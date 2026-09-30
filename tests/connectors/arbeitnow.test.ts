import { describe, expect, it } from 'vitest';
import { SourceError } from '../../src/lib/contracts/connectors';
import { arbeitnow, ARBEITNOW_VERSION } from '../../src/lib/connectors/arbeitnow';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const page = fixtureJson<{ data: Record<string, unknown>[]; links: Record<string, unknown> }>('arbeitnow', 'page-1.json');
const src = fakeSource('arbeitnow', {});
const cfg = arbeitnow.configSchema.parse({});

describe('arbeitnow connector', () => {
  it('stops when links.next is null and keys items by slug', async () => {
    const http = new FakeHttp([{ match: /arbeitnow\.com\/api\/job-board-api\?page=1$/, body: page }]);
    const items = await arbeitnow.fetch(fetchCtx(src, http));
    expect(http.calls).toHaveLength(1);
    expect(items).toHaveLength(5);
    expect(items[0]?.externalId).toBe('security-engineer-ii-mapbox-germany-257943');
  });

  it('follows links.next up to maxPages and dedupes slugs across pages', async () => {
    const withNext = { ...page, links: { ...page.links, next: 'https://www.arbeitnow.com/api/job-board-api?page=2' } };
    const http = new FakeHttp([
      { match: /page=1$/, body: withNext },
      { match: /page=2$/, body: withNext },
    ]);
    const items = await arbeitnow.fetch(fetchCtx(fakeSource('arbeitnow', { maxPages: 2 }), http));
    expect(http.calls.map((c) => c.url.slice(-6))).toEqual(['page=1', 'page=2']);
    expect(items).toHaveLength(5);
  });

  it('parses a remote posting and marks the location', () => {
    const job = arbeitnow.parse(raw('x', page.data[3]), { source: src });
    expect(job.externalId).toBe('remote-senior-software-engineer-quality-67277');
    expect(job.companyName).toBe('Camunda');
    expect(job.locationRaw).toBe('Remote');
    expect(job.workplaceHint).toBe('remote');
    expect(job.postedAt?.toISOString()).toBe(new Date(1790736013 * 1000).toISOString());
    expect(job.descriptionText.length).toBeGreaterThan(100);
    expect(job.extra).toMatchObject({ attribution: 'Arbeitnow' });
  });

  it('keeps on-site city strings and appends (Remote) only for remote ads', () => {
    const job = arbeitnow.parse(raw('x', page.data[2]), { source: src });
    expect(job.locationRaw).toBe('Köln');
    expect(job.workplaceHint).toBeNull();
    const remoteCity = arbeitnow.parse(raw('x', { ...page.data[1], remote: true }), { source: src });
    expect(remoteCity.locationRaw).toBe('Hamburg (Remote)');
  });

  it('pre-filters on title + tags', () => {
    const d = (i: number) => arbeitnow.prefilter!(raw('x', page.data[i]), cfg);
    expect(d(0)).toEqual({ keep: true, reason: 'security' });
    expect(d(2)).toEqual({ keep: true, reason: 'security' }); // DevOps → cloud/platform track
    expect(d(4).keep).toBe(false); // plain "Software Engineer" on an e-commerce portal
    expect(arbeitnow.prefilter!(raw('x', page.data[4]), arbeitnow.configSchema.parse({ prefilter: false })).keep).toBe(true);
  });

  it('rejects a changed response shape and records without a description', async () => {
    await expect(arbeitnow.fetch(fetchCtx(src, new FakeHttp([{ match: /./, body: { jobs: [] } }])))).rejects.toBeInstanceOf(SourceError);
    expect(() => arbeitnow.parse(raw('x', { ...page.data[0], description: '' }), { source: src })).toThrow(/empty description/);
    expect(arbeitnow.version).toBe(ARBEITNOW_VERSION);
    expect(arbeitnow.sourceKeyFor(cfg)).toBe('arbeitnow:all');
  });
});
