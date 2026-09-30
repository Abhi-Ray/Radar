# RADAR — Operations runbook

The day-to-day knowledge for whoever runs the server. Install, secrets and nginx are in
[DEPLOY.md](DEPLOY.md); disasters are in [RECOVERY.md](RECOVERY.md); using the site is in
[USER_GUIDE.md](USER_GUIDE.md); *why* things are the way they are is in [DECISIONS.md](DECISIONS.md).

## 1. Where things live

| What | Where |
|---|---|
| The site | `https://radar.187-127-129-127.sslip.io` (nginx vhost `radar` → `127.0.0.1:3100`) |
| The server | VPS `187.127.129.127`, code in `/opt/radar` (a clone of `main`), shared with other projects |
| Containers | compose project `radar`: `app` (900 MB), `worker` (700 MB), `mysql` (800 MB), `backup` (512 MB) |
| GitHub | `Abhi-Ray/Radar`: branch `main` (code), branch `db-backups` (encrypted daily dump), deploy key `radar-vps-backup` (write) |
| Production env | `/opt/radar/.env` (mode 600) · your laptop `secrets/prod.env` (gitignored) · `ops/secrets.env.enc` in the repo (encrypted with `BACKUP_PASSPHRASE`) |
| Timers | `radar-autodeploy.timer` (every 5 min) · Ubuntu's `certbot.timer` |

Log in to the server as root (password in your password manager — never in the repo or a chat), then
`cd /opt/radar`. Everything below assumes that directory.

## 2. The daily rhythm (worker, UTC)

Defined in `src/worker/index.ts`. Overlapping runs are impossible (a database lock).

| Cron | Task | Notes |
|---|---|---|
| `30 0,12 * * *` | `pipeline:daily` | Crawls every non-paused source (35–40 min for 207 sources), then tidies the review queues, pings the health check, sends the digest |
| `* * * * *` | `pipeline:queued` | Executes runs queued from the UI (*Run now*, *Dry run*) within a minute |
| `15 * * * *` | `linkcheck` | 150 apply links per hour |
| `5 * * * *` | `heartbeat` | Alerts when no run finished within `heartbeatHours` |
| `30 1,13 * * *` | `ai-queue` | Works the AI queue best-fit first; the two batches share the day's budget after the manual reserve |
| `0 3 * * *` | `registers` | Imports the five sponsor registers **and** matches every company (`refreshRegistersAndEvidence`); jobs of companies whose evidence changed are re-evaluated |
| `0 4 * * *` | `official-pages` | Compares the 54 watched immigration pages with their stored copy |
| `0 5 * * *` | `retention` | Prunes raw snapshots older than the Settings value (14 days), old AI cache, dead letters, login attempts |
| `30 15 * * *` | `fx` | ECB exchange rates |

The `backup` container runs on its own clock: daily 21:00 encrypted dump; restore test on day 1 of
the month at 22:00.

## 3. Deploying without hurting a running crawl

- Push to `main` → within 5 minutes the timer builds in the capped builder `radar-builder`
  (about 1 minute with a warm cache), restarts `app` and `worker`, waits for `/api/health` to report
  the new commit and **rolls back by itself** if it does not. Watch it:
  `journalctl -u radar-autodeploy -n 40 --no-pager`.
- **Every deploy restarts the worker.** A crawl in progress is cut short (its run is saved as
  `partial`), and one-off containers started with `docker compose run` are removed as orphans.
  So push between crawls — not around 00:30–01:15 or 12:30–13:15 UTC — and never while a manual run
  from **System** is going. `System` shows whether a run is in progress.
- A build needs about 3.5 GiB of free memory (the box has no swap). If there is less, the deploy is
  *deferred* (one alert a day) and retried at the next tick.

## 4. Running things by hand

The pipeline CLI (`src/worker/cli.ts`) — run inside a one-off container:

