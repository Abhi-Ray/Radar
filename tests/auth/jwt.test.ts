import { SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import {
  isValidSid,
  needsRenewal,
  SESSION_MAX_AGE_S,
  SESSION_RENEW_AFTER_S,
  signSessionToken,
  verifySessionToken,
} from '../../src/lib/auth/jwt';
import { newSid } from '../../src/lib/auth/session-store';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';
const OTHER = 'another-secret-that-is-at-least-32-characters-!!';

describe('session JWT', () => {
  it('signs and verifies a token carrying only the sid', async () => {
    const sid = newSid();
    const now = new Date('2026-01-01T00:00:00Z');
    const token = await signSessionToken(sid, { secret: SECRET, now });
    const decoded = await verifySessionToken(token, { secret: SECRET, now: new Date('2026-01-02T00:00:00Z') });
    expect(decoded?.sid).toBe(sid);
    expect(decoded?.issuedAt.toISOString()).toBe(now.toISOString());
    expect(decoded?.expiresAt.getTime()).toBe(now.getTime() + SESSION_MAX_AGE_S * 1000);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    expect(Object.keys(payload).sort()).toEqual(['aud', 'exp', 'iat', 'iss', 'sid']);
  });

  it('rejects wrong secret, tampering, expiry and garbage', async () => {
    const sid = newSid();
    const now = new Date('2026-01-01T00:00:00Z');
    const token = await signSessionToken(sid, { secret: SECRET, now });
    expect(await verifySessionToken(token, { secret: OTHER, now })).toBeNull();
    const [h, p, s] = token.split('.');
    const forged = JSON.parse(Buffer.from(p, 'base64url').toString()) as Record<string, unknown>;
    forged.sid = newSid();
    const tampered = `${h}.${Buffer.from(JSON.stringify(forged)).toString('base64url')}.${s}`;
    expect(await verifySessionToken(tampered, { secret: SECRET, now })).toBeNull();
    const afterExpiry = new Date(now.getTime() + (SESSION_MAX_AGE_S + 60) * 1000);
    expect(await verifySessionToken(token, { secret: SECRET, now: afterExpiry })).toBeNull();
    for (const bad of [undefined, null, '', 'abc', 'a.b.c', 'x'.repeat(5000)]) {
      expect(await verifySessionToken(bad, { secret: SECRET, now })).toBeNull();
    }
  });

  it('rejects alg=none and tokens for another audience/issuer', async () => {
    const sid = newSid();
    const nowS = Math.floor(Date.now() / 1000);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(
      JSON.stringify({ sid, iss: 'radar', aud: 'radar:session', iat: nowS, exp: nowS + 3600 }),
    ).toString('base64url');
    expect(await verifySessionToken(`${header}.${body}.`, { secret: SECRET })).toBeNull();

    const key = new TextEncoder().encode(SECRET);
    const wrongAud = await new SignJWT({ sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('radar')
      .setAudience('someone-else')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    expect(await verifySessionToken(wrongAud, { secret: SECRET })).toBeNull();
    const noExp = await new SignJWT({ sid })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('radar')
      .setAudience('radar:session')
      .setIssuedAt()
      .sign(key);
    expect(await verifySessionToken(noExp, { secret: SECRET })).toBeNull();
    const badSid = await new SignJWT({ sid: 'short' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('radar')
      .setAudience('radar:session')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(key);
    expect(await verifySessionToken(badSid, { secret: SECRET })).toBeNull();
  });

  it('refuses to sign invalid sids or with a short secret', async () => {
    await expect(signSessionToken('nope', { secret: SECRET })).rejects.toThrow();
    await expect(signSessionToken(newSid(), { secret: 'short' })).rejects.toThrow(/SESSION_SECRET/);
    expect(isValidSid(newSid())).toBe(true);
    expect(isValidSid('a'.repeat(42))).toBe(false);
    expect(isValidSid(42)).toBe(false);
  });

  it('needs renewal only after 30 days', () => {
    const issuedAt = new Date('2026-01-01T00:00:00Z');
    const t = { sid: newSid(), issuedAt, expiresAt: new Date(issuedAt.getTime() + SESSION_MAX_AGE_S * 1000) };
    expect(needsRenewal(t, new Date(issuedAt.getTime() + 1000))).toBe(false);
    expect(needsRenewal(t, new Date(issuedAt.getTime() + SESSION_RENEW_AFTER_S * 1000))).toBe(false);
    expect(needsRenewal(t, new Date(issuedAt.getTime() + SESSION_RENEW_AFTER_S * 1000 + 1000))).toBe(true);
  });
});
