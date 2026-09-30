/**
 * DB-backed foundation tests (one ephemeral MySQL): settings store + audit, nested transactions,
 * the run queue, alerts dedupe and the minimal tracker.
 */
import { readFileSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { asc, eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  alerts,
  applicationEvents,
  applications,
  applicationSnapshots,
  auditLog,
  jobs,
  pipelineRuns,
  resumeVersions,
  settings,
} from '../../src/db/schema';
import { audit } from '../../src/lib/audit';
import { raiseAlert } from '../../src/lib/alerts';
import { DEFAULTED_SETTING_KEYS, defaultSetting } from '../../src/lib/contracts/settings';
import { connect, withTransaction } from '../../src/lib/db';
import { isRetryableTxError } from '../../src/lib/pipeline/stages/dbutil';
import { resolveMigrationsDir, runMigrations, waitForDb } from '../../src/lib/db/migrations';
import { enqueueRun, EnqueueRunError } from '../../src/lib/pipeline/queue';
import { addFact } from '../../src/lib/provenance/store';
import { ensureDefaultSettings, getSetting, getSettingRaw, setSetting } from '../../src/lib/settings';
import { addApplicationEvent, createApplicationFromJob, MAX_EVENT_BODY, TrackerError } from '../../src/lib/tracker';
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

describe('connections', () => {
  it('run at READ COMMITTED (row locks only)', async () => {
    const [rows] = (await t.db.execute(sql`select @@session.transaction_isolation as level`)) as unknown as [{ level: string }[]];
    expect(rows[0].level).toBe('READ-COMMITTED');
  });

  // Regression: under REPEATABLE READ the pipeline's concurrent writers deadlocked on job_facts
  // (gap locks: "deactivate the old fact, insert the new one" for brand-new jobs at the end of the
  // index) and 3.5% of the first production run ended up in dead_letters.
  it('concurrent first-fact writes for new jobs do not deadlock', async () => {
    const jobIds: number[] = [];
    for (let i = 0; i < 160; i++) jobIds.push((await seedJob(t.db, { title: `Deadlock probe ${i}`, applyUrl: `https://example.com/probe/${i}` })).jobId);
    const handle = connect(t.url);
    try {
      const conns = await Promise.all(Array.from({ length: 8 }, () => handle.pool.getConnection()));
      let deadlocks = 0;
      await Promise.all(
        conns.map(async (c, w) => {
          for (let i = w; i < jobIds.length; i += 8) {
            try {
              await c.beginTransaction();
              await c.query("update job_facts set is_active = 0 where job_id = ? and fact_key = 'role' and is_active = 1", [jobIds[i]]);
              await c.query(
                "insert into job_facts (job_id, fact_key, value_json, value_hash, source, method, confidence, logic_version, is_active) values (?, 'role', '{}', sha2(?, 256), 'test', 'rule', 'high', 't', 1)",
                [jobIds[i], String(jobIds[i])],
              );
              await c.commit();
            } catch (err) {
              await c.rollback().catch(() => undefined);
              if (isRetryableTxError(err)) deadlocks++;
              else throw err;
            }
          }
        }),
      );
      conns.forEach((c) => c.release());
      expect(deadlocks).toBe(0);
    } finally {
      await handle.pool.end();
    }
  });
});

describe('migrations', () => {
  const DRIZZLE = path.resolve(__dirname, '../../drizzle');
  const RESERVED_PORTS = new Set([3000, 3001, 3306, 3399]);

  it('resolves the folder; an explicit MIGRATIONS_DIR is strict (no silent fallback)', () => {
    expect(resolveMigrationsDir(DRIZZLE)).toBe(DRIZZLE);
    expect(resolveMigrationsDir(undefined)).toBe(DRIZZLE);
    expect(() => resolveMigrationsDir('/definitely/not/a/migrations/dir')).toThrow(/MIGRATIONS_DIR has no meta\/_journal\.json/);
  });

  it('is idempotent: every journal entry is applied exactly once', async () => {
    const journal = JSON.parse(readFileSync(path.join(DRIZZLE, 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
    const res = await runMigrations(t.url, DRIZZLE);
    expect(res.appliedBefore).toBe(journal.entries.length);
    expect(res.appliedAfter).toBe(journal.entries.length);
  });

  it('waitForDb returns for a live server and gives up (without leaking the URL) on a dead one', async () => {
    await expect(waitForDb(t.url, { timeoutMs: 5_000 })).resolves.toBeUndefined();
    const free = await new Promise<number>((resolve) => {
      const srv = net.createServer();
      srv.listen(0, '127.0.0.1', () => {
        const { port } = srv.address() as net.AddressInfo;
        srv.close(() => resolve(port));
      });
    });
    expect(RESERVED_PORTS.has(free)).toBe(false);
    const dead = `mysql://root:not-a-real-secret@127.0.0.1:${free}/radar`;
    const retries: number[] = [];
    const err = await waitForDb(dead, { timeoutMs: 1_200, intervalMs: 200, onRetry: (a) => retries.push(a) }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/database not reachable after \d+ attempts/);
    expect((err as Error).message).not.toContain('not-a-real-secret');
    expect(retries.length).toBeGreaterThan(0);
  });
});

describe('settings', () => {
  it('returns defaults when unset; fx_rates stays null', async () => {
    expect(await getSetting(t.db, 'profile')).toEqual(defaultSetting('profile'));
    expect(await getSetting(t.db, 'fx_rates')).toBeNull();
  });

  it('validates writes, bumps the version and audits before/after atomically', async () => {
    const weights = defaultSetting('score_weights');
    const first = await setSetting(t.db, 'ai', { ...defaultSetting('ai') }, { reason: 'initial' });
    expect(first).toEqual(defaultSetting('ai'));
    expect((await getSettingRaw(t.db, 'ai'))?.version).toBe(1);
    await setSetting(t.db, 'score_weights', weights);
    await setSetting(t.db, 'score_weights', weights, { reason: 'again', actor: 'cli' });
    expect((await getSettingRaw(t.db, 'score_weights'))?.version).toBe(2);

    const rows = await t.db.select().from(auditLog).where(eq(auditLog.entityId, 'score_weights')).orderBy(asc(auditLog.id));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ action: 'settings.update', entityType: 'settings', beforeJson: null, actor: 'admin' });
    expect(rows[1]).toMatchObject({ reason: 'again', actor: 'cli', beforeJson: weights });

    await expect(setSetting(t.db, 'retention', { rawDays: -5 })).rejects.toThrow();
    expect(await getSettingRaw(t.db, 'retention')).toBeNull();
    await setSetting(t.db, 'title_overrides', {}, { skipAudit: true });
    expect(await t.db.select().from(auditLog).where(eq(auditLog.entityId, 'title_overrides'))).toHaveLength(0);
  });

  it('an invalid stored row falls back to defaults with a warning (no crash)', async () => {
    const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    await t.db.insert(settings).values({ key: 'alerts', valueJson: { channels: 'not-an-object', minSeverity: 42 }, version: 1 });
    expect(await getSetting(t.db, 'alerts')).toEqual(defaultSetting('alerts'));
    expect(warn.mock.calls.map((c) => String(c[0])).join('')).toContain('settings: stored value invalid');
    warn.mockRestore();
  });

  it('ensureDefaultSettings only fills missing keys and never overwrites edits', async () => {
    const edited = { ...defaultSetting('ai'), enabled: !defaultSetting('ai').enabled };
    await setSetting(t.db, 'ai', edited);
    const created = await ensureDefaultSettings(t.db);
    expect(created.sort()).toEqual(DEFAULTED_SETTING_KEYS.filter((k) => k !== 'ai').sort());
    expect(await ensureDefaultSettings(t.db)).toEqual([]);
    expect(await getSetting(t.db, 'ai')).toEqual(edited);
    expect(await getSettingRaw(t.db, 'fx_rates')).toBeNull();
  });
});

describe('audit', () => {
  it('redacts secrets in before/after and bounds field sizes', async () => {
    await audit(t.db, {
      action: `x.${'a'.repeat(200)}`,
      entityType: 'settings',
      entityId: 42,
      before: { apiKey: 'sk-or-v1-abcdefghijklmnop1234', note: 'ok' },
      after: { url: 'smtp://mailer:mailpass@smtp.example:587' },
      reason: 'r'.repeat(10_000),
      ip: '203.0.113.5',
      actor: 'system',
    });
    const [row] = await t.db.select().from(auditLog);
    expect(row.action).toHaveLength(96);
    expect(row.entityId).toBe('42');
    expect(row.beforeJson).toEqual({ apiKey: '[REDACTED]', note: 'ok' });
    expect(JSON.stringify(row.afterJson)).not.toContain('mailpass');
    expect(row.reason).toHaveLength(4000);
    expect(row).toMatchObject({ ip: '203.0.113.5', actor: 'system' });
  });
});

describe('withTransaction', () => {
  it('nests as a savepoint: an inner failure rolls back only the inner work', async () => {
    await withTransaction(t.db, async (tx) => {
      await audit(tx, { action: 'outer', entityType: 'test' });
      await expect(
        withTransaction(tx, async (inner) => {
          await audit(inner, { action: 'inner', entityType: 'test' });
          throw new Error('inner boom');
        }),
      ).rejects.toThrow('inner boom');
    });
    const actions = (await t.db.select().from(auditLog)).map((r) => r.action);
    expect(actions).toEqual(['outer']);

    await expect(
      withTransaction(t.db, async (tx) => {
        await audit(tx, { action: 'doomed', entityType: 'test' });
        throw new Error('outer boom');
      }),
    ).rejects.toThrow('outer boom');
    expect((await t.db.select().from(auditLog)).map((r) => r.action)).toEqual(['outer']);
  });
});

describe('enqueueRun', () => {
  it('queues runs and dedupes an identical queued run', async () => {
    const a = await enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [3, 1, 3] });
    expect(a.created).toBe(true);
    expect(await enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [1, 3] })).toEqual({ runId: a.runId, created: false });
    expect((await enqueueRun(t.db, { kind: 'manual', dryRun: true, sourceIds: [1, 3] })).created).toBe(true);
    expect((await enqueueRun(t.db, { kind: 'manual', dryRun: false })).created).toBe(true);
    expect((await enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [] })).created).toBe(false);
    expect((await enqueueRun(t.db, { kind: 'reprocess', dryRun: false, requestedBy: 'cli' })).created).toBe(true);

    const [row] = await t.db.select().from(pipelineRuns).where(eq(pipelineRuns.id, a.runId));
    expect(row).toMatchObject({ kind: 'manual', status: 'queued', requestedBy: 'ui', dryRun: false, statsJson: { params: { sourceIds: [1, 3] } } });

    // Once the worker picks it up, the same request queues a new run.
    await t.db.update(pipelineRuns).set({ status: 'running' }).where(eq(pipelineRuns.id, a.runId));
    const b = await enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [1, 3] });
    expect(b.created).toBe(true);
    expect(b.runId).not.toBe(a.runId);
  });

  it('dedupes concurrent double-clicks', async () => {
    const results = await Promise.all(Array.from({ length: 5 }, () => enqueueRun(t.db, { kind: 'daily', dryRun: false, requestedBy: 'cron' })));
    expect(new Set(results.map((r) => r.runId)).size).toBe(1);
    expect(results.filter((r) => r.created)).toHaveLength(1);
  });

  it('rejects invalid input', async () => {
    await expect(enqueueRun(t.db, { kind: 'nightly' as never, dryRun: false })).rejects.toBeInstanceOf(EnqueueRunError);
    await expect(enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [0] })).rejects.toBeInstanceOf(EnqueueRunError);
    await expect(enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: [1.5] })).rejects.toBeInstanceOf(EnqueueRunError);
    await expect(enqueueRun(t.db, { kind: 'manual', dryRun: false, sourceIds: 'all' as never })).rejects.toBeInstanceOf(EnqueueRunError);
    expect(await t.db.select().from(pipelineRuns)).toHaveLength(0);
  });
});

