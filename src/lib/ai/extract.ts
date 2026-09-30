/**
 * One-job AI extraction for the UI ("ask AI"): uses the manual budget reserve, never sends the
 * same content twice (cache), validates the answer and verifies every quote. The facts are
 * RETURNED, not stored — the caller stores them (see aiSummarizeJob for the storing variant).
 */
import type { Fact, FactKey } from '../contracts/provenance';
import type { DbOrTx } from '../db';
import type { AiFetch } from './transport';
import { runSingleJob } from './run';

export interface AiExtractInput {
  jobId: number;
  /** 'summary' | 'summary_redflags' | 'extract_facts' | 'suspicious_check' (aliases accepted). */
  task: string;
  /** Plain-text posting (never secrets). */
  text: string;
  /** Kept for compatibility; the cache key is computed from exactly what is sent. */
  contentHash: string;
  /** Manual requests may use the reserved budget (default true). */
  manual?: boolean;
  now?: Date;
  /** Injected transport (tests). */
  fetch?: AiFetch | null;
}

export type AiExtractResult =
  | { ok: true; facts: { key: FactKey; fact: Fact<unknown> }[]; cached: boolean; rejected: number }
  | { ok: false; reason: 'disabled' | 'budget' | 'invalid' | 'error'; message: string };

export async function aiExtract(db: DbOrTx, input: AiExtractInput): Promise<AiExtractResult> {
  const res = await runSingleJob(db, {
    jobId: input.jobId,
    task: input.task,
    text: input.text,
    manual: input.manual ?? true,
    store: false,
    now: input.now,
    fetch: input.fetch,
  });
  if (!res.ok) return res;
  return { ok: true, facts: res.facts, cached: res.cached, rejected: res.rejected };
}
