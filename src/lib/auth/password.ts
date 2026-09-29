/**
 * Password hashing for the single admin account (hash lives in env ADMIN_PASSWORD_HASH).
 *
 * Format: `scrypt:N:r:p:<salt base64url>:<key base64url>` — N=32768, r=8, p=1, keylen=64 by
 * default, maxmem 64 MiB (node:crypto scrypt). Verification is constant-time (timingSafeEqual)
 * and runs the full KDF even for malformed hashes, so timing does not reveal the failure cause.
 */
import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const SCRYPT_DEFAULTS = { N: 32768, r: 8, p: 1, keylen: 64, saltBytes: 16 } as const;
export const SCRYPT_MAXMEM = 64 * 1024 * 1024;

/** Accepted parameter bounds when parsing a stored hash (defends against resource exhaustion). */
const MIN_LOG2_N = 14;
const MAX_LOG2_N = 17;
const MAX_R = 16;
const MAX_P = 4;
const MIN_KEYLEN = 32;
const MAX_KEYLEN = 128;
const MIN_SALT = 16;

export interface ParsedPasswordHash {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
}

function scryptAsync(password: string | Buffer, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
  });
}

function isPowerOfTwo(n: number): boolean {
  return Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
}

function b64urlDecode(s: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(s)) return null;
  return Buffer.from(s, 'base64url');
}

/** Parses and bounds-checks a stored hash. Returns null for anything malformed or out of bounds. */
export function parsePasswordHash(stored: string): ParsedPasswordHash | null {
  const parts = stored.trim().split(':');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [, nStr, rStr, pStr, saltStr, keyStr] = parts;
  if (!/^\d{1,7}$/.test(nStr) || !/^\d{1,3}$/.test(rStr) || !/^\d{1,3}$/.test(pStr)) return null;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!isPowerOfTwo(N) || N < 2 ** MIN_LOG2_N || N > 2 ** MAX_LOG2_N) return null;
  if (r < 1 || r > MAX_R || p < 1 || p > MAX_P) return null;
  if (128 * N * r * p > SCRYPT_MAXMEM) return null;
  const salt = b64urlDecode(saltStr);
  const key = b64urlDecode(keyStr);
  if (!salt || !key || salt.length < MIN_SALT || key.length < MIN_KEYLEN || key.length > MAX_KEYLEN) return null;
  return { N, r, p, salt, key };
}

export interface HashPasswordOptions {
  N?: number;
  r?: number;
  p?: number;
  keylen?: number;
  /** Test hook: fixed salt. Never pass in production code. */
  salt?: Buffer;
}

export async function hashPassword(password: string, opts: HashPasswordOptions = {}): Promise<string> {
  if (typeof password !== 'string' || password.length === 0) throw new Error('password must be a non-empty string');
  const N = opts.N ?? SCRYPT_DEFAULTS.N;
  const r = opts.r ?? SCRYPT_DEFAULTS.r;
  const p = opts.p ?? SCRYPT_DEFAULTS.p;
  const keylen = opts.keylen ?? SCRYPT_DEFAULTS.keylen;
  const salt = opts.salt ?? randomBytes(SCRYPT_DEFAULTS.saltBytes);
  const key = await scryptAsync(password, salt, keylen, { N, r, p, maxmem: SCRYPT_MAXMEM });
  const out = `scrypt:${N}:${r}:${p}:${salt.toString('base64url')}:${key.toString('base64url')}`;
  if (!parsePasswordHash(out)) throw new Error('scrypt parameters out of accepted bounds');
  return out;
}

// Fixed dummy target so a malformed stored hash still costs one full default-strength KDF run.
const DUMMY: ParsedPasswordHash = {
  N: SCRYPT_DEFAULTS.N,
  r: SCRYPT_DEFAULTS.r,
  p: SCRYPT_DEFAULTS.p,
  salt: createHash('sha256').update('radar-dummy-salt').digest().subarray(0, 16),
  key: Buffer.alloc(SCRYPT_DEFAULTS.keylen),
};

/** Constant-time check of `password` against a stored `scrypt:` hash. Never throws. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = typeof stored === 'string' ? parsePasswordHash(stored) : null;
  const target = parsed ?? DUMMY;
  const input = typeof password === 'string' ? password : '';
  let derived: Buffer;
  try {
    derived = await scryptAsync(input, target.salt, target.key.length, {
      N: target.N,
      r: target.r,
      p: target.p,
      maxmem: SCRYPT_MAXMEM,
    });
  } catch {
    return false;
  }
  const equal = derived.length === target.key.length && timingSafeEqual(derived, target.key);
  return parsed !== null && equal && input.length > 0;
}

/** Constant-time string equality (hashes both sides first so lengths never leak). */
export function constantTimeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a, 'utf8').digest();
  const hb = createHash('sha256').update(b, 'utf8').digest();
  return timingSafeEqual(ha, hb);
}
