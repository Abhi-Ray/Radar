import { describe, expect, it } from 'vitest';
import { baDetailId, baJobUrl, bundesagentur, parseBa } from '../../src/lib/connectors/bundesagentur';
import { isSeenOnly } from '../../src/lib/connectors/types';
import { DailyCapError } from '../../src/lib/http/polite';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

// Documented-shape samples (the live API answered 403 from this network; see the fixture _note).
const jobs = fixtureJson<{ stellenangebote: Record<string, unknown>[] }>('bundesagentur', 'documented-shape-jobs.json');
const detail = fixtureJson<Record<string, unknown>>('bundesagentur', 'documented-shape-jobdetails.json');
const src = fakeSource('bundesagentur', { queries: [{ was: 'IT Security' }] });
const REF = '10000-1201234567-S';

describe('bundesagentur connector', () => {
  it('base64-encodes the refnr for the detail path and builds the public job URL', () => {
    expect(baDetailId(REF)).toBe(Buffer.from(REF).toString('base64'));
    expect(baJobUrl(REF)).toBe(`https://www.arbeitsagentur.de/jobsuche/jobdetail/${REF}`);
  });

  it('lists with the public API key header, excludes temp agencies and fetches details', async () => {
    const http = new FakeHttp([
      { match: /\/pc\/v4\/jobs\?/, body: jobs },
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
      { match: /\/pc\/v4\/jobs\?/, body: jobs },
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
      { match: /\/pc\/v4\/jobs\?/, body: many },
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
      { match: /\/pc\/v4\/jobs\?/, body: jobs },
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
    const http = new FakeHttp([{ match: /\/pc\/v4\/jobs\?/, body: { maxErgebnisse: 0, page: 1, size: 50 } }]);
    expect(await bundesagentur.fetch(fetchCtx(src, http))).toEqual([]);
  });

  it('is incremental and validates queries', () => {
    expect(bundesagentur.listing).toBe('incremental');
    expect(() => bundesagentur.configSchema.parse({ queries: [] })).toThrow();
  });
});
