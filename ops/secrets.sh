#!/usr/bin/env bash
# Encrypted copy of the production .env, safe to commit to the PUBLIC repo.
#
#   ops/secrets.sh encrypt [--in .env] [--out ops/secrets.env.enc] [--force]
#   ops/secrets.sh decrypt [--in ops/secrets.env.enc] [--out .env] [--force]
#   ops/secrets.sh check   [--in ops/secrets.env.enc]     decrypts in memory, lists KEY NAMES only
#   ops/secrets.sh init    --domain NAME --email ADDR [--out .env] [--force]
#                          new .env from .env.example with freshly generated secrets
#
# Cipher (identical to the database backups, docs/RECOVERY.md):
#   openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -salt, passphrase = BACKUP_PASSPHRASE
# The passphrase comes from the BACKUP_PASSPHRASE environment variable, otherwise (encrypt) from
# the BACKUP_PASSPHRASE line of the input file, otherwise from a hidden prompt. It is never
# printed and never passed on a command line. Keep it in your password manager: without it
# neither this file nor the database backups can be decrypted.
#
# Paths are relative to the repository root. Output files are written atomically; decrypted
# files are mode 600. Exit 0 on success, 1 on failure, 2 on usage errors.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)"
RADAR_LOG_PREFIX=secrets
# shellcheck source=ops/lib/common.sh
. "$ROOT/ops/lib/common.sh"

CIPHER_ARGS="-aes-256-cbc -pbkdf2 -iter 600000 -md sha256"
MIN_PASSPHRASE=24

usage() { radar_usage "$ROOT/ops/secrets.sh"; }

cmd=${1:-}
[ -n "$cmd" ] || { usage >&2; exit 2; }
shift
case "$cmd" in -h | --help | help) usage; exit 0 ;; esac
IN=
OUT=
FORCE=0
DOMAIN=
EMAIL=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --in) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; IN=$2; shift ;;
    --out) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; OUT=$2; shift ;;
    --domain) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; DOMAIN=$2; shift ;;
    --email) [ "$#" -ge 2 ] || { usage >&2; exit 2; }; EMAIL=$2; shift ;;
    --force) FORCE=1 ;;
    -h | --help) usage; exit 0 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

