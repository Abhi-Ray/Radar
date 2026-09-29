/**
 * SSRF-safe HTTP client for every server-side fetch of a URL that came from data (link checker,
 * career pages, official visa pages, connector endpoints). Brief §4:
 *
 * - http/https only; no credentials in URLs; `localhost`-style names refused outright.
 * - DNS is resolved up front and EVERY returned address must be public (IPv4 + IPv6, including
 *   IPv4-mapped/NAT64/6to4 embeddings). Private, loopback, link-local (cloud metadata), CGNAT,
 *   benchmark, documentation, multicast and reserved ranges are rejected.
 * - The socket connects to the exact address that was validated (pinned via a custom `lookup`),
 *   so a DNS-rebinding answer between check and connect cannot redirect the request. TLS still
 *   verifies the certificate against the hostname (SNI unchanged).
 * - Redirects are followed manually (max 5) and every hop is re-validated the same way.
 * - One overall deadline (default 15 s) and a hard body limit (default 5 MiB, also enforced on the
 *   decompressed size, so compression bombs fail fast).
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { BOT_USER_AGENT } from '../contracts/connectors';

// ---- IP classification ---------------------------------------------------------------------

export type SafeFetchErrorCode =
  | 'invalid_url'
  | 'blocked_scheme'
  | 'blocked_credentials'
  | 'blocked_host'
  | 'blocked_ip'
  | 'dns_error'
  | 'too_many_redirects'
  | 'bad_redirect'
  | 'timeout'
  | 'aborted'
  | 'body_too_large'
  | 'network_error';

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;
  readonly url: string;
  constructor(code: SafeFetchErrorCode, message: string, url: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'SafeFetchError';
    this.code = code;
    this.url = url;
  }
}

/** Parses dotted-quad IPv4 into a 32-bit unsigned number (null when not a plain IPv4 literal). */
export function parseIPv4(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  let n = 0;
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i]);
    if (part > 255 || (m[i].length > 1 && m[i].startsWith('0'))) return null;
    n = n * 256 + part;
  }
  return n >>> 0;
}

/** Parses an IPv6 literal (optionally with embedded IPv4 / zone id) into 8 16-bit groups. */
export function parseIPv6(input: string): number[] | null {
  let ip = input.trim();
  if (ip.startsWith('[') && ip.endsWith(']')) ip = ip.slice(1, -1);
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  if (!ip.includes(':')) return null;

  let tail: number[] = [];
  const lastColon = ip.lastIndexOf(':');
  const maybeV4 = ip.slice(lastColon + 1);
  if (maybeV4.includes('.')) {
    const v4 = parseIPv4(maybeV4);
    if (v4 === null) return null;
    tail = [(v4 >>> 16) & 0xffff, v4 & 0xffff];
    // Drop the IPv4 part; keep the separating ':' only when it belongs to a '::'.
    const prefix = ip.slice(0, lastColon + 1);
    ip = prefix.endsWith('::') ? prefix : prefix.slice(0, -1);
  }

  const halves = ip.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (s: string): number[] | null => {
    if (s === '') return [];
    const out: number[] = [];
    for (const g of s.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null;
      out.push(Number.parseInt(g, 16));
    }
    return out;
  };
  const head = parseGroups(halves[0]);
  const rest = halves.length === 2 ? parseGroups(halves[1]) : [];
  if (!head || !rest) return null;
  const known = head.length + rest.length + tail.length;
  if (halves.length === 2) {
    if (known > 7) return null;
    return [...head, ...new Array<number>(8 - known).fill(0), ...rest, ...tail];
  }
  if (known !== 8) return null;
  return [...head, ...tail];
}

interface V4Range {
  base: number;
  bits: number;
  label: string;
}

const v4 = (cidr: string, label: string): V4Range => {
  const [addr, bits] = cidr.split('/');
  return { base: parseIPv4(addr) as number, bits: Number(bits), label };
};

