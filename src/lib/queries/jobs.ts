/**
 * /jobs list and /jobs/[id] detail reads (server only).
 *
 * The list rules mirror `passesRule()` in src/components/jobs/filters.ts one to one — same meaning,
 * written once in TS and once here in SQL (tests/jobs/queries-db.test.ts checks that both agree on
 * the same rows). Every query goes through Drizzle or the `sql` template with bound parameters.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  applications,
  auditLog,
  companies,
  corrections,
  countries,
  jobChanges,
  jobOverrides,
  jobScores,
  jobSources,
  jobs,
  linkChecks,
  sourcePlatforms,
  sources,
  visaRoutes,
  visaRuleVersions,
  type CompanyRow,
  type CountryRow,
  type JobRow,
  type VisaRuleVersionRow,
} from '@/db/schema';
import { ELIGIBILITY_RESULTS } from '@/db/schema/_enums';
import {
  CLOSED_STATES,
  JOBS_PAGE_SIZE,
  LIMITED_REMOTE,
  activeDefaultRules,
  activeRules,
  confidenceAtLeast,
  postedSince,
  type HiddenBreakdown,
  type JobFilters,
  type RuleId,
  type VisaStatusKey,
} from '@/components/jobs/filters';
import { EDITABLE_FIELDS, type EditableField } from '@/components/jobs/field-edit';
import { formDefaults } from '@/components/jobs/field-values';
import {
  roleKeyLabel,
  type CompanyType,
  type ConfidenceKey,
  type ExperienceBandKey,
  type JobState,
  type LanguageRequirement,
  type LinkStatus,
  type RemoteClass,
  type RoleFamily,
  type SeniorityWord,
  type WorkplaceType,
} from '@/components/jobs/labels';
import { getAiBudget, type AiBudget } from '@/lib/ai';
import type { EligibilityResult, EligibilityValue, SalaryValue, ScoreComponent } from '@/lib/contracts/jobs';
import type { Fact, StoredFact } from '@/lib/contracts/provenance';
import { getDb, type DbOrTx } from '@/lib/db';
import { log } from '@/lib/log';
import { getFacts, getOverrides, resolveJobFacts, type OverrideLike, type ResolvedFacts } from '@/lib/provenance/store';
import { getSetting } from '@/lib/settings';
import { DAY_MS, utcDay } from '@/lib/time';
import { checkEligibility } from '@/lib/visa/eligibility';

// ---- rule → SQL ------------------------------------------------------------------------------

/** `%needle%` for LIKE, with the LIKE metacharacters escaped (MySQL's default escape is `\`). */
export function likeNeedle(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** Correlated: the job has an application past the "saved" stage. */
const appliedExists = sql`EXISTS (SELECT 1 FROM ${applications} WHERE ${applications.jobId} = ${jobs.id} AND ${applications.currentStage} <> ${'saved'})`;

/**
 * SQL for one rule over `jobs` INNER JOIN `companies`. `undefined` = the rule is off (passes all).
 * Keep in lock-step with `passesRule()`.
 */
export function ruleCondition(id: RuleId, f: JobFilters, now: Date): SQL | undefined {
  switch (id) {
    case 'remote_limited':
      return or(isNull(jobs.remoteClass), notInArray(jobs.remoteClass, [...LIMITED_REMOTE]));
    case 'experience_band':
      return or(isNull(jobs.experienceBand), ne(jobs.experienceBand, 'hide'));
    case 'target_roles':
      return or(ne(jobs.roleFamily, 'other'), eq(jobs.saved, true), appliedExists);
    case 'closed':
      return notInArray(jobs.state, [...CLOSED_STATES]);
    case 'hidden':
      return eq(jobs.hidden, false);
    case 'q': {
      if (!f.q) return undefined;
      const needle = likeNeedle(f.q);
      return or(sql`LOWER(${jobs.canonicalTitle}) LIKE ${needle}`, sql`LOWER(${companies.name}) LIKE ${needle}`);
    }
    case 'country':
      return f.country.length ? inArray(jobs.countryIso2, f.country) : undefined;
    case 'remote':
      return f.remote.length ? inArray(jobs.remoteClass, f.remote) : undefined;
    case 'family':
      return f.family.length ? inArray(jobs.roleFamily, f.family) : undefined;
    case 'role':
      return f.role.length ? inArray(jobs.roleKey, f.role) : undefined;
    case 'size':
      return f.size.length ? inArray(companies.sizeBand, f.size) : undefined;
    case 'ctype':
      if (!f.ctype.length) return undefined;
      return f.ctype.includes('agency') ? or(inArray(companies.type, f.ctype), eq(companies.isAgency, true)) : inArray(companies.type, f.ctype);
    case 'visa':
      return f.visa.length ? inArray(sql`COALESCE(${jobs.visaStatus}, ${'unknown'})`, f.visa) : undefined;
    case 'salary':
      return f.salary === null ? undefined : sql`COALESCE(${jobs.salaryEurMax}, ${jobs.salaryEurMin}) >= ${f.salary}`;
    case 'stated':
      return f.stated ? eq(jobs.salaryKind, 'stated') : undefined;
    case 'posted':
      return f.posted === null ? undefined : sql`COALESCE(${jobs.postedAt}, ${jobs.firstSeenAt}) >= ${postedSince(f.posted, now)}`;
    case 'source':
      if (!f.source.length) return undefined;
      return sql`EXISTS (SELECT 1 FROM ${jobSources} INNER JOIN ${sources} ON ${sources.id} = ${jobSources.sourceId} WHERE ${jobSources.jobId} = ${jobs.id} AND ${inArray(sources.platformKey, f.source)})`;
    case 'fit':
      return f.fit === null ? undefined : sql`${jobs.score} >= ${f.fit}`;
    case 'conf':
      return f.conf === null ? undefined : inArray(jobs.factsConfidence, confidenceAtLeast(f.conf));
    case 'state':
      return f.state.length ? inArray(jobs.state, f.state) : undefined;
    case 'mine': {
      if (!f.mine.length) return undefined;
      const parts: SQL[] = [];
      if (f.mine.includes('saved')) parts.push(eq(jobs.saved, true));
      if (f.mine.includes('applied')) parts.push(appliedExists);
      if (f.mine.includes('hidden')) parts.push(eq(jobs.hidden, true));
      return or(...parts);
    }
  }
}

const notMerged = isNull(jobs.mergedIntoJobId);

/** Every active rule ANDed (the rows actually shown). */
function shownWhere(f: JobFilters, now: Date): SQL | undefined {
  return and(notMerged, ...activeRules(f).map((r) => ruleCondition(r.id, f, now)));
}

/** Only the default-view rules (what the facet counts are taken over). */
function defaultWhere(f: JobFilters, now: Date): SQL | undefined {
  return and(notMerged, ...activeDefaultRules(f).map((id) => ruleCondition(id, f, now)));
}

// ---- breakdown -------------------------------------------------------------------------------

/**
 * The "N hidden by filters" numbers in one pass: one 0/1 fail flag per active rule, grouped, so
 * every rule is evaluated once per job. Mirrors `breakdownOf()`.
 */
export async function hiddenBreakdown(db: DbOrTx, f: JobFilters, now: Date): Promise<HiddenBreakdown> {
  const rules = activeRules(f);
  const flags: Record<string, SQL.Aliased<number>> = {};
  rules.forEach((r, i) => {
    const cond = ruleCondition(r.id, f, now) ?? sql`TRUE`;
    flags[`f${i}`] = sql<number>`CASE WHEN ${cond} THEN 0 ELSE 1 END`.as(`f${i}`);
  });
  const base = db
    .select({ ...flags, n: sql<number>`COUNT(*)`.as('n') })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(notMerged);
  const grouped = rules.length ? base.groupBy(...rules.map((_, i) => sql.raw(`\`f${i}\``))) : base;
  const rows = (await grouped) as unknown as Record<string, unknown>[];

  const counts = rules.map(() => 0);
  let total = 0;
  let shown = 0;
  let multi = 0;
  for (const row of rows) {
    const n = Number(row.n) || 0;
    total += n;
    const failed = rules.map((_, i) => Number(row[`f${i}`]) === 1);
    const failCount = failed.filter(Boolean).length;
    if (failCount === 0) shown += n;
    else if (failCount === 1) counts[failed.indexOf(true)] += n;
    else multi += n;
  }
  return { total, shown, hidden: total - shown, byRule: rules.map((rule, i) => ({ rule, count: counts[i] })), multi };
}

// ---- list ------------------------------------------------------------------------------------

export type Grade = 'A' | 'B' | 'C' | 'D';

export interface JobListRow {
  id: number;
  title: string;
  company: string;
  companyId: number;
  isAgency: boolean;
  companyType: CompanyType;
  companySize: string | null;
  countryIso2: string | null;
  countryName: string | null;
  city: string | null;
  locationRaw: string;
  workplaceType: WorkplaceType | null;
  remoteClass: RemoteClass | null;
  roleKey: string | null;
  roleFamily: RoleFamily;
  visaStatus: VisaStatusKey | null;
  visaConfidence: ConfidenceKey | null;
  eligibility: EligibilityResult | null;
  salaryEurMin: number | null;
  salaryEurMax: number | null;
  salaryKind: 'stated' | 'estimated' | null;
  score: number | null;
  factsConfidence: ConfidenceKey | null;
  experienceBand: ExperienceBandKey | null;
  experienceMinYears: number | null;
  seniority: SeniorityWord | null;
  languageRequirement: LanguageRequirement | null;
  state: JobState;
  ghostRisk: boolean;
  linkStatus: LinkStatus;
  linkCheckedAt: Date | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastConfirmedLiveAt: Date | null;
  resolvedAt: Date | null;
  hidden: boolean;
  saved: boolean;
  applied: boolean;
  needsReview: boolean;
  repostCount: number;
  bestGrade: Grade | null;
  sourceCount: number;
}

const GRADE_SET = new Set<string>(['A', 'B', 'C', 'D']);

function toGrade(v: unknown): Grade | null {
  return typeof v === 'string' && GRADE_SET.has(v) ? (v as Grade) : null;
}

function toBool(v: unknown): boolean {
  return v === true || Number(v) === 1;
}

/** Card columns (shared by the list, the desk and the ticker). */
export const listColumns = {
  id: jobs.id,
  title: jobs.canonicalTitle,
  company: companies.name,
  companyId: companies.id,
  isAgency: companies.isAgency,
  companyType: companies.type,
  companySize: companies.sizeBand,
  countryIso2: jobs.countryIso2,
  countryName: countries.name,
  city: jobs.city,
  locationRaw: jobs.locationRaw,
  workplaceType: jobs.workplaceType,
  remoteClass: jobs.remoteClass,
  roleKey: jobs.roleKey,
  roleFamily: jobs.roleFamily,
  visaStatus: jobs.visaStatus,
  visaConfidence: jobs.visaConfidence,
  eligibility: jobs.eligibility,
  salaryEurMin: jobs.salaryEurMin,
  salaryEurMax: jobs.salaryEurMax,
  salaryKind: jobs.salaryKind,
  score: jobs.score,
  factsConfidence: jobs.factsConfidence,
  experienceBand: jobs.experienceBand,
  experienceMinYears: jobs.experienceMinYears,
  seniority: jobs.seniority,
  languageRequirement: jobs.languageRequirement,
  state: jobs.state,
  ghostRisk: jobs.ghostRisk,
  linkStatus: jobs.linkStatus,
  linkCheckedAt: jobs.linkCheckedAt,
  postedAt: jobs.postedAt,
  firstSeenAt: jobs.firstSeenAt,
  lastSeenAt: jobs.lastSeenAt,
  lastConfirmedLiveAt: jobs.lastConfirmedLiveAt,
  resolvedAt: jobs.resolvedAt,
  hidden: jobs.hidden,
  saved: jobs.saved,
  needsReview: jobs.needsReview,
  repostCount: jobs.repostCount,
  applied: sql<number>`${appliedExists}`,
  bestGrade: sql<string | null>`(SELECT MIN(${jobSources.grade}) FROM ${jobSources} WHERE ${jobSources.jobId} = ${jobs.id})`,
  sourceCount: sql<number>`(SELECT COUNT(*) FROM ${jobSources} WHERE ${jobSources.jobId} = ${jobs.id})`,
};

type RawListRow = {
  [K in keyof typeof listColumns]: unknown;
};

export function toListRow(r: RawListRow): JobListRow {
  const row = r as Omit<JobListRow, 'applied' | 'bestGrade' | 'sourceCount'> & { applied: unknown; bestGrade: unknown; sourceCount: unknown };
  return {
    ...row,
    isAgency: toBool(row.isAgency),
    ghostRisk: toBool(row.ghostRisk),
    hidden: toBool(row.hidden),
    saved: toBool(row.saved),
    needsReview: toBool(row.needsReview),
    applied: toBool(row.applied),
    bestGrade: toGrade(row.bestGrade),
    sourceCount: Number(row.sourceCount) || 0,
  };
}

function orderFor(f: JobFilters): SQL[] {
  const top = sql`COALESCE(${jobs.salaryEurMax}, ${jobs.salaryEurMin})`;
  switch (f.sort) {
    case 'posted':
      return [desc(sql`COALESCE(${jobs.postedAt}, ${jobs.firstSeenAt})`), desc(jobs.id)];
    case 'salary':
      return [sql`${top} IS NULL`, desc(top), sql`${jobs.score} IS NULL`, desc(jobs.score), desc(jobs.id)];
    case 'fit':
      return [sql`${jobs.score} IS NULL`, desc(jobs.score), desc(jobs.firstSeenAt), desc(jobs.id)];
  }
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface JobFacets {
  countries: FacetOption[];
  roles: FacetOption[];
  sizes: FacetOption[];
  platforms: FacetOption[];
}

const FACET_LIMIT = 80;

/** Keeps the selected values in the list even when nothing in the view carries them. */
function withSelected(options: FacetOption[], selected: readonly string[], label: (v: string) => string = (v) => v): FacetOption[] {
  const have = new Set(options.map((o) => o.value));
  const missing = selected.filter((v) => !have.has(v)).map((v) => ({ value: v, label: label(v), count: 0 }));
  return [...options, ...missing];
}

export async function jobFacets(db: DbOrTx, f: JobFilters, now: Date): Promise<JobFacets> {
  const where = defaultWhere(f, now);
  const n = sql<number>`COUNT(*)`.mapWith(Number);
  const [countryRows, roleRows, sizeRows, platformRows] = await Promise.all([
    db
      .select({ value: jobs.countryIso2, label: countries.name, count: n })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(countries, eq(countries.iso2, jobs.countryIso2))
      .where(and(where, isNotNull(jobs.countryIso2)))
      .groupBy(jobs.countryIso2, countries.name)
      .orderBy(desc(n), jobs.countryIso2)
      .limit(FACET_LIMIT),
    db
      .select({ value: jobs.roleKey, count: n })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(where, isNotNull(jobs.roleKey)))
      .groupBy(jobs.roleKey)
      .orderBy(desc(n), jobs.roleKey)
      .limit(FACET_LIMIT),
    db
      .select({ value: companies.sizeBand, count: n })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(and(where, isNotNull(companies.sizeBand)))
      .groupBy(companies.sizeBand)
      .orderBy(companies.sizeBand)
      .limit(FACET_LIMIT),
    db
      .select({ value: sources.platformKey, label: sourcePlatforms.name, count: sql<number>`COUNT(DISTINCT ${jobs.id})`.mapWith(Number) })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .innerJoin(jobSources, eq(jobSources.jobId, jobs.id))
      .innerJoin(sources, eq(sources.id, jobSources.sourceId))
      .innerJoin(sourcePlatforms, eq(sourcePlatforms.key, sources.platformKey))
      .where(where)
      .groupBy(sources.platformKey, sourcePlatforms.name)
      .orderBy(sourcePlatforms.name)
      .limit(FACET_LIMIT),
  ]);
  return {
    countries: withSelected(
      countryRows.filter((r): r is typeof r & { value: string } => r.value !== null).map((r) => ({ value: r.value, label: r.label ?? r.value, count: r.count })),
      f.country,
    ),
    roles: withSelected(
      roleRows.filter((r): r is typeof r & { value: string } => r.value !== null).map((r) => ({ value: r.value, label: roleKeyLabel(r.value), count: r.count })),
      f.role,
      roleKeyLabel,
    ),
    sizes: withSelected(
      sizeRows.filter((r): r is typeof r & { value: string } => r.value !== null).map((r) => ({ value: r.value, label: r.value, count: r.count })),
      f.size,
    ),
    platforms: withSelected(
      platformRows.map((r) => ({ value: r.value, label: r.label, count: r.count })),
      f.source,
    ),
  };
}

export interface JobListResult {
  /** The filters actually applied (page clamped to the last page). */
  filters: JobFilters;
  rows: JobListRow[];
  /** Rows passing every rule (= breakdown.shown). */
  total: number;
  pageSize: number;
  breakdown: HiddenBreakdown;
  facets: JobFacets;
  asOf: Date;
}

export async function listJobs(f: JobFilters, opts: { db?: DbOrTx; now?: Date } = {}): Promise<JobListResult> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const [breakdown, facets] = await Promise.all([hiddenBreakdown(db, f, now), jobFacets(db, f, now)]);
  const lastPage = Math.max(1, Math.ceil(breakdown.shown / JOBS_PAGE_SIZE));
  const page = Math.min(Math.max(1, f.page), lastPage);
  const raw = breakdown.shown
    ? await db
        .select(listColumns)
        .from(jobs)
        .innerJoin(companies, eq(companies.id, jobs.companyId))
        .leftJoin(countries, eq(countries.iso2, jobs.countryIso2))
        .where(shownWhere(f, now))
        .orderBy(...orderFor(f))
        .limit(JOBS_PAGE_SIZE)
        .offset((page - 1) * JOBS_PAGE_SIZE)
    : [];
  return {
    filters: { ...f, page },
    rows: raw.map(toListRow),
    total: breakdown.shown,
    pageSize: JOBS_PAGE_SIZE,
    breakdown,
    facets,
    asOf: now,
  };
}

