# RADAR

A single-user, login-walled job-hunting engine. RADAR collects jobs every day from 40+ countries
and remote boards, normalises them, attaches **provenance to every fact** (value · evidence ·
source · method · confidence · checked at · logic version), decides visa sponsorship
conservatively, scores fit, and tracks applications.

- Product rules: [docs/SPEC.md](docs/SPEC.md)
- Build contracts, file ownership, design language: [docs/BUILD_BRIEF.md](docs/BUILD_BRIEF.md)
- Architecture, data flow, trust order, visa decision, schedules: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Running it on the VPS: [docs/DEPLOY.md](docs/DEPLOY.md)
- When something breaks, or the server is gone: [docs/RECOVERY.md](docs/RECOVERY.md)
- Every environment key, documented, without values: [.env.example](.env.example)

This repository is **public**. It never contains secrets or personal data: the production `.env`
lives only on the server (and encrypted in `ops/secrets.env.enc`), and database backups on the
`db-backups` branch are encrypted with a passphrase that is not in the repository.

## Features

What the product is built to do (the rules behind each one are in [docs/SPEC.md](docs/SPEC.md)):

- **Daily collection with isolation.** Graded sources (A–D) from a registry; every connector has
  its own rate limit, timeout, retries and circuit breaker, so one failing source never stops the
  run. Raw responses are stored before parsing, so rule changes re-process saved data.
- **Provenance on every fact.** Each displayed value carries its evidence, source, method,
  confidence, check time and logic version; a fixed trust order (manual > official > posting >
  rule > AI > estimate) decides which value wins.
- **Conservative visa decisions.** Confirmed · Likely · Conflicting · Not offered · Unknown,
  driven by official sponsor registers and explicit statements; AI can never produce
  *Confirmed*. An "Am I eligible?" check against dated country rules.
- **Remote eligibility, normalisation and dedup.** Place, title, experience, salary (with FX) and
  language normalisation; cross-source dedup with company identity and manual merge/split.
- **Explainable, versioned Fit Score** with the factors shown next to the number.
- **Budgeted AI layer** (OpenRouter free tier): quotes must exist in the posting text, results
  are cached and never overwrite official records.
- **Application tracker.** Append-only timeline, snapshot of the posting at apply time, export.
- **Observability.** Run reports per pipeline and source, a heartbeat, a review queue and alerts
  (in-app, Telegram, e-mail) for failed runs, stale data and failed backups.
- **Operations.** One-command install on a shared VPS, 5-minute auto-deploy with health-checked
  rollback, nightly encrypted off-site backups and a monthly automatic restore test.

## Stack

Next.js 16 (App Router, standalone output) · React 19 · TypeScript strict · Tailwind CSS v4 ·
MySQL 8.4 + Drizzle ORM · zod v4 · croner · esbuild · vitest. Production: Docker Compose
(`app`, `worker`, `mysql`, `backup`) behind the host's nginx with a Let's Encrypt certificate.

## Local development

Requirements: Node 22, npm. No Docker needed: the dev database is a local MySQL 8.4 started from
the binary cached by `mysql-memory-server`.

```sh
npm ci
cp .env.example .env.local        # then set DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, SESSION_SECRET, APP_URL
npx tsx scripts/hash-password.ts  # prints ADMIN_PASSWORD_HASH for .env.local (prompts, no echo)
npm run db:dev                    # MySQL on 127.0.0.1:3399 (or DEV_DB_PORT / the port in DATABASE_URL); applies migrations
npm run db:seed                   # reference data: countries, visa rules, sources, companies
npm run dev                       # http://localhost:3000
npm run worker                    # all schedules, in the foreground
npm run pipeline                  # one-off pipeline runs (src/worker/cli.ts: dry run, single source, reprocess)
```

`.env.local` for development needs only `DATABASE_URL` (e.g. `mysql://root@127.0.0.1:3399/radar`),
`ADMIN_EMAIL`, `ADMIN_PASSWORD_HASH`, `SESSION_SECRET` (≥ 32 characters) and `APP_URL`
(`http://localhost:3000`). Everything else has a default or is optional; AI stays off unless
`AI_ENABLED=true` and `OPENROUTER_API_KEY` are set.

## Checks

```sh
npm run lint
npm run typecheck        # tsc --noEmit
npm test                 # vitest; DB tests start their own throw-away MySQL (or use TEST_DATABASE_URL)
npm run build            # Next.js standalone build
npm run build:worker     # esbuild bundles in dist/: worker, cli, migrate, seed, eval, …
npm run eval             # accuracy evaluation against the golden sample
```

CI (`.github/workflows/ci.yml`) runs all of these on every push to `main` and every pull request,
plus a Docker image build with smoke tests and a gitleaks secret scan.

## Layout

| Path | What |
|---|---|
| `src/app/` | pages and route handlers; `(app)/` is behind the login, `/api/health` is public |
| `src/lib/` | domain logic: `pipeline`, `connectors`, `normalize`, `dedup`, `company`, `visa`, `remote`, `scoring`, `ai`, `accuracy`, `tracker`, `provenance`, `auth`, `security`, … |
| `src/worker/` | the scheduler process and the pipeline CLI |
| `src/db/` | Drizzle schema, migrator, seed; `drizzle/` holds the generated SQL migrations |
| `src/data/` | curated reference data (places, titles, salaries, visa rules, remote rules, seed lists) |
| `tests/` | vitest suites per area; `tests/helpers/db.ts` gives each suite an isolated MySQL |
| `scripts/` | dev database, password hashing, worker bundling, seeding |
| `ops/` | installer, deploy + auto-deploy, secrets, nginx and systemd templates, backup image |
| `Dockerfile`, `docker-compose.yml` | production image (app + worker) and the `radar` compose project |

## Operations in one minute

- One VPS, shared with other projects. RADAR is the compose project `radar` in `/opt/radar`,
  published only on `127.0.0.1:3100`; one nginx vhost (`/etc/nginx/sites-available/radar`,
  enabled as `sites-enabled/zz-radar`) serves `https://radar.187-127-129-127.sslip.io`. Images
  are built in RADAR's own capped buildx builder (`radar-builder`: 3 GiB, no swap, 1 CPU).
- `sudo ops/install.sh` installs or repairs everything and is safe to re-run.
- Pushing to `main` deploys within ~5 minutes (`radar-autodeploy.timer`); a revision that fails
  its health check is rolled back automatically and raises a critical alert.
- Every night at 21:00 UTC the `backup` container force-pushes an encrypted dump to `db-backups`;
  on day 1 of each month it restores that dump into a scratch database and compares every table.
- `GET /api/health` → `{"ok":true,"db":"up"}` from the internet; the full
  `{"ok":true,"db":"up","lastRunAgeHours":…,"version":"<commit>"}` only for loopback probes on the
  VPS (no `X-Real-IP`). Nothing else is public.

## Security

- The whole site requires a session except `/login`, `/api/auth/login`, `/api/health` and static
  assets. Single account, scrypt password hash, 1-year HttpOnly session cookie checked against the
  `sessions` table, per-IP login lockout plus an nginx rate limit.
- Posting HTML is untrusted and sanitised before display; server-side fetches of data-driven URLs
  go through an SSRF guard (public addresses only).
- Environment variables are parsed in one place (`src/lib/env.ts`, zod). Each container receives
  only the secrets it needs.
- Anyone who can push to `main` controls the server: protect `main` on GitHub (pull requests
  required, no force pushes). Report security issues privately to the repository owner.
