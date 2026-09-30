/**
 * "Am I eligible?" (spec §13.5): my profile (passport, degree, years, salary expectations) against
 * the country's current visa rule → Meets · Borderline · Doesn't meet · Can't tell, with a reason
 * such as "Job salary €48k vs. threshold €45k (rule verified 2026-10-05): meets, thin margin".
 *
 * Salary check (annual gross EUR):
 * - The LOW end of the posted range is compared (conservative); a range straddling the threshold is
 *   borderline. A net salary only proves "meets" (gross is higher), never "doesn't meet".
 * - Borderline when: margin under 10%, the salary is an estimate, or the rule is stale (never
 *   verified / verified over 90 days ago). A stale rule keeps "doesn't meet" only when the salary is
 *   more than 10% under the threshold.
 * - Thresholds in local currency (salary_threshold_local + currency) are compared when the job
 *   salary is in the same currency and carries its FX rate.
 *
 * Degree / experience: read from the rule's structured keys in other_rules_json —
 *   { minDegreeLevel: 'none'|'bachelor'|'master'|'phd', minYearsExperience: number,
 *     yearsInsteadOfDegree: number }  (years of experience that substitute for the degree)
 * When only free text (degree_rule / experience_rule) exists, obvious wording is read
 * conservatively: a text-only mismatch gives "borderline — check", never "doesn't meet".
 */
import type { VisaRouteRow, VisaRuleVersionRow } from '../../db/schema';
import type { EligibilityResult, EligibilityValue, SalaryValue } from '../contracts/jobs';
import type { Confidence, Fact } from '../contracts/provenance';
import type { Profile } from '../contracts/settings';
import { utcDay } from '../time';
import { describeRule, ruleFreshness } from './rules';

export const ELIGIBILITY_LOGIC_VERSION = 'eligibility@2026-09-30.1';
export const ELIGIBILITY_SOURCE = 'eligibility check';
/** A margin below this (in %) is "thin" → borderline. */
export const THIN_MARGIN_PCT = 10;

type DegreeLevel = Profile['degreeLevel'];
const DEGREE_RANK: Record<DegreeLevel, number> = { none: 0, bachelor: 1, master: 2, phd: 3 };
const DEGREE_LABEL: Record<DegreeLevel, string> = { none: 'no degree', bachelor: "bachelor's degree", master: "master's degree", phd: 'PhD' };

export interface EligibilityInput {
  salary: SalaryValue | null;
  rule: VisaRuleVersionRow | null;
  profile: Profile;
  now: Date;
  /** Route of the rule (for the "DE eu_blue_card v2" label). Optional, additive. */
  route?: Pick<VisaRouteRow, 'countryIso2' | 'code' | 'name'> | null;
}

/** "€48k", "€48.3k", "€950". */
export function formatEur(n: number): string {
  if (Math.abs(n) < 1000) return `€${Math.round(n)}`;
  const k = Math.round(n / 100) / 10;
  return `€${Number.isInteger(k) ? k.toFixed(0) : k.toFixed(1)}k`;
}

interface StructuredRule {
  minDegreeLevel: DegreeLevel | null;
  minYearsExperience: number | null;
  yearsInsteadOfDegree: number | null;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
}

export function readStructuredRule(otherRulesJson: unknown): StructuredRule {
  const o = otherRulesJson !== null && typeof otherRulesJson === 'object' && !Array.isArray(otherRulesJson) ? (otherRulesJson as Record<string, unknown>) : {};
  const lvl = typeof o.minDegreeLevel === 'string' && o.minDegreeLevel in DEGREE_RANK ? (o.minDegreeLevel as DegreeLevel) : null;
  return { minDegreeLevel: lvl, minYearsExperience: num(o.minYearsExperience), yearsInsteadOfDegree: num(o.yearsInsteadOfDegree) };
}

/** Degree level mentioned in free rule text (conservative; null when unclear). */
export function degreeLevelFromText(text: string | null): DegreeLevel | null {
  if (!text) return null;
  const t = text.toLowerCase();
  if (/\b(?:phd|ph\.d|doctorate|doktor)/.test(t)) return 'phd';
  if (/\b(?:master|msc|m\.sc|postgraduate)/.test(t)) return 'master';
  if (/\b(?:bachelor|degree|university|universit|hochschul|diploma|diplom|tertiary|graduate)/.test(t)) return 'bachelor';
  return null;
}

