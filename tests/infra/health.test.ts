import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DB_TIMEOUT_MS,
  LAST_RUN_SQL,
  TimeoutError,
  ageHours,
  deployedVersion,
  getHealth,
  rateLimitedWarn,
  sanitizeVersion,
  withTimeout,
  type HealthDeps,
} from '@/app/api/health/health';
import { log } from '@/lib/log';

type Pool = ReturnType<HealthDeps['pool']>;

function poolReturning(rows: unknown[]): { pool: () => Pool; query: ReturnType<typeof vi.fn> } {
  const query = vi.fn(async () => [rows, []]);
  return { pool: () => ({ query }) as unknown as Pool, query };
}

function poolFailing(error: unknown): () => Pool {
  return () => ({ query: vi.fn(async () => Promise.reject(error)) }) as unknown as Pool;
}

const NOW = new Date('2026-09-30T12:00:00Z');

describe('sanitizeVersion', () => {
  it('keeps short revision strings', () => {
    expect(sanitizeVersion('0123456789abcdef0123456789abcdef01234567')).toBe('0123456789abcdef0123456789abcdef01234567');
    expect(sanitizeVersion(' v1.2.3 ')).toBe('v1.2.3');
    expect(sanitizeVersion('a1b2c3d')).toBe('a1b2c3d');
  });
  it('drops empty, placeholder and anything that is not a plain revision', () => {
    for (const v of [undefined, null, '', '   ', 'unknown', '<script>', 'a b', 'x'.repeat(41), 'sha\nFOO=1', '../etc']) {
      expect(sanitizeVersion(v as string | null | undefined), String(v)).toBeNull();
    }
  });
});

describe('ageHours', () => {
  it('rounds to one decimal and never goes negative', () => {
    expect(ageHours(new Date('2026-09-30T11:40:00Z'), NOW)).toBe(0.3);
    expect(ageHours(new Date('2026-09-29T12:00:00Z'), NOW)).toBe(24);
    expect(ageHours(new Date('2026-09-30T12:05:00Z'), NOW)).toBe(0);
  });
  it('is null without a (valid) date', () => {
    expect(ageHours(null, NOW)).toBeNull();
    expect(ageHours(new Date('nope'), NOW)).toBeNull();
  });
});

describe('withTimeout', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes values and errors through', async () => {
    await expect(withTimeout(Promise.resolve(7), 50)).resolves.toBe(7);
    await expect(withTimeout(Promise.reject(new Error('boom')), 50)).rejects.toThrow('boom');
  });

  it('rejects with TimeoutError when the promise is too slow', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise(() => {}), 2_000);
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);
    await vi.advanceTimersByTimeAsync(2_000);
    await assertion;
  });
});

describe('getHealth', () => {
  it('db up with the age of the last completed run', async () => {
    const { pool, query } = poolReturning([{ last_finished: new Date('2026-09-30T06:00:00Z') }]);
    const h = await getHealth({ pool, now: () => NOW, version: 'abc1234' });
    expect(h).toEqual({ ok: true, db: 'up', lastRunAgeHours: 6, version: 'abc1234' });
    expect(query).toHaveBeenCalledWith({ sql: LAST_RUN_SQL, timeout: DB_TIMEOUT_MS });
  });

  it('accepts string timestamps (mysql2 dateStrings) and "no run yet"', async () => {
    const s = await getHealth({ pool: poolReturning([{ last_finished: '2026-09-30T10:30:00Z' }]).pool, now: () => NOW });
    expect(s).toEqual({ ok: true, db: 'up', lastRunAgeHours: 1.5, version: null });
    const none = await getHealth({ pool: poolReturning([{ last_finished: null }]).pool, now: () => NOW });
    expect(none).toEqual({ ok: true, db: 'up', lastRunAgeHours: null, version: null });
    const empty = await getHealth({ pool: poolReturning([]).pool, now: () => NOW });
    expect(empty.lastRunAgeHours).toBeNull();
  });

  it('only counts real (non-dry, completed, daily/manual) pipeline runs', () => {
    expect(LAST_RUN_SQL).toMatch(/FROM pipeline_runs/);
    expect(LAST_RUN_SQL).toMatch(/dry_run = 0/);
    expect(LAST_RUN_SQL).toMatch(/status IN \('ok','partial'\)/);
    expect(LAST_RUN_SQL).toMatch(/kind IN \('daily','manual'\)/);
  });

  it('a missing pipeline_runs table (mid-migration) is still "db up"', async () => {
    const onError = vi.fn();
    const err = Object.assign(new Error("Table 'radar.pipeline_runs' doesn't exist"), { code: 'ER_NO_SUCH_TABLE' });
    const h = await getHealth({ pool: poolFailing(err), onError, version: 'v1' });
    expect(h).toEqual({ ok: true, db: 'up', lastRunAgeHours: null, version: 'v1' });
    expect(onError).not.toHaveBeenCalled();
  });

  it('connection errors are "db down" and report only the error code', async () => {
    const onError = vi.fn();
    const err = Object.assign(new Error('connect ECONNREFUSED 10.0.0.2:3306 password=hunter2'), { code: 'ECONNREFUSED' });
    const h = await getHealth({ pool: poolFailing(err), onError, version: 'v1' });
    expect(h).toEqual({ ok: false, db: 'down', lastRunAgeHours: null, version: 'v1' });
    expect(onError).toHaveBeenCalledWith('ECONNREFUSED');
    expect(JSON.stringify(h)).not.toMatch(/ECONNREFUSED|hunter2|10\.0\.0\.2/);
  });

  it('a pool that cannot even be created is "db down"', async () => {
    const onError = vi.fn();
    const h = await getHealth({
      pool: () => {
        throw new TypeError('bad DATABASE_URL');
      },
      onError,
    });
    expect(h.ok).toBe(false);
    expect(onError).toHaveBeenCalledWith('TypeError');
  });

  it('a slow database is "db down" after the timeout', async () => {
    const onError = vi.fn();
    const pool = () => ({ query: vi.fn(() => new Promise(() => {})) }) as unknown as Pool;
    const h = await getHealth({ pool, onError, timeoutMs: 20 });
    expect(h).toEqual({ ok: false, db: 'down', lastRunAgeHours: null, version: null });
    expect(onError).toHaveBeenCalledWith('TimeoutError');
  });
});

