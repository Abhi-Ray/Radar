/**
 * DB-backed auth tests: rate limiting/lockout, the session store, the login/logout Server Actions,
 * requireSession() and POST /api/auth/logout. Next's request APIs are mocked.
 */
import { desc, eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, loginAttempts, sessions } from '../../src/db/schema';
import { hashPassword } from '../../src/lib/auth/password';
import {
  checkLoginGate,
  pruneLoginAttempts,
  recordLoginFailure,
  recordLoginSuccess,
  RATE_LIMIT,
} from '../../src/lib/auth/rate-limit';
import {
  createSession,
  listSessionRows,
  LAST_SEEN_REFRESH_MS,
  revokeAllSessionsExcept,
  revokeSessionBySid,
  touchSession,
  validateSessionToken,
} from '../../src/lib/auth/session-store';
import { resetEnvCacheForTests } from '../../src/lib/env';
import { startTestDb, type TestDb } from '../helpers/db';

const state = vi.hoisted(() => ({
  headers: new Headers(),
  jar: new Map<string, { value: string; options?: Record<string, unknown> }>(),
}));

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

vi.mock('next/headers', () => ({
  headers: async () => state.headers,
  cookies: async () => ({
    get: (name: string) => (state.jar.has(name) ? { name, value: state.jar.get(name)!.value } : undefined),
    set: (name: string, value: string, options?: Record<string, unknown>) => {
      state.jar.set(name, { value, options });
    },
  }),
}));
vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    throw new RedirectSignal(url);
  },
}));

const SECRET = 'auth-db-test-secret-at-least-32-characters-long';
const EMAIL = 'owner@example.test';
const PASSWORD = 'a long and correct password';
const IP = '203.0.113.7';

let t: TestDb;
const envBackup: Record<string, string | undefined> = {};

function setEnv(key: string, value: string) {
  if (!(key in envBackup)) envBackup[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  t = await startTestDb({ bindGlobal: true });
  setEnv('ADMIN_EMAIL', EMAIL);
  setEnv('ADMIN_PASSWORD_HASH', await hashPassword(PASSWORD, { N: 16384 }));
  setEnv('SESSION_SECRET', SECRET);
  setEnv('APP_URL', 'https://radar.example.test');
  resetEnvCacheForTests();
});

afterAll(async () => {
  await t?.stop();
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCacheForTests();
});

beforeEach(async () => {
  await t.truncateAll();
  state.jar.clear();
  state.headers = new Headers({ 'x-real-ip': IP, 'user-agent': 'vitest' });
});

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
}

async function expectRedirect(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (e) {
    if (e instanceof RedirectSignal) return e.url;
    throw e;
  }
  throw new Error('expected a redirect');
}

