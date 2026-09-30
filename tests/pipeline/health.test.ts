/** Pure source-health rules: circuit breaker, "healthy run" for absence, baselines, checklist. */
import { describe, expect, it } from 'vitest';
import {
  autoTickChecklist,
  BASELINE_RUNS,
  BREAKER_BASE_MS,
  BREAKER_MAX_MS,
  breakerAfterRun,
  breakerOpenMs,
  computeBaseline,
  emptyChecklist,
  healthyForMissing,
  isCircuitOpen,
  median,
  quantile,
  readChecklist,
  type BaselineSample,
} from '../../src/lib/pipeline/health';
import { HOUR_MS } from '../../src/lib/time';

const now = new Date('2026-09-30T00:30:00.000Z');

describe('circuit breaker', () => {
  it('opens after the 3rd consecutive failure for 12h, then doubles (capped at 7 days)', () => {
    expect(breakerOpenMs(1)).toBeNull();
    expect(breakerOpenMs(2)).toBeNull();
    expect(breakerOpenMs(3)).toBe(12 * HOUR_MS);
    expect(breakerOpenMs(4)).toBe(24 * HOUR_MS);
    expect(breakerOpenMs(5)).toBe(48 * HOUR_MS);
    expect(breakerOpenMs(50)).toBe(BREAKER_MAX_MS);
  });

  it('counts failures and opens the circuit on the threshold', () => {
    let s = { consecutiveFailures: 0, circuitOpenUntil: null as Date | null };
    const a = breakerAfterRun(s, 'failed', now);
    expect(a).toMatchObject({ consecutiveFailures: 1, opened: false, circuitOpenUntil: null });
    s = breakerAfterRun(a, 'failed', now);
    const c = breakerAfterRun(s, 'failed', now);
    expect(c.opened).toBe(true);
    expect(c.consecutiveFailures).toBe(3);
    expect(c.circuitOpenUntil?.getTime()).toBe(now.getTime() + BREAKER_BASE_MS);
    expect(isCircuitOpen(c, now)).toBe(true);
    expect(isCircuitOpen(c, new Date(now.getTime() + BREAKER_BASE_MS))).toBe(false);
  });

  it('skipped runs change nothing; a success resets and reports recovery', () => {
    const open = { consecutiveFailures: 4, circuitOpenUntil: new Date(now.getTime() + HOUR_MS) };
    expect(breakerAfterRun(open, 'skipped', now)).toMatchObject({ consecutiveFailures: 4, circuitOpenUntil: open.circuitOpenUntil, opened: false });
    expect(breakerAfterRun(open, 'ok', now)).toMatchObject({ consecutiveFailures: 0, circuitOpenUntil: null, recovered: true });
    expect(breakerAfterRun({ consecutiveFailures: 1, circuitOpenUntil: null }, 'partial', now)).toMatchObject({ consecutiveFailures: 0, recovered: false });
  });
});

describe('healthyForMissing (never mass-close)', () => {
  const base = { volume_min: 100, volume_max: 120, freshness_hours: 10, field_presence: {} };
  const ok = { status: 'ok' as const, completeListing: true, listed: 100, baseline: base, canariesMissing: false };

  it('needs an ok status, a complete full listing and present canaries', () => {
    expect(healthyForMissing(ok).healthy).toBe(true);
    expect(healthyForMissing({ ...ok, status: 'partial' })).toMatchObject({ healthy: false, reason: 'source run partial' });
    expect(healthyForMissing({ ...ok, completeListing: false }).healthy).toBe(false);
    expect(healthyForMissing({ ...ok, canariesMissing: true }).healthy).toBe(false);
  });

  it('needs at least 50% of the baseline minimum', () => {
    expect(healthyForMissing({ ...ok, listed: 50 }).healthy).toBe(true);
    const low = healthyForMissing({ ...ok, listed: 49 });
    expect(low.healthy).toBe(false);
    expect(low.reason).toContain('below 50');
  });

  it('before a baseline exists only an empty listing is unhealthy', () => {
    expect(healthyForMissing({ ...ok, baseline: null, listed: 3 })).toMatchObject({ healthy: true, reason: 'ok (no baseline yet)' });
    expect(healthyForMissing({ ...ok, baseline: null, listed: 0 }).healthy).toBe(false);
  });
});

describe('baselines', () => {
  it('quantile and median interpolate and ignore non-finite values', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([], 0.5)).toBeNaN();
    expect(median([5, Number.NaN, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });

  const sample = (volume: number, presence: Record<string, number> | null = { salary: 0.4 }, freshnessHours: number | null = 20): BaselineSample => ({ volume, presence, freshnessHours });

  it('is null until 3 healthy runs exist', () => {
    expect(computeBaseline([sample(10), sample(12)])).toBeNull();
    expect(computeBaseline([sample(10), sample(12), sample(11)])).not.toBeNull();
  });

  it('uses the interquartile band and medians of the last 14 runs only', () => {
    const recent = [100, 110, 90, 105, 95, 100, 102, 98, 101, 99, 97, 103, 104, 96].map((v) => sample(v, { salary: 0.5, location: 1 }, 12));
    const ancient = Array.from({ length: 20 }, () => sample(5000, { salary: 0 }, 999));
    const b = computeBaseline([...recent, ...ancient]);
    expect(recent.length).toBe(BASELINE_RUNS);
    expect(b).not.toBeNull();
    expect(b!.volume_min).toBeGreaterThanOrEqual(96);
    expect(b!.volume_max).toBeLessThanOrEqual(104);
    expect(b!.field_presence).toEqual({ location: 1, salary: 0.5 });
    expect(b!.freshness_hours).toBe(12);
  });

  it('one odd run does not move the band much; missing presence/freshness is tolerated', () => {
    const b = computeBaseline([sample(100, null, null), sample(100, null, null), sample(100, null, null), sample(3, null, null)]);
    expect(b).toMatchObject({ volume_max: 100, freshness_hours: null, field_presence: {} });
    expect(b!.volume_min).toBeGreaterThanOrEqual(75);
  });
});

describe('source checklist', () => {
  it('reads tolerant JSON', () => {
    expect(readChecklist(null)).toEqual(emptyChecklist());
    expect(readChecklist({ samples_saved: { done: true, at: 'x', note: 7 } }).samples_saved).toEqual({ done: true, at: 'x', note: null });
  });

  it('ticks items with evidence, never unticks and never overwrites a manual tick', () => {
    const current = { ...emptyChecklist(), terms_reviewed: { done: true, at: '2026-01-01T00:00:00.000Z', note: 'manual' } };
    const { checklist, ticked } = autoTickChecklist(current, { terms_reviewed: 'x', samples_saved: '12 raw snapshots', baseline_recorded: null }, now);
    expect(ticked).toEqual(['samples_saved']);
    expect(checklist.terms_reviewed.note).toBe('manual');
    expect(checklist.samples_saved).toEqual({ done: true, at: now.toISOString(), note: 'auto: 12 raw snapshots' });
    expect(checklist.baseline_recorded.done).toBe(false);
    expect(checklist.hand_checked_20.done).toBe(false);
  });
});
