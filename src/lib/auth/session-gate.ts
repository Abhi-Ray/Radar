/**
 * The proxy's DB-backed session check (AUTH-2). No Next.js imports: src/proxy.ts, route handlers,
 * Server Actions and tests all use it.
 *
 * A request passes only when the JWT verifies (signature + expiry) AND its `sessions` row exists,
 * is not revoked and belongs to ADMIN_EMAIL. Positive results are cached per process for at most
 * SESSION_GATE_TTL_MS, keyed by sha256(sid) — so a revoked session stops working within that TTL
 * even from another process, and immediately in this one (logout/revoke call the evict helpers).
 *
 * DB errors are NOT swallowed: the caller fails closed (503) without touching the cookie.
 */
import { getDb, type DbOrTx } from '../db';
import { getEnvVar } from '../env';
import { verifySessionToken, type SessionToken } from './jwt';
import { hashSid, validateSessionRow } from './session-store';

/** Upper bound for how long a positive DB check is reused. Keep ≤ 5 s. */
export const SESSION_GATE_TTL_MS = 5_000;
/** Hard cap on cached entries (one admin; this only bounds memory under abuse). */
const MAX_ENTRIES = 1_000;

interface CacheEntry {
  rowId: number;
  until: number;
}

// On globalThis: the proxy bundle and the app bundles are separate module instances in one
// process, and eviction from logout (app bundle) must reach the proxy's cache.
const cacheKey = Symbol.for('radar.auth.sessionGateCache');
const g = globalThis as typeof globalThis & { [cacheKey]?: Map<string, CacheEntry> };
const cache: Map<string, CacheEntry> = (g[cacheKey] ??= new Map());

export interface SessionGateOptions {
  db?: DbOrTx;
  /** Epoch ms (tests). */
  now?: number;
  secret?: string;
  expectedEmail?: string;
}

export interface SessionGatePass {
  token: SessionToken;
  sessionId: number;
  /** True when the answer came from the per-process cache (no DB query). */
  cached: boolean;
}

/**
 * Returns the verified token for a live session, or null for a missing/invalid/expired/revoked/
 * foreign session. Throws when the DB (or SESSION_SECRET) is unavailable.
 */
export async function checkSessionGate(rawToken: string | undefined | null, opts: SessionGateOptions = {}): Promise<SessionGatePass | null> {
  const now = opts.now ?? Date.now();
  // Signature + expiry on every request, cached or not.
  const token = await verifySessionToken(rawToken, { secret: opts.secret, now: new Date(now) });
  if (!token) return null;
  const sidHash = hashSid(token.sid);
  const cachedId = hit(sidHash, now);
  if (cachedId !== null) return { token, sessionId: cachedId, cached: true };
  const valid = await validateSessionRow(opts.db ?? getDb(), token, opts.expectedEmail ?? getEnvVar('ADMIN_EMAIL'));
  if (!valid) return null;
  remember(sidHash, valid.row.id, now);
  return { token, sessionId: valid.row.id, cached: false };
}

function hit(sidHash: string, now: number): number | null {
  const e = cache.get(sidHash);
  if (!e) return null;
  if (e.until <= now) {
    cache.delete(sidHash);
    return null;
  }
  return e.rowId;
}

function remember(sidHash: string, rowId: number, now: number): void {
  if (cache.size >= MAX_ENTRIES) {
    for (const [k, v] of cache) if (v.until <= now) cache.delete(k);
    if (cache.size >= MAX_ENTRIES) cache.clear();
  }
  cache.set(sidHash, { rowId, until: now + SESSION_GATE_TTL_MS });
}

/** Forget one session by its raw sid (logout). */
export function evictSessionGateBySid(sid: string): void {
  cache.delete(hashSid(sid));
}

/** Forget one session by its DB id (revoke from the sessions list). */
export function evictSessionGateById(id: number): void {
  for (const [k, v] of cache) if (v.rowId === id) cache.delete(k);
}

/** Forget everything (revoke-all-others; tests). */
export function clearSessionGateCache(): void {
  cache.clear();
}
