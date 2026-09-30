/**
 * Visa decision matrix (spec §13.4): Confirmed is hard to earn, a posting refusal wins over
 * everything except my own note, AI alone never confirms.
 */
import { describe, expect, it } from 'vitest';
import type { VisaSignal } from '../../src/lib/contracts/jobs';
import type { Confidence } from '../../src/lib/contracts/provenance';
import { decideVisaStatus, VISA_DECIDE_LOGIC_VERSION, VISA_ENGINE_SOURCE, type DecideVisaInput, type EvidenceLike } from '../../src/lib/visa/decide';
import { detectVisaSignals } from '../../src/lib/visa/signals';
import type { RegisterMatchValue } from '../../src/lib/visa/types';

const NOW = new Date('2026-09-30T08:00:00Z');

function sig(signal: VisaSignal['signal'], quote: string, confidence: Confidence = 'high'): VisaSignal {
  return { signal, quote, lang: 'en', ruleId: 'test', confidence };
}

function register(over: Partial<RegisterMatchValue> = {}, row: Partial<EvidenceLike> = {}): EvidenceLike {
  const value: RegisterMatchValue = {
    registerKey: 'uk_home_office',
    registerName: 'UK Home Office register of licensed sponsors',
    countryIso2: 'GB',
    orgName: 'Acme Ltd',
    town: 'London',
    route: 'Skilled Worker',
    rating: 'Worker (A rating)',
    registerVersion: '2026-09-29',
    evidenceKind: 'licensed_sponsor',
    matchType: 'exact',
    similarity: 1,
    ...over,
  };
  return {
    kind: 'register_match',
    valueJson: value,
    evidence: 'Acme Ltd, London, Skilled Worker',
    source: `${value.registerKey}@${value.registerVersion}`,
    method: 'official',
    confidence: 'high',
    matchStatus: 'confirmed',
    checkedAt: NOW,
    ...row,
  };
}

function manualRow(sponsors: boolean, note: string, at: Date): EvidenceLike {
  return {
    kind: 'manual_note',
    valueJson: { sponsors, note },
    evidence: note,
    source: 'my note',
    method: 'manual',
    confidence: 'high',
    matchStatus: 'confirmed',
    checkedAt: at,
  };
}

function decide(over: Partial<DecideVisaInput> = {}) {
  return decideVisaStatus({ postingSignals: [], companyEvidence: [], manualNotes: [], aiSignals: [], countryIso2: 'GB', now: NOW, ...over });
}

