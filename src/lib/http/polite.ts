/**
 * Polite HTTP client for connectors (brief §6). One `PoliteHttpPool` per pipeline run; every
 * source gets a `PoliteHttp` view bound to its platform:
 *
 * - Per-platform token bucket from `source_platforms.rate_limit_per_min` (shared by all sources of
 *   the platform inside this process, so two Greenhouse boards never double the rate) and a daily
 *   request cap (`source_platforms.daily_cap`, counted per UTC day; the pool is seeded with the
 *   requests already made today so a restart cannot exceed the cap).
 * - 15 s timeout per attempt, up to 3 retries with exponential backoff + jitter on network
 *   errors, 429 and 5xx; `Retry-After` (seconds or HTTP date) is honoured up to a ceiling.
 * - User-Agent = BOT_USER_AGENT, response bodies capped at 20 MiB.
 * - Fixed, trusted API hosts (code constants) go through `fetch`; every other URL (tenant
 *   sub-domains built from config, links found in data) goes through the SSRF-safe `safeFetch`.
 */
import { BOT_USER_AGENT, SourceError, type PoliteHttp } from '../contracts/connectors';
import { SafeFetchError, safeFetch as defaultSafeFetch, type SafeFetchOptions, type SafeFetchResponse } from '../security/safe-fetch';

export const POLITE_HTTP_VERSION = 'polite-http@2026-09-30.1';

export const POLITE_DEFAULTS = {
  timeoutMs: 15_000,
  maxRetries: 3,
  maxBytes: 20 * 1024 * 1024,
  baseBackoffMs: 1_000,
  maxBackoffMs: 30_000,
  /** A Retry-After longer than this is not waited for (the request fails as rate limited). */
  maxRetryAfterMs: 120_000,
  jitterMs: 500,
  /** Burst size of the token bucket (never more than the per-minute rate). */
  maxBurst: 3,
} as const;

/**
 * API hosts whose address is a code constant (not derived from data). Everything else is fetched
 * via safeFetch, which validates DNS answers and pins the connection to a public address.
 */
export const TRUSTED_API_HOSTS: ReadonlySet<string> = new Set([
  'boards-api.greenhouse.io',
  'api.lever.co',
  'api.eu.lever.co',
  'api.ashbyhq.com',
  'api.smartrecruiters.com',
  'apply.workable.com',
  'www.workable.com',
  'rest.arbeitsagentur.de',
  'jobsearch.api.jobtechdev.se',
  'pam-stilling-feed.nav.no',
  'www.arbeitnow.com',
  'remotive.com',
  'remoteok.com',
  'himalayas.app',
  'jobicy.com',
]);

/** Non-2xx final response. Extends SourceError so an uncaught one fails the source run. */
export class HttpStatusError extends SourceError {
  constructor(
    public readonly url: string,
    status: number,
    public readonly bodyExcerpt: string,
  ) {
    super(`HTTP ${status} from ${safeUrlForLog(url)}`, status);
    this.name = 'HttpStatusError';
  }
}

/** Daily cap for the platform reached; the source run is skipped/partial, never retried today. */
export class DailyCapError extends SourceError {
  constructor(public readonly platformKey: string, cap: number) {
    super(`daily request cap (${cap}) reached for platform ${platformKey}`, 429);
    this.name = 'DailyCapError';
  }
}

export class HttpNetworkError extends SourceError {
  constructor(message: string, public readonly url: string, public readonly code: string) {
    super(message);
    this.name = 'HttpNetworkError';
  }
}

/** Strips query strings (may carry tokens) for logs and error messages. */
export function safeUrlForLog(url: string): string {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return '[invalid url]';
  }
}

/** Parses Retry-After (delta seconds or HTTP date) into milliseconds from `now`; null if absent/invalid. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | null {
  if (!value) return null;
  const v = value.trim();
  if (/^\d+$/.test(v)) return Number(v) * 1000;
  const at = Date.parse(v);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now);
}

/** Exponential backoff with jitter for retry `attempt` (1-based). */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  const exp = Math.min(POLITE_DEFAULTS.maxBackoffMs, POLITE_DEFAULTS.baseBackoffMs * 2 ** (attempt - 1));
  return Math.round(exp + random() * POLITE_DEFAULTS.jitterMs);
}

export function isRetryableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

// ---- token bucket --------------------------------------------------------------------------

