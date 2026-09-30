import { describe, expect, it } from 'vitest';
import { smartrecruiters } from '../../src/lib/connectors/smartrecruiters';
import { isSeenOnly } from '../../src/lib/connectors/types';
import { DailyCapError } from '../../src/lib/http/polite';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const list = fixtureJson<{ content: Record<string, unknown>[]; totalFound: number }>('smartrecruiters', 'postings-servicenow.json');
const details: Record<string, unknown> = {
  '744000152399499': fixtureJson('smartrecruiters', 'detail-744000152399499.json'),
  '744000152535489': fixtureJson('smartrecruiters', 'detail-744000152535489.json'),
  '744000152587869': fixtureJson('smartrecruiters', 'detail-744000152587869.json'),
};
const LIST_RE = /\/v1\/companies\/ServiceNow\/postings\?/;
const DETAIL_RE = /\/v1\/companies\/ServiceNow\/postings\/(\d+)$/;
const detailRoute = { match: DETAIL_RE, body: (url: string) => details[DETAIL_RE.exec(url)?.[1] ?? ''] };

function src(cfg: Record<string, unknown> = {}) {
  return fakeSource('smartrecruiters', { companyId: 'ServiceNow', ...cfg }, { label: 'ServiceNow' });
}

describe('smartrecruiters connector', () => {
  it('lists, then fetches details for every posting within the cap', async () => {
    const http = new FakeHttp([{ match: LIST_RE, body: list }, detailRoute]);
    const items = await smartrecruiters.fetch(fetchCtx(src(), http));
    expect(http.calls[0]?.url).toContain('limit=100&offset=0');
    expect(items).toHaveLength(3);
    expect(items.every((i) => !isSeenOnly(i))).toBe(true);
    expect(http.calls).toHaveLength(4);
  });

  it('spends the capped detail budget on unknown postings first; the rest are seen-only', async () => {
    const http = new FakeHttp([{ match: LIST_RE, body: list }, detailRoute]);
    const known = ['744000152587869', '744000152535489'];
    const items = await smartrecruiters.fetch(fetchCtx(src({ maxDetails: 1 }), http, known));
    const detailed = items.filter((i) => !isSeenOnly(i)).map((i) => i.externalId);
    expect(detailed).toEqual(['744000152399499']);
    expect(items.filter(isSeenOnly).map((i) => i.externalId).sort()).toEqual([...known].sort());
  });

  it('marks the listing partial when more postings exist than maxItems', async () => {
    const http = new FakeHttp([{ match: LIST_RE, body: { ...list, totalFound: 500 } }, detailRoute]);
    const ctx = fetchCtx(src({ maxItems: 2 }), http);
    const items = await smartrecruiters.fetch(ctx);
    expect(items).toHaveLength(2);
    expect(ctx.partial[0]).toMatch(/500 postings/);
  });

  it('skips postings removed between listing and detail (404), keeps others seen-only on errors', async () => {
    const http = new FakeHttp([
      { match: LIST_RE, body: list },
      { match: /postings\/744000152587869$/, status: 404 },
      { match: /postings\/744000152535489$/, status: 500 },
      detailRoute,
    ]);
    const items = await smartrecruiters.fetch(fetchCtx(src(), http));
    expect(items.map((i) => [i.externalId, isSeenOnly(i)])).toEqual([
      ['744000152535489', true],
      ['744000152399499', false],
    ]);
  });

  it('propagates the daily cap instead of swallowing it', async () => {
    const http = new FakeHttp([{ match: LIST_RE, body: list }]);
    http.getJson = (async (url: string) => {
      if (LIST_RE.test(url)) return structuredClone(list);
      throw new DailyCapError('smartrecruiters', 10);
    }) as FakeHttp['getJson'];
    await expect(smartrecruiters.fetch(fetchCtx(src(), http))).rejects.toBeInstanceOf(DailyCapError);
  });

  it('parses the job ad sections, location and employment type', () => {
    const payload = { posting: list.content[2], detail: details['744000152399499'] };
    const job = smartrecruiters.parse(raw('744000152399499', payload), { source: src() });
    expect(job.title).toBe('Senior Software Engineer, DevOps - Moveworks (DevSecOps)');
    expect(job.companyName).toBe('ServiceNow');
    expect(job.locationRaw).toBe('Bangalore, Karnataka, India');
    expect(job.countryHint).toBe('IN');
    expect(job.cityHint).toBe('Bangalore');
    expect(job.workplaceHint).toBeNull();
    expect(job.employmentType).toBe('Full-time');
    expect(job.applyUrl).toMatch(/^https:\/\/jobs\.smartrecruiters\.com\/ServiceNow\/744000152399499/);
    expect(job.descriptionHtml).toContain('<h3>');
    expect(job.postedAt?.toISOString()).toBe('2026-09-29T12:03:08.632Z');
  });

  it('flags remote postings and rejects inactive ones', () => {
    const remote = smartrecruiters.parse(raw('x', { posting: list.content[0], detail: details['744000152587869'] }), { source: src() });
    expect(remote.workplaceHint).toBe('remote');
    const inactive = { posting: list.content[0], detail: { ...(details['744000152587869'] as object), active: false } };
    expect(() => smartrecruiters.parse(raw('x', inactive), { source: src() })).toThrow(/inactive/);
  });
});
