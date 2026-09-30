/**
 * Review-queue housekeeping (src/lib/dedup/tidy.ts): same-source pairs are cleared, cross-source
 * pairs are left for a human, and everything is idempotent.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, duplicateCandidates, jobSources, jobs } from '@/db/schema';
import { dismissSameSourcePairs, mergeExactTwins, tidyCounts, tidyDuplicateQueue } from '@/lib/dedup/tidy';
import { sha256Hex } from '@/lib/hash';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCompany, seedCountry, seedSource } from '../helpers/fixtures';

let t: TestDb;
let seq = 0;

beforeAll(async () => {
  t = await startTestDb();
}, 240_000);

afterAll(async () => {
  await t?.stop();
});

beforeEach(async () => {
  await t.truncateAll();
});

const TEXT = 'We are hiring a cloud security engineer to secure our platform and pipelines.';

async function world() {
  await seedCountry(t.db, 'DE');
  return { company: await seedCompany(t.db, 'Acme Cloud'), s1: await seedSource(t.db), s2: await seedSource(t.db) };
}

async function mkJob(companyId: number, over: { title?: string; city?: string | null; text?: string; firstSeenAt?: Date } = {}): Promise<number> {
  const title = over.title ?? 'Cloud Security Engineer';
  const text = over.text ?? TEXT;
  const url = `https://boards.example.test/jobs/${++seq}`;
  const [res] = await t.db.insert(jobs).values({
    companyId,
    canonicalTitle: title,
    titleRaw: title,
    countryIso2: 'DE',
    city: over.city === undefined ? 'Berlin' : over.city,
    locationRaw: over.city ?? '',
    descriptionText: text,
    descriptionHash: sha256Hex(text),
    applyUrl: url,
    applyUrlClean: url,
    applyUrlHash: sha256Hex(url),
    firstSeenAt: over.firstSeenAt ?? new Date(Date.now() - (1000 - seq) * 1000),
  });
  return Number(res.insertId);
}

async function link(jobId: number, sourceId: number): Promise<void> {
  await t.db.insert(jobSources).values({ jobId, sourceId, externalId: `ext-${++seq}`, url: `https://boards.example.test/l/${seq}`, grade: 'A', firstSeenAt: new Date(), lastSeenAt: new Date() });
}

async function pair(a: number, b: number, status: 'open' | 'dismissed' = 'open'): Promise<number> {
  const [res] = await t.db.insert(duplicateCandidates).values({ jobA: Math.min(a, b), jobB: Math.max(a, b), score: 0.9, reasonsJson: ['same company'], status });
  return Number(res.insertId);
}

const statusOf = async (id: number) => (await t.db.select({ s: duplicateCandidates.status }).from(duplicateCandidates).where(eq(duplicateCandidates.id, id)))[0]?.s;

/** twin (merge), multi-city, other title (both keep-both), cross-source (human), merged side, already decided. */
async function scenario() {
  const { company, s1, s2 } = await world();
  const twinA = await mkJob(company);
  const twinB = await mkJob(company);
  const cityA = await mkJob(company, { title: 'Platform Engineer', city: 'Berlin' });
  const cityB = await mkJob(company, { title: 'Platform Engineer', city: 'Munich' });
  const titleA = await mkJob(company, { title: 'Security Analyst', text: `${TEXT} Analyst.` });
  const titleB = await mkJob(company, { title: 'Security Engineer', text: `${TEXT} Engineer.` });
  const crossA = await mkJob(company, { title: 'SRE' });
  const crossB = await mkJob(company, { title: 'SRE' });
  const mergedA = await mkJob(company, { title: 'Data Engineer' });
  const mergedB = await mkJob(company, { title: 'Data Engineer' });
  const decA = await mkJob(company, { title: 'QA Engineer' });
  const decB = await mkJob(company, { title: 'QA Engineer' });
  for (const j of [twinA, twinB, cityA, cityB, titleA, titleB, crossA, mergedA, mergedB, decA, decB]) await link(j, s1);
  await link(crossB, s2);
  await t.db.update(jobs).set({ mergedIntoJobId: mergedA }).where(eq(jobs.id, mergedB));
  return {
    twin: await pair(twinA, twinB),
    city: await pair(cityA, cityB),
    title: await pair(titleA, titleB),
    cross: await pair(crossA, crossB),
    merged: await pair(mergedA, mergedB),
    decided: await pair(decA, decB, 'dismissed'),
    twinA,
    twinB,
  };
}

describe('review queue tidy', () => {
  it('counts twins, keep-both pairs and pairs that need a human — merged sides and decided pairs excluded', async () => {
    await scenario();
    expect(await tidyCounts(t.db)).toEqual({ twins: 1, keepBoth: 2, needHuman: 1 });
  });

  it('keeps both for same-source pairs that are not twins, with one audit row, and leaves the rest alone', async () => {
    const s = await scenario();
    expect(await dismissSameSourcePairs(t.db)).toEqual({ dismissed: 2 });
    expect(await statusOf(s.city)).toBe('dismissed');
    expect(await statusOf(s.title)).toBe('dismissed');
    expect(await statusOf(s.twin)).toBe('open');
    expect(await statusOf(s.cross)).toBe('open');
    expect(await statusOf(s.merged)).toBe('open');
    const [row] = await t.db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, s.city));
    expect(row.decidedReason).toMatch(/Same source lists both/);
    expect(row.decidedAt).not.toBeNull();
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, 'duplicate.bulk_keep_both'));
    expect(audits).toHaveLength(1);
    expect(audits[0].afterJson).toEqual({ dismissed: 2 });
    // Idempotent: nothing left to do, no second audit row.
    expect(await dismissSameSourcePairs(t.db)).toEqual({ dismissed: 0 });
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'duplicate.bulk_keep_both'))).toHaveLength(1);
  });

  it('merges exact twins, keeping the older job, and reports what is left', async () => {
    const s = await scenario();
    expect(await mergeExactTwins(t.db, { limit: 5 })).toEqual({ merged: 1, failed: 0, remaining: 0 });
    expect(await statusOf(s.twin)).toBe('merged');
    const [dropped] = await t.db.select({ into: jobs.mergedIntoJobId }).from(jobs).where(eq(jobs.id, s.twinB));
    expect(dropped.into).toBe(s.twinA);
    // both links now hang on the kept job
    const links = await t.db.select({ id: jobSources.id }).from(jobSources).where(eq(jobSources.jobId, s.twinA));
    expect(links).toHaveLength(2);
    expect(await mergeExactTwins(t.db)).toEqual({ merged: 0, failed: 0, remaining: 0 });
  });

  it('the nightly pass does both and leaves only the cross-source pair', async () => {
    const s = await scenario();
    expect(await tidyDuplicateQueue(t.db)).toEqual({ merged: 1, dismissed: 2, failed: 0, needHuman: 1 });
    expect(await statusOf(s.cross)).toBe('open');
    expect(await tidyCounts(t.db)).toEqual({ twins: 0, keepBoth: 0, needHuman: 1 });
  });
});
