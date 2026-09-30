/**
 * Turns the raw inputs of the override / correction forms into the stored value shape of each
 * field (the fact value types of src/lib/contracts/jobs.ts, or plain column values), and back into
 * form defaults. Pure: FX table and experience-band settings are passed in.
 */
import {
  ELIGIBILITY_RESULTS,
  LANGUAGE_REQUIREMENTS,
  REMOTE_CLASSES,
  ROLE_FAMILIES,
  SENIORITY_WORDS,
  VISA_STATUSES,
  WORKPLACE_TYPES,
} from "@/db/schema/_enums";
import type { EligibilityValue, ExperienceValue, FxTable, LanguageValue, RemoteValue, RoleValue, SalaryPeriod, SalaryValue, SkillsValue } from "@/lib/contracts/jobs";
import { lookupRate } from "@/lib/fx/rates";
import { experienceBandFor, type ExperienceBandSettings } from "@/lib/normalize/experience";
import { annualize } from "@/lib/normalize/salary";
import { FIELD_SPECS, type EditableField } from "./field-edit";

export interface FieldValueContext {
  fx: FxTable;
  experienceBand: ExperienceBandSettings;
}

export type FieldValueResult = { ok: true; value: unknown } | { ok: false; error: string };

/** Shape stored for the `suspicious` field (the contract leaves it open). */
export interface SuspiciousValue {
  suspicious: boolean;
  reasons: string[];
}

const PERIODS: readonly SalaryPeriod[] = ["year", "month", "day", "hour"];
const GROSS_NET = ["gross", "net", "unknown"] as const;

function has<T extends string>(list: readonly T[], v: string): v is T {
  return (list as readonly string[]).includes(v);
}

function text(raw: Record<string, string>, name: string): string {
  return (raw[name] ?? "").trim();
}

/** Non-negative number from a form input; "" → null; garbage → NaN. */
function num(raw: Record<string, string>, name: string): number | null {
  const s = text(raw, name).replace(/[\s_]/g, "").replace(/,(?=\d{3}(\D|$))/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d+)?$/.test(s)) return Number.NaN;
  return Number(s);
}

function csv(raw: Record<string, string>, name: string, maxItems: number, maxLen: number): string[] | null {
  const s = text(raw, name);
  if (!s) return [];
  const items = [...new Set(s.split(",").map((x) => x.trim()).filter(Boolean))];
  if (items.length > maxItems || items.some((x) => x.length > maxLen)) return null;
  return items;
}

function checked(raw: Record<string, string>, name: string): boolean {
  return ["on", "1", "true", "yes"].includes(text(raw, name).toLowerCase());
}

const fail = (error: string): FieldValueResult => ({ ok: false, error });
const ok = (value: unknown): FieldValueResult => ({ ok: true, value });

function roundEur(n: number | null): number | null {
  return n === null || !Number.isFinite(n) ? null : Math.round(n);
}

export function buildSalaryValue(
  input: { min: number | null; max: number | null; currency: string; period: SalaryPeriod; grossNet: SalaryValue["grossNet"]; installments: number | null },
  fx: FxTable,
): SalaryValue {
  const rate = lookupRate(fx, input.currency);
  const installments = input.period === "month" ? input.installments : null;
  const annualEur = (amount: number | null) => (amount === null || !rate ? null : roundEur(annualize(amount, input.period, installments) / rate.rate));
  return {
    min: input.min,
    max: input.max,
    currency: input.currency,
    period: input.period,
    grossNet: input.grossNet,
    installments,
    annualEurMin: annualEur(input.min),
    annualEurMax: annualEur(input.max),
    fxRate: rate ? rate.rate : null,
    fxDate: rate ? rate.date : null,
    kind: "stated",
  };
}

