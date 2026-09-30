/**
 * Fit Score (spec §16): known input → known score, monotonicity, low confidence lowers the score,
 * weights are relative, every component explains itself.
 */
import { describe, expect, it } from 'vitest';
import type { ScoringInput } from '../../src/lib/contracts/jobs';
import type { Confidence } from '../../src/lib/contracts/provenance';
import { profileSchema, SCORE_COMPONENT_KEYS, scoreWeightsSchema, type ScoreWeights } from '../../src/lib/contracts/settings';
import {
  CONFIDENCE_MULTIPLIER,
  experienceBandFor,
  freshnessRaw,
  salaryRaw,
  SCORE_VERSION,
  scoreJob,
} from '../../src/lib/scoring/score';

const NOW = new Date('2026-09-30T12:00:00Z');
const DAY = 86_400_000;
const profile = profileSchema.parse({});
const weights = scoreWeightsSchema.parse({});

function ideal(over: Partial<ScoringInput> = {}): ScoringInput {
  return {
    role: { roleKey: 'cloud_security_engineer', roleFamily: 'primary', confidence: 'high' },
    experience: { value: { minYears: 3, maxYears: 5, band: 'core', securityStrict: false }, confidence: 'high' },
    visa: { status: 'confirmed', confidence: 'high' },
    salary: {
      value: {
        min: 60_000,
        max: 70_000,
        currency: 'EUR',
        period: 'year',
        grossNet: 'gross',
        installments: null,
        annualEurMin: 60_000,
        annualEurMax: 70_000,
        fxRate: 1,
        fxDate: '2026-09-29',
        kind: 'stated',
      },
      confidence: 'high',
    },
    remote: { value: { class: 'not_remote', regions: [] }, confidence: 'high' },
    workplaceType: 'onsite',
    countryIso2: 'DE',
    language: { value: { postingLang: 'en', requirement: 'english_ok', languages: ['en'] }, confidence: 'high' },
    postedAt: new Date(NOW.getTime() - DAY),
    firstSeenAt: new Date(NOW.getTime() - DAY),
    lastConfirmedLiveAt: new Date(NOW.getTime() - DAY),
    linkStatus: 'ok',
    ghostRisk: false,
    skills: ['AWS', 'Terraform', 'Kubernetes', 'IAM', 'GDPR'],
    company: { isAgency: false, type: 'scaleup', sponsorHistory: true },
    eligibility: 'meets',
    now: NOW,
    ...over,
  };
}

function mixed(): ScoringInput {
  const base = ideal();
  return {
    ...base,
    role: { roleKey: 'devsecops_engineer', roleFamily: 'primary', confidence: 'medium' },
    experience: null,
    visa: { status: 'likely', confidence: 'medium' },
    eligibility: 'borderline',
    salary: {
      value: { ...base.salary!.value, min: 50_000, max: 50_000, annualEurMin: 50_000, annualEurMax: 50_000, kind: 'estimated' },
      confidence: 'low',
    },
    remote: null,
    language: { value: { postingLang: 'en', requirement: 'unclear', languages: [] }, confidence: 'medium' },
    postedAt: null,
    firstSeenAt: new Date(NOW.getTime() - 10 * DAY),
    lastConfirmedLiveAt: null,
    skills: ['aws', 'terraform', 'Photoshop'],
    company: { isAgency: false, type: 'unknown', sponsorHistory: false },
  };
}

const score = (i: ScoringInput, w: ScoreWeights = weights) => scoreJob(i, w, profile);
const comp = (i: ScoringInput, key: string) => score(i).components.find((c) => c.key === key)!;

