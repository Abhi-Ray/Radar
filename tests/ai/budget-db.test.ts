/**
 * Daily AI budget against a real MySQL (spec §15 "A daily budget counter stops cleanly at the
 * limit"): the reservation is atomic (concurrent workers cannot overshoot), the manual reserve is
 * kept free for scheduled work, OpenRouter's own counter is folded in, and exhaustion raises one
 * alert per UTC day. No real network: the key endpoint is a mocked fetch.
 */
import { eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiUsage, alerts } from '../../src/db/schema';
import { budgetConfig, exhaustedAlertKey, getAiBudget, parseKeyResponse, reserveAiCall, syncAiBudget } from '../../src/lib/ai/budget';
import { OPENROUTER_KEY_URL } from '../../src/lib/ai/config';
import { resetEnvCacheForTests } from '../../src/lib/env';
import { setSetting } from '../../src/lib/settings';
import { startTestDb, type TestDb } from '../helpers/db';

let t: TestDb;
const NOW = new Date('2026-09-30T10:00:00Z');
const TOMORROW = new Date('2026-10-01T00:30:00Z');
const saved = { ...process.env };

function enableAiEnv(over: Record<string, string> = {}) {
  process.env.AI_ENABLED = 'true';
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  delete process.env.AI_DAILY_LIMIT;
  Object.assign(process.env, over);
  resetEnvCacheForTests();
}

async function setAi(dailyLimit: number, reserveForManual = 0, enabled = true) {
  await setSetting(t.db, 'ai', { enabled, dailyLimit, reserveForManual });
}

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);
afterAll(async () => {
  process.env = { ...saved };
  resetEnvCacheForTests();
  await t?.stop();
});
beforeEach(async () => {
  await t.truncateAll();
  enableAiEnv();
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCacheForTests();
});

describe('limit and switches', () => {
  it('limit = min(settings, env, 50)', async () => {
    await setAi(200);
    expect((await budgetConfig(t.db)).limit).toBe(50);
    enableAiEnv({ AI_DAILY_LIMIT: '12' });
    expect((await budgetConfig(t.db)).limit).toBe(12);
    await setAi(7);
    expect((await budgetConfig(t.db)).limit).toBe(7);
  });

  it('AI_ENABLED=false, no key, or settings off → disabled and nothing counted', async () => {
    await setAi(10);
    for (const env of [{ AI_ENABLED: 'false' }, { OPENROUTER_API_KEY: '' }] as Record<string, string>[]) {
      enableAiEnv(env);
      const r = await reserveAiCall(t.db, { now: NOW });
      expect(r).toMatchObject({ ok: false, reason: 'disabled' });
    }
    enableAiEnv();
    await setAi(10, 0, false);
    expect(await reserveAiCall(t.db, { now: NOW })).toMatchObject({ ok: false, reason: 'disabled' });
    expect(await t.db.select().from(aiUsage)).toEqual([]);
  });
});

describe('reservation', () => {
  it('counts before the call and stops exactly at the limit', async () => {
    await setAi(3);
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await reserveAiCall(t.db, { now: NOW }));
    expect(results.map((r) => r.ok)).toEqual([true, true, true, false, false]);
    expect(results[3]).toMatchObject({ ok: false, reason: 'budget', used: 3, limit: 3 });
    const [row] = await t.db.select().from(aiUsage).where(eq(aiUsage.day, '2026-09-30'));
    expect(row.callsUsed).toBe(3);
  });

  it('20 concurrent reservations with limit 5 → exactly 5 succeed', async () => {
    await setAi(5);
    // Create the day row first so the race is on the counter, not on the INSERT.
    await reserveAiCall(t.db, { now: NOW, manual: true });
    await t.db.update(aiUsage).set({ callsUsed: 0 }).where(eq(aiUsage.day, '2026-09-30'));
    const results = await Promise.all(Array.from({ length: 20 }, () => reserveAiCall(t.db, { now: NOW })));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    const [row] = await t.db.select().from(aiUsage).where(eq(aiUsage.day, '2026-09-30'));
    expect(row.callsUsed).toBe(5);
  });

  it('concurrent reservations on a fresh day (row created in the race) never overshoot', async () => {
    await setAi(4);
    const results = await Promise.all(Array.from({ length: 12 }, () => reserveAiCall(t.db, { now: NOW })));
    expect(results.filter((r) => r.ok)).toHaveLength(4);
    const rows = await t.db.select().from(aiUsage);
    expect(rows).toHaveLength(1);
    expect(rows[0].callsUsed).toBe(4);
  });

  it('scheduled work leaves the manual reserve free; manual requests may use it', async () => {
    await setAi(5, 2);
    const scheduled = [];
    for (let i = 0; i < 4; i++) scheduled.push(await reserveAiCall(t.db, { now: NOW }));
    expect(scheduled.map((r) => r.ok)).toEqual([true, true, true, false]);
    expect((await reserveAiCall(t.db, { now: NOW, manual: true })).ok).toBe(true);
    expect((await reserveAiCall(t.db, { now: NOW, manual: true })).ok).toBe(true);
    expect((await reserveAiCall(t.db, { now: NOW, manual: true })).ok).toBe(false);
  });

  it('a new UTC day starts from zero', async () => {
    await setAi(1);
    expect((await reserveAiCall(t.db, { now: NOW })).ok).toBe(true);
    expect((await reserveAiCall(t.db, { now: NOW })).ok).toBe(false);
    expect((await reserveAiCall(t.db, { now: TOMORROW })).ok).toBe(true);
  });
});

