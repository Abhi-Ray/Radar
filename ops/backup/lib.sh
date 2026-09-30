# shellcheck shell=bash
# Shared helpers for the RADAR backup container (sourced by backup.sh, restore.sh,
# restore-test.sh, scheduler.sh and radar-alert.sh — never executed directly).
#
# Portable on purpose: bash 3.2+ (the macOS test suite) and bash 5 (the Oracle Linux 9 based
# mysql:8.4 image); GNU or BSD userland; no jq/awk — JSON is written with printf and read back
# through MySQL's own JSON functions.
#
# Secrets: the DB password only ever lives in a mode-600 option file inside a private temp dir
# (removed on exit); BACKUP_PASSPHRASE is handed to openssl as `-pass env:…`; the deploy key is
# copied to the temp dir with mode 600. None of them ever appears on a command line or in a log.
#
# The backup branch may be public: its plain LATEST.json holds only what is needed to fetch and
# verify the files (format, time, names, sizes, sha256, cipher). Row counts, schema level and run
# id are activity metadata and live in LATEST.meta.enc, encrypted exactly like the dump.

RADAR_SCRIPT="${RADAR_SCRIPT:-radar-backup}"

# Encryption parameters — MUST stay identical to ops/secrets.sh and docs/RECOVERY.md.
RB_CIPHER_DESC='openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt, passphrase = BACKUP_PASSPHRASE'
RB_FORMAT='radar-db-backup/2'
# Format 1 kept the row counts etc. in the plain LATEST.json; such backups stay readable.
RB_FORMAT_LEGACY='radar-db-backup/1'
RB_META_FILE='LATEST.meta.enc'
RB_FILE_RE='^radar-db\.sql\.gz\.enc(\.part-[a-z]{3})?$'

# ---------------------------------------------------------------------------------------------
# logging

rb_now_iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }
rb_log() {
  local level=$1
  shift
  printf '%s %-5s %s: %s\n' "$(rb_now_iso)" "$level" "$RADAR_SCRIPT" "$*" >&2
}
rb_info() { rb_log INFO "$@"; }
rb_warn() { rb_log WARN "$@"; }
rb_error() { rb_log ERROR "$@"; }

# Records the reason for a failure (picked up by the caller's EXIT trap) and exits 1.
rb_die() {
  RB_FAIL_REASON="$*"
  rb_error "$*"
  exit 1
}

# Prints a script's header comment (line 2 up to the first non-comment line) as its usage text.
# Pure bash: the mysql:8.4 image has no awk.
rb_usage() { # file
  local line n=0
  while IFS= read -r line || [ -n "$line" ]; do
    n=$((n + 1))
    [ "$n" = 1 ] && continue
    case "$line" in
      '# '*) printf '%s\n' "${line#'# '}" ;;
      '#'*) printf '%s\n' "${line#'#'}" ;;
      *) break ;;
    esac
  done <"$1"
}

rb_need() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || rb_die "required command not found: $c"
  done
}

# ---------------------------------------------------------------------------------------------
# small pure helpers

rb_is_uint() { case "$1" in '' | *[!0-9]*) return 1 ;; *) return 0 ;; esac; }

# SQL identifier we are willing to interpolate (database / table names).
rb_valid_ident() { printf '%s' "$1" | grep -Eq '^[A-Za-z0-9_]{1,64}$'; }

rb_hex_stdin() { od -An -v -tx1 | tr -d ' \n'; }

# A MySQL string expression for an arbitrary value — hex-encoded, so no quoting/injection issues.
rb_sql_str() {
  if [ -z "$1" ]; then
    printf "''"
  else
    printf "CONVERT(UNHEX('%s') USING utf8mb4)" "$(printf '%s' "$1" | rb_hex_stdin)"
  fi
}

# Same, for a file's content.
rb_sql_file() { printf "CONVERT(UNHEX('%s') USING utf8mb4)" "$(rb_hex_stdin <"$1")"; }

