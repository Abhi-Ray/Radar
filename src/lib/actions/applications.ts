'use server';
/**
 * /applications mutations (spec §20). Every action: requireSession → zod → the tracker write
 * (src/lib/tracker, which runs the transaction and writes the audit row with the caller's IP) →
 * refresh. The timeline is append-only: every change here is a new application_events row.
 */
import { refresh } from 'next/cache';
import { z } from 'zod';
import { APPLICATION_STAGES } from '@/db/schema/_enums';
import { getDb } from '@/lib/db';
import { appTz } from '@/lib/time';
import {
  TrackerError,
  addApplicationEvent,
  addComment,
  completeReminder,
  createManualApplication,
  editApplication,
  type ApplicationPatch,
} from '@/lib/tracker';
import {
  actor,
  done,
  fail,
  firstIssue,
  formObject,
  unexpected,
  zFlag,
  zId,
  zOptionalDay,
  zOptionalId,
  zOptionalIso2,
  zOptionalText,
  zOptionalUrl,
  type ActionState,
} from '@/lib/tracker/action-kit';
import { isLocalDay, localDayDiff, localDayOf, localTimeOf, localToUtc, parseFollowUp } from '@/lib/tracker/follow-up';
import { MAX_COMMENT_FIELD } from '@/lib/tracker/meta';
import { INITIAL_STAGES, STAGE_META } from '@/lib/tracker/stages';

const KNOWN = [TrackerError];

function oops(what: string, err: unknown): ActionState {
  return unexpected('tracker', what, err, KNOWN);
}

/**
 * The instant for "this happened on `day`" (local, APP_TZ): now when it is today, noon local time
 * for an earlier day. Future days are refused.
 */
function pastInstant(day: string | null, now: Date, tz: string): { ok: true; at: Date | undefined } | { ok: false; error: string } {
  if (!day) return { ok: true, at: undefined };
  if (!isLocalDay(day)) return { ok: false, error: 'Pick a real date (YYYY-MM-DD).' };
  if (day === localDayOf(now, tz)) return { ok: true, at: now };
  const at = localToUtc(day, '12:00', tz);
  if (!at) return { ok: false, error: 'That date does not exist in the app time zone.' };
  if (localDayDiff(at, now, tz) > 0) return { ok: false, error: 'That day has not happened yet.' };
  return { ok: true, at };
}

// ---- quick add (manual application) ----------------------------------------------------------

const manualSchema = z.object({
  companyName: z.string().trim().min(1, 'Give the company name.').max(255, 'Company name is too long.'),
  title: z.string().trim().min(1, 'Give the job title.').max(512, 'Title is too long.'),
  stage: z.enum(INITIAL_STAGES, 'Pick the stage it is at.'),
  countryIso2: zOptionalIso2,
  source: zOptionalText(191, 'Source'),
  appliedDay: zOptionalDay,
  resumeVersionId: zOptionalId,
  note: zOptionalText(4000, 'The note'),
  postingUrl: zOptionalUrl,
  postingText: zOptionalText(200_000, 'The posting text'),
});

export async function createManualApplicationAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = manualSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  const tz = appTz();
  const now = new Date();
  const when = pastInstant(d.appliedDay, now, tz);
  if (!when.ok) return fail(when.error);
  if (d.stage === 'saved' && d.appliedDay) return fail('A saved application has no applied date — pick “Applied” or later, or leave the date empty.');
  let id: number;
  try {
    const res = await createManualApplication(
      getDb(),
      {
        companyName: d.companyName,
        title: d.title,
        stage: d.stage,
        countryIso2: d.countryIso2,
        source: d.source,
        appliedAt: when.at ?? null,
        resumeVersionId: d.resumeVersionId,
        note: d.note,
        postingUrl: d.postingUrl,
        postingText: d.postingText,
      },
      { ip },
    );
    id = res.applicationId;
  } catch (err) {
    return oops('log the application', err);
  }
  refresh();
  return done(`Logged: ${d.title} at ${d.companyName} (${STAGE_META[d.stage].label.toLowerCase()}).`, { id, href: `/applications/${id}` });
}

// ---- stage -----------------------------------------------------------------------------------

const stageSchema = z.object({
  applicationId: zId,
  stageTo: z.enum(APPLICATION_STAGES, 'Pick a stage.'),
  note: zOptionalText(4000, 'The note'),
  correction: zFlag,
  occurredDay: zOptionalDay,
});

export async function changeStageAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = stageSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  if (d.correction && (!d.note || d.note.length < 3)) return fail('A correction needs a reason (3+ characters).');
  const when = pastInstant(d.occurredDay, new Date(), appTz());
  if (!when.ok) return fail(when.error);
  let snapshotId: number | null = null;
  try {
    const res = await addApplicationEvent(
      getDb(),
      d.applicationId,
      { kind: 'stage_change', stageTo: d.stageTo, body: d.note, correction: d.correction, occurredAt: when.at },
      { ip },
    );
    snapshotId = res.snapshotId;
  } catch (err) {
    return oops('change the stage', err);
  }
  refresh();
  const label = STAGE_META[d.stageTo].label;
  return done(snapshotId ? `Moved to ${label}. The posting was copied into the logbook.` : `Moved to ${label}.`, { id: d.applicationId });
}

// ---- comment (interview notes) ---------------------------------------------------------------

const field = zOptionalText(MAX_COMMENT_FIELD, 'That field');
const commentSchema = z.object({
  applicationId: zId,
  body: zOptionalText(20_000, 'The comment'),
  interviewer: field,
  questions: field,
  wentWell: field,
  nextSteps: field,
  occurredDay: zOptionalDay,
});

