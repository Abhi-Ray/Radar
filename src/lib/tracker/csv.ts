/**
 * RFC 4180 CSV for the tracker export. Pure.
 *
 * - Fields with a comma, quote, CR or LF are quoted; quotes are doubled. Lines end in CRLF.
 * - Spreadsheet formula injection: a text cell starting with = + - @ TAB or CR is prefixed with an
 *   apostrophe so Excel / Sheets show it as text instead of running it (OWASP "CSV injection").
 *   Numbers are written as numbers and never prefixed.
 * - A UTF-8 BOM is prepended by `toCsv` so Excel reads accents correctly.
 */

export type CsvValue = string | number | boolean | Date | null | undefined;

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => CsvValue;
}

const NEEDS_QUOTES = /[",\r\n]/;
const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  let s: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return '';
    return String(value);
  }
  if (typeof value === 'boolean') s = value ? 'true' : 'false';
  else if (value instanceof Date) s = Number.isNaN(value.getTime()) ? '' : value.toISOString();
  else s = value;
  if (FORMULA_START.test(s)) s = `'${s}`;
  return NEEDS_QUOTES.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: readonly CsvValue[]): string {
  return values.map(csvCell).join(',');
}

export const CSV_BOM = '﻿';

export function toCsv<T>(rows: readonly T[], columns: readonly CsvColumn<T>[], opts: { bom?: boolean } = {}): string {
  const lines = [csvLine(columns.map((c) => c.header)), ...rows.map((r) => csvLine(columns.map((c) => c.value(r))))];
  return `${opts.bom === false ? '' : CSV_BOM}${lines.join('\r\n')}\r\n`;
}
