/**
 * DB-backed provenance tests: fact storage (supersede/idempotency/multi-valued), trust order
 * through the stored path, manual overrides (fact + column fields, audit, re-apply), and
 * corrections feeding the golden sample.
 */
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, corrections, goldenSamples, jobFacts, jobOverrides, jobs } from '../../src/db/schema';
import type { Fact } from '../../src/lib/contracts/provenance';
import {
  addFact,
  clearOverride,
  getFacts,
  getOverrides,
  loadResolvedFacts,
  ProvenanceError,
  reapplyColumnOverrides,
  recordCorrection,
  retractFacts,
  setOverride,
  syncResolvedJobColumns,
} from '../../src/lib/provenance/store';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry, seedJob } from '../helpers/fixtures';

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
});

afterAll(async () => {
  await t?.stop();
});

beforeEach(async () => {
  await t.truncateAll();
});

function f<T>(value: T, method: Fact<T>['method'], opts: Partial<Fact<T>> = {}): Fact<T> {
  return {
    value,
    evidence: opts.evidence ?? 'quoted from the posting',
    source: opts.source ?? `${method}:test`,
    method,
    confidence: opts.confidence ?? 'high',
    checkedAt: opts.checkedAt ?? new Date('2026-03-01T10:00:00.000Z'),
    logicVersion: opts.logicVersion ?? 'test-1',
  };
}

async function jobRow(jobId: number) {
  const [row] = await t.db.select().from(jobs).where(eq(jobs.id, jobId));
  return row;
}

