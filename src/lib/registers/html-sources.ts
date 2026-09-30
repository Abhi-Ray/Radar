/**
 * Registers published as one HTML table:
 *  - NL: IND public register of recognised sponsors, residence purpose "work and highly skilled
 *    migrant" (Organisation, KVK number), updated monthly, "The overview was last updated on …".
 *  - DK: SIRI list of companies certified for the Fast-track scheme (Name of company, CVR no.),
 *    "Last updated DD-MM-YYYY".
 */
import { hashJson } from '../hash';
import { REGISTERS } from './catalog';
import { clean, download, htmlTables, PAGE_MAX_BYTES, parseDayFirstDate, parseEnglishDate } from './text';
import { RegisterError, type RegisterEntryInput, type RegisterFile, type RegisterSnapshot, type RegisterSourceContext } from './types';

export const NL_IND_URL = 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work';
export const DK_SIRI_URL = 'https://www.nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies';

interface TableSpec {
  label: string;
  /** Header text of the name column / id column (lower case, prefix match). */
  nameHeader: RegExp;
  idHeader: RegExp;
  idKey: 'kvk' | 'cvr';
  route: string;
}

/** Picks the table whose header matches, then maps each data row. Header-like rows are skipped. */
function parseTable(html: string, spec: TableSpec): RegisterEntryInput[] {
  const tables = htmlTables(html);
  for (const rows of tables) {
    const headerAt = rows.findIndex((r) => r.length >= 2 && spec.nameHeader.test(r[0]) && spec.idHeader.test(r[1]));
    if (headerAt < 0) continue;
    const out: RegisterEntryInput[] = [];
    for (const r of rows.slice(headerAt + 1)) {
      if (spec.nameHeader.test(r[0] ?? '') && spec.idHeader.test(r[1] ?? '')) continue;
      // IND escapes quotes inside names as doubled quotes ("" → ").
      const orgName = clean((r[0] ?? '').replace(/""/g, '"'), 512);
      if (!orgName) continue;
      const id = clean((r[1] ?? '').replace(/\s+/g, ''), 32);
      out.push({ orgName, town: null, route: spec.route, rating: null, raw: { organisation: orgName, [spec.idKey]: id } });
    }
    return out;
  }
  throw new RegisterError(`${spec.label}: the register table was not found on the page`, 'format');
}

export function parseIndHtml(html: string): { publishedAt: string | null; entries: RegisterEntryInput[] } {
  const entries = parseTable(html, {
    label: 'IND register',
    nameHeader: /^organi[sz]ation\b/i,
    idHeader: /^kvk\b/i,
    idKey: 'kvk',
    route: 'Work and highly skilled migrant',
  });
  const line = /last updated on([^<.]{0,40}\d{4})/i.exec(html);
  return { publishedAt: line ? parseEnglishDate(line[1]) : null, entries };
}

export function parseSiriHtml(html: string): { publishedAt: string | null; entries: RegisterEntryInput[] } {
  const entries = parseTable(html, {
    label: 'SIRI certified companies',
    nameHeader: /^name of (the )?company\b/i,
    idHeader: /^cvr\b/i,
    idKey: 'cvr',
    route: 'Fast-track scheme',
  });
  const line = /last updated\s*:?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4})/i.exec(html);
  return { publishedAt: line ? parseDayFirstDate(line[1]) : null, entries };
}

/**
 * The page itself changes on every request (tokens, menus), so an HTML register's fingerprint is
 * the hash of its extracted rows: an unchanged table is detected as unchanged.
 */
function tableFile(file: RegisterFile, entries: RegisterEntryInput[]): RegisterFile {
  return { ...file, sha256: hashJson(entries.map((e) => e.raw)), label: 'register table (hash of the extracted rows)' };
}

export async function loadNl({ fetch }: RegisterSourceContext): Promise<RegisterSnapshot> {
  const page = await download(fetch, NL_IND_URL, REGISTERS.nl_ind.allowedHosts, { maxBytes: 16 * 1024 * 1024, timeoutMs: 60_000, accept: 'text/html' });
  const { publishedAt, entries } = parseIndHtml(page.text());
  return { publishedAt, files: [tableFile(page.file, entries)], entries };
}

export async function loadDk({ fetch }: RegisterSourceContext): Promise<RegisterSnapshot> {
  const page = await download(fetch, DK_SIRI_URL, REGISTERS.dk_siri.allowedHosts, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 60_000, accept: 'text/html' });
  const { publishedAt, entries } = parseSiriHtml(page.text());
  return { publishedAt, files: [tableFile(page.file, entries)], entries };
}
