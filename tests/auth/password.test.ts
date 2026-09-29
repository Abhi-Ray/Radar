import { describe, expect, it } from 'vitest';
import { constantTimeEqual, hashPassword, parsePasswordHash, verifyPassword } from '../../src/lib/auth/password';
import { envSchema } from '../../src/lib/env';

describe('password hashing (scrypt)', () => {
  it('round-trips and uses the documented format', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).toMatch(/^scrypt:32768:8:1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    // The env schema must accept what the hasher produces.
    expect(envSchema.shape.ADMIN_PASSWORD_HASH.safeParse(hash).success).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('correct horse battery stapl', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
    expect(await verifyPassword('same', a)).toBe(true);
    expect(await verifyPassword('same', b)).toBe(true);
  });

  it('is deterministic with a fixed salt (test hook) and supports lower-cost params', async () => {
    const salt = Buffer.alloc(16, 7);
    const a = await hashPassword('pw', { N: 16384, salt });
    const b = await hashPassword('pw', { N: 16384, salt });
    expect(a).toBe(b);
    expect(a.startsWith('scrypt:16384:8:1:')).toBe(true);
    expect(await verifyPassword('pw', a)).toBe(true);
  });

  it('rejects an empty password when hashing', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });

  it('never throws and returns false for malformed or hostile hashes', async () => {
    const good = await hashPassword('pw', { N: 16384 });
    const [, , r, p, salt, key] = good.split(':');
    const bad = [
      '',
      'plain',
      'bcrypt:$2b$10$abc',
      `scrypt:16384:${r}:${p}:${salt}`,
      `scrypt:16385:${r}:${p}:${salt}:${key}`, // not a power of two
      `scrypt:${2 ** 20}:${r}:${p}:${salt}:${key}`, // too expensive (DoS)
      `scrypt:1024:${r}:${p}:${salt}:${key}`, // too weak
      `scrypt:16384:99:${p}:${salt}:${key}`,
      `scrypt:16384:${r}:9:${salt}:${key}`,
      `scrypt:16384:${r}:${p}:c2hvcnQ:${key}`, // salt too short
      `scrypt:16384:${r}:${p}:${salt}:a2V5`, // key too short
      `scrypt:16384:${r}:${p}:${salt}:${key}==`, // not base64url
    ];
    for (const h of bad) {
      expect(parsePasswordHash(h)).toBeNull();
      expect(await verifyPassword('pw', h)).toBe(false);
    }
    expect(await verifyPassword('pw', undefined as unknown as string)).toBe(false);
    expect(await verifyPassword(undefined as unknown as string, good)).toBe(false);
  });

  it('parses a valid hash', async () => {
    const h = await hashPassword('pw', { N: 16384 });
    const parsed = parsePasswordHash(h);
    expect(parsed).not.toBeNull();
    expect(parsed?.N).toBe(16384);
    expect(parsed?.key.length).toBe(64);
    expect(parsed?.salt.length).toBe(16);
  });

  it('constantTimeEqual compares by value, any lengths', () => {
    expect(constantTimeEqual('a@b.c', 'a@b.c')).toBe(true);
    expect(constantTimeEqual('a@b.c', 'a@b.d')).toBe(false);
    expect(constantTimeEqual('short', 'a much longer string')).toBe(false);
    expect(constantTimeEqual('', '')).toBe(true);
  });
});
