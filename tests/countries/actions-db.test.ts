/**
 * DB-backed tests for the /countries Server Actions (src/lib/actions/countries.ts) and the guide
 * query: verify today (+90 days, change log, audit), add a version without touching the old ones,
 * the go-live gate, page reviews, and the as-of view. Session and request APIs are mocked.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, countries, officialPageWatches, visaRoutes, visaRuleChanges, visaRuleVersions } from '../../src/db/schema';
import { sha256Hex } from '../../src/lib/hash';
import { listCountries, loadCountryGuide } from '../../src/lib/queries/countries';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry } from '../helpers/fixtures';

const IP = '203.0.113.44';
const DAY = 86_400_000;

const state = vi.hoisted(() => ({ signedIn: true, refresh: vi.fn() }));

class RedirectSignal extends Error {
  constructor(public readonly url: string) {
    super(`NEXT_REDIRECT ${url}`);
  }
}

vi.mock('next/cache', () => ({ refresh: state.refresh }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-real-ip': IP }) }));
vi.mock('@/lib/auth/session', () => ({
  requireSession: async () => {
    if (!state.signedIn) throw new RedirectSignal('/login');
    return { id: 1, sid: 'test' };
  },
}));

const actions = await import('../../src/lib/actions/countries');

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb({ bindGlobal: true });
});

afterAll(async () => {
  await t?.stop();
});

beforeEach(async () => {
  await t.truncateAll();
  state.signedIn = true;
  state.refresh.mockReset();
});

function form(fields: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
}

const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);

async function seedRoute(opts: { iso2?: string; verifiedDaysAgo?: number | null; effectiveFrom?: string } = {}) {
  const iso2 = await seedCountry(t.db, opts.iso2 ?? 'NL', 'Netherlands', 1);
  const [r] = await t.db.insert(visaRoutes).values({ countryIso2: iso2, code: 'hsm', name: 'Highly skilled migrant', officialUrl: 'https://ind.example.test/hsm' });
  const routeId = Number(r.insertId);
  const verified = opts.verifiedDaysAgo !== undefined && opts.verifiedDaysAgo !== null;
  const [v] = await t.db.insert(visaRuleVersions).values({
    routeId,
    version: 1,
    effectiveFrom: opts.effectiveFrom ?? day(-400),
    salaryThresholdEur: 66_000,
    currency: 'EUR',
    degreeRule: 'No degree needed',
    verificationStatus: verified ? 'verified' : 'unverified',
    lastVerifiedAt: verified ? new Date(Date.now() - opts.verifiedDaysAgo! * DAY) : null,
    nextReviewAt: new Date(Date.now() + 10 * DAY),
    changeReason: 'Seed',
  });
  return { iso2, routeId, ruleId: Number(v.insertId) };
}

async function audits(action: string) {
  return t.db.select().from(auditLog).where(eq(auditLog.action, action)).orderBy(asc(auditLog.id));
}

describe('country actions', () => {
  it('needs a session', async () => {
    state.signedIn = false;
    await expect(actions.setCountryLiveAction(undefined, form({ iso2: 'NL', live: '1' }))).rejects.toThrow(RedirectSignal);
  });

  it('marks a rule verified today: +90 days review, change log and audit', async () => {
    const { ruleId, routeId } = await seedRoute({ verifiedDaysAgo: 200 });
    const res = await actions.markRuleVerifiedAction(undefined, form({ ruleVersionId: ruleId, note: 'Threshold unchanged on the 2026 page' }));
    expect(res.ok, res.error).toBe(true);
    const [rule] = await t.db.select().from(visaRuleVersions).where(eq(visaRuleVersions.id, ruleId));
    expect(rule.verificationStatus).toBe('verified');
    expect(Math.abs(rule.lastVerifiedAt!.getTime() - Date.now())).toBeLessThan(60_000);
    expect(Math.round((rule.nextReviewAt!.getTime() - rule.lastVerifiedAt!.getTime()) / DAY)).toBe(90);
    const [change] = await t.db.select().from(visaRuleChanges).where(eq(visaRuleChanges.routeId, routeId));
    expect(change).toMatchObject({ changeKind: 'verified', why: 'Threshold unchanged on the 2026 page', ruleVersionId: ruleId });
    const [a] = await audits('visa_rule.verify');
    expect(a).toMatchObject({ entityType: 'visa_rule_version', entityId: String(ruleId), ip: IP });
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect((await actions.markRuleVerifiedAction(undefined, form({ ruleVersionId: 999_999 }))).ok).toBe(false);
  });

  it('adds a rule version with the next number and never overwrites the old one', async () => {
    const { ruleId, routeId } = await seedRoute({ verifiedDaysAgo: 10 });
    const noReason = await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(30) }));
    expect(noReason.ok).toBe(false);
    const backwards = await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(30), effectiveTo: day(10), changeReason: '2027 threshold' }));
    expect(backwards).toMatchObject({ ok: false, error: 'The end day is before the start day.' });
    const badCurrency = await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(30), currency: 'EURO', changeReason: '2027 threshold' }));
    expect(badCurrency.ok).toBe(false);

    const res = await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(30), salaryThresholdEur: '68000', currency: 'eur', changeReason: '2027 threshold announced' }));
    expect(res.ok, res.error).toBe(true);
    const rows = await t.db.select().from(visaRuleVersions).where(eq(visaRuleVersions.routeId, routeId)).orderBy(asc(visaRuleVersions.version));
    expect(rows.map((r) => r.version)).toEqual([1, 2]);
    expect(rows[0]).toMatchObject({ id: ruleId, salaryThresholdEur: 66_000, verificationStatus: 'verified' });
    expect(rows[1]).toMatchObject({ salaryThresholdEur: 68_000, currency: 'EUR', verificationStatus: 'unverified', officialSourceUrl: 'https://ind.example.test/hsm' });
    const changes = await t.db.select().from(visaRuleChanges).where(eq(visaRuleChanges.ruleVersionId, rows[1].id));
    expect(changes[0]).toMatchObject({ changeKind: 'created', why: '2027 threshold announced' });
    expect((await audits('visa_rule.create'))[0].ip).toBe(IP);

    const verified = await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(60), changeReason: 'Checked the page', verified: '1' }));
    expect(verified.ok, verified.error).toBe(true);
    const [v3] = await t.db.select().from(visaRuleVersions).where(eq(visaRuleVersions.id, verified.id!));
    expect(v3).toMatchObject({ version: 3, verificationStatus: 'verified', verifiedBy: 'admin' });
  });

  it('only goes live with a verified, fresh rule in effect', async () => {
    const stale = await seedRoute({ iso2: 'NL', verifiedDaysAgo: 120 });
    const refused = await actions.setCountryLiveAction(undefined, form({ iso2: 'nl', live: '1', reason: 'Start applying' }));
    expect(refused.ok).toBe(false);
    expect(refused.error).toContain('stays off');
    expect((await t.db.select().from(countries).where(eq(countries.iso2, 'NL')))[0].isLive).toBe(false);

    await actions.markRuleVerifiedAction(undefined, form({ ruleVersionId: stale.ruleId }));
    const live = await actions.setCountryLiveAction(undefined, form({ iso2: 'nl', live: '1', reason: 'Start applying' }));
    expect(live.ok, live.error).toBe(true);
    expect((await t.db.select().from(countries).where(eq(countries.iso2, 'NL')))[0].isLive).toBe(true);
    const [a] = await audits('country.go_live');
    expect(a).toMatchObject({ entityType: 'country', entityId: 'NL', reason: 'Start applying', ip: IP });
    expect(a.afterJson).toMatchObject({ isLive: true, rulesInEffect: [{ id: stale.ruleId, version: 1 }] });

    const again = await actions.setCountryLiveAction(undefined, form({ iso2: 'NL', live: '1' }));
    expect(again).toMatchObject({ ok: false, error: 'Netherlands is already live.' });
    const off = await actions.setCountryLiveAction(undefined, form({ iso2: 'NL', live: '0' }));
    expect(off.ok, off.error).toBe(true);
    expect(await audits('country.go_off')).toHaveLength(1);

    await seedCountry(t.db, 'SE', 'Sweden', 2);
    const none = await actions.setCountryLiveAction(undefined, form({ iso2: 'SE', live: '1' }));
    expect(none.ok).toBe(false);
  });

  it('marks a changed official page reviewed', async () => {
    const { routeId } = await seedRoute({ verifiedDaysAgo: 5 });
    const url = 'https://ind.example.test/hsm';
    const [w] = await t.db.insert(officialPageWatches).values({ url, urlHash: sha256Hex(url), routeId, status: 'changed', changedAt: new Date() });
    const watchId = Number(w.insertId);
    const res = await actions.markPageReviewedAction(undefined, form({ watchId, note: 'Only the layout changed' }));
    expect(res.ok, res.error).toBe(true);
    expect((await t.db.select().from(officialPageWatches).where(eq(officialPageWatches.id, watchId)))[0].status).toBe('ok');
    const [a] = await audits('visa_page.reviewed');
    expect(a).toMatchObject({ entityId: String(watchId), reason: 'Only the layout changed', ip: IP });
    const again = await actions.markPageReviewedAction(undefined, form({ watchId }));
    expect(again).toMatchObject({ ok: false, error: 'That page is already marked reviewed.' });
  });
});

describe('country queries', () => {
  it('shows the rule in effect on an as-of day, upcoming versions and the list marker', async () => {
    const { iso2, routeId } = await seedRoute({ verifiedDaysAgo: 5, effectiveFrom: day(-400) });
    await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(-100), salaryThresholdEur: '67000', changeReason: 'Indexed', verified: '1' }));
    await actions.addRuleVersionAction(undefined, form({ routeId, effectiveFrom: day(40), salaryThresholdEur: '69000', changeReason: 'Announced' }));

    const g = await loadCountryGuide(iso2);
    expect(g).not.toBeNull();
    const r = g!.routes[0];
    expect(r.versions.map((v) => v.version)).toEqual([3, 2, 1]);
    expect(r.current?.version).toBe(2);
    expect(r.upcoming.map((v) => v.version)).toEqual([3]);
    expect(g!.asOfDay).toBeNull();
    expect(g!.marker).toBe('verified');
    expect(g!.goLive.ok).toBe(true);
    expect(g!.changes.map((c) => c.changeKind)).toEqual(['created', 'created']);

    const past = await loadCountryGuide(iso2, { asOf: day(-200) });
    expect(past!.asOfDay).toBe(day(-200));
    expect(past!.routes[0].asOf?.version).toBe(1);
    expect(past!.routes[0].current?.version).toBe(2);
    const before = await loadCountryGuide(iso2, { asOf: day(-1000) });
    expect(before!.routes[0].asOf).toBeNull();

    await t.db.update(visaRuleVersions).set({ lastVerifiedAt: new Date(Date.now() - 100 * DAY) }).where(and(eq(visaRuleVersions.routeId, routeId), eq(visaRuleVersions.version, 2)));
    const [tier] = await listCountries();
    expect(tier.countries[0]).toMatchObject({ iso2, marker: 'stale', routes: 1, isLive: false });
    expect(await loadCountryGuide('ZZ')).toBeNull();
  });
});