describe('known input → known score', () => {
  it('the ideal onsite job in Germany scores 92 (remote is 0 for onsite)', () => {
    const r = score(ideal());
    expect(r.version).toBe(SCORE_VERSION);
    expect(r.score).toBe(92);
    expect(r.components.map((c) => c.key)).toEqual([...SCORE_COMPONENT_KEYS]);
    const byKey = Object.fromEntries(r.components.map((c) => [c.key, c.contribution]));
    expect(byKey).toEqual({ role: 22, experience: 12, visa: 20, salary: 10, remote: 0, language: 8, freshness: 7, skills: 8, company: 5 });
  });

  it('a mixed job scores 38, with every step explained', () => {
    const r = score(mixed());
    expect(r.score).toBe(38);
    const byKey = Object.fromEntries(r.components.map((c) => [c.key, c]));
    expect(byKey.role.contribution).toBeCloseTo(15.015, 1);
    expect(byKey.experience.contribution).toBeCloseTo(2.4, 2);
    expect(byKey.visa.contribution).toBeCloseTo(8.4, 2);
    expect(byKey.salary.contribution).toBeCloseTo(1.5, 2);
    expect(byKey.remote.contribution).toBe(0);
    expect(byKey.language.contribution).toBeCloseTo(2.8, 2);
    expect(byKey.freshness.contribution).toBeCloseTo(3.69, 2);
    expect(byKey.skills.contribution).toBeCloseTo(3.2, 2);
    expect(byKey.company.contribution).toBeCloseTo(1, 2);
    expect(byKey.salary.reason).toBe('Estimated €50k/yr vs. my floor €45k and target €55k; an estimate counts half (low confidence, counts 40%)');
    expect(byKey.visa.reason).toContain('Sponsorship likely; my eligibility for the route is borderline');
    expect(byKey.skills.reason).toBe('2 of my skills: AWS, Terraform');
    expect(byKey.freshness.reason).toContain('First seen 10 days ago; never confirmed live');
    expect(byKey.role.reason).toContain('devsecops_engineer is #2 in my primary roles');
  });

  it('contributions add up to the score and never exceed the weight', () => {
    for (const input of [ideal(), mixed()]) {
      const r = score(input);
      const sum = r.components.reduce((s, c) => s + c.contribution, 0);
      expect(Math.abs(sum - r.score)).toBeLessThan(1);
      for (const c of r.components) {
        expect(c.contribution).toBeLessThanOrEqual(c.weight + 1e-9);
        expect(c.raw).toBeGreaterThanOrEqual(0);
        expect(c.raw).toBeLessThanOrEqual(1);
        expect(c.reason.length).toBeGreaterThan(3);
        expect(c.label.length).toBeGreaterThan(3);
      }
    }
  });

  it('is deterministic', () => {
    expect(score(mixed())).toEqual(score(mixed()));
  });
});

describe('weights', () => {
  it('are relative: doubling every weight changes nothing', () => {
    const doubled = Object.fromEntries(Object.entries(weights).map(([k, v]) => [k, v * 2])) as ScoreWeights;
    expect(score(mixed(), doubled).score).toBe(score(mixed()).score);
  });

  it('all-zero weights → score 0', () => {
    const zero = Object.fromEntries(Object.keys(weights).map((k) => [k, 0])) as ScoreWeights;
    const r = score(ideal(), zero);
    expect(r.score).toBe(0);
    expect(r.components.every((c) => c.weight === 0)).toBe(true);
  });

  it('only visa weighted → the score is the visa component', () => {
    const onlyVisa = Object.fromEntries(Object.keys(weights).map((k) => [k, k === 'visa' ? 5 : 0])) as ScoreWeights;
    expect(score(ideal(), onlyVisa).score).toBe(100);
    expect(score(ideal({ visa: { status: 'not_offered', confidence: 'high' } }), onlyVisa).score).toBe(0);
  });
});

describe('low confidence lowers the score', () => {
  const confidences: Confidence[] = ['high', 'medium', 'low'];

  it('multipliers are 1.0 / 0.7 / 0.4', () => {
    expect(CONFIDENCE_MULTIPLIER).toEqual({ high: 1, medium: 0.7, low: 0.4 });
  });

  it.each([
    ['role', (c: Confidence) => ideal({ role: { roleKey: 'cloud_security_engineer', roleFamily: 'primary', confidence: c } })],
    ['visa', (c: Confidence) => ideal({ visa: { status: 'confirmed', confidence: c } })],
    ['salary', (c: Confidence) => ideal({ salary: { ...ideal().salary!, confidence: c } })],
    ['language', (c: Confidence) => ideal({ language: { ...ideal().language!, confidence: c } })],
    ['experience', (c: Confidence) => ideal({ experience: { ...ideal().experience!, confidence: c } })],
  ] as const)('%s: high > medium > low', (_key, make) => {
    const [h, m, l] = confidences.map((c) => score(make(c)).score);
    expect(h).toBeGreaterThan(m);
    expect(m).toBeGreaterThan(l);
  });

  it('an unknown visa status (low) scores below a likely one (medium)', () => {
    expect(score(ideal({ visa: { status: 'unknown', confidence: 'low' } })).score).toBeLessThan(score(ideal({ visa: { status: 'likely', confidence: 'medium' } })).score);
  });

  it('missing facts are not neutral: no experience scores below a core match', () => {
    expect(comp(ideal({ experience: null }), 'experience').contribution).toBeLessThan(comp(ideal(), 'experience').contribution / 2);
  });
});