abs() { case "$1" in /*) printf '%s\n' "$1" ;; *) printf '%s/%s\n' "$ROOT" "$1" ;; esac; }

TMPD=$(mktemp -d "${TMPDIR:-/tmp}/radar-secrets.XXXXXX")
trap 'rm -rf "$TMPD"; unset RADAR_SECRETS_PASS' EXIT
chmod 700 "$TMPD"

# Puts the passphrase into RADAR_SECRETS_PASS (exported only for openssl's `-pass env:`).
get_passphrase() { # mode(encrypt|decrypt) [env file to read it from]
  local p=${BACKUP_PASSPHRASE:-} p2
  if [ -z "$p" ] && [ -n "${2:-}" ]; then p=$(radar_env_get BACKUP_PASSPHRASE "$2"); fi
  if [ -z "$p" ]; then
    [ -t 0 ] || radar_die "BACKUP_PASSPHRASE is not set and there is no terminal to ask for it"
    printf 'BACKUP_PASSPHRASE: ' >&2
    IFS= read -r -s p
    printf '\n' >&2
    if [ "$1" = encrypt ]; then
      printf 'again: ' >&2
      IFS= read -r -s p2
      printf '\n' >&2
      [ "$p" = "$p2" ] || radar_die "the two passphrases differ"
    fi
  fi
  [ -n "$p" ] || radar_die "empty passphrase"
  if [ "$1" = encrypt ] && [ "${#p}" -lt "$MIN_PASSPHRASE" ]; then
    radar_die "BACKUP_PASSPHRASE must be at least $MIN_PASSPHRASE characters"
  fi
  RADAR_SECRETS_PASS=$p
  export RADAR_SECRETS_PASS
}

check_env_content() { # file label
  local bad
  [ -s "$1" ] || radar_die "$2 is empty"
  bad=$(radar_env_invalid_lines "$1" | head -n 5 | tr '\n' ' ')
  [ -z "$bad" ] || radar_die "$2 is not a KEY=VALUE file (line(s) $bad)"
}

refuse_overwrite() { # file
  if [ -e "$1" ] && [ "$FORCE" != 1 ]; then radar_die "$1 exists (use --force to overwrite)"; fi
}

# shellcheck disable=SC2086
decrypt_to() { openssl enc -d $CIPHER_ARGS -pass env:RADAR_SECRETS_PASS -in "$1" -out "$2" 2>"$TMPD/openssl.err"; }

case "$cmd" in
  encrypt)
    IN=$(abs "${IN:-.env}")
    OUT=$(abs "${OUT:-ops/secrets.env.enc}")
    [ -f "$IN" ] || radar_die "input not found: $IN"
    check_env_content "$IN" "$IN"
    refuse_overwrite "$OUT"
    get_passphrase encrypt "$IN"
    # shellcheck disable=SC2086
    openssl enc $CIPHER_ARGS -salt -pass env:RADAR_SECRETS_PASS -in "$IN" -out "$TMPD/out.enc" ||
      radar_die "encryption failed"
    decrypt_to "$TMPD/out.enc" "$TMPD/roundtrip" || radar_die "round-trip decryption failed"
    cmp -s "$IN" "$TMPD/roundtrip" || radar_die "round-trip mismatch"
    rm -f "$TMPD/roundtrip"
    chmod 644 "$TMPD/out.enc"
    mv -f "$TMPD/out.enc" "$OUT"
    radar_info "wrote $OUT ($(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$IN") keys). Commit it; keep BACKUP_PASSPHRASE in your password manager."
    ;;
  decrypt)
    IN=$(abs "${IN:-ops/secrets.env.enc}")
    OUT=$(abs "${OUT:-.env}")
    [ -f "$IN" ] || radar_die "input not found: $IN"
    refuse_overwrite "$OUT"
    get_passphrase decrypt
    decrypt_to "$IN" "$TMPD/plain" || radar_die "decryption failed: wrong BACKUP_PASSPHRASE or corrupted file"
    check_env_content "$TMPD/plain" "the decrypted file"
    chmod 600 "$TMPD/plain"
    mv -f "$TMPD/plain" "$OUT"
    radar_info "wrote $OUT (mode 600)"
    ;;
  check)
    IN=$(abs "${IN:-ops/secrets.env.enc}")
    [ -f "$IN" ] || radar_die "input not found: $IN"
    get_passphrase decrypt
    decrypt_to "$IN" "$TMPD/plain" || radar_die "decryption failed: wrong BACKUP_PASSPHRASE or corrupted file"
    check_env_content "$TMPD/plain" "the decrypted file"
    radar_info "ok — keys present:"
    grep -E '^[A-Za-z_][A-Za-z0-9_]*=' "$TMPD/plain" | cut -d= -f1 | sort -u | sed 's/^/  /' >&2
    ;;
  init)
    OUT=$(abs "${OUT:-.env}")
    [ -n "$DOMAIN" ] || radar_die "--domain is required (e.g. radar.187-127-129-127.sslip.io)"
    radar_valid_domain "$DOMAIN" || radar_die "invalid domain: $DOMAIN"
    printf '%s' "$EMAIL" | grep -Eq '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' || radar_die "--email must be an email address"
    refuse_overwrite "$OUT"
    [ -f "$ROOT/.env.example" ] || radar_die ".env.example not found"
    radar_need openssl
    cp "$ROOT/.env.example" "$TMPD/env"
    chmod 600 "$TMPD/env"
    radar_env_set DOMAIN "$DOMAIN" "$TMPD/env"
    radar_env_set APP_URL "https://$DOMAIN" "$TMPD/env"
    radar_env_set ADMIN_EMAIL "$EMAIL" "$TMPD/env"
    radar_env_set SESSION_SECRET "$(radar_gen_secret 32)" "$TMPD/env"
    radar_env_set MYSQL_ROOT_PASSWORD "$(radar_gen_secret 24)" "$TMPD/env"
    radar_env_set MYSQL_PASSWORD "$(radar_gen_secret 24)" "$TMPD/env"
    radar_env_set BACKUP_PASSPHRASE "$(radar_gen_secret 32)" "$TMPD/env"
    mv -f "$TMPD/env" "$OUT"
    radar_info "wrote $OUT with generated SESSION_SECRET, MYSQL_ROOT_PASSWORD, MYSQL_PASSWORD, BACKUP_PASSPHRASE."
    radar_info "still to fill in: ADMIN_PASSWORD_HASH (ops/install.sh offers to create it) and the optional keys (OpenRouter, Telegram, SMTP)."
    radar_info "copy BACKUP_PASSPHRASE into your password manager NOW: it is the only key to the backups."
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
