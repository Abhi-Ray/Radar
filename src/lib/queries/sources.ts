/**
 * /sources reads (server only): the health table, one source's detail page and the platform
 * registry. Health verdicts are derived with the pure helpers in components/sources so the table,
 * the detail page and the tests agree.
 */
import 'server-only';
import { and, asc, count, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import {
  auditLog,
  deadLetters,
  jobSources,
  pipelineRuns,
  rawSnapshots,
  sourcePlatforms,
  sourceRuns,
  sources,
  type SourceBaseline,
  type SourceChecklist,
} from '@/db/schema';
import { checklistProgress, normalizeChecklist, parseFailureRate } from '@/components/sources/checklist';
import type { VolumePoint } from '@/components/sources/spark';
import { CONNECTORS, getConnector } from '@/lib/connectors';
import { getDb, type DbOrTx } from '@/lib/db';

/** Runs shown in the table sparkline (= BASELINE_RUNS). */
export const SPARK_RUNS = 14;

export interface HealthFlags {
  healthy: boolean | null;
  healthReason: string | null;
  listed: number | null;
  /** Health flag names raised on the run (volume_drop, parse_fail_pct, schema_drift, …). */
  raised: string[];
  skipReason: string | null;
  /** Set when "reset baseline" retired this run from the baseline. */
  baselineReset: { at: string } | null;
  checklistTicked: string[];
}

/** Known non-flag keys of source_runs.health_flags_json. */
const FLAG_META_KEYS = new Set([
  'healthy',
  'healthReason',
  'listing',
  'complete',
  'partialReason',
  'listed',
  'presence',
  'freshnessHours',
  'skipReason',
  'counts',
  'filterReasons',
  'checklistTicked',
  'baselineReset',
  'canaries',
  'detailFetch',
]);

export function readHealthFlags(v: unknown): HealthFlags {
  const o = v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const reset = o.baselineReset && typeof o.baselineReset === 'object' ? (o.baselineReset as Record<string, unknown>) : null;
  const listed = typeof o.listed === 'number' ? o.listed : reset && typeof reset.listed === 'number' ? reset.listed : null;
  const raised = Object.entries(o)
    .filter(([k, val]) => !FLAG_META_KEYS.has(k) && val !== false && val !== null && val !== undefined)
    .map(([k]) => k)
    .sort();
  return {
    healthy: typeof o.healthy === 'boolean' ? o.healthy : null,
    healthReason: typeof o.healthReason === 'string' ? o.healthReason : null,
    listed,
    raised,
    skipReason: typeof o.skipReason === 'string' ? o.skipReason : null,
    baselineReset: reset && typeof reset.at === 'string' ? { at: reset.at } : null,
    checklistTicked: Array.isArray(o.checklistTicked) ? o.checklistTicked.filter((x): x is string => typeof x === 'string') : [],
  };
}

function baselineOf(v: unknown): SourceBaseline | null {
  if (!v || typeof v !== 'object') return null;
  const b = v as Partial<SourceBaseline>;
  return {
    volume_min: typeof b.volume_min === 'number' ? b.volume_min : null,
    volume_max: typeof b.volume_max === 'number' ? b.volume_max : null,
    freshness_hours: typeof b.freshness_hours === 'number' ? b.freshness_hours : null,
    field_presence: b.field_presence && typeof b.field_presence === 'object' ? (b.field_presence as Record<string, number>) : {},
  };
}

export interface SourceHealthRow {
  id: number;
  label: string;
  sourceKey: string;
  platformKey: string;
  platformName: string | null;
  grade: string | null;
  termsStatus: string | null;
  status: 'draft' | 'trial' | 'live' | 'paused' | 'disabled';
  countryIso2: string | null;
  lastRunAt: Date | null;
  lastSuccessAt: Date | null;
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
  checklist: { done: number; total: number };
  baseline: SourceBaseline | null;
  /** Oldest → newest, at most SPARK_RUNS. */
  spark: VolumePoint[];
  lastRunStatus: string | null;
  parseFailRate: number | null;
}

interface RecentRun {
  sourceId: number;
  status: string;
  fetched: number;
  parsed: number;
  failedParse: number;
  flags: unknown;
}

async function recentRunsBySource(db: DbOrTx, sourceIds: number[], perSource: number): Promise<Map<number, RecentRun[]>> {
  const out = new Map<number, RecentRun[]>();
  if (sourceIds.length === 0) return out;
  const ranked = db
    .select({
      sourceId: sourceRuns.sourceId,
      status: sourceRuns.status,
      fetched: sourceRuns.fetched,
      parsed: sourceRuns.parsed,
      failedParse: sourceRuns.failedParse,
      flags: sourceRuns.healthFlagsJson,
      id: sourceRuns.id,
      rn: sql<number>`row_number() over (partition by ${sourceRuns.sourceId} order by ${sourceRuns.id} desc)`.as('rn'),
    })
    .from(sourceRuns)
    .where(inArray(sourceRuns.sourceId, sourceIds))
    .as('ranked');
  const rows = await db
    .select({
      sourceId: ranked.sourceId,
      status: ranked.status,
      fetched: ranked.fetched,
      parsed: ranked.parsed,
      failedParse: ranked.failedParse,
      flags: ranked.flags,
      id: ranked.id,
    })
    .from(ranked)
    .where(lte(ranked.rn, perSource))
    .orderBy(asc(ranked.sourceId), asc(ranked.id));
  for (const r of rows) {
    const list = out.get(r.sourceId) ?? [];
    list.push({ sourceId: r.sourceId, status: r.status, fetched: r.fetched, parsed: r.parsed, failedParse: r.failedParse, flags: r.flags });
    out.set(r.sourceId, list);
  }
  return out;
}

export function sparkPoint(r: { status: string; fetched: number; flags: unknown }): VolumePoint {
  const f = readHealthFlags(r.flags);
  if (r.status === 'skipped') return { value: null };
  return { value: f.listed ?? r.fetched, failed: r.status === 'failed' };
}

export async function listSourcesHealth(db: DbOrTx = getDb()): Promise<SourceHealthRow[]> {
  const rows = await db
    .select({
      id: sources.id,
      label: sources.label,
      sourceKey: sources.sourceKey,
      platformKey: sources.platformKey,
      platformName: sourcePlatforms.name,
      grade: sourcePlatforms.grade,
      termsStatus: sourcePlatforms.termsStatus,
      status: sources.status,
      countryIso2: sources.countryIso2,
      lastRunAt: sources.lastRunAt,
      lastSuccessAt: sources.lastSuccessAt,
      consecutiveFailures: sources.consecutiveFailures,
      circuitOpenUntil: sources.circuitOpenUntil,
      checklistJson: sources.checklistJson,
      baselineJson: sources.baselineJson,
    })
    .from(sources)
    .leftJoin(sourcePlatforms, eq(sourcePlatforms.key, sources.platformKey))
    .orderBy(sql`field(${sources.status}, 'live', 'trial', 'paused', 'draft', 'disabled')`, asc(sources.label));
  const runs = await recentRunsBySource(
    db,
    rows.map((r) => r.id),
    SPARK_RUNS,
  );
  return rows.map((r) => {
    const rs = runs.get(r.id) ?? [];
    const progress = checklistProgress(r.checklistJson);
    return {
      id: r.id,
      label: r.label,
      sourceKey: r.sourceKey,
      platformKey: r.platformKey,
      platformName: r.platformName,
      grade: r.grade,
      termsStatus: r.termsStatus,
      status: r.status,
      countryIso2: r.countryIso2,
      lastRunAt: r.lastRunAt,
      lastSuccessAt: r.lastSuccessAt,
      consecutiveFailures: r.consecutiveFailures,
      circuitOpenUntil: r.circuitOpenUntil,
      checklist: { done: progress.done, total: progress.total },
      baseline: baselineOf(r.baselineJson),
      spark: rs.map(sparkPoint),
      lastRunStatus: rs.length ? rs[rs.length - 1]!.status : null,
      parseFailRate: parseFailureRate(rs.filter((x) => x.status !== 'skipped')),
    };
  });
}

// ---- detail --------------------------------------------------------------------------------

export interface SourceRunHistoryRow {
  id: number;
  runId: number;
  kind: string | null;
  dryRun: boolean;
  status: string;
  fetched: number;
  parsed: number;
  newCount: number;
  updatedCount: number;
  closedCount: number;
  failedParse: number;
  durationMs: number | null;
  error: string | null;
  flags: HealthFlags;
  startedAt: Date | null;
  finishedAt: Date | null;
}

export interface ConfigCheck {
  valid: boolean;
  issues: string[];
  /** sourceKeyFor(config) — must equal the stored source_key. */
  derivedKey: string | null;
}

export interface SourceDetail {
  source: {
    id: number;
    label: string;
    sourceKey: string;
    platformKey: string;
    status: 'draft' | 'trial' | 'live' | 'paused' | 'disabled';
    countryIso2: string | null;
    companyId: number | null;
    configJson: Record<string, unknown>;
    notes: string | null;
    consecutiveFailures: number;
    circuitOpenUntil: Date | null;
    lastRunAt: Date | null;
    lastSuccessAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  };
  platform: {
    key: string;
    name: string;
    grade: string;
    accessMethod: string;
    termsUrl: string | null;
    termsStatus: string;
    termsReviewedAt: Date | null;
    termsNotes: string | null;
    rateLimitPerMin: number;
    dailyCap: number;
  } | null;
  connector: { known: boolean; kind: string | null; listing: string | null; version: string | null; attribution: string | null; notes: string | null };
  config: ConfigCheck;
  checklist: SourceChecklist;
  baseline: SourceBaseline | null;
  runs: SourceRunHistoryRow[];
  stats: { rawSnapshots: number; jobLinks: number; openDeadLetters: number };
  /** Status before the most recent pause (for "resume"), from the audit trail. */
  statusBeforePause: string | null;
  history: { id: number; action: string; at: Date; reason: string | null; before: unknown; after: unknown }[];
}

export function checkConfig(platformKey: string, config: unknown, storedKey: string | null): ConfigCheck {
  const connector = getConnector(platformKey);
  if (!connector) return { valid: false, issues: [`No connector is registered for platform “${platformKey}”.`], derivedKey: null };
  const parsed = connector.configSchema.safeParse(config);
  if (!parsed.success) {
    return {
      valid: false,
      issues: parsed.error.issues.slice(0, 8).map((i) => `${i.path.length ? `${i.path.join('.')}: ` : ''}${i.message}`),
      derivedKey: null,
    };
  }
  let derivedKey: string | null = null;
  try {
    derivedKey = connector.sourceKeyFor(parsed.data);
  } catch {
    derivedKey = null;
  }
  const issues = storedKey !== null && derivedKey !== null && derivedKey !== storedKey ? [`This config belongs to “${derivedKey}”, not “${storedKey}”.`] : [];
  return { valid: issues.length === 0, issues, derivedKey };
}

/** Status of a source before its latest pause, read from the audit trail (null when unknown). */
export async function statusBeforeLastPause(db: DbOrTx, sourceId: number): Promise<string | null> {
  const rows = await db
    .select({ before: auditLog.beforeJson, after: auditLog.afterJson })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'source'), eq(auditLog.entityId, String(sourceId)), eq(auditLog.action, 'source.status')))
    .orderBy(desc(auditLog.id))
    .limit(25);
  for (const r of rows) {
    const after = r.after as { status?: unknown } | null;
    if (after?.status === 'paused') {
      const before = r.before as { status?: unknown } | null;
      return typeof before?.status === 'string' ? before.status : null;
    }
  }
  return null;
}

