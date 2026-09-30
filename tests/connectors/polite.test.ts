import { describe, expect, it } from 'vitest';
import { BOT_USER_AGENT } from '../../src/lib/contracts/connectors';
import {
  backoffMs,
  DailyCapError,
  HttpNetworkError,
  HttpStatusError,
  parseRetryAfter,
  PoliteHttpPool,
  safeUrlForLog,
  TokenBucket,
  type PoliteHttpDeps,
} from '../../src/lib/http/polite';
import { SafeFetchError, type SafeFetchResponse } from '../../src/lib/security/safe-fetch';

interface Harness {
  pool: PoliteHttpPool;
  fetchCalls: { url: string; init?: RequestInit }[];
  safeCalls: string[];
  sleeps: number[];
  clock: { t: number };
}

function harness(
  responder: (url: string, n: number) => Response | Promise<Response>,
  opts: { safe?: (url: string) => SafeFetchResponse | Promise<SafeFetchResponse>; usage?: Record<string, number>; deps?: PoliteHttpDeps } = {},
): Harness {
  const clock = { t: Date.parse('2026-09-30T00:00:00Z') };
  const fetchCalls: Harness['fetchCalls'] = [];
  const safeCalls: string[] = [];
  const sleeps: number[] = [];
  const pool = new PoliteHttpPool(
    {
      fetch: async (url, init) => {
        fetchCalls.push({ url, init });
        return responder(url, fetchCalls.length);
      },
      safeFetch: async (url) => {
        safeCalls.push(url);
        if (!opts.safe) throw new Error('unexpected safeFetch');
        return opts.safe(url);
      },
      sleep: async (ms) => {
        sleeps.push(ms);
        clock.t += ms;
      },
      now: () => clock.t,
      random: () => 0,
      ...opts.deps,
    },
    opts.usage,
  );
  return { pool, fetchCalls, safeCalls, sleeps, clock };
}

