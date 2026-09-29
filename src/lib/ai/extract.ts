// STUB(AI+ACCURACY): minimal safe implementation — AI is off, nothing is extracted. The real
// version uses tools/tool_choice function calling, validates with zod and verifies every quote.
// Keep the exported signature (extend the input compatibly).
import type { Fact, FactKey } from '../contracts/provenance';
import type { DbOrTx } from '../db';

export interface AiExtractInput {
  jobId: number;
  task: string;
  /** Plain-text posting (never secrets). */
  text: string;
  contentHash: string;
  /** Manual requests may use the reserved budget. */
  manual?: boolean;
}

export type AiExtractResult =
  | { ok: true; facts: { key: FactKey; fact: Fact<unknown> }[]; cached: boolean; rejected: number }
  | { ok: false; reason: 'disabled' | 'budget' | 'invalid' | 'error'; message: string };

export async function aiExtract(db: DbOrTx, input: AiExtractInput): Promise<AiExtractResult> {
  void db;
  void input;
  return { ok: false, reason: 'disabled', message: 'AI extraction is not active yet.' };
}
