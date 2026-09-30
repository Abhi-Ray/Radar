/**
 * Minimal, dependency-free readers for the official spreadsheets: a ZIP directory reader
 * (stored + deflate entries, no ZIP64/encryption) and an XLSX first-sheet row reader.
 *
 * Only what the registers need: cell values of the first worksheet as strings / numbers, shared
 * and inline strings, and the document's "modified" date. Formulas are read as their cached value.
 * Every size is bounded (zip-bomb safe): entries above MAX_ENTRY_BYTES are refused.
 */
import { inflateRawSync } from 'node:zlib';
import { decodeEntities } from './text';
import { RegisterError } from './types';

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;
/** Largest single decompressed entry accepted (the biggest real sheet is ~15 MB). */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

interface ZipEntry {
  name: string;
  method: number;
  flags: number;
  compressedSize: number;
  size: number;
  localOffset: number;
}

function formatError(msg: string): RegisterError {
  return new RegisterError(`spreadsheet: ${msg}`, 'format');
}

/** Reads the central directory of a ZIP archive. */
export function zipEntries(buf: Buffer): Map<string, ZipEntry> {
  if (buf.length < 22) throw formatError('file too small to be a ZIP archive');
  let eocd = -1;
  const stop = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= stop; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw formatError('not a ZIP archive (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff || cdSize === 0xffffffff) throw formatError('ZIP64 archives are not supported');
  if (cdOffset + cdSize > buf.length) throw formatError('truncated ZIP archive');
  const entries = new Map<string, ZipEntry>();
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) throw formatError('corrupt ZIP central directory');
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compressedSize = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', p + 46, p + 46 + nameLen);
    entries.set(name, { name, method, flags, compressedSize, size, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Decompressed bytes of one entry. */
export function zipRead(buf: Buffer, entry: ZipEntry): Buffer {
  if (entry.flags & 0x1) throw formatError(`encrypted entry ${entry.name}`);
  if (entry.size > MAX_ENTRY_BYTES) throw formatError(`entry ${entry.name} is too large (${entry.size} bytes)`);
  const p = entry.localOffset;
  if (p + 30 > buf.length || buf.readUInt32LE(p) !== LOC_SIG) throw formatError(`corrupt local header for ${entry.name}`);
  const start = p + 30 + buf.readUInt16LE(p + 26) + buf.readUInt16LE(p + 28);
  const end = start + entry.compressedSize;
  if (end > buf.length) throw formatError(`truncated entry ${entry.name}`);
  const data = buf.subarray(start, end);
  if (entry.method === 0) return Buffer.from(data);
  if (entry.method === 8) {
    try {
      return inflateRawSync(data, { maxOutputLength: MAX_ENTRY_BYTES });
    } catch (err) {
      throw formatError(`cannot inflate ${entry.name}: ${(err as Error).message}`);
    }
  }
  throw formatError(`unsupported compression method ${entry.method} for ${entry.name}`);
}

export type CellValue = string | number | null;

/** Decodes XML text plus the OOXML `_xHHHH_` escapes. */
function xmlText(s: string): string {
  return decodeEntities(s).replace(/_x([0-9a-f]{4})_/gi, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** Text of a `<si>` / `<is>` string item: every `<t>` run, phonetic hints (`<rPh>`) excluded. */
function stringItem(xml: string): string {
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>|<t\b[^>]*\/>/g;
  for (let m = re.exec(body); m; m = re.exec(body)) out += m[1] ? xmlText(m[1]) : '';
  return out;
}

function columnIndex(ref: string | undefined, fallback: number): number {
  const m = ref ? /^([A-Z]{1,3})\d*$/i.exec(ref) : null;
  if (!m) return fallback;
  let n = 0;
  for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function attr(attrs: string, name: string): string | undefined {
  const m = new RegExp(`\\b${name}="([^"]*)"`).exec(attrs);
  return m ? m[1] : undefined;
}

/** An opened workbook: first worksheet rows and core properties. */
export interface Workbook {
  /** Rows of the first worksheet (sparse cells filled with null; trailing nulls dropped). */
  rows(): Generator<CellValue[]>;
  /** `dcterms:modified` of docProps/core.xml as 'YYYY-MM-DD', or null. */
  modifiedDay: string | null;
  sheetName: string | null;
}

function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = ['xl'];
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

export function openXlsx(buf: Buffer): Workbook {
  const entries = zipEntries(buf);
  const text = (name: string): string | null => {
    const e = entries.get(name);
    return e ? zipRead(buf, e).toString('utf8') : null;
  };

  const workbook = text('xl/workbook.xml');
  if (!workbook) throw formatError('xl/workbook.xml missing (not an XLSX file)');
  const firstSheet = /<sheet\b([^>]*)\/?>/.exec(workbook);
  if (!firstSheet) throw formatError('workbook has no sheets');
  const sheetName = attr(firstSheet[1], 'name') ?? null;
  const relId = attr(firstSheet[1], 'r:id');
  let sheetPath = 'xl/worksheets/sheet1.xml';
  let sharedPath = 'xl/sharedStrings.xml';
  const rels = text('xl/_rels/workbook.xml.rels');
  if (rels) {
    const relRe = /<Relationship\b([^>]*)\/?>/g;
    for (let m = relRe.exec(rels); m; m = relRe.exec(rels)) {
      const id = attr(m[1], 'Id');
      const type = attr(m[1], 'Type') ?? '';
      const target = attr(m[1], 'Target');
      if (!target) continue;
      if (relId && id === relId) sheetPath = resolveTarget(target);
      else if (type.endsWith('/sharedStrings')) sharedPath = resolveTarget(target);
    }
  }

  const shared: string[] = [];
  const sst = text(sharedPath);
  if (sst) {
    const siRe = /<si>([\s\S]*?)<\/si>|<si\/>/g;
    for (let m = siRe.exec(sst); m; m = siRe.exec(sst)) shared.push(m[1] ? stringItem(m[1]) : '');
  }

  const core = text('docProps/core.xml');
  const mod = core ? /<dcterms:modified\b[^>]*>(\d{4}-\d{2}-\d{2})/.exec(core) : null;

  const sheet = text(sheetPath);
  if (sheet === null) throw formatError(`worksheet ${sheetPath} missing`);

  function* rows(): Generator<CellValue[]> {
    const rowRe = /<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g;
    for (let r = rowRe.exec(sheet!); r; r = rowRe.exec(sheet!)) {
      const cells: CellValue[] = [];
      const body = r[1] ?? '';
      const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
      let next = 0;
      for (let c = cellRe.exec(body); c; c = cellRe.exec(body)) {
        const col = columnIndex(attr(c[1], 'r'), next);
        next = col + 1;
        const type = attr(c[1], 't') ?? 'n';
        const inner = c[2] ?? '';
        let value: CellValue = null;
        if (type === 'inlineStr') {
          const is = /<is>([\s\S]*?)<\/is>/.exec(inner);
          value = is ? stringItem(is[1]) : null;
        } else {
          const v = /<v>([\s\S]*?)<\/v>/.exec(inner);
          if (v) {
            const raw = v[1];
            if (type === 's') value = shared[Number(raw)] ?? null;
            else if (type === 'str' || type === 'e' || type === 'd') value = xmlText(raw);
            else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
            else {
              const num = Number(raw);
              value = Number.isFinite(num) ? num : xmlText(raw);
            }
          }
        }
        while (cells.length < col) cells.push(null);
        cells[col] = value;
      }
      while (cells.length && (cells[cells.length - 1] === null || cells[cells.length - 1] === '')) cells.pop();
      yield cells;
    }
  }

  return { rows, modifiedDay: mod ? mod[1] : null, sheetName };
}
