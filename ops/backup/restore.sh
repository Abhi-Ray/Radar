#!/usr/bin/env bash
# Restore a RADAR database backup (runs in the `backup` container).
#
#   radar-restore [--yes-i-know] [--target DB] [--file PATH [--sha256 HEX]]
#                 [--no-safety-dump] [--skip-count-check]
#
#   Source (default): the latest backup on BACKUP_BRANCH (db-backups). Uses the deploy key when
#   it works, otherwise reads the public repo anonymously over https.
#   --file PATH       a folder holding LATEST.json + LATEST.meta.enc + radar-db.sql.gz.enc[.part-*]
#                     (e.g. a manual download of the branch), or a single radar-db.sql.gz.enc (then
#                     --sha256 is strongly recommended; row counts cannot be checked)
#   --target DB       database to restore into (default: MYSQL_DATABASE, the LIVE database)
#   --yes-i-know      required when the target is the live database: it is DROPPED and
#                     re-created. Stop app + worker first (docker compose stop app worker).
#   --no-safety-dump  skip the encrypted copy of the current live DB taken before it is dropped
#   --skip-count-check  do not compare restored row counts with the backup metadata (also lets a
#                     backup whose LATEST.meta.enc is missing or unreadable be restored)
#
# Steps: fetch → verify sizes + sha256 → decrypt metadata + gunzip test → (safety dump) →
# DROP/CREATE → import → compare row counts with the metadata (LATEST.meta.enc, encrypted with
# BACKUP_PASSPHRASE). Exit 0 only when everything matched.
set -Eeuo pipefail
umask 077

RADAR_SCRIPT=restore
RB_HOME="${RADAR_BACKUP_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}"
# shellcheck source=ops/backup/lib.sh
. "$RB_HOME/lib.sh"

YES=0
TARGET=
FILE=
WANT_SHA=
SAFETY_DUMP=1
COUNT_CHECK=1
usage() { rb_usage "$0"; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --yes-i-know) YES=1 ;;
    --target)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      TARGET=$2
      shift
      ;;
    --file)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      FILE=$2
      shift
      ;;
    --sha256)
      [ "$#" -ge 2 ] || { usage >&2; exit 2; }
      WANT_SHA=$2
      shift
      ;;
    --no-safety-dump) SAFETY_DUMP=0 ;;
    --skip-count-check) COUNT_CHECK=0 ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

on_exit() {
  local code=$?
  set +e
  trap - EXIT INT TERM
  rb_unlock
  rb_cleanup_tmp
  if [ "$code" != 0 ] && [ "${RB_LOCK_BUSY:-0}" != 1 ]; then rb_error "restore FAILED${RB_FAIL_REASON:+: $RB_FAIL_REASON}"; fi
  exit "$code"
}
trap on_exit EXIT
trap 'RB_FAIL_REASON="interrupted by signal"; exit 1' INT TERM

rb_need mysql mysqldump openssl gzip git od tr cut grep sed
rb_load_config
rb_require_passphrase 1
TARGET=${TARGET:-$MYSQL_DATABASE}
rb_valid_ident "$TARGET" || rb_die "--target must match [A-Za-z0-9_]"
LIVE=0
[ "$TARGET" = "$MYSQL_DATABASE" ] && LIVE=1
if [ "$LIVE" = 1 ] && [ "$YES" != 1 ]; then
  rb_die "refusing to overwrite the LIVE database '$TARGET' without --yes-i-know (stop app + worker first)"
fi
if [ -n "$WANT_SHA" ]; then printf '%s' "$WANT_SHA" | grep -Eq '^[0-9a-f]{64}$' || rb_die "--sha256 must be 64 lowercase hex characters"; fi

rb_make_tmp
rb_lock
rb_write_mycnf
rb_wait_for_db 300

# ---------------------------------------------------------------------------------------------
# 1. obtain + verify the backup
ENC="$RB_TMP/backup.enc"
SRC=
META=
if [ -n "$FILE" ]; then
  if [ -d "$FILE" ]; then
    rb_info "using backup folder $FILE"
    rb_assemble_backup "$FILE" "$ENC"
    SRC=$FILE
  elif [ -f "$FILE" ]; then
    rb_info "using single backup file $FILE"
    cp "$FILE" "$ENC"
    if [ -n "$WANT_SHA" ]; then
      [ "$(rb_sha256 "$ENC")" = "$WANT_SHA" ] || rb_die "sha256 of $FILE does not match --sha256"
    else
      rb_warn "no --sha256 given: integrity is only checked by decryption + gzip CRC"
    fi
  else
    rb_die "--file not found: $FILE"
  fi
else
  rb_git_setup optional
  rb_info "fetching the latest backup from branch $BACKUP_BRANCH"
  rb_fetch_backup "$RB_TMP/src" || rb_die "could not fetch branch $BACKUP_BRANCH: $(tail -n 1 "$RB_TMP/clone.err" 2>/dev/null)"
  rb_assemble_backup "$RB_TMP/src" "$ENC"
  SRC="$RB_TMP/src"
