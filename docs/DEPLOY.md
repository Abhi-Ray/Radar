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
| VPS | Ubuntu 24.04, UTC, nginx 1.24, Docker + compose v2, certbot 2.9, no swap, 7.8 GB RAM |
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
| `/var/lib/radar/nginx-radar.prev` | previous RADAR vhost, used for rollback | `ops/install.sh` |
| `/var/www/radar-acme/` | webroot for Let's Encrypt HTTP-01 challenges | `ops/install.sh` |
| `/etc/nginx/sites-available/radar` | the **only** RADAR nginx file (rendered from `ops/nginx/radar.conf.template`) | `ops/install.sh` |
| `/etc/nginx/sites-enabled/radar` | symlink to the file above | `ops/install.sh` |
| `/etc/letsencrypt/live/<DOMAIN>/` | certificate + key | `certbot certonly --webroot` |
| `/etc/letsencrypt/renewal/<DOMAIN>.conf` | renewal settings incl. the deploy hook `nginx -t && systemctl reload nginx` | certbot |
| `/etc/systemd/system/radar-autodeploy.service` / `.timer` | auto-deploy (rendered from `ops/systemd/`) | `ops/install.sh` |
| `/var/log/nginx/radar.access.log`, `radar.error.log` | nginx logs for the RADAR vhost (rotated by the distro's logrotate) | nginx |

Docker objects (all prefixed so they cannot collide with other projects):

| Object | Name |
|---|---|
| Images | `radar-app:latest` (app + worker), `radar-backup:latest`; label `com.radar.project=radar` |
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
capabilities dropped. The app and worker never receive `MYSQL_ROOT_PASSWORD` or
`BACKUP_PASSPHRASE`; the backup container never receives the session secret, the password hash or
the OpenRouter key.

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
- Backups: `BACKUP_PASSPHRASE`, `BACKUP_REPO`, `BACKUP_BRANCH`, `BACKUP_HOUR_UTC`,
  `BACKUP_MINUTE_UTC`, `RESTORE_TEST_DAY`, `RESTORE_TEST_HOUR_UTC`, `RESTORE_TEST_MINUTE_UTC`,
  `RESTORE_TEST_MAX_BACKUP_AGE_HOURS`, `RESTORE_TEST_DB`, `BACKUP_SHRINK_GUARD_PCT`,
  `BACKUP_PART_SIZE`, `BACKUP_MAX_SIZE`, `BACKUP_STARTUP_DELAY_SEC`, `BACKUP_RETRY_DELAY_SEC`,
  `BACKUP_GIT_NAME`, `BACKUP_GIT_EMAIL`, `BACKUP_DB_USER`, `BACKUP_DB_PASSWORD`

Set by the image or compose, never in `.env`: `NODE_ENV`, `MIGRATIONS_DIR`, `GIT_SHA` (the
deployed commit, shown by `/api/health`), `NODE_OPTIONS`.

## 2. nginx and TLS

- One vhost, `/etc/nginx/sites-available/radar`, for `server_name <DOMAIN>` only:
  - `:80` serves `/.well-known/acme-challenge/` from `/var/www/radar-acme` and 301-redirects
    everything else to `https://<DOMAIN>`.
  - `:443` terminates TLS (TLS 1.2/1.3, ECDHE AEAD ciphers, HSTS 1 year) and proxies to
    `127.0.0.1:3100` with `Host`, `X-Real-IP`, `X-Forwarded-For/-Proto/-Host` and WebSocket
    upgrade headers. `client_max_body_size 5m`; gzip for text types.
  - `limit_req` zone `radar_login` (12 requests/min per IP, burst 20) on `/login` and
    `/api/auth/login`, answering `429`. The app adds its own per-IP lockout in the database.
  - Every http-level name is prefixed `radar_` (`radar_login`, `radar_app`,
    `radar_connection_upgrade`, `radar_tls`) so nothing clashes with the other sites.
- **HTTP/2.** nginx 1.24 turns `listen 443 ssl http2` on for *every* site sharing the `:443`
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
4. creates the backup deploy key, prints the public key, and offers
   `gh repo deploy-key add … --allow-write` (or add it by hand: GitHub → Settings → Deploy keys →
   *Allow write access*). It checks the key with a dry-run push;
5. bootstrap vhost → `nginx -t` → reload → `certbot certonly --webroot` → full vhost;
6. asks for the login password if `ADMIN_PASSWORD_HASH` is empty (hashed inside the app image);
7. `docker compose build`, `up -d`, waits for `/api/health` to report the new commit;
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
  `origin/main` moved, runs `git reset --hard origin/main`, `docker compose up -d --build`,
  waits up to 5 minutes for `/api/health` to report the new commit, and prunes RADAR's dangling
  images (label filter: other projects' images are never touched).
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
| `MYSQL_ROOT_PASSWORD` | same procedure with `'root'@'%'` and `'root'@'localhost'` |
| `BACKUP_PASSPHRASE` | see below |
| Backup deploy key | [RECOVERY.md (e)](RECOVERY.md#e-backup-deploy-key-lost-or-leaked) |

`MYSQL_PASSWORD` (the application user):

```sh
cd /opt/radar
NEW=$(openssl rand -hex 24)
sudo docker compose exec -T mysql sh -c 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot' \
  <<<"ALTER USER '$(grep -E '^MYSQL_USER=' .env | cut -d= -f2 | sed 's/^$/radar/')'@'%' IDENTIFIED BY '$NEW';"
sudo sed -i "s/^MYSQL_PASSWORD=.*/MYSQL_PASSWORD=$NEW/" .env && unset NEW
sudo ops/deploy.sh --no-pull
```

`BACKUP_PASSPHRASE`: a new passphrase applies to the *next* backup; the one stored on
`db-backups` stays readable only with the old passphrase until it is replaced. Keep the old
passphrase until the next successful backup (`radar-backup-scheduler run-now backup`), then
re-encrypt `.env` (`ops/secrets.sh encrypt --force` asks for nothing: it reads the new
passphrase from `.env`) and commit it. Record the new passphrase in the password manager
**before** changing it.

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
sudo rm -f /etc/nginx/sites-enabled/radar /etc/nginx/sites-available/radar && sudo nginx -t && sudo systemctl reload nginx
sudo certbot delete --cert-name <DOMAIN>
```
