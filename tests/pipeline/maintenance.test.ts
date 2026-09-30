/**
 * Maintenance jobs against a real (ephemeral) MySQL, no network: retention, the apply-link
 * checker (scripted fetch; the real SSRF-safe fetch for internal addresses), alert dedupe and
 * channels, the "didn't run" heartbeat and the morning digest.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiCache, alerts, applications, deadLetters, jobChanges, jobs, jobSources, linkChecks, loginAttempts, pipelineRuns, rawSnapshots } from '../../src/db/schema';
import { raiseAlert, type AlertChannel, type AlertMessage } from '../../src/lib/alerts';
import { sendMorningDigest } from '../../src/lib/alerts/digest';
import { checkHeartbeat, HEARTBEAT_DEDUPE_KEY, pingHealthcheck } from '../../src/lib/alerts/heartbeat';
import { alertSettingsSchema } from '../../src/lib/contracts/settings';
import { sha256Hex } from '../../src/lib/hash';
import { runRetention } from '../../src/lib/lifecycle/retention';
import { runLinkCheck, type LinkCheckDeps } from '../../src/lib/linkcheck';
import { acquireLock, PIPELINE_LOCK } from '../../src/lib/pipeline/lock';
import { SafeFetchError, type SafeFetchOptions, type SafeFetchResponse } from '../../src/lib/security/safe-fetch';
import { setSetting } from '../../src/lib/settings';
import { DAY_MS, HOUR_MS } from '../../src/lib/time';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedJob, seedSource } from '../helpers/fixtures';

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

const NOW = new Date('2026-09-30T05:00:00.000Z');
const ago = (days: number) => new Date(NOW.getTime() - days * DAY_MS);
let seq = 0;

async function snapshot(sourceId: number, externalId: string, fetchedAt: Date): Promise<number> {
  const payload = JSON.stringify({ id: externalId, n: seq++ });
  const [res] = await t.db.insert(rawSnapshots).values({ sourceId, externalId, contentHash: sha256Hex(payload), payload, fetchedAt, parserVersion: 'test@1' });
  return Number(res.insertId);
}

async function link(jobId: number, sourceId: number, externalId: string, rawSnapshotId: number | null, lastSeenAt: Date): Promise<void> {
  await t.db.insert(jobSources).values({ jobId, sourceId, externalId, url: `https://x.example/${externalId}`, grade: 'A', firstSeenAt: lastSeenAt, lastSeenAt, rawSnapshotId });
}

async function snapshotIds(): Promise<number[]> {
  return (await t.db.select({ id: rawSnapshots.id }).from(rawSnapshots).orderBy(asc(rawSnapshots.id))).map((r) => r.id);
}

describe('retention', () => {
  it('prunes old raw snapshots except saved / applied / still-needed ones, plus AI cache, dead letters and login attempts', async () => {
    const { jobId: savedJob, sourceId } = await seedJob(t.db);
    const src = sourceId as number;
    const { jobId: appliedJob } = await seedJob(t.db, { withSource: false });
    const { jobId: closedJob } = await seedJob(t.db, { withSource: false });
    const { jobId: openJob } = await seedJob(t.db, { withSource: false });
    await t.db.update(jobs).set({ saved: true, state: 'closed' }).where(eq(jobs.id, savedJob));
    await t.db.update(jobs).set({ state: 'closed' }).where(eq(jobs.id, appliedJob));
    await t.db.update(jobs).set({ state: 'closed' }).where(eq(jobs.id, closedJob));
    await t.db.update(jobs).set({ state: 'active' }).where(eq(jobs.id, openJob));
    await t.db.insert(applications).values({ jobId: appliedJob, companyName: 'Acme', title: 'Engineer' });

    const savedOld = await snapshot(src, 'saved', ago(200));
    const savedCur = await snapshot(src, 'saved', ago(150));
    await link(savedJob, src, 'saved', savedCur, ago(150));
    const appliedOld = await snapshot(src, 'applied', ago(120));
    await link(appliedJob, src, 'applied', appliedOld, ago(120));
    const closedOld = await snapshot(src, 'closed', ago(100));
    await link(closedJob, src, 'closed', closedOld, ago(100));
    const openCur = await snapshot(src, 'open', ago(95));
    await link(openJob, src, 'open', openCur, ago(1));
    const deadLetterSnap = await snapshot(src, 'broken', ago(100));
    const orphanOld = await snapshot(src, 'orphan', ago(91));
    const recent = await snapshot(src, 'recent', ago(10));

    await t.db.insert(deadLetters).values([
      { sourceId: src, rawSnapshotId: deadLetterSnap, externalId: 'broken', stage: 'parse', error: 'x', status: 'open', createdAt: ago(100), updatedAt: ago(100) },
      { sourceId: src, externalId: 'old-resolved', stage: 'parse', error: 'x', status: 'resolved', createdAt: ago(200), updatedAt: ago(181), resolvedAt: ago(181) },
      { sourceId: src, externalId: 'old-ignored', stage: 'parse', error: 'x', status: 'ignored', createdAt: ago(200), updatedAt: ago(190) },
      { sourceId: src, externalId: 'young-resolved', stage: 'parse', error: 'x', status: 'resolved', createdAt: ago(100), updatedAt: ago(100), resolvedAt: ago(100) },
      { sourceId: src, externalId: 'ancient-open', stage: 'validate', error: 'x', status: 'open', createdAt: ago(400), updatedAt: ago(400) },
    ]);
    const cache = (key: string, createdAt: Date) => ({ cacheKey: sha256Hex(key), contentHash: sha256Hex(`c${key}`), task: 'summary', promptVersion: 'p1', responseJson: { ok: true }, createdAt });
    await t.db.insert(aiCache).values([cache('old', ago(181)), cache('new', ago(179))]);
    await t.db.insert(loginAttempts).values([
      { ip: '203.0.113.1', outcome: 'bad_credentials', at: ago(40) },
      { ip: '203.0.113.1', outcome: 'bad_credentials', at: ago(1) },
    ]);

    const res = await runRetention(t.db, { now: NOW });
    expect(res.skipped).toBeUndefined();
    expect(res.rawDays).toBe(90);
    expect(res.markedRetained).toBe(3);
    expect(res.snapshotsDeleted).toBe(2);
    expect(await snapshotIds()).toEqual([savedOld, savedCur, appliedOld, openCur, deadLetterSnap, recent].sort((a, b) => a - b));
    expect(await snapshotIds()).not.toContain(closedOld);
    expect(await snapshotIds()).not.toContain(orphanOld);

    expect(res.deadLettersDeleted).toBe(2);
    const dl = (await t.db.select({ e: deadLetters.externalId }).from(deadLetters).orderBy(asc(deadLetters.id))).map((r) => r.e);
    expect(dl).toEqual(['broken', 'young-resolved', 'ancient-open']);
    expect(res.aiCacheDeleted).toBe(1);
    expect((await t.db.select().from(aiCache)).map((r) => r.cacheKey)).toEqual([sha256Hex('new')]);
    expect(res.loginAttemptsDeleted).toBe(1);
    expect((await t.db.select().from(loginAttempts)).length).toBe(1);

    // Idempotent: a second pass deletes nothing more.
    const again = await runRetention(t.db, { now: NOW });
    expect(again).toMatchObject({ markedRetained: 0, snapshotsDeleted: 0, deadLettersDeleted: 0, aiCacheDeleted: 0, loginAttemptsDeleted: 0 });
  });

  it('skips while a pipeline run holds the lock', async () => {
    const src = await seedSource(t.db);
    await snapshot(src, 'orphan', ago(200));
    const lock = await acquireLock(t.db, { name: PIPELINE_LOCK, owner: 'other-run' });
    expect(lock).not.toBeNull();
    const res = await runRetention(t.db, { now: NOW });
    expect(res.skipped).toBe('locked');
    expect((await snapshotIds()).length).toBe(1);
    await lock!.release();
  });
});

// ---- link check ---------------------------------------------------------------------------------

type Scripted = (url: string, method: string) => { status: number; finalUrl?: string } | SafeFetchError;

function scriptedFetch(script: Scripted, calls: string[]) {
  return async (url: string, options?: SafeFetchOptions): Promise<SafeFetchResponse> => {
    const method = options?.method ?? 'GET';
    calls.push(`${method} ${url}`);
    const r = script(url, method);
    if (r instanceof SafeFetchError) throw r;
    const body = Buffer.alloc(0);
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      finalUrl: r.finalUrl ?? url,
      redirects: [],
      headers: new Headers(),
      body,
      remoteAddress: '203.0.113.10',
      text: () => '',
      json: <T,>() => ({}) as T,
    };
  };
}

function linkDeps(now: () => Date, fetch: LinkCheckDeps['fetch']): LinkCheckDeps {
  return { fetch, now, sleep: async () => undefined, hostDelayMs: 0, heartbeatMs: 60_000 };
}

async function jobRow(id: number) {
  const [row] = await t.db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  return row;
}

async function closeReasons(jobId: number): Promise<string[]> {
  return (
    await t.db
      .select({ v: jobChanges.newValue })
      .from(jobChanges)
      .where(and(eq(jobChanges.jobId, jobId), eq(jobChanges.field, 'close_reason')))
      .orderBy(asc(jobChanges.id))
  ).map((r) => r.v ?? '');
}

describe('link check', () => {
  it('HEAD then GET, dead after 2 conclusive failures (closes), inconclusive changes nothing, a working link reopens', async () => {
    const mk = async (path: string) => {
      const { jobId } = await seedJob(t.db, { applyUrl: `https://jobs.example.com/${path}` });
      await t.db.update(jobs).set({ state: 'active' }).where(eq(jobs.id, jobId));
      return jobId;
    };
    const okJob = await mk('ok');
    const headless = await mk('head-405');
    const gone = await mk('gone');
    const flaky = await mk('flaky');
    const redirected = await mk('careers/job-7');

    let now = NOW;
    let goneAlive = false;
    const calls: string[] = [];
    const script: Scripted = (url, method) => {
      if (url.endsWith('/ok')) return { status: 200 };
      if (url.endsWith('/head-405')) return method === 'HEAD' ? { status: 405 } : { status: 200 };
      if (url.endsWith('/gone')) return goneAlive ? { status: 200 } : { status: 404 };
      if (url.endsWith('/flaky')) return new SafeFetchError('timeout', 'timed out', url);
      if (url.endsWith('/careers/job-7')) return { status: 200, finalUrl: 'https://jobs.example.com/careers' };
      return { status: 500 };
    };
    const fetch = scriptedFetch(script, calls);

    const r1 = await runLinkCheck(t.db, { deps: linkDeps(() => now, fetch) });
    expect(r1.status).toBe('ok');
    expect(r1.stats).toMatchObject({ candidates: 5, probes: 5, ok: 2, failedOnce: 2, inconclusive: 1, dead: 0, closed: 0 });
    expect(calls).toContain('HEAD https://jobs.example.com/head-405');
    expect(calls).toContain('GET https://jobs.example.com/head-405');
    expect(calls.filter((c) => c.endsWith('/ok'))).toEqual(['HEAD https://jobs.example.com/ok']);
    expect(await jobRow(okJob)).toMatchObject({ linkStatus: 'ok', state: 'active' });
    expect((await jobRow(okJob)).lastConfirmedLiveAt?.toISOString()).toBe(NOW.toISOString());
    expect((await jobRow(headless)).linkStatus).toBe('ok');
    expect(await jobRow(gone)).toMatchObject({ linkStatus: 'unknown', state: 'active' });
    expect(await jobRow(redirected)).toMatchObject({ linkStatus: 'redirected', state: 'active' });
    expect(await jobRow(flaky)).toMatchObject({ linkStatus: 'unknown', state: 'active' });
    expect((await t.db.select().from(linkChecks)).length).toBe(5);

    // Not due yet: nothing is re-checked within 20 h.
    now = new Date(NOW.getTime() + 2 * HOUR_MS);
    const early = await runLinkCheck(t.db, { deps: linkDeps(() => now, fetch) });
    expect(early.stats).toMatchObject({ candidates: 0 });

    // Second conclusive failure → dead → closed with reason link_dead. Flaky stays open.
    now = new Date(NOW.getTime() + 21 * HOUR_MS);
    const r2 = await runLinkCheck(t.db, { deps: linkDeps(() => now, fetch) });
    expect(r2.stats).toMatchObject({ dead: 2, closed: 2 });
    expect(await jobRow(gone)).toMatchObject({ linkStatus: 'dead', state: 'closed' });
    expect(await closeReasons(gone)).toEqual(['link_dead']);
    expect(await jobRow(redirected)).toMatchObject({ linkStatus: 'dead', state: 'closed' });
    expect(await jobRow(flaky)).toMatchObject({ state: 'active' });

    // A source lists the dead job again and the link works → reopened.
    goneAlive = true;
    now = new Date(NOW.getTime() + 30 * HOUR_MS);
    const [{ bestSourceId }] = await t.db.select({ bestSourceId: jobs.bestSourceId }).from(jobs).where(eq(jobs.id, gone));
    await link(gone, bestSourceId as number, 'gone-1', null, now);
    now = new Date(NOW.getTime() + 31 * HOUR_MS);
    const r3 = await runLinkCheck(t.db, { deps: linkDeps(() => now, fetch) });
    expect(r3.stats).toMatchObject({ recheckDead: 1, reopened: 1 });
    expect(await jobRow(gone)).toMatchObject({ linkStatus: 'ok', state: 'active' });
    // The redirected one was not listed again: stays closed.
    expect(await jobRow(redirected)).toMatchObject({ state: 'closed' });

    const runs = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.kind, 'linkcheck'));
    expect(runs.length).toBe(4);
    expect(runs.every((r) => r.status === 'ok')).toBe(true);
  });

  it('never contacts internal addresses (real safe fetch), and does not GET after a blocked HEAD', async () => {
    const { jobId: loopback } = await seedJob(t.db, { applyUrl: 'http://127.0.0.1:9/job/1' });
    const { jobId: metadata } = await seedJob(t.db, { applyUrl: 'http://169.254.169.254/latest/meta-data' });
    const r = await runLinkCheck(t.db, { deps: { now: () => NOW, sleep: async () => undefined, hostDelayMs: 0 } });
    expect(r.stats).toMatchObject({ probes: 2, inconclusive: 2, ok: 0, dead: 0 });
    const checks = await t.db.select().from(linkChecks).orderBy(asc(linkChecks.id));
    expect(checks.map((c) => c.ok)).toEqual([false, false]);
    expect(checks.every((c) => c.statusCode === null && /not public|blocked/i.test(c.error ?? ''))).toBe(true);
    expect((await jobRow(loopback)).state).toBe('new');
    expect((await jobRow(metadata)).state).toBe('new');

    const calls: string[] = [];
    const blocked = scriptedFetch((url) => new SafeFetchError('blocked_ip', 'blocked', url), calls);
    await t.db.update(jobs).set({ linkCheckedAt: null });
    await runLinkCheck(t.db, { deps: linkDeps(() => new Date(NOW.getTime() + DAY_MS), blocked) });
    expect(calls.every((c) => c.startsWith('HEAD '))).toBe(true);
    expect(calls.length).toBe(2);
  });
});

// ---- alerts -------------------------------------------------------------------------------------

class FakeChannel implements AlertChannel {
  readonly sent: AlertMessage[] = [];
  fail = false;
  constructor(readonly name: 'telegram' | 'email') {}
  isConfigured(): boolean {
    return true;
  }
  async send(msg: AlertMessage): Promise<void> {
    if (this.fail) throw new Error('bot token 123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawabcdef rejected');
    this.sent.push(msg);
  }
}

describe('alerts', () => {
  it('stores every alert, dedupes pushes for 24 h unless the severity escalates, records deliveries', async () => {
    await setSetting(t.db, 'alerts', alertSettingsSchema.parse({ telegram: true, email: false, minSeverity: 'warn' }));
    const tg = new FakeChannel('telegram');
    const mail = new FakeChannel('email');
    const channels = [tg, mail];
    const input = { kind: 'source_failed', severity: 'warn' as const, title: 'Source X failed', body: 'details', dedupeKey: 'source_failed:1' };

    const a = await raiseAlert(t.db, input, { now: NOW, channels });
    expect(a).toMatchObject({ created: true, notified: ['telegram'] });
    expect(mail.sent.length).toBe(0); // email not enabled in settings

    const b = await raiseAlert(t.db, input, { now: new Date(NOW.getTime() + HOUR_MS), channels });
    expect(b).toMatchObject({ alertId: a.alertId, created: false, notified: [] });

    const c = await raiseAlert(t.db, { ...input, severity: 'critical' }, { now: new Date(NOW.getTime() + 2 * HOUR_MS), channels });
    expect(c.notified).toEqual(['telegram']);
    expect(tg.sent[1]).toMatchObject({ severity: 'critical', occurrences: 3 });

    const d = await raiseAlert(t.db, input, { now: new Date(NOW.getTime() + 3 * HOUR_MS), channels });
    expect(d.notified).toEqual([]);
    const e = await raiseAlert(t.db, input, { now: new Date(NOW.getTime() + 27 * HOUR_MS), channels });
    expect(e.notified).toEqual(['telegram']);

    const [row] = await t.db.select().from(alerts).where(eq(alerts.id, a.alertId));
    expect(row).toMatchObject({ occurrences: 5, severity: 'warn' });
    expect((row.sentChannelsJson as { sends: unknown[] }).sends.length).toBe(3);

    // Acknowledged → the next raise is a new alert.
    await t.db.update(alerts).set({ acknowledgedAt: NOW }).where(eq(alerts.id, a.alertId));
    const f = await raiseAlert(t.db, input, { now: new Date(NOW.getTime() + 28 * HOUR_MS), channels });
    expect(f.created).toBe(true);
    expect(f.alertId).not.toBe(a.alertId);
  });

  it('below minSeverity is stored but not pushed; a failing channel is recorded without leaking secrets', async () => {
    await setSetting(t.db, 'alerts', alertSettingsSchema.parse({ telegram: true, email: true, minSeverity: 'warn' }));
    const tg = new FakeChannel('telegram');
    const mail = new FakeChannel('email');
    tg.fail = true;
    const info = await raiseAlert(t.db, { kind: 'note', severity: 'info', title: 'fyi' }, { now: NOW, channels: [tg, mail] });
    expect(info.notified).toEqual([]);
    expect(mail.sent.length).toBe(0);

    const r = await raiseAlert(t.db, { kind: 'x', severity: 'critical', title: 'boom' }, { now: NOW, channels: [tg, mail] });
    expect(r.notified).toEqual(['email']);
    const [row] = await t.db.select().from(alerts).where(eq(alerts.id, r.alertId));
    const json = JSON.stringify(row.sentChannelsJson);
    expect(json).toContain('"ok":false');
    expect(json).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');

    const stored = await raiseAlert(t.db, { kind: 'x', severity: 'critical', title: 'quiet' }, { now: NOW, channels: [tg, mail], notify: false });
    expect(stored.notified).toEqual([]);
    expect((await t.db.select().from(alerts)).length).toBe(3);
  });

  it('heartbeat: critical alert when no daily run succeeded within the threshold; healthcheck ping', async () => {
    await setSetting(t.db, 'alerts', alertSettingsSchema.parse({ heartbeatHours: 26 }));
    expect((await checkHeartbeat(t.db, { now: NOW, channels: [] })).status).toBe('no_reference');
    const fresh = await checkHeartbeat(t.db, { now: NOW, since: new Date(NOW.getTime() - 3 * HOUR_MS), channels: [] });
    expect(fresh.status).toBe('ok');

    await t.db.insert(pipelineRuns).values({ kind: 'daily', status: 'ok', requestedBy: 'cron', startedAt: ago(2), finishedAt: new Date(NOW.getTime() - 27 * HOUR_MS) });
    await t.db.insert(pipelineRuns).values({ kind: 'daily', status: 'failed', requestedBy: 'cron', startedAt: ago(0.5), finishedAt: ago(0.4) });
    await t.db.insert(pipelineRuns).values({ kind: 'manual', status: 'ok', requestedBy: 'cli', startedAt: ago(0.2), finishedAt: ago(0.1) });
    const late = await checkHeartbeat(t.db, { now: NOW, channels: [] });
    expect(late).toMatchObject({ status: 'alerted', thresholdHours: 26 });
    const [al] = await t.db.select().from(alerts).where(eq(alerts.dedupeKey, HEARTBEAT_DEDUPE_KEY));
    expect(al).toMatchObject({ kind: 'heartbeat', severity: 'critical' });

    await t.db.insert(pipelineRuns).values({ kind: 'daily', status: 'partial', requestedBy: 'cron', startedAt: ago(0.1), finishedAt: new Date(NOW.getTime() - HOUR_MS) });
    expect((await checkHeartbeat(t.db, { now: NOW, channels: [] })).status).toBe('ok');

    const seen: string[] = [];
    const okFetch = async (u: string) => (seen.push(u), new Response('ok', { status: 200 }));
    expect(await pingHealthcheck({ url: 'https://hc-ping.example/uuid', fetchImpl: okFetch })).toBe(true);
    expect(seen).toEqual(['https://hc-ping.example/uuid']);
    expect(await pingHealthcheck({ url: 'https://hc-ping.example/uuid', fetchImpl: async () => new Response('no', { status: 404 }) })).toBe(false);
    expect(await pingHealthcheck({ url: 'https://hc-ping.example/uuid', fetchImpl: async () => Promise.reject(new Error('down')) })).toBe(false);
    expect(await pingHealthcheck({ url: null })).toBe(false);
  });

  it('morning digest: once per local day, not before the digest hour, stored as kind digest and pushed', async () => {
    await setSetting(t.db, 'alerts', alertSettingsSchema.parse({ telegram: true, minSeverity: 'critical', digestHour: 8 }));
    const tg = new FakeChannel('telegram');
    const { jobId } = await seedJob(t.db, { title: 'Cloud Security Engineer' });
    await t.db.update(jobs).set({ state: 'new', firstSeenAt: new Date(NOW.getTime() - HOUR_MS) }).where(eq(jobs.id, jobId));

    const early = await sendMorningDigest(t.db, { now: NOW, tz: 'UTC', channels: [tg], appUrl: null });
    expect(early.status).toBe('too_early');

    const at9 = new Date('2026-09-30T09:00:00.000Z');
    const sent = await sendMorningDigest(t.db, { now: at9, tz: 'UTC', channels: [tg], appUrl: null });
    expect(sent.status).toBe('sent');
    expect(tg.sent.length).toBe(1); // pushed despite minSeverity 'critical'
    expect(tg.sent[0].kind).toBe('digest');
    expect(tg.sent[0].body).toContain('Cloud Security Engineer');
    const [row] = await t.db.select().from(alerts).where(eq(alerts.id, sent.alertId as number));
    expect(row).toMatchObject({ kind: 'digest', dedupeKey: 'digest:2026-09-30', severity: 'info' });

    const again = await sendMorningDigest(t.db, { now: new Date(at9.getTime() + HOUR_MS), tz: 'UTC', channels: [tg], force: true });
    expect(again).toMatchObject({ status: 'already_sent', alertId: sent.alertId });
    expect(tg.sent.length).toBe(1);

    await setSetting(t.db, 'alerts', alertSettingsSchema.parse({ digest: false }));
    expect((await sendMorningDigest(t.db, { now: new Date('2026-10-01T09:00:00.000Z'), tz: 'UTC', channels: [tg] })).status).toBe('disabled');
  });
});
