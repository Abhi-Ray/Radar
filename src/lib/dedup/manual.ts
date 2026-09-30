/**
 * Manual job de-duplication fixes (spec §11.1 / §11.2: "the fix persists"). Every change runs in
 * one transaction with its audit row and job_changes history.
 *
 *  - `mergeJobs(keep, drop)`: drop's links (job_sources), facts, overrides and applications move to
 *    keep; dates and the best source are combined; drop stays as a hidden row with
 *    merged_into_job_id so its links and apply URL keep resolving to keep. The pair is stored as
 *    'merged'. A full record of what moved is written to job_changes (field 'merge') so a split
 *    can undo it.
 *  - `splitJobs(job, jobSourceIds)`: the picked links leave the job. When they came from a job
 *    merged in earlier, that job is restored with what the merge moved; otherwise a new job is
 *    created for them (marked needs_review and 'split_from' so the pipeline re-reads it). The pair
 *    is stored as 'split', which findDuplicate never proposes or merges again.
 *  - `dismissDuplicate(candidate)`: "not the same job" for an open pair — stored as 'dismissed',
 *    never proposed again.
 *  - `confirmDuplicate(candidate)`: merges an open pair (older job kept by default).
 */
import { and, asc, desc, eq, inArray, or } from 'drizzle-orm';
import { aiQueue, applications, duplicateCandidates, jobChanges, jobFacts, jobOverrides, jobSources, jobs } from '../../db/schema';
import { GRADES } from '../../db/schema/_enums';
import { audit, type AuditInput } from '../audit';
import { MULTI_VALUED_FACT_KEYS, type FactKey } from '../contracts/provenance';
import { withTransaction, type DbOrTx } from '../db';
import { sha256Hex } from '../hash';
import { collapseWhitespace } from '../normalize/text';
import { cleanUrl } from '../normalize/url';
import { reapplyColumnOverrides, syncResolvedJobColumns } from '../provenance/store';
import { canonicalJobId } from './index';

export interface ManualDedupResult {
  ok: boolean;
  message: string;
  /** The job the change was made on (the kept job of a merge / the job split). */
  jobId?: number;
  /** Split: the job that took the picked links (restored or new). */
  otherJobId?: number;
  /** Split: true when a previously merged job was restored instead of a new one created. */
  restored?: boolean;
  /** Nothing had to change. */
  noop?: boolean;
}

export interface ManualDedupOptions {
  actor?: AuditInput['actor'];
  ip?: string | null;
}

export const JOB_MERGE_RECORD_VERSION = 1;
const MAX_REASON = 2000;
const MAX_IDS = 10_000;
const MAX_MERGE_RECORDS = 50;

type Grade = (typeof GRADES)[number];

interface JobRow {
  id: number;
  companyId: number;
  canonicalTitle: string;
  titleRaw: string;
  roleKey: string | null;
  roleFamily: (typeof jobs.$inferSelect)['roleFamily'];
  countryIso2: string | null;
  city: string | null;
  region: string | null;
  locationRaw: string;
  workplaceType: (typeof jobs.$inferSelect)['workplaceType'];
  descriptionHtmlSanitized: string | null;
  descriptionText: string;
  descriptionHash: string;
  applyUrl: string;
  applyUrlClean: string;
  applyUrlHash: string;
  bestSourceId: number | null;
  postedAt: Date | null;
  closingAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastConfirmedLiveAt: Date | null;
  hidden: boolean;
  hiddenReason: string | null;
  saved: boolean;
  lang: string | null;
  mergedIntoJobId: number | null;
}

const jobColumns = {
  id: jobs.id,
  companyId: jobs.companyId,
  canonicalTitle: jobs.canonicalTitle,
  titleRaw: jobs.titleRaw,
  roleKey: jobs.roleKey,
  roleFamily: jobs.roleFamily,
  countryIso2: jobs.countryIso2,
  city: jobs.city,
  region: jobs.region,
  locationRaw: jobs.locationRaw,
  workplaceType: jobs.workplaceType,
  descriptionHtmlSanitized: jobs.descriptionHtmlSanitized,
  descriptionText: jobs.descriptionText,
  descriptionHash: jobs.descriptionHash,
  applyUrl: jobs.applyUrl,
  applyUrlClean: jobs.applyUrlClean,
  applyUrlHash: jobs.applyUrlHash,
  bestSourceId: jobs.bestSourceId,
  postedAt: jobs.postedAt,
  closingAt: jobs.closingAt,
  firstSeenAt: jobs.firstSeenAt,
  lastSeenAt: jobs.lastSeenAt,
  lastConfirmedLiveAt: jobs.lastConfirmedLiveAt,
  hidden: jobs.hidden,
  hiddenReason: jobs.hiddenReason,
  saved: jobs.saved,
  lang: jobs.lang,
  mergedIntoJobId: jobs.mergedIntoJobId,
};

const DATE_FIELDS = ['firstSeenAt', 'lastSeenAt', 'lastConfirmedLiveAt', 'postedAt', 'closingAt'] as const;
type DateField = (typeof DATE_FIELDS)[number];
type DateSnapshot = Record<DateField, string | null>;

