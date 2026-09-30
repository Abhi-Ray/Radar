/**
 * Bundesagentur für Arbeit — Jobsuche API (public, documented by bund.dev):
 *   GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v4/jobs?was=…&wo=…
 *   header X-API-Key: jobboerse-jobsuche (the public client id published for this API).
 * The listing carries no description; a capped number of detail requests
 * (/pc/v4/jobdetails/{base64(refnr)}) add it. When the detail endpoint is unavailable the posting
 * is kept with its listing facts and flagged `descriptionMissing` (quality gate → needs_review).
 * Listing is filtered by publication age (veroeffentlichtseit) → incremental.
 * https://jobsuche.api.bund.dev/
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import { DailyCapError } from '../http/polite';
import { asRecord, description, httpUrl, isRecord, joinLocation, parseConfig, rawItem, reqStr, str, strArray, throwIfAborted, toDate } from './common';
import { detailPriority, knownIds, seenOnlyPayload, type ConnectorModule } from './types';

export const BUNDESAGENTUR_VERSION = 'bundesagentur@2026-09-30.1';

/** Public client id of the Jobsuche API (documented, not a secret). */
export const BA_API_KEY_HEADER = { 'X-API-Key': 'jobboerse-jobsuche' } as const;
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';

const querySchema = z.object({
  /** Free text: job title, skill or occupation ("IT-Sicherheit", "Cloud Security"). */
  was: z.string().trim().min(2).max(100),
  /** Place or postcode; omitted = Germany-wide. */
  wo: z.string().trim().min(2).max(100).optional(),
  umkreis: z.number().int().min(0).max(200).optional(),
});

export const bundesagenturConfigSchema = z.object({
  queries: z.array(querySchema).min(1).max(20),
  /** 1 = Arbeit (jobs), 4 = Ausbildung, 34 = Praktikum/Trainee. */
  angebotsart: z.union([z.literal(1), z.literal(4), z.literal(34)]).default(1),
  /** Only postings published within the last N days (0-100). */
  veroeffentlichtseit: z.number().int().min(0).max(100).default(7),
  pageSize: z.number().int().min(10).max(100).default(50),
  maxPages: z.number().int().min(1).max(20).default(4),
  maxDetails: z.number().int().min(0).max(200).default(40),
  /** Skip postings from temp agencies (zeitarbeit=false). */
  excludeTempAgencies: z.boolean().default(true),
});
export type BundesagenturConfig = z.output<typeof bundesagenturConfigSchema>;

/** Detail path id: base64 of the refnr (standard alphabet, as the official apps send it). */
export function baDetailId(refnr: string): string {
  return Buffer.from(refnr, 'utf8').toString('base64');
}

export function baJobUrl(refnr: string): string {
  return `https://www.arbeitsagentur.de/jobsuche/jobdetail/${encodeURIComponent(refnr)}`;
}

interface BaPayload {
  listing: Record<string, unknown>;
  detail: Record<string, unknown> | null;
}

const DETAIL_FAILURES_BEFORE_GIVING_UP = 3;