const json = (v: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json', ...headers } });

function safeRes(url: string, body: string, status = 200): SafeFetchResponse {
  const buf = Buffer.from(body);
  return {
    status,
    ok: status >= 200 && status < 300,
    finalUrl: url,
    redirects: [],
    headers: new Headers({ 'content-type': 'application/json' }),
    body: buf,
    remoteAddress: '93.184.216.34',
    text: () => buf.toString('utf8'),
    json: <T>() => JSON.parse(buf.toString('utf8')) as T,
  } as SafeFetchResponse;
}

describe('polite http helpers', () => {
  it('parses Retry-After seconds and HTTP dates', () => {
    const now = Date.parse('2026-09-30T00:00:00Z');
    expect(parseRetryAfter('12', now)).toBe(12_000);
    expect(parseRetryAfter('Wed, 30 Sep 2026 00:00:30 GMT', now)).toBe(30_000);
    expect(parseRetryAfter('soon', now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });

  it('backoff doubles with jitter and is capped', () => {
    expect(backoffMs(1, () => 0)).toBe(1000);
    expect(backoffMs(3, () => 0)).toBe(4000);
    expect(backoffMs(3, () => 1)).toBe(4500);
    expect(backoffMs(20, () => 0)).toBe(30_000);
  });

  it('token bucket: burst up to 3, then 60/rpm seconds per token', () => {
    const b = new TokenBucket(6, 0);
    expect([b.take(0), b.take(0), b.take(0)]).toEqual([0, 0, 0]);
    expect(b.take(0)).toBe(10_000);
    expect(b.take(10_000)).toBe(0);
    expect(new TokenBucket(1, 0).capacity).toBe(1);
  });

  it('strips query strings from logged URLs', () => {
    expect(safeUrlForLog('https://x.example/a?token=secret')).toBe('https://x.example/a');
  });
});

describe('PoliteHttpPool', () => {
  it('sends the bot user agent through fetch for trusted hosts', async () => {
    const h = harness(() => json({ ok: 1 }));
    const http = h.pool.forPlatform('greenhouse');
    await expect(http.getJson('https://boards-api.greenhouse.io/v1/boards/x/jobs')).resolves.toEqual({ ok: 1 });
    const headers = new Headers(h.fetchCalls[0]!.init?.headers);
    expect(headers.get('user-agent')).toBe(BOT_USER_AGENT);
    expect(h.fetchCalls[0]!.init?.redirect).toBe('manual');
    expect(h.safeCalls).toHaveLength(0);
  });

  it('routes untrusted hosts (tenant sub-domains, redirects off the list) through safeFetch', async () => {
    const h = harness(
      () => new Response(null, { status: 302, headers: { location: 'https://elsewhere.example/x' } }),
      { safe: (url) => safeRes(url, '{"via":"safe"}') },
    );
    const http = h.pool.forPlatform('recruitee');
    await expect(http.getJson('https://acme.recruitee.com/api/offers/')).resolves.toEqual({ via: 'safe' });
    expect(h.fetchCalls).toHaveLength(0);
    await expect(http.getJson('https://remotive.com/api/remote-jobs')).resolves.toEqual({ via: 'safe' });
    expect(h.safeCalls).toEqual(['https://acme.recruitee.com/api/offers/', 'https://elsewhere.example/x']);
  });

  it('retries 5xx and 429 with backoff, honouring Retry-After', async () => {
    const h = harness((_u, n) => (n === 1 ? json({}, 503) : n === 2 ? json({}, 429, { 'retry-after': '7' }) : json({ done: true })));
    const r = await h.pool.forPlatform('remotive').getJson('https://remotive.com/api/remote-jobs');
    expect(r).toEqual({ done: true });
    expect(h.fetchCalls).toHaveLength(3);
    expect(h.sleeps).toContain(1000);
    expect(h.sleeps).toContain(7000);
    expect(h.pool.stats().remotive).toMatchObject({ requests: 3, retries: 2, failures: 0 });
  });

  it('does not retry 4xx and gives up after maxRetries', async () => {
    const h = harness(() => json({ error: 'nope' }, 404));
    await expect(h.pool.forPlatform('lever').getJson('https://api.lever.co/v0/postings/x')).rejects.toBeInstanceOf(HttpStatusError);
    expect(h.fetchCalls).toHaveLength(1);
    const g = harness(() => json({}, 500));
    await expect(g.pool.forPlatform('lever').getJson('https://api.lever.co/v0/postings/x')).rejects.toMatchObject({ status: 500 });
    expect(g.fetchCalls).toHaveLength(4);
  });

  it('a Retry-After beyond the ceiling fails instead of waiting', async () => {
    const h = harness(() => json({}, 429, { 'retry-after': '3600' }));
    await expect(h.pool.forPlatform('remoteok').getJson('https://remoteok.com/api')).rejects.toMatchObject({ status: 429 });
    expect(h.fetchCalls).toHaveLength(1);
  });

  it('enforces the daily cap including usage seeded from earlier runs today', async () => {
    const h = harness(() => json([]), { usage: { remotive: 3 } });
    h.pool.setLimits('remotive', { rateLimitPerMin: 2, dailyCap: 4 });
    const http = h.pool.forPlatform('remotive');
    await http.getJson('https://remotive.com/api/remote-jobs?category=devops');
    await expect(http.getJson('https://remotive.com/api/remote-jobs?category=devops')).rejects.toBeInstanceOf(DailyCapError);
    expect(h.pool.usage()).toEqual({ remotive: 4 });
    expect(h.pool.remaining('remotive')).toBe(0);
  });

  it('rate-limits per platform: requests beyond the burst wait for tokens', async () => {
    const h = harness(() => json({}));
    h.pool.setLimits('jobicy', { rateLimitPerMin: 2, dailyCap: 100 });
    const http = h.pool.forPlatform('jobicy');
    for (let i = 0; i < 3; i++) await http.getJson('https://jobicy.com/api/v2/remote-jobs');
    // burst = min(3, 2) = 2 → the third request waits 30 s
    expect(h.sleeps).toEqual([30_000]);
  });

  it('caps response size', async () => {
    const h = harness(() => new Response('x'.repeat(2048), { status: 200 }), { deps: { maxBytes: 1024 } });
    await expect(h.pool.forPlatform('remoteok').getText('https://remoteok.com/api')).rejects.toMatchObject({ code: 'body_too_large' });
  });

  it('only GET over http(s); invalid JSON is a SourceError naming the URL without its query', async () => {
    const h = harness(() => new Response('<html>', { status: 200 }));
    const http = h.pool.forPlatform('remoteok');
    await expect(http.getJson('ftp://remoteok.com/api')).rejects.toBeInstanceOf(HttpNetworkError);
    await expect(http.getJson('https://remoteok.com/api', { method: 'POST' })).rejects.toMatchObject({ code: 'blocked_method' });
    await expect(http.getJson('https://remoteok.com/api?k=secret')).rejects.toThrow(/invalid JSON from https:\/\/remoteok\.com\/api \(/);
  });

  it('non-retryable safeFetch errors (blocked address) fail at once', async () => {
    const h = harness(() => json({}), {
      safe: (url) => {
        throw new SafeFetchError('blocked_ip', 'private address', url);
      },
    });
    await expect(h.pool.forPlatform('personio').getText('https://acme.jobs.personio.de/xml')).rejects.toMatchObject({ code: 'blocked_ip' });
    expect(h.safeCalls).toHaveLength(1);
  });
});
