// STUB(NORMALIZE): minimal safe implementation — changes nothing and says so. The real merge /
// split tools record their decisions so re-runs never undo them. Keep the exported signatures.
import type { DbOrTx } from '../db';

export interface ManualDedupResult {
  ok: boolean;
  message: string;
}

const NOT_AVAILABLE: ManualDedupResult = { ok: false, message: 'Merging and splitting jobs is not available yet.' };

export async function mergeJobs(db: DbOrTx, keepId: number, dropId: number, reason: string): Promise<ManualDedupResult> {
  void db;
  void keepId;
  void dropId;
  void reason;
  return NOT_AVAILABLE;
}

export async function splitJobs(db: DbOrTx, jobId: number, sourceIds: number[], reason: string): Promise<ManualDedupResult> {
  void db;
  void jobId;
  void sourceIds;
  void reason;
  return NOT_AVAILABLE;
}

export async function dismissDuplicate(db: DbOrTx, candidateId: number): Promise<ManualDedupResult> {
  void db;
  void candidateId;
  return NOT_AVAILABLE;
}
