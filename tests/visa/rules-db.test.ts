/**
 * Visa rule knowledge base against MySQL (spec §13.1): versioned rules (never edited in place),
 * "rule as of a date", stale-rule warnings, verification log, and the official page watch that
 * raises "page changed, please review" without ever touching the rules. No network: the page
 * fetch is injected.
 */
import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, auditLog, countries, officialPageWatches, visaRoutes, visaRuleChanges } from '../../src/db/schema';
import type { SafeFetchResponse } from '../../src/lib/security/safe-fetch';
import {
  addRuleVersion,
  checkOfficialPages,
  currentRule,
  currentRulesForCountry,
  ensureOfficialPageWatches,
  getRuleVersions,
  markPageReviewed,
  markRuleVerified,
  ruleAsOf,
  staleRuleWarnings,
  type FetchLike,
} from '../../src/lib/visa/rules';
import { startTestDb, type TestDb } from '../helpers/db';

const NOW = new Date('2026-09-30T08:00:00Z');
const days = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
const ROUTE_URL = 'https://www.gov.uk/skilled-worker-visa';
const RULE_URL = 'https://www.gov.uk/government/publications/skilled-worker-visa-going-rates-for-eligible-occupations';

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);
afterAll(async () => {
  await t?.stop();
});
beforeEach(async () => {
  await t.truncateAll();
});

async function seedRoute(opts: { iso2?: string; code?: string; officialUrl?: string | null; isActive?: boolean } = {}): Promise<number> {
  const iso2 = opts.iso2 ?? 'GB';
  await t.db.insert(countries).values({ iso2, name: iso2 === 'GB' ? 'United Kingdom' : iso2, tier: 1 }).onDuplicateKeyUpdate({ set: { tier: 1 } });
  const [res] = await t.db.insert(visaRoutes).values({
    countryIso2: iso2,
    code: opts.code ?? 'uk_skilled_worker',
    name: opts.code ?? 'Skilled Worker visa',
    officialUrl: opts.officialUrl === undefined ? ROUTE_URL : opts.officialUrl,
    isActive: opts.isActive ?? true,
  });
  return Number(res.insertId);
}

interface Page {
  status?: number;
  body?: string;
  contentType?: string;
  throws?: string;
}

function pageFetch(pages: Record<string, Page>): FetchLike & { calls: string[] } {
  const calls: string[] = [];
  const fn = async (url: string): Promise<SafeFetchResponse> => {
    calls.push(url);
    const p = pages[url] ?? { status: 404, body: 'not found' };
    if (p.throws) throw new Error(p.throws);
    const status = p.status ?? 200;
    const body = Buffer.from(p.body ?? '', 'utf8');
    return {
      status,
      ok: status >= 200 && status < 300,
      finalUrl: url,
      redirects: [],
      headers: new Headers({ 'content-type': p.contentType ?? 'text/html; charset=utf-8' }),
      body,
      remoteAddress: '203.0.113.10',
      text: () => body.toString('utf8'),
      json: <T,>() => JSON.parse(body.toString('utf8')) as T,
    };
  };
  return Object.assign(fn, { calls });
}

const govPage = (threshold: string, footer = 'Last updated 1 September 2026') =>
  `<html><body><header>Cookies on GOV.UK</header><main><h1>Skilled Worker visa</h1><p>You must usually be paid at least ${threshold} per year.</p></main><footer>${footer}</footer></body></html>`;