describe('rate limiting + lockout', () => {
  const t0 = new Date('2026-03-01T10:00:00.000Z');
  const at = (ms: number) => new Date(t0.getTime() + ms);

  it('locks an IP after 5 failures in 15 minutes, only that IP', async () => {
    for (let i = 0; i < 4; i++) {
      const r = await recordLoginFailure(t.db, { ip: IP, now: at(i * 1000) });
      expect(r.lockedUntil).toBeNull();
      expect(r.failuresInWindow).toBe(i + 1);
    }
    expect((await checkLoginGate(t.db, IP, at(5000))).allowed).toBe(true);
    const fifth = await recordLoginFailure(t.db, { ip: IP, now: at(5000) });
    expect(fifth.lockoutLevel).toBe(1);
    expect(fifth.lockedUntil?.getTime()).toBe(at(5000).getTime() + 15 * 60_000);

    const gate = await checkLoginGate(t.db, IP, at(6000));
    expect(gate.allowed).toBe(false);
    expect((await checkLoginGate(t.db, '198.51.100.1', at(6000))).allowed).toBe(true);
    // Lock expires.
    expect((await checkLoginGate(t.db, IP, at(5000 + 15 * 60_000 + 1))).allowed).toBe(true);
  });

  it('does not lock when failures are spread beyond the window', async () => {
    for (let i = 0; i < 8; i++) {
      const r = await recordLoginFailure(t.db, { ip: IP, now: at(i * 4 * 60_000) });
      expect(r.lockedUntil).toBeNull();
    }
  });

  it('doubles repeat lockouts and resets escalation after a success', async () => {
    let now = 0;
    const burst = async () => {
      let last = null as Awaited<ReturnType<typeof recordLoginFailure>> | null;
      for (let i = 0; i < 5; i++) last = await recordLoginFailure(t.db, { ip: IP, now: at((now += 1000)) });
      return last!;
    };
    const first = await burst();
    expect(first.lockoutLevel).toBe(1);
    now += 16 * 60_000;
    const second = await burst();
    expect(second.lockoutLevel).toBe(2);
    expect(second.lockedUntil!.getTime() - at(now).getTime()).toBe(30 * 60_000);
    now += 31 * 60_000;
    const third = await burst();
    expect(third.lockoutLevel).toBe(3);
    now += 61 * 60_000;
    await recordLoginSuccess(t.db, { ip: IP, now: at((now += 1000)) });
    const afterSuccess = await burst();
    expect(afterSuccess.lockoutLevel).toBe(1);
  });

  it('stays at the 24h cap for a persistent attacker and forgets a lock that ended over 24h ago', async () => {
    let now = 0;
    const burst = async () => {
      let last = null as Awaited<ReturnType<typeof recordLoginFailure>> | null;
      for (let i = 0; i < 5; i++) last = await recordLoginFailure(t.db, { ip: IP, now: at((now += 1000)) });
      return last!;
    };
    const levels: number[] = [];
    const durations: number[] = [];
    for (let round = 0; round < 10; round++) {
      const r = await burst();
      levels.push(r.lockoutLevel!);
      durations.push(r.lockedUntil!.getTime() - at(now).getTime());
      // Retry right after the lock expires.
      now = r.lockedUntil!.getTime() - t0.getTime() + 60_000;
    }
    expect(levels).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(durations.slice(0, 8).map((d) => d / 60_000)).toEqual([15, 30, 60, 120, 240, 480, 960, 1440]);
    expect(durations.slice(7).every((d) => d === RATE_LIMIT.maxLockMs)).toBe(true);

    // A lock that ended more than 24h ago no longer escalates.
    now += RATE_LIMIT.escalationMemoryMs + 60_000;
    expect((await burst()).lockoutLevel).toBe(1);
  });

  it('prunes old attempts but never the history an active lock depends on', async () => {
    const day = 24 * 60 * 60_000;
    await recordLoginSuccess(t.db, { ip: IP, now: at(-40 * day) });
    await recordLoginFailure(t.db, { ip: IP, now: at(-31 * day) });
    await recordLoginFailure(t.db, { ip: IP, now: at(-29 * day) });
    let now = 0;
    for (let i = 0; i < 5; i++) await recordLoginFailure(t.db, { ip: IP, now: at((now += 1000)) });
    expect(await pruneLoginAttempts(t.db, { now: at(now) })).toBe(2);
    // A too-short retention is raised to the limiter's minimum (48h): the fresh lockout survives.
    expect(await pruneLoginAttempts(t.db, { now: at(now), retentionMs: 1000 })).toBe(1);
    const rows = await t.db.select().from(loginAttempts);
    expect(rows).toHaveLength(6);
    expect((await checkLoginGate(t.db, IP, at(now + 1000))).allowed).toBe(false);
  });

  it('adds a global delay above 30 failures/hour but never a global lock', async () => {
    for (let i = 0; i < RATE_LIMIT.globalThreshold + 1; i++) {
      await recordLoginFailure(t.db, { ip: `198.51.100.${i % 200}`, now: at(i * 60_000 + 1) });
    }
    const gate = await checkLoginGate(t.db, '192.0.2.55', at(40 * 60_000));
    expect(gate).toEqual({ allowed: true, delayMs: RATE_LIMIT.globalDelayMs });
    const later = await checkLoginGate(t.db, '192.0.2.55', at(2 * 60 * 60_000));
    expect(later).toEqual({ allowed: true, delayMs: 0 });
  });
});

