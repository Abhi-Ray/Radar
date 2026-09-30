/**
 * Pipeline run orchestrator (daily / manual / dry run) and the queued-run executor.
 *
 *   lock + run row → settings → HTTP pool (daily caps seeded from today's runs) → sources
 *   (3 at a time; each isolated, see stages/source.ts) → lifecycle sweep → run report → run row.
 *
 * Once the run row exists nothing throws: every failure ends up in the run row (status, error,
 * stats_json) and, for a failed run, in a critical alert. A dry run writes only its run row
 * (plus the lock row) and reports what would have changed.
 */
import { and, asc, eq, gte, inArray, ne } from 'drizzle-orm';
import { pipelineRuns, sourcePlatforms, sources, type SourceRow } from '../../db/schema';
import { DEFAULT_ALERT_CHANNELS, raiseAlert } from '../alerts';
import { getConnector } from '../connectors';
import type { Db } from '../db';
import { PoliteHttpPool } from '../http/polite';
import { sweepLifecycle, type SweepResult } from '../lifecycle';
import { runLinkCheck } from '../linkcheck';
import { MINUTE_MS } from '../time';
import { PIPELINE_LOCK } from './lock';
import { queuedRunParams, type RunKind, type RunRequester } from './queue';
import { buildRunReport, formatRunSummary, type RunStatus, type SourceReport } from './report';
import { reprocessFromRaw } from './reprocess';
import { beginRun, finishRun, loadRunSettings, mapLimit, type ActiveRun, type PipelineDeps } from './runtime';
import type { RunContext } from './stages/context';
import { errorText } from './stages/dbutil';
import { notStartedReport, processSource } from './stages/source';

export interface PipelineRunResult {
  runId: number | null;
  status: RunStatus;
  stats: Record<string, unknown>;
}

export interface RunPipelineOptions {
  kind: RunKind;
  dryRun: boolean;
  /** Only these sources (any status except 'disabled'). Default: every 'trial' / 'live' source. */
  sourceIds?: number[];
  requestedBy?: RunRequester;
  signal?: AbortSignal;
  /** Execute this queued pipeline_runs row (its stored params are used). */
  runId?: number;
  deps?: PipelineDeps;
}

export const SOURCE_CONCURRENCY = 3;
/** A daily run waits this long for a manual run that still holds the lock. */
export const DAILY_LOCK_WAIT_MS = 20 * MINUTE_MS;
export const RUNNABLE_SOURCE_STATUSES = ['trial', 'live'] as const;

function cleanIds(ids: readonly unknown[] | undefined): number[] | undefined {
  if (!ids) return undefined;
  const out = [...new Set(ids.filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0))].sort((a, b) => a - b);
  return out.length ? out : undefined;
}

/** Requests per platform already made today (UTC) by other runs, from their stats_json.http. */
export function sumHttpUsage(statsList: readonly unknown[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const stats of statsList) {
    if (!stats || typeof stats !== 'object') continue;
    const http = (stats as { http?: unknown }).http;
    if (!http || typeof http !== 'object') continue;
    for (const [platform, s] of Object.entries(http as Record<string, unknown>)) {
      const n = s && typeof s === 'object' ? (s as { requests?: unknown }).requests : undefined;
      if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[platform] = (out[platform] ?? 0) + Math.floor(n);
    }
  }
  return out;
}

async function todaysHttpUsage(db: Db, now: Date, runId: number): Promise<Record<string, number>> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const rows = await db
    .select({ stats: pipelineRuns.statsJson })
    .from(pipelineRuns)
    .where(and(gte(pipelineRuns.startedAt, dayStart), ne(pipelineRuns.id, runId), eq(pipelineRuns.dryRun, false), ne(pipelineRuns.kind, 'linkcheck')));
  return sumHttpUsage(rows.map((r) => r.stats));
}

async function selectSources(db: Db, sourceIds: number[] | undefined): Promise<{ rows: SourceRow[]; unknownIds: number[] }> {
  if (sourceIds?.length) {
    const rows = await db
      .select()
      .from(sources)
      .where(and(inArray(sources.id, sourceIds), ne(sources.status, 'disabled')))
      .orderBy(asc(sources.id));
    const found = new Set(rows.map((r) => r.id));
    return { rows, unknownIds: sourceIds.filter((id) => !found.has(id)) };
  }
  const rows = await db
    .select()
    .from(sources)
    .where(inArray(sources.status, [...RUNNABLE_SOURCE_STATUSES]))
    .orderBy(asc(sources.id));
  return { rows, unknownIds: [] };
}

