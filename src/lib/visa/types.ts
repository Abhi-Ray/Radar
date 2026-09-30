/**
 * Shapes of `company_evidence.value_json` written and read by the visa engine. The DB column is
 * free JSON, so every reader goes through the lenient parsers below (unknown shapes → null).
 */
import type { CompanyEvidenceRow } from '../../db/schema';

/**
 * - `licensed_sponsor`: the register lists employers licensed/recognised to sponsor work visas
 *   (UK Home Office, NL IND, DK SIRI). A strong, same-country match is "confirmed" evidence.
 * - `sponsorship_history`: the register lists employers that obtained permits in the past
 *   (Ireland DETE, Canada LMIA). It proves history, not a current offer → "likely" at most.
 */
export type RegisterEvidenceKind = 'licensed_sponsor' | 'sponsorship_history';

/** value_json of a `register_match` evidence row. */
export interface RegisterMatchValue {
  registerKey: string;
  registerName: string;
  countryIso2: string;
  orgName: string;
  town: string | null;
  route: string | null;
  rating: string | null;
  registerVersion: string;
  evidenceKind: RegisterEvidenceKind;
  /** exact | similar | parent — how the company name met the register name. */
  matchType: 'exact' | 'similar' | 'parent';
  /** Name similarity 0..1 (1 for exact). */
  similarity: number;
}

/** value_json of a `manual_note` evidence row (what a recruiter told me). */
export interface ManualNoteValue {
  sponsors: boolean;
  note?: string;
}

/** value_json of a `posting_history` evidence row (another posting of this company said so). */
export interface PostingHistoryValue {
  sponsors: boolean;
  jobId?: number;
  quote?: string;
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

export function parseRegisterMatch(v: unknown): RegisterMatchValue | null {
  const o = obj(v);
  if (!o) return null;
  const registerKey = str(o.registerKey);
  const countryIso2 = str(o.countryIso2)?.toUpperCase() ?? null;
  const orgName = str(o.orgName);
  if (!registerKey || !countryIso2 || !orgName) return null;
  const kind = o.evidenceKind === 'licensed_sponsor' ? 'licensed_sponsor' : 'sponsorship_history';
  const matchType = o.matchType === 'exact' || o.matchType === 'parent' ? o.matchType : 'similar';
  const similarity = typeof o.similarity === 'number' && Number.isFinite(o.similarity) ? Math.max(0, Math.min(1, o.similarity)) : 0;
  return {
    registerKey,
    registerName: str(o.registerName) ?? registerKey,
    countryIso2,
    orgName,
    town: str(o.town),
    route: str(o.route),
    rating: str(o.rating),
    registerVersion: str(o.registerVersion) ?? 'unknown',
    evidenceKind: kind,
    matchType,
    similarity,
  };
}

/** `sponsors` from a manual note / posting history / AI evidence row (null when absent). */
export function parseSponsorsFlag(v: unknown): { sponsors: boolean; note: string | null } | null {
  const o = obj(v);
  if (!o) return null;
  const flag = typeof o.sponsors === 'boolean' ? o.sponsors : typeof o.offered === 'boolean' ? o.offered : null;
  if (flag === null) return null;
  return { sponsors: flag, note: str(o.note) ?? str(o.quote) };
}

export function isActiveEvidence(row: Pick<CompanyEvidenceRow, 'matchStatus'>): boolean {
  return row.matchStatus !== 'rejected';
}
