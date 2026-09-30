import 'server-only';
import { desc, eq, isNotNull, isNull, sql, count } from 'drizzle-orm';
import { alerts, auditLog, backupRuns, deadLetters, jobs, pipelineRuns, sourceRuns, sources } from '@/db/schema';
import { backupState, type BackupState } from '@/components/system/backups';
import { getAiBudget, type AiBudget } from '@/lib/ai/budget';
import { getDb, type DbOrTx } from '@/lib/db';
import { readHealthFlags } from '@/lib/queries/sources';

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface RunRow {
  id: number;
  kind: string;
  status: string;
  requestedBy: string;
  dryRun: boolean;
  startedAt: Date | null;
  finishedAt: Date | null;
  createdAt: Date;
  error: string | null;
  sources: number;
  created: number;
  updated: number;
  failedItems: number;
  durationMs: number | null;
}

function toRun(r: typeof pipelineRuns.$inferSelect): RunRow {
  const t = rec(rec(r.statsJson).totals);
  return {
    id: r.id,
    kind: r.kind,
    status: r.status,
    requestedBy: r.requestedBy,
    dryRun: r.dryRun,
    startedAt: r.startedAt,
    finishedAt: r.finishedAt,
    createdAt: r.createdAt,
    error: r.error,
    sources: num(t.sources),
    created: num(t.created),
    updated: num(t.updated),
    failedItems: num(t.failedPersist) + num(t.failedParse) + num(t.failedNormalize) + num(t.failedValidate),
    durationMs: r.startedAt && r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null,
  };
}

export interface ReportSource {
  sourceId: number;
  label: string;
  sourceKey: string;
  status: string;
  fetched: number;
  parsed: number;
  newCount: number;
  updatedCount: number;
  closedCount: number;
  failedParse: number;
  durationMs: number | null;
  note: string | null;
  problem: boolean;
}

export interface HttpRow {
  platform: string;
  requests: number;
  failures: number;
  retries: number;
  waitedMs: number;
  bytes: number;
}

export interface AlertRow {
  id: number;
  kind: string;
  severity: 'info' | 'warn' | 'critical';
  title: string;
  body: string | null;
  occurrences: number;
  createdAt: Date;
  lastRaisedAt: Date;
  acknowledgedAt: Date | null;
}

export interface SystemView {
  runs: RunRow[];
  selected: { run: RunRow; totals: Record<string, number>; sources: ReportSource[]; http: HttpRow[] } | null;
  alerts: { open: AlertRow[]; recent: AlertRow[] };
  backup: BackupState;
  backupRows: { id: number; kind: string; status: string; startedAt: Date; finishedAt: Date | null; sizeBytes: number | null; error: string | null; tables: number | null; rows: number | null }[];
  deadLetters: { open: number; byStage: { stage: string; n: number }[]; recent: { id: number; stage: string; error: string; externalId: string | null; sourceLabel: string | null; createdAt: Date }[] };
  audit: { id: number; actor: string; action: string; entityType: string; entityId: string | null; reason: string | null; at: Date }[];
  jobsTotal: number;
  ai: AiBudget;
  version: string | null;
}

