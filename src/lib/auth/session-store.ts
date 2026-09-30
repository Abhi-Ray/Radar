/**
 * DB side of sessions (no Next.js imports — usable from tests, CLIs and route handlers).
 * The cookie JWT carries a random `sid`; the `sessions` row stores only sha256(sid).
 */
import { randomBytes } from 'node:crypto';
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import { sessions, type SessionRow } from '../../db/schema';
import type { DbOrTx } from '../db';
import { sha256Hex } from '../hash';
import { signSessionToken, verifySessionToken, type SessionToken } from './jwt';
import { constantTimeEqual } from './password';

/** `last_seen_at` is refreshed at most this often (keeps writes off the hot path). */
export const LAST_SEEN_REFRESH_MS = 60 * 60_000;

export function newSid(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSid(sid: string): string {
  return sha256Hex(sid);
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateSessionInput {
  email: string;
  ip: string;
  userAgent: string | null;
  now?: Date;
  secret?: string;
}

export interface CreatedSession {
  id: number;
  sid: string;
  token: string;
}

export async function createSession(db: DbOrTx, input: CreateSessionInput): Promise<CreatedSession> {
  const now = input.now ?? new Date();
  const sid = newSid();
  const token = await signSessionToken(sid, { now, secret: input.secret });
  const [res] = await db.insert(sessions).values({
    sidHash: hashSid(sid),
    email: normalizeEmail(input.email),
    createdAt: now,
    lastSeenAt: now,
    renewedAt: now,
    ip: input.ip.slice(0, 64),
    userAgent: input.userAgent?.slice(0, 512) ?? null,
  });
  return { id: Number(res.insertId), sid, token };
}

export interface ValidatedSession {
  row: SessionRow;
  token: SessionToken;
}

export interface ValidateOptions {
  now?: Date;
  secret?: string;
  /** When given, the session must belong to this email (rotating ADMIN_EMAIL logs everyone out). */
  expectedEmail?: string;
}

/** JWT signature/expiry + DB row exists and is not revoked. */
export async function validateSessionToken(
  db: DbOrTx,
  token: string | undefined | null,
  opts: ValidateOptions = {},
): Promise<ValidatedSession | null> {
  const decoded = await verifySessionToken(token, { secret: opts.secret, now: opts.now });
  if (!decoded) return null;
  return validateSessionRow(db, decoded, opts.expectedEmail);
}

/** DB half of `validateSessionToken` for an already verified token. */
export async function validateSessionRow(db: DbOrTx, decoded: SessionToken, expectedEmail?: string): Promise<ValidatedSession | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.sidHash, hashSid(decoded.sid))).limit(1);
  if (!row || row.revokedAt) return null;
  if (expectedEmail !== undefined && !constantTimeEqual(row.email, normalizeEmail(expectedEmail))) return null;
  return { row, token: decoded };
}

/**
 * Bookkeeping after a validated request: refresh last_seen_at (at most hourly) and record a
 * sliding renewal done by the proxy (token issued after the stored renewed_at).
 */
export async function touchSession(db: DbOrTx, s: ValidatedSession, now: Date = new Date()): Promise<boolean> {
  const renewedAt = s.row.renewedAt ?? s.row.createdAt;
  const renewed = s.token.issuedAt.getTime() - renewedAt.getTime() > 60_000;
  const stale = now.getTime() - s.row.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS;
  if (!renewed && !stale) return false;
  await db
    .update(sessions)
    .set(renewed ? { lastSeenAt: now, renewedAt: s.token.issuedAt } : { lastSeenAt: now })
    .where(and(eq(sessions.id, s.row.id), isNull(sessions.revokedAt)));
  return true;
}

export async function revokeSessionById(db: DbOrTx, id: number, reason: string, now: Date = new Date()): Promise<boolean> {
  const [res] = await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 64) })
    .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)));
  return res.affectedRows > 0;
}

/** Revoke by the raw sid from a (verified) cookie token. */
export async function revokeSessionBySid(db: DbOrTx, sid: string, reason: string, now: Date = new Date()): Promise<number | null> {
  const [row] = await db
    .select({ id: sessions.id })
    .from(sessions)
    .where(and(eq(sessions.sidHash, hashSid(sid)), isNull(sessions.revokedAt)))
    .limit(1);
  if (!row) return null;
  await revokeSessionById(db, row.id, reason, now);
  return row.id;
}

export async function revokeAllSessionsExcept(db: DbOrTx, keepId: number, reason: string, now: Date = new Date()): Promise<number> {
  const [res] = await db
    .update(sessions)
    .set({ revokedAt: now, revokedReason: reason.slice(0, 64) })
    .where(and(ne(sessions.id, keepId), isNull(sessions.revokedAt)));
  return res.affectedRows;
}

export interface SessionListItem {
  id: number;
  email: string;
  createdAt: Date;
  lastSeenAt: Date;
  renewedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  revokedAt: Date | null;
  revokedReason: string | null;
  current: boolean;
}

/** Active sessions first (most recently seen), then recently revoked ones. Never exposes sid hashes. */
export async function listSessionRows(db: DbOrTx, currentId: number | null, limit = 50): Promise<SessionListItem[]> {
  const rows = await db
    .select({
      id: sessions.id,
      email: sessions.email,
      createdAt: sessions.createdAt,
      lastSeenAt: sessions.lastSeenAt,
      renewedAt: sessions.renewedAt,
      ip: sessions.ip,
      userAgent: sessions.userAgent,
      revokedAt: sessions.revokedAt,
      revokedReason: sessions.revokedReason,
    })
    .from(sessions)
    .orderBy(sql`${sessions.revokedAt} IS NULL DESC`, desc(sessions.lastSeenAt))
    .limit(Math.min(Math.max(1, limit), 500));
  return rows.map((r) => ({ ...r, current: r.id === currentId }));
}
