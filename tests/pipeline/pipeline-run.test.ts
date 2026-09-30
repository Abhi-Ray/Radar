/**
 * Pipeline runs against a real (ephemeral) MySQL with scripted fake connectors — no network.
 * Covers: idempotency, source isolation + alert, never mass-closing, the circuit breaker, dead
 * letters + retry, dry runs writing nothing, reproducible reprocessing, the single-run lock and
 * the UI → worker run queue; plus lifecycle bookkeeping (last confirmed live from grade-A
 * listings, repost counting → ghost risk) and the checklist auto-tick.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/scoring/score', async (orig) => (await import('./_mocks')).scoringModule(await orig<object>()));
vi.mock('@/lib/remote/classify', async (orig) => (await import('./_mocks')).remoteModule(await orig<object>()));
vi.mock('@/lib/visa/signals', async (orig) => (await import('./_mocks')).visaSignalsModule(await orig<object>()));
vi.mock('@/lib/visa/decide', async (orig) => (await import('./_mocks')).visaDecideModule(await orig<object>()));
vi.mock('@/lib/visa/eligibility', async (orig) => (await import('./_mocks')).eligibilityModule(await orig<object>()));
vi.mock('@/lib/ai/queue', async (orig) => (await import('./_mocks')).aiQueueModule(await orig<object>()));

import { alerts, deadLetters, jobChanges, jobFacts, jobScores, jobs, jobSources, pipelineLock, pipelineRuns, rawSnapshots, sourceRuns, sources } from '../../src/db/schema';
import { OPEN_STATES } from '../../src/lib/lifecycle';
import { processQueuedRuns, reprocessFromRaw, runPipeline, type PipelineRunResult } from '../../src/lib/pipeline';
import { readChecklist } from '../../src/lib/pipeline/health';
import { acquireLock, PIPELINE_LOCK } from '../../src/lib/pipeline/lock';
import { enqueueRun } from '../../src/lib/pipeline/queue';
import type { CompactSourceReport, RunReport } from '../../src/lib/pipeline/report';
import { HOUR_MS } from '../../src/lib/time';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry } from '../helpers/fixtures';
import { Clock, FakeFeed, items, rowCounts, seedFakeSource, seedPlatform, testDeps } from './_harness';
import { mockState } from './_mocks';

let t: TestDb;
let clock: Clock;
let feed: FakeFeed;

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.truncateAll();
  await seedCountry(t.db, 'DE', 'Germany');
  clock = new Clock();
  feed = new FakeFeed(clock.now);
  mockState.scoreBias = 0;
  mockState.scoreVersion = 'score-test-1';
  mockState.aiCalls.length = 0;
});

const run = (opts: Partial<Parameters<typeof runPipeline>[1]> = {}) => runPipeline(t.db, { kind: 'manual', dryRun: false, deps: testDeps(feed, clock), ...opts });

function report(res: PipelineRunResult): RunReport {
  return res.stats as unknown as RunReport;
}

function src(res: PipelineRunResult, sourceId: number): CompactSourceReport {
  const s = report(res).sources.find((x) => x.id === sourceId);
  if (!s) throw new Error(`source ${sourceId} not in the run report`);
  return s;
}

async function jobOf(sourceId: number, externalId: string) {
  const [row] = await t.db
    .select({ job: jobs, js: jobSources })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(and(eq(jobSources.sourceId, sourceId), eq(jobSources.externalId, externalId)))
    .limit(1);
  if (!row) throw new Error(`no job for ${externalId}`);
  return row;
}

async function sourceRow(id: number) {
  const [row] = await t.db.select().from(sources).where(eq(sources.id, id)).limit(1);
  return row;
}

async function alertKinds(): Promise<string[]> {
  return (await t.db.select({ kind: alerts.kind }).from(alerts).orderBy(asc(alerts.id))).map((a) => a.kind);
}

async function missingCounts(sourceId: number): Promise<number[]> {
  const rows = await t.db
    .select({ n: jobs.missingRunCount })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(eq(jobSources.sourceId, sourceId))
    .orderBy(asc(jobSources.id));
  return rows.map((r) => r.n);
}

describe('checklist auto-tick', () => {
  it('ticks samples, parser and rate limit on the first run and the baseline only after 5 healthy runs', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(12));
    const ticks: string[][] = [];
    for (let i = 1; i <= 5; i++) {
      if (i > 1) clock.advance(24 * HOUR_MS);
      const r = await run();
      expect(src(r, sid).healthy).toBe(true);
      const c = readChecklist((await sourceRow(sid)).checklistJson);
      ticks.push((Object.keys(c) as (keyof typeof c)[]).filter((k) => c[k].done).sort());
      if (i === 3) expect((await sourceRow(sid)).baselineJson).not.toBeNull();
    }
    expect(ticks[0]).toEqual(['parser_handles_samples', 'rate_limit_set', 'samples_saved']);
    expect(ticks[3]).toEqual(ticks[0]);
    expect(ticks[4]).toEqual(['baseline_recorded', 'parser_handles_samples', 'rate_limit_set', 'samples_saved']);
    const c = readChecklist((await sourceRow(sid)).checklistJson);
    expect(c.baseline_recorded.note).toBe('auto: baseline 12–12 postings from 5 healthy runs');
  });
});

describe('idempotency', () => {
  it('re-running the same listing stores nothing new and only confirms what is listed', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(6));

    const t1 = clock.now();
    const r1 = await run();
    expect(r1.status).toBe('ok');
    expect(src(r1, sid).counts).toMatchObject({ fetched: 6, listed: 6, attempted: 6, parsed: 6, created: 6, snapshotsCreated: 6 });
    // A grade-A (first-party ATS) listing confirms the posting is live.
    const live1 = await t.db.select({ at: jobs.lastConfirmedLiveAt }).from(jobs);
    expect(live1.map((j) => j.at?.getTime())).toEqual(Array(6).fill(t1.getTime()));
    const after1 = await rowCounts(t.db);
    expect(after1).toMatchObject({ jobs: 6, jobSources: 6, rawSnapshots: 6, sourceRuns: 1, pipelineRuns: 1 });
    const aiCallsAfter1 = mockState.aiCalls.length;

    const t2 = clock.advance(HOUR_MS);
    const r2 = await run();
    expect(r2.status).toBe('ok');
    const c2 = src(r2, sid).counts;
    expect(c2).toMatchObject({ listed: 6, unchanged: 6, confirmed: 6 });
    expect(c2.attempted ?? 0).toBe(0);
    expect(c2.created ?? 0).toBe(0);
    const after2 = await rowCounts(t.db);
    expect(after2).toEqual({ ...after1, pipelineRuns: 2, sourceRuns: 2 });
    expect(mockState.aiCalls.length).toBe(aiCallsAfter1);
    const seen = await t.db.select({ at: jobSources.lastSeenAt }).from(jobSources);
    expect(seen.every((s) => s.at.getTime() === t2.getTime())).toBe(true);
    const live2 = await t.db.select({ at: jobs.lastConfirmedLiveAt }).from(jobs);
    expect(live2.map((j) => j.at?.getTime())).toEqual(Array(6).fill(t2.getTime()));

    // A changed payload is an update with a change record; nothing else moves.
    clock.advance(HOUR_MS);
    feed.set('alpha', [{ id: 'j1', rev: 1 }, { id: 'j2', title: 'Staff DevSecOps Engineer' }, ...items(4, 'j', 3)]);
    const r3 = await run();
    expect(r3.status).toBe('ok');
    expect(src(r3, sid).counts).toMatchObject({ attempted: 2, updated: 2, unchanged: 4, snapshotsCreated: 2 });
    const after3 = await rowCounts(t.db);
    expect(after3.jobs).toBe(6);
    expect(after3.rawSnapshots).toBe(8);
    const j2 = await jobOf(sid, 'j2');
    expect(j2.job.titleRaw).toBe('Staff DevSecOps Engineer');
    const titleChanges = await t.db.select().from(jobChanges).where(and(eq(jobChanges.jobId, j2.job.id), eq(jobChanges.field, 'title')));
    expect(titleChanges).toHaveLength(1);
    expect(titleChanges[0]).toMatchObject({ oldValue: 'Full Stack Developer', newValue: 'Staff DevSecOps Engineer' });
    const j1 = await jobOf(sid, 'j1');
    const descChanges = await t.db.select().from(jobChanges).where(and(eq(jobChanges.jobId, j1.job.id), eq(jobChanges.field, 'description')));
    expect(descChanges).toHaveLength(1);
    expect(j1.job.lastConfirmedLiveAt?.getTime()).toBe(clock.now().getTime());
  });

  it('an aggregator (grade B) listing does not confirm postings as live', async () => {
    await seedPlatform(t.db, 'fakeinc', { grade: 'B' });
    const sid = await seedFakeSource(t.db, 'agg', { platformKey: 'fakeinc' });
    feed.set('agg', items(3));
    expect(src(await run(), sid).counts).toMatchObject({ created: 3 });
    clock.advance(HOUR_MS);
    expect(src(await run(), sid).counts).toMatchObject({ confirmed: 3 });
    const live = await t.db.select({ at: jobs.lastConfirmedLiveAt }).from(jobs);
    expect(live).toHaveLength(3);
    expect(live.every((j) => j.at === null)).toBe(true);
  });
});

describe('isolation', () => {
  it('a failing source is recorded with an alert and the other sources still run', async () => {
    const good = await seedFakeSource(t.db, 'alpha');
    const bad = await seedFakeSource(t.db, 'beta');
    const orphan = await seedFakeSource(t.db, 'gamma', { platformKey: 'noconnector', sourceKey: 'noconnector:gamma' });
    feed.set('alpha', items(5));
    feed.set('beta', new Error('HTTP 500 from the board'));

    const res = await run();
    expect(res.status).toBe('partial');
    expect(src(res, good).status).toBe('ok');
    expect(src(res, good).counts.created).toBe(5);
    expect(src(res, bad).status).toBe('failed');
    expect(src(res, bad).error).toContain('HTTP 500');
    expect(src(res, orphan).status).toBe('failed');
    expect(src(res, orphan).error).toContain('no connector');

    const failedAlerts = await t.db.select().from(alerts).where(eq(alerts.kind, 'source_failed'));
    expect(failedAlerts.map((a) => a.entityId).sort()).toEqual([String(bad), String(orphan)].sort());
    const runs = await t.db.select().from(sourceRuns).orderBy(asc(sourceRuns.sourceId));
    expect(runs.map((r) => [r.sourceId, r.status])).toEqual([
      [good, 'ok'],
      [bad, 'failed'],
      [orphan, 'failed'],
    ]);
    expect((await sourceRow(bad)).consecutiveFailures).toBe(1);
    expect((await sourceRow(good)).lastSuccessAt?.getTime()).toBe(clock.now().getTime());
  });

  it('a run where every source fails is failed and raises one critical alert', async () => {
    await seedFakeSource(t.db, 'beta');
    feed.set('beta', new Error('connection reset'));
    const res = await run();
    expect(res.status).toBe('failed');
    const [row] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, res.runId as number));
    expect(row.status).toBe('failed');
    expect(row.error).toContain('connection reset');
    const critical = await t.db.select().from(alerts).where(eq(alerts.kind, 'pipeline_failed'));
    expect(critical).toHaveLength(1);
    expect(critical[0].severity).toBe('critical');
  });
});

describe('never mass-close', () => {
  it('refuses to count absence when most open jobs vanish at once', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(10));
    await run();
    clock.advance(24 * HOUR_MS);
    feed.set('alpha', items(2));
    const res = await run();
    const s = src(res, sid);
    expect(s.flags).toContain('mass_close_blocked');
    expect(s.counts.missingIncremented ?? 0).toBe(0);
    expect(await missingCounts(sid)).toEqual(Array(10).fill(0));
    const blocked = await t.db.select().from(alerts).where(eq(alerts.kind, 'mass_close_blocked'));
    expect(blocked).toHaveLength(1);
    expect(blocked[0].severity).toBe('critical');
    const open = await t.db.select({ state: jobs.state }).from(jobs);
    expect(open.every((j) => (OPEN_STATES as readonly string[]).includes(j.state))).toBe(true);
  });

  it('an empty listing counts nothing', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(6));
    await run();
    clock.advance(24 * HOUR_MS);
    feed.set('alpha', []);
    const res = await run();
    expect(src(res, sid).healthy).toBe(false);
    expect(await missingCounts(sid)).toEqual(Array(6).fill(0));
  });

  it('incremental and partial listings never count absence', async () => {
    const inc = await seedFakeSource(t.db, 'inc', { platformKey: 'fakeinc', sourceKey: 'fakeinc:inc' });
    const part = await seedFakeSource(t.db, 'part');
    feed.set('inc', items(6));
    feed.set('part', items(6, 'p'));
    await run();
    clock.advance(24 * HOUR_MS);
    feed.set('inc', items(1));
    feed.set('part', items(1, 'p'));
    feed.partial.add('part');
    const res = await run();
    expect(src(res, inc).healthy).toBe(false);
    expect(src(res, inc).healthReason).toBe('listing incomplete or incremental');
    expect(src(res, part).healthy).toBe(false);
    expect(await missingCounts(inc)).toEqual(Array(6).fill(0));
    expect(await missingCounts(part)).toEqual(Array(6).fill(0));
    const [sr] = await t.db.select({ flags: sourceRuns.healthFlagsJson }).from(sourceRuns).where(and(eq(sourceRuns.sourceId, part), eq(sourceRuns.runId, res.runId as number)));
    expect(sr.flags).toMatchObject({ complete: false, partialReason: 'item cap reached' });
  });

  it('closes a job after two healthy misses and reopens it when listed again', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(6));
    await run();
    feed.set('alpha', items(5));
    clock.advance(24 * HOUR_MS);
    const r2 = await run();
    expect(src(r2, sid).counts).toMatchObject({ missing: 1, missingIncremented: 1 });
    expect((await jobOf(sid, 'j6')).job).toMatchObject({ missingRunCount: 1 });
    expect((OPEN_STATES as readonly string[]).includes((await jobOf(sid, 'j6')).job.state)).toBe(true);

    clock.advance(24 * HOUR_MS);
    const r3 = await run();
    expect(src(r3, sid).counts).toMatchObject({ closedMissing: 1 });
    const closed = await jobOf(sid, 'j6');
    expect(closed.job.state).toBe('closed');
    const reason = await t.db.select().from(jobChanges).where(and(eq(jobChanges.jobId, closed.job.id), eq(jobChanges.field, 'close_reason')));
    expect(reason.map((r) => r.newValue)).toEqual(['missing_from_source']);
    // The others were listed every time.
    expect((await missingCounts(sid)).slice(0, 5)).toEqual([0, 0, 0, 0, 0]);

    clock.advance(24 * HOUR_MS);
    feed.set('alpha', items(6));
    const r4 = await run();
    expect(src(r4, sid).counts.reopened).toBe(1);
    expect(src(r4, sid).counts.reposts).toBe(1);
    const back = await jobOf(sid, 'j6');
    expect(back.job.state).toBe('active');
    expect(back.job.missingRunCount).toBe(0);
    // Re-listed after closing = a repost (ghost-risk input); not a content change.
    expect(back.job.repostCount).toBe(1);
    expect(back.job.contentVersion).toBe(closed.job.contentVersion);
    const reposts = await t.db.select().from(jobChanges).where(and(eq(jobChanges.jobId, back.job.id), eq(jobChanges.field, 'repost_count')));
    expect(reposts.map((r) => [r.oldValue, r.newValue])).toEqual([['0', '1']]);
    // Only once: listed again the next day is just "seen".
    clock.advance(24 * HOUR_MS);
    const r5 = await run();
    expect(src(r5, sid).counts.reposts ?? 0).toBe(0);
    expect((await jobOf(sid, 'j6')).job.repostCount).toBe(1);
  });

  it('counts a re-post under a new id as a repost and flags ghost risk after three', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    const same = { title: 'Detection Engineer', company: 'Kestrel Security', desc: 'Detection engineering for cloud workloads, incident response and threat models in a hybrid Berlin office.' };
    feed.set('alpha', [...items(5), { id: 'j20', ...same }]);
    await run();
    let prev = 'j20';
    for (const [i, id] of ['j21', 'j22', 'j23'].entries()) {
      clock.advance(24 * HOUR_MS);
      feed.set('alpha', [...items(5), { id, ...same }]);
      const r = await run();
      expect(src(r, sid).counts).toMatchObject({ created: 1, reposts: 1 });
      const now = await jobOf(sid, id);
      const before = await jobOf(sid, prev);
      expect(now.job.id).not.toBe(before.job.id);
      expect(now.job.repostCount).toBe(i + 1);
      const from = await t.db.select().from(jobChanges).where(and(eq(jobChanges.jobId, now.job.id), eq(jobChanges.field, 'reposted_from')));
      expect(from.map((c) => c.newValue)).toEqual([String(before.job.id)]);
      prev = id;
    }
    const last = await jobOf(sid, 'j23');
    expect(last.job.repostCount).toBe(3);
    expect(last.job.ghostRisk).toBe(true);
    expect((await jobOf(sid, 'j22')).job.ghostRisk).toBe(false);
  });

  it('a second opening with the same title while the first is still listed is not a repost', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    const same = { title: 'Detection Engineer', company: 'Kestrel Security', desc: 'Detection engineering for cloud workloads, incident response and threat models in a hybrid Berlin office.' };
    feed.set('alpha', [...items(5), { id: 'j20', ...same }]);
    await run();
    clock.advance(24 * HOUR_MS);
    feed.set('alpha', [...items(5), { id: 'j20', ...same }, { id: 'j21', ...same }]);
    const r = await run();
    expect(src(r, sid).counts).toMatchObject({ created: 1 });
    expect(src(r, sid).counts.reposts ?? 0).toBe(0);
    expect((await jobOf(sid, 'j21')).job.repostCount).toBe(0);
    expect((await jobOf(sid, 'j20')).job.repostCount).toBe(0);
  });

  it('long-lived canary postings all vanishing blocks absence counting and alerts', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(10));
    await run();
    clock.advance(24 * HOUR_MS);
    feed.set('alpha', items(5, 'j', 6));
    const res = await run();
    const s = src(res, sid);
    expect(s.healthy).toBe(false);
    expect(s.flags).toContain('canaries_missing');
    expect(await missingCounts(sid)).toEqual(Array(10).fill(0));
    expect(await alertKinds()).toContain('canaries_missing');
  });
});

describe('circuit breaker', () => {
  it('opens after 3 failures, skips while open, doubles the pause and recovers', async () => {
    const sid = await seedFakeSource(t.db, 'beta');
    feed.set('beta', new Error('HTTP 503'));
    for (let i = 0; i < 3; i++) {
      await run();
      clock.advance(HOUR_MS);
    }
    let s = await sourceRow(sid);
    expect(s.consecutiveFailures).toBe(3);
    // Opened at the third run (2 h after the first) for 12 h.
    const thirdRunAt = clock.now().getTime() - HOUR_MS;
    expect(s.circuitOpenUntil?.getTime()).toBe(thirdRunAt + 12 * HOUR_MS);
    const circuit = await t.db.select().from(alerts).where(eq(alerts.kind, 'circuit_open'));
    expect(circuit).toHaveLength(1);
    expect(circuit[0].severity).toBe('critical');
    expect(feed.fetches).toHaveLength(3);

    // While open: skipped, not fetched, breaker unchanged.
    const skipped = await run();
    expect(src(skipped, sid).status).toBe('skipped');
    expect(src(skipped, sid).reason).toContain('circuit open');
    expect(feed.fetches).toHaveLength(3);
    expect((await sourceRow(sid)).consecutiveFailures).toBe(3);

    // After the pause a further failure doubles it (24 h).
    clock.t = new Date(thirdRunAt + 13 * HOUR_MS);
    await run();
    s = await sourceRow(sid);
    expect(s.consecutiveFailures).toBe(4);
    expect(s.circuitOpenUntil?.getTime()).toBe(clock.now().getTime() + 24 * HOUR_MS);
    const [bumped] = await t.db.select().from(alerts).where(eq(alerts.kind, 'circuit_open'));
    expect(bumped.occurrences).toBe(2);

    // Working again → closed circuit and a recovery note.
    clock.advance(25 * HOUR_MS);
    feed.set('beta', items(5));
    const ok = await run();
    expect(src(ok, sid).status).toBe('ok');
    s = await sourceRow(sid);
    expect(s.consecutiveFailures).toBe(0);
    expect(s.circuitOpenUntil).toBeNull();
    const recovered = await t.db.select().from(alerts).where(eq(alerts.kind, 'source_recovered'));
    expect(recovered).toHaveLength(1);
    expect(recovered[0].severity).toBe('info');
  });
});

describe('dead letters', () => {
  it('keeps failing items, bumps repeats without degrading the source, and a fixed parser resolves them', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', [...items(5), { id: 'j6', bad: true }]);

    const r1 = await run();
    expect(src(r1, sid).status).toBe('ok');
    expect(src(r1, sid).counts).toMatchObject({ failedParse: 1, deadLetters: 1, created: 5 });
    let [dl] = await t.db.select().from(deadLetters);
    expect(dl).toMatchObject({ sourceId: sid, externalId: 'j6', stage: 'parse', status: 'open', retryCount: 0, parserVersion: 'fake@1' });
    expect(dl.rawSnapshotId).not.toBeNull();
    expect(dl.error).toContain('unexpected payload shape');

    clock.advance(24 * HOUR_MS);
    const r2 = await run();
    // The same broken payload again: still a dead letter, but it does not make the source partial.
    expect(src(r2, sid).status).toBe('ok');
    expect(src(r2, sid).counts).toMatchObject({ failedParse: 1, repeatFailures: 1 });
    [dl] = await t.db.select().from(deadLetters);
    expect(dl).toMatchObject({ status: 'retried', retryCount: 1 });
    expect(await t.db.select().from(deadLetters)).toHaveLength(1);

    feed.fixed = true;
    clock.advance(HOUR_MS);
    const rp = await reprocessFromRaw(t.db, { deps: testDeps(feed, clock) });
    expect(rp.status).toBe('ok');
    expect(rp.stats).toMatchObject({ deadLettersRetried: 1, deadLettersResolved: 1, created: 1 });
    [dl] = await t.db.select().from(deadLetters);
    expect(dl.status).toBe('resolved');
    const j6 = await jobOf(sid, 'j6');
    expect(j6.js.rawSnapshotId).toBe(dl.rawSnapshotId);
  });

  it('a new batch where every new item fails makes the source partial', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(5));
    await run();
    clock.advance(HOUR_MS);
    feed.set('alpha', [...items(5), { id: 'j6', bad: true }, { id: 'j7', bad: true }]);
    const res = await run();
    expect(src(res, sid).status).toBe('partial');
    expect(src(res, sid).error).toContain('new or changed items failed');
  });
});

describe('dry run', () => {
  it('writes nothing but the run row and reports what would change', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    const bad = await seedFakeSource(t.db, 'beta');
    feed.set('alpha', items(6));
    feed.set('beta', new Error('HTTP 500'));
    const before = await rowCounts(t.db);
    const sourcesBefore = await t.db.select().from(sources).orderBy(asc(sources.id));

    const dry = await runPipeline(t.db, { kind: 'dry_run', dryRun: true, deps: testDeps(feed, clock) });
    expect(dry.status).toBe('partial');
    expect(report(dry).dryRun).toBe(true);
    expect(report(dry).wouldChange).toMatchObject({ newPostings: 6, changedPostings: 0 });
    expect(report(dry).wouldChange?.alerts.map((a) => a.kind)).toContain('source_failed');
    expect(await rowCounts(t.db)).toEqual({ ...before, pipelineRuns: before.pipelineRuns + 1 });
    expect(await t.db.select().from(sources).orderBy(asc(sources.id))).toEqual(sourcesBefore);
    const [row] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, dry.runId as number));
    expect(row).toMatchObject({ kind: 'dry_run', dryRun: true, status: 'partial' });

    // After a real run: a changed and a missing posting are only predicted.
    feed.set('beta', items(3, 'b'));
    await run();
    clock.advance(24 * HOUR_MS);
    feed.set('alpha', [{ id: 'j1', rev: 1 }, ...items(4, 'j', 2)]);
    const snapshot = await rowCounts(t.db);
    const jobsBefore = await t.db.select().from(jobs).orderBy(asc(jobs.id));
    const dry2 = await runPipeline(t.db, { kind: 'manual', dryRun: true, deps: testDeps(feed, clock) });
    expect(report(dry2).wouldChange).toMatchObject({ newPostings: 0, changedPostings: 1, missingIncrements: 1 });
    expect(src(dry2, sid).counts).toMatchObject({ unchanged: 4 });
    expect(await rowCounts(t.db)).toEqual({ ...snapshot, pipelineRuns: snapshot.pipelineRuns + 1 });
    expect(await t.db.select().from(jobs).orderBy(asc(jobs.id))).toEqual(jobsBefore);
    expect(bad).toBeGreaterThan(0);
  });
});

describe('reprocess from raw', () => {
  const factView = async () =>
    (await t.db.select().from(jobFacts).orderBy(asc(jobFacts.id))).map((f) => ({
      id: f.id,
      jobId: f.jobId,
      key: f.factKey,
      value: f.valueJson,
      source: f.source,
      method: f.method,
      confidence: f.confidence,
      active: f.isActive,
      logic: f.logicVersion,
    }));
  const jobView = async () =>
    (await t.db.select().from(jobs).orderBy(asc(jobs.id))).map((j) => {
      // updated_at / resolved_at are bookkeeping timestamps of the write itself, not results.
      const { updatedAt: _u, resolvedAt: _r, ...rest } = j;
      void _u;
      void _r;
      return rest;
    });

  it('same snapshots + same logic → the same jobs, facts and scores; new scoring applies', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(6));
    await run();
    const jobs1 = await jobView();
    const facts1 = await factView();
    const scores1 = await t.db.select().from(jobScores).orderBy(asc(jobScores.id));
    const counts1 = await rowCounts(t.db);

    clock.advance(2 * HOUR_MS);
    const rp = await reprocessFromRaw(t.db, { deps: testDeps(feed, clock) });
    expect(rp.status).toBe('ok');
    expect(rp.reprocessed).toBe(6);
    expect(rp.failed).toBe(0);
    expect(rp.stats).toMatchObject({ same: 6, created: 0, updated: 0 });
    expect(await jobView()).toEqual(jobs1);
    expect(await factView()).toEqual(facts1);
    expect(await t.db.select().from(jobScores).orderBy(asc(jobScores.id))).toEqual(scores1);
    expect(await rowCounts(t.db)).toEqual({ ...counts1, pipelineRuns: counts1.pipelineRuns + 1 });
    const [rrow] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, rp.runId as number));
    expect(rrow).toMatchObject({ kind: 'reprocess', status: 'ok' });
    expect(rrow.logicVersionsJson).toMatchObject({ score: 'score-test-1' });
    expect(feed.fetches).toHaveLength(1); // no network

    // A new scorer version with different results is applied to every job.
    mockState.scoreVersion = 'score-test-2';
    mockState.scoreBias = 5;
    const rp2 = await reprocessFromRaw(t.db, { deps: testDeps(feed, clock), sourceIds: [sid] });
    expect(rp2.status).toBe('ok');
    const jobs2 = await t.db.select({ id: jobs.id, score: jobs.score, v: jobs.scoreVersion }).from(jobs).orderBy(asc(jobs.id));
    for (const [i, j] of jobs2.entries()) {
      expect(j.v).toBe('score-test-2');
      expect(j.score).toBe(Math.min(100, (jobs1[i].score ?? 0) + 5));
    }
    const current = await t.db.select().from(jobScores).where(eq(jobScores.isCurrent, true));
    expect(current).toHaveLength(6);
    expect((await t.db.select().from(jobScores)).length).toBe(12);
  });
});

describe('single-run lock', () => {
  it('a held lock skips a run and keeps a queued run queued', async () => {
    await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(3));
    const other = await acquireLock(t.db, { name: PIPELINE_LOCK, owner: 'other-worker:1' });
    expect(other).not.toBeNull();

    const res = await run();
    expect(res.status).toBe('skipped');
    const [row] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, res.runId as number));
    expect(row.status).toBe('skipped');
    expect(row.error).toContain('another run holds the pipeline lock');
    expect(feed.fetches).toHaveLength(0);

    const { runId } = await enqueueRun(t.db, { kind: 'manual', dryRun: false, requestedBy: 'ui' });
    const q1 = await processQueuedRuns(t.db, { deps: testDeps(feed, clock) });
    expect(q1).toMatchObject({ processed: 0, deferred: 1 });
    const [queued] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
    expect(queued.status).toBe('queued');

    await other?.release();
    const q2 = await processQueuedRuns(t.db, { deps: testDeps(feed, clock) });
    expect(q2.processed).toBe(1);
    expect(q2.results[0]).toMatchObject({ runId, status: 'ok' });
    const [done] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
    expect(done.status).toBe('ok');
    expect(feed.fetches).toHaveLength(1);
  });

  it('two concurrent runs: one runs, the other is skipped', async () => {
    await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(3));
    const [a, b] = await Promise.all([run(), run()]);
    expect([a.status, b.status].sort()).toEqual(['ok', 'skipped']);
    expect(feed.fetches).toHaveLength(1);
    const [lock] = await t.db.select().from(pipelineLock).where(eq(pipelineLock.name, PIPELINE_LOCK));
    expect(lock.owner).toBeNull();
  });

  it('takes over a stale lock and fails the orphaned run', async () => {
    await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(3));
    const past = new Date(Date.now() - 2 * HOUR_MS);
    const [orphan] = await t.db.insert(pipelineRuns).values({ kind: 'daily', status: 'running', requestedBy: 'cron', dryRun: false, startedAt: past });
    const orphanId = Number(orphan.insertId);
    await t.db.insert(pipelineLock).values({ name: PIPELINE_LOCK, owner: 'crashed-worker:9', runId: orphanId, acquiredAt: past, heartbeatAt: past, expiresAt: new Date(Date.now() - 60_000) });

    const res = await run();
    expect(res.status).toBe('ok');
    const [old] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, orphanId));
    expect(old.status).toBe('failed');
    expect(old.error).toContain('interrupted');
  });
});

describe('run queue', () => {
  it('executes queued runs with their stored params and fails unreadable ones', async () => {
    const a = await seedFakeSource(t.db, 'alpha');
    await seedFakeSource(t.db, 'beta');
    feed.set('alpha', items(2));
    feed.set('beta', items(2, 'b'));
    const { runId } = await enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [a] });
    const [broken] = await t.db.insert(pipelineRuns).values({ kind: 'manual', status: 'queued', requestedBy: 'ui', dryRun: false, statsJson: { params: { sourceIds: ['x'] } } });
    const brokenId = Number(broken.insertId);

    const q = await processQueuedRuns(t.db, { deps: testDeps(feed, clock) });
    expect(q.processed).toBe(2);
    expect(feed.fetches).toEqual(['alpha']);
    const [ok] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, runId));
    expect(ok.status).toBe('ok');
    expect((ok.statsJson as { params?: unknown }).params).toEqual({ sourceIds: [a] });
    const [bad] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, brokenId));
    expect(bad.status).toBe('failed');
    expect(bad.error).toContain('invalid queued run parameters');
  });

  it('reports unknown source ids and ignores disabled sources', async () => {
    const a = await seedFakeSource(t.db, 'alpha');
    const d = await seedFakeSource(t.db, 'off', { status: 'disabled' });
    feed.set('alpha', items(2));
    feed.set('off', items(2, 'o'));
    const res = await run({ sourceIds: [a, d, 99999] });
    expect(res.status).toBe('ok');
    expect(feed.fetches).toEqual(['alpha']);
    expect(res.stats.unknownSourceIds).toEqual([d, 99999]);
  });

  it('keeps raw snapshots of every processed payload', async () => {
    const sid = await seedFakeSource(t.db, 'alpha');
    feed.set('alpha', items(2));
    await run();
    const snaps = await t.db.select().from(rawSnapshots).where(eq(rawSnapshots.sourceId, sid)).orderBy(asc(rawSnapshots.id));
    expect(snaps.map((s) => s.externalId)).toEqual(['j1', 'j2']);
    expect(JSON.parse(snaps[0].payload)).toEqual({ id: 'j1', board: 'alpha' });
    expect(snaps[0].parserVersion).toBe('fake@1');
  });
});