// ---- detail ----------------------------------------------------------------------------------

/** A visa rule older than this (or never verified) is flagged stale (spec §13). */
export const RULE_STALE_DAYS = 90;

export interface JobSourceLink {
  id: number;
  url: string;
  grade: Grade;
  firstSeenAt: Date;
  lastSeenAt: Date;
  sourceId: number;
  sourceLabel: string;
  sourceStatus: string;
  platformKey: string;
  platformName: string;
  platformGrade: Grade;
  termsStatus: string;
  isBest: boolean;
}

export interface VisaRuleView {
  routeId: number;
  routeCode: string;
  routeName: string;
  routeUrl: string | null;
  /** null when the route has no rule version yet. */
  rule: VisaRuleVersionRow | null;
  /** The version is in force today. */
  current: boolean;
  verified: boolean;
  ageDays: number | null;
  stale: boolean;
}

export interface EligibilityView {
  fact: Fact<EligibilityValue>;
  /** Not stored on the job: computed for this page view with the current rule and profile. */
  computedNow: boolean;
  rule: VisaRuleView | null;
}

export interface ScoreView {
  score: number;
  version: string;
  computedAt: Date;
  components: ScoreComponent[];
}

export interface JobDetail {
  job: JobRow;
  company: CompanyRow;
  country: CountryRow | null;
  bestGrade: Grade | null;
  applied: boolean;
  sources: JobSourceLink[];
  /** Active candidate facts (the resolver's input). */
  facts: StoredFact[];
  /** All overrides, including replaced / removed ones (newest first). */
  overrides: OverrideLike[];
  /** When replaced / removed overrides stopped applying. */
  overrideEnds: { overrideId: number; at: Date }[];
  /** "Remove override" events from the audit log, with the reason given. */
  overrideClears: { field: string; at: Date; reason: string | null }[];
  resolved: ResolvedFacts;
  /** Displayed visa status ("conflicting" when active evidence disagrees). */
  visaStatus: VisaStatusKey;
  visaRules: VisaRuleView[];
  eligibility: EligibilityView;
  score: ScoreView | null;
  changes: { id: number; field: string; oldValue: string | null; newValue: string | null; changedAt: Date }[];
  linkChecks: { id: number; url: string; statusCode: number | null; ok: boolean; finalUrl: string | null; checkedAt: Date; error: string | null; durationMs: number | null }[];
  applications: { id: number; currentStage: string; appliedAt: Date | null; nextFollowUpAt: Date | null; createdAt: Date }[];
  corrections: { id: number; field: string; note: string | null; createdAt: Date; addedToGolden: boolean }[];
  aiBudget: AiBudget | null;
  aiSummary: { text: string; fact: StoredFact } | null;
  /** Pre-filled inputs for the override / correction forms, per field. */
  formDefaults: Record<EditableField, Record<string, string>>;
  /** Current displayed value per editable field (the "wrong value" of a correction). */
  currentValues: Record<EditableField, unknown>;
  now: Date;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Score components stored as JSON — keep only well-formed entries. */
export function parseScoreComponents(v: unknown): ScoreComponent[] {
  if (!Array.isArray(v)) return [];
  const out: ScoreComponent[] = [];
  for (const c of v) {
    if (!isObj(c)) continue;
    const { key, label, raw, weight, contribution, confidence, reason } = c;
    if (typeof key !== 'string' || typeof contribution !== 'number' || !Number.isFinite(contribution)) continue;
    out.push({
      key,
      label: typeof label === 'string' && label ? label : key,
      raw: typeof raw === 'number' && Number.isFinite(raw) ? raw : 0,
      weight: typeof weight === 'number' && Number.isFinite(weight) ? weight : 0,
      contribution,
      confidence: confidence === 'high' || confidence === 'medium' || confidence === 'low' ? confidence : 'low',
      reason: typeof reason === 'string' ? reason : '',
    });
  }
  return out;
}

/** The ai_summary fact is a string or {summary: string}. */
export function summaryText(v: unknown): string | null {
  if (typeof v === 'string') return v.trim() || null;
  if (isObj(v) && typeof v.summary === 'string') return v.summary.trim() || null;
  return null;
}

/** A salary fact value, if it has the SalaryValue shape. */
export function asSalaryValue(v: unknown): SalaryValue | null {
  if (!isObj(v)) return null;
  if (typeof v.currency !== 'string' || typeof v.period !== 'string') return null;
  return v as unknown as SalaryValue;
}

const ELIGIBILITY_RESULT_SET: ReadonlySet<string> = new Set(ELIGIBILITY_RESULTS);

/**
 * A stored eligibility value, normalised (JSON turns `ruleVerifiedAt` into a string), or null when
 * the shape is not usable — the page then works the answer out afresh instead of crashing.
 */
export function asEligibilityValue(v: unknown): EligibilityValue | null {
  if (!isObj(v) || typeof v.result !== 'string' || !ELIGIBILITY_RESULT_SET.has(v.result)) return null;
  const at = v.ruleVerifiedAt;
  const verified = at instanceof Date ? at : typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? new Date(at) : null;
  return {
    result: v.result as EligibilityResult,
    reason: typeof v.reason === 'string' ? v.reason : '',
    marginPct: typeof v.marginPct === 'number' && Number.isFinite(v.marginPct) ? v.marginPct : null,
    ruleVerifiedAt: verified && !Number.isNaN(verified.getTime()) ? verified : null,
    rule: typeof v.rule === 'string' ? v.rule : null,
  };
}

/** Rule in force on `today` ('YYYY-MM-DD'): effective window contains today; highest version wins. */
export function pickRuleVersion(versions: readonly VisaRuleVersionRow[], today: string): { rule: VisaRuleVersionRow | null; current: boolean } {
  const inForce = versions.filter((v) => (!v.effectiveFrom || v.effectiveFrom <= today) && (!v.effectiveTo || v.effectiveTo >= today));
  const byVersion = (a: VisaRuleVersionRow, b: VisaRuleVersionRow) => b.version - a.version;
  const current = [...inForce].sort(byVersion)[0];
  if (current) return { rule: current, current: true };
  const latest = [...versions].sort(byVersion)[0];
  return { rule: latest ?? null, current: false };
}

export function ruleAge(rule: VisaRuleVersionRow | null, now: Date): { ageDays: number | null; stale: boolean; verified: boolean } {
  const verified = rule?.verificationStatus === 'verified';
  const at = rule?.lastVerifiedAt ?? null;
  const ageDays = at ? Math.floor((now.getTime() - at.getTime()) / DAY_MS) : null;
  return { ageDays, verified, stale: !verified || ageDays === null || ageDays > RULE_STALE_DAYS };
}

function displayedVisaStatus(resolved: ResolvedFacts): VisaStatusKey {
  const r = resolved.visa_status;
  if (!r?.winner) return 'unknown';
  if (r.conflict) return 'conflicting';
  const s = isObj(r.winner.value) ? r.winner.value.status : r.winner.value;
  return s === 'confirmed' || s === 'likely' || s === 'unknown' || s === 'not_offered' || s === 'conflicting' ? s : 'unknown';
}

/** Current value per editable field: the resolved winner for fact fields, the job column otherwise. */
function currentValuesOf(job: JobRow, resolved: ResolvedFacts): Record<EditableField, unknown> {
  const out = {} as Record<EditableField, unknown>;
  for (const field of EDITABLE_FIELDS) {
    switch (field) {
      case 'title':
        out[field] = job.canonicalTitle;
        break;
      case 'country':
        out[field] = job.countryIso2;
        break;
      case 'city':
        out[field] = job.city;
        break;
      case 'workplace_type':
        out[field] = job.workplaceType;
        break;
      default:
        out[field] = resolved[field]?.winner?.value ?? null;
    }
  }
  return out;
}

async function safely<T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn(`job detail: ${what} unavailable`, { err });
    return fallback;
  }
}

