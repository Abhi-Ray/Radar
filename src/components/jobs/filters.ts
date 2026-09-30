/**
 * /jobs filter model (spec §19.2, §14): parse from the URL, serialise back, the default view and
 * the rule list behind the "N hidden by filters" panel. Pure — no DB access.
 *
 * Every rule here has one meaning, written once as `passesRule()` over a plain job subject. The SQL
 * in src/lib/queries/jobs.ts mirrors these predicates rule by rule (tests/jobs/queries-db.test.ts
 * checks that the two agree on the same rows).
 */
import { COMPANY_TYPES, CONFIDENCES, JOB_STATES, REMOTE_CLASSES, ROLE_FAMILIES, VISA_STATUSES } from "@/db/schema/_enums";
import { formatEur } from "@/components/ui/format";
import { VISA_META } from "@/components/ui/status";
import { hrefWith, pageFromParams, paramList, paramValue, type ParamUpdate, type SearchParamsInput } from "@/components/ui/url";
import {
  COMPANY_TYPE_LABEL,
  CONFIDENCE_LABEL,
  FAMILY_LABEL,
  REMOTE_LABEL,
  STATE_LABEL,
  roleKeyLabel,
  type CompanyType,
  type ConfidenceKey,
  type JobState,
  type RemoteClass,
  type RoleFamily,
} from "./labels";

export const JOBS_PATH = "/jobs";
export const JOBS_PAGE_SIZE = 24;

export type VisaStatusKey = (typeof VISA_STATUSES)[number];

