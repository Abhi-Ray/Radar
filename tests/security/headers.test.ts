/**
 * Security headers: the nonce CSP, the static header list (and its copy in next.config.ts), and
 * the proxy that applies them together with the auth fast path.
 */
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SESSION_COOKIE, SESSION_RENEW_AFTER_S, signSessionToken, verifySessionToken } from '../../src/lib/auth/jwt';
import { PATH_HEADER } from '../../src/lib/auth/request';
import { newSid } from '../../src/lib/auth/session-store';
import { resetEnvCacheForTests } from '../../src/lib/env';
import { buildCsp, generateNonce, HSTS_VALUE, staticSecurityHeaders } from '../../src/lib/security/headers';

// The proxy checks the session row in the DB (session-gate.ts; covered against a real DB in
// tests/auth/proxy.test.ts). Here the row always exists, so these tests stay about the token itself.
vi.mock('../../src/lib/auth/session-store', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/lib/auth/session-store')>()),
  validateSessionRow: async () => ({ row: { id: 1 } }),
}));

function directives(csp: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const part of csp.split(';').map((p) => p.trim()).filter(Boolean)) {
    const [name, ...values] = part.split(/\s+/);
    expect(out.has(name), `duplicate directive ${name}`).toBe(false);
    out.set(name, values);
  }
  return out;
}

describe('buildCsp', () => {
  it('production: nonce + strict-dynamic, nothing unsafe for scripts, no framing', () => {
    const d = directives(buildCsp({ nonce: 'abc123==', dev: false, https: true }));
    expect(d.get('script-src')).toEqual(["'self'", "'nonce-abc123=='", "'strict-dynamic'"]);
    expect(d.get('default-src')).toEqual(["'self'"]);
    expect(d.get('object-src')).toEqual(["'none'"]);
    expect(d.get('base-uri')).toEqual(["'self'"]);
    expect(d.get('form-action')).toEqual(["'self'"]);
    expect(d.get('frame-ancestors')).toEqual(["'none'"]);
    expect(d.get('frame-src')).toEqual(["'none'"]);
    expect(d.get('connect-src')).toEqual(["'self'"]);
    expect(d.has('upgrade-insecure-requests')).toBe(true);
    for (const [name, values] of d) {
      if (name === 'style-src') continue; // React style attributes need 'unsafe-inline' (documented).
      expect(values, name).not.toContain("'unsafe-inline'");
      expect(values, name).not.toContain("'unsafe-eval'");
      expect(values, name).not.toContain('*');
      expect(values, name).not.toContain('http:');
      expect(values, name).not.toContain('https:');
    }
  });

  it('dev adds eval + websocket for HMR; http omits upgrade-insecure-requests', () => {
    const d = directives(buildCsp({ nonce: 'n', dev: true, https: false }));
    expect(d.get('script-src')).toContain("'unsafe-eval'");
    expect(d.get('connect-src')).toEqual(["'self'", 'ws:', 'wss:']);
    expect(d.has('upgrade-insecure-requests')).toBe(false);
  });
});

describe('generateNonce', () => {
  it('is 16 random bytes in base64 and unique per call', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const n = generateNonce();
      expect(n).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(Buffer.from(n, 'base64')).toHaveLength(16);
      seen.add(n);
    }
    expect(seen.size).toBe(200);
  });
});

describe('static headers', () => {
  it('contains the hardening headers; HSTS only on https', () => {
    const byKey = Object.fromEntries(staticSecurityHeaders(true).map((h) => [h.key, h.value]));
    expect(byKey).toMatchObject({
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Strict-Transport-Security': HSTS_VALUE,
    });
    expect(byKey['Permissions-Policy']).toContain('camera=()');
    expect(staticSecurityHeaders(false).some((h) => h.key === 'Strict-Transport-Security')).toBe(false);
  });

  it.each([
    ['https://radar.example.test', true],
    ['http://localhost:3400', false],
  ])('next.config.ts SECURITY_HEADERS equals staticSecurityHeaders() for APP_URL=%s', async (appUrl, https) => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = appUrl;
    vi.resetModules();
    try {
      const mod = await import('../../next.config');
      expect(mod.SECURITY_HEADERS).toEqual(staticSecurityHeaders(https));
      const cfg = mod.default;
      expect(cfg.poweredByHeader).toBe(false);
      const rules = await cfg.headers!();
      expect(rules).toEqual([{ source: '/:path*', headers: staticSecurityHeaders(https) }]);
    } finally {
      if (prev === undefined) delete process.env.APP_URL;
      else process.env.APP_URL = prev;
      vi.resetModules();
    }
  });
});

// ---- proxy -----------------------------------------------------------------------------------

const SECRET = 'headers-test-secret-at-least-32-characters!!';
const ORIGIN = 'https://radar.example.test';
const envBackup: Record<string, string | undefined> = {};

