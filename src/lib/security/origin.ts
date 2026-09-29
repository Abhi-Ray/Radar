/**
 * CSRF guard for custom mutating Route Handlers (Server Actions have Next's built-in check).
 * The request's `Origin` must equal the origin of APP_URL. Requests without an Origin header are
 * rejected unless `Sec-Fetch-Site: same-origin` vouches for them.
 */
import { getEnvVar } from '../env';

interface HeaderLike {
  get(name: string): string | null;
}

export function appOrigin(appUrl: string = getEnvVar('APP_URL')): string {
  return new URL(appUrl).origin;
}

export function isAllowedOrigin(headers: HeaderLike, appUrl?: string): boolean {
  const expected = appOrigin(appUrl);
  const origin = headers.get('origin');
  if (origin !== null) {
    if (origin === 'null') return false;
    try {
      return new URL(origin).origin === expected;
    } catch {
      return false;
    }
  }
  return headers.get('sec-fetch-site') === 'same-origin';
}