describe('session store', () => {
  it('creates, validates, touches and revokes sessions; stores only the sid hash', async () => {
    const now = new Date();
    const s = await createSession(t.db, { email: ' Owner@Example.TEST ', ip: IP, userAgent: 'ua', now, secret: SECRET });
    const [row] = await t.db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(row.email).toBe(EMAIL);
    expect(row.sidHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.sidHash).not.toContain(s.sid);

    const valid = await validateSessionToken(t.db, s.token, { secret: SECRET, expectedEmail: EMAIL });
    expect(valid?.row.id).toBe(s.id);
    expect(await validateSessionToken(t.db, s.token, { secret: SECRET, expectedEmail: 'other@example.test' })).toBeNull();

    expect(await touchSession(t.db, valid!, new Date(now.getTime() + 1000))).toBe(false);
    expect(await touchSession(t.db, valid!, new Date(now.getTime() + LAST_SEEN_REFRESH_MS + 1000))).toBe(true);

    expect(await revokeSessionBySid(t.db, s.sid, 'logout')).toBe(s.id);
    expect(await validateSessionToken(t.db, s.token, { secret: SECRET })).toBeNull();
    expect(await revokeSessionBySid(t.db, s.sid, 'logout')).toBeNull();
  });

  it('revokes all other sessions and lists active ones first without secrets', async () => {
    const a = await createSession(t.db, { email: EMAIL, ip: IP, userAgent: null, secret: SECRET });
    const b = await createSession(t.db, { email: EMAIL, ip: IP, userAgent: null, secret: SECRET });
    const c = await createSession(t.db, { email: EMAIL, ip: IP, userAgent: null, secret: SECRET });
    expect(await revokeAllSessionsExcept(t.db, b.id, 'revoked_others')).toBe(2);
    const list = await listSessionRows(t.db, b.id);
    expect(list[0].id).toBe(b.id);
    expect(list[0].current).toBe(true);
    expect(list.filter((x) => x.revokedAt).map((x) => x.id).sort()).toEqual([a.id, c.id].sort());
    expect(Object.keys(list[0])).not.toContain('sidHash');
  });
});

