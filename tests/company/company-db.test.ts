import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { auditLog, companies, companyAliases, companyEvidence, jobChanges, jobs, sources } from '@/db/schema';
import { companyAncestors, companyDescendants, companyFamily, companyFamilyIds, companyNames, canonicalCompanyId, mergedCompanyIds } from '@/lib/company/family';
import { manualAgencyDecision, mergeCompanies, setCompanyAgency, setParentCompany, splitCompany } from '@/lib/company/manual';
import { AGENCY_TEXT_POSTINGS_TO_FLAG, hasManualAgencyDecision, isPlaceholderCompany, resolveCompany } from '@/lib/company/resolve';
import type { DbOrTx } from '@/lib/db';
import { sha256Hex } from '@/lib/hash';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCompany, seedSource } from '../helpers/fixtures';

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
}, 240_000);

afterAll(async () => {
  await t?.stop();
});

beforeEach(async () => {
  await t.truncateAll();
});

let n = 0;
async function addJob(db: DbOrTx, companyId: number, title = 'Backend Engineer'): Promise<number> {
  const url = `https://jobs.example.test/${++n}`;
  const [res] = await db.insert(jobs).values({
    companyId,
    canonicalTitle: title,
    titleRaw: title,
    locationRaw: '',
    descriptionText: `${title} posting ${n}`,
    descriptionHash: sha256Hex(`${title} posting ${n}`),
    applyUrl: url,
    applyUrlClean: url,
    applyUrlHash: sha256Hex(url),
  });
  return Number(res.insertId);
}

async function linkJob(db: DbOrTx, jobId: number, sourceId: number): Promise<void> {
  const { jobSources } = await import('@/db/schema');
  await db.insert(jobSources).values({ jobId, sourceId, externalId: `ext-${++n}`, url: `https://jobs.example.test/src/${n}`, grade: 'A' });
}

async function companyOf(jobId: number): Promise<number> {
  const [row] = await t.db.select({ companyId: jobs.companyId }).from(jobs).where(eq(jobs.id, jobId));
  return row.companyId;
}

async function company(id: number) {
  const [row] = await t.db.select().from(companies).where(eq(companies.id, id));
  return row;
}

