/**
 * Golden-sample labels and the weekly spot-check (pure, client-safe): prefilling labels from what
 * the system currently shows, parsing the labelling form, the ISO-week batch key and the seeded
 * "10 random jobs" pick (stable for the whole week, so a reload shows the same jobs).
 */
import {
  LANGUAGE_REQUIREMENTS,
  REMOTE_CLASSES,
  SENIORITY_WORDS,
  VISA_STATUSES,
} from "@/db/schema/_enums";
import { ROLE_KEYS } from "@/data/titles/roles";
import { goldenLabelsSchema, type GoldenField, type GoldenLabels } from "@/lib/contracts/accuracy";
import { hashString } from "@/components/ui/geometry";

export const LABEL_FIELDS = [
  "role_match",
  "role_key",
  "seniority",
  "visa_status",
  "remote_class",
  "salary",
  "language",
  "country_iso2",
  "experience_min_years",
] as const satisfies readonly GoldenField[];

export const FIELD_LABEL: Record<GoldenField, string> = {
  role_match: "Role match",
  role_key: "Role",
  seniority: "Seniority",
  visa_status: "Visa status",
  remote_class: "Remote",
  salary: "Salary",
  language: "Language",
  country_iso2: "Country",
  experience_min_years: "Min. years",
};

/** Fields checked in the weekly spot-check (role_match follows from the role). */
export const SPOT_FIELDS = [
  "role_key",
  "seniority",
  "visa_status",
  "remote_class",
  "salary",
  "language",
  "country_iso2",
  "experience_min_years",
] as const satisfies readonly GoldenField[];
export type SpotField = (typeof SPOT_FIELDS)[number];

/** spot_checks.error_type values (schema comment). */
export const ERROR_TYPES = ["wrong_value", "missed", "false_positive", "stale", "parse_error", "other"] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];
export const ERROR_TYPE_LABEL: Record<ErrorType, string> = {
  wrong_value: "Wrong value",
  missed: "Missed (posting says it, we don't)",
  false_positive: "False positive (we say it, posting doesn't)",
  stale: "Stale (posting changed)",
  parse_error: "Parse error",
  other: "Other",
};

export const SPOT_BATCH_SIZE = 10;

/** What the system currently shows for a job, in label terms. */
export interface SystemValues {
  roleKey: string | null;
  roleFamily: string;
  seniority: string | null;
  visaStatus: string | null;
  remoteClass: string | null;
  languageRequirement: string | null;
  countryIso2: string | null;
  experienceMinYears: number | null;
  /** The resolved salary fact (as posted: original currency / period), null when none. */
  salary: { min?: number | null; max?: number | null; currency?: string | null; period?: string | null; kind?: string | null } | null;
}

const PERIODS = ["hour", "day", "month", "year"] as const;

function inList<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

/** Labels equal to the current system output (every field the system has a value for). */
export function prefillLabels(sys: SystemValues): GoldenLabels {
  const out: GoldenLabels = {};
  out.role_match = sys.roleFamily !== "other";
  out.role_key = sys.roleKey && inList(ROLE_KEYS, sys.roleKey) ? sys.roleKey : null;
  out.seniority = inList(SENIORITY_WORDS, sys.seniority) ? sys.seniority : null;
  if (inList(VISA_STATUSES, sys.visaStatus)) out.visa_status = sys.visaStatus;
  if (inList(REMOTE_CLASSES, sys.remoteClass)) out.remote_class = sys.remoteClass;
  if (inList(LANGUAGE_REQUIREMENTS, sys.languageRequirement)) out.language = sys.languageRequirement;
  out.country_iso2 = sys.countryIso2 && /^[A-Z]{2}$/.test(sys.countryIso2) ? sys.countryIso2 : null;
  out.experience_min_years = sys.experienceMinYears ?? null;
  if (sys.salary && sys.salary.kind !== "estimated") {
    out.salary = {
      stated: true,
      currency: sys.salary.currency && /^[A-Z]{3}$/.test(sys.salary.currency) ? sys.salary.currency : null,
      period: inList(PERIODS, sys.salary.period) ? sys.salary.period : null,
      min: typeof sys.salary.min === "number" ? sys.salary.min : null,
      max: typeof sys.salary.max === "number" ? sys.salary.max : null,
    };
  } else {
    out.salary = { stated: false };
  }
  const parsed = goldenLabelsSchema.safeParse(out);
  return parsed.success ? parsed.data : {};
}

