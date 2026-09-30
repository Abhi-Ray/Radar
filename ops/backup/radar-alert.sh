#!/usr/bin/env bash
# Stores an alert in the RADAR `alerts` table (the in-app bell + /system page), deduplicated on
# an unacknowledged row with the same key. Used by host-side ops scripts that have no Node
# runtime of their own, e.g. ops/autodeploy.sh:
#
#   docker compose exec -T backup radar-alert --kind deploy_failed --severity critical \
#     --title "Auto-deploy failed" --body "…" --dedupe-key "deploy_failed:<sha>"
#
#   --kind K          alert kind (letters, digits, _ . -)
#   --severity S      info | warn | critical (default warn)
#   --title T         short title (required)
#   --body B          details (optional)
#   --dedupe-key D    default: <kind>:<UTC date>
#   --entity-type E / --entity-id I   optional link to an entity
#
# Critical alerts are also pushed to Telegram when TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID are set
# and settings.alerts.telegram is on. Prints "created <id>" or "bumped <id>". Exit 1 on failure.
set -Eeuo pipefail
umask 077

RADAR_SCRIPT=radar-alert
RB_HOME="${RADAR_BACKUP_HOME:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)}"
# shellcheck source=ops/backup/lib.sh
. "$RB_HOME/lib.sh"

KIND=
SEVERITY=warn
TITLE=
BODY=
KEY=
ETYPE=
EID=
usage() { rb_usage "$0"; }
need_value() { [ "$1" -ge 2 ] || { usage >&2; exit 2; }; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --kind) need_value "$#"; KIND=$2; shift ;;
    --severity) need_value "$#"; SEVERITY=$2; shift ;;
    --title) need_value "$#"; TITLE=$2; shift ;;
    --body) need_value "$#"; BODY=$2; shift ;;
    --dedupe-key) need_value "$#"; KEY=$2; shift ;;
    --entity-type) need_value "$#"; ETYPE=$2; shift ;;
    --entity-id) need_value "$#"; EID=$2; shift ;;
    -h | --help) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf '%s' "$KIND" | grep -Eq '^[A-Za-z0-9_.-]{1,64}$' || { printf -- '--kind is required ([A-Za-z0-9_.-], max 64)\n' >&2; exit 2; }
case "$SEVERITY" in info | warn | critical) ;; *) printf -- '--severity must be info, warn or critical\n' >&2; exit 2 ;; esac
[ -n "$TITLE" ] || { printf -- '--title is required\n' >&2; exit 2; }
TITLE=$(printf '%s' "$TITLE" | cut -c1-200)
BODY=$(printf '%s' "$BODY" | cut -c1-4000)
KEY=${KEY:-"$KIND:$(date -u +%Y-%m-%d)"}
KEY=$(printf '%s' "$KEY" | cut -c1-190)

trap 'rb_cleanup_tmp' EXIT
rb_need mysql od tr cut grep sed
rb_load_config
rb_make_tmp
rb_write_mycnf
rb_wait_for_db 60
rb_raise_alert "$KIND" "$SEVERITY" "$TITLE" "$BODY" "$KEY" "$ETYPE" "$EID" || rb_die "alert not stored"