async function aliases(companyId: number) {
  return t.db.select().from(companyAliases).where(eq(companyAliases.companyId, companyId)).orderBy(asc(companyAliases.id));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('resolveCompany', () => {
  it('creates a company once and sends legal-form variants to it', async () => {
    const a = await resolveCompany(t.db, { name: 'Acme Robotics GmbH', countryIso2: 'DE' });
    expect(a).toMatchObject({ created: true, matchedBy: 'created', isAgency: false, placeholder: false });
    const row = await company(a.companyId);
    expect(row.normalizedName).toBe('acme robotics');
    expect((await aliases(a.companyId)).map((x) => [x.normalizedAlias, x.kind])).toEqual([['acme robotics', 'legal']]);

    for (const variant of ['Acme Robotics', 'ACME ROBOTICS GMBH', 'Acme Robotics Ltd.', 'The Acme Robotics Company', 'Acme Robotics, Inc.']) {
      const r = await resolveCompany(t.db, { name: variant });
      expect(r.companyId, variant).toBe(a.companyId);
      expect(r.created).toBe(false);
      expect(r.matchedBy).toBe('name');
      expect(r.confidence).toBeGreaterThanOrEqual(0.85);
    }
    const [{ count }] = (await t.pool.query('SELECT COUNT(*) AS count FROM companies'))[0] as { count: number }[];
    expect(Number(count)).toBe(1);
  });

  it('learns aliases for confident matches, both umlaut spellings', async () => {
    const a = await resolveCompany(t.db, { name: 'Kühne + Nagel' });
    const keys = (await aliases(a.companyId)).map((x) => x.normalizedAlias).sort();
    expect(keys).toEqual(['kuehne and nagel', 'kuhne and nagel']);
    const b = await resolveCompany(t.db, { name: 'Kuehne & Nagel AG' });
    expect(b.companyId).toBe(a.companyId);
    const kinds = (await aliases(a.companyId)).map((x) => `${x.normalizedAlias}/${x.kind}`).sort();
    expect(kinds).toContain('kuehne and nagel/legal');
  });

  it('matches by ATS slug even when the board shows a new name', async () => {
    const a = await resolveCompany(t.db, { name: 'Acme', atsSlug: 'acme-inc', atsPlatform: 'greenhouse' });
    const same = await resolveCompany(t.db, { name: 'Acme Inc.', atsSlug: 'acme-inc', atsPlatform: 'greenhouse' });
    expect(same).toMatchObject({ companyId: a.companyId, matchedBy: 'ats_slug', confidence: 0.97 });
    const renamed = await resolveCompany(t.db, { name: 'Zenith Labs', atsSlug: 'acme-inc', atsPlatform: 'greenhouse' });
    expect(renamed.companyId).toBe(a.companyId);
    expect(renamed.confidence).toBe(0.85);
    expect(renamed.reasons).toContain('the board now shows a different name');
    // The same slug on another platform is a different board.
    const other = await resolveCompany(t.db, { name: 'Other Acme Thing', atsSlug: 'acme-inc', atsPlatform: 'lever' });
    expect(other.companyId).not.toBe(a.companyId);
  });

  it('matches by website when the name differs a little', async () => {
    const a = await resolveCompany(t.db, { name: 'Globex Corporation', domain: 'https://www.globex.com' });
    expect((await company(a.companyId)).domain).toBe('globex.com');
    const b = await resolveCompany(t.db, { name: 'Globex Corp International', domain: 'careers.globex.com' });
    expect(b).toMatchObject({ companyId: a.companyId, matchedBy: 'domain', confidence: 0.85 });
    // A shared ATS / free-mail domain is not evidence.
    const c = await resolveCompany(t.db, { name: 'Umbrella Pharma', domain: 'https://boards.greenhouse.io/umbrella' });
    const d = await resolveCompany(t.db, { name: 'Soylent Foods', domain: 'https://boards.greenhouse.io/soylent' });
    expect(c.companyId).not.toBe(d.companyId);
    expect((await company(c.companyId)).domain).toBeNull();
  });

  it('never joins two names on a website alone when the names do not fit', async () => {
    const a = await resolveCompany(t.db, { name: 'Initrode', domain: 'initrode.com' });
    const b = await resolveCompany(t.db, { name: 'Vandelay Industries', domain: 'initrode.com' });
    expect(b.companyId).not.toBe(a.companyId);
    expect(b.created).toBe(true);
    expect(b.possibleCompanyIds).toContain(a.companyId);
  });

  it('sends a country entity of a known brand to the brand and remembers its legal name', async () => {
    const brand = await resolveCompany(t.db, { name: 'Initech' });
    const de = await resolveCompany(t.db, { name: 'Initech Deutschland GmbH', countryIso2: 'DE' });
    expect(de).toMatchObject({ companyId: brand.companyId, matchedBy: 'brand', confidence: 0.75 });
    const again = await resolveCompany(t.db, { name: 'Initech Deutschland GmbH' });
    expect(again).toMatchObject({ companyId: brand.companyId, matchedBy: 'name' });
    expect((await aliases(brand.companyId)).some((a) => a.normalizedAlias === 'initech deutschland' && a.kind === 'legal')).toBe(true);
  });

  it('keeps generic words from pulling different companies together', async () => {
    const air = await resolveCompany(t.db, { name: 'Air' });
    const af = await resolveCompany(t.db, { name: 'Air France' });
    expect(af.companyId).not.toBe(air.companyId);
  });

  it('several records with the same name: tie → low confidence, domain decides', async () => {
    const x = await seedCompany(t.db, 'Acme');
    const y = await seedCompany(t.db, 'Acme');
    await t.db.update(companies).set({ domain: 'acme.io' }).where(eq(companies.id, y));
    const tie = await resolveCompany(t.db, { name: 'Acme' });
    expect(tie.companyId).toBe(x);
    expect(tie.confidence).toBe(0.7);
    expect(tie.reasons).toContain('several companies share this name');
    expect(tie.possibleCompanyIds).toContain(y);
    expect(await aliases(x)).toHaveLength(0);
    const byDomain = await resolveCompany(t.db, { name: 'Acme', domain: 'https://acme.io/jobs' });
    expect(byDomain).toMatchObject({ companyId: y, confidence: 0.97 });
  });

  it('placeholder names share one record, flagged, with no alias learning', async () => {
    const a = await resolveCompany(t.db, { name: 'Confidential' });
    expect(a).toMatchObject({ placeholder: true, matchedBy: 'placeholder', confidence: 0.3 });
    const b = await resolveCompany(t.db, { name: 'CONFIDENTIAL' });
    expect(b.companyId).toBe(a.companyId);
    expect(b.placeholder).toBe(true);
    expect(await isPlaceholderCompany(t.db, a.companyId)).toBe(true);
    expect((await company(a.companyId)).notes).toMatch(/placeholder/i);
    const real = await resolveCompany(t.db, { name: 'Acme' });
    expect(await isPlaceholderCompany(t.db, real.companyId)).toBe(false);
    expect(await isPlaceholderCompany(t.db, null)).toBe(false);
  });

  it('marks known agencies and agency names at once, with evidence', async () => {
    const hays = await resolveCompany(t.db, { name: 'Hays AG' });
    expect(hays).toMatchObject({ isAgency: true, companyIsAgency: true });
    const row = await company(hays.companyId);
    expect(row).toMatchObject({ isAgency: true, type: 'agency' });
    const ev = await t.db.select().from(companyEvidence).where(eq(companyEvidence.companyId, hays.companyId));
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ kind: 'posting_history', method: 'rule', matchStatus: 'confirmed', source: 'company name' });

    const kw = await resolveCompany(t.db, { name: 'Nordic Tech Recruitment Ltd' });
    expect(kw.companyIsAgency).toBe(true);
  });

  it('recruiter wording flags the company only after enough distinct postings', async () => {
    const text = 'Im Auftrag unseres Kunden suchen wir ab sofort einen Java Entwickler (m/w/d).';
    const first = await resolveCompany(t.db, { name: 'Nordwind Talent GmbH', descriptionText: text, evidenceSource: 'post-1' });
    expect(first).toMatchObject({ isAgency: true, companyIsAgency: false });
    // The same posting seen again does not count twice.
    const repeat = await resolveCompany(t.db, { name: 'Nordwind Talent GmbH', descriptionText: text, evidenceSource: 'post-1' });
    expect(repeat.companyIsAgency).toBe(false);
    for (let i = 2; i < AGENCY_TEXT_POSTINGS_TO_FLAG; i++) {
      const r = await resolveCompany(t.db, { name: 'Nordwind Talent GmbH', descriptionText: text, evidenceSource: `post-${i}` });
      expect(r.companyIsAgency).toBe(false);
    }
    const last = await resolveCompany(t.db, { name: 'Nordwind Talent GmbH', descriptionText: text, evidenceSource: `post-${AGENCY_TEXT_POSTINGS_TO_FLAG}` });
    expect(last.companyIsAgency).toBe(true);
    expect(await company(last.companyId)).toMatchObject({ isAgency: true, type: 'agency' });
    const audits = await t.db.select().from(auditLog).where(eq(auditLog.action, 'company.agency_detected'));
    expect(audits).toHaveLength(1);
  });

  it('a manual "not an agency" decision is never overridden', async () => {
    const text = 'Our client is a leading bank looking for a data engineer.';
    const a = await resolveCompany(t.db, { name: 'Brightline Partners', descriptionText: text, evidenceSource: 'p0' });
    expect(await hasManualAgencyDecision(t.db, a.companyId)).toBe(false);
    const decided = await setCompanyAgency(t.db, a.companyId, false, 'They employ their consultants');
    expect(decided.ok).toBe(true);
    expect(await hasManualAgencyDecision(t.db, a.companyId)).toBe(true);
    for (let i = 1; i <= AGENCY_TEXT_POSTINGS_TO_FLAG + 1; i++) {
      const r = await resolveCompany(t.db, { name: 'Brightline Partners', descriptionText: text, evidenceSource: `p${i}` });
      expect(r.companyIsAgency).toBe(false);
    }
    expect(await company(a.companyId)).toMatchObject({ isAgency: false });
  });

  it('consultancies are never flagged by their posting text', async () => {
    const text = 'Our client is a leading insurer; you will be placed on-site at our client.';
    for (let i = 0; i < AGENCY_TEXT_POSTINGS_TO_FLAG + 1; i++) {
      const r = await resolveCompany(t.db, { name: 'Accenture GmbH', descriptionText: text, evidenceSource: `acc-${i}` });
      expect(r.isAgency).toBe(false);
      expect(r.companyIsAgency).toBe(false);
    }
  });

  it('names of a merged record resolve to the survivor', async () => {
    const keep = await resolveCompany(t.db, { name: 'Acme Robotics' });
    const drop = await resolveCompany(t.db, { name: 'ACMEbots Ltd' });
    expect(drop.companyId).not.toBe(keep.companyId);
    expect((await mergeCompanies(t.db, keep.companyId, drop.companyId, 'Same company, old brand')).ok).toBe(true);
    const r = await resolveCompany(t.db, { name: 'ACMEbots Ltd' });
    expect(r.companyId).toBe(keep.companyId);
    const slugged = await resolveCompany(t.db, { name: 'ACMEbots', atsSlug: 'acmebots', atsPlatform: 'lever' });
    expect(slugged.companyId).toBe(keep.companyId);
  });

  it('blank names get a stable fallback record', async () => {
    const a = await resolveCompany(t.db, { name: '   ' });
    const b = await resolveCompany(t.db, { name: '' });
    expect(a.companyId).toBe(b.companyId);
    expect(a.placeholder).toBe(true);
  });
});

