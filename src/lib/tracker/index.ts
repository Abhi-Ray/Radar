/**
 * The application tracker (spec §20): applications from saved to offer, an APPEND-ONLY timeline,
 * the posting snapshot taken at apply time, follow-up reminders in APP_TZ and the statistics.
 *
 * Invariants:
 * - `application_events` rows are only ever INSERTed. A correction is a new event: an 'edit' with
 *   {before, after}, or a stage_change flagged `correction` (with a reason).
 * - Stage moves follow the stage machine in ./stages (checked here, server-side, for every caller).
 * - Every write runs in one transaction with its audit row.
 * - Reminders: `applications.next_follow_up_at` is the one open follow-up; `reminders` keeps the
 *   history (a new follow-up supersedes the open one; closing an application closes its reminders).
 *
 * Pure helpers live in ./stages, ./follow-up, ./stats, ./meta and ./csv (client-safe).
 */
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import {
  applicationEvents,
  applications,
  applicationSnapshots,
  companies,
  countries,
  jobs,
  reminders,
  resumeVersions,
  sources,
} from '../../db/schema';
import { APPLICATION_STAGES, type APPLICATION_EVENT_KINDS } from '../../db/schema/_enums';
import { audit, type AuditInput } from '../audit';
import { withTransaction, type DbOrTx, type Tx } from '../db';
import { mapTitle } from '../normalize/title';
import { loadResolvedFacts } from '../provenance/store';
import { commentMetaToJson, type CommentMeta } from './meta';
import {
  STAGE_META,
  checkTransition,
  isApplicationStage,
  isClosedStage,
  isInitialStage,
  pipelineIndex,
  type ApplicationStage,
  type InitialStage,
} from './stages';
import { computeTrackerStats, type StatApplication, type TrackerStats } from './stats';

export type { ApplicationStage, InitialStage } from './stages';
export { isApplicationStage } from './stages';
export type ApplicationEventKind = (typeof APPLICATION_EVENT_KINDS)[number];

export class TrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackerError';
  }
}

export const MAX_EVENT_BODY = 20_000;
const MAX_REQUIREMENTS = 20_000;
export const MAX_POSTING_TEXT = 200_000;

export interface TrackerActor {
  ip?: string | null;
  actor?: AuditInput['actor'];
}

/** Editable application fields (each change lands in an 'edit' event as before/after). */
export interface ApplicationPatch {
  companyName?: string;
  title?: string;
  countryIso2?: string | null;
  source?: string | null;
  outcome?: string | null;
  resumeVersionId?: number | null;
  appliedAt?: Date | null;
}

export const PATCH_FIELD_LABELS: Record<keyof ApplicationPatch, string> = {
  companyName: 'company',
  title: 'title',
  countryIso2: 'country',
  source: 'source',
  outcome: 'outcome',
  resumeVersionId: 'resume version',
  appliedAt: 'applied date',
};

export type ApplicationEventInput =
  | {
      kind: 'stage_change';
      stageTo: ApplicationStage;
      body?: string | null;
      meta?: Record<string, unknown>;
      occurredAt?: Date;
      /** A move the stage machine would not allow (backwards, reopening). Needs a body (the reason). */
      correction?: boolean;
    }
  | { kind: 'comment'; body: string; meta?: Record<string, unknown>; occurredAt?: Date }
  | { kind: 'follow_up_set'; followUpAt: Date | null; body?: string | null; occurredAt?: Date }
  | {
      kind: 'edit';
      /** Why / what (generated from the changes when omitted). */
      body?: string | null;
      /** Field changes applied to the application; recorded as {before, after}. */
      changes?: ApplicationPatch;
      meta?: Record<string, unknown>;
      occurredAt?: Date;
    }
  | { kind: 'snapshot'; body?: string | null; occurredAt?: Date };

function cleanBody(body: string | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  const t = body.trim();
  return t ? t.slice(0, MAX_EVENT_BODY) : null;
}

function cleanText(v: string | null | undefined, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t.slice(0, max) : null;
}

