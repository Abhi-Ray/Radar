// STUB(UI-TRACKER): minimal but real implementation (creates applications from jobs, appends
// timeline events, takes the apply-time snapshot). UI-TRACKER owns and may extend it; keep the
// exported signatures. The timeline is APPEND-ONLY: events are never updated or deleted.
import { asc, eq } from 'drizzle-orm';
import {
  applicationEvents,
  applications,
  applicationSnapshots,
  companies,
  jobs,
  resumeVersions,
  sources,
} from '../../db/schema';
import { APPLICATION_STAGES, type APPLICATION_EVENT_KINDS } from '../../db/schema/_enums';
import { audit } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { loadResolvedFacts } from '../provenance/store';

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];
export type ApplicationEventKind = (typeof APPLICATION_EVENT_KINDS)[number];

export class TrackerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackerError';
  }
}

export const MAX_EVENT_BODY = 20_000;
const MAX_REQUIREMENTS = 20_000;

export type ApplicationEventInput =
  | { kind: 'stage_change'; stageTo: ApplicationStage; body?: string | null; meta?: Record<string, unknown>; occurredAt?: Date }
  | { kind: 'comment'; body: string; meta?: Record<string, unknown>; occurredAt?: Date }
  | { kind: 'follow_up_set'; followUpAt: Date | null; body?: string | null; occurredAt?: Date }
  | { kind: 'edit'; body: string; meta?: Record<string, unknown>; occurredAt?: Date }
  | { kind: 'snapshot'; body?: string | null; occurredAt?: Date };

export function isApplicationStage(v: unknown): v is ApplicationStage {
  return typeof v === 'string' && (APPLICATION_STAGES as readonly string[]).includes(v);
}

function cleanBody(body: string | null | undefined): string | null {
  if (typeof body !== 'string') return null;
  const t = body.trim();
  return t ? t.slice(0, MAX_EVENT_BODY) : null;
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
const BULLET = /^(?:[-*\u2022\u2013]|\d+[.)])\s/;

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

/** Copies the posting into application_snapshots (idempotent unless `force`). Returns the snapshot id or null. */
async function snapshotJob(db: DbOrTx, applicationId: number, jobId: number, force = false): Promise<number | null> {
  if (!force) {
    const [existing] = await db
      .select({ id: applicationSnapshots.id })
      .from(applicationSnapshots)
      .where(eq(applicationSnapshots.applicationId, applicationId))
      .limit(1);
    if (existing) return existing.id;
  }
  const [job] = await db
    .select({
      id: jobs.id,
      canonicalTitle: jobs.canonicalTitle,
      titleRaw: jobs.titleRaw,
      company: companies.name,
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

export interface AddEventResult {
  eventId: number;
  stageFrom: ApplicationStage | null;
  stageTo: ApplicationStage | null;
  snapshotId: number | null;
}

/**
 * Appends an event to an application's timeline. A stage_change also moves `current_stage`
 * (and sets `applied_at` + takes the posting snapshot the first time it reaches 'applied');
 * follow_up_set updates `next_follow_up_at`.
 */
export async function addApplicationEvent(db: DbOrTx, appId: number, event: ApplicationEventInput): Promise<AddEventResult> {
  return withTransaction(db, async (tx) => {
    const [app] = await tx
      .select({ id: applications.id, jobId: applications.jobId, currentStage: applications.currentStage, appliedAt: applications.appliedAt })
      .from(applications)
      .where(eq(applications.id, appId))
      .limit(1)
      .for('update');
    if (!app) throw new TrackerError(`application ${appId} not found`);
    const occurredAt = event.occurredAt ?? new Date();
    let stageFrom: ApplicationStage | null = null;
    let stageTo: ApplicationStage | null = null;
    let snapshotId: number | null = null;
    let body: string | null = null;
    let meta: Record<string, unknown> | null = null;

    switch (event.kind) {
      case 'stage_change': {
        if (!isApplicationStage(event.stageTo)) throw new TrackerError(`unknown stage: ${String(event.stageTo)}`);
        stageFrom = app.currentStage;
        stageTo = event.stageTo;
        body = cleanBody(event.body);
        meta = event.meta ?? null;
        const patch: Partial<typeof applications.$inferInsert> = { currentStage: stageTo };
        if (stageTo === 'applied' && !app.appliedAt) patch.appliedAt = occurredAt;
        await tx.update(applications).set(patch).where(eq(applications.id, appId));
        if (stageTo === 'applied' && app.jobId !== null) snapshotId = await snapshotJob(tx, appId, app.jobId);
        break;
      }
      case 'comment':
      case 'edit': {
        body = cleanBody(event.body);
        if (!body) throw new TrackerError(`${event.kind} needs a body`);
        meta = event.meta ?? null;
        break;
      }
      case 'follow_up_set': {
        const at = event.followUpAt;
        if (at !== null && (!(at instanceof Date) || Number.isNaN(at.getTime()))) throw new TrackerError('invalid follow-up date');
        body = cleanBody(event.body);
        meta = { followUpAt: at ? at.toISOString() : null };
        await tx.update(applications).set({ nextFollowUpAt: at }).where(eq(applications.id, appId));
        break;
      }
      case 'snapshot': {
        if (app.jobId === null) throw new TrackerError('application has no job to snapshot');
        snapshotId = await snapshotJob(tx, appId, app.jobId, true);
        if (snapshotId === null) throw new TrackerError(`job ${app.jobId} no longer exists`);
        body = cleanBody(event.body);
        meta = { snapshotId };
        break;
      }
      default: {
        const never: never = event;
        throw new TrackerError(`unknown event kind: ${String((never as { kind?: unknown }).kind)}`);
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
    return { eventId: Number(res.insertId), stageFrom, stageTo, snapshotId };
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
  opts: { stage: 'saved' | 'applied'; resumeVersionId?: number | null; note?: string },
): Promise<CreateApplicationResult> {
  if (opts.stage !== 'saved' && opts.stage !== 'applied') throw new TrackerError(`invalid initial stage: ${String(opts.stage)}`);
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
    if (!job) throw new TrackerError(`job ${jobId} not found`);

    let resumeVersionId: number | null = null;
    if (opts.resumeVersionId !== undefined && opts.resumeVersionId !== null) {
      const [rv] = await tx.select({ id: resumeVersions.id }).from(resumeVersions).where(eq(resumeVersions.id, opts.resumeVersionId)).limit(1);
      if (!rv) throw new TrackerError(`resume version ${opts.resumeVersionId} not found`);
      resumeVersionId = rv.id;
    }
    const note = cleanBody(opts.note);

    const [existing] = await tx
      .select({ id: applications.id, currentStage: applications.currentStage })
      .from(applications)
      .where(eq(applications.jobId, jobId))
      .orderBy(asc(applications.id))
      .limit(1);
    await tx.update(jobs).set({ saved: true }).where(eq(jobs.id, jobId));

    if (existing) {
      let snapshotId: number | null = null;
      if (resumeVersionId !== null) await tx.update(applications).set({ resumeVersionId }).where(eq(applications.id, existing.id));
      if (opts.stage === 'applied' && STAGE_ORDER[existing.currentStage] < STAGE_ORDER.applied) {
        snapshotId = (await addApplicationEvent(tx, existing.id, { kind: 'stage_change', stageTo: 'applied', body: note })).snapshotId;
      } else if (note) {
        await addApplicationEvent(tx, existing.id, { kind: 'comment', body: note });
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
    });
    return { applicationId, created: true, snapshotId };
  });
}
