# RADAR — Build Brief (shared contract for every builder)

> Product spec (source of truth for WHAT to build): `docs/SPEC.md`. Read the sections relevant to your area.
> This brief defines HOW: stack, architecture, contracts, file ownership, conventions, design language.
> If the brief and the spec disagree on a feature, the spec wins. If they disagree on structure/contracts, the brief wins.

## 0. Product in one line
A single-user, login-walled job-hunting engine for Abhishek Ray: collects jobs daily from 40+ countries + remote,
normalises them, attaches **provenance to every fact**, decides visa-sponsorship status conservatively, scores fit,
and tracks applications. Name: **RADAR**. Repo: github.com/Abhi-Ray/Radar (PUBLIC — never commit secrets or personal data).

## 1. Stack (fixed — do not change)
- **Next.js 16.3.6** App Router, React 19.2, TypeScript strict. This is NOT the Next.js in your training data:
  read `node_modules/next/dist/docs/` for anything you are unsure about (routing, proxy, caching, server actions,
  `cookies()`/`headers()` are async, `params`/`searchParams` are Promises, etc.). **`middleware.ts` is replaced by
  `src/proxy.ts`** in Next 16 — check the docs.
- **Tailwind CSS v4** (CSS-first config via `@theme` in `src/app/globals.css`; no tailwind.config.js).
- **MySQL 8.4** via **Drizzle ORM** (`drizzle-orm/mysql2`) + `drizzle-kit`. Schema files: `src/db/schema/*.ts`.
- Validation: **zod v4**. Dates: `date-fns` v4 + `@date-fns/tz`. Scheduling in worker: `croner`.
  HTML sanitising: `sanitize-html`; HTML→text: `html-to-text`. XML/RSS: `fast-xml-parser`. CSV: `csv-parse`.
  Language detection: `franc-min`. JWT: `jose`. Class merging: `clsx`. Tests: `vitest`. Worker bundle: `esbuild`.
- `nodemailer` is installed for optional SMTP alerts.
- **All dependencies are already installed. Do NOT run `npm install`/`npm i` or edit package.json dependencies.**
  If you truly need a new package, implement without it and list it under "NEEDS_DEPENDENCY" in your final report.
  You MAY add npm *scripts* only if your ownership section says so.
- Node 22 in production (Docker `node:22-bookworm-slim`). Production domain: `https://radar.187-127-129-127.sslip.io`.

## 2. Runtime architecture (Docker Compose project `radar`, fully separate from anything else on the VPS)
| Service | What | Notes |
|---|---|---|
| `app` | Next.js standalone server (`node server.js`) | published ONLY on `127.0.0.1:3100`; host nginx vhost proxies the domain to it |
| `worker` | Same image, runs `node dist/worker.mjs` (bundled from `src/worker/index.ts` with esbuild) | all scheduled jobs (pipeline, link checks, FX, registers, heartbeat, digest, AI queue, retention) |
| `mysql` | `mysql:8.4` | no published port; named volume `radar_mysql` |
| `backup` | image built from `ops/backup/Dockerfile` (FROM mysql:8.4 + git/openssh/openssl) | daily encrypted dump force-pushed to branch `db-backups` of the repo; monthly restore test |

- Migrations: `drizzle-kit generate` produces SQL in `drizzle/`; they are applied on container start by
  `src/db/migrate.ts` (bundled to `dist/migrate.mjs`), run by the app entrypoint before `server.js`.
- Timezone: all DB timestamps stored in **UTC** (`DATETIME(3)`/`TIMESTAMP` as UTC). Display & reminders use `APP_TZ=Asia/Kolkata`.
  Helpers in `src/lib/time.ts`.
- Env is parsed once in `src/lib/env.ts` (zod). Never read `process.env` elsewhere. Keys:
  `DATABASE_URL, ADMIN_EMAIL, ADMIN_PASSWORD_HASH, SESSION_SECRET, APP_URL, APP_TZ, OPENROUTER_API_KEY,
  OPENROUTER_MODEL, AI_ENABLED, AI_DAILY_LIMIT, TELEGRAM_BOT_TOKEN?, TELEGRAM_CHAT_ID?, SMTP_URL?, ALERT_EMAIL_TO?,
  HEALTHCHECK_PING_URL?` (optional ones may be empty strings → treat as unset).
- `.env.local` already exists for dev (gitignored). `ADMIN_PASSWORD_HASH` format:
  `scrypt:N:r:p:<salt base64url>:<key base64url>` with N=32768,r=8,p=1,keylen=64, `maxmem: 64*1024*1024`
  (node:crypto `scrypt`). Verify with `timingSafeEqual`.

