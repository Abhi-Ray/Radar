/**
 * Final visa status (spec §13.4). "A wrong Confirmed costs me the most, so Confirmed is hard to earn."
 *
 * Decision order (first match wins):
 * 1. My own note (manual, from a recruiter): the latest note decides — yes → confirmed, no →
 *    not offered. It is the only thing that outranks an explicit "not offered" in the posting.
 * 2. The posting argues both ways (an offer AND a refusal / right-to-work requirement) →
 *    conflicting, with both sides listed.
 * 3. The posting refuses (not_offered, or a high/medium right-to-work requirement) → not offered.
 *    This overrides register matches, relocation mentions and AI; they are listed as overridden.
 * 4. The posting explicitly offers (high/medium offered signal) → confirmed (method posting).
 * 5. An official licensed-sponsor register match (UK Home Office, NL IND, DK SIRI) with
 *    match_status confirmed, method official AND the register country equal to the job country →
 *    confirmed (method official).
 * 6. Likely: sponsorship history (IE DETE, CA LMIA registers, other postings of the company), a
 *    possible register match ("Possible match — verify"), a licensed sponsor in another country,
 *    a relocation mention, or a hedged offer ("may be available") in the posting.
 * 7. AI only: an AI "offered" gives likely with LOW confidence (method ai); an AI "not offered"
 *    gives unknown with a note (method ai). AI alone NEVER yields confirmed or not offered.
 * 8. Otherwise unknown (low confidence). Application-form questions ("Will you require
 *    sponsorship?") are noted but are not company statements.
 */
import type { CompanyEvidenceRow } from '../../db/schema';
import type { VisaDecisionValue, VisaSignal } from '../contracts/jobs';
import type { Confidence, Fact, Method } from '../contracts/provenance';
import { confidenceRank, lowerConfidence, minConfidence } from '../contracts/provenance';
import { DAY_MS } from '../time';
import { isActiveEvidence, parseRegisterMatch, parseSponsorsFlag, type RegisterMatchValue } from './types';

export const VISA_DECIDE_LOGIC_VERSION = 'visa-decide@2026-09-30.1';
/** `source` of every visa_status fact written by this engine. */
export const VISA_ENGINE_SOURCE = 'visa engine';
/** A register snapshot older than this lowers the confidence of a register-based verdict. */
export const REGISTER_STALE_DAYS = 45;

/** The evidence-row fields the engine reads (full CompanyEvidenceRow rows fit). */
export type EvidenceLike = Pick<
  CompanyEvidenceRow,
  'kind' | 'valueJson' | 'evidence' | 'source' | 'method' | 'confidence' | 'matchStatus' | 'checkedAt'
>;

export interface ManualNote {
  sponsors: boolean;
  note: string;
  at: Date;
}

export interface DecideVisaInput {
  postingSignals: VisaSignal[];
  companyEvidence: EvidenceLike[];
  manualNotes: ManualNote[];
  aiSignals: VisaSignal[];
  /** Job country (ISO2). Needed for register country agreement; without it a register match is only "likely". */
  countryIso2?: string | null;
  /** Clock for checkedAt and register staleness (defaults to now). */
  now?: Date;
}

const QUOTE_MAX = 180;

function clip(s: string, max = QUOTE_MAX): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function quoted(s: VisaSignal): string {
  return `"${clip(s.quote)}"`;
}

function best<T extends { confidence: Confidence }>(list: T[]): T | null {
  let out: T | null = null;
  for (const x of list) if (!out || confidenceRank(x.confidence) < confidenceRank(out.confidence)) out = x;
  return out;
}

function bestConfidence(list: Confidence[]): Confidence {
  let out: Confidence = 'low';
  for (const c of list) if (confidenceRank(c) < confidenceRank(out)) out = c;
  return out;
}