/** Non-public IPv4 ranges (RFC 6890 special-purpose + multicast/reserved). */
export const BLOCKED_IPV4_RANGES: readonly V4Range[] = [
  v4('0.0.0.0/8', 'this-network'),
  v4('10.0.0.0/8', 'private'),
  v4('100.64.0.0/10', 'cgnat'),
  v4('127.0.0.0/8', 'loopback'),
  v4('169.254.0.0/16', 'link-local'),
  v4('172.16.0.0/12', 'private'),
  v4('192.0.0.0/24', 'ietf-protocol'),
  v4('192.0.2.0/24', 'documentation'),
  v4('192.31.196.0/24', 'as112'),
  v4('192.52.193.0/24', 'amt'),
  v4('192.88.99.0/24', '6to4-relay'),
  v4('192.168.0.0/16', 'private'),
  v4('192.175.48.0/24', 'as112'),
  v4('198.18.0.0/15', 'benchmark'),
  v4('198.51.100.0/24', 'documentation'),
  v4('203.0.113.0/24', 'documentation'),
  v4('224.0.0.0/4', 'multicast'),
  v4('240.0.0.0/4', 'reserved'),
];

function inV4Range(n: number, r: V4Range): boolean {
  if (r.bits === 0) return true;
  const mask = (0xffffffff << (32 - r.bits)) >>> 0;
  return ((n & mask) >>> 0) === ((r.base & mask) >>> 0);
}

/** Why an IPv4 address is not public (null = public). */
export function ipv4BlockReason(ip: string | number): string | null {
  const n = typeof ip === 'number' ? ip >>> 0 : parseIPv4(ip);
  if (n === null) return 'invalid';
  for (const r of BLOCKED_IPV4_RANGES) if (inV4Range(n, r)) return r.label;
  return null;
}

function prefixMatch(groups: number[], prefix: number[], bits: number): boolean {
  let remaining = bits;
  for (let i = 0; remaining > 0; i++) {
    const take = Math.min(16, remaining);
    const mask = (0xffff << (16 - take)) & 0xffff;
    if ((groups[i] & mask) !== (prefix[i] & mask)) return false;
    remaining -= take;
  }
  return true;
}

const embeddedV4 = (hi: number, lo: number) => ((hi << 16) >>> 0) + lo;

/** Why an IPv6 address is not public (null = public). */
export function ipv6BlockReason(ip: string): string | null {
  const g = parseIPv6(ip);
  if (!g) return 'invalid';
  const allZeroUpTo = (n: number) => g.slice(0, n).every((x) => x === 0);
  if (allZeroUpTo(8)) return 'unspecified';
  if (allZeroUpTo(7) && g[7] === 1) return 'loopback';
  // ::ffff:a.b.c.d (IPv4-mapped) and ::ffff:0:a.b.c.d (IPv4-translated): judge the IPv4 inside.
  if (allZeroUpTo(5) && g[5] === 0xffff) return ipv4BlockReason(embeddedV4(g[6], g[7])) ?? null;
  if (allZeroUpTo(4) && g[4] === 0xffff && g[5] === 0) return ipv4BlockReason(embeddedV4(g[6], g[7])) ?? null;
  // ::a.b.c.d (deprecated IPv4-compatible) — never legitimately routed today.
  if (allZeroUpTo(6)) return 'ipv4-compatible';
  // NAT64 well-known prefix 64:ff9b::/96 embeds an IPv4 address.
  if (prefixMatch(g, [0x64, 0xff9b, 0, 0, 0, 0], 96)) return ipv4BlockReason(embeddedV4(g[6], g[7])) ?? null;
  if (prefixMatch(g, [0x64, 0xff9b, 0x1], 48)) return 'nat64-local';
  if (prefixMatch(g, [0x100, 0, 0, 0], 64)) return 'discard';
  // 6to4 2002::/16 embeds an IPv4 address in bits 16..48.
  if (prefixMatch(g, [0x2002], 16)) return ipv4BlockReason(embeddedV4(g[1], g[2])) ?? null;
  if (prefixMatch(g, [0x2001, 0], 32)) return 'teredo';
  if (prefixMatch(g, [0x2001, 0x2, 0], 48)) return 'benchmark';
  if (prefixMatch(g, [0x2001, 0x10], 28)) return 'orchid';
  if (prefixMatch(g, [0x2001, 0x20], 28)) return 'orchid';
  if (prefixMatch(g, [0x2001, 0], 23)) return 'ietf-protocol';
  if (prefixMatch(g, [0x2001, 0xdb8], 32)) return 'documentation';
  if (prefixMatch(g, [0x3fff], 20)) return 'documentation';
  if (prefixMatch(g, [0x5f00], 16)) return 'srv6';
  if (prefixMatch(g, [0xfc00], 7)) return 'unique-local';
  if (prefixMatch(g, [0xfe80], 10)) return 'link-local';
  if (prefixMatch(g, [0xfec0], 10)) return 'site-local';
  if (prefixMatch(g, [0xff00], 8)) return 'multicast';
  // Only global unicast (2000::/3) is public.
  if (!prefixMatch(g, [0x2000], 3)) return 'reserved';
  return null;
}

