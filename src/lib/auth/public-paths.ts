/**
 * Routes reachable without a session (spec §4). Everything else is login-walled by src/proxy.ts.
 * Only the exact '/login' is public — no '/login/*' prefix, so nothing nested under it (now or
 * later) can bypass the proxy.
 */

const PUBLIC_EXACT = new Set([
  '/login',
  '/api/health',
  '/api/auth/login',
  '/favicon.ico',
  '/robots.txt',
  '/manifest.webmanifest',
  '/manifest.json',
]);

/** Metadata-file routes: /icon, /icon.png, /icon1.svg, /apple-icon.png, … */
const PUBLIC_ICON_RE = /^\/(?:icon|apple-icon)\d*(?:\.(?:ico|png|svg|jpg|jpeg|webp))?$/;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_EXACT.has(pathname)) return true;
  if (pathname.startsWith('/_next/static/') || pathname.startsWith('/_next/image')) return true;
  return PUBLIC_ICON_RE.test(pathname);
}

export function isApiPath(pathname: string): boolean {
  return pathname === '/api' || pathname.startsWith('/api/');
}