export class TokenBucket {
  private tokens: number;
  private last: number;
  readonly capacity: number;
  /** Tokens per millisecond. */
  readonly rate: number;

  constructor(perMinute: number, now: number, burst: number = POLITE_DEFAULTS.maxBurst) {
    const rpm = Math.max(1, Math.floor(perMinute));
    this.capacity = Math.max(1, Math.min(burst, rpm));
    this.rate = rpm / 60_000;
    this.tokens = this.capacity;
    this.last = now;
  }

  private refill(now: number): void {
    if (now > this.last) {
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.rate);
      this.last = now;
    }
  }

  /** Takes one token if available; otherwise returns the milliseconds until one will be. */
  take(now: number): number {
    this.refill(now);
    if (this.tokens >= 1) {
      this.tokens -= 1;
      return 0;
    }
    return Math.ceil((1 - this.tokens) / this.rate);
  }
}

// ---- pool ----------------------------------------------------------------------------------

export interface PlatformLimits {
  rateLimitPerMin: number;
  dailyCap: number;
}

export interface PlatformHttpStats {
  requests: number;
  retries: number;
  failures: number;
  bytes: number;
  waitedMs: number;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type SafeFetchLike = (input: string, options?: SafeFetchOptions) => Promise<SafeFetchResponse>;

export interface PoliteHttpDeps {
  fetch?: FetchLike;
  safeFetch?: SafeFetchLike;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  random?: () => number;
  trustedHosts?: ReadonlySet<string>;
  timeoutMs?: number;
  maxRetries?: number;
  maxBytes?: number;
}

export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason instanceof Error ? signal.reason : new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason instanceof Error ? signal.reason : new Error('aborted'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

interface RawResponse {
  status: number;
  headers: Headers;
  body: Buffer;
}

function headersToRecord(init?: RequestInit): Record<string, string> {
  const out: Record<string, string> = {};
  if (!init?.headers) return out;
  new Headers(init.headers).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

async function readCapped(res: Response, maxBytes: number, url: string): Promise<Buffer> {
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await res.body?.cancel().catch(() => undefined);
    throw new HttpNetworkError(`body exceeds ${maxBytes} bytes`, url, 'body_too_large');
  }
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Buffer[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new HttpNetworkError(`body exceeds ${maxBytes} bytes`, url, 'body_too_large');
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks, size);
}

function decode(res: RawResponse): string {
  const ct = res.headers.get('content-type');
  const m = ct ? /charset\s*=\s*"?([\w.:-]+)"?/i.exec(ct) : null;
  if (m) {
    try {
      return new TextDecoder(m[1].toLowerCase()).decode(res.body);
    } catch {
      // unknown label → utf-8
    }
  }
  return new TextDecoder('utf-8').decode(res.body);
}

/** Error thrown by one attempt that may be retried. */
class RetryableAttemptError extends Error {
  constructor(
    message: string,
    public readonly status: number | null,
    public readonly retryAfterMs: number | null,
    public readonly final: Error,
  ) {
    super(message);
  }
}

export class PoliteHttpPool {
  private readonly buckets = new Map<string, TokenBucket>();
  private readonly limits = new Map<string, PlatformLimits>();
  private readonly used = new Map<string, number>();
  private readonly statsByPlatform = new Map<string, PlatformHttpStats>();
  private readonly deps: Required<Omit<PoliteHttpDeps, 'trustedHosts'>> & { trustedHosts: ReadonlySet<string> };
  private readonly queues = new Map<string, Promise<void>>();

  constructor(deps: PoliteHttpDeps = {}, initialUsage: Record<string, number> = {}) {
    this.deps = {
      fetch: deps.fetch ?? ((input, init) => fetch(input, init)),
      safeFetch: deps.safeFetch ?? defaultSafeFetch,
      sleep: deps.sleep ?? abortableSleep,
      now: deps.now ?? Date.now,
      random: deps.random ?? Math.random,
      trustedHosts: deps.trustedHosts ?? TRUSTED_API_HOSTS,
      timeoutMs: deps.timeoutMs ?? POLITE_DEFAULTS.timeoutMs,
      maxRetries: deps.maxRetries ?? POLITE_DEFAULTS.maxRetries,
      maxBytes: Math.min(deps.maxBytes ?? POLITE_DEFAULTS.maxBytes, 50 * 1024 * 1024),
    };
    for (const [k, v] of Object.entries(initialUsage)) if (Number.isFinite(v) && v > 0) this.used.set(k, Math.floor(v));
  }

  setLimits(platformKey: string, limits: PlatformLimits): void {
    this.limits.set(platformKey, {
      rateLimitPerMin: Math.max(1, Math.floor(limits.rateLimitPerMin || 1)),
      dailyCap: Math.max(0, Math.floor(limits.dailyCap)),
    });
    this.buckets.delete(platformKey);
  }

  /** Requests made today (including the seeded usage) per platform. */
  usage(): Record<string, number> {
    return Object.fromEntries(this.used);
  }

  stats(): Record<string, PlatformHttpStats> {
    return Object.fromEntries([...this.statsByPlatform].map(([k, v]) => [k, { ...v }]));
  }

  remaining(platformKey: string): number {
    const cap = this.limits.get(platformKey)?.dailyCap ?? Number.POSITIVE_INFINITY;
    return Math.max(0, cap - (this.used.get(platformKey) ?? 0));
  }

  private statFor(platformKey: string): PlatformHttpStats {
    let s = this.statsByPlatform.get(platformKey);
    if (!s) {
      s = { requests: 0, retries: 0, failures: 0, bytes: 0, waitedMs: 0 };
      this.statsByPlatform.set(platformKey, s);
    }
    return s;
  }

  private bucket(platformKey: string): TokenBucket {
    let b = this.buckets.get(platformKey);
    if (!b) {
      b = new TokenBucket(this.limits.get(platformKey)?.rateLimitPerMin ?? 30, this.deps.now());
      this.buckets.set(platformKey, b);
    }
    return b;
  }

  /** Waits for a token (serialised per platform so concurrent sources queue fairly) and counts the request. */
  private async acquire(platformKey: string, signal?: AbortSignal): Promise<void> {
    const prev = this.queues.get(platformKey) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => (release = r));
    const chain = prev.then(() => mine);
    this.queues.set(platformKey, chain);
    try {
      await prev;
      const cap = this.limits.get(platformKey)?.dailyCap;
      const used = this.used.get(platformKey) ?? 0;
      if (cap !== undefined && used >= cap) throw new DailyCapError(platformKey, cap);
      const stat = this.statFor(platformKey);
      for (;;) {
        const wait = this.bucket(platformKey).take(this.deps.now());
        if (wait === 0) break;
        stat.waitedMs += wait;
        await this.deps.sleep(wait, signal);
      }
      this.used.set(platformKey, used + 1);
      stat.requests += 1;
    } finally {
      release();
      if (this.queues.get(platformKey) === chain) this.queues.delete(platformKey);
    }
  }

  private isTrusted(url: URL): boolean {
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && this.deps.trustedHosts.has(url.hostname.toLowerCase());
  }

  private async attempt(url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<RawResponse> {
    let current = url;
    for (let hop = 0; ; hop++) {
      if (!this.isTrusted(current)) return this.attemptSafe(current, headers, signal);
      const href = current.href;
      const timeout = AbortSignal.timeout(this.deps.timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      try {
        // Manual redirects: a hop off the trusted host list continues through safeFetch.
        res = await this.deps.fetch(href, { method: 'GET', headers, redirect: 'manual', signal: combined });
      } catch (err) {
        if (signal?.aborted) throw err;
        const code = timeout.aborted ? 'timeout' : 'network_error';
        const msg = err instanceof Error ? err.message : String(err);
        const e = new HttpNetworkError(`${code}: ${msg}`.slice(0, 300), href, code);
        throw new RetryableAttemptError(e.message, null, null, e);
      }
      const location = res.headers.get('location');
      if (res.status >= 300 && res.status < 400 && location) {
        await res.body?.cancel().catch(() => undefined);
        if (hop >= 5) throw new HttpNetworkError('too many redirects', href, 'too_many_redirects');
        let next: URL;
        try {
          next = new URL(location, current);
        } catch {
          throw new HttpNetworkError('invalid redirect location', href, 'bad_redirect');
        }
        if (next.protocol !== 'https:' && next.protocol !== 'http:') throw new HttpNetworkError('blocked redirect scheme', href, 'bad_redirect');
        current = next;
        continue;
      }
      let body: Buffer;
      try {
        body = await readCapped(res, this.deps.maxBytes, href);
      } catch (err) {
        if (err instanceof HttpNetworkError) throw err;
        if (signal?.aborted) throw err;
        const code = timeout.aborted ? 'timeout' : 'network_error';
        const e = new HttpNetworkError(`${code} while reading body`, href, code);
        throw new RetryableAttemptError(e.message, null, null, e);
      }
      return { status: res.status, headers: res.headers, body };
    }
  }

  private async attemptSafe(url: URL, headers: Record<string, string>, signal?: AbortSignal): Promise<RawResponse> {
    const href = url.href;
    try {
      const res = await this.deps.safeFetch(href, {
        method: 'GET',
        headers,
        timeoutMs: this.deps.timeoutMs,
        maxBytes: this.deps.maxBytes,
        signal,
      });
      return { status: res.status, headers: res.headers, body: res.body };
    } catch (err) {
      if (err instanceof SafeFetchError) {
        const e = new HttpNetworkError(`${err.code}: ${err.message}`.slice(0, 300), href, err.code);
        if (err.code === 'timeout' || err.code === 'network_error' || err.code === 'dns_error') {
          throw new RetryableAttemptError(e.message, null, null, e);
        }
        throw e;
      }
      throw err;
    }
  }

  /** GET with rate limiting, daily cap and retries. Resolves only for 2xx responses. */
  async request(platformKey: string, rawUrl: string, init?: RequestInit): Promise<RawResponse> {
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      throw new HttpNetworkError('invalid url', rawUrl, 'invalid_url');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpNetworkError('blocked scheme', rawUrl, 'blocked_scheme');
    if (init?.method && init.method.toUpperCase() !== 'GET') throw new HttpNetworkError('only GET is allowed', rawUrl, 'blocked_method');
    const signal = init?.signal ?? undefined;
    const headers: Record<string, string> = {
      accept: 'application/json, text/xml;q=0.9, */*;q=0.8',
      ...headersToRecord(init),
      'user-agent': BOT_USER_AGENT,
    };
    const stat = this.statFor(platformKey);
    for (let attempt = 0; ; attempt++) {
      await this.acquire(platformKey, signal);
      let retry: RetryableAttemptError;
      try {
        const res = await this.attempt(url, headers, signal);
        stat.bytes += res.body.length;
        if (res.status >= 200 && res.status < 300) return res;
        const excerpt = decode(res).slice(0, 300);
        const err = new HttpStatusError(url.href, res.status, excerpt);
        if (!isRetryableStatus(res.status)) {
          stat.failures += 1;
          throw err;
        }
        retry = new RetryableAttemptError(err.message, res.status, parseRetryAfter(res.headers.get('retry-after'), this.deps.now()), err);
      } catch (err) {
        if (!(err instanceof RetryableAttemptError)) {
          if (!(err instanceof HttpStatusError)) stat.failures += 1;
          throw err;
        }
        retry = err;
      }
      if (attempt >= this.deps.maxRetries) {
        stat.failures += 1;
        throw retry.final;
      }
      let wait = backoffMs(attempt + 1, this.deps.random);
      if (retry.retryAfterMs !== null) {
        if (retry.retryAfterMs > POLITE_DEFAULTS.maxRetryAfterMs) {
          stat.failures += 1;
          throw retry.final;
        }
        wait = Math.max(wait, retry.retryAfterMs);
      }
      stat.retries += 1;
      stat.waitedMs += wait;
      await this.deps.sleep(wait, signal);
    }
  }

  /** The PoliteHttp view a connector gets for one source (bound to the platform + run signal). */
  forPlatform(platformKey: string, signal?: AbortSignal): PoliteHttp {
    const withSignal = (init?: RequestInit): RequestInit | undefined => {
      if (!signal) return init;
      const s = init?.signal ? AbortSignal.any([signal, init.signal]) : signal;
      return { ...(init ?? {}), signal: s };
    };
    return {
      getText: async (url, init) => decode(await this.request(platformKey, url, withSignal(init))),
      getJson: async <T>(url: string, init?: RequestInit): Promise<T> => {
        const res = await this.request(platformKey, url, withSignal(init));
        const text = decode(res);
        try {
          return JSON.parse(text) as T;
        } catch {
          throw new SourceError(`invalid JSON from ${safeUrlForLog(url)} (${text.slice(0, 80).replace(/\s+/g, ' ')})`, res.status);
        }
      },
    };
  }
}
