/**
 * Run bootstrap shared by the pipeline run, reprocessing and the link checker:
 * - the single-run lock (with heartbeat; losing it aborts the run),
 * - the `pipeline_runs` row (claimed from the queue or inserted), `started_at` = the run's fixed
 *   "now" (the canary check and every "seen at" of the run rely on it),
 * - clean-up of orphaned 'running' rows left by a crashed worker (safe: we hold the lock),
 * - one consistent view of the settings for the whole run.
 */
import { and, eq, inArray, ne } from 'drizzle-orm';
import { countries, pipelineRuns, sourceRuns } from '../../db/schema';
import type { AlertChannel } from '../alerts';
import type { ConnectorModule } from '../connectors';
import type { FxTable } from '../contracts/jobs';
import type { Db } from '../db';
import { getFxTable } from '../fx/ecb';
import type { PoliteHttpDeps } from '../http/polite';
import { log as rootLog, type Logger } from '../log';
import { getSetting } from '../settings';
import { acquireLock, acquireLockWithWait, LINKCHECK_LOCK, lockOwnerId, PIPELINE_LOCK, readLock, startHeartbeat, type LockHandle } from './lock';
import type { RunKind, RunRequester } from './queue';
import type { RunStatus } from './report';
import type { RunSettings } from './stages/context';
import { errorText } from './stages/dbutil';
import { logicVersions } from './versions';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyConnector = ConnectorModule<any>;

/** Injection points (tests use fake connectors / HTTP / clock; production uses the defaults). */
export interface PipelineDeps {
  connectors?: (platformKey: string) => AnyConnector | null;
  http?: PoliteHttpDeps;
  channels?: readonly AlertChannel[];
  /** Clock for the run's fixed "now" and row timestamps. The lock always uses real time. */
  now?: () => Date;
  /** How long a run waits for the lock (default: 20 min for daily runs, 0 otherwise). */
  lockWaitMs?: number;
  lockPollMs?: number;
  heartbeatMs?: number;
  sourceConcurrency?: number;
  logger?: Logger;
}

export interface RunOutcome {
  runId: number | null;
  status: RunStatus;
  stats: Record<string, unknown>;
}

export interface BeginRunInput {
  kind: RunKind;
  dryRun: boolean;
  requestedBy: RunRequester;
  /** Execute this queued row instead of inserting a new one. */
  queuedRunId?: number;
  lockName: typeof PIPELINE_LOCK | typeof LINKCHECK_LOCK;
  waitMs: number;
  signal?: AbortSignal;
  deps: PipelineDeps;
  /** Parameters kept in stats_json.params. */
  params: Record<string, unknown>;
}

export interface ActiveRun {
  runId: number;
  /** Fixed run start. */
  now: Date;
  owner: string;
  lock: LockHandle;
  /** Aborted by the caller's signal or when the lock is lost. */
  signal: AbortSignal;
  log: Logger;
  params: Record<string, unknown>;
  /** Stops the heartbeat and releases the lock. Idempotent. */
  end(): Promise<void>;
}

export type BeginRunResult = { started: true; run: ActiveRun } | { started: false; outcome: RunOutcome };

const clockOf = (deps: PipelineDeps) => deps.now ?? (() => new Date());

/** Marks 'running' rows of the same lock family (other than `keepRunId`) as failed. */
async function failOrphanedRuns(db: Db, lockName: string, keepRunId: number, now: Date, dryRun: boolean, reason: string): Promise<number[]> {
  const kindCond = lockName === LINKCHECK_LOCK ? eq(pipelineRuns.kind, 'linkcheck') : ne(pipelineRuns.kind, 'linkcheck');
  const rows = await db
    .select({ id: pipelineRuns.id })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.status, 'running'), ne(pipelineRuns.id, keepRunId), kindCond));
  const ids = rows.map((r) => r.id);
  if (!ids.length) return [];
  await db
    .update(pipelineRuns)
    .set({ status: 'failed', finishedAt: now, error: reason.slice(0, 2000) })
    .where(and(inArray(pipelineRuns.id, ids), eq(pipelineRuns.status, 'running')));
  if (!dryRun) {
    await db
      .update(sourceRuns)
      .set({ status: 'failed', finishedAt: now, error: 'run interrupted before this source finished' })
      .where(and(inArray(sourceRuns.runId, ids), eq(sourceRuns.status, 'running')));
  }
  return ids;
}

/**
 * Takes the lock and creates / claims the run row. When the lock is busy: a queued row stays
 * queued (the worker retries it later); any other request is recorded as a 'skipped' run.
 */
