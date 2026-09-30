/**
 * Editable job fields for "Manual override" and "Report wrong info": which inputs each field has.
 * Pure data, safe in client components (the value builder lives in ./field-values.ts, server side).
 * Input names are prefixed with `v_` in forms so they never collide with the action's own fields.
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
import { ELIGIBILITY_META, VISA_META } from "@/components/ui/status";
import { FAMILY_LABEL, LANGUAGE_LABEL, REMOTE_LABEL, SENIORITY_LABEL, WORKPLACE_LABEL } from "./labels";

/** Mirrors OVERRIDE_FIELDS in src/lib/provenance/resolve.ts (fact fields first, then job columns). */
export const EDITABLE_FIELDS = [
  "visa_status",
  "salary",
  "experience",
  "seniority",
  "remote",
  "language",
  "closing_date",
  "role",
  "skills",
  "eligibility",
  "suspicious",
  "title",
  "country",
  "city",
  "workplace_type",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

export function isEditableField(v: unknown): v is EditableField {
  return typeof v === "string" && (EDITABLE_FIELDS as readonly string[]).includes(v);
}

export interface SelectOptionSpec {
  value: string;
  label: string;
}

export type InputSpec =
  | { name: string; label: string; type: "select"; options: SelectOptionSpec[]; required?: boolean; hint?: string }
  | { name: string; label: string; type: "number"; min: number; max: number; step?: number; required?: boolean; hint?: string; suffix?: string }
  | { name: string; label: string; type: "text"; maxLength: number; required?: boolean; hint?: string; placeholder?: string; mono?: boolean }
  | { name: string; label: string; type: "date"; required?: boolean; hint?: string }
  | { name: string; label: string; type: "checkbox"; hint?: string }
  | { name: string; label: string; type: "textarea"; maxLength: number; required?: boolean; hint?: string; rows?: number };

export interface FieldSpec {
  field: EditableField;
  label: string;
  /** One line on what the override changes. */
  help: string;
  inputs: InputSpec[];
}

const opts = <T extends string>(values: readonly T[], label: (v: T) => string): SelectOptionSpec[] =>
  values.map((v) => ({ value: v, label: label(v) }));

export const FIELD_SPECS: Record<EditableField, FieldSpec> = {
  visa_status: {
    field: "visa_status",
    label: "Visa status",
    help: "Your verdict beats every register, posting and rule signal.",
    inputs: [{ name: "status", label: "Status", type: "select", required: true, options: opts(VISA_STATUSES, (s) => VISA_META[s].label) }],
  },
  salary: {
    field: "salary",
    label: "Salary",
    help: "Recorded as a stated salary; converted to annual EUR with today's cached ECB rate.",
    inputs: [
      { name: "min", label: "Minimum", type: "number", min: 0, max: 100_000_000, step: 1, hint: "Leave empty if only a maximum is known." },
      { name: "max", label: "Maximum", type: "number", min: 0, max: 100_000_000, step: 1 },
      { name: "currency", label: "Currency", type: "text", maxLength: 3, required: true, placeholder: "EUR", mono: true },
      {
        name: "period",
        label: "Per",
        type: "select",
        required: true,
        options: [
          { value: "year", label: "Year" },
          { value: "month", label: "Month" },
          { value: "day", label: "Day" },
          { value: "hour", label: "Hour" },
        ],
      },
      {
        name: "grossNet",
        label: "Gross or net",
        type: "select",
        required: true,
        options: [
          { value: "gross", label: "Gross" },
          { value: "net", label: "Net" },
          { value: "unknown", label: "Not stated" },
        ],
      },
      { name: "installments", label: "Monthly payments per year", type: "number", min: 12, max: 16, step: 1, hint: "Only for monthly pay, e.g. 14 in Spain or Austria." },
    ],
  },
  experience: {
    field: "experience",
    label: "Experience asked",
    help: "Years the posting really asks for. The band (core / within reach / outside) follows your profile.",
    inputs: [
      { name: "minYears", label: "Minimum years", type: "number", min: 0, max: 40, step: 1 },
      { name: "maxYears", label: "Maximum years", type: "number", min: 0, max: 40, step: 1 },
      { name: "securityStrict", label: "Strict security-years requirement", type: "checkbox", hint: "Years must be in security specifically." },
    ],
  },
  seniority: {
    field: "seniority",
    label: "Seniority",
    help: "The seniority word the role really carries.",
    inputs: [
      {
        name: "word",
        label: "Seniority",
        type: "select",
        options: [{ value: "", label: "None stated" }, ...opts(SENIORITY_WORDS, (w) => SENIORITY_LABEL[w])],
      },
    ],
  },
  remote: {
    field: "remote",
    label: "Remote eligibility",
    help: "Whether you can take this remotely from where you are.",
    inputs: [
      { name: "class", label: "Remote class", type: "select", required: true, options: opts(REMOTE_CLASSES, (c) => REMOTE_LABEL[c]) },
      { name: "regions", label: "Allowed regions", type: "text", maxLength: 200, placeholder: "EU, UK", hint: "Comma-separated. Empty for worldwide." },
    ],
  },
  language: {
    field: "language",
    label: "Language",
    help: "Whether English is enough for this role.",
    inputs: [
      { name: "requirement", label: "Requirement", type: "select", required: true, options: opts(LANGUAGE_REQUIREMENTS, (r) => LANGUAGE_LABEL[r]) },
      { name: "languages", label: "Required languages", type: "text", maxLength: 60, placeholder: "de, nl", mono: true, hint: "ISO 639-1 codes, comma-separated." },
      { name: "postingLang", label: "Posting language", type: "text", maxLength: 8, placeholder: "en", mono: true },
    ],
  },
  closing_date: {
    field: "closing_date",
    label: "Closing date",
    help: "Last day to apply, as a calendar date.",
    inputs: [{ name: "date", label: "Closes on", type: "date", required: true }],
  },
  role: {
    field: "role",
    label: "Role match",
    help: "Which of your target roles this really is.",
    inputs: [
      { name: "roleKey", label: "Role key", type: "text", maxLength: 64, placeholder: "cloud_security_engineer", mono: true, hint: "Lowercase with underscores. Empty = unmapped." },
      { name: "roleFamily", label: "Role family", type: "select", required: true, options: opts(ROLE_FAMILIES, (f) => FAMILY_LABEL[f]) },
      { name: "canonicalTitle", label: "Canonical title", type: "text", maxLength: 255, required: true },
    ],
  },
  skills: {
    field: "skills",
    label: "Skills",
    help: "Skills the posting asks for, and which of them you have.",
    inputs: [
      { name: "found", label: "Skills in the posting", type: "text", maxLength: 500, placeholder: "AWS, Terraform, IAM", hint: "Comma-separated." },
      { name: "matched", label: "Of those, you have", type: "text", maxLength: 500, placeholder: "AWS, IAM" },
    ],
  },
  eligibility: {
    field: "eligibility",
    label: "Am I eligible?",
    help: "Your own reading of the country rule for this job.",
    inputs: [
      { name: "result", label: "Result", type: "select", required: true, options: opts(ELIGIBILITY_RESULTS, (r) => ELIGIBILITY_META[r].label) },
      { name: "explain", label: "Why", type: "textarea", maxLength: 500, required: true, rows: 2 },
    ],
  },
  suspicious: {
    field: "suspicious",
    label: "Suspicious posting",
    help: "Flag or clear a scam / ghost-posting suspicion.",
    inputs: [
      {
        name: "flag",
        label: "Suspicious?",
        type: "select",
        required: true,
        options: [
          { value: "yes", label: "Yes, suspicious" },
          { value: "no", label: "No, looks genuine" },
        ],
      },
    ],
  },
  title: {
    field: "title",
    label: "Title",
    help: "The job title shown everywhere.",
    inputs: [{ name: "title", label: "Title", type: "text", maxLength: 255, required: true }],
  },
  country: {
    field: "country",
    label: "Country",
    help: "Country of the job (ISO code). XW = remote / worldwide.",
    inputs: [{ name: "country", label: "Country code", type: "text", maxLength: 2, placeholder: "DE", mono: true, hint: "Empty = unknown." }],
  },
  city: {
    field: "city",
    label: "City",
    help: "City of the job.",
    inputs: [{ name: "city", label: "City", type: "text", maxLength: 128, hint: "Empty = unknown." }],
  },
  workplace_type: {
    field: "workplace_type",
    label: "Workplace",
    help: "On-site, hybrid or remote.",
    inputs: [
      {
        name: "workplace",
        label: "Workplace",
        type: "select",
        options: [{ value: "", label: "Unknown" }, ...opts(WORKPLACE_TYPES, (w) => WORKPLACE_LABEL[w])],
      },
    ],
  },
};

export const FIELD_OPTIONS: SelectOptionSpec[] = EDITABLE_FIELDS.map((f) => ({ value: f, label: FIELD_SPECS[f].label }));

/** Form input name for a field input. */
export function inputName(name: string): string {
  return `v_${name}`;
}
