/**
 * ECB euro foreign-exchange reference rates (spec §10): fetched from the ECB daily XML through
 * the SSRF-safe fetcher, validated, and cached in the `fx_rates` setting together with the ECB
 * reference date. Salary conversion reads the cache only (`getFxTable`); the worker refreshes it
 * (`ensureFxRates`) so normalisation never waits on the network.
 *
 * Only the rates the ECB publishes are stored; AED/SAR/QAR (USD pegs) and BGN/HRK (fixed euro
 * rates) are derived when the table is read, so the cache is always the ECB's own data.
 */
import { XMLParser } from 'fast-xml-parser';
import type { FxTable } from '../contracts/jobs';
import type { FxRatesSetting } from '../contracts/settings';
import type { DbOrTx } from '../db';
import { log } from '../log';
import { createSafeFetch, type AddressPolicy, type Resolver, type SafeFetchResponse } from '../security/safe-fetch';
import { getSetting, setSetting } from '../settings';
import { withDerivedRates } from './rates';

export const FX_LOGIC_VERSION = 'fx@2026-09-29.1';
export const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
export const ECB_SOURCE = 'ECB euro foreign exchange reference rates';

/** Refresh the cache when the last successful fetch is older than this. */
export const FX_REFRESH_AFTER_HOURS = 12;
/** Reference dates older than this are reported as outdated (ECB skips weekends and TARGET holidays). */
export const FX_MAX_REFERENCE_AGE_DAYS = 5;

const MIN_RATES = 5;
const MAX_BODY_BYTES = 256 * 1024;

export interface EcbRates {
  /** ECB reference date 'YYYY-MM-DD'. */
  date: string;
  /** 1 EUR = rates[CUR] CUR, as published. */
  rates: Record<string, number>;
}

export class FxParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxParseError';
  }
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  processEntities: false,
  parseAttributeValue: false,
  isArray: (name) => name === 'Cube',
});

type XmlNode = Record<string, unknown>;

