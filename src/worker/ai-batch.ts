/**
 * How many AI calls a scheduled batch may make. The two batches (01:30 and 13:30 UTC) share the
 * day's budget left after the manual reserve: the morning batch takes half, the afternoon batch
 * the rest (the budget is per UTC day, so anything left at midnight would be lost). An explicit
 * `maxCalls` (CLI `--max-calls=N`) is still capped by what is available.
 */
export const AFTERNOON_BATCH_FROM_UTC_HOUR = 12;

export function aiBatchCalls(available: number, now: Date, maxCalls?: number): number {
  const avail = Math.max(0, Math.floor(available));
  const share = now.getUTCHours() >= AFTERNOON_BATCH_FROM_UTC_HOUR ? avail : Math.ceil(avail / 2);
  const wanted = maxCalls === undefined ? share : Math.max(0, Math.floor(maxCalls));
  return Math.min(avail, wanted);
}