## 3. Local dev & test database (IMPORTANT)
- No Docker locally. Use **`mysql-memory-server`** (already installed; MySQL 8.4.2 binary is cached).
- `npm run db:dev` → starts a persistent-for-the-session MySQL on **port 3399**, db `radar` (script `scripts/dev-db.ts`).
- Tests that need a DB must use the helper `tests/helpers/db.ts` → `await startTestDb()` which starts an **isolated
  ephemeral** MySQL on a random port, applies the schema (via `drizzle-kit push` or the generated migrations) and returns
  `{ db, url, stop }`. Never share port 3399 in tests. Always `stop()` in `afterAll`.
- Keep memory in mind (8 GB laptop): stop any MySQL you start; do not run `next build` unless your brief says so.
- Type-check with `npx tsc --noEmit -p .` and report only errors in YOUR files (others may be mid-edit).

## 4. Security rules (non-negotiable)
- Entire site requires login except: `/login`, `/api/auth/login`, `/api/health` (returns only `{ok:true}`-style info), static assets.
- Session: cookie `radar_session`, **Max-Age 1 year (31536000s)**, `HttpOnly; Secure (prod); SameSite=Lax; Path=/`.
  Value = JWT (HS256 via `jose`, secret `SESSION_SECRET`) containing `sid` (random id). DB table `sessions` stores
  sha256(sid), created_at, last_seen_at, ip, user_agent, revoked_at. `src/proxy.ts` verifies the JWT signature/expiry
  (fast path, redirects to `/login?next=`), and `requireSession()` (server) additionally checks the DB row isn't revoked.
  Every server action and API route handler calls `requireSession()` first. Sliding renewal: re-issue cookie when >30 days old.
- Login: email + password from env. Rate limit + lockout stored in DB table `login_attempts`: per-IP 5 failures/15 min →
  locked 15 min (doubling on repeat); plus a constant-time comparison and ~400ms artificial delay on failure. Never reveal
  which of email/password was wrong. Log to audit trail. Client IP = `x-real-ip` header (set by our nginx) else `unknown`.
- CSRF: Server Actions have built-in origin checks; custom mutating API routes must verify `Origin` matches `APP_URL`.
- **All posting/source HTML is untrusted**: sanitise with `src/lib/security/sanitize.ts` (`sanitizePostingHtml()`) before
  storage-for-display, and render only sanitised HTML. Never `dangerouslySetInnerHTML` unsanitised content.
- **SSRF**: any server-side fetch of a URL that came from data (link checker, career pages) must go through
  `src/lib/security/safe-fetch.ts` (`safeFetch()`): http/https only, resolve DNS and reject private/loopback/link-local/
  CGNAT/multicast/metadata IPs (IPv4+IPv6), re-validate on every redirect (max 5), timeout, max body size.
- SQL: only through Drizzle query builder or `sql` template with bound params. No string-concatenated SQL.
- Secrets never logged, never sent to the client, never in git. AI prompts never include secrets.
- Security headers (CSP with nonce or strict self policy, HSTS, X-Frame-Options DENY, Referrer-Policy, Permissions-Policy)
  configured in `next.config.ts` / proxy.

## 5. Data model (Drizzle, MySQL) — owned by FOUNDATION-BACKEND; everyone else reads it
Foundation creates ALL of these tables (names are the contract; columns may be extended sensibly). Use `bigint` unsigned
auto-increment ids (`serial`) unless noted; JSON columns via `json()`; long text via `longtext`/`mediumtext`.
- **Auth/ops:** `sessions`, `login_attempts`, `audit_log` (actor, action, entity_type, entity_id, before_json, after_json, reason, at),
  `settings` (key, value_json, version, updated_at — profile/targets/weights/alert prefs live here),
  `alerts` (kind, severity info|warn|critical, title, body, entity refs, dedupe_key, created_at, acknowledged_at, sent_channels_json),
  `backup_runs` (kind backup|restore_test, status, started_at, finished_at, size_bytes, sha256, details_json, error).
- **Geography & visa:** `countries` (iso2 PK, name, tier 1-4|0 remote, region, currency, is_live, languages_json, notes,
  salary_ranges_json, best_sites_json, cv_conventions_json, language_notes), `visa_routes` (country, code, name, official_url),
  `visa_rule_versions` (route_id, version, effective_from, effective_to, salary_threshold_eur, salary_threshold_local,
  currency, degree_rule, experience_rule, other_rules_json, rule_text, official_source_url, verification_status
  unverified|verified, last_verified_at, next_review_at, verified_by, change_reason, created_at),
  `visa_rule_changes` (log), `official_page_watches` (url, route_id, last_hash, last_checked_at, changed_at, status).
