/**
 * `npm run eval` — golden-sample accuracy evaluation from the shell (and `node dist/eval.mjs`
 * in the Docker image). See EVAL_USAGE in ./report.ts for the options.
 *
 * Exit code: 0 = passed, 1 = blocked or failed, 2 = bad arguments / unreadable file.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { closeDb, getDb } from '../db';
import { log } from '../log';
import { gate, type Thresholds } from './compare';
import { GoldenFileError, importGoldenSamples, parseGoldenFile, type GoldenFileEntry, type LoadResult } from './golden';
import { currentLogicVersions, evaluateSamples, runAccuracyEval } from './index';
import { defaultPredictEnv } from './predict';
import { EVAL_USAGE, EvalArgError, formatEvalReport, parseEvalArgs, parseThresholds, thresholdFailures, type EvalArgs } from './report';

class InputFileError extends Error {}

function readJsonFile(file: string, what: string): unknown {
  const abs = path.resolve(process.cwd(), file);
  let text: string;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (err) {
    throw new InputFileError(`cannot read ${what} ${file}: ${err instanceof Error ? err.message : String(err)}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (err) {
    throw new InputFileError(`${what} ${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function readGolden(file: string): { entries: GoldenFileEntry[]; load: LoadResult } {
  try {
    return parseGoldenFile(readJsonFile(file, 'golden file'));
  } catch (err) {
    if (err instanceof GoldenFileError) throw new InputFileError(`golden file ${file}: ${err.message}`);
    throw err;
  }
}

function print(out: unknown, args: EvalArgs, text: () => string): void {
  process.stdout.write(`${args.json ? JSON.stringify(out, null, 2) : text()}\n`);
}

/** --file without --save: no database at all (CI, a laptop without MySQL). */
function evaluateFileOnly(args: EvalArgs, file: string, thresholds: Thresholds | null): number {
  const { load } = readGolden(file);
  const report = evaluateSamples(load.samples, defaultPredictEnv());
  const verdict = gate(report, null);
  const notes = [
    'regression check against stored runs skipped (file mode; add --save to store and compare the run)',
    ...(load.skipped.length ? [`${load.skipped.length} sample(s) skipped: ${load.skipped.map((s) => `${s.id} (${s.reason})`).join('; ')}`] : []),
    ...verdict.notes.filter((n) => !n.startsWith('no previous run')),
  ];
  const failures = thresholdFailures(report, thresholds);
  const out = { sampleCount: load.samples.length, blocked: verdict.blocked, blockedReasons: verdict.reasons, thresholdFailures: failures, notes, logicVersions: currentLogicVersions(), report };
  print(out, args, () =>
    formatEvalReport({
      report,
      sampleCount: load.samples.length,
      origin: file,
      runId: null,
      comparedToRunId: null,
      comparison: null,
      blocked: verdict.blocked,
      blockedReasons: verdict.reasons,
      notes,
      thresholdFailures: failures,
      mistakes: args.mistakes,
    }),
  );
  return verdict.blocked || failures.length ? 1 : 0;
}

async function evaluateWithDb(args: EvalArgs, thresholds: Thresholds | null): Promise<number> {
  const db = getDb();
  const pre: string[] = [];
  let fileSamples: LoadResult | null = null;
  if (args.file) fileSamples = readGolden(args.file).load;
  if (args.importFile) {
    const { entries } = readGolden(args.importFile);
    const imported = await importGoldenSamples(db, entries);
    pre.push(`imported ${imported.inserted} sample(s) from ${args.importFile} (${imported.skipped} already present or unusable)`);
  }
  const res = await runAccuracyEval(db, {
    trigger: 'cli',
    compareToRunId: args.compareToRunId,
    persist: args.save ?? true,
    ...(fileSamples ? { samples: fileSamples.samples, skipped: fileSamples.skipped } : {}),
  });
  const failures = thresholdFailures(res.report, thresholds);
  const notes = [...pre, ...res.notes];
  print({ ...res, notes, thresholdFailures: failures }, args, () =>
    formatEvalReport({
      report: res.report,
      sampleCount: res.sampleCount,
      origin: args.file ?? 'database',
      runId: res.runId,
      comparedToRunId: res.comparedToRunId,
      comparison: res.comparison,
      blocked: res.blocked,
      blockedReasons: res.blockedReasons,
      notes,
      thresholdFailures: failures,
      mistakes: args.mistakes,
    }),
  );
  return res.blocked || failures.length ? 1 : 0;
}

async function main(): Promise<number> {
  let args: EvalArgs;
  let thresholds: Thresholds | null = null;
  try {
    args = parseEvalArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${EVAL_USAGE}\n`);
      return 0;
    }
    if (args.thresholds) thresholds = parseThresholds(readJsonFile(args.thresholds, 'thresholds file'));
    if (args.file && args.save !== true) return evaluateFileOnly(args, args.file, thresholds);
  } catch (err) {
    if (err instanceof EvalArgError || err instanceof InputFileError) {
      process.stderr.write(`error: ${err.message}\n\n${EVAL_USAGE}\n`);
      return 2;
    }
    throw err;
  }
  try {
    return await evaluateWithDb(args, thresholds);
  } catch (err) {
    if (err instanceof InputFileError) {
      process.stderr.write(`error: ${err.message}\n`);
      return 2;
    }
    log.error('accuracy eval failed', { error: err });
    return 1;
  } finally {
    await closeDb().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    log.error('accuracy eval crashed', { error: err });
    process.exit(1);
  },
);
