/**
 * The seed against a real (ephemeral) MySQL: idempotency and "owner changes always win".
 */
import { and, eq, like, sql } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  auditLog,
  companies,
  companyAliases,
  countries,
  officialPageWatches,
  resumeVersions,
  settings,
  sourcePlatforms,
  sources,
  templates,
  visaRoutes,
  visaRuleVersions,
} from '../../src/db/schema';
import { SEED_COMPANIES, companyBoardSlug } from '../../src/data/seed/companies';
import { SEED_COUNTRIES } from '../../src/data/seed/countries';
import { SEED_PLATFORMS, SEED_SOURCES } from '../../src/data/seed/sources';
import { SEED_RESUME_VERSIONS, SEED_TEMPLATES } from '../../src/data/seed/templates';
import { SEED_VISA_ROUTES, VISA_CHANGE_REASON } from '../../src/data/seed/visa';
import { VISA_UPDATE_REASON, isNoop, seedDatabase, seedWatchUrls, totalTally, type SeedSummary } from '../../src/db/seed';
import { normalizeAtsSlug } from '../../src/lib/company/normalize';
import { markRuleVerified } from '../../src/lib/visa/rules';
import { startTestDb, type TestDb } from '../helpers/db';

let t: TestDb;
const T0 = new Date('2026-09-30T08:00:00.000Z');
const T1 = new Date('2026-09-30T09:00:00.000Z');
const T2 = new Date('2026-09-30T10:00:00.000Z');

beforeAll(async () => {
  t = await startTestDb();
});
afterAll(async () => {
  await t?.stop();
});

async function count(table: MySqlTable): Promise<number> {
  const [row] = await t.db.select({ n: sql<number>`count(*)` }).from(table);
  return Number(row.n);
}

describe('seedDatabase — fresh database, run twice', () => {
  let first: SeedSummary;
  let second: SeedSummary;

  beforeAll(async () => {
    await t.truncateAll();
    first = await seedDatabase(t.db, { now: T0 });
    second = await seedDatabase(t.db, { now: T1 });
  });

  it('inserts every seed row on the first run', async () => {
    const s = first.sections;
    expect(s.countries.inserted).toBe(SEED_COUNTRIES.length);
    expect(s.visaRoutes.inserted).toBe(SEED_VISA_ROUTES.length);
    expect(s.visaRules.inserted).toBe(SEED_VISA_ROUTES.length);
    expect(s.platforms.inserted).toBe(SEED_PLATFORMS.length);
    expect(s.sources.inserted).toBe(SEED_SOURCES.length + SEED_COMPANIES.length);
    expect(s.companies.inserted).toBe(SEED_COMPANIES.length);
    expect(s.resumeVersions.inserted).toBe(SEED_RESUME_VERSIONS.length);
    expect(s.templates.inserted).toBe(SEED_TEMPLATES.length);
    const expectedWatches = seedWatchUrls(SEED_VISA_ROUTES.map((seed, i) => ({ seed, id: i + 1, isActive: seed.isActive }))).size;
    expect(s.pageWatches.inserted).toBe(expectedWatches);
    expect(totalTally(s).kept).toBe(0);
    expect(first.settingsCreated.length).toBeGreaterThan(0);

    expect(await count(countries)).toBe(SEED_COUNTRIES.length);
    expect(await count(visaRuleVersions)).toBe(SEED_VISA_ROUTES.length);
    expect(await count(officialPageWatches)).toBe(expectedWatches);
    expect(await count(sources)).toBe(SEED_SOURCES.length + SEED_COMPANIES.length);
    expect(await count(companies)).toBe(SEED_COMPANIES.length);
    expect(await count(templates)).toBe(SEED_TEMPLATES.length);
    expect(await count(settings)).toBe(first.settingsCreated.length);
  });

  it('changes nothing on the second run', async () => {
    expect(isNoop(second)).toBe(true);
    const total = totalTally(second.sections);
    expect(total).toMatchObject({ inserted: 0, updated: 0, kept: 0 });
    expect(total.unchanged).toBe(totalTally(first.sections).inserted);
    expect(second.settingsCreated).toEqual([]);
    expect(await count(visaRuleVersions)).toBe(SEED_VISA_ROUTES.length);
    expect(await count(companyAliases)).toBe(first.sections.companyAliases.inserted);
  });

  it('seeds rules unverified with the research change reason, platforms without an owner review', async () => {
    const rules = await t.db.select().from(visaRuleVersions);
    for (const r of rules) {
      expect(r.verificationStatus).toBe('unverified');
      expect(r.lastVerifiedAt).toBeNull();
      expect(r.verifiedBy).toBeNull();
      expect(r.changeReason).toBe(VISA_CHANGE_REASON);
      expect(r.version).toBe(1);
    }
    const platforms = await t.db.select().from(sourcePlatforms);
    for (const p of platforms) expect(p.termsReviewedAt).toBeNull();
    const srcs = await t.db.select().from(sources);
    for (const s of srcs) expect(s.status).toBe('trial');
    const live = await t.db.select().from(countries).where(eq(countries.isLive, true));
    expect(live).toEqual([]);
  });

  it('links each company board source to its company through an ats_slug alias', async () => {
    const c = SEED_COMPANIES[0];
    const slug = normalizeAtsSlug(companyBoardSlug(c), c.platform);
    const [alias] = await t.db.select().from(companyAliases).where(and(eq(companyAliases.kind, 'ats_slug'), eq(companyAliases.normalizedAlias, slug!)));
    expect(alias).toBeDefined();
    const linked = await t.db.select().from(sources).where(eq(sources.companyId, alias.companyId));
    expect(linked.length).toBeGreaterThanOrEqual(1);
  });

  it('records what it created (seed memory) without redacting the ref', async () => {
    const rows = await t.db.select().from(auditLog).where(eq(auditLog.action, 'seed.create'));
    expect(rows.length).toBe(SEED_VISA_ROUTES.length + SEED_RESUME_VERSIONS.length + SEED_TEMPLATES.length);
    for (const r of rows) expect(typeof (r.afterJson as { seed?: unknown }).seed).toBe('string');
    const runs = await t.db.select().from(auditLog).where(eq(auditLog.action, 'seed.run'));
    expect(runs.length).toBe(2);
  });
});