describe('decideVisaStatus: fact shape', () => {
  it('always returns a valid provenance fact', () => {
    const f = decide();
    expect(f.source).toBe(VISA_ENGINE_SOURCE);
    expect(f.logicVersion).toBe(VISA_DECIDE_LOGIC_VERSION);
    expect(f.logicVersion).toMatch(/^visa-decide@\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(f.checkedAt).toEqual(NOW);
    expect(f.value.reasons.length).toBeGreaterThan(0);
  });

  it('works with the original stub input shape (no country / clock)', () => {
    const f = decideVisaStatus({ postingSignals: [sig('offered', 'Visa sponsorship available.')], companyEvidence: [], manualNotes: [], aiSignals: [] });
    expect(f.value.status).toBe('confirmed');
    expect(f.checkedAt).toBeInstanceOf(Date);
  });
});

describe('decideVisaStatus: matrix', () => {
  it('nothing → unknown (low, rule)', () => {
    const f = decide();
    expect(f.value.status).toBe('unknown');
    expect(f.confidence).toBe('low');
    expect(f.method).toBe('rule');
  });

  it('explicit posting offer → confirmed (posting)', () => {
    const f = decide({ postingSignals: [sig('offered', 'Visa sponsorship available.')] });
    expect(f.value.status).toBe('confirmed');
    expect(f.method).toBe('posting');
    expect(f.confidence).toBe('high');
    expect(f.evidence).toContain('Visa sponsorship available.');
  });

  it('hedged posting offer → likely (low), never confirmed', () => {
    const f = decide({ postingSignals: [sig('offered', 'Sponsorship may be available.', 'low')] });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('low');
  });

  it('posting refusal → not_offered', () => {
    const f = decide({ postingSignals: [sig('not_offered', 'No visa sponsorship.')] });
    expect(f.value.status).toBe('not_offered');
    expect(f.method).toBe('posting');
    expect(f.confidence).toBe('high');
  });

  it('right-to-work requirement → not_offered, one step less confident', () => {
    const f = decide({ postingSignals: [sig('right_to_work_required', 'Must have the right to work in the UK.', 'high')] });
    expect(f.value.status).toBe('not_offered');
    expect(f.confidence).toBe('medium');
  });

  it('posting refusal overrides a confirmed register match, and says so', () => {
    const f = decide({ postingSignals: [sig('not_offered', 'We do not sponsor visas.')], companyEvidence: [register()] });
    expect(f.value.status).toBe('not_offered');
    expect(f.value.reasons.some((r) => r.startsWith('Overridden by the posting') && r.includes('Acme Ltd'))).toBe(true);
  });

  it('posting refusal overrides relocation support and AI', () => {
    const f = decide({
      postingSignals: [sig('relocation', 'Relocation package included.'), sig('not_offered', 'No visa sponsorship.')],
      aiSignals: [sig('offered', 'visa support')],
    });
    expect(f.value.status).toBe('not_offered');
    expect(f.value.reasons.filter((r) => r.startsWith('Overridden by the posting')).length).toBe(2);
  });

  it('offer + refusal in the same posting → conflicting with both sides', () => {
    const f = decide({
      postingSignals: [sig('offered', 'We are a licensed sponsor.'), sig('not_offered', 'Unfortunately we cannot sponsor visas.')],
    });
    expect(f.value.status).toBe('conflicting');
    expect(f.value.sides?.for).toHaveLength(1);
    expect(f.value.sides?.against).toHaveLength(1);
    expect(f.value.sides?.for[0]).toContain('licensed sponsor');
    expect(f.value.sides?.against[0]).toContain('cannot sponsor');
    expect(f.confidence).toBe('medium');
  });

  it('hedged offer + refusal → conflicting (low)', () => {
    const f = decide({ postingSignals: [sig('offered', 'Sponsorship may be possible.', 'low'), sig('not_offered', 'No sponsorship.')] });
    expect(f.value.status).toBe('conflicting');
    expect(f.confidence).toBe('low');
  });

  it('application-form question alone stays unknown', () => {
    const f = decide({ postingSignals: [sig('right_to_work_required', 'Will you now or in the future require sponsorship?', 'low')] });
    expect(f.value.status).toBe('unknown');
    expect(f.value.reasons.join(' ')).toContain('Application form');
  });

  it('form question does not turn an offer into a conflict', () => {
    const f = decide({
      postingSignals: [sig('offered', 'Visa sponsorship available.'), sig('right_to_work_required', 'Do you require sponsorship?', 'low')],
    });
    expect(f.value.status).toBe('confirmed');
  });
});

describe('decideVisaStatus: registers', () => {
  it('official licensed-sponsor register, confirmed match, same country → confirmed (official)', () => {
    const f = decide({ companyEvidence: [register()] });
    expect(f.value.status).toBe('confirmed');
    expect(f.method).toBe('official');
    expect(f.confidence).toBe('high');
    expect(f.evidence).toContain('UK Home Office');
  });

  it('register country must agree with the job country', () => {
    const f = decide({ companyEvidence: [register()], countryIso2: 'DE' });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('low');
    expect(f.value.reasons[0]).toContain('Sponsors in GB');
  });

  it('no job country → register match is only likely', () => {
    const f = decide({ companyEvidence: [register()], countryIso2: null });
    expect(f.value.status).toBe('likely');
  });

  it('possible register match → likely (low) with "verify"', () => {
    const f = decide({ companyEvidence: [register({ matchType: 'similar', similarity: 0.93 }, { matchStatus: 'possible', confidence: 'medium' })] });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('low');
    expect(f.value.reasons[0]).toMatch(/^Possible register match — verify/);
  });

  it('rejected register match is ignored', () => {
    const f = decide({ companyEvidence: [register({}, { matchStatus: 'rejected' })] });
    expect(f.value.status).toBe('unknown');
  });

  it('non-official method on a register row cannot confirm', () => {
    const f = decide({ companyEvidence: [register({}, { method: 'ai' })] });
    expect(f.value.status).toBe('likely');
  });

  it('sponsorship-history register (IE/CA) → likely (medium)', () => {
    const f = decide({
      countryIso2: 'IE',
      companyEvidence: [register({ registerKey: 'ie_dete', registerName: 'Ireland DETE permits', countryIso2: 'IE', evidenceKind: 'sponsorship_history' })],
    });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('medium');
    expect(f.method).toBe('official');
  });

  it('stale register snapshot lowers confidence', () => {
    const f = decide({ companyEvidence: [register({ registerVersion: '2026-06-01' })] });
    expect(f.value.status).toBe('confirmed');
    expect(f.confidence).toBe('medium');
    expect(f.value.reasons.join(' ')).toContain('older than');
  });

  it('posting offer + register → confirmed with both reasons', () => {
    const f = decide({ postingSignals: [sig('offered', 'We sponsor visas.')], companyEvidence: [register()] });
    expect(f.value.status).toBe('confirmed');
    expect(f.method).toBe('posting');
    expect(f.value.reasons.some((r) => r.includes('Official register'))).toBe(true);
  });

  it('conflicting posting keeps the register on the "for" side', () => {
    const f = decide({
      postingSignals: [sig('offered', 'We sponsor visas.'), sig('not_offered', 'No sponsorship for this role.')],
      companyEvidence: [register()],
    });
    expect(f.value.status).toBe('conflicting');
    expect(f.value.sides?.for.some((s) => s.includes('Official register'))).toBe(true);
  });
});

describe('decideVisaStatus: likely factors', () => {
  it('relocation mention → likely', () => {
    const f = decide({ postingSignals: [sig('relocation', 'Relocation package included.')] });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('medium');
    expect(f.method).toBe('posting');
  });

  it('posting history of the company → likely', () => {
    const f = decide({
      companyEvidence: [
        {
          kind: 'posting_history',
          valueJson: { sponsors: true, jobId: 12, quote: 'We sponsor visas.' },
          evidence: 'We sponsor visas.',
          source: 'job 12',
          method: 'posting',
          confidence: 'high',
          matchStatus: 'confirmed',
          checkedAt: NOW,
        },
      ],
    });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('medium');
  });
});

describe('decideVisaStatus: AI never decides alone', () => {
  it('AI offered only → likely (low, ai)', () => {
    const f = decide({ aiSignals: [sig('offered', 'visa support available', 'high')] });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('low');
    expect(f.method).toBe('ai');
  });

  it('AI not_offered only → unknown with a note', () => {
    const f = decide({ aiSignals: [sig('not_offered', 'no sponsorship', 'high')] });
    expect(f.value.status).toBe('unknown');
    expect(f.method).toBe('ai');
    expect(f.value.reasons.join(' ')).toContain('not used on its own');
  });

  it('AI company evidence row alone never confirms', () => {
    const f = decide({
      companyEvidence: [
        { kind: 'ai', valueJson: { sponsors: true, note: 'seen on careers page' }, evidence: null, source: 'ai', method: 'ai', confidence: 'high', matchStatus: 'confirmed', checkedAt: NOW },
      ],
    });
    expect(f.value.status).toBe('likely');
    expect(f.confidence).toBe('low');
  });

  it('AI refusal does not override a posting offer', () => {
    const f = decide({ postingSignals: [sig('offered', 'We sponsor visas.')], aiSignals: [sig('not_offered', 'no sponsorship')] });
    expect(f.value.status).toBe('confirmed');
  });

  it('no AI signal combination can reach confirmed', () => {
    const kinds: VisaSignal['signal'][] = ['offered', 'not_offered', 'relocation', 'right_to_work_required'];
    const confs: Confidence[] = ['high', 'medium', 'low'];
    for (const k of kinds) for (const c of confs) for (const k2 of kinds) {
      const f = decide({ aiSignals: [sig(k, 'a', c), sig(k2, 'b', c)] });
      expect(f.value.status).not.toBe('confirmed');
      expect(f.value.status).not.toBe('not_offered');
    }
  });
});

describe('decideVisaStatus: my notes', () => {
  it('my yes note beats a posting refusal', () => {
    const f = decide({
      postingSignals: [sig('not_offered', 'No visa sponsorship.')],
      manualNotes: [{ sponsors: true, note: 'Recruiter said they sponsor for this team', at: new Date('2026-09-20T00:00:00Z') }],
    });
    expect(f.value.status).toBe('confirmed');
    expect(f.method).toBe('manual');
    expect(f.confidence).toBe('high');
    expect(f.value.reasons[0]).toContain('My note (2026-09-20)');
    expect(f.value.reasons.some((r) => r.startsWith('Overrides the posting'))).toBe(true);
  });

  it('my no note beats a confirmed register', () => {
    const f = decide({ companyEvidence: [register(), manualRow(false, 'HR: no sponsorship this year', new Date('2026-09-01T00:00:00Z'))] });
    expect(f.value.status).toBe('not_offered');
    expect(f.method).toBe('manual');
  });

  it('the latest note wins and the earlier one is listed', () => {
    const f = decide({
      manualNotes: [
        { sponsors: false, note: 'first call', at: new Date('2026-08-01T00:00:00Z') },
        { sponsors: true, note: 'second call', at: new Date('2026-09-10T00:00:00Z') },
      ],
    });
    expect(f.value.status).toBe('confirmed');
    expect(f.value.reasons.some((r) => r.includes('Earlier note (2026-08-01)'))).toBe(true);
  });
});

describe('decideVisaStatus: end to end with detected signals', () => {
  const cases: [string, string][] = [
    ['We offer visa sponsorship and a relocation package.', 'confirmed'],
    ['Unfortunately we are unable to sponsor at this time.', 'not_offered'],
    ['Relocation package included.\nUnfortunately we cannot sponsor visas.\nWe are a licensed sponsor.', 'conflicting'],
    ['Visa sponsorship may be available for exceptional candidates.', 'likely'],
    ['Will you now or in the future require sponsorship?', 'unknown'],
    ['We are a fast-growing fintech.', 'unknown'],
    ['Candidates must already have the right to work in the UK.', 'not_offered'],
  ];
  it.each(cases)('%s → %s', (text, status) => {
    expect(decide({ postingSignals: detectVisaSignals(text) }).value.status).toBe(status);
  });
});
