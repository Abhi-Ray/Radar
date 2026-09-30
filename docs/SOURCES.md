# Sources — registry, terms and seeded instances

> **Terms status: auto-reviewed 2026-09-30 by the build assistant — the owner must confirm.** The build assistant read each platform's terms / API documentation on 2026-09-30 and summarised them below and in `source_platforms.terms_notes` (every note starts with _"auto-reviewed 2026-09-30 by build assistant — owner must confirm."_). That is **not** an owner review: `terms_reviewed_at` is seeded **NULL**, so the spec §7.4 item "Terms of use reviewed and recorded, with a date" stays open for every source until the owner reads the terms and records the review (which sets `terms_reviewed_at`).

Source of truth: `src/data/seed/sources.ts` (platforms, aggregator and government instances) and `src/data/seed/companies.ts` (company career boards). This file is generated from the same data; if they disagree, the seed data wins.

## Rules that never change (spec §7.3)

- **No LinkedIn, Indeed or Glassdoor scraping.** They are registered as `forbidden`, have no connector, and the seed refuses to create a source on a forbidden platform. They are listed only so the owner can use them by hand for cross-checking.
- Official APIs, feeds and public hiring-platform listings only. Polite rates (below), one request per board per run where possible, always link back to the original posting.
- No auto-apply: RADAR never submits an application.

## Grades

- **A** — government job services and official APIs (Bundesagentur, JobTech, NAV).
- **A (spec table says B)** — company career boards on public hiring-platform APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workable, Recruitee, Personio). They are seeded as **A** on purpose: the pipeline treats only grade-A listings as proof that a posting is still live, and a company's own board is exactly that proof. The owner can lower it in the `source_platforms` row; the DB grade overrides the connector default.
- **D** — aggregators and remote boards (Arbeitnow, Remotive, Remote OK, Himalayas, Jobicy) and the manual-only sites. They are often reposts, so a higher-grade copy of the same job always wins for the apply link and dates.

## Platform registry

| Key | Platform | Grade | Access | Terms status | Rate / min | Daily cap | Connector | Terms / docs |
|---|---|---|---|---|---|---|---|---|
| `greenhouse` | Greenhouse Job Board API | A | ats_json | allowed | 30 | 1000 | yes | <https://developers.greenhouse.io/job-board.html> |
| `lever` | Lever Postings API | A | ats_json | allowed | 30 | 1000 | yes | <https://github.com/lever/postings-api> |
| `ashby` | Ashby Job Posting API | A | ats_json | allowed | 30 | 1000 | yes | <https://developers.ashbyhq.com/docs/public-job-posting-api> |
| `smartrecruiters` | SmartRecruiters Posting API | A | ats_json | allowed | 30 | 1500 | yes | <https://developers.smartrecruiters.com/docs/posting-api> |
| `workable` | Workable jobs widget | A | ats_json | restricted | 20 | 500 | yes | <https://workable.readme.io/docs/jobs-widget> |
| `recruitee` | Recruitee careers-site API | A | ats_json | restricted | 20 | 500 | yes | <https://docs.recruitee.com/reference/offers> |
| `personio` | Personio XML job feed | A | xml | restricted | 20 | 500 | yes | <https://developer.personio.de/docs/retrieving-open-job-positions> |
| `bundesagentur` | Bundesagentur für Arbeit (Jobsuche) | A | api | unknown | 20 | 600 | yes | <https://jobsuche.api.bund.dev/> |
| `jobtech_se` | JobTech JobSearch (Arbetsförmedlingen) | A | api | allowed | 30 | 400 | yes | <https://jobtechdev.se/en/components/jobsearch> |
| `nav_no` | NAV Arbeidsplassen (stillingsfeed) | A | feed | restricted | 30 | 400 | yes | <https://arbeidsplassen.nav.no/vilkar-api> |
| `arbeitnow` | Arbeitnow | D | api | restricted | 10 | 60 | yes | <https://www.arbeitnow.com/blog/job-board-api> |
| `remotive` | Remotive | D | api | restricted | 2 | 4 | yes | <https://remotive.com/api-documentation> |
| `remoteok` | Remote OK | D | api | restricted | 1 | 4 | yes | <https://remoteok.com/api> |
| `himalayas` | Himalayas | D | api | restricted | 10 | 120 | yes | <https://himalayas.app/api> |
| `jobicy` | Jobicy | D | api | restricted | 2 | 24 | yes | <https://jobicy.com/jobs-rss-feed> |
| `linkedin` | LinkedIn (manual only) | D | manual | forbidden | 0 | 0 | no (manual only) | <https://www.linkedin.com/legal/user-agreement> |
| `indeed` | Indeed (manual only) | D | manual | forbidden | 0 | 0 | no (manual only) | <https://www.indeed.com/legal> |
| `glassdoor` | Glassdoor (manual only) | D | manual | forbidden | 0 | 0 | no (manual only) | <https://www.glassdoor.com/about/terms> |

