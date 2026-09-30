/**
 * DB-backed tracker tests (startTestDb): stage machine enforcement, corrections, the append-only
 * timeline, edits with before/after, follow-up reminders, manual applications, stats and export.
 */
import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applicationEvents, applications, applicationSnapshots, auditLog, reminders, resumeVersions } from '../../src/db/schema';
import { addFact } from '../../src/lib/provenance/store';
import {
  TrackerError,
  addApplicationEvent,
  addComment,
  completeReminder,
  createApplicationFromJob,
  createManualApplication,
  editApplication,
  loadTrackerStats,
} from '../../src/lib/tracker';
import { buildTrackerExport, exportCsv } from '../../src/lib/tracker/export';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry, seedJob } from '../helpers/fixtures';

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
});

afterAll(async () => {
  await t?.stop();
});

beforeEach(async () => {
  await t.truncateAll();
});

const posting = 'About us\nWe secure clouds.\n\nRequirements\n- AWS\n- Terraform\n\nBenefits\n- Lunch';

async function events(appId: number) {
  return t.db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, appId)).orderBy(asc(applicationEvents.id));
}

async function appRow(appId: number) {
  const [row] = await t.db.select().from(applications).where(eq(applications.id, appId));
  return row;
}

async function openReminders(appId: number) {
  return t.db
    .select()
    .from(reminders)
    .where(eq(reminders.applicationId, appId))
    .orderBy(asc(reminders.id))
    .then((rows) => rows.filter((r) => r.doneAt === null));
}

describe('createApplicationFromJob', () => {
  it('applies with a snapshot of description, requirements, link and salary', async () => {
    const { jobId } = await seedJob(t.db, { companyName: 'Initech', descriptionText: posting, descriptionHtmlSanitized: '<p>We secure clouds.</p>', applyUrl: 'https://jobs.example.test/1' });
    await addFact(t.db, jobId, 'salary', {
      value: { annualEurMin: 70_000, annualEurMax: 90_000, kind: 'stated' },
      evidence: '€70k–€90k',
      source: 'posting',
      method: 'posting',
      confidence: 'high',
      checkedAt: new Date(),
      logicVersion: 'test-1',
    });
    const res = await createApplicationFromJob(t.db, jobId, { stage: 'applied', note: 'CV v7', ip: '198.51.100.7' });
    expect(res.created).toBe(true);
    const [snap] = await t.db.select().from(applicationSnapshots).where(eq(applicationSnapshots.applicationId, res.applicationId));
    expect(snap).toMatchObject({ applyUrl: 'https://jobs.example.test/1', requirementsText: '- AWS\n- Terraform', descriptionHtmlSanitized: '<p>We secure clouds.</p>' });
    expect(snap.salaryJson).toMatchObject({ value: { annualEurMin: 70_000 } });
    expect(snap.jobJson).toMatchObject({ jobId, company: 'Initech' });
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'application.create'));
    expect(a.ip).toBe('198.51.100.7');
  });
});