describe('addRuleVersion / ruleAsOf / currentRule', () => {
  it('adds numbered versions, never edits old ones, and answers "rule as of a date"', async () => {
    const routeId = await seedRoute();
    const v1 = await addRuleVersion(
      t.db,
      { routeId, effectiveFrom: '2024-04-04', salaryThresholdLocal: 38_700, currency: 'gbp', changeReason: 'April 2024 salary rise', verified: true },
      { now: days(-400) },
    );
    const v2 = await addRuleVersion(
      t.db,
      { routeId, effectiveFrom: '2025-07-22', salaryThresholdLocal: 41_700, currency: 'GBP', officialSourceUrl: RULE_URL, changeReason: 'July 2025 statement of changes', verified: true },
      { now: days(-30) },
    );
    expect(v1.version).toBe(1);
    expect(v2.version).toBe(2);

    const all = await getRuleVersions(t.db, routeId);
    expect(all.map((r) => [r.version, r.effectiveFrom, r.salaryThresholdLocal, r.currency])).toEqual([
      [1, '2024-04-04', 38_700, 'GBP'],
      [2, '2025-07-22', 41_700, 'GBP'],
    ]);
    // The route's official URL is the default source; an explicit one is kept.
    expect(all[0].officialSourceUrl).toBe(ROUTE_URL);
    expect(all[1].officialSourceUrl).toBe(RULE_URL);

    expect(await ruleAsOf(t.db, routeId, '2024-04-03')).toBeNull();
    expect((await ruleAsOf(t.db, routeId, '2024-04-04'))?.version).toBe(1);
    expect((await ruleAsOf(t.db, routeId, '2025-07-21'))?.version).toBe(1);
    expect((await ruleAsOf(t.db, routeId, new Date('2025-07-22T00:00:00Z')))?.version).toBe(2);
    expect((await currentRule(t.db, routeId, NOW))?.version).toBe(2);

    // Every change is logged with its reason, and audited.
    const changes = await t.db.select().from(visaRuleChanges).orderBy(asc(visaRuleChanges.id));
    expect(changes.map((c) => [c.changeKind, c.ruleVersionId, c.why])).toEqual([
      ['created', v1.id, 'April 2024 salary rise'],
      ['created', v2.id, 'July 2025 statement of changes'],
    ]);
    expect(changes[1].what).toContain('GB uk_skilled_worker v2');
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, 'visa_rule.create'));
    expect(audits).toHaveLength(2);
  });

  it('validates its input and rejects an unknown route', async () => {
    const routeId = await seedRoute();
    await expect(addRuleVersion(t.db, { routeId, effectiveFrom: '22/07/2025', changeReason: 'x' })).rejects.toThrow(RangeError);
    await expect(addRuleVersion(t.db, { routeId, effectiveFrom: '2025-07-22', effectiveTo: '2025-01-01', changeReason: 'x' })).rejects.toThrow(RangeError);
    await expect(addRuleVersion(t.db, { routeId, effectiveFrom: '2025-07-22', changeReason: '   ' })).rejects.toThrow(/changeReason/);
    await expect(addRuleVersion(t.db, { routeId: routeId + 99, effectiveFrom: '2025-07-22', changeReason: 'x' })).rejects.toThrow(/not found/);
    expect(await getRuleVersions(t.db, routeId)).toHaveLength(0);
    expect(await t.db.select().from(visaRuleChanges)).toHaveLength(0);
  });
});

