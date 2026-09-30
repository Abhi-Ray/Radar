/**
 * Fit Score 0–100 (spec §16): explainable, deterministic, versioned.
 *
 * Each component gives a raw value 0..1 with a confidence and a plain reason. Its contribution is
 *
 *     contribution = share × raw × CONFIDENCE_MULTIPLIER[confidence] × 100
 *
 * where `share` = weight / sum(weights) (the weights are relative; defaults sum to 100). Low
 * confidence therefore LOWERS the score instead of counting as neutral. The score is the rounded
 * sum of the contributions, clamped to 0..100. Same input + weights + profile → same score.
 *
 * Components:
 * - role: my target lists (primary > secondary > fallback; earlier entries in a list rank
 *   higher, so cloud security / DevSecOps come first).
 * - experience: the posting's minimum years against my bands (core 2–4 best, show 1–5 OK,
 *   outside → 0).
 * - visa: by status only (confirmed > likely > unknown > conflicting > not offered) and its
 *   confidence. No visa is needed when the job is in my passport country or is remote and open to
 *   where I live. The "Am I eligible?" result scales it (a route I can't meet makes the offer
 *   worth little).
 * - salary: annual EUR against my floor and expected salary. A stated salary counts fully, an
 *   estimate counts half.
 * - remote: only counts when I can really take it remotely (class worldwide).
 * - language: English OK > unclear > local language required.
 * - freshness: age since posted (or first seen), with liveness: a dead link scores 0, ghost
 *   risk halves it, a redirected / unchecked link lowers it.
 * - skills: overlap of the posting's skills with mine (saturates at SKILLS_FOR_FULL_SCORE).
 * - company: type (agencies lower, types I excluded score 0) and sponsor history.
 */
import type { ExperienceBand, ScoreComponent, ScoreResult, ScoringInput, VisaStatus } from '../contracts/jobs';
import type { Confidence } from '../contracts/provenance';
import { minConfidence } from '../contracts/provenance';
import { REMOTE_COUNTRY, SCORE_COMPONENT_KEYS, type Profile, type ScoreComponentKey, type ScoreWeights } from '../contracts/settings';
import { DAY_MS } from '../time';

export const SCORE_VERSION = 'score@2026-09-30.1';

/** Confidence → share of the raw value that counts (spec §16: low confidence lowers the score). */
export const CONFIDENCE_MULTIPLIER: Readonly<Record<Confidence, number>> = { high: 1, medium: 0.7, low: 0.4 };

/** An estimated salary counts this much of a stated one. */
export const ESTIMATED_SALARY_FACTOR = 0.5;

/** Matching this many of my skills gives the full skills value. */
export const SKILLS_FOR_FULL_SCORE = 5;

export const COMPONENT_LABELS: Readonly<Record<ScoreComponentKey, string>> = {
  role: 'Role match',
  experience: 'Experience match',
  visa: 'Visa signal',
  salary: 'Salary vs. floor',
  remote: 'Remote eligibility',
  language: 'Language',
  freshness: 'Freshness and liveness',
  skills: 'Skills overlap',
  company: 'Company signals',
};

interface Part {
  raw: number;
  confidence: Confidence;
  reason: string;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

function fmtEur(n: number): string {
  if (Math.abs(n) < 1000) return `€${Math.round(n)}`;
  const k = Math.round(n / 100) / 10;
  return `€${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

// ── Role ────────────────────────────────────────────────────────────────────────────────────

const LIST_BASE = { primary: 1, secondary: 0.7, fallback: 0.4 } as const;
const LIST_STEP = 0.025;
const LIST_FLOOR = { primary: 0.9, secondary: 0.6, fallback: 0.3 } as const;
/** When the role key is not in my lists (but the title mapper put it in a family). */
const FAMILY_ONLY = { primary: 0.9, secondary: 0.6, fallback: 0.3, other: 0 } as const;

function scoreRole(input: ScoringInput, profile: Profile): Part {
  const { roleKey, roleFamily, confidence } = input.role;
  if (roleKey) {
    for (const list of ['primary', 'secondary', 'fallback'] as const) {
      const i = profile.targetRoles[list].indexOf(roleKey);
      if (i === -1) continue;
      const raw = Math.max(LIST_FLOOR[list], LIST_BASE[list] - i * LIST_STEP);
      return { raw, confidence, reason: `${roleKey} is #${i + 1} in my ${list} roles` };
    }
  }
  const raw = FAMILY_ONLY[roleFamily];
  if (raw === 0) {
    return { raw: 0, confidence, reason: roleKey ? `${roleKey} is not one of my target roles` : 'The title is not one of my target roles' };
  }
  return { raw, confidence, reason: `${roleKey ?? 'The role'} is in the ${roleFamily} family, but not in my lists` };
}