function day(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function describeSignal(s: VisaSignal): string {
  switch (s.signal) {
    case 'offered':
      return s.confidence === 'low' ? `Posting hedges on sponsorship: ${quoted(s)}` : `Posting offers sponsorship: ${quoted(s)}`;
    case 'not_offered':
      return `Posting refuses sponsorship: ${quoted(s)}`;
    case 'relocation':
      return `Posting mentions relocation support: ${quoted(s)}`;
    case 'right_to_work_required':
      return s.confidence === 'low'
        ? `Application form asks about sponsorship (a question, not a company statement): ${quoted(s)}`
        : `Posting requires an existing right to work: ${quoted(s)}`;
  }
}

function describeRegister(v: RegisterMatchValue): string {
  const where = [v.town, v.route, v.rating].filter(Boolean).join(', ');
  return `${v.orgName}${where ? ` (${where})` : ''} on the ${v.registerName}, version ${v.registerVersion}`;
}

interface RegisterItem {
  value: RegisterMatchValue;
  row: EvidenceLike;
  sameCountry: boolean;
  stale: boolean;
}

function registerStale(version: string, now: Date): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(version);
  if (!m) return true;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return (now.getTime() - t) / DAY_MS > REGISTER_STALE_DAYS;
}

interface LikelyFactor {
  reason: string;
  confidence: Confidence;
  method: Method;
  evidence: string;
}