describe('mergeCompanies', () => {
  it('moves jobs, sources and evidence, fills empty fields and records everything', async () => {
    const keep = await seedCompany(t.db, 'Acme');
    const drop = await seedCompany(t.db, 'Acme Holdings');
    await t.db.update(companies).set({ domain: 'acme.com', hqCountry: 'DE', sizeBand: '51-250' }).where(eq(companies.id, drop));
    const j1 = await addJob(t.db, drop);
    const j2 = await addJob(t.db, drop);
    const jk = await addJob(t.db, keep);
    const src = await seedSource(t.db);
    await t.db.update(sources).set({ companyId: drop }).where(eq(sources.id, src));
    await t.db.insert(companyEvidence).values({
      companyId: drop,
      kind: 'register_match',
      valueJson: { sponsors: true },
      source: 'uk_home_office',
      method: 'official',
      confidence: 'high',
      logicVersion: 'test',
    });

    const res = await mergeCompanies(t.db, keep, drop, 'Same company', { actor: 'admin', ip: '127.0.0.1' });
    expect(res).toMatchObject({ ok: true, companyId: keep });
    expect(res.movedJobIds?.sort()).toEqual([j1, j2].sort());
    expect(res.movedSourceIds).toEqual([src]);
    expect(await companyOf(j1)).toBe(keep);
    expect(await companyOf(j2)).toBe(keep);
    expect(await companyOf(jk)).toBe(keep);
    const [s] = await t.db.select().from(sources).where(eq(sources.id, src));
    expect(s.companyId).toBe(keep);
    const ev = await t.db.select().from(companyEvidence);
    expect(ev.every((e) => e.companyId === keep)).toBe(true);
    expect(await company(drop)).toMatchObject({ mergedIntoId: keep });
    expect(await company(keep)).toMatchObject({ domain: 'acme.com', hqCountry: 'DE', sizeBand: '51-250' });

    const changes = await t.db.select().from(jobChanges).where(eq(jobChanges.field, 'company_id'));
    expect(changes.map((c) => [c.jobId, c.oldValue, c.newValue]).sort()).toEqual(
      [
        [j1, String(drop), String(keep)],
        [j2, String(drop), String(keep)],
      ].sort(),
    );
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'company.merge'));
    expect(a).toMatchObject({ entityType: 'company', entityId: String(drop), reason: 'Same company', ip: '127.0.0.1' });
    expect(a.afterJson).toMatchObject({ keepId: keep, dropId: drop });

    expect(await canonicalCompanyId(t.db, drop)).toBe(keep);
    expect(await mergedCompanyIds(t.db, keep)).toEqual([drop]);
  });

  it('repeat merge is a no-op; invalid merges fail without changes', async () => {
    const a = await seedCompany(t.db, 'Alpha');
    const b = await seedCompany(t.db, 'Beta');
    const c = await seedCompany(t.db, 'Gamma');
    expect((await mergeCompanies(t.db, a, a, 'x')).ok).toBe(false);
    expect((await mergeCompanies(t.db, a, b, '   ')).ok).toBe(false);
    expect((await mergeCompanies(t.db, a, 999_999, 'x')).ok).toBe(false);
    expect((await mergeCompanies(t.db, 0, b, 'x')).ok).toBe(false);
    expect((await mergeCompanies(t.db, a, b, 'same')).ok).toBe(true);
    expect(await mergeCompanies(t.db, a, b, 'same')).toMatchObject({ ok: true, noop: true });
    const intoMerged = await mergeCompanies(t.db, b, c, 'x');
    expect(intoMerged.ok).toBe(false);
    expect(intoMerged.message).toMatch(/merged into/);
    const mergedAgain = await mergeCompanies(t.db, c, b, 'x');
    expect(mergedAgain.ok).toBe(false);
    expect(await company(c)).toMatchObject({ mergedIntoId: null });
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'company.merge'))).toHaveLength(1);
  });

  it('flattens chains: records merged into the dropped one point at the survivor', async () => {
    const a = await seedCompany(t.db, 'Alpha');
    const b = await seedCompany(t.db, 'Beta');
    const c = await seedCompany(t.db, 'Gamma');
    await mergeCompanies(t.db, b, c, 'c is b');
    await mergeCompanies(t.db, a, b, 'b is a');
    expect(await company(c)).toMatchObject({ mergedIntoId: a });
    expect((await mergedCompanyIds(t.db, a)).sort()).toEqual([b, c].sort());
  });

  it('re-points subsidiaries and takes the parent when the survivor has none', async () => {
    const parent = await seedCompany(t.db, 'Parent Group');
    const keep = await seedCompany(t.db, 'Acme');
    const drop = await seedCompany(t.db, 'Acme Old');
    const child = await seedCompany(t.db, 'Acme Child');
    await setParentCompany(t.db, drop, parent, 'owned by');
    await setParentCompany(t.db, child, drop, 'owned by');
    await mergeCompanies(t.db, keep, drop, 'same');
    expect(await company(child)).toMatchObject({ parentCompanyId: keep });
    expect(await company(keep)).toMatchObject({ parentCompanyId: parent });
    expect(await companyAncestors(t.db, child)).toEqual([keep, parent]);
  });

  it('merging a parent into its own subsidiary splices it out of the chain (no loop)', async () => {
    const top = await seedCompany(t.db, 'Top');
    const mid = await seedCompany(t.db, 'Mid');
    const low = await seedCompany(t.db, 'Low');
    await setParentCompany(t.db, mid, top, 'x');
    await setParentCompany(t.db, low, mid, 'x');
    const res = await mergeCompanies(t.db, low, mid, 'mid is low');
    expect(res.ok).toBe(true);
    expect(await company(low)).toMatchObject({ parentCompanyId: top });
    expect(await companyAncestors(t.db, low)).toEqual([top]);
    expect(await companyDescendants(t.db, top)).toEqual([low]);
  });

  it('keeps the survivor\'s manual agency decision over the dropped one', async () => {
    const keep = await seedCompany(t.db, 'Keepco');
    const drop = await seedCompany(t.db, 'Dropco');
    await setCompanyAgency(t.db, keep, false, 'employer');
    await setCompanyAgency(t.db, drop, true, 'recruiter');
    await mergeCompanies(t.db, keep, drop, 'same');
    expect(await company(keep)).toMatchObject({ isAgency: false });
    expect(await manualAgencyDecision(t.db, keep)).toMatchObject({ isAgency: false });
  });

  it('takes the dropped manual agency decision when the survivor has none', async () => {
    const keep = await seedCompany(t.db, 'Keepco');
    const drop = await seedCompany(t.db, 'Dropco');
    await setCompanyAgency(t.db, drop, true, 'recruiter');
    await mergeCompanies(t.db, keep, drop, 'same');
    expect(await company(keep)).toMatchObject({ isAgency: true, type: 'agency' });
    expect(await manualAgencyDecision(t.db, keep)).toMatchObject({ isAgency: true });
  });
});

