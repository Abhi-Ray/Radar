/**
 * Source health (pure): circuit breaker, "healthy run" test for missing counts, baselines, and the
 * source checklist auto-tick. The DB side lives in run.ts; everything here is unit-tested.
 */
import type { SourceBaseline, SourceChecklist, SourceChecklistItem } from '../../db/schema/sources';
import { DAY_MS, HOUR_MS } from '../time';

export const HEALTH_LOGIC_VERSION = 'health@2026-09-30.1';

// ---- circuit breaker ---------------------------------------------------------------------------

/** Consecutive failed runs that open the circuit. */
export const BREAKER_THRESHOLD = 3;
/** First open period; doubles with every further failure (12 h, 24 h, 48 h …). */
export const BREAKER_BASE_MS = 12 * HOUR_MS;
export const BREAKER_MAX_MS = 7 * DAY_MS;

export type SourceOutcome = 'ok' | 'partial' | 'failed' | 'skipped';

export interface BreakerState {
  consecutiveFailures: number;
  circuitOpenUntil: Date | null;
}

export interface BreakerUpdate extends BreakerState {
  /** The circuit (re)opened with this run. */
  opened: boolean;
  openForMs: number | null;
  /** First success after the circuit had opened. */
  recovered: boolean;
}

export function breakerOpenMs(consecutiveFailures: number): number | null {
  if (consecutiveFailures < BREAKER_THRESHOLD) return null;
  const k = consecutiveFailures - BREAKER_THRESHOLD;
  return Math.min(BREAKER_MAX_MS, BREAKER_BASE_MS * 2 ** Math.min(k, 20));
}

/** Breaker state after a source run. 'skipped' (daily cap, circuit open) changes nothing. */
export function breakerAfterRun(prev: BreakerState, outcome: SourceOutcome, now: Date): BreakerUpdate {
  if (outcome === 'skipped') return { ...prev, opened: false, openForMs: null, recovered: false };
  if (outcome === 'failed') {
    const consecutiveFailures = prev.consecutiveFailures + 1;
    const openForMs = breakerOpenMs(consecutiveFailures);
    return {
      consecutiveFailures,
      circuitOpenUntil: openForMs === null ? prev.circuitOpenUntil : new Date(now.getTime() + openForMs),
      opened: openForMs !== null,
      openForMs,
      recovered: false,
    };
  }
  return {
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    opened: false,
    openForMs: null,
    recovered: prev.consecutiveFailures >= BREAKER_THRESHOLD,
  };
}

export function isCircuitOpen(state: Pick<BreakerState, 'circuitOpenUntil'>, now: Date): boolean {
  return !!state.circuitOpenUntil && state.circuitOpenUntil.getTime() > now.getTime();
}

// ---- healthy run ---------------------------------------------------------------------------------

/** A full listing must reach this share of the baseline minimum before absence counts. */
export const HEALTHY_VOLUME_SHARE = 0.5;

export interface HealthyRunInput {
  status: SourceOutcome;
  /** 'full' listing that was read completely this run. */
  completeListing: boolean;
  /** Items the listing returned (excluding source-closed markers). */
  listed: number;
  baseline: SourceBaseline | null;
  /** The long-lived canary postings all vanished at once (id scheme change?). */
  canariesMissing: boolean;
}

export interface HealthyRunResult {
  healthy: boolean;
  reason: string;
}

/**
 * Whether absence from this run may count toward closing jobs: status ok, complete full listing,
 * volume ≥ 50% of the baseline minimum (or > 0 before a baseline exists), canaries present.
 */
export function healthyForMissing(input: HealthyRunInput): HealthyRunResult {
  if (input.status !== 'ok') return { healthy: false, reason: `source run ${input.status}` };
  if (!input.completeListing) return { healthy: false, reason: 'listing incomplete or incremental' };
  if (input.canariesMissing) return { healthy: false, reason: 'long-lived postings all missing' };
  const min = input.baseline?.volume_min ?? null;
  if (min !== null && min > 0) {
    const need = Math.ceil(min * HEALTHY_VOLUME_SHARE);
    if (input.listed < need) return { healthy: false, reason: `volume ${input.listed} below ${need} (50% of baseline minimum ${min})` };
    return { healthy: true, reason: 'ok' };
  }
  if (input.listed <= 0) return { healthy: false, reason: 'empty listing and no baseline yet' };
  return { healthy: true, reason: 'ok (no baseline yet)' };
}