export function decideVisaStatus(input: DecideVisaInput): Fact<VisaDecisionValue> {
  const now = input.now ?? new Date();
  const jobCountry = input.countryIso2 ? input.countryIso2.toUpperCase() : null;

  const make = (
    status: VisaDecisionValue['status'],
    method: Method,
    confidence: Confidence,
    reasons: string[],
    evidence: string | null,
    sides?: VisaDecisionValue['sides'],
  ): Fact<VisaDecisionValue> => ({
    value: sides ? { status, reasons, sides } : { status, reasons },
    evidence,
    source: VISA_ENGINE_SOURCE,
    method,
    confidence,
    checkedAt: now,
    logicVersion: VISA_DECIDE_LOGIC_VERSION,
  });

  // ── Posting signals ──
  const posting = input.postingSignals;
  const offered = posting.filter((s) => s.signal === 'offered');
  const offeredFirm = offered.filter((s) => s.confidence !== 'low');
  const offeredHedged = offered.filter((s) => s.confidence === 'low');
  const refusals = posting.filter((s) => s.signal === 'not_offered');
  const rtwFirm = posting.filter((s) => s.signal === 'right_to_work_required' && s.confidence !== 'low');
  const formQuestions = posting.filter((s) => s.signal === 'right_to_work_required' && s.confidence === 'low');
  const relocation = posting.filter((s) => s.signal === 'relocation');
  const against = [...refusals, ...rtwFirm];

  // ── Company evidence ──
  const evidence = input.companyEvidence.filter(isActiveEvidence);
  const registers: RegisterItem[] = [];
  const manual: ManualNote[] = [...input.manualNotes];
  const history: { sponsors: boolean; note: string | null; row: EvidenceLike }[] = [];
  const aiRows: { sponsors: boolean; note: string | null; row: EvidenceLike }[] = [];
  for (const row of evidence) {
    if (row.kind === 'register_match') {
      const value = parseRegisterMatch(row.valueJson);
      if (!value) continue;
      registers.push({ value, row, sameCountry: jobCountry !== null && value.countryIso2 === jobCountry, stale: registerStale(value.registerVersion, now) });
    } else if (row.kind === 'manual_note') {
      const f = parseSponsorsFlag(row.valueJson);
      if (f) manual.push({ sponsors: f.sponsors, note: f.note ?? row.evidence ?? '', at: row.checkedAt });
    } else if (row.kind === 'posting_history') {
      const f = parseSponsorsFlag(row.valueJson);
      if (f) history.push({ ...f, row });
    } else if (row.kind === 'ai') {
      const f = parseSponsorsFlag(row.valueJson);
      if (f) aiRows.push({ ...f, row });
    }
  }

  const aiOffered = input.aiSignals.filter((s) => s.signal === 'offered');
  const aiAgainst = input.aiSignals.filter((s) => s.signal === 'not_offered' || (s.signal === 'right_to_work_required' && s.confidence !== 'low'));
  const aiSaysYes = aiOffered.length > 0 || aiRows.some((r) => r.sponsors);
  const aiSaysNo = aiAgainst.length > 0 || aiRows.some((r) => !r.sponsors);
  const aiNotes = (): string[] => {
    const out: string[] = [];
    for (const s of aiOffered) out.push(`AI read the posting as offering sponsorship (AI alone is never enough): ${quoted(s)}`);
    for (const s of aiAgainst) out.push(`AI read the posting as not offering sponsorship (not used on its own): ${quoted(s)}`);
    for (const r of aiRows) out.push(`AI company note: ${r.sponsors ? 'sponsors' : 'does not sponsor'}${r.note ? ` — ${clip(r.note)}` : ''}`);
    return out;
  };

  const confirmedRegisters = registers.filter(
    (r) => r.value.evidenceKind === 'licensed_sponsor' && r.row.matchStatus === 'confirmed' && r.row.method === 'official' && r.sameCountry,
  );

  const likelyFactors = (): LikelyFactor[] => {
    const out: LikelyFactor[] = [];
    for (const r of registers) {
      if (confirmedRegisters.includes(r)) continue;
      const v = r.value;
      let reason: string;
      let confidence: Confidence;
      if (r.row.matchStatus !== 'confirmed' || r.row.method !== 'official') {
        reason = `Possible register match — verify: ${describeRegister(v)}`;
        confidence = 'low';
      } else if (!r.sameCountry) {
        reason = `Sponsors in ${v.countryIso2}, but this job is ${jobCountry ? `in ${jobCountry}` : 'in an unknown country'}: ${describeRegister(v)}`;
        confidence = 'low';
      } else {
        reason = `Sponsorship history: ${describeRegister(v)}`;
        confidence = minConfidence(r.row.confidence, 'medium');
      }
      if (r.stale) confidence = lowerConfidence(confidence);
      out.push({ reason, confidence, method: 'official', evidence: describeRegister(v) });
    }
    for (const h of history) {
      if (!h.sponsors) continue;
      out.push({
        reason: `Another posting of this company offered sponsorship${h.note ? `: "${clip(h.note)}"` : ''}`,
        confidence: minConfidence(h.row.confidence, 'medium'),
        method: h.row.method,
        evidence: h.row.evidence ?? h.note ?? h.row.source,
      });
    }
    for (const s of relocation) {
      out.push({ reason: describeSignal(s), confidence: minConfidence(s.confidence, 'medium'), method: 'posting', evidence: s.quote });
    }
    for (const s of offeredHedged) {
      out.push({ reason: describeSignal(s), confidence: 'low', method: 'posting', evidence: s.quote });
    }
    return out;
  };

  const registerSupport = (): string[] => [
    ...confirmedRegisters.map((r) => `Official register: ${describeRegister(r.value)}`),
    ...likelyFactors().map((f) => f.reason),
  ];

  // 1. My own note.
  if (manual.length) {
    const sorted = [...manual].sort((a, b) => b.at.getTime() - a.at.getTime());
    const latest = sorted[0];
    const reasons = [
      `My note (${day(latest.at)}): the company ${latest.sponsors ? 'does' : 'does not'} sponsor${latest.note ? ` — "${clip(latest.note)}"` : ''}`,
    ];
    for (const n of sorted.slice(1)) {
      if (n.sponsors !== latest.sponsors) reasons.push(`Earlier note (${day(n.at)}) said the opposite${n.note ? `: "${clip(n.note)}"` : ''}`);
    }
    const disagreeing = latest.sponsors ? against : offeredFirm;
    for (const s of disagreeing) reasons.push(`Overrides the posting — ${describeSignal(s)}`);
    return make(latest.sponsors ? 'confirmed' : 'not_offered', 'manual', 'high', reasons, latest.note || null);
  }

  // 2. The posting argues both ways.
  if (against.length && offered.length) {
    const forSide = offered.map(describeSignal);
    const againstSide = against.map(describeSignal);
    const confidence: Confidence = offeredFirm.length && (refusals.some((s) => s.confidence !== 'low') || rtwFirm.length) ? 'medium' : 'low';
    return make(
      'conflicting',
      'posting',
      confidence,
      ['The posting says both things — judge it yourself.', ...forSide, ...againstSide, ...registerSupport(), ...aiNotes()],
      [...offered, ...against].map((s) => s.quote).join(' | '),
      { for: [...forSide, ...confirmedRegisters.map((r) => `Official register: ${describeRegister(r.value)}`)], against: againstSide },
    );
  }

  // 3. The posting refuses.
  if (against.length) {
    const top = best(refusals);
    const confidence = top ? top.confidence : lowerConfidence(bestConfidence(rtwFirm.map((s) => s.confidence)));
    const overridden = [...registerSupport(), ...(aiSaysYes ? aiNotes() : [])].map((r) => `Overridden by the posting — ${r}`);
    return make(
      'not_offered',
      'posting',
      confidence,
      [...against.map(describeSignal), ...overridden],
      against.map((s) => s.quote).join(' | '),
    );
  }

  // 4. The posting explicitly offers.
  if (offeredFirm.length) {
    const top = best(offeredFirm)!;
    return make(
      'confirmed',
      'posting',
      top.confidence,
      [...offeredFirm.map(describeSignal), ...relocation.map(describeSignal), ...registerSupport(), ...formQuestions.map(describeSignal), ...(aiSaysNo ? aiNotes() : [])],
      offeredFirm.map((s) => s.quote).join(' | '),
    );
  }

  // 5. Official licensed-sponsor register, same country.
  if (confirmedRegisters.length) {
    const ranked = [...confirmedRegisters].sort(
      (a, b) => Number(a.stale) - Number(b.stale) || confidenceRank(a.row.confidence) - confidenceRank(b.row.confidence),
    );
    const top = ranked[0];
    let confidence = minConfidence(top.row.confidence, 'high');
    const reasons = ranked.map((r) => `Official register: ${describeRegister(r.value)}`);
    if (top.stale) {
      confidence = lowerConfidence(confidence);
      reasons.push(`The register snapshot is older than ${REGISTER_STALE_DAYS} days — re-check before relying on it.`);
    }
    reasons.push(...likelyFactors().map((f) => f.reason), ...formQuestions.map(describeSignal), ...(aiSaysNo ? aiNotes() : []));
    return make('confirmed', 'official', confidence, reasons, describeRegister(top.value));
  }

  // 6. Likely.
  const factors = likelyFactors();
  if (factors.length) {
    const top = best(factors)!;
    return make(
      'likely',
      top.method,
      top.confidence,
      [...factors.map((f) => f.reason), ...formQuestions.map(describeSignal), ...aiNotes()],
      top.evidence,
    );
  }

  // 7. AI only — never confirmed, never not_offered.
  if (aiSaysYes) {
    const quotes = aiOffered.map((s) => s.quote);
    return make(
      'likely',
      'ai',
      'low',
      [...aiNotes(), 'Only the AI saw an offer — shown as Likely (low) until a rule, register or my note confirms it.', ...formQuestions.map(describeSignal)],
      quotes.length ? quotes.join(' | ') : null,
    );
  }
  if (aiSaysNo) {
    return make(
      'unknown',
      'ai',
      'low',
      [...aiNotes(), 'Only the AI saw a refusal — status stays Unknown until the posting, a register or my note says so.', ...formQuestions.map(describeSignal)],
      aiAgainst.map((s) => s.quote).join(' | ') || null,
    );
  }

  // 8. Nothing either way.
  return make(
    'unknown',
    'rule',
    'low',
    ['No sponsorship evidence in the posting, the registers or my notes.', ...formQuestions.map(describeSignal)],
    formQuestions.length ? formQuestions.map((s) => s.quote).join(' | ') : null,
  );
}
