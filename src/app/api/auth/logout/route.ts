/**
 * POST /api/auth/logout — for non-form clients (the UI uses the `logoutAction` Server Action).
 * CSRF: Origin must match APP_URL. Revokes the DB session and clears the cookie (the proxy has
 * already rejected requests without a valid session JWT with 401).
 */
import { NextResponse, type NextRequest } from 'next/server';
import { audit } from '@/lib/audit';
import { clearedSessionCookieOptions } from '@/lib/auth/cookie';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/auth/jwt';
import { clientIp } from '@/lib/auth/request';
import { revokeSessionBySid } from '@/lib/auth/session-store';
import { getDb } from '@/lib/db';
import { appOrigin, isAllowedOrigin } from '@/lib/security/origin';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest): Promise<NextResponse> {
  if (!isAllowedOrigin(request.headers)) {
    return NextResponse.json({ ok: false, error: 'forbidden' }, { status: 403 });
  }
  const decoded = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (decoded) {
    const ip = clientIp(request.headers);
    await getDb().transaction(async (tx) => {
      const id = await revokeSessionBySid(tx, decoded.sid, 'logout');
      if (id !== null) await audit(tx, { action: 'auth.logout', entityType: 'session', entityId: id, actor: 'admin', ip });
    });
  }
  const wantsHtml = (request.headers.get('accept') ?? '').includes('text/html');
  const response = wantsHtml
    ? // APP_URL, not request.nextUrl: behind nginx the request URL carries the internal host.
      NextResponse.redirect(new URL('/login', appOrigin()), 303)
    : NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, '', clearedSessionCookieOptions());
  response.headers.set('Cache-Control', 'no-store');
  return response;
}