```sh
docker compose run --rm --no-deps -T app cli --help
docker compose run --rm --no-deps -T app cli registers        # import registers + match companies
docker compose run --rm --no-deps -T app cli run              # full crawl now (kind: manual)
docker compose run --rm --no-deps -T app cli dry-run --source=12
docker compose run --rm --no-deps -T app cli reprocess --since=2026-09-30   # re-apply the current logic to stored raw pages
docker compose run --rm --no-deps -T app cli ai --max-calls=20
docker compose run --rm --no-deps -T app cli official-pages | fx | linkcheck | retention | digest --force | heartbeat
```

For anything longer than a minute, detach it so an SSH drop does not kill it, and read the journal:

```sh
systemd-run --unit=radar-job --collect --working-directory=/opt/radar \
  /usr/bin/docker compose run --rm --no-deps -T app cli registers
journalctl -u radar-job --no-pager | tail -40
```

Do not deploy while such a job runs (see §3). Backups and the restore test on demand:
`docker compose exec backup radar-backup-scheduler run-now backup` / `run-now restore-test`.

## 5. The database

```sh
docker compose exec mysql sh -c 'MYSQL_PWD=$MYSQL_PASSWORD mysql -u$MYSQL_USER $MYSQL_DATABASE'
```

- **Isolation level.** Every pooled connection runs at `READ COMMITTED` (`src/lib/db/index.ts`).
  The default `REPEATABLE READ` made concurrent writers deadlock on gap locks when saving the first
  facts of brand-new jobs (3.5% of the first crawl was dead-lettered). `tests/foundation/db.test.ts`
  replays the collision.
- **Size.** After one full crawl about 830 MB (job text and raw pages); the encrypted daily dump is
  about 80 MB. Raw pages are kept 14 days (Settings → Retention). If dumps grow uncomfortably,
  exclude `raw_snapshots` in `ops/backup/backup.sh` — it can be rebuilt by crawling again.
- **Never edit rows by hand** for anything the app has a screen for: the screens write the audit trail.

## 6. When something is wrong

| Symptom | Look | Do |
|---|---|---|
| Site down or 502 | `docker compose ps`; `journalctl -u radar-autodeploy -n 40` | usually a deploy in progress (give it 2 min); else RECOVERY.md (a)/(b) |
| No run today | System → Runs; `docker compose logs worker --tail 100` | `cli run` by hand; the heartbeat alert fires after `heartbeatHours` |
| A source keeps failing | Sources → the source → run history | fix its config, *Dry run*, *Reset the breaker* |
| "Failed items" on System | System → Failed items | retried by the next run; a posting that vanished at its source never resolves and is pruned by retention |
| Backup alert | System → Backups; `docker compose logs backup --tail 60` | `run-now backup`; check the deploy key on GitHub (RECOVERY.md (e)) |
| Deploy deferred (low memory) | alert `deploy_deferred` | wait, or stop something heavy on the box; it retries every 5 min |
| Disk filling | `df -h /`; `docker system df`; `docker buildx du --builder radar-builder` | RADAR's own builder cache is pruned by the deploy script; Docker's *default* builder cache is shared with other projects — do not prune it blindly |
| Everything "visa unknown" | System → last `registers` result; Companies → a company's evidence | `cli registers` |

## 7. Limits worth knowing

- **AI:** OpenRouter free model, 50 calls a day (Settings can only lower it), 5 kept for *Ask AI* on the job page.
- **Register matching:** weak (fuzzy-name) matches are stored as *possible* and count as *Likely · low* —
  they never make a job *Confirmed*. Only an official licensed-sponsor entry in the job's own country does.
- **One shared VPS:** 2 CPUs, no swap. The build is capped at 3 GiB / 1 CPU; the crawl uses about one core.
- **The repo is public** by design of the current setup (see DECISIONS.md #2). Nothing secret is in it,
  but making it private is recommended; then switch `/opt/radar` to the deploy-key SSH remote.