export async function loadSystem(opts: { runId?: number | null; db?: DbOrTx } = {}): Promise<SystemView> {
  const db = opts.db ?? getDb();
  const now = new Date();
  const [runRows, openAlerts, recentAlerts, backupRowsRaw, deadCount, deadByStage, deadRecent, auditRows, [jobsRow], ai] = await Promise.all([
    db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.id)).limit(15),
    db.select().from(alerts).where(isNull(alerts.acknowledgedAt)).orderBy(sql`field(${alerts.severity}, 'critical', 'warn', 'info')`, desc(alerts.lastRaisedAt)).limit(100),
    db.select().from(alerts).where(isNotNull(alerts.acknowledgedAt)).orderBy(desc(alerts.acknowledgedAt)).limit(8),
    db.select().from(backupRuns).orderBy(desc(backupRuns.id)).limit(12),
    db.select({ n: count() }).from(deadLetters).where(eq(deadLetters.status, 'open')),
    db.select({ stage: deadLetters.stage, n: count() }).from(deadLetters).where(eq(deadLetters.status, 'open')).groupBy(deadLetters.stage),
    db
      .select({ id: deadLetters.id, stage: deadLetters.stage, error: deadLetters.error, externalId: deadLetters.externalId, sourceLabel: sources.label, createdAt: deadLetters.createdAt })
      .from(deadLetters)
      .leftJoin(sources, eq(sources.id, deadLetters.sourceId))
      .where(eq(deadLetters.status, 'open'))
      .orderBy(desc(deadLetters.id))
      .limit(8),
    db.select().from(auditLog).orderBy(desc(auditLog.id)).limit(40),
    db.select({ n: count() }).from(jobs).where(isNull(jobs.mergedIntoJobId)),
    getAiBudget(db, now),
  ]);

  const runs = runRows.map(toRun);
  const latestReal = runRows.find((r) => r.kind !== 'linkcheck');
  const wanted = opts.runId ? runRows.find((r) => r.id === opts.runId) ?? (await db.select().from(pipelineRuns).where(eq(pipelineRuns.id, opts.runId)).limit(1))[0] : latestReal;
  let selected: SystemView['selected'] = null;
  if (wanted) {
    const stats = rec(wanted.statsJson);
    const perSource = await db
      .select({
        sourceId: sourceRuns.sourceId,
        label: sources.label,
        sourceKey: sources.sourceKey,
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
      })
      .from(sourceRuns)
      .innerJoin(sources, eq(sources.id, sourceRuns.sourceId))
      .where(eq(sourceRuns.runId, wanted.id));
    const reportSources: ReportSource[] = perSource
      .map((s) => {
        const f = readHealthFlags(s.flags);
        const note = s.error ?? f.skipReason ?? (f.raised.length ? f.raised.join(', ') : null) ?? (s.status !== 'ok' && f.healthy === false ? f.healthReason : null);
        const problem = s.status !== 'ok' && s.status !== 'skipped' ? true : s.error !== null || f.raised.length > 0 || s.failedParse > 0;
        return { sourceId: s.sourceId, label: s.label, sourceKey: s.sourceKey, status: s.status, fetched: s.fetched, parsed: s.parsed, newCount: s.newCount, updatedCount: s.updatedCount, closedCount: s.closedCount, failedParse: s.failedParse, durationMs: s.durationMs, note, problem };
      })
      .sort((a, b) => Number(b.problem) - Number(a.problem) || b.newCount - a.newCount || a.label.localeCompare(b.label));
    const totals = Object.fromEntries(Object.entries(rec(stats.totals)).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
    const http = Object.entries(rec(stats.http))
      .map(([platform, v]) => {
        const h = rec(v);
        return { platform, requests: num(h.requests), failures: num(h.failures), retries: num(h.retries), waitedMs: num(h.waitedMs), bytes: num(h.bytes) };
      })
      .sort((a, b) => b.bytes - a.bytes);
    selected = { run: toRun(wanted), totals, sources: reportSources, http };
  }

  const backupRows = backupRowsRaw.map((b) => {
    const d = rec(b.detailsJson);
    return { id: b.id, kind: b.kind, status: b.status, startedAt: b.startedAt, finishedAt: b.finishedAt, sizeBytes: b.sizeBytes, error: b.error, tables: typeof d.tables === 'number' ? d.tables : Array.isArray(d.tables) ? d.tables.length : null, rows: typeof d.totalRows === 'number' ? d.totalRows : null };
  });

  return {
    runs,
    selected,
    alerts: { open: openAlerts as AlertRow[], recent: recentAlerts as AlertRow[] },
    backup: backupState(backupRowsRaw, now),
    backupRows,
    deadLetters: { open: deadCount[0]?.n ?? 0, byStage: deadByStage, recent: deadRecent },
    audit: auditRows.map((a) => ({ id: a.id, actor: a.actor, action: a.action, entityType: a.entityType, entityId: a.entityId, reason: a.reason, at: a.at })),
    jobsTotal: jobsRow?.n ?? 0,
    ai,
    version: process.env.GIT_SHA ? process.env.GIT_SHA.slice(0, 7) : null,
  };
}
