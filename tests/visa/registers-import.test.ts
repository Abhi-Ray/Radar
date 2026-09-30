/**
 * Register import into MySQL (spec §13.2): one atomic replace per register with the register name
 * and download date, stable ids for unchanged rows, idempotent daily runs, guards against broken
 * downloads, and an alert (never an exception) when a register cannot be refreshed.
 * All downloads are served from the trimmed real fixtures; no network.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { alerts, auditLog, sponsorRegisterEntries as sre } from '../../src/db/schema';
import { hashJson } from '../../src/lib/hash';
import { getRegisterStatus, refreshRegister, refreshRegisters, REGISTER_KEYS, REGISTERS, type RefreshRegistersOptions, type RegisterKey } from '../../src/lib/registers';
import { IMPORT_ACTION, importSnapshot, normalizerFingerprint, prepareEntry, REGISTERS_LOGIC_VERSION, registerStates } from '../../src/lib/registers/import';
import { UK_CONTENT_API } from '../../src/lib/registers/uk';
import { DK_SIRI_URL, NL_IND_URL } from '../../src/lib/registers/html-sources';
import type { RegisterEntryInput } from '../../src/lib/registers/types';
import { startTestDb, type TestDb } from '../helpers/db';
import { fakeFetch, fixtureText, realRegisterRoutes, UK_CSV_URL, type Served } from './register-fixtures';

const T0 = new Date('2026-09-30T06:00:00Z');
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);
/** The fixtures are ≤ 50-row cuts of the real registers: accept them. */
const SMALL: RefreshRegistersOptions['minEntries'] = { uk_home_office: 5, nl_ind: 5, dk_siri: 5, ie_dete: 5, ca_lmia: 5 };

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

function opts(routes: Record<string, Served>, now: Date, over: Partial<RefreshRegistersOptions> = {}): RefreshRegistersOptions {
  return { fetch: fakeFetch(routes), now, minEntries: SMALL, ...over };
}

async function rows(key: RegisterKey) {
  return t.db
    .select({ id: sre.id, orgName: sre.orgName, normalizedName: sre.normalizedName, town: sre.town, route: sre.route, rating: sre.rating, version: sre.registerVersion, country: sre.countryIso2, importedAt: sre.importedAt })
    .from(sre)
    .where(eq(sre.registerKey, key))
    .orderBy(asc(sre.id));
}

/** The UK fixture with `drop` lines removed and `add` lines appended. */
function ukCsv(opts: { drop?: RegExp; add?: string[] } = {}): string {
  const lines = fixtureText('uk-register.csv').split(/\r?\n/).filter((l) => l !== '');
  const kept = lines.filter((l, i) => i === 0 || !opts.drop || !opts.drop.test(l));
  return [...kept, ...(opts.add ?? [])].join('\r\n') + '\r\n';
}

