import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ensureFxRates, getFxTable, refreshFxRates } from '@/lib/fx/ecb';
import { getSetting, setSetting } from '@/lib/settings';
import { parseSalary } from '@/lib/normalize/salary';
import { auditLog } from '@/db/schema';
import { startTestDb, type TestDb } from '../helpers/db';

const XML = (date: string, usd = '1.1702') => `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <Cube><Cube time='${date}'>
    <Cube currency='USD' rate='${usd}'/><Cube currency='GBP' rate='0.86945'/><Cube currency='CHF' rate='0.9387'/>
    <Cube currency='SEK' rate='11.0215'/><Cube currency='PLN' rate='4.2710'/><Cube currency='DKK' rate='7.4631'/>
  </Cube></Cube>
</gesmes:Envelope>`;

let t: TestDb;
let server: http.Server;
let port = 0;
let body = XML('2026-09-28');
let status = 200;
let hits = 0;

// The ECB host is mapped to a local test server; the policy allows loopback for this test only.
const resolver = async () => [{ address: '127.0.0.1', family: 4 as const }];
const addressPolicy = () => null;
const url = () => `http://ecb.test:${port}/stats/eurofxref/eurofxref-daily.xml`;

beforeAll(async () => {
  server = http.createServer((_req, res) => {
    hits++;
    res.writeHead(status, { 'content-type': 'text/xml; charset=utf-8' });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  t = await startTestDb();
}, 120_000);

afterAll(async () => {
  await t?.stop();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

beforeEach(async () => {
  await t.truncateAll();
  body = XML('2026-09-28');
  status = 200;
  hits = 0;
});

describe('ECB rates cache', () => {
  it('without a cache only EUR and fixed rates convert', async () => {
    const fx = await getFxTable(t.db);
    expect(fx.date).toBeNull();
    expect(fx.rates).toEqual({ EUR: 1, BGN: 1.95583, HRK: 7.5345 });
  });

  it('refreshes through the safe fetcher and caches with the ECB date, without an audit row', async () => {
    const now = new Date('2026-09-29T08:00:00Z');
    const saved = await refreshFxRates(t.db, { resolver, addressPolicy, url: url(), now });
    expect(hits).toBe(1);
    expect(saved).toMatchObject({ date: '2026-09-28', base: 'EUR', fetchedAt: now.toISOString() });
    expect(saved.rates.USD).toBe(1.1702);
    expect(saved.rates.AED).toBeUndefined();
    const stored = await getSetting(t.db, 'fx_rates');
    expect(stored?.date).toBe('2026-09-28');
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, 'fx_rates'));
    expect(audits).toHaveLength(0);

    const fx = await getFxTable(t.db);
    expect(fx.date).toBe('2026-09-28');
    expect(fx.rates.AED).toBeCloseTo(1.1702 * 3.6725, 6);
    const salary = parseSalary({ text: 'Salary: AED 25,000 per month', countryIso2: 'AE' }, fx)!;
    expect(salary.value.fxDate).toBe('2026-09-28');
    expect(salary.value.annualEurMin).toBe(Math.round(300000 / fx.rates.AED));
  });

  it('refuses the default policy for a loopback address (SSRF guard stays on)', async () => {
    await expect(refreshFxRates(t.db, { resolver, url: url() })).rejects.toThrow(/non-public|not public/i);
    expect(hits).toBe(0);
  });

  it('fails on HTTP errors and bad documents without touching the cache', async () => {
    await refreshFxRates(t.db, { resolver, addressPolicy, url: url() });
    status = 503;
    await expect(refreshFxRates(t.db, { resolver, addressPolicy, url: url() })).rejects.toThrow(/503/);
    status = 200;
    body = '<html>maintenance</html>';
    await expect(refreshFxRates(t.db, { resolver, addressPolicy, url: url() })).rejects.toThrow();
    expect((await getSetting(t.db, 'fx_rates'))?.rates.USD).toBe(1.1702);
  });

  it('never replaces newer rates with older ones', async () => {
    await refreshFxRates(t.db, { resolver, addressPolicy, url: url() });
    body = XML('2026-09-20', '1.05');
    const kept = await refreshFxRates(t.db, { resolver, addressPolicy, url: url() });
    expect(kept.date).toBe('2026-09-28');
    expect((await getSetting(t.db, 'fx_rates'))?.rates.USD).toBe(1.1702);
  });

  it('a lagging answer still counts as a check, so the next run does not fetch again', async () => {
    await refreshFxRates(t.db, { resolver, addressPolicy, url: url(), now: new Date('2026-09-29T08:00:00Z') });
    body = XML('2026-09-20', '1.05');
    const checkedAt = new Date('2026-09-30T08:00:00Z');
    const lag = await ensureFxRates(t.db, { resolver, addressPolicy, url: url(), now: checkedAt });
    expect(lag.setting).toMatchObject({ date: '2026-09-28', fetchedAt: checkedAt.toISOString() });
    expect(lag.setting?.rates.USD).toBe(1.1702);
    expect(hits).toBe(2);
    const next = await ensureFxRates(t.db, { resolver, addressPolicy, url: url(), now: new Date('2026-09-30T09:00:00Z') });
    expect(next.refreshed).toBe(false);
    expect(hits).toBe(2);
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.entityId, 'fx_rates'));
    expect(audits).toHaveLength(0);
  });

  it('ensureFxRates refreshes only when stale and falls back to the cache on failure', async () => {
    const t0 = new Date('2026-09-29T08:00:00Z');
    const first = await ensureFxRates(t.db, { resolver, addressPolicy, url: url(), now: t0 });
    expect(first).toMatchObject({ refreshed: true, error: null, outdated: false });
    expect(hits).toBe(1);

    const again = await ensureFxRates(t.db, { resolver, addressPolicy, url: url(), now: new Date('2026-09-29T12:00:00Z') });
    expect(again.refreshed).toBe(false);
    expect(hits).toBe(1);

    status = 500;
    const later = await ensureFxRates(t.db, { resolver, addressPolicy, url: url(), now: new Date('2026-10-06T08:00:00Z') });
    expect(later.refreshed).toBe(false);
    expect(later.error).toMatch(/500/);
    expect(later.setting?.date).toBe('2026-09-28');
    expect(later.outdated).toBe(true);

    status = 200;
    body = XML('2026-09-29', '1.18');
    const forced = await ensureFxRates(t.db, { resolver, addressPolicy, url: url(), now: new Date('2026-09-29T13:00:00Z'), force: true });
    expect(forced.refreshed).toBe(true);
    expect(forced.setting?.rates.USD).toBe(1.18);
  });

  it('ensureFxRates without any cache and a failing network returns null', async () => {
    status = 502;
    const r = await ensureFxRates(t.db, { resolver, addressPolicy, url: url() });
    expect(r).toMatchObject({ setting: null, refreshed: false });
    expect((await getFxTable(t.db)).date).toBeNull();
  });

  it('accepts an injected fetcher', async () => {
    const saved = await refreshFxRates(t.db, {
      fetch: async () => ({ status: 200, ok: true, text: () => XML('2026-09-27') }),
    });
    expect(saved.date).toBe('2026-09-27');
  });

  it('an invalid stored value degrades to EUR only', async () => {
    await setSetting(t.db, 'fx_rates', { date: '2026-09-28', base: 'EUR', rates: { USD: 1.1 }, fetchedAt: new Date().toISOString(), source: 'x' }, { skipAudit: true });
    await t.pool.query("UPDATE settings SET value_json = JSON_OBJECT('date', 'nope') WHERE `key` = 'fx_rates'");
    const fx = await getFxTable(t.db);
    expect(fx.date).toBeNull();
    expect(fx.rates.EUR).toBe(1);
  });
});
