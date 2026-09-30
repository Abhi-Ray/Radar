/**
 * Seed data: source platforms (spec §7.2 registry) and the aggregator / government source
 * instances. Company career-board instances come from `companies.ts`.
 *
 * Terms of use were read by the build assistant on 2026-09-30 (quotes and evidence in
 * docs/SOURCES.md). That is NOT an owner review: `termsReviewedAt` stays NULL and every note says
 * so, so the §7.4 "terms reviewed and recorded, with a date" item stays open until the owner
 * confirms it on the Sources page.
 *
 * Grades (spec §7.1): government APIs are A. Company boards on public hiring-platform APIs are
 * seeded A (the spec table says B) because the pipeline treats only grade A listings as proof that
 * a posting is still live (`listingConfirmsLive`), and a company's own board is exactly that
 * proof. Aggregators and remote boards are D as in the spec (their connector default is B); the
 * DB grade overrides the connector default.
 *
 * Every new source instance starts as 'trial': it runs, but is not "live" until the checklist is
 * done. Rates and caps are the connector defaults, which are deliberately polite.
 */
import type { Grade } from '../../lib/connectors/types';

export const TERMS_REVIEW_DATE = '2026-09-30';
export const TERMS_REVIEW_PREFIX = `auto-reviewed ${TERMS_REVIEW_DATE} by build assistant — owner must confirm.`;

export type TermsStatus = 'allowed' | 'restricted' | 'unknown' | 'forbidden';

export interface SeedPlatform {
  key: string;
  name: string;
  grade: Grade;
  /** api | feed | ats_json | xml | manual */
  accessMethod: string;
  termsUrl: string;
  termsStatus: TermsStatus;
  /** Always starts with TERMS_REVIEW_PREFIX. */
  termsNotes: string;
  rateLimitPerMin: number;
  dailyCap: number;
  /** True when a connector exists for this key (false = manual cross-checking only). */
  hasConnector: boolean;
}

function notes(text: string): string {
  return `${TERMS_REVIEW_PREFIX} ${text}`;
}

