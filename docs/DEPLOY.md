# RADAR — Deployment

How RADAR runs on the VPS, where every piece lives, and how to deploy, observe and rotate it.
Disaster procedures are in [RECOVERY.md](RECOVERY.md); the big picture is in
[ARCHITECTURE.md](ARCHITECTURE.md).

RADAR shares the VPS with other projects. It **only** owns the paths, units, volumes and ports
listed below. It never edits another site's nginx files, never claims `default_server`, never
touches the host MySQL (127.0.0.1:3306) or the apps on :3000/:3001, and never changes the
firewall.

## 1. The facts

| What | Value |
|---|---|
| Public URL | `https://radar.187-127-129-127.sslip.io` (`DOMAIN` / `APP_URL` in `.env`) |
| VPS | Ubuntu 24.04, UTC, 2 vCPU, 7.8 GB RAM, no swap, Docker 29 + compose v5, certbot 2.9, host nginx from Ubuntu (1.24 in 24.04; the installer detects the real version) |
| Code | `/opt/radar`: a clone of `github.com/Abhi-Ray/Radar`, branch `main`, owned by root |
| Compose project | `radar` (`/opt/radar/docker-compose.yml`) |
| Published port | **`127.0.0.1:3100`** → `app:3000`. Nothing else is published; MySQL has no host port. |
| Repo visibility | **Public.** Secrets exist only in `/opt/radar/.env`, `/opt/radar/secrets/` and, encrypted, in `ops/secrets.env.enc`. |

### 1.1 Files and directories on the VPS

