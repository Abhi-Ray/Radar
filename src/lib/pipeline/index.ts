// STUB(PIPELINE): minimal safe implementation — runs nothing and reports "skipped". The real
// orchestrator: fetch → raw snapshot → parse → quality gates → normalise → company → dedup →
// facts → visa/remote → score → lifecycle → report/alerts. Keep the exported signatures.
import type { RUN_STATUSES } from '../../db/schema/_enums';
import type { DbOrTx } from '../db';
import type { RunKind } from './queue';

export type RunStatus = (typeof RUN_STATUSES)[number];

export interface PipelineRunResult {
  runId: number | null;
  status: RunStatus;
  stats: Record<string, unknown>;
}

export interface ReprocessResult {
  reprocessed: number;
  failed: number;
  status: RunStatus;
}

export async function runPipeline(db: DbOrTx, opts: { kind: RunKind; dryRun: boolean; sourceIds?: number[] }): Promise<PipelineRunResult> {
  void db;
  return { runId: null, status: 'skipped', stats: { reason: 'pipeline not implemented yet', kind: opts.kind, dryRun: opts.dryRun } };
}

export async function reprocessFromRaw(db: DbOrTx, opts: { sourceIds?: number[]; since?: Date } = {}): Promise<ReprocessResult> {
  void db;
  void opts;
  return { reprocessed: 0, failed: 0, status: 'skipped' };
}
