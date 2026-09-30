#!/usr/bin/env bash
# Auto-deploy, run every 5 minutes by radar-autodeploy.timer (ops/systemd/). Output goes to the
# journal: journalctl -u radar-autodeploy
#
#   ops/autodeploy.sh [--dir /opt/radar] [--branch main]
#
# 1. flock on /var/lib/radar/deploy.lock, non-blocking (a running install/deploy wins; skip).
# 2. git fetch origin <branch>.
# 3. Nothing to do when origin/<branch> is the deployed revision.
# 4. Otherwise: git reset --hard origin/<branch> → docker compose up -d --build →
#    wait for /api/health to report the new commit → prune RADAR's dangling images.
#    If the new revision does not become healthy the previous one is redeployed and a critical
#    `deploy_failed` alert is stored. A failing commit is retried at most MAX_ATTEMPTS (3) times;
#    the next push (or a manual ops/deploy.sh) starts over.
#
# Untracked files (.env, secrets/) are never touched by the reset.
# Exit 0 = up to date / deployed / skipped, 1 = deploy failed (rolled back), 3 = rollback failed.
set -Eeuo pipefail
umask 022

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
RADAR_LOG_PREFIX=autodeploy
# shellcheck source=ops/lib/common.sh
. "$(dirname "$SELF")/lib/common.sh"

RADAR_DIR="$(cd "$(dirname "$SELF")/.." && pwd -P)"
BRANCH=main
MAX_ATTEMPTS=${RADAR_AUTODEPLOY_MAX_ATTEMPTS:-3}
FETCH_TIMEOUT_SEC=120

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dir) [ "$#" -ge 2 ] || { radar_usage "$SELF" >&2; exit 2; }; RADAR_DIR=$2; shift ;;
    --branch) [ "$#" -ge 2 ] || { radar_usage "$SELF" >&2; exit 2; }; BRANCH=$2; shift ;;
    -h | --help) radar_usage "$SELF"; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; radar_usage "$SELF" >&2; exit 2 ;;
  esac
  shift
done
printf '%s' "$BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$' || radar_die "invalid --branch"
case "$MAX_ATTEMPTS" in '' | *[!0-9]*) MAX_ATTEMPTS=3 ;; esac

[ -d "$RADAR_DIR/.git" ] || radar_die "$RADAR_DIR is not a git checkout"
if [ ! -f "$RADAR_DIR/.env" ]; then
  radar_warn "$RADAR_DIR/.env is missing; not deploying (docs/RECOVERY.md)"
  exit 0
fi
radar_need git docker curl flock

mkdir -p "$RADAR_STATE_DIR"
chmod 700 "$RADAR_STATE_DIR"
exec 9>"$RADAR_STATE_DIR/deploy.lock"
if ! flock -n 9; then
  radar_info "another install/deploy holds the lock; skipping this run"
  exit 0
fi

fetch() {
  if command -v timeout >/dev/null 2>&1; then
    timeout "$FETCH_TIMEOUT_SEC" git -c safe.directory="$RADAR_DIR" -C "$RADAR_DIR" "$@"
  else
    radar_git "$@"
  fi
}
if ! GIT_TERMINAL_PROMPT=0 fetch fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"; then
  radar_warn "git fetch failed (network or GitHub); will retry at the next run"
  exit 0
fi

target=$(radar_git rev-parse "origin/$BRANCH")
deployed=$(radar_deployed_sha)
head=$(radar_git rev-parse HEAD)
[ -n "$deployed" ] || deployed=$head

if [ "$target" = "$deployed" ] && [ "$target" = "$head" ]; then
  exit 0 # up to date: stay quiet, the journal only records changes
fi

attempts=$(radar_failed_attempts "$target")
if [ "$attempts" -ge "$MAX_ATTEMPTS" ]; then
  # Already alerted; log once an hour at most so the journal shows why nothing happens.
  if [ "$(date -u +%M)" -lt 5 ]; then
    radar_info "origin/$BRANCH ${target:0:12} failed $attempts times; not retrying (push a fix or run ops/deploy.sh)"
  fi
  exit 0
fi

radar_info "origin/$BRANCH moved: ${deployed:0:12} → ${target:0:12} (attempt $((attempts + 1))/$MAX_ATTEMPTS)"
cd "$RADAR_DIR"
rc=0
radar_deploy_rev "$target" "$deployed" || rc=$?
exit "$rc"
