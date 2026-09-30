/**
 * Registry-level connector metadata on top of the shared Connector contract: the zod config
 * schema (the SEED step creates `sources` rows from it), platform defaults for the
 * `source_platforms` row, the stable source key and — for broad feeds — the cheap relevance
 * pre-filter the pipeline applies before storage (filtered items are counted, never silent).
 */
import type { z } from 'zod';
import type { GRADES } from '../../db/schema/_enums';
import type { Connector, ConnectorContext } from '../contracts/connectors';
import type { RawItem } from '../contracts/jobs';

export type ConnectorKind = 'ats' | 'aggregator' | 'government';
export type Grade = (typeof GRADES)[number];

export interface PlatformDefaults {
  name: string;
  grade: Grade;
  /** api | feed | ats_json | html | register | csv */
  accessMethod: 'api' | 'feed' | 'ats_json' | 'xml';
  termsUrl: string | null;
  rateLimitPerMin: number;
  dailyCap: number;
  /** Attribution the UI must show next to jobs from this platform (link back), if the terms require it. */
  attribution: string | null;
  notes: string;
}

export interface PrefilterResult {
  keep: boolean;
  /** Which bucket matched ('security' | 'fullstack' | 'keyword') or why it was dropped. */
  reason: string;
}

export interface ConnectorModule<C = unknown> extends Connector {
  kind: ConnectorKind;
  configSchema: z.ZodType<C>;
  platform: PlatformDefaults;
  /** Stable natural key for the `sources.source_key` column, e.g. 'greenhouse:gitlab'. */
  sourceKeyFor(config: C): string;
  /**
   * 'full': every run lists every open posting, so absence counts toward closing (after 2 healthy
   * runs). 'incremental': the fetch returns only recent/changed postings (delta feeds, capped
   * pages); absence never counts — closing comes from source-closed markers, expiry or link checks.
   */
  listing: 'full' | 'incremental';
  /** Relevance pre-filter for broad feeds. Absent = keep everything. */
  prefilter?(item: RawItem, config: C): PrefilterResult;
}

/**
 * What the pipeline passes to `fetch` on top of the shared ConnectorContext: the external ids
 * already stored for this source, so connectors with per-item detail requests (SmartRecruiters,
 * Bundesagentur, NAV) can spend their capped detail budget on new postings first.
 */
export interface PipelineFetchContext extends ConnectorContext {
  knownExternalIds?: ReadonlySet<string>;
  /**
   * Called when a 'full' listing could not be read completely this run (item/page caps hit):
   * the pipeline then treats this run like an incremental one (no missing counts).
   */
  markListingPartial?(reason: string): void;
}

export function markPartial(ctx: ConnectorContext, reason: string): void {
  (ctx as PipelineFetchContext).markListingPartial?.(reason);
  ctx.log(`listing partial: ${reason}`);
}

export function knownIds(ctx: ConnectorContext): ReadonlySet<string> | undefined {
  return (ctx as PipelineFetchContext).knownExternalIds;
}

/**
 * Marker payload for an item the connector saw in the listing but did not fetch in detail (cap
 * reached). The pipeline only confirms it as still listed (last_seen, missing count reset) when
 * the job already exists; unknown ones are counted as `deferred` and fetched in a later run.
 * Never parsed, never stored as a raw snapshot.
 */
export const SEEN_ONLY_KEY = '__radarSeenOnly';

export interface SeenOnlyPayload {
  [SEEN_ONLY_KEY]: true;
  listing: unknown;
}

export function seenOnlyPayload(listing: unknown): SeenOnlyPayload {
  return { [SEEN_ONLY_KEY]: true, listing };
}

export function isSeenOnly(item: RawItem): boolean {
  const p = item.payload;
  return typeof p === 'object' && p !== null && (p as Record<string, unknown>)[SEEN_ONLY_KEY] === true;
}

/** Orders listing ids so unknown ones get detail requests first (stable within each group). */
export function detailPriority<T>(items: readonly T[], idOf: (t: T) => string, known?: ReadonlySet<string>): T[] {
  if (!known || known.size === 0) return [...items];
  const fresh: T[] = [];
  const seen: T[] = [];
  for (const it of items) (known.has(idOf(it)) ? seen : fresh).push(it);
  return [...fresh, ...seen];
}

/**
 * Marker payload: the source itself says this posting is closed/inactive. The pipeline closes
 * the matching job (reason 'source_closed'); unknown ids are ignored (counted). Never parsed.
 */
export const SOURCE_CLOSED_KEY = '__radarSourceClosed';

export function sourceClosedPayload(listing: unknown): Record<string, unknown> {
  return { [SOURCE_CLOSED_KEY]: true, listing };
}

export function isSourceClosed(item: RawItem): boolean {
  const p = item.payload;
  return typeof p === 'object' && p !== null && (p as Record<string, unknown>)[SOURCE_CLOSED_KEY] === true;
}
