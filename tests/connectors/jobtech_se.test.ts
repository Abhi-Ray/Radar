import { describe, expect, it } from 'vitest';
import { jobtechSe } from '../../src/lib/connectors/jobtech_se';
import { isSourceClosed } from '../../src/lib/connectors/types';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const body = fixtureJson<{ total: { value: number }; hits: Record<string, unknown>[] }>('jobtech_se', 'search-security.json');
const src = fakeSource('jobtech_se', { queries: ['security engineer', 'IT-säkerhet'], maxPages: 1 });

describe('jobtech_se connector', () => {
  it('searches each query with published-after and dedupes ids across queries', async () => {
    const http = new FakeHttp([{ match: /^https:\/\/jobsearch\.api\.jobtechdev\.se\/search\?/, body: { ...body, total: { value: 3 } } }]);
    const items = await jobtechSe.fetch(fetchCtx(src, http));
    expect(http.calls).toHaveLength(2);
    const qs = new URL(http.calls[1]!.url).searchParams;
    expect(qs.get('q')).toBe('IT-säkerhet');
    expect(qs.get('published-after')).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(qs.get('offset')).toBe('0');
    expect(items.map((i) => i.externalId)).toEqual(['31533439', '31520004', '31448696']);
  });

  it('marks the listing partial when maxPages leaves hits unread', async () => {
    const full = { total: { value: 658 }, hits: Array.from({ length: 10 }, (_, i) => ({ ...body.hits[0], id: `X${i}` })) };
    const ctx = fetchCtx(fakeSource('jobtech_se', { queries: ['security'], maxPages: 1, limit: 10 }), new FakeHttp([{ match: /./, body: full }]));
    await jobtechSe.fetch(ctx);
    expect(ctx.partial).toHaveLength(1);
    expect(ctx.partial[0]).toMatch(/658 hits/);
  });

  it('removed ads become source-closed markers', async () => {
    const withRemoved = { total: { value: 1 }, hits: [{ ...body.hits[1], removed: true }] };
    const items = await jobtechSe.fetch(fetchCtx(src, new FakeHttp([{ match: /./, body: withRemoved }])));
    expect(items).toHaveLength(1);
    expect(isSourceClosed(items[0]!)).toBe(true);
  });

  it('parses a real ad with an external application URL', () => {
    const job = jobtechSe.parse(raw('x', body.hits[2]), { source: src });
    expect(job.title).toBe('Senior Security Engineer - Network Security');
    expect(job.companyName).toBe('H & M Hennes & Mauritz GBC AB');
    expect(job.applyUrl).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/HMGroup\//);
    expect(job.locationRaw).toBe('Stockholm, Stockholms län, Sverige');
    expect(job.cityHint).toBe('Stockholm');
    expect(job.postedAt?.toISOString()).toBe('2026-09-08T08:04:30.000Z');
    expect(job.closingAt?.toISOString()).toBe('2026-10-08T23:59:59.000Z');
    expect(job.employmentType).toBe('Tillsvidareanställning (inkl. eventuell provanställning)');
    expect(job.extra).toMatchObject({ occupation: 'IT-säkerhetsansvarig' });
  });

  it('email-only applications fall back to the Platsbanken page', () => {
    const job = jobtechSe.parse(raw('x', body.hits[0]), { source: src });
    expect(job.applyUrl).toBe('https://arbetsformedlingen.se/platsbanken/annonser/31533439');
    expect(job.descriptionText.length).toBeGreaterThan(100);
  });

  it('pre-filter is off by default (queries are already targeted) and can be enabled', () => {
    const off = jobtechSe.configSchema.parse({});
    expect(jobtechSe.prefilter!(raw('x', body.hits[0]), off)).toEqual({ keep: true, reason: 'prefilter_disabled' });
    const on = jobtechSe.configSchema.parse({ prefilter: true });
    expect(jobtechSe.prefilter!(raw('x', body.hits[0]), on).keep).toBe(true);
    expect(jobtechSe.prefilter!(raw('x', { headline: 'Undersköterska', occupation: { label: 'Undersköterska' } }), on).keep).toBe(false);
  });
});