/** Human-readable value of one label field ("—" when unlabelled / null). */
export function labelText(field: GoldenField, labels: GoldenLabels): string {
  const v = labels[field];
  if (v === undefined) return "not labelled";
  if (v === null) return "none";
  if (field === "role_match") return v ? "yes" : "no";
  if (field === "salary") {
    const s = v as NonNullable<GoldenLabels["salary"]>;
    if (!s.stated) return "not stated";
    const range = [s.min, s.max].filter((x) => typeof x === "number").map((x) => Number(x).toLocaleString("en-GB"));
    return [range.join("–") || "amount unknown", s.currency ?? "", s.period ? `/ ${s.period}` : ""].filter(Boolean).join(" ");
  }
  return String(v).replaceAll("_", " ");
}

export interface FormLike {
  get(name: string): FormDataEntryValue | null;
}

function s(fd: FormLike, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

function optNum(text: string): number | null | "bad" {
  if (text === "") return null;
  const n = Number(text.replace(",", "."));
  return Number.isFinite(n) ? n : "bad";
}

/** Field names of the labelling form: `lab_<field>` = include; `v_<field>` (+ salary parts) = value. */
export const includeName = (f: GoldenField) => `lab_${f}`;
export const valueName = (f: GoldenField, part?: string) => (part ? `v_${f}_${part}` : `v_${f}`);

/**
 * Reads one field's label value from the form. `undefined` = not labelled; returns an error
 * string for bad input.
 */
export function readLabelValue(fd: FormLike, f: GoldenField): { value: unknown } | { error: string } {
  const raw = s(fd, valueName(f));
  switch (f) {
    case "role_match":
      if (raw !== "yes" && raw !== "no") return { error: "Role match: pick yes or no." };
      return { value: raw === "yes" };
    case "role_key":
      if (raw === "none") return { value: null };
      if (!inList(ROLE_KEYS, raw)) return { error: "Role: pick a role." };
      return { value: raw };
    case "seniority":
      if (raw === "none") return { value: null };
      if (!inList(SENIORITY_WORDS, raw)) return { error: "Seniority: pick a level." };
      return { value: raw };
    case "visa_status":
      if (!inList(VISA_STATUSES, raw)) return { error: "Visa status: pick a status." };
      return { value: raw };
    case "remote_class":
      if (!inList(REMOTE_CLASSES, raw)) return { error: "Remote: pick a class." };
      return { value: raw };
    case "language":
      if (!inList(LANGUAGE_REQUIREMENTS, raw)) return { error: "Language: pick a requirement." };
      return { value: raw };
    case "country_iso2": {
      const c = raw.toUpperCase();
      if (c === "") return { value: null };
      if (!/^[A-Z]{2}$/.test(c)) return { error: "Country: use a two-letter code (e.g. DE)." };
      return { value: c };
    }
    case "experience_min_years": {
      const n = optNum(raw);
      if (n === "bad" || (n !== null && (n < 0 || n > 40))) return { error: "Min. years: a number from 0 to 40, or empty." };
      return { value: n };
    }
    case "salary": {
      const stated = s(fd, valueName(f, "stated"));
      if (stated !== "yes" && stated !== "no") return { error: "Salary: say whether the posting states one." };
      if (stated === "no") return { value: { stated: false } };
      const currency = s(fd, valueName(f, "currency")).toUpperCase();
      if (currency && !/^[A-Z]{3}$/.test(currency)) return { error: "Salary: currency is a three-letter code (EUR)." };
      const period = s(fd, valueName(f, "period"));
      if (period && !inList(PERIODS, period)) return { error: "Salary: unknown period." };
      const min = optNum(s(fd, valueName(f, "min")));
      const max = optNum(s(fd, valueName(f, "max")));
      if (min === "bad" || max === "bad" || (min !== null && min < 0) || (max !== null && max < 0)) return { error: "Salary: amounts must be numbers." };
      if (min !== null && max !== null && min > max) return { error: "Salary: the minimum is above the maximum." };
      return { value: { stated: true, currency: currency || null, period: period || null, min, max } };
    }
  }
}

/** The whole labelling form → GoldenLabels (only the ticked fields). */
export function parseLabelsForm(fd: FormLike, fields: readonly GoldenField[] = LABEL_FIELDS): { ok: true; labels: GoldenLabels } | { ok: false; error: string } {
  const raw: Record<string, unknown> = {};
  for (const f of fields) {
    const inc = s(fd, includeName(f));
    if (inc !== "1" && inc !== "on" && inc !== "true") continue;
    const r = readLabelValue(fd, f);
    if ("error" in r) return { ok: false, error: r.error };
    raw[f] = r.value;
  }
  if (Object.keys(raw).length === 0) return { ok: false, error: "Label at least one field." };
  const parsed = goldenLabelsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid labels." };
  return { ok: true, labels: parsed.data };
}

/** ISO-8601 week key of a date (UTC), e.g. 2026-09-30 → "2026-W40". */
export function isoWeekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic pick of `n` distinct ids for a seed (same seed + ids → same pick, any input order). */
export function seededSample<T extends number | string>(ids: readonly T[], n: number, seed: string): T[] {
  const pool = [...new Set(ids)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const rand = mulberry32(hashString(seed));
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return pool.slice(0, Math.max(0, n));
}

export type SpotVerdict = "correct" | "wrong" | "skip";

export interface SpotAnswer {
  field: SpotField;
  verdict: SpotVerdict;
  errorType: ErrorType | null;
  note: string | null;
  /** Corrected label value for a wrong field (undefined when not given). */
  fix?: unknown;
}

export const verdictName = (f: SpotField) => `ok_${f}`;
export const errorName = (f: SpotField) => `err_${f}`;
export const fixName = (f: SpotField) => `fix_${f}`;

/**
 * Reads the per-field answers of one spot-checked job. A wrong field needs an error type; its
 * corrected value is optional (`fix_<field>` = "1" plus the `v_<field>` inputs).
 */
export function parseSpotAnswers(fd: FormLike): { ok: true; answers: SpotAnswer[] } | { ok: false; error: string } {
  const answers: SpotAnswer[] = [];
  for (const f of SPOT_FIELDS) {
    const verdict = s(fd, verdictName(f)) || "skip";
    if (verdict !== "correct" && verdict !== "wrong" && verdict !== "skip") return { ok: false, error: `${FIELD_LABEL[f]}: unknown answer.` };
    if (verdict === "skip") continue;
    if (verdict === "correct") {
      answers.push({ field: f, verdict, errorType: null, note: null });
      continue;
    }
    const et = s(fd, errorName(f));
    if (!inList(ERROR_TYPES, et)) return { ok: false, error: `${FIELD_LABEL[f]}: pick the error type.` };
    const note = s(fd, `note_${f}`).slice(0, 1000) || null;
    const a: SpotAnswer = { field: f, verdict, errorType: et, note };
    const wantsFix = s(fd, fixName(f));
    if (wantsFix === "1" || wantsFix === "on") {
      const r = readLabelValue(fd, f);
      if ("error" in r) return { ok: false, error: r.error };
      a.fix = r.value;
    }
    answers.push(a);
  }
  if (answers.length === 0) return { ok: false, error: "Answer at least one field (correct or wrong)." };
  return { ok: true, answers };
}

/**
 * Golden labels from a spot-check: fields marked correct take the system value, wrong fields take
 * the fix when one was given (otherwise they stay unlabelled — the note keeps the finding).
 */
export function spotLabels(sys: GoldenLabels, answers: readonly SpotAnswer[], isTargetRole: (roleKey: string | null) => boolean): GoldenLabels {
  const out: Record<string, unknown> = {};
  for (const a of answers) {
    if (a.verdict === "correct" && sys[a.field] !== undefined) out[a.field] = sys[a.field];
    else if (a.verdict === "wrong" && a.fix !== undefined) out[a.field] = a.fix;
  }
  if ("role_key" in out) out.role_match = isTargetRole((out.role_key as string | null) ?? null);
  const parsed = goldenLabelsSchema.safeParse(out);
  return parsed.success ? parsed.data : {};
}