describe('splitCompany', () => {
  it('splits names off into a new company that then wins those names', async () => {
    const a = await resolveCompany(t.db, { name: 'Acme GmbH', countryIso2: 'DE' });
    // One spelling is kept per (key, kind), so "Acme Ltd" is not learned as a second legal name ...
    expect((await resolveCompany(t.db, { name: 'Acme Ltd', countryIso2: 'GB' })).companyId).toBe(a.companyId);
    expect((await aliases(a.companyId)).some((x) => x.alias === 'Acme Ltd')).toBe(false);
    // ... an admin adds it by hand, then splits it off.
    await t.db.insert(companyAliases).values({ companyId: a.companyId, alias: 'Acme Ltd', normalizedAlias: 'acme', kind: 'other', countryIso2: 'GB' });
    const ltdAlias = (await aliases(a.companyId)).find((x) => x.alias === 'Acme Ltd');
    expect(ltdAlias).toBeTruthy();

    const src = await seedSource(t.db);
    await t.db.update(sources).set({ companyId: a.companyId }).where(eq(sources.id, src));
    const onlyUk = await addJob(t.db, a.companyId);
    await linkJob(t.db, onlyUk, src);
    const both = await addJob(t.db, a.companyId);
    const other = await seedSource(t.db);
    await linkJob(t.db, both, src);
    await linkJob(t.db, both, other);
    const picked = await addJob(t.db, a.companyId);

    const res = await splitCompany(t.db, a.companyId, [ltdAlias!.id], 'UK entity is a different employer', { sourceIds: [src], jobIds: [picked] });
    expect(res).toMatchObject({ ok: true, restored: false });
    const newId = res.newCompanyId!;
    expect(await company(newId)).toMatchObject({ name: 'Acme Ltd', normalizedName: 'acme', mergedIntoId: null });
    expect((await company(newId)).notes).toContain(`Split from company #${a.companyId}`);
    expect((await aliases(newId)).map((x) => x.alias)).toEqual(['Acme Ltd']);
    expect(await companyOf(onlyUk)).toBe(newId);
    expect(await companyOf(picked)).toBe(newId);
    expect(await companyOf(both)).toBe(a.companyId);
    const [s] = await t.db.select().from(sources).where(eq(sources.id, src));
    expect(s.companyId).toBe(newId);

    // The full legal name now leads to the split-off record; the other names stay.
    expect((await resolveCompany(t.db, { name: 'Acme Ltd' })).companyId).toBe(newId);
    expect((await resolveCompany(t.db, { name: 'Acme GmbH' })).companyId).toBe(a.companyId);
    const [audit] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'company.split'));
    expect(audit.afterJson).toMatchObject({ newCompanyId: newId, restored: false });
  });

  it('restores a merged record with what the merge moved and the names learned since', async () => {
    const keep = await resolveCompany(t.db, { name: 'Acme Robotics' });
    const drop = await resolveCompany(t.db, { name: 'Zenith Automation GmbH' });
    const dj = await addJob(t.db, drop.companyId);
    const src = await seedSource(t.db);
    await t.db.update(sources).set({ companyId: drop.companyId }).where(eq(sources.id, src));
    await t.db.update(companies).set({ domain: 'zenith-automation.de' }).where(eq(companies.id, drop.companyId));
    await mergeCompanies(t.db, keep.companyId, drop.companyId, 'looked like a rebrand');
    expect(await company(keep.companyId)).toMatchObject({ domain: 'zenith-automation.de' });

    await sleep(5);
    // Postings keep arriving under the old name; the survivor learns its spelling variants.
    const later = await resolveCompany(t.db, { name: 'Zenith Automation', countryIso2: 'DE' });
    expect(later.companyId).toBe(keep.companyId);
    const learned = (await aliases(keep.companyId)).filter((x) => x.normalizedAlias === 'zenith automation');
    expect(learned.length).toBeGreaterThan(0);
    const newJob = await addJob(t.db, keep.companyId);

    const dropAlias = (await aliases(drop.companyId))[0];
    const res = await splitCompany(t.db, keep.companyId, [dropAlias.id], 'not the same company after all', { jobIds: [newJob] });
    expect(res).toMatchObject({ ok: true, restored: true, newCompanyId: drop.companyId });
    expect(await company(drop.companyId)).toMatchObject({ mergedIntoId: null });
    expect(await companyOf(dj)).toBe(drop.companyId);
    expect(await companyOf(newJob)).toBe(drop.companyId);
    const [s] = await t.db.select().from(sources).where(eq(sources.id, src));
    expect(s.companyId).toBe(drop.companyId);
    expect(await company(keep.companyId)).toMatchObject({ domain: null });
    expect((await aliases(keep.companyId)).some((x) => x.normalizedAlias === 'zenith automation')).toBe(false);

    // The fix persists: new postings under the old name go to the restored record.
    expect((await resolveCompany(t.db, { name: 'Zenith Automation GmbH' })).companyId).toBe(drop.companyId);
    expect((await resolveCompany(t.db, { name: 'Zenith Automation' })).companyId).toBe(drop.companyId);
    expect((await resolveCompany(t.db, { name: 'Acme Robotics' })).companyId).toBe(keep.companyId);
  });

  it('restores parent links the merge changed', async () => {
    const keep = await seedCompany(t.db, 'Keepco');
    const drop = await seedCompany(t.db, 'Dropco');
    const child = await seedCompany(t.db, 'Childco');
    await t.db.insert(companyAliases).values({ companyId: drop, alias: 'Dropco', normalizedAlias: 'dropco', kind: 'brand' });
    await setParentCompany(t.db, child, drop, 'x');
    await mergeCompanies(t.db, keep, drop, 'same');
    expect(await company(child)).toMatchObject({ parentCompanyId: keep });
    const [al] = await aliases(drop);
    const res = await splitCompany(t.db, keep, [al.id], 'different');
    expect(res.ok).toBe(true);
    expect(await company(child)).toMatchObject({ parentCompanyId: drop });
  });

  it('refuses bad selections', async () => {
    const a = await resolveCompany(t.db, { name: 'Alpha GmbH' });
    const b = await resolveCompany(t.db, { name: 'Beta GmbH' });
    const [aa] = await aliases(a.companyId);
    const [bb] = await aliases(b.companyId);
    expect((await splitCompany(t.db, a.companyId, [], 'x')).ok).toBe(false);
    expect((await splitCompany(t.db, a.companyId, [aa.id], '')).ok).toBe(false);
    expect((await splitCompany(t.db, a.companyId, [aa.id, bb.id], 'x')).ok).toBe(false);
    expect((await splitCompany(t.db, a.companyId, [bb.id], 'x')).message).toMatch(/belong to company/);
    expect((await splitCompany(t.db, a.companyId, [123_456], 'x')).ok).toBe(false);
    const slug = await resolveCompany(t.db, { name: 'Gamma', atsSlug: 'gamma', atsPlatform: 'lever' });
    const slugAlias = (await aliases(slug.companyId)).find((x) => x.kind === 'ats_slug')!;
    expect((await splitCompany(t.db, slug.companyId, [slugAlias.id], 'x')).message).toMatch(/name/);
    const named = await splitCompany(t.db, slug.companyId, [slugAlias.id], 'board belongs to Delta', { name: 'Delta GmbH' });
    expect(named.ok).toBe(true);
    expect((await resolveCompany(t.db, { name: 'Whatever', atsSlug: 'gamma', atsPlatform: 'lever' })).companyId).toBe(named.newCompanyId);
    expect((await resolveCompany(t.db, { name: 'Delta' })).companyId).toBe(named.newCompanyId);
    await mergeCompanies(t.db, a.companyId, b.companyId, 'x');
    expect((await splitCompany(t.db, b.companyId, [bb.id], 'x')).ok).toBe(false);
  });
});

