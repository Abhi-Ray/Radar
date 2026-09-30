/**
 * Daily AI budget (spec §15 "A daily budget counter stops cleanly at the limit").
 *
 * - One ai_usage row per UTC day. A call is counted BEFORE it is sent with one atomic statement:
 *     UPDATE ai_usage SET calls_used = calls_used + 1 WHERE day = ? AND calls_used < calls_limit - ?
 *   (the `- ?` keeps the manual reserve free for scheduled work; manual calls pass 0). Zero
 *   affected rows = refused, so two workers can never overshoot the limit together.
 * - limit = min(settings.ai.dailyLimit, AI_DAILY_LIMIT, 50).
 * - Sync with OpenRouter: GET /api/v1/key (free: it does not consume quota) →
 *   data.free_model_daily_requests {used, limit, remaining}. calls_used becomes
 *   max(local, remote); remote remaining 0 exhausts the day locally too.
 * - Exhausted: one alert per UTC day; the pipeline keeps going on rules only.
 */
import { and, eq, sql } from 'drizzle-orm';
import { aiUsage, alerts } from '../../db/schema';
import { raiseAlert } from '../alerts';
import type { DbOrTx } from '../db';
import { log } from '../log';
import { getSetting } from '../settings';
import { msUntilNextUtcDay, utcDay } from '../time';
import { resolveAiFetch, type AiFetch } from './transport';
import { AI_KEY_SYNC_TIMEOUT_MS, HARD_DAILY_CAP, OPENROUTER_KEY_URL, aiApiKey, aiEnvEnabled, envDailyLimit } from './config';

const blog = log.child({ module: 'ai-budget' });

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
  /** Next UTC midnight (when the counter starts again). */
  resetAt: Date;
  /** Where `used` comes from: our own counter, or OpenRouter's (higher) one. */
  source: 'local' | 'openrouter';
}

export interface BudgetConfig {
  /** AI_ENABLED + key + settings.ai.enabled + limit > 0. */
  enabled: boolean;
  limit: number;
  reserveForManual: number;
}

export async function budgetConfig(db: DbOrTx): Promise<BudgetConfig> {
  const ai = await getSetting(db, 'ai');
  const limit = Math.max(0, Math.min(ai.dailyLimit, envDailyLimit(), HARD_DAILY_CAP));
  return {
    enabled: aiEnvEnabled() && ai.enabled && limit > 0,
    limit,
    reserveForManual: Math.max(0, Math.min(ai.reserveForManual, limit)),
  };
}

function resetAtFor(now: Date): Date {
  return new Date(now.getTime() + msUntilNextUtcDay(now));
}

export async function getAiBudget(db: DbOrTx, now: Date = new Date()): Promise<AiBudget> {
  const day = utcDay(now);
  const cfg = await budgetConfig(db);
  const [row] = await db.select().from(aiUsage).where(eq(aiUsage.day, day)).limit(1);
  const local = row?.callsUsed ?? 0;
  const remote = row?.remoteUsed ?? null;
  const used = Math.max(local, remote ?? 0);
  return {
    day,
    enabled: cfg.enabled,
    used,
    limit: cfg.limit,
    remaining: Math.max(0, cfg.limit - used),
    reserveForManual: cfg.reserveForManual,
    remoteUsed: remote,
    syncedAt: row?.syncedAt ?? null,
    resetAt: resetAtFor(now),
    source: remote !== null && remote > local ? 'openrouter' : 'local',
  };
}

/** Creates today's row (or refreshes its limit when the settings changed). */
async function ensureDayRow(db: DbOrTx, day: string, limit: number): Promise<void> {
  await db
    .insert(aiUsage)
    .values({ day, callsUsed: 0, callsLimit: limit })
    .onDuplicateKeyUpdate({ set: { callsLimit: limit } });
}

export type ReserveResult =
  | { ok: true; day: string; used: number; limit: number }
  | { ok: false; reason: 'disabled' | 'budget'; day: string; used: number; limit: number };

/**
 * Counts one call against today's budget, atomically, BEFORE the call is made. Scheduled calls
 * (manual=false) stop `reserveForManual` short of the limit.
 */
