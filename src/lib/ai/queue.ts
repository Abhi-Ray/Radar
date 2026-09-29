// STUB(AI+ACCURACY): enqueueAi is minimal but real (one queued row per job+task, priority raised
// if re-requested); runAiQueue makes NO calls while AI is a stub. Keep the exported signatures.
import { and, eq, sql } from 'drizzle-orm';
import { aiQueue } from '../../db/schema';
import { withTransaction, type DbOrTx } from '../db';

export const AI_TASKS = ['extract_facts', 'summary', 'red_flags', 'visa_signals'] as const;
export type AiTask = (typeof AI_TASKS)[number] | (string & {});

export async function enqueueAi(
  db: DbOrTx,
  jobId: number,
  task: AiTask,
  priority: number,
): Promise<{ queueId: number; created: boolean }> {
  const t = String(task).trim().slice(0, 64);
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

export interface AiQueueRunResult {
  processed: number;
  skipped: number;
  failed: number;
  callsUsed: number;
  stoppedBy: 'done' | 'budget' | 'disabled' | 'max_calls';
}

export async function runAiQueue(db: DbOrTx, opts: { maxCalls: number }): Promise<AiQueueRunResult> {
  void db;
  void opts;
  return { processed: 0, skipped: 0, failed: 0, callsUsed: 0, stoppedBy: 'disabled' };
}
