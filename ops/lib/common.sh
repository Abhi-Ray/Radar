# shellcheck shell=bash
# Shared helpers for the host-side ops scripts (install.sh, deploy.sh, autodeploy.sh,
# secrets.sh). Sourced, never executed. Portable to bash 3.2 (macOS, where the tests and
# `ops/secrets.sh` may run) and bash 5 (Ubuntu 24.04, the VPS).
#
# Nothing here prints secret values: .env is parsed without being sourced, and generated
# secrets are written straight into the file.

RADAR_LOG_PREFIX="${RADAR_LOG_PREFIX:-radar}"
# Host-side deploy state: deploy.lock, deployed-sha, failed-sha, seeded, nginx backups.
RADAR_STATE_DIR="${RADAR_STATE_DIR:-/var/lib/radar}"

radar_log() { printf '%s [%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$RADAR_LOG_PREFIX" "$*" >&2; }
radar_info() { radar_log "$@"; }
radar_warn() { radar_log "WARNING: $*"; }
radar_die() {
  radar_log "ERROR: $*"
  exit 1
}

# Prints a script's header comment (line 2 up to the first non-comment line) as its usage text.
radar_usage() { # file
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$1"
}

radar_need() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || radar_die "required command not found: $c"
  done
}

# ---------------------------------------------------------------------------------------------
# .env handling (KEY=VALUE lines; never sourced, so a value can never execute)

# A line is valid when it is blank, a comment, or KEY=VALUE with a shell-style key.
radar_env_invalid_lines() { # file → prints the numbers of invalid lines
  grep -nvE '^[[:space:]]*(#.*)?$|^[A-Za-z_][A-Za-z0-9_]*=' "$1" | cut -d: -f1 || true
}

# Value of KEY in an env file (last assignment wins); surrounding single/double quotes removed.
radar_env_get() { # key file
  local line v
  [ -f "$2" ] || return 0
  line=$(grep -E "^$1=" "$2" | tail -n 1 || true)
  [ -n "$line" ] || return 0
  v=${line#*=}
  v=${v%$'\r'}
  case "$v" in
    \"*\") v=${v#\"}; v=${v%\"} ;;
    \'*\') v=${v#\'}; v=${v%\'} ;;
  esac
  printf '%s\n' "$v"
}

# Sets KEY=VALUE in an env file: replaces the (last) existing assignment or appends one.
# The file keeps its mode; VALUE must be a single line.
radar_env_set() { # key value file
  local key=$1 value=$2 file=$3 tmp
  case "$value" in *$'\n'*) radar_die "radar_env_set: multi-line value for $key" ;; esac
  printf '%s' "$key" | grep -Eq '^[A-Za-z_][A-Za-z0-9_]*$' || radar_die "radar_env_set: bad key $key"
  tmp="$file.tmp.$$"
  if [ -f "$file" ] && grep -qE "^$key=" "$file"; then
    # Rewrite without sed so arbitrary characters in VALUE need no escaping.
    local line n=0 last
    last=$(grep -nE "^$key=" "$file" | tail -n 1 | cut -d: -f1)
    : >"$tmp"
    chmod 600 "$tmp"
    while IFS= read -r line || [ -n "$line" ]; do
      n=$((n + 1))
      if [ "$n" = "$last" ]; then printf '%s=%s\n' "$key" "$value" >>"$tmp"; else printf '%s\n' "$line" >>"$tmp"; fi
    done <"$file"
    cat "$tmp" >"$file"
    rm -f "$tmp"
  else
    [ -f "$file" ] && [ -n "$(tail -c 1 "$file" 2>/dev/null)" ] && printf '\n' >>"$file"
    printf '%s=%s\n' "$key" "$value" >>"$file"
  fi
}

radar_gen_secret() { openssl rand -hex "${1:-32}"; }

# ---------------------------------------------------------------------------------------------
# domains + templates

radar_valid_domain() {
  printf '%s' "$1" | grep -Eq '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$'
}