# A JSON string literal (quotes included) for an arbitrary value.
rb_json_str() {
  local s=$1
  s=${s//\\/\\\\}
  s=${s//\"/\\\"}
  s=${s//$'\n'/\\n}
  s=${s//$'\r'/\\r}
  s=${s//$'\t'/\\t}
  s=$(printf '%s' "$s" | tr -d '\000-\010\013\014\016-\037')
  printf '"%s"' "$s"
}

rb_sha256() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$@" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$@" | cut -d' ' -f1
  else
    openssl dgst -sha256 -r "$@" | cut -d' ' -f1
  fi
}

rb_size() { wc -c <"$1" | tr -d ' '; }

# Days since 1970-01-01 → "Y M D" (Howard Hinnant's civil_from_days; pure integer arithmetic,
# so the scheduler behaves identically with GNU and BSD `date`).
rb_civil_from_days() {
  local z=$(($1 + 719468))
  local era=$(((z >= 0 ? z : z - 146096) / 146097))
  local doe=$((z - era * 146097))
  local yoe=$(((doe - doe / 1460 + doe / 36524 - doe / 146096) / 365))
  local y=$((yoe + era * 400))
  local doy=$((doe - (365 * yoe + yoe / 4 - yoe / 100)))
  local mp=$(((5 * doy + 2) / 153))
  local d=$((doy - (153 * mp + 2) / 5 + 1))
  local m=$((mp < 10 ? mp + 3 : mp - 9))
  if [ "$m" -le 2 ]; then y=$((y + 1)); fi
  printf '%d %d %d\n' "$y" "$m" "$d"
}

# "Y M D" → days since 1970-01-01 (days_from_civil).
rb_days_from_civil() {
  local y=$1 m=$2 d=$3
  if [ "$m" -le 2 ]; then y=$((y - 1)); fi
  local era=$(((y >= 0 ? y : y - 399) / 400))
  local yoe=$((y - era * 400))
  local doy=$(((153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1))
  local doe=$((yoe * 365 + yoe / 4 - yoe / 100 + doy))
  printf '%d\n' $((era * 146097 + doe - 719468))
}

# Epoch seconds → ISO-8601 UTC, without GNU/BSD `date` differences.
rb_iso_from_epoch() {
  local t=$1 ymd y m d s
  ymd=$(rb_civil_from_days $((t / 86400)))
  set -- $ymd
  y=$1 m=$2 d=$3
  s=$((t % 86400))
  printf '%04d-%02d-%02dT%02d:%02d:%02dZ\n' "$y" "$m" "$d" $((s / 3600)) $((s % 3600 / 60)) $((s % 60))
}

# ---------------------------------------------------------------------------------------------
# configuration

rb_load_config() {
  MYSQL_HOST="${MYSQL_HOST:-mysql}"
  MYSQL_PORT="${MYSQL_PORT:-3306}"
  MYSQL_DATABASE="${MYSQL_DATABASE:-radar}"
  BACKUP_DB_USER="${BACKUP_DB_USER:-root}"
  BACKUP_DB_PASSWORD="${BACKUP_DB_PASSWORD:-${MYSQL_ROOT_PASSWORD:-}}"
  BACKUP_REPO="${BACKUP_REPO:-git@github.com:Abhi-Ray/Radar.git}"
  BACKUP_BRANCH="${BACKUP_BRANCH:-db-backups}"
  BACKUP_DEPLOY_KEY="${BACKUP_DEPLOY_KEY:-/run/secrets/deploy_key}"
  BACKUP_KNOWN_HOSTS="${BACKUP_KNOWN_HOSTS:-/etc/radar-backup/github_known_hosts}"
  BACKUP_WORK_DIR="${BACKUP_WORK_DIR:-/work}"
  BACKUP_FILE_NAME='radar-db.sql.gz.enc'
  # GitHub rejects files > 100 MB and warns > 50 MB: bigger dumps are split into 45 MiB parts.
  BACKUP_PART_SIZE="${BACKUP_PART_SIZE:-47185920}"
  BACKUP_MAX_SIZE="${BACKUP_MAX_SIZE:-1900000000}"
  # Refuse to replace the stored backup with one holding fewer than this % of its rows
  # (protects the only off-site copy from an empty/new database; override: --allow-shrink).
  BACKUP_SHRINK_GUARD_PCT="${BACKUP_SHRINK_GUARD_PCT:-50}"
  RESTORE_TEST_DB="${RESTORE_TEST_DB:-radar_restore_test}"
  RADAR_MIGRATIONS_DIR="${RADAR_MIGRATIONS_DIR:-/opt/radar-drizzle}"
  RB_GIT_NAME="${BACKUP_GIT_NAME:-RADAR backup}"
  RB_GIT_EMAIL="${BACKUP_GIT_EMAIL:-radar-backup@localhost.invalid}"

  rb_is_uint "$MYSQL_PORT" || rb_die "MYSQL_PORT must be a number"
  rb_valid_ident "$MYSQL_DATABASE" || rb_die "MYSQL_DATABASE must match [A-Za-z0-9_]"
  rb_valid_ident "$RESTORE_TEST_DB" || rb_die "RESTORE_TEST_DB must match [A-Za-z0-9_]"
  [ "$RESTORE_TEST_DB" != "$MYSQL_DATABASE" ] || rb_die "RESTORE_TEST_DB must differ from MYSQL_DATABASE"
  rb_is_uint "$BACKUP_PART_SIZE" && [ "$BACKUP_PART_SIZE" -ge 1048576 ] || rb_die "BACKUP_PART_SIZE must be >= 1048576 bytes"
  rb_is_uint "$BACKUP_MAX_SIZE" || rb_die "BACKUP_MAX_SIZE must be a number"
  rb_is_uint "$BACKUP_SHRINK_GUARD_PCT" && [ "$BACKUP_SHRINK_GUARD_PCT" -le 100 ] || rb_die "BACKUP_SHRINK_GUARD_PCT must be 0-100"
  printf '%s' "$BACKUP_BRANCH" | grep -Eq '^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$' || rb_die "BACKUP_BRANCH has invalid characters"
  # The branch is force-pushed with a single orphan commit: it must never be a code branch.
  case "$BACKUP_BRANCH" in
    *backup*) ;;
    *) rb_die "BACKUP_BRANCH must contain the word 'backup' (it is force-pushed): $BACKUP_BRANCH" ;;
  esac
  case "$BACKUP_DB_PASSWORD" in
    *'"'* | *$'\n'*) rb_die "the database password must not contain double quotes or newlines" ;;
  esac
  RB_STATE_DIR="$BACKUP_WORK_DIR/state"
  mkdir -p "$RB_STATE_DIR" || rb_die "cannot create $RB_STATE_DIR"
}

rb_require_passphrase() {
  [ -n "${BACKUP_PASSPHRASE:-}" ] || rb_die "BACKUP_PASSPHRASE is not set"
  [ "${#BACKUP_PASSPHRASE}" -ge "${1:-1}" ] || rb_die "BACKUP_PASSPHRASE must be at least ${1:-1} characters"
  export BACKUP_PASSPHRASE
}

# ---------------------------------------------------------------------------------------------
# temp dir, locks, state

rb_make_tmp() {
  mkdir -p "${TMPDIR:-/tmp}" 2>/dev/null || true
  RB_TMP=$(mktemp -d "${TMPDIR:-/tmp}/radar-backup.XXXXXX") || rb_die "mktemp failed"
  chmod 700 "$RB_TMP"
}

rb_cleanup_tmp() {
  if [ -n "${RB_TMP:-}" ] && [ -d "$RB_TMP" ]; then rm -rf "$RB_TMP"; fi
  RB_TMP=
}

# This container's name for the job lock (a container has its own hostname and PID namespace).
rb_host() {
  local h=${HOSTNAME:-}
  [ -n "$h" ] || h=$(uname -n 2>/dev/null || true)
  printf '%s\n' "${h:-unknown}" | tr -c 'A-Za-z0-9._\n-' '_'
}

# 0 = the owner of the job lock may still be running. Owner line: "pid host epoch" (older
# versions wrote "pid epoch"). A pid can only be checked from the same host: containers have
# separate PID namespaces, so the scheduler container cannot see a `docker compose run` job.
# A lock from another (or an unknown) host is trusted until it is 6 h old — no job runs that long.
rb_lock_owner_live() { # owner now this_host
  local pid host started
  read -r pid host started <<EOF
$1
EOF
  if [ -z "$started" ]; then
    started=$host
    host=
  fi
  rb_is_uint "$pid" && rb_is_uint "$started" || return 1
  [ $(($2 - started)) -lt 21600 ] || return 1
  if [ -n "$host" ] && [ "$host" = "$3" ]; then
    kill -0 "$pid" 2>/dev/null
    return
  fi
  return 0
}

# One DB job (backup / restore / restore test) at a time: an atomic mkdir lock in the work volume,
# which the scheduler container shares with one-off `docker compose run` containers.
rb_lock() {
  local dir="$BACKUP_WORK_DIR/locks/db-job.lock" owner now me
  mkdir -p "$BACKUP_WORK_DIR/locks"
  now=$(date -u +%s)
  me=$(rb_host)
  if ! mkdir "$dir" 2>/dev/null; then
    owner=$(cat "$dir/owner" 2>/dev/null || true)
    # The owner file is written right after mkdir: an empty one younger than a minute is a job
    # that is just starting.
    if { [ -n "$owner" ] && rb_lock_owner_live "$owner" "$now" "$me"; } ||
      { [ -z "$owner" ] && [ -z "$(find "$dir" -maxdepth 0 -mmin +1 2>/dev/null)" ]; }; then
      RB_LOCK_BUSY=1
      rb_error "another backup/restore job is running (${owner:-starting}); try again later"
      exit 75
    fi
    rb_warn "breaking stale lock (${owner:-no owner})"
    rm -rf "$dir"
    mkdir "$dir" 2>/dev/null || rb_die "could not take the job lock"
  fi
  printf '%s %s %s\n' "$$" "$me" "$now" >"$dir/owner"
  RB_LOCK_DIR=$dir
}

# Scheduler start-up: a job lock owned by this container's previous run is stale (that process
# is gone). A restart keeps the hostname; a re-created container gets a new one, so the
# scheduler passes the one it recorded last time. Locks of other containers are left to rb_lock.
rb_break_own_stale_lock() { # previous_scheduler_host
  local dir="$BACKUP_WORK_DIR/locks/db-job.lock" owner pid host started
  [ -d "$dir" ] || return 0
  owner=$(cat "$dir/owner" 2>/dev/null || true)
  read -r pid host started <<EOF
$owner
EOF
  [ -n "$started" ] || return 0
  if [ "$host" = "$(rb_host)" ] || { [ -n "${1:-}" ] && [ "$host" = "$1" ]; }; then
    rb_warn "removing the job lock left by this container's previous run ($owner)"
    rm -rf "$dir"
  fi
}

# Removes job temp dirs left by killed containers — only ones older than 6 h: TMPDIR lives in the
# work volume, shared with one-off `docker compose run` jobs that may be using theirs right now.
rb_prune_stale_tmp() {
  find "${TMPDIR:-/tmp}" -maxdepth 1 -type d -name 'radar-backup.*' -mmin +360 -exec rm -rf {} + 2>/dev/null || true
}

rb_unlock() {
  if [ -n "${RB_LOCK_DIR:-}" ]; then rm -rf "$RB_LOCK_DIR"; fi
  RB_LOCK_DIR=
}

rb_state_set() { date -u +%s >"$RB_STATE_DIR/$1"; }
rb_state_get() {
  local v
  v=$(cat "$RB_STATE_DIR/$1" 2>/dev/null || true)
  if rb_is_uint "$v"; then printf '%s\n' "$v"; else printf '0\n'; fi
}

# ---------------------------------------------------------------------------------------------
# MySQL

rb_option_escape() {
  local s=$1
  s=${s//\\/\\\\}
  printf '%s' "$s"
}

rb_write_mycnf() {
  RB_MYCNF="$RB_TMP/client.cnf"
  (
    umask 077
    {
      printf '[client]\n'
      printf 'host="%s"\n' "$(rb_option_escape "$MYSQL_HOST")"
      printf 'port=%s\n' "$MYSQL_PORT"
      printf 'user="%s"\n' "$(rb_option_escape "$BACKUP_DB_USER")"
      printf 'password="%s"\n' "$(rb_option_escape "$BACKUP_DB_PASSWORD")"
      printf 'protocol=TCP\n'
      printf 'default-character-set=utf8mb4\n'
      # [client] is read by mysqldump too, which rejects options it does not know (such as
      # connect-timeout): client-specific options go into their own group.
      printf '[mysql]\n'
      printf 'connect-timeout=15\n'
    } >"$RB_MYCNF"
  )
}

# Runs SQL from stdin. Batch mode, no column names, raw values. Extra args (e.g. a db name) follow.
rb_mysql() { mysql --defaults-extra-file="$RB_MYCNF" --batch --skip-column-names --raw "$@"; }

rb_wait_for_db() {
  local deadline=$(($(date -u +%s) + ${1:-300}))
  while :; do
    if printf 'SELECT 1;\n' | rb_mysql >/dev/null 2>"$RB_TMP/wait.err"; then return 0; fi
    if [ "$(date -u +%s)" -ge "$deadline" ]; then
      rb_die "database not reachable at $MYSQL_HOST:$MYSQL_PORT: $(tail -n 1 "$RB_TMP/wait.err" 2>/dev/null)"
    fi
    sleep 3
  done
}

rb_db_exists() {
  local n
  n=$(printf 'SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name = %s;\n' "$(rb_sql_str "$1")" | rb_mysql) || return 2
  [ "$n" = "1" ]
}

rb_table_exists() { # db table
  local n
  n=$(printf 'SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_name = %s;\n' \
    "$(rb_sql_str "$1")" "$(rb_sql_str "$2")" | rb_mysql) || return 2
  [ "$n" = "1" ]
}

# Exact row counts of every base table: "table<TAB>count" lines, sorted by table name.
rb_row_counts() {
  local db=$1 tables t sql=''
  tables=$(printf "SELECT table_name FROM information_schema.tables WHERE table_schema = %s AND table_type = 'BASE TABLE' ORDER BY table_name;\n" \
    "$(rb_sql_str "$db")" | rb_mysql) || return 1
  for t in $tables; do
    rb_valid_ident "$t" || { rb_error "refusing unexpected table name in $db"; return 1; }
    sql="${sql}SELECT '$t', COUNT(*) FROM \`$db\`.\`$t\`;"
  done
  [ -n "$sql" ] || return 0
  printf '%s\n' "$sql" | rb_mysql
}

# Reads one scalar from a JSON file via MySQL (`$.path`); prints nothing for JSON null / missing.
rb_json_get() { # file path
  local v
  v=$(printf 'SELECT COALESCE(JSON_UNQUOTE(NULLIF(JSON_EXTRACT(CAST(%s AS JSON), %s), CAST(%s AS JSON))), %s);\n' \
    "$(rb_sql_file "$1")" "$(rb_sql_str "$2")" "$(rb_sql_str 'null')" "$(rb_sql_str '')" | rb_mysql) || return 1
  printf '%s\n' "$v"
}

# ---------------------------------------------------------------------------------------------
# backup_runs + alerts (best effort: never mask the original failure)

# Creates a backup_runs row; prints its id (empty if the table does not exist yet).
rb_run_start() { # kind
  local id
  rb_table_exists "$MYSQL_DATABASE" backup_runs || { rb_warn "backup_runs table missing; result will not be recorded"; return 0; }
  id=$(printf "INSERT INTO backup_runs (kind, status, started_at) VALUES (%s, 'running', UTC_TIMESTAMP(3)); SELECT LAST_INSERT_ID();\n" \
    "$(rb_sql_str "$1")" | rb_mysql "$MYSQL_DATABASE") || { rb_warn "could not record the run start"; return 0; }
  printf '%s\n' "$id"
}

# Finishes a backup_runs row. details = path to a JSON file or empty.
rb_run_finish() { # id status size sha details_file error
  local id=$1 status=$2 size=$3 sha=$4 details=$5 err=$6 size_sql=NULL sha_sql=NULL details_sql=NULL err_sql=NULL
  rb_is_uint "$id" || return 0
  rb_is_uint "$size" && size_sql=$size
  printf '%s' "$sha" | grep -Eq '^[0-9a-f]{64}$' && sha_sql="'$sha'"
  [ -n "$details" ] && [ -s "$details" ] && details_sql="CAST($(rb_sql_file "$details") AS JSON)"
  [ -n "$err" ] && err_sql=$(rb_sql_str "$(printf '%s' "$err" | cut -c1-2000)")
  printf 'UPDATE backup_runs SET status = %s, finished_at = UTC_TIMESTAMP(3), size_bytes = %s, sha256 = %s, details_json = %s, error = %s WHERE id = %s;\n' \
    "$(rb_sql_str "$status")" "$size_sql" "$sha_sql" "$details_sql" "$err_sql" "$id" | rb_mysql "$MYSQL_DATABASE" ||
    rb_warn "could not record the run result"
}

# Marks runs left 'running' by a killed container as failed (older than 6 h).
rb_fail_stale_runs() {
  rb_table_exists "$MYSQL_DATABASE" backup_runs || return 0
  printf "UPDATE backup_runs SET status = 'failed', finished_at = UTC_TIMESTAMP(3), error = 'interrupted (container stopped or killed)' WHERE status = 'running' AND started_at < UTC_TIMESTAMP(3) - INTERVAL 6 HOUR;\n" |
    rb_mysql "$MYSQL_DATABASE" || rb_warn "could not clean up stale runs"
}

# Optional Telegram push for critical infrastructure alerts (the app's alert module only runs in
# the worker). Honours settings.alerts.telegram; the token is passed to curl via a config file on
# stdin, never on the command line.
rb_telegram_push() { # title body → prints a JSON send record, returns 1 if not attempted
  local title=$1 body=$2 enabled text payload code at
  [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ] || return 1
  command -v curl >/dev/null 2>&1 || return 1
  enabled=$(printf "SELECT COALESCE(JSON_EXTRACT(value_json, '\$.telegram'), CAST('false' AS JSON)) FROM settings WHERE \`key\` = 'alerts';\n" |
    rb_mysql "$MYSQL_DATABASE" 2>/dev/null || true)
  [ "$enabled" = "true" ] || return 1
  text="RADAR CRITICAL: $title"
  [ -n "$body" ] && text="$text"$'\n\n'"$body"
  [ -n "${APP_URL:-}" ] && text="$text"$'\n\n'"${APP_URL%/}/system"
  payload="$RB_TMP/telegram.json"
  printf '{"chat_id":%s,"text":%s,"disable_web_page_preview":true}' \
    "$(rb_json_str "$TELEGRAM_CHAT_ID")" "$(rb_json_str "$(printf '%s' "$text" | cut -c1-3800)")" >"$payload"
  code=$(printf 'url = "https://api.telegram.org/bot%s/sendMessage"\n' "$TELEGRAM_BOT_TOKEN" |
    curl --config - --silent --show-error --max-time 15 --proto '=https' --output /dev/null --write-out '%{http_code}' \
      --header 'content-type: application/json' --data-binary "@$payload" 2>/dev/null || true)
  at=$(rb_now_iso)
  if [ "$code" = "200" ]; then
    printf '{"channel":"telegram","at":"%s","ok":true,"severity":"critical"}' "$at"
  else
    printf '{"channel":"telegram","at":"%s","ok":false,"severity":"critical","error":"telegram: HTTP %s"}' "$at" "${code:-000}"
  fi
}

# Upserts an unacknowledged alert with the same dedupe key (bump occurrences) or inserts one.
# Prints "created <id>" / "bumped <id>".
rb_raise_alert() { # kind severity title body dedupe_key [entity_type entity_id]
  local kind=$1 severity=$2 title=$3 body=$4 key=$5 etype=${6:-} eid=${7:-} out id state rec sent
  case "$severity" in info | warn | critical) ;; *) severity=critical ;; esac
  rb_table_exists "$MYSQL_DATABASE" alerts || { rb_warn "alerts table missing; alert not stored: $title"; return 1; }
  out=$(
    {
      printf 'SET @k = %s;\n' "$(rb_sql_str "$key")"
      printf "UPDATE alerts SET occurrences = occurrences + 1, last_raised_at = UTC_TIMESTAMP(3), severity = %s, title = %s, body = %s WHERE dedupe_key = @k AND acknowledged_at IS NULL ORDER BY id DESC LIMIT 1;\n" \
        "$(rb_sql_str "$severity")" "$(rb_sql_str "$title")" "$(rb_sql_str "$body")"
      printf 'SET @bumped = ROW_COUNT();\n'
      printf 'INSERT INTO alerts (kind, severity, title, body, entity_type, entity_id, dedupe_key, created_at, last_raised_at) SELECT %s, %s, %s, %s, %s, %s, @k, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3) FROM DUAL WHERE @bumped = 0;\n' \
        "$(rb_sql_str "$kind")" "$(rb_sql_str "$severity")" "$(rb_sql_str "$title")" "$(rb_sql_str "$body")" \
        "$([ -n "$etype" ] && rb_sql_str "$etype" || printf NULL)" "$([ -n "$eid" ] && rb_sql_str "$eid" || printf NULL)"
      printf "SELECT IF(@bumped = 0, 'created', 'bumped'), (SELECT id FROM alerts WHERE dedupe_key = @k AND acknowledged_at IS NULL ORDER BY id DESC LIMIT 1);\n"
    } | rb_mysql "$MYSQL_DATABASE"
  ) || { rb_warn "could not store alert: $title"; return 1; }
  state=$(printf '%s' "$out" | cut -f1)
  id=$(printf '%s' "$out" | cut -f2)
  if [ "$state" = "created" ] && [ "$severity" = "critical" ] && rb_is_uint "$id"; then
    if rec=$(rb_telegram_push "$title" "$body"); then
      case "$rec" in *'"ok":true'*) sent="{\"inApp\":true,\"lastNotifiedAt\":\"$(rb_now_iso)\",\"lastNotifiedSeverity\":\"critical\",\"sends\":[$rec]}" ;;
      *) sent="{\"inApp\":true,\"lastNotifiedAt\":null,\"lastNotifiedSeverity\":null,\"sends\":[$rec]}" ;;
      esac
      printf 'UPDATE alerts SET sent_channels_json = CAST(%s AS JSON) WHERE id = %s;\n' "$(rb_sql_str "$sent")" "$id" |
        rb_mysql "$MYSQL_DATABASE" || true
    fi
  fi
  printf '%s %s\n' "$state" "$id"
}

