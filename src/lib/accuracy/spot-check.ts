/**
 * Weekly human spot-check (spec §17.3): open 10 random jobs, check each shown field against the
 * original posting, log every error with its type. The accuracy log (./log.ts) aggregates these
 * rows by field / source / error type over time. A wrong job can be added to the golden sample
 * (origin 'spot_check') so the mistake is measured on every later evaluation.
 */
import { and, eq, gte, inArray, isNull, notInArray, sql } from 'drizzle-orm';
import { z } from 'zod';
import { companies, goldenSamples, jobs, sources, spotChecks } from '../../db/schema';
import { goldenLabelsSchema, GOLDEN_FIELDS, type GoldenLabels } from '../contracts/accuracy';
import { withTransaction, type DbOrTx } from '../db';
import { buildJobSnapshot } from '../provenance/store';

/** Fields a spot-check can mark: the golden fields plus what else the job page shows. */
export const SPOT_CHECK_FIELDS = [...GOLDEN_FIELDS, 'company', 'title', 'apply_link', 'duplicate', 'freshness'] as const;
export type SpotCheckField = (typeof SPOT_CHECK_FIELDS)[number];

export const SPOT_CHECK_ERROR_TYPES = ['wrong_value', 'missed', 'false_positive', 'stale', 'parse_error', 'other'] as const;
export type SpotCheckErrorType = (typeof SPOT_CHECK_ERROR_TYPES)[number];

export const SPOT_CHECK_SIZE = 10;
/** A job checked this recently is not picked again. */
export const RECHECK_AFTER_DAYS = 28;
/** Closed / expired postings cannot be checked against the original any more. */
const UNCHECKABLE_STATES = ['closed', 'expired'] as const;

export class SpotCheckError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SpotCheckError';
  }
}