export const SEED_PLATFORMS: readonly SeedPlatform[] = [
  // ---- company career boards (public hiring-platform APIs)
  {
    key: 'greenhouse',
    name: 'Greenhouse Job Board API',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://developers.greenhouse.io/job-board.html',
    termsStatus: 'allowed',
    termsNotes: notes(
      'Documented public Job Board API: unauthenticated GET endpoints that companies publish so their open jobs can be listed anywhere. Keep one request per board per run, link every job back to its original posting and never submit applications through the API (that needs the company key).',
    ),
    rateLimitPerMin: 30,
    dailyCap: 1000,
    hasConnector: true,
  },
  {
    key: 'lever',
    name: 'Lever Postings API',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://github.com/lever/postings-api',
    termsStatus: 'allowed',
    termsNotes: notes(
      'Documented public postings API (api.lever.co, api.eu.lever.co for EU accounts) that companies use for their own job sites. Read-only use of published postings, link back to jobs.lever.co; the apply endpoint needs a company key and is not used.',
    ),
    rateLimitPerMin: 30,
    dailyCap: 1000,
    hasConnector: true,
  },
  {
    key: 'ashby',
    name: 'Ashby Job Posting API',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    termsStatus: 'allowed',
    termsNotes: notes(
      'Documented public job posting API (api.ashbyhq.com/posting-api/job-board/{org}); only listed postings are returned. Read-only, polite rate, link back to jobs.ashbyhq.com.',
    ),
    rateLimitPerMin: 30,
    dailyCap: 1000,
    hasConnector: true,
  },
  {
    key: 'smartrecruiters',
    name: 'SmartRecruiters Posting API',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://developers.smartrecruiters.com/docs/posting-api',
    termsStatus: 'allowed',
    termsNotes: notes(
      'Documented public Posting API for published job ads (no key needed). The list has no descriptions, so detail requests are capped per run; big companies are narrowed with a keyword query. Link back to jobs.smartrecruiters.com.',
    ),
    rateLimitPerMin: 30,
    dailyCap: 1500,
    hasConnector: true,
  },
  {
    key: 'workable',
    name: 'Workable jobs widget',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://workable.readme.io/docs/jobs-widget',
    termsStatus: 'restricted',
    termsNotes: notes(
      'Public widget endpoint (apply.workable.com/api/v1/widget/accounts/{slug}) meant for embedding a company’s own job list; not a general data API. Low rate, one request per board per run, link back to apply.workable.com, stop if Workable objects.',
    ),
    rateLimitPerMin: 20,
    dailyCap: 500,
    hasConnector: true,
  },
  {
    key: 'recruitee',
    name: 'Recruitee careers-site API',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://docs.recruitee.com/reference/offers',
    termsStatus: 'restricted',
    termsNotes: notes(
      'Public careers-site endpoint ({slug}.recruitee.com/api/offers/) used by the company’s own careers page. Read-only, low rate, link back to the company careers page.',
    ),
    rateLimitPerMin: 20,
    dailyCap: 500,
    hasConnector: true,
  },
  {
    key: 'personio',
    name: 'Personio XML job feed',
    grade: 'A',
    accessMethod: 'xml',
    termsUrl: 'https://developer.personio.de/docs/retrieving-open-job-positions',
    termsStatus: 'restricted',
    termsNotes: notes(
      'Public XML feed ({slug}.jobs.personio.de/xml) that Personio documents for showing open positions on a company’s own site and job boards. One request per tenant per run, link back to the company’s Personio job page.',
    ),
    rateLimitPerMin: 20,
    dailyCap: 500,
    hasConnector: true,
  },

  // ---- government job boards
  {
    key: 'bundesagentur',
    name: 'Bundesagentur für Arbeit (Jobsuche)',
    grade: 'A',
    accessMethod: 'api',
    termsUrl: 'https://jobsuche.api.bund.dev/',
    termsStatus: 'unknown',
    termsNotes: notes(
      'Official job search of the German Federal Employment Agency, used through its public client key. The only documentation is the community project bund.dev; no official terms of use for this API were found. Attribution "Quelle: Bundesagentur für Arbeit", capped detail requests, temp-agency postings excluded. Owner: decide whether to accept the unclear terms before making it live.',
    ),
    rateLimitPerMin: 20,
    dailyCap: 600,
    hasConnector: true,
  },
  {
    key: 'jobtech_se',
    name: 'JobTech JobSearch (Arbetsförmedlingen)',
    grade: 'A',
    accessMethod: 'api',
    termsUrl: 'https://jobtechdev.se/en/components/jobsearch',
    termsStatus: 'allowed',
    termsNotes: notes(
      'Swedish Public Employment Service open data (JobSearch API over Platsbanken), published as open data under CC0 per JobTech Dev. The docs page did not resolve from the build machine on 2026-09-30, so this is from background knowledge: re-read it before going live. Attribution "Arbetsförmedlingen (Platsbanken)".',
    ),
    rateLimitPerMin: 30,
    dailyCap: 400,
    hasConnector: true,
  },
  {
    key: 'nav_no',
    name: 'NAV Arbeidsplassen (stillingsfeed)',
    grade: 'A',
    accessMethod: 'feed',
    termsUrl: 'https://arbeidsplassen.nav.no/vilkar-api',
    termsStatus: 'restricted',
    termsNotes: notes(
      'NAV terms for the public job feed (read 2026-09-30): free to use, NAV may stop access on misuse; ads must be removed at once when they are inactive or deleted in the feed and updated when they change; the apply button must deep-link to the source ad; the user of the feed is a separate controller for any personal data in ads. Uses the public rotating token (docs: https://navikt.github.io/pam-stilling-feed/). Attribution "Kilde: NAV / arbeidsplassen.no".',
    ),
    rateLimitPerMin: 30,
    dailyCap: 400,
    hasConnector: true,
  },

  // ---- aggregators and remote boards (grade D per spec §7.1)
  {
    key: 'arbeitnow',
    name: 'Arbeitnow',
    grade: 'D',
    accessMethod: 'api',
    termsUrl: 'https://www.arbeitnow.com/blog/job-board-api',
    termsStatus: 'restricted',
    termsNotes: notes('Free public Job Board API, no key. Link back to Arbeitnow (attribution "via Arbeitnow"). Aggregated, often reposted from company boards: grade D.'),
    rateLimitPerMin: 10,
    dailyCap: 60,
    hasConnector: true,
  },
  {
    key: 'remotive',
    name: 'Remotive',
    grade: 'D',
    accessMethod: 'api',
    termsUrl: 'https://remotive.com/api-documentation',
    termsStatus: 'restricted',
    termsNotes: notes(
      'Public API: at most ~4 requests a day, jobs are shown with a 24 h delay, you must link back to the Remotive job page and credit Remotive. The docs page was behind a bot check on 2026-09-30, so this is from the connector notes and background knowledge: re-read before going live.',
    ),
    rateLimitPerMin: 2,
    dailyCap: 4,
    hasConnector: true,
  },
  {
    key: 'remoteok',
    name: 'Remote OK',
    grade: 'D',
    accessMethod: 'api',
    termsUrl: 'https://remoteok.com/api',
    termsStatus: 'restricted',
    termsNotes: notes('Public API (latest jobs). Its legal notice asks to link back (follow link) to the Remote OK job page and mention Remote OK as the source; do not use the Remote OK logo, or API access is suspended.'),
    rateLimitPerMin: 1,
    dailyCap: 4,
    hasConnector: true,
  },
  {
    key: 'himalayas',
    name: 'Himalayas',
    grade: 'D',
    accessMethod: 'api',
    termsUrl: 'https://himalayas.app/api',
    termsStatus: 'restricted',
    termsNotes: notes(
      'Free public JSON API. Terms on the API page: link back to the Himalayas job page and mention Himalayas as the source; do not submit its jobs to third-party sites or aggregators (Jooble, Google Jobs, LinkedIn …); at most 20 jobs per request (since 24 Mar 2025).',
    ),
    rateLimitPerMin: 10,
    dailyCap: 120,
    hasConnector: true,
  },
  {
    key: 'jobicy',
    name: 'Jobicy',
    grade: 'D',
    accessMethod: 'api',
    termsUrl: 'https://jobicy.com/jobs-rss-feed',
    termsStatus: 'restricted',
    termsNotes: notes('Public remote-jobs API and feeds, free, API key optional. Credit Jobicy with a direct link to the Jobicy job page; apply through the original URL; keep requests infrequent.'),
    rateLimitPerMin: 2,
    dailyCap: 24,
    hasConnector: true,
  },

  // ---- forbidden: manual cross-checking only (spec §7.3), no connector and no sources
  {
    key: 'linkedin',
    name: 'LinkedIn (manual only)',
    grade: 'D',
    accessMethod: 'manual',
    termsUrl: 'https://www.linkedin.com/legal/user-agreement',
    termsStatus: 'forbidden',
    termsNotes: notes('User Agreement forbids using "software, devices, scripts, robots or any other means or processes (including crawlers, browser plugins and add-ons …) to scrape or copy the Services". Never automated: open it by hand to cross-check a job or a recruiter.'),
    rateLimitPerMin: 0,
    dailyCap: 0,
    hasConnector: false,
  },
  {
    key: 'indeed',
    name: 'Indeed (manual only)',
    grade: 'D',
    accessMethod: 'manual',
    termsUrl: 'https://www.indeed.com/legal',
    termsStatus: 'forbidden',
    termsNotes: notes('Terms forbid using "any automated system (bots, scrapers, spiders, AI …) to access, data-mine" the site without Indeed’s express written permission. Manual cross-checking only.'),
    rateLimitPerMin: 0,
    dailyCap: 0,
    hasConnector: false,
  },
  {
    key: 'glassdoor',
    name: 'Glassdoor (manual only)',
    grade: 'D',
    accessMethod: 'manual',
    termsUrl: 'https://www.glassdoor.com/about/terms',
    termsStatus: 'forbidden',
    termsNotes: notes('Terms forbid introducing "software or automated agents … to scrape, strip, or mine data" from the site. Manual cross-checking only (salaries, reviews).'),
    rateLimitPerMin: 0,
    dailyCap: 0,
    hasConnector: false,
  },
];

