/**
 * NAV Arbeidsplassen job vacancy feed (Norway, public):
 *   GET https://pam-stilling-feed.nav.no/api/publicToken        → the current public bearer token
 *   GET /api/v1/feed  (If-Modified-Since: window start)         → pages of 1000 changes, oldest first
 *   GET /api/v1/feedentry/{uuid}                                → the full ad
 * The feed is a firehose of every Norwegian vacancy, so only titles passing the relevance
 * pre-filter get (capped) detail requests; the rest are handed to the pipeline for counting.
 * INACTIVE entries become source-closed markers. Delta feed → incremental.
 * The token is sent as a header only — never logged, stored or put in a URL.
 * https://navikt.github.io/pam-stilling-feed/
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import { DailyCapError, HttpStatusError } from '../http/polite';
import {
  asRecord,
  capIfUpper,
  description,
  httpUrl,
  isRecord,
  joinLocation,
  parseConfig,
  prefilterFields,
  rawItem,
  reqStr,
  str,
  throwIfAborted,
  toDate,
  type Rec,
} from './common';
import { prefilterDecision } from './relevance';
import { knownIds, markPartial, seenOnlyPayload, sourceClosedPayload, type ConnectorModule } from './types';

export const NAV_NO_VERSION = 'nav_no@2026-09-30.1';

const HOST = 'https://pam-stilling-feed.nav.no';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NEXT_PATH_RE = /^\/api\/v1\/feed\/[0-9a-f-]{36}$/i;
/** Feed pages hold up to 1000 entries; a shorter page is the live tail of the feed. */
const FULL_PAGE = 1000;

export const navConfigSchema = z.object({
  /** Longest look-back window; a recent successful run shortens it (last success − 2 h). */
  lookbackHours: z.number().int().min(1).max(168).default(48),
  maxPages: z.number().int().min(1).max(30).default(10),
  maxDetails: z.number().int().min(0).max(200).default(40),
  ...prefilterFields(true),
});
export type NavConfig = z.output<typeof navConfigSchema>;

interface NavPayload {
  feedEntry: Rec;
  detail: Rec | null;
}

/** Extracts the JWT from the publicToken response text (exported for tests). */
export function extractNavToken(text: string): string {
  const m = /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.exec(text);
  if (!m) throw new SourceError('nav_no: public token response has no token');
  return m[0];
}

/** Start of the fetch window: max(now − lookback, lastSuccess − 2 h). */
export function navWindowStart(now: Date, lookbackHours: number, lastSuccessAt: Date | null | undefined): Date {
  const floor = now.getTime() - lookbackHours * 3_600_000;
  const fromLast = lastSuccessAt ? lastSuccessAt.getTime() - 2 * 3_600_000 : floor;
  return new Date(Math.max(floor, Math.min(fromLast, now.getTime())));
}

function feedTitle(entry: Rec): string {
  const fe = isRecord(entry._feed_entry) ? entry._feed_entry : {};
  return str(fe.title) ?? str(entry.title) ?? '';
}

function feedStatus(entry: Rec): string | null {
  const fe = isRecord(entry._feed_entry) ? entry._feed_entry : {};
  return str(fe.status);
}

function decide(title: string, cfg: NavConfig) {
  return prefilterDecision(title, [], { enabled: cfg.prefilter, keywords: cfg.keywords });
}

