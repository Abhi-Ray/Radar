/**
 * Golden-sample evaluation (spec §17.2): runs the current rules over every labelled golden
 * sample, scores precision / recall / accuracy per field (and per source), compares the result
 * with the previous good run and blocks the change when
 *
 *   - visa "confirmed" precision is below 98%, or
 *   - any key metric falls by more than 1 point (on the samples both runs scored).
 *
 * Every run is stored in accuracy_runs with the logic versions of every rule set and prompt, so
 * a number on the dashboard can always be traced back to the exact logic that produced it.
 * Deterministic: no AI, no network, no FX — the same samples and logic give the same result.
 */
import { desc, eq } from 'drizzle-orm';
import { accuracyRuns } from '../../db/schema';
import { promptVersions } from '../ai/prompts';
import type { AccuracyResults } from '../contracts/accuracy';
import type { DbOrTx } from '../db';
import { logicVersions } from '../pipeline/versions';
import { gate, type GateResult, type PreviousRun } from './compare';
import { loadDbGoldenSamples, type LoadedSample, type SkippedSample } from './golden';
import { scoreSamples, type AccuracyReport, type EvalSample } from './metrics';
import { defaultPredictEnv, predictSnapshot, type PredictEnv } from './predict';

export const ACCURACY_LOGIC_VERSION = 'accuracy@2026-09-30.1';

export interface AccuracyEvalOptions {
  trigger?: 'cli' | 'ui' | 'ci';
  /** Compare against this run (default: the latest unblocked run). */
  compareToRunId?: number | null;
  /** Store the run in accuracy_runs (default true). */
  persist?: boolean;
  /** Evaluate these samples instead of golden_samples (e.g. the JSON file in CI). */
  samples?: readonly LoadedSample[];
  /** Samples the loader could not use (reported, not scored). */
  skipped?: readonly SkippedSample[];
  /** Profile / title overrides / clock the rules run with (default: default profile, now). */
  env?: PredictEnv;
}

export interface AccuracyEvalResult {
  runId: number | null;
  sampleCount: number;
  results: AccuracyResults;
  blocked: boolean;
  blockedReasons: string[];
  logicVersions: Record<string, string>;
  /** Full report: key metrics, visa "confirmed" precision, per-sample marks, mistakes. */
  report: AccuracyReport;
  /** Non-blocking remarks (no previous run, samples skipped, …). */
  notes: string[];
  comparedToRunId: number | null;
  comparison: GateResult['common'];
  skipped: SkippedSample[];
  durationMs: number;
}

/** Logic versions of every rule set / prompt (recorded on each accuracy run). */
export function currentLogicVersions(): Record<string, string> {
  const out: Record<string, string> = { ...logicVersions() };
  for (const [task, version] of Object.entries(promptVersions())) out[`prompt.${task}`] = version;
  out.accuracy = ACCURACY_LOGIC_VERSION;
  return out;
}

/** Runs the rules on each sample (pure). */
export function predictSamples(samples: readonly LoadedSample[], env: PredictEnv): { scored: EvalSample[]; errors: { id: string; message: string }[] } {
  const scored: EvalSample[] = [];
  const errors: { id: string; message: string }[] = [];
  for (const s of samples) {
    const prediction = predictSnapshot(s.snapshot, env);
    if (prediction.error) errors.push({ id: s.id, message: prediction.error });
    scored.push({ key: s.key, id: s.id, sourceKey: s.sourceKey, labels: s.labels, prediction });
  }
  return { scored, errors };
}

/** Scores samples without touching the DB (tests, `npm run eval -- --file`). */
export function evaluateSamples(samples: readonly LoadedSample[], env: PredictEnv = defaultPredictEnv()): AccuracyReport {
  const { scored, errors } = predictSamples(samples, env);
  return scoreSamples(scored, errors);
}

async function loadPreviousRun(db: DbOrTx, compareToRunId: number | null | undefined): Promise<{ run: PreviousRun | null; note: string | null }> {
  if (compareToRunId !== undefined && compareToRunId !== null) {
    const [row] = await db
      .select({ id: accuracyRuns.id, results: accuracyRuns.resultsJson })
      .from(accuracyRuns)
      .where(eq(accuracyRuns.id, compareToRunId))
      .limit(1);
    if (!row) return { run: null, note: `run #${compareToRunId} to compare with does not exist` };
    return { run: row, note: null };
  }
  const [row] = await db
    .select({ id: accuracyRuns.id, results: accuracyRuns.resultsJson })
    .from(accuracyRuns)
    .where(eq(accuracyRuns.blocked, false))
    .orderBy(desc(accuracyRuns.id))
    .limit(1);
  return { run: row ?? null, note: null };
}

/**
 * Evaluates the golden sample (DB samples unless `opts.samples` is given), gates the result
 * against the previous good run and (by default) stores it in accuracy_runs.
 */
export async function runAccuracyEval(db: DbOrTx, opts: AccuracyEvalOptions = {}): Promise<AccuracyEvalResult> {
  const started = Date.now();
  const env = opts.env ?? defaultPredictEnv();
  let samples: readonly LoadedSample[];
  let skipped: SkippedSample[];
  if (opts.samples) {
    samples = opts.samples;
    skipped = [...(opts.skipped ?? [])];
  } else {
    const loaded = await loadDbGoldenSamples(db);
    samples = loaded.samples;
    skipped = loaded.skipped;
  }
  const report = evaluateSamples(samples, env);
  const versions = currentLogicVersions();
  const notes: string[] = [];
  if (!samples.length) notes.push('no labelled golden samples to evaluate — label some on /accuracy or import tests/golden/samples.json');
  if (skipped.length) notes.push(`${skipped.length} golden sample(s) skipped (unlabelled or unusable)`);

  const previous = await loadPreviousRun(db, opts.compareToRunId);
  if (previous.note) notes.push(previous.note);
  const verdict = gate(report, previous.run);
  notes.push(...verdict.notes);

  const persist = (opts.persist ?? true) && samples.length > 0;
  const durationMs = Date.now() - started;
  let runId: number | null = null;
  if (persist) {
    const [res] = await db.insert(accuracyRuns).values({
      logicVersionsJson: versions,
      resultsJson: {
        ...report,
        comparison: verdict.common,
        notes,
        skipped,
      } as unknown as Record<string, unknown>,
      sampleCount: samples.length,
      blocked: verdict.blocked,
      blockedReasonsJson: verdict.reasons.length ? verdict.reasons : null,
      comparedToRunId: previous.run?.id ?? null,
      trigger: opts.trigger ?? null,
      durationMs,
    });
    runId = Number(res.insertId);
  }
  return {
    runId,
    sampleCount: samples.length,
    results: { fields: report.fields, bySource: report.bySource },
    blocked: verdict.blocked,
    blockedReasons: verdict.reasons,
    logicVersions: versions,
    report,
    notes,
    comparedToRunId: previous.run?.id ?? null,
    comparison: verdict.common,
    skipped,
    durationMs,
  };
}

export { CONFIRMED_PRECISION_MIN, MAX_DROP, belowThresholds, gate, pct, type Thresholds } from './compare';
export { GoldenFileError, goldenSampleCounts, importGoldenSamples, loadDbGoldenSamples, parseGoldenFile, type LoadedSample, type SkippedSample } from './golden';
export { flatMetrics, KEY_METRIC_CONFIRMED, KEY_METRIC_ROLE_PRECISION, scoreSamples, type AccuracyReport, type Mistake } from './metrics';
export { defaultPredictEnv, predictSnapshot, readSnapshot, type Prediction, type PredictEnv } from './predict';
