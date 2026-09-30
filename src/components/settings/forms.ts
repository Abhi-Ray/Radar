/**
 * /settings form parsing (pure, client-safe). Each parser turns the submitted form into a value
 * of the matching settings schema (src/lib/contracts/settings.ts) and returns either the parsed
 * value or one readable error. The server actions use these; tests cover them directly.
 */
import { z } from "zod";
import {
  COMPANY_TYPES_LIST,
  TARGET_FAMILIES,
  type TargetFamily,
} from "./options";
import {
  SCORE_COMPONENT_KEYS,
  aiSettingsSchema,
  alertSettingsSchema,
  profileSchema,
  retentionSettingsSchema,
  scoreWeightsSchema,
  type AiSettings,
  type AlertSettings,
  type Profile,
  type RetentionSettings,
  type ScoreWeights,
} from "@/lib/contracts/settings";
import { ROLE_KEYS } from "@/data/titles/roles";

/** The part of FormData the parsers use (so tests can pass a plain FormData or a stub). */
export interface FormLike {
  get(name: string): FormDataEntryValue | null;
  getAll(name: string): FormDataEntryValue[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The UI never allows more than this many AI calls a day (spec: free tier budget). */
export const AI_DAILY_LIMIT_MAX = 50;
export const WEIGHTS_TOTAL = 100;

function str(fd: FormLike, name: string): string {
  const v = fd.get(name);
  return typeof v === "string" ? v.trim() : "";
}

/** Empty → NaN so the schema reports it; accepts "1,5" as 1.5. */
function num(fd: FormLike, name: string): number {
  const s = str(fd, name).replace(",", ".");
  return s === "" ? Number.NaN : Number(s);
}

function flag(fd: FormLike, name: string): boolean {
  const v = str(fd, name);
  return v === "1" || v === "on" || v === "true";
}

function all(fd: FormLike, name: string): string[] {
  return fd
    .getAll(name)
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean);
}

function issueText(err: z.ZodError, labels: Record<string, string>): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input.";
  const path = issue.path.map(String);
  const label = labels[path.join(".")] ?? labels[path[0] ?? ""] ?? path.join(".");
  let msg = issue.message;
  if (issue.code === "invalid_type" && /nan|number/i.test(msg)) msg = "enter a number";
  else if (issue.code === "too_big" && "maximum" in issue) msg = `must be at most ${String(issue.maximum)}`;
  else if (issue.code === "too_small" && "minimum" in issue) msg = `must be at least ${String(issue.minimum)}`;
  return label ? `${label}: ${msg}` : msg;
}

function parseWith<T>(schema: z.ZodType<T>, raw: unknown, labels: Record<string, string>): Parsed<T> {
  const r = schema.safeParse(raw);
  return r.success ? { ok: true, value: r.data } : { ok: false, error: issueText(r.error, labels) };
}

/** "de, NL  ie" → ["DE","NL","IE"]; null when a token is not two letters. */
export function parseCountryCodes(text: string): string[] | null {
  const tokens = text
    .split(/[\s,;]+/)
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean);
  if (tokens.some((t) => !/^[A-Z]{2}$/.test(t))) return null;
  return [...new Set(tokens)];
}

