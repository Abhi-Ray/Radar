/**
 * Login rate limiting + lockout, backed by `login_attempts` (spec §4).
 *
 * - Per IP: 5 failures within 15 min → locked for 15 min. Each further lockout of the same IP
 *   (while the previous one is "recent", i.e. it ENDED less than 24h ago and was not followed by a
 *   successful login) doubles the duration, capped at 24h. Measuring from the end of the lock means
 *   a persistent attacker stays at the 24h cap instead of cycling back to 15 min.
 * - Global: more than 30 failures (all IPs) in the last hour → every attempt waits an extra 2s.
 *   There is deliberately NO global hard lock (it would let anyone lock the owner out).
 * - Every failure costs ~400ms (the caller sleeps `failureDelayMs()`).
 */
import { randomInt } from 'node:crypto';
import { and, count, desc, eq, gt, gte, inArray, lt } from 'drizzle-orm';
import { loginAttempts } from '../../db/schema';
import type { DbOrTx } from '../db';

export const RATE_LIMIT = {
  windowMs: 15 * 60_000,
  maxFailures: 5,
  baseLockMs: 15 * 60_000,
  maxLockMs: 24 * 60 * 60_000,
  /** A previous lockout that ended longer ago than this no longer escalates the next one. */
  escalationMemoryMs: 24 * 60 * 60_000,
  globalWindowMs: 60 * 60_000,
  globalThreshold: 30,
  globalDelayMs: 2_000,
  failureDelayMs: 400,
} as const;

/** Outcomes that count as a failed credential attempt. ('locked' attempts never extend a lock.) */
const FAILURE_OUTCOMES = ['bad_credentials', 'invalid'] as const;
type FailureOutcome = (typeof FAILURE_OUTCOMES)[number];

/** Lock duration for a lockout level (1 = first). 15 min · 2^(level-1), capped at 24h. */
export function lockDurationMs(level: number): number {
  const lvl = Math.max(1, Math.floor(level));
  // 2^7 · 15 min > 24h, so cap the exponent before multiplying.
  const factor = 2 ** Math.min(lvl - 1, 10);
  return Math.min(RATE_LIMIT.baseLockMs * factor, RATE_LIMIT.maxLockMs);
}

/** ~400ms (±50ms jitter) artificial delay applied to every failed attempt. */
export function failureDelayMs(): number {
  return RATE_LIMIT.failureDelayMs + randomInt(-50, 51);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

export type LoginGate = { allowed: true; delayMs: number } | { allowed: false; lockedUntil: Date; delayMs: number };

async function activeLock(db: DbOrTx, ip: string, now: Date): Promise<Date | null> {
  const rows = await db
    .select({ lockedUntil: loginAttempts.lockedUntil })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, ip), eq(loginAttempts.outcome, 'lockout'), gt(loginAttempts.lockedUntil, now)))
    .orderBy(desc(loginAttempts.lockedUntil))
    .limit(1);
  return rows[0]?.lockedUntil ?? null;
}

/** Global failures in the last hour (all IPs). */
export async function globalFailureCount(db: DbOrTx, now: Date): Promise<number> {
  const since = new Date(now.getTime() - RATE_LIMIT.globalWindowMs);
  const rows = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(inArray(loginAttempts.outcome, [...FAILURE_OUTCOMES]), gte(loginAttempts.at, since)));
  return Number(rows[0]?.n ?? 0);
}

/** Called BEFORE checking credentials. */
export async function checkLoginGate(db: DbOrTx, ip: string, now: Date = new Date()): Promise<LoginGate> {
  const globalFailures = await globalFailureCount(db, now);
  const delayMs = globalFailures > RATE_LIMIT.globalThreshold ? RATE_LIMIT.globalDelayMs : 0;
  const lockedUntil = await activeLock(db, ip, now);
  if (lockedUntil) return { allowed: false, lockedUntil, delayMs };
  return { allowed: true, delayMs };
}

export interface AttemptMeta {
  ip: string;
  userAgent?: string | null;
  now?: Date;
}

/** Records an attempt made while locked (does not extend the lock). */
export async function recordLockedAttempt(db: DbOrTx, meta: AttemptMeta): Promise<void> {
  await db.insert(loginAttempts).values({
    ip: meta.ip,
    outcome: 'locked',
    success: false,
    userAgent: meta.userAgent ?? null,
    at: meta.now ?? new Date(),
  });
}

