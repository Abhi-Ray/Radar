import { describe, expect, it } from 'vitest';
import { recruitee } from '../../src/lib/connectors/recruitee';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const offers = fixtureJson<{ offers: Record<string, unknown>[] }>('recruitee', 'offers-bunq.json');
const src = fakeSource('recruitee', { slug: 'bunq' });

describe('recruitee connector', () => {
  it('fetches the tenant sub-domain offers endpoint', async () => {
    const http = new FakeHttp([{ match: /^https:\/\/bunq\.recruitee\.com\/api\/offers\/$/, body: offers }]);
    const items = await recruitee.fetch(fetchCtx(src, http));
    expect(items.map((i) => i.externalId)).toEqual(['2763710', '2763695', '2760348', '2760260']);
  });

  it('parses description + requirements, hybrid flag and "UTC" timestamps', () => {
    const job = recruitee.parse(raw('2763710', offers.offers[0]), { source: src });
    expect(job.title).toBe('iOS Developer');
    expect(job.companyName).toBe('bunq');
    expect(job.locationRaw).toBe('Amsterdam, Noord-Holland, Netherlands');
    expect(job.countryHint).toBe('NL');
    expect(job.workplaceHint).toBe('hybrid');
    expect(job.applyUrl).toBe('https://careers.bunq.com/o/ios-developer-3');
    expect(job.postedAt?.toISOString()).toBe('2026-09-29T16:02:37.000Z');
    expect(job.salaryHint).toBeNull();
  });

  it('reads salary when present and rejects unpublished offers', () => {
    const paid = { ...offers.offers[1], salary: { min: '5000', max: '7000', currency: 'EUR', period: 'month' } };
    expect(recruitee.parse(raw('x', paid), { source: src }).salaryHint).toMatchObject({ min: 5000, max: 7000, currency: 'EUR', period: 'month' });
    expect(() => recruitee.parse(raw('x', { ...offers.offers[1], status: 'closed' }), { source: src })).toThrow(/status closed/);
  });

  it('only accepts DNS-label slugs', async () => {
    await expect(recruitee.fetch(fetchCtx(fakeSource('recruitee', { slug: 'evil.com/x' }), new FakeHttp([])))).rejects.toThrow(/invalid config/);
  });
});