describe('refreshRegisters', () => {
  it('imports every register with its name, country and download date', async () => {
    const results = await refreshRegisters(t.db, opts(realRegisterRoutes(), T0));
    expect(results.map((r) => [r.key, r.status, r.rows, r.duplicates, r.version])).toEqual([
      ['uk_home_office', 'imported', 42, 1, '2026-09-30'],
      ['nl_ind', 'imported', 27, 0, '2026-09-30'],
      ['dk_siri', 'imported', 25, 0, '2026-09-30'],
      ['ie_dete', 'imported', 49, 0, '2026-09-30'],
      ['ca_lmia', 'imported', 34, 0, '2026-09-30'],
    ]);
    expect(results.map((r) => r.publishedAt)).toEqual(['2026-09-29', '2026-09-03', '2026-09-29', '2026-09-02', '2026-07-21']);
    for (const r of results) {
      expect(r.name).toBe(REGISTERS[r.key].name);
      expect(r.inserted).toBe(r.rows);
      expect(r.reason).toBeNull();
      const stored = await rows(r.key);
      expect(stored).toHaveLength(r.rows);
      expect(new Set(stored.map((s) => s.country))).toEqual(new Set([REGISTERS[r.key].countryIso2]));
      expect(stored.every((s) => s.version === '2026-09-30' && s.normalizedName.length > 0)).toBe(true);
    }
    const uk = await rows('uk_home_office');
    expect(uk.find((r) => r.orgName === 'Akaal Transport Ltd')).toMatchObject({ town: 'Leicester, Leicestershire', route: 'Skilled Worker', rating: 'B rating' });
    expect(uk.filter((r) => r.orgName === 'Monzo Bank Ltd')).toHaveLength(2);
    const [raw] = await t.db.select({ raw: sre.rawJson, hash: sre.entryHash }).from(sre).where(and(eq(sre.registerKey, 'dk_siri'), eq(sre.orgName, 'Novo Nordisk A/S')));
    expect(raw.raw).toEqual({ organisation: 'Novo Nordisk A/S', cvr: '24256790' });
    expect(raw.hash).toBe(hashJson({ organisation: 'Novo Nordisk A/S', cvr: '24256790' }));

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, IMPORT_ACTION));
    expect(audits).toHaveLength(5);
    expect(audits.every((a) => a.actor === 'worker' && a.entityType === 'sponsor_register')).toBe(true);
    const nl = audits.find((a) => a.entityId === 'nl_ind')!;
    expect(nl.afterJson).toMatchObject({ status: 'imported', version: '2026-09-30', publishedAt: '2026-09-03', rows: 27, logic: REGISTERS_LOGIC_VERSION, normalizer: normalizerFingerprint(), checkedAt: T0.toISOString() });
    expect(nl.reason).toBe('IND public register of recognised sponsors (work): 27 entries (27 new, 0 kept, 0 removed)');
    expect(await t.db.select().from(alerts)).toHaveLength(0);
  });

  it('is idempotent: skips within 20 h, then only moves the version when nothing changed', async () => {
    await refreshRegisters(t.db, opts(realRegisterRoutes(), T0));
    const before = await rows('ca_lmia');

    const early = opts(realRegisterRoutes(), hours(3));
    const skipped = await refreshRegisters(t.db, early);
    expect(skipped.every((r) => r.status === 'skipped' && /checked 3\.0 h ago \(interval 20 h\)/.test(r.reason ?? ''))).toBe(true);
    expect(skipped[0]).toMatchObject({ version: '2026-09-30', rows: 42, publishedAt: '2026-09-29' });
    expect((early.fetch as ReturnType<typeof fakeFetch>).calls).toEqual([]);

    const next = await refreshRegisters(t.db, opts(realRegisterRoutes(), hours(24)));
    expect(next.map((r) => [r.status, r.version, r.rows, r.kept, r.inserted, r.removed])).toEqual(
      REGISTER_KEYS.map((k) => ['unchanged', '2026-10-01', { uk_home_office: 42, nl_ind: 27, dk_siri: 25, ie_dete: 49, ca_lmia: 34 }[k], { uk_home_office: 42, nl_ind: 27, dk_siri: 25, ie_dete: 49, ca_lmia: 34 }[k], 0, 0]),
    );
    const after = await rows('ca_lmia');
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.every((r) => r.version === '2026-10-01')).toBe(true);
    // importedAt keeps the first sighting.
    expect(after.map((r) => r.importedAt.getTime())).toEqual(before.map((r) => r.importedAt.getTime()));
  });

  it('keeps ids of unchanged rows, adds new ones and removes rows no longer published', async () => {
    await refreshRegister(t.db, 'uk_home_office', opts(realRegisterRoutes(), T0));
    const before = await rows('uk_home_office');
    const routes = realRegisterRoutes();
    routes[UK_CSV_URL] = ukCsv({ drop: /^REVOLUTION CLOTHING/, add: ['Wise Payments Limited,London,,Worker (A rating),Skilled Worker'] });
    const r = await refreshRegister(t.db, 'uk_home_office', opts(routes, hours(24)));
    expect(r).toMatchObject({ status: 'imported', version: '2026-10-01', rows: 42, inserted: 1, kept: 41, removed: 1 });
    const after = await rows('uk_home_office');
    expect(after.some((x) => x.orgName === 'REVOLUTION CLOTHING COMPANY LIMITED')).toBe(false);
    const wise = after.find((x) => x.orgName === 'Wise Payments Limited')!;
    expect(wise.importedAt.getTime()).toBe(hours(24).getTime());
    const keptBefore = before.filter((x) => x.orgName !== 'REVOLUTION CLOTHING COMPANY LIMITED');
    expect(after.filter((x) => x.id !== wise.id).map((x) => x.id)).toEqual(keptBefore.map((x) => x.id));
    expect(after.every((x) => x.version === '2026-10-01')).toBe(true);
  });

  it('re-imports on the same download date (forced) without losing ids', async () => {
    await refreshRegister(t.db, 'nl_ind', opts(realRegisterRoutes(), T0));
    const before = await rows('nl_ind');
    const routes = realRegisterRoutes();
    routes[NL_IND_URL] = fixtureText('ind-work.html').replace(/<tr><th scope="row">Mollie B\.V\.<\/th>.*?<\/tr>/, '');
    const r = await refreshRegister(t.db, 'nl_ind', opts(routes, hours(2), { force: true }));
    expect(r).toMatchObject({ status: 'imported', version: '2026-09-30', rows: 26, kept: 26, inserted: 0, removed: 1 });
    const after = await rows('nl_ind');
    expect(after.map((x) => x.id)).toEqual(before.filter((x) => x.orgName !== 'Mollie B.V.').map((x) => x.id));
    expect(new Set(after.map((x) => x.version))).toEqual(new Set(['2026-09-30']));
  });

  it('a failed download keeps the old version, is audited and raises one deduplicated alert', async () => {
    await refreshRegister(t.db, 'dk_siri', opts(realRegisterRoutes(), T0));
    const before = await rows('dk_siri');
    const down = { ...realRegisterRoutes(), [DK_SIRI_URL]: { status: 503, body: 'maintenance' } };

    const r = await refreshRegister(t.db, 'dk_siri', opts(down, hours(24)));
    expect(r).toMatchObject({ status: 'failed', version: '2026-09-30', rows: 25, reason: `HTTP 503 for ${DK_SIRI_URL}` });
    expect(await rows('dk_siri')).toEqual(before);
    let [alert] = await t.db.select().from(alerts);
    expect(alert).toMatchObject({ kind: 'register_import', severity: 'warn', dedupeKey: 'register:dk_siri:down', entityType: 'sponsor_register', entityId: 'dk_siri', occurrences: 1 });
    expect(alert.title).toBe('Sponsor register import failed: SIRI certified companies (Fast-track scheme)');
    expect(alert.body).toContain('The previous version (2026-09-30, 25 entries) stays in use.');

    // Retried no sooner than 2 h after the failure …
    const soon = await refreshRegister(t.db, 'dk_siri', opts(down, hours(25)));
    expect(soon.status).toBe('skipped');
    expect(soon.reason).toMatch(/last attempt failed 1\.0 h ago; retrying after 2 h/);
    // … and a second failure bumps the same alert.
    const again = await refreshRegister(t.db, 'dk_siri', opts(down, hours(27)));
    expect(again.status).toBe('failed');
    [alert] = await t.db.select().from(alerts);
    expect((await t.db.select().from(alerts)).length).toBe(1);
    expect(alert.occurrences).toBe(2);

    const states = await registerStates(t.db, 'dk_siri');
    expect(states.lastAttempt).toMatchObject({ status: 'failed', error: `HTTP 503 for ${DK_SIRI_URL}` });
    expect(states.lastSuccess).toMatchObject({ status: 'imported', version: '2026-09-30', rows: 25 });

    // Recovery: the next good run imports normally.
    const ok = await refreshRegister(t.db, 'dk_siri', opts(realRegisterRoutes(), hours(30)));
    expect(ok).toMatchObject({ status: 'unchanged', version: '2026-10-01', rows: 25 });
  });

  it('alerts critical when there is no usable version, and after the stale limit', async () => {
    const r = await refreshRegister(t.db, 'ie_dete', opts({}, T0));
    expect(r).toMatchObject({ status: 'failed', version: null, rows: 0 });
    expect(r.reason).toMatch(/HTTP 404/);
    const [a] = await t.db.select().from(alerts);
    expect(a).toMatchObject({ severity: 'critical', dedupeKey: 'register:ie_dete:down' });
    expect(a.body).toContain('No version of this register has been imported yet');

    await t.truncateAll();
    await refreshRegister(t.db, 'nl_ind', opts(realRegisterRoutes(), T0));
    await refreshRegister(t.db, 'nl_ind', opts({}, hours(24 * 50)));
    const [stale] = await t.db.select().from(alerts);
    expect(stale.severity).toBe('critical');
    expect(stale.body).toContain('but it is older than 45 days');
  });

  it('rejects a register with too few entries (the real minimum applies by default)', async () => {
    const r = await refreshRegister(t.db, 'uk_home_office', { fetch: fakeFetch(realRegisterRoutes()), now: T0 });
    expect(r.status).toBe('failed');
    expect(r.reason).toBe('UK Home Office register of licensed sponsors (workers): only 42 entries parsed (expected at least 50000) — the file or its format looks broken');
    expect(await rows('uk_home_office')).toHaveLength(0);
  });

  it('rejects a download that shrank below half of the current version unless forced', async () => {
    await refreshRegister(t.db, 'uk_home_office', opts(realRegisterRoutes(), T0));
    const routes = realRegisterRoutes();
    routes[UK_CSV_URL] = ukCsv({ drop: /^(?!(Monzo|Revolut|Arm) )/ });
    const r = await refreshRegister(t.db, 'uk_home_office', opts(routes, hours(24)));
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/8 entries vs 42 in the current version \(less than 50%\) — looks like a truncated download/);
    expect(await rows('uk_home_office')).toHaveLength(42);
    const forced = await refreshRegister(t.db, 'uk_home_office', opts(routes, hours(24), { force: true }));
    expect(forced).toMatchObject({ status: 'imported', rows: 8, kept: 8, removed: 34 });
    expect(await rows('uk_home_office')).toHaveLength(8);
  });

  it('refuses a file link that leaves the publisher hosts', async () => {
    const doc = JSON.parse(fixtureText('uk-content.json'));
    doc.details.attachments[0].url = 'https://example.org/SP_-_Worker_Register_-_2026-09-29.csv';
    const f = fakeFetch({ [UK_CONTENT_API]: JSON.stringify(doc) });
    const r = await refreshRegister(t.db, 'uk_home_office', { fetch: f, now: T0, minEntries: SMALL });
    expect(r.status).toBe('failed');
    expect(r.reason).toMatch(/not on an official host/);
    expect(f.calls).toEqual([UK_CONTENT_API]);
  });

  it('reports "skipped" while another import of the same register holds the lock', async () => {
    const conn = await t.pool.getConnection();
    try {
      await conn.query("SELECT GET_LOCK('radar_register_nl_ind', 0)");
      const r = await refreshRegister(t.db, 'nl_ind', opts(realRegisterRoutes(), T0));
      expect(r).toMatchObject({ status: 'skipped', reason: 'another import of this register is running' });
      expect(await rows('nl_ind')).toHaveLength(0);
    } finally {
      await conn.query("SELECT RELEASE_LOCK('radar_register_nl_ind')");
      conn.release();
    }
    expect((await refreshRegister(t.db, 'nl_ind', opts(realRegisterRoutes(), T0))).status).toBe('imported');
  });

  it('only / unknown keys', async () => {
    const r = await refreshRegisters(t.db, opts(realRegisterRoutes(), T0, { only: ['dk_siri', 'nope' as RegisterKey] }));
    expect(r.map((x) => x.key)).toEqual(['dk_siri']);
  });
});