Terms status: `allowed` = documented public API meant for this use; `restricted` = allowed with conditions (attribution, rate, no redistribution, …) that RADAR must respect; `unknown` = no official terms found; `forbidden` = never automated.

## Terms notes (build assistant, 2026-09-30)

What was read and what it means for RADAR. Where a page could not be fetched, the note says so and the owner must read it before the source goes live.

### Greenhouse Job Board API (`greenhouse`)

- Terms / docs: <https://developers.greenhouse.io/job-board.html>
- Status: **allowed** · grade A · 30/min, 1000/day
- Notes: Documented public Job Board API: unauthenticated GET endpoints that companies publish so their open jobs can be listed anywhere. Keep one request per board per run, link every job back to its original posting and never submit applications through the API (that needs the company key).
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Lever Postings API (`lever`)

- Terms / docs: <https://github.com/lever/postings-api>
- Status: **allowed** · grade A · 30/min, 1000/day
- Notes: Documented public postings API (api.lever.co, api.eu.lever.co for EU accounts) that companies use for their own job sites. Read-only use of published postings, link back to jobs.lever.co; the apply endpoint needs a company key and is not used.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Ashby Job Posting API (`ashby`)

- Terms / docs: <https://developers.ashbyhq.com/docs/public-job-posting-api>
- Status: **allowed** · grade A · 30/min, 1000/day
- Notes: Documented public job posting API (api.ashbyhq.com/posting-api/job-board/{org}); only listed postings are returned. Read-only, polite rate, link back to jobs.ashbyhq.com.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### SmartRecruiters Posting API (`smartrecruiters`)

- Terms / docs: <https://developers.smartrecruiters.com/docs/posting-api>
- Status: **allowed** · grade A · 30/min, 1500/day
- Notes: Documented public Posting API for published job ads (no key needed). The list has no descriptions, so detail requests are capped per run; big companies are narrowed with a keyword query. Link back to jobs.smartrecruiters.com.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Workable jobs widget (`workable`)

- Terms / docs: <https://workable.readme.io/docs/jobs-widget>
- Status: **restricted** · grade A · 20/min, 500/day
- Notes: Public widget endpoint (apply.workable.com/api/v1/widget/accounts/{slug}) meant for embedding a company’s own job list; not a general data API. Low rate, one request per board per run, link back to apply.workable.com, stop if Workable objects.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Recruitee careers-site API (`recruitee`)

- Terms / docs: <https://docs.recruitee.com/reference/offers>
- Status: **restricted** · grade A · 20/min, 500/day
- Notes: Public careers-site endpoint ({slug}.recruitee.com/api/offers/) used by the company’s own careers page. Read-only, low rate, link back to the company careers page.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Personio XML job feed (`personio`)

- Terms / docs: <https://developer.personio.de/docs/retrieving-open-job-positions>
- Status: **restricted** · grade A · 20/min, 500/day
- Notes: Public XML feed ({slug}.jobs.personio.de/xml) that Personio documents for showing open positions on a company’s own site and job boards. One request per tenant per run, link back to the company’s Personio job page.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Bundesagentur für Arbeit (Jobsuche) (`bundesagentur`)

- Terms / docs: <https://jobsuche.api.bund.dev/>
- Status: **unknown** · grade A · 20/min, 600/day
- Notes: Official job search of the German Federal Employment Agency, used through its public client key. The only documentation is the community project bund.dev; no official terms of use for this API were found. Attribution "Quelle: Bundesagentur für Arbeit", capped detail requests, temp-agency postings excluded. Owner: decide whether to accept the unclear terms before making it live.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### JobTech JobSearch (Arbetsförmedlingen) (`jobtech_se`)

- Terms / docs: <https://jobtechdev.se/en/components/jobsearch>
- Status: **allowed** · grade A · 30/min, 400/day
- Notes: Swedish Public Employment Service open data (JobSearch API over Platsbanken), published as open data under CC0 per JobTech Dev. The docs page did not resolve from the build machine on 2026-09-30, so this is from background knowledge: re-read it before going live. Attribution "Arbetsförmedlingen (Platsbanken)".
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### NAV Arbeidsplassen (stillingsfeed) (`nav_no`)