- **Sources:** `source_platforms` (key PK e.g. greenhouse, lever, arbeitnow, bundesagentur; name, grade A-D, access_method,
  terms_url, terms_status allowed|restricted|unknown|forbidden, terms_reviewed_at, terms_notes, rate_limit_per_min, daily_cap),
  `sources` (platform_key, config_json e.g. {board:"gitlab"}, label, country_iso2 nullable, company_id nullable,
  status draft|trial|live|paused|disabled, checklist_json (the 7 items of spec §7.4 each {done, at, note}),
  baseline_json {volume_min, volume_max, freshness_hours, field_presence{...}}, consecutive_failures, circuit_open_until,
  last_run_at, last_success_at, notes), `source_runs` (per source per pipeline run: status ok|failed|partial|skipped,
  fetched, parsed, new, updated, closed, failed_parse, duration_ms, error, health_flags_json).
- **Pipeline:** `pipeline_runs` (kind daily|manual|reprocess|dry_run|linkcheck, status queued|running|ok|partial|failed|skipped, requested_by, started_at,
  finished_at, lock_owner, stats_json, logic_versions_json, dry_run bool), `pipeline_lock` (single row lock with heartbeat),
  `raw_snapshots` (source_id, run_id, external_id, content_hash (sha256), payload longtext JSON, fetched_at,
  parser_version, retained bool; UNIQUE(source_id, external_id, content_hash)),
  `dead_letters` (source_id, run_id, raw_snapshot_id, stage parse|validate|normalize|enrich, error, payload_excerpt,
  status open|retried|resolved|ignored, retry_count, created_at, resolved_at).
- **Companies:** `companies` (name, normalized_name, domain, hq_country, size_band, type startup|scaleup|midsize|mnc|agency|unknown,
  is_agency, parent_company_id, notes, sponsor_summary_json), `company_aliases` (company_id, alias, normalized_alias, kind
  brand|legal|ats_slug|other, country_iso2), `sponsor_register_entries` (register_key uk_home_office|nl_ind|..., country_iso2,
  org_name, normalized_name, town, route, rating, raw_json, imported_at, register_version (download date)),
  `company_evidence` (company_id, kind register_match|posting_history|manual_note|ai, value_json, evidence, source, method,
  confidence, match_status confirmed|possible|rejected, checked_at, logic_version).
- **Jobs:** `jobs` (company_id, canonical_title, title_raw, role_key, role_family primary|secondary|fallback|other,
  country_iso2, city, location_raw, workplace_type, description_html_sanitized mediumtext, description_text mediumtext,
  description_hash, apply_url, apply_url_clean, best_source_id, posted_at, closing_at, first_seen_at, last_seen_at,
  last_confirmed_live_at, state new|active|updated|stale|closed|expired|suspicious, missing_run_count, ghost_risk bool,
  repost_count, link_status ok|dead|unknown|redirected, link_checked_at, needs_review bool, hidden bool, saved bool,
  lang, content_version int, created_at, updated_at),
  `job_sources` (job_id, source_id, external_id, url, grade, first_seen_at, last_seen_at, raw_snapshot_id, UNIQUE(source_id, external_id)),
  `job_facts` (job_id, fact_key, value_json, evidence text, source varchar, method manual|official|posting|rule|ai|estimate,
  confidence high|medium|low, checked_at, logic_version, is_active bool, created_at) — ALL candidate facts are kept;
  the displayed one is resolved by trust order,
  `job_changes` (job_id, field, old_value, new_value, changed_at, run_id), `job_scores` (job_id, score int 0-100,
  components_json, score_version, computed_at, is_current), `duplicate_candidates` (job_a, job_b, score, reasons_json,
  status open|merged|split|dismissed, decided_at), `job_overrides` (job_id, field, value_json, reason, created_at, active),
  `corrections` ("report wrong info": job_id, field, wrong_value_json, correct_value_json, note, created_at, added_to_golden bool),
  `title_review_queue` (title_raw, normalized, count, first_seen, status), `link_checks` (job_id, url, status_code, final_url, ok, checked_at, error).
