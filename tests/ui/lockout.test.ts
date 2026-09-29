/** Login lockout countdown helpers. */
import { describe, expect, it } from 'vitest';
import { formatCountdown, lockRemainingMs } from '@/app/(auth)/login/lockout';

const NOW = Date.parse('2026-09-29T08:32:00Z');

describe('lockRemainingMs', () => {
  it('returns the time left until the lock lifts', () => {
    expect(lockRemainingMs('2026-09-29T08:47:00Z', NOW)).toBe(15 * 60_000);
    expect(lockRemainingMs('2026-09-29T08:32:00.500Z', NOW)).toBe(500);
  });
  it('floors expired locks at zero', () => {
    expect(lockRemainingMs('2026-09-29T08:00:00Z', NOW)).toBe(0);
  });
  it('is null for missing or unusable timestamps', () => {
    expect(lockRemainingMs(undefined, NOW)).toBeNull();
    expect(lockRemainingMs(null, NOW)).toBeNull();
    expect(lockRemainingMs('', NOW)).toBeNull();
    expect(lockRemainingMs('soon', NOW)).toBeNull();
    expect(lockRemainingMs('2026-09-29T08:47:00Z', Number.NaN)).toBeNull();
  });
});

describe('formatCountdown', () => {
  it('prints m:ss under an hour', () => {
    expect(formatCountdown(9_000)).toBe('0:09');
    expect(formatCountdown(898_000)).toBe('14:58');
    expect(formatCountdown(15 * 60_000)).toBe('15:00');
  });
  it('prints h:mm:ss from an hour', () => {
    expect(formatCountdown(3_723_000)).toBe('1:02:03');
    expect(formatCountdown(24 * 3_600_000)).toBe('24:00:00');
  });
  it('rounds up so a live lock never reads 0:00', () => {
    expect(formatCountdown(1)).toBe('0:01');
    expect(formatCountdown(59_001)).toBe('1:00');
  });
  it('reads 0:00 once expired or invalid', () => {
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(Number.NaN)).toBe('0:00');
  });
});