# 187.127.129.127 → radar.187-127-129-127.sslip.io
radar_sslip_domain() { # ipv4
  printf '%s' "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || return 1
  printf 'radar.%s.sslip.io\n' "$(printf '%s' "$1" | tr '.' '-')"
}

# Primary IPv4 of this host (the source address of the default route).
radar_primary_ipv4() {
  ip -4 route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1
}

# 0 when ADDR is a well-formed public unicast address (IPv4, or IPv6 in 2000::/3). Private,
# CGNAT, loopback, link-local, ULA, documentation, benchmark, multicast and reserved ranges fail.
radar_is_public_ip() { # addr
  local a=$1 o o1 o2 o3 o4
  if printf '%s' "$a" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$'; then
    IFS=. read -r o1 o2 o3 o4 <<<"$a"
    for o in "$o1" "$o2" "$o3" "$o4"; do
      case "$o" in 0?*) return 1 ;; esac # leading zeros: ambiguous, refuse
      [ "$o" -le 255 ] || return 1
    done
    [ "$o1" -eq 0 ] || [ "$o1" -eq 10 ] || [ "$o1" -eq 127 ] || [ "$o1" -ge 224 ] && return 1
    [ "$o1" -eq 100 ] && [ "$o2" -ge 64 ] && [ "$o2" -le 127 ] && return 1
    [ "$o1" -eq 169 ] && [ "$o2" -eq 254 ] && return 1
    [ "$o1" -eq 172 ] && [ "$o2" -ge 16 ] && [ "$o2" -le 31 ] && return 1
    [ "$o1" -eq 192 ] && [ "$o2" -eq 168 ] && return 1
    [ "$o1" -eq 192 ] && [ "$o2" -eq 0 ] && { [ "$o3" -eq 0 ] || [ "$o3" -eq 2 ]; } && return 1
    [ "$o1" -eq 198 ] && { [ "$o2" -eq 18 ] || [ "$o2" -eq 19 ]; } && return 1
    [ "$o1" -eq 198 ] && [ "$o2" -eq 51 ] && [ "$o3" -eq 100 ] && return 1
    [ "$o1" -eq 203 ] && [ "$o2" -eq 0 ] && [ "$o3" -eq 113 ] && return 1
    return 0
  fi
  a=$(printf '%s' "$a" | tr 'A-F' 'a-f')
  # IPv6: hex groups and colons only (no zone id, no embedded IPv4), global unicast 2000::/3.
  printf '%s' "$a" | grep -Eq '^[23][0-9a-f]{0,3}(:[0-9a-f]{0,4}){2,7}$' || return 1
  case "$a" in
    *:::* | *::*::* | *[0-9a-f]: | 2001:db8:* | 2001:0db8:*) return 1 ;;
    *::*) ;;
    *) printf '%s' "$a" | grep -Eq '^[0-9a-f]{1,4}(:[0-9a-f]{1,4}){7}$' || return 1 ;;
  esac
  return 0
}

# This host's own public addresses, comma-separated, detected locally with no external lookup:
# `ip -o addr show scope global`, falling back to `hostname -I`. Non-public ones (docker bridges,
# private LANs, …) are left out; safe-fetch refuses those anyway.
radar_public_ips() {
  local addrs a out=''
  addrs=$(ip -o addr show scope global 2>/dev/null |
    awk '{ for (i = 1; i < NF; i++) if ($i == "inet" || $i == "inet6") { split($(i + 1), p, "/"); print p[1] } }' || true)
  [ -n "$addrs" ] || addrs=$(hostname -I 2>/dev/null | tr ' ' '\n' || true)
  for a in $addrs; do
    a=$(printf '%s' "$a" | tr 'A-F' 'a-f')
    radar_is_public_ip "$a" || continue
    case ",$out," in *",$a,"*) continue ;; esac
    out=${out:+$out,}$a
  done
  [ -z "$out" ] || printf '%s\n' "$out"
}

