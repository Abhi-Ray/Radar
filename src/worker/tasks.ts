/**
 * Named worker tasks shared by the scheduler (src/worker/index.ts) and the CLI (src/worker/cli.ts).
 * Each task logs its own outcome and returns a small JSON-able summary; errors propagate to the
 * caller (the scheduler logs them, the CLI exits non-zero).
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { sql } from 'drizzle-orm';
import { getAiBudget, runAiQueue } from '../lib/ai';
import { raiseAlert } from '../lib/alerts';
import { sendMorningDigest } from '../lib/alerts/digest';
import { checkHeartbeat, pingHealthcheck } from '../lib/alerts/heartbeat';
import type { Db } from '../lib/db';
import { resolveMigrationsDir } from '../lib/db/migrations';
import { getEnvVar } from '../lib/env';
import { ensureFxRates } from '../lib/fx/ecb';
import { runRetention } from '../lib/lifecycle/retention';
import { runLinkCheck } from '../lib/linkcheck';
import { log } from '../lib/log';
import { processQueuedRuns, reprocessFromRaw, runPipeline } from '../lib/pipeline';
import type { RunRequester } from '../lib/pipeline/queue';
import { getSetting } from '../lib/settings';
import { aiBatchCalls } from './ai-batch';

export type TaskResult = Record<string, unknown>;

export interface TaskContext {
  db: Db;
  requestedBy: RunRequester;
  /**
   * Worker start: the heartbeat reference before the first successful daily run. Null for one-shot
   * CLI tasks (a process that just started says nothing about whether the pipeline ran).
   */
  startedAt: Date | null;
  signal?: AbortSignal;
}

const tlog = log.child({ module: 'worker' });

// ---------------------------------------------------------------- pipeline

export async function dailyPipelineTask(ctx: TaskContext, opts: { sourceIds?: number[] } = {}): Promise<TaskResult> {
  const res = await runPipeline(ctx.db, { kind: 'daily', dryRun: false, sourceIds: opts.sourceIds, requestedBy: ctx.requestedBy, signal: ctx.signal });
  if (res.status === 'ok' || res.status === 'partial') {
    const pinged = await pingHealthcheck();
    const digest = await sendMorningDigest(ctx.db).catch((err: unknown) => {
      tlog.warn('digest after daily run failed', { error: err });
      return null;
    });
    return { runId: res.runId, status: res.status, pinged, digest: digest?.status ?? 'error' };
  }
  return { runId: res.runId, status: res.status };
}

export async function manualPipelineTask(ctx: TaskContext, opts: { dryRun: boolean; sourceIds?: number[] }): Promise<TaskResult> {
  const res = await runPipeline(ctx.db, {
    kind: opts.dryRun ? 'dry_run' : 'manual',
    dryRun: opts.dryRun,
    sourceIds: opts.sourceIds,
    requestedBy: ctx.requestedBy,
    signal: ctx.signal,
  });
  return { runId: res.runId, status: res.status, stats: res.stats };
}

export async function reprocessTask(ctx: TaskContext, opts: { sourceIds?: number[]; since?: Date }): Promise<TaskResult> {
  const res = await reprocessFromRaw(ctx.db, { sourceIds: opts.sourceIds, since: opts.since });
  return { ...res };
}

export async function queuedRunsTask(ctx: TaskContext): Promise<TaskResult> {
  const res = await processQueuedRuns(ctx.db, { signal: ctx.signal });
  return { ...res };
}

// ---------------------------------------------------------------- maintenance

export async function linkCheckTask(ctx: TaskContext, opts: { batch?: number } = {}): Promise<TaskResult> {
  const res = await runLinkCheck(ctx.db, { batch: opts.batch ?? 150, signal: ctx.signal, requestedBy: ctx.requestedBy });
  return { ...res };
}

export async function fxTask(ctx: TaskContext): Promise<TaskResult> {
  const res = await ensureFxRates(ctx.db, { force: true });
  if (res.error || res.outdated) {
    await raiseAlert(ctx.db, {
      kind: 'fx',
      severity: res.setting ? 'warn' : 'critical',
      title: res.setting ? `FX rates refresh failed (using rates of ${res.setting.date})` : 'FX rates unavailable',
      body: [res.error ? `Error: ${res.error}` : null, res.outdated ? 'The cached ECB reference date is older than 5 days.' : null]
        .filter(Boolean)
        .join('\n'),
      dedupeKey: 'fx:refresh',
      entityType: 'settings',
      entityId: 'fx_rates',
    });
  }
  return { refreshed: res.refreshed, date: res.setting?.date ?? null, error: res.error, outdated: res.outdated };
}

type ModuleFn = (db: Db) => Promise<unknown>;

