#!/usr/bin/env bash
# Main process of the `backup` container (compose `init: true` puts docker-init in front of it).
#
#   radar-backup-scheduler                       loop forever (container CMD)
#   radar-backup-scheduler run-now backup [--allow-shrink]
#   radar-backup-scheduler run-now restore-test
#   radar-backup-scheduler status                last results + next slots
#   radar-backup-scheduler next-slots [EPOCH]    next backup / restore-test times (tests)
#
# Schedule (UTC; the VPS and containers run in UTC):
#   backup        daily at BACKUP_HOUR_UTC:BACKUP_MINUTE_UTC            (default 21:00 = 02:30 IST)
#   restore test  day RESTORE_TEST_DAY at RESTORE_TEST_HOUR_UTC:…MINUTE (default day 1, 22:00)
# A failed job is retried once, an hour later. On start-up a missed or interrupted backup (last
# success > 25 h ago, or the last attempt failed) runs after BACKUP_STARTUP_DELAY_SEC; a restore test
# older than 35 days likewise. A fresh volume (no previous success recorded) never catches up —
# it waits for the regular slot, so a brand-new, empty install cannot overwrite the off-site
# backup before the owner had a chance to restore it (backup.sh has a shrink guard as well).
# The loop never exits on job errors; jobs record their own results and alerts.
set -uo pipefail

RADAR_SCRIPT=scheduler
RB_HOME="${RADAR_BACKUP_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}"
# shellcheck source=ops/backup/lib.sh
. "$RB_HOME/lib.sh"

BACKUP_HOUR_UTC="${BACKUP_HOUR_UTC:-21}"
BACKUP_MINUTE_UTC="${BACKUP_MINUTE_UTC:-0}"
RESTORE_TEST_DAY="${RESTORE_TEST_DAY:-1}"
RESTORE_TEST_HOUR_UTC="${RESTORE_TEST_HOUR_UTC:-22}"
RESTORE_TEST_MINUTE_UTC="${RESTORE_TEST_MINUTE_UTC:-0}"
STARTUP_DELAY_SEC="${BACKUP_STARTUP_DELAY_SEC:-600}"
RETRY_DELAY_SEC="${BACKUP_RETRY_DELAY_SEC:-3600}"
CATCHUP_BACKUP_SEC=$((25 * 3600))
CATCHUP_RESTORE_SEC=$((35 * 86400))

