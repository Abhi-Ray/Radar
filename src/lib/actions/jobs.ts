'use server';
/**
 * /jobs mutations (spec §12, §16, §19.3). Every action: requireSession → zod → write → audit →
 * refresh. Overrides and corrections are audited inside the provenance store (with the caller's
 * IP); the rest write their own audit row here. Errors come back as `ActionState` for the form.
 */
import { eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { applications, jobs } from '@/db/schema';
import { markAppliedMessage } from '@/components/jobs/action-messages';
import { buildFieldValue, type FieldValueContext } from '@/components/jobs/field-values';
import { EDITABLE_FIELDS, type EditableField } from '@/components/jobs/field-edit';
import { aiExtract, getAiBudget } from '@/lib/ai';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/auth/request';
import { requireSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { getFxTable } from '@/lib/fx/ecb';
import { log } from '@/lib/log';
import { ProvenanceError, addFact, clearOverride, loadResolvedFacts, recordCorrection, setOverride } from '@/lib/provenance/store';
import { getSetting } from '@/lib/settings';
import { TrackerError, createApplicationFromJob } from '@/lib/tracker';

export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Distinguishes two identical results in a row (so toasts fire again). */
  at?: number;
  /** Set by markApplied: the tracker application. */
  applicationId?: number;
}

const jobId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const field = z.enum(EDITABLE_FIELDS);
const reason = z.string().trim().min(3, 'Give a short reason (3+ characters).').max(500, 'Keep the reason under 500 characters.');
const optionalNote = z
  .string()
  .trim()
  .max(1000, 'Keep the note under 1000 characters.')
  .optional()
  .transform((v) => (v ? v : null));
const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'on' || v === 'true');

function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === 'string' && !k.startsWith('$ACTION')) out[k] = v;
  return out;
}

/** `v_*` inputs of the field editor, prefix stripped. */
function valueInputs(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === 'string' && k.startsWith('v_')) out[k.slice(2)] = v;
  return out;
}

function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}

function fail(error: string): ActionState {
  return { ok: false, error, at: Date.now() };
}

function done(message: string, extra: Partial<ActionState> = {}): ActionState {
  return { ok: true, message, at: Date.now(), ...extra };
}

async function actor() {
  await requireSession();
  return { ip: clientIp(await headers()) };
}

async function jobExists(id: number): Promise<{ id: number; saved: boolean; hidden: boolean; hiddenReason: string | null } | null> {
  const [row] = await getDb()
    .select({ id: jobs.id, saved: jobs.saved, hidden: jobs.hidden, hiddenReason: jobs.hiddenReason })
    .from(jobs)
    .where(eq(jobs.id, id))
    .limit(1);
  return row ?? null;
}

function unexpected(what: string, err: unknown): ActionState {
  if (err instanceof ProvenanceError || err instanceof TrackerError) return fail(err.message);
  log.error(`jobs action: ${what} failed`, { err });
  return fail(`Could not ${what}. Nothing was changed — try again.`);
}

async function fieldContext(): Promise<FieldValueContext> {
  const db = getDb();
  const [fx, profile] = await Promise.all([getFxTable(db), getSetting(db, 'profile')]);
  return { fx, experienceBand: profile.experienceBand };
}

// ---- save / hide -----------------------------------------------------------------------------

const saveSchema = z.object({ jobId, saved: flag });

export async function toggleSaveAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = saveSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId: id, saved } = parsed.data;
  try {
    const job = await jobExists(id);
    if (!job) return fail('That job no longer exists.');
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.update(jobs).set({ saved }).where(eq(jobs.id, id));
      await audit(tx, { action: saved ? 'job.save' : 'job.unsave', entityType: 'job', entityId: id, before: { saved: job.saved }, after: { saved }, ip });
    });
  } catch (err) {
    return unexpected(saved ? 'save the job' : 'unsave the job', err);
  }
  refresh();
  return done(saved ? 'Saved to your shortlist.' : 'Removed from your shortlist.');
}

const hideSchema = z.object({
  jobId,
  hidden: flag,
  reason: z
    .string()
    .trim()
    .max(255, 'Keep the reason under 255 characters.')
    .optional()
    .transform((v) => (v ? v : null)),
});

export async function setHiddenAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = hideSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId: id, hidden, reason: why } = parsed.data;
  try {
    const job = await jobExists(id);
    if (!job) return fail('That job no longer exists.');
    const hiddenReason = hidden ? why : null;
    const db = getDb();
    await db.transaction(async (tx) => {
      await tx.update(jobs).set({ hidden, hiddenReason }).where(eq(jobs.id, id));
      await audit(tx, {
        action: hidden ? 'job.hide' : 'job.unhide',
        entityType: 'job',
        entityId: id,
        before: { hidden: job.hidden, hiddenReason: job.hiddenReason },
        after: { hidden, hiddenReason },
        reason: why,
        ip,
      });
    });
  } catch (err) {
    return unexpected(hidden ? 'hide the job' : 'unhide the job', err);
  }
  refresh();
  return done(hidden ? 'Hidden from the default list.' : 'Back in the list.');
}

// ---- tracker ---------------------------------------------------------------------------------

const applySchema = z.object({ jobId, note: optionalNote });

