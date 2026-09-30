/**
 * Listing stage: what the listing of one source says about jobs we already have.
 * - confirmSeen: listed (unchanged / seen-only) items → last seen, missing count reset, reopen.
 * - canaries: the oldest postings of a full listing; all of them vanishing at once means the
 *   source changed its id scheme (not that everything closed) → the run is not healthy.
 * - countMissing: absence counts only on healthy full-listing runs; a job closes after 2 healthy
 *   misses. A guard refuses to count when > 50% of the source's open jobs would be missing.
 * - source-closed markers: the source itself says a posting closed.
 * Dry run: counts only.
 */
import { and, asc, desc, eq, gte, inArray, isNull, ne, sql } from 'drizzle-orm';
import { jobChanges, jobs, jobSources, pipelineRuns, sourceRuns } from '../../../db/schema';
import { closeJob, OPEN_STATES, reopenDecision, reopenJob } from '../../lifecycle';
import { canonicalJobId } from '../../dedup';
import { HOUR_MS } from '../../time';
import { runAlert } from './alerting';
import type { RunContext } from './context';
import { chunks } from './dbutil';
import type { KnownItem } from './snapshot';

/** Absence toward closing needs this many consecutive healthy misses. */
export const CLOSE_AFTER_MISSES = 2;
/** Another source listed the job this recently → not missing. */
export const OTHER_SOURCE_FRESH_MS = 36 * HOUR_MS;
export const CANARY_COUNT = 5;
export const CANARY_MIN = 3;
/** Mass-close guard: more than this many missing AND more than this share of open jobs. */
export const MASS_MISSING_MIN = 5;
export const MASS_MISSING_SHARE = 0.5;

export interface ConfirmResult {
  confirmed: number;
  reopened: number;
  /** Canonical job ids confirmed as listed by this source in this run. */
  jobIds: Set<number>;
}

async function canonicalIds(ctx: RunContext, jobIds: number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  for (const part of chunks([...new Set(jobIds)], 500)) {
    const rows = await ctx.db.select({ id: jobs.id, mergedInto: jobs.mergedIntoJobId }).from(jobs).where(inArray(jobs.id, part));
    for (const r of rows) {
      if (r.mergedInto === null) out.set(r.id, r.id);
      else out.set(r.id, (await canonicalJobId(ctx.db, r.id)) ?? r.id);
    }
  }
  return out;
}

async function closedManually(ctx: RunContext, jobId: number): Promise<boolean> {
  const [row] = await ctx.db
    .select({ v: jobChanges.newValue })
    .from(jobChanges)
    .where(and(eq(jobChanges.jobId, jobId), eq(jobChanges.field, 'close_reason')))
    .orderBy(desc(jobChanges.changedAt), desc(jobChanges.id))
    .limit(1);
  return row?.v === 'manual';
}

/** Confirms listed items that were not re-processed (unchanged content, seen-only markers). */
export async function confirmSeen(ctx: RunContext, items: KnownItem[]): Promise<ConfirmResult> {
  const out: ConfirmResult = { confirmed: 0, reopened: 0, jobIds: new Set() };
  if (!items.length) return out;
  const canon = await canonicalIds(ctx, items.map((i) => i.jobId));
  for (const i of items) out.jobIds.add(canon.get(i.jobId) ?? i.jobId);
  out.confirmed = items.length;
  if (ctx.dryRun) return out;
  const now = ctx.now;
  for (const part of chunks(items, 500)) {
    await ctx.db
      .update(jobSources)
      .set({ lastSeenAt: sql`GREATEST(${jobSources.lastSeenAt}, ${now})` })
      .where(inArray(jobSources.id, part.map((i) => i.jobSourceId)));
  }
  const ids = [...out.jobIds];
  for (const part of chunks(ids, 500)) {
    await ctx.db
      .update(jobs)
      .set({ lastSeenAt: sql`GREATEST(${jobs.lastSeenAt}, ${now})`, missingRunCount: 0 })
      .where(inArray(jobs.id, part));
    const closed = await ctx.db
      .select({ id: jobs.id, state: jobs.state, linkStatus: jobs.linkStatus, closingAt: jobs.closingAt })
      .from(jobs)
      .where(and(inArray(jobs.id, part), inArray(jobs.state, ['closed', 'expired', 'stale']), isNull(jobs.mergedIntoJobId)));
    for (const j of closed) {
      const d = reopenDecision({ state: j.state, linkStatus: j.linkStatus, closingAt: j.closingAt, now });
      if (!d.reopen || !d.reason) continue;
      if (j.state !== 'stale' && (await closedManually(ctx, j.id))) continue;
      if (await reopenJob(ctx.db, j.id, d.reason, { now, runId: ctx.runId })) out.reopened++;
    }
  }
  return out;
}