describe('stage machine on the timeline', () => {
  it('refuses moves the machine does not allow, without writing anything', async () => {
    const { jobId } = await seedJob(t.db);
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'saved' });
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'rejected' })).rejects.toThrow(/applied first/);
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'saved' })).rejects.toBeInstanceOf(TrackerError);
    expect(await events(applicationId)).toHaveLength(1);
    expect((await appRow(applicationId)).currentStage).toBe('saved');
  });

  it('skipping "applied" still sets applied_at and takes the snapshot', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: posting });
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'saved' });
    const moved = await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'screening' });
    expect(moved.snapshotId).not.toBeNull();
    const row = await appRow(applicationId);
    expect(row.appliedAt).toBeInstanceOf(Date);
    expect(row.currentStage).toBe('screening');
  });

  it('logs repeated technical rounds and needs a reason for a correction', async () => {
    const { jobId } = await seedJob(t.db);
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'technical' });
    await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'technical', body: 'Round 2: system design' });
    await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'offer' });
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'final' })).rejects.toThrow(/correction/);
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'final', correction: true })).rejects.toThrow(/reason/);
    await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'final', correction: true, body: 'Clicked offer by mistake', meta: { round: 3 } }, { ip: '203.0.113.1' });
    const evs = await events(applicationId);
    expect(evs.map((e) => [e.stageFrom, e.stageTo])).toEqual([
      [null, 'applied'],
      ['applied', 'technical'],
      ['technical', 'technical'],
      ['technical', 'offer'],
      ['offer', 'final'],
    ]);
    expect(evs.at(-1)?.metaJson).toEqual({ round: 3, correction: true });
    const [audit] = await t.db.select().from(auditLog).where(and(eq(auditLog.entityType, 'application'), eq(auditLog.reason, 'Clicked offer by mistake')));
    expect(audit).toMatchObject({ action: 'application.stage_change', ip: '203.0.113.1' });
    // The stats do not count the mistaken offer.
    const stats = await loadTrackerStats(t.db);
    expect(stats.overall).toMatchObject({ applied: 1, offers: 0, interviews: 1 });
  });

  it('closing an application closes its reminders; closed ones cannot get a follow-up', async () => {
    const { jobId } = await seedJob(t.db);
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    await addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: new Date('2026-10-07T04:30:00Z'), body: 'Chase recruiter' });
    expect(await openReminders(applicationId)).toHaveLength(1);
    await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'rejected', body: 'Form email' });
    expect(await openReminders(applicationId)).toHaveLength(0);
    const row = await appRow(applicationId);
    expect(row.nextFollowUpAt).toBeNull();
    expect((await events(applicationId)).at(-1)?.metaJson).toEqual({ remindersClosed: 1 });
    await expect(addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: new Date('2026-10-09T04:30:00Z') })).rejects.toThrow(/nothing to follow up/);
  });
});

describe('append-only timeline', () => {
  it('edits are new events with before/after; earlier events never change', async () => {
    const { jobId } = await seedJob(t.db, { title: 'Cloud Sec Eng', companyName: 'Initech' });
    await seedCountry(t.db, 'NL');
    const [rv] = await t.db.insert(resumeVersions).values({ name: 'Cloud v2', track: 'cloud_security', contentMd: '# CV' });
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    const before = await events(applicationId);

    const res = await editApplication(t.db, applicationId, { title: 'Cloud Security Engineer', countryIso2: 'nl', resumeVersionId: Number(rv.insertId), source: '  ' }, { ip: '203.0.113.2' });
    const evs = await events(applicationId);
    expect(evs.slice(0, before.length)).toEqual(before);
    const edit = evs.find((e) => e.id === res.eventId)!;
    expect(edit.kind).toBe('edit');
    expect(edit.metaJson).toMatchObject({
      before: { title: 'Cloud Sec Eng', countryIso2: 'DE', resumeVersionId: null },
      after: { title: 'Cloud Security Engineer', countryIso2: 'NL', resumeVersionId: Number(rv.insertId), source: null },
      names: { resumeVersionId: { before: null, after: 'Cloud v2' } },
    });
    expect(edit.body).toContain('resume version: none → Cloud v2');
    const row = await appRow(applicationId);
    expect(row).toMatchObject({ title: 'Cloud Security Engineer', countryIso2: 'NL', resumeVersionId: Number(rv.insertId), source: null });

    await expect(editApplication(t.db, applicationId, { title: 'Cloud Security Engineer' })).rejects.toThrow(/Nothing changed/);
    await expect(editApplication(t.db, applicationId, { countryIso2: 'ZZ' })).rejects.toThrow(/Unknown country/);
    await expect(editApplication(t.db, applicationId, { title: '   ' })).rejects.toThrow(/cannot be empty/);
    await expect(editApplication(t.db, applicationId, { resumeVersionId: 999 })).rejects.toThrow(/not found/);
    expect(await events(applicationId)).toHaveLength(evs.length);
  });

  it('comments carry the interview fields', async () => {
    const { jobId } = await seedJob(t.db);
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    await addComment(t.db, applicationId, { fields: { interviewer: 'Priya (EM)', questions: 'Design an IAM boundary', wentWell: '', nextSteps: 'Take-home by Fri' } });
    await addComment(t.db, applicationId, { body: 'Sent thank-you note' });
    await expect(addComment(t.db, applicationId, { body: ' ', fields: { interviewer: ' ' } })).rejects.toThrow(/Write a comment/);
    const evs = (await events(applicationId)).filter((e) => e.kind === 'comment');
    expect(evs.map((e) => [e.body, e.metaJson])).toEqual([
      ['Interview notes', { interviewer: 'Priya (EM)', questions: 'Design an IAM boundary', next_steps: 'Take-home by Fri' }],
      ['Sent thank-you note', null],
    ]);
  });
});

