/**
 * Session tokens: HS256 JWT (jose) carrying only a random `sid`. The DB stores sha256(sid).
 * Edge/Node agnostic and DB-free, so `src/proxy.ts` can verify it on every request.
 */
import { errors, jwtVerify, SignJWT } from 'jose';
import { getEnvVar } from '../env';

export const SESSION_COOKIE = 'radar_session';
/** Cookie + token lifetime: 1 year. */
export const SESSION_MAX_AGE_S = 31_536_000;
/** Sliding renewal: a token older than this is re-issued (proxy) with a fresh 1-year expiry. */
export const SESSION_RENEW_AFTER_S = 30 * 24 * 60 * 60;

const ISSUER = 'radar';
const AUDIENCE = 'radar:session';
const ALG = 'HS256';
/** 32 random bytes, base64url → 43 chars. */
const SID_RE = /^[A-Za-z0-9_-]{43}$/;

export interface SessionToken {
  sid: string;
  issuedAt: Date;
  expiresAt: Date;
}

function key(secret?: string): Uint8Array {
  const s = secret ?? getEnvVar('SESSION_SECRET');
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  return new TextEncoder().encode(s);
}

export function isValidSid(sid: unknown): sid is string {
  return typeof sid === 'string' && SID_RE.test(sid);
}

export interface SignOptions {
  secret?: string;
  now?: Date;
  maxAgeS?: number;
}

export async function signSessionToken(sid: string, opts: SignOptions = {}): Promise<string> {
  if (!isValidSid(sid)) throw new Error('invalid sid');
  const nowS = Math.floor((opts.now ?? new Date()).getTime() / 1000);
  return new SignJWT({ sid })
    .setProtectedHeader({ alg: ALG, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(nowS)
    .setExpirationTime(nowS + (opts.maxAgeS ?? SESSION_MAX_AGE_S))
    .sign(key(opts.secret));
}

export interface VerifyOptions {
  secret?: string;
  now?: Date;
}

/** Returns the decoded token, or null for anything invalid/expired/tampered. Never throws for bad input. */
export async function verifySessionToken(token: string | undefined | null, opts: VerifyOptions = {}): Promise<SessionToken | null> {
  if (!token || typeof token !== 'string' || token.length > 4096) return null;
  try {
    const { payload } = await jwtVerify(token, key(opts.secret), {
      algorithms: [ALG],
      issuer: ISSUER,
      audience: AUDIENCE,
      requiredClaims: ['iat', 'exp', 'sid'],
      currentDate: opts.now,
    });
    if (!isValidSid(payload.sid) || typeof payload.iat !== 'number' || typeof payload.exp !== 'number') return null;
    return { sid: payload.sid, issuedAt: new Date(payload.iat * 1000), expiresAt: new Date(payload.exp * 1000) };
  } catch (err) {
    if (err instanceof errors.JOSEError) return null;
    // A missing/short SESSION_SECRET is a deployment error, not an invalid token.
    throw err;
  }
}

/** True when the token should be re-issued (sliding renewal, at most once per 30 days). */
export function needsRenewal(token: SessionToken, now: Date = new Date()): boolean {
  return now.getTime() - token.issuedAt.getTime() > SESSION_RENEW_AFTER_S * 1000;
}