/** One skill per line or comma; trimmed, de-duplicated case-insensitively, order kept. */
export function parseSkills(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/[\n,]+/)) {
    const s = raw.trim().replace(/\s+/g, " ");
    if (!s) continue;
    const k = s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

const PROFILE_LABELS: Record<string, string> = {
  passport: "Passport",
  degree: "Degree",
  degreeLevel: "Degree level",
  yearsTotal: "Years of experience",
  yearsCloud: "Years in cloud",
  expectedSalaryEur: "Expected salary",
  salaryFloorEur: "Salary floor",
  targetRoles: "Target roles",
  "experienceBand.core": "Core band",
  "experienceBand.show": "Show band",
  "experienceBand.hideBelow": "Hide below",
  "experienceBand.hideAbove": "Hide above",
  targetCountries: "Target countries",
  companyTypes: "Company types",
  skills: "Skills",
};

/** Field name of a role's family chooser. */
export const roleFieldName = (roleKey: string) => `role_${roleKey}`;

export function parseProfileForm(fd: FormLike): Parsed<Profile> {
  const targetRoles: Record<Exclude<TargetFamily, "none">, string[]> = { primary: [], secondary: [], fallback: [] };
  for (const key of ROLE_KEYS) {
    const fam = str(fd, roleFieldName(key));
    if (fam === "primary" || fam === "secondary" || fam === "fallback") targetRoles[fam].push(key);
    else if (fam && !(TARGET_FAMILIES as readonly string[]).includes(fam)) return { ok: false, error: `Target roles: unknown family “${fam}”.` };
  }
  if (targetRoles.primary.length === 0) return { ok: false, error: "Target roles: pick at least one primary role." };

  const extra = parseCountryCodes(str(fd, "countriesExtra"));
  if (extra === null) return { ok: false, error: "Target countries: extra codes must be two-letter ISO codes (e.g. “PL, RO”)." };
  const targetCountries = [...new Set([...all(fd, "countries").map((c) => c.toUpperCase()), ...extra])];
  if (targetCountries.length === 0) return { ok: false, error: "Target countries: pick at least one country." };

  const companyTypes = all(fd, "companyTypes");
  if (companyTypes.length === 0) return { ok: false, error: "Company types: keep at least one type." };
  if (companyTypes.some((t) => !(COMPANY_TYPES_LIST as readonly string[]).includes(t))) return { ok: false, error: "Company types: unknown type." };

  const core: [number, number] = [num(fd, "coreLow"), num(fd, "coreHigh")];
  const show: [number, number] = [num(fd, "showLow"), num(fd, "showHigh")];
  const raw = {
    passport: str(fd, "passport"),
    degree: str(fd, "degree"),
    degreeLevel: str(fd, "degreeLevel"),
    yearsTotal: num(fd, "yearsTotal"),
    yearsCloud: num(fd, "yearsCloud"),
    expectedSalaryEur: num(fd, "expectedSalaryEur"),
    salaryFloorEur: num(fd, "salaryFloorEur"),
    targetRoles,
    experienceBand: { core, show, hideBelow: num(fd, "hideBelow"), hideAbove: num(fd, "hideAbove") },
    targetCountries,
    companyTypes,
    skills: parseSkills(str(fd, "skills")),
  };
  const parsed = parseWith(profileSchema, raw, PROFILE_LABELS);
  if (!parsed.ok) return parsed;
  const p = parsed.value;
  if (p.salaryFloorEur > p.expectedSalaryEur) return { ok: false, error: "Salary floor: must not be above the expected salary." };
  if (p.yearsCloud > p.yearsTotal) return { ok: false, error: "Years in cloud: must not be more than the total years." };
  const eb = p.experienceBand;
  if (eb.core[0] < eb.show[0] || eb.core[1] > eb.show[1]) return { ok: false, error: "Core band: must sit inside the show band." };
  if (eb.hideBelow >= eb.hideAbove) return { ok: false, error: "Hide below: must be less than hide above." };
  if (eb.hideBelow > eb.show[0] || eb.hideAbove < eb.show[1]) return { ok: false, error: "Show band: must sit between hide below and hide above." };
  return parsed;
}

export const WEIGHT_LABELS: Record<(typeof SCORE_COMPONENT_KEYS)[number], string> = {
  role: "Role match",
  experience: "Experience fit",
  visa: "Visa",
  salary: "Salary",
  remote: "Remote",
  language: "Language",
  freshness: "Freshness",
  skills: "Skills",
  company: "Company",
};

export const weightFieldName = (key: string) => `w_${key}`;

/** Sum of the weights (NaN entries count as 0). */
export function weightsTotal(w: Partial<Record<string, number>>): number {
  let t = 0;
  for (const k of SCORE_COMPONENT_KEYS) {
    const v = w[k];
    if (typeof v === "number" && Number.isFinite(v)) t += v;
  }
  return Math.round(t * 1000) / 1000;
}

export function parseWeightsForm(fd: FormLike): Parsed<ScoreWeights> {
  const raw: Record<string, number> = {};
  for (const k of SCORE_COMPONENT_KEYS) raw[k] = num(fd, weightFieldName(k));
  const parsed = parseWith(scoreWeightsSchema, raw, WEIGHT_LABELS);
  if (!parsed.ok) return parsed;
  const total = weightsTotal(parsed.value);
  if (total !== WEIGHTS_TOTAL) return { ok: false, error: `The weights must add up to ${WEIGHTS_TOTAL} (they add up to ${total}).` };
  return parsed;
}

const ALERT_LABELS: Record<string, string> = {
  minSeverity: "Minimum severity",
  volumeDropPct: "Volume drop",
  volumeSpikePct: "Volume spike",
  parseFailPct: "Parse failures",
  fieldDriftPct: "Field drift",
  heartbeatHours: "Heartbeat",
  digestHour: "Digest hour",
};

export function parseAlertsForm(fd: FormLike): Parsed<AlertSettings> {
  return parseWith(
    alertSettingsSchema,
    {
      telegram: flag(fd, "telegram"),
      email: flag(fd, "email"),
      minSeverity: str(fd, "minSeverity"),
      volumeDropPct: num(fd, "volumeDropPct"),
      volumeSpikePct: num(fd, "volumeSpikePct"),
      parseFailPct: num(fd, "parseFailPct"),
      fieldDriftPct: num(fd, "fieldDriftPct"),
      heartbeatHours: num(fd, "heartbeatHours"),
      digest: flag(fd, "digest"),
      digestHour: num(fd, "digestHour"),
    },
    ALERT_LABELS,
  );
}

const AI_LABELS: Record<string, string> = { dailyLimit: "Daily limit", reserveForManual: "Manual reserve" };

export function parseAiForm(fd: FormLike): Parsed<AiSettings> {
  const parsed = parseWith(
    aiSettingsSchema,
    { enabled: flag(fd, "enabled"), dailyLimit: num(fd, "dailyLimit"), reserveForManual: num(fd, "reserveForManual") },
    AI_LABELS,
  );
  if (!parsed.ok) return parsed;
  if (parsed.value.dailyLimit > AI_DAILY_LIMIT_MAX) return { ok: false, error: `Daily limit: must be at most ${AI_DAILY_LIMIT_MAX}.` };
  if (parsed.value.reserveForManual > parsed.value.dailyLimit) return { ok: false, error: "Manual reserve: must not exceed the daily limit." };
  return parsed;
}

export function parseRetentionForm(fd: FormLike): Parsed<RetentionSettings> {
  return parseWith(retentionSettingsSchema, { rawDays: num(fd, "rawDays") }, { rawDays: "Raw snapshot retention" });
}

/** Keys shown on /settings (title_overrides is edited from /review, fx_rates by the worker). */
export const EDITABLE_SETTING_KEYS = ["profile", "score_weights", "alerts", "ai", "retention"] as const;
export type EditableSettingKey = (typeof EDITABLE_SETTING_KEYS)[number];

/** Top-level keys whose value changed (for the "what changed" line of a save). */
export function changedKeys(before: unknown, after: unknown): string[] {
  const a = before && typeof before === "object" ? (before as Record<string, unknown>) : {};
  const b = after && typeof after === "object" ? (after as Record<string, unknown>) : {};
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k])).sort();
}
