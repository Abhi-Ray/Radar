/** Request helpers shared by auth code (pure; take a Headers-like object). */

/** Request header set by src/proxy.ts with the current path + query (for `?next=` redirects). */
export const PATH_HEADER = 'x-radar-path';

interface HeaderLike {
  get(name: string): string | null;
}

const IP_RE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Client IP = `x-real-ip` (set by our nginx, which overwrites any client-supplied value), else
 * 'unknown'. Anything that does not look like an IPv4/IPv6 literal is treated as unknown.
 */
export function clientIp(headers: HeaderLike): string {
  const raw = headers.get('x-real-ip')?.trim();
  if (!raw || !IP_RE.test(raw)) return 'unknown';
  return raw.toLowerCase();
}

/** User-Agent truncated to the column size. */
export function userAgent(headers: HeaderLike): string | null {
  const ua = headers.get('user-agent');
  if (!ua) return null;
  // Strip control characters before storing.
  const clean = ua.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return clean ? clean.slice(0, 512) : null;
}

const NEXT_BASE = 'http://radar.invalid';

/** True for a path the browser resolves against our own origin (not '//host' or '/\\host'). */
function isSameOriginPath(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) return false;
  try {
    return new URL(path, NEXT_BASE).origin === NEXT_BASE;
  } catch {
    return false;
  }
}

/**
 * Percent-encoded control characters or backslashes anywhere in the path, or an encoded slash that
 * would make the path start with '//' once some proxy or later redirect decodes it once.
 */
const ENCODED_TRICK_RE = /%(?:[01][0-9a-f]|7f|5c)/i;
const ENCODED_LEADING_SLASH_RE = /^\/(?:%2f|%5c)/i;

/**
 * Safe post-login redirect target: only same-origin relative paths. Anything else ('//evil',
 * '/\\evil', absolute URLs, raw or percent-encoded control characters and backslashes, the login
 * page itself) falls back to '/'.
 *
 * The NORMALISED output is re-validated too: URL parsing collapses dot segments, so an input like
 * '/.//evil.com' or '/%2e%2e//evil.com' would otherwise come out as '//evil.com' — a
 * protocol-relative URL that the browser sends to another host.
 */
export function safeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return fallback;
  if (!isSameOriginPath(next)) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  const url = new URL(next, NEXT_BASE);
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return fallback;
  if (url.pathname.startsWith('/api/')) return fallback;
  if (ENCODED_TRICK_RE.test(url.pathname) || ENCODED_LEADING_SLASH_RE.test(url.pathname)) return fallback;
  const out = `${url.pathname}${url.search}${url.hash}`;
  if (!isSameOriginPath(out)) return fallback;
  return out;
}
