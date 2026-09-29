/** Session cookie attributes (spec §4): 1 year, HttpOnly, SameSite=Lax, Secure behind https, Path=/. */
import { isHttpsApp } from '../env';
import { SESSION_COOKIE, SESSION_MAX_AGE_S } from './jwt';

export interface SessionCookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
}

export function sessionCookieOptions(): SessionCookieOptions {
  return { httpOnly: true, sameSite: 'lax', secure: isHttpsApp(), path: '/', maxAge: SESSION_MAX_AGE_S };
}

/** Attributes for clearing the cookie (must match path/secure of the original). */
export function clearedSessionCookieOptions(): SessionCookieOptions {
  return { ...sessionCookieOptions(), maxAge: 0 };
}

export { SESSION_COOKIE };
