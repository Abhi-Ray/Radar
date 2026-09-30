/**
 * Proxy (Next 16's replacement for middleware; Node.js runtime).
 *
 * 1. Auth gate, DB-backed: every route except the public ones needs a session JWT that verifies
 *    (signature + expiry) AND whose `sessions` row exists, is not revoked and belongs to
 *    ADMIN_EMAIL (session-gate.ts; positive answers cached ≤5 s per process, evicted on logout /
 *    revoke). Pages redirect to /login?next=…, API routes get 401 JSON; a cookie that was sent but
 *    failed the check is cleared. If the DB check itself fails, requests fail CLOSED with 503 and
 *    the cookie is left alone (a DB outage must not log the owner out).
 *    This is the gate that also covers partial (RSC) renders, which skip the (app) layout.
 * 2. Sliding renewal: a live token older than 30 days is re-issued with a fresh 1-year expiry —
 *    only after the DB check passed.
 * 3. Per-request nonce CSP (+ HSTS at runtime when APP_URL is https).
 * 4. Passes the current path to server code (x-radar-path) for `?next=` redirects.
 *
 * Server Functions are POSTs to the page route, so they pass through here too — and pages, Server
 * Actions and route handlers still call `requireSession()` themselves (defence in depth).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getEnvVar, isHttpsApp } from './lib/env';
import { clearedSessionCookieOptions, sessionCookieOptions } from './lib/auth/cookie';
import { needsRenewal, SESSION_COOKIE, signSessionToken } from './lib/auth/jwt';
import { isApiPath, isPublicPath } from './lib/auth/public-paths';
import { PATH_HEADER } from './lib/auth/request';
import { checkSessionGate, type SessionGatePass } from './lib/auth/session-gate';
import { log } from './lib/log';
import { buildCsp, generateNonce, HSTS_VALUE } from './lib/security/headers';

function withSecurityHeaders(res: NextResponse, csp: string, https: boolean): NextResponse {
  res.headers.set('Content-Security-Policy', csp);
  if (https) res.headers.set('Strict-Transport-Security', HSTS_VALUE);
  return res;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;
  const https = isHttpsApp();
  const dev = getEnvVar('NODE_ENV') === 'development';
  const nonce = generateNonce();
  const csp = buildCsp({ nonce, dev, https });

  let renewedToken: string | null = null;
  if (!isPublicPath(pathname)) {
    const raw = request.cookies.get(SESSION_COOKIE)?.value;
    let gate: SessionGatePass | null;
    try {
      gate = await checkSessionGate(raw);
    } catch (err) {
      // Fail closed, but keep the cookie: the session may be perfectly valid once the DB is back.
      log.error('proxy: session check failed', { err, path: pathname });
      const res = isApiPath(pathname)
        ? NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 })
        : new NextResponse('Service temporarily unavailable.', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      res.headers.set('Cache-Control', 'no-store');
      res.headers.set('Retry-After', '5');
      return withSecurityHeaders(res, csp, https);
    }
    if (!gate) {
      let res: NextResponse;
      if (isApiPath(pathname)) {
        res = NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        res.headers.set('Cache-Control', 'no-store');
      } else {
        const login = request.nextUrl.clone();
        login.pathname = '/login';
        login.search = '';
        const next = `${pathname}${search}`;
        if (next !== '/') login.searchParams.set('next', next);
        res = NextResponse.redirect(login, 307);
      }
      // A cookie that failed the check (bad/expired JWT, revoked, other operator) is dead: drop it.
      if (raw !== undefined) res.cookies.set(SESSION_COOKIE, '', clearedSessionCookieOptions());
      return withSecurityHeaders(res, csp, https);
    }
    if (needsRenewal(gate.token)) renewedToken = await signSessionToken(gate.token.sid);
  }

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  // Always overwritten: clients cannot inject their own value.
  requestHeaders.set(PATH_HEADER, `${pathname}${search}`.slice(0, 2048));

  const res = NextResponse.next({ request: { headers: requestHeaders } });
  if (renewedToken) res.cookies.set(SESSION_COOKIE, renewedToken, sessionCookieOptions());
  return withSecurityHeaders(res, csp, https);
}

export const config = {
  matcher: [
    // Everything except build assets and image optimisation; public paths are decided in code.
    '/((?!_next/static|_next/image).*)',
  ],
};
