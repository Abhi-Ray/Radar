/**
 * Display helpers for /companies (pure, client-safe): stamp wording per sponsor class, the match
 * status of a register receipt, size labels and the one-line register summary on list cards.
 */
import type { Tone } from "@/components/ui/status";
import { COMPANY_TYPE_LABEL, registerKeyLabel, type SponsorClass, type SponsorSummaryView } from "./model";

export const SPONSOR_CLASS_META: Record<SponsorClass, { stamp: string; tone: Tone; blurb: string }> = {
  confirmed: {
    stamp: "Sponsor",
    tone: "radar",
    blurb: "On an official sponsor register, or you recorded that they sponsor.",
  },
  possible: {
    stamp: "Possible",
    tone: "cobalt",
    blurb: "A register name that still needs checking, sponsorship history, or conflicting evidence.",
  },
  none: {
    stamp: "No evidence",
    tone: "concrete",
    blurb: "Nothing found either way. Not the same as “does not sponsor”.",
  },
};

export const MATCH_STATUS_META: Record<string, { label: string; tone: Tone; blurb: string }> = {
  confirmed: { label: "Confirmed match", tone: "radar", blurb: "The register entry is this company." },
  possible: { label: "Possible match", tone: "acid", blurb: "The name fits but it is not proven to be this company. Check the town and legal name." },
  rejected: { label: "Rejected match", tone: "stamp", blurb: "Checked and not this company; kept for the record." },
};

export function matchStatusMeta(status: string): { label: string; tone: Tone; blurb: string } {
  return MATCH_STATUS_META[status] ?? { label: status || "Unknown", tone: "concrete", blurb: "" };
}

/** "51-250" → "51–250 people"; "1000+" → "1000+ people". Free-form bands pass through. */
export function sizeLabel(band: string | null): string | null {
  if (!band) return null;
  const b = band.trim();
  if (!b) return null;
  return /^\d[\d\s,.]*(-\s*\d[\d\s,.]*|\+)$/.test(b) ? `${b.replace(/\s*-\s*/, "–")} people` : b;
}

export function companyTypeLabel(type: string): string {
  return COMPANY_TYPE_LABEL[type] ?? type;
}

/**
 * One line for a list card: which registers list it and the newest download date, e.g.
 * "UK home office · GB · 2026-09-01" or "2 registers · newest 2026-09-01".
 */
export function registerSummaryLine(summary: SponsorSummaryView | null): string | null {
  if (!summary || !summary.registers.length) return null;
  const versions = summary.registers.map((r) => r.registerVersion).filter((v): v is string => Boolean(v));
  const newest = versions.length ? [...versions].sort().at(-1) : null;
  const keys = [...new Set(summary.registers.map((r) => r.registerKey))];
  if (keys.length === 1) {
    const r = summary.registers[0];
    return [registerKeyLabel(r.registerKey), r.countryIso2, newest].filter(Boolean).join(" · ");
  }
  return [`${keys.length} registers`, newest ? `newest ${newest}` : null].filter(Boolean).join(" · ");
}