export const FORBIDDEN_PLATFORM_KEYS = SEED_PLATFORMS.filter((p) => p.termsStatus === 'forbidden').map((p) => p.key);

export interface SeedSource {
  platformKey: string;
  /** Connector config (validated against the connector's configSchema in tests and at seed time). */
  config: Record<string, unknown>;
  label: string;
  /**
   * The pipeline's location hint (normalise → normalizeLocation): it wins when the
   * posting's location is vague ("Remote", "HQ") and marks postings elsewhere low-confidence, so it
   * is only set when (nearly) every posting of the source is in that country.
   */
  countryIso2: string | null;
  notes: string;
}

const TRIAL_NOTE = 'Seeded 2026-09-30 as trial: runs, but is not live until the spec §7.4 checklist is done.';

/** Aggregator and government instances (spec §3 roles). Company boards: see `companies.ts`. */
export const SEED_SOURCES: readonly SeedSource[] = [
  {
    platformKey: 'bundesagentur',
    config: {
      queries: [
        { was: 'Cloud Security' },
        { was: 'DevSecOps' },
        { was: 'Application Security' },
        { was: 'Product Security' },
        { was: 'Security Engineer' },
        { was: 'IT-Sicherheit Cloud' },
        { was: 'Cloud Engineer' },
        { was: 'Security Analyst' },
      ],
    },
    label: 'Bundesagentur für Arbeit — cloud & security roles (DE)',
    countryIso2: 'DE',
    notes: `${TRIAL_NOTE} Primary and secondary roles, Germany-wide, last 7 days, temp agencies excluded.`,
  },
  {
    platformKey: 'bundesagentur',
    config: {
      queries: [{ was: 'Full Stack Developer' }, { was: 'Fullstack Entwickler' }, { was: 'Node.js' }, { was: 'Next.js' }],
      maxDetails: 20,
    },
    label: 'Bundesagentur für Arbeit — full-stack fallback (DE)',
    countryIso2: 'DE',
    notes: `${TRIAL_NOTE} Fallback roles (full-stack / Node / Next.js); fewer detail requests.`,
  },
  {
    platformKey: 'jobtech_se',
    config: {
      queries: ['IT-säkerhet', 'informationssäkerhet', 'security engineer', 'cloud security', 'devsecops', 'application security', 'molnsäkerhet'],
    },
    label: 'JobTech (Platsbanken) — cloud & security roles (SE)',
    countryIso2: 'SE',
    notes: `${TRIAL_NOTE} Swedish and English queries, last 14 days.`,
  },
  {
    platformKey: 'nav_no',
    config: {},
    label: 'NAV Arbeidsplassen — job feed (NO)',
    countryIso2: 'NO',
    notes: `${TRIAL_NOTE} Whole Norwegian feed, title pre-filter on. NAV terms: remove inactive ads at once, deep-link apply.`,
  },
  {
    platformKey: 'arbeitnow',
    config: {},
    label: 'Arbeitnow — all jobs (mostly DE)',
    // Mostly German, but also AT/CH/NL jobs: no country hint (a hint would win over vague text).
    countryIso2: null,
    notes: `${TRIAL_NOTE} Newest pages only, title pre-filter on.`,
  },
  {
    platformKey: 'remotive',
    config: { categories: ['software-dev', 'devops'] },
    label: 'Remotive — software-dev + devops (remote)',
    countryIso2: 'XW',
    notes: `${TRIAL_NOTE} At most ~4 requests a day; jobs arrive 24 h late.`,
  },
  {
    platformKey: 'remoteok',
    config: {},
    label: 'Remote OK — latest jobs (remote)',
    countryIso2: 'XW',
    notes: `${TRIAL_NOTE} Latest jobs only, title pre-filter on; no logo use.`,
  },
  {
    platformKey: 'himalayas',
    config: {},
    label: 'Himalayas — remote jobs',
    countryIso2: 'XW',
    notes: `${TRIAL_NOTE} Do not pass its jobs on to other sites (Himalayas terms).`,
  },
  {
    platformKey: 'jobicy',
    config: { tags: ['security', 'devops'] },
    label: 'Jobicy — security + devops (remote)',
    countryIso2: 'XW',
    notes: `${TRIAL_NOTE} Tag search, 50 newest.`,
  },
];
