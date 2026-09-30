/**
 * Country guide logic (spec §4, §13.1, §19.5). Pure and client-safe.
 *
 * Rule selection and freshness mirror the visa engine (src/lib/visa/rules.ts): the version in
 * effect on a day is the latest `effective_from` ≤ day whose `effective_to` (inclusive) has not
 * passed, ties to the higher version; a rule is stale when never verified or verified more than
 * 90 days ago. The JSON columns on `countries` are free-form, so they are read leniently.
 */
import { safeExternalHref } from "@/components/ui/url";

export const RULE_STALE_DAYS = 90;
export const REVIEW_INTERVAL_DAYS = 90;
const DAY_MS = 86_400_000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const TIER_LABEL: Record<number, string> = {
  0: "Remote / Worldwide",
  1: "Tier 1 · EU core",
  2: "Tier 2 · Nordics & Central/Eastern Europe",
  3: "Tier 3 · Other high-pay markets",
  4: "Tier 4 · Middle East & other markets",
};

export function tierLabel(tier: number): string {
  return TIER_LABEL[tier] ?? `Tier ${tier}`;
}

/** 'YYYY-MM-DD' (UTC) of an instant. */
export function utcDayOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isDay(v: unknown): v is string {
  if (typeof v !== "string" || !DAY_RE.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && utcDayOf(d) === v;
}

export interface RuleDates {
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
}

/** The version in effect on `day` ('YYYY-MM-DD', UTC) — null when none applies yet. */
export function ruleInEffect<T extends RuleDates>(versions: readonly T[], day: string): T | null {
  let best: T | null = null;
  for (const v of versions) {
    const from = v.effectiveFrom ?? "0000-01-01";
    if (from > day) continue;
    if (v.effectiveTo && v.effectiveTo < day) continue;
    if (!best) {
      best = v;
      continue;
    }
    const bestFrom = best.effectiveFrom ?? "0000-01-01";
    if (from > bestFrom || (from === bestFrom && v.version > best.version)) best = v;
  }
  return best;
}

/** Versions whose effective period starts after `day` (announced changes). */
export function upcomingVersions<T extends RuleDates>(versions: readonly T[], day: string): T[] {
  return versions.filter((v) => v.effectiveFrom !== null && v.effectiveFrom > day).sort((a, b) => (a.effectiveFrom! < b.effectiveFrom! ? -1 : 1));
}

export interface RuleVerification {
  verificationStatus: "verified" | "unverified" | string;
  lastVerifiedAt: Date | null;
  nextReviewAt: Date | null;
}

export type RuleState = "verified" | "stale" | "unverified";

export interface RuleFreshness {
  state: RuleState;
  stale: boolean;
  neverVerified: boolean;
  daysSinceVerified: number | null;
  reviewDue: boolean;
  warning: string | null;
}

export function ruleFreshness(rule: RuleVerification, now: Date): RuleFreshness {
  const verifiedAt = rule.verificationStatus === "verified" ? rule.lastVerifiedAt : null;
  const reviewDue = rule.nextReviewAt !== null && rule.nextReviewAt.getTime() < now.getTime();
  if (!verifiedAt) {
    return { state: "unverified", stale: true, neverVerified: true, daysSinceVerified: null, reviewDue, warning: "Never verified against the official source." };
  }
  const days = Math.floor((now.getTime() - verifiedAt.getTime()) / DAY_MS);
  const stale = days > RULE_STALE_DAYS;
  let warning: string | null = null;
  if (stale) warning = `Last verified ${utcDayOf(verifiedAt)} (${days} days ago) — re-check the official source.`;
  else if (reviewDue && rule.nextReviewAt) warning = `Review was due ${utcDayOf(rule.nextReviewAt)}.`;
  return { state: stale ? "stale" : "verified", stale, neverVerified: false, daysSinceVerified: days, reviewDue, warning };
}

/** The country-level marker: the worst state among the rules in effect today. */
export type CountryRuleMarker = RuleState | "none";

export function countryRuleMarker(current: readonly RuleVerification[], now: Date): CountryRuleMarker {
  if (!current.length) return "none";
  const states = current.map((r) => ruleFreshness(r, now).state);
  if (states.includes("unverified")) return "unverified";
  if (states.includes("stale")) return "stale";
  return "verified";
}

export const MARKER_LABEL: Record<CountryRuleMarker, string> = {
  verified: "Rules verified",
  stale: "Rules stale",
  unverified: "Rules unverified",
  none: "No rules yet",
};

/**
 * Can the country be switched live? Only with at least one rule in effect today that is verified
 * and not stale (spec §4: "only goes live when its rules are verified"). Switching off always works.
 */
export function goLiveCheck(current: readonly RuleVerification[], now: Date): { ok: true } | { ok: false; reason: string } {
  if (!current.length) return { ok: false, reason: "No visa rule is in effect today. Add a rule version first." };
  const fresh = current.map((r) => ruleFreshness(r, now));
  if (fresh.some((f) => f.state === "verified")) return { ok: true };
  if (fresh.every((f) => f.neverVerified)) return { ok: false, reason: "No rule in effect is verified yet. Check the official source and mark one verified." };
  return { ok: false, reason: `Every rule in effect is stale (verified more than ${RULE_STALE_DAYS} days ago). Re-verify one first.` };
}

// ---- lenient JSON readers --------------------------------------------------------------------

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, max = 300): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  if (typeof v === "string" && /^\d+(?:\.\d+)?$/.test(v.trim())) return Number(v.trim());
  return null;
}