describe('login / logout actions', () => {
  it('rejects bad credentials with one generic message and audits without the email/password', async () => {
    const { loginAction } = await import('../../src/lib/auth/actions');
    const wrongPw = await loginAction(undefined, form({ email: EMAIL, password: 'nope' }));
    const wrongEmail = await loginAction(undefined, form({ email: 'x@example.test', password: PASSWORD }));
    expect(wrongPw.error).toBe('Wrong email or password.');
    expect(wrongEmail.error).toBe(wrongPw.error);
    expect(state.jar.size).toBe(0);
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login.failed'));
    expect(rows).toHaveLength(2);
    const dump = JSON.stringify(rows);
    expect(dump).not.toContain(PASSWORD);
    expect(dump).not.toContain('x@example.test');
    expect(rows[0].ip).toBe(IP);
    const empty = await loginAction(undefined, form({ email: '', password: '' }));
    expect(empty.error).toBe('Enter your email and password.');
  });

  it('logs in, sets a hardened cookie and redirects only to safe paths', async () => {
    const { loginAction } = await import('../../src/lib/auth/actions');
    const url = await expectRedirect(loginAction(undefined, form({ email: 'OWNER@example.test', password: PASSWORD, next: '/jobs?x=1' })));
    expect(url).toBe('/jobs?x=1');
    const cookie = state.jar.get('radar_session');
    expect(cookie?.value).toMatch(/^[\w-]+\.[\w-]+\.[\w-]+$/);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: 'lax', secure: true, path: '/', maxAge: 31_536_000 });
    const [success] = await t.db.select().from(loginAttempts).where(eq(loginAttempts.outcome, 'success'));
    expect(success.ip).toBe(IP);

    state.jar.clear();
    const evil = await expectRedirect(loginAction(undefined, form({ email: EMAIL, password: PASSWORD, next: '//evil.example' })));
    expect(evil).toBe('/');
  });

  it('locks out after 5 failures even for the right password afterwards', async () => {
    const { loginAction } = await import('../../src/lib/auth/actions');
    let last;
    for (let i = 0; i < 5; i++) last = await loginAction(undefined, form({ email: EMAIL, password: `bad-${i}` }));
    expect(last?.lockedUntil).toBeTruthy();
    const blocked = await loginAction(undefined, form({ email: EMAIL, password: PASSWORD }));
    expect(blocked.lockedUntil).toBeTruthy();
    expect(state.jar.size).toBe(0);
    const [lockout] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login.lockout'));
    expect(lockout).toBeTruthy();
    const [locked] = await t.db.select().from(loginAttempts).where(eq(loginAttempts.outcome, 'locked'));
    expect(locked).toBeTruthy();
  }, 30_000);

  it('requireSession accepts a live session and redirects when revoked or missing', async () => {
    const { loginAction, logoutAction } = await import('../../src/lib/auth/actions');
    const { getSession, requireSession } = await import('../../src/lib/auth/session');
    await expectRedirect(loginAction(undefined, form({ email: EMAIL, password: PASSWORD })));
    const me = await requireSession();
    expect(me.email).toBe(EMAIL);
    expect(me.sessionId).toBe(String(me.id));

    expect(await expectRedirect(logoutAction())).toBe('/login');
    expect(state.jar.get('radar_session')).toMatchObject({ value: '', options: { maxAge: 0 } });
    const [row] = await t.db.select().from(sessions).where(eq(sessions.id, me.id));
    expect(row.revokedReason).toBe('logout');

    state.headers.set('x-radar-path', '/jobs?country=DE');
    expect(await getSession()).toBeNull();
    expect(await expectRedirect(requireSession())).toBe(`/login?next=${encodeURIComponent('/jobs?country=DE')}`);
  });

  it('a session for a previous ADMIN_EMAIL is rejected', async () => {
    const { getSession } = await import('../../src/lib/auth/session');
    const s = await createSession(t.db, { email: 'old-owner@example.test', ip: IP, userAgent: null, secret: SECRET });
    state.jar.set('radar_session', { value: s.token });
    expect(await getSession()).toBeNull();
  });
});

describe('POST /api/auth/logout', () => {
  it('rejects cross-origin requests and revokes on same-origin ones', async () => {
    const { POST } = await import('../../src/app/api/auth/logout/route');
    const s = await createSession(t.db, { email: EMAIL, ip: IP, userAgent: null, secret: SECRET });
    const cookie = `radar_session=${s.token}`;

    const cross = await POST(
      new NextRequest('https://radar.example.test/api/auth/logout', { method: 'POST', headers: { origin: 'https://evil.example', cookie } }),
    );
    expect(cross.status).toBe(403);
    const [still] = await t.db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(still.revokedAt).toBeNull();

    const ok = await POST(
      new NextRequest('http://internal:3000/api/auth/logout', {
        method: 'POST',
        headers: { origin: 'https://radar.example.test', cookie, accept: 'text/html' },
      }),
    );
    expect(ok.status).toBe(303);
    expect(ok.headers.get('location')).toBe('https://radar.example.test/login');
    expect(ok.headers.get('set-cookie')).toMatch(/radar_session=;/);
    const [revoked] = await t.db.select().from(sessions).where(eq(sessions.id, s.id));
    expect(revoked.revokedReason).toBe('logout');
    const [a] = await t.db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    expect(a.action).toBe('auth.logout');
  });
});
