/**
 * Follow-up reminders in one time zone (spec §20: APP_TZ, default Asia/Kolkata). The DB stores UTC
 * instants; the form speaks local days and wall-clock times. Pure and client-safe: pass the zone.
 */
import { TZDate } from '@date-fns/tz';

export const DEFAULT_FOLLOW_UP_TIME = '10:00';
/** Default gap before chasing an application that went quiet. */
export const DEFAULT_FOLLOW_UP_DAYS = 7;
/** "Soon" on the reminder strip: due within this many local days. */
export const SOON_DAYS = 3;
/** A follow-up further out than this is almost certainly a typo. */
export const MAX_FOLLOW_UP_DAYS = 366;

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function dayParts(day: string): [number, number, number] | null {
  const m = DAY_RE.exec(day);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  const check = new Date(Date.UTC(y, mo, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo || check.getUTCDate() !== d) return null;
  return [y, mo, d];
}

export function isLocalDay(v: unknown): v is string {
  return typeof v === 'string' && dayParts(v) !== null;
}

export function isLocalTime(v: unknown): v is string {
  return typeof v === 'string' && TIME_RE.test(v);
}

/** UTC instant of `day` at `time` (HH:mm) on the wall clock of `tz`. Null for malformed input. */
export function localToUtc(day: string, time: string, tz: string): Date | null {
  const parts = dayParts(day);
  const t = TIME_RE.exec(time);
  if (!parts || !t) return null;
  const local = new TZDate(parts[0], parts[1], parts[2], Number(t[1]), Number(t[2]), 0, 0, tz);
  const d = new Date(local.getTime());
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 'YYYY-MM-DD' of `d` in `tz`. */
export function localDayOf(d: Date, tz: string): string {
  const l = new TZDate(d.getTime(), tz);
  return `${l.getFullYear()}-${String(l.getMonth() + 1).padStart(2, '0')}-${String(l.getDate()).padStart(2, '0')}`;
}

/** 'HH:mm' of `d` in `tz`. */
export function localTimeOf(d: Date, tz: string): string {
  const l = new TZDate(d.getTime(), tz);
  return `${String(l.getHours()).padStart(2, '0')}:${String(l.getMinutes()).padStart(2, '0')}`;
}

/** The local day `n` calendar days after the local day of `from`. */
export function addLocalDays(from: Date, n: number, tz: string): string {
  const l = new TZDate(from.getTime(), tz);
  const moved = new TZDate(l.getFullYear(), l.getMonth(), l.getDate() + n, 12, 0, 0, 0, tz);
  return localDayOf(new Date(moved.getTime()), tz);
}

/** Whole local calendar days from `now`'s day to `d`'s day (negative = in the past). */
export function localDayDiff(d: Date, now: Date, tz: string): number {
  const a = dayParts(localDayOf(now, tz)) as [number, number, number];
  const b = dayParts(localDayOf(d, tz)) as [number, number, number];
  return Math.round((Date.UTC(b[0], b[1], b[2]) - Date.UTC(a[0], a[1], a[2])) / 86_400_000);
}

export type ReminderBucket = 'overdue' | 'today' | 'soon' | 'later';

/**
 * Where a due reminder sits: overdue (its moment has passed on an earlier local day, or earlier
 * today), today (later today), soon (within SOON_DAYS local days), later.
 */
export function reminderBucket(dueAt: Date, now: Date, tz: string): ReminderBucket {
  const diff = localDayDiff(dueAt, now, tz);
  if (diff < 0) return 'overdue';
  if (diff === 0) return dueAt.getTime() <= now.getTime() ? 'overdue' : 'today';
  return diff <= SOON_DAYS ? 'soon' : 'later';
}

export type FollowUpCheck = { ok: true; at: Date } | { ok: false; error: string };

/** Validates a follow-up picked in the form (local day + time) against `now`. */
export function parseFollowUp(day: string, time: string | null | undefined, now: Date, tz: string): FollowUpCheck {
  if (!isLocalDay(day)) return { ok: false, error: 'Pick a real date (YYYY-MM-DD).' };
  const t = time && time.trim() ? time.trim() : DEFAULT_FOLLOW_UP_TIME;
  if (!isLocalTime(t)) return { ok: false, error: 'Pick a time as HH:mm (24-hour).' };
  const at = localToUtc(day, t, tz);
  if (!at) return { ok: false, error: 'That date and time do not exist in the app time zone.' };
  const diff = localDayDiff(at, now, tz);
  if (diff < 0) return { ok: false, error: 'That day is already over — pick today or later.' };
  if (diff > MAX_FOLLOW_UP_DAYS) return { ok: false, error: `Pick a day within a year (≤ ${MAX_FOLLOW_UP_DAYS} days).` };
  return { ok: true, at };
}
