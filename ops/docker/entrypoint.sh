#!/bin/sh
# RADAR app-image entrypoint. Runs under tini (PID 1, `-g` forwards signals to the whole process
# group), as the unprivileged `radar` user, in /app.
#
#   web                 apply pending migrations (dist/migrate.mjs), then start the Next server
#   worker              wait until the web container has applied migrations, then start the scheduler
#   cli|pipeline ARGS   one-off pipeline task:  docker compose exec worker radar-entrypoint cli run
#   migrate             apply pending migrations and exit
#   seed ARGS           apply pending migrations, then load the reference data (idempotent)
#   eval ARGS           accuracy evaluation CLI
#   hash-password ARGS  print an ADMIN_PASSWORD_HASH (reads the password from a TTY or --stdin)
#   help                this text
#   anything else       exec'd as-is (e.g. `sh` for debugging)
set -eu

cd /app

node_run() {
  # Source maps: stack traces in logs point at src/…ts lines, not bundle offsets.
  node --enable-source-maps "$@"
}

usage() {
  awk 'NR == 1 { next } /^#/ { sub(/^# ?/, ""); print; next } { exit }' "$0"
}

mode="${1:-web}"
if [ "$#" -gt 0 ]; then shift; fi

case "$mode" in
  web)
    node_run dist/migrate.mjs
    exec node --enable-source-maps server.js
    ;;
  worker)
    node_run dist/wait-for-migrations.mjs --timeout "${WAIT_FOR_MIGRATIONS_TIMEOUT_SEC:-600}"
    exec node --enable-source-maps dist/worker.mjs "$@"
    ;;
  cli | pipeline)
    exec node --enable-source-maps dist/cli.mjs "$@"
    ;;
  migrate)
    exec node --enable-source-maps dist/migrate.mjs
    ;;
  seed)
    node_run dist/migrate.mjs
    exec node --enable-source-maps dist/seed.mjs "$@"
    ;;
  eval)
    exec node --enable-source-maps dist/eval.mjs "$@"
    ;;
  hash-password)
    exec node dist/hash-password.mjs "$@"
    ;;
  help | --help | -h)
    usage
    ;;
  *)
    exec "$mode" "$@"
    ;;
esac
