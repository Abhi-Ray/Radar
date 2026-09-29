import { describe, expect, it } from 'vitest';
import {
  confidenceRank,
  TRUST_ORDER,
  trustRank,
  type Confidence,
  type FactKey,
  type Method,
  type StoredFact,
} from '../../src/lib/contracts/provenance';
import { hashJson } from '../../src/lib/hash';
import {
  columnOverrides,
  compareFacts,
  factMeaning,
  lowestConfidence,
  overrideToFact,
  resolveFact,
  resolveJobFacts,
  type OverrideLike,
} from '../../src/lib/provenance/resolve';
import { correctionToLabels, resolvedToJobColumns } from '../../src/lib/provenance/store';

let nextId = 1;
function fact<T>(
  key: FactKey,
  value: T,
  method: Method,
  confidence: Confidence = 'high',
  opts: { checkedAt?: Date; active?: boolean; source?: string } = {},
): StoredFact<T> {
  const id = nextId++;
  return {
    id,
    key,
    value,
    valueHash: hashJson(value),
    evidence: `evidence ${id}`,
    source: opts.source ?? `${method} source`,
    method,
    confidence,
    checkedAt: opts.checkedAt ?? new Date('2026-01-01T00:00:00Z'),
    logicVersion: 'test-1',
    isActive: opts.active ?? true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

function override(field: string, valueJson: unknown, opts: { id?: number; at?: Date; active?: boolean } = {}): OverrideLike {
  return {
    id: opts.id ?? nextId++,
    field,
    valueJson,
    reason: 'checked the posting myself',
    createdAt: opts.at ?? new Date('2026-02-01T00:00:00Z'),
    active: opts.active ?? true,
  };
}

describe('trust order', () => {
  it('is manual > official > posting > rule > ai > estimate', () => {
    expect(TRUST_ORDER).toEqual(['manual', 'official', 'posting', 'rule', 'ai', 'estimate']);
    expect(trustRank('manual')).toBeLessThan(trustRank('official'));
    expect(trustRank('ai')).toBeLessThan(trustRank('estimate'));
    expect(trustRank('bogus')).toBe(TRUST_ORDER.length);
    expect(confidenceRank('high')).toBeLessThan(confidenceRank('low'));
  });

  it('a lower level never wins, whatever its confidence or freshness', () => {
    const official = fact('visa_status', { status: 'likely' }, 'official', 'low', { checkedAt: new Date('2020-01-01') });
    const ai = fact('visa_status', { status: 'confirmed' }, 'ai', 'high', { checkedAt: new Date('2026-06-01') });
    const posting = fact('visa_status', { status: 'unlikely' }, 'posting', 'high');
    for (const order of [
      [ai, posting, official],
      [official, ai, posting],
      [posting, official, ai],
    ]) {
      const r = resolveFact(order);
      expect(r.winner?.id).toBe(official.id);
      expect(r.others.map((o) => o.method)).toEqual(['posting', 'ai']);
    }
  });

  it('AI never beats a rule, a rule never beats the posting', () => {
    const rule = fact('remote', { class: 'worldwide' }, 'rule', 'low');
    const ai = fact('remote', { class: 'not_remote' }, 'ai', 'high');
    expect(resolveFact([ai, rule]).winner?.method).toBe('rule');
    const posting = fact('remote', { class: 'region_limited' }, 'posting', 'low');
    expect(resolveFact([rule, posting, ai]).winner?.method).toBe('posting');
  });

  it('within a level: confidence, then most recently checked, then newest id', () => {
    const lowNew = fact('language', { requirement: 'english_ok' }, 'rule', 'low', { checkedAt: new Date('2026-05-01') });
    const highOld = fact('language', { requirement: 'english_ok' }, 'rule', 'high', { checkedAt: new Date('2025-01-01') });
    expect(resolveFact([lowNew, highOld]).winner?.id).toBe(highOld.id);
    const older = fact('language', { requirement: 'local_required' }, 'rule', 'medium', { checkedAt: new Date('2025-01-01') });
    const newer = fact('language', { requirement: 'local_required' }, 'rule', 'medium', { checkedAt: new Date('2025-06-01') });
    expect(resolveFact([older, newer]).winner?.id).toBe(newer.id);
    const a = fact('language', { requirement: 'unclear' }, 'rule', 'medium');
    const b = fact('language', { requirement: 'unclear' }, 'rule', 'medium');
    expect(compareFacts(a, b)).toBeGreaterThan(0);
    expect(resolveFact([a, b]).winner?.id).toBe(b.id);
  });

  it('ignores inactive facts and returns an empty result for none', () => {
    const inactive = fact('salary', { annualEurMin: 90000 }, 'official', 'high', { active: false });
    const posting = fact('salary', { annualEurMin: 60000 }, 'posting', 'medium');
    expect(resolveFact([inactive, posting]).winner?.id).toBe(posting.id);
    expect(resolveFact([])).toEqual({ winner: null, conflict: false, others: [], conflictWith: [], overridden: false });
  });
});

describe('conflicts', () => {
  it('flags disagreeing sources on the meaning of the value', () => {
    const posting = fact('visa_status', { status: 'confirmed', reasons: ['sponsorship offered'] }, 'posting');
    const rule = fact('visa_status', { status: 'unlikely', reasons: ['EU only'] }, 'rule');
    const r = resolveFact([posting, rule]);
    expect(r.conflict).toBe(true);
    expect(r.conflictWith.map((c) => c.id)).toEqual([rule.id]);
  });

  it('re-worded evidence / different reasons with the same meaning is not a conflict', () => {
    const a = fact('visa_status', { status: 'likely', reasons: ['a'] }, 'posting');
    const b = fact('visa_status', { status: 'likely', reasons: ['b', 'c'] }, 'rule');
    expect(resolveFact([a, b]).conflict).toBe(false);
    const s1 = fact('salary', { annualEurMin: 60_100, annualEurMax: 80_000, raw: '60k-80k' }, 'posting');
    const s2 = fact('salary', { annualEurMin: 60_000, annualEurMax: 80_200, raw: '€60.000 – €80.000' }, 'ai');
    expect(resolveFact([s1, s2]).conflict).toBe(false);
    const k1 = fact('skills', { found: ['AWS', 'terraform'] }, 'rule');
    const k2 = fact('skills', { found: ['Terraform', 'aws', 'aws'] }, 'ai');
    expect(resolveFact([k1, k2]).conflict).toBe(false);
  });

  it('estimates never cause a conflict', () => {
    const posting = fact('salary', { annualEurMin: 50_000, annualEurMax: 60_000 }, 'posting');
    const est = fact('salary', { annualEurMin: 90_000, annualEurMax: 120_000 }, 'estimate', 'low');
    const r = resolveFact([posting, est]);
    expect(r.conflict).toBe(false);
    expect(r.others).toHaveLength(1);
  });

  it('multi-valued keys never conflict', () => {
    const s1 = fact('visa_signal', { kind: 'sponsorship_offered', quote: 'we sponsor visas' }, 'posting');
    const s2 = fact('visa_signal', { kind: 'eu_only', quote: 'EU citizens only' }, 'rule');
    expect(resolveFact([s1, s2]).conflict).toBe(false);
  });

  it('factMeaning projections', () => {
    expect(factMeaning('remote', { class: 'worldwide', regions: ['x'] })).toBe('worldwide');
    expect(factMeaning('closing_date', '2026-03-01T12:00:00Z')).toBe('2026-03-01');
    expect(factMeaning('closing_date', { date: '2026-03-01' })).toBe('2026-03-01');
    expect(factMeaning('experience', { minYears: 3, maxYears: null, band: 'core' })).toEqual([3, null]);
    expect(factMeaning('role', { roleKey: 'cloud_security', roleFamily: 'primary', matchedBy: 'x' })).toEqual([
      'cloud_security',
      'primary',
    ]);
    expect(factMeaning('salary', { min: 5000, max: 6000, currency: 'EUR', period: 'month' })).toEqual([
      'raw',
      5000,
      6000,
      'EUR',
      'month',
    ]);
    expect(factMeaning('suspicious', true)).toBe(true);
  });
});

describe('manual overrides', () => {
  it('become high-confidence manual facts with negative ids and beat everything', () => {
    const official = fact('visa_status', { status: 'unlikely' }, 'official', 'high');
    const o = override('visa_status', { status: 'confirmed' }, { id: 7 });
    const synthetic = overrideToFact(o);
    expect(synthetic).toMatchObject({ id: -7, method: 'manual', confidence: 'high', evidence: o.reason });
    const r = resolveJobFacts([official], [o]).visa_status!;
    expect(r.winner?.method).toBe('manual');
    expect(r.overridden).toBe(true);
    // A manual decision is not a "conflict", but the disagreement is still visible.
    expect(r.conflict).toBe(false);
    expect(r.conflictWith.map((c) => c.id)).toEqual([official.id]);
  });

  it('inactive overrides and column overrides do not become facts', () => {
    const posting = fact('remote', { class: 'worldwide' }, 'posting');
    const r = resolveJobFacts([posting], [override('remote', { class: 'not_remote' }, { active: false }), override('title', 'X')]);
    expect(r.remote?.winner?.id).toBe(posting.id);
    expect(overrideToFact(override('city', 'Berlin'))).toBeNull();
  });

  it('columnOverrides picks the latest active value per field', () => {
    const res = columnOverrides([
      override('title', 'Old', { at: new Date('2026-01-01') }),
      override('title', 'New', { at: new Date('2026-02-01') }),
      override('city', 'Berlin', { active: false }),
      override('country', 'NL'),
      override('visa_status', { status: 'likely' }),
    ]);
    expect(res).toEqual({ title: 'New', country: 'NL' });
  });

  it('resolveJobFacts groups by key and skips keys without candidates', () => {
    const r = resolveJobFacts(
      [fact('remote', { class: 'worldwide' }, 'rule'), fact('language', { requirement: 'english_ok' }, 'ai', 'low')],
      [],
    );
    expect(Object.keys(r).sort()).toEqual(['language', 'remote']);
    expect(lowestConfidence(r, ['remote', 'language', 'salary'])).toBe('low');
    expect(lowestConfidence(r, ['salary'])).toBeNull();
  });
});

describe('resolved → job columns', () => {
  it('maps winners onto the denormalised columns', () => {
    const now = new Date('2026-03-01T00:00:00Z');
    const r = resolveJobFacts(
      [
        fact('visa_status', { status: 'likely' }, 'rule', 'medium'),
        fact('remote', { class: 'region_limited', regions: ['EU'] }, 'posting'),
        fact('language', { requirement: 'english_ok' }, 'rule', 'high'),
        fact('experience', { minYears: 300, maxYears: null, band: 'core' }, 'rule', 'high'),
        fact('seniority', { word: 'senior' }, 'rule'),
        fact('salary', { annualEurMin: 70_000.4, annualEurMax: 90_000, kind: 'stated' }, 'posting', 'high'),
        fact('role', { roleKey: 'cloud_security', roleFamily: 'primary' }, 'rule', 'high'),
        fact('eligibility', { result: 'meets' }, 'rule', 'medium'),
      ],
      [],
    );
    const cols = resolvedToJobColumns(r, now);
    expect(cols).toMatchObject({
      visaStatus: 'likely',
      visaConfidence: 'medium',
      remoteClass: 'region_limited',
      languageRequirement: 'english_ok',
      experienceMinYears: 255,
      seniority: 'senior',
      salaryEurMin: 70_000,
      salaryEurMax: 90_000,
      salaryKind: 'stated',
      factsConfidence: 'medium',
      roleKey: 'cloud_security',
      roleFamily: 'primary',
      resolvedAt: now,
    });
  });

  it('conflicts show as "conflicting"; estimates as "estimated"; unknown enums become null', () => {
    const r = resolveJobFacts(
      [
        fact('visa_status', { status: 'confirmed' }, 'posting'),
        fact('visa_status', { status: 'unlikely' }, 'rule'),
        fact('salary', { annualEurMin: 50_000 }, 'estimate', 'low'),
        fact('remote', { class: 'moon_base' }, 'rule'),
      ],
      [],
    );
    const cols = resolvedToJobColumns(r);
    expect(cols.visaStatus).toBe('conflicting');
    expect(cols.salaryKind).toBe('estimated');
    expect(cols.remoteClass).toBeNull();
    expect('roleFamily' in cols).toBe(false);
  });
});

describe('correction → golden labels', () => {
  it('maps plain values and fact objects', () => {
    expect(correctionToLabels('visa_status', 'likely')).toEqual({ visa_status: 'likely' });
    expect(correctionToLabels('visa_status', { status: 'confirmed', reasons: [] })).toEqual({ visa_status: 'confirmed' });
    expect(correctionToLabels('remote', { class: 'worldwide' })).toEqual({ remote_class: 'worldwide' });
    expect(correctionToLabels('country', ' nl ')).toEqual({ country_iso2: 'NL' });
    expect(correctionToLabels('experience', { minYears: 4 })).toEqual({ experience_min_years: 4 });
    expect(correctionToLabels('role', { roleKey: 'devsecops', roleFamily: 'primary' })).toEqual({
      role_key: 'devsecops',
      role_match: true,
    });
    expect(correctionToLabels('role', { roleKey: null, roleFamily: 'other' })).toEqual({ role_key: null, role_match: false });
    expect(correctionToLabels('salary', null)).toEqual({ salary: { stated: false } });
    expect(correctionToLabels('salary', { min: 5000, max: 6000, currency: 'EUR', period: 'month', kind: 'stated' })).toEqual({
      salary: { stated: true, currency: 'EUR', period: 'month', min: 5000, max: 6000 },
    });
  });

  it('returns {} for unmappable or invalid input', () => {
    expect(correctionToLabels('visa_status', 'definitely')).toEqual({});
    expect(correctionToLabels('title', 'Senior Engineer')).toEqual({});
    expect(correctionToLabels('country', 'Germany')).toEqual({});
  });
});