# Renders an nginx template: substitutes exactly ${DOMAIN}, ${LISTEN_HTTP2}, ${HTTP2_DIRECTIVE}
# (nginx's own $variables are left alone) and refuses to emit any leftover ${…}.
radar_render_nginx() { # template domain listen_http2 http2_directive → stdout
  local out
  radar_valid_domain "$2" || radar_die "invalid domain: $2"
  case "$3" in '' | ' http2') ;; *) radar_die "bad listen_http2 value" ;; esac
  case "$4" in '' | 'http2 on;') ;; *) radar_die "bad http2 directive" ;; esac
  out=$(sed -e "s|\${DOMAIN}|$2|g" -e "s|\${LISTEN_HTTP2}|$3|g" -e "s|\${HTTP2_DIRECTIVE}|$4|g" "$1") ||
    radar_die "cannot read template $1"
  if printf '%s\n' "$out" | grep -v '^[[:space:]]*#' | grep -qF '${'; then
    radar_die "unrendered placeholder left in $1"
  fi
  printf '%s\n' "$out"
}

# Of the given ports, prints those that no `listen` directive in an `nginx -T` dump marks as
# default_server (any address: 80, 0.0.0.0:80, [::]:80 …).
radar_nginx_ports_without_default() { # dump_file port...
  local dump=$1 port
  shift
  for port in "$@"; do
    grep -Eq "^[[:space:]]*listen[[:space:]]+([^[:space:];#]*:)?$port([[:space:]][^;#]*)?[[:space:]]default_server([[:space:];]|$)" "$dump" ||
      printf '%s\n' "$port"
  done
}

# "1.24.0" "1.25.1" → 0 when $1 >= $2 (numeric, dot-separated, up to three parts).
radar_version_ge() {
  local i x y
  for i in 1 2 3; do
    x=$(printf '%s' "$1" | cut -d. -f"$i" | tr -cd '0-9')
    y=$(printf '%s' "$2" | cut -d. -f"$i" | tr -cd '0-9')
    x=${x:-0} y=${y:-0}
    [ "$x" -gt "$y" ] && return 0
    [ "$x" -lt "$y" ] && return 1
  done
  return 0
}

# ---------------------------------------------------------------------------------------------
# docker compose + health

radar_compose() { docker compose --project-directory "$RADAR_DIR" -f "$RADAR_DIR/docker-compose.yml" "$@"; }

# git on the deployment checkout, whoever owns it (root runs the ops scripts).
radar_git() { git -c safe.directory="$RADAR_DIR" -C "$RADAR_DIR" "$@"; }

# GET /api/health until it answers 200 (and, if given, reports the expected version).
radar_wait_healthy() { # timeout_seconds [expected_version]
  local deadline=$(($(date +%s) + $1)) body
  while :; do
    body=$(curl -fsS --max-time 5 http://127.0.0.1:3100/api/health 2>/dev/null || true)
    case "$body" in
      *'"ok":true'*)
        if [ -z "${2:-}" ]; then return 0; fi
        case "$body" in *"\"version\":\"$2\""*) return 0 ;; esac
        ;;
    esac
    [ "$(date +%s)" -lt "$deadline" ] || return 1
    sleep 5
  done
}

# ---------------------------------------------------------------------------------------------
# Image builds on a shared, swapless box (docs/DEPLOY.md §4). `next build` runs Turbopack, whose
# native memory no V8 heap flag bounds, so builds never use dockerd's built-in, unlimited builder:
# they run in RADAR's own BuildKit container (buildx, docker-container driver) whose cgroup caps
# them at RADAR_BUILD_MEMORY (swap included) and one CPU. An out-of-memory build then kills only
# itself. Compose loads what it builds into dockerd's local image store (`--load` is implied for
# `docker compose build`); radar_compose_build checks that the new revision really landed there.
RADAR_BUILDER="${RADAR_BUILDER:-radar-builder}"
RADAR_BUILD_MEMORY=3g
# Deploys wait until MemAvailable is at least this (3.5 GiB: the build cap + headroom).
RADAR_BUILD_MIN_AVAILABLE_KB="${RADAR_BUILD_MIN_AVAILABLE_KB:-3670016}"

