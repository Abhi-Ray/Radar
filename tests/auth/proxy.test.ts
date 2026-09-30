/**
 * AUTH-2 / SESS-1: src/proxy.ts is the DB-backed gate for every non-public request (also partial
 * RSC renders, which skip the (app) layout). Covers valid / revoked / expired / foreign sessions,
 * DB outage (fail closed, cookie untouched), the ≤5 s per-process cache, eviction on logout and
 * revoke, and renewal only after the DB check passed.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { sessions } from '../../src/db/schema';
import { SESSION_RENEW_AFTER_S } from '../../src/lib/auth/jwt';
import { checkSessionGate, clearSessionGateCache, SESSION_GATE_TTL_MS } from '../../src/lib/auth/session-gate';
import { createSession, revokeSessionBySid } from '../../src/lib/auth/session-store';
import { resetEnvCacheForTests } from '../../src/lib/env';
import { proxy } from '../../src/proxy';
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

const SECRET = 'proxy-test-secret-at-least-32-characters-long!';
const EMAIL = 'owner@example.test';
const IP = '203.0.113.9';
const ORIGIN = 'https://radar.example.test';
const DB_HANDLE = Symbol.for('radar.db.handle');

let t: TestDb;
const envBackup: Record<string, string | undefined> = {};

function setEnv(key: string, value: string) {
  if (!(key in envBackup)) envBackup[key] = process.env[key];
  process.env[key] = value;
}

beforeAll(async () => {
  t = await startTestDb({ bindGlobal: true });
  setEnv('ADMIN_EMAIL', EMAIL);
  setEnv('SESSION_SECRET', SECRET);
  setEnv('APP_URL', ORIGIN);
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
  clearSessionGateCache();
  state.jar.clear();
  state.headers = new Headers({ 'x-real-ip': IP, 'user-agent': 'vitest' });
});

/** A client-side navigation (partial RSC render of a data page inside the (app) group). */
const RSC_HEADERS = {
  RSC: '1',
  'Next-Router-State-Tree': encodeURIComponent(JSON.stringify(['', { children: ['(app)', { children: ['jobs', { children: ['__PAGE__', {}] }] }] }])),
};

function req(pathname: string, token?: string, extra: Record<string, string> = {}): NextRequest {
  const headers: Record<string, string> = { ...extra };
  if (token !== undefined) headers.cookie = `radar_session=${token}`;
  return new NextRequest(`${ORIGIN}${pathname}`, { headers });
}

async function newSession(opts: { email?: string; now?: Date } = {}) {
  return createSession(t.db, { email: opts.email ?? EMAIL, ip: IP, userAgent: null, secret: SECRET, now: opts.now });
}

function passed(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1';
}

function sessionCookie(res: Response): string | null {
  const all = res.headers.getSetCookie?.() ?? [];
  return all.find((c) => c.startsWith('radar_session=')) ?? null;
}

async function withBrokenDb<T>(fn: () => Promise<T>): Promise<T> {
  const g = globalThis as Record<symbol, unknown>;
  const real = g[DB_HANDLE];
  const boom = () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:3306');
  };
  g[DB_HANDLE] = { db: { select: boom, transaction: boom }, pool: { end: async () => undefined } };
  try {
    return await fn();
  } finally {
    g[DB_HANDLE] = real;
  }
}