# ---------------------------------------------------------------------------------------------
# git / GitHub

rb_https_url() { # git@github.com:Owner/Repo.git → https://github.com/Owner/Repo.git
  case "$1" in
    git@*:*) local rest=${1#git@}; printf 'https://%s/%s\n' "${rest%%:*}" "${rest#*:}" ;;
    ssh://git@*) local rest=${1#ssh://git@}; printf 'https://%s\n' "$rest" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

rb_is_ssh_url() { case "$1" in git@* | ssh://*) return 0 ;; *) return 1 ;; esac; }

# Configures git for non-interactive use; for ssh remotes pins the deploy key + known_hosts.
# Pass "optional" to fall back to anonymous https when no key is present (read-only use).
rb_git_setup() {
  export GIT_TERMINAL_PROMPT=0 GIT_CONFIG_NOSYSTEM=1 GIT_CONFIG_GLOBAL=/dev/null GIT_ASKPASS=/bin/false
  RB_GIT_URL=$BACKUP_REPO
  unset GIT_SSH_COMMAND
  if rb_is_ssh_url "$BACKUP_REPO"; then
    if [ ! -r "$BACKUP_DEPLOY_KEY" ] || [ ! -s "$BACKUP_DEPLOY_KEY" ]; then
      if [ "${1:-}" = "optional" ]; then
        RB_GIT_URL=$(rb_https_url "$BACKUP_REPO")
        rb_warn "no deploy key at $BACKUP_DEPLOY_KEY; reading anonymously from $RB_GIT_URL"
        return 0
      fi
      rb_die "deploy key not found or empty: $BACKUP_DEPLOY_KEY (see docs/RECOVERY.md, 'deploy key lost')"
    fi
    [ -r "$BACKUP_KNOWN_HOSTS" ] || rb_die "pinned known_hosts file missing: $BACKUP_KNOWN_HOSTS"
    rb_need ssh
    (umask 077 && cp "$BACKUP_DEPLOY_KEY" "$RB_TMP/deploy_key") || rb_die "cannot copy the deploy key"
    chmod 600 "$RB_TMP/deploy_key"
    GIT_SSH_COMMAND="ssh -F /dev/null -i $RB_TMP/deploy_key -o IdentitiesOnly=yes -o IdentityAgent=none -o UserKnownHostsFile=$BACKUP_KNOWN_HOSTS -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o UpdateHostKeys=no -o BatchMode=yes -o ConnectTimeout=20 -o ServerAliveInterval=15 -o ServerAliveCountMax=4"
    export GIT_SSH_COMMAND
  fi
}

# 0 = branch exists, 1 = branch absent, 2 = remote unreachable / auth failure.
rb_remote_branch_state() {
  local out
  out=$(git ls-remote --heads "$RB_GIT_URL" "refs/heads/$BACKUP_BRANCH" 2>"$RB_TMP/ls-remote.err") || return 2
  [ -n "$out" ] && return 0
  return 1
}

# Shallow single-branch clone of the backup branch into $1. Big blobs are fetched lazily when
# the remote supports partial clone ("meta" mode = only LATEST.json + LATEST.meta.enc are needed).
rb_clone_backup() { # dir [meta]
  local dir=$1 filter=''
  [ "${2:-}" = "meta" ] && filter='--filter=blob:limit=1m'
  rm -rf "$dir"
  # shellcheck disable=SC2086
  git clone --quiet --depth 1 --single-branch --branch "$BACKUP_BRANCH" $filter ${2:+--no-checkout} \
    "$RB_GIT_URL" "$dir" 2>"$RB_TMP/clone.err"
}

# Read-only fetch (restore, restore test): when the SSH clone fails — e.g. a brand-new VPS whose
# deploy key is not on GitHub yet — fall back to anonymous https (the repository is public).
rb_fetch_backup() { # dir
  rb_clone_backup "$1" && return 0
  if rb_is_ssh_url "$RB_GIT_URL"; then
    rb_warn "ssh fetch failed ($(tail -n 1 "$RB_TMP/clone.err" 2>/dev/null)); retrying anonymously over https"
    RB_GIT_URL=$(rb_https_url "$BACKUP_REPO")
    unset GIT_SSH_COMMAND
    rb_clone_backup "$1" && return 0
  fi
  return 1
}

# ---------------------------------------------------------------------------------------------
# backup artefacts

# Encrypts $1 to $2 exactly like the dump (same cipher, KDF and passphrase).
rb_encrypt_file() { # in out
  openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt -pass env:BACKUP_PASSPHRASE -in "$1" -out "$2"
}

# Writes the private metadata of the backup in $1 (row counts, tables, migrations, run id, …) as
# JSON to $2. Format 2 decrypts $RB_META_FILE and checks it belongs to this LATEST.json (same dump
# sha256); format 1 (legacy) kept it all in LATEST.json itself. Returns 1 and sets RB_META_ERROR
# when the metadata is missing, cannot be decrypted (wrong BACKUP_PASSPHRASE) or is not valid.
rb_backup_meta() { # dir out
  local dir=$1 out=$2 format sha msha
  RB_META_ERROR=
  rm -f "$out"
  [ -s "$dir/LATEST.json" ] || { RB_META_ERROR='LATEST.json missing'; return 1; }
  format=$(rb_json_get "$dir/LATEST.json" '$.format' 2>/dev/null) || { RB_META_ERROR='LATEST.json is not valid JSON'; return 1; }
  case "$format" in
    "$RB_FORMAT_LEGACY")
      cp "$dir/LATEST.json" "$out" || { RB_META_ERROR='cannot copy LATEST.json'; return 1; }
      return 0
      ;;
    "$RB_FORMAT") ;;
    *) RB_META_ERROR="unsupported backup format: ${format:-none}"; return 1 ;;
  esac
  [ -s "$dir/$RB_META_FILE" ] || { RB_META_ERROR="$RB_META_FILE missing"; return 1; }
  if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE \
    -in "$dir/$RB_META_FILE" -out "$out" 2>/dev/null; then
    rm -f "$out"
    RB_META_ERROR="cannot decrypt $RB_META_FILE (wrong BACKUP_PASSPHRASE or corrupted file)"
    return 1
  fi
  sha=$(rb_json_get "$dir/LATEST.json" '$.sha256' 2>/dev/null || true)
  msha=$(rb_json_get "$out" '$.sha256' 2>/dev/null) || { rm -f "$out"; RB_META_ERROR="$RB_META_FILE is not valid JSON"; return 1; }
  if [ -z "$sha" ] || [ "$msha" != "$sha" ]; then
    rm -f "$out"
    RB_META_ERROR="$RB_META_FILE belongs to a different backup (sha256 mismatch)"
    return 1
  fi
}