- **Accuracy:** `golden_samples` (job_id nullable, snapshot_json of the posting, labels_json {role_match, seniority,
  visa_status, remote_class, salary{...}, language}, labeled_at, notes, origin manual|correction|spot_check),
  `accuracy_runs` (logic_versions_json, results_json per field precision/recall/accuracy, sample_count, created_at, blocked bool, compared_to_run_id),
  `spot_checks` (job_id, field, was_correct bool, error_type, note, checked_at).
- **AI:** `ai_usage` (day DATE UTC, calls_used, calls_limit, updated_at — UNIQUE(day)), `ai_calls` (task, model, prompt_version,
  job_ids_json, status ok|invalid|error|budget, latency_ms, tokens_in, tokens_out, error, created_at),
  `ai_cache` (content_hash + task + prompt_version UNIQUE, response_json, created_at), `ai_queue` (job_id, task, priority, status queued|done|skipped|failed, attempts, created_at, done_at).
- **Tracker & kit:** `applications` (job_id nullable, company_name, title, country_iso2, current_stage, resume_version_id,
  applied_at, source, next_follow_up_at, outcome, created_at, updated_at), `application_events` (APPEND-ONLY: application_id,
  kind stage_change|comment|follow_up_set|edit|snapshot, stage_from, stage_to, body, meta_json {interviewer, questions,
  went_well, next_steps}, occurred_at, created_at), `application_snapshots` (application_id, job_json, description_html_sanitized,
  requirements_text, apply_url, salary_json, captured_at), `resume_versions` (name, track cloud_security|devsecops|fullstack|other,
  content_md, file_note, created_at), `templates` (kind cover_letter|outreach|checklist|cv_convention, name, body_md, fields_json, country_iso2 nullable),
  `reminders` (application_id, due_at, note, done_at).
- **Settings keys** (JSON in `settings`): `profile` (passport IN, degree B.Tech, years_total, years_cloud, expected_salary_eur,
  salary_floor_eur, target_roles{primary[],secondary[],fallback[]}, experience_band {core:[2,4], show:[1,5], hide_below:1, hide_above:6},
  target_countries[], company_types[], skills[]), `score_weights`, `alerts` (channels, thresholds), `ai` (enabled, daily_limit,
  reserve_for_manual), `retention` (raw_days 90).

## 6. Core contracts (TypeScript) — foundation writes them in `src/lib/contracts/*.ts`; owners implement
```ts
// provenance.ts
export type Method = 'manual'|'official'|'posting'|'rule'|'ai'|'estimate';
export const TRUST_ORDER: readonly Method[] = ['manual','official','posting','rule','ai','estimate']; // index 0 = highest trust
export type Confidence = 'high'|'medium'|'low';
export interface Fact<T> { value: T; evidence: string|null; source: string; method: Method; confidence: Confidence;
  checkedAt: Date; logicVersion: string; }
export type FactKey = 'visa_status'|'visa_signal'|'salary'|'experience'|'seniority'|'remote'|'language'|'closing_date'
  |'role'|'skills'|'eligibility'|'suspicious'|'ai_summary'|'red_flags';
// resolveFact(candidates) → highest trust; lower trust never overrides higher; returns {winner, conflict: boolean, others}
```
```ts
// jobs.ts
export interface RawItem { externalId: string; payload: unknown; url?: string; fetchedAt: Date }
export interface NormalizedJob { sourceId: number; externalId: string; title: string; companyName: string;
  companyDomain?: string|null; locationRaw: string; countryHint?: string|null; cityHint?: string|null;
  workplaceHint?: 'onsite'|'hybrid'|'remote'|null; descriptionHtml: string|null; descriptionText: string;
  applyUrl: string; postedAt: Date|null; closingAt?: Date|null;
  salaryHint?: { min?: number; max?: number; currency?: string; period?: string; raw?: string } | null;
  employmentType?: string|null; extra?: Record<string, unknown> }
```
```ts
// connectors.ts
export interface Connector { platformKey: string; version: string; // bump when parser changes
  fetch(ctx: ConnectorContext): Promise<RawItem[]>;   // one source instance; may paginate internally
  parse(item: RawItem, ctx: ParseContext): NormalizedJob; // throw ParseError on bad record (→ dead letter)
}
export interface ConnectorContext { source: SourceRow; http: PoliteHttp; signal: AbortSignal; log: (m: string) => void }
export interface PoliteHttp { getJson<T>(url: string, init?: RequestInit): Promise<T>; getText(url: string, init?: RequestInit): Promise<string> }
  // enforces per-platform rate limit, daily cap, timeout (15s), retries (3, exponential + jitter), polite User-Agent
  // "RadarJobBot/1.0 (+https://radar.187-127-129-127.sslip.io/bot; personal non-commercial job search)"
```
Normalisation / enrichment function contracts (owners implement in their dirs; pure functions, no DB unless stated):
- `src/lib/normalize/location.ts` → `normalizeLocation(raw: string, hints?: {country?: string|null; city?: string|null}): LocationResult`
  `{ countryIso2: string|null; city: string|null; region: string|null; workplaceType: 'onsite'|'hybrid'|'remote'|null;
     remoteScopeRaw: string|null; confidence: Confidence; evidence: string }`