export async function addCommentAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = commentSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  if (!d.body && !d.interviewer && !d.questions && !d.wentWell && !d.nextSteps) return fail('Write a comment or fill in at least one field.');
  const when = pastInstant(d.occurredDay, new Date(), appTz());
  if (!when.ok) return fail(when.error);
  try {
    await addComment(
      getDb(),
      d.applicationId,
      {
        body: d.body,
        fields: { interviewer: d.interviewer ?? undefined, questions: d.questions ?? undefined, wentWell: d.wentWell ?? undefined, nextSteps: d.nextSteps ?? undefined },
        occurredAt: when.at,
      },
      { ip },
    );
  } catch (err) {
    return oops('add the comment', err);
  }
  refresh();
  return done('Added to the logbook.', { id: d.applicationId });
}

// ---- follow-up -------------------------------------------------------------------------------

const followUpSchema = z.object({
  applicationId: zId,
  day: zOptionalDay,
  time: z
    .union([z.literal(''), z.string().regex(/^\d{2}:\d{2}$/, 'Pick a time as HH:mm.')])
    .optional()
    .transform((v) => (v ? v : null)),
  note: zOptionalText(1000, 'The note'),
  clear: zFlag,
});

export async function setFollowUpAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = followUpSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  const tz = appTz();
  let at: Date | null = null;
  if (!d.clear) {
    if (!d.day) return fail('Pick the day to follow up.');
    const check = parseFollowUp(d.day, d.time, new Date(), tz);
    if (!check.ok) return fail(check.error);
    at = check.at;
  }
  try {
    await addApplicationEvent(getDb(), d.applicationId, { kind: 'follow_up_set', followUpAt: at, body: d.note }, { ip });
  } catch (err) {
    return oops(d.clear ? 'clear the follow-up' : 'set the follow-up', err);
  }
  refresh();
  return done(at ? `Follow-up set for ${localDayOf(at, tz)} ${localTimeOf(at, tz)} (${tz}).` : 'Follow-up cleared.', { id: d.applicationId });
}

const reminderSchema = z.object({ reminderId: zId, note: zOptionalText(1000, 'The note') });

export async function completeReminderAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = reminderSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  let applicationId: number;
  try {
    applicationId = (await completeReminder(getDb(), parsed.data.reminderId, { ip, note: parsed.data.note })).applicationId;
  } catch (err) {
    return oops('mark the reminder done', err);
  }
  refresh();
  return done('Reminder done — logged on the timeline.', { id: applicationId });
}

// ---- edit / resume version / snapshot --------------------------------------------------------

const editSchema = z.object({
  applicationId: zId,
  companyName: z.string().trim().min(1, 'The company name cannot be empty.').max(255, 'Company name is too long.').optional(),
  title: z.string().trim().min(1, 'The title cannot be empty.').max(512, 'Title is too long.').optional(),
  countryIso2: zOptionalIso2,
  source: zOptionalText(191, 'Source'),
  outcome: zOptionalText(255, 'The outcome'),
  appliedDay: zOptionalDay,
  reason: zOptionalText(500, 'The reason'),
});

export async function editApplicationAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const raw = formObject(formData);
  const parsed = editSchema.safeParse(raw);
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  const tz = appTz();
  const changes: ApplicationPatch = {};
  if (d.companyName !== undefined) changes.companyName = d.companyName;
  if (d.title !== undefined) changes.title = d.title;
  if ('countryIso2' in raw) changes.countryIso2 = d.countryIso2;
  if ('source' in raw) changes.source = d.source;
  if ('outcome' in raw) changes.outcome = d.outcome;
  // The form sends the day it showed (`appliedDayWas`): an unchanged day must not rewrite the
  // stored instant (a past day maps to noon local time, which would log a phantom edit).
  if ('appliedDay' in raw && (raw.appliedDayWas === undefined || raw.appliedDay.trim() !== raw.appliedDayWas.trim())) {
    if (d.appliedDay) {
      const when = pastInstant(d.appliedDay, new Date(), tz);
      if (!when.ok) return fail(when.error);
      changes.appliedAt = when.at ?? null;
    } else changes.appliedAt = null;
  }
  try {
    await editApplication(getDb(), d.applicationId, changes, { ip, reason: d.reason });
  } catch (err) {
    return oops('save the changes', err);
  }
  refresh();
  return done('Saved — the change is on the timeline.', { id: d.applicationId });
}

const resumeSchema = z.object({ applicationId: zId, resumeVersionId: zOptionalId });

export async function setResumeVersionAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = resumeSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const d = parsed.data;
  try {
    await editApplication(getDb(), d.applicationId, { resumeVersionId: d.resumeVersionId }, { ip });
  } catch (err) {
    return oops('record the resume version', err);
  }
  refresh();
  return done(d.resumeVersionId ? 'Resume version recorded.' : 'Resume version cleared.', { id: d.applicationId });
}

const snapshotSchema = z.object({ applicationId: zId, note: zOptionalText(1000, 'The note') });

export async function snapshotAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = snapshotSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    await addApplicationEvent(getDb(), parsed.data.applicationId, { kind: 'snapshot', body: parsed.data.note ?? 'Posting copied again.' }, { ip });
  } catch (err) {
    return oops('copy the posting', err);
  }
  refresh();
  return done('A fresh copy of the posting is in the logbook.', { id: parsed.data.applicationId });
}
