/**
 * Registers published as spreadsheets:
 *  - IE: DETE "Employment permits issued to companies <year>" (XLSX, year to date, monthly). The
 *    current and the previous year are imported. Columns: Employer Name, Permits Issued <Month>…,
 *    Permits Issued Grand Total; a "Total" row closes the sheet.
 *  - CA: ESDC "Employers who were issued a positive LMIA" (open.canada.ca CKAN dataset, one XLSX
 *    per quarter). The latest four English quarters are imported. Columns: Province/Territory,
 *    Program Stream, Employer, Address, Occupation, Incorporate Status, Approved LMIAs, Approved
 *    Positions; a title row precedes the header and numbered notes follow the data.
 */
import { parse as parseCsvSync } from 'csv-parse/sync';
import { REGISTERS } from './catalog';
import { clean, download, FILE_MAX_BYTES, isoDay, PAGE_MAX_BYTES } from './text';
import { RegisterError, type RegisterEntryInput, type RegisterFile, type RegisterSnapshot, type RegisterSourceContext } from './types';
import { openXlsx, type CellValue } from './xlsx';

// ---------------------------------------------------------------- Ireland

export const ieStatisticsPage = (year: number): string => `https://enterprise.gov.ie/en/publications/employment-permit-statistics-${year}.html`;

/** Absolute URL of the "issued to companies" XLSX linked from a statistics page, or null. */
export function findIeCompaniesXlsx(html: string, pageUrl: string): string | null {
  const re = /href="([^"]*issued-to-companies[^"]*\.xlsx[^"]*)"/gi;
  const m = re.exec(html);
  if (!m) return null;
  try {
    return new URL(m[1].replace(/&amp;/g, '&'), pageUrl).href;
  } catch {
    return null;
  }
}

const MONTH_RE = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/i;

function cellString(v: CellValue | undefined): string {
  return v === null || v === undefined ? '' : String(v).replace(/[ \s]+/g, ' ').trim();
}

function cellNumber(v: CellValue | undefined): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = cellString(v).replace(/,/g, '');
  return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** Entries of one DETE company-listing sheet. */
export function* parseIeRows(rows: Iterable<CellValue[]>, year: number): Generator<RegisterEntryInput> {
  let nameCol = -1;
  let totalCol = -1;
  let months: string[] = [];
  let sawHeader = false;
  for (const row of rows) {
    if (!sawHeader) {
      const cells = row.map(cellString);
      const n = cells.findIndex((c) => /^(employer|company)( name)?$/i.test(c));
      const t = cells.findIndex((c) => /total$/i.test(c));
      const monthCols = cells.filter((c) => MONTH_RE.test(c) && !/total/i.test(c));
      // 2026+: "Employer Name | Permits Issued Jan … | Permits Issued Grand Total".
      // 2025 and older: "(blank) | January … December | Grand Total".
      if (t >= 0 && (n >= 0 || (monthCols.length > 0 && cells[0] === ''))) {
        sawHeader = true;
        nameCol = n >= 0 ? n : 0;
        totalCol = t;
        months = monthCols.map((c) => MONTH_RE.exec(c)![1]).map((m) => m[0].toUpperCase() + m.slice(1, 3).toLowerCase());
      }
      continue;
    }
    const orgName = clean(row[nameCol], 512);
    if (!orgName || /^(grand )?total$/i.test(orgName)) continue;
    const total = cellNumber(row[totalCol]);
    const span = months.length ? ` (${months[0]}–${months[months.length - 1]})` : '';
    yield {
      orgName,
      town: null,
      route: `Employment permits ${year}${span}`,
      rating: total === null ? null : `${total} permit${total === 1 ? '' : 's'}`,
      raw: { year, employer: orgName, total },
    };
  }
  if (!sawHeader) throw new RegisterError(`DETE ${year} company listing: header row (Employer Name … Total) not found`, 'format');
}

interface IeYear {
  year: number;
  file: RegisterFile;
  modifiedDay: string | null;
  rows: () => Generator<CellValue[]>;
}