// ── Experience ──────────────────────────────────────────────────────────────────────────────

const BAND_RAW: Record<ExperienceBand, number> = { core: 1, show: 0.6, hide: 0, unknown: 0.5 };

/** The posting's minimum years → my band (same rule as the list filter). */
export function experienceBandFor(minYears: number, profile: Profile): ExperienceBand {
  const b = profile.experienceBand;
  if (minYears < b.hideBelow || minYears >= b.hideAbove) return 'hide';
  if (minYears >= b.core[0] && minYears <= b.core[1]) return 'core';
  if (minYears >= b.show[0] && minYears <= b.show[1]) return 'show';
  return 'hide';
}

function scoreExperience(input: ScoringInput, profile: Profile): Part {
  const e = input.experience;
  if (!e) return { raw: BAND_RAW.unknown, confidence: 'low', reason: 'The posting does not state the years of experience' };
  const { minYears, maxYears, securityStrict } = e.value;
  const range = minYears !== null ? (maxYears !== null && maxYears > minYears ? `${minYears}–${maxYears}` : `${minYears}+`) : null;
  const band = minYears !== null ? experienceBandFor(minYears, profile) : e.value.band;
  let raw = BAND_RAW[band];
  let reason: string;
  const b = profile.experienceBand;
  switch (band) {
    case 'core':
      reason = `Asks ${range} years: inside my core band (${b.core[0]}–${b.core[1]})`;
      break;
    case 'show':
      reason = range ? `Asks ${range} years: outside my core band (${b.core[0]}–${b.core[1]}) but within ${b.show[0]}–${b.show[1]}` : 'Experience is in my acceptable band';
      break;
    case 'hide':
      reason = range ? `Asks ${range} years: outside what I target (${b.show[0]}–${b.show[1]})` : 'Experience is outside what I target';
      break;
    default:
      reason = 'The years of experience are unclear';
  }
  if (securityStrict && minYears !== null && minYears > profile.yearsTotal && raw > 0.3) {
    raw = 0.3;
    reason += `; a strict security requirement above my ${profile.yearsTotal} years`;
  }
  return { raw, confidence: band === 'unknown' ? 'low' : e.confidence, reason };
}

// ── Visa ────────────────────────────────────────────────────────────────────────────────────

export const VISA_STATUS_RAW: Readonly<Record<VisaStatus, number>> = {
  confirmed: 1,
  likely: 0.75,
  unknown: 0.35,
  conflicting: 0.3,
  not_offered: 0,
};

const VISA_LABEL: Record<VisaStatus, string> = {
  confirmed: 'Sponsorship confirmed',
  likely: 'Sponsorship likely',
  unknown: 'Sponsorship unknown',
  conflicting: 'Sponsorship evidence conflicts',
  not_offered: 'Sponsorship not offered',
};

const ELIGIBILITY_FACTOR = { meets: 1, borderline: 0.8, cant_tell: 1, doesnt_meet: 0.25 } as const;

function scoreVisa(input: ScoringInput, profile: Profile): Part {
  const country = input.countryIso2 && input.countryIso2 !== REMOTE_COUNTRY ? input.countryIso2 : null;
  if (country && country === profile.passport) {
    return { raw: 1, confidence: 'high', reason: `No visa needed: the job is in ${country}, my passport country` };
  }
  const remote = input.remote;
  if (remote && remote.value.class === 'worldwide' && remote.confidence !== 'low') {
    return { raw: 1, confidence: remote.confidence, reason: 'No visa needed: remote and open to where I live' };
  }
  const status: VisaStatus = input.visa?.status ?? 'unknown';
  const confidence: Confidence = input.visa?.confidence ?? 'low';
  let raw = VISA_STATUS_RAW[status];
  let reason = VISA_LABEL[status];
  if (!input.visa) reason += ' (no visa decision yet)';
  const el = input.eligibility;
  if (el && raw > 0 && el !== 'cant_tell' && el !== 'meets') {
    raw *= ELIGIBILITY_FACTOR[el];
    reason += el === 'doesnt_meet' ? "; but I don't meet the visa route criteria" : '; my eligibility for the route is borderline';
  } else if (el === 'meets' && raw > 0) {
    reason += '; I meet the visa route criteria';
  }
  return { raw, confidence, reason };
}

// ── Salary ──────────────────────────────────────────────────────────────────────────────────

/** Raw value of a stated annual EUR range vs. my floor and expected salary. */
export function salaryRaw(low: number, high: number, floor: number, expected: number): number {
  const mid = (low + high) / 2;
  if (high < floor) return 0;
  if (mid < floor) return 0.3; // the range reaches my floor only at the top
  if (expected <= floor) return 1;
  if (mid >= expected) return 1;
  return 0.5 + (0.5 * (mid - floor)) / (expected - floor);
}

