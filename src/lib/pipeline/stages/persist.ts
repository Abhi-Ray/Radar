/**
 * Persist stage: one prepared posting → company → job identity (known / dedup merge / new) →
 * job row with change history → job_sources → provenance facts → resolved columns → score.
 * Everything for one item runs in ONE transaction (retried on deadlock), so a failure leaves no
 * half-written job; the caller records it as a dead letter.
 *
 * Content ownership: the job row carries the content of its best source (grade A > B > C > D; a
 * best source not seen for 3 days hands over). Other sources still add their fact candidates and
 * confirm the job as listed. Fields with an active manual column override are never rewritten.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { MySqlUpdateSetSource } from 'drizzle-orm/mysql-core';
import { jobChanges, jobOverrides, jobs, jobSources, type SourceRow } from '../../../db/schema';
import type { GRADES } from '../../../db/schema/_enums';
import type { RoleFamily, SalaryValue } from '../../contracts/jobs';
import { resolveCompany } from '../../company/resolve';
import type { Tx } from '../../db';
import { canonicalJobId, findDuplicate, recordPossibleDuplicates } from '../../dedup';
import { reopenDecision } from '../../lifecycle';
import { formatSalary } from '../../normalize/salary';
import { loadResolvedFacts, syncResolvedJobColumns, type ResolvedFacts } from '../../provenance/store';
import { DAY_MS } from '../../time';
import type { RunContext } from './context';
import { withTxRetry } from './dbutil';
import { resolveDeadLetters } from './deadletters';
import { writeJobFacts, writeSourceFacts } from './facts';
import { CHANGE_TEXT_MAX, type PreparedJob } from './normalise';
import { scoreJobById } from './score';
import type { KnownItem } from './snapshot';

export type Grade = (typeof GRADES)[number];

/** A best source that has not listed the job for this long hands content ownership over. */
export const BEST_SOURCE_STALE_MS = 3 * DAY_MS;
export const MAX_TITLE_RAW = 512;
export const MAX_LOCATION_RAW = 512;
export const MAX_URL = 2048;

export function gradeRank(g: string | null | undefined): number {
  const i = ['A', 'B', 'C', 'D'].indexOf(g ?? '');
  return i < 0 ? 99 : i;
}

export interface PersistInput {
  source: Pick<SourceRow, 'id' | 'sourceKey' | 'companyId' | 'platformKey'>;
  grade: Grade;
  /** ATS board slug (company identity hint), null for aggregators. */
  atsSlug: string | null;
  prepared: PreparedJob;
  externalId: string;
  /** Listing/detail URL of the item (job_sources.url); falls back to the apply URL. */
  itemUrl: string | null;
  rawSnapshotId: number | null;
  known: KnownItem | undefined;
  /** When the item was seen (run start; the snapshot's fetch time in reprocess mode). */
  seenAt: Date;
}

export interface PersistResult {
  jobId: number;
  jobSourceId: number;
  action: 'created' | 'merged' | 'updated' | 'same';
  isNew: boolean;
  reopened: boolean;
  descriptionChanged: boolean;
  titleChanged: boolean;
  changedFields: string[];
  roleFamily: RoleFamily;
  titleUnknown: boolean;
  score: number | null;
  possibleDuplicates: number;
}