- `src/lib/normalize/title.ts` → `mapTitle(title: string): TitleResult`
  `{ roleKey: string|null; roleFamily: 'primary'|'secondary'|'fallback'|'other'; seniorityWord: 'junior'|'mid'|'senior'|'lead'|'principal'|null;
     matched: string|null; lang: string|null; confidence: Confidence; unknown: boolean }`
- `src/lib/normalize/experience.ts` → `extractExperience(text: string, title: string): Fact<{minYears: number|null; maxYears: number|null;
   band: 'core'|'show'|'hide'|'unknown'; securityStrict: boolean}>`
- `src/lib/normalize/salary.ts` → `parseSalary(input: {hint?: NormalizedJob['salaryHint']; text: string; countryIso2: string|null},
   fx: FxTable): Fact<SalaryValue>|null` where `SalaryValue = { min: number|null; max: number|null; currency: string;
   period: 'hour'|'day'|'month'|'year'; grossNet: 'gross'|'net'|'unknown'; installments: number|null;
   annualEurMin: number|null; annualEurMax: number|null; fxRate: number|null; fxDate: string|null; kind: 'stated'|'estimated' }`
   and `estimateSalary(countryIso2, roleKey, fx)` for country averages (kind 'estimated', method 'estimate').
- `src/lib/normalize/language.ts` → `detectLanguage(text: string): Fact<{postingLang: string|null; requirement: 'english_ok'|'local_required'|'unclear'; languages: string[]}>`
- `src/lib/normalize/url.ts` → `cleanUrl(url: string): string` (strip utm_*, gclid, fbclid, ref, source trackers; normalise host/trailing slash)
- `src/lib/fx/ecb.ts` → `getFxTable(db): Promise<FxTable>` (ECB daily reference rates, cached in `settings` key `fx_rates` with date)
- `src/lib/dedup/index.ts` → `findDuplicate(db, candidate: DedupCandidate): Promise<{action:'merge'; jobId: number; confidence: number; reasons: string[]}
   |{action:'possible'; jobIds: number[]; score: number; reasons: string[]}|{action:'new'}>`
- `src/lib/company/resolve.ts` → `resolveCompany(db, input: {name: string; domain?: string|null; countryIso2?: string|null; atsSlug?: string|null}):
   Promise<{companyId: number; isAgency: boolean; confidence: number; created: boolean}>`
- `src/lib/visa/signals.ts` → `detectVisaSignals(text: string): VisaSignal[]` with
   `VisaSignal = { signal: 'offered'|'not_offered'|'relocation'|'right_to_work_required'; quote: string; lang: string; ruleId: string; confidence: Confidence }`
- `src/lib/visa/decide.ts` → `decideVisaStatus(input: {postingSignals: VisaSignal[]; companyEvidence: CompanyEvidenceRow[];
   manualNotes: {sponsors: boolean; note: string; at: Date}[]; aiSignals: VisaSignal[]}): Fact<{status: 'confirmed'|'likely'|'unknown'|'not_offered'|'conflicting';
   reasons: string[]; sides?: {for: string[]; against: string[]}}>` — AI alone NEVER yields confirmed (spec §13.4).
- `src/lib/visa/eligibility.ts` → `checkEligibility(input: {salary: SalaryValue|null; rule: VisaRuleVersionRow|null; profile: Profile; now: Date}):
   Fact<{result: 'meets'|'borderline'|'doesnt_meet'|'cant_tell'; reason: string; marginPct: number|null; ruleVerifiedAt: Date|null}>`
- `src/lib/remote/classify.ts` → `classifyRemote(text: string, loc: LocationResult): Fact<{class: 'worldwide'|'region_limited'|'timezone_limited'|'unclear'|'not_remote'; regions: string[]}>`
- `src/lib/scoring/score.ts` → `scoreJob(input: ScoringInput, weights: ScoreWeights, profile: Profile): {score: number; version: string;
   components: {key: string; label: string; raw: number; weight: number; contribution: number; confidence: Confidence; reason: string}[]}`
   Deterministic; low confidence reduces contribution.
