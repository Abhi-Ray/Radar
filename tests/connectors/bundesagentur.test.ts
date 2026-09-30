import { describe, expect, it } from 'vitest';
import { baDetailId, baJobUrl, baOffers, bundesagentur, BUNDESAGENTUR_VERSION, parseBa } from '../../src/lib/connectors/bundesagentur';
import { isSeenOnly } from '../../src/lib/connectors/types';
import { DailyCapError } from '../../src/lib/http/polite';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

// v4 documented-shape samples (older raw snapshots must keep parsing) + live v6 captures (2026-09-30).
const jobs = fixtureJson<{ stellenangebote: Record<string, unknown>[] }>('bundesagentur', 'documented-shape-jobs.json');
const detail = fixtureJson<Record<string, unknown>>('bundesagentur', 'documented-shape-jobdetails.json');
const live = fixtureJson<{ ergebnisliste: Record<string, unknown>[]; maxErgebnisse: number }>('bundesagentur', 'live-v6-jobs-it-sicherheit-berlin.json');
const liveDetail = (ref: string) => fixtureJson<Record<string, unknown>>('bundesagentur', `live-v4-jobdetails-${ref}.json`);
const LIVE_REFS = ['12951-03e8c7a2-5eeb-4241--S', '12456-1636264-1-S', '12098-13876732-S'];
const src = fakeSource('bundesagentur', { queries: [{ was: 'IT Security' }] });
const REF = '10000-1201234567-S';

