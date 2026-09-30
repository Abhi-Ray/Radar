# RADAR — Recovery runbook

Written for the worst day: the server is gone, or something is broken, and you have to bring
RADAR back without remembering how it was built. Paths, ports and services are listed in
[DEPLOY.md](DEPLOY.md).

## 0. What you need (keep these OUTSIDE the VPS)

| Item | Where it lives | Needed for |
|---|---|---|
| **`BACKUP_PASSPHRASE`** | your password manager | decrypting every backup **and** `ops/secrets.env.enc`. Without it nothing can be restored. |
| GitHub access to `Abhi-Ray/Radar` | your GitHub account | adding the new deploy key, pushing fixes |
| The repo | `github.com/Abhi-Ray/Radar` (public) | code (`main`), encrypted env (`ops/secrets.env.enc`), encrypted dumps (branch `db-backups`) |
| SSH access to a VPS | your provider | everything |

What is where:

- **Code:** branch `main`.
- **Configuration:** `ops/secrets.env.enc` on `main` = the production `.env`, encrypted with
  `openssl enc -aes-256-cbc -pbkdf2 -iter 600000 -md sha256` and `BACKUP_PASSPHRASE`.
- **Data:** branch `db-backups` = ONE orphan commit with `radar-db.sql.gz.enc` (or
  `radar-db.sql.gz.enc.part-aaa`, `-aab`, … when > 45 MiB), `LATEST.json` (plain, only what
  fetching and verifying need: format, time, file names/parts, size, sha256, cipher) and
  `LATEST.meta.enc` (encrypted: database name, per-table row counts, last migration, run id —
  the repo is public). Replaced every night at 21:00 UTC. Same cipher and passphrase for all.
- **Not backed up, re-created on demand:** the backup deploy key, the TLS certificate, the nginx
  vhost, Docker images.

Health at a glance, on the VPS:

```sh
curl -s http://127.0.0.1:3100/api/health     # ok / db / lastRunAgeHours / version
cd /opt/radar && sudo docker compose ps
```

---

## (a) The VPS rebooted

Everything comes back on its own: `docker.service` is enabled, every container has
`restart: unless-stopped`, nginx is enabled, `radar-autodeploy.timer` starts 3 minutes after boot,
and the backup scheduler catches up a missed backup (last success > 25 h ago) 10 minutes after it
starts.

Check, 5 minutes after the reboot:

```sh
curl -s http://127.0.0.1:3100/api/health               # "ok":true
cd /opt/radar && sudo docker compose ps                  # 4 services Up; app (healthy)
systemctl is-active nginx docker radar-autodeploy.timer
sudo docker compose exec backup radar-backup-scheduler status
```

If something is not running: `cd /opt/radar && sudo docker compose up -d --no-build`. If `mysql` restarts
in a loop, go to (c). If the whole box is unreachable, go to (d).

## (b) A container is broken

1. Look:

   ```sh
   cd /opt/radar
   sudo docker compose ps -a
   sudo docker compose logs --tail=200 app          # or worker / mysql / backup
   journalctl -u radar-autodeploy -n 100 --no-pager  # did a deploy just happen?
   df -h / && sudo docker system df                 # disk full?
   free -m                                          # memory (no swap: OOM kills show in dmesg)
   ```

2. Restart just that service: `sudo docker compose restart app`.
3. Recreate it (fresh container, current image): `sudo docker compose up -d --no-build
   --force-recreate app`. To rebuild the image as well, run `sudo /opt/radar/ops/deploy.sh
   --no-pull`: it builds in RADAR's capped `radar-builder` ([DEPLOY.md §4.1](DEPLOY.md#41-builds-on-the-shared-swapless-vps)).
   Never `docker compose up --build` by hand: that builds in dockerd's unlimited default builder
   next to the other sites on this swapless box.
4. A bad commit? Auto-deploy already rolls back when the health check fails. To pin a known-good
   revision by hand:

   ```sh
   sudo systemctl stop radar-autodeploy.timer
   sudo /opt/radar/ops/deploy.sh --ref <good sha>
   # fix main, then: sudo systemctl start radar-autodeploy.timer
   ```