describe('importSnapshot', () => {
  const def = { ...REGISTERS.nl_ind, minEntries: 1 };
  const entry = (orgName: string, kvk: string, route = 'Work and highly skilled migrant'): RegisterEntryInput => ({ orgName, town: null, route, rating: null, raw: { organisation: orgName, kvk } });

  it('refreshes derived columns in place when the raw row is the same (mapping / normaliser change)', async () => {
    const files = [{ url: NL_IND_URL, bytes: 1, sha256: 'a' }];
    await importSnapshot(t.db, def, { publishedAt: null, files, entries: [entry('Adyen N.V.', '34259528'), entry('Mollie B.V.', '30204462')] }, { version: '2026-09-30', now: T0, lastSuccess: null });
    const before = await rows('nl_ind');
    const out = await importSnapshot(
      t.db,
      def,
      { publishedAt: null, files: [{ ...files[0], sha256: 'b' }], entries: [entry('Adyen N.V.', '34259528', 'Highly skilled migrant'), entry('Mollie B.V.', '30204462')] },
      { version: '2026-10-01', now: hours(24), lastSuccess: null },
    );
    expect(out).toMatchObject({ status: 'imported', rows: 2, kept: 2, inserted: 0, removed: 0 });
    const after = await rows('nl_ind');
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after.map((r) => [r.orgName, r.route, r.version])).toEqual([
      ['Adyen N.V.', 'Highly skilled migrant', '2026-10-01'],
      ['Mollie B.V.', 'Work and highly skilled migrant', '2026-10-01'],
    ]);
  });

  it('skips rows without a usable name and counts duplicates', async () => {
    const out = await importSnapshot(
      t.db,
      def,
      { publishedAt: null, files: [], entries: [entry('  ', '1'), entry('-', '2'), entry('GitHub B.V.', '61237523'), entry('GitHub B.V.', '61237523')] },
      { version: '2026-09-30', now: T0, lastSuccess: null },
    );
    expect(out).toMatchObject({ rows: 1, skippedRows: 2, duplicates: 1, inserted: 1 });
    expect(prepareEntry(entry('Ørsted A/S', '1'))?.normalizedName).toBeTruthy();
    expect(prepareEntry({ orgName: 'x'.repeat(600), town: ' ', route: null, rating: null, raw: {} })?.orgName).toHaveLength(512);
  });

  it('handles more rows than one batch', async () => {
    const many = Array.from({ length: 2345 }, (_, i) => entry(`Company ${i} B.V.`, String(10_000_000 + i)));
    const out = await importSnapshot(t.db, def, { publishedAt: null, files: [], entries: many }, { version: '2026-09-30', now: T0, lastSuccess: null });
    expect(out).toMatchObject({ rows: 2345, inserted: 2345 });
    const again = await importSnapshot(t.db, def, { publishedAt: null, files: [], entries: many.slice(0, 2000) }, { version: '2026-10-01', now: hours(24), lastSuccess: null });
    expect(again).toMatchObject({ rows: 2000, kept: 2000, inserted: 0, removed: 345 });
  });
});

