/**
 * Fit Score DB glue: inputs come from RESOLVED facts (overrides win), scores are stored once per
 * change with a single current row, and rescoreAll re-scores from saved facts.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { companies, companyEvidence, jobs, jobScores } from '../../src/db/schema';
import type { Fact, FactKey } from '../../src/lib/contracts/provenance';
import { addFact, setOverride } from '../../src/lib/provenance/store';
import { buildScoringInput, hasSponsorHistory, rescoreAll, rescoreJob, scoreInputFromDb } from '../../src/lib/scoring/from-db';
import { SCORE_VERSION } from '../../src/lib/scoring/score';
import { setSetting } from '../../src/lib/settings';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedJob } from '../helpers/fixtures';

const NOW = new Date('2026-09-30T12:00:00Z');
let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.truncateAll();
});

function fact<T>(value: T, over: Partial<Fact<T>> = {}): Fact<T> {
  return { value, evidence: 'quote', source: 'posting text', method: 'posting', confidence: 'high', checkedAt: NOW, logicVersion: 'test@1', ...over };
}

async function seedScoredJob() {
  const { jobId, companyId } = await seedJob(t.db, { countryIso2: 'DE' });
  await t.db
    .update(jobs)
    .set({ postedAt: new Date(NOW.getTime() - 86_400_000), firstSeenAt: new Date(NOW.getTime() - 86_400_000), lastConfirmedLiveAt: NOW, linkStatus: 'ok' })
    .where(eq(jobs.id, jobId));
  await t.db.update(companies).set({ type: 'scaleup' }).where(eq(companies.id, companyId));
  const add = (key: FactKey, value: unknown, over: Partial<Fact<unknown>> = {}) => addFact(t.db, jobId, key, fact(value, over));
  await add('role', { roleKey: 'cloud_security_engineer', roleFamily: 'primary', canonicalTitle: 'Cloud Security Engineer' }, { method: 'rule' });
  await add('experience', { minYears: 3, maxYears: 5, band: 'core', securityStrict: false });
  await add('visa_status', { status: 'confirmed', reasons: ['Posting offers sponsorship'] }, { source: 'visa engine' });
  await add('salary', {
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
  });
  await add('language', { postingLang: 'en', requirement: 'english_ok', languages: ['en'] }, { method: 'rule' });
  await add('remote', { class: 'not_remote', regions: [] }, { method: 'rule' });
  await add('skills', { matched: ['AWS', 'Terraform'], found: ['AWS', 'Terraform', 'Kubernetes', 'IAM', 'GDPR'] }, { method: 'rule' });
  await add('eligibility', { result: 'meets', reason: 'ok', marginPct: 30, ruleVerifiedAt: null }, { method: 'rule', source: 'eligibility check' });
  return { jobId, companyId };
}

describe('scoreInputFromDb', () => {
  it('reads resolved facts, the job row and company signals', async () => {
    const { jobId, companyId } = await seedScoredJob();
    await t.db.insert(companyEvidence).values({
      companyId,
      kind: 'register_match',
      valueJson: { registerKey: 'uk_home_office', countryIso2: 'GB', orgName: 'Acme Ltd', evidenceKind: 'licensed_sponsor', matchType: 'exact', similarity: 1 },
      source: 'uk_home_office 2026-09-29',
      method: 'official',
      confidence: 'high',
      matchStatus: 'confirmed',
      logicVersion: 'test@1',
    });
    const input = (await scoreInputFromDb(t.db, jobId, NOW))!;
    expect(input.role).toEqual({ roleKey: 'cloud_security_engineer', roleFamily: 'primary', confidence: 'high' });
    expect(input.visa).toEqual({ status: 'confirmed', confidence: 'high' });
    expect(input.salary?.value.annualEurMin).toBe(60_000);
    expect(input.salary?.value.kind).toBe('stated');
    expect(input.remote?.value.class).toBe('not_remote');
    expect(input.skills).toEqual(['AWS', 'Terraform', 'Kubernetes', 'IAM', 'GDPR']);
    expect(input.company).toEqual({ isAgency: false, type: 'scaleup', sponsorHistory: true });
    expect(input.eligibility).toBe('meets');
    expect(input.countryIso2).toBe('DE');
    expect(input.now).toEqual(NOW);
  });

  it('a manual override wins over the engine', async () => {
    const { jobId } = await seedScoredJob();
    await setOverride(t.db, jobId, 'visa_status', { status: 'not_offered', reasons: ['Recruiter said no'] }, 'recruiter call');
    const input = (await scoreInputFromDb(t.db, jobId, NOW))!;
    expect(input.visa).toEqual({ status: 'not_offered', confidence: 'high' });
  });

  it('an estimate salary fact is read as estimated', async () => {
    const { jobId } = await seedJob(t.db, { countryIso2: 'DE' });
    await addFact(t.db, jobId, 'salary', fact({ annualEurMin: 50_000, annualEurMax: 60_000, currency: 'EUR', period: 'year' }, { method: 'estimate', confidence: 'low', source: 'salary estimate' }));
    const input = (await scoreInputFromDb(t.db, jobId, NOW))!;
    expect(input.salary?.value.kind).toBe('estimated');
    expect(input.salary?.confidence).toBe('low');
    expect(input.visa).toBeNull();
    expect(input.role.confidence).toBe('low');
  });

  it('missing job → null', async () => {
    expect(await scoreInputFromDb(t.db, 999_999, NOW)).toBeNull();
  });
});

describe('rescoreJob / rescoreAll', () => {
  it('stores one current score row and mirrors it on the job', async () => {
    const { jobId } = await seedScoredJob();
    const first = (await rescoreJob(t.db, jobId, { now: NOW }))!;
    expect(first.written).toBe(true);
    // Same as the "ideal" pure case minus sponsor history (scaleup, medium confidence): 90.
    expect(first.result.score).toBe(90);
    const [job] = await t.db.select({ score: jobs.score, scoreVersion: jobs.scoreVersion }).from(jobs).where(eq(jobs.id, jobId));
    expect(job).toEqual({ score: 90, scoreVersion: SCORE_VERSION });

    // Same inputs → no new row.
    const again = (await rescoreJob(t.db, jobId, { now: NOW }))!;
    expect(again.written).toBe(false);
    expect(await t.db.select().from(jobScores).where(eq(jobScores.jobId, jobId))).toHaveLength(1);

    // An override changes the score; the old row stays as history.
    await setOverride(t.db, jobId, 'visa_status', { status: 'not_offered', reasons: ['Recruiter said no'] }, 'recruiter call');
    const after = (await rescoreJob(t.db, jobId, { now: NOW }))!;
    expect(after.written).toBe(true);
    expect(after.result.score).toBe(70);
    const rows = await t.db.select().from(jobScores).where(eq(jobScores.jobId, jobId));
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.isCurrent)).toHaveLength(1);
    const [current] = await t.db.select().from(jobScores).where(and(eq(jobScores.jobId, jobId), eq(jobScores.isCurrent, true)));
    expect(current.score).toBe(70);
    expect(Array.isArray(current.componentsJson)).toBe(true);
    expect(current.inputsHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changing weights re-scores from saved facts', async () => {
    const a = await seedScoredJob();
    const b = await seedScoredJob();
    const first = await rescoreAll(t.db, { now: NOW });
    expect(first).toEqual({ scored: 2, written: 2, unchanged: 0, version: SCORE_VERSION });
    expect(await rescoreAll(t.db, { now: NOW })).toMatchObject({ scored: 2, written: 0, unchanged: 2 });

    await setSetting(t.db, 'score_weights', { role: 0, experience: 0, visa: 0, salary: 0, remote: 100, language: 0, freshness: 0, skills: 0, company: 0 });
    const res = await rescoreAll(t.db, { now: NOW });
    expect(res.written).toBe(2);
    const scores = await t.db.select({ id: jobs.id, score: jobs.score }).from(jobs);
    expect(scores.map((s) => s.score)).toEqual([0, 0]);

    const only = await rescoreAll(t.db, { now: NOW, jobIds: [a.jobId, 999_999] });
    expect(only.scored).toBe(1);
    void b;
  });

  it('merged jobs are skipped', async () => {
    const a = await seedScoredJob();
    const b = await seedScoredJob();
    await t.db.update(jobs).set({ mergedIntoJobId: a.jobId }).where(eq(jobs.id, b.jobId));
    expect((await rescoreAll(t.db, { now: NOW, batchSize: 1 })).scored).toBe(1);
  });
});

describe('pure helpers', () => {
  it('hasSponsorHistory', () => {
    expect(hasSponsorHistory([])).toBe(false);
    expect(hasSponsorHistory([{ kind: 'posting_history', valueJson: { sponsors: true }, matchStatus: 'confirmed' }])).toBe(true);
    expect(hasSponsorHistory([{ kind: 'posting_history', valueJson: { sponsors: false }, matchStatus: 'confirmed' }])).toBe(false);
    expect(hasSponsorHistory([{ kind: 'manual_note', valueJson: { sponsors: true }, matchStatus: 'rejected' }])).toBe(false);
    const reg = { registerKey: 'nl_ind', countryIso2: 'NL', orgName: 'Acme B.V.' };
    expect(hasSponsorHistory([{ kind: 'register_match', valueJson: reg, matchStatus: 'possible' }])).toBe(false);
    expect(hasSponsorHistory([{ kind: 'register_match', valueJson: reg, matchStatus: 'confirmed' }])).toBe(true);
    expect(hasSponsorHistory([{ kind: 'ai', valueJson: { sponsors: true }, matchStatus: 'confirmed' }])).toBe(false);
  });

  it('buildScoringInput tolerates malformed fact values', () => {
    const job = {
      countryIso2: 'NL',
      workplaceType: null,
      roleKey: 'node_developer',
      roleFamily: 'fallback' as const,
      postedAt: null,
      firstSeenAt: NOW,
      lastConfirmedLiveAt: null,
      linkStatus: 'unknown' as const,
      ghostRisk: false,
    };
    const bad = { winner: { value: 'garbage', confidence: 'high', method: 'rule' }, conflict: false, others: [], conflictWith: [], overridden: false } as never;
    const input = buildScoringInput(job, { role: bad, experience: bad, visa_status: bad, salary: bad, remote: bad, language: bad, skills: bad }, { isAgency: false, type: 'unknown', sponsorHistory: false }, NOW);
    expect(input.role).toEqual({ roleKey: 'node_developer', roleFamily: 'fallback', confidence: 'low' });
    expect(input.experience).toBeNull();
    expect(input.visa).toBeNull();
    expect(input.salary).toBeNull();
    expect(input.remote).toBeNull();
    expect(input.language).toBeNull();
    expect(input.skills).toEqual([]);
  });

  it('a conflicting visa fact is scored as conflicting', () => {
    const job = {
      countryIso2: 'DE',
      workplaceType: null,
      roleKey: null,
      roleFamily: 'other' as const,
      postedAt: null,
      firstSeenAt: NOW,
      lastConfirmedLiveAt: null,
      linkStatus: 'ok' as const,
      ghostRisk: false,
    };
    const visa = { winner: { value: { status: 'confirmed' }, confidence: 'medium', method: 'posting' }, conflict: true, others: [], conflictWith: [], overridden: false } as never;
    expect(buildScoringInput(job, { visa_status: visa }, { isAgency: false, type: 'unknown', sponsorHistory: false }, NOW).visa).toEqual({ status: 'conflicting', confidence: 'medium' });
  });
});