export const navNo: ConnectorModule<NavConfig> = {
  platformKey: 'nav_no',
  version: NAV_NO_VERSION,
  kind: 'government',
  listing: 'incremental',
  configSchema: navConfigSchema,
  platform: {
    name: 'NAV Arbeidsplassen (stillingsfeed)',
    grade: 'A',
    accessMethod: 'feed',
    termsUrl: 'https://navikt.github.io/pam-stilling-feed/',
    rateLimitPerMin: 30,
    dailyCap: 400,
    attribution: 'Kilde: NAV / arbeidsplassen.no',
    notes: 'Norwegian public employment service feed; public rotating token; capped detail requests.',
  },
  sourceKeyFor: () => 'nav_no:feed',

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    const entry = isRecord(p.feedEntry) ? p.feedEntry : {};
    return decide(feedTitle(entry), cfg);
  },

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(navConfigSchema, ctx.source);
    const tokenText = await ctx.http.getText(`${HOST}/api/publicToken`, { headers: { accept: 'text/plain' } });
    const auth = { authorization: `Bearer ${extractNavToken(tokenText)}`, accept: 'application/json' };
    const since = navWindowStart(new Date(), cfg.lookbackHours, ctx.source.lastSuccessAt);

    // Latest occurrence wins: the feed repeats an ad each time it changes.
    const entries = new Map<string, Rec>();
    let url: string | null = `${HOST}/api/v1/feed`;
    let pages = 0;
    while (url && pages < cfg.maxPages) {
      throwIfAborted(ctx.signal);
      const headers: Record<string, string> = pages === 0 ? { ...auth, 'if-modified-since': since.toUTCString() } : auth;
      let body: unknown;
      try {
        body = await ctx.http.getJson<unknown>(url, { headers });
      } catch (err) {
        if (err instanceof HttpStatusError && err.status === 401) throw new SourceError('nav_no: public token rejected (rotated?)', 401);
        throw err;
      }
      pages++;
      if (!isRecord(body) || !Array.isArray(body.items)) throw new SourceError('nav_no: feed page has no items array');
      const items = body.items.filter(isRecord);
      for (const it of items) {
        const id = str(it.id) ?? (isRecord(it._feed_entry) ? str(it._feed_entry.uuid) : null);
        if (!id || !UUID_RE.test(id)) continue;
        entries.delete(id);
        entries.set(id, it);
      }
      const next = str(body.next_url);
      const nextUrl: string | null = next && NEXT_PATH_RE.test(next) ? `${HOST}${next}` : null;
      if (items.length < FULL_PAGE || !nextUrl || nextUrl === url) {
        url = null;
        break;
      }
      url = nextUrl;
    }
    if (url) markPartial(ctx, `nav_no: stopped after ${pages} feed pages`);

    const known = knownIds(ctx);
    const fetchedAt = new Date();
    const out: RawItem[] = [];
    const wanted: { id: string; entry: Rec }[] = [];
    for (const [id, entry] of entries) {
      if (feedStatus(entry) === 'INACTIVE') {
        out.push(rawItem(id, sourceClosedPayload(entry), null, fetchedAt));
        continue;
      }
      if (!decide(feedTitle(entry), cfg).keep) {
        // Handed on without detail: the pipeline's pre-filter drops and counts it.
        out.push(rawItem(id, { feedEntry: entry, detail: null } satisfies NavPayload, null, fetchedAt));
        continue;
      }
      wanted.push({ id, entry });
    }
    // New ids get the capped detail budget first.
    wanted.sort((a, b) => Number(known?.has(a.id) ?? false) - Number(known?.has(b.id) ?? false));
    let details = 0;
    let failures = 0;
    for (const { id, entry } of wanted) {
      if (details >= cfg.maxDetails) {
        out.push(rawItem(id, seenOnlyPayload(entry), null, fetchedAt));
        continue;
      }
      throwIfAborted(ctx.signal);
      try {
        details++;
        const d = await ctx.http.getJson<unknown>(`${HOST}/api/v1/feedentry/${encodeURIComponent(id)}`, { headers: auth });
        if (!isRecord(d)) throw new SourceError('nav_no: feed entry is not an object');
        if (str(d.status) === 'INACTIVE') out.push(rawItem(id, sourceClosedPayload(entry), null, fetchedAt));
        else out.push(rawItem(id, { feedEntry: entry, detail: d } satisfies NavPayload, `https://arbeidsplassen.nav.no/stillinger/stilling/${id}`, fetchedAt));
      } catch (err) {
        if (err instanceof DailyCapError || ctx.signal.aborted) throw err;
        failures++;
        ctx.log(`nav_no: entry ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (err instanceof HttpStatusError && err.status === 404) continue;
        out.push(rawItem(id, seenOnlyPayload(entry), null, fetchedAt));
        if (failures >= 5 && failures > details / 2) throw new SourceError('nav_no: most feed entry requests failing');
      }
    }
    return out;
  },

  parse(item, ctx): NormalizedJob {
    const p = asRecord(item.payload);
    const entry = asRecord(p.feedEntry, 'feedEntry');
    if (!isRecord(p.detail)) throw new ParseError('feed entry without detail', 'detail');
    const ad = asRecord(p.detail.ad_content, 'ad_content');
    const id = str(ad.uuid) ?? reqStr(entry, 'id');
    const title = str(ad.title) ?? feedTitle(entry);
    if (!title) throw new ParseError('missing title', 'title');
    const employer = isRecord(ad.employer) ? ad.employer : {};
    const fe = isRecord(entry._feed_entry) ? entry._feed_entry : {};
    const company = str(employer.name) ?? str(fe.businessName);
    if (!company) throw new ParseError('missing employer.name', 'employer.name');
    const desc = description([str(ad.description)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const locs = Array.isArray(ad.workLocations) ? ad.workLocations.filter(isRecord) : [];
    const cap = capIfUpper;
    const locationRaw = joinLocation(
      locs.map((l) => joinLocation([cap(str(l.city) ?? str(l.municipal)), cap(str(l.county)), cap(str(l.country))])),
      '; ',
    );
    const first = locs[0] ?? {};
    const link = httpUrl(ad.link) ?? `https://arbeidsplassen.nav.no/stillinger/stilling/${encodeURIComponent(id)}`;
    const cats = Array.isArray(ad.occupationCategories)
      ? ad.occupationCategories.filter(isRecord).map((c) => joinLocation([str(c.level1), str(c.level2)], ' / '))
      : [];
    const remote = str(ad.remote);
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: company,
      companyDomain: null,
      locationRaw,
      countryHint: cap(str(first.country)) ?? 'NO',
      cityHint: cap(str(first.city) ?? str(first.municipal)),
      workplaceHint: remote && /hjemmekontor|remote|fjern/i.test(remote) ? (/delvis|hybrid/i.test(remote) ? 'hybrid' : 'remote') : null,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: httpUrl(ad.applicationUrl) ?? link,
      postedAt: toDate(ad.published),
      closingAt: toDate(ad.applicationDue) ?? toDate(ad.expires),
      salaryHint: null,
      employmentType: joinLocation([str(ad.engagementtype), str(ad.extent)], ', ') || null,
      extra: {
        navUrl: link,
        jobtitle: str(ad.jobtitle),
        occupationCategories: cats,
        sector: str(ad.sector),
        positionCount: str(ad.positioncount),
        startTime: str(ad.starttime),
        applicationDueRaw: str(ad.applicationDue),
        expiresAt: str(ad.expires),
        orgnr: str(employer.orgnr),
      },
    };
  },
};
