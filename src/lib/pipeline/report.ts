/**
 * Run report (pure): per-source results, totals, the lifecycle sweep, alerts and HTTP usage of
 * one pipeline run, stored in `pipeline_runs.stats_json` and shown on the runs page. For a dry run
 * the same numbers form the "would change" summary (nothing was written).
 */
import type { RUN_STATUSES } from '../../db/schema/_enums';
import type { PlatformHttpStats } from '../http/polite';
import type { SweepResult } from '../lifecycle';
import type { SourceHealthFlags } from './quality';
import type { RunAlertRecord } from './stages/context';

export type RunStatus = (typeof RUN_STATUSES)[number];
export type SourceRunOutcome = 'ok' | 'partial' | 'failed' | 'skipped';

/** Item counts of one source run. In a dry run `created` / `updated` are "would" counts. */
export interface SourceCounts {
  /** Items the connector returned (markers included). */
  fetched: number;
  /** Distinct external ids in the listing (source-closed markers excluded). */
  listed: number;
  /** Repeated external ids in one fetch (first one wins). */
  duplicates: number;
  closedMarkers: number;
  /** Seen-only markers (listed, detail not fetched this run). */
  seenOnly: number;
  /** Seen-only markers of postings we do not have yet (fetched in a later run). */
  deferred: number;
  /** Dropped by the connector's relevance pre-filter. */
  filtered: number;
  /** Payload identical to the stored snapshot: only confirmed as listed. */
  unchanged: number;
  /** Items that went through parse. */
  attempted: number;
  parsed: number;
  failedParse: number;
  failedValidate: number;
  failedNormalize: number;
  failedPersist: number;
  /** New job rows (dry run: postings this source did not have yet). */
  created: number;
  /** Postings attached to an existing job of another source (dedup merge). */
  merged: number;
  /** Stored jobs whose content changed (dry run: postings whose payload changed). */
  updated: number;
  /** Re-processed postings without any stored change. */
  same: number;
  reopened: number;
  /** Re-listed after closing, or re-posted under a new id (repost_count +1; ghost-risk input). */
  reposts: number;
  /** Listed postings confirmed without re-processing (unchanged / seen-only / filtered). */
  confirmed: number;
  missing: number;
  missingIncremented: number;
  closedMissing: number;
  closedBySource: number;
  deadLetters: number;
  /**
   * Failures of a payload that already failed before (open dead letter with the same content).
   * Kept as dead letters but left out of the failure-rate checks, so one permanently broken
   * posting does not keep the source 'partial' (which would stop absence counting) forever.
   */
  repeatFailures: number;
  snapshotsCreated: number;
  aiQueued: number;
  titleQueued: number;
  followupErrors: number;
  possibleDuplicates: number;
}

export function emptyCounts(): SourceCounts {
  return {
    fetched: 0,
    listed: 0,
    duplicates: 0,
    closedMarkers: 0,
    seenOnly: 0,
    deferred: 0,
    filtered: 0,
    unchanged: 0,
    attempted: 0,
    parsed: 0,
    failedParse: 0,
    failedValidate: 0,
    failedNormalize: 0,
    failedPersist: 0,
    created: 0,
    merged: 0,
    updated: 0,
    same: 0,
    reopened: 0,
    reposts: 0,
    confirmed: 0,
    missing: 0,
    missingIncremented: 0,
    closedMissing: 0,
    closedBySource: 0,
    deadLetters: 0,
    repeatFailures: 0,
    snapshotsCreated: 0,
    aiQueued: 0,
    titleQueued: 0,
    followupErrors: 0,
    possibleDuplicates: 0,
  };
}

export interface SourceBreakerReport {
  consecutiveFailures: number;
  circuitOpenUntil: string | null;
  opened: boolean;
  recovered: boolean;
}

export interface SourceReport {
  sourceId: number;
  sourceKey: string;
  label: string;
  platformKey: string;
  status: SourceRunOutcome;
  /** Why the source was skipped (circuit open, daily cap, terms). */
  reason: string | null;
  error: string | null;
  listing: 'full' | 'incremental' | null;
  /** Full listing read completely (absence may count). */
  completeListing: boolean;
  partialReason: string | null;
  healthy: boolean;
  healthReason: string | null;
  canariesMissing: boolean;
  massCloseBlocked: boolean;
  flags: SourceHealthFlags;
  counts: SourceCounts;
  durationMs: number;
  breaker: SourceBreakerReport | null;
  checklistTicked: string[];
  filterReasons: Record<string, number>;
}

/** Overall run status from the per-source results. */
export function runStatusFor(sources: readonly Pick<SourceReport, 'status'>[], opts: { aborted: boolean; sweepFailed: boolean }): Exclude<RunStatus, 'queued' | 'running' | 'skipped'> {
  if (opts.aborted) return 'failed';
  if (!sources.length) return opts.sweepFailed ? 'partial' : 'ok';
  const ran = sources.filter((s) => s.status === 'ok' || s.status === 'partial').length;
  const failed = sources.filter((s) => s.status === 'failed').length;
  const partial = sources.filter((s) => s.status === 'partial').length;
  if (ran === 0 && failed > 0) return 'failed';
  if (failed > 0 || partial > 0 || opts.sweepFailed) return 'partial';
  // Everything skipped (circuits open, daily caps): nothing was fetched.
  if (ran === 0) return 'partial';
  return 'ok';
}

