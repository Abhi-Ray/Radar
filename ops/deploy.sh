#!/usr/bin/env bash
# Manual deploy on the VPS: bring /opt/radar to origin/main (or --ref), rebuild, restart, wait for
# /api/health to report the new commit; roll back to the previous revision if it does not.
#
#   sudo ops/deploy.sh [--ref REF] [--branch main] [--no-pull] [--force] [--dir /opt/radar]
#
#   --ref REF     deploy this commit/tag/branch instead of origin/<branch> (e.g. to pin an older
#                 revision; auto-deploy moves forward again at the next push to main — stop the
#                 timer first if you want the pin to stick: systemctl stop radar-autodeploy.timer)
#   --branch B    branch to follow (default main)
#   --no-pull     deploy the commit that is checked out now (after editing .env, for example)
#   --force       discard local changes to tracked files in the checkout
#   --dir DIR     checkout (default /opt/radar)
#
# Always redeploys, even when the commit did not change (picks up .env edits). Shares
# /var/lib/radar/deploy.lock with ops/install.sh and ops/autodeploy.sh, so they never overlap.
# Exit 0 = live, 1 = failed (previous revision restored), 3 = failed and rollback failed.
set -Eeuo pipefail
umask 022

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
RADAR_LOG_PREFIX=deploy
# shellcheck source=ops/lib/common.sh
. "$(dirname "$SELF")/lib/common.sh"

RADAR_DIR="$(cd "$(dirname "$SELF")/.." && pwd -P)"
BRANCH=main
REF=
NO_PULL=0
FORCE=0

while [ "$#" -gt 0 ]; do
  case "$1" in
    --ref) [ "$#" -ge 2 ] || { radar_usage "$SELF" >&2; exit 2; }; REF=$2; shift ;;
    --branch) [ "$#" -ge 2 ] || { radar_usage "$SELF" >&2; exit 2; }; BRANCH=$2; shift ;;
    --dir) [ "$#" -ge 2 ] || { radar_usage "$SELF" >&2; exit 2; }; RADAR_DIR=$2; shift ;;
    --no-pull) NO_PULL=1 ;;
    --force) FORCE=1 ;;
    -h | --help) radar_usage "$SELF"; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; radar_usage "$SELF" >&2; exit 2 ;;
  esac
  shift
done

printf '%s' "$BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$' || radar_die "invalid --branch"
[ "$(id -u)" = 0 ] || radar_die "run as root: sudo $SELF"
[ -d "$RADAR_DIR/.git" ] || radar_die "$RADAR_DIR is not a git checkout (run ops/install.sh first)"
[ -f "$RADAR_DIR/.env" ] || radar_die "$RADAR_DIR/.env is missing (docs/RECOVERY.md)"
radar_need git docker curl flock

mkdir -p "$RADAR_STATE_DIR"
chmod 700 "$RADAR_STATE_DIR"
exec 9>"$RADAR_STATE_DIR/deploy.lock"
radar_info "waiting for the deploy lock (install/auto-deploy may be running)…"
flock -w 1800 9 || radar_die "could not get $RADAR_STATE_DIR/deploy.lock within 30 min"

prev=$(radar_deployed_sha)
[ -n "$prev" ] || prev=$(radar_git rev-parse HEAD)

if [ "$NO_PULL" = 1 ]; then
  target=$(radar_git rev-parse HEAD)
else
  if [ "$FORCE" != 1 ] && { ! radar_git diff --quiet HEAD -- || ! radar_git diff --cached --quiet; }; then
    radar_die "local changes to tracked files in $RADAR_DIR (git -C $RADAR_DIR status); commit them upstream, or --force to discard"
  fi
  radar_info "fetching origin/$BRANCH"
  radar_git fetch --quiet origin "+refs/heads/$BRANCH:refs/remotes/origin/$BRANCH"
  if [ -n "$REF" ]; then
    radar_git fetch --quiet --tags origin 2>/dev/null || true
    target=$(radar_git rev-parse --verify --quiet "$REF^{commit}" || true)
    [ -n "$target" ] || radar_die "unknown --ref $REF"
  else
    target=$(radar_git rev-parse "origin/$BRANCH")
  fi
fi

radar_info "current ${prev:0:12} → target ${target:0:12}"
cd "$RADAR_DIR"
rc=0
radar_deploy_rev "$target" "$prev" || rc=$?
if [ "$rc" = 0 ]; then
  radar_info "done: https://$(radar_env_get DOMAIN "$RADAR_DIR/.env")"
fi
exit "$rc"
