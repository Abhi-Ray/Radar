/**
 * "Am I eligible?" (spec §13.5): thresholds, thin margins, estimates, stale rules, degree and
 * experience criteria, multi-route countries.
 */
import { describe, expect, it } from 'vitest';
import type { VisaRuleVersionRow } from '../../src/db/schema';
import type { SalaryValue } from '../../src/lib/contracts/jobs';
import { profileSchema } from '../../src/lib/contracts/settings';
import {
  checkEligibility,
  checkEligibilityForCountry,
  degreeLevelFromText,
  ELIGIBILITY_LOGIC_VERSION,
  formatEur,
  yearsFromText,
} from '../../src/lib/visa/eligibility';

const NOW = new Date('2026-09-30T08:00:00Z');
const profile = profileSchema.parse({});

function rule(over: Partial<VisaRuleVersionRow> = {}): VisaRuleVersionRow {
  return {
    id: 1,
    routeId: 1,
    version: 2,
    effectiveFrom: '2026-01-01',
    effectiveTo: null,
    salaryThresholdEur: 45_000,
    salaryThresholdLocal: null,
    currency: 'EUR',
    degreeRule: null,
    experienceRule: null,
    otherRulesJson: null,
    ruleText: null,
    officialSourceUrl: 'https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card',
    verificationStatus: 'verified',
    lastVerifiedAt: new Date('2026-09-05T00:00:00Z'),
    nextReviewAt: new Date('2026-12-04T00:00:00Z'),
    verifiedBy: 'admin',
    changeReason: 'seed',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function salary(min: number | null, max: number | null = min, over: Partial<SalaryValue> = {}): SalaryValue {
  return {
    min,
    max,
    currency: 'EUR',
    period: 'year',
    grossNet: 'gross',
    installments: null,
    annualEurMin: min,
    annualEurMax: max,
    fxRate: 1,
    fxDate: '2026-09-29',
    kind: 'stated',
    ...over,
  };
}

const route = { countryIso2: 'DE', code: 'eu_blue_card', name: 'EU Blue Card' };

describe('checkEligibility: salary threshold', () => {
  it('uses the spec reason format for a thin margin', () => {
    const f = checkEligibility({ salary: salary(48_000), rule: rule(), profile, now: NOW, route });
    expect(f.value.result).toBe('borderline');
    expect(f.value.reason).toBe('Job salary €48k vs. threshold €45k (rule verified 2026-09-05): meets, thin margin');
    expect(f.value.marginPct).toBeCloseTo(6.7, 1);
    expect(f.value.rule).toBe('DE eu_blue_card v2');
    expect(f.value.ruleVerifiedAt).toEqual(new Date('2026-09-05T00:00:00Z'));
    expect(f.logicVersion).toBe(ELIGIBILITY_LOGIC_VERSION);
    expect(f.method).toBe('rule');
    expect(f.source).toBe('eligibility check');
  });

  it('meets with a comfortable margin (high confidence)', () => {
    const f = checkEligibility({ salary: salary(60_000, 70_000), rule: rule(), profile, now: NOW });
    expect(f.value.result).toBe('meets');
    expect(f.confidence).toBe('high');
    expect(f.value.reason).toContain('€60k–€70k vs. threshold €45k');
  });

  it('exactly 10% margin is no longer thin', () => {
    expect(checkEligibility({ salary: salary(49_500), rule: rule(), profile, now: NOW }).value.result).toBe('meets');
    expect(checkEligibility({ salary: salary(49_499), rule: rule(), profile, now: NOW }).value.result).toBe('borderline');
  });

  it("doesn't meet when even the top of the range is below", () => {
    const f = checkEligibility({ salary: salary(30_000, 38_000), rule: rule(), profile, now: NOW });
    expect(f.value.result).toBe('doesnt_meet');
    expect(f.value.marginPct).toBeLessThan(0);
    expect(f.confidence).toBe('high');
  });

  it('a range straddling the threshold is borderline', () => {
    const f = checkEligibility({ salary: salary(40_000, 55_000), rule: rule(), profile, now: NOW });
    expect(f.value.result).toBe('borderline');
    expect(f.value.reason).toContain('straddles');
  });

  it('estimated salary is borderline at best, low confidence', () => {
    const f = checkEligibility({ salary: salary(80_000, 80_000, { kind: 'estimated' }), rule: rule(), profile, now: NOW });
    expect(f.value.result).toBe('borderline');
    expect(f.confidence).toBe('low');
    expect(f.value.reason).toMatch(/^Estimated salary €80k/);
    const below = checkEligibility({ salary: salary(20_000, 20_000, { kind: 'estimated' }), rule: rule(), profile, now: NOW });
    expect(below.value.result).toBe('borderline');
  });

  it('net salary only proves "meets", never "doesn\'t meet"', () => {
    expect(checkEligibility({ salary: salary(60_000, 60_000, { grossNet: 'net' }), rule: rule(), profile, now: NOW }).value.result).toBe('meets');
    expect(checkEligibility({ salary: salary(30_000, 30_000, { grossNet: 'net' }), rule: rule(), profile, now: NOW }).value.result).toBe('borderline');
  });

  it('no salary → can\'t tell', () => {
    const f = checkEligibility({ salary: null, rule: rule(), profile, now: NOW });
    expect(f.value.result).toBe('cant_tell');
    expect(f.confidence).toBe('low');
    expect(f.value.reason).toContain('No salary in the posting');
  });

  it('no rule → can\'t tell', () => {
    const f = checkEligibility({ salary: salary(60_000), rule: null, profile, now: NOW });
    expect(f.value.result).toBe('cant_tell');
    expect(f.value.ruleVerifiedAt).toBeNull();
  });

  it('local-currency threshold is converted with the job FX rate', () => {
    const r = rule({ salaryThresholdEur: null, salaryThresholdLocal: 38_700, currency: 'GBP' });
    const s = salary(52_941, 52_941, { currency: 'GBP', min: 45_000, max: 45_000, fxRate: 0.85 });
    const f = checkEligibility({ salary: s, rule: r, profile, now: NOW });
    expect(f.value.result).toBe('meets');
    expect(f.value.reason).toContain('GBP 38,700');
    const other = checkEligibility({ salary: salary(60_000), rule: r, profile, now: NOW });
    expect(other.value.result).toBe('cant_tell');
  });
});

describe('checkEligibility: stale rules', () => {
  it('a stale rule turns meets into borderline and says so', () => {
    const f = checkEligibility({ salary: salary(60_000), rule: rule({ lastVerifiedAt: new Date('2026-05-01T00:00:00Z') }), profile, now: NOW });
    expect(f.value.result).toBe('borderline');
    expect(f.value.reason).toContain('rule verified 2026-05-01, stale');
    expect(f.confidence).toBe('low');
  });

  it('a never-verified rule is stale', () => {
    const f = checkEligibility({ salary: salary(60_000), rule: rule({ verificationStatus: 'unverified', lastVerifiedAt: null }), profile, now: NOW });
    expect(f.value.result).toBe('borderline');
    expect(f.value.reason).toContain('rule never verified');
    expect(f.value.ruleVerifiedAt).toBeNull();
  });

  it('a stale rule keeps doesn\'t meet only when far below', () => {
    const stale = rule({ lastVerifiedAt: new Date('2026-01-01T00:00:00Z') });
    expect(checkEligibility({ salary: salary(30_000), rule: stale, profile, now: NOW }).value.result).toBe('doesnt_meet');
    expect(checkEligibility({ salary: salary(43_000), rule: stale, profile, now: NOW }).value.result).toBe('borderline');
  });

  it('exactly 90 days is still fresh, 91 is stale', () => {
    const at90 = new Date(NOW.getTime() - 90 * 86_400_000);
    const at91 = new Date(NOW.getTime() - 91 * 86_400_000);
    expect(checkEligibility({ salary: salary(60_000), rule: rule({ lastVerifiedAt: at90 }), profile, now: NOW }).value.result).toBe('meets');
    expect(checkEligibility({ salary: salary(60_000), rule: rule({ lastVerifiedAt: at91 }), profile, now: NOW }).value.result).toBe('borderline');
  });
});

describe('checkEligibility: degree and experience', () => {
  it('structured degree requirement met by a bachelor', () => {
    const f = checkEligibility({ salary: salary(60_000), rule: rule({ otherRulesJson: { minDegreeLevel: 'bachelor' } }), profile, now: NOW });
    expect(f.value.result).toBe('meets');
    expect(f.value.reason).toContain("bachelor's degree meets");
  });

  it('structured master requirement → doesn\'t meet, even without salary', () => {
    const f = checkEligibility({ salary: null, rule: rule({ otherRulesJson: { minDegreeLevel: 'master' } }), profile, now: NOW });
    expect(f.value.result).toBe('doesnt_meet');
  });

  it('years can substitute for the degree', () => {
    const f = checkEligibility({
      salary: salary(60_000),
      rule: rule({ otherRulesJson: { minDegreeLevel: 'master', yearsInsteadOfDegree: 3 } }),
      profile,
      now: NOW,
    });
    expect(f.value.result).toBe('meets');
  });

  it('structured experience requirement', () => {
    expect(checkEligibility({ salary: salary(60_000), rule: rule({ otherRulesJson: { minYearsExperience: 2 } }), profile, now: NOW }).value.result).toBe('meets');
    expect(checkEligibility({ salary: salary(60_000), rule: rule({ otherRulesJson: { minYearsExperience: 5 } }), profile, now: NOW }).value.result).toBe('doesnt_meet');
  });

  it('text-only rules never fully confirm and never reject', () => {
    const met = checkEligibility({ salary: salary(60_000), rule: rule({ degreeRule: 'Recognised university degree' }), profile, now: NOW });
    expect(met.value.result).toBe('borderline');
    const master = checkEligibility({ salary: salary(60_000), rule: rule({ degreeRule: "Master's degree in a related field" }), profile, now: NOW });
    expect(master.value.result).toBe('borderline');
    expect(master.value.reason).toContain('check');
  });

  it('route without salary or criteria → can\'t tell', () => {
    const f = checkEligibility({ salary: salary(60_000), rule: rule({ salaryThresholdEur: null }), profile, now: NOW, route });
    expect(f.value.result).toBe('cant_tell');
  });

  it('route without salary threshold but met structured degree → meets', () => {
    const f = checkEligibility({ salary: null, rule: rule({ salaryThresholdEur: null, otherRulesJson: { minDegreeLevel: 'bachelor' } }), profile, now: NOW });
    expect(f.value.result).toBe('meets');
  });
});

describe('checkEligibilityForCountry', () => {
  it('the best route wins and the others are listed', () => {
    const f = checkEligibilityForCountry({
      salary: salary(46_000),
      routes: [
        { route, rule: rule({ salaryThresholdEur: 48_300 }) },
        { route: { countryIso2: 'DE', code: 'skilled_worker', name: 'Skilled worker' }, rule: rule({ id: 2, salaryThresholdEur: 40_000 }) },
      ],
      profile,
      now: NOW,
    });
    expect(f.value.result).toBe('meets');
    expect(f.value.rule).toBe('DE skilled_worker v2');
    expect(f.value.reason).toContain("Other routes: EU Blue Card: doesn't meet");
  });

  it('no rules at all → can\'t tell', () => {
    expect(checkEligibilityForCountry({ salary: salary(60_000), routes: [{ route, rule: null }], profile, now: NOW }).value.result).toBe('cant_tell');
  });
});

describe('helpers', () => {
  it('formatEur', () => {
    expect(formatEur(48_000)).toBe('€48k');
    expect(formatEur(48_300)).toBe('€48.3k');
    expect(formatEur(950)).toBe('€950');
  });
  it('reads degree and years from text', () => {
    expect(degreeLevelFromText('A recognised university degree')).toBe('bachelor');
    expect(degreeLevelFromText("Master's or equivalent")).toBe('master');
    expect(degreeLevelFromText(null)).toBeNull();
    expect(yearsFromText('at least 3 years of professional experience')).toBe(3);
    expect(yearsFromText('relevant experience')).toBeNull();
  });
});