function scoreSalary(input: ScoringInput, profile: Profile): Part {
  const s = input.salary;
  const floor = profile.salaryFloorEur;
  const expected = Math.max(profile.expectedSalaryEur, floor);
  if (!s || (s.value.annualEurMin === null && s.value.annualEurMax === null)) {
    return { raw: 0.25, confidence: 'low', reason: 'No salary in the posting' };
  }
  const low = s.value.annualEurMin ?? s.value.annualEurMax!;
  const high = Math.max(s.value.annualEurMax ?? low, low);
  const estimated = s.value.kind === 'estimated';
  let raw = salaryRaw(low, high, floor, expected);
  const range = high > low ? `${fmtEur(low)}–${fmtEur(high)}` : fmtEur(low);
  let reason = `${estimated ? 'Estimated' : 'Stated'} ${range}/yr vs. my floor ${fmtEur(floor)} and target ${fmtEur(expected)}`;
  if (s.value.grossNet === 'net') reason += ' (net; the gross is higher)';
  if (estimated) {
    raw *= ESTIMATED_SALARY_FACTOR;
    reason += '; an estimate counts half';
  }
  return { raw, confidence: estimated ? minConfidence(s.confidence, 'low') : s.confidence, reason };
}

// ── Remote ──────────────────────────────────────────────────────────────────────────────────

const REMOTE_REASON = {
  worldwide: 'Remote and open to where I live',
  region_limited: "Remote only from regions that don't include where I live: doesn't count",
  timezone_limited: "Remote only within working hours I can't meet",
  unclear: "Remote scope unclear: doesn't count",
  not_remote: 'Not remote',
} as const;

function scoreRemote(input: ScoringInput): Part {
  const r = input.remote;
  if (!r) {
    return { raw: 0, confidence: 'low', reason: input.workplaceType === 'remote' ? "Remote scope unknown: doesn't count" : 'Not remote' };
  }
  const raw = r.value.class === 'worldwide' ? 1 : 0;
  return { raw, confidence: r.confidence, reason: REMOTE_REASON[r.value.class] };
}

// ── Language ────────────────────────────────────────────────────────────────────────────────

function scoreLanguage(input: ScoringInput): Part {
  const l = input.language;
  if (!l) return { raw: 0.5, confidence: 'low', reason: 'Language requirement not checked' };
  const langs = l.value.languages.length ? ` (${l.value.languages.join(', ')})` : '';
  switch (l.value.requirement) {
    case 'english_ok':
      return { raw: 1, confidence: l.confidence, reason: 'English is enough' };
    case 'local_required':
      return { raw: 0, confidence: l.confidence, reason: `A local language is required${langs}` };
    default:
      return { raw: 0.5, confidence: l.confidence, reason: `Language requirement unclear${langs}` };
  }
}

// ── Freshness and liveness ──────────────────────────────────────────────────────────────────

/** (age in days, value) points; linear in between, flat after the last. */
const FRESHNESS_CURVE: readonly [number, number][] = [
  [0, 1],
  [3, 1],
  [7, 0.9],
  [14, 0.75],
  [30, 0.5],
  [60, 0.2],
  [90, 0.1],
];

export function freshnessRaw(ageDays: number): number {
  const a = Math.max(0, ageDays);
  for (let i = 1; i < FRESHNESS_CURVE.length; i++) {
    const [x1, y1] = FRESHNESS_CURVE[i];
    if (a <= x1) {
      const [x0, y0] = FRESHNESS_CURVE[i - 1];
      return y0 + ((y1 - y0) * (a - x0)) / (x1 - x0);
    }
  }
  return FRESHNESS_CURVE[FRESHNESS_CURVE.length - 1][1];
}

/** A live check older than this lowers the freshness value. */
export const LIVENESS_STALE_DAYS = 7;