5. Specific cases:
   - **worker logs "waiting for migrations":** the app has not applied them yet: check `app` logs.
   - **app exits with `Invalid environment configuration`:** the listed keys are wrong in
     `.env` (values are never printed). Fix, then `sudo ops/deploy.sh --no-pull`.
   - **Disk full:** see what uses it: `sudo docker system df` (whole host) and
     `sudo docker buildx du --builder radar-builder` (RADAR's build cache). RADAR-only clean-up:
     - `sudo docker image prune -f --filter label=com.radar.project=radar` deletes RADAR's
       *dangling* images (untagged leftovers of earlier builds). Tagged and running images stay.
     - `sudo docker buildx prune --builder radar-builder -f` empties RADAR's own build cache (it
       lives in the `radar-builder` container). The next deploy then builds from scratch: slower,
       same memory cap. The other projects' caches are in dockerd's default builder and are not
       touched.

     Do **not** run `docker system prune`, `docker builder prune` or `docker image prune -a`:
     they act on every project on this host (the other sites' images and build caches, whatever
     the filter says about age). Check other projects with their owners before deleting anything
     else.
   - **nginx shows 502:** the app is down (steps above); nginx itself is fine if other sites work.
   - **Certificate expired:** `sudo certbot renew --cert-name <DOMAIN>`; if HTTP-01 fails, check
     that `/etc/nginx/sites-enabled/zz-radar` still exists (installs before that name used
     `sites-enabled/radar`; re-running `sudo ops/install.sh` switches it) and `sudo nginx -t`
     passes.

## (c) The database is corrupted (or data was destroyed)

Symptoms: `mysql` restarts in a loop with InnoDB errors, `/api/health` says `"db":"down"`, or
data is visibly wrong/missing.

