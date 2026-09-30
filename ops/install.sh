#!/usr/bin/env bash
# RADAR installer for the VPS (Ubuntu 24.04). Idempotent: safe to re-run at any time.
#
#   sudo ops/install.sh [options]
#
#   --fresh-box        also install missing packages: docker (+compose, buildx), nginx, certbot, git
#   --restore          restore the database from the db-backups branch before the app starts
#                      (new VPS / lost volume — docs/RECOVERY.md). Asks for confirmation.
#   --domain NAME      public name (default: DOMAIN from .env). `auto` = radar.<this-ip>.sslip.io.
#                      A different name than .env's updates DOMAIN and APP_URL in .env.
#   --email ADDR       Let's Encrypt account email (default: ADMIN_EMAIL from .env)
#   --env-from FILE    install FILE as .env (the previous .env is kept as .env.bak-<time>)
#   --dir DIR          install directory (default /opt/radar)
#   --repo URL         git remote (default https://github.com/Abhi-Ray/Radar.git)
#   --branch NAME      branch to deploy (default main)
#   --http2 MODE       auto (default) | on | off   — see "HTTP/2" below
#   --staging          use the Let's Encrypt staging CA (testing only)
#   --skip-nginx       do not touch nginx or certbot
#   --no-pull          use the checkout as it is
#   --no-autodeploy    do not install the radar-autodeploy systemd timer
#   --add-deploy-key   add the backup deploy key with `gh` without asking
#   -y, --yes          no questions (fails instead of prompting)
#
# Steps: packages → clone/pull DIR → .env (keep | --env-from | decrypt ops/secrets.env.enc) →
# backup deploy key → /var/www/radar-acme → http-only vhost → certbot certonly --webroot →
# full vhost → docker compose up -d --build (after an optional restore) → seed on first
# install → systemd auto-deploy timer.
#
# Shared-server safety: touches ONLY DIR, /var/lib/radar, /var/www/radar-acme,
# /etc/nginx/sites-{available,enabled}/radar, the certificate for DOMAIN and the
# radar-autodeploy systemd units. Every nginx change is `nginx -t`-checked and rolled back on
# failure. Never edits other sites, other containers, the host MySQL or the firewall.
#
# HTTP/2: with nginx >= 1.25.1 `http2 on;` is per site. Older nginx (Ubuntu 24.04 ships 1.24)
# applies `listen … http2` to every site on the same :443 socket, so `auto` enables it only if
# another enabled site already has it (i.e. when it changes nothing for the neighbours).
set -Eeuo pipefail
umask 022

SELF="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
SRC_ROOT="$(cd "$(dirname "$SELF")/.." && pwd -P)"
RADAR_LOG_PREFIX=install
# shellcheck source=ops/lib/common.sh
. "$SRC_ROOT/ops/lib/common.sh"

ORIG_ARGS=("$@")
FRESH=0
RESTORE=0
DOMAIN_ARG=
EMAIL_ARG=
ENV_FROM=
RADAR_DIR=/opt/radar
REPO=https://github.com/Abhi-Ray/Radar.git
BRANCH=main
HTTP2_MODE=auto
STAGING=0
SKIP_NGINX=0
NO_PULL=0
NO_AUTODEPLOY=0
ADD_KEY=0
YES=0
STATE_DIR=$RADAR_STATE_DIR
ACME_ROOT=/var/www/radar-acme
NGINX_AVAIL=/etc/nginx/sites-available/radar
NGINX_ENABLED=/etc/nginx/sites-enabled/radar
GH_REPO=Abhi-Ray/Radar

usage() { radar_usage "$SELF"; }

