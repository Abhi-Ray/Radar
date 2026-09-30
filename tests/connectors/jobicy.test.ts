import { describe, expect, it } from 'vitest';
import { SourceError } from '../../src/lib/contracts/connectors';
import { jobicy } from '../../src/lib/connectors/jobicy';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const body = fixtureJson<{ jobs: Record<string, unknown>[] }>('jobicy', 'remote-jobs-security.json');
const src = fakeSource('jobicy', {});

describe('jobicy connector', () => {
  it('queries each tag, dedupes ids and tolerates the no-match response', async () => {
    const http = new FakeHttp([
      { match: /tag=security/, body },
      { match: /tag=devops/, body: { success: false, jobCount: 0 } },
    ]);
    const items = await jobicy.fetch(fetchCtx(src, http));
    expect(http.calls.map((c) => new URL(c.url).searchParams.get('tag'))).toEqual(['security', 'devops']);
    expect(items.map((i) => i.externalId)).toEqual(['154209', '154158', '154125']);
    await expect(jobicy.fetch(fetchCtx(src, new FakeHttp([{ match: /./, body: { data: 1 } }])))).rejects.toBeInstanceOf(SourceError);
  });

  it('adds geo when configured', async () => {
    const http = new FakeHttp([{ match: /./, body }]);
    await jobicy.fetch(fetchCtx(fakeSource('jobicy', { tags: ['security'], geo: 'europe' }), http));
    expect(new URL(http.calls[0]!.url).searchParams.get('geo')).toBe('europe');
  });

  it('parses salary, period and geo', () => {
    const a = jobicy.parse(raw('x', body.jobs[0]), { source: src });
    expect(a.salaryHint).toMatchObject({ min: 172279, max: 249640, currency: 'USD', period: 'year' });
    expect(a.locationRaw).toBe('Remote (Canada, USA)');
    expect(a.employmentType).toBe('Full-Time');
    expect(a.companyName).toBe('Quora');
    expect(a.postedAt?.toISOString()).toBe('2026-09-29T15:31:05.000Z');
    const b = jobicy.parse(raw('x', body.jobs[1]), { source: src });
    expect(b.salaryHint).toMatchObject({ currency: 'EUR' });
    expect(b.locationRaw).toBe('Remote (Europe)');
    expect(jobicy.parse(raw('x', body.jobs[2]), { source: src }).salaryHint).toBeNull();
  });

  it('config key is stable and tag-order independent', () => {
    const k1 = jobicy.sourceKeyFor(jobicy.configSchema.parse({ tags: ['devops', 'security'] }));
    const k2 = jobicy.sourceKeyFor(jobicy.configSchema.parse({ tags: ['Security', 'devops'] }));
    expect(k1).toBe(k2);
    expect(() => jobicy.configSchema.parse({ tags: ['a&b=c'] })).toThrow();
  });
});
