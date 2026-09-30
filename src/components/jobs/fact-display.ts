/**
 * One-line human readings of stored fact / override values (fact ledger, overrides list, change
 * history, correction receipts). Pure and defensive: values come from JSON columns, so every shape
 * is checked before it is trusted, and anything unrecognised is shown as compact JSON (never hidden).
 */
import { formatDate, formatEurRange, formatMoneyRange, formatNumber, truncate } from "@/components/ui/format";
import { ELIGIBILITY_META, VISA_META, isEligibilityResult, isVisaStatus } from "@/components/ui/status";
import { FIELD_SPECS, isEditableField } from "./field-edit";
import {
  EXPERIENCE_BAND_LABEL,
  FAMILY_LABEL,
  LANGUAGE_LABEL,
  REMOTE_LABEL,
  SENIORITY_LABEL,
  WORKPLACE_LABEL,
  labelOf,
  roleKeyLabel,
} from "./labels";

/** Labels for every fact key and editable column (ledger headings). */
export function factLabel(key: string): string {
  if (isEditableField(key)) return FIELD_SPECS[key].label;
  switch (key) {
    case "visa_signal":
      return "Visa signal";
    case "ai_summary":
      return "AI summary";
    case "red_flags":
      return "Red flags";
    default:
      return key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  }
}

const VISA_SIGNAL_LABEL: Record<string, string> = {
  offered: "Sponsorship offered",
  not_offered: "No sponsorship",
  relocation: "Relocation support",
  right_to_work_required: "Right to work required",
};

export const PERIOD_LABEL: Record<string, string> = { hour: "hour", day: "day", month: "month", year: "year" };

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

function json(v: unknown, max = 80): string {
  try {
    return truncate(JSON.stringify(v) ?? String(v), max);
  } catch {
    return "[unreadable value]";
  }
}

/** "€60k–€75k/yr" from annual EUR; falls back to the original currency and period. */
export function describeSalary(v: unknown): string {
  if (!isObj(v)) return json(v);
  const eurMin = num(v.annualEurMin);
  const eurMax = num(v.annualEurMax);
  const min = num(v.min);
  const max = num(v.max);
  const currency = str(v.currency) ?? "EUR";
  const period = str(v.period) ?? "year";
  const original = min !== null || max !== null ? `${formatMoneyRange(min, max, currency)}/${PERIOD_LABEL[period] ?? period}` : null;
  const annual = eurMin !== null || eurMax !== null ? `${formatEurRange(eurMin, eurMax)}/yr` : null;
  const kind = v.kind === "estimated" ? "estimated" : "stated";
  const gross = v.grossNet === "net" ? " net" : v.grossNet === "gross" ? " gross" : "";
  if (annual && original && (currency !== "EUR" || period !== "year")) return `${annual}${gross} (${original}, ${kind})`;
  if (annual) return `${annual}${gross} (${kind})`;
  if (original) return `${original}${gross} (${kind}, not converted)`;
  return `No amount (${kind})`;
}

/** One-line reading of a value stored for `key`. */
export function describeFactValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "Not set";
  switch (key) {
    case "visa_status": {
      const s = isObj(value) ? value.status : value;
      return isVisaStatus(s) ? VISA_META[s].label : json(value);
    }
    case "visa_signal": {
      if (!isObj(value)) return json(value);
      const label = VISA_SIGNAL_LABEL[String(value.signal)] ?? String(value.signal ?? "Signal");
      const quote = str(value.quote);
      return quote ? `${label}: “${truncate(quote, 90)}”` : label;
    }
    case "salary":
      return describeSalary(value);
    case "experience": {
      if (!isObj(value)) return json(value);
      const lo = num(value.minYears);
      const hi = num(value.maxYears);
      const years = lo !== null && hi !== null ? `${lo}–${hi} yrs` : lo !== null ? `${lo}+ yrs` : hi !== null ? `up to ${hi} yrs` : "Years not stated";
      const band = labelOf(EXPERIENCE_BAND_LABEL, str(value.band));
      return `${years} · ${band}${value.securityStrict === true ? " · security years" : ""}`;
    }
    case "seniority": {
      const w = isObj(value) ? value.word : value;
      return w === null || w === undefined || w === "" ? "No seniority word" : labelOf(SENIORITY_LABEL, String(w));
    }
    case "remote": {
      if (!isObj(value)) return json(value);
      const regions = strList(value.regions);
      return `${labelOf(REMOTE_LABEL, str(value.class))}${regions.length ? ` · ${regions.join(", ")}` : ""}`;
    }
    case "language": {
      if (!isObj(value)) return json(value);
      const langs = strList(value.languages).map((l) => l.toUpperCase());
      const posting = str(value.postingLang);
      return `${labelOf(LANGUAGE_LABEL, str(value.requirement))}${langs.length ? ` · ${langs.join(", ")}` : ""}${posting ? ` · posting in ${posting.toUpperCase()}` : ""}`;
    }
    case "closing_date":
      return typeof value === "string" ? formatDate(`${value.slice(0, 10)}T12:00:00Z`) : json(value);
    case "role": {
      if (!isObj(value)) return json(value);
      const title = str(value.canonicalTitle);
      const role = roleKeyLabel(str(value.roleKey));
      const family = labelOf(FAMILY_LABEL, str(value.roleFamily));
      // The role key often reads the same as the canonical title; say it once.
      const sameAsTitle = title !== null && title.trim().toLowerCase() === role.trim().toLowerCase();
      return `${title && !sameAsTitle ? `${title} · ` : ""}${sameAsTitle ? title : role} · ${family}`;
    }
    case "skills": {
      if (!isObj(value)) return json(value);
      const found = strList(value.found);
      const matched = strList(value.matched);
      return `${matched.length} of ${found.length} matched${found.length ? `: ${truncate(found.join(", "), 80)}` : ""}`;
    }
    case "eligibility": {
      if (!isObj(value)) return json(value);
      const r = value.result;
      const label = isEligibilityResult(r) ? ELIGIBILITY_META[r].label : String(r ?? "Unknown");
      const reason = str(value.reason);
      return reason ? `${label}: ${truncate(reason, 90)}` : label;
    }
    case "suspicious": {
      if (typeof value === "boolean") return value ? "Flagged suspicious" : "Not suspicious";
      if (!isObj(value)) return json(value);
      const reasons = strList(value.reasons);
      return `${value.suspicious === true ? "Flagged suspicious" : "Not suspicious"}${reasons.length ? ` · ${reasons.join("; ")}` : ""}`;
    }
    case "ai_summary": {
      const s = typeof value === "string" ? value : isObj(value) ? str(value.summary) : null;
      return s ? truncate(s, 120) : json(value);
    }
    case "red_flags": {
      if (typeof value === "string") return truncate(value, 100);
      if (Array.isArray(value)) return truncate(strList(value).join("; ") || "None", 100);
      if (isObj(value)) return str(value.flag) ?? str(value.reason) ?? json(value);
      return json(value);
    }
    case "workplace_type":
      return typeof value === "string" ? labelOf(WORKPLACE_LABEL, value) : json(value);
    case "title":
    case "city":
    case "country":
      return typeof value === "string" ? value : json(value);
    default:
      if (typeof value === "string") return truncate(value, 100);
      if (typeof value === "number") return formatNumber(value);
      if (typeof value === "boolean") return value ? "Yes" : "No";
      return json(value);
  }
}

/** Evidence quote that is worth showing (not just the value restated). */
export function evidenceOf(evidence: string | null | undefined): string | null {
  const e = evidence?.trim();
  return e ? truncate(e, 400) : null;
}
