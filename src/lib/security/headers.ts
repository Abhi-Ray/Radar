/**
 * Security headers. The per-request nonce CSP is built here and applied by src/proxy.ts; the
 * static headers are also applied by next.config.ts (so static assets carry them too).
 * Pure functions — no env access.
 */

export interface CspOptions {
  nonce: string;
  dev: boolean;
  https: boolean;
}

/**
 * Nonce-based CSP (Next applies the nonce to its own scripts when it sees this header on the
 * request). style-src needs 'unsafe-inline' because React `style` attributes cannot carry a nonce
 * (and a nonce in style-src would make browsers ignore 'unsafe-inline').
 */
export function buildCsp({ nonce, dev, https }: CspOptions): string {
  const directives: [string, string[]][] = [
    ['default-src', ["'self'"]],
    ['script-src', ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(dev ? ["'unsafe-eval'"] : [])]],
    ['style-src', ["'self'", "'unsafe-inline'"]],
    ['img-src', ["'self'", 'data:', 'blob:']],
    ['font-src', ["'self'", 'data:']],
    ['connect-src', ["'self'", ...(dev ? ['ws:', 'wss:'] : [])]],
    ['media-src', ["'self'"]],
    ['object-src', ["'none'"]],
    ['base-uri', ["'self'"]],
    ['form-action', ["'self'"]],
    ['frame-ancestors', ["'none'"]],
    ['frame-src', ["'none'"]],
    ['worker-src', ["'self'", 'blob:']],
    ['manifest-src', ["'self'"]],
  ];
  const parts = directives.map(([k, v]) => `${k} ${v.join(' ')}`);
  if (https) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/** 16 random bytes, base64. Uses Web Crypto (available in Node 22 and every Next runtime). */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export const HSTS_VALUE = 'max-age=63072000; includeSubDomains';

export interface StaticHeader {
  key: string;
  value: string;
}

export function staticSecurityHeaders(https: boolean): StaticHeader[] {
  const headers: StaticHeader[] = [
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=(), browsing-topics=()',
    },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
    { key: 'Cross-Origin-Resource-Policy', value: 'same-origin' },
    { key: 'X-DNS-Prefetch-Control', value: 'off' },
  ];
  if (https) headers.push({ key: 'Strict-Transport-Security', value: HSTS_VALUE });
  return headers;
}
