#!/usr/bin/env bash
# Monthly restore test (spec §21: "a backup that has never been restored doesn't count").
#
#   radar-restore-test
#
# Fetches the latest backup from BACKUP_BRANCH, verifies sha256 + decryption, restores it into
# the throw-away database RESTORE_TEST_DB (radar_restore_test) on the same MySQL server, compares
# every table's row count and the last migration with LATEST.json, then drops the test database.
# The live database is never touched (except for the backup_runs / alerts bookkeeping rows).
#
# Records a backup_runs row (kind restore_test). On failure — including a latest backup older
# than 72 h — raises a critical `restore_test_failed` alert (deduplicated per UTC day), exit 1.
set -Eeuo pipefail
umask 077

RADAR_SCRIPT=restore-test
RB_HOME="${RADAR_BACKUP_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}"
# shellcheck source=ops/backup/lib.sh
. "$RB_HOME/lib.sh"

case "${1:-}" in
  '') ;;
  -h | --help)
    rb_usage "$0"
    exit 0
    ;;
  *)
    printf 'unknown argument: %s\n' "$1" >&2
    exit 2
    ;;
esac

MAX_AGE_HOURS="${RESTORE_TEST_MAX_BACKUP_AGE_HOURS:-72}"
STEP=init
OK=0
RUN_ID=
STARTED_S=$(date -u +%s)
RB_FAIL_REASON=
TEST_DB_CREATED=0
DETAILS_EXTRA=

drop_test_db() {
  if [ "$TEST_DB_CREATED" = 1 ]; then
    printf 'DROP DATABASE IF EXISTS `%s`;\n' "$RESTORE_TEST_DB" | rb_mysql || rb_warn "could not drop $RESTORE_TEST_DB"
    TEST_DB_CREATED=0
  fi
}

write_details() { # file
  printf '{"database":%s,"durationMs":%s,"step":%s%s}\n' "$(rb_json_str "$RESTORE_TEST_DB")" \
    "$((($(date -u +%s) - STARTED_S) * 1000))" "$(rb_json_str "$STEP")" "$DETAILS_EXTRA" >"$1"
}

on_exit() {
  local code=$?
  set +e
  trap - EXIT INT TERM
  if [ -n "${RB_MYCNF:-}" ] && [ -f "${RB_MYCNF:-/nonexistent}" ]; then
    drop_test_db
    if [ "$OK" != 1 ] && [ "${RB_LOCK_BUSY:-0}" != 1 ]; then
      local reason=${RB_FAIL_REASON:-"failed during step '$STEP' (exit $code)"}
      rb_error "restore test FAILED: $reason"
      write_details "$RB_TMP/details.json"
      rb_run_finish "$RUN_ID" failed "${SIZE:-}" "${SHA:-}" "$RB_TMP/details.json" "$reason"
      rb_raise_alert restore_test_failed critical "Backup restore test failed" \
        "The monthly restore test of the latest backup failed (step: $STEP). $reason. Until it passes, treat the backup as unproven. See docs/RECOVERY.md (g)." \
        "restore_test_failed:$(date -u +%Y-%m-%d)" backup_run "$RUN_ID" >/dev/null
    fi
  fi
  rb_unlock
  rb_cleanup_tmp
  [ "$OK" = 1 ] && exit 0
  [ "${RB_LOCK_BUSY:-0}" = 1 ] && exit 75
  [ "$code" = 0 ] && code=1
  exit "$code"
}
trap on_exit EXIT
trap 'RB_FAIL_REASON="interrupted by signal"; exit 1' INT TERM

rb_need mysql openssl gzip git od tr cut grep sed
rb_load_config
rb_require_passphrase 1
rb_is_uint "$MAX_AGE_HOURS" || rb_die "RESTORE_TEST_MAX_BACKUP_AGE_HOURS must be a number"
rb_make_tmp
rb_lock
rb_state_set last-restore-test-attempt
rb_write_mycnf

STEP=connect
rb_wait_for_db 300
rb_fail_stale_runs
RUN_ID=$(rb_run_start restore_test)
rb_info "restore test started (run ${RUN_ID:-unrecorded})"

