// STUB(AI+ACCURACY): minimal safe implementation — reports today's counters but keeps AI OFF
// (`enabled: false`), so nothing is ever called. The real module counts BEFORE each call, hard-
// stops at AI_DAILY_LIMIT per UTC day and syncs with OpenRouter. Keep the exported signature.
import { eq } from 'drizzle-orm';
import { aiUsage } from '../../db/schema';
import type { DbOrTx } from '../db';
import { getSetting } from '../settings';
import { utcDay } from '../time';

export interface AiBudget {
  /** UTC day 'YYYY-MM-DD'. */
  day: string;
  enabled: boolean;
  used: number;
  limit: number;
  remaining: number;
  /** Calls kept back for manual "ask AI" requests. */
  reserveForManual: number;
  remoteUsed: number | null;
  syncedAt: Date | null;
}

export async function getAiBudget(db: DbOrTx, now: Date = new Date()): Promise<AiBudget> {
  const day = utcDay(now);
  const ai = await getSetting(db, 'ai');
  const [row] = await db.select().from(aiUsage).where(eq(aiUsage.day, day)).limit(1);
  const limit = row?.callsLimit ?? ai.dailyLimit;
  const used = row?.callsUsed ?? 0;
  return {
    day,
    enabled: false,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    reserveForManual: ai.reserveForManual,
    remoteUsed: row?.remoteUsed ?? null,
    syncedAt: row?.syncedAt ?? null,
  };
}
