/**
 * DB-backed tests for the /applications and /kit Server Actions (src/lib/actions/applications.ts,
 * src/lib/actions/kit.ts): session first, zod validation, the write, the audit row with the
 * caller's IP and the refresh. Next's request APIs and the session check are mocked.
 */
import { and, asc, eq, like } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applicationEvents, applications, auditLog, reminders, resumeVersions, templates } from '../../src/db/schema';
import { localDayOf } from '../../src/lib/tracker/follow-up';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry } from '../helpers/fixtures';

const IP = '203.0.113.21';

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

const tracker = await import('../../src/lib/actions/applications');
const kit = await import('../../src/lib/actions/kit');

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

function form(fields: Record<string, string | number | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) for (const x of v) fd.append(k, x);
    else fd.set(k, String(v));
  }
  return fd;
}

async function auditsFor(entityType: string, entityId: number | string) {
  return t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, String(entityId))))
    .orderBy(asc(auditLog.id));
}

async function events(appId: number) {
  return t.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, appId)).orderBy(asc(applicationEvents.id));
}

async function logManual(extra: Record<string, string> = {}): Promise<number> {
  const res = await tracker.createManualApplicationAction(undefined, form({ companyName: 'Initech', title: 'Cloud Security Engineer', stage: 'applied', countryIso2: 'DE', ...extra }));
  expect(res.ok, res.error).toBe(true);
  return res.id!;
}

const dayPlus = (days: number) => localDayOf(new Date(Date.now() + days * 86_400_000), 'UTC');

describe('application actions', () => {
  it('needs a session before anything else', async () => {
    state.signedIn = false;
    await expect(tracker.createManualApplicationAction(undefined, form({ companyName: 'X', title: 'Y', stage: 'saved' }))).rejects.toThrow(RedirectSignal);
    expect(await t.db.select().from(applications)).toHaveLength(0);
  });

  it('logs a manual application with an audit row carrying the IP', async () => {
    await seedCountry(t.db, 'DE');
    const bad = await tracker.createManualApplicationAction(undefined, form({ companyName: '', title: 'Y', stage: 'applied' }));
    expect(bad).toMatchObject({ ok: false, error: 'Give the company name.' });
    const saved = await tracker.createManualApplicationAction(undefined, form({ companyName: 'X', title: 'Y', stage: 'saved', appliedDay: dayPlus(-1) }));
    expect(saved.ok).toBe(false);
    expect(state.refresh).not.toHaveBeenCalled();

    const id = await logManual({ appliedDay: dayPlus(-2), note: 'Referred by Sam' });
    const [row] = await t.db.select().from(applications).where(eq(applications.id, id));
    expect(row.currentStage).toBe('applied');
    expect(row.appliedAt).not.toBeNull();
    const audits = await auditsFor('application', id);
    expect(audits.map((a) => a.action)).toContain('application.create');
    expect(audits.every((a) => a.ip === IP)).toBe(true);
    expect(state.refresh).toHaveBeenCalledTimes(1);
  });

  it('moves stages along the machine and refuses the moves it does not allow', async () => {
    await seedCountry(t.db, 'DE');
    const id = await logManual();
    const before = (await events(id)).length;
    const ok = await tracker.changeStageAction(undefined, form({ applicationId: id, stageTo: 'screening', note: 'Recruiter call booked' }));
    expect(ok.ok, ok.error).toBe(true);
    expect((await t.db.select().from(applications).where(eq(applications.id, id)))[0].currentStage).toBe('screening');
    const no = await tracker.changeStageAction(undefined, form({ applicationId: id, stageTo: 'saved' }));
    expect(no.ok).toBe(false);
    expect((await events(id)).length).toBe(before + 1);
    const future = await tracker.changeStageAction(undefined, form({ applicationId: id, stageTo: 'technical', occurredDay: dayPlus(3) }));
    expect(future).toMatchObject({ ok: false });
  });

  it('comments, follow-ups and reminders land on the timeline', async () => {
    await seedCountry(t.db, 'DE');
    const id = await logManual();
    const empty = await tracker.addCommentAction(undefined, form({ applicationId: id }));
    expect(empty.ok).toBe(false);
    const c = await tracker.addCommentAction(undefined, form({ applicationId: id, body: 'Went well', interviewer: 'Dana (EM)', questions: 'IAM, threat models' }));
    expect(c.ok, c.error).toBe(true);

    const past = await tracker.setFollowUpAction(undefined, form({ applicationId: id, day: dayPlus(-3), time: '09:00' }));
    expect(past.ok).toBe(false);
    const f = await tracker.setFollowUpAction(undefined, form({ applicationId: id, day: dayPlus(5), time: '09:30', note: 'Ping the recruiter' }));
    expect(f.ok, f.error).toBe(true);
    const open = (await t.db.select().from(reminders).where(eq(reminders.applicationId, id))).filter((r) => r.doneAt === null);
    expect(open).toHaveLength(1);

    const done = await tracker.completeReminderAction(undefined, form({ reminderId: open[0].id, note: 'Sent' }));
    expect(done.ok, done.error).toBe(true);
    const [r] = await t.db.select().from(reminders).where(eq(reminders.id, open[0].id));
    expect(r.doneAt).not.toBeNull();
    const again = await tracker.completeReminderAction(undefined, form({ reminderId: open[0].id }));
    expect(again.ok).toBe(false);
    const kinds = (await events(id)).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(['comment', 'follow_up_set']));
  });

  it('edits keep the unchanged applied day and log the change', async () => {
    await seedCountry(t.db, 'DE');
    const id = await logManual({ appliedDay: dayPlus(-4) });
    const [before] = await t.db.select().from(applications).where(eq(applications.id, id));
    const res = await tracker.editApplicationAction(undefined, form({ applicationId: id, title: 'Senior Cloud Security Engineer', appliedDay: dayPlus(-4), appliedDayWas: dayPlus(-4), reason: 'Title on the offer' }));
    expect(res.ok, res.error).toBe(true);
    const [after] = await t.db.select().from(applications).where(eq(applications.id, id));
    expect(after.title).toBe('Senior Cloud Security Engineer');
    expect(after.appliedAt?.getTime()).toBe(before.appliedAt?.getTime());
    const edit = (await events(id)).at(-1)!;
    expect(edit.kind).toBe('edit');
  });

  it('records the resume version sent', async () => {
    await seedCountry(t.db, 'DE');
    const id = await logManual();
    const [res] = await t.db.insert(resumeVersions).values({ name: 'Cloud EU', track: 'cloud_security', contentMd: '# CV' });
    const rv = Number(res.insertId);
    const ok = await tracker.setResumeVersionAction(undefined, form({ applicationId: id, resumeVersionId: rv }));
    expect(ok.ok, ok.error).toBe(true);
    expect((await t.db.select().from(applications).where(eq(applications.id, id)))[0].resumeVersionId).toBe(rv);
  });
});