// ---- baselines -------------------------------------------------------------------------------------

export const BASELINE_RUNS = 14;
export const BASELINE_MIN_RUNS = 3;

export interface BaselineSample {
  volume: number;
  /** field → share (0..1) of parsed items carrying it; absent when too few items were parsed. */
  presence: Record<string, number> | null;
  freshnessHours: number | null;
}

/** Linear-interpolated quantile of an ascending array. */
export function quantile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return Number.NaN;
  const pos = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function median(values: readonly number[]): number | null {
  const v = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  return v.length ? quantile(v, 0.5) : null;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Baseline from the last 14 healthy runs (newest first; extra samples ignored). The normal volume
 * range is the interquartile band around the median (robust to one odd run); field presence and
 * freshness are medians. Null until 3 healthy runs exist.
 */
export function computeBaseline(samples: readonly BaselineSample[]): SourceBaseline | null {
  const recent = samples.slice(0, BASELINE_RUNS).filter((s) => Number.isFinite(s.volume) && s.volume >= 0);
  if (recent.length < BASELINE_MIN_RUNS) return null;
  const volumes = recent.map((s) => s.volume).sort((a, b) => a - b);
  const fields = new Set<string>();
  for (const s of recent) for (const k of Object.keys(s.presence ?? {})) fields.add(k);
  const fieldPresence: Record<string, number> = {};
  for (const f of [...fields].sort()) {
    const m = median(recent.flatMap((s) => (s.presence && typeof s.presence[f] === 'number' ? [s.presence[f]] : [])));
    if (m !== null) fieldPresence[f] = round3(m);
  }
  const fresh = median(recent.flatMap((s) => (s.freshnessHours === null ? [] : [s.freshnessHours])));
  return {
    volume_min: Math.floor(quantile(volumes, 0.25)),
    volume_max: Math.ceil(quantile(volumes, 0.75)),
    freshness_hours: fresh === null ? null : Math.round(fresh * 10) / 10,
    field_presence: fieldPresence,
  };
}

// ---- checklist -------------------------------------------------------------------------------------

export const CHECKLIST_KEYS = [
  'terms_reviewed',
  'samples_saved',
  'parser_handles_samples',
  'baseline_recorded',
  'rate_limit_set',
  'alerts_configured',
  'hand_checked_20',
] as const satisfies readonly (keyof SourceChecklist)[];
export type ChecklistKey = (typeof CHECKLIST_KEYS)[number];

export function emptyChecklist(): SourceChecklist {
  const item = (): SourceChecklistItem => ({ done: false, at: null, note: null });
  return {
    terms_reviewed: item(),
    samples_saved: item(),
    parser_handles_samples: item(),
    baseline_recorded: item(),
    rate_limit_set: item(),
    alerts_configured: item(),
    hand_checked_20: item(),
  };
}

function readItem(v: unknown): SourceChecklistItem {
  if (!v || typeof v !== 'object') return { done: false, at: null, note: null };
  const o = v as Record<string, unknown>;
  return {
    done: o.done === true,
    at: typeof o.at === 'string' ? o.at : null,
    note: typeof o.note === 'string' ? o.note : null,
  };
}

export function readChecklist(v: unknown): SourceChecklist {
  const out = emptyChecklist();
  if (v && typeof v === 'object') for (const k of CHECKLIST_KEYS) out[k] = readItem((v as Record<string, unknown>)[k]);
  return out;
}

/** Evidence the pipeline can check by itself; `hand_checked_20` is always a manual tick. */
export type ChecklistEvidence = Partial<Record<Exclude<ChecklistKey, 'hand_checked_20'>, string | null>>;

/**
 * Ticks the items whose evidence is present (value = the note). Never unticks anything and never
 * touches an item that is already done (a manual note stays).
 */
export function autoTickChecklist(current: unknown, evidence: ChecklistEvidence, now: Date): { checklist: SourceChecklist; ticked: ChecklistKey[] } {
  const checklist = readChecklist(current);
  const ticked: ChecklistKey[] = [];
  for (const [k, note] of Object.entries(evidence) as [Exclude<ChecklistKey, 'hand_checked_20'>, string | null | undefined][]) {
    if (!note || checklist[k].done) continue;
    checklist[k] = { done: true, at: now.toISOString(), note: `auto: ${note}`.slice(0, 500) };
    ticked.push(k);
  }
  return { checklist, ticked };
}