radar_ensure_builder() {
  docker buildx inspect "$RADAR_BUILDER" >/dev/null 2>&1 && return 0
  radar_info "creating buildx builder $RADAR_BUILDER (docker-container driver; $RADAR_BUILD_MEMORY RAM, no swap, 1 CPU)"
  docker buildx create --name "$RADAR_BUILDER" --driver docker-container \
    --driver-opt "memory=$RADAR_BUILD_MEMORY" --driver-opt "memory-swap=$RADAR_BUILD_MEMORY" \
    --driver-opt cpu-quota=100000 --driver-opt cpu-period=100000 \
    --bootstrap >/dev/null
}

radar_mem_available_kb() { # → MemAvailable in kB (0 if unknown)
  local kb
  kb=$(sed -n 's/^MemAvailable:[[:space:]]*\([0-9][0-9]*\) kB$/\1/p' "${RADAR_MEMINFO:-/proc/meminfo}" 2>/dev/null | head -n 1)
  case "$kb" in '' | *[!0-9]*) kb=0 ;; esac
  printf '%s\n' "$kb"
}

radar_build_memory_ok() { [ "$(radar_mem_available_kb)" -ge "$RADAR_BUILD_MIN_AVAILABLE_KB" ]; }

radar_compose_build() { # sha
  local rev
  radar_ensure_builder || { radar_warn "cannot create the buildx builder $RADAR_BUILDER"; return 1; }
  GIT_SHA=$1 radar_compose build --builder "$RADAR_BUILDER" || return 1
  rev=$(docker image inspect --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' radar-app:latest 2>/dev/null || true)
  [ "$rev" = "$1" ] || { radar_warn "radar-app:latest in the local image store is '${rev:-missing}', not $1 (image not loaded?)"; return 1; }
}

# Build + (re)start the stack at the checked-out revision; prunes only RADAR's dangling images.
radar_compose_deploy() { # sha
  radar_compose_build "$1" || return 1
  GIT_SHA=$1 radar_compose up -d --no-build --remove-orphans || return 1
  # RADAR-scoped clean-up only: its own dangling images and its own builder's cache.
  docker image prune -f --filter "label=com.radar.project=radar" >/dev/null 2>&1 || true
  docker buildx prune --builder "$RADAR_BUILDER" -f --filter until=168h >/dev/null 2>&1 || true
}

# Not enough free memory for a build now: nothing is changed and no failed attempt is counted —
# the next timer run tries again. At most one in-app alert per UTC day.
radar_defer_deploy() { # target
  local short=${1:0:12} kb day stamp="$RADAR_STATE_DIR/deploy-deferred-day"
  kb=$(radar_mem_available_kb)
  radar_warn "deploy of $short deferred: MemAvailable is $((kb / 1024)) MiB, a build needs $((RADAR_BUILD_MIN_AVAILABLE_KB / 1024)) MiB; retrying at the next run"
  day=$(date -u +%Y-%m-%d)
  [ "$(cat "$stamp" 2>/dev/null || true)" = "$day" ] && return 0
  printf '%s\n' "$day" >"$stamp"
  radar_alert deploy_deferred warn "Deploy of $short deferred: low memory" \
    "Only $((kb / 1024)) MiB of memory was available; building RADAR needs $((RADAR_BUILD_MIN_AVAILABLE_KB / 1024)) MiB and this box has no swap, so the build was skipped to protect the other services. Auto-deploy retries every 5 minutes. Check: free -m." \
    "deploy_deferred:$day"
}

# Stores an alert in the app DB through the backup container (best effort).
radar_alert() { # kind severity title body dedupe_key
  radar_compose exec -T backup radar-alert --kind "$1" --severity "$2" --title "$3" --body "$4" --dedupe-key "$5" >/dev/null 2>&1 ||
    radar_warn "could not store the alert in the app ($3)"
}

# ---------------------------------------------------------------------------------------------
# deploy with rollback (ops/deploy.sh, ops/autodeploy.sh)

radar_is_sha() { printf '%s' "$1" | grep -Eq '^[0-9a-f]{40}$'; }

# Revision that is live according to the last successful deploy (empty if unknown).
radar_deployed_sha() {
  local s
  s=$(head -n 1 "$RADAR_STATE_DIR/deployed-sha" 2>/dev/null || true)
  if radar_is_sha "$s"; then printf '%s\n' "$s"; fi
}

# failed-sha holds "<sha> <attempts>" for the most recent revision that failed to deploy.
radar_failed_attempts() { # sha → number of failed attempts for exactly that sha
  local line n
  line=$(head -n 1 "$RADAR_STATE_DIR/failed-sha" 2>/dev/null || true)
  case "$line" in
    "$1 "*)
      n=${line#* }
      case "$n" in '' | *[!0-9]*) n=0 ;; esac
      printf '%s\n' "$n"
      ;;
    *) printf '0\n' ;;
  esac
}