/** Why an IP literal is not a public address (null = public; 'invalid' for non-IPs). */
export function ipBlockReason(ip: string): string | null {
  const bare = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  const kind = isIP(bare.split('%')[0]);
  if (kind === 4) return ipv4BlockReason(bare);
  if (kind === 6) return ipv6BlockReason(bare);
  return 'invalid';
}

export function isPublicIp(ip: string): boolean {
  return ipBlockReason(ip) === null;
}

// ---- URL / host validation -----------------------------------------------------------------

const BLOCKED_HOST_SUFFIXES = ['.localhost', '.local', '.internal', '.home.arpa', '.lan', '.intranet', '.corp'];
const BLOCKED_HOSTS = new Set(['localhost', 'localhost.localdomain', 'ip6-localhost', 'ip6-loopback', 'metadata', 'metadata.google.internal']);

export function hostBlockReason(hostname: string): string | null {
  const h = hostname.toLowerCase().replace(/\.$/, '');
  if (!h) return 'empty host';
  if (BLOCKED_HOSTS.has(h)) return `host ${h} is not allowed`;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return `host ${h} is not allowed`;
  if (!h.includes('.') && isIP(h) === 0 && !h.startsWith('[')) return 'single-label hosts are not allowed';
  return null;
}

/** Parses and statically validates a URL (scheme, credentials, obviously-internal hosts, IP literals). */
export function validateUrl(raw: string | URL): URL {
  const input = typeof raw === 'string' ? raw : raw.href;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new SafeFetchError('invalid_url', 'invalid URL', String(input).slice(0, 200));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new SafeFetchError('blocked_scheme', `scheme ${url.protocol} is not allowed`, url.href);
  }
  if (url.username || url.password) {
    throw new SafeFetchError('blocked_credentials', 'credentials in URLs are not allowed', redactUrl(url));
  }
  const host = bareHost(url);
  const hostReason = hostBlockReason(host);
  if (hostReason) throw new SafeFetchError('blocked_host', hostReason, url.href);
  if (isIP(host)) {
    const reason = ipBlockReason(host);
    if (reason) throw new SafeFetchError('blocked_ip', `address ${host} is not public (${reason})`, url.href);
  }
  return url;
}

function bareHost(url: URL): string {
  const h = url.hostname;
  return h.startsWith('[') && h.endsWith(']') ? h.slice(1, -1) : h;
}

function redactUrl(url: URL): string {
  const copy = new URL(url.href);
  copy.username = '';
  copy.password = '';
  return copy.href;
}

// ---- DNS -----------------------------------------------------------------------------------

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const systemResolver: Resolver = async (hostname) => {
  const res = await dnsLookup(hostname, { all: true, verbatim: true });
  return res.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export type AddressPolicy = (ip: string) => string | null;

/**
 * Resolves `url`'s host and returns the address to connect to. Every resolved address must pass
 * the policy (an attacker-controlled record set mixing public and private answers is rejected).
 */
export async function resolvePublicAddress(
  url: URL,
  resolver: Resolver = systemResolver,
  policy: AddressPolicy = ipBlockReason,
): Promise<ResolvedAddress> {
  const host = bareHost(url);
  const literal = isIP(host);
  if (literal) {
    const reason = policy(host);
    if (reason) throw new SafeFetchError('blocked_ip', `address ${host} is not public (${reason})`, url.href);
    return { address: host, family: literal === 6 ? 6 : 4 };
  }
  let addrs: ResolvedAddress[];
  try {
    addrs = await resolver(host);
  } catch (err) {
    throw new SafeFetchError('dns_error', `DNS lookup failed for ${host}`, url.href, { cause: err });
  }
  if (!addrs.length) throw new SafeFetchError('dns_error', `no addresses for ${host}`, url.href);
  for (const a of addrs) {
    const reason = policy(a.address);
    if (reason) throw new SafeFetchError('blocked_ip', `${host} resolves to a non-public address (${reason})`, url.href);
  }
  // Prefer IPv4 when available (more predictable on typical VPS networking).
  return addrs.find((a) => a.family === 4) ?? addrs[0];
}

// ---- fetch ---------------------------------------------------------------------------------

export const SAFE_FETCH_DEFAULTS = {
  timeoutMs: 15_000,
  maxBytes: 5 * 1024 * 1024,
  maxRedirects: 5,
  userAgent: BOT_USER_AGENT,
} as const;

const HARD_MAX_REDIRECTS = 5;
const HARD_MAX_BYTES = 50 * 1024 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD';
  headers?: Record<string, string>;
  /** Overall deadline across all redirects. */
  timeoutMs?: number;
  /** Max body bytes (after decompression). Exceeding it throws `body_too_large`. */
  maxBytes?: number;
  /** 0..5; 0 = return the redirect response itself. */
  maxRedirects?: number;
  signal?: AbortSignal;
}

