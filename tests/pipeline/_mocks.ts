/**
 * Deterministic replacements for the enrichment modules other lanes own (scoring, remote, visa,
 * AI queue). Pipeline DB tests mock them so the results do not change when those lanes land their
 * real logic, and so "same input → same output" can be asserted exactly.
 *
 *   vi.mock('@/lib/scoring/score', async (orig) => (await import('./_mocks')).scoringModule(await orig()));
 */
import type { EligibilityValue, LocationResult, RemoteValue, ScoreResult, ScoringInput, VisaDecisionValue, VisaSignal } from '../../src/lib/contracts/jobs';
import type { Fact } from '../../src/lib/contracts/provenance';

export const mockState = {
  /** Added to every score (simulates new weights / a new scorer). */
  scoreBias: 0,
  scoreVersion: 'score-test-1',
  aiCalls: [] as { jobId: number; task: string; priority: number }[],
};

export const FIXED_CHECKED_AT = new Date('2026-09-29T00:00:00Z');

const FAMILY_POINTS: Record<string, number> = { primary: 70, secondary: 50, fallback: 30, other: 5 };

export function testScoreJob(input: ScoringInput): ScoreResult {
  const base = FAMILY_POINTS[input.role.roleFamily] ?? 0;
  const score = Math.max(0, Math.min(100, base + mockState.scoreBias));
  return {
    score,
    version: mockState.scoreVersion,
    components: [{ key: 'role', label: 'Role', raw: base / 100, weight: 1, contribution: score, confidence: input.role.confidence, reason: `family ${input.role.roleFamily}` }],
  };
}

export function scoringModule<T extends object>(orig: T): T {
  return { ...orig, SCORE_VERSION: mockState.scoreVersion, scoreJob: testScoreJob };
}

export function remoteModule<T extends object>(orig: T): T {
  return {
    ...orig,
    REMOTE_LOGIC_VERSION: 'remote-test-1',
    classifyRemote: (text: string, loc: LocationResult): Fact<RemoteValue> => ({
      value: loc.workplaceType === 'remote' ? { class: 'unclear', regions: [] } : { class: 'not_remote', regions: [] },
      evidence: null,
      source: 'posting text',
      method: 'rule',
      confidence: 'low',
      checkedAt: FIXED_CHECKED_AT,
      logicVersion: 'remote-test-1',
    }),
  };
}

export function visaSignalsModule<T extends object>(orig: T): T {
  return {
    ...orig,
    VISA_SIGNALS_LOGIC_VERSION: 'visa-signals-test-1',
    detectVisaSignals: (text: string): VisaSignal[] =>
      /relocation support/i.test(text) ? [{ signal: 'relocation', quote: 'relocation support', lang: 'en', ruleId: 'test-relocation', confidence: 'medium' } as VisaSignal] : [],
  };
}

export function visaDecideModule<T extends object>(orig: T): T {
  return {
    ...orig,
    VISA_DECIDE_LOGIC_VERSION: 'visa-decide-test-1',
    decideVisaStatus: (input: { postingSignals: VisaSignal[] }): Fact<VisaDecisionValue> => ({
      value: { status: 'unknown', reasons: [`${input.postingSignals.length} posting signals`] },
      evidence: null,
      source: 'visa engine',
      method: 'rule',
      confidence: 'low',
      checkedAt: FIXED_CHECKED_AT,
      logicVersion: 'visa-decide-test-1',
    }),
  };
}

export function eligibilityModule<T extends object>(orig: T): T {
  return {
    ...orig,
    ELIGIBILITY_LOGIC_VERSION: 'eligibility-test-1',
    checkEligibility: (input: { now: Date }): Fact<EligibilityValue> => ({
      value: { result: 'cant_tell', reason: 'test', marginPct: null, ruleVerifiedAt: null },
      evidence: null,
      source: 'eligibility check',
      method: 'rule',
      confidence: 'low',
      checkedAt: input.now,
      logicVersion: 'eligibility-test-1',
    }),
  };
}

export function aiQueueModule<T extends object>(orig: T): T {
  return {
    ...orig,
    enqueueAi: async (_db: unknown, jobId: number, task: string, priority: number) => {
      mockState.aiCalls.push({ jobId, task, priority });
      return { queueId: mockState.aiCalls.length, created: true };
    },
    runAiQueue: async () => {
      throw new Error('the pipeline must never run the AI queue');
    },
  };
}
