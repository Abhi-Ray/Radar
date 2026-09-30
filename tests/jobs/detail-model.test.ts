import { describe, expect, it } from 'vitest';
import { describeFactValue, describeSalary, evidenceOf, factLabel } from '@/components/jobs/fact-display';
import { fitBars, historyItems, ledgerEntries, lingeringColumnOverride, linkCheckText, marginText, visaDecisionOf, visaSignalOf } from '@/components/jobs/detail/detail-model';
import type { ScoreComponent } from '@/lib/contracts/jobs';
import type { StoredFact } from '@/lib/contracts/provenance';
import { resolveJobFacts } from '@/lib/provenance/resolve';

let nextId = 1;
function fact(key: StoredFact['key'], value: unknown, over: Partial<StoredFact> = {}): StoredFact {
  const id = nextId++;
  return {
    id,
    key,
    value,
    valueHash: `h${id}`,
    evidence: null,
    source: 'test',
    method: 'posting',
    confidence: 'medium',
    checkedAt: new Date('2026-09-20T10:00:00Z'),
    logicVersion: 'test@1',
    isActive: true,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    ...over,
  };
}

describe('describeFactValue', () => {
  it('reads salary with annual EUR, original currency and kind', () => {
    const s = describeSalary({ min: 4000, max: 5000, currency: 'GBP', period: 'month', grossNet: 'gross', installments: 12, annualEurMin: 56470, annualEurMax: 70588, fxRate: 1.176, fxDate: '2026-09-29', kind: 'stated' });
    expect(s).toContain('/yr gross');
    expect(s).toContain('stated');
    expect(s).toContain('/month');
    expect(describeSalary({ min: null, max: null, currency: 'EUR', period: 'year', kind: 'estimated' })).toBe('No amount (estimated)');
  });

  it('reads the common fact shapes and never hides unknown shapes', () => {
    expect(describeFactValue('visa_status', { status: 'confirmed', reasons: [] })).toBe('Confirmed');
    expect(describeFactValue('visa_status', 'likely')).toMatch(/likely/i);
    expect(describeFactValue('remote', { class: 'worldwide', regions: ['EU'] })).toMatch(/EU$/);
    expect(describeFactValue('experience', { minYears: 3, maxYears: 5, band: 'mid' })).toMatch(/^3–5 yrs/);
    expect(describeFactValue('suspicious', { suspicious: true, reasons: ['fee'] })).toBe('Flagged suspicious · fee');
    expect(describeFactValue('ai_summary', { summary: 'Short.' })).toBe('Short.');
    expect(describeFactValue('closing_date', '2026-10-15')).toMatch(/2026/);
    expect(describeFactValue('salary', null)).toBe('Not set');
    expect(describeFactValue('mystery', { a: 1 })).toBe('{"a":1}');
    expect(describeFactValue('visa_status', { status: 'bogus' })).toBe('{"status":"bogus"}');
  });

  it('says the role once when the key reads like the title', () => {
    const same = describeFactValue('role', { roleKey: 'cloud_security_engineer', roleFamily: 'primary', canonicalTitle: 'Cloud Security Engineer' });
    expect(same.match(/cloud security engineer/gi)).toHaveLength(1);
    const differs = describeFactValue('role', { roleKey: 'security_engineer', roleFamily: 'primary', canonicalTitle: 'Principal Security Engineer' });
    expect(differs).toMatch(/^Principal Security Engineer · Security engineer · /);
  });

  it('labels keys and trims evidence', () => {
    expect(factLabel('visa_signal')).toBe('Visa signal');
    expect(factLabel('red_flags')).toBe('Red flags');
    expect(factLabel('some_key')).toBe('Some key');
    expect(evidenceOf('   ')).toBeNull();
    expect(evidenceOf('  quoted  ')).toBe('quoted');
  });
});

