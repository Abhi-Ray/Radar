/**
 * Dead-letter store: every item that failed parse / validation / normalisation / enrichment is
 * kept with its error and a payload excerpt — never silently dropped. The same item failing again
 * updates its open row (retry count +1, status 'retried'); a later success resolves it.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { deadLetters } from '../../../db/schema';
import type { DEAD_LETTER_STAGES } from '../../../db/schema/_enums';
import type { DbOrTx } from '../../db';

export type DeadLetterStage = (typeof DEAD_LETTER_STAGES)[number];

export const PAYLOAD_EXCERPT_CHARS = 2000;

export interface DeadLetterInput {
  sourceId: number;
  runId: number | null;
  rawSnapshotId: number | null;
  externalId: string | null;
  stage: DeadLetterStage;
  error: string;
  payload: unknown;
  parserVersion: string | null;
}

export function payloadExcerpt(payload: unknown, max = PAYLOAD_EXCERPT_CHARS): string | null {
  if (payload === undefined) return null;
  let s: string;
  try {
    s = typeof payload === 'string' ? payload : JSON.stringify(payload);
  } catch {
    s = String(payload);
  }
  if (s === undefined) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export async function recordDeadLetter(db: DbOrTx, input: DeadLetterInput): Promise<{ id: number; created: boolean }> {
  const error = input.error.slice(0, 8000) || 'unknown error';
  const excerpt = payloadExcerpt(input.payload);
  const parserVersion = input.parserVersion?.slice(0, 64) ?? null;
  const externalId = input.externalId ? input.externalId.slice(0, 255) : null;
  if (externalId) {
    const [open] = await db
      .select({ id: deadLetters.id, retryCount: deadLetters.retryCount })
      .from(deadLetters)
      .where(
        and(eq(deadLetters.sourceId, input.sourceId), eq(deadLetters.externalId, externalId), inArray(deadLetters.status, ['open', 'retried'])),
      )
      .orderBy(desc(deadLetters.id))
      .limit(1);
    if (open) {
      await db
        .update(deadLetters)
        .set({
          status: 'retried',
          retryCount: open.retryCount + 1,
          stage: input.stage,
          error,
          runId: input.runId,
          rawSnapshotId: input.rawSnapshotId,
          payloadExcerpt: excerpt,
          parserVersion,
        })
        .where(eq(deadLetters.id, open.id));
      return { id: open.id, created: false };
    }
  }
  const [res] = await db.insert(deadLetters).values({
    sourceId: input.sourceId,
    runId: input.runId,
    rawSnapshotId: input.rawSnapshotId,
    externalId,
    stage: input.stage,
    error,
    payloadExcerpt: excerpt,
    status: 'open',
    retryCount: 0,
    parserVersion,
  });
  return { id: Number(res.insertId), created: true };
}

/** Marks the open dead letters of an item as resolved (it processed successfully). */
export async function resolveDeadLetters(db: DbOrTx, sourceId: number, externalId: string, now: Date): Promise<number> {
  const [res] = await db
    .update(deadLetters)
    .set({ status: 'resolved', resolvedAt: now })
    .where(and(eq(deadLetters.sourceId, sourceId), eq(deadLetters.externalId, externalId.slice(0, 255)), inArray(deadLetters.status, ['open', 'retried'])));
  return res.affectedRows;
}
