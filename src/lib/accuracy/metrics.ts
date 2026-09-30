/**
 * Per-field precision / recall / accuracy of the rules on the golden sample (spec §17.2).
 *
 * - An absent label = not labelled: the sample does not count for that field.
 * - Categorical fields (role_key, seniority, visa_status, remote_class, language, country_iso2):
 *   macro precision / recall over the classes that occur.
 * - "Is there one?" fields (role_match, salary, experience_min_years): precision / recall of the
 *   positive class (a match / a stated salary / a stated minimum), where a positive only counts
 *   as a hit when the value is right too.
 * - Visa: `falseConfirmed` counts wrong "confirmed" predictions, and "confirmed" precision is
 *   reported on its own (target ≥ 98%, spec §1 — a wrong "Confirmed" is the worst error).
 */
import { GOLDEN_FIELDS, type AccuracyResults, type FieldMetrics, type GoldenField, type GoldenLabels } from '../contracts/accuracy';
import type { Prediction } from './predict';

export interface EvalSample {
  /** Stable key of the sample + its content (runs are compared on common keys). */
  key: string;
  /** Short display id ("db:12", "file:de-cloudsec-1"). */
  id: string;
  sourceKey: string | null;
  labels: GoldenLabels;
  prediction: Prediction;
}

export interface FieldOutcome {
  field: GoldenField;
  /** Class strings (for confusion counts / display). */
  label: string;
  predicted: string;
  correct: boolean;
  /** Label says "there is one" (binary fields). */
  labelPositive: boolean;
  predictedPositive: boolean;
}

/** Per-sample marks kept in results_json so later runs can be compared on the same samples. */
export interface SampleMarks {
  /** Fields labelled and predicted right. */
  ok: GoldenField[];
  /** Fields labelled and predicted wrong. */
  bad: GoldenField[];
  /** Predicted visa "confirmed" (only when visa_status is labelled). */
  pc?: true;
  /** Predicted role match (only when role_match is labelled). */
  rm?: true;
}

export interface Mistake {
  id: string;
  field: GoldenField;
  label: string;
  predicted: string;
  sourceKey: string | null;
}

export type KeyMetrics = Record<string, number | null>;

export interface AccuracyReport extends AccuracyResults {
  keyMetrics: KeyMetrics;
  confirmed: { predicted: number; correct: number; precision: number | null };
  samples: Record<string, SampleMarks>;
  mistakes: Mistake[];
  errors: { id: string; message: string }[];
}

export const BINARY_FIELDS: readonly GoldenField[] = ['role_match', 'salary', 'experience_min_years'];
export const KEY_METRIC_CONFIRMED = 'visa_status.confirmed_precision';
export const KEY_METRIC_ROLE_PRECISION = 'role_match.precision';
const MAX_MISTAKES = 300;
/** Salary amounts match within 0.5% (rounding in the posting, "52.5k"). */
const AMOUNT_TOLERANCE = 0.005;

function none(v: unknown): string {
  return v === null || v === undefined || v === '' ? 'none' : String(v);
}

function amountsEqual(a: number | null | undefined, b: number | null | undefined): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return (a ?? null) === (b ?? null);
  return Math.abs(a - b) <= Math.max(0.5, Math.abs(a) * AMOUNT_TOLERANCE);
}

function salaryClass(s: { stated: boolean; currency?: string | null; period?: string | null; min?: number | null; max?: number | null }): string {
  if (!s.stated) return 'none';
  return [s.currency ?? '?', s.period ?? '?', s.min ?? '-', s.max ?? '-'].join(' ');
}

