import { describe, expect, it } from 'vitest';
import { isApiPath, isPublicPath } from '../../src/lib/auth/public-paths';
import { lockDurationMs, RATE_LIMIT, failureDelayMs } from '../../src/lib/auth/rate-limit';
import { clientIp, safeNextPath, userAgent } from '../../src/lib/auth/request';

const h = (entries: Record<string, string>) => new Headers(entries);

describe('clientIp', () => {
  it('trusts only x-real-ip and only IP-looking values', () => {
    expect(clientIp(h({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9');
    expect(clientIp(h({ 'x-real-ip': '2001:DB8::1' }))).toBe('2001:db8::1');
    expect(clientIp(h({ 'x-forwarded-for': '1.2.3.4' }))).toBe('unknown');
    expect(clientIp(h({ 'x-real-ip': 'evil<script>' }))).toBe('unknown');
    expect(clientIp(h({ 'x-real-ip': '1.2.3.4, 5.6.7.8' }))).toBe('unknown');
    expect(clientIp(h({}))).toBe('unknown');
  });
});

describe('userAgent', () => {
  it('strips control characters and truncates', () => {
    expect(userAgent(h({ 'user-agent': 'Mozilla/5.0' }))).toBe('Mozilla/5.0');
    expect(userAgent(h({}))).toBeNull();
    expect(userAgent(h({ 'user-agent': 'x'.repeat(600) }))?.length).toBe(512);
    expect(userAgent({ get: () => 'a\u0000b\u001fc' })).toBe('abc');
  });
});

describe('safeNextPath', () => {
  it('allows same-origin relative paths', () => {
    expect(safeNextPath('/jobs?country=DE#top')).toBe('/jobs?country=DE#top');
    expect(safeNextPath('/review')).toBe('/review');
  });
  it('rejects open redirects and odd input', () => {
    for (const bad of [
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      '\\\\evil',
      'javascript:alert(1)',
      'jobs',
      '/login',
      '/login?next=/x',
      '/api/auth/logout',
      '/a\u0000b',
      '/a\nb',
      '',
      null,
      42,
      `/${'a'.repeat(3000)}`,
    ]) {
      expect(safeNextPath(bad)).toBe('/');
    }
    expect(safeNextPath('//evil', '')).toBe('');
  });
});

describe('public paths', () => {
  it('only login, health and static metadata are public', () => {
    for (const p of ['/login', '/api/health', '/favicon.ico', '/robots.txt', '/icon.png', '/apple-icon.png', '/_next/static/x.js']) {
      expect(isPublicPath(p)).toBe(true);
    }
    for (const p of ['/', '/jobs', '/api/auth/logout', '/api/export', '/loginx', '/api/healthz', '/icon/../secret']) {
      expect(isPublicPath(p)).toBe(false);
    }
    expect(isApiPath('/api/x')).toBe(true);
    expect(isApiPath('/apix')).toBe(false);
  });
});

describe('rate-limit math', () => {
  it('lockout doubles from 15 min and caps at 24h', () => {
    expect(lockDurationMs(1)).toBe(15 * 60_000);
    expect(lockDurationMs(2)).toBe(30 * 60_000);
    expect(lockDurationMs(3)).toBe(60 * 60_000);
    expect(lockDurationMs(7)).toBe(16 * 60 * 60_000);
    expect(lockDurationMs(8)).toBe(24 * 60 * 60_000);
    expect(lockDurationMs(100)).toBe(RATE_LIMIT.maxLockMs);
    expect(lockDurationMs(0)).toBe(15 * 60_000);
  });
  it('failure delay is ~400ms', () => {
    for (let i = 0; i < 50; i++) {
      const d = failureDelayMs();
      expect(d).toBeGreaterThanOrEqual(350);
      expect(d).toBeLessThanOrEqual(450);
    }
  });
});