describe('getRegisterStatus', () => {
  it('one line per register with counts, versions, last error and staleness', async () => {
    await refreshRegister(t.db, 'uk_home_office', opts(realRegisterRoutes(), T0));
    await refreshRegister(t.db, 'nl_ind', opts(realRegisterRoutes(), T0));
    await refreshRegister(t.db, 'nl_ind', opts({ [NL_IND_URL]: { status: 500 } }, hours(24)));
    const s = await getRegisterStatus(t.db, hours(26));
    expect(s.map((x) => x.key)).toEqual([...REGISTER_KEYS]);
    expect(s[0]).toMatchObject({ key: 'uk_home_office', countryIso2: 'GB', evidenceKind: 'licensed_sponsor', entries: 42, version: '2026-09-30', publishedAt: '2026-09-29', lastAttemptStatus: 'imported', lastError: null, stale: false });
    expect(s[0].lastCheckedAt?.toISOString()).toBe(T0.toISOString());
    expect(s[1]).toMatchObject({ key: 'nl_ind', entries: 27, lastAttemptStatus: 'failed', lastError: `HTTP 500 for ${NL_IND_URL}`, stale: false });
    expect(s[2]).toMatchObject({ key: 'dk_siri', entries: 0, version: null, lastCheckedAt: null, lastAttemptStatus: null, stale: true });
    const later = await getRegisterStatus(t.db, hours(24 * 46));
    expect(later[0].stale).toBe(true);
  });
});