# Validates LATEST.json + the files it lists in $1 and assembles the encrypted stream into $2.
rb_assemble_backup() { # dir out
  local dir=$1 out=$2 meta="$1/LATEST.json" format sha parts line name size psha actual
  [ -s "$meta" ] || rb_die "LATEST.json missing in the backup"
  format=$(rb_json_get "$meta" '$.format') || rb_die "LATEST.json is not valid JSON"
  [ "$format" = "$RB_FORMAT" ] || [ "$format" = "$RB_FORMAT_LEGACY" ] || rb_die "unsupported backup format: ${format:-none}"
  sha=$(rb_json_get "$meta" '$.sha256')
  parts=$(printf "SELECT p.name, p.size, p.sha FROM JSON_TABLE(CAST(%s AS JSON), '\$.parts[*]' COLUMNS (name VARCHAR(255) PATH '\$.name', size BIGINT UNSIGNED PATH '\$.sizeBytes', sha CHAR(64) PATH '\$.sha256', ord FOR ORDINALITY)) p ORDER BY p.ord;\n" \
    "$(rb_sql_file "$meta")" | rb_mysql) || rb_die "cannot read the parts list"
  [ -n "$parts" ] || rb_die "LATEST.json lists no files"
  : >"$out"
  while IFS="$(printf '\t')" read -r name size psha; do
    [ -n "$name" ] || continue
    printf '%s' "$name" | grep -Eq "$RB_FILE_RE" || rb_die "unexpected file name in LATEST.json: $name"
    [ -f "$dir/$name" ] || rb_die "backup file missing: $name"
    actual=$(rb_size "$dir/$name")
    [ "$actual" = "$size" ] || rb_die "size mismatch for $name (expected $size, got $actual)"
    [ "$(rb_sha256 "$dir/$name")" = "$psha" ] || rb_die "sha256 mismatch for $name"
    cat "$dir/$name" >>"$out"
  done <<EOF
$parts
EOF
  [ "$(rb_sha256 "$out")" = "$sha" ] || rb_die "sha256 of the assembled backup does not match LATEST.json"
}

