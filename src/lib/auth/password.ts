/**
 * Password hashing for the single admin account (hash lives in env ADMIN_PASSWORD_HASH).
 *
 * Format: `scrypt:N:r:p:<salt base64url>:<key base64url>` — N=32768, r=8, p=1, keylen=64 by
 * default, maxmem 64 MiB (node:crypto scrypt). Verification is constant-time (timingSafeEqual)
 * and runs the full KDF even for malformed hashes, so timing does not reveal the failure cause.
 * Every KDF run (hash or verify) goes through a process-wide limit of KDF_MAX_CONCURRENT.
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

/**
 * At most this many KDF runs at once per process; the rest wait their turn. One default-strength
 * scrypt needs 128·N·r = 32 MiB, so ~20 parallel login POSTs would otherwise allocate ~650 MiB on
 * top of the app inside a 900 MB container limit.
 */
export const KDF_MAX_CONCURRENT = 2;

interface KdfLimiter {
  active: number;
  peak: number;
  waiting: Array<() => void>;
}

// Kept on globalThis: Next can evaluate this module more than once per process (separate bundles),
// and the limit is about the process's memory.
const kdfKey = Symbol.for('radar.auth.kdfLimiter');
const kdfGlobal = globalThis as typeof globalThis & { [kdfKey]?: KdfLimiter };
const kdf: KdfLimiter = (kdfGlobal[kdfKey] ??= { active: 0, peak: 0, waiting: [] });

async function withKdfSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (kdf.active >= KDF_MAX_CONCURRENT) await new Promise<void>((resolve) => kdf.waiting.push(resolve));
  // A released slot is handed over directly (`active` is not decremented in between).
  else kdf.active += 1;
  kdf.peak = Math.max(kdf.peak, kdf.active);
  try {
    return await fn();
  } finally {
    const next = kdf.waiting.shift();
    if (next) next();
    else kdf.active -= 1;
  }
}

/** Test hook: the highest number of concurrent KDF runs seen since the last reset. */
export function kdfPeakForTests(reset = false): number {
  const peak = kdf.peak;
  if (reset) kdf.peak = kdf.active;
  return peak;
}

function scryptAsync(password: string | Buffer, salt: Buffer, keylen: number, opts: ScryptOptions): Promise<Buffer> {
  return withKdfSlot(
    () =>
      new Promise((resolve, reject) => {
        scrypt(password, salt, keylen, opts, (err, derived) => (err ? reject(err) : resolve(derived)));
      }),
  );
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