describe('raiseAlert', () => {
  it('stores alerts, bumps an open duplicate and starts over after acknowledgement', async () => {
    const first = await raiseAlert(t.db, { kind: 'source_failing', severity: 'warn', title: 'Source 12 failing', dedupeKey: 'source:12', entityType: 'source', entityId: 12 });
    expect(first.created).toBe(true);
    const again = await raiseAlert(t.db, { kind: 'source_failing', severity: 'critical', title: 'Source 12 still failing', body: '3 runs', dedupeKey: 'source:12' });
    expect(again).toEqual({ alertId: first.alertId, created: false });
    let [row] = await t.db.select().from(alerts).where(eq(alerts.id, first.alertId));
    expect(row).toMatchObject({ occurrences: 2, severity: 'critical', title: 'Source 12 still failing', body: '3 runs', entityType: 'source', entityId: '12' });

    await t.db.update(alerts).set({ acknowledgedAt: new Date() }).where(eq(alerts.id, first.alertId));
    const fresh = await raiseAlert(t.db, { kind: 'source_failing', severity: 'warn', title: 'Source 12 failing', dedupeKey: 'source:12' });
    expect(fresh.created).toBe(true);
    [row] = await t.db.select().from(alerts).where(eq(alerts.id, fresh.alertId));
    expect(row.occurrences).toBe(1);

    // No dedupe key → always a new row.
    await raiseAlert(t.db, { kind: 'misc', severity: 'info', title: 'x' });
    await raiseAlert(t.db, { kind: 'misc', severity: 'info', title: 'x' });
    expect(await t.db.select().from(alerts).where(eq(alerts.kind, 'misc'))).toHaveLength(2);
  });

  it('redacts secrets and bounds sizes', async () => {
    const { alertId } = await raiseAlert(t.db, {
      kind: '  ',
      severity: 'critical',
      title: `  login to mysql://radar:dbsecret@db/radar failed ${'!'.repeat(400)}`,
      body: 'token sk-or-v1-abcdefghijklmnopqrstuv leaked?',
    });
    const [row] = await t.db.select().from(alerts).where(eq(alerts.id, alertId));
    expect(row.kind).toBe('general');
    expect(row.title.length).toBeLessThanOrEqual(255);
    expect(row.title).not.toContain('dbsecret');
    expect(row.body).not.toContain('abcdefghijklmnopqrstuv');
  });
});

