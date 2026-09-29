/** Pure helpers for the login lockout countdown (unit-tested in tests/ui/lockout.test.ts). */

/** Milliseconds until `lockedUntil` (ISO string), floored at 0; null when the timestamp is unusable. */
export function lockRemainingMs(lockedUntil: string | null | undefined, nowMs: number): number | null {
  if (!lockedUntil) return null;
  const until = Date.parse(lockedUntil);
  if (!Number.isFinite(until) || !Number.isFinite(nowMs)) return null;
  return Math.max(0, until - nowMs);
}

/** "0:09", "14:58", "1:02:03" — rounded up so the display never reads 0:00 while still locked. */
export function formatCountdown(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0:00";
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}
