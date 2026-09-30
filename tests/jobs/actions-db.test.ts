/**
 * DB-backed tests for the /jobs Server Actions (src/lib/actions/jobs.ts): session first, zod
 * validation, the write, the audit row (with the caller's IP) and the refresh. Next's request APIs,
 * the session check and the AI client are mocked — no network, no OpenRouter.
 */
import { and, desc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applications, auditLog, corrections, jobFacts, jobOverrides, jobs } from '../../src/db/schema';
import type { AiBudget, AiExtractResult } from '../../src/lib/ai';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedJob } from '../helpers/fixtures';

const IP = '203.0.113.9';

const state = vi.hoisted(() => ({
  signedIn: true,
  budget: null as null | Partial<AiBudget>,
  extract: vi.fn(),
  refresh: vi.fn(),
}));

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
vi.mock('@/lib/ai', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/ai')>();
  return {
    ...real,
    getAiBudget: async (...args: Parameters<typeof real.getAiBudget>) => ({ ...(await real.getAiBudget(...args)), ...(state.budget ?? {}) }),
    aiExtract: (...args: Parameters<typeof real.aiExtract>) => state.extract(...args),
  };
});

// Imported after the mocks are registered (vi.mock is hoisted above these anyway).
const actions = await import('../../src/lib/actions/jobs');

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
  state.budget = null;
  state.extract.mockReset();
  state.refresh.mockReset();
});

function form(fields: Record<string, string | number>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, String(v));
  return fd;
}

async function audits(jobId: number) {
  return t.db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'job'), eq(auditLog.entityId, String(jobId))))
    .orderBy(auditLog.id);
}

async function jobRow(jobId: number) {
  const [row] = await t.db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
  return row;
}

describe('session and validation', () => {
  it('every action redirects to /login without a session and writes nothing', async () => {
    const { jobId } = await seedJob(t.db);
    state.signedIn = false;
    const calls: [string, Promise<unknown>][] = [
      ['save', actions.toggleSaveAction(undefined, form({ jobId, saved: '1' }))],
      ['hide', actions.setHiddenAction(undefined, form({ jobId, hidden: '1' }))],
      ['apply', actions.markAppliedAction(undefined, form({ jobId }))],
      ['report', actions.reportWrongInfoAction(undefined, form({ jobId, field: 'visa_status', v_status: 'likely' }))],
      ['override', actions.overrideFieldAction(undefined, form({ jobId, field: 'visa_status', v_status: 'likely', reason: 'because' }))],
      ['clear', actions.clearOverrideAction(undefined, form({ jobId, field: 'visa_status', reason: 'because' }))],
      ['ai', actions.askAiSummaryAction(undefined, form({ jobId }))],
    ];
    for (const [name, p] of calls) await expect(p, name).rejects.toBeInstanceOf(RedirectSignal);
    expect(await audits(jobId)).toHaveLength(0);
    expect(await jobRow(jobId)).toMatchObject({ saved: false, hidden: false });
    expect(await t.db.select().from(applications)).toHaveLength(0);
    expect(state.extract).not.toHaveBeenCalled();
    expect(state.refresh).not.toHaveBeenCalled();
  });

  it('rejects bad input with a form error and no write', async () => {
    const { jobId } = await seedJob(t.db);
    expect(await actions.toggleSaveAction(undefined, form({ jobId: 'abc', saved: '1' }))).toMatchObject({ ok: false });
    expect(await actions.setHiddenAction(undefined, form({ jobId, hidden: '1', reason: 'x'.repeat(256) }))).toMatchObject({
      ok: false,
      error: 'Keep the reason under 255 characters.',
    });
    expect(await actions.overrideFieldAction(undefined, form({ jobId, field: 'visa_status', v_status: 'likely', reason: 'x' }))).toMatchObject({
      ok: false,
      error: 'Give a short reason (3+ characters).',
    });
    expect(await actions.overrideFieldAction(undefined, form({ jobId, field: 'salary_band', reason: 'because' }))).toMatchObject({ ok: false });
    expect(await actions.overrideFieldAction(undefined, form({ jobId, field: 'visa_status', v_status: 'maybe', reason: 'because' }))).toMatchObject({
      ok: false,
      error: 'Pick a visa status.',
    });
    expect(await actions.toggleSaveAction(undefined, form({ jobId: jobId + 999, saved: '1' }))).toMatchObject({ ok: false, error: 'That job no longer exists.' });
    expect(await audits(jobId)).toHaveLength(0);
    expect(await t.db.select().from(jobOverrides)).toHaveLength(0);
    expect(state.refresh).not.toHaveBeenCalled();
  });
});