describe('kit actions', () => {
  it('creates, updates and copies resume versions; a used version cannot be deleted', async () => {
    const created = await kit.saveResumeAction(undefined, form({ name: 'Cloud EU', track: 'cloud_security', contentMd: '# Abhishek\n- AWS' }));
    expect(created.ok, created.error).toBe(true);
    const id = created.id!;
    const same = await kit.saveResumeAction(undefined, form({ id, name: 'Cloud EU', track: 'cloud_security', contentMd: '# Abhishek\n- AWS' }));
    expect(same).toMatchObject({ ok: false, error: 'Nothing changed.' });
    const copy = await kit.saveResumeAction(undefined, form({ id, name: 'Cloud EU v2', track: 'cloud_security', contentMd: '# Abhishek\n- AWS\n- GCP', asNew: '1' }));
    expect(copy.ok, copy.error).toBe(true);
    expect(copy.id).not.toBe(id);
    expect(await t.db.select().from(resumeVersions)).toHaveLength(2);
    expect((await auditsFor('resume_version', copy.id!))[0].afterJson).toMatchObject({ copiedFrom: id });

    await seedCountry(t.db, 'DE');
    const appId = await logManual();
    await tracker.setResumeVersionAction(undefined, form({ applicationId: appId, resumeVersionId: id }));
    const blocked = await kit.deleteResumeAction(undefined, form({ id }));
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toContain('recorded on 1 application');
    const gone = await kit.deleteResumeAction(undefined, form({ id: copy.id! }));
    expect(gone.ok, gone.error).toBe(true);
    expect((await auditsFor('resume_version', copy.id!)).map((a) => a.action)).toEqual(['resume.create', 'resume.delete']);
  });

  it('templates: CV conventions need a known country; fields are validated; delete is audited', async () => {
    const noCountry = await kit.saveTemplateAction(undefined, form({ kind: 'cv_convention', name: 'DE CV', bodyMd: 'Photo: optional' }));
    expect(noCountry.ok).toBe(false);
    const unknown = await kit.saveTemplateAction(undefined, form({ kind: 'cv_convention', name: 'ZZ CV', bodyMd: 'x', countryIso2: 'ZZ' }));
    expect(unknown).toMatchObject({ ok: false, error: 'Unknown country “ZZ”.' });
    const badFields = await kit.saveTemplateAction(undefined, form({ kind: 'cover_letter', name: 'Cover', bodyMd: 'Dear {{name}}', fieldLines: '1bad | Label' }));
    expect(badFields.ok).toBe(false);

    await seedCountry(t.db, 'DE');
    const ok = await kit.saveTemplateAction(undefined, form({ kind: 'cv_convention', name: 'DE CV', bodyMd: 'Photo: optional', countryIso2: 'de' }));
    expect(ok.ok, ok.error).toBe(true);
    const [row] = await t.db.select().from(templates).where(eq(templates.id, ok.id!));
    expect(row.countryIso2).toBe('DE');
    const del = await kit.deleteTemplateAction(undefined, form({ id: ok.id! }));
    expect(del.ok, del.error).toBe(true);
    const rows = await t.db.select().from(auditLog).where(like(auditLog.action, 'template.%')).orderBy(asc(auditLog.id));
    expect(rows.map((a) => a.action)).toEqual(['template.create', 'template.delete']);
    expect(rows.every((a) => a.ip === IP)).toBe(true);
  });
});
