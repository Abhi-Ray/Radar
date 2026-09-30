/**
 * `npm run eval` argument parsing and the plain-text report table (pure; the CLI entry is
 * ./cli.ts).
 */
import { GOLDEN_FIELDS } from '../contracts/accuracy';
import { belowThresholds, pct, type Thresholds } from './compare';
import { flatMetrics, KEY_METRIC_CONFIRMED, type AccuracyReport } from './metrics';

export const EVAL_USAGE = `Usage: npm run eval -- [options]

Evaluates the current rules on the golden sample (spec §17.2): per-field precision / recall /
accuracy, visa "confirmed" precision (must be >= 98%), and a regression check against the last
good run (any key metric falling by more than 1 point blocks the change).

Options:
  (none)                  evaluate the golden samples stored in the database, save the run
  --file <path>           evaluate a golden JSON file (e.g. tests/golden/samples.json) without
                          the database; combine with --save to store and compare the run
  --import <path>         import a golden JSON file into the database first (idempotent), then
                          evaluate the database samples
  --thresholds <path>     also fail when a metric is below its minimum in this JSON file
  --compare <runId>       compare with this run instead of the latest unblocked one
  --no-save               evaluate the database samples without storing the run
  --save                  with --file: store the run in the database and compare it
  --mistakes <n|all>      list up to n wrong predictions (default 20)
  --json                  print the full result as JSON instead of the table
  --help                  show this help

Exit code: 0 = passed, 1 = blocked (regression, confirmed precision < 98%, below thresholds)
or failed, 2 = bad arguments or unreadable file.`;

export interface EvalArgs {
  help: boolean;
  file: string | null;
  importFile: string | null;
  thresholds: string | null;
  compareToRunId: number | null;
  save: boolean | null;
  mistakes: number;
  json: boolean;
}

export class EvalArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EvalArgError';
  }
}

const DEFAULT_MISTAKES = 20;

/** Parses argv (without node + script). Throws EvalArgError on bad input. */
export function parseEvalArgs(argv: readonly string[]): EvalArgs {
  const a: EvalArgs = { help: false, file: null, importFile: null, thresholds: null, compareToRunId: null, save: null, mistakes: DEFAULT_MISTAKES, json: false };
  const args = [...argv];
  const value = (flag: string, inline: string | undefined): string => {
    const v = inline ?? args.shift();
    if (v === undefined || v === '' || (inline === undefined && v.startsWith('--'))) throw new EvalArgError(`${flag} needs a value`);
    return v;
  };
  while (args.length) {
    const raw = args.shift()!;
    const eq = raw.indexOf('=');
    const flag = raw.startsWith('--') && eq > 0 ? raw.slice(0, eq) : raw;
    const inline = raw.startsWith('--') && eq > 0 ? raw.slice(eq + 1) : undefined;
    switch (flag) {
      case '--help':
      case '-h':
        a.help = true;
        break;
      case '--file':
        a.file = value(flag, inline);
        break;
      case '--import':
        a.importFile = value(flag, inline);
        break;
      case '--thresholds':
        a.thresholds = value(flag, inline);
        break;
      case '--compare': {
        const v = value(flag, inline);
        if (!/^\d+$/.test(v) || Number(v) < 1) throw new EvalArgError('--compare needs a run id (positive integer)');
        a.compareToRunId = Number(v);
        break;
      }
      case '--save':
        a.save = true;
        break;
      case '--no-save':
        a.save = false;
        break;
      case '--mistakes': {
        const v = value(flag, inline);
        if (v === 'all') a.mistakes = Number.POSITIVE_INFINITY;
        else if (/^\d+$/.test(v)) a.mistakes = Number(v);
        else throw new EvalArgError('--mistakes needs a number or "all"');
        break;
      }
      case '--json':
        a.json = true;
        break;
      default:
        throw new EvalArgError(`unknown argument "${raw}"`);
    }
  }
  if (a.file && a.importFile) throw new EvalArgError('use either --file or --import, not both');
  if (a.file && a.compareToRunId !== null && a.save !== true) throw new EvalArgError('--compare with --file needs --save (the comparison uses stored runs)');
  return a;
}

/** Parses a thresholds file's content: metric → minimum (keys starting with "_" are comments). */
export function parseThresholds(json: unknown): Thresholds {
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new EvalArgError('thresholds file must be a JSON object');
  const out: Thresholds = {};
  for (const [k, v] of Object.entries(json as Record<string, unknown>)) {
    if (k.startsWith('_')) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) throw new EvalArgError(`threshold "${k}" must be a number between 0 and 1`);
    out[k] = v;
  }
  return out;
}

function pad(s: string, n: number, right = false): string {
  return right ? s.padStart(n) : s.padEnd(n);
}