export interface RunReportInput {
  kind: string;
  dryRun: boolean;
  startedAt: Date;
  finishedAt: Date;
  sources: readonly SourceReport[];
  sweep: SweepResult | null;
  sweepError: string | null;
  alerts: readonly RunAlertRecord[];
  http: Record<string, PlatformHttpStats>;
  aborted: string | null;
}

export type RunTotals = SourceCounts & { sources: number; ok: number; partial: number; failed: number; skipped: number };

export interface CompactSourceReport {
  id: number;
  key: string;
  label: string;
  status: SourceRunOutcome;
  reason: string | null;
  error: string | null;
  healthy: boolean;
  healthReason: string | null;
  flags: string[];
  durationMs: number;
  counts: Partial<SourceCounts>;
}

export interface WouldChange {
  newPostings: number;
  changedPostings: number;
  confirmed: number;
  reopened: number;
  missingIncrements: number;
  closed: number;
  deadLetters: number;
  alerts: { kind: string; severity: string; title: string }[];
  lifecycle: SweepResult | null;
}

export interface RunReport {
  kind: string;
  dryRun: boolean;
  status: RunStatus;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  totals: RunTotals;
  sources: CompactSourceReport[];
  lifecycle: SweepResult | null;
  lifecycleError: string | null;
  alerts: RunAlertRecord[];
  http: Record<string, PlatformHttpStats>;
  aborted: string | null;
  wouldChange?: WouldChange;
}

/** Only the non-zero counters (keeps stats_json small and readable). */
function nonZero(c: SourceCounts): Partial<SourceCounts> {
  const out: Partial<SourceCounts> = {};
  for (const [k, v] of Object.entries(c) as [keyof SourceCounts, number][]) if (v) out[k] = v;
  return out;
}

export function flagNames(flags: SourceHealthFlags): string[] {
  return (Object.keys(flags) as (keyof SourceHealthFlags)[]).filter((k) => flags[k] !== undefined).sort();
}

export function sumCounts(list: readonly SourceCounts[]): SourceCounts {
  const out = emptyCounts();
  for (const c of list) for (const k of Object.keys(out) as (keyof SourceCounts)[]) out[k] += c[k];
  return out;
}

export function buildRunReport(input: RunReportInput): RunReport {
  const counts = sumCounts(input.sources.map((s) => s.counts));
  const by = (st: SourceRunOutcome) => input.sources.filter((s) => s.status === st).length;
  const status = runStatusFor(input.sources, { aborted: !!input.aborted, sweepFailed: !!input.sweepError });
  const report: RunReport = {
    kind: input.kind,
    dryRun: input.dryRun,
    status,
    startedAt: input.startedAt.toISOString(),
    finishedAt: input.finishedAt.toISOString(),
    durationMs: Math.max(0, input.finishedAt.getTime() - input.startedAt.getTime()),
    totals: { ...counts, sources: input.sources.length, ok: by('ok'), partial: by('partial'), failed: by('failed'), skipped: by('skipped') },
    sources: input.sources.map((s) => ({
      id: s.sourceId,
      key: s.sourceKey,
      label: s.label,
      status: s.status,
      reason: s.reason,
      error: s.error,
      healthy: s.healthy,
      healthReason: s.healthReason,
      flags: [...flagNames(s.flags), ...(s.canariesMissing ? ['canaries_missing'] : []), ...(s.massCloseBlocked ? ['mass_close_blocked'] : [])],
      durationMs: s.durationMs,
      counts: nonZero(s.counts),
    })),
    lifecycle: input.sweep,
    lifecycleError: input.sweepError,
    alerts: [...input.alerts],
    http: input.http,
    aborted: input.aborted,
  };
  if (input.dryRun) report.wouldChange = wouldChangeSummary(counts, input.sweep, input.alerts);
  return report;
}

export function wouldChangeSummary(c: SourceCounts, sweep: SweepResult | null, alerts: readonly RunAlertRecord[]): WouldChange {
  return {
    newPostings: c.created,
    changedPostings: c.updated,
    confirmed: c.confirmed,
    reopened: c.reopened,
    missingIncrements: c.missingIncremented,
    closed: c.closedMissing + c.closedBySource,
    deadLetters: c.deadLetters,
    alerts: alerts.map((a) => ({ kind: a.kind, severity: a.severity, title: a.title })),
    lifecycle: sweep,
  };
}

/** One-line summary for logs and the CLI. */
export function formatRunSummary(r: Pick<RunReport, 'kind' | 'dryRun' | 'status' | 'durationMs' | 'totals'>): string {
  const t = r.totals;
  const parts = [
    `${r.dryRun ? 'dry run' : r.kind} ${r.status} in ${Math.round(r.durationMs / 100) / 10}s`,
    `sources ${t.sources} (ok ${t.ok}, partial ${t.partial}, failed ${t.failed}, skipped ${t.skipped})`,
    `listed ${t.listed}`,
    `${r.dryRun ? 'would create' : 'created'} ${t.created}`,
    `${r.dryRun ? 'would update' : 'updated'} ${t.updated}`,
    `merged ${t.merged}`,
    `unchanged ${t.unchanged}`,
    `closed ${t.closedMissing + t.closedBySource}`,
    `reopened ${t.reopened}`,
    ...(t.reposts ? [`reposts ${t.reposts}`] : []),
    `dead letters ${t.deadLetters}`,
  ];
  return parts.join(' · ');
}