/** Validates the form inputs of `field` and builds its stored value. */
export function buildFieldValue(field: EditableField, raw: Record<string, string>, ctx: FieldValueContext): FieldValueResult {
  switch (field) {
    case "visa_status": {
      const status = text(raw, "status");
      if (!has(VISA_STATUSES, status)) return fail("Pick a visa status.");
      return ok({ status, reasons: [] });
    }
    case "salary": {
      const min = num(raw, "min");
      const max = num(raw, "max");
      if (Number.isNaN(min) || Number.isNaN(max)) return fail("Salary amounts must be plain numbers.");
      if (min === null && max === null) return fail("Enter a minimum, a maximum or both.");
      if (min !== null && max !== null && min > max) return fail("Minimum is above maximum.");
      const currency = text(raw, "currency").toUpperCase() || "EUR";
      if (!/^[A-Z]{3}$/.test(currency)) return fail("Currency must be a 3-letter code like EUR or GBP.");
      const period = text(raw, "period");
      if (!has(PERIODS, period)) return fail("Pick a pay period.");
      const grossNet = text(raw, "grossNet") || "unknown";
      if (!has(GROSS_NET, grossNet)) return fail("Pick gross, net or not stated.");
      const inst = num(raw, "installments");
      if (Number.isNaN(inst) || (inst !== null && (!Number.isInteger(inst) || inst < 12 || inst > 16))) {
        return fail("Monthly payments per year must be between 12 and 16.");
      }
      return ok(buildSalaryValue({ min, max, currency, period, grossNet, installments: inst }, ctx.fx));
    }
    case "experience": {
      const minYears = num(raw, "minYears");
      const maxYears = num(raw, "maxYears");
      if (Number.isNaN(minYears) || Number.isNaN(maxYears)) return fail("Years must be whole numbers.");
      const bad = (n: number | null) => n !== null && (!Number.isInteger(n) || n > 40);
      if (bad(minYears) || bad(maxYears)) return fail("Years must be whole numbers from 0 to 40.");
      if (minYears === null && maxYears === null) return fail("Enter the minimum years, the maximum or both.");
      if (minYears !== null && maxYears !== null && minYears > maxYears) return fail("Minimum years is above the maximum.");
      const value: ExperienceValue = {
        minYears,
        maxYears,
        band: experienceBandFor(minYears, maxYears, ctx.experienceBand),
        securityStrict: checked(raw, "securityStrict"),
      };
      return ok(value);
    }
    case "seniority": {
      const word = text(raw, "word");
      if (word && !has(SENIORITY_WORDS, word)) return fail("Pick a seniority.");
      return ok({ word: word || null });
    }
    case "remote": {
      const cls = text(raw, "class");
      if (!has(REMOTE_CLASSES, cls)) return fail("Pick a remote class.");
      const regions = csv(raw, "regions", 20, 40);
      if (!regions) return fail("Up to 20 regions, each under 40 characters.");
      const value: RemoteValue = { class: cls, regions };
      return ok(value);
    }
    case "language": {
      const requirement = text(raw, "requirement");
      if (!has(LANGUAGE_REQUIREMENTS, requirement)) return fail("Pick a language requirement.");
      const languages = csv(raw, "languages", 10, 3);
      const codes = languages?.map((l) => l.toLowerCase());
      if (!codes || codes.some((c) => !/^[a-z]{2,3}$/.test(c))) return fail("Languages must be ISO codes like de, nl, fr.");
      const postingLang = text(raw, "postingLang").toLowerCase();
      if (postingLang && !/^[a-z]{2,3}$/.test(postingLang)) return fail("Posting language must be an ISO code like en.");
      const value: LanguageValue = { postingLang: postingLang || null, requirement, languages: codes };
      return ok(value);
    }
    case "closing_date": {
      const date = text(raw, "date");
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
      const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
      if (!m || !d || d.toISOString().slice(0, 10) !== date) return fail("Enter a real date (YYYY-MM-DD).");
      return ok(date);
    }
    case "role": {
      const roleKey = text(raw, "roleKey").toLowerCase();
      if (roleKey && !/^[a-z0-9_]{1,64}$/.test(roleKey)) return fail("Role key: lowercase letters, digits and underscores.");
      const roleFamily = text(raw, "roleFamily");
      if (!has(ROLE_FAMILIES, roleFamily)) return fail("Pick a role family.");
      const canonicalTitle = text(raw, "canonicalTitle");
      if (!canonicalTitle || canonicalTitle.length > 255) return fail("Canonical title is required (max 255).");
      const value: RoleValue = { roleKey: roleKey || null, roleFamily, canonicalTitle };
      return ok(value);
    }
    case "skills": {
      const found = csv(raw, "found", 60, 40);
      const matched = csv(raw, "matched", 60, 40);
      if (!found || !matched) return fail("Up to 60 skills, each under 40 characters.");
      if (!found.length && !matched.length) return fail("List at least one skill.");
      const value: SkillsValue = { found, matched };
      return ok(value);
    }
    case "eligibility": {
      const result = text(raw, "result");
      if (!has(ELIGIBILITY_RESULTS, result)) return fail("Pick an eligibility result.");
      const reason = text(raw, "explain");
      if (!reason || reason.length > 500) return fail("Say why (max 500 characters).");
      const value: EligibilityValue = { result, reason, marginPct: null, ruleVerifiedAt: null, rule: null };
      return ok(value);
    }
    case "suspicious": {
      const flag = text(raw, "flag");
      if (flag !== "yes" && flag !== "no") return fail("Pick yes or no.");
      const value: SuspiciousValue = { suspicious: flag === "yes", reasons: [] };
      return ok(value);
    }
    case "title": {
      const title = text(raw, "title").replace(/\s+/g, " ");
      if (!title || title.length > 255) return fail("Title is required (max 255).");
      return ok(title);
    }
    case "country": {
      const c = text(raw, "country").toUpperCase();
      if (!c) return ok(null);
      if (!/^[A-Z]{2}$/.test(c)) return fail("Country must be a 2-letter ISO code.");
      return ok(c);
    }
    case "city": {
      const city = text(raw, "city").replace(/\s+/g, " ");
      if (city.length > 128) return fail("City is at most 128 characters.");
      return ok(city || null);
    }
    case "workplace_type": {
      const w = text(raw, "workplace");
      if (!w) return ok(null);
      if (!has(WORKPLACE_TYPES, w)) return fail("Pick on-site, hybrid or remote.");
      return ok(w);
    }
  }
}

