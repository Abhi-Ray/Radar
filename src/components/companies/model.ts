/**
 * Company page logic (spec §11, §13.2, §19.4). Pure and client-safe.
 *
 * `companies.sponsor_summary_json` is written by the register matcher
 * ({status: confirmed|likely|possible|unknown, sponsorCountries, historyCountries, possibleMatches,
 * registers[], at, logicVersion}); `company_evidence.value_json` of register matches carries the
 * register name, download date (register_version) and match details; my own notes are
 * `manual_note` rows with `{field:'sponsors', sponsors, note}`. All read leniently.
 */

export type SponsorStatus = "confirmed" | "likely" | "possible" | "unknown";
/** The filter classes: confirmed evidence, possible (to verify / history), none. */
export type SponsorClass = "confirmed" | "possible" | "none";

export const SPONSOR_CLASSES: readonly SponsorClass[] = ["confirmed", "possible", "none"];

export const SPONSOR_CLASS_LABEL: Record<SponsorClass, string> = {
  confirmed: "Confirmed sponsor",
  possible: "Possible sponsor",
  none: "No sponsor evidence",
};

export interface SponsorSummaryView {
  status: SponsorStatus;
  sponsorCountries: string[];
  historyCountries: string[];
  possibleMatches: number;
  registers: Array<{ registerKey: string; countryIso2: string | null; orgName: string; matchStatus: string; matchType: string | null; registerVersion: string | null }>;
  at: string | null;
  logicVersion: string | null;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown, max = 500): string | null {
  return typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => str(x, 64)).filter((x): x is string => Boolean(x)) : [];
}

function isStatus(v: unknown): v is SponsorStatus {
  return v === "confirmed" || v === "likely" || v === "possible" || v === "unknown";
}

export function parseSponsorSummary(v: unknown): SponsorSummaryView | null {
  const o = obj(v);
  if (!o || !isStatus(o.status)) return null;
  const registers = Array.isArray(o.registers)
    ? o.registers
        .map(obj)
        .filter((r): r is Record<string, unknown> => r !== null && typeof r.registerKey === "string")
        .map((r) => ({
          registerKey: String(r.registerKey),
          countryIso2: str(r.countryIso2, 2),
          orgName: str(r.orgName) ?? "",
          matchStatus: str(r.matchStatus, 16) ?? "possible",
          matchType: str(r.matchType, 32),
          registerVersion: str(r.registerVersion, 32),
        }))
    : [];
  return {
    status: o.status,
    sponsorCountries: strList(o.sponsorCountries),
    historyCountries: strList(o.historyCountries),
    possibleMatches: typeof o.possibleMatches === "number" && o.possibleMatches >= 0 ? Math.floor(o.possibleMatches) : 0,
    registers,
    at: str(o.at, 40),
    logicVersion: str(o.logicVersion, 64),
  };
}

/** My own note on whether the company sponsors (`manual_note` · `{field:'sponsors', sponsors, note}`). */
export interface SponsorNoteView {
  sponsors: boolean;
  note: string | null;
}

export function parseSponsorNote(v: unknown): SponsorNoteView | null {
  const o = obj(v);
  if (!o) return null;
  if (o.field !== undefined && o.field !== "sponsors") return null;
  const flag = typeof o.sponsors === "boolean" ? o.sponsors : typeof o.offered === "boolean" ? o.offered : null;
  if (flag === null) return null;
  return { sponsors: flag, note: str(o.note, 2000) ?? str(o.quote, 2000) };
}

/**
 * The class used by the filter and the stamp. My own confirmed "yes, they sponsor" note counts as
 * confirmed (spec §13.2: evidence "marked as coming from me"); a "no" note wins over "possible".
 */
export function sponsorClass(summary: SponsorSummaryView | null, latestNote: SponsorNoteView | null): SponsorClass {
  if (latestNote?.sponsors === true) return "confirmed";
  if (summary?.status === "confirmed") return latestNote?.sponsors === false ? "possible" : "confirmed";
  if (latestNote?.sponsors === false) return "none";
  if (summary?.status === "likely" || summary?.status === "possible") return "possible";
  return "none";
}

