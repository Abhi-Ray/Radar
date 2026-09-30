#!/usr/bin/env bash
# RADAR daily database backup (runs in the `backup` container; scheduled by scheduler.sh).
#
#   radar-backup [--allow-shrink]
#
#   1. mysqldump --single-transaction … | gzip -9 | openssl enc -aes-256-cbc -pbkdf2 -iter 600000
#      (the DB password sits in a temp option file, never on the command line)
#   2. self-check: decrypt → gunzip → "-- Dump completed" marker; sha256; exact per-table row
#      counts taken before and after the dump (tables that changed meanwhile are "volatile")
#   3. publish radar-db.sql.gz.enc (+ .part-* when > 45 MiB), LATEST.json (only format, time,
#      file names, sizes, sha256, cipher) and LATEST.meta.enc (row counts, tables, migrations,
#      run id — encrypted like the dump) as ONE orphan commit, force-pushed to BACKUP_BRANCH
#      (db-backups): yesterday's copy is replaced and the branch history never grows
#   4. record the result in backup_runs; on failure raise a critical `backup_failed` alert
#      (deduplicated per UTC day) and exit 1
#
# Safety: refuses to replace a stored backup holding more than twice as many rows (an empty or
# wrong database must never overwrite the only off-site copy) unless --allow-shrink is given.
# The guard fails closed: a stored backup whose metadata cannot be fetched, decrypted or parsed
# is not replaced either (again unless --allow-shrink).
#
# Exit codes: 0 ok, 1 failed (recorded + alerted), 2 usage, 75 another DB job is running.
set -Eeuo pipefail
umask 077

RADAR_SCRIPT=backup
RB_HOME="${RADAR_BACKUP_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}"
# shellcheck source=ops/backup/lib.sh
. "$RB_HOME/lib.sh"

ALLOW_SHRINK=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --allow-shrink) ALLOW_SHRINK=1 ;;
    -h | --help)
      rb_usage "$0"
      exit 0
      ;;
    *)
      printf 'unknown argument: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

STEP=init
OK=0
RUN_ID=
SIZE=
SHA=
STARTED_S=$(date -u +%s)
RB_FAIL_REASON=