describe('save, hide, mark applied', () => {
  it('saves and unsaves with an audit row each', async () => {
    const { jobId } = await seedJob(t.db);
    expect(await actions.toggleSaveAction(undefined, form({ jobId, saved: '1' }))).toMatchObject({ ok: true, message: 'Saved to your shortlist.' });
    expect((await jobRow(jobId)).saved).toBe(true);
    expect(await actions.toggleSaveAction(undefined, form({ jobId }))).toMatchObject({ ok: true, message: 'Removed from your shortlist.' });
    expect((await jobRow(jobId)).saved).toBe(false);
    const rows = await audits(jobId);
    expect(rows.map((r) => [r.action, r.beforeJson, r.afterJson, r.ip])).toEqual([
      ['job.save', { saved: false }, { saved: true }, IP],
      ['job.unsave', { saved: true }, { saved: false }, IP],
    ]);
    expect(state.refresh).toHaveBeenCalledTimes(2);
  });

  it('hides with a reason and unhides clearing it', async () => {
    const { jobId } = await seedJob(t.db);
    await actions.setHiddenAction(undefined, form({ jobId, hidden: '1', reason: 'needs Dutch, per recruiter' }));
    expect(await jobRow(jobId)).toMatchObject({ hidden: true, hiddenReason: 'needs Dutch, per recruiter' });
    await actions.setHiddenAction(undefined, form({ jobId, hidden: '0' }));
    expect(await jobRow(jobId)).toMatchObject({ hidden: false, hiddenReason: null });
    const rows = await audits(jobId);
    expect(rows.map((r) => [r.action, r.reason])).toEqual([
      ['job.hide', 'needs Dutch, per recruiter'],
      ['job.unhide', null],
    ]);
  });

  it('marks applied once and reports the existing application the second time', async () => {
    const { jobId } = await seedJob(t.db);
    const first = await actions.markAppliedAction(undefined, form({ jobId, note: 'CV v7' }));
    expect(first).toMatchObject({ ok: true });
    expect(first.message).toMatch(/^Application logged in the tracker\./);
    const [app] = await t.db.select().from(applications).where(eq(applications.jobId, jobId));
    expect(app).toMatchObject({ id: first.applicationId, currentStage: 'applied' });
    const second = await actions.markAppliedAction(undefined, form({ jobId }));
    expect(second).toMatchObject({ ok: true, applicationId: first.applicationId });
    expect(second.message).toBe('The tracker already has this application at "applied", so its stage was left alone.');
    const marks = (await audits(jobId)).filter((r) => r.action === 'job.mark_applied');
    expect(marks.map((r) => (r.afterJson as { created: boolean }).created)).toEqual([true, false]);
    expect(marks.every((r) => r.ip === IP)).toBe(true);
  });

  it('never claims to move an application that is already past "applied"', async () => {
    const { jobId } = await seedJob(t.db);
    const first = await actions.markAppliedAction(undefined, form({ jobId }));
    await t.db.update(applications).set({ currentStage: 'technical' }).where(eq(applications.id, first.applicationId!));
    const again = await actions.markAppliedAction(undefined, form({ jobId, note: 'Second round booked' }));
    expect(again).toMatchObject({ ok: true, applicationId: first.applicationId });
    expect(again.message).toBe('The tracker already has this application at "technical", so its stage was left alone. Your note was added to it.');
    const [app] = await t.db.select().from(applications).where(eq(applications.id, first.applicationId!));
    expect(app.currentStage).toBe('technical');
    const marks = (await audits(jobId)).filter((r) => r.action === 'job.mark_applied');
    expect((marks.at(-1)?.afterJson as { stage: string }).stage).toBe('technical');
  });

  it('moves a saved application on to "applied" and snapshots the posting', async () => {
    const { jobId } = await seedJob(t.db);
    const first = await actions.markAppliedAction(undefined, form({ jobId }));
    await t.db.update(applications).set({ currentStage: 'saved' }).where(eq(applications.id, first.applicationId!));
    const again = await actions.markAppliedAction(undefined, form({ jobId }));
    expect(again.message).toBe('The tracker already had this job — it is now at "applied". The posting was snapshotted.');
    const [app] = await t.db.select().from(applications).where(eq(applications.id, first.applicationId!));
    expect(app.currentStage).toBe('applied');
  });
});

