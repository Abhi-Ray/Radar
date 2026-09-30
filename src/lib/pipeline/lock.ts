/**
 * Named locks with heartbeat in `pipeline_lock` (row 'pipeline' = the single-run lock, row
 * 'linkcheck' = the link checker). A lock is held while `expires_at` is in the future; the holder
 * refreshes it every minute, so a crashed worker's lock goes stale after 30 minutes and the next
 * run takes it over.
 *
 * Acquire = `INSERT IGNORE` (the row exists from then on) + one conditional UPDATE: atomic, and no
 * `SELECT … FOR UPDATE` on a missing row (gap locks deadlock concurrent inserts).
 */
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { pipelineLock } from '../../db/schema';
import type { DbOrTx } from '../db';
import { MINUTE_MS } from '../time';

export const PIPELINE_LOCK = 'pipeline';
export const LINKCHECK_LOCK = 'linkcheck';
/** A lock without a heartbeat for this long is stale and may be taken over. */
export const LOCK_STALE_MS = 30 * MINUTE_MS;
export const LOCK_HEARTBEAT_MS = MINUTE_MS;

let processOwner: string | null = null;

/** Stable id of this process (host:pid:random), used as the lock owner and pipeline_runs.lock_owner. */
export function lockOwnerId(): string {
  processOwner ??= `${hostname().slice(0, 64)}:${process.pid}:${randomBytes(4).toString('hex')}`;
  return processOwner;
}

export interface LockState {
  name: string;
  owner: string | null;
  runId: number | null;
  acquiredAt: Date | null;
  heartbeatAt: Date | null;
  expiresAt: Date | null;
  /** Held = has an owner and has not expired. */
  held: boolean;
}

export interface LockHandle {
  readonly name: string;
  readonly owner: string;
  /** The previous holder whose lock had gone stale (its run is marked failed by the caller). */
  readonly takenOverFrom: { owner: string | null; runId: number | null } | null;
  runId: number | null;
  /** Refreshes the lease. false = the lock was lost (taken over after going stale). */
  heartbeat(now?: Date): Promise<boolean>;
  /** Records the run id on the lock row. */
  setRunId(runId: number | null): Promise<void>;
  release(): Promise<void>;
}

export interface AcquireLockOptions {
  name: string;
  owner?: string;
  runId?: number | null;
  ttlMs?: number;
  now?: Date;
}

export async function readLock(db: DbOrTx, name: string, now: Date = new Date()): Promise<LockState | null> {
  const [row] = await db.select().from(pipelineLock).where(eq(pipelineLock.name, name)).limit(1);
  if (!row) return null;
  return { ...row, held: !!row.owner && !!row.expiresAt && row.expiresAt.getTime() > now.getTime() };
}

/** Takes the lock when it is free or stale; null when someone else holds it. */
export async function acquireLock(db: DbOrTx, opts: AcquireLockOptions): Promise<LockHandle | null> {
  const name = opts.name;
  const owner = (opts.owner ?? lockOwnerId()).slice(0, 128);
  const ttl = opts.ttlMs ?? LOCK_STALE_MS;
  const now = opts.now ?? new Date();
  const runId = opts.runId ?? null;

  await db.insert(pipelineLock).ignore().values({ name });
  const before = await readLock(db, name, now);
  const [res] = await db
    .update(pipelineLock)
    .set({ owner, runId, acquiredAt: now, heartbeatAt: now, expiresAt: new Date(now.getTime() + ttl) })
    .where(and(eq(pipelineLock.name, name), or(isNull(pipelineLock.owner), isNull(pipelineLock.expiresAt), lt(pipelineLock.expiresAt, now))));
  if (res.affectedRows !== 1) return null;
  const takenOverFrom = before?.owner && before.owner !== owner ? { owner: before.owner, runId: before.runId } : null;
  return makeHandle(db, name, owner, runId, ttl, takenOverFrom);
}

export interface WaitForLockOptions extends AcquireLockOptions {
  waitMs: number;
  pollMs?: number;
  signal?: AbortSignal;
}

/** Retries `acquireLock` until `waitMs` has passed (daily runs wait for a queued UI run to finish). */
export async function acquireLockWithWait(db: DbOrTx, opts: WaitForLockOptions): Promise<LockHandle | null> {
  const deadline = Date.now() + Math.max(0, opts.waitMs);
  const poll = Math.max(50, opts.pollMs ?? 15_000);
  for (;;) {
    const lock = await acquireLock(db, { ...opts, now: undefined });
    if (lock || Date.now() + poll > deadline || opts.signal?.aborted) return lock;
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, poll);
      opts.signal?.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
  }
}

function makeHandle(
  db: DbOrTx,
  name: string,
  owner: string,
  initialRunId: number | null,
  ttl: number,
  takenOverFrom: LockHandle['takenOverFrom'],
): LockHandle {
  const mine = and(eq(pipelineLock.name, name), eq(pipelineLock.owner, owner));
  const handle: LockHandle = {
    name,
    owner,
    takenOverFrom,
    runId: initialRunId,
    async heartbeat(now = new Date()) {
      const [res] = await db
        .update(pipelineLock)
        .set({ heartbeatAt: now, expiresAt: new Date(now.getTime() + ttl) })
        .where(mine);
      return res.affectedRows === 1;
    },
    async setRunId(runId) {
      handle.runId = runId;
      await db.update(pipelineLock).set({ runId }).where(mine);
    },
    async release() {
      await db.update(pipelineLock).set({ owner: null, runId: null, expiresAt: null }).where(mine);
    },
  };
  return handle;
}

/**
 * Refreshes the lease every `intervalMs` until stopped. `onLost` fires once when the lease could
 * not be refreshed (another process took the lock over): the caller aborts its run.
 */
export function startHeartbeat(lock: LockHandle, opts: { intervalMs?: number; onLost?: () => void } = {}): () => void {
  let stopped = false;
  let lost = false;
  const timer = setInterval(() => {
    if (stopped) return;
    lock.heartbeat().then(
      (ok) => {
        if (!ok && !lost && !stopped) {
          lost = true;
          opts.onLost?.();
        }
      },
      () => undefined, // A transient DB error: the next beat retries; the lease is 30× the interval.
    );
  }, opts.intervalMs ?? LOCK_HEARTBEAT_MS);
  timer.unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
