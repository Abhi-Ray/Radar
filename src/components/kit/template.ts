/**
 * Fill-in templates (spec §22: cover letters and outreach "with fill-in fields"). A template body
 * is kit Markdown with `{{key}}` slots; `templates.fields_json` may declare labels and hints for
 * them. Pure and client-safe (the live preview runs in the browser).
 */
import { SLOT_RE } from "./markdown";

export interface TemplateField {
  key: string;
  label: string;
  hint: string | null;
  /** Declared in fields_json. */
  declared: boolean;
  /** Appears in the body as {{key}}. */
  used: boolean;
}

const KEY = /^[A-Za-z][\w.-]{0,40}$/;
export const MAX_FIELDS = 40;
const MAX_LABEL = 80;
const MAX_HINT = 200;

/** "company_name" / "hiringManager" / "role.title" → "Company name" / "Hiring manager" / "Role title". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_.-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function clip(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

/**
 * Reads `fields_json` leniently: `["company", {key:"role", label:"Role", hint:"…"}]`. Unknown
 * shapes and bad keys are skipped; duplicates keep the first.
 */
export function parseFieldsJson(v: unknown): Array<Pick<TemplateField, "key" | "label" | "hint">> {
  if (!Array.isArray(v)) return [];
  const out: Array<Pick<TemplateField, "key" | "label" | "hint">> = [];
  const seen = new Set<string>();
  for (const item of v) {
    let key: string | null = null;
    let label: string | null = null;
    let hint: string | null = null;
    if (typeof item === "string") key = item.trim();
    else if (item && typeof item === "object" && !Array.isArray(item)) {
      const o = item as Record<string, unknown>;
      key = typeof o.key === "string" ? o.key.trim() : null;
      label = clip(o.label, MAX_LABEL);
      hint = clip(o.hint, MAX_HINT);
    }
    if (!key || !KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    out.push({ key, label: label ?? humanizeKey(key), hint });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/** Slot keys in the order they first appear in the body. */
export function slotKeys(body: string | null | undefined): string[] {
  if (typeof body !== "string") return [];
  const out: string[] = [];
  for (const m of body.matchAll(new RegExp(SLOT_RE.source, "g"))) if (!out.includes(m[1])) out.push(m[1]);
  return out.slice(0, MAX_FIELDS);
}

/** The form for a template: declared fields first (in their order), then any other slot in the body. */
export function templateFields(body: string | null | undefined, fieldsJson: unknown): TemplateField[] {
  const used = slotKeys(body);
  const declared = parseFieldsJson(fieldsJson);
  const out: TemplateField[] = declared.map((f) => ({ ...f, declared: true, used: used.includes(f.key) }));
  for (const key of used) {
    if (out.some((f) => f.key === key)) continue;
    out.push({ key, label: humanizeKey(key), hint: null, declared: false, used: true });
  }
  return out.slice(0, MAX_FIELDS);
}

/** Replaces filled slots; unfilled ones stay as `{{key}}` and are listed in `missing`. */
export function fillTemplate(body: string, values: Record<string, string | undefined>): { text: string; missing: string[] } {
  const missing: string[] = [];
  const text = body.replace(new RegExp(SLOT_RE.source, "g"), (whole, key: string) => {
    const v = values[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (!missing.includes(key)) missing.push(key);
    return whole;
  });
  return { text, missing };
}

/** Serialises the editor's field list back to fields_json (labels only when they differ). */
export function fieldsToJson(fields: ReadonlyArray<{ key: string; label?: string | null; hint?: string | null }>): Array<{ key: string; label?: string; hint?: string }> {
  const out: Array<{ key: string; label?: string; hint?: string }> = [];
  const seen = new Set<string>();
  for (const f of fields) {
    const key = f.key.trim();
    if (!KEY.test(key) || seen.has(key)) continue;
    seen.add(key);
    const entry: { key: string; label?: string; hint?: string } = { key };
    const label = clip(f.label, MAX_LABEL);
    const hint = clip(f.hint, MAX_HINT);
    if (label && label !== humanizeKey(key)) entry.label = label;
    if (hint) entry.hint = hint;
    out.push(entry);
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/**
 * Parses the "fields" textarea of the template editor: one field per line, `key | Label | hint`
 * (label and hint optional). Returns the fields and the lines it could not read.
 */
export function parseFieldLines(text: string): { fields: Array<{ key: string; label: string | null; hint: string | null }>; bad: string[] } {
  const fields: Array<{ key: string; label: string | null; hint: string | null }> = [];
  const bad: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const [key, label, ...hint] = line.split("|").map((s) => s.trim());
    const k = key.replace(/^\{\{\s*|\s*\}\}$/g, "");
    if (!KEY.test(k)) {
      bad.push(line);
      continue;
    }
    fields.push({ key: k, label: label || null, hint: hint.join(" | ").trim() || null });
  }
  return { fields, bad };
}

/** The editor textarea text for stored fields (inverse of parseFieldLines). */
export function fieldLines(fieldsJson: unknown): string {
  return parseFieldsJson(fieldsJson)
    .map((f) => {
      const parts = [f.key];
      if (f.label !== humanizeKey(f.key) || f.hint) parts.push(f.label);
      if (f.hint) parts.push(f.hint);
      return parts.join(" | ");
    })
    .join("\n");
}

/** What the kit knows about a job, for prefilling common slots. */
export interface PrefillSource {
  company?: string | null;
  title?: string | null;
  country?: string | null;
  city?: string | null;
  whyCompany?: string | null;
  skills?: readonly string[];
  source?: string | null;
}

const PREFILL_ALIASES: Record<keyof PrefillSource, readonly string[]> = {
  company: ["company", "company_name", "companyname", "employer", "organisation", "organization"],
  title: ["role", "title", "job_title", "jobtitle", "position", "role_title"],
  country: ["country"],
  city: ["city", "location", "office"],
  whyCompany: ["why_company", "whycompany", "why_this_company", "why"],
  skills: ["skills", "key_skills", "keyskills", "top_skills"],
  source: ["source", "where_found", "found_on"],
};

/** Values for the slots the job can answer (only non-empty ones). */
export function prefillValues(fields: readonly Pick<TemplateField, "key">[], src: PrefillSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const k = f.key.toLowerCase().replace(/[-.]/g, "_");
    for (const [name, aliases] of Object.entries(PREFILL_ALIASES) as Array<[keyof PrefillSource, readonly string[]]>) {
      if (!aliases.includes(k)) continue;
      const v = src[name];
      const text = Array.isArray(v) ? (v.length ? v.slice(0, 6).join(", ") : null) : typeof v === "string" && v.trim() ? v.trim() : null;
      if (text) out[f.key] = text;
    }
  }
  return out;
}