1. Pause auto-deploy: `sudo systemctl stop radar-autodeploy.timer`.
2. **If MySQL still starts**, restore the latest backup over the live database. The restore takes
   an encrypted safety copy of the current database first (kept in the `radar_backup_work` volume
   under `pre-restore/`, newest two), verifies the backup's sha256 and decryption, drops and
   re-creates the database, imports, and compares every table's row count with the counts in
   the encrypted `LATEST.meta.enc`.

   Run stop → restore → start as ONE command under the deploy lock. While it is held no deploy
   can restart the app/worker against a half-imported database or recreate the backup container
   (auto-deploy skips, `ops/deploy.sh` and `ops/install.sh` wait). If the restore fails the
   chain stops there and app + worker stay stopped:

   ```sh
   cd /opt/radar
   sudo flock /var/lib/radar/deploy.lock sh -c \
     'docker compose stop app worker && docker compose run --rm backup radar-restore --yes-i-know && docker compose up -d --no-build'
   curl -s http://127.0.0.1:3100/api/health
   sudo systemctl start radar-autodeploy.timer
   ```

   Backup jobs (the scheduler's backup / restore test, this restore) also exclude each other
   with their own lock in the `radar_backup_work` volume. A lock left behind by a job container
   that died is taken over after 6 hours at the latest, or at once when its own scheduler
   restarts; temp dirs of dead jobs are deleted when they are older than 6 hours.

   An older copy: download it (`git clone --single-branch --branch db-backups
   https://github.com/Abhi-Ray/Radar.git /tmp/radar-backup` shows the latest only; older copies
   exist only as safety dumps) and pass `--file /path/to/folder` (the folder holds the dump,
   `LATEST.json` and `LATEST.meta.enc`).

3. **If MySQL no longer starts**, keep the broken files and start from an empty volume:

   ```sh
   cd /opt/radar
   sudo docker compose down                       # NOT -v
   sudo mkdir -p /root/radar-mysql-broken
   sudo docker run --rm -v radar_mysql:/from:ro -v /root/radar-mysql-broken:/to \
     --entrypoint cp mysql:8.4 -a /from/. /to/    # raw copy, for forensics
   sudo docker volume rm radar_mysql
   sudo /opt/radar/ops/install.sh --restore       # new empty DB + restore + start (type RESTORE); holds the deploy lock itself
   sudo systemctl start radar-autodeploy.timer
   ```

4. Verify (see the final checklist), then delete `/root/radar-mysql-broken` when you are sure.

## (d) The VPS is lost (new server from scratch)

The new server gets a new IP address, so the sslip.io name changes too:
`radar.<new-ip-with-dashes>.sslip.io` (e.g. `203.0.113.7` → `radar.203-0-113-7.sslip.io`).
sslip.io needs no DNS setup: the name resolves to the IP inside it.

1. Create an Ubuntu 24.04 VPS (≥ 4 GB RAM). Harden it as usual (key-only SSH, firewall allowing
   22/80/443, unattended upgrades).
2. As root:

   ```sh
   apt-get update && apt-get install -y git
   git clone --single-branch --branch main https://github.com/Abhi-Ray/Radar.git /opt/radar
   cd /opt/radar
   read -rsp 'BACKUP_PASSPHRASE: ' BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE && echo
   ops/secrets.sh check                  # lists the key names; proves the passphrase is right
   ops/secrets.sh decrypt                # ops/secrets.env.enc → .env (mode 600)
   unset BACKUP_PASSPHRASE
   sed -i '/^SAFE_FETCH_DENY_IPS=/d' .env  # the old server's IPs; the installer writes this one's
   ops/install.sh --fresh-box --restore --domain auto
   ```

   `--fresh-box` installs Docker/compose/buildx, nginx, certbot, curl and openssl if missing.
   `--domain auto` computes `radar.<new-ip-with-dashes>.sslip.io` and updates `DOMAIN` and
   `APP_URL` in `.env`. `--restore` loads the latest backup from `db-backups` (the repo is
   public, so this works before any key exists) before the app starts, instead of seeding.
3. The installer prints a **new backup deploy key**. Add it with write access (e), or accept the
   installer's offer to run `gh repo deploy-key add --allow-write`. Delete the old server's key
   on GitHub (Settings → Deploy keys).
4. Store the updated `.env` (new DOMAIN) encrypted and push it:
   `ops/secrets.sh encrypt --force`, then commit `ops/secrets.env.enc` (from your laptop if
   the VPS cannot push to `main`).
5. Log in at `https://radar.<new-ip-with-dashes>.sslip.io` and run the final checklist.

Real domain instead of sslip.io: point its `A` record at the new IP first and use
`--domain radar.example.com` ([DEPLOY.md §7](DEPLOY.md#7-moving-to-a-real-domain)).

No `ops/secrets.env.enc` (or the passphrase is lost)? Then the old secrets are gone, and so is
the data (the dumps use the same passphrase). Start fresh: `ops/secrets.sh init --domain … --email …`,
then `ops/install.sh --fresh-box --domain auto` (seeds reference data; no `--restore`).

## (e) Backup deploy key lost or leaked

The key only lets the backup container push `db-backups`; restores do not need it.

```sh
cd /opt/radar
sudo mv secrets/backup_deploy_key secrets/backup_deploy_key.old-$(date -u +%Y%m%d)
sudo mv secrets/backup_deploy_key.pub secrets/backup_deploy_key.pub.old-$(date -u +%Y%m%d)
sudo ops/install.sh            # generates a new key, prints it, offers `gh repo deploy-key add --allow-write`
```

On GitHub: Abhi-Ray/Radar → Settings → Deploy keys → delete the old key, and add the new public
key with **Allow write access** if the installer did not. Then prove it:

```sh
sudo docker compose restart backup     # re-reads the key file
sudo docker compose exec backup radar-backup-scheduler run-now backup
```

Delete the `.old-*` files once the backup succeeded. A leaked key could have overwritten the
`db-backups` branch: after rotating, check that `LATEST.json` on GitHub looks like tonight's
backup (`createdAt`) and that `sudo docker compose exec backup radar-backup-scheduler run-now
restore-test` passes (it decrypts `LATEST.meta.enc` and compares every table).

## (f) OpenRouter key rotated

1. Create the new key on openrouter.ai; revoke the old one.
2. `sudo nano /opt/radar/.env` → `OPENROUTER_API_KEY=<new key>`.
3. `sudo /opt/radar/ops/deploy.sh --no-pull` (recreates app + worker with the new env).
4. `sudo ops/secrets.sh encrypt --force` and commit `ops/secrets.env.enc`.
5. Check `/system` → AI usage after the next AI queue run. RADAR works without AI in the meantime
   (rules only); a failing key never stops the pipeline.

## (g) Monthly manual restore test (spec §21 and §25)

The backup container runs an automatic restore test on day 1 of each month (22:00 UTC) and alerts
on failure. Once a month, also do it by hand, **as if the server were gone**, from your laptop.
This proves the passphrase in your password manager and the off-site copy both work.

```sh
# 1. Fetch the latest backup (public repo, no key needed)
git clone --quiet --depth 1 --single-branch --branch db-backups https://github.com/Abhi-Ray/Radar.git /tmp/radar-bk
cd /tmp/radar-bk && cat LATEST.json            # createdAt should be < 24 h old

# 2. Verify integrity: prints the sha256 to compare with LATEST.json's "sha256"
cat $(ls radar-db.sql.gz.enc* | sort) | shasum -a 256

# 3. Decrypt + decompress (passphrase from the password manager, never on the command line),
#    and decrypt the metadata (row counts, last migration; its "sha256" equals LATEST.json's)
read -rsp 'BACKUP_PASSPHRASE: ' BACKUP_PASSPHRASE && export BACKUP_PASSPHRASE && echo
cat $(ls radar-db.sql.gz.enc* | sort) |
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE |
  gunzip > /tmp/radar-restore.sql
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE \
  -in LATEST.meta.enc > /tmp/radar-meta.json && cat /tmp/radar-meta.json
unset BACKUP_PASSPHRASE
tail -n 1 /tmp/radar-restore.sql                 # "-- Dump completed on …"

# 4. Load it into a throw-away MySQL 8.4 and look at real rows
docker run -d --name radar-restore-check -e MYSQL_ROOT_PASSWORD=check -e MYSQL_DATABASE=radar mysql:8.4
sleep 30
docker exec -i radar-restore-check sh -c 'MYSQL_PWD=check mysql -uroot radar' < /tmp/radar-restore.sql
docker exec radar-restore-check sh -c 'MYSQL_PWD=check mysql -uroot radar -e "SELECT COUNT(*) FROM jobs; SELECT COUNT(*) FROM applications; SELECT MAX(at) FROM audit_log;"'
#    compare with "rowCounts" in /tmp/radar-meta.json

# 5. Clean up (the dump holds personal data)
docker rm -f radar-restore-check && rm -rf /tmp/radar-bk /tmp/radar-restore.sql /tmp/radar-meta.json
```

No Docker on the laptop? Run step 4 on the VPS instead:
`sudo docker compose exec backup radar-backup-scheduler run-now restore-test` restores into the
separate `radar_restore_test` database and compares every table. Record the date of the manual
test in your notes; the automatic results are listed on `/system` (backups).

Also check once a month: `ops/secrets.sh check` with the passphrase from the password manager
(proves the encrypted `.env` is current and readable).

---

## Final checklist (after any recovery)

- [ ] `curl -s http://127.0.0.1:3100/api/health` → `"ok":true`, `"db":"up"`, `"version"` = the commit on `main`
- [ ] `https://<DOMAIN>` loads with a valid certificate; `http://<DOMAIN>` redirects to https
- [ ] Log in works; the jobs list and your applications look complete (compare counts with `rowCounts` in the decrypted `LATEST.meta.enc`, see (g) step 3)
- [ ] `sudo docker compose ps` → app (healthy), worker, mysql (healthy), backup all Up
- [ ] `systemctl list-timers radar-autodeploy.timer` shows the next run; `certbot.timer` is active
- [ ] The backup deploy key works: `sudo docker compose exec backup radar-backup-scheduler run-now backup` succeeds and `db-backups` on GitHub shows a new commit
- [ ] `/system` → alerts: the recovery's own alerts acknowledged; no new criticals
- [ ] The next pipeline run happened (`lastRunAgeHours` < 24 the next day)
- [ ] `ops/secrets.env.enc` re-encrypted and committed if `.env` changed (new DOMAIN, rotated keys)
- [ ] Old server's deploy key removed on GitHub; old passwords/keys that may have leaked rotated
- [ ] Other sites on the VPS still work (`sudo nginx -t`; spot-check their URLs)
