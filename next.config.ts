import type { NextConfig } from 'next';

/**
 * Static security headers for every response (incl. static assets). The per-request nonce CSP is
 * set by src/proxy.ts, which also sets HSTS at runtime from APP_URL.
 *
 * Self-contained on purpose: Node's native TypeScript loader (used for next.config.ts on
 * Node >= 22.10) cannot resolve extension-less imports into src/. The list must stay identical to
 * `staticSecurityHeaders()` in src/lib/security/headers.ts (enforced by tests/security/headers.test.ts).
 * Config files are the one place outside src/lib/env.ts that read process.env.
 */
const https = (process.env.APP_URL ?? '').startsWith('https://');

export const SECURITY_HEADERS: { key: string; value: string }[] = [
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
  ...(https ? [{ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }] : []),
];

const nextConfig: NextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  reactStrictMode: true,
  serverExternalPackages: ['mysql2'],
  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