STEP=fetch
rb_git_setup optional
rb_fetch_backup "$RB_TMP/src" || rb_die "could not fetch branch $BACKUP_BRANCH: $(tail -n 1 "$RB_TMP/clone.err" 2>/dev/null)"
META="$RB_TMP/src/LATEST.json"

STEP=verify
ENC="$RB_TMP/backup.enc"
rb_assemble_backup "$RB_TMP/src" "$ENC"
SIZE=$(rb_json_get "$META" '$.sizeBytes')
SHA=$(rb_json_get "$META" '$.sha256')
CREATED_AT=$(rb_json_get "$META" '$.createdAt')
rb_verify_encrypted_dump "$ENC"

# Age of the backup (createdAt is written by backup.sh as YYYY-MM-DDTHH:MM:SSZ).
AGE_HOURS=-1
if printf '%s' "$CREATED_AT" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$'; then
  c_days=$(rb_days_from_civil "${CREATED_AT:0:4}" "$((10#${CREATED_AT:5:2}))" "$((10#${CREATED_AT:8:2}))")
  c_epoch=$((c_days * 86400 + 10#${CREATED_AT:11:2} * 3600 + 10#${CREATED_AT:14:2} * 60 + 10#${CREATED_AT:17:2}))
  AGE_HOURS=$((($(date -u +%s) - c_epoch) / 3600))
fi
DETAILS_EXTRA=",\"backupCreatedAt\":$(rb_json_str "$CREATED_AT"),\"backupSha256\":$(rb_json_str "$SHA"),\"backupSizeBytes\":${SIZE:-null},\"backupAgeHours\":$AGE_HOURS"

STEP=restore
printf 'DROP DATABASE IF EXISTS `%s`; CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n' \
  "$RESTORE_TEST_DB" "$RESTORE_TEST_DB" | rb_mysql || rb_die "could not create $RESTORE_TEST_DB"
TEST_DB_CREATED=1
rb_import_dump "$ENC" "$RESTORE_TEST_DB"

STEP=compare
COUNTS_OK=1
rb_compare_counts "$RESTORE_TEST_DB" "$META" "$RB_TMP/mismatches" || COUNTS_OK=0
EXPECTED_MIG=$(rb_json_get "$META" '$.lastMigration.createdAt')
if [ -n "$EXPECTED_MIG" ]; then
  actual_mig=$(printf 'SELECT COALESCE(MAX(created_at), 0) FROM `%s`.`__drizzle_migrations`;\n' "$RESTORE_TEST_DB" | rb_mysql 2>/dev/null || true)
  if [ "$actual_mig" != "$EXPECTED_MIG" ]; then
    printf '__drizzle_migrations: last migration %s, expected %s\n' "${actual_mig:-missing}" "$EXPECTED_MIG" >>"$RB_TMP/mismatches"
    COUNTS_OK=0
  fi
fi
MISMATCH_JSON=
while IFS= read -r line; do
  [ -n "$line" ] || continue
  MISMATCH_JSON="${MISMATCH_JSON:+$MISMATCH_JSON,}$(rb_json_str "$line")"
done <"$RB_TMP/mismatches"
DETAILS_EXTRA="$DETAILS_EXTRA,\"tablesCompared\":${RB_TABLES_COMPARED:-0},\"mismatches\":[${MISMATCH_JSON}]"

STEP=cleanup
drop_test_db

STEP=result
[ "$COUNTS_OK" = 1 ] || rb_die "restored data differs from LATEST.json: $(head -n 5 "$RB_TMP/mismatches" | tr '\n' ';')"
if [ "$AGE_HOURS" -lt 0 ]; then rb_die "LATEST.json has no valid createdAt"; fi
if [ "$AGE_HOURS" -gt "$MAX_AGE_HOURS" ]; then
  rb_die "restore works, but the latest backup is ${AGE_HOURS} h old (limit ${MAX_AGE_HOURS} h): nightly backups are not being pushed"
fi

write_details "$RB_TMP/details.json"
rb_run_finish "$RUN_ID" ok "$SIZE" "$SHA" "$RB_TMP/details.json" ""
rb_state_set last-restore-test-ok
OK=1
rb_info "restore test ok: backup of $CREATED_AT (${AGE_HOURS} h old), ${RB_TABLES_COMPARED} tables match"
