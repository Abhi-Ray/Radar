# RADAR — what is live, and what is left

Updated 2026-09-30, after the budget pause. The first version of this file listed the security fixes and
six unfinished screens as "parked"; both are now done.

## Live

- URL: https://radar.187-127-129-127.sslip.io (Let's Encrypt certificate, renewed by certbot).
- Login: `ADMIN_EMAIL` + the password whose scrypt hash is `ADMIN_PASSWORD_HASH`; cookie `radar_session`
  lasts 1 year (HttpOnly, Secure, SameSite=Lax). A signed-out or revoked session stops working at once
  (the proxy checks the session row in the database, cached for at most 5 s). Change the password: `docs/DEPLOY.md` §6.
- Stack on the VPS: docker compose project `radar` in `/opt/radar` (app, worker, mysql, backup),
  app bound to `127.0.0.1:3100`, one nginx vhost. Nothing else on the box was touched.
- Screens: Desk, Jobs (+ detail), Tracker (+ detail), Companies, Countries, Kit, **Review, Sources
  (+ detail), Accuracy, System, Settings** — no placeholder is left.
- Deploys: pushing to `main` is picked up by `radar-autodeploy.timer` (every 5 min) and builds in RADAR's own
  memory-capped buildx builder (`radar-builder`, 3 GiB, 1 CPU); `ops/deploy.sh` does it by hand.
  **A deploy restarts app and worker, so it cuts a running pipeline run short — push between runs.**
- Backups: 21:00 UTC daily, encrypted, force-pushed to the `db-backups` branch (yesterday's file is
  overwritten). Restore steps: `docs/RECOVERY.md`. The env is in `ops/secrets.env.enc`
  (decrypt with `ops/secrets.sh decrypt`; the key is `BACKUP_PASSPHRASE`).

## Things learned in production (worth knowing)

- **Deadlocks on `job_facts`.** With MySQL's default REPEATABLE READ, concurrent writers deadlocked on gap
  locks when saving the first facts of brand-new jobs; 682 of the first run's 19,616 jobs went to
  `dead_letters`. Every pooled connection now runs at READ COMMITTED (`src/lib/db/index.ts`), and
  `tests/foundation/db.test.ts` replays the collision. The failed items were re-collected by run #4 (1,103 new jobs, 0 failures to save; 680 of 682 recovered — the
  other 2 are postings that no longer exist at their source).
- **Database size.** After one full crawl the database is ~830 MB (job text and raw snapshots); the
  encrypted daily dump is ~80 MB. Raw snapshots are now kept 14 days (Settings → Retention; default was 90).
  If dumps keep growing, exclude `raw_snapshots` from `ops/backup/backup.sh` (it can be rebuilt by re-crawling).
- The first crawl found 207 sources fine, but everything starts in `trial`; promote sources to `live`
  from the Sources screen once their checklist is complete.

## Still to do (in this order)

1. **Independent audits** of what was built after the first review: the tracker screens, the six ops
   screens, the seed data and the AI/accuracy step. All were exercised by hand and by the 3,881 tests, but no
   separate reviewer has read them. Include a second security review of the new server actions.
2. **Automated browser tests** for the new screens (Playwright): sign-in, a review decision, a settings
   save, the weekly spot-check. Today only the underlying logic has unit/integration tests.
3. **Repeat the restore test** (`docs/RECOVERY.md`) monthly — the scheduler does it on its own. The first one
   passed on 2026-09-30: last night's backup restored into a scratch database and all 46 tables matched.
4. **Label golden samples** (yours): the weekly spot-check on Accuracy fills the golden sample; 30 labelled
   jobs make the accuracy numbers meaningful.
5. Write your profile on Settings (roles, countries, salary floor) — the defaults are a starting point.

## Owner tasks (outside the code)

- Rotate the VPS root password and the OpenRouter key: both were pasted into a chat. Prefer key-only SSH.
- Make the GitHub repo private. Then point `/opt/radar` at the deploy key (SSH remote) so the autodeploy
  timer keeps working, because it currently pulls over public HTTPS.
- Optional: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` or `SMTP_URL` in `/opt/radar/.env` for alerts and the
  morning digest, then `sudo /opt/radar/ops/deploy.sh --no-pull`; re-encrypt with `ops/secrets.sh encrypt --force`.
- Optional: a real domain (`docs/DEPLOY.md` §7).
