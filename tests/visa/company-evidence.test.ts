/**
 * Company ↔ sponsor-register matching (spec §13.2 / §11.2): exact name + country agreement →
 * confirmed; qualifier, legal-name, spacing, fuzzy (≥ 0.9) and parent / subsidiary matches →
 * "Possible match — verify"; people's decisions survive re-runs. The DB tests import the trimmed
 * real register fixtures (no network).
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, companies, companyAliases, companyEvidence, jobs } from '../../src/db/schema';
import { normalizeCompanyName } from '../../src/lib/company/normalize';
import type { DbOrTx } from '../../src/lib/db';
import { sha256Hex } from '../../src/lib/hash';
import { refreshRegister, refreshRegisters, REGISTERS, type RefreshRegistersOptions } from '../../src/lib/registers';
import {
  companyNameSimilarity,
  groupEntries,
  legalNameStem,
  manualStatusOf,
  matchAllCompaniesToRegisters,
  matchCompanyToRegisters,
  matchNameForms,
  MAX_POSSIBLE_PER_REGISTER,
  nameForm,
  planGroupMatch,
  planRegisterMatches,
  reconcileRegisterMatches,
  refreshRegistersAndEvidence,
  REGISTER_MATCH_AUDIT_ACTION,
  REGISTER_MATCH_LOGIC_VERSION,
  registerEvidenceText,
  sameCompanyWord,
  sponsorSummary,
  type CompanyMatchContext,
  type CompanyNameForm,
  type CountrySource,
  type EntryGroup,
  type PlannedMatch,
  type RegisterEntryLite,
  type RegisterMatchRecord,
  type StoredMatchRow,
} from '../../src/lib/visa/company-evidence';
import { decideVisaStatus } from '../../src/lib/visa/decide';
import { loadVisaDecisionInput } from '../../src/lib/visa/persist';
import { parseRegisterMatch } from '../../src/lib/visa/types';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry } from '../helpers/fixtures';
import { fakeFetch, fixtureText, realRegisterRoutes, UK_CSV_URL } from './register-fixtures';

const T0 = new Date('2026-09-30T06:00:00Z');
const hours = (h: number) => new Date(T0.getTime() + h * 3_600_000);
const SMALL: RefreshRegistersOptions['minEntries'] = { uk_home_office: 5, nl_ind: 5, dk_siri: 5, ie_dete: 5, ca_lmia: 5 };
const UK = REGISTERS.uk_home_office;

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────

function ctx(names: { name: string; family?: boolean; companyId?: number }[], countries: Record<string, CountrySource[]> = {}, isAgency = false): CompanyMatchContext {
  return {
    companyId: 1,
    isAgency,
    names: names.map((n): CompanyNameForm => ({ ...nameForm(n.name), companyId: n.companyId ?? 1, family: n.family ?? false })),
    countries: new Map(Object.entries(countries)),
  };
}

let nextId = 1;
function entry(orgName: string, over: Partial<RegisterEntryLite> = {}): RegisterEntryLite {
  return {
    id: nextId++,
    registerKey: 'uk_home_office',
    countryIso2: 'GB',
    orgName,
    normalizedName: normalizeCompanyName(orgName),
    town: 'London',
    route: 'Skilled Worker',
    rating: 'A rating',
    registerVersion: '2026-09-30',
    ...over,
  };
}

function group(...entries: RegisterEntryLite[]): EntryGroup {
  const [g] = groupEntries(entries);
  return g;
}

function plan(c: CompanyMatchContext, g: EntryGroup): PlannedMatch {
  const p = planGroupMatch(c, UK, g);
  if (!p) throw new Error(`no match for ${g.entryKey}`);
  return p;
}

describe('sameCompanyWord / companyNameSimilarity', () => {
  it('accepts word forms and one typo in long words, never a different word', () => {
    expect(sameCompanyWord('systems', 'systems')).toBe(2);
    expect(sameCompanyWord('system', 'systems')).toBe(1);
    expect(sameCompanyWord('technology', 'technologies')).toBe(1);
    expect(sameCompanyWord('cloudfare', 'cloudflare')).toBe(1);
    expect(sameCompanyWord('revolut', 'revolution')).toBe(0);
    expect(sameCompanyWord('arm', 'arms')).toBe(0);
    expect(sameCompanyWord('15243921', '15243922')).toBe(0);
    expect(sameCompanyWord('monzo', 'monza')).toBe(0);
  });

  it('scores names word by word', () => {
    expect(companyNameSimilarity('revolut', 'revolut')).toBe(1);
    expect(companyNameSimilarity('mastercard ireland', 'master card ireland')).toBe(0.97);
    expect(companyNameSimilarity('revolut', 'revolution clothing')).toBe(0);
    expect(companyNameSimilarity('picnic technology', 'picnic technologies')).toBe(0.95);
    expect(companyNameSimilarity('15243921 canada', '15243922 canada')).toBe(0.5);
    expect(companyNameSimilarity('okta', 'okta construction')).toBe(0);
    expect(companyNameSimilarity('', 'x')).toBe(0);
  });
});

describe('legalNameStem', () => {
  it.each([
    ['Monzo Bank Ltd', 'monzo'],
    ['Microsoft Ireland Operations Limited', 'microsoft'],
    ['Amazon Development Centre Canada ULC', 'amazon'],
    ['Meta Platforms Ireland Limited', 'meta'],
    ['Maersk Logistics & Services Denmark A/S', 'maersk'],
    ['Intercom R&D Unlimited Company', 'intercom'],
    ['Palantir Technologies UK Limited', 'palantir'],
    ['Okta Construction Limited', 'okta construction'],
    ['Institute of Technology', 'institute of technology'],
    ['Novo Nordisk A/S', 'novo nordisk'],
  ])('%s → %s', (name, stem) => {
    expect(legalNameStem(name)).toBe(stem);
  });

  it('is null when only generic words are left', () => {
    expect(legalNameStem('Global Services Ltd')).toBeNull();
    expect(legalNameStem('Data Solutions Limited')).toBeNull();
    expect(legalNameStem('')).toBeNull();
  });
});

describe('matchNameForms', () => {
  const m = (a: string, b: string) => matchNameForms(nameForm(a), nameForm(b));
  it('names the basis of each match', () => {
    expect(m('Revolut', 'Revolut Ltd')).toEqual({ basis: 'exact', similarity: 1 });
    expect(m('Kühne + Nagel', 'Kuehne & Nagel Ltd')).toEqual({ basis: 'exact', similarity: 1 });
    expect(m('Master Card', 'MasterCard Limited')).toEqual({ basis: 'spacing', similarity: 0.97 });
    expect(m('Okta', 'Okta UK Ltd')).toEqual({ basis: 'brand', similarity: 0.95 });
    expect(m('Mastercard', 'Master Card Ireland Limited')).toEqual({ basis: 'brand', similarity: 0.95 });
    expect(m('Datadog Ireland', 'Datadog Netherlands B.V.')).toEqual({ basis: 'brand', similarity: 0.95 });
    expect(m('Monzo', 'Monzo Bank Ltd')).toEqual({ basis: 'legal_name', similarity: 0.9 });
    expect(m('Arm Holdings', 'Arm Limited')).toEqual({ basis: 'legal_name', similarity: 0.9 });
    expect(m('Cloudfare', 'Cloudflare Limited')).toEqual({ basis: 'fuzzy', similarity: 0.9 });
  });

  it('does not match different companies that share letters or a first word', () => {
    expect(m('Revolut', 'REVOLUTION CLOTHING COMPANY LIMITED')).toBeNull();
    expect(m('Okta', 'OKTA CONSTRUCTION LIMITED')).toBeNull();
    expect(m('Uber', 'uberall B.V.')).toBeNull();
    expect(m('Elastic', 'Elasticsearch Limited')).toBeNull();
    expect(m('15243921 Canada Inc.', '15243922 CANADA INC.')).toBeNull();
    expect(m('Global Services', 'Global Services Group Ltd')).toBeNull();
    // A consultancy named after the same word is usually another firm (live UK register: "STRIPE CONSULTING LIMITED").
    expect(m('Stripe Payments Europe', 'STRIPE CONSULTING LIMITED')).toBeNull();
    expect(m('Stripe Payments Europe', 'Stripe Technology Europe Limited')).toEqual({ basis: 'legal_name', similarity: 0.9 });
  });
});

describe('planGroupMatch / planRegisterMatches', () => {
  it('confirms only an exact own-name match in a country the company is known in', () => {
    const monzo = group(entry('Monzo Bank Ltd'), entry('Monzo Bank Ltd', { route: 'Global Business Mobility: Senior or Specialist Worker' }));
    const confirmed = plan(ctx([{ name: 'Monzo Bank' }], { GB: ['jobs'] }), monzo);
    expect(confirmed.value).toMatchObject({
      autoStatus: 'confirmed',
      basis: 'exact',
      matchType: 'exact',
      countryAgrees: true,
      countrySources: ['jobs'],
      route: 'Skilled Worker; Global Business Mobility: Senior or Specialist Worker',
      town: 'London',
      entryCount: 2,
      entryKey: 'monzo bank',
      evidenceKind: 'licensed_sponsor',
    });
    expect(confirmed.value.entryIds).toEqual(monzo.entries.map((e) => e.id));
    expect(confirmed.registerEntryId).toBe(monzo.entries[0].id);
    expect(confirmed.confirmedConfidence).toBe('high');
    // The value is also a valid RegisterMatchValue for the visa engine.
    expect(parseRegisterMatch(confirmed.value)).toMatchObject({ registerKey: 'uk_home_office', countryIso2: 'GB', matchType: 'exact', similarity: 1 });

    const noCountry = plan(ctx([{ name: 'Monzo Bank' }], { DE: ['hq'] }), monzo);
    expect(noCountry.value).toMatchObject({ autoStatus: 'possible', countryAgrees: false, countrySources: [] });
    expect(noCountry.possibleConfidence).toBe('medium');

    const agency = plan(ctx([{ name: 'Monzo Bank' }], { GB: ['hq'] }, true), monzo);
    expect(agency.value.autoStatus).toBe('possible');
    expect(agency.isAgency).toBe(true);

    const brand = plan(ctx([{ name: 'Monzo' }], { GB: ['hq'] }), monzo);
    expect(brand.value).toMatchObject({ autoStatus: 'possible', basis: 'legal_name', matchType: 'similar', similarity: 0.9 });
    expect(brand.possibleConfidence).toBe('low');
  });

  it('matches a family member only as possible, and prefers the company’s own names', () => {
    const stripe = group(entry('Stripe Payments Europe Limited', { registerKey: 'ie_dete', countryIso2: 'IE', rating: null }));
    const c = ctx([{ name: 'Paystack' }, { name: 'Stripe', family: true, companyId: 7 }], { IE: ['jobs'] });
    const p = planGroupMatch(c, REGISTERS.ie_dete, stripe)!;
    expect(p.value).toMatchObject({ autoStatus: 'possible', matchType: 'parent', matchedName: 'Stripe', matchedCompanyId: 7, basis: 'legal_name' });
    expect(p.possibleConfidence).toBe('low');
    // An exact family-name match is still only possible.
    const exactFamily = planGroupMatch(ctx([{ name: 'Paystack' }, { name: 'Stripe Payments Europe', family: true }], { IE: ['jobs'] }), REGISTERS.ie_dete, stripe)!;
    expect(exactFamily.value).toMatchObject({ autoStatus: 'possible', matchType: 'parent', basis: 'exact' });
    // Own names win.
    const own = planGroupMatch(ctx([{ name: 'Stripe Payments Europe' }, { name: 'Stripe', family: true }], { IE: ['hq'] }), REGISTERS.ie_dete, stripe)!;
    expect(own.value).toMatchObject({ autoStatus: 'confirmed', matchType: 'exact', countrySources: ['hq'] });
    expect(own.confirmedConfidence).toBe('medium');
    // Family names never count for fuzzy matches.
    expect(planGroupMatch(ctx([{ name: 'Paystack' }, { name: 'Cloudfare', family: true }]), UK, group(entry('Cloudflare Limited')))).toBeNull();
  });

  it('a B-rated or provisional licence is medium even when confirmed', () => {
    const c = ctx([{ name: 'Akaal Transport' }, { name: '3DCP Academy' }], { GB: ['jobs'] });
    expect(plan(c, group(entry('Akaal Transport Ltd', { rating: 'B rating' }))).confirmedConfidence).toBe('medium');
    expect(plan(c, group(entry('3DCP ACADEMY LIMITED', { rating: 'Provisional' }))).confirmedConfidence).toBe('medium');
    const mixed = group(entry('Akaal Transport Ltd', { rating: 'B rating' }), entry('Akaal Transport Ltd', { rating: 'A rating', route: 'Scale-up' }));
    expect(plan(c, mixed).confirmedConfidence).toBe('high');
  });

  it('keeps every confirmed match and the best possible ones per register', () => {
    const c = ctx([{ name: 'Apex' }], { GB: ['hq'] });
    const groups = groupEntries([
      entry('Apex Ltd'),
      ...Array.from({ length: MAX_POSSIBLE_PER_REGISTER + 3 }, (_, i) => entry(`Apex UK ${String.fromCharCode(97 + i)}xy Ltd`)),
      ...Array.from({ length: MAX_POSSIBLE_PER_REGISTER + 1 }, (_, i) => entry(`Apex ${['Holdings', 'Group', 'Services', 'Solutions', 'Systems', 'Labs', 'Digital', 'Media', 'Tech', 'Software', 'Studios'][i]} Ltd`)),
      entry('Apex Holding B.V.', { registerKey: 'nl_ind', countryIso2: 'NL' }),
    ]);
    const planned = planRegisterMatches(c, groups);
    const uk = planned.filter((p) => p.value.registerKey === 'uk_home_office');
    expect(uk.filter((p) => p.value.autoStatus === 'confirmed').map((p) => p.value.orgName)).toEqual(['Apex Ltd']);
    expect(uk.filter((p) => p.value.autoStatus === 'possible')).toHaveLength(MAX_POSSIBLE_PER_REGISTER);
    // Legal-name matches are stronger than word-by-word ones, so they fill the cap.
    expect(uk.filter((p) => p.value.autoStatus === 'possible').every((p) => p.value.basis === 'legal_name')).toBe(true);
    expect(planned.filter((p) => p.value.registerKey === 'nl_ind')).toHaveLength(1);
    // A match a person decided on is never cut.
    const kept = planRegisterMatches(c, groups, new Set(['uk_home_office|apex studios']));
    expect(kept.some((p) => p.key === 'uk_home_office|apex studios')).toBe(true);
    expect(kept.filter((p) => p.value.registerKey === 'uk_home_office' && p.value.autoStatus === 'possible')).toHaveLength(MAX_POSSIBLE_PER_REGISTER + 1);
  });
});

describe('registerEvidenceText', () => {
  const base = (over: Partial<RegisterMatchRecord> = {}): RegisterMatchRecord => ({
    ...plan(ctx([{ name: 'Monzo Bank' }], { GB: ['hq', 'jobs'] }), group(entry('Monzo Bank Ltd'))).value,
    ...over,
  });

  it('says what the register lists and how the name matched', () => {
    expect(registerEvidenceText(base(), 'confirmed')).toBe(
      'Register match: "Monzo Bank Ltd" (London; Skilled Worker; A rating) on the UK Home Office register of licensed sponsors (workers), version 2026-09-30 — the same name as "Monzo Bank"; GB agrees with its HQ, its jobs there.',
    );
    expect(registerEvidenceText(base({ countryAgrees: false, countrySources: [] }), 'possible')).toMatch(/^Possible match — verify: .* no known presence of the company in GB\.$/);
    expect(registerEvidenceText(base({ manualStatus: 'confirmed' }), 'confirmed')).toMatch(/^Register match \(confirmed by hand\): /);
    expect(registerEvidenceText(base({ manualStatus: 'rejected' }), 'rejected')).toMatch(/^Rejected register match: /);
    expect(registerEvidenceText(base({ basis: 'fuzzy', similarity: 0.93, matchType: 'similar' }), 'possible')).toContain('a name 93% similar to "Monzo Bank"');
    expect(registerEvidenceText(base({ matchType: 'parent', basis: 'legal_name' }), 'possible')).toContain('a related company (parent, subsidiary or sister company)');
  });

  it('explains B ratings, provisional licences, history registers and agencies', () => {
    expect(registerEvidenceText(base({ rating: 'B rating' }), 'confirmed')).toContain('cannot assign new certificates of sponsorship until it is A-rated again');
    expect(registerEvidenceText(base({ rating: 'A rating; B rating' }), 'confirmed')).toContain('B rating:');
    expect(registerEvidenceText(base({ rating: 'Provisional' }), 'confirmed')).toContain('UK Expansion Worker licence');
    expect(registerEvidenceText(base({ evidenceKind: 'sponsorship_history' }), 'confirmed')).toContain('past permits (sponsorship history), not a current offer');
    expect(registerEvidenceText(base(), 'possible', true)).toContain('recruitment agency');
    expect(registerEvidenceText(base({ entryCount: 3 }), 'confirmed')).toContain('3 register rows.');
  });
});

describe('reconcileRegisterMatches', () => {
  const c = ctx([{ name: 'Monzo' }, { name: 'Revolut' }], { GB: ['hq'] });
  const monzo = plan(c, group(entry('Monzo Bank Ltd')));
  const revolut = plan(c, group(entry('Revolut Ltd')));
  let id = 100;
  const storedFrom = (p: PlannedMatch, over: Partial<StoredMatchRow> = {}): StoredMatchRow => {
    const first = reconcileRegisterMatches([], [p]).insert[0];
    return { id: id++, ...first, ...over };
  };

  it('inserts new matches and leaves identical rows alone', () => {
    const fresh = reconcileRegisterMatches([], [monzo, revolut]);
    expect(fresh.insert.map((w) => [w.matchStatus, w.confidence, w.source, w.logicVersion])).toEqual([
      ['possible', 'low', 'uk_home_office@2026-09-30', REGISTER_MATCH_LOGIC_VERSION],
      ['confirmed', 'high', 'uk_home_office@2026-09-30', REGISTER_MATCH_LOGIC_VERSION],
    ]);
    const again = reconcileRegisterMatches([storedFrom(monzo), storedFrom(revolut)], [monzo, revolut]);
    expect(again).toMatchObject({ insert: [], update: [], remove: [] });
    expect(again.unchanged).toHaveLength(2);
  });

  it('keeps a person’s decision and never re-creates a rejected match', () => {
    const rejected = storedFrom(monzo, { matchStatus: 'rejected' });
    expect(manualStatusOf(rejected)).toBe('rejected');
    const r = reconcileRegisterMatches([rejected], [monzo]);
    expect(r.insert).toEqual([]);
    expect(r.update).toHaveLength(1);
    expect(r.update[0]).toMatchObject({ id: rejected.id, material: false, row: { matchStatus: 'rejected', valueJson: { manualStatus: 'rejected', autoStatus: 'possible' } } });
    expect(r.update[0].row.evidence).toMatch(/^Rejected register match/);
    // Once recorded, the decision is stable: the next run changes nothing.
    const settled = reconcileRegisterMatches([{ ...rejected, ...r.update[0].row }], [monzo]);
    expect(settled.update).toEqual([]);
    // A rejected match whose register row is gone is kept (the rejection still applies later).
    const gone = reconcileRegisterMatches([{ ...rejected, ...r.update[0].row }], []);
    expect(gone.remove).toEqual([]);
    expect(gone.final).toEqual([{ key: monzo.key, status: 'rejected', value: null }]);

    const confirmedByHand = storedFrom(monzo, { matchStatus: 'confirmed' });
    expect(manualStatusOf(confirmedByHand)).toBe('confirmed');
    const k = reconcileRegisterMatches([confirmedByHand], [monzo]);
    expect(k.update[0]).toMatchObject({ material: true, row: { matchStatus: 'confirmed', confidence: 'high', valueJson: { manualStatus: 'confirmed' } } });
    // Later changed back by hand: that is the new decision.
    const backToPossible = { ...confirmedByHand, ...k.update[0].row, matchStatus: 'possible' as const };
    expect(manualStatusOf(backToPossible)).toBe('possible');
  });

  it('removes automatic matches that no longer match and duplicate rows', () => {
    const a = storedFrom(revolut);
    const dup = storedFrom(revolut);
    const legacy = storedFrom(monzo, { valueJson: { registerKey: 'uk_home_office', orgName: 'Monzo Bank Ltd' } });
    const foreign = storedFrom(monzo, { logicVersion: 'manual-entry' });
    const broken = storedFrom(monzo, { valueJson: 'not an object' });
    const r = reconcileRegisterMatches([a, dup, legacy, foreign, broken], [revolut]);
    expect(r.remove).toEqual(
      expect.arrayContaining([
        { id: dup.id, material: false },
        { id: legacy.id, material: true },
        { id: broken.id, material: true },
      ]),
    );
    expect(r.remove).toHaveLength(3);
    expect(r.unchanged).toEqual([a.id]);
    // The duplicate a person decided on wins over the automatic one.
    const decided = storedFrom(revolut, { matchStatus: 'rejected' });
    const d = reconcileRegisterMatches([a, decided], [revolut]);
    expect(d.remove).toEqual([{ id: a.id, material: false }]);
    expect(d.update[0].id).toBe(decided.id);
  });

  it('marks status and confidence changes as material, text-only changes not', () => {
    const stored = storedFrom(revolut);
    const moved = plan(c, group(entry('Revolut Ltd', { registerVersion: '2026-10-01' })));
    const r = reconcileRegisterMatches([stored], [moved]);
    expect(r.update).toHaveLength(1);
    expect(r.update[0].material).toBe(false);
    expect(r.update[0].row.source).toBe('uk_home_office@2026-10-01');
    const downgraded = plan(c, group(entry('Revolut Ltd', { rating: 'B rating' })));
    expect(reconcileRegisterMatches([stored], [downgraded]).update[0].material).toBe(true);
  });
});

describe('sponsorSummary', () => {
  it('summarises confirmed sponsors, history and possible matches', () => {
    const c = ctx([{ name: 'Monzo Bank' }, { name: 'Stripe Payments Europe' }, { name: 'Okta' }], { GB: ['hq'], IE: ['jobs'] });
    const ie = planGroupMatch(c, REGISTERS.ie_dete, group(entry('Stripe Payments Europe Limited', { registerKey: 'ie_dete', countryIso2: 'IE' })))!;
    const r = reconcileRegisterMatches([], [plan(c, group(entry('Monzo Bank Ltd'))), ie, plan(c, group(entry('Okta UK Ltd')))]);
    const s = sponsorSummary(r.final, T0);
    expect(s).toMatchObject({ status: 'confirmed', sponsorCountries: ['GB'], historyCountries: ['IE'], possibleMatches: 1, at: T0.toISOString(), logicVersion: REGISTER_MATCH_LOGIC_VERSION });
    expect(s.registers.map((x) => [x.registerKey, x.orgName, x.matchStatus])).toEqual([
      ['ie_dete', 'Stripe Payments Europe Limited', 'confirmed'],
      ['uk_home_office', 'Monzo Bank Ltd', 'confirmed'],
      ['uk_home_office', 'Okta UK Ltd', 'possible'],
    ]);
    expect(sponsorSummary(r.final.filter((f) => f.value?.registerKey === 'ie_dete'), T0).status).toBe('likely');
    expect(sponsorSummary(r.final.filter((f) => f.value?.orgName === 'Okta UK Ltd'), T0).status).toBe('possible');
    expect(sponsorSummary([{ key: 'x', status: 'rejected', value: null }], T0)).toMatchObject({ status: 'unknown', registers: [], possibleMatches: 0 });
  });
});

// ── DB ──────────────────────────────────────────────────────────────────────────────────────

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);
afterAll(async () => {
  await t?.stop();
});

async function importRegisters(now = T0, routes = realRegisterRoutes()) {
  const r = await refreshRegisters(t.db, { fetch: fakeFetch(routes), now, minEntries: SMALL, force: true });
  expect(r.every((x) => x.status === 'imported' || x.status === 'unchanged')).toBe(true);
}

async function addCompany(name: string, o: { hq?: string; agency?: boolean; parent?: number; mergedInto?: number } = {}): Promise<number> {
  const [r] = await t.db.insert(companies).values({
    name,
    normalizedName: normalizeCompanyName(name),
    hqCountry: o.hq ?? null,
    isAgency: o.agency ?? false,
    parentCompanyId: o.parent ?? null,
    mergedIntoId: o.mergedInto ?? null,
  });
  return Number(r.insertId);
}

let jobSeq = 0;
async function addJob(db: DbOrTx, companyId: number, countryIso2: string): Promise<number> {
  await seedCountry(db, countryIso2);
  const url = `https://boards.example.test/jobs/${++jobSeq}`;
  const text = `Backend engineer ${jobSeq}`;
  const [r] = await db.insert(jobs).values({
    companyId,
    canonicalTitle: 'Backend Engineer',
    titleRaw: 'Backend Engineer',
    countryIso2,
    locationRaw: countryIso2,
    descriptionText: text,
    descriptionHash: sha256Hex(text),
    applyUrl: url,
    applyUrlClean: url,
    applyUrlHash: sha256Hex(url),
  });
  return Number(r.insertId);
}

async function evidenceOf(companyId: number) {
  return t.db
    .select()
    .from(companyEvidence)
    .where(and(eq(companyEvidence.companyId, companyId), eq(companyEvidence.kind, 'register_match')))
    .orderBy(asc(companyEvidence.id));
}

function valueOf(row: { valueJson: unknown }): RegisterMatchRecord {
  return row.valueJson as RegisterMatchRecord;
}

describe('matchCompanyToRegisters', () => {
  beforeEach(async () => {
    await t.truncateAll();
    await importRegisters();
  });

  it('confirms an exact name in a country the company hires in, as one row per organisation', async () => {
    const id = await addCompany('Monzo Bank', { hq: 'GB' });
    const jobId = await addJob(t.db, id, 'GB');
    const r = await matchCompanyToRegisters(t.db, id, { now: T0 });
    expect(r).toMatchObject({ companyId: id, confirmed: 1, possible: 0, inserted: 1, updated: 0, removed: 0, changed: true, skipped: null });
    const [row] = await evidenceOf(id);
    expect(row).toMatchObject({ kind: 'register_match', method: 'official', confidence: 'high', matchStatus: 'confirmed', source: 'uk_home_office@2026-09-30', logicVersion: REGISTER_MATCH_LOGIC_VERSION });
    expect(row.checkedAt.toISOString()).toBe(T0.toISOString());
    const v = valueOf(row);
    expect(v).toMatchObject({
      registerKey: 'uk_home_office',
      registerName: UK.name,
      orgName: 'Monzo Bank Ltd',
      town: 'London',
      route: 'Skilled Worker; Global Business Mobility: Senior or Specialist Worker',
      rating: 'A rating',
      registerVersion: '2026-09-30',
      entryCount: 2,
      countrySources: ['hq', 'jobs'],
      basis: 'exact',
    });
    expect(row.registerEntryId).toBe(v.entryIds[0]);
    expect(row.evidence).toBe(
      `Register match: "Monzo Bank Ltd" (London; Skilled Worker; Global Business Mobility: Senior or Specialist Worker; A rating) on the ${UK.name}, version 2026-09-30 — the same name as "Monzo Bank"; GB agrees with its HQ, its jobs there. 2 register rows.`,
    );

    // The visa engine reads it as confirmed official evidence, and the job verdict was re-decided.
    const decision = decideVisaStatus((await loadVisaDecisionInput(t.db, jobId, T0))!);
    expect(decision).toMatchObject({ method: 'official', value: { status: 'confirmed' } });
    const [j] = await t.db.select({ visa: jobs.visaStatus }).from(jobs).where(eq(jobs.id, jobId));
    expect(j.visa).toBe('confirmed');

    const [c] = await t.db.select({ s: companies.sponsorSummaryJson }).from(companies).where(eq(companies.id, id));
    expect(c.s).toMatchObject({ status: 'confirmed', sponsorCountries: ['GB'], historyCountries: [], possibleMatches: 0, at: T0.toISOString() });

    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, REGISTER_MATCH_AUDIT_ACTION));
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor: 'worker', entityType: 'company', entityId: String(id) });
    expect(audits[0].afterJson).toMatchObject({ confirmed: ['uk_home_office: Monzo Bank Ltd'], possible: [] });
    expect(audits[0].reason).toBe('Sponsor register matches: 1 confirmed, 0 possible (1 new, 0 updated, 0 removed)');
  });

  it('is idempotent', async () => {
    const id = await addCompany('Revolut', { hq: 'GB' });
    await matchCompanyToRegisters(t.db, id, { now: T0 });
    const before = await evidenceOf(id);
    const again = await matchCompanyToRegisters(t.db, id, { now: hours(1) });
    expect(again).toMatchObject({ inserted: 0, updated: 0, removed: 0, changed: false, confirmed: 1 });
    expect(await evidenceOf(id)).toEqual(before);
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, REGISTER_MATCH_AUDIT_ACTION))).toHaveLength(1);
  });

  it('without a known presence in the country an exact match is only possible', async () => {
    const id = await addCompany('Monzo Bank');
    const jobId = await addJob(t.db, id, 'IE');
    await matchCompanyToRegisters(t.db, id, { now: T0 });
    const [row] = await evidenceOf(id);
    expect(row).toMatchObject({ matchStatus: 'possible', confidence: 'medium' });
    expect(row.evidence).toMatch(/^Possible match — verify: .*no known presence of the company in GB/);
    const decision = decideVisaStatus((await loadVisaDecisionInput(t.db, jobId, T0))!);
    expect(decision.value.status).not.toBe('confirmed');
  });

  it('never matches a different company that shares the first letters or word', async () => {
    const revolut = await addCompany('Revolut', { hq: 'GB' });
    const okta = await addCompany('Okta', { hq: 'US' });
    await addJob(t.db, okta, 'GB');
    await matchCompanyToRegisters(t.db, revolut, { now: T0 });
    await matchCompanyToRegisters(t.db, okta, { now: T0 });
    expect((await evidenceOf(revolut)).map((r) => [valueOf(r).orgName, r.matchStatus, r.confidence])).toEqual([['Revolut Ltd', 'confirmed', 'high']]);
    expect((await evidenceOf(revolut))[0].valueJson).toMatchObject({ route: 'Skilled Worker; Scale-up; Global Business Mobility: Senior or Specialist Worker', entryCount: 3 });
    expect((await evidenceOf(okta)).map((r) => [valueOf(r).orgName, valueOf(r).basis, r.matchStatus, r.confidence])).toEqual([['Okta UK Ltd', 'brand', 'possible', 'low']]);
  });

  it('brand, legal-name and alias matches', async () => {
    const monzo = await addCompany('Monzo', { hq: 'GB' });
    await matchCompanyToRegisters(t.db, monzo, { now: T0 });
    expect((await evidenceOf(monzo)).map((r) => [valueOf(r).orgName, valueOf(r).basis, r.matchStatus])).toEqual([['Monzo Bank Ltd', 'legal_name', 'possible']]);

    const palantir = await addCompany('Palantir Technologies', { hq: 'US' });
    await t.db.insert(companyAliases).values({ companyId: palantir, alias: 'Palantir UK Limited', normalizedAlias: normalizeCompanyName('Palantir UK Limited'), kind: 'legal', countryIso2: 'GB' });
    await matchCompanyToRegisters(t.db, palantir, { now: T0 });
    const rows = await evidenceOf(palantir);
    expect(rows.map((r) => [valueOf(r).registerKey, valueOf(r).orgName, valueOf(r).basis, r.matchStatus, valueOf(r).matchedName])).toEqual(
      expect.arrayContaining([
        ['uk_home_office', 'Palantir UK Limited', 'exact', 'confirmed', 'Palantir UK Limited'],
        ['uk_home_office', 'Palantir Technologies UK Limited', 'brand', 'possible', 'Palantir Technologies'],
      ]),
    );
    expect(valueOf(rows.find((r) => valueOf(r).orgName === 'Palantir UK Limited')!).countrySources).toEqual(['alias']);

    // Spacing / capitalisation variants across years group into one IE row.
    const mc = await addCompany('Mastercard Ireland', { hq: 'IE' });
    await matchCompanyToRegisters(t.db, mc, { now: T0 });
    const [ie] = await evidenceOf(mc);
    expect(ie).toMatchObject({ matchStatus: 'confirmed', confidence: 'medium', source: 'ie_dete@2026-09-30' });
    expect(valueOf(ie)).toMatchObject({ orgName: 'Mastercard Ireland Limited', entryCount: 2, route: 'Employment permits 2026 (Jan–Aug); Employment permits 2025 (Jan–Dec)', evidenceKind: 'sponsorship_history' });
  });

  it('sponsorship-history registers confirm at medium and give a "likely" verdict', async () => {
    const stripe = await addCompany('Stripe Payments Europe', { hq: 'IE' });
    const ieJob = await addJob(t.db, stripe, 'IE');
    const shopify = await addCompany('Shopify', { hq: 'CA' });
    const caJob = await addJob(t.db, shopify, 'CA');
    await matchCompanyToRegisters(t.db, stripe, { now: T0 });
    await matchCompanyToRegisters(t.db, shopify, { now: T0 });
    const [ie] = await evidenceOf(stripe);
    expect(ie).toMatchObject({ matchStatus: 'confirmed', confidence: 'medium' });
    expect(ie.evidence).toContain('past permits (sponsorship history), not a current offer');
    const [ca] = await evidenceOf(shopify);
    expect(ca).toMatchObject({ matchStatus: 'confirmed', confidence: 'medium', source: 'ca_lmia@2026-09-30' });
    expect(valueOf(ca)).toMatchObject({ orgName: 'Shopify Inc.', town: 'Ottawa', route: 'High Wage stream, 2026 Q1', entryCount: 3 });
    for (const jobId of [ieJob, caJob]) {
      const d = decideVisaStatus((await loadVisaDecisionInput(t.db, jobId, T0))!);
      expect(d.value.status).toBe('likely');
      expect(d.value.reasons.join(' ')).toContain('Sponsorship history');
    }
    const [c] = await t.db.select({ s: companies.sponsorSummaryJson }).from(companies).where(eq(companies.id, shopify));
    expect(c.s).toMatchObject({ status: 'likely', sponsorCountries: [], historyCountries: ['CA'] });
  });

  it('B-rated and provisional sponsors are medium with an explanation', async () => {
    const akaal = await addCompany('Akaal Transport');
    await addJob(t.db, akaal, 'GB');
    const dcp = await addCompany('3DCP Academy');
    await addJob(t.db, dcp, 'GB');
    await matchCompanyToRegisters(t.db, akaal, { now: T0 });
    await matchCompanyToRegisters(t.db, dcp, { now: T0 });
    const [a] = await evidenceOf(akaal);
    expect(a).toMatchObject({ matchStatus: 'confirmed', confidence: 'medium' });
    expect(valueOf(a)).toMatchObject({ rating: 'B rating', town: 'Leicester, Leicestershire' });
    expect(a.evidence).toContain('cannot assign new certificates of sponsorship until it is A-rated again');
    const [d] = await evidenceOf(dcp);
    expect(d).toMatchObject({ matchStatus: 'confirmed', confidence: 'medium' });
    expect(d.evidence).toContain('UK Expansion Worker licence');
  });

  it('an agency is never confirmed', async () => {
    const id = await addCompany('Brooke Healthcare', { hq: 'GB', agency: true });
    await matchCompanyToRegisters(t.db, id, { now: T0 });
    const [row] = await evidenceOf(id);
    expect(row).toMatchObject({ matchStatus: 'possible', confidence: 'medium' });
    expect(row.evidence).toContain('recruitment agency');
  });

  it('a parent or subsidiary register entry is a possible match', async () => {
    const stripe = await addCompany('Stripe', { hq: 'US' });
    const paystack = await addCompany('Paystack', { hq: 'NG', parent: stripe });
    await addJob(t.db, paystack, 'IE');
    await matchCompanyToRegisters(t.db, paystack, { now: T0 });
    const rows = await evidenceOf(paystack);
    expect(rows.map((r) => [valueOf(r).orgName, valueOf(r).matchType, valueOf(r).matchedCompanyId, r.matchStatus, r.confidence])).toEqual([
      ['Stripe Payments Europe Limited', 'parent', stripe, 'possible', 'low'],
      ['Stripe Technology Company Limited', 'parent', stripe, 'possible', 'low'],
    ]);
    expect(rows[0].evidence).toContain('a related company (parent, subsidiary or sister company)');
    // The parent sees them as its own legal-name matches.
    await matchCompanyToRegisters(t.db, stripe, { now: T0 });
    expect((await evidenceOf(stripe)).map((r) => [valueOf(r).basis, valueOf(r).matchType])).toEqual([
      ['legal_name', 'similar'],
      ['legal_name', 'similar'],
    ]);
  });

  it('follows merges and uses the names of merged records', async () => {
    const keep = await addCompany('Monzo', { hq: 'GB' });
    const dropped = await addCompany('Monzo Bank', { mergedInto: keep });
    const r = await matchCompanyToRegisters(t.db, dropped, { now: T0 });
    expect(r.companyId).toBe(keep);
    expect(await evidenceOf(dropped)).toEqual([]);
    const rows = await evidenceOf(keep);
    expect(rows.map((x) => [valueOf(x).basis, valueOf(x).matchedName, valueOf(x).matchedCompanyId, x.matchStatus])).toEqual([['exact', 'Monzo Bank', dropped, 'confirmed']]);
    expect((await matchCompanyToRegisters(t.db, 999_999, { now: T0 })).skipped).toBe('company not found');
  });

  it('keeps people’s decisions and rows written by others across re-runs', async () => {
    const okta = await addCompany('Okta');
    const oktaJob = await addJob(t.db, okta, 'GB');
    const monzo = await addCompany('Monzo');
    const monzoJob = await addJob(t.db, monzo, 'GB');
    await matchCompanyToRegisters(t.db, okta, { now: T0 });
    await matchCompanyToRegisters(t.db, monzo, { now: T0 });
    const [o] = await evidenceOf(okta);
    const [m] = await evidenceOf(monzo);
    await t.db.update(companyEvidence).set({ matchStatus: 'rejected' }).where(eq(companyEvidence.id, o.id));
    await t.db.update(companyEvidence).set({ matchStatus: 'confirmed' }).where(eq(companyEvidence.id, m.id));
    const [other] = await t.db.insert(companyEvidence).values({
      companyId: okta,
      kind: 'register_match',
      valueJson: { registerKey: 'uk_home_office', countryIso2: 'GB', orgName: 'Okta Ltd', evidenceKind: 'licensed_sponsor', matchType: 'exact' },
      evidence: 'Entered by hand',
      source: 'manual',
      method: 'manual',
      confidence: 'medium',
      matchStatus: 'possible',
      checkedAt: T0,
      logicVersion: 'manual@1',
    });

    const r1 = await matchCompanyToRegisters(t.db, okta, { now: hours(1) });
    expect(r1).toMatchObject({ inserted: 0, removed: 0, rejected: 1, possible: 0 });
    const rows = await evidenceOf(okta);
    expect(rows.map((x) => x.id)).toEqual([o.id, Number(other.insertId)]);
    expect(rows[0]).toMatchObject({ matchStatus: 'rejected', valueJson: { manualStatus: 'rejected', autoStatus: 'possible' } });
    expect(rows[0].evidence).toMatch(/^Rejected register match/);
    expect(rows[1]).toMatchObject({ evidence: 'Entered by hand', logicVersion: 'manual@1' });
    const oktaDecision = decideVisaStatus((await loadVisaDecisionInput(t.db, oktaJob, hours(1)))!);
    expect(oktaDecision.value.reasons.join(' ')).not.toContain('Okta UK Ltd');

    const r2 = await matchCompanyToRegisters(t.db, monzo, { now: hours(1) });
    expect(r2).toMatchObject({ confirmed: 1, changed: true });
    const [m2] = await evidenceOf(monzo);
    expect(m2).toMatchObject({ id: m.id, matchStatus: 'confirmed', confidence: 'high', valueJson: { manualStatus: 'confirmed', autoStatus: 'possible' } });
    expect(m2.evidence).toMatch(/^Register match \(confirmed by hand\)/);
    const monzoDecision = decideVisaStatus((await loadVisaDecisionInput(t.db, monzoJob, hours(1)))!);
    expect(monzoDecision.value.status).toBe('confirmed');
    // Stable from then on.
    expect(await matchCompanyToRegisters(t.db, monzo, { now: hours(2) })).toMatchObject({ updated: 0, changed: false });
  });

  it('follows register changes: new download dates update rows, removed entries remove matches', async () => {
    const revolut = await addCompany('Revolut', { hq: 'GB' });
    const jobId = await addJob(t.db, revolut, 'GB');
    const monzo = await addCompany('Monzo Bank', { hq: 'GB' });
    await matchCompanyToRegisters(t.db, revolut, { now: T0 });
    await matchCompanyToRegisters(t.db, monzo, { now: T0 });

    const csv = fixtureText('uk-register.csv')
      .split(/\r?\n/)
      .filter((l) => !/^Revolut Ltd,/.test(l))
      .join('\r\n');
    const res = await refreshRegister(t.db, 'uk_home_office', { fetch: fakeFetch({ ...realRegisterRoutes(), [UK_CSV_URL]: csv }), now: hours(24), minEntries: SMALL });
    // Revolut Ltd is listed once per route (3 rows).
    expect(res).toMatchObject({ status: 'imported', removed: 3 });

    const gone = await matchCompanyToRegisters(t.db, revolut, { now: hours(24) });
    expect(gone).toMatchObject({ removed: 1, confirmed: 0, changed: true });
    expect(await evidenceOf(revolut)).toEqual([]);
    const [j] = await t.db.select({ visa: jobs.visaStatus }).from(jobs).where(eq(jobs.id, jobId));
    expect(j.visa).not.toBe('confirmed');
    const [c] = await t.db.select({ s: companies.sponsorSummaryJson }).from(companies).where(eq(companies.id, revolut));
    expect(c.s).toMatchObject({ status: 'unknown', registers: [] });

    const moved = await matchCompanyToRegisters(t.db, monzo, { now: hours(24) });
    expect(moved).toMatchObject({ updated: 1, changed: false });
    const [row] = await evidenceOf(monzo);
    expect(row).toMatchObject({ source: 'uk_home_office@2026-10-01', valueJson: { registerVersion: '2026-10-01' } });
    expect(row.evidence).toContain('version 2026-10-01');
    expect(row.checkedAt.toISOString()).toBe(hours(24).toISOString());
  });
});

describe('matchAllCompaniesToRegisters / refreshRegistersAndEvidence', () => {
  beforeEach(async () => {
    await t.truncateAll();
  });

  it('matches every surviving company in pages', async () => {
    await importRegisters();
    const ids = [await addCompany('Monzo Bank', { hq: 'GB' }), await addCompany('Okta', { hq: 'GB' }), await addCompany('Unrelated Widgets'), await addCompany('Novo Nordisk', { hq: 'DK' })];
    await addCompany('Revolut', { mergedInto: ids[2] });
    const r = await matchAllCompaniesToRegisters(t.db, { now: T0, batchSize: 2 });
    // Monzo Bank and Novo Nordisk confirmed; Okta UK Ltd and (via the merged record) Revolut Ltd possible.
    expect(r).toMatchObject({ companies: 4, changed: 4, failed: 0, confirmed: 2, possible: 2, inserted: 4 });
    // Revolut's name counts for the record it was merged into.
    expect((await evidenceOf(ids[2])).map((x) => [valueOf(x).orgName, x.matchStatus])).toEqual([['Revolut Ltd', 'possible']]);
    const again = await matchAllCompaniesToRegisters(t.db, { now: T0, batchSize: 3 });
    expect(again).toMatchObject({ companies: 4, changed: 0, inserted: 0, updated: 0, removed: 0 });
  });

  it('refreshes the registers, then the evidence (only when a register was checked)', async () => {
    const id = await addCompany('Novo Nordisk', { hq: 'DK' });
    const first = await refreshRegistersAndEvidence(t.db, { fetch: fakeFetch(realRegisterRoutes()), now: T0, minEntries: SMALL });
    expect(first.registers.map((x) => x.status)).toEqual(['imported', 'imported', 'imported', 'imported', 'imported']);
    expect(first.evidence).toMatchObject({ companies: 1, confirmed: 1, inserted: 1 });
    expect((await evidenceOf(id)).map((x) => [x.source, x.matchStatus, x.confidence])).toEqual([['dk_siri@2026-09-30', 'confirmed', 'high']]);

    const soon = await refreshRegistersAndEvidence(t.db, { fetch: fakeFetch(realRegisterRoutes()), now: hours(3), minEntries: SMALL });
    expect(soon.registers.every((x) => x.status === 'skipped')).toBe(true);
    expect(soon.evidence).toBeNull();

    const next = await refreshRegistersAndEvidence(t.db, { fetch: fakeFetch(realRegisterRoutes()), now: hours(24), minEntries: SMALL });
    expect(next.registers.every((x) => x.status === 'unchanged')).toBe(true);
    expect(next.evidence).toMatchObject({ companies: 1, updated: 1, changed: 0 });
    expect((await evidenceOf(id))[0].source).toBe('dk_siri@2026-10-01');
  });
});