describe('bundesagentur connector', () => {
  it('base64-encodes the refnr for the detail path and builds the public job URL', () => {
    expect(baDetailId(REF)).toBe(Buffer.from(REF).toString('base64'));
    expect(baJobUrl(REF)).toBe(`https://www.arbeitsagentur.de/jobsuche/jobdetail/${REF}`);
  });

  it('lists with the public API key header, excludes temp agencies and fetches details', async () => {
    const http = new FakeHttp([
      { match: /\/pc\/v6\/jobs\?/, body: jobs },
      { match: /\/pc\/v4\/jobdetails\//, body: detail },
    ]);
    const items = await bundesagentur.fetch(fetchCtx(src, http));
    const list = new URL(http.calls[0]!.url);
    expect(list.searchParams.get('was')).toBe('IT Security');
    expect(list.searchParams.get('zeitarbeit')).toBe('false');
    expect(list.searchParams.get('angebotsart')).toBe('1');
    expect(http.calls.every((c) => c.headers['x-api-key'] === 'jobboerse-jobsuche')).toBe(true);
    expect(http.calls).toHaveLength(4);
    expect(items.map((i) => i.externalId)).toEqual([REF, '12345-0001122334-S', '10001-1209876543-S']);
  });

  it('spends the detail budget on unknown refnrs first; the rest are seen-only', async () => {
    const http = new FakeHttp([
      { match: /\/pc\/v6\/jobs\?/, body: jobs },
      { match: /\/pc\/v4\/jobdetails\//, body: detail },
    ]);
    const s = fakeSource('bundesagentur', { queries: [{ was: 'IT Security' }], maxDetails: 1 });
    const items = await bundesagentur.fetch(fetchCtx(s, http, [REF]));
    const byId = new Map(items.map((i) => [i.externalId, i]));
    expect(isSeenOnly(byId.get(REF)!)).toBe(true);
    expect(isSeenOnly(byId.get('12345-0001122334-S')!)).toBe(false);
    expect(isSeenOnly(byId.get('10001-1209876543-S')!)).toBe(true);
    expect(http.calls.filter((c) => c.url.includes('jobdetails'))).toHaveLength(1);
  });

  it('after 3 consecutive detail failures new postings fall back to listing data', async () => {
    const many = { ...jobs, stellenangebote: [0, 1, 2, 3, 4].map((i) => ({ ...jobs.stellenangebote[0], refnr: `R-${i}` })) };
    const http = new FakeHttp([
      { match: /\/pc\/v6\/jobs\?/, body: many },
      { match: /\/pc\/v4\/jobdetails\//, status: 500 },
    ]);
    const ctx = fetchCtx(src, http, ['R-4']);
    const items = await bundesagentur.fetch(ctx);
    expect(http.calls.filter((c) => c.url.includes('jobdetails'))).toHaveLength(3);
    expect(items.filter(isSeenOnly).map((i) => i.externalId)).toEqual(['R-4']);
    expect(items.filter((i) => !isSeenOnly(i))).toHaveLength(4);
    expect(ctx.logs.some((l) => /failing repeatedly/.test(l))).toBe(true);
  });

  it('a daily cap during details aborts the fetch (the pipeline records a skip)', async () => {
    const http = new FakeHttp([
      { match: /\/pc\/v6\/jobs\?/, body: jobs },
      {
        match: /\/pc\/v4\/jobdetails\//,
        body: () => {
          throw new DailyCapError('rest.arbeitsagentur.de', 600);
        },
      },
    ]);
    await expect(bundesagentur.fetch(fetchCtx(src, http))).rejects.toBeInstanceOf(DailyCapError);
  });

  it('parses listing + detail', () => {
    const job = parseBa(raw(REF, { listing: jobs.stellenangebote[0], detail }), 7);
    expect(job.title).toBe('IT Security Engineer (m/w/d)');
    expect(job.companyName).toBe('Beispiel Cloud GmbH');
    expect(job.locationRaw).toBe('Berlin, Deutschland');
    expect(job.descriptionText).toMatch(/DevSecOps-Pipelines/);
    expect(job.salaryHint).toEqual({ raw: '70.000 - 85.000 EUR brutto jährlich' });
    expect(job.employmentType).toBe('VOLLZEIT');
    expect(job.closingAt?.toISOString()).toBe('2026-11-25T00:00:00.000Z');
    expect(job.extra).toMatchObject({ descriptionMissing: false });
  });

  it('without a detail it builds a plain-text description from listing facts and flags it', () => {
    const job = bundesagentur.parse(raw('x', { listing: jobs.stellenangebote[2], detail: null }), { source: src });
    expect(job.title).toMatch(/Full-Stack Entwickler/);
    expect(job.descriptionHtml).toBeNull();
    expect(job.descriptionText).toMatch(/Arbeitgeber: Hanse Digital GmbH/);
    expect(job.applyUrl).toBe(baJobUrl('10001-1209876543-S'));
    expect(job.extra).toMatchObject({ descriptionMissing: true });
  });

  it('an empty result page has no stellenangebote key and is not an error', async () => {
    const http = new FakeHttp([{ match: /\/pc\/v6\/jobs\?/, body: { maxErgebnisse: 0, page: 1, size: 50 } }]);
    expect(await bundesagentur.fetch(fetchCtx(src, http))).toEqual([]);
  });

  it('is incremental and validates queries', () => {
    expect(bundesagentur.listing).toBe('incremental');
    expect(() => bundesagentur.configSchema.parse({ queries: [] })).toThrow();
  });

  it('live v6 listing: pages via ergebnisliste, details by base64(referenznummer) on the v4 detail path', async () => {
    const byB64 = new Map(LIVE_REFS.map((r) => [baDetailId(r), liveDetail(r)]));
    const http = new FakeHttp([
      { match: /\/pc\/v6\/jobs\?/, body: { ...live, maxErgebnisse: live.ergebnisliste.length } },
      {
        match: /\/pc\/v4\/jobdetails\//,
        body: (url: string) => {
          const d = byB64.get(decodeURIComponent(url.split('/').pop() ?? ''));
          if (!d) throw new Error(`no fixture for ${url}`);
          return d;
        },
      },
    ]);
    const s = fakeSource('bundesagentur', { queries: [{ was: 'IT-Sicherheit', wo: 'Berlin', umkreis: 25 }], maxDetails: 3 });
    const items = await bundesagentur.fetch(fetchCtx(s, http));
    const list = new URL(http.calls[0]!.url);
    expect(list.pathname).toBe('/jobboerse/jobsuche-service/pc/v6/jobs');
    expect(list.searchParams.get('wo')).toBe('Berlin');
    expect(list.searchParams.get('umkreis')).toBe('25');
    expect(items.map((i) => i.externalId)).toEqual(live.ergebnisliste.map((o) => o.referenznummer));
    expect(items.filter(isSeenOnly)).toHaveLength(1);
    expect(http.calls.filter((c) => c.url.includes('/pc/v4/jobdetails/'))).toHaveLength(3);
    for (const item of items.filter((i) => !isSeenOnly(i))) {
      const job = bundesagentur.parse(item, { source: s });
      expect(job.descriptionText.length).toBeGreaterThan(500);
      expect(job.countryHint).toBe('DE');
      expect(job.cityHint).toBe('Berlin');
      expect(job.extra).toMatchObject({ descriptionMissing: false });
    }
  });

  it('parses live v6 postings: title, employer, Land names, external apply link, structured salary', () => {
    const [bvg, db, tempton] = live.ergebnisliste;
    const a = parseBa(raw(LIVE_REFS[0]!, { listing: bvg, detail: liveDetail(LIVE_REFS[0]!) }), 7);
    expect(a.title).toMatch(/^Projektmanagerin \/ Projektmanager IT-Sicherheit/);
    expect(a.companyName).toBe('Berliner Verkehrsbetriebe (BVG) - AöR -');
    expect(a.locationRaw).toBe('Berlin, Deutschland');
    expect(a.applyUrl).toMatch(/^https:\/\/www\.heyjobs\.co\//);
    expect(a.postedAt?.toISOString()).toBe('2026-09-28T00:00:00.000Z');
    expect(a.salaryHint).toBeNull();
    expect(a.employmentType).toMatch(/Vollzeit/);

    const b = parseBa(raw(LIVE_REFS[1]!, { listing: db, detail: liveDetail(LIVE_REFS[1]!) }), 7);
    expect(b.companyName).toBe('Deutsche Bahn AG');
    // No external link and a host-only allianzpartnerUrl: the public BA page is the apply link.
    expect(b.applyUrl).toBe(baJobUrl(LIVE_REFS[1]!));

    const c = parseBa(raw(LIVE_REFS[2]!, { listing: tempton, detail: liveDetail(LIVE_REFS[2]!) }), 7);
    expect(c.locationRaw).toBe('München, Bayern, Deutschland; Hamburg, Deutschland; Berlin, Deutschland; Köln, Nordrhein-Westfalen, Deutschland');
    expect(c.cityHint).toBe('Berlin');
    expect(c.salaryHint).toEqual({ min: 45000, max: 60000, currency: 'EUR', period: 'year', raw: undefined });
  });

  it('a v6 posting without its detail still parses from listing facts (flagged)', () => {
    const job = parseBa(raw('x', { listing: live.ergebnisliste[3], detail: null }), 7);
    expect(job.externalId).toBe(live.ergebnisliste[3]!.referenznummer);
    expect(job.companyName).toBe('GWAdriga GmbH & Co. KG');
    expect(job.descriptionText).toMatch(/Arbeitgeber: GWAdriga/);
    expect(job.extra).toMatchObject({ descriptionMissing: true });
    expect(() => parseBa(raw('x', { listing: { stellenangebotsTitel: 'x', firma: 'y' }, detail: null }), 7)).toThrow(/referenznummer/);
  });

  it('reads both listing shapes and bumps the parser version', () => {
    expect(baOffers(live)).toHaveLength(4);
    expect(baOffers(jobs)).toHaveLength(3);
    expect(baOffers({})).toEqual([]);
    expect(BUNDESAGENTUR_VERSION).toBe('bundesagentur@2026-09-30.2');
  });
});
