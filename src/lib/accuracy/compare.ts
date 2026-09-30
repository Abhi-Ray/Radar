/**
 * Regression gate (spec §17.2): a logic change is blocked when
 *
 *   - visa "confirmed" precision is below 98% (a wrong "Confirmed" is the worst error), or
 *   - any key metric falls by more than 1 point versus the previous run.
 *
 * Runs are compared on the samples both runs scored with the same labels (per-sample marks in
 * results_json), so adding or relabelling golden samples never looks like a regression — and
 * never hides one either. A previous run without per-sample marks (older format) is compared on
 * its stored totals instead.
 */
import { GOLDEN_FIELDS, type GoldenField } from '../contracts/accuracy';
import { KEY_METRIC_CONFIRMED, keyMetricsOf, type AccuracyReport, type KeyMetrics, type SampleMarks } from './metrics';

/** Minimum visa "confirmed" precision (spec §1: ≥ 98%). */
export const CONFIRMED_PRECISION_MIN = 0.98;
/** A key metric may not fall by more than this (1 point). */
export const MAX_DROP = 0.01;
/** Float noise guard (e.g. 0.98 computed as 0.97999…). */
const EPS = 1e-9;

export interface PreviousRun {
  id: number;
  results: unknown;
}

export interface GateResult {
  blocked: boolean;
  reasons: string[];
  notes: string[];
  /** Key metrics of both runs on the common samples (null when no comparison was possible). */
  common: { count: number; before: KeyMetrics; after: KeyMetrics } | null;
}

export function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

function isMarks(v: unknown): v is SampleMarks {
  if (!v || typeof v !== 'object') return false;
  const m = v as Record<string, unknown>;
  return Array.isArray(m.ok) && Array.isArray(m.bad);
}

/** Per-sample marks stored in a run's results_json (null when the run has none). */
export function marksOf(results: unknown): Record<string, SampleMarks> | null {
  if (!results || typeof results !== 'object') return null;
  const s = (results as Record<string, unknown>).samples;
  if (!s || typeof s !== 'object' || Array.isArray(s)) return null;
  const out: Record<string, SampleMarks> = {};
  for (const [k, v] of Object.entries(s as Record<string, unknown>)) {
    if (!isMarks(v)) continue;
    out[k] = {
      ok: v.ok.filter((f): f is GoldenField => (GOLDEN_FIELDS as readonly string[]).includes(f as string)),
      bad: v.bad.filter((f): f is GoldenField => (GOLDEN_FIELDS as readonly string[]).includes(f as string)),
      ...(v.pc ? { pc: true as const } : {}),
      ...(v.rm ? { rm: true as const } : {}),
    };
  }
  return out;
}

/** Stored key metrics of a run (its `keyMetrics`, else derived from per-field accuracy). */
export function storedKeyMetrics(results: unknown): KeyMetrics {
  if (!results || typeof results !== 'object') return {};
  const r = results as Record<string, unknown>;
  const out: KeyMetrics = {};
  if (r.keyMetrics && typeof r.keyMetrics === 'object') {
    for (const [k, v] of Object.entries(r.keyMetrics as Record<string, unknown>)) {
      if (typeof v === 'number' || v === null) out[k] = v;
    }
    return out;
  }
  const fields = (r.fields ?? {}) as Record<string, { accuracy?: unknown; precision?: unknown } | undefined>;
  for (const f of GOLDEN_FIELDS) {
    const a = fields[f]?.accuracy;
    if (typeof a === 'number') out[`${f}.accuracy`] = a;
  }
  const rp = fields.role_match?.precision;
  if (typeof rp === 'number') out['role_match.precision'] = rp;
  return out;
}

function drops(before: KeyMetrics, after: KeyMetrics, runId: number, scope: string): string[] {
  const reasons: string[] = [];
  for (const [k, b] of Object.entries(before)) {
    const a = after[k];
    if (b === null || a === null || a === undefined) continue;
    if (b - a > MAX_DROP + EPS) {
      reasons.push(`${k} fell from ${pct(b)} to ${pct(a)} (${((a - b) * 100).toFixed(1)} pts) vs run #${runId} ${scope}`);
    }
  }
  return reasons;
}

/** Decides whether the current evaluation blocks the change. Pure. */
export function gate(current: AccuracyReport, previous: PreviousRun | null): GateResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const cp = current.confirmed.precision;
  if (cp === null) {
    notes.push('no visa "confirmed" predictions on the labelled samples — confirmed precision not measurable');
  } else if (cp < CONFIRMED_PRECISION_MIN - EPS) {
    reasons.push(
      `visa "confirmed" precision ${pct(cp)} is below ${pct(CONFIRMED_PRECISION_MIN)} (${current.confirmed.predicted - current.confirmed.correct} wrong of ${current.confirmed.predicted})`,
    );
  }
  let common: GateResult['common'] = null;
  if (!previous) {
    notes.push('no previous run to compare with (first run or all earlier runs blocked)');
  } else {
    const prevMarks = marksOf(previous.results);
    if (prevMarks) {
      const keys = Object.keys(current.samples).filter((k) => k in prevMarks);
      if (!keys.length) {
        notes.push(`no samples in common with run #${previous.id} — regression check skipped`);
      } else {
        const before = keyMetricsOf(keys.map((k) => prevMarks[k]));
        const after = keyMetricsOf(keys.map((k) => current.samples[k]));
        common = { count: keys.length, before, after };
        reasons.push(...drops(before, after, previous.id, `on ${keys.length} common sample${keys.length === 1 ? '' : 's'}`));
      }
    } else {
      notes.push(`run #${previous.id} has no per-sample data — compared on its stored totals`);
      reasons.push(...drops(storedKeyMetrics(previous.results), current.keyMetrics, previous.id, 'on all samples'));
    }
  }
  if (current.errors.length) notes.push(`${current.errors.length} sample(s) could not be processed by the rules`);
  return { blocked: reasons.length > 0, reasons, notes, common };
}

/** Thresholds file (tests/golden/thresholds.json): metric → minimum value (0..1). */
export type Thresholds = Record<string, number>;

/** Metrics below their threshold (missing metrics count as failures). */
export function belowThresholds(metrics: KeyMetrics, thresholds: Thresholds): string[] {
  const out: string[] = [];
  for (const [k, min] of Object.entries(thresholds)) {
    if (k.startsWith('_') || typeof min !== 'number') continue;
    const v = metrics[k];
    if (v === null || v === undefined) out.push(`${k} was not measured (threshold ${pct(min)})`);
    else if (v < min - EPS) out.push(`${k} ${pct(v)} is below the threshold ${pct(min)}`);
  }
  return out;
}

export { KEY_METRIC_CONFIRMED };
