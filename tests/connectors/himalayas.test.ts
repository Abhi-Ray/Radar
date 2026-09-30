import { describe, expect, it } from 'vitest';
import { himalayas, himalayasId } from '../../src/lib/connectors/himalayas';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const body = fixtureJson<{ nextCursor: string; jobs: Record<string, unknown>[] }>('himalayas', 'jobs.json');
const src = fakeSource('himalayas', { maxPages: 2 });
const cfg = himalayas.configSchema.parse({});

describe('himalayas connector', () => {
  it('follows nextCursor up to maxPages', async () => {
    const http = new FakeHttp([{ match: /himalayas\.app\/jobs\/api\?limit=20/, body }]);
    const items = await himalayas.fetch(fetchCtx(src, http));
    expect(http.calls).toHaveLength(2);
    expect(http.calls[0]?.url).not.toMatch(/cursor=/);
    expect(new URL(http.calls[1]!.url).searchParams.get('cursor')).toBe(body.nextCursor);
    expect(items).toHaveLength(5);
    expect(items[0]?.externalId).toBe('/companies/bjak/jobs/cloud-infrastructure-security-engineer');
  });

  it('stops without a cursor', async () => {
    const http = new FakeHttp([{ match: /./, body: { ...body, nextCursor: null } }]);
    await himalayas.fetch(fetchCtx(src, http));
    expect(http.calls).toHaveLength(1);
  });

  it('himalayasId is the guid path', () => {
    expect(himalayasId({ guid: 'https://himalayas.app/companies/x/jobs/y?utm=1' })).toBe('/companies/x/jobs/y');
    expect(himalayasId({})).toBeNull();
  });

  it('parses restrictions, expiry and an hourly salary', () => {
    const a = himalayas.parse(raw('x', body.jobs[2]), { source: src });
    expect(a.locationRaw).toBe('Remote (Netherlands)');
    expect(a.countryHint).toBe('Netherlands');
    expect(a.closingAt?.toISOString()).toBe(new Date(1795918289 * 1000).toISOString());
    const b = himalayas.parse(raw('x', body.jobs[3]), { source: src });
    expect(b.salaryHint).toMatchObject({ min: 100, max: 100, currency: 'USD', period: 'hour' });
    const c = himalayas.parse(raw('x', body.jobs[0]), { source: src });
    expect(c.locationRaw).toBe('Remote (Worldwide)');
    expect(c.salaryHint).toBeNull();
    expect(c.descriptionText.length).toBeGreaterThan(100);
  });

  it('pre-filter reads the category slugs', () => {
    expect(himalayas.prefilter!(raw('x', body.jobs[1]), cfg).keep).toBe(true);
    expect(himalayas.prefilter!(raw('x', body.jobs[4]), cfg).keep).toBe(false);
  });
});