export async function getJobDetail(id: number, opts: { db?: DbOrTx; now?: Date } = {}): Promise<JobDetail | null> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const [head] = await db
    .select({
      job: jobs,
      company: companies,
      country: countries,
      applied: sql<number>`${appliedExists}`,
      bestGrade: sql<string | null>`(SELECT MIN(${jobSources.grade}) FROM ${jobSources} WHERE ${jobSources.jobId} = ${jobs.id})`,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(countries, eq(countries.iso2, jobs.countryIso2))
    .where(eq(jobs.id, id))
    .limit(1);
  if (!head) return null;
  const { job } = head;

  const [sourceRows, facts, overrides, changes, scoreRows, checks, apps, corr, routes, profile, ends, clears] = await Promise.all([
    db
      .select({
        id: jobSources.id,
        url: jobSources.url,
        grade: jobSources.grade,
        firstSeenAt: jobSources.firstSeenAt,
        lastSeenAt: jobSources.lastSeenAt,
        sourceId: sources.id,
        sourceLabel: sources.label,
        sourceStatus: sources.status,
        platformKey: sourcePlatforms.key,
        platformName: sourcePlatforms.name,
        platformGrade: sourcePlatforms.grade,
        termsStatus: sourcePlatforms.termsStatus,
      })
      .from(jobSources)
      .innerJoin(sources, eq(sources.id, jobSources.sourceId))
      .innerJoin(sourcePlatforms, eq(sourcePlatforms.key, sources.platformKey))
      .where(eq(jobSources.jobId, id))
      .orderBy(jobSources.grade, desc(jobSources.lastSeenAt)),
    getFacts(db, id),
    getOverrides(db, id, { includeInactive: true }),
    db
      .select({ id: jobChanges.id, field: jobChanges.field, oldValue: jobChanges.oldValue, newValue: jobChanges.newValue, changedAt: jobChanges.changedAt })
      .from(jobChanges)
      .where(eq(jobChanges.jobId, id))
      .orderBy(desc(jobChanges.changedAt), desc(jobChanges.id))
      .limit(50),
    db
      .select()
      .from(jobScores)
      .where(and(eq(jobScores.jobId, id), eq(jobScores.isCurrent, true)))
      .orderBy(desc(jobScores.computedAt), desc(jobScores.id))
      .limit(1),
    db
      .select({
        id: linkChecks.id,
        url: linkChecks.url,
        statusCode: linkChecks.statusCode,
        ok: linkChecks.ok,
        finalUrl: linkChecks.finalUrl,
        checkedAt: linkChecks.checkedAt,
        error: linkChecks.error,
        durationMs: linkChecks.durationMs,
      })
      .from(linkChecks)
      .where(eq(linkChecks.jobId, id))
      .orderBy(desc(linkChecks.checkedAt), desc(linkChecks.id))
      .limit(5),
    db
      .select({
        id: applications.id,
        currentStage: applications.currentStage,
        appliedAt: applications.appliedAt,
        nextFollowUpAt: applications.nextFollowUpAt,
        createdAt: applications.createdAt,
      })
      .from(applications)
      .where(eq(applications.jobId, id))
      // Oldest first: the first one is the application "Mark applied" updates (see createApplicationFromJob).
      .orderBy(asc(applications.id)),
    db
      .select({ id: corrections.id, field: corrections.field, note: corrections.note, createdAt: corrections.createdAt, addedToGolden: corrections.addedToGolden })
      .from(corrections)
      .where(eq(corrections.jobId, id))
      .orderBy(desc(corrections.createdAt), desc(corrections.id))
      .limit(10),
    job.countryIso2
      ? db
          .select()
          .from(visaRoutes)
          .where(and(eq(visaRoutes.countryIso2, job.countryIso2), eq(visaRoutes.isActive, true)))
          .orderBy(visaRoutes.name)
      : Promise.resolve([]),
    getSetting(db, 'profile'),
    db
      .select({ overrideId: jobOverrides.id, at: jobOverrides.deactivatedAt })
      .from(jobOverrides)
      .where(and(eq(jobOverrides.jobId, id), isNotNull(jobOverrides.deactivatedAt))),
    db
      .select({ at: auditLog.at, reason: auditLog.reason, before: auditLog.beforeJson })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'job'), eq(auditLog.entityId, String(id)), eq(auditLog.action, 'job.override.clear')))
      .orderBy(desc(auditLog.at), desc(auditLog.id))
      .limit(50),
  ]);

  const versions = routes.length
    ? await db
        .select()
        .from(visaRuleVersions)
        .where(inArray(visaRuleVersions.routeId, routes.map((r) => r.id)))
    : [];
  const today = utcDay(now);
  const visaRules: VisaRuleView[] = routes
    .map((route) => {
      const picked = pickRuleVersion(
        versions.filter((v) => v.routeId === route.id),
        today,
      );
      return {
        routeId: route.id,
        routeCode: route.code,
        routeName: route.name,
        routeUrl: route.officialUrl,
        rule: picked.rule,
        current: picked.current,
        ...ruleAge(picked.rule, now),
      };
    })
    // Verified rules in force first.
    .sort((a, b) => Number(b.current && b.verified) - Number(a.current && a.verified) || Number(b.current) - Number(a.current));

  const resolved = resolveJobFacts(facts, overrides);
  const bestRule = visaRules.find((r) => r.current && r.rule) ?? null;
  const storedEligibility = resolved.eligibility?.winner ?? null;
  const storedEligibilityValue = storedEligibility ? asEligibilityValue(storedEligibility.value) : null;
  const eligibility: EligibilityView =
    storedEligibility && storedEligibilityValue
      ? { fact: { ...storedEligibility, value: storedEligibilityValue }, computedNow: false, rule: bestRule }
      : {
        fact: checkEligibility({ salary: asSalaryValue(resolved.salary?.winner?.value), rule: bestRule?.rule ?? null, profile, now }),
        computedNow: true,
        rule: bestRule,
      };

  const score = scoreRows[0]
    ? { score: scoreRows[0].score, version: scoreRows[0].scoreVersion, computedAt: scoreRows[0].computedAt, components: parseScoreComponents(scoreRows[0].componentsJson) }
    : null;

  const aiBudget = await safely('AI budget', () => getAiBudget(db, now), null);
  const summaryFact = resolved.ai_summary?.winner ?? null;
  const summary = summaryFact ? summaryText(summaryFact.value) : null;

  const currentValues = currentValuesOf(job, resolved);
  const columns = { title: job.canonicalTitle, countryIso2: job.countryIso2, city: job.city, workplaceType: job.workplaceType, closingAt: job.closingAt };
  const defaults = {} as Record<EditableField, Record<string, string>>;
  for (const field of EDITABLE_FIELDS) defaults[field] = formDefaults(field, currentValues[field], columns);

  const bestSourceId = job.bestSourceId;
  return {
    job,
    company: head.company,
    country: head.country,
    bestGrade: toGrade(head.bestGrade),
    applied: toBool(head.applied),
    sources: sourceRows.map((s) => ({ ...s, isBest: s.sourceId === bestSourceId })),
    facts,
    overrides,
    overrideEnds: ends.flatMap((e) => (e.at ? [{ overrideId: e.overrideId, at: e.at }] : [])),
    overrideClears: clears.flatMap((c) => {
      const field = c.before && typeof c.before === 'object' && 'field' in c.before ? (c.before as { field: unknown }).field : null;
      return typeof field === 'string' ? [{ field, at: c.at, reason: c.reason }] : [];
    }),
    resolved,
    visaStatus: displayedVisaStatus(resolved),
    visaRules,
    eligibility,
    score,
    changes,
    linkChecks: checks,
    applications: apps,
    corrections: corr,
    aiBudget,
    aiSummary: summary && summaryFact ? { text: summary, fact: summaryFact } : null,
    formDefaults: defaults,
    currentValues,
    now,
  };
}