export interface SafeFetchResponse {
  status: number;
  ok: boolean;
  /** URL of the final response (after redirects). */
  finalUrl: string;
  /** Every URL visited before the final one. */
  redirects: string[];
  headers: Headers;
  /** Raw (decompressed) body; empty for HEAD. */
  body: Buffer;
  /** The IP the final response came from. */
  remoteAddress: string;
  /** Body decoded with the response charset (utf-8 fallback). */
  text(): string;
  json<T = unknown>(): T;
}

export interface SafeFetchDeps {
  resolver?: Resolver;
  /** Returns a reason when an address must not be contacted. Default: public addresses only. */
  addressPolicy?: AddressPolicy;
}

function pinnedLookup(addr: ResolvedAddress): LookupFunction {
  return ((_hostname: string, options: { all?: boolean }, cb: (...args: unknown[]) => void) => {
    if (options?.all) cb(null, [{ address: addr.address, family: addr.family }]);
    else cb(null, addr.address, addr.family);
  }) as unknown as LookupFunction;
}

function toHeaders(raw: http.IncomingHttpHeaders): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(raw)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) h.append(k, item);
    else h.set(k, v);
  }
  return h;
}

function decoderFor(contentType: string | null): TextDecoder {
  const m = contentType ? /charset\s*=\s*"?([\w.:-]+)"?/i.exec(contentType) : null;
  if (m) {
    try {
      return new TextDecoder(m[1].toLowerCase());
    } catch {
      // Unknown label → utf-8.
    }
  }
  return new TextDecoder('utf-8');
}

interface HopResult {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

function requestOnce(
  url: URL,
  addr: ResolvedAddress,
  method: 'GET' | 'HEAD',
  headers: Record<string, string>,
  maxBytes: number,
  signal: AbortSignal,
  readBody: (status: number) => boolean,
): Promise<HopResult> {
  return new Promise<HopResult>((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: bareHost(url),
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        lookup: pinnedLookup(addr),
        agent: false,
        signal,
        // Never let Node pick a different family than the validated address.
        family: addr.family,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (method === 'HEAD' || !readBody(status)) {
          // Headers are all we need (HEAD, or a redirect we are about to follow).
          res.destroy();
          resolve({ status, headers: res.headers, body: Buffer.alloc(0) });
          return;
        }
        const declared = Number(res.headers['content-length']);
        if (Number.isFinite(declared) && declared > maxBytes) {
          res.destroy();
          reject(new SafeFetchError('body_too_large', `body exceeds ${maxBytes} bytes`, url.href));
          return;
        }
        const encoding = String(res.headers['content-encoding'] ?? '').trim().toLowerCase();
        let stream: Readable = res;
        if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
        else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
        else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
        const chunks: Buffer[] = [];
        let size = 0;
        let done = false;
        const fail = (err: unknown) => {
          if (done) return;
          done = true;
          if (stream !== res) stream.destroy();
          res.destroy();
          reject(err);
        };
        // Counted AFTER decompression, so a compression bomb stops at maxBytes.
        stream.on('data', (chunk: Buffer) => {
          if (done) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(new SafeFetchError('body_too_large', `body exceeds ${maxBytes} bytes`, url.href));
            return;
          }
          chunks.push(chunk);
        });
        stream.on('end', () => {
          if (done) return;
          done = true;
          resolve({ status, headers: res.headers, body: Buffer.concat(chunks, size) });
        });
        stream.on('error', fail);
        if (stream !== res) res.on('error', fail);
      },
    );
    req.on('error', reject);
    req.end();
  });
}