describe('addFact', () => {
  it('is idempotent for an identical value and refreshes checked_at', async () => {
    const { jobId } = await seedJob(t.db);
    const first = await addFact(t.db, jobId, 'remote', f({ class: 'worldwide', regions: [] }, 'rule'));
    expect(first.created).toBe(true);
    const later = new Date('2026-04-01T00:00:00.000Z');
    const again = await addFact(t.db, jobId, 'remote', f({ class: 'worldwide', regions: [] }, 'rule', { checkedAt: later, confidence: 'medium' }));
    expect(again).toEqual({ id: first.id, created: false, deactivated: [] });
    const rows = await t.db.select().from(jobFacts).where(eq(jobFacts.jobId, jobId));
    expect(rows).toHaveLength(1);
    expect(rows[0].checkedAt.toISOString()).toBe(later.toISOString());
    expect(rows[0].confidence).toBe('medium');
  });

  it('supersedes the same method+source but never touches other sources', async () => {
    const { jobId } = await seedJob(t.db);
    const a = await addFact(t.db, jobId, 'language', f({ requirement: 'unclear' }, 'rule', { source: 'lang-rules' }));
    const other = await addFact(t.db, jobId, 'language', f({ requirement: 'english_ok' }, 'ai', { source: 'openrouter' }));
    const b = await addFact(t.db, jobId, 'language', f({ requirement: 'english_ok' }, 'rule', { source: 'lang-rules' }));
    expect(b.created).toBe(true);
    expect(b.deactivated).toEqual([a.id]);
    const active = await getFacts(t.db, jobId);
    expect(active.map((x) => x.id).sort()).toEqual([other.id, b.id].sort());
    const all = await getFacts(t.db, jobId, { includeInactive: true });
    expect(all).toHaveLength(3);
    expect(all.find((x) => x.id === a.id)?.isActive).toBe(false);
  });

  it('accumulates multi-valued keys and retracts them explicitly', async () => {
    const { jobId } = await seedJob(t.db);
    const s1 = await addFact(t.db, jobId, 'visa_signal', f({ kind: 'sponsorship_offered', quote: 'we sponsor visas' }, 'posting', { source: 'posting' }));
    const s2 = await addFact(t.db, jobId, 'visa_signal', f({ kind: 'relocation', quote: 'relocation package' }, 'posting', { source: 'posting' }));
    expect(s2.deactivated).toEqual([]);
    expect((await getFacts(t.db, jobId, { keys: ['visa_signal'] })).map((x) => x.id).sort()).toEqual([s1.id, s2.id].sort());
    expect(await retractFacts(t.db, jobId, 'visa_signal', { source: 'posting' })).toBe(2);
    expect(await getFacts(t.db, jobId, { keys: ['visa_signal'] })).toHaveLength(0);
    expect(await retractFacts(t.db, jobId, 'visa_signal')).toBe(0);
  });

  it('stores JSON-safe values (Dates become strings) and truncates long evidence', async () => {
    const { jobId } = await seedJob(t.db);
    await addFact(t.db, jobId, 'closing_date', f({ date: new Date('2026-05-01T00:00:00Z') as unknown as string }, 'posting', { evidence: 'x'.repeat(5000) }));
    const [stored] = await getFacts(t.db, jobId);
    expect(stored.value).toEqual({ date: '2026-05-01T00:00:00.000Z' });
    expect(stored.evidence?.length).toBe(4000);
  });

  it('rejects invalid facts', async () => {
    const { jobId } = await seedJob(t.db);
    const bad: [string, Fact<unknown>][] = [
      ['nope', f(1, 'rule')],
      ['remote', { ...f(1, 'rule'), method: 'guess' as never }],
      ['remote', { ...f(1, 'rule'), confidence: 'certain' as never }],
      ['remote', { ...f(1, 'rule'), checkedAt: new Date('invalid') }],
      ['remote', { ...f(1, 'rule'), source: '  ' }],
      ['remote', { ...f(1, 'rule'), logicVersion: '' }],
      ['remote', { ...f(1, 'rule'), value: undefined }],
    ];
    for (const [key, fact] of bad) {
      await expect(addFact(t.db, jobId, key as never, fact)).rejects.toBeInstanceOf(ProvenanceError);
    }
    expect(await getFacts(t.db, jobId, { includeInactive: true })).toHaveLength(0);
  });

  it('AI never beats an official fact through the stored path', async () => {
    const { jobId } = await seedJob(t.db);
    await addFact(t.db, jobId, 'visa_status', f({ status: 'not_offered' }, 'official', { confidence: 'low', checkedAt: new Date('2025-01-01') }));
    await addFact(t.db, jobId, 'visa_status', f({ status: 'confirmed' }, 'ai', { confidence: 'high', checkedAt: new Date('2026-06-01') }));
    const r = await loadResolvedFacts(t.db, jobId);
    expect(r.visa_status?.winner?.method).toBe('official');
    expect(r.visa_status?.conflict).toBe(true);
    await syncResolvedJobColumns(t.db, jobId);
    const row = await jobRow(jobId);
    expect(row.visaStatus).toBe('conflicting');
    expect(row.visaConfidence).toBe('low');
    expect(row.resolvedAt).toBeInstanceOf(Date);
  });
});