/** ISO-8601 week key of a date (UTC), e.g. '2026-W40' — groups one sitting's checks. */
export function isoWeekKey(d: Date): string {
  const day = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const weekday = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - weekday);
  const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((day.getTime() - yearStart) / 86_400_000 + 1) / 7);
  return `${day.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export interface SpotCheckJob {
  id: number;
  titleRaw: string;
  canonicalTitle: string;
  company: string;
  locationRaw: string;
  countryIso2: string | null;
  city: string | null;
  applyUrl: string;
  sourceId: number | null;
  sourceKey: string | null;
  state: string;
  /** What RADAR currently shows for the fields being checked. */
  shown: {
    roleKey: string | null;
    roleFamily: string;
    seniority: string | null;
    visaStatus: string | null;
    remoteClass: string | null;
    workplaceType: string | null;
    languageRequirement: string | null;
    experienceMinYears: number | null;
    salaryKind: string | null;
    salaryEurMin: number | null;
    salaryEurMax: number | null;
    postedAt: Date | null;
  };
}

export interface PickOptions {
  now?: Date;
  /** Skip jobs spot-checked within this many days (default 28). */
  excludeCheckedWithinDays?: number;
  /** Deterministic order (tests); default: a fresh random pick each time. */
  seed?: number;
}

/**
 * `n` random live jobs (not merged, not closed / expired, not spot-checked recently). Hidden
 * jobs are included on purpose: a wrong hide decision is an error too.
 */
export async function pickRandomJobs(db: DbOrTx, n: number = SPOT_CHECK_SIZE, opts: PickOptions = {}): Promise<SpotCheckJob[]> {
  const limit = Math.max(1, Math.min(50, Math.trunc(n)));
  const now = opts.now ?? new Date();
  const days = opts.excludeCheckedWithinDays ?? RECHECK_AFTER_DAYS;
  const since = new Date(now.getTime() - days * 86_400_000);
  const recent = await db
    .selectDistinct({ jobId: spotChecks.jobId })
    .from(spotChecks)
    .where(gte(spotChecks.checkedAt, since));
  const recentIds = recent.map((r) => r.jobId).filter((id): id is number => typeof id === 'number');
  const seed = opts.seed !== undefined && Number.isFinite(opts.seed) ? Math.trunc(opts.seed) : null;
  const rows = await db
    .select({
      id: jobs.id,
      titleRaw: jobs.titleRaw,
      canonicalTitle: jobs.canonicalTitle,
      company: companies.name,
      locationRaw: jobs.locationRaw,
      countryIso2: jobs.countryIso2,
      city: jobs.city,
      applyUrl: jobs.applyUrl,
      sourceId: jobs.bestSourceId,
      sourceKey: sources.sourceKey,
      state: jobs.state,
      roleKey: jobs.roleKey,
      roleFamily: jobs.roleFamily,
      seniority: jobs.seniority,
      visaStatus: jobs.visaStatus,
      remoteClass: jobs.remoteClass,
      workplaceType: jobs.workplaceType,
      languageRequirement: jobs.languageRequirement,
      experienceMinYears: jobs.experienceMinYears,
      salaryKind: jobs.salaryKind,
      salaryEurMin: jobs.salaryEurMin,
      salaryEurMax: jobs.salaryEurMax,
      postedAt: jobs.postedAt,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(sources, eq(sources.id, jobs.bestSourceId))
    .where(
      and(
        isNull(jobs.mergedIntoJobId),
        notInArray(jobs.state, [...UNCHECKABLE_STATES]),
        recentIds.length ? notInArray(jobs.id, recentIds) : undefined,
      ),
    )
    .orderBy(seed === null ? sql`RAND()` : sql`RAND(${seed})`)
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    titleRaw: r.titleRaw,
    canonicalTitle: r.canonicalTitle,
    company: r.company,
    locationRaw: r.locationRaw,
    countryIso2: r.countryIso2,
    city: r.city,
    applyUrl: r.applyUrl,
    sourceId: r.sourceId,
    sourceKey: r.sourceKey,
    state: r.state,
    shown: {
      roleKey: r.roleKey,
      roleFamily: r.roleFamily,
      seniority: r.seniority,
      visaStatus: r.visaStatus,
      remoteClass: r.remoteClass,
      workplaceType: r.workplaceType,
      languageRequirement: r.languageRequirement,
      experienceMinYears: r.experienceMinYears,
      salaryKind: r.salaryKind,
      salaryEurMin: r.salaryEurMin,
      salaryEurMax: r.salaryEurMax,
      postedAt: r.postedAt,
    },
  }));
}

const checkItemSchema = z
  .object({
    field: z.enum(SPOT_CHECK_FIELDS),
    wasCorrect: z.boolean(),
    errorType: z.enum(SPOT_CHECK_ERROR_TYPES).nullable().optional(),
    note: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

const spotCheckInputSchema = z
  .object({
    jobId: z.number().int().positive(),
    checks: z.array(checkItemSchema).min(1).max(SPOT_CHECK_FIELDS.length),
    /** Defaults to the ISO week of `now`. */
    batchKey: z
      .string()
      .trim()
      .regex(/^[\w.:-]{1,32}$/)
      .optional(),
    /** Add the job to the golden sample with these (correct) labels. */
    goldenLabels: goldenLabelsSchema.optional(),
  })
  .strict();
export type SpotCheckInput = z.input<typeof spotCheckInputSchema>;

export interface SpotCheckResult {
  ids: number[];
  batchKey: string;
  wrong: number;
  goldenSampleId: number | null;
}

/**
 * Logs one job's spot-check: one row per checked field (a wrong field without an error type is
 * logged as 'wrong_value'). With `goldenLabels`, the job is also snapshotted into the golden
 * sample (origin 'spot_check') and the rows link to it. One transaction.
 */
export async function recordSpotCheck(db: DbOrTx, input: SpotCheckInput, opts: { now?: Date } = {}): Promise<SpotCheckResult> {
  const parsed = spotCheckInputSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SpotCheckError(`invalid spot-check (${issue?.path.join('.') || 'input'}: ${issue?.message ?? 'invalid'})`);
  }
  const data = parsed.data;
  const seen = new Set<string>();
  for (const c of data.checks) {
    if (seen.has(c.field)) throw new SpotCheckError(`field "${c.field}" is checked twice`);
    seen.add(c.field);
  }
  const now = opts.now ?? new Date();
  const batchKey = data.batchKey ?? isoWeekKey(now);
  const labels: GoldenLabels | null = data.goldenLabels && Object.values(data.goldenLabels).some((v) => v !== undefined) ? data.goldenLabels : null;

  return withTransaction(db, async (tx) => {
    const [job] = await tx.select({ id: jobs.id, sourceId: jobs.bestSourceId }).from(jobs).where(eq(jobs.id, data.jobId)).limit(1);
    if (!job) throw new SpotCheckError(`job ${data.jobId} not found`);

    let goldenSampleId: number | null = null;
    if (labels) {
      const snap = await buildJobSnapshot(tx, job.id, now);
      if (!snap) throw new SpotCheckError(`job ${data.jobId} not found`);
      const wrongFields = data.checks.filter((c) => !c.wasCorrect).map((c) => c.field);
      const [g] = await tx.insert(goldenSamples).values({
        jobId: job.id,
        snapshotJson: snap.snapshot as unknown as Record<string, unknown>,
        labelsJson: labels as Record<string, unknown>,
        sourceKey: snap.sourceKey,
        countryIso2: labels.country_iso2 ?? snap.countryIso2,
        origin: 'spot_check',
        labeledAt: now,
        notes: `spot-check ${batchKey}${wrongFields.length ? ` (wrong: ${wrongFields.join(', ')})` : ''}`,
      });
      goldenSampleId = Number(g.insertId);
    }

    const ids: number[] = [];
    for (const c of data.checks) {
      const [res] = await tx.insert(spotChecks).values({
        jobId: job.id,
        sourceId: job.sourceId,
        field: c.field,
        wasCorrect: c.wasCorrect,
        errorType: c.wasCorrect ? null : (c.errorType ?? 'wrong_value'),
        note: c.note ? c.note : null,
        batchKey,
        checkedAt: now,
        goldenSampleId,
      });
      ids.push(Number(res.insertId));
    }
    return { ids, batchKey, wrong: data.checks.filter((c) => !c.wasCorrect).length, goldenSampleId };
  });
}

/** Jobs of one batch already checked (the UI shows "7 of 10 done"). */
export async function checkedJobIds(db: DbOrTx, batchKey: string): Promise<number[]> {
  const rows = await db.selectDistinct({ jobId: spotChecks.jobId }).from(spotChecks).where(eq(spotChecks.batchKey, batchKey));
  return rows.map((r) => r.jobId).filter((id): id is number => typeof id === 'number');
}

/** Removes a mistaken spot-check row set of one job in one batch (undo). Returns rows deleted. */
export async function deleteSpotCheck(db: DbOrTx, jobId: number, batchKey: string): Promise<number> {
  const rows = await db
    .select({ id: spotChecks.id })
    .from(spotChecks)
    .where(and(eq(spotChecks.jobId, jobId), eq(spotChecks.batchKey, batchKey)));
  if (!rows.length) return 0;
  await db.delete(spotChecks).where(inArray(spotChecks.id, rows.map((r) => r.id)));
  return rows.length;
}