async function loadIeYear(ctx: RegisterSourceContext, year: number): Promise<IeYear> {
  const hosts = REGISTERS.ie_dete.allowedHosts;
  const pageUrl = ieStatisticsPage(year);
  const page = await download(ctx.fetch, pageUrl, hosts, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 30_000, accept: 'text/html' });
  const xlsxUrl = findIeCompaniesXlsx(page.text(), pageUrl);
  if (!xlsxUrl) throw new RegisterError(`DETE ${year}: no "issued to companies" spreadsheet linked on ${pageUrl}`, 'format', pageUrl, 404);
  const file = await download(ctx.fetch, xlsxUrl, hosts, { maxBytes: FILE_MAX_BYTES, timeoutMs: 120_000, label: `${year}` });
  const wb = openXlsx(file.body);
  return { year, file: file.file, modifiedDay: wb.modifiedDay, rows: wb.rows };
}

const notPublishedYet = (err: unknown): boolean => err instanceof RegisterError && err.status === 404;

export async function loadIe(ctx: RegisterSourceContext): Promise<RegisterSnapshot> {
  const y = ctx.now.getUTCFullYear();
  let current: IeYear | null = null;
  try {
    current = await loadIeYear(ctx, y);
  } catch (err) {
    // Early in January the new year's listing is not published yet: use the two previous years.
    if (!notPublishedYet(err)) throw err;
  }
  const years = current ? [current, await loadIeYear(ctx, y - 1)] : [await loadIeYear(ctx, y - 1), await loadIeYear(ctx, y - 2)];
  function* entries(): Generator<RegisterEntryInput> {
    for (const yr of years) yield* parseIeRows(yr.rows(), yr.year);
  }
  return { publishedAt: years[0].modifiedDay, files: years.map((x) => x.file), entries: entries() };
}

// ---------------------------------------------------------------- Canada

export const CA_DATASET_ID = '90fed587-1364-4f33-a9ee-208181dc0b97';
export const CA_PACKAGE_API = `https://open.canada.ca/data/api/action/package_show?id=${CA_DATASET_ID}`;
export const CA_QUARTERS = 4;

export interface CaResource {
  quarter: string;
  url: string;
  format: 'xlsx' | 'csv';
  modifiedDay: string | null;
}

/** Latest `n` English quarterly resources (XLSX preferred over CSV for the same quarter). */
export function pickCaResources(pkg: unknown, n = CA_QUARTERS): CaResource[] {
  const result = (pkg as { result?: { resources?: unknown } } | null)?.result;
  const list = Array.isArray(result?.resources) ? (result.resources as Record<string, unknown>[]) : [];
  const byQuarter = new Map<string, CaResource>();
  for (const r of list) {
    const url = typeof r.url === 'string' ? r.url : '';
    const langs = Array.isArray(r.language) ? r.language.map(String) : typeof r.language === 'string' ? [r.language] : [];
    const english = langs.includes('en') || /_en\.(xlsx|csv)$/i.test(url);
    if (!english || langs.includes('fr')) continue;
    const name = typeof r.name === 'string' ? r.name : '';
    const q = /^(\d{4})\s*Q([1-4])/i.exec(name) ?? /(\d{4})q([1-4])/i.exec(url);
    if (!q) continue;
    const ext = /\.(xlsx|csv)(?:$|\?)/i.exec(url)?.[1]?.toLowerCase() as 'xlsx' | 'csv' | undefined;
    if (!ext) continue;
    const quarter = `${q[1]}Q${q[2]}`;
    const modifiedDay = isoDay(r.last_modified) ?? isoDay(r.created);
    const prev = byQuarter.get(quarter);
    if (!prev || (prev.format === 'csv' && ext === 'xlsx')) byQuarter.set(quarter, { quarter, url, format: ext, modifiedDay });
  }
  return [...byQuarter.values()].sort((a, b) => (a.quarter < b.quarter ? 1 : -1)).slice(0, n);
}

/** 'St. John’s, NL A1B 1W3' → 'St. John’s'. */
export function caTown(address: string | null): string | null {
  if (!address) return null;
  return clean(address.split(',')[0], 128);
}