export async function beginRun(db: Db, input: BeginRunInput): Promise<BeginRunResult> {
  const clock = clockOf(input.deps);
  const logger = input.deps.logger ?? rootLog.child({ module: input.lockName === LINKCHECK_LOCK ? 'linkcheck' : 'pipeline' });
  const owner = lockOwnerId();
  const lock =
    input.waitMs > 0
      ? await acquireLockWithWait(db, { name: input.lockName, owner, waitMs: input.waitMs, pollMs: input.deps.lockPollMs, signal: input.signal })
      : await acquireLock(db, { name: input.lockName, owner });

  if (!lock) {
    const held = await readLock(db, input.lockName);
    const reason = `another run holds the ${input.lockName} lock${held?.runId ? ` (run ${held.runId})` : ''}`;
    if (input.queuedRunId !== undefined) {
      return { started: false, outcome: { runId: input.queuedRunId, status: 'queued', stats: { reason, heldByRunId: held?.runId ?? null } } };
    }
    const at = clock();
    const [res] = await db.insert(pipelineRuns).values({
      kind: input.kind,
      status: 'skipped',
      requestedBy: input.requestedBy,
      dryRun: input.dryRun,
      startedAt: at,
      finishedAt: at,
      error: reason,
      statsJson: { params: input.params, reason: 'locked', heldByRunId: held?.runId ?? null },
    });
    logger.warn('run skipped: lock busy', { kind: input.kind, heldByRunId: held?.runId ?? null });
    return { started: false, outcome: { runId: Number(res.insertId), status: 'skipped', stats: { reason, heldByRunId: held?.runId ?? null } } };
  }

  const now = clock();
  let runId: number;
  let params = input.params;
  try {
    if (input.queuedRunId !== undefined) {
      const [res] = await db
        .update(pipelineRuns)
        .set({ status: 'running', startedAt: now, lockOwner: owner, logicVersionsJson: logicVersions(), error: null })
        .where(and(eq(pipelineRuns.id, input.queuedRunId), eq(pipelineRuns.status, 'queued')));
      if (res.affectedRows !== 1) {
        await lock.release();
        const [row] = await db.select({ status: pipelineRuns.status }).from(pipelineRuns).where(eq(pipelineRuns.id, input.queuedRunId)).limit(1);
        return { started: false, outcome: { runId: input.queuedRunId, status: row?.status ?? 'skipped', stats: { reason: 'run is no longer queued' } } };
      }
      const [row] = await db.select({ statsJson: pipelineRuns.statsJson }).from(pipelineRuns).where(eq(pipelineRuns.id, input.queuedRunId)).limit(1);
      const stored = row?.statsJson && typeof row.statsJson === 'object' ? (row.statsJson as { params?: unknown }).params : undefined;
      if (stored && typeof stored === 'object') params = { ...(stored as Record<string, unknown>), ...input.params };
      runId = input.queuedRunId;
    } else {
      const [res] = await db.insert(pipelineRuns).values({
        kind: input.kind,
        status: 'running',
        requestedBy: input.requestedBy,
        dryRun: input.dryRun,
        startedAt: now,
        lockOwner: owner,
        logicVersionsJson: logicVersions(),
        statsJson: { params },
      });
      runId = Number(res.insertId);
    }
    await lock.setRunId(runId);
  } catch (err) {
    await lock.release().catch(() => undefined);
    throw err;
  }

  const runLog = logger.child({ runId });
  if (lock.takenOverFrom) {
    runLog.warn('took over a stale lock (previous holder stopped sending heartbeats)', { previousRunId: lock.takenOverFrom.runId });
  }
  const orphans = await failOrphanedRuns(db, input.lockName, runId, now, input.dryRun, `interrupted: the worker stopped before the run finished (lock taken over by run ${runId})`).catch(
    (err: unknown) => {
      runLog.warn('could not mark orphaned runs', { error: errorText(err, 300) });
      return [] as number[];
    },
  );
  if (orphans.length) runLog.warn('marked orphaned runs as failed', { runIds: orphans });

  const ac = new AbortController();
  const onOuterAbort = () => ac.abort(input.signal?.reason instanceof Error ? input.signal.reason : new Error('run aborted'));
  if (input.signal?.aborted) onOuterAbort();
  else input.signal?.addEventListener('abort', onOuterAbort, { once: true });
  const stopHeartbeat = startHeartbeat(lock, {
    intervalMs: input.deps.heartbeatMs,
    onLost: () => {
      runLog.error('pipeline lock lost (another worker took it over); aborting the run');
      ac.abort(new Error('lock lost: another worker took over the run lock'));
    },
  });
  let ended = false;
  return {
    started: true,
    run: {
      runId,
      now,
      owner,
      lock,
      signal: ac.signal,
      log: runLog,
      params,
      async end() {
        if (ended) return;
        ended = true;
        stopHeartbeat();
        input.signal?.removeEventListener('abort', onOuterAbort);
        await lock.release().catch((err: unknown) => runLog.warn('lock release failed (it expires by itself)', { error: errorText(err, 300) }));
      },
    },
  };
}

/** Final run row update. Guarded by status='running' (a takeover may already have failed it). */
export async function finishRun(
  db: Db,
  runId: number,
  input: { status: RunStatus; stats: Record<string, unknown>; error: string | null; finishedAt: Date },
): Promise<boolean> {
  const [res] = await db
    .update(pipelineRuns)
    .set({ status: input.status, finishedAt: input.finishedAt, statsJson: input.stats, error: input.error ? input.error.slice(0, 8000) : null })
    .where(and(eq(pipelineRuns.id, runId), eq(pipelineRuns.status, 'running')));
  return res.affectedRows === 1;
}

export interface LoadedRunSettings {
  settings: RunSettings;
  fx: FxTable;
  knownCountries: Set<string>;
}

/** One view of the settings for the whole run (FX from the cache only: never waits on the network). */
export async function loadRunSettings(db: Db): Promise<LoadedRunSettings> {
  const [profile, weights, alerts, titleOverrides, fx, countryRows] = await Promise.all([
    getSetting(db, 'profile'),
    getSetting(db, 'score_weights'),
    getSetting(db, 'alerts'),
    getSetting(db, 'title_overrides'),
    getFxTable(db),
    db.select({ iso2: countries.iso2 }).from(countries),
  ]);
  return {
    settings: { profile, weights, alerts, titleOverrides },
    fx,
    knownCountries: new Set(countryRows.map((r) => r.iso2)),
  };
}

/** Bounded-concurrency map preserving input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}