beforeAll(() => {
  for (const [k, v] of Object.entries({ SESSION_SECRET: SECRET, APP_URL: ORIGIN, ADMIN_EMAIL: 'owner@radar.example.test', DATABASE_URL: 'mysql://radar:unused@127.0.0.1:1/radar' })) {
    envBackup[k] = process.env[k];
    process.env[k] = v;
  }
  resetEnvCacheForTests();
});

afterAll(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  resetEnvCacheForTests();
});

async function runProxy(path: string, init: { cookie?: string; headers?: Record<string, string>; method?: string } = {}) {
  const { proxy } = await import('../../src/proxy');
  const headers: Record<string, string> = { ...(init.headers ?? {}) };
  if (init.cookie) headers.cookie = `${SESSION_COOKIE}=${init.cookie}`;
  return proxy(new NextRequest(`${ORIGIN}${path}`, { method: init.method ?? 'GET', headers }));
}

/** Request headers forwarded by NextResponse.next({ request: { headers } }). */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name.toLowerCase()}`);

function expectSecured(res: Response) {
  const csp = res.headers.get('content-security-policy');
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/]{22}==' 'strict-dynamic'/);
  expect(res.headers.get('strict-transport-security')).toBe(HSTS_VALUE);
  return csp!;
}

describe('proxy', () => {
  it('redirects pages without a session to /login with a safe next', async () => {
    const res = await runProxy('/jobs?country=DE');
    expect(res.status).toBe(307);
    const loc = new URL(res.headers.get('location')!);
    expect(loc.pathname).toBe('/login');
    expect(loc.searchParams.get('next')).toBe('/jobs?country=DE');
    expectSecured(res);

    const home = await runProxy('/');
    expect(new URL(home.headers.get('location')!).search).toBe('');
  });

  it('answers API routes without a session with 401 JSON', async () => {
    for (const path of ['/api/jobs', '/api', '/api/settings']) {
      const res = await runProxy(path, { method: 'POST' });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ ok: false, error: 'unauthorized' });
      expect(res.headers.get('cache-control')).toBe('no-store');
      expectSecured(res);
    }
  });

  it('lets public paths through with a fresh nonce, the CSP and an unspoofable path header', async () => {
    const res = await runProxy('/login?next=%2Fjobs', { headers: { [PATH_HEADER]: '/evil', 'x-nonce': 'attacker' } });
    expect(res.headers.get('x-middleware-next')).toBe('1');
    const csp = expectSecured(res);
    const nonce = forwarded(res, 'x-nonce');
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(csp).toContain(`'nonce-${nonce}'`);
    expect(forwarded(res, 'content-security-policy')).toBe(csp);
    expect(forwarded(res, PATH_HEADER)).toBe('/login?next=%2Fjobs');
    const other = await runProxy('/login');
    expect(forwarded(other, 'x-nonce')).not.toBe(nonce);
    for (const path of ['/api/health', '/favicon.ico', '/icon.png']) {
      expect((await runProxy(path)).headers.get('x-middleware-next'), path).toBe('1');
    }
  });

  it('accepts a valid session and rejects forged, expired or foreign-key tokens', async () => {
    const sid = newSid();
    const ok = await runProxy('/jobs', { cookie: await signSessionToken(sid, { secret: SECRET }) });
    expect(ok.headers.get('x-middleware-next')).toBe('1');
    expect(ok.headers.get('set-cookie')).toBeNull();

    const forged = await signSessionToken(sid, { secret: 'another-secret-that-is-also-32-chars-long' });
    const expired = await signSessionToken(sid, { secret: SECRET, now: new Date(Date.now() - 2 * 3600_000), maxAgeS: 60 });
    const valid = await signSessionToken(sid, { secret: SECRET });
    const tampered = `${valid.slice(0, -4)}AAAA`;
    for (const cookie of [forged, expired, tampered, 'garbage', `${valid}x`]) {
      const res = await runProxy('/jobs', { cookie });
      expect(res.status, cookie.slice(0, 20)).toBe(307);
    }
  });

  it('re-issues a token older than the renewal age with a fresh expiry', async () => {
    const sid = newSid();
    const old = await signSessionToken(sid, { secret: SECRET, now: new Date(Date.now() - (SESSION_RENEW_AFTER_S + 3600) * 1000) });
    const res = await runProxy('/jobs', { cookie: old });
    expect(res.headers.get('x-middleware-next')).toBe('1');
    const setCookie = res.headers.get('set-cookie') ?? '';
    const m = new RegExp(`${SESSION_COOKIE}=([^;]+)`).exec(setCookie);
    expect(m).not.toBeNull();
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/Secure/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    const renewed = await verifySessionToken(m![1], { secret: SECRET });
    expect(renewed?.sid).toBe(sid);
    expect(renewed!.issuedAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
  });
});