export interface RegisterEvidenceView {
  registerKey: string;
  registerName: string;
  countryIso2: string | null;
  orgName: string | null;
  town: string | null;
  route: string | null;
  rating: string | null;
  /** Download date of the register file. */
  registerVersion: string | null;
  evidenceKind: "licensed_sponsor" | "sponsorship_history" | null;
  matchType: string | null;
  basis: string | null;
  matchedName: string | null;
  countryAgrees: boolean | null;
  autoStatus: string | null;
  manualStatus: string | null;
  entryCount: number | null;
}

/** "uk_home_office" → "Uk home office" (when the row does not carry the register's display name). */
export function registerKeyLabel(key: string): string {
  const words = key.replace(/[_-]+/g, " ").trim();
  return words ? words.replace(/\b([a-z]{2})\b/g, (w) => (w.length === 2 ? w.toUpperCase() : w)).replace(/^./, (c) => c.toUpperCase()) : key;
}

export function parseRegisterEvidence(v: unknown, source?: string | null): RegisterEvidenceView | null {
  const o = obj(v);
  const fromSource = typeof source === "string" && source.includes("@") ? source.split("@") : null;
  const registerKey = str(o?.registerKey, 64) ?? (fromSource ? fromSource[0] : null);
  if (!registerKey) return null;
  const kind = o?.evidenceKind;
  return {
    registerKey,
    registerName: str(o?.registerName, 200) ?? registerKeyLabel(registerKey),
    countryIso2: str(o?.countryIso2, 2),
    orgName: str(o?.orgName),
    town: str(o?.town, 128),
    route: str(o?.route, 191),
    rating: str(o?.rating, 64),
    registerVersion: str(o?.registerVersion, 32) ?? (fromSource ? (fromSource[1] ?? null) : null),
    evidenceKind: kind === "licensed_sponsor" || kind === "sponsorship_history" ? kind : null,
    matchType: str(o?.matchType, 32),
    basis: str(o?.basis, 32),
    matchedName: str(o?.matchedName),
    countryAgrees: typeof o?.countryAgrees === "boolean" ? o.countryAgrees : null,
    autoStatus: str(o?.autoStatus, 16),
    manualStatus: str(o?.manualStatus, 16),
    entryCount: typeof o?.entryCount === "number" ? o.entryCount : null,
  };
}

export const BASIS_LABEL: Record<string, string> = {
  exact: "Exact name",
  spacing: "Same name, different spacing",
  brand: "Brand + country qualifier",
  legal_name: "Legal-entity name",
  fuzzy: "Similar name (fuzzy)",
};

/** The agency flag note (`manual_note` · `{field:'is_agency', isAgency}`) written by company/manual. */
export function parseAgencyNote(v: unknown): boolean | null {
  const o = obj(v);
  if (!o || o.field !== "is_agency" || typeof o.isAgency !== "boolean") return null;
  return o.isAgency;
}

export const COMPANY_TYPE_LABEL: Record<string, string> = {
  startup: "Startup",
  scaleup: "Scale-up",
  midsize: "Mid-size",
  mnc: "Multinational",
  agency: "Agency",
  unknown: "Unknown type",
};

export const ALIAS_KIND_LABEL: Record<string, string> = {
  name: "Name",
  brand: "Brand",
  legal: "Legal name",
  ats_slug: "ATS slug",
  other: "Other",
};

/** Size bands in display order (free-form in the DB; unknown bands sort after these). */
export const SIZE_BANDS = ["1-50", "51-250", "251-1000", "1000+"] as const;

export function sizeBandOrder(band: string): number {
  const i = (SIZE_BANDS as readonly string[]).indexOf(band);
  return i === -1 ? SIZE_BANDS.length : i;
}