on_exit() {
  local code=$?
  set +e
  trap - EXIT INT TERM
  if [ "$OK" != 1 ] && [ "${RB_LOCK_BUSY:-0}" != 1 ]; then
    local reason=${RB_FAIL_REASON:-"failed during step '$STEP' (exit $code)"}
    rb_error "backup FAILED: $reason"
    if [ -n "${RB_MYCNF:-}" ] && [ -f "${RB_MYCNF:-/nonexistent}" ]; then
      local details="$RB_TMP/details-failed.json"
      printf '{"step":%s,"durationMs":%s}\n' "$(rb_json_str "$STEP")" "$((($(date -u +%s) - STARTED_S) * 1000))" >"$details"
      rb_run_finish "$RUN_ID" failed "$SIZE" "" "$details" "$reason"
      rb_raise_alert backup_failed critical "Database backup failed" \
        "The nightly encrypted backup did not complete (step: $STEP). $reason. The previous backup on branch ${BACKUP_BRANCH:-db-backups} is unchanged. Check: docker compose logs backup; docs/RECOVERY.md." \
        "backup_failed:$(date -u +%Y-%m-%d)" backup_run "$RUN_ID" >/dev/null
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

rb_need mysql mysqldump openssl gzip git split od tr cut grep sed
rb_load_config
rb_require_passphrase 24
rb_make_tmp
rb_lock
rb_state_set last-backup-attempt
rb_write_mycnf

STEP=connect
rb_wait_for_db 300
rb_fail_stale_runs
RUN_ID=$(rb_run_start backup)
rb_info "backup started (run ${RUN_ID:-unrecorded}, database $MYSQL_DATABASE)"

# ---------------------------------------------------------------------------------------------
STEP=count-before
rb_row_counts "$MYSQL_DATABASE" >"$RB_TMP/counts.before" || rb_die "could not count rows"
[ -s "$RB_TMP/counts.before" ] || rb_die "database $MYSQL_DATABASE has no tables (not migrated yet?)"

STEP=dump
ENC="$RB_TMP/$BACKUP_FILE_NAME"
if ! mysqldump --defaults-extra-file="$RB_MYCNF" \
  --single-transaction --quick --routines --triggers --events --no-tablespaces --set-gtid-purged=OFF \
  --hex-blob --default-character-set=utf8mb4 --max-allowed-packet=1073741824 \
  "$MYSQL_DATABASE" 2>"$RB_TMP/dump.err" |
  gzip -9 |
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE -out "$ENC"; then
  rb_die "mysqldump failed: $(grep -v -i 'warning' "$RB_TMP/dump.err" | tail -n 2 | tr '\n' ' ')"
fi

STEP=count-after
rb_row_counts "$MYSQL_DATABASE" >"$RB_TMP/counts.after" || rb_die "could not count rows after the dump"

STEP=verify
rb_verify_encrypted_dump "$ENC"
SIZE=$(rb_size "$ENC")
SHA=$(rb_sha256 "$ENC")
[ "$SIZE" -le "$BACKUP_MAX_SIZE" ] || rb_die "encrypted dump is $SIZE bytes, above BACKUP_MAX_SIZE ($BACKUP_MAX_SIZE)"

# ---------------------------------------------------------------------------------------------
STEP=metadata
TAB=$(printf '\t')
ROWCOUNTS_JSON=
VOLATILE_JSON=
TABLES=0
TOTAL=0
while IFS="$TAB" read -r t before; do
  [ -n "$t" ] || continue
  after=$(grep -E "^${t}${TAB}" "$RB_TMP/counts.after" | cut -f2 || true)
  [ -n "$after" ] || after=$before
  TABLES=$((TABLES + 1))
  TOTAL=$((TOTAL + before))
  ROWCOUNTS_JSON="${ROWCOUNTS_JSON:+$ROWCOUNTS_JSON, }\"$t\": $before"
  if [ "$after" != "$before" ]; then
    lo=$before hi=$after
    [ "$after" -lt "$before" ] && lo=$after hi=$before
    VOLATILE_JSON="${VOLATILE_JSON:+$VOLATILE_JSON, }\"$t\": [$lo, $hi]"
    rb_warn "table $t changed during the dump ($before → $after rows); recorded as volatile"
  fi
done <"$RB_TMP/counts.before"

MYSQL_VERSION=$(printf 'SELECT VERSION();\n' | rb_mysql)
LASTMIG_JSON=null
MIG_COUNT=0
if rb_table_exists "$MYSQL_DATABASE" __drizzle_migrations; then
  MIG_COUNT=$(printf 'SELECT COUNT(*) FROM `__drizzle_migrations`;\n' | rb_mysql "$MYSQL_DATABASE")
  mig=$(printf 'SELECT created_at, hash FROM `__drizzle_migrations` ORDER BY created_at DESC, id DESC LIMIT 1;\n' | rb_mysql "$MYSQL_DATABASE")
  mig_at=$(printf '%s' "$mig" | cut -f1)
  mig_hash=$(printf '%s' "$mig" | cut -f2)
  if rb_is_uint "$mig_at"; then
    tag_json=null
    journal="$RADAR_MIGRATIONS_DIR/meta/_journal.json"
    if [ -r "$journal" ]; then
      tag=$(printf "SELECT j.tag FROM JSON_TABLE(CAST(%s AS JSON), '\$.entries[*]' COLUMNS (tag VARCHAR(255) PATH '\$.tag', w BIGINT PATH '\$.when')) j WHERE j.w = %s LIMIT 1;\n" \
        "$(rb_sql_file "$journal")" "$mig_at" | rb_mysql 2>/dev/null || true)
      [ -n "$tag" ] && tag_json=$(rb_json_str "$tag")
    fi
    printf '%s' "$mig_hash" | grep -Eq '^[0-9a-f]{64}$' || mig_hash=
    LASTMIG_JSON="{\"createdAt\": $mig_at, \"hash\": $([ -n "$mig_hash" ] && printf '"%s"' "$mig_hash" || printf null), \"tag\": $tag_json}"
  fi
fi

# ---------------------------------------------------------------------------------------------
STEP=prepare
PUB="$RB_TMP/publish"
mkdir -p "$PUB"
PARTS_JSON=
if [ "$SIZE" -gt "$BACKUP_PART_SIZE" ]; then
  split -b "$BACKUP_PART_SIZE" -a 3 "$ENC" "$PUB/$BACKUP_FILE_NAME.part-"
  rm -f "$ENC"
  for f in "$PUB/$BACKUP_FILE_NAME".part-*; do
    n=$(basename "$f")
    PARTS_JSON="${PARTS_JSON:+$PARTS_JSON, }{\"name\": \"$n\", \"sizeBytes\": $(rb_size "$f"), \"sha256\": \"$(rb_sha256 "$f")\"}"
  done
  # shellcheck disable=SC2012
  rb_info "split into $(ls "$PUB" | grep -c 'part-') parts of <= $BACKUP_PART_SIZE bytes"
else
  mv "$ENC" "$PUB/$BACKUP_FILE_NAME"
  PARTS_JSON="{\"name\": \"$BACKUP_FILE_NAME\", \"sizeBytes\": $SIZE, \"sha256\": \"$SHA\"}"
fi

CREATED_AT=$(rb_now_iso)
# Public: only what is needed to fetch and verify the files.
{
  printf '{\n'
  printf '  "format": "%s",\n' "$RB_FORMAT"
  printf '  "createdAt": "%s",\n' "$CREATED_AT"
  printf '  "file": "%s",\n' "$BACKUP_FILE_NAME"
  printf '  "sizeBytes": %s,\n' "$SIZE"
  printf '  "sha256": "%s",\n' "$SHA"
  printf '  "parts": [%s],\n' "$PARTS_JSON"
  printf '  "encryption": %s\n' "$(rb_json_str "$RB_CIPHER_DESC")"
  printf '}\n'
} >"$PUB/LATEST.json"
[ "$(rb_json_get "$PUB/LATEST.json" '$.format')" = "$RB_FORMAT" ] || rb_die "generated LATEST.json is not valid JSON"

# Private: encrypted with BACKUP_PASSPHRASE into LATEST.meta.enc (sha256 ties it to this dump).
{
  printf '{\n'
  printf '  "format": "%s",\n' "$RB_FORMAT"
  printf '  "createdAt": "%s",\n' "$CREATED_AT"
  printf '  "sha256": "%s",\n' "$SHA"
  printf '  "database": %s,\n' "$(rb_json_str "$MYSQL_DATABASE")"
  printf '  "compression": "gzip -9",\n'
  printf '  "mysqlVersion": %s,\n' "$(rb_json_str "$MYSQL_VERSION")"
  printf '  "tables": %s,\n' "$TABLES"
  printf '  "totalRows": %s,\n' "$TOTAL"
  printf '  "rowCounts": {%s},\n' "$ROWCOUNTS_JSON"
  printf '  "volatileTables": {%s},\n' "$VOLATILE_JSON"
  printf '  "lastMigration": %s,\n' "$LASTMIG_JSON"
  printf '  "migrationsApplied": %s,\n' "$MIG_COUNT"
  # The backup_runs row of this run is inside the dump as 'running'; radar-restore finishes it.
  printf '  "runId": %s,\n' "$(rb_is_uint "$RUN_ID" && printf '%s' "$RUN_ID" || printf null)"
  printf '  "tool": "radar-backup/2"\n'
  printf '}\n'
} >"$RB_TMP/meta.json"
[ "$(rb_json_get "$RB_TMP/meta.json" '$.totalRows')" = "$TOTAL" ] || rb_die "generated metadata is not valid JSON"
rb_encrypt_file "$RB_TMP/meta.json" "$PUB/$RB_META_FILE" || rb_die "cannot encrypt the backup metadata"
rb_backup_meta "$PUB" "$RB_TMP/meta.check.json" || rb_die "self-check of $RB_META_FILE failed: $RB_META_ERROR"

# ---------------------------------------------------------------------------------------------
STEP=remote-check
rb_git_setup
set +e
rb_remote_branch_state
REMOTE_STATE=$?
set -e
case "$REMOTE_STATE" in
  0)
    REMOTE_TOTAL=
    RB_META_ERROR=
    mkdir -p "$RB_TMP/remote-meta"
    if rb_clone_backup "$RB_TMP/remote" meta &&
      git -C "$RB_TMP/remote" show HEAD:LATEST.json >"$RB_TMP/remote-meta/LATEST.json" 2>/dev/null; then
      git -C "$RB_TMP/remote" show "HEAD:$RB_META_FILE" >"$RB_TMP/remote-meta/$RB_META_FILE" 2>/dev/null ||
        rm -f "$RB_TMP/remote-meta/$RB_META_FILE"
      if rb_backup_meta "$RB_TMP/remote-meta" "$RB_TMP/remote.json"; then
        REMOTE_TOTAL=$(rb_json_get "$RB_TMP/remote.json" '$.totalRows' 2>/dev/null || true)
        rb_is_uint "$REMOTE_TOTAL" || RB_META_ERROR='the stored metadata has no totalRows'
      fi
    else
      RB_META_ERROR="cannot fetch LATEST.json from $BACKUP_BRANCH ($(tail -n 1 "$RB_TMP/clone.err" 2>/dev/null))"
    fi
    if ! rb_is_uint "$REMOTE_TOTAL"; then
      # Fail closed: without the stored row count the shrink guard cannot tell a healthy
      # database from an empty one, and this push would replace the only off-site copy.
      if [ "$ALLOW_SHRINK" = 1 ]; then
        rb_warn "cannot read the stored backup's metadata ($RB_META_ERROR); replacing it anyway (--allow-shrink)"
      else
        rb_die "cannot read the stored backup's metadata ($RB_META_ERROR); refusing to replace it. Retry later; if the stored copy is known to be unusable (e.g. BACKUP_PASSPHRASE was rotated) run: radar-backup --allow-shrink"
      fi
    elif [ "$REMOTE_TOTAL" -gt 100 ] && [ $((TOTAL * 100)) -lt $((REMOTE_TOTAL * BACKUP_SHRINK_GUARD_PCT)) ]; then
      if [ "$ALLOW_SHRINK" = 1 ]; then
        rb_warn "replacing a backup of $REMOTE_TOTAL rows with $TOTAL rows (--allow-shrink)"
      else
        rb_die "refusing to replace the stored backup ($REMOTE_TOTAL rows) with a much smaller one ($TOTAL rows); if intended run: radar-backup --allow-shrink"
      fi
    fi
    ;;
  1) rb_info "branch $BACKUP_BRANCH does not exist yet; creating it" ;;
  *) rb_die "cannot reach the backup remote: $(tail -n 1 "$RB_TMP/ls-remote.err" 2>/dev/null)" ;;