/** What a merge moved, stored as JSON in job_changes (field 'merge') on the kept job. */
export interface JobMergeRecord {
  v: number;
  dropId: number;
  jobSourceIds: number[];
  factIds: number[];
  /** Moved facts switched off because keep already had the same answer from the same source. */
  deactivatedFactIds: number[];
  /** Keep's facts switched off because the moved fact from the same source was newer. */
  keepDeactivatedFactIds: number[];
  overrideIds: number[];
  /** Moved overrides switched off because keep had its own for the field. */
  deactivatedOverrideIds: number[];
  applicationIds: number[];
  /** Jobs that had been merged into drop and now point at keep. */
  flattenedIds: number[];
  keepBefore: DateSnapshot;
  keepAfter: DateSnapshot;
  dropBefore: { hidden: boolean; hiddenReason: string | null };
}

interface LinkRow {
  id: number;
  jobId: number;
  sourceId: number;
  url: string;
  grade: Grade;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

function fail(message: string): ManualDedupResult {
  return { ok: false, message };
}

function cleanReason(reason: unknown): string {
  return typeof reason === 'string' ? collapseWhitespace(reason).slice(0, MAX_REASON) : '';
}

function validId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

function uniqueIds(ids: readonly unknown[] | null | undefined): number[] {
  return [...new Set((ids ?? []).filter(validId))].slice(0, MAX_IDS);
}

function chunks<T>(list: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function iso(d: Date | null): string | null {
  return d ? d.toISOString() : null;
}

function snapshot(j: Pick<JobRow, DateField>): DateSnapshot {
  return {
    firstSeenAt: iso(j.firstSeenAt),
    lastSeenAt: iso(j.lastSeenAt),
    lastConfirmedLiveAt: iso(j.lastConfirmedLiveAt),
    postedAt: iso(j.postedAt),
    closingAt: iso(j.closingAt),
  };
}

function minDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a <= b ? a : b;
}

function maxDate(a: Date | null, b: Date | null): Date | null {
  if (!a) return b;
  if (!b) return a;
  return a >= b ? a : b;
}

/** Pure: the combined dates / flags of two jobs being merged. */
export function mergedJobFields(keep: Pick<JobRow, DateField | 'saved'>, drop: Pick<JobRow, DateField | 'saved'>) {
  return {
    firstSeenAt: minDate(keep.firstSeenAt, drop.firstSeenAt) ?? keep.firstSeenAt,
    lastSeenAt: maxDate(keep.lastSeenAt, drop.lastSeenAt) ?? keep.lastSeenAt,
    lastConfirmedLiveAt: maxDate(keep.lastConfirmedLiveAt, drop.lastConfirmedLiveAt),
    postedAt: minDate(keep.postedAt, drop.postedAt),
    closingAt: keep.closingAt ?? drop.closingAt,
    saved: keep.saved || drop.saved,
  };
}

/** Pure: the link shown first — best grade, then the earliest seen, then the oldest row. */
export function bestLink<T extends { id: number; grade: Grade; firstSeenAt: Date }>(links: readonly T[]): T | null {
  let best: T | null = null;
  for (const l of links) {
    if (
      !best ||
      GRADES.indexOf(l.grade) < GRADES.indexOf(best.grade) ||
      (l.grade === best.grade && (l.firstSeenAt < best.firstSeenAt || (l.firstSeenAt.getTime() === best.firstSeenAt.getTime() && l.id < best.id)))
    ) {
      best = l;
    }
  }
  return best;
}

/** Pure: parses a job_changes 'merge' record (null when it is not one). */
export function parseJobMergeRecord(text: string | null): JobMergeRecord | null {
  if (!text) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (!validId(r.dropId)) return null;
  const ids = (v: unknown) => (Array.isArray(v) ? uniqueIds(v) : []);
  const snap = (v: unknown): DateSnapshot => {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
    const out = {} as DateSnapshot;
    for (const f of DATE_FIELDS) out[f] = typeof o[f] === 'string' ? (o[f] as string) : null;
    return out;
  };
  const db = r.dropBefore && typeof r.dropBefore === 'object' ? (r.dropBefore as Record<string, unknown>) : {};
  return {
    v: typeof r.v === 'number' ? r.v : 0,
    dropId: r.dropId,
    jobSourceIds: ids(r.jobSourceIds),
    factIds: ids(r.factIds),
    deactivatedFactIds: ids(r.deactivatedFactIds),
    keepDeactivatedFactIds: ids(r.keepDeactivatedFactIds),
    overrideIds: ids(r.overrideIds),
    deactivatedOverrideIds: ids(r.deactivatedOverrideIds),
    applicationIds: ids(r.applicationIds),
    flattenedIds: ids(r.flattenedIds),
    keepBefore: snap(r.keepBefore),
    keepAfter: snap(r.keepAfter),
    dropBefore: { hidden: db.hidden === true, hiddenReason: typeof db.hiddenReason === 'string' ? db.hiddenReason : null },
  };
}

async function lockJobs(tx: DbOrTx, ids: number[]): Promise<Map<number, JobRow>> {
  const rows = (await tx
    .select(jobColumns)
    .from(jobs)
    .where(inArray(jobs.id, ids))
    .orderBy(asc(jobs.id))
    .for('update')) as JobRow[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function linksOf(tx: DbOrTx, jobId: number): Promise<LinkRow[]> {
  return tx
    .select({
      id: jobSources.id,
      jobId: jobSources.jobId,
      sourceId: jobSources.sourceId,
      url: jobSources.url,
      grade: jobSources.grade,
      firstSeenAt: jobSources.firstSeenAt,
      lastSeenAt: jobSources.lastSeenAt,
    })
    .from(jobSources)
    .where(eq(jobSources.jobId, jobId));
}

/** Recomputes jobs.best_source_id from the job's links (unchanged when it has none). */
async function refreshBestSource(tx: DbOrTx, jobId: number): Promise<number | null> {
  const best = bestLink(await linksOf(tx, jobId));
  if (!best) return null;
  await tx.update(jobs).set({ bestSourceId: best.sourceId }).where(eq(jobs.id, jobId));
  return best.sourceId;
}

function cleanOf(url: string): string {
  return cleanUrl(url) || url;
}

/** When the job's apply URL is one of the links that left, point it at its best remaining link. */
async function fixApplyUrl(tx: DbOrTx, job: JobRow, movedLinks: LinkRow[]): Promise<boolean> {
  if (!movedLinks.some((l) => cleanOf(l.url) === job.applyUrlClean)) return false;
  const remaining = await linksOf(tx, job.id);
  const best = bestLink(remaining);
  if (!best) return false;
  const clean = cleanOf(best.url);
  await tx
    .update(jobs)
    .set({ applyUrl: best.url.slice(0, 2048), applyUrlClean: clean.slice(0, 2048), applyUrlHash: sha256Hex(clean) })
    .where(eq(jobs.id, job.id));
  return true;
}

async function resync(tx: DbOrTx, jobId: number): Promise<void> {
  await reapplyColumnOverrides(tx, jobId);
  await syncResolvedJobColumns(tx, jobId);
}

async function setPairStatus(
  tx: DbOrTx,
  x: number,
  y: number,
  status: 'merged' | 'split' | 'dismissed',
  reason: string,
  defaults: { score: number; reasons: string[] },
): Promise<number> {
  const jobA = Math.min(x, y);
  const jobB = Math.max(x, y);
  const now = new Date();
  const [existing] = await tx
    .select({ id: duplicateCandidates.id })
    .from(duplicateCandidates)
    .where(and(eq(duplicateCandidates.jobA, jobA), eq(duplicateCandidates.jobB, jobB)))
    .limit(1)
    .for('update');
  if (existing) {
    await tx.update(duplicateCandidates).set({ status, decidedAt: now, decidedReason: reason }).where(eq(duplicateCandidates.id, existing.id));
    return existing.id;
  }
  const [res] = await tx
    .insert(duplicateCandidates)
    .values({ jobA, jobB, score: defaults.score, reasonsJson: defaults.reasons, status, decidedAt: now, decidedReason: reason });
  return Number(res.insertId);
}

/**
 * Moves drop's other review pairs to keep: open ones are re-pointed (or dropped when keep already
 * has that pair); "not the same job" decisions (dismissed / split) carry over, so a merge never
 * brings back a pair I already ruled out.
 */
async function carryPairs(tx: DbOrTx, keepId: number, dropId: number, now: Date): Promise<{ repointed: number; carried: number; removed: number }> {
  const out = { repointed: 0, carried: 0, removed: 0 };
  const pairs = await tx
    .select()
    .from(duplicateCandidates)
    .where(or(eq(duplicateCandidates.jobA, dropId), eq(duplicateCandidates.jobB, dropId)))
    .for('update');
  for (const p of pairs) {
    const other = p.jobA === dropId ? p.jobB : p.jobA;
    if (other === keepId || other === dropId) continue;
    if (p.status === 'merged') continue;
    const jobA = Math.min(keepId, other);
    const jobB = Math.max(keepId, other);
    const [existing] = await tx
      .select({ id: duplicateCandidates.id, status: duplicateCandidates.status })
      .from(duplicateCandidates)
      .where(and(eq(duplicateCandidates.jobA, jobA), eq(duplicateCandidates.jobB, jobB)))
      .limit(1)
      .for('update');
    if (p.status === 'open') {
      if (existing) {
        await tx.delete(duplicateCandidates).where(eq(duplicateCandidates.id, p.id));
        out.removed++;
      } else {
        await tx.update(duplicateCandidates).set({ jobA, jobB }).where(eq(duplicateCandidates.id, p.id));
        out.repointed++;
      }
      continue;
    }
    const carriedReason = `Carried over from merged job #${dropId}${p.decidedReason ? `: ${p.decidedReason}` : ''}`.slice(0, 4000);
    if (!existing) {
      await tx.insert(duplicateCandidates).values({
        jobA,
        jobB,
        score: p.score,
        reasonsJson: p.reasonsJson ?? [],
        status: p.status,
        decidedAt: now,
        decidedReason: carriedReason,
      });
      out.carried++;
    } else if (existing.status === 'open') {
      await tx.update(duplicateCandidates).set({ status: p.status, decidedAt: now, decidedReason: carriedReason }).where(eq(duplicateCandidates.id, existing.id));
      out.carried++;
    }
  }
  return out;
}

// ---- merge ---------------------------------------------------------------------------------

/**
 * Merges job `dropId` into `keepId` (see the module comment). A pair I had ruled out before can
 * still be merged by hand: this call is the newer decision.
 */
export async function mergeJobs(db: DbOrTx, keepId: number, dropId: number, reason: string, opts: ManualDedupOptions = {}): Promise<ManualDedupResult> {
  const why = cleanReason(reason);
  if (!validId(keepId) || !validId(dropId)) return fail('Pick the two jobs to merge.');
  if (keepId === dropId) return fail('A job cannot be merged into itself.');
  if (!why) return fail('Give a reason for the merge.');

  return withTransaction(db, async (tx) => {
    const locked = await lockJobs(tx, [keepId, dropId]);
    const keep = locked.get(keepId);
    const drop = locked.get(dropId);
    if (!keep || !drop) return fail(`Job #${keep ? dropId : keepId} does not exist.`);
    if (drop.mergedIntoJobId === keepId) return { ok: true, noop: true, jobId: keepId, message: `Job #${dropId} is already merged into #${keepId}.` };
    if (keep.mergedIntoJobId !== null) return fail(`Job #${keepId} was itself merged into #${keep.mergedIntoJobId}; merge into that job instead.`);
    if (drop.mergedIntoJobId !== null) return fail(`Job #${dropId} was already merged into #${drop.mergedIntoJobId}.`);
    const now = new Date();

    // Links.
    const links = await linksOf(tx, dropId);
    if (links.length) await tx.update(jobSources).set({ jobId: keepId }).where(eq(jobSources.jobId, dropId));

    // Facts: all move; where keep has an answer from the same method + source, the newer stays active.
    const factCols = {
      id: jobFacts.id,
      factKey: jobFacts.factKey,
      method: jobFacts.method,
      source: jobFacts.source,
      valueHash: jobFacts.valueHash,
      isActive: jobFacts.isActive,
      checkedAt: jobFacts.checkedAt,
    };
    const dropFacts = await tx.select(factCols).from(jobFacts).where(eq(jobFacts.jobId, dropId));
    const keepActive = await tx
      .select(factCols)
      .from(jobFacts)
      .where(and(eq(jobFacts.jobId, keepId), eq(jobFacts.isActive, true)));
    const deactivatedFactIds: number[] = [];
    const keepDeactivatedFactIds: number[] = [];
    for (const f of dropFacts) {
      if (!f.isActive) continue;
      const multi = MULTI_VALUED_FACT_KEYS.includes(f.factKey as FactKey);
      const clash = keepActive.filter(
        (k) => k.isActive && k.factKey === f.factKey && k.method === f.method && k.source === f.source && (!multi || k.valueHash === f.valueHash),
      );
      if (!clash.length) continue;
      const newestKeep = clash.reduce((a, b) => (b.checkedAt > a.checkedAt ? b : a));
      if (multi || clash.some((k) => k.valueHash === f.valueHash) || f.checkedAt <= newestKeep.checkedAt) {
        deactivatedFactIds.push(f.id);
      } else {
        for (const k of clash) {
          k.isActive = false;
          keepDeactivatedFactIds.push(k.id);
        }
      }
    }
    if (dropFacts.length) await tx.update(jobFacts).set({ jobId: keepId }).where(eq(jobFacts.jobId, dropId));
    for (const part of chunks([...deactivatedFactIds, ...keepDeactivatedFactIds])) {
      await tx.update(jobFacts).set({ isActive: false }).where(inArray(jobFacts.id, part));
    }

    // Overrides: keep's own fixes win per field.
    const dropOverrides = await tx
      .select({ id: jobOverrides.id, field: jobOverrides.field, active: jobOverrides.active })
      .from(jobOverrides)
      .where(eq(jobOverrides.jobId, dropId));
    const keepFields = new Set(
      (
        await tx
          .select({ field: jobOverrides.field })
          .from(jobOverrides)
          .where(and(eq(jobOverrides.jobId, keepId), eq(jobOverrides.active, true)))
      ).map((o) => o.field),
    );
    const deactivatedOverrideIds = dropOverrides.filter((o) => o.active && keepFields.has(o.field)).map((o) => o.id);
    if (dropOverrides.length) await tx.update(jobOverrides).set({ jobId: keepId }).where(eq(jobOverrides.jobId, dropId));
    if (deactivatedOverrideIds.length) {
      await tx.update(jobOverrides).set({ active: false, deactivatedAt: now }).where(inArray(jobOverrides.id, deactivatedOverrideIds));
    }

    // Applications I logged against either posting follow the job.
    const applicationIds = (await tx.select({ id: applications.id }).from(applications).where(eq(applications.jobId, dropId))).map((a) => a.id);
    if (applicationIds.length) await tx.update(applications).set({ jobId: keepId }).where(eq(applications.jobId, dropId));

    // AI work queued for the dropped job is no longer needed.
    await tx
      .update(aiQueue)
      .set({ status: 'skipped', lastError: `merged into job #${keepId}`, doneAt: now })
      .where(and(eq(aiQueue.jobId, dropId), eq(aiQueue.status, 'queued')));

    // Dates, saved flag, best source.
    const merged = mergedJobFields(keep, drop);
    await tx.update(jobs).set(merged).where(eq(jobs.id, keepId));
    const bestSourceId = (await refreshBestSource(tx, keepId)) ?? keep.bestSourceId ?? drop.bestSourceId;
    if (bestSourceId !== keep.bestSourceId) await tx.update(jobs).set({ bestSourceId }).where(eq(jobs.id, keepId));

    // The dropped row stays for history; jobs merged into it now point at keep.
    const flattenedIds = (await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.mergedIntoJobId, dropId))).map((j) => j.id);
    if (flattenedIds.length) await tx.update(jobs).set({ mergedIntoJobId: keepId }).where(inArray(jobs.id, flattenedIds));
    await tx
      .update(jobs)
      .set({ mergedIntoJobId: keepId, hidden: true, hiddenReason: `Merged into job #${keepId}` })
      .where(eq(jobs.id, dropId));

    const pairId = await setPairStatus(tx, keepId, dropId, 'merged', why, { score: 1, reasons: ['merged by hand'] });
    const pairs = await carryPairs(tx, keepId, dropId, now);

    const record: JobMergeRecord = {
      v: JOB_MERGE_RECORD_VERSION,
      dropId,
      jobSourceIds: links.map((l) => l.id),
      factIds: dropFacts.map((f) => f.id),
      deactivatedFactIds,
      keepDeactivatedFactIds,
      overrideIds: dropOverrides.map((o) => o.id),
      deactivatedOverrideIds,
      applicationIds,
      flattenedIds,
      keepBefore: snapshot(keep),
      keepAfter: snapshot(merged),
      dropBefore: { hidden: drop.hidden, hiddenReason: drop.hiddenReason },
    };
    await tx.insert(jobChanges).values([
      { jobId: keepId, field: 'merge', oldValue: null, newValue: JSON.stringify(record) },
      { jobId: dropId, field: 'merged_into', oldValue: null, newValue: String(keepId) },
    ]);

    await resync(tx, keepId);
    await audit(tx, {
      action: 'job.merge',
      entityType: 'job',
      entityId: dropId,
      before: {
        keep: { id: keepId, title: keep.canonicalTitle, companyId: keep.companyId },
        drop: { id: dropId, title: drop.canonicalTitle, companyId: drop.companyId },
      },
      after: {
        keepId,
        dropId,
        pairId,
        links: links.length,
        facts: dropFacts.length,
        overrides: dropOverrides.length,
        applications: applicationIds.length,
        pairsRepointed: pairs.repointed,
        pairsCarried: pairs.carried,
      },
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });

    const parts = [`Merged job #${dropId} into #${keepId}`, `${links.length} link${links.length === 1 ? '' : 's'} moved`];
    if (applicationIds.length) parts.push(`${applicationIds.length} application${applicationIds.length === 1 ? '' : 's'} moved`);
    if (keep.companyId !== drop.companyId) parts.push(`kept the company of #${keepId}`);
    return { ok: true, jobId: keepId, message: `${parts.join(', ')}.` };
  });
}

// ---- split ---------------------------------------------------------------------------------

/** Merge records on a job, newest first. */
async function mergeRecordsOf(tx: DbOrTx, jobId: number): Promise<JobMergeRecord[]> {
  const rows = await tx
    .select({ newValue: jobChanges.newValue })
    .from(jobChanges)
    .where(and(eq(jobChanges.jobId, jobId), eq(jobChanges.field, 'merge')))
    .orderBy(desc(jobChanges.id))
    .limit(MAX_MERGE_RECORDS);
  return rows.map((r) => parseJobMergeRecord(r.newValue)).filter((r): r is JobMergeRecord => r !== null);
}

/**
 * Splits the links `jobSourceIds` (job_sources ids) off job `jobId` into their own job, and records
 * the two as different jobs so no re-run merges them again.
 */
export async function splitJobs(db: DbOrTx, jobId: number, jobSourceIds: number[], reason: string, opts: ManualDedupOptions = {}): Promise<ManualDedupResult> {
  const why = cleanReason(reason);
  const ids = uniqueIds(jobSourceIds);
  if (!validId(jobId)) return fail('Pick the job to split.');
  if (!ids.length) return fail('Pick the links that belong to the other job.');
  if (!why) return fail('Give a reason for the split.');

  return withTransaction(db, async (tx) => {
    // Lock the job and every job it could restore in one go, in id order like mergeJobs.
    const covering = (recs: JobMergeRecord[]) => recs.filter((rec) => ids.every((id) => rec.jobSourceIds.includes(id))).map((rec) => rec.dropId);
    const locked = await lockJobs(tx, [...new Set([jobId, ...covering(await mergeRecordsOf(tx, jobId))])]);
    const job = locked.get(jobId);
    if (!job) return fail(`Job #${jobId} does not exist.`);
    if (job.mergedIntoJobId !== null) return fail(`Job #${jobId} was merged into #${job.mergedIntoJobId}; split that job instead.`);
    const links = await linksOf(tx, jobId);
    const picked = links.filter((l) => ids.includes(l.id));
    if (picked.length !== ids.length) return fail('Some of the picked links are not on this job; reload and try again.');
    if (picked.length === links.length) return fail('Leave at least one link on this job.');

    for (const rec of await mergeRecordsOf(tx, jobId)) {
      if (!ids.every((id) => rec.jobSourceIds.includes(id))) continue;
      // A merge committed between the first read and the lock is rare; lock its job on its own.
      const other = locked.get(rec.dropId) ?? (await lockJobs(tx, [rec.dropId])).get(rec.dropId);
      if (other && other.mergedIntoJobId === jobId) return restoreMergedJob(tx, job, other, rec, picked, why, opts);
    }
    return splitIntoNewJob(tx, job, picked, why, opts);
  });
}

async function restoreMergedJob(
  tx: DbOrTx,
  job: JobRow,
  other: JobRow,
  rec: JobMergeRecord,
  picked: LinkRow[],
  why: string,
  opts: ManualDedupOptions,
): Promise<ManualDedupResult> {
  const now = new Date();
  await tx
    .update(jobs)
    .set({ mergedIntoJobId: null, hidden: rec.dropBefore.hidden, hiddenReason: rec.dropBefore.hiddenReason })
    .where(eq(jobs.id, other.id));
  await tx
    .update(jobSources)
    .set({ jobId: other.id })
    .where(
      inArray(
        jobSources.id,
        picked.map((l) => l.id),
      ),
    );

  // Facts that came with the merge go back; answers the merge switched off come back on.
  const factCols = {
    id: jobFacts.id,
    jobId: jobFacts.jobId,
    factKey: jobFacts.factKey,
    method: jobFacts.method,
    source: jobFacts.source,
    valueHash: jobFacts.valueHash,
    isActive: jobFacts.isActive,
  };
  const movedBack = rec.factIds.length
    ? await tx
        .select(factCols)
        .from(jobFacts)
        .where(and(inArray(jobFacts.id, rec.factIds), eq(jobFacts.jobId, job.id)))
    : [];
  if (movedBack.length) {
    for (const part of chunks(movedBack.map((f) => f.id))) await tx.update(jobFacts).set({ jobId: other.id }).where(inArray(jobFacts.id, part));
  }
  const reactivate = async (targetJob: number, candidates: typeof movedBack) => {
    if (!candidates.length) return 0;
    const active = await tx
      .select(factCols)
      .from(jobFacts)
      .where(and(eq(jobFacts.jobId, targetJob), eq(jobFacts.isActive, true)));
    const ids: number[] = [];
    for (const f of candidates) {
      const multi = MULTI_VALUED_FACT_KEYS.includes(f.factKey as FactKey);
      const taken = active.some((a) => a.factKey === f.factKey && a.method === f.method && a.source === f.source && (!multi || a.valueHash === f.valueHash));
      if (taken) continue;
      ids.push(f.id);
      active.push({ ...f, isActive: true });
    }
    if (ids.length) await tx.update(jobFacts).set({ isActive: true }).where(inArray(jobFacts.id, ids));
    return ids.length;
  };
  await reactivate(
    other.id,
    movedBack.filter((f) => rec.deactivatedFactIds.includes(f.id) && !f.isActive),
  );
  const keepOff = rec.keepDeactivatedFactIds.length
    ? await tx
        .select(factCols)
        .from(jobFacts)
        .where(and(inArray(jobFacts.id, rec.keepDeactivatedFactIds), eq(jobFacts.jobId, job.id), eq(jobFacts.isActive, false)))
    : [];
  await reactivate(job.id, keepOff);

  // Overrides and applications that came with the merge.
  const overridesBack = rec.overrideIds.length
    ? await tx
        .select({ id: jobOverrides.id, field: jobOverrides.field, active: jobOverrides.active })
        .from(jobOverrides)
        .where(and(inArray(jobOverrides.id, rec.overrideIds), eq(jobOverrides.jobId, job.id)))
    : [];
  if (overridesBack.length) {
    await tx
      .update(jobOverrides)
      .set({ jobId: other.id })
      .where(
        inArray(
          jobOverrides.id,
          overridesBack.map((o) => o.id),
        ),
      );
    const activeFields = new Set(overridesBack.filter((o) => o.active).map((o) => o.field));
    const revive: number[] = [];
    for (const o of overridesBack) {
      if (o.active || !rec.deactivatedOverrideIds.includes(o.id) || activeFields.has(o.field)) continue;
      revive.push(o.id);
      activeFields.add(o.field);
    }
    if (revive.length) await tx.update(jobOverrides).set({ active: true, deactivatedAt: null }).where(inArray(jobOverrides.id, revive));
  }
  const appsBack = rec.applicationIds.length
    ? (
        await tx
          .select({ id: applications.id })
          .from(applications)
          .where(and(inArray(applications.id, rec.applicationIds), eq(applications.jobId, job.id)))
      ).map((a) => a.id)
    : [];
  if (appsBack.length) await tx.update(applications).set({ jobId: other.id }).where(inArray(applications.id, appsBack));
  if (rec.flattenedIds.length) {
    await tx
      .update(jobs)
      .set({ mergedIntoJobId: other.id })
      .where(and(inArray(jobs.id, rec.flattenedIds), eq(jobs.mergedIntoJobId, job.id)));
  }

  // Dates the merge combined, where nothing changed them since.
  const [current] = (await tx.select(jobColumns).from(jobs).where(eq(jobs.id, job.id)).limit(1)) as JobRow[];
  const datePatch: {
    firstSeenAt?: Date;
    lastSeenAt?: Date;
    lastConfirmedLiveAt?: Date | null;
    postedAt?: Date | null;
    closingAt?: Date | null;
  } = {};
  if (current) {
    const cur = snapshot(current);
    for (const f of DATE_FIELDS) {
      if (cur[f] !== rec.keepAfter[f] || rec.keepBefore[f] === rec.keepAfter[f]) continue;
      const before = rec.keepBefore[f];
      const value = before === null ? null : new Date(before);
      if (value && Number.isNaN(value.getTime())) continue;
      if (f === 'firstSeenAt' || f === 'lastSeenAt') {
        if (value) datePatch[f] = value;
      } else {
        datePatch[f] = value;
      }
    }
    if (Object.keys(datePatch).length) await tx.update(jobs).set(datePatch).where(eq(jobs.id, job.id));
  }
  await refreshBestSource(tx, job.id);
  await refreshBestSource(tx, other.id);
  await fixApplyUrl(tx, current ?? job, picked);

  const pairId = await setPairStatus(tx, job.id, other.id, 'split', why, { score: 0, reasons: ['split by hand'] });
  await tx.insert(jobChanges).values([
    { jobId: job.id, field: 'split', oldValue: null, newValue: JSON.stringify({ jobId: other.id, restored: true, jobSourceIds: picked.map((l) => l.id) }) },
    { jobId: other.id, field: 'split_from', oldValue: null, newValue: String(job.id) },
  ]);
  await resync(tx, job.id);
  await resync(tx, other.id);
  await audit(tx, {
    action: 'job.split',
    entityType: 'job',
    entityId: job.id,
    before: { jobId: job.id, mergedJobId: other.id },
    after: {
      otherJobId: other.id,
      restored: true,
      pairId,
      jobSourceIds: picked.map((l) => l.id),
      facts: movedBack.length,
      overrides: overridesBack.length,
      applications: appsBack.length,
      restoredDates: Object.keys(datePatch),
      at: now.toISOString(),
    },
    reason: why,
    actor: opts.actor ?? 'admin',
    ip: opts.ip ?? null,
  });
  return {
    ok: true,
    jobId: job.id,
    otherJobId: other.id,
    restored: true,
    message: `Restored job #${other.id} with ${picked.length} link${picked.length === 1 ? '' : 's'}; the two are now marked as different jobs.`,
  };
}

async function splitIntoNewJob(tx: DbOrTx, job: JobRow, picked: LinkRow[], why: string, opts: ManualDedupOptions): Promise<ManualDedupResult> {
  const best = bestLink(picked)!;
  const clean = cleanOf(best.url);
  const firstSeenAt = picked.reduce((a, l) => (l.firstSeenAt < a ? l.firstSeenAt : a), picked[0].firstSeenAt);
  const lastSeenAt = picked.reduce((a, l) => (l.lastSeenAt > a ? l.lastSeenAt : a), picked[0].lastSeenAt);
  // The posting's own text comes back with its next fetch (split_from + needs_review tell the
  // pipeline to re-read it); until then it shows the text it was merged under.
  const [res] = await tx.insert(jobs).values({
    companyId: job.companyId,
    canonicalTitle: job.canonicalTitle,
    titleRaw: job.titleRaw,
    roleKey: job.roleKey,
    roleFamily: job.roleFamily,
    countryIso2: job.countryIso2,
    city: job.city,
    region: job.region,
    locationRaw: job.locationRaw,
    workplaceType: job.workplaceType,
    descriptionHtmlSanitized: job.descriptionHtmlSanitized,
    descriptionText: job.descriptionText,
    descriptionHash: job.descriptionHash,
    applyUrl: best.url.slice(0, 2048),
    applyUrlClean: clean.slice(0, 2048),
    applyUrlHash: sha256Hex(clean),
    bestSourceId: best.sourceId,
    firstSeenAt,
    lastSeenAt,
    state: 'new',
    needsReview: true,
    lang: job.lang,
  });
  const newId = Number(res.insertId);
  await tx
    .update(jobSources)
    .set({ jobId: newId })
    .where(
      inArray(
        jobSources.id,
        picked.map((l) => l.id),
      ),
    );
  await refreshBestSource(tx, job.id);
  const applyFixed = await fixApplyUrl(tx, job, picked);
  const pairId = await setPairStatus(tx, job.id, newId, 'split', why, { score: 0, reasons: ['split by hand'] });
  await tx.insert(jobChanges).values([
    { jobId: job.id, field: 'split', oldValue: null, newValue: JSON.stringify({ jobId: newId, restored: false, jobSourceIds: picked.map((l) => l.id) }) },
    { jobId: newId, field: 'split_from', oldValue: null, newValue: String(job.id) },
  ]);
  await syncResolvedJobColumns(tx, newId);
  await audit(tx, {
    action: 'job.split',
    entityType: 'job',
    entityId: job.id,
    before: { jobId: job.id },
    after: { otherJobId: newId, restored: false, pairId, jobSourceIds: picked.map((l) => l.id), applyUrlChanged: applyFixed },
    reason: why,
    actor: opts.actor ?? 'admin',
    ip: opts.ip ?? null,
  });
  return {
    ok: true,
    jobId: job.id,
    otherJobId: newId,
    restored: false,
    message: `Moved ${picked.length} link${picked.length === 1 ? '' : 's'} to new job #${newId} (marked for review); the two are now marked as different jobs.`,
  };
}

// ---- review pairs --------------------------------------------------------------------------

/** "Not the same job": an open pair becomes 'dismissed' and is never proposed again. */
export async function dismissDuplicate(db: DbOrTx, candidateId: number, reason?: string | null, opts: ManualDedupOptions = {}): Promise<ManualDedupResult> {
  if (!validId(candidateId)) return fail('Pick a possible duplicate.');
  const why = cleanReason(reason ?? '') || 'Not the same job';
  return withTransaction(db, async (tx) => {
    const [pair] = await tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).limit(1).for('update');
    if (!pair) return fail(`Possible duplicate #${candidateId} does not exist.`);
    if (pair.status === 'dismissed' || pair.status === 'split') {
      return { ok: true, noop: true, jobId: pair.jobA, otherJobId: pair.jobB, message: 'These jobs are already marked as different.' };
    }
    if (pair.status === 'merged') return fail('These jobs were merged; split them instead.');
    await tx.update(duplicateCandidates).set({ status: 'dismissed', decidedAt: new Date(), decidedReason: why }).where(eq(duplicateCandidates.id, candidateId));
    await audit(tx, {
      action: 'duplicate.dismiss',
      entityType: 'duplicate_candidate',
      entityId: candidateId,
      before: { status: pair.status, jobA: pair.jobA, jobB: pair.jobB, score: pair.score },
      after: { status: 'dismissed' },
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });
    return { ok: true, jobId: pair.jobA, otherJobId: pair.jobB, message: `Jobs #${pair.jobA} and #${pair.jobB} are marked as different jobs.` };
  });
}

