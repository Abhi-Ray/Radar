/**
 * Retention (weekly): keeps the database small without losing anything that matters.
 *
 * - Raw snapshots of saved jobs and jobs with an application are marked `retained` (kept forever).
 * - Other raw snapshots older than settings.retention.rawDays (default 90) are deleted, EXCEPT
 *   the current snapshot of a posting whose job is still open or was listed within the window
 *   (reprocessFromRaw needs it) and snapshots an open dead letter points at (retry needs them).
 * - Superseded job scores, resolved / ignored dead letters and link checks older than 90 days.
 * - Old login attempts (auth rate-limit history).
 *
 * Takes the pipeline lock without waiting (skips when a run is in progress), so a run never
 * references a snapshot that is being deleted.
 */
import { and, asc, eq, exists, gt, gte, inArray, lt, notExists, or, sql } from 'drizzle-orm';
import { applications, deadLetters, jobs, jobScores, jobSources, linkChecks, rawSnapshots } from '../../db/schema';
import { pruneLoginAttempts } from '../auth/rate-limit';
import type { Db } from '../db';
import { log as rootLog } from '../log';
import { acquireLock, lockOwnerId, PIPELINE_LOCK, startHeartbeat } from '../pipeline/lock';
import { chunks } from '../pipeline/stages/dbutil';
import { getSetting } from '../settings';
import { DAY_MS } from '../time';
import { OPEN_STATES } from '.';

export const HISTORY_RETENTION_DAYS = 90;
export const RETENTION_BATCH = 1000;

export interface RetentionResult {
  skipped?: 'locked';
  rawDays: number;
  markedRetained: number;
  snapshotsDeleted: number;
  scoresDeleted: number;
  deadLettersDeleted: number;
  linkChecksDeleted: number;
  loginAttemptsDeleted: number;
  durationMs: number;
}

/** Deletes ids selected by `pick` in batches until none are left (or the limit of rounds). */
async function deleteInBatches(pick: (afterId: number) => Promise<number[]>, remove: (ids: number[]) => Promise<number>): Promise<number> {
  let total = 0;
  let after = 0;
  for (let round = 0; round < 10_000; round++) {
    const ids = await pick(after);
    if (!ids.length) break;
    after = ids[ids.length - 1];
    for (const part of chunks(ids, RETENTION_BATCH)) total += await remove(part);
  }
  return total;
}

export async function runRetention(db: Db, opts: { now?: Date } = {}): Promise<RetentionResult> {
  const t0 = Date.now();
  const now = opts.now ?? new Date();
  const { rawDays } = await getSetting(db, 'retention');
  const out: RetentionResult = {
    rawDays,
    markedRetained: 0,
    snapshotsDeleted: 0,
    scoresDeleted: 0,
    deadLettersDeleted: 0,
    linkChecksDeleted: 0,
    loginAttemptsDeleted: 0,
    durationMs: 0,
  };
  const logger = rootLog.child({ module: 'retention' });
  const lock = await acquireLock(db, { name: PIPELINE_LOCK, owner: lockOwnerId() });
  if (!lock) {
    logger.info('retention skipped: a pipeline run holds the lock');
    return { ...out, skipped: 'locked', durationMs: Date.now() - t0 };
  }
  const stopHeartbeat = startHeartbeat(lock, { onLost: () => logger.warn('pipeline lock lost during retention') });
  try {
    // ---- keep everything of saved / applied jobs
    const [marked] = await db
      .update(rawSnapshots)
      .set({ retained: true })
      .where(
        and(
          eq(rawSnapshots.retained, false),
          exists(
            db
              .select({ one: sql`1` })
              .from(jobSources)
              .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
              .where(
                and(
                  eq(jobSources.sourceId, rawSnapshots.sourceId),
                  eq(jobSources.externalId, rawSnapshots.externalId),
                  or(eq(jobs.saved, true), exists(db.select({ one: sql`1` }).from(applications).where(eq(applications.jobId, jobs.id)))),
                ),
              ),
          ),
        ),
      );
    out.markedRetained = marked.affectedRows;

    // ---- raw snapshots past the window
    const rawCutoff = new Date(now.getTime() - rawDays * DAY_MS);
    out.snapshotsDeleted = await deleteInBatches(
      async (after) =>
        (
          await db
            .select({ id: rawSnapshots.id })
            .from(rawSnapshots)
            .where(
              and(
                gt(rawSnapshots.id, after),
                lt(rawSnapshots.fetchedAt, rawCutoff),
                eq(rawSnapshots.retained, false),
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(jobSources)
                    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
                    .where(and(eq(jobSources.rawSnapshotId, rawSnapshots.id), or(inArray(jobs.state, [...OPEN_STATES]), gte(jobSources.lastSeenAt, rawCutoff)))),
                ),
                notExists(
                  db
                    .select({ one: sql`1` })
                    .from(deadLetters)
                    .where(and(eq(deadLetters.rawSnapshotId, rawSnapshots.id), inArray(deadLetters.status, ['open', 'retried']))),
                ),
              ),
            )
            .orderBy(asc(rawSnapshots.id))
            .limit(RETENTION_BATCH)
        ).map((r) => r.id),
      async (ids) => (await db.delete(rawSnapshots).where(and(inArray(rawSnapshots.id, ids), eq(rawSnapshots.retained, false))))[0].affectedRows,
    );

    // ---- history tables
    const histCutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * DAY_MS);
    out.scoresDeleted = await deleteInBatches(
      async (after) =>
        (
          await db
            .select({ id: jobScores.id })
            .from(jobScores)
            .where(and(gt(jobScores.id, after), eq(jobScores.isCurrent, false), lt(jobScores.computedAt, histCutoff)))
            .orderBy(asc(jobScores.id))
            .limit(RETENTION_BATCH)
        ).map((r) => r.id),
      async (ids) => (await db.delete(jobScores).where(and(inArray(jobScores.id, ids), eq(jobScores.isCurrent, false))))[0].affectedRows,
    );
    out.deadLettersDeleted = await deleteInBatches(
      async (after) =>
        (
          await db
            .select({ id: deadLetters.id })
            .from(deadLetters)
            .where(and(gt(deadLetters.id, after), inArray(deadLetters.status, ['resolved', 'ignored']), lt(deadLetters.updatedAt, histCutoff)))
            .orderBy(asc(deadLetters.id))
            .limit(RETENTION_BATCH)
        ).map((r) => r.id),
      async (ids) => (await db.delete(deadLetters).where(and(inArray(deadLetters.id, ids), inArray(deadLetters.status, ['resolved', 'ignored']))))[0].affectedRows,
    );
    out.linkChecksDeleted = await deleteInBatches(
      async (after) =>
        (
          await db
            .select({ id: linkChecks.id })
            .from(linkChecks)
            .where(and(gt(linkChecks.id, after), lt(linkChecks.checkedAt, histCutoff)))
            .orderBy(asc(linkChecks.id))
            .limit(RETENTION_BATCH)
        ).map((r) => r.id),
      async (ids) => (await db.delete(linkChecks).where(inArray(linkChecks.id, ids)))[0].affectedRows,
    );
    out.loginAttemptsDeleted = await pruneLoginAttempts(db, { now });
  } finally {
    stopHeartbeat();
    await lock.release().catch(() => undefined);
  }
  out.durationMs = Date.now() - t0;
  logger.info('retention finished', { ...out });
  return out;
}
