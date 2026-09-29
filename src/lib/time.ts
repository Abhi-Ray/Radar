/**
 * Time helpers. Storage rule: every DB timestamp is UTC (DATETIME(3) holding UTC; Drizzle maps
 * them to JS Date instants). Display and reminders use APP_TZ (default Asia/Kolkata).
 * All functions are pure given their arguments; `tz` defaults to APP_TZ.
 */
import { tz as tzContext, TZDate } from '@date-fns/tz';
import { format as dfFormat, formatDistanceStrict } from 'date-fns';
import { getEnvVar } from './env';

export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

/** APP_TZ from env (falls back to Asia/Kolkata when env is unavailable, e.g. in unit tests). */
export function appTz(): string {
  try {
    return getEnvVar('APP_TZ');
  } catch {
    return 'Asia/Kolkata';
  }
}

export function nowUtc(): Date {
  return new Date();
}

function pad(n: number, w = 2): string {
  return String(n).padStart(w, '0');
}

/** 'YYYY-MM-DD' of the UTC calendar day. Used as the AI budget key (ai_usage.day). */
export function utcDay(d: Date = new Date()): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

/** 'YYYY-MM-DD' of the calendar day in `tz`. */
export function localDay(d: Date = new Date(), tz: string = appTz()): string {
  return dfFormat(d, 'yyyy-MM-dd', { in: tzContext(tz) });
}

/** UTC instant of local midnight (00:00) of the day containing `now` in `tz`. */
export function startOfTodayInTz(tz: string = appTz(), now: Date = new Date()): Date {
  const local = new TZDate(now.getTime(), tz);
  const midnight = new TZDate(local.getFullYear(), local.getMonth(), local.getDate(), 0, 0, 0, 0, tz);
  return new Date(midnight.getTime());
}

/** UTC instant of local midnight of a 'YYYY-MM-DD' day in `tz`. */
export function startOfLocalDay(day: string, tz: string = appTz()): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`Invalid day "${day}", expected YYYY-MM-DD`);
  const d = new TZDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0, 0, tz);
  return new Date(d.getTime());
}

/** Exact 24h steps (instant arithmetic). Use addCalendarDaysInTz for "same local time N days later". */
export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

export function addHours(d: Date, hours: number): Date {
  return new Date(d.getTime() + hours * HOUR_MS);
}

export function addMinutes(d: Date, minutes: number): Date {
  return new Date(d.getTime() + minutes * MINUTE_MS);
}

/** Calendar-day arithmetic in `tz` (DST-safe): keeps the local wall-clock time. */
export function addCalendarDaysInTz(d: Date, days: number, tz: string = appTz()): Date {
  const local = new TZDate(d.getTime(), tz);
  const moved = new TZDate(
    local.getFullYear(),
    local.getMonth(),
    local.getDate() + days,
    local.getHours(),
    local.getMinutes(),
    local.getSeconds(),
    local.getMilliseconds(),
    tz,
  );
  return new Date(moved.getTime());
}

/** Whole days between two instants (floor of b - a in 24h units; negative if b < a). */
export function daysBetween(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}

/** Format an instant in `tz` using date-fns tokens. Default: "29 Sep 2026, 14:05". */
export function formatInTz(d: Date, pattern = 'dd MMM yyyy, HH:mm', tz: string = appTz()): string {
  return dfFormat(d, pattern, { in: tzContext(tz) });
}

/** Short "as of" label: "29 Sep, 14:05 IST". */
export function formatAsOf(d: Date, tz: string = appTz()): string {
  return `${formatInTz(d, 'dd MMM, HH:mm', tz)} ${tzAbbrev(d, tz)}`;
}

/** ISO date string (YYYY-MM-DD) in `tz` — for date-only display like "rule verified 2026-10-05". */
export function formatDay(d: Date, tz: string = appTz()): string {
  return localDay(d, tz);
}

/** "3 hours ago" / "in 2 days". */
export function formatAge(d: Date, now: Date = new Date()): string {
  return formatDistanceStrict(d, now, { addSuffix: true });
}

/** Time-zone abbreviation for display (e.g. IST, CET, GMT+5:30). */
export function tzAbbrev(d: Date, tz: string = appTz()): string {
  if (tz === 'Asia/Kolkata' || tz === 'Asia/Calcutta') return 'IST';
  try {
    const parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, timeZoneName: 'short' }).formatToParts(d);
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
  } catch {
    return tz;
  }
}

/** Parse a date-like input into a valid Date or null (never Invalid Date). */
export function toDateOrNull(input: unknown): Date | null {
  if (input === null || input === undefined || input === '') return null;
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input as string | number);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Parse 'YYYY-MM-DD' as UTC midnight (for DATE columns stored as strings). */
export function parseUtcDay(day: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) throw new RangeError(`Invalid day "${day}", expected YYYY-MM-DD`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

/** Milliseconds until the next UTC midnight (AI budget reset). */
export function msUntilNextUtcDay(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}