- `src/lib/ai/*` → `getAiBudget(db)`, `enqueueAi(db, jobId, task, priority)`, `runAiQueue(db, {maxCalls})`, `verifyQuote(quote, text): boolean`,
   `aiExtract(...)`. Budget: hard stop at `AI_DAILY_LIMIT` per UTC day, counted BEFORE the call; syncs with OpenRouter
   `GET /api/v1/key` (`data.free_model_daily_requests`). Model `nvidia/nemotron-3-ultra-550b-a55b:free` does NOT support
   `response_format` — use `tools` + `tool_choice` function-calling for structured output, validate with zod, reject otherwise.
   Everything works with AI off.
- `src/lib/pipeline/*` → `runPipeline(db, {kind, dryRun, sourceIds?})`, `reprocessFromRaw(db, {sourceIds?, since?})`,
   orchestrates: fetch → raw snapshot → parse → quality gates → normalise → company → dedup → facts → visa/remote → score → lifecycle → report/alerts.
- `src/lib/provenance/store.ts` (foundation) → `addFact(db, jobId, key, fact)`, `getFacts(db, jobId)`, `resolveJobFacts(facts, overrides)`,
   `setOverride(db, jobId, field, value, reason)` (method manual, logged in audit), `recordCorrection(...)` (adds golden sample).
- `src/lib/audit.ts` (foundation) → `audit(db, {action, entityType, entityId, before?, after?, reason?})`.
- `src/lib/alerts/index.ts` (pipeline owner) → `raiseAlert(db, {kind, severity, title, body, dedupeKey})` + channel senders (Telegram/SMTP optional).
- `src/lib/settings.ts` (foundation) → typed `getSetting(db, key)` / `setSetting(db, key, value)` with zod schemas and defaults.

Stub policy: FOUNDATION-BACKEND creates every file above with the exact exported signature and a minimal safe
implementation (e.g. return unknown/low confidence) marked `// STUB(owner): ...`. Feature owners replace stubs and keep
signatures. If you must change a contract, keep it backward compatible and note it in your report.

### 6b. Extra shared contracts
- **Run queue:** the web app never runs the pipeline in-process. UI inserts a `pipeline_runs` row with `status='queued'`
  (+ kind, dry_run, requested_by='ui', params in stats_json); the worker polls every 60s and executes queued rows in order
  (respecting the single-run lock). Helper: `src/lib/pipeline/queue.ts` → `enqueueRun(db, {kind, dryRun, sourceIds?})` (PIPELINE owns; foundation stubs).
- **Tracker:** `src/lib/tracker/index.ts` (UI-TRACKER owns; foundation stubs) → `createApplicationFromJob(db, jobId, {stage: 'saved'|'applied'; resumeVersionId?: number|null; note?: string})`
  (on 'applied' it writes an `application_snapshots` row copying description/requirements/link/salary), `addApplicationEvent(db, appId, event)`.
- **Merge/split tools:** `src/lib/dedup/manual.ts` → `mergeJobs(db, keepId, dropId, reason)`, `splitJobs(db, jobId, sourceIds[], reason)`,
  `dismissDuplicate(db, candidateId)`; `src/lib/company/manual.ts` → `mergeCompanies(db, keepId, dropId, reason)`, `splitCompany(db, companyId, aliasIds[], reason)`
  (NORMALIZE owns; foundation stubs). Fixes persist: merges/splits are recorded so re-runs don't undo them.
- **Login:** `src/lib/auth/actions.ts` (FOUNDATION-BACKEND) → `loginAction(prev: LoginState|undefined, formData: FormData): Promise<LoginState>`
  where `LoginState = {error?: string; lockedUntil?: string}` (redirects to a safe same-origin `next` on success), `logoutAction(): Promise<void>`.
  The login PAGE UI (`src/app/(auth)/**`) is built by FOUNDATION-UI using `useActionState(loginAction, undefined)`.
- **Session helpers:** `src/lib/auth/session.ts` → `requireSession(): Promise<{sessionId: string; email: string}>` (redirects to /login if invalid),
  `getSession()` (nullable), `listSessions()`, `revokeSession(id)`, `revokeOtherSessions()`.
- **npm scripts** (foundation adds to package.json; owners create target files): `dev, build, start, lint, typecheck (tsc --noEmit), test (vitest run),
  db:generate, db:migrate (tsx src/db/migrate.ts), db:dev (tsx scripts/dev-db.ts), db:seed (tsx scripts/seed.ts),
  worker (tsx src/worker/index.ts), pipeline (tsx src/worker/cli.ts), eval (tsx src/lib/accuracy/cli.ts), build:worker (node scripts/build-worker.mjs)`.