describe('tracker', () => {
  const posting = 'About us\nWe secure clouds.\n\nRequirements\n- AWS\n- Terraform\n\nBenefits\n- Lunch';

  it('saves, then applies (snapshot + applied_at), never moving backwards', async () => {
    const { jobId } = await seedJob(t.db, { title: 'Cloud Security Engineer', companyName: 'Initech', descriptionText: posting });
    await addFact(t.db, jobId, 'salary', {
      value: { annualEurMin: 70_000, annualEurMax: 90_000, kind: 'stated' },
      evidence: '€70k–€90k',
      source: 'posting',
      method: 'posting',
      confidence: 'high',
      checkedAt: new Date(),
      logicVersion: 'test-1',
    });

    const saved = await createApplicationFromJob(t.db, jobId, { stage: 'saved', note: '  looks good  ' });
    expect(saved).toMatchObject({ created: true, snapshotId: null });
    const [app] = await t.db.select().from(applications).where(eq(applications.id, saved.applicationId));
    expect(app).toMatchObject({ jobId, companyName: 'Initech', title: 'Cloud Security Engineer', currentStage: 'saved', appliedAt: null, countryIso2: 'DE' });
    expect(app.source).toMatch(/^greenhouse:/);
    expect((await t.db.select().from(jobs).where(eq(jobs.id, jobId)))[0].saved).toBe(true);
    const [created] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'application.create'));
    expect(created.entityId).toBe(String(saved.applicationId));

    const applied = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    expect(applied.applicationId).toBe(saved.applicationId);
    expect(applied.created).toBe(false);
    expect(applied.snapshotId).not.toBeNull();
    const [after] = await t.db.select().from(applications).where(eq(applications.id, saved.applicationId));
    expect(after.currentStage).toBe('applied');
    expect(after.appliedAt).toBeInstanceOf(Date);

    const [snap] = await t.db.select().from(applicationSnapshots).where(eq(applicationSnapshots.id, applied.snapshotId!));
    expect(snap.requirementsText).toBe('- AWS\n- Terraform');
    expect(snap.jobJson).toMatchObject({ jobId, company: 'Initech', descriptionText: posting });
    expect(snap.salaryJson).toMatchObject({ method: 'posting', value: { annualEurMin: 70_000 } });

    // Applying again / saving again changes nothing and takes no second snapshot.
    const again = await createApplicationFromJob(t.db, jobId, { stage: 'saved' });
    expect(again).toEqual({ applicationId: saved.applicationId, created: false, snapshotId: null });
    await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    expect(await t.db.select().from(applicationSnapshots)).toHaveLength(1);
    const events = await t.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, saved.applicationId)).orderBy(asc(applicationEvents.id));
    expect(events.map((e) => [e.kind, e.stageFrom, e.stageTo, e.body])).toEqual([
      ['stage_change', null, 'saved', 'looks good'],
      ['stage_change', 'saved', 'applied', null],
    ]);
  });

  it('appends timeline events of every kind (append-only)', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: posting });
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    const moved = await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'screening', body: 'Recruiter call booked', meta: { interviewer: 'Sam' } });
    expect(moved).toMatchObject({ stageFrom: 'applied', stageTo: 'screening', snapshotId: null });
    const followUp = new Date('2026-10-05T04:30:00.000Z');
    await addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: followUp });
    await addApplicationEvent(t.db, applicationId, { kind: 'comment', body: 'x'.repeat(MAX_EVENT_BODY + 50) });
    const snap = await addApplicationEvent(t.db, applicationId, { kind: 'snapshot' });
    expect(snap.snapshotId).not.toBeNull();
    await addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: null });

    const [app] = await t.db.select().from(applications).where(eq(applications.id, applicationId));
    expect(app.currentStage).toBe('screening');
    expect(app.nextFollowUpAt).toBeNull();
    const events = await t.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId)).orderBy(asc(applicationEvents.id));
    expect(events.map((e) => e.kind)).toEqual(['stage_change', 'stage_change', 'follow_up_set', 'comment', 'snapshot', 'follow_up_set']);
    expect(events[1].metaJson).toEqual({ interviewer: 'Sam' });
    expect(events[2].metaJson).toEqual({ followUpAt: followUp.toISOString() });
    expect(events[3].body).toHaveLength(MAX_EVENT_BODY);
    expect(await t.db.select().from(applicationSnapshots)).toHaveLength(2);
  });

  it('rejects invalid input without partial writes', async () => {
    const { jobId } = await seedJob(t.db);
    await expect(createApplicationFromJob(t.db, jobId + 999, { stage: 'saved' })).rejects.toBeInstanceOf(TrackerError);
    await expect(createApplicationFromJob(t.db, jobId, { stage: 'offer' as never })).rejects.toBeInstanceOf(TrackerError);
    await expect(createApplicationFromJob(t.db, jobId, { stage: 'saved', resumeVersionId: 999 })).rejects.toBeInstanceOf(TrackerError);
    expect(await t.db.select().from(applications)).toHaveLength(0);
    expect((await t.db.select().from(jobs).where(eq(jobs.id, jobId)))[0].saved).toBe(false);

    const [rv] = await t.db.insert(resumeVersions).values({ name: 'Cloud v3', track: 'other', contentMd: '# CV' });
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'saved', resumeVersionId: Number(rv.insertId) });
    expect((await t.db.select().from(applications))[0].resumeVersionId).toBe(Number(rv.insertId));

    await expect(addApplicationEvent(t.db, applicationId + 999, { kind: 'comment', body: 'x' })).rejects.toBeInstanceOf(TrackerError);
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'comment', body: '   ' })).rejects.toBeInstanceOf(TrackerError);
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'hired' as never })).rejects.toBeInstanceOf(TrackerError);
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: new Date('nope') })).rejects.toBeInstanceOf(TrackerError);
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'bogus' } as never)).rejects.toBeInstanceOf(TrackerError);
    expect(await t.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, applicationId))).toHaveLength(1);
  });
});
