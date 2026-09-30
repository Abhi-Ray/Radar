import { describe, expect, it } from 'vitest';
import { SourceError } from '../../src/lib/contracts/connectors';
import { greenhouse, GREENHOUSE_VERSION } from '../../src/lib/connectors/greenhouse';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const board = fixtureJson<{ jobs: unknown[] }>('greenhouse', 'board-gitlab.json');
const src = fakeSource('greenhouse', { board: 'gitlab' });

describe('greenhouse connector', () => {
  it('fetches one board with content=true and keys items by job id', async () => {
    const http = new FakeHttp([{ match: /boards-api\.greenhouse\.io\/v1\/boards\/gitlab\/jobs\?content=true$/, body: board }]);
    const items = await greenhouse.fetch(fetchCtx(src, http));
    expect(http.calls).toHaveLength(1);
    expect(items.map((i) => i.externalId)).toEqual(['8697493002', '8628447002', '8615319002', '8773546002']);
    expect(items[0]?.url).toBe('https://job-boards.greenhouse.io/gitlab/jobs/8697493002');
  });

  it('parses real postings: unescapes content, keeps location string, first_published date', () => {
    const job = greenhouse.parse(raw('8628447002', board.jobs[1]), { source: src });
    expect(job.title).toContain('Senior Security Engineer');
    expect(job.companyName).toBe('GitLab');
    expect(job.locationRaw).toBe('Remote, Israel; Remote, Poland; Remote, United Kingdom');
    expect(job.descriptionHtml).toMatch(/^<div/);
    expect(job.descriptionText).not.toMatch(/&lt;|<div/);
    expect(job.descriptionText.length).toBeGreaterThan(500);
    expect(job.postedAt?.toISOString()).toBe('2026-07-10T20:02:45.000Z');
    expect(job.applyUrl).toBe('https://job-boards.greenhouse.io/gitlab/jobs/8628447002');
    expect(job.salaryHint).toBeNull();
  });

  it('turns pay_input_ranges (cents) into a yearly salary hint', () => {
    const detail = fixtureJson('greenhouse', 'job-with-pay-ranges.json');
    const job = greenhouse.parse(raw('8770747002', detail), { source: src });
    expect(job.salaryHint).toMatchObject({ min: 139200, max: 196000, currency: 'USD', period: 'year' });
  });

  it('config overrides the company name and domain', () => {
    const s = fakeSource('greenhouse', { board: 'gitlab', companyName: 'GitLab Inc.', companyDomain: 'GitLab.com' });
    const job = greenhouse.parse(raw('x', board.jobs[0]), { source: s });
    expect(job.companyName).toBe('GitLab Inc.');
    expect(job.companyDomain).toBe('gitlab.com');
  });

  it('dead-letters records without content or id', () => {
    const j = { ...(board.jobs[0] as Record<string, unknown>), content: '' };
    expect(() => greenhouse.parse(raw('x', j), { source: src })).toThrow(/empty description/);
    expect(() => greenhouse.parse(raw('x', { title: 'x' }), { source: src })).toThrow(/missing id/);
  });

  it('maps a 404 board to a SourceError and rejects a changed response shape', async () => {
    await expect(greenhouse.fetch(fetchCtx(src, new FakeHttp([{ match: /./, status: 404 }])))).rejects.toThrow(/not found/);
    await expect(greenhouse.fetch(fetchCtx(src, new FakeHttp([{ match: /./, body: { data: [] } }])))).rejects.toBeInstanceOf(SourceError);
  });

  it('validates config (slug cannot reshape the URL) and derives a stable key', async () => {
    await expect(greenhouse.fetch(fetchCtx(fakeSource('greenhouse', { board: '../x' }), new FakeHttp([])))).rejects.toThrow(/invalid config/);
    expect(greenhouse.sourceKeyFor(greenhouse.configSchema.parse({ board: 'GitLab' }))).toBe('greenhouse:gitlab');
    expect(greenhouse.version).toBe(GREENHOUSE_VERSION);
    expect(greenhouse.listing).toBe('full');
  });
});