# Decrypts + decompresses $1 to /dev/null and checks the mysqldump completion marker.
rb_verify_encrypted_dump() { # file
  local tailf="$RB_TMP/dump.tail"
  set -o pipefail
  if ! openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE -in "$1" 2>"$RB_TMP/dec.err" |
    gzip -dc 2>"$RB_TMP/gz.err" | tail -c 400 >"$tailf"; then
    rb_die "decryption/decompression failed: wrong BACKUP_PASSPHRASE or corrupted file ($(cat "$RB_TMP/dec.err" "$RB_TMP/gz.err" 2>/dev/null | head -n 1))"
  fi
  grep -q -- '-- Dump completed' "$tailf" || rb_die "the dump is truncated (no '-- Dump completed' marker)"
}

# Decrypts $1 and imports it into database $2 (which must exist and be empty).
rb_import_dump() { # file db
  set -o pipefail
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE -in "$1" 2>"$RB_TMP/dec.err" |
    gzip -dc |
    mysql --defaults-extra-file="$RB_MYCNF" --max-allowed-packet=1073741824 --database="$2" 2>"$RB_TMP/import.err" ||
    rb_die "import into $2 failed: $(grep -v -i 'password' "$RB_TMP/import.err" | tail -n 2 | tr '\n' ' ')"
}