describe('exhaustion alert', () => {
  it('one alert per UTC day, even after many refusals', async () => {
    await setAi(1);
    await reserveAiCall(t.db, { now: NOW });
    for (let i = 0; i < 4; i++) await reserveAiCall(t.db, { now: NOW });
    const rows = await t.db.select().from(alerts).where(eq(alerts.dedupeKey, exhaustedAlertKey('2026-09-30')));
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe('ai_budget');
    // Acknowledged or not, no second alert the same day.
    await t.db.update(alerts).set({ acknowledgedAt: NOW }).where(eq(alerts.id, rows[0].id));
    await reserveAiCall(t.db, { now: NOW });
    expect(await t.db.select().from(alerts).where(eq(alerts.dedupeKey, exhaustedAlertKey('2026-09-30')))).toHaveLength(1);
    // The next day gets its own.
    await reserveAiCall(t.db, { now: TOMORROW });
    await reserveAiCall(t.db, { now: TOMORROW });
    expect(await t.db.select().from(alerts).where(eq(alerts.dedupeKey, exhaustedAlertKey('2026-10-01')))).toHaveLength(1);
  });
});

describe('getAiBudget', () => {
  it('returns used / limit / remaining / resetAt / source', async () => {
    await setAi(10, 2);
    await reserveAiCall(t.db, { now: NOW });
    await reserveAiCall(t.db, { now: NOW });
    const b = await getAiBudget(t.db, NOW);
    expect(b).toMatchObject({ day: '2026-09-30', enabled: true, used: 2, limit: 10, remaining: 8, reserveForManual: 2, source: 'local' });
    expect(b.resetAt.toISOString()).toBe('2026-10-01T00:00:00.000Z');
  });

  it('works with AI disabled and no row (UI can always show it)', async () => {
    enableAiEnv({ AI_ENABLED: 'false' });
    const b = await getAiBudget(t.db, NOW);
    expect(b).toMatchObject({ enabled: false, used: 0, remaining: b.limit, source: 'local' });
  });
});

describe('sync with OpenRouter /api/v1/key', () => {
  const keyFetch = (f: Record<string, number>) => {
    const calls: string[] = [];
    const fetch = async (url: string, init: RequestInit) => {
      calls.push(`${init.method} ${url}`);
      return new Response(JSON.stringify({ data: { label: 'x', free_model_daily_requests: f } }), { status: 200 });
    };
    return { fetch, calls };
  };

  it('parses data.free_model_daily_requests', () => {
    expect(parseKeyResponse({ data: { free_model_daily_requests: { used: 3, limit: 50, remaining: 47 } } })).toEqual({ used: 3, limit: 50, remaining: 47 });
    expect(parseKeyResponse({ data: { free_model_daily_requests: { used: 3, limit: 50 } } })).toEqual({ used: 3, limit: 50, remaining: 47 });
    expect(parseKeyResponse({ data: {} })).toBeNull();
    expect(parseKeyResponse('junk')).toBeNull();
  });

  it('used = max(local, remote)', async () => {
    await setAi(20);
    await reserveAiCall(t.db, { now: NOW });
    const m = keyFetch({ used: 7, limit: 50, remaining: 43 });
    const r = await syncAiBudget(t.db, { now: NOW, fetch: m.fetch });
    expect(r.ok).toBe(true);
    expect(m.calls).toEqual([`GET ${OPENROUTER_KEY_URL}`]);
    const b = await getAiBudget(t.db, NOW);
    expect(b.used).toBe(7);
    expect(b.remoteUsed).toBe(7);
    // A lower remote count never lowers the local counter.
    await syncAiBudget(t.db, { now: NOW, fetch: keyFetch({ used: 1, limit: 50, remaining: 49 }).fetch });
    expect((await getAiBudget(t.db, NOW)).used).toBe(7);
  });

  it('remote remaining 0 exhausts the day locally', async () => {
    await setAi(20);
    await syncAiBudget(t.db, { now: NOW, fetch: keyFetch({ used: 50, limit: 50, remaining: 0 }).fetch });
    const r = await reserveAiCall(t.db, { now: NOW, manual: true });
    expect(r).toMatchObject({ ok: false, reason: 'budget' });
    expect((await getAiBudget(t.db, NOW)).remaining).toBe(0);
  });

  it('a failing sync leaves the local counter in charge', async () => {
    await setAi(20);
    await reserveAiCall(t.db, { now: NOW });
    const r = await syncAiBudget(t.db, {
      now: NOW,
      fetch: async () => {
        throw new Error('ECONNRESET');
      },
    });
    expect(r.ok).toBe(false);
    expect((await getAiBudget(t.db, NOW)).used).toBe(1);
    const r2 = await syncAiBudget(t.db, { now: NOW, fetch: async () => new Response('nope', { status: 500 }) });
    expect(r2).toMatchObject({ ok: false, error: 'HTTP 500' });
  });

  it('disabled → no request at all', async () => {
    enableAiEnv({ AI_ENABLED: 'false' });
    const m = keyFetch({ used: 1, limit: 50, remaining: 49 });
    expect((await syncAiBudget(t.db, { now: NOW, fetch: m.fetch })).ok).toBe(false);
    expect(m.calls).toEqual([]);
  });
});
