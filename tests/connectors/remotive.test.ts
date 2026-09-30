import { describe, expect, it } from 'vitest';
import { remotive } from '../../src/lib/connectors/remotive';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const body = fixtureJson<{ jobs: Record<string, unknown>[] }>('remotive', 'remote-jobs.json');
const src = fakeSource('remotive', {});
const cfg = remotive.configSchema.parse({});

describe('remotive connector', () => {
  it('requests each configured category once and dedupes ids across them', async () => {
    const http = new FakeHttp([{ match: /remotive\.com\/api\/remote-jobs\?category=(software-dev|devops)$/, body }]);
    const items = await remotive.fetch(fetchCtx(src, http));
    expect(http.calls.map((c) => c.url.split('=')[1])).toEqual(['software-dev', 'devops']);
    expect(items.map((i) => i.externalId)).toEqual(['2091131', '2091130', '1919266', '2091144']);
  });

  it('parses: remote location with the candidate region, raw salary, mapped job type', () => {
    const job = remotive.parse(raw('x', body.jobs[2]), { source: src });
    expect(job.externalId).toBe('1919266');
    expect(job.companyName).toBe('A.Team');
    expect(job.locationRaw).toBe('Remote (Americas, Europe, Israel)');
    expect(job.workplaceHint).toBe('remote');
    expect(job.salaryHint).toEqual({ raw: '$120 - $170 /hour' });
    expect(job.employmentType).toMatch(/contract/i);
    expect(job.postedAt?.toISOString()).toBe('2026-09-16T10:10:53.000Z');
    expect(job.applyUrl).toMatch(/^https:\/\/remotive\.com\//);
    expect(job.extra).toMatchObject({ attribution: 'Remotive' });
  });

  it('empty salary string → no salary hint', () => {
    expect(remotive.parse(raw('x', body.jobs[0]), { source: src }).salaryHint).toBeNull();
  });

  it('pre-filter keeps full-stack and drops unrelated roles', () => {
    expect(remotive.prefilter!(raw('x', body.jobs[1]), cfg).keep).toBe(true); // full-stack title (tags also list cloud)
    expect(remotive.prefilter!(raw('x', { ...body.jobs[1], tags: [] }), cfg)).toEqual({ keep: true, reason: 'fullstack' });
    expect(remotive.prefilter!(raw('x', body.jobs[3]), cfg).keep).toBe(false);
  });

  it('is a full listing within the terms (≤ 2 categories, 4 requests/day)', () => {
    expect(remotive.listing).toBe('full');
    expect(remotive.platform.dailyCap).toBe(4);
    expect(() => remotive.configSchema.parse({ categories: ['software-dev', 'devops', 'data'] })).toThrow();
    expect(remotive.sourceKeyFor(cfg)).toBe('remotive:devops+software-dev');
  });
});
