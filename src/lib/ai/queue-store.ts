/**
 * ai_queue rows: one queued row per (job, task); a re-request only raises its priority. The
 * queue is worked top priority (= fit score) first. A row that failed MAX_QUEUE_ATTEMPTS times
 * becomes 'failed'; jobs that no longer need AI (merged, hidden, closed…) are 'skipped'.
 */
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { aiQueue, companies, jobs } from '../../db/schema';
import { withTransaction, type DbOrTx } from '../db';
import { MAX_QUEUE_ATTEMPTS } from './config';
import { canonicalTask, type AiTask } from './tasks';

/** Queue a task for a job (tasks are stored under their canonical name). */
export async function enqueueAi(
  db: DbOrTx,
  jobId: number,
  task: AiTask,
  priority: number,
): Promise<{ queueId: number; created: boolean }> {
  const t = (canonicalTask(String(task)) ?? String(task).trim()).slice(0, 64);
  const p = Math.max(-32768, Math.min(32767, Math.round(Number.isFinite(priority) ? priority : 0)));
  return withTransaction(db, async (tx) => {
    const [existing] = await tx
      .select({ id: aiQueue.id, priority: aiQueue.priority })
      .from(aiQueue)
      .where(and(eq(aiQueue.jobId, jobId), eq(aiQueue.task, t), eq(aiQueue.status, 'queued')))
      .limit(1)
      .for('update');
    if (existing) {
      if (p > existing.priority) {
        await tx.update(aiQueue).set({ priority: sql`GREATEST(${aiQueue.priority}, ${p})` }).where(eq(aiQueue.id, existing.id));
      }
      return { queueId: existing.id, created: false };
    }
    const [res] = await tx.insert(aiQueue).values({ jobId, task: t, priority: p, status: 'queued' });
    return { queueId: Number(res.insertId), created: true };
  });
}

export interface QueuedWork {
  queueId: number;
  jobId: number;
  task: string;
  priority: number;
  attempts: number;
  title: string;
  company: string | null;
  location: string;
  text: string;
  lang: string | null;
  state: string;
  hidden: boolean;
  mergedIntoJobId: number | null;
  score: number | null;
}

/** Queued rows, best first, with what the prompt needs. */
export async function listQueued(db: DbOrTx, opts: { exclude?: Iterable<number>; limit?: number } = {}): Promise<QueuedWork[]> {
  const exclude = [...(opts.exclude ?? [])];
  const conds = [eq(aiQueue.status, 'queued')];
  if (exclude.length) conds.push(notInArray(aiQueue.id, exclude));
  const rows = await db
    .select({
      queueId: aiQueue.id,
      jobId: aiQueue.jobId,
      task: aiQueue.task,
      priority: aiQueue.priority,
      attempts: aiQueue.attempts,
      canonicalTitle: jobs.canonicalTitle,
      titleRaw: jobs.titleRaw,
      company: companies.name,
      location: jobs.locationRaw,
      text: jobs.descriptionText,
      lang: jobs.lang,
      state: jobs.state,
      hidden: jobs.hidden,
      mergedIntoJobId: jobs.mergedIntoJobId,
      score: jobs.score,
    })
    .from(aiQueue)
    .innerJoin(jobs, eq(jobs.id, aiQueue.jobId))
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(...conds))
    .orderBy(desc(aiQueue.priority), aiQueue.id)
    .limit(Math.max(1, Math.min(500, opts.limit ?? 50)));
  return rows.map((r) => ({
    queueId: r.queueId,
    jobId: r.jobId,
    task: r.task,
    priority: r.priority,
    attempts: r.attempts,
    title: r.canonicalTitle || r.titleRaw,
    company: r.company ?? null,
    location: r.location,
    text: r.text,
    lang: r.lang ?? null,
    state: r.state,
    hidden: r.hidden,
    mergedIntoJobId: r.mergedIntoJobId ?? null,
    score: r.score ?? null,
  }));
}

/** Why a job no longer needs AI work (null = it does). */
export function skipReason(w: Pick<QueuedWork, 'state' | 'hidden' | 'mergedIntoJobId' | 'text'>): string | null {
  if (w.mergedIntoJobId !== null) return 'merged into another job';
  if (w.hidden) return 'job is hidden';
  if (w.state === 'closed' || w.state === 'expired') return `job is ${w.state}`;
  if (!w.text.trim()) return 'posting has no text';
  return null;
}

export async function markDone(db: DbOrTx, queueIds: number[], now: Date): Promise<void> {
  if (!queueIds.length) return;
  await db
    .update(aiQueue)
    .set({ status: 'done', doneAt: now, lastError: null, attempts: sql`${aiQueue.attempts} + 1` })
    .where(and(inArray(aiQueue.id, queueIds), eq(aiQueue.status, 'queued')));
}

export async function markSkipped(db: DbOrTx, queueId: number, reason: string, now: Date): Promise<void> {
  await db
    .update(aiQueue)
    .set({ status: 'skipped', doneAt: now, lastError: reason.slice(0, 1000) })
    .where(and(eq(aiQueue.id, queueId), eq(aiQueue.status, 'queued')));
}

/** One more failed attempt; the row becomes 'failed' at MAX_QUEUE_ATTEMPTS. Returns true when it did. */
export async function markAttemptFailed(db: DbOrTx, queueId: number, error: string, now: Date): Promise<boolean> {
  const [row] = await db.select({ attempts: aiQueue.attempts }).from(aiQueue).where(eq(aiQueue.id, queueId)).limit(1);
  const attempts = (row?.attempts ?? 0) + 1;
  const failed = attempts >= MAX_QUEUE_ATTEMPTS;
  await db
    .update(aiQueue)
    .set({ attempts, lastError: error.slice(0, 1000), ...(failed ? { status: 'failed' as const, doneAt: now } : {}) })
    .where(and(eq(aiQueue.id, queueId), eq(aiQueue.status, 'queued')));
  return failed;
}

/** Jobs that already have a row (any status) for `task` — used to avoid planning work twice. */
export async function jobsWithTask(db: DbOrTx, task: string, jobIds: number[]): Promise<Set<number>> {
  if (!jobIds.length) return new Set();
  const rows = await db
    .select({ jobId: aiQueue.jobId })
    .from(aiQueue)
    .where(and(eq(aiQueue.task, task), inArray(aiQueue.jobId, jobIds)));
  return new Set(rows.map((r) => r.jobId));
}