describe('corrections and overrides', () => {
  it('records a correction, and needs a note when the correct value is unknown', async () => {
    const { jobId } = await seedJob(t.db);
    expect(await actions.reportWrongInfoAction(undefined, form({ jobId, field: 'visa_status', knowsCorrect: 'no' }))).toMatchObject({
      ok: false,
      error: 'Say what is wrong in the note when you do not know the correct value.',
    });
    expect(await actions.reportWrongInfoAction(undefined, form({ jobId, field: 'visa_status', knowsCorrect: 'maybe', note: 'x' }))).toMatchObject({
      ok: false,
      error: 'Say whether you know the correct value.',
    });
    expect(await actions.reportWrongInfoAction(undefined, form({ jobId, field: 'visa_status', knowsCorrect: 'no', note: 'x', applyAsOverride: '1' }))).toMatchObject({
      ok: false,
      error: 'An override needs the correct value.',
    });
    const res = await actions.reportWrongInfoAction(undefined, form({ jobId, field: 'visa_status', v_status: 'not_offered', note: 'Recruiter said no sponsorship' }));
    expect(res).toMatchObject({ ok: true });
    expect(res.message).toMatch(/^Correction recorded/);
    const [c] = await t.db.select().from(corrections).where(eq(corrections.jobId, jobId));
    expect(c).toMatchObject({ field: 'visa_status', note: 'Recruiter said no sponsorship' });
    expect(await t.db.select().from(jobOverrides)).toHaveLength(0);

    const withOverride = await actions.reportWrongInfoAction(undefined, form({ jobId, field: 'visa_status', v_status: 'not_offered', applyAsOverride: '1' }));
    expect(withOverride.message).toMatch(/applied as an override/);
    const [ov] = await t.db.select().from(jobOverrides).where(eq(jobOverrides.jobId, jobId));
    expect(ov).toMatchObject({ field: 'visa_status', active: true });
    expect((await jobRow(jobId)).visaStatus).toBe('not_offered');
  });

  it('sets, replaces and removes an override (audited with the IP)', async () => {
    const { jobId } = await seedJob(t.db);
    const set = (status: string, reason: string) => actions.overrideFieldAction(undefined, form({ jobId, field: 'visa_status', v_status: status, reason }));
    expect(await set('likely', 'Recruiter hinted at it')).toMatchObject({ ok: true, message: 'Override set — it now beats every other source.' });
    expect(await set('confirmed', 'HR confirmed by email')).toMatchObject({ ok: true, message: 'Override replaced.' });
    expect((await jobRow(jobId)).visaStatus).toBe('confirmed');

    const clear = () => actions.clearOverrideAction(undefined, form({ jobId, field: 'visa_status', reason: 'Email was about another team' }));
    expect(await clear()).toMatchObject({ ok: true, message: 'Override removed — the evidence decides again.' });
    expect(await clear()).toMatchObject({ ok: false, error: 'There was no active override on that field.' });

    const rows = await audits(jobId);
    expect(rows.map((r) => [r.action, r.reason, r.ip])).toEqual([
      ['job.override.set', 'Recruiter hinted at it', IP],
      ['job.override.set', 'HR confirmed by email', IP],
      ['job.override.clear', 'Email was about another team', IP],
    ]);
    const all = await t.db.select().from(jobOverrides).where(eq(jobOverrides.jobId, jobId));
    expect(all.every((o) => !o.active && o.deactivatedAt instanceof Date)).toBe(true);
  });

  it('writes a column override to the job row', async () => {
    const { jobId } = await seedJob(t.db, { countryIso2: 'IE', city: 'Dublin' });
    const res = await actions.overrideFieldAction(undefined, form({ jobId, field: 'city', v_city: '  Dublin   2 ', reason: 'Office address on the careers page' }));
    expect(res).toMatchObject({ ok: true });
    expect((await jobRow(jobId)).city).toBe('Dublin 2');
  });
});