describe('staleness and verification', () => {
  it('warns per country for stale or never-verified current rules, and markRuleVerified clears it', async () => {
    const gb = await seedRoute();
    const nl = await seedRoute({ iso2: 'NL', code: 'nl_kennismigrant', officialUrl: null });
    const de = await seedRoute({ iso2: 'DE', code: 'eu_blue_card', officialUrl: null });
    await addRuleVersion(t.db, { routeId: gb, effectiveFrom: '2025-07-22', changeReason: 'seed', verified: true }, { now: days(-91) });
    const nlRule = await addRuleVersion(t.db, { routeId: nl, effectiveFrom: '2026-01-01', changeReason: 'seed' }, { now: days(-5) });
    await addRuleVersion(t.db, { routeId: de, effectiveFrom: '2026-01-01', changeReason: 'seed', verified: true }, { now: days(-90) });

    const warnings = await staleRuleWarnings(t.db, NOW);
    expect(Object.keys(warnings).sort()).toEqual(['GB', 'NL']);
    expect(warnings.GB[0]).toMatch(/91 days ago/);
    expect(warnings.NL[0]).toMatch(/never verified/i);

    const gbRules = await currentRulesForCountry(t.db, 'gb', NOW);
    expect(gbRules).toHaveLength(1);
    expect(gbRules[0].label).toBe('GB uk_skilled_worker v1');
    expect(gbRules[0].freshness?.stale).toBe(true);

    expect(await markRuleVerified(t.db, nlRule.id, { now: NOW, verifiedBy: 'admin', note: 'checked IND page' })).toBe(true);
    expect(Object.keys(await staleRuleWarnings(t.db, NOW))).toEqual(['GB']);
    const [nlRow] = await getRuleVersions(t.db, nl);
    expect(nlRow.verificationStatus).toBe('verified');
    expect(nlRow.lastVerifiedAt?.toISOString()).toBe(NOW.toISOString());
    expect(nlRow.effectiveFrom).toBe('2026-01-01'); // only verification fields change
    const verifiedLog = await t.db.select().from(visaRuleChanges).where(eq(visaRuleChanges.changeKind, 'verified'));
    expect(verifiedLog).toHaveLength(1);
    expect(verifiedLog[0].why).toBe('checked IND page');

    expect(await markRuleVerified(t.db, 999_999, { now: NOW })).toBe(false);
  });

  it('an inactive route never produces a warning', async () => {
    const r = await seedRoute({ isActive: false });
    await addRuleVersion(t.db, { routeId: r, effectiveFrom: '2025-01-01', changeReason: 'seed' }, { now: days(-200) });
    expect(await staleRuleWarnings(t.db, NOW)).toEqual({});
    expect(await currentRulesForCountry(t.db, 'GB', NOW)).toEqual([]);
  });
});