| Path | What | Created by |
|---|---|---|
| `/opt/radar/` | git checkout (deployed revision) | `ops/install.sh` |
| `/opt/radar/.env` | production environment, mode 600, untracked | `ops/secrets.sh init` / `decrypt`, or `--env-from` |
| `/opt/radar/.env.bak-<UTC time>` | previous `.env` whenever the installer changed it | `ops/install.sh` |
| `/opt/radar/secrets/backup_deploy_key` (+ `.pub`) | SSH key allowed to push the `db-backups` branch; dir mode 700, key 600; `secrets/.gitignore` = `*` | `ops/install.sh` |
| `/opt/radar/ops/secrets.env.enc` | AES-256 copy of `.env`, committed to git | `ops/secrets.sh encrypt` |
| `/var/lib/radar/deploy.lock` | one install/deploy at a time (`flock`) | ops scripts |
| `/var/lib/radar/deployed-sha` | commit that last passed the health check | ops scripts |
| `/var/lib/radar/failed-sha` | `<commit> <attempts>` of the last commit that failed to deploy | ops scripts |
| `/var/lib/radar/seeded` | marker: reference data was loaded (or a backup restored) | `ops/install.sh` |
| `/var/lib/radar/deploy-deferred-day` | UTC day of the last `deploy_deferred` alert (one per day, §4) | ops scripts |
| `/var/lib/radar/nginx-radar.prev` | previous RADAR vhost, used for rollback | `ops/install.sh` |
| `/var/www/radar-acme/` | webroot for Let's Encrypt HTTP-01 challenges | `ops/install.sh` |
| `/etc/nginx/sites-available/radar` | the **only** RADAR nginx file (rendered from `ops/nginx/radar.conf.template`) | `ops/install.sh` |
| `/etc/nginx/sites-enabled/zz-radar` | symlink to the file above; the `zz-` makes it sort after every other site (§2). Installs before this name used `sites-enabled/radar`; the installer removes that old link when it points to RADAR's file | `ops/install.sh` |
| `/etc/letsencrypt/live/<DOMAIN>/` | certificate + key | `certbot certonly --webroot` |
| `/etc/letsencrypt/renewal/<DOMAIN>.conf` | renewal settings incl. the deploy hook `nginx -t && systemctl reload nginx` | certbot |
| `/etc/systemd/system/radar-autodeploy.service` / `.timer` | auto-deploy (rendered from `ops/systemd/`) | `ops/install.sh` |
| `/var/log/nginx/radar.access.log`, `radar.error.log` | nginx logs for the RADAR vhost (rotated by the distro's logrotate) | nginx |

Docker objects (all prefixed so they cannot collide with other projects):

| Object | Name |
|---|---|
| Images | `radar-app:latest` (app + worker), `radar-backup:latest`; label `com.radar.project=radar` |
| Image builder | buildx builder `radar-builder` (docker-container driver: container `buildx_buildkit_radar-builder0`, volume `buildx_buildkit_radar-builder0_state` with RADAR's build cache); §4 |
| Containers | `radar-app-1`, `radar-worker-1`, `radar-mysql-1`, `radar-backup-1` |
| Volumes | `radar_mysql` (database), `radar_backup_work` (backup state, safety dumps, temp files) |
| Networks | `radar_internal` (no internet; the only network MySQL is on), `radar_egress` (outbound + the port publish) |
| Container logs | Docker `json-file`, 10 MB × 3 files per container |

### 1.2 Services

| Service | Image / command | Limits | Notes |
|---|---|---|---|
| `app` | `radar-app` `web` | 900 MB, 1 CPU | runs `dist/migrate.mjs`, then `node server.js`; health check `GET /api/health` |
| `worker` | `radar-app` `worker` | 700 MB, 1 CPU | waits until the app applied the migrations, then runs every scheduled job (`dist/worker.mjs`) |
| `mysql` | `mysql:8.4` | 800 MB, 1 CPU | `innodb-buffer-pool-size=256M`, `max-connections=60`, utf8mb4/`utf8mb4_0900_ai_ci`, `skip-name-resolve`, UTC, no binlog, no performance_schema |
| `backup` | `radar-backup` `radar-backup-scheduler` | 512 MB | encrypted daily dump → branch `db-backups`; monthly restore test |

All run with `restart: unless-stopped`, `no-new-privileges`, and (except MySQL) all Linux
capabilities dropped. The app and worker never receive `MYSQL_ROOT_PASSWORD`,
`BACKUP_PASSPHRASE`, `BACKUP_DB_USER` or `BACKUP_DB_PASSWORD` (compose blanks them again after
`env_file`); the backup container never receives the session secret, the password hash or the
OpenRouter key.

### 1.3 Schedules (all UTC)

| When | What | Where |
|---|---|---|
| every 5 min (first run 3 min after boot) | auto-deploy check | `radar-autodeploy.timer` |
| daily 21:00 (02:30 IST) | encrypted database backup → `db-backups` | `backup` container (`BACKUP_HOUR_UTC`, `BACKUP_MINUTE_UTC`) |
| monthly, day 1, 22:00 | automatic restore test into `radar_restore_test` | `backup` container (`RESTORE_TEST_*`) |
| failed backup / restore test | one retry 1 h later, critical alert | `backup` container |
| twice a day | certificate renewal check (renews < 30 days before expiry) | Ubuntu's `certbot.timer` |
| pipeline, link checks, FX, registers, heartbeat, digest, AI queue, retention | see the schedule table in `src/worker/` | `worker` container |

### 1.4 Environment keys

`/opt/radar/.env` holds these keys (full comments, defaults and rules in
[`.env.example`](../.env.example); values are never written into any doc):

- Public name: `DOMAIN`, `APP_URL`
- Login: `ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET`
- Time: `APP_TZ`
- Database: `MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
  (`DATABASE_URL` stays empty in production: compose builds it)
- AI: `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `AI_ENABLED`, `AI_DAILY_LIMIT`
- Alerts: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `SMTP_URL`, `ALERT_EMAIL_TO`, `HEALTHCHECK_PING_URL`
- Outbound fetch safety: `SAFE_FETCH_DENY_IPS` — comma-separated IPs the fetchers must never
  contact, on top of every private/reserved range. `ops/install.sh` writes this VPS's own public
  addresses once (detected locally from `ip -o addr` / `hostname -I`, no external lookup) and
  never touches the key again; an empty value is kept as the operator's choice. On a new VPS with
  an old `.env`, delete the line and re-run the installer. An invalid entry stops the app at start.
- Backups: `BACKUP_PASSPHRASE`, `BACKUP_REPO`, `BACKUP_BRANCH`, `BACKUP_HOUR_UTC`,
  `BACKUP_MINUTE_UTC`, `RESTORE_TEST_DAY`, `RESTORE_TEST_HOUR_UTC`, `RESTORE_TEST_MINUTE_UTC`,
  `RESTORE_TEST_MAX_BACKUP_AGE_HOURS`, `RESTORE_TEST_DB`, `BACKUP_SHRINK_GUARD_PCT`,
  `BACKUP_PART_SIZE`, `BACKUP_MAX_SIZE`, `BACKUP_STARTUP_DELAY_SEC`, `BACKUP_RETRY_DELAY_SEC`,
  `BACKUP_GIT_NAME`, `BACKUP_GIT_EMAIL`, `BACKUP_DB_USER`, `BACKUP_DB_PASSWORD`

Set by the image or compose, never in `.env`: `NODE_ENV`, `MIGRATIONS_DIR`, `GIT_SHA` (the
deployed commit, shown by `/api/health`), `NODE_OPTIONS`.

## 2. nginx and TLS

- One vhost, `/etc/nginx/sites-available/radar`, for `server_name <DOMAIN>` only, enabled as
  `/etc/nginx/sites-enabled/zz-radar`. It never declares `default_server`; because nginx makes the
  *first* server of a socket its implicit default, the `zz-` name keeps RADAR behind every other
  site, so bare-IP / unknown-`Host` / SNI-less requests keep reaching whichever neighbour answered
  them before. The installer also warns (it does not fail) when `nginx -T` shows no
  `default_server` for `:80` or `:443`: then the first site in include order answers those
  requests, which is worth pinning on a shared box (e.g. `listen 443 ssl default_server;` in the
  site that should get them — RADAR never edits other sites itself).
  - `:80` serves `/.well-known/acme-challenge/` from `/var/www/radar-acme` and 301-redirects
    everything else to `https://<DOMAIN>`.
  - `:443` terminates TLS (TLS 1.2/1.3, ECDHE AEAD ciphers, HSTS 1 year) and proxies to
    `127.0.0.1:3100` with `Host`, `X-Real-IP`, `X-Forwarded-For/-Proto/-Host` and WebSocket
    upgrade headers. `client_max_body_size 5m`; gzip for text types.
  - `limit_req` zone `radar_login` (12 requests/min per IP, burst 20) on `/login` and
    `/api/auth/login`, answering `429`. The app adds its own per-IP lockout in the database.
  - Every http-level name is prefixed `radar_` (`radar_login`, `radar_app`,
    `radar_connection_upgrade`, `radar_tls`) so nothing clashes with the other sites.
- **HTTP/2.** On nginx < 1.25.1 (Ubuntu 24.04 ships 1.24) `listen 443 ssl http2` turns HTTP/2 on for *every* site sharing the `:443`
  socket, so `ops/install.sh --http2 auto` enables it only when another enabled site already
  does (then nothing changes for the neighbours). With nginx ≥ 1.25.1 the per-site
  `http2 on;` is used instead. `--http2 on|off` forces it.
- **Certificate.** First install: the installer puts a plain-HTTP bootstrap vhost in place
  (ACME path only, everything else 503), proves that `http://<DOMAIN>/.well-known/acme-challenge/`
  reaches this nginx, then runs

  ```sh
  certbot certonly --webroot -w /var/www/radar-acme -d <DOMAIN> --non-interactive --agree-tos \
    --keep-until-expiring -m <ADMIN_EMAIL> --deploy-hook 'nginx -t && systemctl reload nginx'
  ```

  and swaps in the full vhost. Renewal is automatic (`certbot.timer`); the deploy hook reloads
  nginx only if the configuration is valid. Check with `sudo certbot certificates` and
  `sudo certbot renew --dry-run --cert-name <DOMAIN>`.
- Every change is checked with `nginx -t` before `systemctl reload nginx`; a failing file is
  rolled back to `/var/lib/radar/nginx-radar.prev` and nothing is reloaded.

## 3. First installation

On the VPS, as root:

```sh
git clone --single-branch --branch main https://github.com/Abhi-Ray/Radar.git /opt/radar
cd /opt/radar
ops/secrets.sh init --domain radar.187-127-129-127.sslip.io --email <you@example.com>
#   → writes .env with generated secrets. Copy BACKUP_PASSPHRASE into your password manager now.
#   Optional: edit .env for OPENROUTER_API_KEY, TELEGRAM_*, SMTP_URL, ALERT_EMAIL_TO.
ops/install.sh
```

The installer (idempotent; re-run it whenever you like):

1. checks the required packages (`--fresh-box` installs missing ones: docker, compose, buildx,
   nginx, certbot, git, curl, openssl);
2. fast-forwards `/opt/radar` to `origin/main` (and continues with the updated installer);
3. keeps `.env` (or installs `--env-from FILE`, or decrypts `ops/secrets.env.enc`) and validates it;
   writes `SAFE_FETCH_DENY_IPS` (§1.4) if the key is absent;
4. creates the backup deploy key, prints the public key, and offers
   `gh repo deploy-key add … --allow-write` (or add it by hand: GitHub → Settings → Deploy keys →
   *Allow write access*). It checks the key with a dry-run push;
5. bootstrap vhost → `nginx -t` → reload → `certbot certonly --webroot` → full vhost;
6. asks for the login password if `ADMIN_PASSWORD_HASH` is empty (hashed inside the app image);
7. creates the `radar-builder` buildx builder if missing, refuses to build with less than 3.5 GiB
   `MemAvailable`, `docker compose build --builder radar-builder`, `up -d --no-build`, waits for
   `/api/health` to report the new commit (§4);
8. loads the reference data on the first install (`seed`), or with `--restore` restores the
   latest backup instead;
9. installs and starts `radar-autodeploy.timer`.

Afterwards, commit the encrypted `.env`:

```sh
cd /opt/radar && ops/secrets.sh encrypt     # uses BACKUP_PASSPHRASE from .env
git add ops/secrets.env.enc && git commit -m "ops: update encrypted env" && git push
# (push from your laptop if the VPS has no GitHub write access: copy the file over, commit there)
```

## 4. Deploying

- **Normal path:** push to `main`. Within ~5 minutes `radar-autodeploy` notices that
  `origin/main` moved, runs `git reset --hard origin/main`,
  `docker compose build --builder radar-builder`, `docker compose up -d --no-build
  --remove-orphans`, waits up to 5 minutes for `/api/health` to report the new commit, and prunes
  only RADAR's leftovers: `docker image prune -f --filter label=com.radar.project=radar` (its
  dangling images) and `docker buildx prune --builder radar-builder -f --filter until=168h` (its
  own build cache). Other projects' images and build caches are never touched.
- **If the new commit does not become healthy**, the previous commit is checked out and
  redeployed, and a critical `deploy_failed` alert is stored (and sent to Telegram). A failing
  commit is retried at most 3 times; the next push starts over.
- **Manual deploy** (also after editing `.env`):

  ```sh
  sudo /opt/radar/ops/deploy.sh             # origin/main, always rebuilds + restarts
  sudo /opt/radar/ops/deploy.sh --no-pull   # what is checked out now (e.g. only .env changed)
  sudo /opt/radar/ops/deploy.sh --ref <sha> # pin a revision; first: systemctl stop radar-autodeploy.timer
  ```

- **Pause auto-deploy:** `sudo systemctl stop radar-autodeploy.timer` (start it again to resume;
  `disable` to keep it off across reboots).

### 4.1 Builds on the shared, swapless VPS

`next build` runs Turbopack, whose native memory no `--max-old-space-size` bounds (the Dockerfile's
`BUILD_MAX_OLD_SPACE_MB=2048` only makes a JS-heavy step fail with a readable "heap out of
memory"). The `nice`/`CPUWeight` settings of `radar-autodeploy.service` only apply to the
git/compose client. So RADAR never builds in dockerd's built-in builder; it uses its own BuildKit
container, whose cgroup is the real ceiling:

```sh
# created once by ops/install.sh; deploy.sh and autodeploy.sh re-create it if it is missing
docker buildx create --name radar-builder --driver docker-container \
  --driver-opt memory=3g --driver-opt memory-swap=3g \
  --driver-opt cpu-quota=100000 --driver-opt cpu-period=100000 --bootstrap
# every build (ops/lib/common.sh radar_compose_build)
GIT_SHA=<sha> docker compose build --builder radar-builder
# `docker compose build` loads the result into dockerd's local image store; the script then
# checks `docker image inspect radar-app:latest` for label org.opencontainers.image.revision=<sha>
GIT_SHA=<sha> docker compose up -d --no-build --remove-orphans
```

3 GiB RAM with `memory-swap` equal to it (no swap), one CPU (`cpu-quota`/`cpu-period` =
100000/100000). A build that needs more is OOM-killed *inside* that container; the running stack
and the neighbours are unaffected and the deploy fails like any other failed build (rollback,
`deploy_failed`). Inspect with `docker buildx inspect radar-builder` / `docker buildx ls`; after a
Docker upgrade that lost it, the next deploy re-creates it.

**Memory guard.** Before touching the checkout, a deploy reads `MemAvailable` from
`/proc/meminfo`. Below 3.5 GiB (the build cap plus headroom) nothing is changed: the run is logged,
it does **not** count as a failed attempt, at most one `deploy_deferred` warning alert is stored
per UTC day, and the next timer run (5 min) simply tries again. `ops/deploy.sh` exits `4` in that
case (try again later); `ops/install.sh` stops with a message before building. A rollback to the
previous revision is never deferred (its layers are normally still cached, and a broken RADAR must
not wait).

**Alternative: build in CI, pull on the VPS.** The CI `images` job already builds
`radar-app`. Pushing it to GHCR (`ghcr.io/abhi-ray/radar-app:<sha>`, `permissions: packages:
write` for that job only) and letting the deploy `docker pull` that tag + `docker compose up -d
--no-build` would remove on-box builds entirely (no build memory at all on the VPS). It needs a
registry login on the VPS for a private package (a read-only token) and a deploy that waits for
CI to finish; it is not wired up today.
- Migrations run automatically when the app container starts (forward-only). A rollback to an
  older commit keeps the newer schema, so migrations must stay backwards compatible (add, don't
  drop, in the same release).

Security note: anyone who can push to `main` controls the VPS. Protect `main` on GitHub
(ruleset: require pull requests, block force pushes) and keep the backup deploy key limited to
what it needs: the backup container only ever pushes the `db-backups` branch.

## 5. Observing

```sh
cd /opt/radar
curl -s http://127.0.0.1:3100/api/health         # {"ok":true,"db":"up","lastRunAgeHours":…,"version":"<sha>"}
curl -s https://$DOMAIN/api/health               # {"ok":true,"db":"up"} — the public view never shows version/run age
sudo docker compose ps
sudo docker compose logs -f --tail=200 app worker
sudo docker compose logs --tail=200 backup mysql
sudo docker compose exec backup radar-backup-scheduler status   # last backup/restore test + next slots
journalctl -u radar-autodeploy -n 100 --no-pager                # deploy history
systemctl list-timers radar-autodeploy.timer
sudo tail -f /var/log/nginx/radar.access.log /var/log/nginx/radar.error.log
sudo docker stats --no-stream radar-app-1 radar-worker-1 radar-mysql-1 radar-backup-1
```

Inside the app: `/system` shows pipeline runs, alerts, dead letters, the audit trail, AI usage and
backups (`backup_runs`). One-off tasks:

```sh
sudo docker compose exec worker radar-entrypoint cli --help      # pipeline CLI
sudo docker compose run --rm --no-deps app eval                  # accuracy evaluation
sudo docker compose exec backup radar-backup-scheduler run-now backup
sudo docker compose exec backup radar-backup-scheduler run-now restore-test
```

## 6. Rotating secrets

Edit `/opt/radar/.env` (`sudo nano /opt/radar/.env`), apply, then refresh the encrypted copy:
`sudo /opt/radar/ops/secrets.sh encrypt --force` and commit `ops/secrets.env.enc`.

| Secret | How |
|---|---|
| Login password | `sudo docker compose run --rm --no-deps app hash-password` → paste into `ADMIN_PASSWORD_HASH` → `sudo ops/deploy.sh --no-pull` |
| `SESSION_SECRET` | `openssl rand -hex 32` → `.env` → `sudo ops/deploy.sh --no-pull` (every session is logged out) |
| `OPENROUTER_API_KEY` | [RECOVERY.md (f)](RECOVERY.md#f-openrouter-key-rotated) |
| `TELEGRAM_*`, `SMTP_URL` | edit `.env` → `sudo ops/deploy.sh --no-pull` |
| `MYSQL_PASSWORD` | the volume already has the old one, so change it in MySQL first — see below |
| `MYSQL_ROOT_PASSWORD` | same idea for `'root'@'%'` and `'root'@'localhost'` — see below |
| `BACKUP_PASSPHRASE` | see below |
| Backup deploy key | [RECOVERY.md (e)](RECOVERY.md#e-backup-deploy-key-lost-or-leaked) |

The new password never appears on a command line (other users of the box can read every
process's argv in `/proc`): `openssl` prints it into a variable, MySQL gets it on stdin (a bash
here-string) and `.env` is rewritten by `radar_env_set` from `ops/lib/common.sh`, which uses only
shell builtins (argument order: `KEY VALUE FILE`). Never pass it as an argument to an external
command (e.g. `sed -i "s/^MYSQL_PASSWORD=.*/MYSQL_PASSWORD=$NEW/" .env`).

`MYSQL_PASSWORD` (the application user). Run it as root (`.env` is mode 600, owned by root), so
start with `sudo -i`:

```sh
cd /opt/radar && . ops/lib/common.sh
NEW=$(openssl rand -hex 24)
USER_NAME=$(radar_env_get MYSQL_USER .env); USER_NAME=${USER_NAME:-radar}
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' \
  <<<"ALTER USER '$USER_NAME'@'%' IDENTIFIED BY '$NEW';"
radar_env_set MYSQL_PASSWORD "$NEW" .env && unset NEW USER_NAME
ops/deploy.sh --no-pull
exit
```

`MYSQL_ROOT_PASSWORD` (the running `mysql` container still knows the old one, which the first
command uses; `deploy.sh` then recreates `mysql` and `backup` with the new value):

```sh
cd /opt/radar && . ops/lib/common.sh
NEW=$(openssl rand -hex 24)
docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' \
  <<<"ALTER USER 'root'@'%' IDENTIFIED BY '$NEW'; ALTER USER 'root'@'localhost' IDENTIFIED BY '$NEW';"
radar_env_set MYSQL_ROOT_PASSWORD "$NEW" .env && unset NEW
ops/deploy.sh --no-pull
exit
```

`BACKUP_PASSPHRASE`: a new passphrase applies to the *next* backup; the one stored on
`db-backups` stays readable only with the old passphrase until it is replaced. Record the new
passphrase in the password manager **before** changing it (`radar_env_set BACKUP_PASSPHRASE
"$NEW" .env` as above), then `ops/deploy.sh --no-pull`. The next backup cannot read the stored
backup's encrypted metadata (`LATEST.meta.enc`, old passphrase), and the shrink guard therefore
**refuses** to replace it (critical alert, fails closed). Once you have checked that the stored
copy is really the one encrypted with the old passphrase, replace it on purpose:

```sh
sudo docker compose exec backup radar-backup-scheduler run-now backup --allow-shrink
```

Keep the old passphrase until that backup succeeded, then re-encrypt `.env`
(`ops/secrets.sh encrypt --force` asks for nothing: it reads the new passphrase from `.env`) and
commit it.

## 7. Moving to a real domain

1. Create a DNS `A` record for the new name (e.g. `radar.example.com`) pointing to the VPS IPv4.
   Wait until `dig +short radar.example.com` returns it.
2. `sudo /opt/radar/ops/install.sh --domain radar.example.com`
   - updates `DOMAIN` and `APP_URL` in `.env` (old file kept as `.env.bak-<time>`);
   - replaces the RADAR vhost with the bootstrap vhost for the new name, gets its certificate,
     installs the full vhost, rebuilds and restarts the stack.
3. Log in again (the session cookie belongs to the old host name).
4. Refresh the encrypted env: `sudo ops/secrets.sh encrypt --force`, commit.
5. Optional: remove the old certificate: `sudo certbot delete --cert-name radar.187-127-129-127.sslip.io`.

Going back is the same command with the old name.

## 8. Removing RADAR

```sh
cd /opt/radar
sudo systemctl disable --now radar-autodeploy.timer
sudo rm -f /etc/systemd/system/radar-autodeploy.{service,timer} && sudo systemctl daemon-reload
sudo docker compose down            # add -v ONLY to delete the database volume as well
sudo docker buildx rm radar-builder # RADAR's builder container and its build cache only
# the link older installs used, only if it is RADAR's
[ "$(readlink /etc/nginx/sites-enabled/radar)" = /etc/nginx/sites-available/radar ] && sudo rm /etc/nginx/sites-enabled/radar
sudo rm -f /etc/nginx/sites-enabled/zz-radar /etc/nginx/sites-available/radar && sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name <DOMAIN>
```