// ---- canaries --------------------------------------------------------------------------------

interface HealthJson {
  healthy?: unknown;
}

/**
 * True when ≥ 3 long-lived postings that were listed in the last healthy run are all absent now.
 * Only meaningful for complete full listings.
 */
export async function canariesMissing(ctx: RunContext, sourceId: number, listedIds: ReadonlySet<string>): Promise<{ missing: boolean; checked: number; externalIds: string[] }> {
  const recent = await ctx.db
    .select({ runStartedAt: pipelineRuns.startedAt, flags: sourceRuns.healthFlagsJson })
    .from(sourceRuns)
    .innerJoin(pipelineRuns, eq(pipelineRuns.id, sourceRuns.runId))
    .where(and(eq(sourceRuns.sourceId, sourceId), eq(sourceRuns.status, 'ok'), ne(sourceRuns.runId, ctx.runId)))
    .orderBy(desc(sourceRuns.id))
    .limit(30);
  const lastHealthy = recent.find((r) => (r.flags as HealthJson | null)?.healthy === true);
  const threshold = lastHealthy?.runStartedAt ?? null;
  if (!threshold) return { missing: false, checked: 0, externalIds: [] };
  const canaries = await ctx.db
    .select({ externalId: jobSources.externalId })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(and(eq(jobSources.sourceId, sourceId), gte(jobSources.lastSeenAt, threshold), inArray(jobs.state, [...OPEN_STATES]), isNull(jobs.mergedIntoJobId)))
    .orderBy(asc(jobSources.firstSeenAt), asc(jobSources.id))
    .limit(CANARY_COUNT);
  if (canaries.length < CANARY_MIN) return { missing: false, checked: canaries.length, externalIds: [] };
  const absent = canaries.filter((c) => !listedIds.has(c.externalId)).map((c) => c.externalId);
  return { missing: absent.length === canaries.length, checked: canaries.length, externalIds: absent };
}

// ---- missing counts ----------------------------------------------------------------------------

export interface MissingResult {
  missing: number;
  incremented: number;
  closed: number;
  blocked: boolean;
  openBefore: number;
}

/** Pure guard: refuse to count absence when a large share of the open jobs vanished at once. */
export function massMissingGuard(missing: number, open: number): boolean {
  return missing > MASS_MISSING_MIN && missing > open * MASS_MISSING_SHARE;
}

/**
 * Raises the missing count of this source's open jobs that were not listed; closes at 2.
 * Call only for healthy runs (see healthyForMissing).
 */