describe('seedDatabase — owner changes are never overwritten', () => {
  let after: SeedSummary;
  const editedTemplate = SEED_TEMPLATES.find((x) => x.kind === 'cover_letter' && x.countryIso2 === 'DE')!;
  const deletedTemplate = SEED_TEMPLATES.find((x) => x.kind === 'outreach')!;
  const staleTemplate = SEED_TEMPLATES.find((x) => x.kind === 'checklist')!;
  const editedResume = SEED_RESUME_VERSIONS[0];
  const verifiedRoute = SEED_VISA_ROUTES[0];
  const staleRuleRoute = SEED_VISA_ROUTES[1];
  const ownedSource = SEED_SOURCES[0];
  const reviewedPlatform = SEED_PLATFORMS[0];

  beforeAll(async () => {
    await t.truncateAll();
    await seedDatabase(t.db, { now: T0 });

    // 1. The owner edits a cover letter and a resume in the kit (updated_at moves on).
    await t.db.update(templates).set({ bodyMd: 'my own letter', updatedAt: T1 }).where(eq(templates.name, editedTemplate.name));
    await t.db.update(resumeVersions).set({ contentMd: 'my own CV', updatedAt: T1 }).where(eq(resumeVersions.name, editedResume.name));
    // 2. The owner deletes a starter.
    await t.db.delete(templates).where(eq(templates.name, deletedTemplate.name));
    // 3. An untouched starter whose seed text changed since (simulated: row holds older seed text).
    await t.db.update(templates).set({ bodyMd: 'older seed text', createdAt: T0, updatedAt: T0 }).where(eq(templates.name, staleTemplate.name));
    // 4. The owner verifies one route's rule; another route's rule still holds older seed research.
    const [vr] = await t.db
      .select({ id: visaRoutes.id })
      .from(visaRoutes)
      .where(and(eq(visaRoutes.countryIso2, verifiedRoute.countryIso2), eq(visaRoutes.code, verifiedRoute.code)));
    const [vRule] = await t.db.select().from(visaRuleVersions).where(eq(visaRuleVersions.routeId, vr.id));
    await markRuleVerified(t.db, vRule.id, { actor: 'admin', verifiedBy: 'owner', now: T1 });
    await t.db.update(visaRuleVersions).set({ ruleText: 'owner-verified wording' }).where(eq(visaRuleVersions.id, vRule.id));
    const [sr] = await t.db
      .select({ id: visaRoutes.id })
      .from(visaRoutes)
      .where(and(eq(visaRoutes.countryIso2, staleRuleRoute.countryIso2), eq(visaRoutes.code, staleRuleRoute.code)));
    await t.db.update(visaRuleVersions).set({ ruleText: 'older seed research' }).where(eq(visaRuleVersions.routeId, sr.id));
    // 5. The owner promotes a source and reviews a platform's terms.
    await t.db.update(sources).set({ status: 'live', label: 'owner label' }).where(eq(sources.label, ownedSource.label));
    await t.db
      .update(sourcePlatforms)
      .set({ termsReviewedAt: T1, termsNotes: 'reviewed by the owner' })
      .where(eq(sourcePlatforms.key, reviewedPlatform.key));
    // 6. The owner makes a country live.
    await t.db.update(countries).set({ isLive: true }).where(eq(countries.iso2, 'DE'));

    after = await seedDatabase(t.db, { now: T2 });
  });

  it('keeps edited and deleted starters', async () => {
    const [tpl] = await t.db.select().from(templates).where(eq(templates.name, editedTemplate.name));
    expect(tpl.bodyMd).toBe('my own letter');
    const [cv] = await t.db.select().from(resumeVersions).where(eq(resumeVersions.name, editedResume.name));
    expect(cv.contentMd).toBe('my own CV');
    const gone = await t.db.select().from(templates).where(eq(templates.name, deletedTemplate.name));
    expect(gone).toEqual([]);
    expect(after.sections.templates.kept).toBe(2);
    expect(after.sections.resumeVersions.kept).toBe(1);
  });

  it('refreshes an untouched starter whose seed text changed, and it stays pristine', async () => {
    const [tpl] = await t.db.select().from(templates).where(eq(templates.name, staleTemplate.name));
    expect(tpl.bodyMd).toBe(staleTemplate.bodyMd);
    expect(tpl.updatedAt.getTime()).toBe(tpl.createdAt.getTime());
    expect(after.sections.templates.updated).toBe(1);
  });

  it('leaves a verified rule alone and adds an unverified version for changed research', async () => {
    const [vr] = await t.db
      .select({ id: visaRoutes.id })
      .from(visaRoutes)
      .where(and(eq(visaRoutes.countryIso2, verifiedRoute.countryIso2), eq(visaRoutes.code, verifiedRoute.code)));
    const vRules = await t.db.select().from(visaRuleVersions).where(eq(visaRuleVersions.routeId, vr.id));
    expect(vRules).toHaveLength(1);
    expect(vRules[0]).toMatchObject({ verificationStatus: 'verified', ruleText: 'owner-verified wording' });

    const [sr] = await t.db
      .select({ id: visaRoutes.id })
      .from(visaRoutes)
      .where(and(eq(visaRoutes.countryIso2, staleRuleRoute.countryIso2), eq(visaRoutes.code, staleRuleRoute.code)));
    const sRules = (await t.db.select().from(visaRuleVersions).where(eq(visaRuleVersions.routeId, sr.id))).sort((a, b) => a.version - b.version);
    expect(sRules.map((r) => r.version)).toEqual([1, 2]);
    expect(sRules[0].ruleText).toBe('older seed research');
    expect(sRules[1]).toMatchObject({ verificationStatus: 'unverified', changeReason: VISA_UPDATE_REASON, ruleText: staleRuleRoute.rule.ruleText });
    expect(after.sections.visaRules).toMatchObject({ updated: 1, kept: 1 });
  });

  it('keeps a source whose status the owner changed and a platform whose terms they reviewed', async () => {
    const [src] = await t.db.select().from(sources).where(eq(sources.label, 'owner label'));
    expect(src.status).toBe('live');
    const [p] = await t.db.select().from(sourcePlatforms).where(eq(sourcePlatforms.key, reviewedPlatform.key));
    expect(p.termsNotes).toBe('reviewed by the owner');
    expect(after.sections.sources.kept).toBe(1);
    expect(after.sections.platforms.kept).toBe(1);
  });

  it("never touches a country's live flag", async () => {
    const [de] = await t.db.select().from(countries).where(eq(countries.iso2, 'DE'));
    expect(de.isLive).toBe(true);
  });

  it('is stable afterwards: a third run only reports the kept rows', async () => {
    const third = await seedDatabase(t.db, { now: new Date('2026-09-30T11:00:00.000Z') });
    expect(isNoop(third)).toBe(true);
    expect(totalTally(third.sections).kept).toBe(totalTally(after.sections).kept);
    expect(third.keptNotes.length).toBe(totalTally(third.sections).kept);
  });
});

