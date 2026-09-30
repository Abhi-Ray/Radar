import { describe, expect, it } from 'vitest';
import { lever } from '../../src/lib/connectors/lever';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const postings = fixtureJson<Record<string, unknown>[]>('lever', 'postings-palantir.json');
const src = fakeSource('lever', { company: 'palantir' }, { label: 'Palantir' });

describe('lever connector', () => {
  it('uses the global host by default and the EU host when configured', async () => {
    const http = new FakeHttp([{ match: /^https:\/\/api\.lever\.co\/v0\/postings\/palantir\?mode=json$/, body: postings }]);
    const items = await lever.fetch(fetchCtx(src, http));
    expect(items).toHaveLength(4);
    expect(items[0]?.externalId).toBe('c44510a1-9537-4c52-ae81-51546979fe47');

    const eu = new FakeHttp([{ match: /^https:\/\/api\.eu\.lever\.co\/v0\/postings\/acme\?mode=json$/, body: [] }]);
    await lever.fetch(fetchCtx(fakeSource('lever', { company: 'acme', region: 'eu' }), eu));
    expect(eu.calls).toHaveLength(1);
    expect(lever.sourceKeyFor(lever.configSchema.parse({ company: 'acme', region: 'eu' }))).toBe('lever:eu:acme');
  });

  it('parses a real posting with lists, workplace type, country and ms epoch', () => {
    const job = lever.parse(raw('1124402c-2088-40c6-b6aa-b9ef7777519b', postings[1]), { source: src });
    expect(job.title).toBe('Information Security Engineer');
    expect(job.companyName).toBe('Palantir');
    expect(job.locationRaw).toBe('Seattle, WA');
    expect(job.countryHint).toBe('US');
    expect(job.workplaceHint).toBe('hybrid');
    expect(job.employmentType).toBe('Full-time');
    expect(job.postedAt?.getTime()).toBe(1738187468756);
    expect(job.applyUrl).toBe('https://jobs.lever.co/palantir/1124402c-2088-40c6-b6aa-b9ef7777519b');
    expect(job.descriptionText.length).toBeGreaterThan(300);
    expect(job.extra?.team).toBe('Information Security');
  });

  it('maps salaryRange intervals when present', () => {
    const p = { ...postings[0], salaryRange: { min: 60000, max: 80000, currency: 'GBP', interval: 'per-year-salary' } };
    expect(lever.parse(raw('x', p), { source: src }).salaryHint).toMatchObject({ min: 60000, max: 80000, currency: 'GBP', period: 'year' });
  });

  it('rejects non-array responses and dead-letters empty postings', async () => {
    await expect(lever.fetch(fetchCtx(src, new FakeHttp([{ match: /./, body: { ok: false } }])))).rejects.toThrow(/not an array/);
    await expect(lever.fetch(fetchCtx(src, new FakeHttp([{ match: /./, status: 404 }])))).rejects.toThrow(/not found/);
    expect(() => lever.parse(raw('x', { id: 'x', text: 'T', hostedUrl: 'https://jobs.lever.co/x' }), { source: src })).toThrow(/empty description/);
  });
});