export async function countMissing(
  ctx: RunContext,
  source: { id: number; label: string },
  listedIds: ReadonlySet<string>,
  seenJobIds: ReadonlySet<number>,
): Promise<MissingResult> {
  const now = ctx.now;
  const rows = await ctx.db
    .select({ jobId: jobs.id, externalId: jobSources.externalId, missingRunCount: jobs.missingRunCount })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(and(eq(jobSources.sourceId, source.id), inArray(jobs.state, [...OPEN_STATES]), isNull(jobs.mergedIntoJobId)));
  const openJobIds = new Set(rows.map((r) => r.jobId));
  // A job listed under any of its external ids of this source is not missing.
  const listedJobIds = new Set(rows.filter((r) => listedIds.has(r.externalId)).map((r) => r.jobId));
  const candidates = rows.filter((r) => !listedJobIds.has(r.jobId) && !seenJobIds.has(r.jobId) && !ctx.missingIncremented.has(r.jobId));
  const candidateIds = [...new Set(candidates.map((c) => c.jobId))];
  // Listed recently by another source → not missing.
  const fresh = new Set<number>();
  for (const part of chunks(candidateIds, 500)) {
    const r = await ctx.db
      .selectDistinct({ jobId: jobSources.jobId })
      .from(jobSources)
      .where(and(inArray(jobSources.jobId, part), ne(jobSources.sourceId, source.id), gte(jobSources.lastSeenAt, new Date(now.getTime() - OTHER_SOURCE_FRESH_MS))));
    r.forEach((x) => fresh.add(x.jobId));
  }
  const missingIds = candidateIds.filter((id) => !fresh.has(id));
  const out: MissingResult = { missing: missingIds.length, incremented: 0, closed: 0, blocked: false, openBefore: openJobIds.size };
  if (!missingIds.length) return out;

  if (massMissingGuard(missingIds.length, openJobIds.size)) {
    out.blocked = true;
    await runAlert(
      ctx,
      {
        kind: 'mass_close_blocked',
        severity: 'critical',
        title: `${source.label}: ${missingIds.length} of ${openJobIds.size} open jobs missing — nothing closed`,
        body:
          'More than half of the open jobs of this source were absent from a listing that otherwise looked healthy. ' +
          'Absence was NOT counted (no job closed). Check whether the source changed its ids or listing format.',
        dedupeKey: `mass_close:${source.id}`,
        entityType: 'source',
        entityId: source.id,
      },
      source.id,
    );
    return out;
  }

  const current = new Map(candidates.map((c) => [c.jobId, c.missingRunCount]));
  if (ctx.dryRun) {
    out.incremented = missingIds.length;
    out.closed = missingIds.filter((id) => (current.get(id) ?? 0) + 1 >= CLOSE_AFTER_MISSES).length;
    return out;
  }
  for (const part of chunks(missingIds, 500)) {
    await ctx.db
      .update(jobs)
      .set({ missingRunCount: sql`${jobs.missingRunCount} + 1` })
      .where(and(inArray(jobs.id, part), inArray(jobs.state, [...OPEN_STATES])));
    part.forEach((id) => ctx.missingIncremented.add(id));
    out.incremented += part.length;
  }
  for (const part of chunks(missingIds, 500)) {
    const due = await ctx.db
      .select({ id: jobs.id, n: jobs.missingRunCount })
      .from(jobs)
      .where(and(inArray(jobs.id, part), gte(jobs.missingRunCount, CLOSE_AFTER_MISSES), inArray(jobs.state, [...OPEN_STATES])));
    for (const j of due) if (await closeJob(ctx.db, j.id, 'missing_from_source', { now, runId: ctx.runId })) out.closed++;
  }
  return out;
}

// ---- source-closed markers ----------------------------------------------------------------------

export async function applySourceClosed(ctx: RunContext, known: ReadonlyMap<string, KnownItem>, externalIds: string[]): Promise<{ closed: number; unknown: number; alreadyClosed: number }> {
  const out = { closed: 0, unknown: 0, alreadyClosed: 0 };
  const hits: KnownItem[] = [];
  for (const id of new Set(externalIds)) {
    const k = known.get(id);
    if (k) hits.push(k);
    else out.unknown++;
  }
  if (!hits.length) return out;
  const canon = await canonicalIds(ctx, hits.map((h) => h.jobId));
  const ids = [...new Set(hits.map((h) => canon.get(h.jobId) ?? h.jobId))];
  const open = new Set<number>();
  for (const part of chunks(ids, 500)) {
    const rows = await ctx.db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(inArray(jobs.id, part), inArray(jobs.state, [...OPEN_STATES]), isNull(jobs.mergedIntoJobId)));
    rows.forEach((r) => open.add(r.id));
  }
  out.alreadyClosed = ids.length - open.size;
  if (ctx.dryRun) {
    out.closed = open.size;
    return out;
  }
  for (const id of open) if (await closeJob(ctx.db, id, 'source_closed', { now: ctx.now, runId: ctx.runId })) out.closed++;
  return out;
}