describe('follow-up reminders', () => {
  it('a new follow-up supersedes the open one; completing moves on to the next open one', async () => {
    const { jobId } = await seedJob(t.db);
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
    const first = new Date('2026-10-07T04:30:00Z');
    const second = new Date('2026-10-09T04:30:00Z');
    await addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: first, body: 'Chase' });
    await addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: second, body: 'Chase later' });
    const open = await openReminders(applicationId);
    expect(open.map((r) => [r.dueAt.toISOString(), r.note])).toEqual([[second.toISOString(), 'Chase later']]);
    expect((await appRow(applicationId)).nextFollowUpAt?.toISOString()).toBe(second.toISOString());

    const done = await completeReminder(t.db, open[0].id, { note: 'Emailed the recruiter', ip: '203.0.113.3' });
    expect(done.applicationId).toBe(applicationId);
    expect(await openReminders(applicationId)).toHaveLength(0);
    expect((await appRow(applicationId)).nextFollowUpAt).toBeNull();
    const last = (await events(applicationId)).at(-1)!;
    expect(last).toMatchObject({ kind: 'follow_up_set', body: 'Emailed the recruiter' });
    expect(last.metaJson).toMatchObject({ done: true, reminderId: open[0].id, followUpAt: null });
    await expect(completeReminder(t.db, open[0].id)).rejects.toThrow(/already done/);
    await expect(completeReminder(t.db, 99_999)).rejects.toBeInstanceOf(TrackerError);
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'application.reminder_done'));
    expect(a.ip).toBe('203.0.113.3');
  });
});

describe('manual applications', () => {
  it('logs an application without a job and keeps the pasted posting as its snapshot', async () => {
    await seedCountry(t.db, 'IE');
    const appliedAt = new Date(Date.now() - 3 * 86_400_000);
    const res = await createManualApplication(t.db, {
      companyName: '  Stripe ',
      title: 'Security Engineer, Cloud',
      stage: 'screening',
      countryIso2: 'ie',
      source: 'Referral',
      appliedAt,
      note: 'Referred by Anu',
      postingUrl: 'https://stripe.example.test/jobs/1',
      postingText: posting,
    });
    expect(res).toMatchObject({ created: true });
    const row = await appRow(res.applicationId);
    expect(row).toMatchObject({ jobId: null, companyName: 'Stripe', countryIso2: 'IE', currentStage: 'screening', source: 'Referral' });
    expect(row.appliedAt?.getTime()).toBe(appliedAt.getTime());
    const [snap] = await t.db.select().from(applicationSnapshots).where(eq(applicationSnapshots.applicationId, res.applicationId));
    expect(snap).toMatchObject({ applyUrl: 'https://stripe.example.test/jobs/1', requirementsText: '- AWS\n- Terraform' });
    expect(snap.jobJson).toMatchObject({ manual: true, jobId: null, company: 'Stripe' });
    expect((await events(res.applicationId)).map((e) => [e.stageTo, e.body])).toEqual([['screening', 'Referred by Anu']]);
    // No job → a snapshot event is refused.
    await expect(addApplicationEvent(t.db, res.applicationId, { kind: 'snapshot' })).rejects.toThrow(/no job/);
  });

  it('validates stage, names, country and dates', async () => {
    await expect(createManualApplication(t.db, { companyName: 'X', title: 'Y', stage: 'accepted' as never })).rejects.toThrow(/cannot start/);
    await expect(createManualApplication(t.db, { companyName: ' ', title: 'Y', stage: 'saved' })).rejects.toThrow(/company/);
    await expect(createManualApplication(t.db, { companyName: 'X', title: 'Y', stage: 'applied', countryIso2: 'ZZ' })).rejects.toThrow(/Unknown country/);
    await expect(createManualApplication(t.db, { companyName: 'X', title: 'Y', stage: 'applied', appliedAt: new Date(Date.now() + 5 * 86_400_000) })).rejects.toThrow(/future/);
    expect(await t.db.select().from(applications)).toHaveLength(0);
    const saved = await createManualApplication(t.db, { companyName: 'X', title: 'Y', stage: 'saved', appliedAt: new Date() });
    expect((await appRow(saved.applicationId)).appliedAt).toBeNull();
    expect((await appRow(saved.applicationId)).source).toBe('manual');
  });
});

