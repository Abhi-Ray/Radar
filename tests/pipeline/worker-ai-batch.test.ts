/** Scheduled AI batches: morning half, afternoon the rest; the manual reserve is applied by the caller. */
import { describe, expect, it } from 'vitest';
import { aiBatchCalls } from '../../src/worker/ai-batch';

const at = (hhmm: string) => new Date(`2026-09-30T${hhmm}:00Z`);

describe('aiBatchCalls', () => {
  it('the 01:30 batch takes half of what is available, the 13:30 batch all of it', () => {
    expect(aiBatchCalls(40, at('01:30'))).toBe(20);
    expect(aiBatchCalls(41, at('01:30'))).toBe(21);
    // What the morning left over is spent in the afternoon (the budget resets at 00:00 UTC).
    expect(aiBatchCalls(20, at('13:30'))).toBe(20);
    expect(aiBatchCalls(1, at('01:30'))).toBe(1);
  });

  it('an explicit --max-calls is capped by what is available', () => {
    expect(aiBatchCalls(40, at('01:30'), 5)).toBe(5);
    expect(aiBatchCalls(3, at('13:30'), 50)).toBe(3);
    expect(aiBatchCalls(10, at('01:30'), 0)).toBe(0);
  });

  it('never goes below zero', () => {
    expect(aiBatchCalls(0, at('13:30'))).toBe(0);
    expect(aiBatchCalls(-4, at('01:30'))).toBe(0);
    expect(aiBatchCalls(-4, at('01:30'), 7)).toBe(0);
  });
});
