/**
 * Job lifecycle: closing / reopening single jobs (always with a job_changes record) and the
 * end-of-run sweep (expiry, ghost risk, new → active, updated → active, stale, re-score).
 *
 * States: new → active ⇄ updated; any open state → stale (not seen for 30 days) → closed / expired.
 * Nothing here ever closes jobs in bulk because of absence: that decision is per source, per job,
 * after two healthy runs (src/lib/pipeline/stages/listing.ts).
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lt, ne, notExists, or, sql } from 'drizzle-orm';
import { jobChanges, jobScores, jobs } from '../../db/schema';
import type { JOB_STATES } from '../../db/schema/_enums';
import type { Profile, ScoreWeights } from '../contracts/settings';
import { withTransaction, type Db, type DbOrTx } from '../db';
import { chunks, withTxRetry } from '../pipeline/stages/dbutil';
import { scoreJobById } from '../pipeline/stages/score';
import { SCORE_VERSION } from '../scoring/score';
import { DAY_MS, utcDay } from '../time';

export { LIFECYCLE_LOGIC_VERSION } from '../pipeline/versions';

export type JobState = (typeof JOB_STATES)[number];

/** States in which a job is still listed somewhere (not closed / expired). */
export const OPEN_STATES = ['new', 'active', 'updated', 'stale', 'suspicious'] as const satisfies readonly JobState[];
export const CLOSED_STATES = ['closed', 'expired'] as const satisfies readonly JobState[];

export const GHOST_REPOST_COUNT = 3;
export const GHOST_OPEN_DAYS = 60;
export const NEW_TO_ACTIVE_DAYS = 3;
export const UPDATED_TO_ACTIVE_DAYS = 3;
export const STALE_AFTER_DAYS = 30;
export const RESCORE_LIMIT = 2000;

export function isOpenState(state: string): boolean {
  return (OPEN_STATES as readonly string[]).includes(state);
}

// ---- pure rules --------------------------------------------------------------------------------

export interface GhostRiskInput {
  repostCount: number;
  postedAt: Date | null;
  firstSeenAt: Date;
  now: Date;
}

/** Ghost-job risk: reposted ≥ 3 times, or open for more than 60 days. */
export function computeGhostRisk(j: GhostRiskInput): { ghostRisk: boolean; reason: string | null } {
  if (j.repostCount >= GHOST_REPOST_COUNT) return { ghostRisk: true, reason: `reposted ${j.repostCount} times` };
  const since = j.postedAt && j.postedAt.getTime() < j.firstSeenAt.getTime() ? j.postedAt : j.firstSeenAt;
  const days = Math.floor((j.now.getTime() - since.getTime()) / DAY_MS);
  if (days > GHOST_OPEN_DAYS) return { ghostRisk: true, reason: `open for ${days} days` };
  return { ghostRisk: false, reason: null };
}

export interface ReopenInput {
  state: string;
  linkStatus: string;
  closingAt: Date | null;
  now: Date;
}

/**
 * Whether a job that is seen again in a source listing returns to 'active':
 * - closed → yes, unless its apply link is dead;
 * - expired → only when the closing date was removed or moved into the future;
 * - stale → yes (it is listed again).
 */
export function reopenDecision(j: ReopenInput): { reopen: boolean; reason: string | null } {
  if (j.state === 'closed') {
    if (j.linkStatus === 'dead') return { reopen: false, reason: null };
    return { reopen: true, reason: 'listed again by the source' };
  }
  if (j.state === 'expired') {
    if (j.closingAt && j.closingAt.getTime() <= j.now.getTime()) return { reopen: false, reason: null };
    return { reopen: true, reason: j.closingAt ? 'closing date moved into the future' : 'closing date removed' };
  }
  if (j.state === 'stale') return { reopen: true, reason: 'listed again by the source' };
  return { reopen: false, reason: null };
}

// ---- single-job transitions ---------------------------------------------------------------------

export type CloseReason = 'missing_from_source' | 'source_closed' | 'link_dead' | 'manual';

export interface TransitionOptions {
  now: Date;
  runId: number | null;
}

async function recordChanges(db: DbOrTx, jobId: number, rows: { field: string; oldValue: string | null; newValue: string | null }[], opts: TransitionOptions) {
  if (!rows.length) return;
  await db.insert(jobChanges).values(rows.map((r) => ({ jobId, field: r.field, oldValue: r.oldValue, newValue: r.newValue, changedAt: opts.now, runId: opts.runId })));
}