describe('overrides', () => {
  it('a fact override wins, syncs the job columns and is audited with its reason', async () => {
    const { jobId } = await seedJob(t.db);
    await addFact(t.db, jobId, 'visa_status', f({ status: 'unknown' }, 'rule', { confidence: 'low' }));
    await syncResolvedJobColumns(t.db, jobId);
    expect((await jobRow(jobId)).visaStatus).toBe('unknown');

    const first = await setOverride(t.db, jobId, 'visa_status', { status: 'confirmed' }, 'Recruiter confirmed by email', { ip: '203.0.113.1' });
    expect(first.previous).toBeNull();
    const r = await loadResolvedFacts(t.db, jobId);
    expect(r.visa_status?.winner).toMatchObject({ method: 'manual', confidence: 'high', evidence: 'Recruiter confirmed by email' });
    expect(r.visa_status?.overridden).toBe(true);
    const row = await jobRow(jobId);
    expect(row.visaStatus).toBe('confirmed');
    expect(row.visaConfidence).toBe('high');

    const second = await setOverride(t.db, jobId, 'visa_status', { status: 'likely' }, 'Actually only likely');
    expect(second.previous).toEqual({ status: 'confirmed' });
    const all = await getOverrides(t.db, jobId, { includeInactive: true });
    expect(all.filter((o) => o.active).map((o) => o.id)).toEqual([second.id]);
    expect((await jobRow(jobId)).visaStatus).toBe('likely');

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.override.set')).orderBy(auditLog.id);
    expect(audits).toHaveLength(2);
    expect(audits[0]).toMatchObject({ entityType: 'job', entityId: String(jobId), reason: 'Recruiter confirmed by email', ip: '203.0.113.1' });
    expect(audits[1].beforeJson).toEqual({ field: 'visa_status', value: { status: 'confirmed' } });
  });

  it('clearing an override falls back to the best fact', async () => {
    const { jobId } = await seedJob(t.db);
    await addFact(t.db, jobId, 'remote', f({ class: 'region_limited', regions: ['EU'] }, 'posting'));
    await setOverride(t.db, jobId, 'remote', { class: 'worldwide', regions: [] }, 'Hiring manager said anywhere');
    expect((await jobRow(jobId)).remoteClass).toBe('worldwide');
    expect(await clearOverride(t.db, jobId, 'remote', 'Was wrong')).toBe(true);
    expect((await jobRow(jobId)).remoteClass).toBe('region_limited');
    expect(await clearOverride(t.db, jobId, 'remote', 'again')).toBe(false);
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.override.clear'));
    expect(a.reason).toBe('Was wrong');
  });

  it('column overrides write the job row, validate input and survive a re-scrape', async () => {
    const { jobId } = await seedJob(t.db, { countryIso2: 'DE', city: 'Berlin' });
    await seedCountry(t.db, 'NL', 'Netherlands');
    await setOverride(t.db, jobId, 'title', '  Senior Cloud Security Engineer ', 'Title was truncated');
    await setOverride(t.db, jobId, 'country', 'NL', 'Office is in Amsterdam');
    await setOverride(t.db, jobId, 'city', 'Amsterdam', 'Office is in Amsterdam');
    await setOverride(t.db, jobId, 'workplace_type', 'hybrid', '2 days office');
    let row = await jobRow(jobId);
    expect(row).toMatchObject({ canonicalTitle: 'Senior Cloud Security Engineer', countryIso2: 'NL', city: 'Amsterdam', workplaceType: 'hybrid' });

    // The pipeline re-normalises the job and overwrites the columns…
    await t.db.update(jobs).set({ canonicalTitle: 'Cloud Security Eng', countryIso2: 'DE', city: 'Berlin', workplaceType: 'onsite' }).where(eq(jobs.id, jobId));
    // …then re-applies the manual fixes.
    expect(await reapplyColumnOverrides(t.db, jobId)).toBe(4);
    row = await jobRow(jobId);
    expect(row).toMatchObject({ canonicalTitle: 'Senior Cloud Security Engineer', countryIso2: 'NL', city: 'Amsterdam', workplaceType: 'hybrid' });
  });

  it('rejects bad overrides without writing anything', async () => {
    const { jobId } = await seedJob(t.db);
    const attempts: [number, string, unknown, string][] = [
      [jobId, 'visa_status', { status: 'confirmed' }, '   '],
      [jobId, 'description', 'x', 'reason'],
      [jobId, 'country', 'de', 'reason'],
      [jobId, 'country', 'ZZ', 'reason'],
      [jobId, 'title', '', 'reason'],
      [jobId, 'title', 'x'.repeat(300), 'reason'],
      [jobId, 'workplace_type', 'moon', 'reason'],
      [jobId, 'city', 42, 'reason'],
      [jobId, 'remote', undefined, 'reason'],
      [jobId + 999, 'remote', { class: 'worldwide' }, 'reason'],
    ];
    for (const [id, field, value, reason] of attempts) {
      await expect(setOverride(t.db, id, field, value, reason)).rejects.toBeInstanceOf(ProvenanceError);
    }
    expect(await t.db.select().from(jobOverrides)).toHaveLength(0);
    expect(await t.db.select().from(auditLog)).toHaveLength(0);
  });
});