parse_args() {
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --fresh-box) FRESH=1 ;;
      --restore) RESTORE=1 ;;
      --domain) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; DOMAIN_ARG=$2; shift ;;
      --email) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; EMAIL_ARG=$2; shift ;;
      --env-from) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; ENV_FROM=$2; shift ;;
      --dir) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; RADAR_DIR=$2; shift ;;
      --repo) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; REPO=$2; shift ;;
      --branch) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; BRANCH=$2; shift ;;
      --http2) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; HTTP2_MODE=$2; shift ;;
      --staging) STAGING=1 ;;
      --skip-nginx) SKIP_NGINX=1 ;;
      --no-pull) NO_PULL=1 ;;
      --no-autodeploy) NO_AUTODEPLOY=1 ;;
      --add-deploy-key) ADD_KEY=1 ;;
      -y | --yes) YES=1 ;;
      -h | --help) usage; exit 0 ;;
      *) printf 'unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
    esac
    shift
  done
  case "$HTTP2_MODE" in auto | on | off) ;; *) radar_die "--http2 must be auto, on or off" ;; esac
  case "$RADAR_DIR" in /*) ;; *) radar_die "--dir must be an absolute path" ;; esac
  printf '%s' "$BRANCH" | grep -Eq '^[A-Za-z0-9._/-]+$' || radar_die "invalid --branch"
}

confirm() { # question → 0 = yes
  local a
  if [ "$YES" = 1 ]; then return 1; fi
  [ -t 0 ] || return 1
  printf '%s [y/N] ' "$1" >&2
  IFS= read -r a || return 1
  case "$a" in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

step() { radar_info "── $*"; }

# ---------------------------------------------------------------------------------------------
# 0. packages

install_packages() {
  local pkgs=''
  command -v git >/dev/null 2>&1 || pkgs="$pkgs git"
  command -v curl >/dev/null 2>&1 || pkgs="$pkgs curl"
  command -v openssl >/dev/null 2>&1 || pkgs="$pkgs openssl"
  command -v ssh-keygen >/dev/null 2>&1 || pkgs="$pkgs openssh-client"
  command -v flock >/dev/null 2>&1 || pkgs="$pkgs util-linux"
  if [ "$SKIP_NGINX" != 1 ]; then
    command -v nginx >/dev/null 2>&1 || pkgs="$pkgs nginx"
    command -v certbot >/dev/null 2>&1 || pkgs="$pkgs certbot"
  fi
  if ! command -v docker >/dev/null 2>&1; then
    pkgs="$pkgs docker.io docker-buildx docker-compose-v2"
  else
    docker compose version >/dev/null 2>&1 || pkgs="$pkgs docker-compose-v2"
    docker buildx version >/dev/null 2>&1 || pkgs="$pkgs docker-buildx"
  fi
  [ -n "$pkgs" ] || { radar_info "all packages present"; return 0; }
  if [ "$FRESH" != 1 ]; then
    radar_die "missing:$pkgs — install them or re-run with --fresh-box"
  fi
  radar_need apt-get
  step "installing:$pkgs"
  DEBIAN_FRONTEND=noninteractive apt-get update -q
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y -q --no-install-recommends $pkgs
  if printf '%s' "$pkgs" | grep -q docker; then systemctl enable --now docker; fi
}

# ---------------------------------------------------------------------------------------------
# 1. code

sync_code() {
  local before after
  if [ -d "$RADAR_DIR/.git" ]; then
    if [ "$NO_PULL" = 1 ]; then
      radar_info "using $RADAR_DIR as checked out ($(radar_git rev-parse --short HEAD))"
      return 0
    fi
    before=$(sha256sum "$RADAR_DIR/ops/install.sh" 2>/dev/null | cut -d' ' -f1 || true)
    step "updating $RADAR_DIR ($BRANCH)"
    radar_git fetch --quiet origin "$BRANCH"
    if ! radar_git diff --quiet HEAD -- || ! radar_git diff --cached --quiet; then
      radar_die "$RADAR_DIR has local changes to tracked files; commit them upstream or discard them (git -C $RADAR_DIR status)"
    fi
    radar_git checkout --quiet "$BRANCH" 2>/dev/null || radar_git checkout --quiet -B "$BRANCH" "origin/$BRANCH"
    radar_git merge --quiet --ff-only "origin/$BRANCH" ||
      radar_die "cannot fast-forward $RADAR_DIR to origin/$BRANCH (history diverged); inspect, then: git -C $RADAR_DIR reset --hard origin/$BRANCH"
    after=$(sha256sum "$RADAR_DIR/ops/install.sh" | cut -d' ' -f1)
    if [ "$before" != "$after" ] || [ "$SELF" != "$RADAR_DIR/ops/install.sh" ]; then
      radar_info "continuing with the updated installer from $RADAR_DIR"
      exec bash "$RADAR_DIR/ops/install.sh" "${ORIG_ARGS[@]}" --no-pull
    fi
  elif [ -e "$RADAR_DIR" ] && [ -n "$(ls -A "$RADAR_DIR" 2>/dev/null)" ]; then
    radar_die "$RADAR_DIR exists, is not empty and is not a git checkout"
  else
    step "cloning $REPO ($BRANCH) into $RADAR_DIR"
    git clone --quiet --single-branch --branch "$BRANCH" "$REPO" "$RADAR_DIR"
    exec bash "$RADAR_DIR/ops/install.sh" "${ORIG_ARGS[@]}" --no-pull
  fi
}

# ---------------------------------------------------------------------------------------------
# 2. .env

ENV_FILE=

setup_env() {
  local ts
  ENV_FILE="$RADAR_DIR/.env"
  ts=$(date -u +%Y%m%dT%H%M%SZ)
  if [ -n "$ENV_FROM" ]; then
    [ -f "$ENV_FROM" ] || radar_die "--env-from file not found: $ENV_FROM"
    [ -z "$(radar_env_invalid_lines "$ENV_FROM")" ] || radar_die "$ENV_FROM is not a KEY=VALUE file"
    if [ -f "$ENV_FILE" ] && ! cmp -s "$ENV_FROM" "$ENV_FILE"; then
      cp -p "$ENV_FILE" "$ENV_FILE.bak-$ts"
      radar_info "previous .env kept as $ENV_FILE.bak-$ts"
    fi
    install -m 600 "$ENV_FROM" "$ENV_FILE"
    radar_info ".env installed from $ENV_FROM"
  elif [ -f "$ENV_FILE" ]; then
    radar_info "keeping the existing $ENV_FILE"
  elif [ -f "$RADAR_DIR/ops/secrets.env.enc" ]; then
    step "decrypting ops/secrets.env.enc into .env (needs BACKUP_PASSPHRASE)"
    bash "$RADAR_DIR/ops/secrets.sh" decrypt --in ops/secrets.env.enc --out .env
  else
    radar_die "no .env and no ops/secrets.env.enc. Create one: sudo $RADAR_DIR/ops/secrets.sh init --domain <name> --email <you@example.com>, fill in the rest (docs/DEPLOY.md), then re-run"
  fi
  chmod 600 "$ENV_FILE"
  [ -z "$(radar_env_invalid_lines "$ENV_FILE")" ] || radar_die "$ENV_FILE has lines that are not KEY=VALUE"
}

DOMAIN=

resolve_domain() {
  local current ip
  current=$(radar_env_get DOMAIN "$ENV_FILE")
  if [ "$DOMAIN_ARG" = auto ]; then
    ip=$(radar_primary_ipv4)
    [ -n "$ip" ] || radar_die "cannot determine this host's IPv4 address; pass --domain explicitly"
    DOMAIN_ARG=$(radar_sslip_domain "$ip")
  fi
  DOMAIN=${DOMAIN_ARG:-$current}
  [ -n "$DOMAIN" ] || radar_die "no DOMAIN in .env; pass --domain NAME (or --domain auto)"
  radar_valid_domain "$DOMAIN" || radar_die "invalid domain: $DOMAIN"
  if [ "$DOMAIN" != "$current" ] || [ "$(radar_env_get APP_URL "$ENV_FILE")" != "https://$DOMAIN" ]; then
    cp -p "$ENV_FILE" "$ENV_FILE.bak-$(date -u +%Y%m%dT%H%M%SZ)"
    radar_env_set DOMAIN "$DOMAIN" "$ENV_FILE"
    radar_env_set APP_URL "https://$DOMAIN" "$ENV_FILE"
    radar_info "DOMAIN/APP_URL set to $DOMAIN in .env"
  fi
  case "$DOMAIN" in
    *.sslip.io)
      ip=$(radar_primary_ipv4)
      if [ -n "$ip" ] && [ "$(radar_sslip_domain "$ip")" != "$DOMAIN" ]; then
        radar_warn "$DOMAIN does not match this host's IPv4 ($ip). On a new VPS use --domain auto (docs/RECOVERY.md d)."
      fi
      ;;
  esac
}

check_env() {
  local k v missing='' pw
  for k in MYSQL_ROOT_PASSWORD MYSQL_PASSWORD BACKUP_PASSPHRASE SESSION_SECRET ADMIN_EMAIL APP_URL DOMAIN; do
    v=$(radar_env_get "$k" "$ENV_FILE")
    [ -n "$v" ] || missing="$missing $k"
  done
  [ -z "$missing" ] || radar_die ".env is missing values for:$missing (see .env.example)"
  for k in MYSQL_PASSWORD MYSQL_USER MYSQL_DATABASE; do
    v=$(radar_env_get "$k" "$ENV_FILE")
    [ -z "$v" ] || printf '%s' "$v" | grep -Eq '^[A-Za-z0-9_-]+$' ||
      radar_die "$k may only contain [A-Za-z0-9_-] (it is embedded in DATABASE_URL)"
  done
  pw=$(radar_env_get BACKUP_PASSPHRASE "$ENV_FILE")
  [ "${#pw}" -ge 24 ] || radar_die "BACKUP_PASSPHRASE must be at least 24 characters"
  v=$(radar_env_get SESSION_SECRET "$ENV_FILE")
  [ "${#v}" -ge 32 ] || radar_die "SESSION_SECRET must be at least 32 characters"
  if grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE" | cut -d= -f2- | grep -q '\$'; then
    radar_warn ".env contains a '\$': docker compose interpolates it — single-quote that value"
  fi
}

# ---------------------------------------------------------------------------------------------
# 3. backup deploy key

setup_deploy_key() {
  local dir="$RADAR_DIR/secrets" key pub title
  key="$dir/backup_deploy_key"
  mkdir -p "$dir"
  chmod 700 "$dir"
  # Belt and braces: nothing in secrets/ can ever be committed from this checkout.
  [ -f "$dir/.gitignore" ] || printf '*\n' >"$dir/.gitignore"
  if [ ! -s "$key" ]; then
    step "generating the backup deploy key"
    ssh-keygen -q -t ed25519 -N '' -C "radar-backup@$(hostname -s)-$(date -u +%Y%m%d)" -f "$key"
  fi
  chmod 600 "$key"
  pub=$(cat "$key.pub")
  if deploy_key_works; then
    radar_info "backup deploy key can reach $GH_REPO"
    return 0
  fi
  radar_warn "the backup deploy key is not (yet) accepted by GitHub. Add it WITH WRITE ACCESS:"
  printf '\n  GitHub → %s → Settings → Deploy keys → Add deploy key → "Allow write access"\n\n  %s\n\n' "$GH_REPO" "$pub" >&2
  if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
    if [ "$ADD_KEY" = 1 ] || confirm "Add it now with: gh repo deploy-key add --allow-write?"; then
      title="radar-backup $(hostname -s) $(date -u +%Y-%m-%d)"
      gh repo deploy-key add "$key.pub" --repo "$GH_REPO" --allow-write --title "$title" &&
        radar_info "deploy key added" || radar_warn "gh could not add the key; add it by hand"
    fi
  fi
  deploy_key_works || radar_warn "backups will FAIL (and raise an alert) until the key is added"
}

# `git push --dry-run` opens git-receive-pack, which GitHub refuses for unknown or read-only keys;
# nothing is uploaded.
deploy_key_works() {
  local probe="$WORK/key-probe" ok=1
  rm -rf "$probe"
  git init --quiet "$probe"
  git -C "$probe" -c user.name=radar -c user.email=radar@localhost.invalid commit --quiet --allow-empty -m probe
  if GIT_SSH_COMMAND="ssh -F /dev/null -i $RADAR_DIR/secrets/backup_deploy_key -o IdentitiesOnly=yes -o IdentityAgent=none -o UserKnownHostsFile=$RADAR_DIR/ops/backup/github_known_hosts -o GlobalKnownHostsFile=/dev/null -o StrictHostKeyChecking=yes -o BatchMode=yes -o ConnectTimeout=15" \
    GIT_TERMINAL_PROMPT=0 GIT_CONFIG_GLOBAL=/dev/null \
    git -C "$probe" push --dry-run --quiet "git@github.com:$GH_REPO.git" HEAD:refs/heads/radar-deploy-key-probe >/dev/null 2>"$WORK/key-probe.err"; then
    ok=0
  fi
  rm -rf "$probe"
  return "$ok"
}

# ---------------------------------------------------------------------------------------------
# 4-7. nginx + certificate

NGINX_PREV=

nginx_install_vhost() { # rendered file
  local rendered=$1
  if [ -f "$NGINX_AVAIL" ] && cmp -s "$rendered" "$NGINX_AVAIL" && [ -L "$NGINX_ENABLED" ]; then
    radar_info "nginx vhost unchanged"
    return 0
  fi
  NGINX_PREV="$STATE_DIR/nginx-radar.prev"
  if [ -f "$NGINX_AVAIL" ]; then cp -p "$NGINX_AVAIL" "$NGINX_PREV"; else rm -f "$NGINX_PREV"; fi
  install -m 644 "$rendered" "$NGINX_AVAIL"
  ln -sfn "$NGINX_AVAIL" "$NGINX_ENABLED"
  if ! nginx -t 2>"$STATE_DIR/nginx-t.log"; then
    cat "$STATE_DIR/nginx-t.log" >&2
    if [ -f "$NGINX_PREV" ]; then
      install -m 644 "$NGINX_PREV" "$NGINX_AVAIL"
    else
      rm -f "$NGINX_ENABLED" "$NGINX_AVAIL"
    fi
    nginx -t >/dev/null 2>&1 || radar_warn "nginx -t still fails after the rollback — this was not caused by RADAR's file"
    radar_die "the new RADAR vhost failed nginx -t; rolled back (nothing reloaded)"
  fi
  systemctl reload nginx
  radar_info "nginx vhost installed and nginx reloaded"
}

http2_settings() { # sets LISTEN_HTTP2 / HTTP2_DIRECTIVE
  local ver
  LISTEN_HTTP2=''
  HTTP2_DIRECTIVE=''
  [ "$HTTP2_MODE" = off ] && return 0
  ver=$(nginx -v 2>&1 | sed -n 's|.*nginx/\([0-9.]*\).*|\1|p')
  if [ -n "$ver" ] && radar_version_ge "$ver" 1.25.1; then
    HTTP2_DIRECTIVE='http2 on;'
  elif [ "$HTTP2_MODE" = on ]; then
    LISTEN_HTTP2=' http2'
    radar_warn "nginx $ver: 'listen 443 ssl http2' also enables HTTP/2 for the other sites on :443"
  elif grep -EHs '^[[:space:]]*listen[[:space:]][^;#]*443[^;#]*http2' /etc/nginx/sites-enabled/* /etc/nginx/conf.d/*.conf 2>/dev/null |
    grep -v "^$NGINX_ENABLED:" | grep -q .; then
    LISTEN_HTTP2=' http2'
  else
    radar_info "nginx $ver: HTTP/2 left off (enabling it would change the other sites on :443; --http2 on to force)"
  fi
}

setup_nginx() {
  local cert="/etc/letsencrypt/live/$DOMAIN/fullchain.pem" email tmp="$WORK" probe body
  [ "$SKIP_NGINX" = 1 ] && { radar_info "--skip-nginx: nginx and certbot untouched"; return 0; }
  radar_need nginx certbot systemctl curl
  step "nginx + certificate for $DOMAIN"
  nginx -t >/dev/null 2>&1 || radar_die "nginx -t fails BEFORE any RADAR change; fix the existing configuration first (not touching it)"
  mkdir -p "$ACME_ROOT/.well-known/acme-challenge"
  chmod 755 "$ACME_ROOT" "$ACME_ROOT/.well-known" "$ACME_ROOT/.well-known/acme-challenge"
  if [ ! -s "$cert" ]; then
    radar_render_nginx "$RADAR_DIR/ops/nginx/radar-http-only.conf.template" "$DOMAIN" '' '' >"$tmp/http-only.conf"
    nginx_install_vhost "$tmp/http-only.conf"

    # Prove the HTTP-01 path works before asking Let's Encrypt (clear error instead of a rate-limited failure).
    probe="radar-probe-$(openssl rand -hex 8)"
    printf '%s\n' "$probe" >"$ACME_ROOT/.well-known/acme-challenge/$probe"
    body=$(curl -fsS --max-time 15 "http://$DOMAIN/.well-known/acme-challenge/$probe" 2>/dev/null || true)
    rm -f "$ACME_ROOT/.well-known/acme-challenge/$probe"
    [ "$body" = "$probe" ] ||
      radar_die "http://$DOMAIN/.well-known/acme-challenge/ is not served by this nginx (DNS must point here and port 80 must be open; RADAR does not change the firewall)"

    email=${EMAIL_ARG:-$(radar_env_get ADMIN_EMAIL "$ENV_FILE")}
    local certbot_args=(certonly --webroot -w "$ACME_ROOT" -d "$DOMAIN" --non-interactive --agree-tos --keep-until-expiring
      --deploy-hook 'nginx -t && systemctl reload nginx')
    if [ -n "$email" ]; then certbot_args+=(-m "$email"); else certbot_args+=(--register-unsafely-without-email); fi
    [ "$STAGING" = 1 ] && certbot_args+=(--staging)
    step "certbot certonly --webroot for $DOMAIN"
    certbot "${certbot_args[@]}"
    [ -s "$cert" ] || radar_die "certbot finished but $cert does not exist"
  else
    radar_info "certificate for $DOMAIN present (renewed by certbot.timer; deploy hook reloads nginx)"
  fi

  http2_settings
  radar_render_nginx "$RADAR_DIR/ops/nginx/radar.conf.template" "$DOMAIN" "$LISTEN_HTTP2" "$HTTP2_DIRECTIVE" >"$tmp/radar.conf"
  nginx_install_vhost "$tmp/radar.conf"
}

# ---------------------------------------------------------------------------------------------
# 8-9. containers, restore, seed

ensure_admin_hash() {
  local h
  h=$(radar_env_get ADMIN_PASSWORD_HASH "$ENV_FILE")
  [ -n "$h" ] && return 0
  [ "$YES" != 1 ] && [ -t 0 ] || radar_die "ADMIN_PASSWORD_HASH is empty in .env; create it: docker compose run --rm --no-deps app hash-password"
  step "no ADMIN_PASSWORD_HASH yet: choose the RADAR login password (min 8 characters)"
  local p1 p2
  printf 'password: ' >&2
  IFS= read -r -s p1
  printf '\nagain: ' >&2
  IFS= read -r -s p2
  printf '\n' >&2
  [ "$p1" = "$p2" ] || radar_die "the passwords differ"
  # The password travels only through this pipe (never argv/env/files).
  h=$(printf '%s' "$p1" | radar_compose run --rm --no-deps -T app hash-password --stdin) || radar_die "hash-password failed"
  p1= p2=
  printf '%s' "$h" | grep -Eq '^scrypt:[0-9]+:[0-9]+:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$' || radar_die "unexpected hash-password output"
  radar_env_set ADMIN_PASSWORD_HASH "$h" "$ENV_FILE"
  radar_info "ADMIN_PASSWORD_HASH written to .env"
}

start_stack() {
  local sha
  radar_need docker curl
  sha=$(radar_git rev-parse HEAD)
  cd "$RADAR_DIR"
  [ -s "$RADAR_DIR/secrets/backup_deploy_key" ] || radar_die "secrets/backup_deploy_key missing"

  step "building images at ${sha:0:12}"
  GIT_SHA=$sha radar_compose build
  ensure_admin_hash

  if [ "$RESTORE" = 1 ]; then
    radar_warn "--restore REPLACES the database '$(radar_env_get MYSQL_DATABASE "$ENV_FILE" | sed 's/^$/radar/')' with the latest backup from db-backups"
    if [ "$YES" != 1 ]; then
      [ -t 0 ] || radar_die "--restore needs a terminal for the confirmation (or -y)"
      printf 'Type RESTORE to continue: ' >&2
      local answer
      IFS= read -r answer
      [ "$answer" = RESTORE ] || radar_die "aborted"
    fi
    step "restoring the database from the latest backup"
    radar_compose stop app worker >/dev/null 2>&1 || true
    GIT_SHA=$sha radar_compose up -d mysql
    radar_compose run --rm backup radar-restore --yes-i-know ||
      radar_die "restore failed — nothing else was started. Details above; docs/RECOVERY.md"
    mkdir -p "$STATE_DIR"
    date -u +%Y-%m-%dT%H:%M:%SZ >"$STATE_DIR/seeded"
    radar_info "restore complete"
  fi

  step "starting the stack"
  radar_compose_deploy "$sha" || radar_die "docker compose up failed"
  if radar_wait_healthy 300 "$sha"; then
    radar_info "app healthy on 127.0.0.1:3100"
  else
    radar_die "the app did not become healthy within 5 min: docker compose logs --tail=200 app"
  fi
  printf '%s\n' "$sha" >"$STATE_DIR/deployed-sha"
  rm -f "$STATE_DIR/failed-sha"

  if [ ! -f "$STATE_DIR/seeded" ]; then
    step "first install: loading reference data (seed)"
    radar_compose run --rm --no-deps app seed || radar_die "seed failed: docker compose run --rm --no-deps app seed"
    date -u +%Y-%m-%dT%H:%M:%SZ >"$STATE_DIR/seeded"
  fi
}

# ---------------------------------------------------------------------------------------------
# 10. auto-deploy timer

install_systemd() {
  local u changed=0 tmp
  [ "$NO_AUTODEPLOY" = 1 ] && { radar_info "--no-autodeploy: systemd timer not installed"; return 0; }
  radar_need systemctl
  tmp=$(mktemp)
  for u in radar-autodeploy.service radar-autodeploy.timer; do
    sed "s|@RADAR_DIR@|$RADAR_DIR|g" "$RADAR_DIR/ops/systemd/$u" >"$tmp"
    if ! cmp -s "$tmp" "/etc/systemd/system/$u"; then
      install -m 644 "$tmp" "/etc/systemd/system/$u"
      changed=1
    fi
  done
  rm -f "$tmp"
  [ "$changed" = 1 ] && systemctl daemon-reload
  systemctl enable --now radar-autodeploy.timer >/dev/null
  radar_info "radar-autodeploy.timer active (every 5 min; journalctl -u radar-autodeploy)"
}

# ---------------------------------------------------------------------------------------------

main() {
  parse_args "$@"
  [ "$(id -u)" = 0 ] || radar_die "run as root: sudo $0 $*"
  step "RADAR install into $RADAR_DIR"
  install_packages
  mkdir -p "$STATE_DIR"
  chmod 700 "$STATE_DIR"
  # Same lock as ops/deploy.sh + ops/autodeploy.sh. fd 9 (and the lock) survive the re-exec in
  # sync_code, which therefore must not take it a second time.
  if [ "${RADAR_DEPLOY_LOCK_HELD:-}" != 1 ]; then
    exec 9>"$STATE_DIR/deploy.lock"
    flock -w 900 9 || radar_die "another install/deploy is running (lock $STATE_DIR/deploy.lock)"
    export RADAR_DEPLOY_LOCK_HELD=1
  fi
  sync_code
  WORK=$(mktemp -d)
  trap 'rm -rf "$WORK"' EXIT
  setup_env
  resolve_domain
  check_env
  setup_deploy_key
  setup_nginx
  start_stack
  install_systemd
  step "done"
  radar_info "RADAR: https://$DOMAIN   (health: curl -s http://127.0.0.1:3100/api/health)"
  radar_info "backups: daily 21:00 UTC → branch db-backups; status: docker compose exec backup radar-backup-scheduler status"
  if [ ! -f "$RADAR_DIR/ops/secrets.env.enc" ]; then
    radar_info "next: keep an encrypted copy of .env: sudo $RADAR_DIR/ops/secrets.sh encrypt, then commit ops/secrets.env.enc (docs/DEPLOY.md)"
  fi
}

main "$@"
