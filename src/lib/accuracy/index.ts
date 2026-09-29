// STUB(AI+ACCURACY): minimal safe implementation — evaluates nothing, writes nothing, blocks
// nothing. The real evaluator scores the golden sample per field/source and blocks regressions
// (spec §17.2). Keep the exported signatures.
import type { AccuracyResults } from '../contracts/accuracy';
import type { DbOrTx } from '../db';

export const ACCURACY_LOGIC_VERSION = 'accuracy-stub-0';

export interface AccuracyEvalOptions {
  trigger?: 'cli' | 'ui' | 'ci';
  /** Compare against this run (default: the latest unblocked run). */
  compareToRunId?: number | null;
  /** Store the run in accuracy_runs (default true). */
  persist?: boolean;
}

export interface AccuracyEvalResult {
  runId: number | null;
  sampleCount: number;
  results: AccuracyResults;
  blocked: boolean;
  blockedReasons: string[];
  logicVersions: Record<string, string>;
}

/** Logic versions of every rule set / prompt (recorded on each accuracy run). */
export function currentLogicVersions(): Record<string, string> {
  return { accuracy: ACCURACY_LOGIC_VERSION };
}

export async function runAccuracyEval(db: DbOrTx, opts: AccuracyEvalOptions = {}): Promise<AccuracyEvalResult> {
  void db;
  void opts;
  return {
    runId: null,
    sampleCount: 0,
    results: { fields: {}, bySource: {} },
    blocked: false,
    blockedReasons: [],
    logicVersions: currentLogicVersions(),
  };
}