/** Closes one open job. Returns false when it was already closed/expired, merged or missing. */
export async function closeJob(db: DbOrTx, jobId: number, reason: CloseReason, opts: TransitionOptions & { missingRunCount?: number }): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ state: jobs.state, mergedIntoJobId: jobs.mergedIntoJobId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
      .for('update');
    if (!row || row.mergedIntoJobId !== null || !isOpenState(row.state)) return false;
    await tx
      .update(jobs)
      .set({ state: 'closed', ...(opts.missingRunCount === undefined ? {} : { missingRunCount: opts.missingRunCount }) })
      .where(eq(jobs.id, jobId));
    await recordChanges(
      tx,
      jobId,
      [
        { field: 'state', oldValue: row.state, newValue: 'closed' },
        { field: 'close_reason', oldValue: null, newValue: reason },
      ],
      opts,
    );
    return true;
  });
}

/**
 * Returns a closed / expired / stale job to 'active' (seen again). The caller decides with
 * `reopenDecision`; this re-checks the state under a row lock. Resets the missing count.
 */
export async function reopenJob(db: DbOrTx, jobId: number, reason: string, opts: TransitionOptions): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const [row] = await tx
      .select({ state: jobs.state, mergedIntoJobId: jobs.mergedIntoJobId })
      .from(jobs)
      .where(eq(jobs.id, jobId))
      .limit(1)
      .for('update');
    if (!row || row.mergedIntoJobId !== null || !['closed', 'expired', 'stale'].includes(row.state)) return false;
    await tx.update(jobs).set({ state: 'active', missingRunCount: 0 }).where(eq(jobs.id, jobId));
    await recordChanges(
      tx,
      jobId,
      [
        { field: 'state', oldValue: row.state, newValue: 'active' },
        { field: 'reopen_reason', oldValue: null, newValue: reason.slice(0, 500) },
      ],
      opts,
    );
    return true;
  });
}

// ---- sweep ---------------------------------------------------------------------------------------

export interface SweepOptions {
  now: Date;
  runId: number | null;
  dryRun: boolean;
  weights: ScoreWeights;
  profile: Profile;
  rescoreLimit?: number;
  /** Stop early (between batches) when aborted. */
  signal?: AbortSignal;
}

export interface SweepResult {
  expired: number;
  ghostFlagged: number;
  ghostCleared: number;
  newToActive: number;
  updatedToActive: number;
  stale: number;
  rescored: number;
  rescoreChecked: number;
}

type Condition = ReturnType<typeof and>;

/**
 * Moves every job matching `where` to `to`, with one job_changes 'state' row per job. Runs in
 * chunks of 200 locked rows; returns the number moved (or matching, for a dry run).
 */
async function transitionWhere(db: Db, where: Condition, to: JobState, opts: SweepOptions, extraChange?: { field: string; value: string }): Promise<{ count: number; ids: number[] }> {
  const candidates = await db.select({ id: jobs.id }).from(jobs).where(where);
  const ids = candidates.map((c) => c.id);
  if (opts.dryRun || !ids.length) return { count: ids.length, ids: [] };
  const moved: number[] = [];
  for (const part of chunks(ids, 200)) {
    if (opts.signal?.aborted) break;
    await withTxRetry(db, async (tx) => {
      const locked = await tx
        .select({ id: jobs.id, state: jobs.state })
        .from(jobs)
        .where(and(inArray(jobs.id, part), where))
        .for('update');
      if (!locked.length) return;
      await tx
        .update(jobs)
        .set({ state: to })
        .where(inArray(jobs.id, locked.map((l) => l.id)));
      const rows = locked.flatMap((l) => {
        const out = [{ jobId: l.id, field: 'state', oldValue: l.state as string | null, newValue: to as string | null, changedAt: opts.now, runId: opts.runId }];
        if (extraChange) out.push({ jobId: l.id, field: extraChange.field, oldValue: null, newValue: extraChange.value, changedAt: opts.now, runId: opts.runId });
        return out;
      });
      await tx.insert(jobChanges).values(rows);
      moved.push(...locked.map((l) => l.id));
    });
  }
  return { count: moved.length, ids: moved };
}

const notMerged = isNull(jobs.mergedIntoJobId);