describe('setCompanyAgency / setParentCompany', () => {
  it('stores the decision as manual evidence and is idempotent', async () => {
    const c = await seedCompany(t.db, 'Talentfinder');
    const r1 = await setCompanyAgency(t.db, c, true, 'They place contractors');
    expect(r1.ok).toBe(true);
    expect(await company(c)).toMatchObject({ isAgency: true, type: 'agency' });
    const [ev] = await t.db.select().from(companyEvidence).where(and(eq(companyEvidence.companyId, c), eq(companyEvidence.kind, 'manual_note')));
    expect(ev).toMatchObject({ method: 'manual', matchStatus: 'confirmed', source: 'manual', evidence: 'They place contractors' });
    expect(ev.valueJson).toEqual({ field: 'is_agency', isAgency: true });
    expect(await setCompanyAgency(t.db, c, true, 'again')).toMatchObject({ ok: true, noop: true });
    const r2 = await setCompanyAgency(t.db, c, false, 'Actually the employer');
    expect(r2.ok).toBe(true);
    expect(await company(c)).toMatchObject({ isAgency: false, type: 'unknown' });
    expect(await manualAgencyDecision(t.db, c)).toMatchObject({ isAgency: false });
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'company.set_agency'))).toHaveLength(2);
    expect((await setCompanyAgency(t.db, c, true, '')).ok).toBe(false);
    expect((await setCompanyAgency(t.db, 424_242, true, 'x')).ok).toBe(false);
  });

  it('keeps a startup type when marked not an agency', async () => {
    const c = await seedCompany(t.db, 'Rocket');
    await t.db.update(companies).set({ type: 'startup' }).where(eq(companies.id, c));
    await setCompanyAgency(t.db, c, false, 'employer');
    expect(await company(c)).toMatchObject({ type: 'startup', isAgency: false });
  });

  it('sets, clears and refuses loops', async () => {
    const top = await seedCompany(t.db, 'Top');
    const mid = await seedCompany(t.db, 'Mid');
    const low = await seedCompany(t.db, 'Low');
    expect((await setParentCompany(t.db, mid, top, 'owned')).ok).toBe(true);
    expect((await setParentCompany(t.db, low, mid, 'owned')).ok).toBe(true);
    expect(await setParentCompany(t.db, low, mid, 'owned')).toMatchObject({ ok: true, noop: true });
    expect((await setParentCompany(t.db, top, low, 'loop')).message).toMatch(/loop/);
    expect((await setParentCompany(t.db, top, top, 'self')).ok).toBe(false);
    expect(await companyAncestors(t.db, low)).toEqual([mid, top]);
    expect((await companyDescendants(t.db, top)).sort()).toEqual([mid, low].sort());

    const fam = await companyFamily(t.db, low);
    expect(fam).toMatchObject({ companyId: low, rootId: top, ancestors: [mid, top] });
    expect(fam!.members.sort()).toEqual([top, mid, low].sort());
    expect((await companyFamilyIds(t.db, mid)).sort()).toEqual([top, mid, low].sort());

    expect((await setParentCompany(t.db, low, null, 'sold')).ok).toBe(true);
    expect(await companyAncestors(t.db, low)).toEqual([]);
    const merged = await seedCompany(t.db, 'Merged');
    await mergeCompanies(t.db, top, merged, 'x');
    expect((await setParentCompany(t.db, low, merged, 'x')).ok).toBe(false);
    expect((await setParentCompany(t.db, merged, low, 'x')).ok).toBe(false);
  });
});

describe('companyNames', () => {
  it('lists the names of the company and of records merged into it', async () => {
    const keep = await resolveCompany(t.db, { name: 'Acme Robotics GmbH', atsSlug: 'acme', atsPlatform: 'lever' });
    const drop = await resolveCompany(t.db, { name: 'Zenith Automation Ltd' });
    await mergeCompanies(t.db, keep.companyId, drop.companyId, 'x');
    const names = await companyNames(t.db, keep.companyId);
    expect(names[0]).toMatchObject({ companyId: keep.companyId, kind: 'name', normalized: 'acme robotics' });
    expect(names.map((x) => x.normalized)).toEqual(expect.arrayContaining(['acme robotics', 'zenith automation']));
    expect(names.some((x) => x.kind === 'ats_slug')).toBe(false);
    expect((await companyNames(t.db, keep.companyId, { includeSlugs: true })).some((x) => x.kind === 'ats_slug')).toBe(true);
    // Asking through the merged record gives the same family.
    expect((await companyNames(t.db, drop.companyId)).length).toBe(names.length);
    expect((await companyFamilyIds(t.db, drop.companyId)).sort()).toEqual([keep.companyId, drop.companyId].sort());
  });
});
