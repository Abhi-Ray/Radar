// STUB(NORMALIZE): minimal safe implementation — never merges (every job is "new"); careful,
// non-aggressive dedup replaces this. Keep the exported signature.
import type { DedupCandidate, DedupResult } from '../contracts/jobs';
import type { DbOrTx } from '../db';

export const DEDUP_LOGIC_VERSION = 'dedup-stub-0';

export async function findDuplicate(db: DbOrTx, candidate: DedupCandidate): Promise<DedupResult> {
  void db;
  void candidate;
  return { action: 'new' };
}