describe('visa helpers', () => {
  it('parses decisions with reasons and sides', () => {
    expect(visaDecisionOf('confirmed')).toEqual({ status: 'confirmed', reasons: [], sides: null });
    expect(visaDecisionOf({ status: 'conflicting', reasons: ['a', 3, ''], sides: { for: ['x'], against: [] } })).toEqual({
      status: 'conflicting',
      reasons: ['a'],
      sides: { for: ['x'], against: [] },
    });
    expect(visaDecisionOf({ status: 'likely', sides: { for: [], against: [] } }).sides).toBeNull();
    expect(visaDecisionOf(42)).toEqual({ status: null, reasons: [], sides: null });
  });

  it('parses signals and falls back for unknown kinds', () => {
    expect(visaSignalOf({ signal: 'offered', quote: 'We sponsor visas', lang: 'en', ruleId: 'en.offered.1' })).toMatchObject({ label: 'Sponsorship offered', tone: 'radar', quote: 'We sponsor visas' });
    expect(visaSignalOf({ signal: 'odd_kind' })).toMatchObject({ label: 'odd kind', tone: 'concrete', quote: null });
    expect(visaSignalOf('offered')).toBeNull();
  });

  it('words the eligibility margin', () => {
    expect(marginText(12.34)).toBe('12.3% above the threshold');
    expect(marginText(-4)).toBe('4% below the threshold');
    expect(marginText(0.01)).toBe('Right at the threshold');
    expect(marginText(null)).toBeNull();
    expect(marginText(Number.NaN)).toBeNull();
  });
});

describe('fitBars', () => {
  const c = (key: string, raw: number, weight: number, contribution: number): ScoreComponent => ({ key, label: key, raw, weight, contribution, confidence: 'high', reason: '' });

  it('turns relative weights into point shares and clamps the fill', () => {
    const bars = fitBars([c('visa', 1, 30, 30), c('salary', 0.5, 10, 5), c('role', 1.4, 10, 10)]);
    expect(bars.map((b) => b.maxPoints)).toEqual([60, 20, 20]);
    expect(bars.map((b) => b.fill)).toEqual([1, 0.5, 1]);
    expect(bars[1].points).toBe(5);
  });

  it('copes with zero / negative weights', () => {
    expect(fitBars([c('a', 0.5, 0, 0)])[0].maxPoints).toBe(0);
    expect(fitBars([c('a', -1, -5, 0), c('b', 0.2, 5, 1)]).map((b) => [b.maxPoints, b.fill])).toEqual([
      [0, 0],
      [100, 0.2],
    ]);
  });
});

describe('ledgerEntries', () => {
  it('orders candidates by trust, marks the winner and who disagrees', () => {
    const facts = [
      fact('visa_status', { status: 'likely' }, { method: 'ai', confidence: 'low' }),
      fact('visa_status', { status: 'not_offered' }, { method: 'posting', confidence: 'high', evidence: 'No sponsorship' }),
      fact('visa_status', { status: 'not_offered' }, { method: 'rule' }),
      fact('salary', { min: 1, max: 2, currency: 'EUR', period: 'year', annualEurMin: 50000, annualEurMax: 60000, kind: 'estimated' }, { method: 'estimate' }),
      fact('ai_summary', 'Summary'),
    ];
    const entries = ledgerEntries(resolveJobFacts(facts, []), { skip: ['ai_summary'] });
    expect(entries.map((e) => e.key)).toEqual(['visa_status', 'salary']);
    const visa = entries[0];
    expect(visa.winnerText).toBe('Not offered');
    expect(visa.candidates.map((c) => [c.fact.method, c.role, c.rank])).toEqual([
      ['posting', 'winner', 1],
      ['rule', 'agrees', 2],
      ['ai', 'disagrees', 3],
    ]);
    expect(visa.conflict).toBe(true);
    expect(visa.disagreeing).toBe(1);
  });

  it('shows a manual override as the winner without a conflict', () => {
    const facts = [fact('remote', { class: 'worldwide', regions: [] }, { method: 'posting' })];
    const overrides = [{ id: 9, field: 'remote', valueJson: { class: 'regional', regions: ['EU'] }, reason: 'EU only per recruiter', createdAt: new Date('2026-09-21T00:00:00Z'), active: true }];
    const [remote] = ledgerEntries(resolveJobFacts(facts, overrides));
    expect(remote.overridden).toBe(true);
    expect(remote.conflict).toBe(false);
    expect(remote.candidates[0]).toMatchObject({ manual: true, role: 'winner' });
    expect(remote.candidates[1].role).toBe('disagrees');
  });

  it('summarises multi-valued keys instead of picking one', () => {
    const facts = [fact('visa_signal', { signal: 'offered', quote: 'We sponsor' }), fact('visa_signal', { signal: 'relocation', quote: 'Relocation package' })];
    const [sig] = ledgerEntries(resolveJobFacts(facts, []));
    expect(sig.multi).toBe(true);
    expect(sig.winnerText).toBe('2 signals');
    expect(sig.conflict).toBe(false);
  });
});