describe('rateLimitedWarn', () => {
  it('logs at most once per interval and counts what it suppressed', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
    try {
      let t = 0;
      const report = rateLimitedWarn(60_000, () => t);
      report('ECONNREFUSED');
      t = 30_000;
      report('ECONNREFUSED');
      report('ETIMEDOUT');
      t = 60_000;
      report('ETIMEDOUT');
      expect(warn).toHaveBeenCalledTimes(2);
      expect(warn.mock.calls[0]).toEqual(['health: database probe failed', { code: 'ECONNREFUSED', suppressedSinceLast: 0 }]);
      expect(warn.mock.calls[1]).toEqual(['health: database probe failed', { code: 'ETIMEDOUT', suppressedSinceLast: 2 }]);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('deployedVersion', () => {
  const saved = process.env.GIT_SHA;
  afterEach(() => {
    if (saved === undefined) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = saved;
  });

  it('reads the GIT_SHA build arg, sanitised', () => {
    process.env.GIT_SHA = 'deadbeef';
    expect(deployedVersion()).toBe('deadbeef');
    process.env.GIT_SHA = 'not a sha!';
    expect(deployedVersion()).toBeNull();
    delete process.env.GIT_SHA;
    expect(deployedVersion()).toBeNull();
  });
});

describe('GET /api/health', () => {
  const getPool = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    getPool.mockReset();
    vi.doMock('next/server', async (importOriginal) => ({
      ...(await importOriginal<typeof import('next/server')>()),
      connection: async () => {},
    }));
    vi.doMock('@/lib/db', () => ({ getPool }));
  });

  afterEach(() => {
    vi.doUnmock('next/server');
    vi.doUnmock('@/lib/db');
  });

  it('is dynamic and answers 200 with no-store when the database is up', async () => {
    getPool.mockReturnValue({ query: vi.fn(async () => [[{ last_finished: null }], []]) });
    const route = await import('@/app/api/health/route');
    expect(route.dynamic).toBe('force-dynamic');
    const res = await route.GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store, max-age=0');
    expect(res.headers.get('x-robots-tag')).toBe('noindex');
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['db', 'lastRunAgeHours', 'ok', 'version']);
    expect(body).toMatchObject({ ok: true, db: 'up', lastRunAgeHours: null });
  });

  it('answers 503 when the database is down (and logs the code once)', async () => {
    // Same module registry as the freshly imported route (after resetModules).
    const { log: routeLog } = await import('@/lib/log');
    const warn = vi.spyOn(routeLog, 'warn').mockImplementation(() => {});
    try {
      getPool.mockReturnValue({ query: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { code: 'ECONNREFUSED' }))) });
      const route = await import('@/app/api/health/route');
      const res = await route.GET();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ ok: false, db: 'down', lastRunAgeHours: null });
      await route.GET();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0]?.[1]).toEqual({ code: 'ECONNREFUSED', suppressedSinceLast: 0 });
    } finally {
      warn.mockRestore();
    }
  });
});
