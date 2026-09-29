/**
 * Proxy (Next 16's replacement for middleware; Node.js runtime).
 *
 * 1. Auth fast path: every route except the public ones needs a valid session JWT (signature +
 *    expiry only — no DB here; `requireSession()` does the revocation check). Pages redirect to
 *    /login?next=…, API routes get 401 JSON.
 * 2. Sliding renewal: a valid token older than 30 days is re-issued with a fresh 1-year expiry.
 * 3. Per-request nonce CSP (+ HSTS at runtime when APP_URL is https).
 * 4. Passes the current path to server code (x-radar-path) for `?next=` redirects.
 *
 * Server Functions are POSTs to the page route, so they pass through here too — and still call
 * `requireSession()` themselves (defence in depth).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { getEnvVar, isHttpsApp } from './lib/env';
import { sessionCookieOptions } from './lib/auth/cookie';
import { needsRenewal, SESSION_COOKIE, signSessionToken, verifySessionToken } from './lib/auth/jwt';
import { isApiPath, isPublicPath } from './lib/auth/public-paths';
import { PATH_HEADER } from './lib/auth/request';
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
    const token = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
    if (!token) {
      if (isApiPath(pathname)) {
        const res = NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
        res.headers.set('Cache-Control', 'no-store');
        return withSecurityHeaders(res, csp, https);
      }
      const login = request.nextUrl.clone();
      login.pathname = '/login';
      login.search = '';
      const next = `${pathname}${search}`;
      if (next !== '/') login.searchParams.set('next', next);
      return withSecurityHeaders(NextResponse.redirect(login, 307), csp, https);
    }
    if (needsRenewal(token)) renewedToken = await signSessionToken(token.sid);
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