export async function getSourceDetail(id: number, db: DbOrTx = getDb()): Promise<SourceDetail | null> {
  const [row] = await db.select().from(sources).where(eq(sources.id, id)).limit(1);
  if (!row) return null;
  const [platform] = await db.select().from(sourcePlatforms).where(eq(sourcePlatforms.key, row.platformKey)).limit(1);
  const runRows = await db
    .select({
      id: sourceRuns.id,
      runId: sourceRuns.runId,
      kind: pipelineRuns.kind,
      dryRun: pipelineRuns.dryRun,
      status: sourceRuns.status,
      fetched: sourceRuns.fetched,
      parsed: sourceRuns.parsed,
      newCount: sourceRuns.newCount,
      updatedCount: sourceRuns.updatedCount,
      closedCount: sourceRuns.closedCount,
      failedParse: sourceRuns.failedParse,
      durationMs: sourceRuns.durationMs,
      error: sourceRuns.error,
      flags: sourceRuns.healthFlagsJson,
      startedAt: sourceRuns.startedAt,
      finishedAt: sourceRuns.finishedAt,
    })
    .from(sourceRuns)
    .leftJoin(pipelineRuns, eq(pipelineRuns.id, sourceRuns.runId))
    .where(eq(sourceRuns.sourceId, id))
    .orderBy(desc(sourceRuns.id))
    .limit(30);
  const [[snaps], [links], [dls], before, historyRows] = await Promise.all([
    db.select({ n: count() }).from(rawSnapshots).where(eq(rawSnapshots.sourceId, id)),
    db.select({ n: count() }).from(jobSources).where(eq(jobSources.sourceId, id)),
    db
      .select({ n: count() })
      .from(deadLetters)
      .where(and(eq(deadLetters.sourceId, id), inArray(deadLetters.status, ['open', 'retried']))),
    statusBeforeLastPause(db, id),
    db
      .select({ id: auditLog.id, action: auditLog.action, at: auditLog.at, reason: auditLog.reason, before: auditLog.beforeJson, after: auditLog.afterJson })
      .from(auditLog)
      .where(and(eq(auditLog.entityType, 'source'), eq(auditLog.entityId, String(id))))
      .orderBy(desc(auditLog.id))
      .limit(15),
  ]);
  const connector = getConnector(row.platformKey);
  return {
    source: {
      id: row.id,
      label: row.label,
      sourceKey: row.sourceKey,
      platformKey: row.platformKey,
      status: row.status,
      countryIso2: row.countryIso2,
      companyId: row.companyId,
      configJson: row.configJson ?? {},
      notes: row.notes,
      consecutiveFailures: row.consecutiveFailures,
      circuitOpenUntil: row.circuitOpenUntil,
      lastRunAt: row.lastRunAt,
      lastSuccessAt: row.lastSuccessAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    platform: platform
      ? {
          key: platform.key,
          name: platform.name,
          grade: platform.grade,
          accessMethod: platform.accessMethod,
          termsUrl: platform.termsUrl,
          termsStatus: platform.termsStatus,
          termsReviewedAt: platform.termsReviewedAt,
          termsNotes: platform.termsNotes,
          rateLimitPerMin: platform.rateLimitPerMin,
          dailyCap: platform.dailyCap,
        }
      : null,
    connector: {
      known: Boolean(connector),
      kind: connector?.kind ?? null,
      listing: connector?.listing ?? null,
      version: connector?.version ?? null,
      attribution: connector?.platform.attribution ?? null,
      notes: connector?.platform.notes ?? null,
    },
    config: checkConfig(row.platformKey, row.configJson ?? {}, row.sourceKey),
    checklist: normalizeChecklist(row.checklistJson),
    baseline: baselineOf(row.baselineJson),
    runs: runRows.map((r) => ({ ...r, kind: r.kind ?? null, dryRun: Boolean(r.dryRun), flags: readHealthFlags(r.flags) })),
    stats: { rawSnapshots: Number(snaps?.n ?? 0), jobLinks: Number(links?.n ?? 0), openDeadLetters: Number(dls?.n ?? 0) },
    statusBeforePause: before,
    history: historyRows,
  };
}

// ---- platform registry ---------------------------------------------------------------------

export interface PlatformRow {
  key: string;
  name: string;
  grade: string;
  accessMethod: string;
  termsUrl: string | null;
  termsStatus: string;
  termsReviewedAt: Date | null;
  termsNotes: string | null;
  rateLimitPerMin: number;
  dailyCap: number;
  /** False = a connector exists but no source uses it yet (no source_platforms row). */
  registered: boolean;
  hasConnector: boolean;
  sourceCount: number;
  attribution: string | null;
}

export async function listPlatforms(db: DbOrTx = getDb()): Promise<PlatformRow[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(sourcePlatforms).orderBy(asc(sourcePlatforms.grade), asc(sourcePlatforms.name)),
    db.select({ key: sources.platformKey, n: count() }).from(sources).groupBy(sources.platformKey),
  ]);
  const n = new Map(counts.map((c) => [c.key, Number(c.n)]));
  const out: PlatformRow[] = rows.map((p) => ({
    key: p.key,
    name: p.name,
    grade: p.grade,
    accessMethod: p.accessMethod,
    termsUrl: p.termsUrl,
    termsStatus: p.termsStatus,
    termsReviewedAt: p.termsReviewedAt,
    termsNotes: p.termsNotes,
    rateLimitPerMin: p.rateLimitPerMin,
    dailyCap: p.dailyCap,
    registered: true,
    hasConnector: Boolean(CONNECTORS[p.key]),
    sourceCount: n.get(p.key) ?? 0,
    attribution: CONNECTORS[p.key]?.platform.attribution ?? null,
  }));
  const seen = new Set(rows.map((r) => r.key));
  for (const [key, c] of Object.entries(CONNECTORS)) {
    if (seen.has(key)) continue;
    out.push({
      key,
      name: c.platform.name,
      grade: c.platform.grade,
      accessMethod: c.platform.accessMethod,
      termsUrl: c.platform.termsUrl,
      termsStatus: 'unknown',
      termsReviewedAt: null,
      termsNotes: null,
      rateLimitPerMin: c.platform.rateLimitPerMin,
      dailyCap: c.platform.dailyCap,
      registered: false,
      hasConnector: true,
      sourceCount: 0,
      attribution: c.platform.attribution,
    });
  }
  return out.sort((a, b) => a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name));
}

/** Connector keys + an example config for the "add source" form. */
export function connectorChoices(): { key: string; name: string; grade: string; kind: string; example: string }[] {
  const EXAMPLES: Record<string, Record<string, unknown>> = {
    greenhouse: { board: 'gitlab' },
    lever: { company: 'example', region: 'global' },
    ashby: { org: 'example' },
    smartrecruiters: { companyId: 'Example' },
    workable: { slug: 'example' },
    recruitee: { slug: 'example' },
    personio: { slug: 'example', domain: 'de' },
    bundesagentur: { queries: [{ was: 'IT-Sicherheit' }] },
    jobtech_se: { queries: ['cloud security'] },
    remotive: { categories: ['software-dev', 'devops'] },
    jobicy: { tags: ['security', 'devops'] },
  };
  return Object.entries(CONNECTORS)
    .map(([key, c]) => ({ key, name: c.platform.name, grade: c.platform.grade, kind: c.kind, example: JSON.stringify(EXAMPLES[key] ?? {}) }))
    .sort((a, b) => a.grade.localeCompare(b.grade) || a.name.localeCompare(b.name));
}
