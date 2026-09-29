// STUB(NORMALIZE): minimal safe implementation — changes nothing and says so. The real tools
// record merges/splits so re-runs never undo them. Keep the exported signatures.
import type { DbOrTx } from '../db';

export interface ManualCompanyResult {
  ok: boolean;
  message: string;
}

const NOT_AVAILABLE: ManualCompanyResult = { ok: false, message: 'Merging and splitting companies is not available yet.' };

export async function mergeCompanies(db: DbOrTx, keepId: number, dropId: number, reason: string): Promise<ManualCompanyResult> {
  void db;
  void keepId;
  void dropId;
  void reason;
  return NOT_AVAILABLE;
}

export async function splitCompany(db: DbOrTx, companyId: number, aliasIds: number[], reason: string): Promise<ManualCompanyResult> {
  void db;
  void companyId;
  void aliasIds;
  void reason;
  return NOT_AVAILABLE;
}
