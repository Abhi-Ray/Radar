import { describe, expect, it } from 'vitest';
import { SourceError } from '../../src/lib/contracts/connectors';
import { extractNavToken, navNo, navWindowStart } from '../../src/lib/connectors/nav_no';
import { isSeenOnly, isSourceClosed } from '../../src/lib/connectors/types';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw, type Route } from './_helpers';

type Rec = Record<string, unknown>;
const page = fixtureJson<{ items: Rec[]; next_url: string }>('nav_no', 'feed-page.json');
const kitchenItem = fixtureJson<Rec>('nav_no', 'feed-item-297f41fe.json');
const kitchenEntry = fixtureJson<Rec>('nav_no', 'entry-297f41fe-6d82-4a74-9c06-1be9135fa77e.json');
const nurseEntry = fixtureJson<Rec>('nav_no', 'entry-3961f849-f41c-40c6-9701-90bcc5509443.json');
// A syntactically valid, meaningless JWT (header.payload.signature) — not a real token.
const FAKE_JWT = 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ0ZXN0In0.c2lnbmF0dXJl';
const src = fakeSource('nav_no', {});

/** The kitchen ad retitled so it passes the relevance filter. */
function relevant(id: string, title = 'IT-sikkerhetsrådgiver'): Rec {
  const fe = kitchenItem._feed_entry as Rec;
  return { ...kitchenItem, id, title, _feed_entry: { ...fe, uuid: id, title } };
}