fi
if [ -n "$SRC" ]; then
  # Plain LATEST.json (verified above: sizes + sha256) and the private metadata next to it.
  cp "$SRC/LATEST.json" "$RB_TMP/LATEST.json"
  PUBMETA="$RB_TMP/LATEST.json"
  META="$RB_TMP/meta.json"
  if rb_backup_meta "$SRC" "$META"; then
    rb_info "backup created $(rb_json_get "$PUBMETA" '$.createdAt'), $(rb_json_get "$PUBMETA" '$.sizeBytes') bytes, $(rb_json_get "$META" '$.totalRows') rows"
  elif [ "$COUNT_CHECK" = 1 ]; then
    rb_die "cannot read the backup metadata: $RB_META_ERROR (row counts cannot be checked; to restore anyway add --skip-count-check)"
  else
    rb_warn "cannot read the backup metadata ($RB_META_ERROR); restoring without it (--skip-count-check)"
    META=
  fi
fi
rb_verify_encrypted_dump "$ENC"
rb_info "backup verified (sha256, decryption, gzip, dump completion marker)"

# ---------------------------------------------------------------------------------------------
# 2. protect the live database
if [ "$LIVE" = 1 ]; then
  others=$(printf 'SELECT COUNT(*) FROM information_schema.processlist WHERE db = %s AND id <> CONNECTION_ID();\n' "$(rb_sql_str "$TARGET")" | rb_mysql)
  [ "${others:-0}" = 0 ] || rb_die "$others other connection(s) are using '$TARGET'; stop them first: docker compose stop app worker"
  if [ "$SAFETY_DUMP" = 1 ] && rb_db_exists "$TARGET"; then
    mkdir -p "$BACKUP_WORK_DIR/pre-restore"
    safety="$BACKUP_WORK_DIR/pre-restore/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.enc"
    if mysqldump --defaults-extra-file="$RB_MYCNF" --single-transaction --quick --routines --triggers --events \
      --no-tablespaces --set-gtid-purged=OFF --hex-blob --default-character-set=utf8mb4 --max-allowed-packet=1073741824 \
      "$TARGET" 2>"$RB_TMP/safety.err" |
      gzip -9 |
      openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE -out "$safety"; then
      rb_info "safety copy of the current database: $safety (encrypted; keep until the restore is verified)"
      # Keep the two newest safety copies only.
      # shellcheck disable=SC2012
      ls -1t "$BACKUP_WORK_DIR/pre-restore/"pre-restore-*.sql.gz.enc 2>/dev/null | sed -n '3,$p' | while read -r old; do rm -f "$old"; done
    else
      rm -f "$safety"
      rb_warn "safety dump of the current database failed (continuing: it may be the corrupted copy being replaced)"
    fi
  fi
fi

# ---------------------------------------------------------------------------------------------
# 3. replace + import
rb_info "re-creating database $TARGET"
printf 'DROP DATABASE IF EXISTS `%s`; CREATE DATABASE `%s` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;\n' "$TARGET" "$TARGET" |
  rb_mysql || rb_die "could not re-create database $TARGET"
rb_info "importing (this can take a few minutes)"
rb_import_dump "$ENC" "$TARGET"

# ---------------------------------------------------------------------------------------------
# 4. verify
if [ -n "$META" ] && [ "$COUNT_CHECK" = 1 ]; then
  if ! rb_compare_counts "$TARGET" "$META" "$RB_TMP/mismatches"; then
    rb_die "restored into '$TARGET' but row counts differ from the backup metadata: $(head -n 5 "$RB_TMP/mismatches" | tr '\n' ';')"
  fi
  rb_info "row counts match the backup metadata for all $RB_TABLES_COMPARED tables"
fi
# ---------------------------------------------------------------------------------------------
# 5. The dump was taken while its own backup_runs row still said 'running'. That backup did
#    succeed (it was pushed), so finish the row the way backup.sh did — otherwise the next
#    backup's stale-run cleanup would report it as interrupted.
if [ -n "$META" ] && rb_table_exists "$TARGET" backup_runs; then
  run_id=$(rb_json_get "$META" '$.runId' 2>/dev/null || true)
  if rb_is_uint "$run_id"; then
    printf "UPDATE backup_runs SET status = 'ok', finished_at = STR_TO_DATE(%s, %s), size_bytes = %s, sha256 = %s, details_json = JSON_OBJECT('format', %s, 'createdAt', %s, 'finishedBy', 'radar-restore') WHERE id = %s AND kind = 'backup' AND status = 'running';\n" \
      "$(rb_sql_str "$(rb_json_get "$PUBMETA" '$.createdAt')")" "$(rb_sql_str '%Y-%m-%dT%H:%i:%sZ')" \
      "$(rb_json_get "$PUBMETA" '$.sizeBytes' | grep -E '^[0-9]+$' || printf NULL)" \
      "$(rb_sql_str "$(rb_json_get "$PUBMETA" '$.sha256')")" "$(rb_sql_str "$(rb_json_get "$PUBMETA" '$.format')")" \
      "$(rb_sql_str "$(rb_json_get "$PUBMETA" '$.createdAt')")" "$run_id" |
      rb_mysql "$TARGET" || rb_warn "could not finish backup_runs row $run_id in the restored database"
  fi
fi
rb_info "restore into '$TARGET' complete"
if [ "$LIVE" = 1 ]; then rb_info "next: docker compose up -d   (then check /api/health and the /system page)"; fi
