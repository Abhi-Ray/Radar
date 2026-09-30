/**
 * UI → worker run queue (brief §6b). The web app never runs the pipeline in-process: it inserts a
 * `pipeline_runs` row with status 'queued'; the worker polls and executes queued rows in order
 * (respecting the single-run lock). Real implementation provided by foundation; PIPELINE owns it.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { pipelineRuns } from '../../db/schema';
import { RUN_KINDS } from '../../db/schema/_enums';
import { withTransaction, type DbOrTx } from '../db';
import { canonicalJson } from '../hash';

export type RunKind = (typeof RUN_KINDS)[number];
export type RunRequester = 'ui' | 'cron' | 'cli' | 'system';

export interface EnqueueRunInput {
  kind: RunKind;
  dryRun: boolean;
  sourceIds?: number[];
  /** Default 'ui'. */
  requestedBy?: RunRequester;
}

export interface QueuedRunParams {
  sourceIds?: number[];
}

export class EnqueueRunError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EnqueueRunError';
  }
}

const MAX_SOURCE_IDS = 1000;
/**
 * Serialises enqueue calls. Without it, concurrent `SELECT … FOR UPDATE` on an empty range take
 * compatible gap locks and the following INSERTs deadlock each other (ER_LOCK_DEADLOCK).
 */
const ENQUEUE_LOCK_NAME = 'radar_enqueue_run';
const ENQUEUE_LOCK_TIMEOUT_SEC = 10;

function normaliseSourceIds(ids: number[] | undefined): number[] | undefined {
  if (ids === undefined) return undefined;
  if (!Array.isArray(ids)) throw new EnqueueRunError('sourceIds must be an array');
  const clean = [...new Set(ids)].sort((a, b) => a - b);
  if (clean.some((n) => !Number.isSafeInteger(n) || n <= 0)) throw new EnqueueRunError('sourceIds must be positive integers');
  if (clean.length > MAX_SOURCE_IDS) throw new EnqueueRunError(`at most ${MAX_SOURCE_IDS} sourceIds`);
  return clean.length ? clean : undefined;
}

/** The params stored in stats_json.params of a queued run (null when absent/invalid). */
export function queuedRunParams(statsJson: unknown): QueuedRunParams | null {
  if (!statsJson || typeof statsJson !== 'object') return null;
  const params = (statsJson as { params?: unknown }).params;
  if (!params || typeof params !== 'object') return null;
  const ids = (params as { sourceIds?: unknown }).sourceIds;
  if (ids === undefined) return {};
  if (!Array.isArray(ids) || ids.some((n) => !Number.isSafeInteger(n) || (n as number) <= 0)) return null;
  return { sourceIds: ids as number[] };
}

/**
 * Queues a pipeline run. An identical run that is still queued (same kind, dry-run flag and
 * params) is returned instead of adding a duplicate (double clicks, cron + manual overlap).
 */
export async function enqueueRun(db: DbOrTx, input: EnqueueRunInput): Promise<{ runId: number; created: boolean }> {
  if (!(RUN_KINDS as readonly string[]).includes(input.kind)) throw new EnqueueRunError(`unknown run kind: ${String(input.kind)}`);
  const sourceIds = normaliseSourceIds(input.sourceIds);
  const params: QueuedRunParams = sourceIds ? { sourceIds } : {};
  const dryRun = input.dryRun === true;
  const requestedBy: RunRequester = input.requestedBy ?? 'ui';

  return withTransaction(db, async (tx) => {
    const [lockRows] = (await tx.execute(sql`SELECT GET_LOCK(${ENQUEUE_LOCK_NAME}, ${ENQUEUE_LOCK_TIMEOUT_SEC}) AS got`)) as unknown as [{ got: number | string | null }[]];
    if (Number(lockRows[0]?.got) !== 1) throw new EnqueueRunError('the run queue is busy; try again');
    try {
      return await enqueueLocked(tx, input.kind, dryRun, requestedBy, params);
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${ENQUEUE_LOCK_NAME})`);
    }
  });
}

async function enqueueLocked(
  tx: DbOrTx,
  kind: RunKind,
  dryRun: boolean,
  requestedBy: RunRequester,
  params: QueuedRunParams,
): Promise<{ runId: number; created: boolean }> {
  const queued = await tx
    .select({ id: pipelineRuns.id, statsJson: pipelineRuns.statsJson })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.status, 'queued'), eq(pipelineRuns.kind, kind), eq(pipelineRuns.dryRun, dryRun)))
    .orderBy(asc(pipelineRuns.id))
    .for('update');
  const wanted = canonicalJson(params);
  const same = queued.find((r) => {
    const p = queuedRunParams(r.statsJson);
    return p !== null && canonicalJson(p) === wanted;
  });
  if (same) return { runId: same.id, created: false };
  const [res] = await tx.insert(pipelineRuns).values({
    kind,
    status: 'queued',
    requestedBy,
    dryRun,
    statsJson: { params },
  });
  return { runId: Number(res.insertId), created: true };
}