describe('stats and export', () => {
  it('groups by country, source and role with the small-sample flag', async () => {
    for (let i = 0; i < 5; i++) {
      const { jobId } = await seedJob(t.db, { countryIso2: 'DE' });
      const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied' });
      if (i < 2) await addApplicationEvent(t.db, applicationId, { kind: 'stage_change', stageTo: 'screening' });
    }
    await seedCountry(t.db, 'NL', 'Netherlands');
    await createManualApplication(t.db, { companyName: 'Adyen', title: 'DevSecOps Engineer', stage: 'applied', countryIso2: 'NL', source: 'LinkedIn' });
    const s = await loadTrackerStats(t.db);
    expect(s.overall).toMatchObject({ applied: 6, responded: 2, interviews: 2, conclusive: true });
    expect(s.byCountry.map((g) => [g.key, g.applied, g.conclusive])).toEqual([
      ['DE', 5, true],
      ['NL', 1, false],
    ]);
    expect(s.byCountry[1].label).toBe('Netherlands');
    expect(s.bySource.find((g) => g.label === 'LinkedIn')).toMatchObject({ applied: 1, conclusive: false });
    expect(s.byRole.length).toBeGreaterThan(0);
  });

  it('exports applications with events, snapshots and reminders', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: posting, companyName: 'Initech' });
    const { applicationId } = await createApplicationFromJob(t.db, jobId, { stage: 'applied', note: '=cmd|calc' });
    await addComment(t.db, applicationId, { body: 'Call, went "well"', fields: { interviewer: 'Sam' } });
    await addApplicationEvent(t.db, applicationId, { kind: 'follow_up_set', followUpAt: new Date('2026-10-07T04:30:00Z') });
    const data = await buildTrackerExport(t.db, { timeZone: 'Asia/Kolkata', now: new Date('2026-09-30T06:00:00Z') });
    expect(data.counts).toEqual({ applications: 1, events: 3, snapshots: 1, reminders: 1 });
    expect(data.applications[0]).toMatchObject({ companyName: 'Initech', currentStage: 'applied' });
    expect(data.applications[0].snapshots[0].requirementsText).toBe('- AWS\n- Terraform');
    const eventsCsv = exportCsv(data, 'events');
    expect(eventsCsv).toContain('"Call, went ""well"""');
    expect(eventsCsv).toContain("'=cmd|calc");
    expect(eventsCsv.split('\r\n')[0]).toContain('interviewer');
    expect(exportCsv(data, 'snapshots')).toContain('- AWS');
    expect(exportCsv(data, 'applications').split('\r\n')).toHaveLength(3);
  });
});