describe('historyItems / linkCheckText', () => {
  it('merges changes, overrides and corrections newest first', () => {
    const items = historyItems({
      changes: [{ id: 1, field: 'title', oldValue: 'A', newValue: null, changedAt: new Date('2026-09-01T00:00:00Z') }],
      overrides: [{ id: 2, field: 'salary', valueJson: { currency: 'EUR', period: 'year', annualEurMin: 70000, annualEurMax: null, kind: 'stated' }, reason: 'Recruiter call', createdAt: new Date('2026-09-10T00:00:00Z'), active: false }],
      corrections: [{ id: 3, field: 'visa_status', note: null, createdAt: new Date('2026-09-05T00:00:00Z'), addedToGolden: true }],
    });
    expect(items.map((i) => i.kind)).toEqual(['override_removed', 'correction', 'change']);
    expect(items[2].body).toBe('A → empty');
    expect(items[0].title).toContain('no longer active');
    expect(items[0].body).toContain('Recruiter call');
    expect(items[1].title).toContain('golden sample');
  });

  it('gives a removed override its own line with the reason; a replaced one gets none', () => {
    const at = (iso: string) => new Date(iso);
    const ov = (id: number, active: boolean, createdAt: string) => ({ id, field: 'visa_status', valueJson: { status: 'confirmed', reasons: [] }, reason: `why ${id}`, createdAt: at(createdAt), active });
    const items = historyItems({
      changes: [],
      corrections: [],
      overrides: [ov(3, true, '2026-09-20T00:00:00Z'), ov(2, false, '2026-09-12T00:00:00Z'), ov(1, false, '2026-09-10T00:00:00Z')],
      // #1 was replaced by #2 (no clear event); #2 was removed 2026-09-15.
      overrideEnds: [
        { overrideId: 1, at: at('2026-09-12T00:00:00Z') },
        { overrideId: 2, at: at('2026-09-15T08:00:00.120Z') },
      ],
      overrideClears: [
        { field: 'salary', at: at('2026-09-15T08:00:00.100Z'), reason: 'other field' },
        { field: 'visa_status', at: at('2026-09-15T08:00:00.100Z'), reason: 'Email was about another team' },
      ],
    });
    expect(items.map((i) => [i.id, i.kind])).toEqual([
      ['o3', 'override'],
      ['x2', 'override_removed'],
      ['o2', 'override'],
      ['o1', 'override'],
    ]);
    expect(items[1]).toMatchObject({ title: 'Visa status override removed', body: '“Email was about another team”' });
    expect(items.some((i) => i.title.includes('no longer active'))).toBe(false);
  });

  it('describes link checks', () => {
    expect(linkCheckText({ ok: true, statusCode: 200, error: null, durationMs: 1234 })).toBe('HTTP 200 · 1,234 ms');
    expect(linkCheckText({ ok: false, statusCode: null, error: 'timeout', durationMs: null })).toBe('No response · timeout');
  });
});

describe('lingeringColumnOverride', () => {
  const at = (iso: string) => new Date(iso);
  const ov = (id: number, valueJson: unknown, active: boolean, createdAt: string) => ({ id, field: 'city', valueJson, reason: 'r', createdAt: at(createdAt), active });

  it('flags a removed override whose value is still on the row', () => {
    const removed = ov(2, 'Berlin-Mitte', false, '2026-09-29T10:00:00Z');
    expect(lingeringColumnOverride([removed], 'city', 'Berlin-Mitte')).toBe(removed);
    expect(lingeringColumnOverride([removed], 'city', ' Berlin-Mitte ')).toBe(removed);
  });

  it('ignores it once the posting value is back, or when a newer override is active', () => {
    expect(lingeringColumnOverride([ov(2, 'Berlin-Mitte', false, '2026-09-29T10:00:00Z')], 'city', 'Berlin')).toBeNull();
    const list = [ov(3, 'Berlin-Mitte', true, '2026-09-30T10:00:00Z'), ov(2, 'Berlin-Mitte', false, '2026-09-29T10:00:00Z')];
    expect(lingeringColumnOverride(list, 'city', 'Berlin-Mitte')).toBeNull();
  });

  it('only looks at the same field and never matches empty values', () => {
    expect(lingeringColumnOverride([ov(2, 'Berlin-Mitte', false, '2026-09-29T10:00:00Z')], 'title', 'Berlin-Mitte')).toBeNull();
    expect(lingeringColumnOverride([ov(2, null, false, '2026-09-29T10:00:00Z')], 'city', null)).toBeNull();
    expect(lingeringColumnOverride([], 'city', 'Berlin')).toBeNull();
  });
});