describe('recordCorrection', () => {
  it('stores the correction and a golden sample with a self-contained snapshot', async () => {
    const { jobId } = await seedJob(t.db, { title: 'DevSecOps Engineer', companyName: 'Globex', descriptionText: 'EU work permit required.' });
    await addFact(t.db, jobId, 'visa_status', f({ status: 'confirmed' }, 'ai', { confidence: 'medium' }));
    const res = await recordCorrection(t.db, {
      jobId,
      field: 'visa_status',
      wrongValue: { status: 'confirmed' },
      correctValue: 'not_offered',
      note: 'Posting says EU work permit required',
    });
    expect(res.goldenSampleId).not.toBeNull();
    expect(res.overrideId).toBeNull();

    const [c] = await t.db.select().from(corrections).where(eq(corrections.id, res.correctionId));
    expect(c).toMatchObject({ jobId, field: 'visa_status', addedToGolden: true, goldenSampleId: res.goldenSampleId });
    const [g] = await t.db.select().from(goldenSamples).where(eq(goldenSamples.id, res.goldenSampleId!));
    expect(g.origin).toBe('correction');
    expect(g.labelsJson).toEqual({ visa_status: 'not_offered' });
    expect(g.countryIso2).toBe('DE');
    expect(g.sourceKey).toMatch(/^greenhouse:/);
    expect(g.snapshotJson).toMatchObject({
      jobId,
      title: 'DevSecOps Engineer',
      company: 'Globex',
      descriptionText: 'EU work permit required.',
      resolved: { visa_status: { value: { status: 'confirmed' }, method: 'ai' } },
    });
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.correction'));
    expect(a.reason).toBe('Posting says EU work permit required');
  });

  it('can apply the fix as an override and skip the golden sample', async () => {
    const { jobId } = await seedJob(t.db);
    const res = await recordCorrection(t.db, {
      jobId,
      field: 'visa_status',
      correctValue: { status: 'likely' },
      addToGolden: false,
      applyAsOverride: true,
    });
    expect(res.goldenSampleId).toBeNull();
    expect(res.overrideId).not.toBeNull();
    expect((await jobRow(jobId)).visaStatus).toBe('likely');
    const [o] = await t.db.select().from(jobOverrides).where(and(eq(jobOverrides.jobId, jobId), eq(jobOverrides.active, true)));
    expect(o.reason).toBe(`correction #${res.correctionId}`);
    expect(await t.db.select().from(goldenSamples)).toHaveLength(0);
  });

  it('rolls back completely when something fails', async () => {
    const { jobId } = await seedJob(t.db);
    await expect(recordCorrection(t.db, { jobId: jobId + 999, field: 'visa_status', correctValue: 'likely' })).rejects.toThrow();
    await expect(recordCorrection(t.db, { jobId, field: 'visa_status', applyAsOverride: true })).rejects.toThrow();
    await expect(recordCorrection(t.db, { jobId, field: 'description', correctValue: 'x', applyAsOverride: true })).rejects.toThrow();
    // Override validation fails inside the transaction → correction + golden sample are rolled back too.
    await expect(recordCorrection(t.db, { jobId, field: 'country', correctValue: 'ZZ', applyAsOverride: true })).rejects.toThrow();
    expect(await t.db.select().from(corrections)).toHaveLength(0);
    expect(await t.db.select().from(goldenSamples)).toHaveLength(0);
    const audits = await t.db.select().from(auditLog).orderBy(desc(auditLog.id));
    expect(audits).toHaveLength(0);
  });
});