/** End-of-run lifecycle sweep over all jobs. Dry run: counts what would change, writes nothing. */
export async function sweepLifecycle(db: Db, opts: SweepOptions): Promise<SweepResult> {
  const now = opts.now;
  const before = (days: number) => new Date(now.getTime() - days * DAY_MS);
  const touched = new Set<number>();
  const out: SweepResult = { expired: 0, ghostFlagged: 0, ghostCleared: 0, newToActive: 0, updatedToActive: 0, stale: 0, rescored: 0, rescoreChecked: 0 };

  // 1. Closing date passed → expired.
  const expired = await transitionWhere(
    db,
    and(notMerged, inArray(jobs.state, [...OPEN_STATES]), isNotNull(jobs.closingAt), lt(jobs.closingAt, now)),
    'expired',
    opts,
    { field: 'close_reason', value: 'closing_date_passed' },
  );
  out.expired = expired.count;
  expired.ids.forEach((id) => touched.add(id));

  // 2. Ghost risk (open jobs only): reposted ≥ 3 or open > 60 days (posted date or first seen).
  const ghostCutoff = before(GHOST_OPEN_DAYS);
  const ghostCond = or(
    gte(jobs.repostCount, GHOST_REPOST_COUNT),
    lt(sql`LEAST(COALESCE(${jobs.postedAt}, ${jobs.firstSeenAt}), ${jobs.firstSeenAt})`, ghostCutoff),
  );
  const flag = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(notMerged, inArray(jobs.state, [...OPEN_STATES]), eq(jobs.ghostRisk, false), ghostCond));
  const clear = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(notMerged, inArray(jobs.state, [...OPEN_STATES]), eq(jobs.ghostRisk, true), sql`NOT (${ghostCond})`));
  out.ghostFlagged = flag.length;
  out.ghostCleared = clear.length;
  if (!opts.dryRun) {
    for (const part of chunks(flag.map((r) => r.id), 500)) {
      await db.update(jobs).set({ ghostRisk: true }).where(inArray(jobs.id, part));
      part.forEach((id) => touched.add(id));
    }
    for (const part of chunks(clear.map((r) => r.id), 500)) {
      await db.update(jobs).set({ ghostRisk: false }).where(inArray(jobs.id, part));
      part.forEach((id) => touched.add(id));
    }
  }

  // 3. new → active after 3 days.
  const n2a = await transitionWhere(db, and(notMerged, eq(jobs.state, 'new'), lt(jobs.firstSeenAt, before(NEW_TO_ACTIVE_DAYS))), 'active', opts);
  out.newToActive = n2a.count;

  // 4. updated → active when nothing changed for 3 days.
  const recentChange = db
    .select({ one: sql`1` })
    .from(jobChanges)
    .where(and(eq(jobChanges.jobId, jobs.id), gte(jobChanges.changedAt, before(UPDATED_TO_ACTIVE_DAYS))));
  const u2a = await transitionWhere(db, and(notMerged, eq(jobs.state, 'updated'), notExists(recentChange)), 'active', opts);
  out.updatedToActive = u2a.count;

  // 5. Not seen anywhere for 30 days → stale (still open; closing needs evidence).
  const stale = await transitionWhere(
    db,
    and(notMerged, inArray(jobs.state, ['new', 'active', 'updated']), lt(jobs.lastSeenAt, before(STALE_AFTER_DAYS))),
    'stale',
    opts,
  );
  out.stale = stale.count;
  stale.ids.forEach((id) => touched.add(id));

  // 6. Re-score: touched jobs, jobs scored by an older scorer, then the oldest scores (ageing).
  if (!opts.dryRun) {
    const limit = opts.rescoreLimit ?? RESCORE_LIMIT;
    const ids: number[] = [...touched].slice(0, limit);
    const have = new Set(ids);
    const openCond = and(notMerged, inArray(jobs.state, [...OPEN_STATES]));
    if (ids.length < limit) {
      const outdated = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(openCond, or(isNull(jobs.scoreVersion), ne(jobs.scoreVersion, SCORE_VERSION))))
        .orderBy(asc(jobs.id))
        .limit(limit - ids.length);
      for (const r of outdated) {
        if (have.has(r.id)) continue;
        have.add(r.id);
        ids.push(r.id);
      }
    }
    if (ids.length < limit) {
      const startOfDay = new Date(`${utcDay(now)}T00:00:00.000Z`);
      const aged = await db
        .select({ id: jobs.id })
        .from(jobs)
        .innerJoin(jobScores, and(eq(jobScores.jobId, jobs.id), eq(jobScores.isCurrent, true)))
        .where(and(openCond, lt(jobScores.computedAt, startOfDay)))
        .orderBy(asc(jobScores.computedAt))
        .limit(limit - ids.length);
      for (const r of aged) {
        if (have.has(r.id)) continue;
        have.add(r.id);
        ids.push(r.id);
      }
    }
    for (const id of ids) {
      if (opts.signal?.aborted) break;
      out.rescoreChecked++;
      const res = await withTxRetry(db, (tx) => scoreJobById(tx, id, { weights: opts.weights, profile: opts.profile, now }));
      if (res?.action === 'rescored') out.rescored++;
    }
  }
  return out;
}