const APOS = "(?:'|\\u2019)?";
const REQUIREMENTS_HEADING = new RegExp(
  `^(?:#+\\s*)?(?:requirements|qualifications|what you${APOS}ll (?:need|bring)|what you bring|what we${APOS}re looking for|who you are|must[- ]haves?|your profile|about you|skills(?: (?:and|&) experience)?|you have|minimum qualifications|basic qualifications|preferred qualifications|nice to haves?)\\s*:?$`,
  'i',
);
const NEXT_SECTION_HEADING = new RegExp(
  `^(?:#+\\s*)?(?:benefits|perks|what we offer|we offer|about (?:us|the company|the team|the role)|responsibilities|what you${APOS}ll do|your role|the role|how to apply|compensation|salary|why join|location|equal opportunit)`,
  'i',
);
const BULLET = /^(?:[-*•–]|\d+[.)])\s/;

function looksLikeNextHeading(line: string): boolean {
  if (BULLET.test(line) || REQUIREMENTS_HEADING.test(line)) return false;
  const words = line.split(/\s+/).length;
  if (words > 8) return false;
  return /^#+\s/.test(line) || NEXT_SECTION_HEADING.test(line);
}

/**
 * The "requirements" part of a plain-text posting: the lines under a Requirements/Qualifications
 * style heading, up to the next section heading. Null when there is no such section.
 */
export function extractRequirementsText(text: string | null | undefined): string | null {
  if (typeof text !== 'string' || !text.trim()) return null;
  const out: string[] = [];
  let inside = false;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!inside) {
      if (REQUIREMENTS_HEADING.test(line)) inside = true;
      continue;
    }
    if (!line) {
      if (out.length && out[out.length - 1] !== '') out.push('');
      continue;
    }
    if (out.some(Boolean) && looksLikeNextHeading(line)) break;
    out.push(line);
  }
  const result = out.join('\n').trim();
  return result ? result.slice(0, MAX_REQUIREMENTS) : null;
}

/**
 * Copies the posting into application_snapshots. Without `force` it is idempotent: when the
 * application already has a snapshot nothing is written and null comes back, so the returned id
 * always means "a new snapshot was taken just now". Null also when the job is gone.
 */