/** Minimum years from free text like "3 years of experience" (null when unclear). */
export function yearsFromText(text: string | null): number | null {
  if (!text) return null;
  const m = /(\d{1,2})\s*\+?\s*(?:years?|yrs?|jahre|ans|jaar|anos|años|anni)/i.exec(text);
  return m ? Number(m[1]) : null;
}

type CheckOutcome = { result: EligibilityResult; note: string; definite: boolean };

function checkDegree(rule: VisaRuleVersionRow, profile: Profile): CheckOutcome | null {
  const s = readStructuredRule(rule.otherRulesJson);
  const fromText = s.minDegreeLevel === null ? degreeLevelFromText(rule.degreeRule) : null;
  const required = s.minDegreeLevel ?? fromText;
  if (required === null) return null;
  const mine = profile.degreeLevel;
  if (DEGREE_RANK[mine] >= DEGREE_RANK[required]) {
    return { result: 'meets', note: `${DEGREE_LABEL[mine]} meets the ${DEGREE_LABEL[required]} requirement`, definite: s.minDegreeLevel !== null };
  }
  if (s.yearsInsteadOfDegree !== null && profile.yearsTotal >= s.yearsInsteadOfDegree) {
    return { result: 'meets', note: `${profile.yearsTotal} years of experience substitute for the ${DEGREE_LABEL[required]}`, definite: true };
  }
  if (s.minDegreeLevel !== null) {
    return { result: 'doesnt_meet', note: `needs a ${DEGREE_LABEL[required]} (I have: ${DEGREE_LABEL[mine]})`, definite: true };
  }
  return { result: 'borderline', note: `rule text mentions a ${DEGREE_LABEL[required]} — check: "${rule.degreeRule}"`, definite: false };
}

function checkExperience(rule: VisaRuleVersionRow, profile: Profile): CheckOutcome | null {
  const s = readStructuredRule(rule.otherRulesJson);
  const fromText = s.minYearsExperience === null ? yearsFromText(rule.experienceRule) : null;
  const required = s.minYearsExperience ?? fromText;
  if (required === null) return null;
  if (profile.yearsTotal >= required) {
    return { result: 'meets', note: `${profile.yearsTotal} years of experience vs. ${required} required`, definite: s.minYearsExperience !== null };
  }
  if (s.minYearsExperience !== null) {
    return { result: 'doesnt_meet', note: `needs ${required} years of experience (I have ${profile.yearsTotal})`, definite: true };
  }
  return { result: 'borderline', note: `rule text asks for ${required} years (I have ${profile.yearsTotal}) — check: "${rule.experienceRule}"`, definite: false };
}

