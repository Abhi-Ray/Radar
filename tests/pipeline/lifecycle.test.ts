/** Lifecycle sweep and single-job transitions against a real (ephemeral) MySQL. */
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { jobChanges, jobs } from '../../src/db/schema';
import { closeJob, reopenJob, sweepLifecycle, type SweepOptions } from '../../src/lib/lifecycle';
import { getSetting } from '../../src/lib/settings';
import { DAY_MS } from '../../src/lib/time';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedJob } from '../helpers/fixtures';

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

const NOW = new Date('2026-09-30T00:45:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);

async function job(set: Partial<typeof jobs.$inferInsert>): Promise<number> {
  const { jobId } = await seedJob(t.db, { withSource: false });
  await t.db.update(jobs).set({ firstSeenAt: ago(1), lastSeenAt: NOW, ...set }).where(eq(jobs.id, jobId));
  return jobId;
}

async function row(id: number) {
  const [r] = await t.db.select().from(jobs).where(eq(jobs.id, id));
  return r;
}

async function changes(id: number) {
  return (await t.db.select().from(jobChanges).where(eq(jobChanges.jobId, id)).orderBy(asc(jobChanges.id))).map((c) => `${c.field}:${c.oldValue ?? ''}>${c.newValue ?? ''}`);
}

async function opts(dryRun: boolean): Promise<SweepOptions> {
  return { now: NOW, runId: null, dryRun, weights: await getSetting(t.db, 'score_weights'), profile: await getSetting(t.db, 'profile'), rescoreLimit: 0 };
}

describe('sweepLifecycle', () => {
  it('expires, flags ghost risk, promotes new/updated, marks stale — and a dry run writes nothing', async () => {
    const expired = await job({ state: 'active', closingAt: ago(1) });
    const futureClosing = await job({ state: 'active', closingAt: new Date(NOW.getTime() + DAY_MS) });
    const reposted = await job({ state: 'active', repostCount: 3 });
    const old = await job({ state: 'active', firstSeenAt: ago(61) });
    const oldPosted = await job({ state: 'active', postedAt: ago(75), firstSeenAt: ago(5) });
    const cleared = await job({ state: 'active', ghostRisk: true });
    const closedGhost = await job({ state: 'closed', repostCount: 5 });
    const fresh = await job({ state: 'new', firstSeenAt: ago(4) });
    const brandNew = await job({ state: 'new', firstSeenAt: ago(1) });
    const updatedQuiet = await job({ state: 'updated' });
    const updatedBusy = await job({ state: 'updated' });
    await t.db.insert(jobChanges).values({ jobId: updatedBusy, field: 'title', oldValue: 'a', newValue: 'b', changedAt: ago(1) });
    await t.db.insert(jobChanges).values({ jobId: updatedQuiet, field: 'title', oldValue: 'a', newValue: 'b', changedAt: ago(4) });
    const unseen = await job({ state: 'active', lastSeenAt: ago(31) });

    const before = await t.db.select().from(jobs).orderBy(asc(jobs.id));
    const dry = await sweepLifecycle(t.db, await opts(true));
    expect(dry).toMatchObject({ expired: 1, ghostFlagged: 3, ghostCleared: 1, newToActive: 1, updatedToActive: 1, stale: 1, rescored: 0 });
    expect(await t.db.select().from(jobs).orderBy(asc(jobs.id))).toEqual(before);

    const res = await sweepLifecycle(t.db, await opts(false));
    expect(res).toMatchObject({ expired: 1, ghostFlagged: 3, ghostCleared: 1, newToActive: 1, updatedToActive: 1, stale: 1 });
    expect((await row(expired)).state).toBe('expired');
    expect(await changes(expired)).toEqual(['state:active>expired', 'close_reason:>closing_date_passed']);
    expect((await row(futureClosing)).state).toBe('active');
    expect(await row(reposted)).toMatchObject({ ghostRisk: true, state: 'active' });
    expect((await row(old)).ghostRisk).toBe(true);
    expect((await row(oldPosted)).ghostRisk).toBe(true);
    expect((await row(cleared)).ghostRisk).toBe(false);
    expect((await row(closedGhost)).ghostRisk).toBe(false);
    expect((await row(fresh)).state).toBe('active');
    expect((await row(brandNew)).state).toBe('new');
    expect((await row(updatedQuiet)).state).toBe('active');
    expect((await row(updatedBusy)).state).toBe('updated');
    expect((await row(unseen)).state).toBe('stale');

    // Idempotent.
    expect(await sweepLifecycle(t.db, await opts(false))).toMatchObject({ expired: 0, ghostFlagged: 0, ghostCleared: 0, newToActive: 0, updatedToActive: 0, stale: 0 });
  });
});

describe('closeJob / reopenJob', () => {
  it('records state and reason changes; refuses already-closed or merged jobs', async () => {
    const id = await job({ state: 'active' });
    expect(await closeJob(t.db, id, 'missing_from_source', { now: NOW, runId: null, missingRunCount: 2 })).toBe(true);
    expect(await row(id)).toMatchObject({ state: 'closed', missingRunCount: 2 });
    expect(await closeJob(t.db, id, 'manual', { now: NOW, runId: null })).toBe(false);
    expect(await reopenJob(t.db, id, 'listed again', { now: NOW, runId: null })).toBe(true);
    expect(await row(id)).toMatchObject({ state: 'active', missingRunCount: 0 });
    expect(await reopenJob(t.db, id, 'again', { now: NOW, runId: null })).toBe(false);
    expect(await changes(id)).toEqual(['state:active>closed', 'close_reason:>missing_from_source', 'state:closed>active', 'reopen_reason:>listed again']);

    const target = await job({ state: 'active' });
    const merged = await job({ state: 'active', mergedIntoJobId: target });
    expect(await closeJob(t.db, merged, 'link_dead', { now: NOW, runId: null })).toBe(false);
    expect((await t.db.select().from(jobChanges).where(eq(jobChanges.jobId, merged))).length).toBe(0);
  });
});