function scoreFreshness(input: ScoringInput): Part {
  if (input.linkStatus === 'dead') return { raw: 0, confidence: 'high', reason: 'The apply link is dead' };
  const from = input.postedAt ?? input.firstSeenAt;
  const ageDays = (input.now.getTime() - from.getTime()) / DAY_MS;
  let raw = freshnessRaw(ageDays);
  const days = Math.max(0, Math.floor(ageDays));
  const parts = [`${input.postedAt ? 'Posted' : 'First seen'} ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`}`];
  if (input.ghostRisk) {
    raw *= 0.5;
    parts.push('ghost-job risk (reposted or open for long)');
  }
  if (input.linkStatus === 'redirected') {
    raw *= 0.8;
    parts.push('the apply link redirects');
  }
  const liveAge = input.lastConfirmedLiveAt ? (input.now.getTime() - input.lastConfirmedLiveAt.getTime()) / DAY_MS : null;
  if (liveAge === null || liveAge > LIVENESS_STALE_DAYS) {
    raw *= 0.9;
    parts.push(liveAge === null ? 'never confirmed live' : `last confirmed live ${Math.floor(liveAge)} days ago`);
  }
  // Without a posting date the age is a lower bound → less certain.
  return { raw, confidence: input.postedAt ? 'high' : 'medium', reason: parts.join('; ') };
}

// ── Skills ──────────────────────────────────────────────────────────────────────────────────

const skillKey = (s: string) => s.toLowerCase().replace(/[\s._/-]+/g, '');

function scoreSkills(input: ScoringInput, profile: Profile): Part {
  const mine = new Map(profile.skills.map((s) => [skillKey(s), s] as const));
  const matched: string[] = [];
  const seen = new Set<string>();
  for (const s of input.skills) {
    const k = skillKey(s);
    const name = mine.get(k);
    if (name && !seen.has(k)) {
      seen.add(k);
      matched.push(name);
    }
  }
  if (!matched.length) {
    return { raw: 0, confidence: input.skills.length ? 'high' : 'low', reason: input.skills.length ? 'None of my skills are mentioned' : 'No skills found in the posting' };
  }
  return {
    raw: Math.min(1, matched.length / SKILLS_FOR_FULL_SCORE),
    confidence: 'high',
    reason: `${matched.length} of my skills: ${matched.join(', ')}`,
  };
}

// ── Company ─────────────────────────────────────────────────────────────────────────────────

const COMPANY_TYPE_RAW: Record<string, number> = { mnc: 0.8, scaleup: 0.8, midsize: 0.7, startup: 0.6, unknown: 0.5, agency: 0.3 };
const SPONSOR_HISTORY_BONUS = 0.3;

function scoreCompany(input: ScoringInput, profile: Profile): Part {
  const { isAgency, type, sponsorHistory } = input.company;
  const effectiveType = isAgency ? 'agency' : type in COMPANY_TYPE_RAW ? type : 'unknown';
  if (!(profile.companyTypes as readonly string[]).includes(effectiveType)) {
    return { raw: 0, confidence: 'high', reason: `Company type ${effectiveType} is excluded in my settings` };
  }
  let raw = COMPANY_TYPE_RAW[effectiveType];
  const parts = [isAgency ? 'Recruiting agency' : effectiveType === 'unknown' ? 'Company type unknown' : `Company type: ${effectiveType}`];
  if (sponsorHistory) {
    raw = Math.min(1, raw + SPONSOR_HISTORY_BONUS);
    parts.push('has sponsored visas before');
  }
  const confidence: Confidence = sponsorHistory || isAgency ? 'high' : effectiveType === 'unknown' ? 'low' : 'medium';
  return { raw, confidence, reason: parts.join('; ') };
}

// ── Total ───────────────────────────────────────────────────────────────────────────────────

const SCORERS: Record<ScoreComponentKey, (input: ScoringInput, profile: Profile) => Part> = {
  role: scoreRole,
  experience: scoreExperience,
  visa: scoreVisa,
  salary: scoreSalary,
  remote: (i) => scoreRemote(i),
  language: (i) => scoreLanguage(i),
  freshness: (i) => scoreFreshness(i),
  skills: scoreSkills,
  company: scoreCompany,
};

/**
 * Score one job. `weight` in each component is its share of 100 (weights / sum × 100), so
 * `contribution` ≤ `weight` and the contributions add up to the score (before rounding).
 */
export function scoreJob(input: ScoringInput, weights: ScoreWeights, profile: Profile): ScoreResult {
  const total = SCORE_COMPONENT_KEYS.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0);
  const components: ScoreComponent[] = [];
  let sum = 0;
  for (const key of SCORE_COMPONENT_KEYS) {
    const part = SCORERS[key](input, profile);
    const raw = clamp01(part.raw);
    const share = total > 0 ? Math.max(0, weights[key] ?? 0) / total : 0;
    const contribution = share * raw * CONFIDENCE_MULTIPLIER[part.confidence] * 100;
    sum += contribution;
    components.push({
      key,
      label: COMPONENT_LABELS[key],
      raw: round2(raw),
      weight: round2(share * 100),
      contribution: round2(contribution),
      confidence: part.confidence,
      reason: part.confidence === 'high' ? part.reason : `${part.reason} (${part.confidence} confidence, counts ${pct(CONFIDENCE_MULTIPLIER[part.confidence])})`,
    });
  }
  const score = Math.max(0, Math.min(100, Math.round(sum + 1e-9)));
  return { score, version: SCORE_VERSION, components };
}