export async function reserveAiCall(db: DbOrTx, opts: { manual?: boolean; now?: Date } = {}): Promise<ReserveResult> {
  const now = opts.now ?? new Date();
  const day = utcDay(now);
  const cfg = await budgetConfig(db);
  if (!cfg.enabled) return { ok: false, reason: 'disabled', day, used: 0, limit: cfg.limit };
  await ensureDayRow(db, day, cfg.limit);
  const keep = opts.manual ? 0 : cfg.reserveForManual;
  const [res] = await db
    .update(aiUsage)
    .set({ callsUsed: sql`${aiUsage.callsUsed} + 1` })
    .where(and(eq(aiUsage.day, day), sql`${aiUsage.callsUsed} < ${aiUsage.callsLimit} - ${keep}`));
  const [row] = await db.select({ used: aiUsage.callsUsed, limit: aiUsage.callsLimit }).from(aiUsage).where(eq(aiUsage.day, day)).limit(1);
  const used = row?.used ?? 0;
  const limit = row?.limit ?? cfg.limit;
  if (res.affectedRows === 1) return { ok: true, day, used, limit };
  await noteBudgetExhausted(db, { day, used, limit, manual: Boolean(opts.manual), reserve: keep });
  return { ok: false, reason: 'budget', day, used, limit };
}

// ---- OpenRouter sync -------------------------------------------------------------------------

export interface RemoteUsage {
  used: number;
  limit: number | null;
  remaining: number | null;
}

/** data.free_model_daily_requests of GET /api/v1/key (null when absent/malformed). */
export function parseKeyResponse(body: unknown): RemoteUsage | null {
  const data = (body as { data?: Record<string, unknown> } | null)?.data;
  const f = data?.free_model_daily_requests as Record<string, unknown> | undefined;
  if (!f || typeof f !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : null);
  const used = n(f.used);
  const limit = n(f.limit);
  const remaining = n(f.remaining) ?? (used !== null && limit !== null ? Math.max(0, limit - used) : null);
  if (used === null) return null;
  return { used, limit, remaining };
}

export interface SyncResult {
  ok: boolean;
  remote: RemoteUsage | null;
  error?: string;
}

/**
 * Pulls OpenRouter's own counter (does not consume quota) and folds it into today's row.
 * Best-effort: any failure leaves the local counter in charge.
 */
export async function syncAiBudget(
  db: DbOrTx,
  opts: { now?: Date; fetch?: AiFetch | null } = {},
): Promise<SyncResult> {
  const now = opts.now ?? new Date();
  const day = utcDay(now);
  const cfg = await budgetConfig(db);
  const key = aiApiKey();
  if (!cfg.enabled || !key) return { ok: false, remote: null, error: 'AI disabled' };
  const doFetch = resolveAiFetch(opts.fetch ?? null);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_KEY_SYNC_TIMEOUT_MS);
  let body: unknown;
  try {
    const res = await doFetch(OPENROUTER_KEY_URL, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
      redirect: 'error',
    });
    if (!res.ok) return { ok: false, remote: null, error: `HTTP ${res.status}` };
    body = (await res.json()) as unknown;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    blog.warn('budget sync failed', { error });
    return { ok: false, remote: null, error };
  } finally {
    clearTimeout(timer);
  }
  const remote = parseKeyResponse(body);
  if (!remote) return { ok: false, remote: null, error: 'no free_model_daily_requests in the key response' };
  await ensureDayRow(db, day, cfg.limit);
  const exhausted = remote.remaining !== null && remote.remaining <= 0;
  await db
    .update(aiUsage)
    .set({
      remoteUsed: remote.used,
      syncedAt: now,
      callsUsed: exhausted
        ? sql`GREATEST(${aiUsage.callsUsed}, ${remote.used}, ${aiUsage.callsLimit})`
        : sql`GREATEST(${aiUsage.callsUsed}, ${remote.used})`,
    })
    .where(eq(aiUsage.day, day));
  return { ok: true, remote };
}

// ---- exhaustion alert ------------------------------------------------------------------------

export function exhaustedAlertKey(day: string): string {
  return `ai_budget_exhausted:${day}`;
}

/** One alert per UTC day (even if the first one was already acknowledged). */
export async function noteBudgetExhausted(
  db: DbOrTx,
  info: { day: string; used: number; limit: number; manual?: boolean; reserve?: number },
): Promise<boolean> {
  try {
    const dedupeKey = exhaustedAlertKey(info.day);
    const [seen] = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.dedupeKey, dedupeKey)).limit(1);
    if (seen) return false;
    const scheduledOnly = !info.manual && (info.reserve ?? 0) > 0 && info.used < info.limit;
    await raiseAlert(db, {
      kind: 'ai_budget',
      severity: 'warn',
      title: scheduledOnly
        ? `AI budget for scheduled work is used up (${info.used}/${info.limit}, ${info.reserve} kept for manual requests)`
        : `AI budget used up for today (${info.used}/${info.limit})`,
      body: 'RADAR keeps running on rules only. Queued AI work waits until the budget resets at 00:00 UTC.',
      dedupeKey,
      entityType: 'ai_usage',
      entityId: info.day,
    });
    return true;
  } catch (err) {
    blog.warn('budget alert failed', { error: err instanceof Error ? err.message : String(err) });
    return false;
  }
}