radar_record_failure() { # sha
  local n
  n=$(radar_failed_attempts "$1")
  printf '%s %s\n' "$1" "$((n + 1))" >"$RADAR_STATE_DIR/failed-sha"
}

# Checks out TARGET (a fetched commit), rebuilds + restarts the stack and waits until
# /api/health reports it. On failure the checkout and the stack go back to PREV and a critical
# `deploy_failed` alert is stored (Telegram too, when configured).
# Returns 0 = TARGET is live, 1 = TARGET failed (PREV restored, or nothing to restore),
# 3 = TARGET failed and the rollback failed as well (RADAR may be down), 4 = deferred: too little
# free memory for a build, nothing changed (radar_defer_deploy). A rollback is not deferred: PREV
# is usually still in the builder's cache, and a broken RADAR must not wait for memory.
radar_deploy_rev() { # target [prev]
  local target=$1 prev=${2:-} short=${1:0:12} timeout=${RADAR_HEALTH_TIMEOUT_SEC:-300}
  radar_is_sha "$target" || radar_die "radar_deploy_rev: not a full commit id: $target"
  if ! radar_build_memory_ok; then
    radar_defer_deploy "$target"
    return 4
  fi
  radar_git reset --quiet --hard "$target" || { radar_warn "git reset --hard $short failed"; return 1; }
  radar_info "deploying $short ($(radar_git log -1 --format=%s "$target" | cut -c1-80))"
  if radar_compose_deploy "$target" && radar_wait_healthy "$timeout" "$target"; then
    printf '%s\n' "$target" >"$RADAR_STATE_DIR/deployed-sha"
    rm -f "$RADAR_STATE_DIR/failed-sha"
    radar_info "$short is live"
    return 0
  fi

  radar_warn "$short failed (build, start or health check within ${timeout}s)"
  radar_compose ps -a >&2 2>/dev/null || true
  radar_compose logs --no-color --tail=80 app worker >&2 2>/dev/null || true
  radar_record_failure "$target"
  if [ -z "$prev" ] || [ "$prev" = "$target" ]; then
    radar_alert deploy_failed critical "Deploy of $short failed" \
      "Commit $target did not become healthy and there is no previous revision to return to. See: journalctl -u radar-autodeploy; docker compose logs app." \
      "deploy_failed:$short"
    return 1
  fi

  radar_info "rolling back to ${prev:0:12}"
  if radar_git reset --quiet --hard "$prev" && radar_compose_deploy "$prev" && radar_wait_healthy "$timeout" "$prev"; then
    radar_info "rolled back: ${prev:0:12} is live again"
    radar_alert deploy_failed critical "Deploy of $short failed; rolled back to ${prev:0:12}" \
      "Commit $target did not become healthy, so ${prev:0:12} was redeployed and is serving. Auto-deploy retries a failed commit at most 3 times; push a fix or run ops/deploy.sh. Logs: journalctl -u radar-autodeploy." \
      "deploy_failed:$short"
    return 1
  fi
  radar_warn "rollback to ${prev:0:12} failed too"
  radar_alert deploy_failed critical "Deploy of $short failed AND the rollback failed" \
    "Neither $target nor $prev became healthy: RADAR may be down. docs/RECOVERY.md (b)." \
    "deploy_failed:$short"
  return 3
}