interface SalaryOutcome {
  result: EligibilityResult;
  marginPct: number | null;
  text: string;
  thin: boolean;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function thresholdEur(rule: VisaRuleVersionRow, salary: SalaryValue | null): { eur: number; note: string | null } | null {
  if (rule.salaryThresholdEur !== null && rule.salaryThresholdEur > 0) return { eur: rule.salaryThresholdEur, note: null };
  if (rule.salaryThresholdLocal && rule.currency && salary && salary.currency.toUpperCase() === rule.currency.toUpperCase() && salary.fxRate) {
    return { eur: rule.salaryThresholdLocal / salary.fxRate, note: `${rule.currency} ${rule.salaryThresholdLocal.toLocaleString('en-GB')} at the job's FX rate` };
  }
  return null;
}

function checkSalary(rule: VisaRuleVersionRow, salary: SalaryValue | null, ruleNote: string, stale: boolean): SalaryOutcome | null {
  const hasThreshold = (rule.salaryThresholdEur ?? 0) > 0 || (rule.salaryThresholdLocal ?? 0) > 0;
  if (!hasThreshold) return null;
  const threshold = thresholdEur(rule, salary);
  if (!salary || (salary.annualEurMin === null && salary.annualEurMax === null)) {
    const t = threshold ? formatEur(threshold.eur) : `${rule.currency ?? ''} ${rule.salaryThresholdLocal ?? ''}`.trim();
    return { result: 'cant_tell', marginPct: null, thin: false, text: `No salary in the posting vs. threshold ${t} (${ruleNote}): can't tell` };
  }
  if (!threshold) {
    return {
      result: 'cant_tell',
      marginPct: null,
      thin: false,
      text: `Threshold is ${rule.currency} ${rule.salaryThresholdLocal} and the job salary is in ${salary.currency} (${ruleNote}): can't tell`,
    };
  }
  const low = salary.annualEurMin ?? salary.annualEurMax!;
  const high = salary.annualEurMax ?? low;
  const t = threshold.eur;
  const rawMargin = ((low - t) / t) * 100;
  const margin = round1(rawMargin);
  const estimated = salary.kind === 'estimated';
  const net = salary.grossNet === 'net';
  const range = high > low ? `${formatEur(low)}–${formatEur(high)}` : formatEur(low);
  const lead = `${estimated ? 'Estimated salary' : net ? 'Job salary (net)' : 'Job salary'} ${range} vs. threshold ${formatEur(t)}${threshold.note ? ` (${threshold.note})` : ''} (${ruleNote})`;

  let result: EligibilityResult;
  let tail: string;
  let thin = false;
  if (low >= t) {
    thin = rawMargin < THIN_MARGIN_PCT;
    if (estimated) {
      result = 'borderline';
      tail = 'meets on an estimate — the real salary is unknown';
    } else if (stale) {
      result = 'borderline';
      tail = thin ? 'meets, thin margin, but the rule is stale' : 'meets, but the rule is stale';
    } else if (thin) {
      result = 'borderline';
      tail = 'meets, thin margin';
    } else {
      result = 'meets';
      tail = 'meets';
    }
  } else if (high >= t) {
    result = 'borderline';
    tail = 'the range straddles the threshold';
    thin = true;
  } else if (net) {
    result = 'borderline';
    tail = 'net salary below the threshold — the gross is higher, check it';
  } else if (estimated) {
    result = 'borderline';
    tail = 'below on an estimate — the real salary is unknown';
  } else if (stale && rawMargin >= -THIN_MARGIN_PCT) {
    result = 'borderline';
    tail = 'slightly below, and the rule is stale';
    thin = true;
  } else {
    result = 'doesnt_meet';
    thin = rawMargin >= -THIN_MARGIN_PCT;
    tail = thin ? "doesn't meet, just below" : "doesn't meet";
  }
  return { result, marginPct: margin, thin, text: `${lead}: ${tail}` };
}

const RESULT_ORDER: EligibilityResult[] = ['doesnt_meet', 'cant_tell', 'borderline', 'meets'];

export const ELIGIBILITY_LABEL: Record<EligibilityResult, string> = {
  meets: 'meets',
  borderline: 'borderline',
  doesnt_meet: "doesn't meet",
  cant_tell: "can't tell",
};

function worst(a: EligibilityResult, b: EligibilityResult): EligibilityResult {
  return RESULT_ORDER.indexOf(a) <= RESULT_ORDER.indexOf(b) ? a : b;
}

export function checkEligibility(input: EligibilityInput): Fact<EligibilityValue> {
  const { rule, salary, profile, now } = input;
  const make = (value: EligibilityValue, confidence: Confidence, evidence: string | null): Fact<EligibilityValue> => ({
    value,
    evidence,
    source: ELIGIBILITY_SOURCE,
    method: 'rule',
    confidence,
    checkedAt: now,
    logicVersion: ELIGIBILITY_LOGIC_VERSION,
  });

  if (!rule) {
    return make({ result: 'cant_tell', reason: 'No visa rule recorded for this country yet: can\'t tell.', marginPct: null, ruleVerifiedAt: null, rule: null }, 'low', null);
  }
  const label = input.route ? describeRule(input.route, rule) : `rule v${rule.version}`;
  const fresh = ruleFreshness(rule, now);
  const verifiedAt = rule.verificationStatus === 'verified' ? rule.lastVerifiedAt : null;
  const ruleNote = verifiedAt ? `rule verified ${utcDay(verifiedAt)}${fresh.stale ? ', stale' : ''}` : 'rule never verified';

  const salaryCheck = checkSalary(rule, salary, ruleNote, fresh.stale);
  const degree = checkDegree(rule, profile);
  const experience = checkExperience(rule, profile);
  const checks = [degree, experience].filter((c): c is CheckOutcome => c !== null);

  if (!salaryCheck && checks.length === 0) {
    return make(
      {
        result: 'cant_tell',
        reason: `The ${label} rule has no salary threshold or degree/experience criteria I can check (${ruleNote}): can't tell.`,
        marginPct: null,
        ruleVerifiedAt: verifiedAt,
        rule: label,
      },
      'low',
      rule.ruleText ? rule.ruleText.slice(0, 500) : null,
    );
  }

  let result: EligibilityResult = salaryCheck ? salaryCheck.result : 'meets';
  for (const c of checks) result = worst(result, c.result);
  // A definite degree/experience failure is a "doesn't meet" even when the salary is unknown.
  if (checks.some((c) => c.result === 'doesnt_meet' && c.definite)) result = 'doesnt_meet';
  // Without a salary check, a met degree/experience rule on a stale rule is only borderline.
  if (!salaryCheck && result === 'meets' && fresh.stale) result = 'borderline';
  // Text-derived checks never fully confirm.
  if (result === 'meets' && checks.some((c) => !c.definite)) result = 'borderline';

  const parts: string[] = [];
  if (salaryCheck) parts.push(salaryCheck.text);
  for (const c of checks) parts.push(c.note);
  if (!salaryCheck) parts.push(`${ruleNote}: ${ELIGIBILITY_LABEL[result]}`);
  const reason = parts.join('; ');

  let confidence: Confidence;
  if (result === 'cant_tell') confidence = 'low';
  else if (salary?.kind === 'estimated' || fresh.stale) confidence = 'low';
  else if (result === 'borderline') confidence = 'medium';
  else confidence = checks.every((c) => c.definite) ? 'high' : 'medium';

  const evidence = [
    salaryCheck && salary ? `salary ${salary.annualEurMin ?? '?'}–${salary.annualEurMax ?? '?'} EUR/yr (${salary.kind}, ${salary.grossNet})` : null,
    rule.salaryThresholdEur ? `threshold ${rule.salaryThresholdEur} EUR` : rule.salaryThresholdLocal ? `threshold ${rule.salaryThresholdLocal} ${rule.currency ?? ''}`.trim() : null,
    label,
    rule.officialSourceUrl,
  ]
    .filter(Boolean)
    .join(' · ');

  return make({ result, reason, marginPct: salaryCheck?.marginPct ?? null, ruleVerifiedAt: verifiedAt, rule: label }, confidence, evidence || null);
}

export interface RouteRule {
  route: Pick<VisaRouteRow, 'countryIso2' | 'code' | 'name'>;
  rule: VisaRuleVersionRow | null;
}

const BEST_ORDER: EligibilityResult[] = ['meets', 'borderline', 'doesnt_meet', 'cant_tell'];

/**
 * Eligibility against every route of a country: the best evaluable route wins (one route I qualify
 * for is enough); "can't tell" only when no route could be evaluated. Other routes are listed.
 */
export function checkEligibilityForCountry(input: {
  salary: SalaryValue | null;
  routes: RouteRule[];
  profile: Profile;
  now: Date;
}): Fact<EligibilityValue> {
  const withRules = input.routes.filter((r) => r.rule !== null);
  if (!withRules.length) return checkEligibility({ salary: input.salary, rule: null, profile: input.profile, now: input.now });
  const facts = withRules.map((r) => ({ r, f: checkEligibility({ salary: input.salary, rule: r.rule, profile: input.profile, now: input.now, route: r.route }) }));
  facts.sort(
    (a, b) =>
      BEST_ORDER.indexOf(a.f.value.result) - BEST_ORDER.indexOf(b.f.value.result) ||
      (b.f.value.marginPct ?? -Infinity) - (a.f.value.marginPct ?? -Infinity),
  );
  const [top, ...rest] = facts;
  if (!rest.length) return top.f;
  const others = rest.map((x) => `${x.r.route.name}: ${ELIGIBILITY_LABEL[x.f.value.result]}`).join('; ');
  return { ...top.f, value: { ...top.f.value, reason: `${top.r.route.name} — ${top.f.value.reason}. Other routes: ${others}` } };
}
