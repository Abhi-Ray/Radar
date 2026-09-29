/** Pure foundation logic: env validation, log redaction, hashing, time helpers, settings defaults, queue params. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSetting,
  DEFAULTED_SETTING_KEYS,
  isSettingKey,
  SETTINGS_SCHEMAS,
} from '../../src/lib/contracts/settings';
import { EnvError, getEnv, getEnvVar, isHttpsApp, resetEnvCacheForTests } from '../../src/lib/env';
import { canonicalJson, hashJson, normalizeTextForHash, sha256Hex } from '../../src/lib/hash';
import { isSecretKey, log, redact, redactString } from '../../src/lib/log';
import { queuedRunParams } from '../../src/lib/pipeline/queue';
import {
  addCalendarDaysInTz,
  daysBetween,
  formatAsOf,
  formatInTz,
  localDay,
  msUntilNextUtcDay,
  parseUtcDay,
  startOfLocalDay,
  startOfTodayInTz,
  toDateOrNull,
  tzAbbrev,
  utcDay,
} from '../../src/lib/time';
import { extractRequirementsText, isApplicationStage } from '../../src/lib/tracker';

const ENV_KEYS = ['DATABASE_URL', 'ADMIN_EMAIL', 'ADMIN_PASSWORD_HASH', 'SESSION_SECRET', 'APP_URL', 'APP_TZ', 'AI_ENABLED', 'AI_DAILY_LIMIT', 'OPENROUTER_API_KEY', 'SMTP_URL'];
const FAKE_HASH = 'scrypt:16384:8:1:c2FsdHNhbHRzYWx0:a2V5a2V5a2V5a2V5';

function stubValidEnv(overrides: Record<string, string> = {}) {
  const base: Record<string, string> = {
    DATABASE_URL: 'mysql://radar:dbpass-not-real@127.0.0.1:3399/radar',
    ADMIN_EMAIL: ' Owner@Example.TEST ',
    ADMIN_PASSWORD_HASH: FAKE_HASH,
    SESSION_SECRET: 'x'.repeat(40),
    APP_URL: 'https://radar.example.test///',
    APP_TZ: '',
    AI_ENABLED: '',
    AI_DAILY_LIMIT: '',
    OPENROUTER_API_KEY: '',
    SMTP_URL: '',
  };
  for (const [k, v] of Object.entries({ ...base, ...overrides })) vi.stubEnv(k, v);
  resetEnvCacheForTests();
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetEnvCacheForTests();
});

describe('env', () => {
  it('parses, normalises and applies defaults (empty strings count as unset)', () => {
    stubValidEnv({ AI_ENABLED: 'yes', AI_DAILY_LIMIT: '20' });
    const env = getEnv();
    expect(env.ADMIN_EMAIL).toBe('owner@example.test');
    expect(env.APP_URL).toBe('https://radar.example.test');
    expect(env.APP_TZ).toBe('Asia/Kolkata');
    expect(env.AI_ENABLED).toBe(true);
    expect(env.AI_DAILY_LIMIT).toBe(20);
    expect(env.OPENROUTER_API_KEY).toBeUndefined();
    expect(isHttpsApp()).toBe(true);
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('reports every invalid key without echoing any value', () => {
    stubValidEnv({
      DATABASE_URL: 'postgres://u:topsecretdb@h/db',
      SESSION_SECRET: 'short-secret-value',
      ADMIN_PASSWORD_HASH: 'plaintext-password-oops',
      APP_TZ: 'Mars/Olympus',
      AI_ENABLED: 'maybe',
    });
    let err: unknown;
    try {
      getEnv();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(EnvError);
    const msg = (err as EnvError).message;
    for (const key of ['DATABASE_URL', 'SESSION_SECRET', 'ADMIN_PASSWORD_HASH', 'APP_TZ', 'AI_ENABLED']) expect(msg).toContain(key);
    for (const secret of ['topsecretdb', 'short-secret-value', 'plaintext-password-oops']) expect(msg).not.toContain(secret);
  });

  it('getEnvVar validates one key without needing the rest', () => {
    for (const k of ENV_KEYS) vi.stubEnv(k, '');
    vi.stubEnv('DATABASE_URL', 'mysql://u:p@localhost:3399/radar');
    resetEnvCacheForTests();
    expect(getEnvVar('DATABASE_URL')).toBe('mysql://u:p@localhost:3399/radar');
    expect(() => getEnvVar('SESSION_SECRET')).toThrow(EnvError);
    expect(() => getEnv()).toThrow(EnvError);
  });

  it('rejects non-http APP_URL and bad AI_DAILY_LIMIT', () => {
    stubValidEnv({ APP_URL: 'javascript:alert(1)' });
    expect(() => getEnvVar('APP_URL')).toThrow(EnvError);
    stubValidEnv({ AI_DAILY_LIMIT: '5000' });
    expect(() => getEnvVar('AI_DAILY_LIMIT')).toThrow(EnvError);
  });
});

describe('log redaction', () => {
  it('redacts secret-named keys at any depth but keeps identifier keys', () => {
    const out = redact({
      password: 'hunter2',
      nested: { apiKey: 'abc', sessionToken: 'def', list: [{ authorization: 'Bearer x' }], cookie: 'sid=1' },
      factKey: 'visa_status',
      platformKey: 'greenhouse',
      dedupeKey: 'source:12:failing',
      emptyToken: '',
      nullSecret: null,
    }) as Record<string, unknown>;
    expect(out).toEqual({
      password: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', sessionToken: '[REDACTED]', list: [{ authorization: '[REDACTED]' }], cookie: '[REDACTED]' },
      factKey: 'visa_status',
      platformKey: 'greenhouse',
      dedupeKey: 'source:12:failing',
      emptyToken: '',
      nullSecret: null,
    });
    expect(isSecretKey('SESSION_SECRET')).toBe(true);
    expect(isSecretKey('source_key')).toBe(false);
    expect(isSecretKey('monkey')).toBe(true); // over-redaction is the safe side
  });

  it('scrubs secret shapes inside free text', () => {
    const s = redactString(
      'key sk-or-v1-0123456789abcdef0123 jwt eyJhbGciOiJIUzI1NiJ9.eyJzaWQiOiJhYmNkZWZnaCJ9.c2lnbmF0dXJlLXNpZw ' +
        `hash ${FAKE_HASH} db mysql://radar:pa55word@db:3306/radar tg bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw`,
    );
    for (const leaked of ['0123456789abcdef0123', 'eyJzaWQiOiJhYmNkZWZnaCJ9', 'a2V5a2V5a2V5a2V5', 'pa55word', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw']) {
      expect(s).not.toContain(leaked);
    }
    expect(s).toContain('mysql://radar:[REDACTED]@db:3306/radar');
    expect(redactString('x'.repeat(5000))).toMatch(/…\[truncated 1000\]$/);
  });

  it('serialises errors (message, cause, code), dates, cycles, maps and buffers safely', () => {
    const cause = Object.assign(new Error('connect mysql://u:secretpw@h/db failed'), { code: 'ECONNREFUSED' });
    const err = new Error('outer', { cause });
    const cyc: Record<string, unknown> = { a: 1 };
    cyc.self = cyc;
    const out = redact({ err, when: new Date('2026-01-02T03:04:05.000Z'), bad: new Date('x'), cyc, m: new Map([['token', 't']]), buf: Buffer.from('abc'), n: BigInt(10), fn: () => 1 }) as {
      err: { message: string; cause: { code: string; message: string } };
      when: string;
      bad: string;
      cyc: { self: unknown };
      m: unknown;
      buf: string;
      n: string;
      fn: unknown;
    };
    expect(out.err.message).toBe('outer');
    expect(out.err.cause.code).toBe('ECONNREFUSED');
    expect(out.err.cause.message).not.toContain('secretpw');
    expect(out.when).toBe('2026-01-02T03:04:05.000Z');
    expect(out.bad).toBe('Invalid Date');
    expect(out.cyc.self).toBe('[Circular]');
    expect(out.m).toEqual({ token: '[REDACTED]' });
    expect(out.buf).toBe('[Buffer 3b]');
    expect(out.n).toBe('10');
    expect(out.fn).toBeUndefined();
  });

  it('writes one JSON line; reserved keys cannot be overwritten; levels route to the right stream', () => {
    const out = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const err = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.stubEnv('NODE_ENV', 'production');
    const child = log.child({ module: 'test', token: 'child-secret' });
    child.info('hello', { level: 'fake', msg: 'fake', ts: 'fake', runId: 7, password: 'pw' });
    child.debug('hidden in production');
    child.warn('careful');
    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(out.mock.calls[0][0]);
    expect(line.endsWith('\n')).toBe(true);
    const rec = JSON.parse(line);
    expect(rec).toMatchObject({ level: 'info', msg: 'hello', module: 'test', runId: 7, token: '[REDACTED]', password: '[REDACTED]' });
    expect(rec.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(line).not.toContain('child-secret');
    expect(JSON.parse(String(err.mock.calls[0][0])).level).toBe('warn');

    vi.stubEnv('NODE_ENV', 'test');
    log.info('quiet in tests');
    log.error('errors still print');
    expect(out).toHaveBeenCalledTimes(1);
    expect(err).toHaveBeenCalledTimes(2);
  });
});

describe('hash', () => {
  it('canonical JSON sorts keys recursively and drops undefined', () => {
    expect(canonicalJson({ b: 1, a: { d: [3, undefined, { z: 1, y: 2 }], c: undefined }, e: new Date('2026-01-01T00:00:00Z') })).toBe(
      '{"a":{"d":[3,null,{"y":2,"z":1}]},"b":1,"e":"2026-01-01T00:00:00.000Z"}',
    );
    expect(hashJson({ x: 1, y: 2 })).toBe(hashJson({ y: 2, x: 1 }));
    expect(hashJson({ x: 1 })).not.toBe(hashJson({ x: '1' }));
    expect(hashJson(undefined)).toBe(hashJson(null));
  });

  it('sha256Hex and text normalisation', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex(Buffer.from('abc'))).toBe(sha256Hex('abc'));
    expect(normalizeTextForHash('  Cloud Security\n\tEngineer  ')).toBe('cloud security engineer');
    expect(normalizeTextForHash('\uff21\uff37\uff33 \u216b De\u200bvOps')).toBe('aws xii devops');
  });
});

describe('time', () => {
  const t = new Date('2026-03-29T00:30:00.000Z'); // 06:00 IST; CET→CEST switch day in Berlin

  it('days in UTC and in a time zone', () => {
    expect(utcDay(new Date('2026-03-01T23:59:59.999Z'))).toBe('2026-03-01');
    expect(localDay(new Date('2026-03-01T19:00:00.000Z'), 'Asia/Kolkata')).toBe('2026-03-02');
    expect(startOfTodayInTz('Asia/Kolkata', t).toISOString()).toBe('2026-03-28T18:30:00.000Z');
    expect(startOfLocalDay('2026-03-29', 'Europe/Berlin').toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(parseUtcDay('2026-02-28').toISOString()).toBe('2026-02-28T00:00:00.000Z');
    expect(parseUtcDay('2028-02-29').toISOString()).toBe('2028-02-29T00:00:00.000Z');
  });

  it('rejects malformed and impossible days', () => {
    for (const bad of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-00-10', '2026-1-01', '26-01-01', '2026-01-01T00:00']) {
      expect(() => parseUtcDay(bad), bad).toThrow(RangeError);
      expect(() => startOfLocalDay(bad, 'UTC'), bad).toThrow(RangeError);
    }
  });

  it('calendar-day arithmetic keeps wall-clock time across DST', () => {
    const before = new Date('2026-03-28T09:00:00.000Z'); // 10:00 CET
    const after = addCalendarDaysInTz(before, 1, 'Europe/Berlin');
    expect(after.toISOString()).toBe('2026-03-29T08:00:00.000Z'); // 10:00 CEST
    expect(daysBetween(before, after)).toBe(0); // only 23h apart
    expect(daysBetween(new Date('2026-01-01'), new Date('2026-01-11'))).toBe(10);
    expect(daysBetween(new Date('2026-01-11'), new Date('2026-01-01'))).toBe(-10);
  });

  it('formats in the app time zone with an abbreviation', () => {
    expect(formatInTz(t, 'dd MMM yyyy, HH:mm', 'Asia/Kolkata')).toBe('29 Mar 2026, 06:00');
    expect(formatAsOf(t, 'Asia/Kolkata')).toBe('29 Mar, 06:00 IST');
    expect(tzAbbrev(t, 'UTC')).toBe('UTC');
    expect(tzAbbrev(t, 'Not/AZone')).toBe('Not/AZone');
  });

  it('toDateOrNull and msUntilNextUtcDay', () => {
    expect(toDateOrNull('2026-01-01T00:00:00Z')?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(toDateOrNull(0)?.toISOString()).toBe('1970-01-01T00:00:00.000Z');
    const d = new Date();
    const copy = toDateOrNull(d);
    expect(copy).not.toBe(d);
    expect(copy?.getTime()).toBe(d.getTime());
    for (const bad of [null, undefined, '', '   ', 'not a date', true, {}, [], new Date('x'), Number.NaN]) {
      expect(toDateOrNull(bad), String(bad)).toBeNull();
    }
    expect(msUntilNextUtcDay(new Date('2026-01-01T23:59:59.000Z'))).toBe(1000);
    expect(msUntilNextUtcDay(new Date('2026-01-01T00:00:00.000Z'))).toBe(86_400_000);
  });
});

describe('settings contracts', () => {
  it('every defaulted key parses {} into a complete value, fresh each call', () => {
    for (const key of DEFAULTED_SETTING_KEYS) {
      const a = defaultSetting(key);
      const b = defaultSetting(key);
      expect(a, key).toEqual(b);
      expect(SETTINGS_SCHEMAS[key].safeParse(a).success, key).toBe(true);
      if (a && typeof a === 'object') expect(a).not.toBe(b);
    }
    expect(DEFAULTED_SETTING_KEYS).not.toContain('fx_rates');
    expect(isSettingKey('profile')).toBe(true);
    expect(isSettingKey('fx_rates')).toBe(true);
    expect(isSettingKey('__proto__')).toBe(false);
    expect(isSettingKey('toString')).toBe(false);
  });
});

describe('queue params', () => {
  it('reads params from stats_json defensively', () => {
    expect(queuedRunParams({ params: {} })).toEqual({});
    expect(queuedRunParams({ params: { sourceIds: [1, 2] } })).toEqual({ sourceIds: [1, 2] });
    for (const bad of [null, 'x', {}, { params: null }, { params: { sourceIds: [0] } }, { params: { sourceIds: ['1'] } }, { params: { sourceIds: 'all' } }]) {
      expect(queuedRunParams(bad)).toBeNull();
    }
  });
});

describe('tracker helpers', () => {
  it('extracts the requirements section of a posting', () => {
    const text = [
      'About us',
      'We secure clouds.',
      '',
      'Requirements:',
      '- 3+ years AWS',
      '- Terraform',
      '',
      '- Kubernetes',
      'Benefits',
      '- Free lunch',
    ].join('\n');
    expect(extractRequirementsText(text)).toBe('- 3+ years AWS\n- Terraform\n\n- Kubernetes');
    expect(extractRequirementsText("What you'll bring\nStrong IAM skills\n\n## How to apply\nSend CV")).toBe('Strong IAM skills');
    expect(extractRequirementsText('No such section here.\n- bullet')).toBeNull();
    expect(extractRequirementsText('')).toBeNull();
    expect(extractRequirementsText(null)).toBeNull();
    expect(isApplicationStage('applied')).toBe(true);
    expect(isApplicationStage('hired')).toBe(false);
  });
});
