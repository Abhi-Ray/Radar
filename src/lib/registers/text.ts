/**
 * Small, dependency-free helpers for the register pages: HTML/XML entity decoding, table
 * extraction from official HTML pages, date parsing of "last updated" lines, and fetching with
 * host checks.
 */
import { sha256Hex } from '../hash';
import { RegisterError, type RegisterFetch, type RegisterFile } from './types';

const NAMED: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', hellip: '…', euro: '€', trade: '™', bull: '•', middot: '·', laquo: '«',
  raquo: '»', copy: '©', reg: '®', deg: '°', shy: '­', times: '×', iexcl: '¡', iquest: '¿', sect: '§', para: '¶',
  Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ', Ccedil: 'Ç', Egrave: 'È',
  Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï', ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò',
  Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', Oslash: 'Ø', Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü',
  Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á', acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å',
  aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê', euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î',
  iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó', ocirc: 'ô', otilde: 'õ', ouml: 'ö', oslash: 'ø',
  ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü', yacute: 'ý', thorn: 'þ', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ',
  Scaron: 'Š', scaron: 'š', Zcaron: 'Ž', zcaron: 'ž', Yuml: 'Ÿ',
};

function codePoint(n: number): string {
  return Number.isInteger(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : '�';
}

/** Decodes HTML/XML character references (named Latin-1 set, decimal, hex). Unknown names stay. */
export function decodeEntities(s: string): string {
  if (!s.includes('&')) return s;
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (m, ref: string) => {
    if (ref[0] === '#') return codePoint(ref[1] === 'x' || ref[1] === 'X' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10));
    return NAMED[ref] ?? m;
  });
}

/** Cell / fragment HTML → one line of text (tags dropped, entities decoded, spaces collapsed). */
export function cellText(html: string): string {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, ' '))
    .replace(/[ \s]+/g, ' ')
    .replace(/[​-‍⁠﻿]/g, '')
    .trim();
}

/**
 * Every `<table>` of a page as rows of cell texts (th and td alike). Enough for the plain
 * official tables used here; nested tables are not expected and not supported.
 */
export function htmlTables(html: string): string[][][] {
  const tables: string[][][] = [];
  const tableRe = /<table\b[^>]*>([\s\S]*?)<\/table>/gi;
  for (let t = tableRe.exec(html); t; t = tableRe.exec(html)) {
    const rows: string[][] = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    for (let r = rowRe.exec(t[1]); r; r = rowRe.exec(t[1])) {
      const cells: string[] = [];
      const cellRe = /<t([hd])\b[^>]*>([\s\S]*?)<\/t\1>/gi;
      for (let c = cellRe.exec(r[1]); c; c = cellRe.exec(r[1])) cells.push(cellText(c[2]));
      if (cells.length) rows.push(cells);
    }
    tables.push(rows);
  }
  return tables;
}

const MONTHS: Readonly<Record<string, number>> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7,
  aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};

function isoDate(y: number, m: number, d: number): string | null {
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return date.toISOString().slice(0, 10);
}

/** "3 September 2026", "2nd September 2026", "September 3, 2026" → '2026-09-03'. */
export function parseEnglishDate(s: string): string | null {
  const a = /\b(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})\b/i.exec(s);
  if (a) {
    const m = MONTHS[a[2].toLowerCase()];
    if (m) return isoDate(Number(a[3]), m, Number(a[1]));
  }
  const b = /\b([a-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i.exec(s);
  if (b) {
    const m = MONTHS[b[1].toLowerCase()];
    if (m) return isoDate(Number(b[3]), m, Number(b[2]));
  }
  return null;
}

/** "29-09-2026" / "29.09.2026" / "29/09/2026" (day first) → '2026-09-29'. */
export function parseDayFirstDate(s: string): string | null {
  const m = /\b(\d{1,2})[./-](\d{1,2})[./-](\d{4})\b/.exec(s);
  return m ? isoDate(Number(m[3]), Number(m[2]), Number(m[1])) : null;
}

/** 'YYYY-MM-DD' at the start of an ISO timestamp, or null. */
export function isoDay(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

export const PAGE_MAX_BYTES = 8 * 1024 * 1024;
export const FILE_MAX_BYTES = 50 * 1024 * 1024;

/** Throws unless `url` is https on one of `hosts`. */
export function assertHost(url: string, hosts: readonly string[]): URL {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new RegisterError(`invalid register URL: ${url}`, 'host', url);
  }
  if (u.protocol !== 'https:' || !hosts.includes(u.hostname.toLowerCase())) {
    throw new RegisterError(`register URL is not on an official host (${hosts.join(', ')}): ${u.href}`, 'host', u.href);
  }
  return u;
}

/**
 * GET `url` (on an allowed host; redirects must also end on one) and return the body with its
 * file record. Non-2xx → RegisterError('http').
 */
export async function download(
  fetch: RegisterFetch,
  url: string,
  hosts: readonly string[],
  opts: { maxBytes: number; timeoutMs: number; accept?: string; label?: string },
): Promise<{ body: Buffer; text: () => string; file: RegisterFile }> {
  assertHost(url, hosts);
  const res = await fetch(url, { timeoutMs: opts.timeoutMs, maxBytes: opts.maxBytes, headers: opts.accept ? { accept: opts.accept } : undefined });
  if (!res.ok) throw new RegisterError(`HTTP ${res.status} for ${url}`, 'http', url, res.status);
  assertHost(res.finalUrl || url, hosts);
  const body = res.body;
  return {
    body,
    text: () => res.text(),
    file: { url, bytes: body.length, sha256: sha256Hex(body), ...(opts.label ? { label: opts.label } : {}) },
  };
}

/** Trimmed string or null (also for "", "-", "n/a"). */
export function clean(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[ \s]+/g, ' ').trim();
  if (!s || s === '-' || /^n\/?a$/i.test(s)) return null;
  return s.length > max ? s.slice(0, max) : s;
}
