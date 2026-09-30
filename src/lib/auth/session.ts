/**
 * Server-side session helpers (spec §4). `src/proxy.ts` is the DB-backed gate for every non-public
 * request (session-gate.ts, ≤5 s cache); these repeat the DB check (row exists, not revoked,
 * belongs to ADMIN_EMAIL) per render. Every Server Action, Route Handler, page and data-reading
 * generateMetadata calls `requireSession()` itself — a layout check alone is not enough, because
 * partial (RSC) renders can skip the layout.
 */
import 'server-only';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { getDb } from '../db';
import { audit } from '../audit';
import { getEnvVar } from '../env';
import { log } from '../log';
import { SESSION_COOKIE } from './jwt';
import { clientIp, PATH_HEADER, safeNextPath } from './request';
import { clearSessionGateCache, evictSessionGateById } from './session-gate';
import {
  listSessionRows,
  revokeAllSessionsExcept,
  revokeSessionById,
  touchSession,
  validateSessionToken,
  type SessionListItem,
} from './session-store';

export type { SessionListItem } from './session-store';

export interface SessionInfo {
  /** The session's DB id as a string (never the secret sid). */
  sessionId: string;
  email: string;
  id: number;
  createdAt: Date;
  lastSeenAt: Date;
}

/** The current session or null. Deduplicated per request. */
export const getSession = cache(async (): Promise<SessionInfo | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = getDb();
  const valid = await validateSessionToken(db, token, { expectedEmail: getEnvVar('ADMIN_EMAIL') });
  if (!valid) return null;
  try {
    await touchSession(db, valid);
  } catch (err) {
    // Bookkeeping only; never block a valid request on it.
    log.warn('session: touch failed', { err });
  }
  return {
    sessionId: String(valid.row.id),
    email: valid.row.email,
    id: valid.row.id,
    createdAt: valid.row.createdAt,
    lastSeenAt: valid.row.lastSeenAt,
  };
});

/** Returns the session or redirects to /login?next=<current path>. */
export async function requireSession(): Promise<SessionInfo> {
  const session = await getSession();
  if (session) return session;
  const next = safeNextPath((await headers()).get(PATH_HEADER), '');
  redirect(next ? `/login?next=${encodeURIComponent(next)}` : '/login');
}

export async function listSessions(): Promise<SessionListItem[]> {
  const me = await requireSession();
  return listSessionRows(getDb(), me.id);
}

/** Revokes one session by DB id. Revoking the current one signs this browser out on its next request. */
export async function revokeSession(id: number | string): Promise<boolean> {
  const me = await requireSession();
  const sessionId = typeof id === 'number' ? id : Number.parseInt(id, 10);
  if (!Number.isSafeInteger(sessionId) || sessionId <= 0) return false;
  const ip = clientIp(await headers());
  const db = getDb();
  const done = await db.transaction(async (tx) => {
    const revoked = await revokeSessionById(tx, sessionId, sessionId === me.id ? 'self_revoked' : 'revoked');
    if (revoked) {
      await audit(tx, { action: 'auth.session.revoke', entityType: 'session', entityId: sessionId, ip, actor: 'admin' });
    }
    return revoked;
  });
  // The proxy's positive cache must not outlive the revocation in this process.
  evictSessionGateById(sessionId);
  return done;
}

/** Revokes every session except the current one. Returns how many were revoked. */
export async function revokeOtherSessions(): Promise<number> {
  const me = await requireSession();
  const ip = clientIp(await headers());
  const db = getDb();
  const revoked = await db.transaction(async (tx) => {
    const n = await revokeAllSessionsExcept(tx, me.id, 'revoked_others');
    await audit(tx, {
      action: 'auth.session.revoke_others',
      entityType: 'session',
      entityId: me.id,
      after: { revoked: n },
      ip,
      actor: 'admin',
    });
    return n;
  });
  clearSessionGateCache();
  return revoked;
}
