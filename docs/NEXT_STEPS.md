# RADAR — what is live, and what is parked

Written 2026-09-30, when the build budget ran out and the priority became "make it and deploy it".

## Live

- URL: https://radar.187-127-129-127.sslip.io (Let's Encrypt certificate, renewed by certbot).
- Login: `ADMIN_EMAIL` + the password whose scrypt hash is `ADMIN_PASSWORD_HASH`; cookie `radar_session`
  lasts 1 year (HttpOnly, Secure, SameSite=Lax). Change the password: see `docs/DEPLOY.md` §6.
- Stack on the VPS: docker compose project `radar` in `/opt/radar` (app, worker, mysql, backup),
  app bound to `127.0.0.1:3100`, one nginx vhost. Nothing else on the box was touched.
- Deploys: pushing to `main` is picked up by `radar-autodeploy.timer`; `ops/deploy.sh` does it by hand.
- Backups: 21:00 UTC daily, encrypted, force-pushed to the `db-backups` branch (yesterday's file is
  overwritten). Restore steps: `docs/RECOVERY.md`. The env is in `ops/secrets.env.enc`
  (decrypt with `ops/secrets.sh decrypt`; the key is `BACKUP_PASSPHRASE`).

## Parked for later (in this order)

1. **Security fixes.** Branch `security-fixes-wip` holds a partial, untested set of fixes from the first
   security review (0 critical/high): DB-backed session check in the proxy, stricter `next=` handling,
   per-IP login serialisation, trimmed `/api/health`, SSRF port allow-list, build-memory cap on the VPS,
   backup hardening. Review it, finish it, run the tests, merge it. Then run a second review.
2. **Audits that did not finish.** The adversarial audit passes for the tracker UI, ops UI, seed data and
   AI/accuracy steps were stopped. Their code is merged and the test suite is green (3,798 tests), but it
   has had only the builder's own tests, not an independent audit.
3. **Integration checks.** Not run: the full end-to-end browser run and the visual pass over every page at
   phone width. Known cosmetic issue: the "RUNNING" tile on the phone desk slightly overflows its card.
4. **Label golden samples** on `/accuracy` (0 of 30) and write your profile on `/settings`; the desk's
   setup card lists what is missing.

## Owner tasks (outside the code)

- Rotate the VPS root password and the OpenRouter key: both were pasted into a chat. Prefer key-only SSH.
- Make the GitHub repo private. Then point `/opt/radar` at the deploy key (SSH remote) so the autodeploy
  timer keeps working, because it currently pulls over public HTTPS.
- Optional: `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` or `SMTP_URL` in `/opt/radar/.env` for alerts and the
  morning digest, then `sudo /opt/radar/ops/deploy.sh --no-pull`; re-encrypt with `ops/secrets.sh encrypt --force`.
- Optional: a real domain (`docs/DEPLOY.md` §7).