export interface FormatInput {
  report: AccuracyReport;
  sampleCount: number;
  origin: string;
  runId: number | null;
  comparedToRunId: number | null;
  comparison: { count: number } | null;
  blocked: boolean;
  blockedReasons: string[];
  notes: string[];
  thresholdFailures: string[];
  mistakes: number;
}

/** The plain-text table printed by `npm run eval`. */
export function formatEvalReport(i: FormatInput): string {
  const r = i.report;
  const lines: string[] = [];
  lines.push(`RADAR accuracy — ${i.sampleCount} golden sample${i.sampleCount === 1 ? '' : 's'} (${i.origin})${i.runId !== null ? `, stored as run #${i.runId}` : ''}`);
  lines.push('');
  const head = `${pad('field', 22)}${pad('n', 6, true)}${pad('accuracy', 11, true)}${pad('precision', 11, true)}${pad('recall', 9, true)}`;
  lines.push(head);
  lines.push('-'.repeat(head.length));
  for (const f of GOLDEN_FIELDS) {
    const m = r.fields[f];
    if (!m) continue;
    lines.push(`${pad(f, 22)}${pad(String(m.support), 6, true)}${pad(pct(m.accuracy), 11, true)}${pad(pct(m.precision), 11, true)}${pad(pct(m.recall), 9, true)}`);
  }
  lines.push('');
  const c = r.confirmed;
  lines.push(`visa "confirmed" precision: ${pct(c.precision)} (${c.correct} of ${c.predicted} right; wrong "confirmed": ${r.fields.visa_status?.falseConfirmed ?? 0})`);
  const rp = r.keyMetrics['role_match.precision'];
  lines.push(`role-match precision: ${pct(rp)}`);
  const sources = Object.keys(r.bySource);
  if (sources.length > 1) {
    // Only sources with at least one wrong visa / remote / role-match answer, worst first.
    const worst = (s: string) => {
      const b = r.bySource[s];
      return Math.min(b.visa_status?.accuracy ?? 1, b.remote_class?.accuracy ?? 1, b.role_match?.accuracy ?? 1);
    };
    const weak = sources.filter((s) => worst(s) < 1).sort((a, b) => worst(a) - worst(b) || a.localeCompare(b));
    lines.push('');
    if (!weak.length) {
      lines.push(`by source: visa / remote / role match all correct in ${sources.length} sources`);
    } else {
      lines.push('by source (accuracy of visa / remote / role match; sources with mistakes only):');
      for (const s of weak.slice(0, 15)) {
        const b = r.bySource[s];
        lines.push(`  ${pad(s, 28)} visa ${pad(pct(b.visa_status?.accuracy), 7, true)}  remote ${pad(pct(b.remote_class?.accuracy), 7, true)}  role ${pad(pct(b.role_match?.accuracy), 7, true)}`);
      }
      if (weak.length > 15) lines.push(`  … ${weak.length - 15} more source(s) with mistakes`);
      lines.push(`  ${sources.length - weak.length} other source(s): all correct`);
    }
  }
  if (r.errors.length) {
    lines.push('');
    lines.push(`${r.errors.length} sample(s) the rules could not process:`);
    for (const e of r.errors.slice(0, 10)) lines.push(`  ${e.id}: ${e.message}`);
  }
  if (i.mistakes > 0 && r.mistakes.length) {
    const shown = r.mistakes.slice(0, i.mistakes);
    lines.push('');
    lines.push(`wrong predictions (${shown.length} of ${r.mistakes.length}):`);
    for (const m of shown) lines.push(`  ${pad(m.id, 34)} ${pad(m.field, 21)} expected ${m.label} — got ${m.predicted}`);
  }
  lines.push('');
  if (i.comparedToRunId !== null) {
    lines.push(`compared with run #${i.comparedToRunId}${i.comparison ? ` on ${i.comparison.count} common sample${i.comparison.count === 1 ? '' : 's'}` : ''}`);
  }
  for (const n of i.notes) lines.push(`note: ${n}`);
  const failures = [...i.blockedReasons, ...i.thresholdFailures];
  if (i.blocked || i.thresholdFailures.length) {
    lines.push('');
    lines.push('BLOCKED:');
    for (const f of failures) lines.push(`  - ${f}`);
  } else {
    lines.push('');
    lines.push('PASSED: no regression, visa "confirmed" precision within target.');
  }
  return lines.join('\n');
}

/** Threshold failures of a report (empty when no thresholds are given). */
export function thresholdFailures(report: AccuracyReport, thresholds: Thresholds | null): string[] {
  return thresholds ? belowThresholds(flatMetrics(report), thresholds) : [];
}

export { KEY_METRIC_CONFIRMED };
