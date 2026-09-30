'use server';
/**
 * Login / logout Server Actions (spec §4). The login page (FOUNDATION-UI) uses
 * `useActionState(loginAction, undefined)` with fields `email`, `password` and hidden `next`.
 *
 * Failure handling is uniform: the same generic message whichever of email/password was wrong,
 * both checks always run (constant-time), every failure sleeps ~400ms, rate limiting and lockout
 * come from `login_attempts`, and every outcome is written to the audit trail (never the typed
 * email or password).
 */
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { getDb } from '../db';
import { audit } from '../audit';
import { getEnvVar } from '../env';
import { log } from '../log';
import { clearedSessionCookieOptions, sessionCookieOptions } from './cookie';
import { SESSION_COOKIE, verifySessionToken } from './jwt';
import { constantTimeEqual, verifyPassword } from './password';
import {
  checkLoginGate,
  failureDelayMs,
  recordLockedAttempt,
  recordLoginFailure,
  recordLoginSuccess,
  sleep,
  withLoginIpLock,
} from './rate-limit';
import { clientIp, safeNextPath, userAgent } from './request';
import { evictSessionGateBySid } from './session-gate';
import { createSession, normalizeEmail, revokeSessionBySid } from './session-store';

export interface LoginState {
  error?: string;
  /** ISO timestamp (UTC) when the current lockout ends. */
  lockedUntil?: string;
}

const BAD_CREDENTIALS = 'Wrong email or password.';

type LoginAttempt =
  | { kind: 'locked'; lockedUntil: Date }
  | { kind: 'failed'; lockedUntil: Date | null }
  | { kind: 'ok'; token: string };

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(1024),
  next: z.string().max(2048).optional(),
});

function field(formData: FormData, name: string): string | undefined {
  const v = formData.get(name);
  return typeof v === 'string' ? v : undefined;
}

function lockedMessage(until: Date): LoginState {
  return { error: 'Too many failed attempts. Login is locked for now — try again later.', lockedUntil: until.toISOString() };
}

export async function loginAction(_prev: LoginState | undefined, formData: FormData): Promise<LoginState> {
  const h = await headers();
  const ip = clientIp(h);
  const ua = userAgent(h);
  const db = getDb();

  const parsed = loginSchema.safeParse({
    email: field(formData, 'email'),
    password: field(formData, 'password'),
    next: field(formData, 'next'),
  });
  if (!parsed.success) {
    // Empty/oversized input: not a credential guess, but still slowed down.
    await sleep(failureDelayMs());
    return { error: 'Enter your email and password.' };
  }

  // Gate → verify → record for one IP at a time (in-process), so parallel POSTs from the same IP
  // cannot all pass the gate before the first failure is written: at most `maxFailures` guesses.
  const attempt = await withLoginIpLock(ip, async (): Promise<LoginAttempt> => {
    const gate = await checkLoginGate(db, ip);
    if (gate.delayMs > 0) await sleep(gate.delayMs);
    if (!gate.allowed) {
      await recordLockedAttempt(db, { ip, userAgent: ua });
      await audit(db, {
        action: 'auth.login.locked',
        entityType: 'auth',
        actor: 'anonymous',
        ip,
        after: { lockedUntil: gate.lockedUntil },
      });
      return { kind: 'locked', lockedUntil: gate.lockedUntil };
    }

    const adminEmail = getEnvVar('ADMIN_EMAIL');
    const emailOk = constantTimeEqual(normalizeEmail(parsed.data.email), normalizeEmail(adminEmail));
    // Always run the KDF, even when the email is already wrong.
    const passwordOk = await verifyPassword(parsed.data.password, getEnvVar('ADMIN_PASSWORD_HASH'));

    if (!(emailOk && passwordOk)) {
      const result = await recordLoginFailure(db, { ip, userAgent: ua });
      await audit(db, {
        action: 'auth.login.failed',
        entityType: 'auth',
        actor: 'anonymous',
        ip,
        after: { failuresInWindow: result.failuresInWindow },
      });
      if (result.lockedUntil) {
        await audit(db, {
          action: 'auth.login.lockout',
          entityType: 'auth',
          actor: 'anonymous',
          ip,
          after: { lockedUntil: result.lockedUntil, level: result.lockoutLevel },
        });
        log.warn('auth: login lockout', { ip, lockoutLevel: result.lockoutLevel });
      }
      return { kind: 'failed', lockedUntil: result.lockedUntil };
    }

    const created = await db.transaction(async (tx) => {
      const s = await createSession(tx, { email: adminEmail, ip, userAgent: ua });
      await recordLoginSuccess(tx, { ip, userAgent: ua });
      await audit(tx, { action: 'auth.login.success', entityType: 'session', entityId: s.id, actor: 'admin', ip });
      return s;
    });
    return { kind: 'ok', token: created.token };
  });

  if (attempt.kind !== 'ok') {
    // Outside the per-IP lock: the delay slows the caller, not the next attempt's bookkeeping.
    await sleep(failureDelayMs());
    if (attempt.kind === 'locked') return lockedMessage(attempt.lockedUntil);
    return attempt.lockedUntil ? lockedMessage(attempt.lockedUntil) : { error: BAD_CREDENTIALS };
  }
  (await cookies()).set(SESSION_COOKIE, attempt.token, sessionCookieOptions());

  // redirect() throws by design — keep it outside any try/catch.
  redirect(safeNextPath(parsed.data.next));
}

export async function logoutAction(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  const decoded = await verifySessionToken(token);
  if (decoded) {
    const ip = clientIp(await headers());
    const db = getDb();
    await db.transaction(async (tx) => {
      const id = await revokeSessionBySid(tx, decoded.sid, 'logout');
      if (id !== null) await audit(tx, { action: 'auth.logout', entityType: 'session', entityId: id, actor: 'admin', ip });
    });
    evictSessionGateBySid(decoded.sid);
  }
  jar.set(SESSION_COOKIE, '', clearedSessionCookieOptions());
  redirect('/login');
}
