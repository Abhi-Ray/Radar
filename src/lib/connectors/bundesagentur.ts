/**
 * Bundesagentur für Arbeit — Jobsuche API (public, documented by bund.dev):
 *   GET https://rest.arbeitsagentur.de/jobboerse/jobsuche-service/pc/v6/jobs?was=…&wo=…
 *   header X-API-Key: jobboerse-jobsuche (the public client id published for this API).
 * The listing carries no description; a capped number of detail requests
 * (/pc/v4/jobdetails/{base64(referenznummer)}) add it. When the detail endpoint is unavailable the
 * posting is kept with its listing facts and flagged `descriptionMissing` (quality gate → review).
 * Listing is filtered by publication age (veroeffentlichtseit) → incremental.
 *
 * Live-verified 2026-09-30: the v4 listing (`stellenangebote`, `refnr`, `titel`, `arbeitgeber`,
 * `arbeitsort`) now answers 403; v6 (`ergebnisliste`, `referenznummer`, `stellenangebotsTitel`,
 * `firma`, `stellenlokationen[].adresse`, `externeURL`) works, and the v4 detail endpoint still
 * works with the base64 of the v6 referenznummer. The parser reads both shapes, so raw snapshots
 * stored from either version reprocess.
 * https://jobsuche.api.bund.dev/
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem, SalaryHint } from '../contracts/jobs';
import { DailyCapError } from '../http/polite';
import { asRecord, capIfUpper, description, httpUrl, isRecord, joinLocation, parseConfig, rawItem, salaryFrom, str, strArray, throwIfAborted, toDate } from './common';
import { detailPriority, knownIds, seenOnlyPayload, type ConnectorModule } from './types';

export const BUNDESAGENTUR_VERSION = 'bundesagentur@2026-09-30.2';

/** Public client id of the Jobsuche API (documented, not a secret). */
export const BA_API_KEY_HEADER = { 'X-API-Key': 'jobboerse-jobsuche' } as const;
const BASE = 'https://rest.arbeitsagentur.de/jobboerse/jobsuche-service';
/** Listing path (v6; v4 answers 403 since 2026). */
export const BA_LISTING_PATH = '/pc/v6/jobs';
/** Detail path (still v4; takes base64(referenznummer)). */
export const BA_DETAIL_PATH = '/pc/v4/jobdetails';

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
        const body = await ctx.http.getJson<unknown>(`${BASE}${BA_LISTING_PATH}?${qs.toString()}`, { headers: BA_API_KEY_HEADER });
        if (!isRecord(body)) throw new SourceError('bundesagentur: response is not an object');
        // No results → the key is simply absent.
        const offers = baOffers(body);
        for (const o of offers) {
          const ref = baRef(o);
          if (ref && !listings.has(ref)) listings.set(ref, o);
        }
        const max = typeof body.maxErgebnisse === 'number' ? body.maxErgebnisse : Number(body.maxErgebnisse ?? 0);
        if (offers.length < cfg.pageSize || page * cfg.pageSize >= max) break;
      }
    }
    const ordered = detailPriority([...listings.values()], (o) => baRef(o) ?? '', knownIds(ctx));
    const fetchedAt = new Date();
    const items: RawItem[] = [];
    let details = 0;
    let consecutiveFailures = 0;
    let detailsDisabled = cfg.maxDetails === 0;
    for (const listing of ordered) {
      const refnr = baRef(listing);
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
        const d = await ctx.http.getJson<unknown>(`${BASE}${BA_DETAIL_PATH}/${encodeURIComponent(baDetailId(refnr))}`, { headers: BA_API_KEY_HEADER });
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

/** Listing offers of a v6 (`ergebnisliste`) or v4 (`stellenangebote`) response. */
export function baOffers(body: Record<string, unknown>): Record<string, unknown>[] {
  const list = Array.isArray(body.ergebnisliste) ? body.ergebnisliste : Array.isArray(body.stellenangebote) ? body.stellenangebote : [];
  return list.filter(isRecord);
}

/** Reference number of a listing / detail (v6 `referenznummer`, v4 `refnr`). */
export function baRef(o: Record<string, unknown>): string | null {
  return str(o.referenznummer) ?? str(o.refnr);
}

function detailText(detail: Record<string, unknown> | null): string | null {
  if (!detail) return null;
  return str(detail.stellenangebotsBeschreibung) ?? str(detail.stellenbeschreibung) ?? str(detail.beschreibung);
}

const LAENDER: Record<string, string> = {
  BADEN_WUERTTEMBERG: 'Baden-Württemberg',
  BAYERN: 'Bayern',
  BERLIN: 'Berlin',
  BRANDENBURG: 'Brandenburg',
  BREMEN: 'Bremen',
  HAMBURG: 'Hamburg',
  HESSEN: 'Hessen',
  MECKLENBURG_VORPOMMERN: 'Mecklenburg-Vorpommern',
  NIEDERSACHSEN: 'Niedersachsen',
  NORDRHEIN_WESTFALEN: 'Nordrhein-Westfalen',
  RHEINLAND_PFALZ: 'Rheinland-Pfalz',
  SAARLAND: 'Saarland',
  SACHSEN: 'Sachsen',
  SACHSEN_ANHALT: 'Sachsen-Anhalt',
  SCHLESWIG_HOLSTEIN: 'Schleswig-Holstein',
  THUERINGEN: 'Thüringen',
};

/** v6 enum spellings ('NORDRHEIN_WESTFALEN', 'DEUTSCHLAND') → display names; v4 names pass through. */
function placeName(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (LAENDER[s]) return LAENDER[s];
  return capIfUpper(s.replace(/_/g, ' '));
}

const COUNTRY_ISO2: Record<string, string> = { deutschland: 'DE', germany: 'DE', österreich: 'AT', oesterreich: 'AT', schweiz: 'CH', luxemburg: 'LU', niederlande: 'NL', frankreich: 'FR', polen: 'PL', dänemark: 'DK', daenemark: 'DK', belgien: 'BE', tschechien: 'CZ' };

function countryIso2(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase();
  return COUNTRY_ISO2[s.toLowerCase()] ?? null;
}

interface BaPlace {
  ort: string | null;
  region: string | null;
  land: string | null;
}

/** Work places: v6 `stellenlokationen[].adresse`, v4 detail `arbeitsorte[]`, v4 listing `arbeitsort`. */
function places(listing: Record<string, unknown>, detail: Record<string, unknown> | null): BaPlace[] {
  const read = (o: Record<string, unknown>): BaPlace => ({ ort: str(o.ort), region: placeName(o.region), land: placeName(o.land) });
  for (const src of [detail, listing]) {
    if (!src) continue;
    if (Array.isArray(src.stellenlokationen)) {
      const out = src.stellenlokationen.filter(isRecord).map((l) => read(isRecord(l.adresse) ? l.adresse : l));
      if (out.some((p) => p.ort || p.region || p.land)) return out;
    }
    if (Array.isArray(src.arbeitsorte)) {
      const out = src.arbeitsorte.filter(isRecord).map(read);
      if (out.length) return out;
    }
  }
  return isRecord(listing.arbeitsort) ? [read(listing.arbeitsort)] : [];
}

const PAY_PERIOD: Record<string, string> = { JAHRESGEHALT: 'year', MONATSGEHALT: 'month', WOCHENLOHN: 'week', TAGESLOHN: 'day', STUNDENLOHN: 'hour' };

function salary(listing: Record<string, unknown>, detail: Record<string, unknown> | null): SalaryHint | null {
  const pick = (k: string) => detail?.[k] ?? listing[k];
  const angabe = str(pick('verguetungsangabe')) ?? str(detail?.verguetung);
  const period = angabe ? PAY_PERIOD[angabe] : undefined;
  const fixed = pick('festgehalt');
  const structured = salaryFrom(pick('gehaltsspanneVon') ?? fixed, pick('gehaltsspanneBis') ?? fixed, 'EUR', period);
  if (structured) return structured;
  // v4 free text ("70.000 - 85.000 EUR brutto jährlich"); the enum placeholders carry nothing.
  if (angabe && !PAY_PERIOD[angabe] && !/^KEINE_ANGABE/.test(angabe)) return { raw: angabe };
  return null;
}

function employmentType(listing: Record<string, unknown>, detail: Record<string, unknown> | null): string | null {
  const models = detail?.arbeitszeitmodelle;
  if (Array.isArray(models)) return strArray(models).join(', ') || null;
  if (str(models)) return str(models);
  const src = detail ?? listing;
  const kinds: string[] = [];
  if (src.arbeitszeitVollzeit === true) kinds.push('Vollzeit');
  if (Object.entries(src).some(([k, v]) => k.startsWith('arbeitszeitTeilzeit') && v === true)) kinds.push('Teilzeit');
  if (src.arbeitszeitSchichtNachtWochenende === true) kinds.push('Schicht/Nacht/Wochenende');
  return kinds.length ? kinds.join(', ') : null;
}

/** Exported for tests. */
export function parseBa(item: RawItem, sourceId: number): NormalizedJob {
  const p = asRecord(item.payload);
  const listing = asRecord(p.listing, 'listing');
  const detail = isRecord(p.detail) ? p.detail : null;
  const refnr = baRef(listing) ?? (detail ? baRef(detail) : null);
  if (!refnr) throw new ParseError('missing referenznummer', 'referenznummer');
  const beruf = str(listing.hauptberuf) ?? str(listing.beruf) ?? str(detail?.hauptberuf);
  const title = str(detail?.stellenangebotsTitel) ?? str(listing.stellenangebotsTitel) ?? str(listing.titel) ?? beruf;
  if (!title) throw new ParseError('missing stellenangebotsTitel', 'stellenangebotsTitel');
  const employer = str(detail?.firma) ?? str(detail?.arbeitgeber) ?? str(listing.firma) ?? str(listing.arbeitgeber);
  if (!employer) throw new ParseError('missing firma', 'firma');
  const where = places(listing, detail);
  const locationRaw = joinLocation(
    where.map((o) => joinLocation([o.ort, o.region, o.land])),
    '; ',
  );
  const eintritt = str(listing.eintrittsdatum) ?? (isRecord(listing.eintrittszeitraum) ? str(listing.eintrittszeitraum.von) : null);
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
            ['Beruf', beruf],
            ['Arbeitgeber', employer],
            ['Eintrittsdatum', eintritt],
            ['Arbeitsort', locationRaw],
          ]
            .filter(([, v]) => str(v))
            .map(([k, v]) => `- ${String(k)}: ${str(v)}`),
        ].join('\n'),
      );
  const externe = str(detail?.externeURL) ?? str(listing.externeURL) ?? str(listing.externeUrl);
  const external = httpUrl(externe) ?? httpUrl(detail?.allianzpartnerUrl);
  const periodOf = (o: Record<string, unknown> | null) => (o && isRecord(o.veroeffentlichungszeitraum) ? o.veroeffentlichungszeitraum : null);
  const period = periodOf(detail) ?? periodOf(listing) ?? {};
  // The listing names the place that matched the search; the detail may list several.
  const first = places(listing, null)[0] ?? where[0];
  const modifiedAt = str(listing.aenderungsdatum) ?? str(listing.modifikationsTimestamp) ?? str(detail?.aenderungsdatum);
  return {
    sourceId,
    externalId: refnr,
    title,
    companyName: employer,
    companyDomain: null,
    locationRaw,
    countryHint: countryIso2(first?.land) ?? (first?.land ? null : 'DE'),
    cityHint: first?.ort ?? null,
    workplaceHint: null,
    descriptionHtml: desc.html,
    descriptionText: desc.text,
    applyUrl: external ?? baJobUrl(refnr),
    postedAt:
      toDate(listing.aktuelleVeroeffentlichungsdatum) ??
      toDate(period.von) ??
      toDate(listing.datumErsteVeroeffentlichung) ??
      toDate(detail?.datumErsteVeroeffentlichung) ??
      toDate(modifiedAt),
    closingAt: toDate(period.bis),
    salaryHint: salary(listing, detail),
    employmentType: employmentType(listing, detail),
    extra: {
      descriptionMissing,
      beruf,
      eintrittsdatum: eintritt,
      baUrl: baJobUrl(refnr),
      externeUrl: externe,
      modifiedAt,
      ...((detail ?? listing).homeofficemoeglich === true ? { homeOffice: str((detail ?? listing).homeofficetyp) ?? 'possible' } : {}),
      ...(detail?.istArbeitnehmerUeberlassung === true ? { tempAgency: true } : {}),
      ...(detail?.istPrivateArbeitsvermittlung === true ? { privateAgency: true } : {}),
    },
  };
}