esac

STEP=push
git -C "$PUB" init --quiet
git -C "$PUB" checkout --quiet --orphan "$BACKUP_BRANCH"
git -C "$PUB" add -A
git -C "$PUB" -c user.name="$RB_GIT_NAME" -c user.email="$RB_GIT_EMAIL" -c commit.gpgsign=false \
  commit --quiet -m "db backup $CREATED_AT ($SIZE bytes, sha256 ${SHA:0:12})"
COMMIT=$(git -C "$PUB" rev-parse HEAD)
pushed=0
for attempt in 1 2 3; do
  if git -C "$PUB" -c core.bigFileThreshold=1m -c pack.compression=0 \
    push --quiet --force "$RB_GIT_URL" "HEAD:refs/heads/$BACKUP_BRANCH" 2>"$RB_TMP/push.err"; then
    pushed=1
    break
  fi
  rb_warn "push attempt $attempt failed: $(tail -n 1 "$RB_TMP/push.err")"
  [ "$attempt" -lt 3 ] && sleep $((attempt * 30))
done
[ "$pushed" = 1 ] || rb_die "git push to $BACKUP_BRANCH failed: $(tail -n 1 "$RB_TMP/push.err")"
REMOTE_HEAD=$(git ls-remote --heads "$RB_GIT_URL" "refs/heads/$BACKUP_BRANCH" 2>/dev/null | cut -f1 || true)
[ "$REMOTE_HEAD" = "$COMMIT" ] || rb_die "remote branch does not point at the pushed commit"