export type SalaryBasis = "estimate" | "stated" | "official";

export interface SalaryRange {
  label: string;
  currency: string;
  min: number | null;
  max: number | null;
  median: number | null;
  /** 'estimate' unless the data says it is stated (from postings) or official (statistics office). */
  basis: SalaryBasis;
  source: string | null;
  sourceHref: string | null;
  asOf: string | null;
  note: string | null;
}

function salaryBasis(o: Record<string, unknown>): SalaryBasis {
  const raw = (str(o.basis) ?? str(o.kind) ?? str(o.method) ?? "").toLowerCase();
  if (raw === "official" || raw === "statistics") return "official";
  if (raw === "stated" || raw === "posting" || raw === "postings") return "stated";
  return "estimate";
}

function salaryEntry(o: Record<string, unknown>, fallbackLabel: string | null, fallbackCurrency: string | null): SalaryRange | null {
  const label = str(o.label) ?? str(o.role) ?? str(o.title) ?? str(o.level) ?? str(o.seniority) ?? fallbackLabel;
  const min = num(o.min ?? o.low ?? o.p25 ?? o.from);
  const max = num(o.max ?? o.high ?? o.p75 ?? o.to);
  const median = num(o.median ?? o.mid ?? o.p50);
  if (!label || (min === null && max === null && median === null)) return null;
  const currency = (str(o.currency) ?? fallbackCurrency ?? "EUR").toUpperCase().slice(0, 3);
  const sourceUrl = str(o.sourceUrl ?? o.source_url ?? o.url, 2048);
  return {
    label,
    currency,
    min: min !== null && max !== null && min > max ? max : min,
    max: min !== null && max !== null && min > max ? min : max,
    median,
    basis: salaryBasis(o),
    source: str(o.source),
    sourceHref: safeExternalHref(sourceUrl),
    asOf: str(o.asOf ?? o.as_of ?? o.year ?? o.date, 32),
    note: str(o.note ?? o.notes, 500),
  };
}

/**
 * `salary_ranges_json`: a list of `{label|role, min, max, median?, currency?, basis?, source?, asOf?}`,
 * or an object keyed by label, or `{currency, ranges: [...]}`.
 */
export function parseSalaryRanges(v: unknown, countryCurrency: string | null = null): SalaryRange[] {
  const out: SalaryRange[] = [];
  const o = obj(v);
  const currency = str(o?.currency) ?? countryCurrency;
  const list: unknown = Array.isArray(v) ? v : Array.isArray(o?.ranges) ? o!.ranges : null;
  if (Array.isArray(list)) {
    for (const item of list.slice(0, 50)) {
      const e = obj(item);
      const r = e ? salaryEntry(e, null, currency) : null;
      if (r) out.push(r);
    }
    return out;
  }
  if (o) {
    for (const [key, val] of Object.entries(o).slice(0, 50)) {
      if (key === "currency" || key === "ranges") continue;
      const e = obj(val);
      const r = e ? salaryEntry(e, key.replace(/_/g, " "), currency) : null;
      if (r) out.push(r);
    }
  }
  return out;
}

