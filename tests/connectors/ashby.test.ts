import { describe, expect, it } from 'vitest';
import { ashby } from '../../src/lib/connectors/ashby';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const board = fixtureJson<{ jobs: Record<string, unknown>[] }>('ashby', 'job-board-ramp.json');
const src = fakeSource('ashby', { org: 'ramp' }, { label: 'Ramp' });

describe('ashby connector', () => {
  it('requests compensation and returns every job', async () => {
    const http = new FakeHttp([{ match: /^https:\/\/api\.ashbyhq\.com\/posting-api\/job-board\/ramp\?includeCompensation=true$/, body: board }]);
    const items = await ashby.fetch(fetchCtx(src, http));
    expect(items).toHaveLength(5);
    expect(items[0]?.externalId).toBe('34413f8d-26bf-4bbc-8ade-eb309a0e2245');
  });

  it('parses title (trimmed), secondary locations, workplace and salary component', () => {
    const job = ashby.parse(raw('34413f8d-26bf-4bbc-8ade-eb309a0e2245', board.jobs[0]), { source: src });
    expect(job.title).toBe('Security Engineer, Cloud');
    expect(job.locationRaw).toBe('New York, NY (HQ); Remote (Canada); Remote (US); Miami, FL');
    expect(job.workplaceHint).toBe('hybrid');
    expect(job.salaryHint).toMatchObject({ min: 211400, max: 290600, currency: 'USD', period: 'year' });
    expect(job.applyUrl).toBe('https://jobs.ashbyhq.com/ramp/34413f8d-26bf-4bbc-8ade-eb309a0e2245');
    expect(job.postedAt?.toISOString()).toBe('2026-04-07T17:12:35.753Z');
  });

  it('handles on-site jobs and salaries in other currencies', () => {
    const onsite = ashby.parse(raw('x', board.jobs[1]), { source: src });
    expect(onsite.workplaceHint).toBe('onsite');
    expect(onsite.salaryHint).toBeNull();
    const cad = ashby.parse(raw('x', board.jobs[2]), { source: src });
    expect(cad.salaryHint).toMatchObject({ min: 166600, max: 182000, currency: 'CAD' });
    const remote = ashby.parse(raw('x', board.jobs[3]), { source: src });
    expect(remote.workplaceHint).toBe('remote');
  });

  it('fails the source on a 404 org or missing jobs array', async () => {
    await expect(ashby.fetch(fetchCtx(src, new FakeHttp([{ match: /./, status: 404 }])))).rejects.toThrow(/not found/);
    await expect(ashby.fetch(fetchCtx(src, new FakeHttp([{ match: /./, body: {} }])))).rejects.toThrow(/jobs/);
  });
});