describe('seedDatabase — companies the pipeline already knows', () => {
  it('reuses an existing company (by name), fills only its gaps, and does not duplicate it', async () => {
    await t.truncateAll();
    const c = SEED_COMPANIES.find((x) => x.type !== 'unknown' && x.type !== 'agency' && x.domain)!;
    const [first] = await seedDatabase(t.db, { now: T0 }).then(async () => t.db.select().from(companies).where(eq(companies.name, c.name)));
    const normalizedName = first.normalizedName;
    await t.truncateAll();
    const [res] = await t.db.insert(companies).values({ name: c.name, normalizedName, type: 'unknown', hqCountry: null, domain: null, notes: 'found by the pipeline' });
    const existingId = Number(res.insertId);

    const summary = await seedDatabase(t.db, { now: T1 });
    expect(summary.sections.companies.updated).toBeGreaterThanOrEqual(1);
    const rows = await t.db.select().from(companies).where(eq(companies.normalizedName, normalizedName));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existingId, type: c.type, hqCountry: c.hqCountry, notes: 'found by the pipeline' });
    expect(rows[0].domain).not.toBeNull();
    const linked = await t.db.select().from(sources).where(like(sources.notes, 'Seeded %'));
    expect(linked.some((s) => s.companyId === existingId)).toBe(true);
  });
});

describe('seedDatabase — concurrent runs', () => {
  it('serialises two runs on the seed lock: one inserts, the other finds nothing to do', async () => {
    await t.truncateAll();
    const [a, b] = await Promise.all([seedDatabase(t.db, { now: T0 }), seedDatabase(t.db, { now: T0 })]);
    const inserted = [totalTally(a.sections).inserted, totalTally(b.sections).inserted].sort((x, y) => x - y);
    expect(inserted[0]).toBe(0);
    expect(inserted[1]).toBeGreaterThan(1000);
    expect(await count(templates)).toBe(SEED_TEMPLATES.length);
    expect(await count(companies)).toBe(SEED_COMPANIES.length);
  });
});