interface Change {
  field: string;
  oldValue: string | null;
  newValue: string | null;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const clip = (s: string | null | undefined, max = CHANGE_TEXT_MAX) => (s === null || s === undefined ? null : s.length > max ? `${s.slice(0, max - 1)}…` : s);

function salaryText(r: ResolvedFacts): string | null {
  const w = r.salary?.winner;
  if (!w) return null;
  const v = w.value as SalaryValue;
  if (v.min === null && v.max === null) return null;
  try {
    return `${formatSalary(v)}${w.method === 'estimate' ? ' (estimate)' : ''}`;
  } catch {
    return null;
  }
}

async function activeColumnOverrides(tx: Tx, jobId: number): Promise<Set<string>> {
  const rows = await tx
    .select({ field: jobOverrides.field })
    .from(jobOverrides)
    .where(and(eq(jobOverrides.jobId, jobId), eq(jobOverrides.active, true)));
  return new Set(rows.map((r) => r.field));
}

async function lastCloseReason(tx: Tx, jobId: number): Promise<string | null> {
  const [row] = await tx
    .select({ v: jobChanges.newValue })
    .from(jobChanges)
    .where(and(eq(jobChanges.jobId, jobId), eq(jobChanges.field, 'close_reason')))
    .orderBy(desc(jobChanges.changedAt), desc(jobChanges.id))
    .limit(1);
  return row?.v ?? null;
}

/** Whether this source should own the job's content fields. */
async function ownsContent(tx: Tx, job: { id: number; bestSourceId: number | null }, input: PersistInput, forced: boolean): Promise<boolean> {
  if (job.bestSourceId === null || job.bestSourceId === input.source.id) return true;
  if (forced) return false;
  const [best] = await tx
    .select({ grade: jobSources.grade, lastSeenAt: jobSources.lastSeenAt })
    .from(jobSources)
    .where(and(eq(jobSources.jobId, job.id), eq(jobSources.sourceId, job.bestSourceId)))
    .orderBy(desc(jobSources.lastSeenAt))
    .limit(1);
  if (!best) return true;
  if (gradeRank(input.grade) < gradeRank(best.grade)) return true;
  return input.seenAt.getTime() - best.lastSeenAt.getTime() > BEST_SOURCE_STALE_MS;
}

type JobInsert = typeof jobs.$inferInsert;
type JobSet = MySqlUpdateSetSource<typeof jobs>;

function newJobValues(p: PreparedJob, companyId: number, sourceId: number, seenAt: Date): JobInsert {
  return {
    companyId,
    canonicalTitle: p.canonicalTitle,
    titleRaw: p.titleRaw.slice(0, MAX_TITLE_RAW),
    roleKey: p.title.roleKey ? p.title.roleKey.slice(0, 64) : null,
    roleFamily: p.title.roleFamily,
    countryIso2: p.countryIso2,
    city: p.city,
    region: p.region,
    locationRaw: p.locationRaw.slice(0, MAX_LOCATION_RAW),
    workplaceType: p.workplaceType,
    descriptionHtmlSanitized: p.descriptionHtmlSanitized,
    descriptionText: p.descriptionText,
    descriptionHash: p.descriptionHash,
    applyUrl: p.applyUrl.slice(0, MAX_URL),
    applyUrlClean: p.applyUrlClean,
    applyUrlHash: p.applyUrlHash,
    bestSourceId: sourceId,
    postedAt: p.postedAt,
    closingAt: p.closingAt,
    firstSeenAt: seenAt,
    lastSeenAt: seenAt,
    state: 'new',
    lang: p.lang,
  };
}

/**
 * Content diff between the stored job and this posting (only for the content owner). Returns the
 * column updates and the tracked changes.
 */
function contentDiff(
  job: typeof jobs.$inferSelect,
  p: PreparedJob,
  companyId: number,
  overridden: ReadonlySet<string>,
): { set: Partial<JobInsert>; changes: Change[] } {
  const set: Partial<JobInsert> = {};
  const changes: Change[] = [];
  const titleRaw = p.titleRaw.slice(0, MAX_TITLE_RAW);
  if (job.titleRaw !== titleRaw) {
    changes.push({ field: 'title', oldValue: job.titleRaw, newValue: titleRaw });
    set.titleRaw = titleRaw;
  }
  if (!overridden.has('title') && job.canonicalTitle !== p.canonicalTitle) set.canonicalTitle = p.canonicalTitle;
  if (job.companyId !== companyId) {
    changes.push({ field: 'company_id', oldValue: String(job.companyId), newValue: String(companyId) });
    set.companyId = companyId;
  }
  const locationRaw = p.locationRaw.slice(0, MAX_LOCATION_RAW);
  if (job.locationRaw !== locationRaw) {
    changes.push({ field: 'location', oldValue: job.locationRaw, newValue: locationRaw });
    set.locationRaw = locationRaw;
  }
  if (!overridden.has('country') && job.countryIso2 !== p.countryIso2) {
    changes.push({ field: 'country', oldValue: job.countryIso2, newValue: p.countryIso2 });
    set.countryIso2 = p.countryIso2;
  }
  if (!overridden.has('city') && job.city !== p.city) set.city = p.city;
  if (job.region !== p.region) set.region = p.region;
  if (!overridden.has('workplace_type') && job.workplaceType !== p.workplaceType) {
    changes.push({ field: 'workplace_type', oldValue: job.workplaceType, newValue: p.workplaceType });
    set.workplaceType = p.workplaceType;
  }
  if (job.descriptionHash !== p.descriptionHash) {
    changes.push({ field: 'description', oldValue: clip(job.descriptionText), newValue: clip(p.descriptionText) });
    set.descriptionText = p.descriptionText;
    set.descriptionHtmlSanitized = p.descriptionHtmlSanitized;
    set.descriptionHash = p.descriptionHash;
  } else if ((job.descriptionHtmlSanitized ?? null) !== p.descriptionHtmlSanitized) {
    set.descriptionHtmlSanitized = p.descriptionHtmlSanitized;
  }
  if (job.applyUrlClean !== p.applyUrlClean) {
    changes.push({ field: 'apply_url', oldValue: job.applyUrlClean, newValue: p.applyUrlClean });
    set.applyUrl = p.applyUrl.slice(0, MAX_URL);
    set.applyUrlClean = p.applyUrlClean;
    set.applyUrlHash = p.applyUrlHash;
  } else if (job.applyUrl !== p.applyUrl.slice(0, MAX_URL)) {
    set.applyUrl = p.applyUrl.slice(0, MAX_URL);
  }
  // A posted date that disappears from the source keeps the stored one (no information).
  if (p.postedAt && iso(job.postedAt) !== iso(p.postedAt)) {
    changes.push({ field: 'posted_at', oldValue: iso(job.postedAt), newValue: iso(p.postedAt) });
    set.postedAt = p.postedAt;
  }
  if (iso(job.closingAt) !== iso(p.closingAt)) {
    changes.push({ field: 'closing_at', oldValue: iso(job.closingAt), newValue: iso(p.closingAt) });
    set.closingAt = p.closingAt;
  }
  if (p.lang && job.lang !== p.lang) set.lang = p.lang;
  return { set, changes };
}

/** Writes one posting. Runs its own transaction (with deadlock retry) on `ctx.db`. */
export async function persistItem(ctx: RunContext, input: PersistInput): Promise<PersistResult> {
  return withTxRetry(ctx.db, (tx) => persistInTx(tx, ctx, input));
}

async function persistInTx(tx: Tx, ctx: RunContext, input: PersistInput): Promise<PersistResult> {
  const p = input.prepared;
  const forced = ctx.forced;
  const now = ctx.now;

  // ---- company
  const companyId =
    input.source.companyId ??
    (
      await resolveCompany(tx, {
        name: p.job.companyName,
        domain: p.job.companyDomain ?? null,
        countryIso2: p.countryIso2,
        atsSlug: input.atsSlug,
        atsPlatform: input.atsSlug ? input.source.platformKey : null,
        descriptionText: p.descriptionText,
        evidenceSource: `${input.source.sourceKey}:${input.externalId}`.slice(0, 512),
      })
    ).companyId;

  // ---- identity
  let jobId: number | null = null;
  let action: PersistResult['action'] = 'updated';
  let possible: { jobIds: number[]; score: number; reasons: string[] } | null = null;
  if (input.known) {
    jobId = (await canonicalJobId(tx, input.known.jobId)) ?? input.known.jobId;
  } else {
    const dup = await findDuplicate(tx, {
      companyId,
      canonicalTitle: p.canonicalTitle,
      titleRaw: p.titleRaw,
      countryIso2: p.countryIso2,
      city: p.city,
      applyUrlHash: p.applyUrlHash,
      descriptionHash: p.descriptionHash,
      descriptionText: p.descriptionText,
      sourceId: input.source.id,
      postedAt: p.postedAt,
      roleKey: p.title.roleKey,
      now,
    });
    if (dup.action === 'merge') {
      jobId = (await canonicalJobId(tx, dup.jobId)) ?? dup.jobId;
      action = 'merged';
    } else if (dup.action === 'possible') {
      possible = { jobIds: dup.jobIds, score: dup.score, reasons: dup.reasons };
    }
  }

  const changes: Change[] = [];
  let reopened = false;
  let isNew = false;
  let descriptionChanged = false;
  let titleChanged = false;

  if (jobId === null) {
    // ---- new job
    const [res] = await tx.insert(jobs).values(newJobValues(p, companyId, input.source.id, input.seenAt));
    jobId = Number(res.insertId);
    action = 'created';
    isNew = true;
    descriptionChanged = true;
  }

  const [job] = await tx.select().from(jobs).where(eq(jobs.id, jobId)).limit(1).for('update');
  if (!job) throw new Error(`job ${jobId} vanished during persist`);

  // ---- job_sources
  const jsUrl = (input.itemUrl && input.itemUrl.length <= MAX_URL ? input.itemUrl : p.applyUrl).slice(0, MAX_URL);
  let jobSourceId: number;
  if (input.known) {
    jobSourceId = input.known.jobSourceId;
    await tx
      .update(jobSources)
      .set({
        jobId,
        url: jsUrl,
        grade: input.grade,
        ...(input.rawSnapshotId !== null ? { rawSnapshotId: input.rawSnapshotId } : {}),
        ...(forced ? {} : { lastSeenAt: sql`GREATEST(${jobSources.lastSeenAt}, ${input.seenAt})` }),
      })
      .where(eq(jobSources.id, jobSourceId));
  } else {
    const [res] = await tx.insert(jobSources).values({
      jobId,
      sourceId: input.source.id,
      externalId: input.externalId,
      url: jsUrl,
      grade: input.grade,
      firstSeenAt: input.seenAt,
      lastSeenAt: input.seenAt,
      rawSnapshotId: input.rawSnapshotId,
    });
    jobSourceId = Number(res.insertId);
  }

  const before = isNew ? null : await loadResolvedFacts(tx, jobId);

  // ---- content (owner only)
  const set: JobSet = {};
  if (!isNew && (await ownsContent(tx, job, input, forced))) {
    const overridden = await activeColumnOverrides(tx, jobId);
    const diff = contentDiff(job, p, companyId, overridden);
    Object.assign(set, diff.set);
    changes.push(...diff.changes);
    if (job.bestSourceId !== input.source.id) set.bestSourceId = input.source.id;
    descriptionChanged = diff.changes.some((c) => c.field === 'description');
    titleChanged = diff.changes.some((c) => c.field === 'title');
  }

  // ---- seen: missing count, last seen, reopen (never in reprocess mode)
  let state = job.state;
  if (!forced && !isNew) {
    set.missingRunCount = 0;
    set.lastSeenAt = sql`GREATEST(${jobs.lastSeenAt}, ${input.seenAt})`;
    const closingAt = p.closingAt !== undefined && set.closingAt !== undefined ? p.closingAt : job.closingAt;
    const decision = reopenDecision({ state: job.state, linkStatus: job.linkStatus, closingAt: closingAt ?? null, now });
    if (decision.reopen && decision.reason && (await lastCloseReason(tx, jobId)) !== 'manual') {
      changes.push({ field: 'state', oldValue: job.state, newValue: 'active' });
      changes.push({ field: 'reopen_reason', oldValue: null, newValue: decision.reason });
      state = 'active';
      set.state = 'active';
      reopened = true;
    }
  }

  if (Object.keys(set).length) await tx.update(jobs).set(set).where(eq(jobs.id, jobId));

  // ---- facts → resolved columns → score
  await writeSourceFacts(tx, jobId, p, input.source.sourceKey);
  const mid = await loadResolvedFacts(tx, jobId);
  const roleKey = ((mid.role?.winner?.value as { roleKey?: string | null } | undefined)?.roleKey ?? null) || null;
  const [cols] = await tx.select({ companyId: jobs.companyId, countryIso2: jobs.countryIso2 }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  await writeJobFacts(tx, ctx, { jobId, companyId: cols?.companyId ?? companyId, countryIso2: cols?.countryIso2 ?? null, roleKey });
  const resolved = await loadResolvedFacts(tx, jobId);
  await syncResolvedJobColumns(tx, jobId, resolved);

  if (before) {
    const a = salaryText(before);
    const b = salaryText(resolved);
    if (a !== b) changes.push({ field: 'salary', oldValue: a, newValue: b });
  }

  const contentChanges = changes.filter((c) => c.field !== 'state' && c.field !== 'reopen_reason');
  if (!isNew && contentChanges.length) {
    const bump: JobSet = { contentVersion: sql`${jobs.contentVersion} + 1` };
    if (!forced && (state === 'active' || state === 'updated')) bump.state = 'updated';
    await tx.update(jobs).set(bump).where(eq(jobs.id, jobId));
  } else if (!isNew && action === 'updated' && !reopened) {
    action = 'same';
  }
  if (changes.length) {
    await tx.insert(jobChanges).values(changes.map((c) => ({ jobId: jobId as number, field: c.field, oldValue: c.oldValue, newValue: c.newValue, changedAt: now, runId: ctx.runId })));
  }

  const scored = await scoreJobById(tx, jobId, { weights: ctx.settings.weights, profile: ctx.settings.profile, now, resolved });

  let possibleDuplicates = 0;
  if (possible) {
    const rec = await recordPossibleDuplicates(tx, jobId, possible);
    possibleDuplicates = rec.created + rec.updated;
  }
  await resolveDeadLetters(tx, input.source.id, input.externalId, now);

  const roleWinner = resolved.role?.winner?.value as { roleFamily?: RoleFamily } | undefined;
  return {
    jobId,
    jobSourceId,
    action,
    isNew,
    reopened,
    descriptionChanged,
    titleChanged,
    changedFields: contentChanges.map((c) => c.field),
    roleFamily: roleWinner?.roleFamily ?? p.title.roleFamily,
    titleUnknown: p.title.unknown,
    score: scored?.score ?? null,
    possibleDuplicates,
  };
}