function isNode(v: unknown): v is XmlNode {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every `<Cube time="…">` element, wherever it sits in the document. */
function dayCubes(node: unknown, out: XmlNode[] = [], depth = 0): XmlNode[] {
  if (depth > 8) return out;
  if (Array.isArray(node)) {
    for (const n of node) dayCubes(n, out, depth + 1);
    return out;
  }
  if (!isNode(node)) return out;
  if (typeof node['@_time'] === 'string') out.push(node);
  for (const [k, v] of Object.entries(node)) if (!k.startsWith('@_')) dayCubes(v, out, depth + 1);
  return out;
}

function validDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Parses the ECB daily (or 90-day / historical) XML and returns the most recent day. Throws
 * `FxParseError` unless the document has a valid date and at least five positive rates incl. USD.
 */
export function parseEcbXml(xml: string): EcbRates {
  if (typeof xml !== 'string' || !xml.trim()) throw new FxParseError('empty document');
  let doc: unknown;
  try {
    doc = parser.parse(xml);
  } catch (err) {
    throw new FxParseError(`not XML: ${err instanceof Error ? err.message.slice(0, 120) : 'parse error'}`);
  }
  const days = dayCubes(doc)
    .map((c) => ({ date: String(c['@_time']), cube: c }))
    .filter((d) => validDate(d.date))
    .sort((a, b) => (a.date < b.date ? 1 : -1));
  const latest = days[0];
  if (!latest) throw new FxParseError('no reference date');
  const rates: Record<string, number> = {};
  const entries = latest.cube.Cube;
  for (const e of Array.isArray(entries) ? entries : []) {
    if (!isNode(e)) continue;
    const code = String(e['@_currency'] ?? '').trim().toUpperCase();
    const rate = Number(String(e['@_rate'] ?? '').trim());
    if (!/^[A-Z]{3}$/.test(code) || code === 'EUR') continue;
    if (!Number.isFinite(rate) || rate <= 0) continue;
    rates[code] = rate;
  }
  if (Object.keys(rates).length < MIN_RATES) throw new FxParseError(`only ${Object.keys(rates).length} rates`);
  if (!rates.USD) throw new FxParseError('USD rate missing');
  return { date: latest.date, rates };
}

/** True when the cache is missing or its last fetch is older than `refreshAfterHours`. */
export function isFxStale(setting: Pick<FxRatesSetting, 'fetchedAt'> | null, now: Date = new Date(), refreshAfterHours = FX_REFRESH_AFTER_HOURS): boolean {
  if (!setting) return true;
  const fetched = Date.parse(setting.fetchedAt);
  if (Number.isNaN(fetched)) return true;
  return now.getTime() - fetched > refreshAfterHours * 3_600_000;
}

/** Days between the ECB reference date and `now` (null without a date). */
export function fxReferenceAgeDays(date: string | null, now: Date = new Date()): number | null {
  if (!date || !validDate(date)) return null;
  return Math.floor((now.getTime() - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
}

/** The table salary conversion uses: cached ECB rates plus derived pegs; EUR-only without a cache. */
export function fxTableFromSetting(setting: Pick<FxRatesSetting, 'date' | 'rates'> | null): FxTable {
  if (!setting) return { date: null, rates: withDerivedRates({}) };
  return { date: setting.date, rates: withDerivedRates(setting.rates) };
}

/** Cached FX table. Never fetches and never throws: FX trouble must not break the pipeline. */
export async function getFxTable(db: DbOrTx): Promise<FxTable> {
  try {
    return fxTableFromSetting(await getSetting(db, 'fx_rates'));
  } catch (err) {
    log.warn('fx: reading cached rates failed', { error: err instanceof Error ? err.message : String(err) });
    return fxTableFromSetting(null);
  }
}

export type FxFetch = (url: string, opts: { timeoutMs: number; maxBytes: number; headers: Record<string, string> }) => Promise<Pick<SafeFetchResponse, 'status' | 'ok' | 'text'>>;

export interface RefreshFxOptions {
  /** Injected fetcher (tests); default is `createSafeFetch({ resolver, addressPolicy })`. */
  fetch?: FxFetch;
  resolver?: Resolver;
  addressPolicy?: AddressPolicy;
  url?: string;
  now?: Date;
  timeoutMs?: number;
}

/** Fetches the ECB daily XML and stores it in `fx_rates`. Throws on network / parse failure. */
export async function refreshFxRates(db: DbOrTx, opts: RefreshFxOptions = {}): Promise<FxRatesSetting> {
  const now = opts.now ?? new Date();
  const url = opts.url ?? ECB_DAILY_URL;
  const fetcher: FxFetch = opts.fetch ?? createSafeFetch({ resolver: opts.resolver, addressPolicy: opts.addressPolicy });
  const res = await fetcher(url, {
    timeoutMs: opts.timeoutMs ?? 15_000,
    maxBytes: MAX_BODY_BYTES,
    headers: { accept: 'application/xml, text/xml;q=0.9, */*;q=0.1' },
  });
  if (!res.ok) throw new Error(`ECB rates request failed with HTTP ${res.status}`);
  const parsed = parseEcbXml(res.text());
  const previous = await getSetting(db, 'fx_rates').catch(() => null);
  if (previous && previous.date > parsed.date) {
    // A lagging mirror or cache must not replace newer rates.
    log.warn('fx: fetched rates are older than the cache; keeping the cache', { cached: previous.date, fetched: parsed.date });
    return previous;
  }
  const value: FxRatesSetting = { date: parsed.date, base: 'EUR', rates: parsed.rates, fetchedAt: now.toISOString(), source: ECB_SOURCE };
  // A daily machine refresh, not a user decision: no audit row (settings.setSetting skipAudit).
  const saved = await setSetting(db, 'fx_rates', value, { skipAudit: true, actor: 'worker', reason: 'ECB daily reference rates' });
  log.info('fx: rates refreshed', { date: saved.date, currencies: Object.keys(saved.rates).length });
  return saved;
}

export interface EnsureFxResult {
  setting: FxRatesSetting | null;
  refreshed: boolean;
  /** Set when a refresh was attempted and failed (the cached rates, if any, are returned). */
  error: string | null;
  /** The reference date is older than FX_MAX_REFERENCE_AGE_DAYS. */
  outdated: boolean;
}

/** Refreshes when stale; on failure keeps and returns the cache (logged, never thrown). */
export async function ensureFxRates(db: DbOrTx, opts: RefreshFxOptions & { refreshAfterHours?: number; force?: boolean } = {}): Promise<EnsureFxResult> {
  const now = opts.now ?? new Date();
  let cached: FxRatesSetting | null = null;
  try {
    cached = await getSetting(db, 'fx_rates');
  } catch (err) {
    log.warn('fx: reading cached rates failed', { error: err instanceof Error ? err.message : String(err) });
  }
  const outdated = (s: FxRatesSetting | null) => {
    const age = fxReferenceAgeDays(s?.date ?? null, now);
    return age === null || age > FX_MAX_REFERENCE_AGE_DAYS;
  };
  if (!opts.force && !isFxStale(cached, now, opts.refreshAfterHours)) {
    return { setting: cached, refreshed: false, error: null, outdated: outdated(cached) };
  }
  try {
    const setting = await refreshFxRates(db, { ...opts, now });
    return { setting, refreshed: true, error: null, outdated: outdated(setting) };
  } catch (err) {
    const message = err instanceof Error ? err.message.slice(0, 300) : String(err);
    log.warn('fx: refresh failed; using cached rates', { error: message, cachedDate: cached?.date ?? null });
    return { setting: cached, refreshed: false, error: message, outdated: outdated(cached) };
  }
}