- Terms / docs: <https://arbeidsplassen.nav.no/vilkar-api>
- Status: **restricted** · grade A · 30/min, 400/day
- Notes: NAV terms for the public job feed (read 2026-09-30): free to use, NAV may stop access on misuse; ads must be removed at once when they are inactive or deleted in the feed and updated when they change; the apply button must deep-link to the source ad; the user of the feed is a separate controller for any personal data in ads. Uses the public rotating token (docs: https://navikt.github.io/pam-stilling-feed/). Attribution "Kilde: NAV / arbeidsplassen.no".
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Arbeitnow (`arbeitnow`)

- Terms / docs: <https://www.arbeitnow.com/blog/job-board-api>
- Status: **restricted** · grade D · 10/min, 60/day
- Notes: Free public Job Board API, no key. Link back to Arbeitnow (attribution "via Arbeitnow"). Aggregated, often reposted from company boards: grade D.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Remotive (`remotive`)

- Terms / docs: <https://remotive.com/api-documentation>
- Status: **restricted** · grade D · 2/min, 4/day
- Notes: Public API: at most ~4 requests a day, jobs are shown with a 24 h delay, you must link back to the Remotive job page and credit Remotive. The docs page was behind a bot check on 2026-09-30, so this is from the connector notes and background knowledge: re-read before going live.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Remote OK (`remoteok`)

- Terms / docs: <https://remoteok.com/api>
- Status: **restricted** · grade D · 1/min, 4/day
- Notes: Public API (latest jobs). Its legal notice asks to link back (follow link) to the Remote OK job page and mention Remote OK as the source; do not use the Remote OK logo, or API access is suspended.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Himalayas (`himalayas`)

- Terms / docs: <https://himalayas.app/api>
- Status: **restricted** · grade D · 10/min, 120/day
- Notes: Free public JSON API. Terms on the API page: link back to the Himalayas job page and mention Himalayas as the source; do not submit its jobs to third-party sites or aggregators (Jooble, Google Jobs, LinkedIn …); at most 20 jobs per request (since 24 Mar 2025).
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Jobicy (`jobicy`)

- Terms / docs: <https://jobicy.com/jobs-rss-feed>
- Status: **restricted** · grade D · 2/min, 24/day
- Notes: Public remote-jobs API and feeds, free, API key optional. Credit Jobicy with a direct link to the Jobicy job page; apply through the original URL; keep requests infrequent.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### LinkedIn (manual only) (`linkedin`)

- Terms / docs: <https://www.linkedin.com/legal/user-agreement>
- Status: **forbidden** · grade D · 0/min, 0/day
- Notes: User Agreement forbids using "software, devices, scripts, robots or any other means or processes (including crawlers, browser plugins and add-ons …) to scrape or copy the Services". Never automated: open it by hand to cross-check a job or a recruiter.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Indeed (manual only) (`indeed`)

- Terms / docs: <https://www.indeed.com/legal>
- Status: **forbidden** · grade D · 0/min, 0/day
- Notes: Terms forbid using "any automated system (bots, scrapers, spiders, AI …) to access, data-mine" the site without Indeed’s express written permission. Manual cross-checking only.
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

### Glassdoor (manual only) (`glassdoor`)

- Terms / docs: <https://www.glassdoor.com/about/terms>
- Status: **forbidden** · grade D · 0/min, 0/day
- Notes: Terms forbid introducing "software or automated agents … to scrape, strip, or mine data" from the site. Manual cross-checking only (salaries, reviews).
- Owner: [ ] read the terms page yourself and confirm (or change) the status; this sets `terms_reviewed_at`.

## Seeded source instances — government and aggregators

Every seeded source starts as **`trial`**: it runs, but is not "live" until the spec §7.4 checklist is complete. The seed stores an empty checklist; it ticks nothing.

| Source | Platform | Country hint | Config | Notes |
|---|---|---|---|---|
| Bundesagentur für Arbeit — cloud & security roles (DE) | `bundesagentur` | DE | `{"queries":[{"was":"Cloud Security"},{"was":"DevSecOps"},{"was":"Application Security"},{"was":"Product Security"},{"was":"Security Engineer"},{"was":"IT-Sicherheit Cloud"},{"was":"Cloud Engineer"},{"was":"Security Analyst"}]}` | Primary and secondary roles, Germany-wide, last 7 days, temp agencies excluded. |
| Bundesagentur für Arbeit — full-stack fallback (DE) | `bundesagentur` | DE | `{"queries":[{"was":"Full Stack Developer"},{"was":"Fullstack Entwickler"},{"was":"Node.js"},{"was":"Next.js"}],"maxDetails":20}` | Fallback roles (full-stack / Node / Next.js); fewer detail requests. |
| JobTech (Platsbanken) — cloud & security roles (SE) | `jobtech_se` | SE | `{"queries":["IT-säkerhet","informationssäkerhet","security engineer","cloud security","devsecops","application security","molnsäkerhet"]}` | Swedish and English queries, last 14 days. |
| NAV Arbeidsplassen — job feed (NO) | `nav_no` | NO | `{}` | Whole Norwegian feed, title pre-filter on. NAV terms: remove inactive ads at once, deep-link apply. |
| Arbeitnow — all jobs (mostly DE) | `arbeitnow` | — | `{}` | Newest pages only, title pre-filter on. |
| Remotive — software-dev + devops (remote) | `remotive` | XW | `{"categories":["software-dev","devops"]}` | At most ~4 requests a day; jobs arrive 24 h late. |
| Remote OK — latest jobs (remote) | `remoteok` | XW | `{}` | Latest jobs only, title pre-filter on; no logo use. |
| Himalayas — remote jobs | `himalayas` | XW | `{}` | Do not pass its jobs on to other sites (Himalayas terms). |
| Jobicy — security + devops (remote) | `jobicy` | XW | `{"tags":["security","devops"]}` | Tag search, 50 newest. |

## Seeded source instances — company career boards

198 companies, each with one `trial` source on its public hiring-platform board. Every board below answered on its public API when the build assistant checked it on 2026-09-30 (timestamp in `check.at` in `companies.ts`). The posting counts are a snapshot used to pick sources, **not** the §7.4 volume baseline — that is recorded from real runs.

- HQ country and company type are the build assistant's best knowledge, **not verified**; they are only weak tie-breakers for company matching.
- "Hint" = the source's country hint. It is set only when (nearly) all sampled postings were in that country; multinational boards get no hint, so each posting's own location decides.
- Each company also gets its brand/legal aliases and an `ats_slug` alias (`<platform>:<slug>`), so jobs from the board resolve to the same company as jobs from aggregators.

By platform: greenhouse 103 · ashby 52 · lever 14 · smartrecruiters 12 · personio 8 · recruitee 6 · workable 3

By hub country: US 33 · DE 31 · GB 21 · IE 21 · FR 18 · XW 17 · NL 14 · SE 6 · AT 4 · BE 4 · CA 4 · PT 4 · CH 3 · DK 2 · EE 2 · FI 2 · GR 2 · NO 2 · AE 1 · AU 1 · ES 1 · IL 1 · LT 1 · PL 1 · RO 1 · SG 1 (XW = remote-first)

By type: scaleup 103 · mnc 49 · startup 31 · midsize 14 · unknown 1

| Company | Platform | Board | Hub | Hint | HQ (unverified) | Open postings at check (security / cloud by title) |
|---|---|---|---|---|---|---|
| 1KOMMA5° | personio | `1komma5grad` | DE | DE | DE | 1594 (1 / 1) |
| 1Password | ashby | `1password` | CA | — | CA | 64 (5 / 0) |
| Abnormal Security | greenhouse | `abnormalsecurity` | GB | — | US | 81 (13 / 1) |
| Adverity | personio | `adverity` | AT | — | AT | 8 (0 / 0) |
| Adyen | greenhouse | `adyen` | NL | — | NL | 213 (2 / 5) |
| Airbnb | greenhouse | `airbnb` | IE | — | US | 157 (0 / 2) |
| Airbyte | ashby | `airbyte` | XW | — | US | 12 (0 / 2) |
| Aircall | lever | `aircall` | FR | — | FR | 77 (1 / 0) |
| Alan | ashby | `alan` | FR | — | FR | 119 (3 / 1) |
| Algolia | greenhouse | `algolia` | FR | — | US | 34 (1 / 7) |
| Anthropic | greenhouse | `anthropic` | IE | — | US | 637 (55 / 43) |
| Asana | greenhouse | `asana` | IE | — | US | 95 (8 / 4) |
| Attio | ashby | `attio` | GB | — | GB | 37 (3 / 3) |
| Axonius | greenhouse | `axonius` | US | — | US | 20 (8 / 2) |
| Binance | lever | `binance` | XW | — | ? | 306 (14 / 6) |
| Bitpanda | greenhouse | `bitpanda` | AT | — | AT | 23 (5 / 1) |
| Bitvavo | ashby | `bitvavo` | NL | NL | NL | 11 (0 / 1) |
| Bitwarden | greenhouse | `bitwarden` | US | — | US | 36 (3 / 1) |
| Blueground | workable | `blueground` | GR | — | GR | 9 (0 / 0) |
| Bosch | smartrecruiters | `boschgroup`, keyword "security" | DE | — | DE | 4830 (4 / 1) |
| Brainlab | smartrecruiters | `brainlab` | DE | — | DE | 57 (1 / 0) |
| Brex | greenhouse | `brex` | US | — | US | 268 (7 / 0) |
| Bugcrowd | greenhouse | `bugcrowd` | GB | — | US | 8 (3 / 0) |
| bunq | recruitee | `bunq` | NL | — | NL | 15 (0 / 0) |
| Canonical | greenhouse | `canonical` | XW | — | GB | 306 (15 / 33) |
| Careem | greenhouse | `careem` | AE | — | AE | 20 (0 / 1) |
| Catawiki | greenhouse | `catawiki` | NL | — | NL | 43 (0 / 1) |
| Cato Networks | greenhouse | `catonetworks` | US | — | US | 95 (11 / 3) |
| Celonis | greenhouse | `celonis` | DE | — | DE | 240 (4 / 4) |
| CERN | smartrecruiters | `cern` | CH | CH | CH | 54 (0 / 1) |
| Chainguard | greenhouse | `chainguard` | US | — | US | 82 (10 / 1) |
| Channable | recruitee | `channable` | NL | — | NL | 10 (0 / 0) |
| CircleCI | greenhouse | `circleci` | US | — | US | 13 (0 / 0) |
| ClickHouse | ashby | `clickhouse` | NL | — | US | 186 (10 / 32) |
| Cloudflare | greenhouse | `cloudflare` | PT | — | US | 399 (27 / 21) |
| Cloudinary | lever | `cloudinary` | IL | — | IL | 8 (0 / 0) |
| Cognite | greenhouse | `cognite` | NO | — | NO | 46 (1 / 0) |
| Cognition | ashby | `cognition` | US | — | US | 103 (2 / 3) |
| Cohere | ashby | `cohere` | CA | — | CA | 143 (6 / 17) |
| Coinbase | greenhouse | `coinbase` | IE | — | US | 210 (12 / 11) |
| Collibra | greenhouse | `collibra` | BE | — | BE | 32 (1 / 0) |
| commercetools | greenhouse | `commercetools` | DE | — | DE | 36 (4 / 1) |
| Contentful | greenhouse | `contentful` | DE | — | DE | 22 (0 / 0) |
| Contentsquare | lever | `contentsquare` | FR | — | FR | 31 (1 / 0) |
| Continental | smartrecruiters | `continental`, keyword "security" | DE | — | DE | 745 (6 / 4) |
| Cyberhaven | ashby | `cyberhaven` | US | — | US | 29 (2 / 1) |
| Dashlane | greenhouse | `dashlane` | FR | — | FR | 16 (3 / 0) |
| Databricks | greenhouse | `databricks` | NL | — | US | 884 (29 / 24) |
| Datadog | greenhouse | `datadog` | FR | — | US | 437 (29 / 7) |
| Dataiku | greenhouse | `dataiku` | FR | — | FR | 23 (0 / 1) |
| DeepL | ashby | `deepl` | DE | — | DE | 19 (0 / 0) |
| Deliveroo | greenhouse | `deliveroo` | GB | — | GB | 185 (3 / 3) |
| Delivery Hero | smartrecruiters | `deliveryhero`, keyword "security" | DE | — | DE | 978 (1 / 0) |
| Devoteam | smartrecruiters | `devoteam`, keyword "security" | FR | — | FR | 921 (14 / 26) |
| DigitalOcean | greenhouse | `digitalocean98` | US | — | US | 163 (24 / 23) |
| Discord | greenhouse | `discord` | US | — | US | 48 (4 / 2) |
| Doctolib | greenhouse | `doctolib` | FR | — | FR | 153 (2 / 9) |
| Drata | ashby | `drata` | US | — | US | 38 (0 / 1) |
| Dropbox | greenhouse | `dropbox` | IE | — | US | 37 (0 / 3) |
| Duolingo | greenhouse | `duolingo` | DE | — | US | 83 (0 / 3) |
| Elastic | greenhouse | `elastic` | NL | — | NL | 391 (67 / 28) |
| ElevenLabs | ashby | `elevenlabs` | PL | — | US | 181 (1 / 4) |
| Endava | smartrecruiters | `endava` | RO | — | GB | 169 (2 / 15) |
| Epic Games | greenhouse | `epicgames` | US | — | US | 158 (5 / 3) |
| Expel | greenhouse | `expel` | US | — | US | 11 (4 / 0) |
| Experian | smartrecruiters | `experian`, keyword "security" | IE | — | IE | 401 (3 / 2) |
| Fastly | greenhouse | `fastly` | GB | — | US | 44 (9 / 4) |
| Feedzai | greenhouse | `feedzai` | PT | — | PT | 34 (4 / 2) |
| Figma | greenhouse | `figma` | GB | — | US | 163 (4 / 6) |
| Flix | greenhouse | `flix` | DE | — | DE | 153 (0 / 6) |
| getquin | personio | `getquin` | DE | DE | DE | 41 (0 / 0) |
| GetYourGuide | greenhouse | `getyourguide` | DE | — | DE | 51 (1 / 1) |
| GitLab | greenhouse | `gitlab` | XW | — | US | 199 (19 / 11) |
| GoCardless | greenhouse | `gocardless` | GB | — | GB | 25 (1 / 1) |
| Grafana Labs | greenhouse | `grafanalabs` | XW | — | US | 117 (0 / 8) |
| Granola | ashby | `granola` | GB | — | GB | 19 (1 / 0) |
| Harvey | ashby | `harvey` | GB | — | US | 295 (7 / 14) |
| HelloFresh | greenhouse | `hellofresh` | DE | — | DE | 430 (5 / 4) |
| Helsing | greenhouse | `helsing` | DE | — | DE | 160 (5 / 2) |
| Hopper | ashby | `hopper` | CA | — | CA | 19 (0 / 0) |
| Hornetsecurity | personio | `hornetsecurity` | DE | — | DE | 185 (5 / 0) |
| Hugging Face | workable | `huggingface` | FR | — | FR | 8 (0 / 0) |
| Huntress | greenhouse | `huntress` | US | — | US | 41 (19 / 1) |
| Immutable | lever | `immutable` | AU | — | AU | 7 (0 / 1) |
| incident.io | ashby | `incident` | GB | — | GB | 33 (2 / 3) |
| Infisical | ashby | `infisical` | US | — | US | 10 (0 / 0) |
| Intercom | greenhouse | `intercom` | IE | — | IE | 109 (4 / 6) |
| IONOS | greenhouse | `ionos` | DE | DE | DE | 32 (3 / 5) |
| Isar Aerospace | greenhouse | `isaraerospace` | DE | — | DE | 97 (1 / 1) |
| JFrog | greenhouse | `jfrog` | US | — | US | 61 (4 / 3) |
| JumpCloud | lever | `jumpcloud` | US | — | US | 28 (2 / 0) |
| Keeper Security | greenhouse | `keepersecurity` | IE | — | US | 84 (5 / 7) |
| LangChain | ashby | `langchain` | US | — | US | 101 (1 / 1) |
| Legora | ashby | `legora` | SE | — | SE | 274 (4 / 9) |
| Linear | ashby | `linear` | XW | — | US | 30 (0 / 0) |
| Lovable | ashby | `lovable` | SE | — | SE | 78 (7 / 4) |
| Luminus | recruitee | `luminus` | BE | BE | BE | 20 (2 / 0) |
| Mattermost | greenhouse | `mattermost` | XW | — | US | 14 (0 / 1) |
| Mijndomein | recruitee | `mijndomein` | NL | NL | NL | 14 (0 / 2) |
| Mirakl | greenhouse | `mirakl` | FR | — | FR | 11 (0 / 0) |
| Miro | greenhouse | `realtimeboardglobal` | NL | — | NL | 25 (1 / 0) |
| Modal | ashby | `modal` | US | — | US | 39 (2 / 2) |
| Mollie | ashby | `mollie` | NL | — | NL | 44 (0 / 4) |
| MongoDB | greenhouse | `mongodb` | IE | — | US | 395 (8 / 22) |
| Monzo | greenhouse | `monzo` | GB | — | GB | 72 (1 / 0) |
| Mozilla | greenhouse | `mozilla` | XW | — | US | 81 (8 / 2) |
| Multiverse | ashby | `multiverse` | GB | GB | GB | 19 (0 / 0) |
| N26 | greenhouse | `n26` | DE | — | DE | 50 (4 / 5) |
| n8n | ashby | `n8n` | DE | — | DE | 35 (0 / 2) |
| NetBird | ashby | `netbird` | DE | DE | DE | 12 (0 / 1) |
| Netskope | greenhouse | `netskope` | US | — | US | 149 (10 / 8) |
| New Relic | greenhouse | `newrelic` | IE | — | US | 49 (1 / 2) |
| Nium | lever | `nium` | SG | — | SG | 23 (0 / 1) |
| Northwave Cyber Security | recruitee | `northwave` | NL | — | NL | 16 (6 / 0) |
| Notion | ashby | `notion` | IE | — | US | 128 (6 / 4) |
| Okta | greenhouse | `okta` | US | — | US | 351 (31 / 28) |
| OpenAI | ashby | `openai` | IE | — | US | 838 (51 / 67) |
| Orca Security | greenhouse | `orcasecurity` | GB | — | GB | 11 (0 / 2) |
| ottonova | personio | `ottonova` | DE | DE | DE | 57 (0 / 0) |
| Outreach | lever | `outreach` | US | — | US | 32 (1 / 0) |
| Paddle | ashby | `paddle` | GB | — | GB | 22 (0 / 1) |
| PagerDuty | greenhouse | `pagerduty` | PT | — | US | 54 (3 / 2) |
| Parloa | ashby | `parloa` | DE | — | DE | 51 (1 / 2) |
| Pennylane | ashby | `pennylane` | FR | — | FR | 148 (0 / 0) |
| Perplexity | ashby | `perplexity` | US | — | US | 124 (3 / 6) |
| Photoroom | ashby | `photoroom` | FR | — | FR | 15 (0 / 0) |
| Pigment | lever | `pigment` | FR | — | FR | 137 (1 / 4) |
| Pinterest | greenhouse | `pinterest` | IE | — | US | 152 (2 / 8) |
| Pipedrive | lever | `pipedrive` | EE | — | EE | 8 (3 / 0) |
| Plain | ashby | `plain` | GB | — | GB | 4 (0 / 0) |
| Pleo | ashby | `pleo` | DK | — | DK | 32 (0 / 0) |
| Polarsteps | ashby | `polarsteps` | NL | NL | NL | 4 (0 / 0) |
| PostHog | ashby | `posthog` | XW | — | US | 8 (1 / 1) |
| Proton | greenhouse | `proton` | CH | — | CH | 59 (3 / 6) |
| Qonto | ashby | `qonto` | FR | — | FR | 41 (0 / 0) |
| Raisin | greenhouse | `raisin` | DE | — | DE | 34 (1 / 0) |
| Ramp | ashby | `ramp` | US | — | US | 155 (7 / 3) |
| Recorded Future | greenhouse | `recordedfuture` | SE | — | US | 43 (2 / 6) |
| Reddit | greenhouse | `reddit` | IE | — | US | 146 (7 / 2) |
| RELEX Solutions | greenhouse | `relex` | FI | — | FI | 42 (3 / 0) |
| Remote | greenhouse | `remotecom` | XW | — | US | 137 (0 / 0) |
| Render | ashby | `render` | US | — | US | 40 (1 / 4) |
| Replit | ashby | `replit` | US | — | US | 74 (3 / 9) |
| Resend | ashby | `resend` | XW | — | US | 7 (2 / 0) |
| Riot Games | greenhouse | `riotgames` | IE | — | US | 167 (1 / 8) |
| Robinhood | greenhouse | `robinhood` | GB | — | US | 162 (18 / 9) |
| Samsara | greenhouse | `samsara` | GB | — | US | 240 (21 / 9) |
| Sanity | ashby | `sanity` | NO | — | NO | 34 (0 / 2) |
| Scandit | greenhouse | `scandit` | CH | — | CH | 9 (0 / 0) |
| Semgrep | ashby | `semgrep` | US | — | US | 11 (2 / 0) |
| Sentry | ashby | `sentry` | AT | — | US | 41 (5 / 1) |
| ServiceNow | smartrecruiters | `servicenow`, keyword "security" | NL | — | US | 692 (5 / 11) |
| Showpad | greenhouse | `showpad` | BE | — | BE | 28 (0 / 1) |
| Skroutz | workable | `skroutz` | GR | GR | GR | 11 (0 / 0) |
| Socket | ashby | `socket` | US | — | US | 29 (2 / 1) |
| Solaris | greenhouse | `solarisbank` | DE | DE | DE | 23 (3 / 2) |
| Sonatype | lever | `sonatype` | US | — | US | 23 (0 / 4) |
| Sopra Steria | smartrecruiters | `soprasteria1`, keyword "security" | FR | — | FR | 2041 (8 / 6) |
| Sourcegraph | greenhouse | `sourcegraph91` | XW | — | US | 8 (0 / 0) |
| Spotify | lever | `spotify` | SE | — | SE | 79 (1 / 0) |
| Squarespace | greenhouse | `squarespace` | IE | — | US | 33 (1 / 0) |
| Staffbase | greenhouse | `staffbase` | DE | — | DE | 20 (3 / 0) |
| Stripe | greenhouse | `stripe` | IE | — | IE | 711 (28 / 13) |
| Sumo Logic | greenhouse | `sumologic` | US | — | US | 9 (0 / 2) |
| SumUp | greenhouse | `sumup` | DE | — | GB | 324 (3 / 3) |
| Supabase | ashby | `supabase` | XW | — | US | 49 (2 / 4) |
| Swile | lever | `swile` | FR | — | FR | 32 (3 / 3) |
| Sword Health | greenhouse | `swordhealth` | PT | — | PT | 45 (2 / 2) |
| Synthesia | ashby | `synthesia` | GB | — | GB | 51 (2 / 1) |
| tado | personio | `tado` | DE | DE | DE | 4 (0 / 0) |
| Tailscale | greenhouse | `tailscale` | CA | — | CA | 52 (2 / 2) |
| Tanium | greenhouse | `tanium` | US | — | US | 59 (4 / 2) |
| Temporal Technologies | ashby | `temporal` | XW | — | US | 65 (1 / 9) |
| thermondo | personio | `thermondo` | DE | DE | DE | 1513 (0 / 0) |
| Thoughtworks | greenhouse | `thoughtworks` | GB | — | US | 35 (1 / 1) |
| Tines | greenhouse | `tines` | IE | — | IE | 26 (2 / 0) |
| Toast | greenhouse | `toast` | IE | — | US | 340 (3 / 1) |
| Toreon | recruitee | `toreon` | BE | BE | BE | 6 (5 / 0) |
| Tractive | personio | `tractive` | AT | AT | AT | 12 (0 / 0) |
| Trade Republic | greenhouse | `traderepublicbank` | DE | DE | DE | 39 (4 / 0) |
| trivago | greenhouse | `trivago` | DE | DE | DE | 13 (0 / 1) |
| Truecaller | greenhouse | `truecaller` | SE | — | SE | 29 (0 / 1) |
| Trustpilot | greenhouse | `trustpilot` | DK | — | DK | 44 (1 / 0) |
| Twilio | greenhouse | `twilio` | IE | — | US | 135 (6 / 3) |
| Typeform | greenhouse | `typeform` | ES | — | ES | 15 (0 / 0) |
| Ubisoft | smartrecruiters | `ubisoft2`, keyword "security" | FR | — | FR | 300 (4 / 4) |
| Vanta | ashby | `vanta` | IE | — | US | 88 (2 / 0) |
| Vercel | greenhouse | `vercel` | XW | — | US | 91 (6 / 4) |
| Veriff | greenhouse | `veriff` | EE | — | EE | 10 (0 / 0) |
| Wayve | ashby | `wayve` | GB | — | GB | 194 (3 / 13) |
| Wikimedia Foundation | greenhouse | `wikimedia` | XW | — | US | 13 (2 / 0) |
| Wix | smartrecruiters | `wix2` | LT | — | IL | 69 (2 / 4) |
| Wiz | greenhouse | `wizinc` | US | — | US | 138 (20 / 5) |
| Wolt | greenhouse | `wolt` | FI | — | FI | 217 (0 / 1) |
| Yubico | greenhouse | `yubico` | SE | — | SE | 16 (1 / 1) |
| Zapier | ashby | `zapier` | XW | — | US | 11 (0 / 0) |
| Zopa | lever | `zopa` | GB | GB | GB | 34 (1 / 1) |
| Zscaler | greenhouse | `zscaler` | US | — | US | 365 (31 / 20) |

## How the seed treats sources

- Natural keys: platforms by `key`; sources by the connector's `source_key` (for example `greenhouse:acmecorp`). Every source config is validated against its connector's schema at seed time; an invalid config, an unknown platform or a forbidden platform stops the seed (nothing is written).
- New platforms are inserted with `terms_reviewed_at = NULL`. A platform row is refreshed from the seed data only while the seed created it, nobody edited it and its terms are not owner-reviewed.
- New sources are inserted as `trial` with an empty checklist. A source is refreshed (label, config, country hint, notes) only while it is still `trial` and its notes still start with "Seeded ". **Once the owner changes its status** (live, paused, disabled, …) or edits its notes, the seed never touches it again.
- Companies are matched to existing rows by `ats_slug` alias, then normalised name / alias, then domain (following merges). An existing company only has empty fields filled (domain, HQ country, an `unknown` type); names, notes and merges are never changed.

## Adding a company board

1. Find the company's public board on one of the supported platforms and open its public API URL in a browser (for example `https://boards-api.greenhouse.io/v1/boards/<board>/jobs`, `https://api.lever.co/v0/postings/<company>?mode=json`, `https://api.ashbyhq.com/posting-api/job-board/<org>`). Check that it answers and has relevant postings.
2. Add an entry to `SEED_COMPANIES` in `src/data/seed/companies.ts`: name, domain, HQ country (or `null`), type, platform, connector `config`, `hubCountry`, `singleCountry` (true only if nearly all postings are in the hub country), aliases, and the `check` you made (date, counts, top locations).
3. Run `npx vitest run tests/seed` (the config must parse and the board must be unique), then `npm run db:seed`. The new company and its `trial` source are inserted; nothing else changes.
4. Work through the §7.4 checklist before making the source live.

Sources and companies created outside the seed (by the pipeline or by hand) are never removed. The seed leaves such sources alone and only fills empty fields of such companies (see above).

## Adding a source on a new platform

1. Read the platform's terms. If they forbid automated access, stop: register it as `forbidden` (manual only) or not at all.
2. A connector must exist in `src/lib/connectors/` (with saved sample responses and parser tests, spec §7.4).
3. Add the platform to `SEED_PLATFORMS` (terms notes starting with the "auto-reviewed … owner must confirm" prefix if it was not the owner who read them) and the instance to `SEED_SOURCES`, then run the seed tests and `npm run db:seed`.

## Spec §7.4 checklist — state after seeding

For **every** seeded source all seven items are open: the seed does not tick anything. In particular the terms item stays open even though the build assistant read the terms, because only the owner may record the review.