describe('askAiSummaryAction', () => {
  const summaryFact = (summary: string) => ({
    key: 'ai_summary' as const,
    fact: {
      value: { summary },
      evidence: 'We are hiring a cloud security engineer.',
      source: 'ai:test-model',
      method: 'ai' as const,
      confidence: 'medium' as const,
      checkedAt: new Date('2026-09-30T06:00:00.000Z'),
      logicVersion: 'ai-summary@test',
    },
  });

  it('makes no call while AI is off or the budget is used up', async () => {
    const { jobId } = await seedJob(t.db);
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({ ok: false, error: 'AI is switched off, so no call was made.' });
    state.budget = { enabled: true, used: 5, limit: 5, remaining: 0 };
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({ ok: false, error: "Today's AI budget is used up (5/5). No call was made." });
    expect(state.extract).not.toHaveBeenCalled();
    expect(await audits(jobId)).toHaveLength(0);
  });

  it('stores the summary fact once and audits the call', async () => {
    const { jobId } = await seedJob(t.db);
    state.budget = { enabled: true, used: 1, limit: 20, remaining: 19 };
    state.extract.mockResolvedValue({ ok: true, cached: false, rejected: 0, facts: [summaryFact('Cloud security role, EU remote.')] } satisfies AiExtractResult);
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({ ok: true, message: 'Summary added.' });
    expect(state.extract).toHaveBeenCalledTimes(1);
    expect(state.extract.mock.calls[0][1]).toMatchObject({ jobId, task: 'summary', manual: true });
    const facts = await t.db.select().from(jobFacts).where(and(eq(jobFacts.jobId, jobId), eq(jobFacts.factKey, 'ai_summary')));
    expect(facts.map((f) => f.valueJson)).toEqual([{ summary: 'Cloud security role, EU remote.' }]);

    state.extract.mockResolvedValue({ ok: true, cached: true, rejected: 0, facts: [summaryFact('Cloud security role, EU remote.')] } satisfies AiExtractResult);
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({ ok: true, message: 'Summary loaded from the cache — no budget used.' });
    const rows = (await audits(jobId)).filter((r) => r.action === 'job.ai_summary');
    expect(rows.map((r) => r.afterJson)).toEqual([
      { ok: true, cached: false, facts: 1, stored: 1, rejected: 0 },
      { ok: true, cached: true, facts: 1, stored: 0, rejected: 0 },
    ]);
  });

  it('reports a failed or unusable answer honestly', async () => {
    const { jobId } = await seedJob(t.db);
    state.budget = { enabled: true, used: 0, limit: 20, remaining: 20 };
    state.extract.mockResolvedValueOnce({ ok: false, reason: 'error', message: 'The AI provider did not answer.' } satisfies AiExtractResult);
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({ ok: false, error: 'The AI provider did not answer.' });
    state.extract.mockResolvedValueOnce({ ok: true, cached: false, rejected: 2, facts: [] } satisfies AiExtractResult);
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({
      ok: false,
      error: 'The AI answered without a usable summary (every quote must be verified).',
    });
    const [last] = await t.db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'job.ai_summary'))
      .orderBy(desc(auditLog.id))
      .limit(1);
    expect(last.afterJson).toEqual({ ok: true, cached: false, facts: 0, stored: 0, rejected: 2 });
  });

  it('never calls the AI for a posting without text', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: '   ' });
    state.budget = { enabled: true, used: 0, limit: 20, remaining: 20 };
    expect(await actions.askAiSummaryAction(undefined, form({ jobId }))).toMatchObject({ ok: false, error: 'This posting has no text to summarise.' });
    expect(state.extract).not.toHaveBeenCalled();
  });
});