describe('checkOfficialPages', () => {
  it('baseline → unchanged → changed (alert + change log, rules untouched) → reviewed', async () => {
    const routeId = await seedRoute();
    await addRuleVersion(t.db, { routeId, effectiveFrom: '2025-07-22', officialSourceUrl: RULE_URL, salaryThresholdLocal: 41_700, currency: 'GBP', changeReason: 'seed', verified: true }, { now: days(-10) });
    const rulesBefore = await getRuleVersions(t.db, routeId);

    const pages: Record<string, Page> = { [ROUTE_URL]: { body: govPage('£41,700') }, [RULE_URL]: { body: govPage('£41,700 (going rate)') } };
    const first = await checkOfficialPages(t.db, { fetch: pageFetch(pages), now: NOW });
    expect(first).toMatchObject({ checked: 2, baseline: 2, unchanged: 0, changed: 0, errors: 0 });
    const watches = await t.db.select().from(officialPageWatches).orderBy(asc(officialPageWatches.id));
    expect(watches.map((w) => [w.url, w.status, w.routeId])).toEqual([
      [ROUTE_URL, 'ok', routeId],
      [RULE_URL, 'ok', routeId],
    ]);
    expect(watches.every((w) => /^[0-9a-f]{64}$/.test(w.lastHash ?? ''))).toBe(true);

    // Only the footer changed: not a content change.
    pages[ROUTE_URL] = { body: govPage('£41,700', 'Last updated 30 September 2026') };
    const second = await checkOfficialPages(t.db, { fetch: pageFetch(pages), now: days(1) });
    expect(second).toMatchObject({ checked: 2, unchanged: 2, changed: 0 });
    expect(await t.db.select().from(alerts)).toHaveLength(0);

    // The threshold on the page changed.
    pages[ROUTE_URL] = { body: govPage('£45,000') };
    const third = await checkOfficialPages(t.db, { fetch: pageFetch(pages), now: days(2) });
    expect(third).toMatchObject({ changed: 1, unchanged: 1 });
    const changedWatch = (await t.db.select().from(officialPageWatches).where(eq(officialPageWatches.url, ROUTE_URL)))[0];
    expect(changedWatch.status).toBe('changed');
    expect(changedWatch.changedAt?.toISOString()).toBe(days(2).toISOString());
    const alertRows = await t.db.select().from(alerts);
    expect(alertRows).toHaveLength(1);
    expect(alertRows[0]).toMatchObject({ kind: 'visa_page_changed', severity: 'warn', dedupeKey: `page-watch:${changedWatch.id}:changed` });
    expect(alertRows[0].title).toMatch(/please review/);
    const pageLog = await t.db.select().from(visaRuleChanges).where(eq(visaRuleChanges.changeKind, 'page_changed'));
    expect(pageLog).toHaveLength(1);
    expect(pageLog[0].ruleVersionId).toBeNull();
    expect(pageLog[0].why).toMatch(/NOT changed/);
    // The rules themselves were not touched.
    expect(await getRuleVersions(t.db, routeId)).toEqual(rulesBefore);

    // A later identical check keeps "changed" visible until reviewed.
    const fourth = await checkOfficialPages(t.db, { fetch: pageFetch(pages), now: days(3) });
    expect(fourth).toMatchObject({ unchanged: 2, changed: 0 });
    expect((await t.db.select().from(officialPageWatches).where(eq(officialPageWatches.id, changedWatch.id)))[0].status).toBe('changed');

    expect(await markPageReviewed(t.db, changedWatch.id, { note: 'threshold noted' })).toBe(true);
    expect((await t.db.select().from(officialPageWatches).where(eq(officialPageWatches.id, changedWatch.id)))[0].status).toBe('ok');
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'visa_page.reviewed'))).toHaveLength(1);
    expect(await markPageReviewed(t.db, 999_999)).toBe(false);
  });

  it('a page error marks the watch and raises one deduplicated alert, never throws', async () => {
    const routeId = await seedRoute();
    await ensureOfficialPageWatches(t.db, NOW);
    const failing = pageFetch({ [ROUTE_URL]: { status: 503, body: 'Service Unavailable' } });
    const r1 = await checkOfficialPages(t.db, { fetch: failing, now: NOW });
    expect(r1).toMatchObject({ checked: 1, errors: 1 });
    expect(r1.pages[0].error).toBe('HTTP 503');
    const [w] = await t.db.select().from(officialPageWatches);
    expect(w).toMatchObject({ status: 'error', lastError: 'HTTP 503', routeId });
    expect(w.lastHash).toBeNull();

    const throwing = pageFetch({ [ROUTE_URL]: { throws: 'getaddrinfo ENOTFOUND www.gov.uk' } });
    const r2 = await checkOfficialPages(t.db, { fetch: throwing, now: days(1) });
    expect(r2.errors).toBe(1);
    const alertRows = await t.db.select().from(alerts);
    expect(alertRows).toHaveLength(1);
    expect(alertRows[0]).toMatchObject({ kind: 'visa_page_error', occurrences: 2 });

    const empty = pageFetch({ [ROUTE_URL]: { body: '   ' } });
    expect((await checkOfficialPages(t.db, { fetch: empty, now: days(2) })).pages[0].error).toBe('empty page');

    // Recovery: the next good fetch becomes the baseline and clears the error.
    const ok = pageFetch({ [ROUTE_URL]: { body: govPage('£41,700') } });
    expect(await checkOfficialPages(t.db, { fetch: ok, now: days(3) })).toMatchObject({ baseline: 1, errors: 0 });
    const [after] = await t.db.select().from(officialPageWatches);
    expect(after).toMatchObject({ status: 'ok', lastError: null });
  });

  it('ensureOfficialPageWatches is idempotent and skips non-http URLs', async () => {
    await seedRoute();
    await seedRoute({ iso2: 'NL', code: 'nl_kennismigrant', officialUrl: 'ftp://example.org/rules' });
    expect(await ensureOfficialPageWatches(t.db, NOW)).toBe(1);
    expect(await ensureOfficialPageWatches(t.db, NOW)).toBe(0);
    const fetch = pageFetch({ [ROUTE_URL]: { body: govPage('£41,700') } });
    await checkOfficialPages(t.db, { fetch, now: NOW, ensureWatches: false });
    expect(fetch.calls).toEqual([ROUTE_URL]);
  });
});
