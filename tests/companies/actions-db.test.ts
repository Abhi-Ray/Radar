/**
 * DB-backed tests for the /companies Server Actions (src/lib/actions/companies.ts) and queries:
 * my sponsor note (manual_note, method manual), agency / parent, merge, split and undo-merge via
 * the merged record's names; the SQL sponsor class agrees with the pure one.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { auditLog, companies, companyAliases, companyEvidence } from '../../src/db/schema';
import { sponsorClass, type SponsorSummaryView } from '../../src/components/companies/model';
import { EMPTY_COMPANY_FILTERS } from '../../src/components/companies/filters';
import { listCompanies, loadCompany, sponsorClassSql } from '../../src/lib/queries/companies';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCompany } from '../helpers/fixtures';

const IP = '203.0.113.77';

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

const actions = await import('../../src/lib/actions/companies');

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

function form(fields: Record<string, string | number | Array<string | number>>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) fd.append(k, String(x));
    else fd.set(k, String(v));
  }
  return fd;
}

async function alias(companyId: number, name: string, kind: 'brand' | 'legal' | 'ats_slug' | 'other' = 'brand'): Promise<number> {
  const [r] = await t.db.insert(companyAliases).values({ companyId, alias: name, normalizedAlias: name.toLowerCase(), kind });
  return Number(r.insertId);
}

async function audits(entityId: number) {
  return t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'company'), eq(auditLog.entityId, String(entityId))))
    .orderBy(asc(auditLog.id));
}

function summary(status: SponsorSummaryView['status']): SponsorSummaryView {
  return { status, sponsorCountries: [], historyCountries: [], possibleMatches: 0, registers: [], at: null, logicVersion: null };
}

describe('sponsor note', () => {
  it('needs a session and a real note', async () => {
    const id = await seedCompany(t.db, 'Initech');
    state.signedIn = false;
    await expect(actions.addSponsorNoteAction(undefined, form({ companyId: id, sponsors: 'yes', note: 'Recruiter said so' }))).rejects.toThrow(RedirectSignal);
    state.signedIn = true;
    const short = await actions.addSponsorNoteAction(undefined, form({ companyId: id, sponsors: 'yes', note: 'ok' }));
    expect(short.ok).toBe(false);
    const noFlag = await actions.addSponsorNoteAction(undefined, form({ companyId: id, note: 'Recruiter said so' }));
    expect(noFlag.ok).toBe(false);
    expect(await t.db.select().from(companyEvidence)).toHaveLength(0);
  });

  it('stores manual evidence that makes the company a confirmed sponsor; a later "no" supersedes it', async () => {
    const id = await seedCompany(t.db, 'Initech');
    const res = await actions.addSponsorNoteAction(undefined, form({ companyId: id, sponsors: 'yes', note: 'Recruiter confirmed on a call, 2026-09-28', url: 'https://initech.example.test/careers' }));
    expect(res.ok, res.error).toBe(true);
    const [ev] = await t.db.select().from(companyEvidence).where(eq(companyEvidence.companyId, id));
    expect(ev).toMatchObject({ kind: 'manual_note', method: 'manual', confidence: 'high', source: 'https://initech.example.test/careers' });
    expect(ev.valueJson).toEqual({ field: 'sponsors', sponsors: true, note: 'Recruiter confirmed on a call, 2026-09-28', url: 'https://initech.example.test/careers' });
    const [a] = await audits(id);
    expect(a).toMatchObject({ action: 'company.sponsor_note', ip: IP });
    expect((await loadCompany(id))!.sponsor).toBe('confirmed');
    expect((await listCompanies({ ...EMPTY_COMPANY_FILTERS, sponsor: ['confirmed'] })).rows.map((r) => r.id)).toEqual([id]);

    await actions.addSponsorNoteAction(undefined, form({ companyId: id, sponsors: 'no', note: 'HR says no sponsorship this year' }));
    const d = await loadCompany(id);
    expect(d!.sponsor).toBe('none');
    expect(d!.notes).toHaveLength(2);
    expect((await listCompanies({ ...EMPTY_COMPANY_FILTERS, sponsor: ['none'] })).rows.map((r) => r.id)).toEqual([id]);
  });

  it('the SQL sponsor class matches the pure one for every summary × note combination', async () => {
    const statuses: Array<SponsorSummaryView['status'] | null> = ['confirmed', 'likely', 'possible', 'unknown', null];
    const notes: Array<boolean | null> = [true, false, null];
    const expected = new Map<number, string>();
    for (const s of statuses) {
      for (const n of notes) {
        const id = await seedCompany(t.db);
        if (s) await t.db.update(companies).set({ sponsorSummaryJson: summary(s) }).where(eq(companies.id, id));
        if (n !== null) {
          // An older contrary note first: only the latest counts.
          await t.db.insert(companyEvidence).values({ companyId: id, kind: 'manual_note', valueJson: { field: 'sponsors', sponsors: !n, note: 'old' }, source: 'manual', method: 'manual', confidence: 'high', logicVersion: 'manual' });
          await t.db.insert(companyEvidence).values({ companyId: id, kind: 'manual_note', valueJson: { field: 'sponsors', sponsors: n, note: 'new' }, source: 'manual', method: 'manual', confidence: 'high', logicVersion: 'manual' });
        }
        expected.set(id, sponsorClass(s ? summary(s) : null, n === null ? null : { sponsors: n, note: 'new' }));
      }
    }
    const rows = await t.db.select({ id: companies.id, cls: sponsorClassSql }).from(companies);
    expect(rows).toHaveLength(15);
    for (const r of rows) expect([r.id, r.cls]).toEqual([r.id, expected.get(r.id)]);
  });
});

describe('agency and parent', () => {
  it('flags an agency (audited) and treats a repeat as nothing to do', async () => {
    const id = await seedCompany(t.db, 'Hays');
    const res = await actions.setAgencyAction(undefined, form({ companyId: id, isAgency: 'yes', reason: 'Recruitment agency' }));
    expect(res.ok, res.error).toBe(true);
    expect((await t.db.select().from(companies).where(eq(companies.id, id)))[0].isAgency).toBe(true);
    expect(state.refresh).toHaveBeenCalledTimes(1);
    const again = await actions.setAgencyAction(undefined, form({ companyId: id, isAgency: 'yes', reason: 'Recruitment agency' }));
    expect(again.ok).toBe(true);
    expect(again.message).toContain('already');
    expect(state.refresh).toHaveBeenCalledTimes(1);
    expect((await actions.setAgencyAction(undefined, form({ companyId: id, isAgency: 'maybe', reason: 'x y z' }))).ok).toBe(false);
  });

  it('links a parent, refuses a loop and can remove the link', async () => {
    const parent = await seedCompany(t.db, 'Globex Group');
    const child = await seedCompany(t.db, 'Globex Cloud');
    const res = await actions.setParentAction(undefined, form({ companyId: child, parentId: parent, reason: 'Subsidiary per annual report' }));
    expect(res.ok, res.error).toBe(true);
    const d = await loadCompany(child);
    expect(d!.parent?.id).toBe(parent);
    expect((await loadCompany(parent))!.subsidiaries.map((s) => s.id)).toEqual([child]);
    const loop = await actions.setParentAction(undefined, form({ companyId: parent, parentId: child, reason: 'Wrong way round' }));
    expect(loop.ok).toBe(false);
    const cleared = await actions.setParentAction(undefined, form({ companyId: child, parentId: '', reason: 'Sold off' }));
    expect(cleared.ok, cleared.error).toBe(true);
    expect((await loadCompany(child))!.parent).toBeNull();
  });
});

describe('merge, split and undo merge', () => {
  it('merges a duplicate, lists its names, and splitting those names off restores it', async () => {
    const keep = await seedCompany(t.db, 'Initech');
    const drop = await seedCompany(t.db, 'Initech GmbH');
    const dropAlias = await alias(drop, 'Initech GmbH', 'legal');
    await alias(keep, 'Initech', 'brand');

    const self = await actions.mergeCompaniesAction(undefined, form({ keepId: keep, dropId: keep, reason: 'Same company' }));
    expect(self.ok).toBe(false);
    const res = await actions.mergeCompaniesAction(undefined, form({ keepId: keep, dropId: drop, reason: 'Same company, legal name' }));
    expect(res.ok, res.error).toBe(true);
    expect(res.href).toBe(`/companies/${keep}`);
    expect((await t.db.select().from(companies).where(eq(companies.id, drop)))[0].mergedIntoId).toBe(keep);

    const d = await loadCompany(keep);
    expect(d!.mergedRecords.map((m) => m.id)).toEqual([drop]);
    expect(d!.mergedAliases).toEqual([{ id: dropAlias, alias: 'Initech GmbH', kind: 'legal', companyId: drop }]);
    expect((await loadCompany(drop))!.mergedInto?.id).toBe(keep);

    const undo = await actions.splitCompanyAction(undefined, form({ companyId: keep, aliasId: [dropAlias], reason: 'Different legal entity after all' }));
    expect(undo.ok, undo.error).toBe(true);
    expect(undo.href).toBe(`/companies/${drop}`);
    expect((await t.db.select().from(companies).where(eq(companies.id, drop)))[0].mergedIntoId).toBeNull();
    expect((await loadCompany(keep))!.mergedRecords).toEqual([]);
  });

  it('splits own names into a new company', async () => {
    const id = await seedCompany(t.db, 'Umbrella');
    const a1 = await alias(id, 'Umbrella');
    const a2 = await alias(id, 'Umbrella Pharma', 'legal');
    const none = await actions.splitCompanyAction(undefined, form({ companyId: id, reason: 'Two companies' }));
    expect(none).toMatchObject({ ok: false, error: 'Tick the names that belong to the other company.' });
    const bad = await actions.splitCompanyAction(undefined, form({ companyId: id, aliasId: ['x'], reason: 'Two companies' }));
    expect(bad.ok).toBe(false);
    const res = await actions.splitCompanyAction(undefined, form({ companyId: id, aliasId: [a2], name: 'Umbrella Pharma', reason: 'Two companies share the brand' }));
    expect(res.ok, res.error).toBe(true);
    expect(res.id).not.toBe(id);
    const [created] = await t.db.select().from(companies).where(eq(companies.id, res.id!));
    expect(created.name).toBe('Umbrella Pharma');
    expect((await t.db.select().from(companyAliases).where(eq(companyAliases.id, a2)))[0].companyId).toBe(res.id);
    expect((await t.db.select().from(companyAliases).where(eq(companyAliases.id, a1)))[0].companyId).toBe(id);
    expect((await t.db.select().from(auditLog)).every((a) => a.ip === IP)).toBe(true);
  });
});
