// STUB(NORMALIZE): minimal safe implementation — serves the cached `fx_rates` setting (never
// fetches). Without cached rates only EUR converts. Replace with the ECB daily fetch + cache;
// keep the exported signature.
import type { FxTable } from '../contracts/jobs';
import type { DbOrTx } from '../db';
import { getSetting } from '../settings';

export async function getFxTable(db: DbOrTx): Promise<FxTable> {
  try {
    const cached = await getSetting(db, 'fx_rates');
    if (cached) return { date: cached.date, rates: { ...cached.rates, EUR: 1 } };
  } catch {
    // Fall through: an FX problem must never break the pipeline (salaries stay unconverted).
  }
  return { date: null, rates: { EUR: 1 } };
}
