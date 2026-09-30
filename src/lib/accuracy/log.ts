/**
 * Accuracy log (spec §17.3 / §17.4): spot-check errors aggregated by field, source and error
 * type, with a weekly trend — and the history of golden-sample evaluation runs (key metrics per
 * run, which logic versions changed) for the dashboard's "trend over time".
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { accuracyRuns, sources, spotChecks } from '../../db/schema';
import type { DbOrTx } from '../db';
import { storedKeyMetrics } from './compare';
import type { KeyMetrics } from './metrics';
import { isoWeekKey } from './spot-check';

export interface CheckCounts {
  checked: number;
  wrong: number;
  /** correct / checked (null when nothing was checked). */
  correctRate: number | null;
}

export interface FieldLog extends CheckCounts {
  errorTypes: Record<string, number>;
}

export interface WeekLog extends CheckCounts {
  week: string;
  jobs: number;
  byField: Record<string, CheckCounts>;
}

export interface AccuracyLog {
  since: Date;
  until: Date;
  total: CheckCounts & { jobs: number };
  byField: Record<string, FieldLog>;
  bySource: Record<string, FieldLog>;
  byErrorType: Record<string, number>;
  /** Oldest week first; weeks without checks are omitted. */
  trend: WeekLog[];
  /** Fields ordered by number of errors (most first) — "which areas need work". */
  worstFields: { field: string; wrong: number; correctRate: number | null }[];
}

export interface SpotCheckRow {
  jobId: number | null;
  field: string;
  wasCorrect: boolean;
  errorType: string | null;
  checkedAt: Date;
  sourceKey: string | null;
}

const NO_SOURCE = '(none)';

function counts(): CheckCounts {
  return { checked: 0, wrong: 0, correctRate: null };
}

function bump(c: CheckCounts, correct: boolean): void {
  c.checked++;
  if (!correct) c.wrong++;
  c.correctRate = (c.checked - c.wrong) / c.checked;
}

function bumpField(map: Record<string, FieldLog>, key: string, row: SpotCheckRow): void {
  const f = (map[key] ??= { ...counts(), errorTypes: {} });
  bump(f, row.wasCorrect);
  if (!row.wasCorrect) {
    const t = row.errorType ?? 'other';
    f.errorTypes[t] = (f.errorTypes[t] ?? 0) + 1;
  }
}

/** Aggregates spot-check rows (pure). */
export function aggregateSpotChecks(rows: readonly SpotCheckRow[], since: Date, until: Date): AccuracyLog {
  const total = { ...counts(), jobs: 0 };
  const byField: Record<string, FieldLog> = {};
  const bySource: Record<string, FieldLog> = {};
  const byErrorType: Record<string, number> = {};
  const weeks = new Map<string, WeekLog & { jobIds: Set<number> }>();
  const jobIds = new Set<number>();
  for (const r of rows) {
    bump(total, r.wasCorrect);
    if (r.jobId !== null) jobIds.add(r.jobId);
    bumpField(byField, r.field, r);
    bumpField(bySource, r.sourceKey ?? NO_SOURCE, r);
    if (!r.wasCorrect) {
      const t = r.errorType ?? 'other';
      byErrorType[t] = (byErrorType[t] ?? 0) + 1;
    }
    const wk = isoWeekKey(r.checkedAt);
    const w = weeks.get(wk) ?? { week: wk, jobs: 0, ...counts(), byField: {}, jobIds: new Set<number>() };
    bump(w, r.wasCorrect);
    bump((w.byField[r.field] ??= counts()), r.wasCorrect);
    if (r.jobId !== null) w.jobIds.add(r.jobId);
    weeks.set(wk, w);
  }
  total.jobs = jobIds.size;
  const trend = [...weeks.values()]
    .sort((a, b) => a.week.localeCompare(b.week))
    .map(({ jobIds: ids, ...w }) => ({ ...w, jobs: ids.size }));
  const worstFields = Object.entries(byField)
    .filter(([, f]) => f.wrong > 0)
    .sort(([a, x], [b, y]) => y.wrong - x.wrong || (x.correctRate ?? 1) - (y.correctRate ?? 1) || a.localeCompare(b))
    .map(([field, f]) => ({ field, wrong: f.wrong, correctRate: f.correctRate }));
  return { since, until, total, byField, bySource, byErrorType, trend, worstFields };
}