# Compares the row counts of database $1 with the backup metadata ($2, see rb_backup_meta).
# Volatile tables (rows changed
# while the dump ran) may fall anywhere in their recorded [min,max]. Writes mismatches to $3.
# Returns 0 when everything matches.
rb_compare_counts() { # db meta mismatches_file
  local db=$1 meta=$2 out=$3 expected actual_file="$RB_TMP/actual.counts" name exp lo hi act bad=0 tab
  tab=$(printf '\t')
  expected=$(printf "SELECT k.name, CAST(JSON_EXTRACT(d.doc, CONCAT('\$.rowCounts.', JSON_QUOTE(k.name))) AS UNSIGNED), COALESCE(CAST(JSON_EXTRACT(d.doc, CONCAT('\$.volatileTables.', JSON_QUOTE(k.name), '[0]')) AS SIGNED), -1), COALESCE(CAST(JSON_EXTRACT(d.doc, CONCAT('\$.volatileTables.', JSON_QUOTE(k.name), '[1]')) AS SIGNED), -1) FROM (SELECT CAST(%s AS JSON) AS doc) d, JSON_TABLE(JSON_KEYS(d.doc, '\$.rowCounts'), '\$[*]' COLUMNS (name VARCHAR(64) PATH '\$')) k ORDER BY k.name;\n" \
    "$(rb_sql_file "$meta")" | rb_mysql) || rb_die "cannot read rowCounts from the backup metadata"
  rb_row_counts "$db" >"$actual_file" || rb_die "cannot count rows in $db"
  : >"$out"
  RB_TABLES_COMPARED=0
  while IFS="$(printf '\t')" read -r name exp lo hi; do
    [ -n "$name" ] || continue
    RB_TABLES_COMPARED=$((RB_TABLES_COMPARED + 1))
    if ! rb_valid_ident "$name"; then
      printf 'unexpected table name in the backup metadata\n' >>"$out"
      bad=1
      continue
    fi
    act=$(grep -E "^${name}${tab}" "$actual_file" | cut -f2 || true)
    if [ -z "$act" ]; then
      printf '%s: table missing after restore\n' "$name" >>"$out"
      bad=1
    elif [ "$lo" -ge 0 ] && [ "$hi" -ge 0 ]; then
      if [ "$act" -lt "$lo" ] || [ "$act" -gt "$hi" ]; then
        printf '%s: %s rows, expected %s-%s\n' "$name" "$act" "$lo" "$hi" >>"$out"
        bad=1
      fi
    elif [ "$act" != "$exp" ]; then
      printf '%s: %s rows, expected %s\n' "$name" "$act" "$exp" >>"$out"
      bad=1
    fi
  done <<EOF
$expected
EOF
  [ "$RB_TABLES_COMPARED" -gt 0 ] || { printf 'the backup metadata has no rowCounts\n' >>"$out"; bad=1; }
  return $bad
}