/**
 * Loads an optional module owned by another step. A missing module or export is a logged skip, so
 * the worker runs before that step lands.
 */
async function optionalTask(name: string, load: () => Promise<unknown>, exportName: string, db: Db): Promise<TaskResult> {
  let mod: unknown;
  try {
    mod = await load();
  } catch (err) {
    tlog.warn(`${name}: module not available, skipped`, { error: err instanceof Error ? err.message : String(err) });
    return { skipped: 'module_unavailable' };
  }
  const fn = mod && typeof mod === 'object' ? (mod as Record<string, unknown>)[exportName] : undefined;
  if (typeof fn !== 'function') {
    tlog.warn(`${name}: ${exportName}() not exported, skipped`);
    return { skipped: 'export_missing' };
  }
  const out = await (fn as ModuleFn)(db);
  return { result: out && typeof out === 'object' ? (out as Record<string, unknown>) : (out ?? null) };
}

export async function registersTask(ctx: TaskContext): Promise<TaskResult> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- owned by the registers step; absent until it lands (graceful skip).
  return optionalTask('registers', () => import('../lib/registers'), 'refreshRegisters', ctx.db);
}

export async function officialPagesTask(ctx: TaskContext): Promise<TaskResult> {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore -- owned by the visa-rules step; absent until it lands (graceful skip).
  return optionalTask('official pages', () => import('../lib/visa/rules'), 'checkOfficialPages', ctx.db);
}

export async function aiQueueTask(ctx: TaskContext, opts: { maxCalls?: number; now?: Date } = {}): Promise<TaskResult> {
  const now = opts.now ?? new Date();
  const budget = await getAiBudget(ctx.db, now);
  if (!budget.enabled) return { skipped: 'ai_disabled' };
  // Scheduled batches leave the manual reserve untouched: the morning batch takes half of what is
  // left, the afternoon batch the rest of the day's budget.
  const available = Math.max(0, budget.remaining - budget.reserveForManual);
  const maxCalls = aiBatchCalls(available, now, opts.maxCalls);
  if (maxCalls <= 0) return { skipped: 'budget_exhausted', remaining: budget.remaining };
  const res = await runAiQueue(ctx.db, { maxCalls });
  return { maxCalls, ...res };
}

export async function heartbeatTask(ctx: TaskContext): Promise<TaskResult> {
  const hb = await checkHeartbeat(ctx.db, { since: ctx.startedAt });
  // The digest waits for the local digest hour; checking hourly catches it (once per day).
  const digest = await sendMorningDigest(ctx.db).catch((err: unknown) => {
    tlog.warn('digest check failed', { error: err });
    return null;
  });
  return { heartbeat: hb.status, hoursSince: hb.hoursSince, digest: digest?.status ?? 'error' };
}

export async function digestTask(ctx: TaskContext, opts: { force?: boolean } = {}): Promise<TaskResult> {
  return { ...(await sendMorningDigest(ctx.db, { force: opts.force })) };
}

export async function retentionTask(ctx: TaskContext): Promise<TaskResult> {
  return { ...(await runRetention(ctx.db)) };
}

// ---------------------------------------------------------------- startup

function expectedMigrations(): number {
  try {
    let explicit: string | undefined;
    try {
      explicit = getEnvVar('MIGRATIONS_DIR');
    } catch {
      explicit = undefined;
    }
    const dir = resolveMigrationsDir(explicit);
    const journal = JSON.parse(readFileSync(path.join(dir, 'meta', '_journal.json'), 'utf8')) as { entries?: unknown[] };
    return Array.isArray(journal.entries) ? journal.entries.length : 1;
  } catch {
    return 1;
  }
}

/** Resolves once the migrator has applied every migration this build ships (polls every 5 s). */
export async function waitForMigrations(db: Db, opts: { signal?: AbortSignal; intervalMs?: number } = {}): Promise<void> {
  const need = expectedMigrations();
  let attempt = 0;
  for (;;) {
    if (opts.signal?.aborted) throw new Error('aborted while waiting for migrations');
    attempt++;
    try {
      const [rows] = (await db.execute(sql`SELECT COUNT(*) AS n FROM \`__drizzle_migrations\``)) as unknown as [{ n: number | string }[]];
      const n = Number(rows[0]?.n ?? 0);
      if (n >= need) {
        await getSetting(db, 'alerts');
        return;
      }
      if (attempt === 1 || attempt % 12 === 0) tlog.info('waiting for migrations', { applied: n, expected: need });
    } catch (err) {
      if (attempt === 1 || attempt % 12 === 0) tlog.info('waiting for the migrations table', { error: err instanceof Error ? err.message : String(err) });
    }
    await new Promise((r) => setTimeout(r, opts.intervalMs ?? 5_000));
  }
}