describe('proxy: DB-backed gate', () => {
  it('passes a live session (page, API and RSC request) without touching the cookie', async () => {
    const s = await newSession();
    for (const r of [req('/jobs', s.token), req('/api/export', s.token), req('/jobs', s.token, RSC_HEADERS)]) {
      const res = await proxy(r);
      expect(passed(res)).toBe(true);
      expect(sessionCookie(res)).toBeNull();
      expect(res.headers.get('content-security-policy')).toContain("'nonce-");
    }
  });

  it('rejects a revoked session: 307 for pages (also RSC), 401 JSON for APIs, and clears the cookie', async () => {
    const s = await newSession();
    expect(passed(await proxy(req('/jobs', s.token)))).toBe(true);
    // Revoked by another process: this process only sees it once the cache entry expires.
    await revokeSessionBySid(t.db, s.sid, 'revoked');
    clearSessionGateCache();

    const page = await proxy(req('/jobs?country=DE', s.token));
    expect(page.status).toBe(307);
    expect(page.headers.get('location')).toBe(`${ORIGIN}/login?next=${encodeURIComponent('/jobs?country=DE')}`);
    expect(sessionCookie(page)).toMatch(/^radar_session=;.*Max-Age=0/i);

    const rsc = await proxy(req('/jobs', s.token, RSC_HEADERS));
    expect(rsc.status).toBe(307);
    expect(passed(rsc)).toBe(false);
    expect(await rsc.text()).toBe('');

    const api = await proxy(req('/api/export', s.token));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ ok: false, error: 'unauthorized' });
    expect(api.headers.get('cache-control')).toBe('no-store');
    expect(sessionCookie(api)).toMatch(/^radar_session=;.*Max-Age=0/i);
  });

  it('rejects a session whose row is gone', async () => {
    const s = await newSession();
    await t.db.delete(sessions).where(eq(sessions.id, s.id));
    const res = await proxy(req('/', s.token));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login`);
  });

  it('rejects an expired JWT even though its row is still live', async () => {
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60_000);
    const s = await newSession({ now: twoYearsAgo });
    const res = await proxy(req('/api/jobs', s.token));
    expect(res.status).toBe(401);
    expect(sessionCookie(res)).toMatch(/^radar_session=;/);
  });

  it('rejects a session that belongs to another (previous) ADMIN_EMAIL', async () => {
    const s = await newSession({ email: 'old-owner@example.test' });
    const res = await proxy(req('/jobs', s.token));
    expect(res.status).toBe(307);
    expect(sessionCookie(res)).toMatch(/^radar_session=;/);
    expect(await checkSessionGate(s.token)).toBeNull();
  });

  it('redirects without a cookie and does not set one', async () => {
    const res = await proxy(req('/jobs'));
    expect(res.status).toBe(307);
    expect(sessionCookie(res)).toBeNull();
    const api = await proxy(req('/api/export'));
    expect(api.status).toBe(401);
  });

  it('fails closed with 503 when the DB check throws, and leaves the cookie alone', async () => {
    const s = await newSession();
    await withBrokenDb(async () => {
      const api = await proxy(req('/api/export', s.token));
      expect(api.status).toBe(503);
      expect(await api.json()).toEqual({ ok: false, error: 'unavailable' });
      expect(api.headers.get('cache-control')).toBe('no-store');
      expect(sessionCookie(api)).toBeNull();

      const page = await proxy(req('/jobs', s.token, RSC_HEADERS));
      expect(page.status).toBe(503);
      expect(passed(page)).toBe(false);
      expect(await page.text()).toBe('Service temporarily unavailable.');
      expect(sessionCookie(page)).toBeNull();
    });
    // Back to normal once the DB is reachable again.
    expect(passed(await proxy(req('/jobs', s.token)))).toBe(true);
  });

  it('public paths skip the gate (no DB access at all)', async () => {
    await withBrokenDb(async () => {
      const res = await proxy(req('/login'));
      expect(passed(res)).toBe(true);
      expect(passed(await proxy(req('/login/x')))).toBe(false);
    });
  });

  it('renews an old token only after the DB check passed', async () => {
    const old = new Date(Date.now() - (SESSION_RENEW_AFTER_S + 60) * 1000);
    const live = await newSession({ now: old });
    const ok = await proxy(req('/jobs', live.token));
    expect(passed(ok)).toBe(true);
    const renewed = sessionCookie(ok);
    expect(renewed).toMatch(/^radar_session=[\w-]+\.[\w-]+\.[\w-]+;/);
    expect(renewed).toMatch(/Max-Age=31536000/i);

    const dead = await newSession({ now: old });
    await revokeSessionBySid(t.db, dead.sid, 'revoked');
    const res = await proxy(req('/jobs', dead.token));
    expect(res.status).toBe(307);
    // Only the clearing cookie, never a fresh token for a revoked session.
    expect(sessionCookie(res)).toMatch(/^radar_session=;/);
  });
});

describe('session gate cache', () => {
  it('caches a positive answer for at most SESSION_GATE_TTL_MS (≤ 5 s)', async () => {
    expect(SESSION_GATE_TTL_MS).toBeLessThanOrEqual(5_000);
    const s = await newSession();
    const now = Date.now();
    const first = await checkSessionGate(s.token, { now });
    expect(first).toMatchObject({ sessionId: s.id, cached: false });
    const second = await checkSessionGate(s.token, { now: now + 1_000 });
    expect(second).toMatchObject({ sessionId: s.id, cached: true });

    // Revoked elsewhere (no eviction in this process): stale for at most the TTL.
    await revokeSessionBySid(t.db, s.sid, 'revoked');
    expect(await checkSessionGate(s.token, { now: now + SESSION_GATE_TTL_MS - 1 })).toMatchObject({ cached: true });
    expect(await checkSessionGate(s.token, { now: now + SESSION_GATE_TTL_MS })).toBeNull();
  });

  it('never caches a negative answer', async () => {
    const s = await newSession();
    await revokeSessionBySid(t.db, s.sid, 'revoked');
    const now = Date.now();
    expect(await checkSessionGate(s.token, { now })).toBeNull();
    await t.db.update(sessions).set({ revokedAt: null, revokedReason: null }).where(eq(sessions.id, s.id));
    expect(await checkSessionGate(s.token, { now: now + 1 })).toMatchObject({ cached: false });
  });

  it('checks the JWT on every request, even on a cache hit', async () => {
    const s = await newSession();
    const now = Date.now();
    expect(await checkSessionGate(s.token, { now })).not.toBeNull();
    expect(await checkSessionGate(`${s.token}x`, { now: now + 1 })).toBeNull();
    expect(await checkSessionGate(s.token, { now: now + 1, secret: 'another-secret-that-is-at-least-32-chars' })).toBeNull();
  });

  it('POST /api/auth/logout evicts the cache entry: the next proxy request is rejected at once', async () => {
    const { POST } = await import('../../src/app/api/auth/logout/route');
    const s = await newSession();
    expect(passed(await proxy(req('/jobs', s.token)))).toBe(true);
    const out = await POST(
      new NextRequest(`${ORIGIN}/api/auth/logout`, { method: 'POST', headers: { origin: ORIGIN, cookie: `radar_session=${s.token}` } }),
    );
    expect(out.status).toBe(200);
    // Well within the TTL: without eviction this would still be a cache hit.
    const after = await proxy(req('/jobs', s.token, RSC_HEADERS));
    expect(after.status).toBe(307);
  });

  it('logoutAction evicts the cache entry', async () => {
    const { logoutAction } = await import('../../src/lib/auth/actions');
    const s = await newSession();
    expect(passed(await proxy(req('/jobs', s.token)))).toBe(true);
    state.jar.set('radar_session', { value: s.token });
    await expect(logoutAction()).rejects.toThrow(RedirectSignal);
    expect((await proxy(req('/jobs', s.token))).status).toBe(307);
  });

  it('revokeSession (sessions list) evicts the revoked session in this process', async () => {
    const { revokeSession, revokeOtherSessions } = await import('../../src/lib/auth/session');
    const me = await newSession();
    const other = await newSession();
    const third = await newSession();
    for (const s of [me, other, third]) expect(passed(await proxy(req('/jobs', s.token)))).toBe(true);
    state.jar.set('radar_session', { value: me.token });

    expect(await revokeSession(other.id)).toBe(true);
    expect((await proxy(req('/jobs', other.token))).status).toBe(307);
    expect(passed(await proxy(req('/jobs', third.token)))).toBe(true);

    expect(await revokeOtherSessions()).toBe(1);
    expect((await proxy(req('/api/export', third.token))).status).toBe(401);
    expect(passed(await proxy(req('/jobs', me.token)))).toBe(true);
  });
});

describe('defence in depth: pages check the session themselves', () => {
  // Directories owned by other lanes are out of scope for this change.
  const EXCLUDED = new Set(['applications', 'companies', 'countries', 'sources', 'review', 'system', 'settings', 'accuracy']);
  const root = path.resolve(__dirname, '../../src/app/(app)');

  function pages(dir: string): string[] {
    const out: string[] = [];
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        if (dir === root && EXCLUDED.has(name)) continue;
        out.push(...pages(full));
      } else if (name === 'page.tsx') out.push(full);
    }
    return out;
  }

  it('every in-scope page.tsx and data-reading generateMetadata awaits requireSession()', () => {
    const found = pages(root);
    expect(found.length).toBeGreaterThanOrEqual(5);
    for (const file of found) {
      const src = readFileSync(file, 'utf8');
      const rel = path.relative(root, file);
      const pageFn = /export default async function \w+\([^)]*\)[^{]*\{\s*(?:\/\/[^\n]*\n\s*)*await requireSession\(\);/;
      expect(src, rel).toMatch(pageFn);
      if (src.includes('generateMetadata')) {
        expect(src, rel).toMatch(/export async function generateMetadata\([^)]*\)[^{]*\{\s*(?:\/\/[^\n]*\n\s*)*await requireSession\(\);/);
      }
    }
  });
});