describe('monotonicity', () => {
  it('visa: confirmed ≥ likely ≥ unknown ≥ conflicting ≥ not offered', () => {
    const order = (['confirmed', 'likely', 'unknown', 'conflicting', 'not_offered'] as const).map((s) => score(ideal({ visa: { status: s, confidence: 'high' } })).score);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThanOrEqual(order[i - 1]);
    expect(order[0]).toBeGreaterThan(order[order.length - 1]);
  });

  it('salary: more money never scores lower', () => {
    let prev = -1;
    for (let eur = 20_000; eur <= 120_000; eur += 2_500) {
      const s = ideal().salary!;
      const v = score(ideal({ salary: { ...s, value: { ...s.value, annualEurMin: eur, annualEurMax: eur } } })).score;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('freshness: older never scores higher', () => {
    let prev = Infinity;
    for (let d = 0; d <= 120; d += 1) {
      const posted = new Date(NOW.getTime() - d * DAY);
      const v = comp(ideal({ postedAt: posted, firstSeenAt: posted }), 'freshness').contribution;
      expect(v).toBeLessThanOrEqual(prev);
      prev = v;
    }
  });

  it('skills: more of my skills never scores lower', () => {
    const all = ['AWS', 'Azure', 'GCP', 'IAM', 'Terraform', 'Kubernetes', 'Docker'];
    let prev = -1;
    for (let n = 0; n <= all.length; n++) {
      const v = score(ideal({ skills: all.slice(0, n) })).score;
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });

  it('role: primary > secondary > fallback > other', () => {
    const r = (roleKey: string | null, roleFamily: 'primary' | 'secondary' | 'fallback' | 'other') => score(ideal({ role: { roleKey, roleFamily, confidence: 'high' } })).score;
    const p = r('cloud_security_engineer', 'primary');
    const s = r('cloud_security_analyst', 'secondary');
    const f = r('node_developer', 'fallback');
    const o = r(null, 'other');
    expect(p).toBeGreaterThan(s);
    expect(s).toBeGreaterThan(f);
    expect(f).toBeGreaterThan(o);
  });

  it('within the primary list, cloud security ranks above product security', () => {
    const r = (roleKey: string) => comp(ideal({ role: { roleKey, roleFamily: 'primary', confidence: 'high' } }), 'role').raw;
    expect(r('cloud_security_engineer')).toBeGreaterThan(r('product_security_engineer'));
  });

  it('language: English OK > unclear > local required', () => {
    const l = (requirement: 'english_ok' | 'unclear' | 'local_required') => score(ideal({ language: { value: { postingLang: 'de', requirement, languages: [] }, confidence: 'high' } })).score;
    expect(l('english_ok')).toBeGreaterThan(l('unclear'));
    expect(l('unclear')).toBeGreaterThan(l('local_required'));
  });
});

describe('component rules', () => {
  it('an estimated salary counts half of the same stated salary', () => {
    const s = ideal().salary!;
    const stated = comp(ideal(), 'salary');
    const est = comp(ideal({ salary: { ...s, value: { ...s.value, kind: 'estimated' } } }), 'salary');
    expect(est.raw).toBeCloseTo(stated.raw * 0.5, 5);
  });

  it('remote counts only when worldwide', () => {
    for (const cls of ['region_limited', 'timezone_limited', 'unclear', 'not_remote'] as const) {
      expect(comp(ideal({ remote: { value: { class: cls, regions: [] }, confidence: 'high' } }), 'remote').contribution).toBe(0);
    }
    expect(comp(ideal({ remote: { value: { class: 'worldwide', regions: ['WORLDWIDE'] }, confidence: 'high' } }), 'remote').contribution).toBe(8);
  });

  it('no visa is needed for a worldwide remote job or a job in my passport country', () => {
    const remote = comp(ideal({ remote: { value: { class: 'worldwide', regions: ['IN'] }, confidence: 'high' }, visa: { status: 'unknown', confidence: 'low' } }), 'visa');
    expect(remote.raw).toBe(1);
    expect(remote.reason).toContain('No visa needed');
    const home = comp(ideal({ countryIso2: 'IN', visa: { status: 'not_offered', confidence: 'high' } }), 'visa');
    expect(home.raw).toBe(1);
    // A low-confidence "worldwide" does not waive the visa.
    const unsure = comp(ideal({ remote: { value: { class: 'worldwide', regions: [] }, confidence: 'low' }, visa: { status: 'unknown', confidence: 'low' } }), 'visa');
    expect(unsure.raw).toBeCloseTo(0.35, 5);
  });

  it("not meeting the visa route criteria lowers the visa component", () => {
    expect(comp(ideal({ eligibility: 'doesnt_meet' }), 'visa').raw).toBeCloseTo(0.25, 5);
    expect(comp(ideal({ eligibility: 'cant_tell' }), 'visa').raw).toBe(1);
  });

  it('a dead link zeroes freshness; ghost risk halves it', () => {
    expect(comp(ideal({ linkStatus: 'dead' }), 'freshness').raw).toBe(0);
    expect(comp(ideal({ ghostRisk: true }), 'freshness').raw).toBeCloseTo(0.5, 5);
    expect(comp(ideal({ linkStatus: 'redirected' }), 'freshness').raw).toBeCloseTo(0.8, 5);
  });

  it('a future posting date counts as today', () => {
    expect(comp(ideal({ postedAt: new Date(NOW.getTime() + 5 * DAY) }), 'freshness').raw).toBe(1);
  });

  it('experience bands follow my profile', () => {
    expect(experienceBandFor(3, profile)).toBe('core');
    expect(experienceBandFor(5, profile)).toBe('show');
    expect(experienceBandFor(1, profile)).toBe('show');
    expect(experienceBandFor(0, profile)).toBe('hide');
    expect(experienceBandFor(6, profile)).toBe('hide');
    expect(comp(ideal({ experience: { value: { minYears: 7, maxYears: null, band: 'hide', securityStrict: false }, confidence: 'high' } }), 'experience').raw).toBe(0);
    const strict = comp(ideal({ experience: { value: { minYears: 4, maxYears: null, band: 'core', securityStrict: true }, confidence: 'high' } }), 'experience');
    expect(strict.raw).toBe(0.3);
    expect(strict.reason).toContain('strict security requirement');
  });

  it('agencies and excluded company types', () => {
    expect(comp(ideal({ company: { isAgency: true, type: 'agency', sponsorHistory: false } }), 'company').raw).toBeCloseTo(0.3, 5);
    const noStartups = profileSchema.parse({ companyTypes: ['mnc', 'scaleup', 'midsize', 'unknown'] });
    const c = scoreJob(ideal({ company: { isAgency: false, type: 'startup', sponsorHistory: true } }), weights, noStartups).components.find((x) => x.key === 'company')!;
    expect(c.raw).toBe(0);
    expect(c.reason).toContain('excluded');
  });

  it('skill matching ignores case and punctuation and counts each skill once', () => {
    expect(comp(ideal({ skills: ['aws', 'AWS', 'ci-cd', 'CI/CD', 'iso27001'] }), 'skills').reason).toBe('3 of my skills: AWS, CI/CD, ISO 27001');
  });

  it('pure helpers', () => {
    expect(salaryRaw(30_000, 40_000, 45_000, 55_000)).toBe(0);
    expect(salaryRaw(40_000, 48_000, 45_000, 55_000)).toBe(0.3);
    expect(salaryRaw(45_000, 45_000, 45_000, 55_000)).toBe(0.5);
    expect(salaryRaw(55_000, 60_000, 45_000, 55_000)).toBe(1);
    expect(freshnessRaw(0)).toBe(1);
    expect(freshnessRaw(3)).toBe(1);
    expect(freshnessRaw(30)).toBe(0.5);
    expect(freshnessRaw(365)).toBe(0.1);
  });
});
