/**
 * Shared helpers for connector parsers: defensive field access (throwing ParseError with the
 * field name), date parsing for the formats platforms actually send, description extraction
 * (HTML kept for the sanitiser, plain text derived), and config validation.
 */
import { z } from 'zod';
import type { SourceRow } from '../../db/schema';
import { ParseError, SourceError } from '../contracts/connectors';
import type { RawItem, SalaryHint, WorkplaceType } from '../contracts/jobs';
import { htmlToPlainText, safeHref, unescapeIfEncodedHtml } from '../security/sanitize';

/** Tenant slug used inside a hostname or path: never lets config reshape the URL. */
export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'letters, digits, dot, dash, underscore only');
/** Slug used as a DNS label ({slug}.recruitee.com): lowercase, no dots/underscores. */
export const hostLabelSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, 'a DNS label (letters, digits, dashes)');
export const optionalName = z.string().trim().min(1).max(191).optional();
export const iso2Schema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/);
export const keywordsSchema = z.array(z.string().trim().min(2).max(64)).max(50).default([]);

export function parseConfig<C>(schema: z.ZodType<C>, source: Pick<SourceRow, 'configJson' | 'sourceKey'>): C {
  const parsed = schema.safeParse(source.configJson ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new SourceError(`invalid config for ${source.sourceKey}: ${issue?.path.join('.') || '(root)'} ${issue?.message ?? ''}`.trim());
  }
  return parsed.data;
}

export type Rec = Record<string, unknown>;

export function isRecord(v: unknown): v is Rec {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function asRecord(v: unknown, field = 'payload'): Rec {
  if (!isRecord(v)) throw new ParseError(`${field} is not an object`, field);
  return v;
}

/** Trimmed non-empty string or null (numbers are stringified). */
export function str(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = v.replace(/ /g, ' ').trim();
    return t ? t : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

export function reqStr(obj: Rec, key: string, label = key): string {
  const v = str(obj[key]);
  if (v === null) throw new ParseError(`missing ${label}`, label);
  return v;
}

export function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function positiveNum(v: unknown): number | null {
  const n = num(v);
  return n !== null && n > 0 ? n : null;
}

export function strArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(str).filter((x): x is string => x !== null);
}

/**
 * Parses the date shapes platforms send: ISO 8601 (with/without zone; zone-less = UTC),
 * 'YYYY-MM-DD', 'YYYY-MM-DD HH:mm:ss UTC', epoch seconds or milliseconds. Invalid → null.
 */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === 'number') {
    if (!Number.isFinite(v) || v <= 0) return null;
    const d = new Date(v < 1e11 ? v * 1000 : v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof v !== 'string') return null;
  let s = v.trim();
  if (/^\d{9,13}$/.test(s)) return toDate(Number(s));
  const utcSuffix = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)\s*UTC$/i.exec(s);
  if (utcSuffix) s = `${utcSuffix[1]}T${utcSuffix[2]}Z`;
  else if (/^\d{4}-\d{2}-\d{2}$/.test(s)) s = `${s}T00:00:00Z`;
  else if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(s)) s = `${s.replace(' ', 'T')}Z`;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface Description {
  html: string | null;
  text: string;
}

/** HTML (unescaped once if the API double-encodes it) for the sanitiser + plain text. */
export function description(parts: readonly (string | null | undefined)[], plain?: string | null): Description {
  const html = parts
    .map((p) => (typeof p === 'string' ? unescapeIfEncodedHtml(p).trim() : ''))
    .filter(Boolean)
    .join('\n');
  const plainText = typeof plain === 'string' ? plain.replace(/ /g, ' ').trim() : '';
  const text = plainText || (html ? htmlToPlainText(html) : '');
  return { html: html || null, text };
}

/** Absolute http(s) URL or null. */
export function httpUrl(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  const href = safeHref(s);
  if (!href || !/^https?:/i.test(href)) return null;
  return href;
}

export function reqUrl(v: unknown, label: string): string {
  const u = httpUrl(v);
  if (!u) throw new ParseError(`missing or invalid ${label}`, label);
  return u;
}