/** 'High Wage' → 'High Wage stream'; 'Global Talent Stream' stays; none → 'LMIA'. */
export function caStreamLabel(stream: string | null): string {
  if (!stream) return 'LMIA';
  return /\bstream$/i.test(stream) ? stream : `${stream} stream`;
}

/** Entries of one quarterly LMIA sheet (XLSX rows or CSV records). */
export function* parseCaRows(rows: Iterable<CellValue[]>, quarter: string): Generator<RegisterEntryInput> {
  let col: Record<'province' | 'stream' | 'employer' | 'address' | 'occupation' | 'status' | 'lmias' | 'positions', number> | null = null;
  const label = `${quarter.slice(0, 4)} Q${quarter.slice(5)}`;
  for (const row of rows) {
    if (!col) {
      const cells = row.map(cellString);
      const find = (re: RegExp) => cells.findIndex((c) => re.test(c));
      const employer = find(/^employer( name)?$/i);
      const address = find(/address|location/i);
      if (employer >= 0 && address >= 0) {
        col = {
          province: find(/province|territory/i),
          stream: find(/stream/i),
          employer,
          address,
          occupation: find(/occupation|noc/i),
          status: find(/incorporat/i),
          lmias: find(/approved lmias?/i),
          positions: find(/approved positions?/i),
        };
      }
      continue;
    }
    const at = (i: number) => (i >= 0 ? row[i] : null);
    const orgName = clean(at(col.employer), 512);
    if (!orgName) continue;
    const stream = clean(at(col.stream), 96);
    const address = clean(at(col.address), 255);
    const positions = cellNumber(at(col.positions));
    yield {
      orgName,
      town: caTown(address),
      route: `${caStreamLabel(stream)}, ${label}`,
      rating: positions === null ? null : `${positions} position${positions === 1 ? '' : 's'}`,
      raw: {
        quarter,
        province: clean(at(col.province), 128),
        stream,
        employer: orgName,
        address,
        occupation: clean(at(col.occupation), 255),
        status: clean(at(col.status), 64),
        lmias: cellNumber(at(col.lmias)),
        positions,
      },
    };
  }
  if (!col) throw new RegisterError(`LMIA ${quarter}: header row (Employer … Address) not found`, 'format');
}

function decodeCsv(buf: Buffer): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    // Older ESDC CSVs are Windows-1252 / Latin-1.
    return buf.toString('latin1');
  }
}

export async function loadCa(ctx: RegisterSourceContext): Promise<RegisterSnapshot> {
  const hosts = REGISTERS.ca_lmia.allowedHosts;
  const api = await download(ctx.fetch, CA_PACKAGE_API, hosts, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 30_000, accept: 'application/json' });
  let pkg: unknown;
  try {
    pkg = JSON.parse(api.text());
  } catch {
    throw new RegisterError('open.canada.ca package API returned invalid JSON', 'format', CA_PACKAGE_API);
  }
  const resources = pickCaResources(pkg);
  if (!resources.length) throw new RegisterError('open.canada.ca: no quarterly English LMIA files in the dataset', 'format', CA_PACKAGE_API);
  const sheets: { quarter: string; rows: () => Iterable<CellValue[]> }[] = [];
  const files: RegisterFile[] = [];
  for (const r of resources) {
    const file = await download(ctx.fetch, r.url, hosts, { maxBytes: FILE_MAX_BYTES, timeoutMs: 120_000, label: r.quarter });
    files.push(file.file);
    if (r.format === 'xlsx') {
      const wb = openXlsx(file.body);
      sheets.push({ quarter: r.quarter, rows: wb.rows });
    } else {
      const records = parseCsvSync(decodeCsv(file.body), { bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true }) as string[][];
      sheets.push({ quarter: r.quarter, rows: () => records });
    }
  }
  function* entries(): Generator<RegisterEntryInput> {
    for (const s of sheets) yield* parseCaRows(s.rows(), s.quarter);
  }
  const publishedAt = resources.map((r) => r.modifiedDay).filter((d): d is string => d !== null).sort().pop() ?? null;
  return { publishedAt, files, entries: entries() };
}
