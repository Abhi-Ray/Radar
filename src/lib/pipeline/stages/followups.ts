/**
 * Follow-ups after an item's transaction committed (non-fatal: a failure is logged and counted,
 * the job itself is already stored):
 * - AI enqueue ('extract_facts') for new postings and changed descriptions in a relevant role
 *   family, priority = fit score. The AI queue is never RUN by the pipeline (budgeted batches).
 * - title_review_queue for titles mapTitle() could not map (reviewed by hand, never guessed).
 */
import { sql } from 'drizzle-orm';
import { titleReviewQueue } from '../../../db/schema';
import { enqueueAi } from '../../ai/queue';
import type { DbOrTx } from '../../db';
import { normalizeTitleKey, TITLE_KEY_MAX } from '../../normalize/title';
import { withRetry } from './dbutil';
import type { PersistResult } from './persist';

export interface FollowupInput {
  result: PersistResult;
  titleRaw: string;
  lang: string | null;
  now: Date;
}

export interface FollowupOutcome {
  aiQueued: boolean;
  titleQueued: boolean;
}

/** Whether a stored posting should get AI fact extraction. */
export function wantsAiExtraction(r: Pick<PersistResult, 'isNew' | 'descriptionChanged' | 'roleFamily'>): boolean {
  return (r.isNew || r.descriptionChanged) && r.roleFamily !== 'other';
}

export async function queueTitleReview(db: DbOrTx, input: { titleRaw: string; lang: string | null; jobId: number; now: Date }): Promise<boolean> {
  const normalized = normalizeTitleKey(input.titleRaw).slice(0, TITLE_KEY_MAX);
  if (!normalized) return false;
  await db
    .insert(titleReviewQueue)
    .values({
      titleRaw: input.titleRaw.slice(0, 512),
      normalized,
      count: 1,
      lang: input.lang ? input.lang.slice(0, 8) : null,
      sampleJobId: input.jobId,
      firstSeen: input.now,
      lastSeen: input.now,
      status: 'open',
    })
    .onDuplicateKeyUpdate({
      set: {
        count: sql`${titleReviewQueue.count} + 1`,
        lastSeen: input.now,
        sampleJobId: sql`COALESCE(${titleReviewQueue.sampleJobId}, ${input.jobId})`,
      },
    });
  return true;
}

export async function runFollowups(db: DbOrTx, input: FollowupInput): Promise<FollowupOutcome> {
  const out: FollowupOutcome = { aiQueued: false, titleQueued: false };
  const r = input.result;
  if (wantsAiExtraction(r)) {
    await withRetry(() => enqueueAi(db, r.jobId, 'extract_facts', r.score ?? 0));
    out.aiQueued = true;
  }
  // Only first sightings and changed titles count, so the queue count is "postings", not "runs".
  if (r.titleUnknown && (r.isNew || r.titleChanged)) {
    out.titleQueued = await withRetry(() => queueTitleReview(db, { titleRaw: input.titleRaw, lang: input.lang, jobId: r.jobId, now: input.now }));
  }
  return out;
}
