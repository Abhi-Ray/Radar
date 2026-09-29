/** Display formatting: zoned dates (IST default), relative time, durations, numbers, money, text. */
import { describe, expect, it } from 'vitest';
import {
  APP_TZ,
  DASH,
  currencySymbol,
  daysUntil,
  formatCompact,
  formatDate,
  formatDateTime,
  formatDuration,
  formatEur,
  formatEurRange,
  formatIsoDate,
  formatMoney,
  formatMoneyRange,
  formatNumber,
  formatPercent,
  formatRelative,
  formatTime,
  isStale,
  plural,
  toDate,
  truncate,
  tzLabel,
} from '@/components/ui/format';

// 08:32 UTC = 14:02 IST on 29 Sep 2026.
const AT = new Date('2026-09-29T08:32:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const ago = (ms: number) => new Date(AT.getTime() - ms);

describe('toDate', () => {
  it('parses dates, ISO strings and epoch ms', () => {
    expect(toDate('2026-09-29T08:32:00Z')?.getTime()).toBe(AT.getTime());
    expect(toDate(AT.getTime())?.getTime()).toBe(AT.getTime());
  });
  it('returns a copy, not the same Date instance', () => {
    const d = toDate(AT);
    expect(d).not.toBe(AT);
    expect(d?.getTime()).toBe(AT.getTime());
  });
  it('maps empty and invalid input to null', () => {
    expect(toDate(null)).toBeNull();
    expect(toDate(undefined)).toBeNull();
    expect(toDate('')).toBeNull();
    expect(toDate('not a date')).toBeNull();
    expect(toDate(Number.NaN)).toBeNull();
  });
});

describe('zoned date/time formatting', () => {
  it('defaults to the app zone (Asia/Kolkata)', () => {
    expect(APP_TZ).toBe('Asia/Kolkata');
    expect(formatDate(AT)).toBe('29 Sep 2026');
    expect(formatTime(AT)).toBe('14:02');
    expect(formatDateTime(AT)).toBe('29 Sep 2026, 14:02 IST');
  });
  it('rolls the calendar day over in the zone, not in UTC', () => {
    const late = new Date('2026-09-29T20:00:00Z'); // 01:30 IST next day
    expect(formatDate(late)).toBe('30 Sep 2026');
    expect(formatDate(late, { tz: 'UTC' })).toBe('29 Sep 2026');
    expect(formatIsoDate(late)).toBe('2026-09-30');
    expect(formatIsoDate(late, 'UTC')).toBe('2026-09-29');
  });
  it('supports year-less, seconds and zone-less variants', () => {
    expect(formatDate(AT, { year: false })).toBe('29 Sep');
    expect(formatTime(new Date('2026-09-29T08:32:07Z'), { seconds: true })).toBe('14:02:07');
    expect(formatDateTime(AT, { zone: false })).toBe('29 Sep 2026, 14:02');
    expect(formatDateTime(AT, { tz: 'UTC' })).toBe('29 Sep 2026, 08:32 UTC');
  });
  it('uses 24h clock with zero padding and never prints hour 24', () => {
    expect(formatTime(new Date('2026-01-05T18:30:00Z'))).toBe('00:00');
    expect(formatTime(new Date('2026-01-05T03:35:00Z'))).toBe('09:05');
  });
  it('prints the fallback for missing values', () => {
    expect(formatDate(null)).toBe(DASH);
    expect(formatTime('garbage')).toBe(DASH);
    expect(formatDateTime(undefined, { fallback: 'never' })).toBe('never');
    expect(formatIsoDate(null)).toBe(DASH);
  });
});

describe('tzLabel', () => {
  it('abbreviates known zones', () => {
    expect(tzLabel()).toBe('IST');
    expect(tzLabel('Asia/Calcutta')).toBe('IST');
    expect(tzLabel('UTC')).toBe('UTC');
  });
  it('falls back to Intl for other zones and to the raw id when invalid', () => {
    expect(tzLabel('Europe/Berlin').length).toBeGreaterThan(0);
    expect(tzLabel('Not/A_Zone')).toBe('Not/A_Zone');
  });
});

describe('formatRelative', () => {
  it('uses terse past forms', () => {
    expect(formatRelative(ago(30_000), AT)).toBe('just now');
    expect(formatRelative(ago(5 * MIN), AT)).toBe('5m ago');
    expect(formatRelative(ago(50_000), AT)).toBe('1m ago');
    expect(formatRelative(ago(3 * HOUR), AT)).toBe('3h ago');
    expect(formatRelative(ago(2 * DAY), AT)).toBe('2d ago');
    expect(formatRelative(ago(20 * DAY), AT)).toBe('3w ago');
    expect(formatRelative(ago(60 * DAY), AT)).toBe('2mo ago');
    expect(formatRelative(ago(800 * DAY), AT)).toBe('2y ago');
  });
  it('never prints rounding overflows like 24h / 7d / 5w / 12mo', () => {
    expect(formatRelative(ago(23.9 * HOUR), AT)).toBe('1d ago');
    expect(formatRelative(ago(6.6 * DAY), AT)).toBe('1w ago');
    expect(formatRelative(ago(34 * DAY), AT)).toBe('1mo ago');
    expect(formatRelative(ago(360 * DAY), AT)).toBe('1y ago');
  });
  it('uses "in …" for future times', () => {
    expect(formatRelative(new Date(AT.getTime() + 5 * MIN), AT)).toBe('in 5m');
    expect(formatRelative(new Date(AT.getTime() + 3 * DAY), AT)).toBe('in 3d');
  });
  it('returns the fallback for missing input', () => {
    expect(formatRelative(null, AT)).toBe('never');
    expect(formatRelative(undefined, AT, 'not yet')).toBe('not yet');
  });
});

describe('daysUntil / isStale', () => {
  it('counts calendar days in the zone', () => {
    expect(daysUntil(new Date('2026-09-30T20:00:00Z'), AT)).toBe(2); // 1 Oct IST
    expect(daysUntil(new Date('2026-09-30T20:00:00Z'), AT, 'UTC')).toBe(1);
    expect(daysUntil(ago(3 * DAY), AT)).toBe(-3);
    expect(daysUntil(AT, AT)).toBe(0);
    expect(daysUntil(null, AT)).toBeNull();
  });
  it('treats missing timestamps as stale', () => {
    expect(isStale(null, 24, AT)).toBe(true);
    expect(isStale(ago(25 * HOUR), 24, AT)).toBe(true);
    expect(isStale(ago(23 * HOUR), 24, AT)).toBe(false);
    expect(isStale(ago(24 * HOUR), 24, AT)).toBe(false);
  });
});

describe('formatDuration', () => {
  it('scales units', () => {
    expect(formatDuration(850)).toBe('850ms');
    expect(formatDuration(4200)).toBe('4.2s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(184_000)).toBe('3m 04s');
    expect(formatDuration(7_800_000)).toBe('2h 10m');
  });
  it('dashes invalid durations', () => {
    expect(formatDuration(null)).toBe(DASH);
    expect(formatDuration(-1)).toBe(DASH);
    expect(formatDuration(Number.NaN)).toBe(DASH);
  });
});

describe('numbers', () => {
  it('formats with en-GB grouping', () => {
    expect(formatNumber(1204)).toBe('1,204');
    expect(formatNumber(3.14159, { decimals: 2 })).toBe('3.14');
    expect(formatNumber(null)).toBe(DASH);
    expect(formatNumber(Number.POSITIVE_INFINITY, { fallback: '?' })).toBe('?');
  });
  it('compacts', () => {
    expect(formatCompact(950)).toBe('950');
    expect(formatCompact(1000)).toBe('1k');
    expect(formatCompact(9500)).toBe('9.5k');
    expect(formatCompact(48_000)).toBe('48k');
    expect(formatCompact(1_200_000)).toBe('1.2M');
    expect(formatCompact(1_250_000)).toBe('1.25M');
    expect(formatCompact(12_500_000)).toBe('12.5M');
    expect(formatCompact(-9500)).toBe('-9.5k');
    expect(formatCompact(undefined)).toBe(DASH);
  });
  it('formats ratios as percentages', () => {
    expect(formatPercent(0.923)).toBe('92%');
    expect(formatPercent(0.923, 1)).toBe('92.3%');
    expect(formatPercent(null)).toBe(DASH);
  });
});

describe('money', () => {
  it('resolves currency symbols and tolerates bad codes', () => {
    expect(currencySymbol('EUR')).toBe('€');
    expect(currencySymbol('gbp')).toBe('£');
    expect(currencySymbol('CHF')).toBe('CHF');
    expect(currencySymbol('XX')).toBe('XX');
  });
  it('formats amounts', () => {
    expect(formatMoney(48_000)).toBe('€48,000');
    expect(formatMoney(48_000, 'EUR', { compact: true })).toBe('€48k');
    expect(formatMoney(52_500, 'GBP')).toBe('£52,500');
    expect(formatMoney(110_000, 'CHF', { compact: true })).toBe('CHF 110k');
    expect(formatMoney(-500)).toBe('-€500');
    expect(formatMoney(48_000, 'euro')).toBe('48,000 euro');
    expect(formatMoney(null)).toBe(DASH);
    expect(formatEur(60_000)).toBe('€60,000');
  });
  it('formats ranges, open ranges and single values', () => {
    expect(formatMoneyRange(48_000, 60_000)).toBe('€48k–€60k');
    expect(formatMoneyRange(60_000, 48_000)).toBe('€48k–€60k');
    expect(formatMoneyRange(55_000, 55_000)).toBe('€55k');
    expect(formatMoneyRange(48_000, null)).toBe('€48k+');
    expect(formatMoneyRange(null, 60_000)).toBe('up to €60k');
    expect(formatMoneyRange(null, undefined)).toBe(DASH);
    expect(formatEurRange(72_000, 88_000)).toBe('€72k–€88k');
    expect(formatMoneyRange(48_000, 60_000, 'EUR', { compact: false })).toBe('€48,000–€60,000');
  });
});

describe('text', () => {
  it('pluralises with grouping', () => {
    expect(plural(1, 'job')).toBe('1 job');
    expect(plural(0, 'job')).toBe('0 jobs');
    expect(plural(1204, 'job')).toBe('1,204 jobs');
    expect(plural(2, 'company', 'companies')).toBe('2 companies');
  });
  it('truncates at a word boundary when one is close', () => {
    expect(truncate('short', 10)).toBe('short');
    expect(truncate('alpha beta gamma delta', 18)).toBe('alpha beta gamma…');
  });
  it('hard-cuts when no boundary is near and never exceeds max', () => {
    const out = truncate('Senior Cloud Security Engineer', 20);
    expect(out.endsWith('…')).toBe(true);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(truncate('abcdefghijklmnop', 6)).toBe('abcde…');
  });
});