export const SORT_KEYS = ["fit", "posted", "salary"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORT_LABEL: Record<SortKey, string> = { fit: "Best fit", posted: "Newest posted", salary: "Highest salary" };

/** "Posted within N days" windows offered in the UI (any positive integer ≤ 365 parses). */
export const POSTED_WINDOWS = [1, 3, 7, 14, 30, 90] as const;

/** Default-view switches. `all` turns off the remote, experience and closed rules at once. */
export const SHOW_FLAGS = ["all", "remote", "experience", "closed", "hidden"] as const;
export type ShowFlag = (typeof SHOW_FLAGS)[number];

/** "My" jobs: any of saved / applied / hidden (OR). */
export const MINE_KEYS = ["saved", "applied", "hidden"] as const;
export type MineKey = (typeof MINE_KEYS)[number];
export const MINE_LABEL: Record<MineKey, string> = { saved: "Saved", applied: "Applied", hidden: "Hidden" };

/** Remote classes the default view hides (spec §14: only Worldwide + Unclear among remote roles). */
export const LIMITED_REMOTE: readonly RemoteClass[] = ["region_limited", "timezone_limited"];
/** Lifecycle states the default view hides. */
export const CLOSED_STATES: readonly JobState[] = ["closed", "expired"];

export interface JobFilters {
  q: string | null;
  country: string[];
  remote: RemoteClass[];
  family: RoleFamily[];
  role: string[];
  size: string[];
  ctype: CompanyType[];
  visa: VisaStatusKey[];
  /** Annual EUR floor (upper end of the posted range must reach it). */
  salary: number | null;
  stated: boolean;
  /** Posted (or first seen) within N days. */
  posted: number | null;
  /** Source platform keys. */
  source: string[];
  fit: number | null;
  /** Minimum confidence of the resolved core facts. */
  conf: ConfidenceKey | null;
  state: JobState[];
  mine: MineKey[];
  show: ShowFlag[];
  sort: SortKey;
  page: number;
}

export const EMPTY_FILTERS: JobFilters = {
  q: null,
  country: [],
  remote: [],
  family: [],
  role: [],
  size: [],
  ctype: [],
  visa: [],
  salary: null,
  stated: false,
  posted: null,
  source: [],
  fit: null,
  conf: null,
  state: [],
  mine: [],
  show: [],
  sort: "fit",
  page: 1,
};

// ---- parsing ---------------------------------------------------------------------------------

const MAX_LIST = 40;

function oneOfList<T extends string>(allowed: readonly T[], raw: string[]): T[] {
  const set = new Set<T>();
  for (const v of raw) {
    const s = v.trim().toLowerCase();
    if ((allowed as readonly string[]).includes(s)) set.add(s as T);
  }
  return [...set];
}

function patternList(raw: string[], re: RegExp, transform: (s: string) => string = (s) => s): string[] {
  const set = new Set<string>();
  for (const v of raw) {
    const s = transform(v.trim());
    if (re.test(s)) set.add(s);
    if (set.size >= MAX_LIST) break;
  }
  return [...set];
}

function intParam(raw: string | undefined, min: number, max: number): number | null {
  if (raw === undefined) return null;
  const t = raw.trim().replace(/[\s_,.]/g, "");
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number.parseInt(t, 10);
  if (!Number.isFinite(n) || n < min) return null;
  return Math.min(n, max);
}

function flag(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  return ["1", "true", "on", "yes"].includes(raw.trim().toLowerCase());
}

/** Reads the filters from `searchParams`; unknown values are dropped, numbers clamped. */
export function parseJobFilters(sp: SearchParamsInput): JobFilters {
  const qRaw = paramValue(sp, "q")?.trim().replace(/\s+/g, " ") ?? "";
  const conf = paramValue(sp, "conf")?.trim().toLowerCase();
  const sort = paramValue(sp, "sort")?.trim().toLowerCase();
  const salary = intParam(paramValue(sp, "salary"), 1, 1_000_000);
  return {
    q: qRaw ? qRaw.slice(0, 100) : null,
    country: patternList(paramList(sp, "country"), /^[A-Z]{2}$/, (s) => s.toUpperCase()),
    remote: oneOfList(REMOTE_CLASSES, paramList(sp, "remote")),
    family: oneOfList(ROLE_FAMILIES, paramList(sp, "family")),
    role: patternList(paramList(sp, "role"), /^[a-z0-9_]{1,64}$/, (s) => s.toLowerCase()),
    // Size bands are free-form in the schema ("51-250", "1000+"): printable, short, no commas.
    size: patternList(paramList(sp, "size"), /^[\w+\-– ]{1,32}$/u),
    ctype: oneOfList(COMPANY_TYPES, paramList(sp, "ctype")),
    visa: oneOfList(VISA_STATUSES, paramList(sp, "visa")),
    salary,
    stated: flag(paramValue(sp, "stated")),
    posted: intParam(paramValue(sp, "posted"), 1, 365),
    source: patternList(paramList(sp, "source"), /^[a-z0-9][a-z0-9_.-]{0,63}$/, (s) => s.toLowerCase()),
    fit: intParam(paramValue(sp, "fit"), 1, 100),
    conf: conf && (CONFIDENCES as readonly string[]).includes(conf) ? (conf as ConfidenceKey) : null,
    state: oneOfList(JOB_STATES, paramList(sp, "state")),
    mine: oneOfList(MINE_KEYS, paramList(sp, "mine")),
    show: oneOfList(SHOW_FLAGS, paramList(sp, "show")),
    sort: sort && (SORT_KEYS as readonly string[]).includes(sort) ? (sort as SortKey) : "fit",
    page: pageFromParams(sp),
  };
}

// ---- serialising -----------------------------------------------------------------------------

/** URL params for `hrefWith()`. Defaults are omitted so URLs stay short and canonical. */
export function filtersToParams(f: JobFilters): Record<string, ParamUpdate> {
  return {
    q: f.q,
    country: f.country,
    remote: f.remote,
    family: f.family,
    role: f.role,
    size: f.size,
    ctype: f.ctype,
    visa: f.visa,
    salary: f.salary,
    stated: f.stated,
    posted: f.posted,
    source: f.source,
    fit: f.fit,
    conf: f.conf,
    state: f.state,
    mine: f.mine,
    show: f.show,
    sort: f.sort === "fit" ? null : f.sort,
    page: f.page > 1 ? f.page : null,
  };
}

/** The one URL for these filters: defaults and blanks dropped, values deduped, keys sorted. */
export function canonicalJobsHref(f: JobFilters): string {
  return hrefWith(JOBS_PATH, null, filtersToParams(f), { keepPage: true });
}

/**
 * Where to send a /jobs request whose query isn't canonical, else null. A submitted filter form
 * carries every field (`?q=&salary=&sort=fit…`) and hand-edited URLs may carry junk; one redirect
 * leaves a short URL worth bookmarking. Idempotent: the canonical URL maps to itself.
 */
export function canonicalJobsRedirect(sp: SearchParamsInput): string | null {
  const canonical = canonicalJobsHref(parseJobFilters(sp));
  return hrefWith(JOBS_PATH, sp, {}, { keepPage: true }) === canonical ? null : canonical;
}

/** Link to /jobs with the current filters plus `patch` (page resets unless patched). */
export function jobsHref(f: JobFilters, patch: Record<string, ParamUpdate> = {}): string {
  const base = filtersToParams(f);
  if (!("page" in patch)) base.page = null;
  return hrefWith(JOBS_PATH, null, { ...base, ...patch }, { keepPage: true });
}

// ---- rules -----------------------------------------------------------------------------------

export type DefaultRuleId = "remote_limited" | "experience_band" | "closed" | "hidden";
export type FilterRuleId =
  | "q"
  | "country"
  | "remote"
  | "family"
  | "role"
  | "size"
  | "ctype"
  | "visa"
  | "salary"
  | "stated"
  | "posted"
  | "source"
  | "fit"
  | "conf"
  | "state"
  | "mine";
export type RuleId = DefaultRuleId | FilterRuleId;

export interface RuleSpec {
  id: RuleId;
  kind: "default" | "filter";
  /** Why a job is hidden by this rule ("Remote, but region-limited"). */
  label: string;
  /** Link that turns only this rule off. */
  revealHref: string;
  /** Plain words for the reveal link ("Show them", "Remove filter"). */
  revealLabel: string;
}

const DEFAULT_RULE_FLAG: Record<DefaultRuleId, ShowFlag> = {
  remote_limited: "remote",
  experience_band: "experience",
  closed: "closed",
  hidden: "hidden",
};

/** Default-view rules in force for these filters (spec §14 / §19.2). */
export function activeDefaultRules(f: JobFilters): DefaultRuleId[] {
  const all = f.show.includes("all");
  const out: DefaultRuleId[] = [];
  if (!all && !f.show.includes("remote") && f.remote.length === 0) out.push("remote_limited");
  if (!all && !f.show.includes("experience")) out.push("experience_band");
  if (!all && !f.show.includes("closed") && f.state.length === 0) out.push("closed");
  // Hidden jobs are my own decision: "show all" does not bring them back, only an explicit reveal.
  if (!f.show.includes("hidden") && !f.mine.includes("hidden")) out.push("hidden");
  return out;
}

const DEFAULT_RULE_LABEL: Record<DefaultRuleId, string> = {
  remote_limited: "Remote, but region- or time-zone-limited",
  experience_band: "Experience ask outside your band",
  closed: "Closed or expired",
  hidden: "Hidden by you",
};

function list(values: string[], label: (v: string) => string, max = 3): string {
  const shown = values.slice(0, max).map(label);
  return values.length > max ? `${shown.join(", ")} +${values.length - max}` : shown.join(", ");
}

/** Label for an active user filter (null when that filter is off). */
export function filterRuleLabel(id: FilterRuleId, f: JobFilters): string | null {
  switch (id) {
    case "q":
      return f.q ? `Search “${f.q}”` : null;
    case "country":
      return f.country.length ? `Country: ${list(f.country, (c) => c)}` : null;
    case "remote":
      return f.remote.length ? `Remote: ${list(f.remote, (r) => REMOTE_LABEL[r as RemoteClass])}` : null;
    case "family":
      return f.family.length ? `Role family: ${list(f.family, (r) => FAMILY_LABEL[r as RoleFamily])}` : null;
    case "role":
      return f.role.length ? `Role: ${list(f.role, roleKeyLabel, 2)}` : null;
    case "size":
      return f.size.length ? `Company size: ${list(f.size, (s) => s)}` : null;
    case "ctype":
      return f.ctype.length ? `Company type: ${list(f.ctype, (t) => COMPANY_TYPE_LABEL[t as CompanyType])}` : null;
    case "visa":
      return f.visa.length ? `Visa: ${list(f.visa, (v) => VISA_META[v as VisaStatusKey].label)}` : null;
    case "salary":
      return f.salary !== null ? `Salary ≥ ${formatEur(f.salary, { compact: true })}/yr` : null;
    case "stated":
      return f.stated ? "Stated salary only" : null;
    case "posted":
      return f.posted !== null ? `Posted within ${f.posted === 1 ? "1 day" : `${f.posted} days`}` : null;
    case "source":
      return f.source.length ? `Source: ${list(f.source, (s) => s)}` : null;
    case "fit":
      return f.fit !== null ? `Fit ≥ ${f.fit}` : null;
    case "conf":
      return f.conf ? `Confidence ≥ ${CONFIDENCE_LABEL[f.conf]}` : null;
    case "state":
      return f.state.length ? `State: ${list(f.state, (s) => STATE_LABEL[s as JobState])}` : null;
    case "mine":
      return f.mine.length ? `Only ${list(f.mine, (m) => MINE_LABEL[m as MineKey].toLowerCase())}` : null;
  }
}

export const FILTER_RULE_IDS: readonly FilterRuleId[] = [
  "q",
  "country",
  "remote",
  "family",
  "role",
  "size",
  "ctype",
  "visa",
  "salary",
  "stated",
  "posted",
  "source",
  "fit",
  "conf",
  "state",
  "mine",
];

const FILTER_PARAM: Record<FilterRuleId, string> = {
  q: "q",
  country: "country",
  remote: "remote",
  family: "family",
  role: "role",
  size: "size",
  ctype: "ctype",
  visa: "visa",
  salary: "salary",
  stated: "stated",
  posted: "posted",
  source: "source",
  fit: "fit",
  conf: "conf",
  state: "state",
  mine: "mine",
};

/** Every rule currently narrowing the list: default-view rules first, then my filters. */
export function activeRules(f: JobFilters): RuleSpec[] {
  const out: RuleSpec[] = activeDefaultRules(f).map((id) => ({
    id,
    kind: "default" as const,
    label: DEFAULT_RULE_LABEL[id],
    revealHref: jobsHref(f, { show: [...new Set([...f.show, DEFAULT_RULE_FLAG[id]])] }),
    revealLabel: "Show them",
  }));
  for (const id of FILTER_RULE_IDS) {
    const label = filterRuleLabel(id, f);
    if (!label) continue;
    out.push({ id, kind: "filter", label, revealHref: jobsHref(f, { [FILTER_PARAM[id]]: null }), revealLabel: "Remove filter" });
  }
  return out;
}

/** Number of user filters set (drawer badge). */
export function activeFilterCount(f: JobFilters): number {
  return FILTER_RULE_IDS.filter((id) => filterRuleLabel(id, f) !== null).length;
}

/** Link that clears every user filter but keeps sort and the default-view switches. */
export function clearFiltersHref(f: JobFilters): string {
  return jobsHref({ ...EMPTY_FILTERS, sort: f.sort, show: f.show });
}

// ---- the predicate (the rule meaning, mirrored in SQL) ---------------------------------------

export interface JobFilterSubject {
  title: string;
  company: string;
  countryIso2: string | null;
  remoteClass: RemoteClass | null;
  roleFamily: RoleFamily;
  roleKey: string | null;
  companySize: string | null;
  companyType: CompanyType;
  isAgency: boolean;
  visaStatus: VisaStatusKey | null;
  salaryEurMin: number | null;
  salaryEurMax: number | null;
  salaryKind: "stated" | "estimated" | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  platformKeys: string[];
  score: number | null;
  factsConfidence: ConfidenceKey | null;
  state: JobState;
  experienceBand: "core" | "show" | "hide" | "unknown" | null;
  hidden: boolean;
  saved: boolean;
  /** Has an application past the "saved" stage. */
  applied: boolean;
}

const CONF_RANK: Record<ConfidenceKey, number> = { high: 0, medium: 1, low: 2 };
const DAY_MS = 86_400_000;

/** Confidence levels that satisfy "at least `min`". */
export function confidenceAtLeast(min: ConfidenceKey): ConfidenceKey[] {
  return (CONFIDENCES as readonly ConfidenceKey[]).filter((c) => CONF_RANK[c] <= CONF_RANK[min]);
}

/** Start of the "posted within N days" window. */
export function postedSince(days: number, now: Date): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

export function passesRule(id: RuleId, f: JobFilters, job: JobFilterSubject, now: Date): boolean {
  switch (id) {
    case "remote_limited":
      return job.remoteClass === null || !LIMITED_REMOTE.includes(job.remoteClass);
    case "experience_band":
      return job.experienceBand !== "hide";
    case "closed":
      return !CLOSED_STATES.includes(job.state);
    case "hidden":
      return !job.hidden;
    case "q": {
      if (!f.q) return true;
      const needle = f.q.toLowerCase();
      return job.title.toLowerCase().includes(needle) || job.company.toLowerCase().includes(needle);
    }
    case "country":
      return !f.country.length || (job.countryIso2 !== null && f.country.includes(job.countryIso2));
    case "remote":
      return !f.remote.length || (job.remoteClass !== null && f.remote.includes(job.remoteClass));
    case "family":
      return !f.family.length || f.family.includes(job.roleFamily);
    case "role":
      return !f.role.length || (job.roleKey !== null && f.role.includes(job.roleKey));
    case "size":
      return !f.size.length || (job.companySize !== null && f.size.includes(job.companySize));
    case "ctype":
      return !f.ctype.length || f.ctype.includes(job.companyType) || (f.ctype.includes("agency") && job.isAgency);
    case "visa":
      // Unresolved = Unknown (the honest default).
      return !f.visa.length || f.visa.includes(job.visaStatus ?? "unknown");
    case "salary": {
      if (f.salary === null) return true;
      const top = job.salaryEurMax ?? job.salaryEurMin;
      return top !== null && top >= f.salary;
    }
    case "stated":
      return !f.stated || job.salaryKind === "stated";
    case "posted":
      return f.posted === null || (job.postedAt ?? job.firstSeenAt).getTime() >= postedSince(f.posted, now).getTime();
    case "source":
      return !f.source.length || job.platformKeys.some((k) => f.source.includes(k));
    case "fit":
      return f.fit === null || (job.score !== null && job.score >= f.fit);
    case "conf":
      return f.conf === null || (job.factsConfidence !== null && confidenceAtLeast(f.conf).includes(job.factsConfidence));
    case "state":
      return !f.state.length || f.state.includes(job.state);
    case "mine":
      return (
        !f.mine.length ||
        (f.mine.includes("saved") && job.saved) ||
        (f.mine.includes("applied") && job.applied) ||
        (f.mine.includes("hidden") && job.hidden)
      );
  }
}

export interface HiddenBreakdown {
  /** Jobs on the scope before any rule (merged duplicates never count). */
  total: number;
  shown: number;
  hidden: number;
  /** Per rule: jobs hidden by that rule alone (revealing it brings exactly these back). */
  byRule: { rule: RuleSpec; count: number }[];
  /** Jobs hidden by two or more rules at once. */
  multi: number;
}

/** In-memory version of the breakdown query (tests and small lists). */
export function breakdownOf(f: JobFilters, jobs: readonly JobFilterSubject[], now: Date): HiddenBreakdown {
  const rules = activeRules(f);
  const counts = new Map<RuleId, number>(rules.map((r) => [r.id, 0]));
  let shown = 0;
  let multi = 0;
  for (const job of jobs) {
    const failed = rules.filter((r) => !passesRule(r.id, f, job, now));
    if (failed.length === 0) shown++;
    else if (failed.length === 1) counts.set(failed[0].id, (counts.get(failed[0].id) ?? 0) + 1);
    else multi++;
  }
  return {
    total: jobs.length,
    shown,
    hidden: jobs.length - shown,
    byRule: rules.map((rule) => ({ rule, count: counts.get(rule.id) ?? 0 })),
    multi,
  };
}
