/**
 * UK Home Office "Register of Worker and Temporary Worker licensed sponsors".
 *
 * The gov.uk content API describes the publication; its CSV attachment (~11 MB, ~140k rows,
 * refreshed every working day) is the register. Columns: Organisation Name, Town/City, County,
 * Type & Rating, Route. One organisation appears once per route it is licensed for.
 */
import { Readable } from 'node:stream';
import { parse } from 'csv-parse';
import { REGISTERS } from './catalog';
import { clean, download, FILE_MAX_BYTES, isoDay, PAGE_MAX_BYTES } from './text';
import { RegisterError, type RegisterEntryInput, type RegisterSnapshot, type RegisterSourceContext } from './types';

export const UK_CONTENT_API = 'https://www.gov.uk/api/content/government/publications/register-of-licensed-sponsors-workers';

const UK_COLUMNS = ['Organisation Name', 'Town/City', 'County', 'Type & Rating', 'Route'] as const;
type UkColumn = (typeof UK_COLUMNS)[number];

interface UkAttachment {
  url: string;
  filename: string | null;
}

/** The CSV attachment of the content-API document (the worker register). */
export function pickUkAttachment(doc: unknown): UkAttachment {
  const details = (doc as { details?: { attachments?: unknown } } | null)?.details;
  const list = Array.isArray(details?.attachments) ? (details.attachments as Record<string, unknown>[]) : [];
  const csvs = list.filter((a) => {
    const url = typeof a.url === 'string' ? a.url : '';
    const type = typeof a.content_type === 'string' ? a.content_type : '';
    return /\.csv($|\?)/i.test(url) || /csv/i.test(type);
  });
  const best = csvs.find((a) => /worker/i.test(String(a.title ?? '') + String(a.filename ?? ''))) ?? csvs[0];
  if (!best || typeof best.url !== 'string') throw new RegisterError('gov.uk content API: no CSV attachment on the sponsor register page', 'format', UK_CONTENT_API);
  return { url: best.url, filename: typeof best.filename === 'string' ? best.filename : null };
}

/** '…_Register_-_2026-09-29.csv' → '2026-09-29'. */
export function ukDateFromFilename(name: string | null): string | null {
  if (!name) return null;
  const m = /(\d{4}-\d{2}-\d{2})(?:[^\d]*)\.csv/i.exec(name);
  return m ? isoDay(m[1]) : null;
}

/**
 * 'Worker (A rating)' → 'A rating'; 'Worker (A (SME+))' → 'A rating (SME+)';
 * 'Worker (UK Expansion Worker: Provisional )' → 'Provisional'.
 */
export function ukRating(typeAndRating: string | null): string | null {
  if (!typeAndRating) return null;
  const open = typeAndRating.indexOf('(');
  const close = typeAndRating.lastIndexOf(')');
  if (open < 0 || close <= open) return null;
  const inner = typeAndRating.slice(open + 1, close).replace(/\s+/g, ' ').trim();
  const rated = /^([AB])[\s-]*rat(?:ing|ed)\b/i.exec(inner);
  if (rated) return `${rated[1].toUpperCase()} rating`;
  const graded = /^([AB])\s*\(([^)]*)\)?$/i.exec(inner);
  if (graded) return clean(`${graded[1].toUpperCase()} rating (${graded[2].trim()})`, 64);
  if (/provisional/i.test(inner)) return 'Provisional';
  return clean(inner, 64);
}

/** 'HAMILTON, ' → 'HAMILTON' (a few rows carry a dangling separator). */
export function ukTown(town: string | null): string | null {
  return town ? clean(town.replace(/[\s,;]+$/, ''), 128) : null;
}

/** Streams the CSV rows as entries (the buffer is parsed incrementally, never split into all rows at once). */
export async function* parseUkCsv(csv: Buffer | string): AsyncGenerator<RegisterEntryInput> {
  const parser = Readable.from([typeof csv === 'string' ? Buffer.from(csv, 'utf8') : csv]).pipe(
    parse({ bom: true, relax_column_count: true, relax_quotes: true, skip_empty_lines: true, trim: true }),
  );
  let idx: Record<UkColumn, number> | null = null;
  for await (const rec of parser as AsyncIterable<string[]>) {
    if (!idx) {
      const header = rec.map((h) => h.trim().toLowerCase());
      const found = {} as Record<UkColumn, number>;
      for (const c of UK_COLUMNS) found[c] = header.indexOf(c.toLowerCase());
      const missing = UK_COLUMNS.filter((c) => found[c] < 0);
      if (missing.length) throw new RegisterError(`UK register CSV: missing column(s) ${missing.join(', ')}`, 'format');
      idx = found;
      continue;
    }
    const get = (c: UkColumn) => clean(rec[idx![c]], 512);
    const orgName = get('Organisation Name');
    if (!orgName) continue;
    const typeRating = get('Type & Rating');
    yield {
      orgName,
      town: ukTown(get('Town/City')),
      route: clean(rec[idx!.Route], 191),
      rating: ukRating(typeRating),
      raw: {
        organisation: orgName,
        town: get('Town/City'),
        county: get('County'),
        typeAndRating: typeRating,
        route: get('Route'),
      },
    };
  }
  if (!idx) throw new RegisterError('UK register CSV is empty', 'format');
}

export async function loadUk({ fetch }: RegisterSourceContext): Promise<RegisterSnapshot> {
  const hosts = REGISTERS.uk_home_office.allowedHosts;
  const page = await download(fetch, UK_CONTENT_API, hosts, { maxBytes: PAGE_MAX_BYTES, timeoutMs: 30_000, accept: 'application/json' });
  let doc: unknown;
  try {
    doc = JSON.parse(page.text());
  } catch {
    throw new RegisterError('gov.uk content API returned invalid JSON', 'format', UK_CONTENT_API);
  }
  const att = pickUkAttachment(doc);
  const file = await download(fetch, att.url, hosts, { maxBytes: FILE_MAX_BYTES, timeoutMs: 180_000, accept: 'text/csv', label: att.filename ?? undefined });
  const publishedAt = ukDateFromFilename(att.filename ?? att.url) ?? isoDay((doc as { public_updated_at?: unknown }).public_updated_at);
  return { publishedAt, files: [file.file], entries: parseUkCsv(file.body) };
}
