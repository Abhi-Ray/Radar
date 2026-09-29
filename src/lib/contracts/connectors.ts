/**
 * Connector contract: one module per platform (greenhouse, lever, ...). `fetch` pulls raw items
 * for one source instance through the polite HTTP client; `parse` turns one raw item into the
 * common NormalizedJob shape or throws ParseError (→ dead-letter store, never silently dropped).
 */
import type { SourceRow } from '../../db/schema';
import type { NormalizedJob, RawItem } from './jobs';

export interface PoliteHttp {
  getJson<T>(url: string, init?: RequestInit): Promise<T>;
  getText(url: string, init?: RequestInit): Promise<string>;
}

export interface ConnectorContext {
  source: SourceRow;
  http: PoliteHttp;
  signal: AbortSignal;
  log: (m: string) => void;
}

export interface ParseContext {
  source: SourceRow;
}

export interface Connector {
  platformKey: string;
  /** Bump when the parser changes (recorded on raw snapshots and dead letters). */
  version: string;
  fetch(ctx: ConnectorContext): Promise<RawItem[]>;
  parse(item: RawItem, ctx: ParseContext): NormalizedJob;
}

export class ParseError extends Error {
  constructor(
    message: string,
    public readonly field?: string,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

/** Raised by connectors when the source itself is unusable (404 board, schema changed wholesale). */
export class SourceError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SourceError';
  }
}

export const BOT_USER_AGENT =
  'RadarJobBot/1.0 (+https://radar.187-127-129-127.sslip.io/bot; personal non-commercial job search)';