export function workplaceFrom(v: unknown): WorkplaceType | null {
  const s = str(v)?.toLowerCase().replace(/[\s_-]+/g, '');
  if (!s) return null;
  if (s === 'remote' || s === 'fullyremote' || s === 'remoteonly' || s === 'telecommute') return 'remote';
  if (s === 'hybrid') return 'hybrid';
  if (s === 'onsite' || s === 'inoffice' || s === 'office') return 'onsite';
  return null;
}

/** 'STOCKHOLM' → 'Stockholm', 'NORGE' → 'Norge'; mixed-case strings are left alone. */
export function capIfUpper(s: string | null): string | null {
  if (!s || s !== s.toUpperCase() || s === s.toLowerCase()) return s;
  return s.toLowerCase().replace(/(^|[\s-])(\S)/g, (_m, sep: string, c: string) => sep + c.toUpperCase());
}

export function joinLocation(parts: readonly (string | null | undefined)[], sep = ', '): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of parts) {
    const t = typeof p === 'string' ? p.trim() : '';
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out.join(sep);
}

export function rawItem(externalId: string, payload: unknown, url?: string | null, fetchedAt: Date = new Date()): RawItem {
  return { externalId: externalId.slice(0, 255), payload, url: url ?? undefined, fetchedAt };
}

/** Company name for single-company boards: config override → payload → source label. */
export function companyNameFor(configName: string | undefined, payloadName: string | null, source: Pick<SourceRow, 'label'>): string {
  return configName?.trim() || payloadName || source.label;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason instanceof Error ? signal.reason : new Error('aborted');
}

/** Config fields every source with a relevance pre-filter accepts. */
export function prefilterFields(enabledByDefault: boolean) {
  return {
    /** Apply the cheap security/fullstack title pre-filter (dropped items are counted). */
    prefilter: z.boolean().default(enabledByDefault),
    /** Extra words that also keep an item. */
    keywords: keywordsSchema,
  };
}

/** Salary hint from numeric min/max (0 or missing = unknown). Null when neither is usable. */
const PERIOD_ALIASES: Record<string, string> = {
  year: 'year', yearly: 'year', annual: 'year', annually: 'year', yr: 'year',
  month: 'month', monthly: 'month', week: 'week', weekly: 'week',
  day: 'day', daily: 'day', hour: 'hour', hourly: 'hour', hr: 'hour',
};

/** Normalises source salary periods ('annual', 'hourly', 'MONTHLY') to year|month|week|day|hour. */
export function salaryPeriod(v: unknown): string | undefined {
  const p = str(v)?.toLowerCase();
  if (!p) return undefined;
  return PERIOD_ALIASES[p] ?? p;
}

export function salaryFrom(min: unknown, max: unknown, currency: unknown, period: unknown, raw?: unknown): SalaryHint | null {
  const lo = positiveNum(min);
  const hi = positiveNum(max);
  const r = str(raw);
  if (lo === null && hi === null) return r ? { raw: r } : null;
  return {
    min: lo ?? undefined,
    max: hi ?? undefined,
    currency: str(currency)?.toUpperCase() ?? undefined,
    period: salaryPeriod(period),
    raw: r ?? undefined,
  };
}

const MOJIBAKE_RE = /[Â-ß][\u0080-¿]|[à-ï][\u0080-¿]{2}|[ð-ô][\u0080-¿]{3}/g;

/**
 * Repairs UTF-8 text that a source decoded as Latin-1 ("MecÃ¡nico" → "Mecánico",
 * "â\u0080\u0094" → "—"). Each suspicious byte run is re-decoded on its own and kept only when it
 * forms one valid UTF-8 character, so correctly encoded text passes through unchanged.
 */
export function repairMojibake(s: string): string {
  return s.replace(MOJIBAKE_RE, (m) => {
    const fixed = Buffer.from(m, 'latin1').toString('utf8');
    return fixed.includes('�') || [...fixed].length !== 1 ? m : fixed;
  });
}