/**
 * Runs the pipeline. 'reprocess' delegates to reprocessFromRaw, 'linkcheck' to the link checker;
 * 'dry_run' implies dryRun. Returns status 'skipped' when another run holds the lock (a queued
 * run stays 'queued' instead, and is retried by the worker).
 */
export async function runPipeline(db: Db, opts: RunPipelineOptions): Promise<PipelineRunResult> {
  const deps = opts.deps ?? {};
  const requestedBy = opts.requestedBy ?? 'system';
  if (opts.kind === 'reprocess') {
    const r = await reprocessFromRaw(db, { sourceIds: opts.sourceIds, runId: opts.runId, requestedBy, signal: opts.signal, deps });
    return { runId: r.runId, status: r.status, stats: r.stats };
  }
  if (opts.kind === 'linkcheck') {
    const r = await runLinkCheck(db, { runId: opts.runId, requestedBy, signal: opts.signal, deps: { now: deps.now, logger: deps.logger, heartbeatMs: deps.heartbeatMs } });
    return { runId: r.runId, status: r.status, stats: r.stats };
  }
  const dryRun = opts.dryRun || opts.kind === 'dry_run';
  const sourceIds = cleanIds(opts.sourceIds);
  const begun = await beginRun(db, {
    kind: opts.kind,
    dryRun,
    requestedBy,
    queuedRunId: opts.runId,
    lockName: PIPELINE_LOCK,
    waitMs: deps.lockWaitMs ?? (opts.kind === 'daily' && opts.runId === undefined ? DAILY_LOCK_WAIT_MS : 0),
    signal: opts.signal,
    deps,
    params: sourceIds ? { sourceIds } : {},
  });
  if (!begun.started) return begun.outcome;
  const run = begun.run;
  try {
    return await executeRun(db, run, { kind: opts.kind, dryRun, deps });
  } finally {
    await run.end();
  }
}

async function executeRun(db: Db, run: ActiveRun, opts: { kind: RunKind; dryRun: boolean; deps: PipelineDeps }): Promise<PipelineRunResult> {
  const { deps, dryRun } = opts;
  const clock = deps.now ?? (() => new Date());
  const channels = deps.channels ?? DEFAULT_ALERT_CHANNELS;
  const sourceIds = cleanIds(queuedRunParams({ params: run.params })?.sourceIds);
  let reports: SourceReport[] = [];
  let unknownIds: number[] = [];
  let sweep: SweepResult | null = null;
  let sweepError: string | null = null;
  let fatal: string | null = null;
  let ctx: RunContext | null = null;
  let pool: PoliteHttpPool | null = null;

  try {
    const loaded = await loadRunSettings(db);
    ctx = {
      db,
      runId: run.runId,
      kind: opts.kind,
      dryRun,
      forced: false,
      now: run.now,
      settings: loaded.settings,
      fx: loaded.fx,
      knownCountries: loaded.knownCountries,
      signal: run.signal,
      channels,
      log: run.log,
      missingIncremented: new Set(),
      alerts: [],
      ruleCache: new Map(),
    };
    const platforms = await db.select().from(sourcePlatforms);
    pool = new PoliteHttpPool(deps.http ?? {}, await todaysHttpUsage(db, run.now, run.runId));
    for (const p of platforms) pool.setLimits(p.key, { rateLimitPerMin: p.rateLimitPerMin, dailyCap: p.dailyCap });
    const selected = await selectSources(db, sourceIds);
    unknownIds = selected.unknownIds;
    run.log.info('pipeline run started', { kind: opts.kind, dryRun, sources: selected.rows.length });
    const rt = {
      ctx,
      pool,
      platforms: new Map(platforms.map((p) => [p.key, p])),
      connectorFor: deps.connectors ?? getConnector,
      clock,
    };
    const context = ctx;
    reports = await mapLimit(selected.rows, deps.sourceConcurrency ?? SOURCE_CONCURRENCY, (s) =>
      context.signal.aborted ? Promise.resolve(notStartedReport(s, 'run aborted before this source started')) : processSource(rt, s),
    );
    if (!run.signal.aborted) {
      try {
        sweep = await sweepLifecycle(db, { now: run.now, runId: run.runId, dryRun, weights: ctx.settings.weights, profile: ctx.settings.profile, signal: run.signal });
      } catch (err) {
        sweepError = errorText(err, 1000);
        run.log.error('lifecycle sweep failed', { error: sweepError });
      }
    }
  } catch (err) {
    fatal = errorText(err, 2000);
    run.log.error('pipeline run failed', { error: fatal });
  }

  const abortReason = run.signal.aborted ? errorText(run.signal.reason ?? 'aborted', 500) : null;
  const report = buildRunReport({
    kind: opts.kind,
    dryRun,
    startedAt: run.now,
    finishedAt: clock(),
    sources: reports,
    sweep,
    sweepError,
    alerts: ctx?.alerts ?? [],
    http: pool?.stats() ?? {},
    aborted: abortReason,
  });
  if (fatal) report.status = 'failed';
  const failedSources = reports.filter((r) => r.status === 'failed');
  const error =
    fatal ??
    abortReason ??
    (report.status === 'failed'
      ? `all sources failed: ${failedSources
          .slice(0, 5)
          .map((s) => `${s.label}: ${s.error ?? 'unknown'}`)
          .join('; ')}`
      : null);
  const stats: Record<string, unknown> = { params: run.params, ...report, ...(unknownIds.length ? { unknownSourceIds: unknownIds } : {}) };

  try {
    const updated = await finishRun(db, run.runId, { status: report.status, stats, error, finishedAt: clock() });
    if (!updated) run.log.warn('run row was no longer running (taken over); final stats not stored');
  } catch (err) {
    run.log.error('storing the run result failed', { error: errorText(err, 500) });
  }
  run.log.info(formatRunSummary(report));

  if (report.status === 'failed' && !dryRun) {
    try {
      await raiseAlert(
        db,
        {
          kind: 'pipeline_failed',
          severity: 'critical',
          title: `Pipeline run ${run.runId} (${opts.kind}) failed`,
          body: error ?? 'unknown error',
          dedupeKey: 'pipeline_failed',
          entityType: 'pipeline_run',
          entityId: run.runId,
        },
        { now: clock(), channels, linkPath: '/system' },
      );
    } catch (err) {
      run.log.error('raising the pipeline_failed alert failed', { error: errorText(err, 300) });
    }
  }
  return { runId: run.runId, status: report.status, stats };
}