export interface FailureResult {
  /** Set when this failure triggered a new lockout. */
  lockedUntil: Date | null;
  lockoutLevel: number | null;
  failuresInWindow: number;
}

/**
 * Records a failed attempt and, when the IP reaches 5 failures inside the window (counted since
 * its last lockout), starts a lockout. Returns the new lock, if any.
 */
export async function recordLoginFailure(
  db: DbOrTx,
  meta: AttemptMeta & { outcome?: FailureOutcome },
): Promise<FailureResult> {
  const now = meta.now ?? new Date();
  await db.insert(loginAttempts).values({
    ip: meta.ip,
    outcome: meta.outcome ?? 'bad_credentials',
    success: false,
    userAgent: meta.userAgent ?? null,
    at: now,
  });

  const [lastLock] = await db
    .select({ at: loginAttempts.at, level: loginAttempts.lockoutLevel, lockedUntil: loginAttempts.lockedUntil })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, meta.ip), eq(loginAttempts.outcome, 'lockout')))
    .orderBy(desc(loginAttempts.at), desc(loginAttempts.id))
    .limit(1);

  // Failures that already caused the last lockout never count again.
  const windowStart = new Date(now.getTime() - RATE_LIMIT.windowMs);
  const since =
    lastLock && lastLock.at >= windowStart ? gt(loginAttempts.at, lastLock.at) : gte(loginAttempts.at, windowStart);
  const [{ n }] = await db
    .select({ n: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.ip, meta.ip), inArray(loginAttempts.outcome, [...FAILURE_OUTCOMES]), since));
  const failuresInWindow = Number(n);
  if (failuresInWindow < RATE_LIMIT.maxFailures) return { lockedUntil: null, lockoutLevel: null, failuresInWindow };

  let level = 1;
  const lastLockEnd = lastLock ? (lastLock.lockedUntil ?? lastLock.at) : null;
  if (lastLock && lastLockEnd && now.getTime() - lastLockEnd.getTime() < RATE_LIMIT.escalationMemoryMs) {
    const [success] = await db
      .select({ id: loginAttempts.id })
      .from(loginAttempts)
      .where(and(eq(loginAttempts.ip, meta.ip), eq(loginAttempts.outcome, 'success'), gt(loginAttempts.at, lastLock.at)))
      .limit(1);
    if (!success) level = (lastLock.level ?? 1) + 1;
  }
  const lockedUntil = new Date(now.getTime() + lockDurationMs(level));
  await db.insert(loginAttempts).values({
    ip: meta.ip,
    outcome: 'lockout',
    success: false,
    userAgent: meta.userAgent ?? null,
    lockedUntil,
    lockoutLevel: level,
    at: now,
  });
  return { lockedUntil, lockoutLevel: level, failuresInWindow };
}

export async function recordLoginSuccess(db: DbOrTx, meta: AttemptMeta): Promise<void> {
  await db.insert(loginAttempts).values({
    ip: meta.ip,
    outcome: 'success',
    success: true,
    userAgent: meta.userAgent ?? null,
    at: meta.now ?? new Date(),
  });
}

/** Default retention for login_attempts rows (the rate limiter itself needs < 48h of history). */
export const LOGIN_ATTEMPTS_RETENTION_MS = 30 * 24 * 60 * 60_000;

/**
 * Deletes login attempts older than the retention period (retention job). Never shorter than the
 * lockout history the limiter relies on (24h max lock + 24h escalation memory). Returns rows deleted.
 */
export async function pruneLoginAttempts(
  db: DbOrTx,
  opts: { now?: Date; retentionMs?: number } = {},
): Promise<number> {
  const minRetention = RATE_LIMIT.maxLockMs + RATE_LIMIT.escalationMemoryMs;
  const retention = Math.max(minRetention, opts.retentionMs ?? LOGIN_ATTEMPTS_RETENTION_MS);
  const cutoff = new Date((opts.now ?? new Date()).getTime() - retention);
  const [res] = await db.delete(loginAttempts).where(lt(loginAttempts.at, cutoff));
  return res.affectedRows;
}