/**
 * "Same job": merges a pair. Keeps `opts.keepId` when given (either side), otherwise the job seen
 * first. Sides that were merged elsewhere since are followed to the surviving job.
 */
export async function confirmDuplicate(
  db: DbOrTx,
  candidateId: number,
  reason: string,
  opts: ManualDedupOptions & { keepId?: number } = {},
): Promise<ManualDedupResult> {
  if (!validId(candidateId)) return fail('Pick a possible duplicate.');
  const why = cleanReason(reason);
  if (!why) return fail('Give a reason for the merge.');
  return withTransaction(db, async (tx) => {
    const [peek] = await tx
      .select({ jobA: duplicateCandidates.jobA, jobB: duplicateCandidates.jobB })
      .from(duplicateCandidates)
      .where(eq(duplicateCandidates.id, candidateId))
      .limit(1);
    if (!peek) return fail(`Possible duplicate #${candidateId} does not exist.`);
    const a = await canonicalJobId(tx, peek.jobA);
    const b = await canonicalJobId(tx, peek.jobB);
    if (a === null || b === null) return fail('One of the jobs no longer exists.');
    // Same lock order as mergeJobs (jobs, then the pair row), so the two never deadlock.
    await lockJobs(tx, [...new Set([a, b])]);
    const [pair] = await tx.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, candidateId)).limit(1).for('update');
    if (!pair) return fail(`Possible duplicate #${candidateId} does not exist.`);
    const decide = () =>
      tx.update(duplicateCandidates).set({ status: 'merged', decidedAt: new Date(), decidedReason: why }).where(eq(duplicateCandidates.id, candidateId));
    if (a === b) {
      await decide();
      return { ok: true, noop: true, jobId: a, message: `Both are already job #${a}.` };
    }
    let keep: number;
    if (opts.keepId !== undefined) {
      const k = await canonicalJobId(tx, opts.keepId);
      if (k !== a && k !== b) return fail('The job to keep must be one of the pair.');
      keep = k;
    } else {
      const rows = await tx.select({ id: jobs.id, firstSeenAt: jobs.firstSeenAt }).from(jobs).where(inArray(jobs.id, [a, b]));
      rows.sort((x, y) => x.firstSeenAt.getTime() - y.firstSeenAt.getTime() || x.id - y.id);
      keep = rows[0]?.id ?? Math.min(a, b);
    }
    const drop = keep === a ? b : a;
    const res = await mergeJobs(tx, keep, drop, why, opts);
    if (res.ok) await decide();
    return res;
  });
}