export async function markAppliedAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = applySchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId: id, note } = parsed.data;
  let result: Awaited<ReturnType<typeof createApplicationFromJob>>;
  let stage: string | null = null;
  try {
    const db = getDb();
    result = await createApplicationFromJob(db, id, { stage: 'applied', note: note ?? undefined });
    if (!result.created) {
      // The tracker never moves an application backwards: say where it really is now.
      const [app] = await db.select({ stage: applications.currentStage }).from(applications).where(eq(applications.id, result.applicationId)).limit(1);
      stage = app?.stage ?? null;
    }
    await audit(db, {
      action: 'job.mark_applied',
      entityType: 'job',
      entityId: id,
      after: { applicationId: result.applicationId, created: result.created, snapshotId: result.snapshotId, stage: result.created ? 'applied' : stage },
      ip,
    });
  } catch (err) {
    return unexpected('mark the job as applied', err);
  }
  refresh();
  return done(markAppliedMessage(result, stage, note !== null), { applicationId: result.applicationId });
}

// ---- corrections and overrides ---------------------------------------------------------------

const reportSchema = z.object({
  jobId,
  field,
  note: optionalNote,
  applyAsOverride: flag,
  /** "no" = I only know the value is wrong. Absent = the form without the choice (knows it). */
  knowsCorrect: z.enum(['yes', 'no'], 'Say whether you know the correct value.').optional(),
});

/** Current displayed value of a field: the resolved winner, or the job column. */
async function currentValue(id: number, f: EditableField): Promise<unknown> {
  const db = getDb();
  switch (f) {
    case 'title':
    case 'country':
    case 'city':
    case 'workplace_type': {
      const [row] = await db
        .select({ title: jobs.canonicalTitle, country: jobs.countryIso2, city: jobs.city, workplace_type: jobs.workplaceType })
        .from(jobs)
        .where(eq(jobs.id, id))
        .limit(1);
      return row ? row[f] : null;
    }
    default:
      return (await loadResolvedFacts(db, id))[f]?.winner?.value ?? null;
  }
}

export async function reportWrongInfoAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = reportSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId: id, field: f, note, applyAsOverride } = parsed.data;
  const raw = valueInputs(formData);
  const knowsCorrect = parsed.data.knowsCorrect !== 'no';
  let correctValue: unknown;
  if (knowsCorrect) {
    const built = buildFieldValue(f, raw, await fieldContext());
    if (!built.ok) return fail(built.error);
    correctValue = built.value;
  } else if (!note) {
    return fail('Say what is wrong in the note when you do not know the correct value.');
  }
  if (applyAsOverride && !knowsCorrect) return fail('An override needs the correct value.');
  try {
    if (!(await jobExists(id))) return fail('That job no longer exists.');
    const wrongValue = await currentValue(id, f);
    const res = await recordCorrection(
      getDb(),
      { jobId: id, field: f, wrongValue, correctValue, note, addToGolden: true, applyAsOverride: applyAsOverride && knowsCorrect },
      { ip },
    );
    refresh();
    const parts = ['Correction recorded'];
    if (res.goldenSampleId) parts.push('added to the golden sample');
    if (res.overrideId) parts.push('applied as an override');
    return done(`${parts.join(', ')}.`);
  } catch (err) {
    return unexpected('record the correction', err);
  }
}

const overrideSchema = z.object({ jobId, field, reason });

export async function overrideFieldAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = overrideSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId: id, field: f, reason: why } = parsed.data;
  const built = buildFieldValue(f, valueInputs(formData), await fieldContext());
  if (!built.ok) return fail(built.error);
  try {
    if (!(await jobExists(id))) return fail('That job no longer exists.');
    const res = await setOverride(getDb(), id, f, built.value, why, { ip });
    refresh();
    return done(res.previous === null ? 'Override set — it now beats every other source.' : 'Override replaced.');
  } catch (err) {
    return unexpected('set the override', err);
  }
}

const clearSchema = z.object({ jobId, field, reason });

export async function clearOverrideAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = clearSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { jobId: id, field: f, reason: why } = parsed.data;
  try {
    const cleared = await clearOverride(getDb(), id, f, why, { ip });
    if (!cleared) return fail('There was no active override on that field.');
    refresh();
    return done('Override removed — the evidence decides again.');
  } catch (err) {
    return unexpected('remove the override', err);
  }
}

// ---- AI summary ------------------------------------------------------------------------------

const aiSchema = z.object({ jobId });

export async function askAiSummaryAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = aiSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const id = parsed.data.jobId;
  const db = getDb();
  try {
    const budget = await getAiBudget(db);
    if (!budget.enabled) return fail('AI is switched off, so no call was made.');
    if (budget.remaining <= 0) return fail(`Today's AI budget is used up (${budget.used}/${budget.limit}). No call was made.`);
    const [job] = await db
      .select({ id: jobs.id, text: jobs.descriptionText, hash: jobs.descriptionHash })
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1);
    if (!job) return fail('That job no longer exists.');
    if (!job.text.trim()) return fail('This posting has no text to summarise.');
    const res = await aiExtract(db, { jobId: id, task: 'summary', text: job.text, contentHash: job.hash, manual: true });
    let stored = 0;
    if (res.ok) {
      for (const { key, fact } of res.facts) if ((await addFact(db, id, key, fact)).created) stored++;
    }
    await audit(db, {
      action: 'job.ai_summary',
      entityType: 'job',
      entityId: id,
      after: res.ok ? { ok: true, cached: res.cached, facts: res.facts.length, stored, rejected: res.rejected } : { ok: false, reason: res.reason },
      ip,
    });
    if (!res.ok) return fail(res.message);
    refresh();
    if (!res.facts.some((f) => f.key === 'ai_summary')) return fail('The AI answered without a usable summary (every quote must be verified).');
    return done(res.cached ? 'Summary loaded from the cache — no budget used.' : 'Summary added.');
  } catch (err) {
    return unexpected('ask for a summary', err);
  }
}