export const bundesagentur: ConnectorModule<BundesagenturConfig> = {
  platformKey: 'bundesagentur',
  version: BUNDESAGENTUR_VERSION,
  kind: 'government',
  listing: 'incremental',
  configSchema: bundesagenturConfigSchema,
  platform: {
    name: 'Bundesagentur für Arbeit (Jobsuche)',
    grade: 'A',
    accessMethod: 'api',
    termsUrl: 'https://jobsuche.api.bund.dev/',
    rateLimitPerMin: 20,
    dailyCap: 600,
    attribution: 'Quelle: Bundesagentur für Arbeit',
    notes: 'Official German employment agency API; listing + capped detail requests.',
  },
  sourceKeyFor: (c) => `bundesagentur:${c.queries.map((q) => `${q.was}${q.wo ? `@${q.wo}` : ''}`.toLowerCase().replace(/\s+/g, '-')).join('+')}`.slice(0, 191),

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(bundesagenturConfigSchema, ctx.source);
    const listings = new Map<string, Record<string, unknown>>();
    for (const q of cfg.queries) {
      for (let page = 1; page <= cfg.maxPages; page++) {
        throwIfAborted(ctx.signal);
        const qs = new URLSearchParams({
          was: q.was,
          angebotsart: String(cfg.angebotsart),
          veroeffentlichtseit: String(cfg.veroeffentlichtseit),
          size: String(cfg.pageSize),
          page: String(page),
        });
        if (q.wo) qs.set('wo', q.wo);
        if (q.umkreis !== undefined) qs.set('umkreis', String(q.umkreis));
        if (cfg.excludeTempAgencies) qs.set('zeitarbeit', 'false');
        const body = await ctx.http.getJson<unknown>(`${BASE}/pc/v4/jobs?${qs.toString()}`, { headers: BA_API_KEY_HEADER });
        if (!isRecord(body)) throw new SourceError('bundesagentur: response is not an object');
        // No results → the key is simply absent.
        const offers = Array.isArray(body.stellenangebote) ? body.stellenangebote.filter(isRecord) : [];
        for (const o of offers) {
          const ref = str(o.refnr);
          if (ref && !listings.has(ref)) listings.set(ref, o);
        }
        const max = typeof body.maxErgebnisse === 'number' ? body.maxErgebnisse : Number(body.maxErgebnisse ?? 0);
        if (offers.length < cfg.pageSize || page * cfg.pageSize >= max) break;
      }
    }
    const ordered = detailPriority([...listings.values()], (o) => str(o.refnr) ?? '', knownIds(ctx));
    const fetchedAt = new Date();
    const items: RawItem[] = [];
    let details = 0;
    let consecutiveFailures = 0;
    let detailsDisabled = cfg.maxDetails === 0;
    for (const listing of ordered) {
      const refnr = str(listing.refnr);
      if (!refnr) continue;
      const known = knownIds(ctx)?.has(refnr) ?? false;
      if (detailsDisabled || details >= cfg.maxDetails) {
        // Known postings are only confirmed; new ones are kept with listing facts once the
        // detail endpoint is known to be unavailable, deferred when merely over budget.
        if (known || !detailsDisabled) items.push(rawItem(refnr, seenOnlyPayload(listing), null, fetchedAt));
        else items.push(rawItem(refnr, { listing, detail: null } satisfies BaPayload, baJobUrl(refnr), fetchedAt));
        continue;
      }
      throwIfAborted(ctx.signal);
      let detail: Record<string, unknown> | null = null;
      try {
        const d = await ctx.http.getJson<unknown>(`${BASE}/pc/v4/jobdetails/${encodeURIComponent(baDetailId(refnr))}`, { headers: BA_API_KEY_HEADER });
        details++;
        detail = isRecord(d) ? d : null;
        consecutiveFailures = 0;
      } catch (err) {
        if (err instanceof DailyCapError || ctx.signal.aborted) throw err;
        details++;
        consecutiveFailures++;
        ctx.log(`bundesagentur: detail ${refnr} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (consecutiveFailures >= DETAIL_FAILURES_BEFORE_GIVING_UP) {
          detailsDisabled = true;
          ctx.log('bundesagentur: detail endpoint failing repeatedly; using listing data for the rest of this run');
        }
      }
      items.push(rawItem(refnr, { listing, detail } satisfies BaPayload, baJobUrl(refnr), fetchedAt));
    }
    return items;
  },

  parse: (item, ctx) => parseBa(item, ctx.source.id),
};

function detailText(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;
  return str(detail.stellenangebotsBeschreibung) ?? str(detail.stellenbeschreibung) ?? str(detail.beschreibung);
}

/** Exported for tests. */
export function parseBa(item: RawItem, sourceId: number): NormalizedJob {
  const p = asRecord(item.payload);
  const listing = asRecord(p.listing, 'listing');
  const detail = isRecord(p.detail) ? p.detail : null;
  const refnr = reqStr(listing, 'refnr');
  const title = str(detail?.stellenangebotsTitel) ?? str(listing.titel) ?? reqStr(listing, 'beruf', 'titel');
  const employer = str(detail?.firma) ?? str(detail?.arbeitgeber) ?? str(listing.arbeitgeber);
  if (!employer) throw new ParseError('missing arbeitgeber', 'arbeitgeber');
  const ort = isRecord(listing.arbeitsort) ? listing.arbeitsort : {};
  const detailOrte = detail && Array.isArray(detail.arbeitsorte) ? detail.arbeitsorte.filter(isRecord) : [];
  const places = detailOrte.length ? detailOrte : [ort];
  const locationRaw = joinLocation(
    places.map((o) => joinLocation([str(o.ort), str(o.region), str(o.land)])),
    '; ',
  );
  const text = detailText(detail);
  const descriptionMissing = !text;
  // Without the detail text the listing facts stand in, as plain text (no HTML built from source strings).
  const desc = text
    ? description([], text)
    : description(
        [],
        [
          title,
          ...[
            ['Beruf', listing.beruf],
            ['Arbeitgeber', employer],
            ['Eintrittsdatum', listing.eintrittsdatum],
            ['Arbeitsort', locationRaw],
          ]
            .filter(([, v]) => str(v))
            .map(([k, v]) => `- ${String(k)}: ${str(v)}`),
        ].join('\n'),
      );
  const external = httpUrl(detail?.allianzpartnerUrl) ?? httpUrl(listing.externeUrl);
  const verguetung = str(detail?.verguetungsangabe) ?? str(detail?.verguetung);
  const period = isRecord(detail?.veroeffentlichungszeitraum) ? detail.veroeffentlichungszeitraum : {};
  return {
    sourceId,
    externalId: refnr,
    title,
    companyName: employer,
    companyDomain: null,
    locationRaw,
    countryHint: str(ort.land) ?? 'DE',
    cityHint: str(ort.ort),
    workplaceHint: null,
    descriptionHtml: desc.html,
    descriptionText: desc.text,
    applyUrl: external ?? baJobUrl(refnr),
    postedAt: toDate(listing.aktuelleVeroeffentlichungsdatum) ?? toDate(period.von) ?? toDate(listing.modifikationsTimestamp),
    closingAt: toDate(period.bis),
    salaryHint: verguetung ? { raw: verguetung } : null,
    employmentType: (Array.isArray(detail?.arbeitszeitmodelle) ? strArray(detail.arbeitszeitmodelle).join(', ') : str(detail?.arbeitszeitmodelle)) || null,
    extra: {
      descriptionMissing,
      beruf: str(listing.beruf),
      eintrittsdatum: str(listing.eintrittsdatum),
      baUrl: baJobUrl(refnr),
      externeUrl: str(listing.externeUrl),
      modifiedAt: str(listing.modifikationsTimestamp),
    },
  };
}
