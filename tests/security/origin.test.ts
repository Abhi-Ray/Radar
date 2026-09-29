import { afterEach, describe, expect, it } from 'vitest';
import { resetEnvCacheForTests } from '../../src/lib/env';
import { appOrigin, isAllowedOrigin } from '../../src/lib/security/origin';

const APP = 'https://radar.example.test';
const h = (init: Record<string, string>) => new Headers(init);

describe('appOrigin', () => {
  const prev = process.env.APP_URL;
  afterEach(() => {
    if (prev === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = prev;
    resetEnvCacheForTests();
  });

  it('reduces APP_URL to scheme://host[:port]', () => {
    expect(appOrigin('https://radar.example.test/')).toBe(APP);
    expect(appOrigin('https://Radar.Example.test:443/some/path?x=1')).toBe(APP);
    expect(appOrigin('http://localhost:3400')).toBe('http://localhost:3400');
  });

  it('defaults to the validated APP_URL env var', () => {
    process.env.APP_URL = 'https://jobs.example.test/';
    resetEnvCacheForTests();
    expect(appOrigin()).toBe('https://jobs.example.test');
    process.env.APP_URL = 'ftp://jobs.example.test';
    resetEnvCacheForTests();
    expect(() => appOrigin()).toThrow(/APP_URL/);
  });
});

describe('isAllowedOrigin', () => {
  it('accepts only the exact app origin', () => {
    expect(isAllowedOrigin(h({ origin: APP }), APP)).toBe(true);
    expect(isAllowedOrigin(h({ origin: 'https://RADAR.example.test:443' }), APP)).toBe(true);
    for (const origin of [
      'https://evil.example',
      'http://radar.example.test',
      'https://radar.example.test:8443',
      'https://radar.example.test.evil.example',
      'https://sub.radar.example.test',
      'null',
      '',
      'not a url',
    ]) {
      expect(isAllowedOrigin(h({ origin }), APP), origin).toBe(false);
    }
  });

  it('an explicit Origin wins over Sec-Fetch-Site', () => {
    expect(isAllowedOrigin(h({ origin: 'https://evil.example', 'sec-fetch-site': 'same-origin' }), APP)).toBe(false);
    expect(isAllowedOrigin(h({ origin: 'null', 'sec-fetch-site': 'same-origin' }), APP)).toBe(false);
  });

  it('without Origin, only Sec-Fetch-Site: same-origin is trusted', () => {
    expect(isAllowedOrigin(h({ 'sec-fetch-site': 'same-origin' }), APP)).toBe(true);
    for (const site of ['same-site', 'cross-site', 'none', 'SAME-ORIGIN']) {
      expect(isAllowedOrigin(h({ 'sec-fetch-site': site }), APP), site).toBe(false);
    }
    expect(isAllowedOrigin(h({ referer: `${APP}/jobs` }), APP)).toBe(false);
    expect(isAllowedOrigin(h({}), APP)).toBe(false);
  });
});