async function snapshotJob(db: DbOrTx, applicationId: number, jobId: number, force = false): Promise<number | null> {
  if (!force) {
    const [existing] = await db
      .select({ id: applicationSnapshots.id })
      .from(applicationSnapshots)
      .where(eq(applicationSnapshots.applicationId, applicationId))
      .limit(1);
    if (existing) return null;
  }
  const [job] = await db
    .select({
      id: jobs.id,
      canonicalTitle: jobs.canonicalTitle,
      titleRaw: jobs.titleRaw,
      company: companies.name,
      companyId: jobs.companyId,
      countryIso2: jobs.countryIso2,
      city: jobs.city,
      locationRaw: jobs.locationRaw,
      workplaceType: jobs.workplaceType,
      descriptionHtmlSanitized: jobs.descriptionHtmlSanitized,
      descriptionText: jobs.descriptionText,
      applyUrl: jobs.applyUrl,
      postedAt: jobs.postedAt,
      closingAt: jobs.closingAt,
      visaStatus: jobs.visaStatus,
      remoteClass: jobs.remoteClass,
      languageRequirement: jobs.languageRequirement,
      experienceBand: jobs.experienceBand,
      seniority: jobs.seniority,
      score: jobs.score,
      sourceKey: sources.sourceKey,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(sources, eq(sources.id, jobs.bestSourceId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;
  const resolved = await loadResolvedFacts(db, jobId);
  const salary = resolved.salary?.winner;
  const facts: Record<string, unknown> = {};
  for (const [key, r] of Object.entries(resolved)) {
    if (r?.winner) facts[key] = { value: r.winner.value, method: r.winner.method, confidence: r.winner.confidence, source: r.winner.source };
  }
  const [res] = await db.insert(applicationSnapshots).values({
    applicationId,
    jobJson: {
      jobId: job.id,
      title: job.canonicalTitle,
      titleRaw: job.titleRaw,
      company: job.company,
      companyId: job.companyId,
      countryIso2: job.countryIso2,
      city: job.city,
      locationRaw: job.locationRaw,
      workplaceType: job.workplaceType,
      postedAt: job.postedAt?.toISOString() ?? null,
      closingAt: job.closingAt?.toISOString() ?? null,
      visaStatus: job.visaStatus,
      remoteClass: job.remoteClass,
      languageRequirement: job.languageRequirement,
      experienceBand: job.experienceBand,
      seniority: job.seniority,
      score: job.score,
      sourceKey: job.sourceKey,
      descriptionText: job.descriptionText,
      facts,
    },
    descriptionHtmlSanitized: job.descriptionHtmlSanitized,
    requirementsText: extractRequirementsText(job.descriptionText),
    applyUrl: job.applyUrl.slice(0, 2048),
    salaryJson: salary ? { value: salary.value, method: salary.method, confidence: salary.confidence, source: salary.source } : null,
  });
  return Number(res.insertId);
}

/** Closes every open reminder of an application; returns how many were closed. */
async function closeOpenReminders(tx: Tx, appId: number, at: Date): Promise<number> {
  const open = await tx
    .select({ id: reminders.id })
    .from(reminders)
    .where(and(eq(reminders.applicationId, appId), isNull(reminders.doneAt)));
  if (!open.length) return 0;
  await tx.update(reminders).set({ doneAt: at }).where(inArray(reminders.id, open.map((r) => r.id)));
  return open.length;
}

async function assertResumeVersion(tx: DbOrTx, id: number): Promise<{ id: number; name: string }> {
  const [rv] = await tx.select({ id: resumeVersions.id, name: resumeVersions.name }).from(resumeVersions).where(eq(resumeVersions.id, id)).limit(1);
  if (!rv) throw new TrackerError(`Resume version ${id} not found.`);
  return rv;
}

async function assertCountry(tx: DbOrTx, iso2: string): Promise<string> {
  const code = iso2.trim().toUpperCase();
  const [c] = await tx.select({ iso2: countries.iso2 }).from(countries).where(eq(countries.iso2, code)).limit(1);
  if (!c) throw new TrackerError(`Unknown country “${code}”.`);
  return c.iso2;
}

type AppRow = typeof applications.$inferSelect;

function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : null;
    const tb = b instanceof Date ? b.getTime() : null;
    return ta === tb;
  }
  return (a ?? null) === (b ?? null);
}

function jsonValue(v: unknown): unknown {
  return v instanceof Date ? v.toISOString() : (v ?? null);
}

/** Normalises a patch and returns only what differs from the row (validated). */
async function diffPatch(tx: Tx, app: AppRow, patch: ApplicationPatch) {
  const next: Partial<typeof applications.$inferInsert> = {};
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  const names: Record<string, { before: string | null; after: string | null }> = {};
  const set = <K extends keyof ApplicationPatch>(field: K, value: AppRow[K]) => {
    if (sameValue(app[field], value)) return;
    (next as Record<string, unknown>)[field] = value;
    before[field] = jsonValue(app[field]);
    after[field] = jsonValue(value);
  };
  if (patch.companyName !== undefined) {
    const v = cleanText(patch.companyName, 255);
    if (!v) throw new TrackerError('The company name cannot be empty.');
    set('companyName', v);
  }
  if (patch.title !== undefined) {
    const v = cleanText(patch.title, 512);
    if (!v) throw new TrackerError('The title cannot be empty.');
    set('title', v);
  }
  if (patch.countryIso2 !== undefined) set('countryIso2', patch.countryIso2 ? await assertCountry(tx, patch.countryIso2) : null);
  if (patch.source !== undefined) set('source', cleanText(patch.source, 191));
  if (patch.outcome !== undefined) set('outcome', cleanText(patch.outcome, 255));
  if (patch.appliedAt !== undefined) {
    const v = patch.appliedAt;
    if (v !== null && (!(v instanceof Date) || Number.isNaN(v.getTime()))) throw new TrackerError('Invalid applied date.');
    set('appliedAt', v);
  }
  if (patch.resumeVersionId !== undefined) {
    const rv = patch.resumeVersionId === null ? null : await assertResumeVersion(tx, patch.resumeVersionId);
    if (!sameValue(app.resumeVersionId, rv?.id ?? null)) {
      const [old] = app.resumeVersionId
        ? await tx.select({ name: resumeVersions.name }).from(resumeVersions).where(eq(resumeVersions.id, app.resumeVersionId)).limit(1)
        : [];
      names.resumeVersionId = { before: old?.name ?? null, after: rv?.name ?? null };
    }
    set('resumeVersionId', rv?.id ?? null);
  }
  return { next, before, after, names };
}

function describeChanges(before: Record<string, unknown>, after: Record<string, unknown>, names: Record<string, { before: string | null; after: string | null }>): string {
  const parts = Object.keys(after).map((field) => {
    const label = PATCH_FIELD_LABELS[field as keyof ApplicationPatch] ?? field;
    const show = (v: unknown, side: 'before' | 'after') => {
      const named = names[field]?.[side];
      if (named) return named;
      if (v === null || v === undefined || v === '') return 'none';
      if (field === 'appliedAt' && typeof v === 'string') return v.slice(0, 10);
      return String(v);
    };
    return `${label}: ${show(before[field], 'before')} → ${show(after[field], 'after')}`;
  });
  return `Changed ${parts.join('; ')}`.slice(0, MAX_EVENT_BODY);
}

export interface AddEventResult {
  eventId: number;
  stageFrom: ApplicationStage | null;
  stageTo: ApplicationStage | null;
  snapshotId: number | null;
}

/**
 * Appends an event to an application's timeline (the only way the timeline grows).
 * - stage_change: checked against the stage machine; moves `current_stage`; the first move to
 *   applied-or-later sets `applied_at` and takes the posting snapshot; closing the application
 *   (accepted / rejected / withdrawn) closes its open reminders.
 * - follow_up_set: sets `next_follow_up_at` and opens a reminder (superseding the open one), or
 *   clears both with `followUpAt: null`.
 * - edit: applies `changes` to the application and records {before, after}.
 * - snapshot: re-copies the posting (the job must still exist).
 */
export async function addApplicationEvent(db: DbOrTx, appId: number, event: ApplicationEventInput, opts: TrackerActor = {}): Promise<AddEventResult> {
  return withTransaction(db, async (tx) => {
    const [app] = await tx.select().from(applications).where(eq(applications.id, appId)).limit(1).for('update');
    if (!app) throw new TrackerError(`Application ${appId} not found.`);
    const occurredAt = event.occurredAt ?? new Date();
    if (!(occurredAt instanceof Date) || Number.isNaN(occurredAt.getTime())) throw new TrackerError('Invalid event time.');
    let stageFrom: ApplicationStage | null = null;
    let stageTo: ApplicationStage | null = null;
    let snapshotId: number | null = null;
    let body: string | null = null;
    let meta: Record<string, unknown> | null = null;
    const auditExtra: Record<string, unknown> = {};

    switch (event.kind) {
      case 'stage_change': {
        if (!isApplicationStage(event.stageTo)) throw new TrackerError(`Unknown stage: ${String(event.stageTo)}.`);
        body = cleanBody(event.body);
        const verdict = checkTransition(app.currentStage, event.stageTo, { correction: event.correction === true });
        if (!verdict.ok) throw new TrackerError(verdict.reason);
        if (verdict.correction && !body) throw new TrackerError('A correction needs a reason.');
        stageFrom = app.currentStage;
        stageTo = event.stageTo;
        meta = event.meta ? { ...event.meta } : null;
        if (verdict.correction) meta = { ...(meta ?? {}), correction: true };
        const patch: Partial<typeof applications.$inferInsert> = { currentStage: stageTo };
        const idx = pipelineIndex(stageTo);
        const reachedApplied = (idx !== null && idx >= (pipelineIndex('applied') as number)) || stageTo === 'rejected' || stageTo === 'no_response';
        if (reachedApplied && !app.appliedAt) patch.appliedAt = occurredAt;
        if (isClosedStage(stageTo)) {
          const closed = await closeOpenReminders(tx, appId, occurredAt);
          if (closed || app.nextFollowUpAt) {
            patch.nextFollowUpAt = null;
            meta = { ...(meta ?? {}), remindersClosed: closed };
          }
        }
        await tx.update(applications).set(patch).where(eq(applications.id, appId));
        if (reachedApplied && app.jobId !== null) snapshotId = await snapshotJob(tx, appId, app.jobId);
        break;
      }
      case 'comment': {
        body = cleanBody(event.body);
        if (!body) throw new TrackerError('A comment needs some text.');
        meta = event.meta ?? null;
        break;
      }
      case 'edit': {
        meta = event.meta ? { ...event.meta } : null;
        if (event.changes && Object.keys(event.changes).length) {
          const { next, before, after, names } = await diffPatch(tx, app, event.changes);
          if (!Object.keys(after).length) throw new TrackerError('Nothing changed.');
          await tx.update(applications).set(next).where(eq(applications.id, appId));
          meta = { ...(meta ?? {}), before, after, ...(Object.keys(names).length ? { names } : {}) };
          body = cleanBody(event.body) ?? describeChanges(before, after, names);
          auditExtra.before = before;
          auditExtra.after = after;
        } else {
          body = cleanBody(event.body);
          if (!body) throw new TrackerError('An edit needs a description or a change.');
        }
        break;
      }
      case 'follow_up_set': {
        const at = event.followUpAt;
        if (at !== null && (!(at instanceof Date) || Number.isNaN(at.getTime()))) throw new TrackerError('Invalid follow-up date.');
        if (at !== null && isClosedStage(app.currentStage)) throw new TrackerError(`The application is ${STAGE_META[app.currentStage].label.toLowerCase()} — there is nothing to follow up.`);
        body = cleanBody(event.body);
        meta = { followUpAt: at ? at.toISOString() : null };
        await closeOpenReminders(tx, appId, occurredAt);
        if (at) await tx.insert(reminders).values({ applicationId: appId, dueAt: at, note: body });
        await tx.update(applications).set({ nextFollowUpAt: at }).where(eq(applications.id, appId));
        break;
      }
      case 'snapshot': {
        if (app.jobId === null) throw new TrackerError('This application has no job to snapshot.');
        snapshotId = await snapshotJob(tx, appId, app.jobId, true);
        if (snapshotId === null) throw new TrackerError(`Job ${app.jobId} no longer exists.`);
        body = cleanBody(event.body);
        meta = { snapshotId };
        break;
      }
      default: {
        const never: never = event;
        throw new TrackerError(`Unknown event kind: ${String((never as { kind?: unknown }).kind)}.`);
      }
    }

    const [res] = await tx.insert(applicationEvents).values({
      applicationId: appId,
      kind: event.kind,
      stageFrom,
      stageTo,
      body,
      metaJson: meta,
      occurredAt,
    });
    const eventId = Number(res.insertId);
    await audit(tx, {
      action: `application.${event.kind}`,
      entityType: 'application',
      entityId: appId,
      before: auditExtra.before ?? (stageFrom ? { stage: stageFrom } : undefined),
      after: auditExtra.after ?? { eventId, ...(stageTo ? { stage: stageTo } : {}), ...(snapshotId ? { snapshotId } : {}), ...(event.kind === 'follow_up_set' ? meta : {}) },
      reason: event.kind === 'stage_change' && event.correction ? body : null,
      actor: opts.actor,
      ip: opts.ip,
    });
    return { eventId, stageFrom, stageTo, snapshotId };
  });
}

/** Records a change to the application's fields as an 'edit' event with before/after. */
export async function editApplication(db: DbOrTx, appId: number, changes: ApplicationPatch, opts: TrackerActor & { reason?: string | null } = {}): Promise<AddEventResult> {
  return addApplicationEvent(db, appId, { kind: 'edit', changes, body: opts.reason ?? null }, opts);
}

/** A comment on the timeline, with the interview fields (interviewer, questions, went well, next steps). */
export async function addComment(db: DbOrTx, appId: number, input: { body?: string | null; fields?: CommentMeta; occurredAt?: Date }, opts: TrackerActor = {}): Promise<AddEventResult> {
  const meta = commentMetaToJson(input.fields ?? {});
  const body = cleanBody(input.body) ?? (Object.keys(meta).length ? 'Interview notes' : null);
  if (!body) throw new TrackerError('Write a comment or fill in at least one field.');
  return addApplicationEvent(db, appId, { kind: 'comment', body, meta: Object.keys(meta).length ? meta : undefined, occurredAt: input.occurredAt }, opts);
}

/**
 * Marks a reminder done (the follow-up happened): closes it, moves `next_follow_up_at` to the next
 * open reminder (or clears it) and logs it on the timeline.
 */
export async function completeReminder(db: DbOrTx, reminderId: number, opts: TrackerActor & { note?: string | null } = {}): Promise<{ applicationId: number; eventId: number }> {
  return withTransaction(db, async (tx) => {
    const [r] = await tx.select().from(reminders).where(eq(reminders.id, reminderId)).limit(1).for('update');
    if (!r) throw new TrackerError(`Reminder ${reminderId} not found.`);
    if (r.doneAt) throw new TrackerError('That reminder is already done.');
    const [app] = await tx.select({ id: applications.id }).from(applications).where(eq(applications.id, r.applicationId)).limit(1).for('update');
    if (!app) throw new TrackerError(`Application ${r.applicationId} not found.`);
    const now = new Date();
    await tx.update(reminders).set({ doneAt: now }).where(eq(reminders.id, r.id));
    const [nextOpen] = await tx
      .select({ dueAt: reminders.dueAt })
      .from(reminders)
      .where(and(eq(reminders.applicationId, r.applicationId), isNull(reminders.doneAt)))
      .orderBy(asc(reminders.dueAt))
      .limit(1);
    await tx.update(applications).set({ nextFollowUpAt: nextOpen?.dueAt ?? null }).where(eq(applications.id, r.applicationId));
    const body = cleanBody(opts.note) ?? 'Followed up.';
    const [res] = await tx.insert(applicationEvents).values({
      applicationId: r.applicationId,
      kind: 'follow_up_set',
      body,
      metaJson: { followUpAt: nextOpen?.dueAt.toISOString() ?? null, done: true, reminderId: r.id, dueAt: r.dueAt.toISOString() },
      occurredAt: now,
    });
    const eventId = Number(res.insertId);
    await audit(tx, {
      action: 'application.reminder_done',
      entityType: 'application',
      entityId: r.applicationId,
      before: { reminderId: r.id, dueAt: r.dueAt.toISOString() },
      after: { eventId, doneAt: now.toISOString() },
      actor: opts.actor,
      ip: opts.ip,
    });
    return { applicationId: r.applicationId, eventId };
  });
}

export interface CreateApplicationResult {
  applicationId: number;
  created: boolean;
  snapshotId: number | null;
}

const STAGE_ORDER: Record<ApplicationStage, number> = Object.fromEntries(APPLICATION_STAGES.map((s, i) => [s, i])) as Record<
  ApplicationStage,
  number
>;

/**
 * Creates an application for a job (stage 'saved' or 'applied'), recording the first stage_change
 * event and marking the job saved. If the job already has an application it is reused: a 'saved'
 * one is moved to 'applied' when asked (never moved backwards).
 */
export async function createApplicationFromJob(
  db: DbOrTx,
  jobId: number,
  opts: { stage: 'saved' | 'applied'; resumeVersionId?: number | null; note?: string; ip?: string | null },
): Promise<CreateApplicationResult> {
  if (opts.stage !== 'saved' && opts.stage !== 'applied') throw new TrackerError(`Invalid initial stage: ${String(opts.stage)}.`);
  return withTransaction(db, async (tx) => {
    const [job] = await tx
      .select({
        id: jobs.id,
        title: jobs.canonicalTitle,
        company: companies.name,
        countryIso2: jobs.countryIso2,
        sourceKey: sources.sourceKey,
        sourceLabel: sources.label,
      })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(sources, eq(sources.id, jobs.bestSourceId))
      .where(eq(jobs.id, jobId))
      .limit(1)
      .for('update');
    if (!job) throw new TrackerError(`Job ${jobId} not found.`);

    let resumeVersionId: number | null = null;
    if (opts.resumeVersionId !== undefined && opts.resumeVersionId !== null) resumeVersionId = (await assertResumeVersion(tx, opts.resumeVersionId)).id;
    const note = cleanBody(opts.note);

    const [existing] = await tx
      .select({ id: applications.id, currentStage: applications.currentStage, resumeVersionId: applications.resumeVersionId })
      .from(applications)
      .where(eq(applications.jobId, jobId))
      .orderBy(asc(applications.id))
      .limit(1);
    await tx.update(jobs).set({ saved: true }).where(eq(jobs.id, jobId));

    if (existing) {
      let snapshotId: number | null = null;
      if (resumeVersionId !== null && existing.resumeVersionId !== resumeVersionId) {
        await addApplicationEvent(tx, existing.id, { kind: 'edit', changes: { resumeVersionId } }, { ip: opts.ip });
      }
      if (opts.stage === 'applied' && STAGE_ORDER[existing.currentStage] < STAGE_ORDER.applied) {
        snapshotId = (await addApplicationEvent(tx, existing.id, { kind: 'stage_change', stageTo: 'applied', body: note }, { ip: opts.ip })).snapshotId;
      } else if (note) {
        await addApplicationEvent(tx, existing.id, { kind: 'comment', body: note }, { ip: opts.ip });
      }
      return { applicationId: existing.id, created: false, snapshotId };
    }

    const now = new Date();
    const [res] = await tx.insert(applications).values({
      jobId,
      companyName: job.company.slice(0, 255),
      title: job.title.slice(0, 512),
      countryIso2: job.countryIso2,
      currentStage: opts.stage,
      resumeVersionId,
      appliedAt: opts.stage === 'applied' ? now : null,
      source: (job.sourceLabel ?? job.sourceKey ?? 'radar').slice(0, 191),
    });
    const applicationId = Number(res.insertId);
    await tx.insert(applicationEvents).values({
      applicationId,
      kind: 'stage_change',
      stageFrom: null,
      stageTo: opts.stage,
      body: note,
      occurredAt: now,
    });
    const snapshotId = opts.stage === 'applied' ? await snapshotJob(tx, applicationId, jobId) : null;
    await audit(tx, {
      action: 'application.create',
      entityType: 'application',
      entityId: applicationId,
      after: { jobId, stage: opts.stage, resumeVersionId },
      ip: opts.ip,
    });
    return { applicationId, created: true, snapshotId };
  });
}

export interface ManualApplicationInput {
  companyName: string;
  title: string;
  stage: InitialStage;
  countryIso2?: string | null;
  source?: string | null;
  /** When I applied (defaults to now for stages past "saved"). */
  appliedAt?: Date | null;
  resumeVersionId?: number | null;
  note?: string | null;
  /** The posting as I found it, kept as the application's snapshot. */
  postingUrl?: string | null;
  postingText?: string | null;
}

/**
 * Logs an application RADAR never saw as a job (no job_id). With a posting URL or text, that is
 * kept as the snapshot so the ad survives even though there is no job record behind it.
 */
export async function createManualApplication(db: DbOrTx, input: ManualApplicationInput, opts: TrackerActor = {}): Promise<CreateApplicationResult> {
  if (!isInitialStage(input.stage)) throw new TrackerError(`A new application cannot start as “${String(input.stage)}”.`);
  const companyName = cleanText(input.companyName, 255);
  const title = cleanText(input.title, 512);
  if (!companyName) throw new TrackerError('Give the company name.');
  if (!title) throw new TrackerError('Give the job title.');
  const appliedAt = input.appliedAt ?? null;
  if (appliedAt !== null && (!(appliedAt instanceof Date) || Number.isNaN(appliedAt.getTime()))) throw new TrackerError('Invalid applied date.');
  return withTransaction(db, async (tx) => {
    const countryIso2 = input.countryIso2 ? await assertCountry(tx, input.countryIso2) : null;
    const resumeVersionId = input.resumeVersionId ? (await assertResumeVersion(tx, input.resumeVersionId)).id : null;
    const now = new Date();
    const pastSaved = input.stage !== 'saved';
    const applied = pastSaved ? (appliedAt ?? now) : null;
    if (applied && applied.getTime() > now.getTime() + 60_000) throw new TrackerError('The applied date is in the future.');
    const [res] = await tx.insert(applications).values({
      jobId: null,
      companyName,
      title,
      countryIso2,
      currentStage: input.stage,
      resumeVersionId,
      appliedAt: applied,
      source: cleanText(input.source, 191) ?? 'manual',
    });
    const applicationId = Number(res.insertId);
    const note = cleanBody(input.note);
    await tx.insert(applicationEvents).values({
      applicationId,
      kind: 'stage_change',
      stageFrom: null,
      stageTo: input.stage,
      body: note,
      metaJson: { manual: true },
      occurredAt: now,
    });
    const postingUrl = cleanText(input.postingUrl, 2048);
    const postingText = cleanText(input.postingText, MAX_POSTING_TEXT);
    let snapshotId: number | null = null;
    if (postingUrl || postingText) {
      const [snap] = await tx.insert(applicationSnapshots).values({
        applicationId,
        jobJson: { manual: true, jobId: null, title, company: companyName, countryIso2, descriptionText: postingText, facts: {} },
        descriptionHtmlSanitized: null,
        requirementsText: extractRequirementsText(postingText),
        applyUrl: postingUrl,
        salaryJson: null,
      });
      snapshotId = Number(snap.insertId);
    }
    await audit(tx, {
      action: 'application.create',
      entityType: 'application',
      entityId: applicationId,
      after: { jobId: null, manual: true, stage: input.stage, companyName, title, countryIso2, resumeVersionId, snapshotId },
      actor: opts.actor,
      ip: opts.ip,
    });
    return { applicationId, created: true, snapshotId };
  });
}

// ---- statistics ------------------------------------------------------------------------------

function roleLabel(key: string): string {
  const words = key.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Unmapped role';
}

/** Loads every application with its stage_change events and computes the tracker statistics. */
export async function loadTrackerStats(db: DbOrTx, filter: { ids?: number[] } = {}): Promise<TrackerStats> {
  const where = filter.ids ? (filter.ids.length ? inArray(applications.id, filter.ids) : eq(applications.id, -1)) : undefined;
  const rows = await db
    .select({
      id: applications.id,
      currentStage: applications.currentStage,
      appliedAt: applications.appliedAt,
      countryIso2: applications.countryIso2,
      source: applications.source,
      title: applications.title,
      roleKey: jobs.roleKey,
    })
    .from(applications)
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(where);
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await db
        .select({
          applicationId: applicationEvents.applicationId,
          kind: applicationEvents.kind,
          stageTo: applicationEvents.stageTo,
          occurredAt: applicationEvents.occurredAt,
          metaJson: applicationEvents.metaJson,
        })
        .from(applicationEvents)
        .where(and(inArray(applicationEvents.applicationId, ids), eq(applicationEvents.kind, 'stage_change')))
        .orderBy(asc(applicationEvents.occurredAt), asc(applicationEvents.id))
    : [];
  const byApp = new Map<number, StatApplication['events']>();
  for (const e of events) {
    const list = byApp.get(e.applicationId) ?? [];
    list.push({ kind: e.kind, stageTo: e.stageTo, occurredAt: e.occurredAt, meta: e.metaJson });
    byApp.set(e.applicationId, list);
  }
  const countryRows = await db.select({ iso2: countries.iso2, name: countries.name }).from(countries);
  const countryNames = new Map(countryRows.map((c) => [c.iso2, c.name]));
  const apps: StatApplication[] = rows.map((r) => {
    let roleKey = r.roleKey;
    if (!roleKey) {
      const mapped = mapTitle(r.title);
      roleKey = mapped.unknown ? null : mapped.roleKey;
    }
    return {
      id: r.id,
      currentStage: r.currentStage,
      appliedAt: r.appliedAt,
      countryIso2: r.countryIso2,
      source: r.source,
      roleKey,
      events: byApp.get(r.id) ?? [],
    };
  });
  return computeTrackerStats(apps, { country: (iso2) => countryNames.get(iso2) ?? iso2, role: roleLabel });
}