// ---- form defaults ---------------------------------------------------------------------------

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  return typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "";
}

function strList(v: unknown): string {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").join(", ") : "";
}

export interface JobColumnDefaults {
  title: string;
  countryIso2: string | null;
  city: string | null;
  workplaceType: string | null;
  closingAt: Date | null;
}

/** Pre-fills the inputs of `field` from its current value (winner fact or job column). */
export function formDefaults(field: EditableField, current: unknown, job: JobColumnDefaults): Record<string, string> {
  const o = obj(current);
  const out: Record<string, string> = {};
  switch (field) {
    case "visa_status":
      out.status = str(o?.status) || "unknown";
      break;
    case "salary":
      out.min = str(o?.min);
      out.max = str(o?.max);
      out.currency = str(o?.currency) || "EUR";
      out.period = str(o?.period) || "year";
      out.grossNet = str(o?.grossNet) || "gross";
      out.installments = str(o?.installments);
      break;
    case "experience":
      out.minYears = str(o?.minYears);
      out.maxYears = str(o?.maxYears);
      out.securityStrict = o?.securityStrict === true ? "on" : "";
      break;
    case "seniority":
      out.word = str(o?.word);
      break;
    case "remote":
      out.class = str(o?.class) || "unclear";
      out.regions = strList(o?.regions);
      break;
    case "language":
      out.requirement = str(o?.requirement) || "unclear";
      out.languages = strList(o?.languages);
      out.postingLang = str(o?.postingLang);
      break;
    case "closing_date": {
      const s = typeof current === "string" ? current : str(o?.date);
      out.date = s ? s.slice(0, 10) : job.closingAt ? job.closingAt.toISOString().slice(0, 10) : "";
      break;
    }
    case "role":
      out.roleKey = str(o?.roleKey);
      out.roleFamily = str(o?.roleFamily) || "other";
      out.canonicalTitle = str(o?.canonicalTitle) || job.title;
      break;
    case "skills":
      out.found = strList(o?.found);
      out.matched = strList(o?.matched);
      break;
    case "eligibility":
      out.result = str(o?.result) || "cant_tell";
      out.explain = "";
      break;
    case "suspicious": {
      const flagged = typeof current === "boolean" ? current : o?.suspicious === true;
      out.flag = flagged ? "yes" : "no";
      break;
    }
    case "title":
      out.title = job.title;
      break;
    case "country":
      out.country = job.countryIso2 ?? "";
      break;
    case "city":
      out.city = job.city ?? "";
      break;
    case "workplace_type":
      out.workplace = job.workplaceType ?? "";
      break;
  }
  // Only keys the form actually has.
  const names = new Set(FIELD_SPECS[field].inputs.map((i) => i.name));
  return Object.fromEntries(Object.entries(out).filter(([k]) => names.has(k)));
}
