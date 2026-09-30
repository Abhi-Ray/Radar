/**
 * Time-zone words that show up in remote scopes ("Remote (CET ±2h)", "must overlap with EST").
 * Offsets are standard-time UTC offsets in hours; `macro` names the area the zone implies.
 * Ambiguous abbreviations (IST = India / Ireland / Israel, CST = US Central / China) are marked,
 * so callers can treat them as weak evidence.
 */

export interface TimezoneWord {
  key: string;
  /** UTC offset range in hours covered by the word (standard time; DST variants listed separately). */
  offsets: readonly [number, number];
  macro: string | null;
  aliases: readonly string[];
  ambiguous?: boolean;
}

export const TIMEZONES: readonly TimezoneWord[] = [
  { key: 'UTC', offsets: [0, 0], macro: null, aliases: ['UTC', 'Coordinated Universal Time', 'Zulu'] },
  { key: 'GMT', offsets: [0, 0], macro: 'EUROPE', aliases: ['GMT', 'Greenwich Mean Time', 'UK time'] },
  { key: 'BST', offsets: [1, 1], macro: 'EUROPE', aliases: ['BST', 'British Summer Time'] },
  { key: 'WET', offsets: [0, 0], macro: 'EUROPE', aliases: ['WET', 'Western European Time'] },
  { key: 'WEST', offsets: [1, 1], macro: 'EUROPE', aliases: ['WEST', 'Western European Summer Time'] },
  { key: 'CET', offsets: [1, 1], macro: 'EUROPE', aliases: ['CET', 'Central European Time', 'MEZ', 'Mitteleuropäische Zeit', "Heure d'Europe centrale", 'European time zone', 'European time zones', 'European timezone', 'European hours', 'European working hours'] },
  { key: 'CEST', offsets: [2, 2], macro: 'EUROPE', aliases: ['CEST', 'Central European Summer Time', 'MESZ', 'Mitteleuropäische Sommerzeit'] },
  { key: 'EET', offsets: [2, 2], macro: 'EUROPE', aliases: ['EET', 'Eastern European Time', 'OEZ'] },
  { key: 'EEST', offsets: [3, 3], macro: 'EUROPE', aliases: ['EEST', 'Eastern European Summer Time', 'OESZ'] },
  { key: 'MSK', offsets: [3, 3], macro: null, aliases: ['MSK', 'Moscow Time'] },
  { key: 'GST', offsets: [4, 4], macro: 'GCC', aliases: ['GST', 'Gulf Standard Time'] },
  { key: 'IST', offsets: [5.5, 5.5], macro: 'ASIA', aliases: ['IST', 'India Standard Time', 'Indian Standard Time'], ambiguous: true },
  { key: 'SGT', offsets: [8, 8], macro: 'APAC', aliases: ['SGT', 'Singapore Time', 'Singapore Standard Time'] },
  { key: 'HKT', offsets: [8, 8], macro: 'APAC', aliases: ['HKT', 'Hong Kong Time'] },
  { key: 'AWST', offsets: [8, 8], macro: 'ANZ', aliases: ['AWST', 'Australian Western Standard Time'] },
  { key: 'JST', offsets: [9, 9], macro: 'APAC', aliases: ['JST', 'Japan Standard Time'] },
  { key: 'KST', offsets: [9, 9], macro: 'APAC', aliases: ['KST', 'Korea Standard Time'] },
  { key: 'AEST', offsets: [10, 10], macro: 'ANZ', aliases: ['AEST', 'Australian Eastern Standard Time'] },
  { key: 'AEDT', offsets: [11, 11], macro: 'ANZ', aliases: ['AEDT', 'Australian Eastern Daylight Time'] },
  { key: 'NZST', offsets: [12, 12], macro: 'ANZ', aliases: ['NZST', 'NZT', 'New Zealand Standard Time', 'New Zealand Time'] },
  { key: 'ET', offsets: [-5, -5], macro: 'NORTH_AMERICA', aliases: ['ET', 'EST', 'EDT', 'Eastern Time', 'Eastern Standard Time', 'Eastern Daylight Time', 'US Eastern'] },
  { key: 'CT', offsets: [-6, -6], macro: 'NORTH_AMERICA', aliases: ['CT', 'CST', 'CDT', 'Central Time', 'Central Standard Time', 'US Central'], ambiguous: true },
  { key: 'MT', offsets: [-7, -7], macro: 'NORTH_AMERICA', aliases: ['MT', 'MST', 'MDT', 'Mountain Time', 'Mountain Standard Time'] },
  { key: 'PT', offsets: [-8, -8], macro: 'NORTH_AMERICA', aliases: ['PT', 'PST', 'PDT', 'Pacific Time', 'Pacific Standard Time', 'Pacific Daylight Time', 'US Pacific'] },
  { key: 'US_TIMEZONES', offsets: [-10, -5], macro: 'NORTH_AMERICA', aliases: ['US time zones', 'US timezones', 'US time zone', 'US hours', 'US business hours', 'North American time zones'] },
];

/** Abbreviations that are only time zones when written in capitals ("ET", "PT", "MT", "CT"). */
export const UPPERCASE_ONLY_TZ = new Set(['ET', 'CT', 'MT', 'PT', 'EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT', 'IST', 'GST', 'BST', 'WET', 'WEST', 'CET', 'CEST', 'EET', 'EEST', 'MEZ', 'MESZ', 'OEZ', 'OESZ', 'MSK', 'SGT', 'HKT', 'JST', 'KST', 'NZT', 'UTC', 'GMT', 'AWST', 'AEST', 'AEDT', 'NZST']);

/** Matches explicit offsets such as "UTC+1", "GMT -5", "UTC+05:30", "UTC±2". */
export const UTC_OFFSET_RE = /\b(?:UTC|GMT)\s?([+\-±])\s?(\d{1,2})(?::?(\d{2}))?\b/gi;