// ---- queued runs (UI → worker) ------------------------------------------------------------------

export interface ProcessQueuedResult {
  processed: number;
  /** Rows left queued because their lock was busy (retried on the next poll). */
  deferred: number;
  results: PipelineRunResult[];
}

/**
 * Executes queued runs oldest first. A run whose lock is busy stays queued and later rows of the
 * same lock family wait behind it (order is kept); rows with unreadable params are failed.
 */
export async function processQueuedRuns(db: Db, opts: { signal?: AbortSignal; deps?: PipelineDeps; max?: number } = {}): Promise<ProcessQueuedResult> {
  const max = Math.max(1, opts.max ?? 10);
  const rows = await db
    .select({ id: pipelineRuns.id, kind: pipelineRuns.kind, dryRun: pipelineRuns.dryRun, requestedBy: pipelineRuns.requestedBy, statsJson: pipelineRuns.statsJson })
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, 'queued'))
    .orderBy(asc(pipelineRuns.id))
    .limit(max);
  const out: ProcessQueuedResult = { processed: 0, deferred: 0, results: [] };
  const busy = new Set<string>();
  const requesters: readonly string[] = ['ui', 'cron', 'cli', 'system'];
  for (const row of rows) {
    if (opts.signal?.aborted) break;
    const family = row.kind === 'linkcheck' ? 'linkcheck' : 'pipeline';
    if (busy.has(family)) {
      out.deferred++;
      continue;
    }
    const params = queuedRunParams(row.statsJson);
    if (!params) {
      const now = (opts.deps?.now ?? (() => new Date()))();
      await db
        .update(pipelineRuns)
        .set({ status: 'failed', startedAt: now, finishedAt: now, error: 'invalid queued run parameters (stats_json.params)' })
        .where(and(eq(pipelineRuns.id, row.id), eq(pipelineRuns.status, 'queued')));
      out.results.push({ runId: row.id, status: 'failed', stats: { reason: 'invalid params' } });
      out.processed++;
      continue;
    }
    const res = await runPipeline(db, {
      kind: row.kind,
      dryRun: row.dryRun,
      sourceIds: params.sourceIds,
      requestedBy: (requesters.includes(row.requestedBy) ? row.requestedBy : 'ui') as RunRequester,
      signal: opts.signal,
      runId: row.id,
      deps: opts.deps,
    });
    out.results.push(res);
    if (res.status === 'queued') {
      busy.add(family);
      out.deferred++;
    } else out.processed++;
  }
  return out;
}