function routes(feed: unknown, extra: Route[] = []): Route[] {
  return [
    { match: /\/api\/publicToken$/, text: `${FAKE_JWT}\n` },
    ...extra,
    { match: /\/api\/v1\/feedentry\//, body: kitchenEntry },
    { match: /\/api\/v1\/feed(\/|$)/, body: feed },
  ];
}

describe('nav_no connector', () => {
  it('extracts the JWT and rejects a response without one', () => {
    expect(extractNavToken(`Bearer ${FAKE_JWT}`)).toBe(FAKE_JWT);
    expect(() => extractNavToken('<html>maintenance</html>')).toThrow(SourceError);
  });

  it('window start: last success − 2 h, bounded by the look-back', () => {
    const now = new Date('2026-09-30T12:00:00Z');
    expect(navWindowStart(now, 48, null).toISOString()).toBe('2026-09-28T12:00:00.000Z');
    expect(navWindowStart(now, 48, new Date('2026-09-30T06:00:00Z')).toISOString()).toBe('2026-09-30T04:00:00.000Z');
    expect(navWindowStart(now, 48, new Date('2026-09-01T00:00:00Z')).toISOString()).toBe('2026-09-28T12:00:00.000Z');
  });

  it('sends the token only as a header, never in a URL; If-Modified-Since on the first page', async () => {
    const http = new FakeHttp(routes({ ...page, items: [...page.items, relevant('11111111-1111-4111-8111-111111111111')] }));
    await navNo.fetch(fetchCtx(src, http));
    expect(http.calls.every((c) => !c.url.includes(FAKE_JWT))).toBe(true);
    const feed = http.calls.find((c) => /\/api\/v1\/feed$/.test(c.url))!;
    expect(feed.headers.authorization).toBe(`Bearer ${FAKE_JWT}`);
    expect(feed.headers['if-modified-since']).toMatch(/GMT$/);
    const entry = http.calls.find((c) => c.url.includes('/feedentry/'))!;
    expect(entry.headers.authorization).toBe(`Bearer ${FAKE_JWT}`);
  });

  it('INACTIVE → closed marker; irrelevant → no detail request, left for the pre-filter to count', async () => {
    const http = new FakeHttp(routes(page));
    const items = await navNo.fetch(fetchCtx(src, http));
    expect(http.calls.filter((c) => c.url.includes('/feedentry/'))).toHaveLength(0);
    const byId = new Map(items.map((i) => [i.externalId, i]));
    expect(isSourceClosed(byId.get('afc8cb8b-7409-41dd-b3ca-4a438a732cd4')!)).toBe(true);
    const nurse = byId.get('3961f849-f41c-40c6-9701-90bcc5509443')!;
    expect((nurse.payload as Rec).detail).toBeNull();
    // "Sikkerhetspost" is a psychiatric ward, not IT security.
    expect(navNo.prefilter!(nurse, navNo.configSchema.parse({})).keep).toBe(false);
    expect(items).toHaveLength(4);
  });

  it('dedupes repeated feed entries (latest wins) and caps details, new ids first', async () => {
    const a = '22222222-2222-4222-8222-222222222222';
    const b = '33333333-3333-4333-8333-333333333333';
    const feed = { ...page, items: [relevant(a, 'Security Engineer'), relevant(b), relevant(a, 'Senior Security Engineer')] };
    const http = new FakeHttp(routes(feed));
    const s = fakeSource('nav_no', { maxDetails: 1 });
    const items = await navNo.fetch(fetchCtx(s, http, [a]));
    expect(items).toHaveLength(2);
    const detailCalls = http.calls.filter((c) => c.url.includes('/feedentry/'));
    expect(detailCalls.map((c) => c.url.split('/').pop())).toEqual([b]);
    const itemA = items.find((i) => i.externalId === a)!;
    expect(isSeenOnly(itemA)).toBe(true);
    expect(JSON.stringify(itemA.payload)).toContain('Senior Security Engineer');
  });

  it('follows only well-formed next_url paths and stops at a short page', async () => {
    const full = { ...page, items: Array.from({ length: 1000 }, (_, i) => ({ ...page.items[2], id: `aaaaaaaa-aaaa-4aaa-8aaa-${String(i).padStart(12, '0')}` })) };
    let n = 0;
    const paged = () => ({ ...full, next_url: `/api/v1/feed/bbbbbbbb-bbbb-4bbb-8bbb-${String(++n).padStart(12, '0')}` });
    const http = new FakeHttp(routes(paged));
    const s = fakeSource('nav_no', { maxPages: 2 });
    const ctx = fetchCtx(s, http);
    await navNo.fetch(ctx);
    const feedCalls = http.calls.filter((c) => /\/api\/v1\/feed(\/|$)/.test(c.url));
    expect(feedCalls).toHaveLength(2);
    expect(feedCalls[1]!.url).toBe('https://pam-stilling-feed.nav.no/api/v1/feed/bbbbbbbb-bbbb-4bbb-8bbb-000000000001');
    expect(ctx.partial).toHaveLength(1);

    const evil = new FakeHttp(routes({ ...full, next_url: 'https://evil.example/api/v1/feed/x' }));
    await navNo.fetch(fetchCtx(s, evil));
    expect(evil.calls.filter((c) => c.url.includes('evil'))).toHaveLength(0);
  });

  it('401 on the feed means the token rotated', async () => {
    const http = new FakeHttp([{ match: /publicToken/, text: FAKE_JWT }, { match: /\/api\/v1\/feed/, status: 401 }]);
    await expect(navNo.fetch(fetchCtx(src, http))).rejects.toThrow(/token rejected/);
  });

  it('a detail that reports INACTIVE closes the posting; 404 is skipped', async () => {
    const id = '44444444-4444-4444-8444-444444444444';
    const gone = '55555555-5555-4555-8555-555555555555';
    const http = new FakeHttp(
      routes({ ...page, items: [relevant(id), relevant(gone)] }, [
        { match: new RegExp(`/feedentry/${id}$`), body: { ...kitchenEntry, status: 'INACTIVE' } },
        { match: new RegExp(`/feedentry/${gone}$`), status: 404 },
      ]),
    );
    const items = await navNo.fetch(fetchCtx(src, http));
    expect(items.map((i) => [i.externalId, isSourceClosed(i)])).toEqual([[id, true]]);
  });

  it('parses the live entries', () => {
    const k = navNo.parse(raw('x', { feedEntry: kitchenItem, detail: kitchenEntry }), { source: src });
    expect(k.externalId).toBe('297f41fe-6d82-4a74-9c06-1be9135fa77e');
    expect(k.title).toBe('Kitchen Staff Needed');
    expect(k.companyName).toBe('Momo Chhe As');
    expect(k.locationRaw).toBe('Oslo, Norge');
    expect(k.cityHint).toBe('Oslo');
    expect(k.closingAt?.toISOString()).toBe('2026-10-20T22:00:00.000Z'); // 'Snarest' → falls back to expires
    expect(k.applyUrl).toBe('https://arbeidsplassen.nav.no/stillinger/stilling/297f41fe-6d82-4a74-9c06-1be9135fa77e');
    expect(k.employmentType).toBe('Fast, Heltid');
    expect(k.extra).toMatchObject({ applicationDueRaw: 'Snarest' });
    const n = navNo.parse(raw('x', { feedEntry: page.items[0], detail: nurseEntry }), { source: src });
    expect(n.applyUrl).toMatch(/^https:\/\/candidate\.webcruiter\.com\//);
    expect(n.closingAt?.toISOString()).toBe('2026-10-25T00:00:00.000Z');
    expect(() => navNo.parse(raw('x', { feedEntry: kitchenItem, detail: null }), { source: src })).toThrow(/without detail/);
  });
});