# ---------------------------------------------------------------------------------------------
STEP=record
DURATION_MS=$((($(date -u +%s) - STARTED_S) * 1000))
PART_COUNT=$(printf '%s' "$PARTS_JSON" | grep -o '"name"' | wc -l | tr -d ' ')
printf '{"format":"%s","createdAt":"%s","branch":%s,"commit":"%s","parts":%s,"tables":%s,"totalRows":%s,"volatileTables":{%s},"lastMigration":%s,"durationMs":%s}\n' \
  "$RB_FORMAT" "$CREATED_AT" "$(rb_json_str "$BACKUP_BRANCH")" "$COMMIT" "$PART_COUNT" "$TABLES" "$TOTAL" "$VOLATILE_JSON" "$LASTMIG_JSON" "$DURATION_MS" \
  >"$RB_TMP/details.json"
rb_run_finish "$RUN_ID" ok "$SIZE" "$SHA" "$RB_TMP/details.json" ""
cp "$PUB/LATEST.json" "$PUB/$RB_META_FILE" "$RB_STATE_DIR/"
rb_state_set last-backup-ok
OK=1
rb_info "backup ok: $SIZE bytes, sha256 $SHA, $TABLES tables, $TOTAL rows, commit ${COMMIT:0:12} on $BACKUP_BRANCH (${DURATION_MS} ms)"