export interface AccuracyLogOptions {
  now?: Date;
  /** Window length in weeks (default 12) when `since` is not given. */
  weeks?: number;
  since?: Date;
  until?: Date;
}

/** Spot-check accuracy log over a window (default: the last 12 weeks). */
export async function accuracyLog(db: DbOrTx, opts: AccuracyLogOptions = {}): Promise<AccuracyLog> {
  const until = opts.until ?? opts.now ?? new Date();
  const weeks = Math.max(1, Math.min(520, Math.trunc(opts.weeks ?? 12)));
  const since = opts.since ?? new Date(until.getTime() - weeks * 7 * 86_400_000);
  const rows = await db
    .select({
      jobId: spotChecks.jobId,
      field: spotChecks.field,
      wasCorrect: spotChecks.wasCorrect,
      errorType: spotChecks.errorType,
      checkedAt: spotChecks.checkedAt,
      sourceKey: sources.sourceKey,
    })
    .from(spotChecks)
    .leftJoin(sources, eq(sources.id, spotChecks.sourceId))
    .where(and(gte(spotChecks.checkedAt, since), lte(spotChecks.checkedAt, until)));
  return aggregateSpotChecks(rows, since, until);
}

export interface AccuracyRunSummary {
  id: number;
  createdAt: Date;
  sampleCount: number;
  blocked: boolean;
  blockedReasons: string[];
  comparedToRunId: number | null;
  trigger: string | null;
  keyMetrics: KeyMetrics;
  /** Logic versions that differ from the run before it (what changed). */
  changedVersions: Record<string, { from: string | null; to: string | null }>;
  logicVersions: Record<string, string>;
}

/** The latest evaluation runs, newest first (dashboard trend). */
export async function accuracyRunHistory(db: DbOrTx, limit = 20): Promise<AccuracyRunSummary[]> {
  const n = Math.max(1, Math.min(200, Math.trunc(limit)));
  const rows = await db
    .select({
      id: accuracyRuns.id,
      createdAt: accuracyRuns.createdAt,
      sampleCount: accuracyRuns.sampleCount,
      blocked: accuracyRuns.blocked,
      blockedReasons: accuracyRuns.blockedReasonsJson,
      comparedToRunId: accuracyRuns.comparedToRunId,
      trigger: accuracyRuns.trigger,
      results: accuracyRuns.resultsJson,
      logicVersions: accuracyRuns.logicVersionsJson,
    })
    .from(accuracyRuns)
    .orderBy(desc(accuracyRuns.id))
    .limit(n + 1);
  const out: AccuracyRunSummary[] = [];
  for (let i = 0; i < Math.min(n, rows.length); i++) {
    const r = rows[i];
    const prev = rows[i + 1];
    const versions = r.logicVersions ?? {};
    const changed: AccuracyRunSummary['changedVersions'] = {};
    if (prev) {
      const before = prev.logicVersions ?? {};
      for (const k of new Set([...Object.keys(before), ...Object.keys(versions)])) {
        if (before[k] !== versions[k]) changed[k] = { from: before[k] ?? null, to: versions[k] ?? null };
      }
    }
    out.push({
      id: r.id,
      createdAt: r.createdAt,
      sampleCount: r.sampleCount,
      blocked: r.blocked,
      blockedReasons: r.blockedReasons ?? [],
      comparedToRunId: r.comparedToRunId,
      trigger: r.trigger,
      keyMetrics: storedKeyMetrics(r.results),
      changedVersions: changed,
      logicVersions: versions,
    });
  }
  return out;
}