function mapError(err: unknown, url: string, signal: AbortSignal, userSignal?: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  if (signal.aborted) {
    if (userSignal?.aborted) return new SafeFetchError('aborted', 'request aborted', url, { cause: err });
    return new SafeFetchError('timeout', 'request timed out', url, { cause: err });
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new SafeFetchError('network_error', msg.slice(0, 300), url, { cause: err });
}

/**
 * Builds a safeFetch with injected DNS / address policy (tests). Production code uses the
 * exported `safeFetch`, which only ever talks to public addresses.
 */
export function createSafeFetch(deps: SafeFetchDeps = {}) {
  const resolver = deps.resolver ?? systemResolver;
  const policy = deps.addressPolicy ?? ipBlockReason;

  return async function safeFetchImpl(input: string | URL, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
    const method = options.method ?? 'GET';
    const timeoutMs = Math.max(1, options.timeoutMs ?? SAFE_FETCH_DEFAULTS.timeoutMs);
    const maxBytes = Math.min(HARD_MAX_BYTES, Math.max(0, options.maxBytes ?? SAFE_FETCH_DEFAULTS.maxBytes));
    const maxRedirects = Math.min(HARD_MAX_REDIRECTS, Math.max(0, options.maxRedirects ?? SAFE_FETCH_DEFAULTS.maxRedirects));
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

    const baseHeaders: Record<string, string> = {
      'user-agent': SAFE_FETCH_DEFAULTS.userAgent,
      accept: '*/*',
      'accept-encoding': 'gzip, deflate, br',
    };
    for (const [k, v] of Object.entries(options.headers ?? {})) {
      const key = k.toLowerCase();
      // Hop-by-hop / routing headers are ours to set.
      if (key === 'host' || key === 'connection' || key === 'content-length' || key === 'transfer-encoding') continue;
      baseHeaders[key] = v;
    }

    let current = validateUrl(input);
    const visited: string[] = [];
    for (let hop = 0; ; hop++) {
      if (signal.aborted) throw mapError(signal.reason, current.href, signal, options.signal);
      let addr: ResolvedAddress;
      let res: HopResult;
      try {
        addr = await resolvePublicAddress(current, resolver, policy);
        // Redirect bodies are never read (unless redirects are disabled and the caller wants it).
        res = await requestOnce(current, addr, method, baseHeaders, maxBytes, signal, (status) => {
          return !REDIRECT_STATUSES.has(status) || maxRedirects === 0;
        });
      } catch (err) {
        throw mapError(err, current.href, signal, options.signal);
      }

      const location = res.headers.location;
      if (REDIRECT_STATUSES.has(res.status) && location && hop < maxRedirects) {
        let next: URL;
        try {
          next = new URL(Array.isArray(location) ? location[0] : location, current);
        } catch {
          throw new SafeFetchError('bad_redirect', 'invalid redirect location', current.href);
        }
        visited.push(current.href);
        // Credentials never follow a redirect to another origin.
        if (next.origin !== current.origin) delete baseHeaders.authorization;
        delete baseHeaders.cookie;
        current = validateUrl(next);
        continue;
      }
      if (REDIRECT_STATUSES.has(res.status) && location && maxRedirects > 0 && hop >= maxRedirects) {
        throw new SafeFetchError('too_many_redirects', `more than ${maxRedirects} redirects`, current.href);
      }

      const headers = toHeaders(res.headers);
      const body = res.body;
      return {
        status: res.status,
        ok: res.status >= 200 && res.status < 300,
        finalUrl: current.href,
        redirects: visited,
        headers,
        body,
        remoteAddress: addr.address,
        text: () => decoderFor(headers.get('content-type')).decode(body),
        json: <T>() => JSON.parse(decoderFor(headers.get('content-type')).decode(body)) as T,
      };
    }
  };
}

/** SSRF-safe fetch (public addresses only). See the module comment for guarantees. */
export const safeFetch = createSafeFetch();