/** Compares one field; null when the field is not labelled. */
export function compareField(field: GoldenField, labels: GoldenLabels, p: Prediction): FieldOutcome | null {
  const label = labels[field];
  if (label === undefined) return null;
  switch (field) {
    case 'role_match': {
      const l = labels.role_match as boolean;
      return { field, label: String(l), predicted: String(p.role_match), correct: l === p.role_match, labelPositive: l, predictedPositive: p.role_match };
    }
    case 'salary': {
      const l = labels.salary!;
      const ps = p.salary;
      let correct = l.stated === ps.stated;
      if (correct && l.stated) {
        if (l.currency !== undefined && (l.currency ?? null) !== ps.currency) correct = false;
        if (l.period !== undefined && (l.period ?? null) !== ps.period) correct = false;
        if (l.min !== undefined && !amountsEqual(l.min, ps.min)) correct = false;
        if (l.max !== undefined && !amountsEqual(l.max, ps.max)) correct = false;
      }
      return { field, label: salaryClass(l), predicted: salaryClass(ps), correct, labelPositive: l.stated, predictedPositive: ps.stated };
    }
    case 'experience_min_years': {
      const l = labels.experience_min_years ?? null;
      const v = p.experience_min_years;
      const correct = l === null ? v === null : v !== null && Math.abs(l - v) < 0.01;
      return { field, label: none(l), predicted: none(v), correct, labelPositive: l !== null, predictedPositive: v !== null };
    }
    case 'country_iso2': {
      const l = none((labels.country_iso2 ?? null)?.toUpperCase());
      const v = none(p.country_iso2?.toUpperCase());
      return { field, label: l, predicted: v, correct: l === v, labelPositive: l !== 'none', predictedPositive: v !== 'none' };
    }
    default: {
      const l = none(label as string | null);
      const v = none(p[field] as string | null);
      return { field, label: l, predicted: v, correct: l === v, labelPositive: l !== 'none', predictedPositive: v !== 'none' };
    }
  }
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/** FieldMetrics of one field from its outcomes. */
export function fieldMetrics(field: GoldenField, outcomes: FieldOutcome[]): FieldMetrics {
  const support = outcomes.length;
  const correct = outcomes.filter((o) => o.correct).length;
  let precision: number | null;
  let recall: number | null;
  if (BINARY_FIELDS.includes(field)) {
    const tp = outcomes.filter((o) => o.predictedPositive && o.labelPositive && o.correct).length;
    precision = ratio(tp, outcomes.filter((o) => o.predictedPositive).length);
    recall = ratio(tp, outcomes.filter((o) => o.labelPositive).length);
  } else {
    const classes = new Set(outcomes.flatMap((o) => [o.label, o.predicted]));
    const ps: number[] = [];
    const rs: number[] = [];
    for (const c of classes) {
      const tp = outcomes.filter((o) => o.label === c && o.predicted === c).length;
      const predicted = outcomes.filter((o) => o.predicted === c).length;
      const labelled = outcomes.filter((o) => o.label === c).length;
      if (predicted) ps.push(tp / predicted);
      if (labelled) rs.push(tp / labelled);
    }
    precision = mean(ps);
    recall = mean(rs);
  }
  const m: FieldMetrics = { support, correct, accuracy: ratio(correct, support), precision, recall };
  if (field === 'visa_status') m.falseConfirmed = outcomes.filter((o) => o.predicted === 'confirmed' && o.label !== 'confirmed').length;
  return m;
}

/** Key metrics (the ones a change must not make worse) from per-sample marks. */
export function keyMetricsOf(marks: Iterable<SampleMarks>): KeyMetrics {
  const list = [...marks];
  const out: KeyMetrics = {};
  for (const f of GOLDEN_FIELDS) {
    const ok = list.filter((m) => m.ok.includes(f)).length;
    const bad = list.filter((m) => m.bad.includes(f)).length;
    if (ok + bad) out[`${f}.accuracy`] = ok / (ok + bad);
  }
  const pc = list.filter((m) => m.pc);
  out[KEY_METRIC_CONFIRMED] = ratio(pc.filter((m) => m.ok.includes('visa_status')).length, pc.length);
  const rm = list.filter((m) => m.rm);
  out[KEY_METRIC_ROLE_PRECISION] = ratio(rm.filter((m) => m.ok.includes('role_match')).length, rm.length);
  return out;
}

/** Scores the predictions of a set of samples. */
export function scoreSamples(samples: EvalSample[], errors: { id: string; message: string }[] = []): AccuracyReport {
  const byField = new Map<GoldenField, FieldOutcome[]>();
  const bySourceField = new Map<string, Map<GoldenField, FieldOutcome[]>>();
  const marks: Record<string, SampleMarks> = {};
  const mistakes: Mistake[] = [];
  for (const s of samples) {
    const m: SampleMarks = { ok: [], bad: [] };
    const src = s.sourceKey ?? '(none)';
    for (const field of GOLDEN_FIELDS) {
      const o = compareField(field, s.labels, s.prediction);
      if (!o) continue;
      byField.set(field, [...(byField.get(field) ?? []), o]);
      const perSource = bySourceField.get(src) ?? new Map<GoldenField, FieldOutcome[]>();
      perSource.set(field, [...(perSource.get(field) ?? []), o]);
      bySourceField.set(src, perSource);
      (o.correct ? m.ok : m.bad).push(field);
      if (field === 'visa_status' && o.predicted === 'confirmed') m.pc = true;
      if (field === 'role_match' && o.predictedPositive) m.rm = true;
      if (!o.correct && mistakes.length < MAX_MISTAKES) mistakes.push({ id: s.id, field, label: o.label, predicted: o.predicted, sourceKey: s.sourceKey });
    }
    marks[s.key] = m;
  }
  const fields: AccuracyResults['fields'] = {};
  for (const f of GOLDEN_FIELDS) {
    const o = byField.get(f);
    if (o?.length) fields[f] = fieldMetrics(f, o);
  }
  const bySource: AccuracyResults['bySource'] = {};
  for (const [src, perField] of [...bySourceField.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    bySource[src] = {};
    for (const f of GOLDEN_FIELDS) {
      const o = perField.get(f);
      if (o?.length) bySource[src][f] = fieldMetrics(f, o);
    }
  }
  const pcList = Object.values(marks).filter((m) => m.pc);
  const pcCorrect = pcList.filter((m) => m.ok.includes('visa_status')).length;
  return {
    fields,
    bySource,
    keyMetrics: keyMetricsOf(Object.values(marks)),
    confirmed: { predicted: pcList.length, correct: pcCorrect, precision: ratio(pcCorrect, pcList.length) },
    samples: marks,
    mistakes,
    errors,
  };
}

/**
 * Every measured number of a report as one flat map (`<field>.accuracy|precision|recall`, plus
 * the key metrics) — what the thresholds file and the CLI table read.
 */
export function flatMetrics(r: AccuracyReport): KeyMetrics {
  const out: KeyMetrics = {};
  for (const f of GOLDEN_FIELDS) {
    const m = r.fields[f];
    if (!m) continue;
    out[`${f}.accuracy`] = m.accuracy;
    out[`${f}.precision`] = m.precision;
    out[`${f}.recall`] = m.recall;
  }
  return { ...out, ...r.keyMetrics };
}
