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

/**
 * Safe post-login redirect target: only same-origin relative paths. Anything else ('//evil',
 * '/\\evil', absolute URLs, control characters, the login page itself) falls back to '/'.
 */
export function safeNextPath(next: unknown, fallback = '/'): string {
  if (typeof next !== 'string' || next.length === 0 || next.length > 2048) return fallback;
  if (!next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\')) return fallback;
  if (/[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, 'http://radar.invalid');
  } catch {
    return fallback;
  }
  if (url.origin !== 'http://radar.invalid') return fallback;
  if (url.pathname === '/login' || url.pathname.startsWith('/login/')) return fallback;
  if (url.pathname.startsWith('/api/')) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}