## 7. File ownership (only write inside your area; read anything)
| Owner | Paths |
|---|---|
| FOUNDATION-BACKEND | `src/lib/env.ts, src/lib/log.ts, src/lib/db/**, src/db/schema/**, src/db/migrate.ts, drizzle.config.ts, drizzle/**, src/lib/auth/**, src/proxy.ts, src/app/api/auth/**, src/lib/contracts/**, src/lib/provenance/**, src/lib/audit.ts, src/lib/settings.ts, src/lib/time.ts, src/lib/security/**, scripts/dev-db.ts, scripts/hash-password.ts, tests/helpers/**, vitest.config.ts, next.config.ts, package.json scripts`, and initial stubs anywhere in §6 |
| FOUNDATION-UI | `src/app/globals.css, src/app/layout.tsx, src/app/(auth)/** (login page UI), src/app/(app)/layout.tsx, src/app/not-found.tsx, src/app/error.tsx, src/app/(app)/error.tsx, src/app/(app)/loading.tsx, src/components/ui/**, src/components/shell/**, src/app/(app)/**/page.tsx placeholders (one per route in §8), public/**, src/app/icon.*, src/app/(app)/styleguide/**` |
| PIPELINE | `src/lib/pipeline/**, src/lib/connectors/**, src/lib/http/**, src/lib/alerts/**, src/lib/lifecycle/**, src/lib/linkcheck/**, src/worker/**, tests/pipeline/**, tests/connectors/**, tests/fixtures/connectors/**` |
| NORMALIZE | `src/lib/normalize/**, src/lib/dedup/**, src/lib/company/**, src/lib/fx/**, src/data/places/**, src/data/titles/**, src/data/salary/**, tests/normalize/**, tests/dedup/**, tests/company/**` |
| VISA | `src/lib/visa/**, src/lib/remote/**, src/lib/scoring/**, src/lib/registers/**, src/data/visa/**, src/data/remote/**, tests/visa/**, tests/remote/**, tests/scoring/**` |
| AI+ACCURACY | `src/lib/ai/**, src/lib/accuracy/**, tests/ai/**, tests/accuracy/**, tests/golden/**` |
| SEED/RESEARCH | `src/db/seed/**, src/data/seed/**, scripts/seed.ts, docs/SOURCES.md, docs/COUNTRY_RULES.md` |
| UI-JOBS | `src/app/(app)/page.tsx (dashboard), src/app/(app)/jobs/**, src/components/jobs/**, src/components/dashboard/**, src/lib/queries/jobs.ts, src/lib/queries/dashboard.ts, src/lib/actions/jobs.ts` |
| UI-TRACKER | `src/lib/tracker/**, src/app/(app)/applications/**, src/app/(app)/kit/**, src/app/(app)/companies/**, src/app/(app)/countries/**, src/components/{tracker,kit,companies,countries}/**, src/lib/queries/{applications,kit,companies,countries}.ts, src/lib/actions/{applications,kit,companies,countries}.ts, src/app/api/export/**` |
| UI-OPS | `src/app/(app)/review/**, src/app/(app)/sources/**, src/app/(app)/accuracy/**, src/app/(app)/settings/**, src/app/(app)/system/**, src/components/{review,sources,accuracy,settings,system}/**, src/lib/queries/{review,sources,accuracy,settings,system}.ts, src/lib/actions/{review,sources,accuracy,settings,system}.ts` |
| INFRA | `Dockerfile, .dockerignore, docker-compose.yml, ops/**, .github/**, docs/RECOVERY.md, docs/DEPLOY.md, docs/ARCHITECTURE.md, README.md, .env.example, src/app/api/health/**, scripts/build-worker.mjs` |

If a file you need belongs to someone else and is missing/broken, do NOT edit it — work around it and report it.

## 8. Routes (App Router, group `(app)` is behind auth)
`/login` · `/` dashboard · `/jobs` list · `/jobs/[id]` detail · `/companies`, `/companies/[id]` · `/countries`, `/countries/[iso2]` ·
`/applications`, `/applications/[id]` · `/kit` · `/review` · `/sources`, `/sources/[id]` · `/accuracy` (golden sample + dashboard + spot-checks) ·
`/settings` · `/system` (runs, alerts, dead letters, audit, AI usage, backups) · `/styleguide` (UI kit showcase).
Pages that read the DB must be dynamic (never touch the DB at build time). Mutations via Server Actions in `src/lib/actions/*`
(each starts with `await requireSession()`; validate input with zod; write `audit()` for settings/rules/overrides/merges).