sched_validate() {
  local v
  for v in BACKUP_HOUR_UTC BACKUP_MINUTE_UTC RESTORE_TEST_DAY RESTORE_TEST_HOUR_UTC RESTORE_TEST_MINUTE_UTC STARTUP_DELAY_SEC RETRY_DELAY_SEC; do
    rb_is_uint "${!v}" || rb_die "$v must be a non-negative integer"
  done
  # Base 10 even with a leading zero ("09").
  BACKUP_HOUR_UTC=$((10#$BACKUP_HOUR_UTC)) BACKUP_MINUTE_UTC=$((10#$BACKUP_MINUTE_UTC))
  RESTORE_TEST_DAY=$((10#$RESTORE_TEST_DAY)) RESTORE_TEST_HOUR_UTC=$((10#$RESTORE_TEST_HOUR_UTC))
  RESTORE_TEST_MINUTE_UTC=$((10#$RESTORE_TEST_MINUTE_UTC))
  [ "$BACKUP_HOUR_UTC" -le 23 ] && [ "$RESTORE_TEST_HOUR_UTC" -le 23 ] || rb_die "hours must be 0-23"
  [ "$BACKUP_MINUTE_UTC" -le 59 ] && [ "$RESTORE_TEST_MINUTE_UTC" -le 59 ] || rb_die "minutes must be 0-59"
  [ "$RESTORE_TEST_DAY" -ge 1 ] && [ "$RESTORE_TEST_DAY" -le 28 ] || rb_die "RESTORE_TEST_DAY must be 1-28"
}

# First daily slot strictly after $1.
next_daily() { # now hour minute
  local t=$(($1 / 86400 * 86400 + $2 * 3600 + $3 * 60))
  [ "$t" -le "$1" ] && t=$((t + 86400))
  printf '%s\n' "$t"
}

# First monthly slot (day $2 of a month) strictly after $1.
next_monthly() { # now day hour minute
  local ymd y m t
  ymd=$(rb_civil_from_days $(($1 / 86400)))
  set -- "$1" "$2" "$3" "$4" $ymd
  y=$5 m=$6
  t=$(($(rb_days_from_civil "$y" "$m" "$2") * 86400 + $3 * 3600 + $4 * 60))
  if [ "$t" -le "$1" ]; then
    m=$((m + 1))
    if [ "$m" -gt 12 ]; then m=1 y=$((y + 1)); fi
    t=$(($(rb_days_from_civil "$y" "$m" "$2") * 86400 + $3 * 3600 + $4 * 60))
  fi
  printf '%s\n' "$t"
}

print_slots() { # now
  local b r
  b=$(next_daily "$1" "$BACKUP_HOUR_UTC" "$BACKUP_MINUTE_UTC")
  r=$(next_monthly "$1" "$RESTORE_TEST_DAY" "$RESTORE_TEST_HOUR_UTC" "$RESTORE_TEST_MINUTE_UTC")
  printf 'backup %s %s\n' "$b" "$(rb_iso_from_epoch "$b")"
  printf 'restore-test %s %s\n' "$r" "$(rb_iso_from_epoch "$r")"
}

fmt_state() { # epoch → ISO or "never"
  if [ "$1" -gt 0 ]; then rb_iso_from_epoch "$1"; else printf 'never\n'; fi
}

JOB_PID=
STOPPING=0
on_term() {
  STOPPING=1
  if [ -n "$JOB_PID" ]; then kill -TERM "$JOB_PID" 2>/dev/null || true; fi
  if [ -n "${SLEEP_PID:-}" ]; then kill "$SLEEP_PID" 2>/dev/null || true; fi
}

run_job() { # backup|restore-test → exit code
  local script code
  case "$1" in
    backup) script="$RB_HOME/backup.sh" ;;
    restore-test) script="$RB_HOME/restore-test.sh" ;;
    *) return 2 ;;
  esac
  rb_info "starting $1"
  "$script" &
  JOB_PID=$!
  wait "$JOB_PID"
  code=$?
  # `wait` returns early when a trapped signal arrives: wait for the job to finish its cleanup.
  while kill -0 "$JOB_PID" 2>/dev/null; do
    wait "$JOB_PID"
    code=$?
  done
  JOB_PID=
  if [ "$code" = 0 ]; then rb_info "$1 finished ok"; else rb_warn "$1 finished with exit code $code"; fi
  return "$code"
}

sleep_until() { # epoch — in chunks of <= 1 h so clock jumps are noticed; interruptible
  local now left chunk
  while [ "$STOPPING" = 0 ]; do
    now=$(date -u +%s)
    left=$(($1 - now))
    [ "$left" -gt 0 ] || return 0
    chunk=$left
    [ "$chunk" -gt 3600 ] && chunk=3600
    sleep "$chunk" &
    SLEEP_PID=$!
    wait "$SLEEP_PID" 2>/dev/null
    SLEEP_PID=
  done
}

loop() {
  local now next_b next_r b_retried=0 r_retried=0 last_ok last_attempt rt_ok due
  trap on_term TERM INT
  # No job can be running when the container starts: clear the lock and temp dirs (decrypted
  # material never lands there, but partial encrypted dumps can) left by a killed container.
  rm -rf "$BACKUP_WORK_DIR/locks/db-job.lock"
  rm -rf "${TMPDIR:-/tmp}"/radar-backup.* 2>/dev/null || true
  now=$(date -u +%s)
  next_b=$(next_daily "$now" "$BACKUP_HOUR_UTC" "$BACKUP_MINUTE_UTC")
  next_r=$(next_monthly "$now" "$RESTORE_TEST_DAY" "$RESTORE_TEST_HOUR_UTC" "$RESTORE_TEST_MINUTE_UTC")

  last_ok=$(rb_state_get last-backup-ok)
  last_attempt=$(rb_state_get last-backup-attempt)
  if [ "$last_ok" -gt 0 ]; then
    if [ $((now - last_ok)) -gt "$CATCHUP_BACKUP_SEC" ] || [ "$last_attempt" -gt "$last_ok" ]; then
      local c=$((now + STARTUP_DELAY_SEC))
      if [ "$c" -lt "$next_b" ]; then
        next_b=$c
        rb_info "last backup succeeded $(fmt_state "$last_ok"); catch-up backup at $(rb_iso_from_epoch "$next_b")"
      fi
    fi
  else
    rb_info "no successful backup recorded in this volume yet; first backup at the regular slot"
  fi
  rt_ok=$(rb_state_get last-restore-test-ok)
  if [ "$rt_ok" -gt 0 ] && [ $((now - rt_ok)) -gt "$CATCHUP_RESTORE_SEC" ]; then
    local c=$((now + STARTUP_DELAY_SEC + 1800))
    if [ "$c" -lt "$next_r" ]; then
      next_r=$c
      rb_info "last restore test succeeded $(fmt_state "$rt_ok"); catch-up restore test at $(rb_iso_from_epoch "$next_r")"
    fi
  fi

  while [ "$STOPPING" = 0 ]; do
    rb_info "next backup $(rb_iso_from_epoch "$next_b"), next restore test $(rb_iso_from_epoch "$next_r")"
    due=$next_b
    [ "$next_r" -lt "$due" ] && due=$next_r
    sleep_until "$due"
    [ "$STOPPING" = 0 ] || break
    now=$(date -u +%s)
    [ "$now" -ge "$due" ] || continue

    if [ "$now" -ge "$next_b" ]; then
      if run_job backup; then
        b_retried=0
        next_b=$(next_daily "$(date -u +%s)" "$BACKUP_HOUR_UTC" "$BACKUP_MINUTE_UTC")
      elif [ "$b_retried" = 0 ] && [ "$STOPPING" = 0 ]; then
        b_retried=1
        next_b=$(($(date -u +%s) + RETRY_DELAY_SEC))
        rb_warn "backup will be retried at $(rb_iso_from_epoch "$next_b")"
      else
        b_retried=0
        next_b=$(next_daily "$(date -u +%s)" "$BACKUP_HOUR_UTC" "$BACKUP_MINUTE_UTC")
      fi
    fi
    [ "$STOPPING" = 0 ] || break
    now=$(date -u +%s)
    if [ "$now" -ge "$next_r" ]; then
      if run_job restore-test; then
        r_retried=0
        next_r=$(next_monthly "$(date -u +%s)" "$RESTORE_TEST_DAY" "$RESTORE_TEST_HOUR_UTC" "$RESTORE_TEST_MINUTE_UTC")
      elif [ "$r_retried" = 0 ] && [ "$STOPPING" = 0 ]; then
        r_retried=1
        next_r=$(($(date -u +%s) + RETRY_DELAY_SEC))
        rb_warn "restore test will be retried at $(rb_iso_from_epoch "$next_r")"
      else
        r_retried=0
        next_r=$(next_monthly "$(date -u +%s)" "$RESTORE_TEST_DAY" "$RESTORE_TEST_HOUR_UTC" "$RESTORE_TEST_MINUTE_UTC")
      fi
    fi
  done
  rb_info "stopping"
}

sched_validate
case "${1:-loop}" in
  loop)
    rb_load_config
    loop
    ;;
  run-now)
    shift
    case "${1:-}" in
      backup)
        shift
        exec "$RB_HOME/backup.sh" "$@"
        ;;
      restore-test)
        shift
        exec "$RB_HOME/restore-test.sh" "$@"
        ;;
      *)
        printf 'usage: %s run-now backup|restore-test\n' "$0" >&2
        exit 2
        ;;
    esac
    ;;
  next-slots)
    now=${2:-$(date -u +%s)}
    rb_is_uint "$now" || { printf 'EPOCH must be a number\n' >&2; exit 2; }
    print_slots "$now"
    ;;
  status)
    rb_load_config
    printf 'last backup ok:          %s\n' "$(fmt_state "$(rb_state_get last-backup-ok)")"
    printf 'last backup attempt:     %s\n' "$(fmt_state "$(rb_state_get last-backup-attempt)")"
    printf 'last restore test ok:    %s\n' "$(fmt_state "$(rb_state_get last-restore-test-ok)")"
    printf 'last restore test try:   %s\n' "$(fmt_state "$(rb_state_get last-restore-test-attempt)")"
    print_slots "$(date -u +%s)" | sed 's/^/next /'
    ;;
  -h | --help | help)
    rb_usage "$0"
    ;;
  *)
    printf 'unknown command: %s (try --help)\n' "$1" >&2
    exit 2
    ;;
esac
