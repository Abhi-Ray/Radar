/**
 * Worker task wiring (src/worker/tasks.ts). The scheduler once called the register IMPORT alone, so
 * companies were never matched against the registers and no job ever got register evidence; these
 * tests pin the right calls and the after-run housekeeping.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => ({
  refreshRegistersAndEvidence: vi.fn(),
  checkOfficialPages: vi.fn(),
  runPipeline: vi.fn(),
  tidyDuplicateQueue: vi.fn(),
  ignoreUnrelatedTitles: vi.fn(),
  pingHealthcheck: vi.fn(),
  sendMorningDigest: vi.fn(),
}));

vi.mock('../../src/lib/visa/company-evidence', () => ({ refreshRegistersAndEvidence: m.refreshRegistersAndEvidence }));
vi.mock('../../src/lib/visa/rules', () => ({ checkOfficialPages: m.checkOfficialPages }));
vi.mock('../../src/lib/pipeline', () => ({ runPipeline: m.runPipeline, processQueuedRuns: vi.fn(), reprocessFromRaw: vi.fn() }));
vi.mock('../../src/lib/dedup/tidy', () => ({ tidyDuplicateQueue: m.tidyDuplicateQueue }));
vi.mock('../../src/lib/normalize/title-tidy', () => ({ ignoreUnrelatedTitles: m.ignoreUnrelatedTitles }));
vi.mock('../../src/lib/alerts/heartbeat', () => ({ checkHeartbeat: vi.fn(), pingHealthcheck: m.pingHealthcheck }));
vi.mock('../../src/lib/alerts/digest', () => ({ sendMorningDigest: m.sendMorningDigest }));

import { dailyPipelineTask, manualPipelineTask, officialPagesTask, registersTask, type TaskContext } from '../../src/worker/tasks';

const ctx = { db: { marker: 'db' }, requestedBy: 'cron', startedAt: null } as unknown as TaskContext;

beforeEach(() => {
  vi.clearAllMocks();
  m.tidyDuplicateQueue.mockResolvedValue({ merged: 3, dismissed: 40, failed: 0, needHuman: 2 });
  m.ignoreUnrelatedTitles.mockResolvedValue({ ignored: 17 });
  m.pingHealthcheck.mockResolvedValue(true);
  m.sendMorningDigest.mockResolvedValue({ status: 'sent' });
});

describe('registers and official pages', () => {
  it('registersTask imports the registers AND matches companies (refreshRegistersAndEvidence)', async () => {
    m.refreshRegistersAndEvidence.mockResolvedValue({
      registers: [{ key: 'uk_home_office', name: 'UK', status: 'imported', version: '2026-09-30', rows: 120000, inserted: 120000, kept: 0, removed: 0, reason: null }],
      evidence: { companies: 600, changed: 41, confirmed: 30, possible: 22, failed: 0, inserted: 52, updated: 0, removed: 0, durationMs: 1000 },
    });
    const out = await registersTask(ctx);
    expect(m.refreshRegistersAndEvidence).toHaveBeenCalledTimes(1);
    expect(m.refreshRegistersAndEvidence).toHaveBeenCalledWith((ctx as { db: unknown }).db);
    expect(out).toEqual({
      registers: [{ key: 'uk_home_office', status: 'imported', rows: 120000, inserted: 120000, reason: null }],
      evidence: { companies: 600, changed: 41, confirmed: 30, possible: 22, failed: 0 },
    });
  });

  it('registersTask reports "no evidence run" when no register could be checked', async () => {
    m.refreshRegistersAndEvidence.mockResolvedValue({ registers: [{ key: 'nl_ind', status: 'failed', rows: 0, inserted: 0, reason: 'HTTP 503' }], evidence: null });
    expect((await registersTask(ctx)).evidence).toBeNull();
  });

  it('officialPagesTask returns the counts and drops the per-page detail', async () => {
    m.checkOfficialPages.mockResolvedValue({ checked: 54, baseline: 0, unchanged: 52, changed: 1, errors: 1, pages: [{ big: 'detail' }] });
    expect(await officialPagesTask(ctx)).toEqual({ checked: 54, baseline: 0, unchanged: 52, changed: 1, errors: 1 });
  });
});

describe('review clean-up after a run', () => {
  it('a finished daily run tidies the queues, pings, sends the digest and reports the tidy counts', async () => {
    m.runPipeline.mockResolvedValue({ runId: 9, status: 'ok' });
    const out = await dailyPipelineTask(ctx);
    expect(m.tidyDuplicateQueue).toHaveBeenCalledWith((ctx as { db: unknown }).db, { actor: 'worker' });
    expect(m.ignoreUnrelatedTitles).toHaveBeenCalledWith((ctx as { db: unknown }).db, { actor: 'worker' });
    expect(out).toMatchObject({ runId: 9, status: 'ok', pinged: true, digest: 'sent', tidy: { duplicatesMerged: 3, duplicatesKeptBoth: 40, duplicatesNeedYou: 2, titlesIgnored: 17 } });
  });

  it('a failed daily run is not tidied (nothing new to clear, and the failure stays visible)', async () => {
    m.runPipeline.mockResolvedValue({ runId: 9, status: 'failed' });
    expect(await dailyPipelineTask(ctx)).toEqual({ runId: 9, status: 'failed' });
    expect(m.tidyDuplicateQueue).not.toHaveBeenCalled();
  });

  it('a title clean-up failure never fails the run', async () => {
    m.runPipeline.mockResolvedValue({ runId: 9, status: 'partial' });
    m.ignoreUnrelatedTitles.mockRejectedValue(new Error('boom'));
    const out = await dailyPipelineTask(ctx);
    expect(out).toMatchObject({ status: 'partial', tidy: { titlesIgnored: 0 } });
  });

  it('a manual run tidies, a dry run does not', async () => {
    m.runPipeline.mockResolvedValue({ runId: 4, status: 'ok', stats: {} });
    expect(await manualPipelineTask(ctx, { dryRun: false })).toHaveProperty('tidy');
    m.tidyDuplicateQueue.mockClear();
    expect(await manualPipelineTask(ctx, { dryRun: true })).not.toHaveProperty('tidy');
    expect(m.tidyDuplicateQueue).not.toHaveBeenCalled();
  });
});