## 9. Design language — "Field Station" neo-brutalism (must feel hand-made, NOT generic AI UI)
Concept: RADAR is a field station + customs office for a job hunt. Facts are **receipts**, visa verdicts are **passport stamps**,
jobs are **blips** on a radar, the dashboard is a **control desk**. Neo-brutalism rules:
- **Paper & ink:** background warm paper `#F3EEE3` with a faint dot-grid; ink `#111` for text/borders. Surfaces are flat.
- **Borders 3px solid ink**, radius 0 (or 2px max on small chips). **Hard offset shadows** `4px 4px 0 #111` (6px on hover,
  press = translate(4px,4px) + shadow 0). No blur shadows, no glassmorphism, no gradients-as-decoration, no purple-blue gradient.
- **Palette (semantic):** acid yellow `#FFE14D` (primary/action), signal orange `#FF6B1A` (attention/new), radar green `#1FD18B`
  (ok/confirmed), cobalt `#2F5BFF` (info/links), stamp red `#E5383B` (danger/not offered), lilac `#B9A6FF` (AI-derived),
  concrete `#D9D3C7` (muted/unknown). Confidence: high = solid fill, medium = hatched fill, low = dashed outline + "LOW CONF" tag.
- **Type:** display = `Archivo` (via next/font, heavy weights 800–900, some headings with `font-stretch`/expanded if available) or
  `Bricolage Grotesque`; data/receipts = `JetBrains Mono` or `IBM Plex Mono`. Do NOT use Inter, Geist, Roboto, Poppins, Space Grotesk.
  Big numerals for scores. UPPERCASE tracking-wide micro-labels.
- **Signature components:** `<Stamp>` (rotated −6°…4°, double border, slight ink-texture via SVG filter) for visa status/verdicts;
  `<Receipt>` (monospace, zig-zag/perforated top & bottom edge) for provenance (value · evidence quote · source · method · confidence · checked at · logic version);
  `<ConfidenceMeter>` (■■□ blocks); `<Sticker>` labels; `<Ticker>` marquee of new jobs (pauses on hover, respects reduced motion);
  `<RadarSweep>` animated SVG (login + dashboard health); `<FitGauge>` chunky 0–100; `<AsOf>` timestamp chip (every data view shows "as of");
  `<EstimateTag>` (estimates look visibly different — italic + hatched); `<EmptyState>` with personality; `<Drawer>` (mobile filters),
  `<Tabs>`, `<Button>` variants, `<Input>/<Select>/<Textarea>/<Checkbox>/<Toggle>`, `<Table>` that collapses into stacked cards on mobile,
  `<Modal>`, `<Toast>`, `<Badge>`, `<Card>`, `<KeyValue>`, `<Timeline>` (append-only feel, like a logbook).
- **Layout:** desktop = left rail nav (chunky, labelled, with key counts) + content; mobile = top bar + **bottom tab bar**
  (Desk, Jobs, Tracker, Review, More→sheet). Must be fully usable at 360px width; no horizontal scroll except intentional tables.
  Touch targets ≥ 44px. Focus rings visible (thick yellow/ink outline). WCAG AA contrast.
- Copy voice: terse, field-manual tone ("3 blips need review", "Signal lost: arbeitnow — 0 jobs, keeping yesterday's"). Honest labels:
  "Unknown" is a first-class state, estimates are labelled, low confidence visibly marked, "as of" everywhere, nothing hidden silently
  (show "N hidden by filters" with reasons).
- Motion: small and snappy (press/hover offsets, stamp "thunk" scale-in); all motion disabled under `prefers-reduced-motion`.

## 10. Conventions
- Server Components by default; `'use client'` only where needed. Data access lives in `src/lib/queries/*` (server-only) and
  `src/lib/actions/*` (server actions). Import `server-only` in server modules.
- DB client: `import { db } from '@/lib/db'` (lazy singleton pool, never at import-time connect during build).
- Every version constant (parser, rules, prompts, scoring) exported as `export const X_VERSION = 'name@YYYY-MM-DD.n'`.
- Tests: vitest, files `tests/<area>/*.test.ts`. Pure-function modules must have solid unit tests (multilingual cases, negation, edge cases).
- No console noise in production code — use `src/lib/log.ts` (foundation) `log.info/warn/error` (JSON lines).
- Keep comments purposeful; no giant commented-out blocks. No TODO placeholders in shipped UI — build the real thing.