export interface BestSite {
  name: string;
  href: string | null;
  note: string | null;
}

/** `best_sites_json`: strings (names or URLs) or `{name, url, note}` objects. */
export function parseBestSites(v: unknown): BestSite[] {
  const list = Array.isArray(v) ? v : Array.isArray(obj(v)?.sites) ? (obj(v)!.sites as unknown[]) : [];
  const out: BestSite[] = [];
  for (const item of list.slice(0, 50)) {
    if (typeof item === "string" && item.trim()) {
      const href = safeExternalHref(item);
      out.push({ name: href ? new URL(href).hostname.replace(/^www\./, "") : item.trim().slice(0, 120), href, note: null });
      continue;
    }
    const o = obj(item);
    if (!o) continue;
    const href = safeExternalHref(str(o.url ?? o.href, 2048));
    const name = str(o.name ?? o.label, 120) ?? (href ? new URL(href).hostname.replace(/^www\./, "") : null);
    if (!name) continue;
    out.push({ name, href, note: str(o.note ?? o.notes ?? o.why, 300) });
  }
  return out;
}

export interface CvConventions {
  items: Array<{ key: string; label: string; value: string }>;
  notes: string[];
}

const CV_KEYS: Array<[string, string, readonly string[]]> = [
  ["length", "Length", ["length", "pages", "maxPages", "max_pages"]],
  ["photo", "Photo", ["photo", "picture"]],
  ["personal", "Personal details", ["personalDetails", "personal_details", "personal", "details"]],
  ["language", "Language", ["language", "languages"]],
  ["format", "Format", ["format", "style"]],
  ["coverLetter", "Cover letter", ["coverLetter", "cover_letter"]],
  ["references", "References", ["references"]],
];

function describe(v: unknown): string | null {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) {
    const parts = v.map((x) => str(x)).filter((x): x is string => Boolean(x));
    return parts.length ? parts.join(", ") : null;
  }
  return str(v, 500);
}

/** `cv_conventions_json`: `{length, photo, personalDetails, language, notes}` (any subset), or a list of notes. */
export function parseCvConventions(v: unknown): CvConventions {
  if (Array.isArray(v)) return { items: [], notes: v.map((x) => str(x, 500)).filter((x): x is string => Boolean(x)).slice(0, 30) };
  const o = obj(v);
  if (!o) return { items: [], notes: typeof v === "string" && v.trim() ? [v.trim().slice(0, 2000)] : [] };
  const items: CvConventions["items"] = [];
  const used = new Set<string>(["notes", "note"]);
  for (const [key, label, aliases] of CV_KEYS) {
    for (const a of aliases) {
      if (!(a in o)) continue;
      used.add(a);
      const val = describe(o[a]);
      if (val && !items.some((i) => i.key === key)) items.push({ key, label, value: key === "length" && /^\d+$/.test(val) ? `${val} page${val === "1" ? "" : "s"}` : val });
    }
  }
  for (const [k, val] of Object.entries(o)) {
    if (used.has(k)) continue;
    const d = describe(val);
    if (d && items.length < 20) items.push({ key: k, label: k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value: d });
  }
  const notesRaw = o.notes ?? o.note;
  const notes = Array.isArray(notesRaw) ? notesRaw.map((x) => str(x, 500)).filter((x): x is string => Boolean(x)) : str(notesRaw, 2000) ? [str(notesRaw, 2000)!] : [];
  return { items, notes };
}

/** `other_rules_json` on a rule version: an object of extra rules or a list of lines. */
export function parseOtherRules(v: unknown): Array<{ label: string; value: string }> {
  if (Array.isArray(v)) return v.map((x, i) => ({ label: `Rule ${i + 1}`, value: describe(x) ?? "" })).filter((r) => r.value).slice(0, 20);
  const o = obj(v);
  if (!o) return [];
  return Object.entries(o)
    .map(([k, val]) => ({ label: k.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), value: describe(val) ?? (obj(val) ? JSON.stringify(val) : "") }))
    .filter((r) => r.value)
    .slice(0, 20);
}

/** The languages list on a country row. */
export function parseLanguages(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, 60)).filter((x): x is string => Boolean(x)).slice(0, 12) : [];
}
