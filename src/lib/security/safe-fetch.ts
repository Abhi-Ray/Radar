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
 * - Addresses listed in SAFE_FETCH_DENY_IPS (the VPS's own public IPs, written by ops/install.sh)
 *   are refused too: they are "public", but reach the host's nginx and its other vhosts.
 * - Only ports 80 and 443 (explicit or implied by the scheme), on the first URL and every hop.
 * - Redirects are followed manually (max 5) and every hop is re-validated the same way.
 * - One overall deadline (default 15 s) that also covers DNS (c-ares resolver, cancelled on
 *   timeout/abort), and a hard body limit (default 5 MiB, also enforced on the decompressed size,
 *   so compression bombs fail fast).
 */
import { Resolver as DnsResolver } from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import { isIP, type LookupFunction } from 'node:net';
import type { Readable } from 'node:stream';
import zlib from 'node:zlib';
import { BOT_USER_AGENT } from '../contracts/connectors';
import { getEnvVar } from '../env';
import { canonicalIp, ipv4ToString, parseIPv4, parseIPv6 } from './ip';

export { canonicalIp, parseIPv4, parseIPv6 } from './ip';

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

/** Resolves a hostname. `signal` fires on the fetch's deadline or the caller's abort. */
export type Resolver = (hostname: string, signal?: AbortSignal) => Promise<ResolvedAddress[]>;

/** Per-query timeout and attempts of the c-ares resolver (the fetch deadline still caps the total). */
export const DNS_TIMEOUT_MS = 3_000;
export const DNS_TRIES = 2;

/**
 * A + AAAA via c-ares (`dns.promises.Resolver`), not getaddrinfo: a c-ares query can be cancelled,
 * whereas a hung `dns.lookup` keeps a libuv thread-pool thread (shared with scrypt) busy with no way
 * to stop it. One resolver per call, so `cancel()` only affects this request.
 */
export const systemResolver: Resolver = async (hostname, signal) => {
  if (signal?.aborted) throw signal.reason;
  const resolver = new DnsResolver({ timeout: DNS_TIMEOUT_MS, tries: DNS_TRIES });
  const cancel = () => resolver.cancel();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    const [a, aaaa] = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    const out: ResolvedAddress[] = [];
    if (a.status === 'fulfilled') for (const address of a.value) out.push({ address, family: 4 });
    if (aaaa.status === 'fulfilled') for (const address of aaaa.value) out.push({ address, family: 6 });
    if (!out.length) {
      const failed = [a, aaaa].find((r): r is PromiseRejectedResult => r.status === 'rejected');
      if (failed) throw failed.reason;
    }
    return out;
  } finally {
    signal?.removeEventListener('abort', cancel);
  }
};

/** Settles like `p`, or rejects with the signal's reason as soon as it aborts (listener cleaned up). */
function untilAborted<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      },
      (e) => {
        signal.removeEventListener('abort', onAbort);
        reject(e);
      },
    );
  });
}

export type AddressPolicy = (ip: string) => string | null;

// ---- Deny list (SAFE_FETCH_DENY_IPS) -------------------------------------------------------

let denyMemo: { list: readonly string[]; set: ReadonlySet<string> } | null = null;

/** The configured deny list (canonical forms, see env.ts); empty when unset. */
function deniedAddresses(): ReadonlySet<string> {
  const list = getEnvVar('SAFE_FETCH_DENY_IPS');
  if (denyMemo?.list !== list) denyMemo = { list, set: new Set(list) };
  return denyMemo.set;
}

/** IPv4 addresses an IPv6 literal is translated to on the way (NAT64 well-known prefix, 6to4). */
function embeddedIPv4s(ip: string): string[] {
  const g = parseIPv6(ip);
  if (!g) return [];
  const out: string[] = [];
  if (prefixMatch(g, [0x64, 0xff9b, 0, 0, 0, 0], 96)) out.push(ipv4ToString(embeddedV4(g[6], g[7])));
  if (prefixMatch(g, [0x2002], 16)) out.push(ipv4ToString(embeddedV4(g[1], g[2])));
  return out;
}

/** Why `ip` is on the deny list (null = not listed). */
export function denyListReason(ip: string, deny: ReadonlySet<string> = deniedAddresses()): string | null {
  if (deny.size === 0) return null;
  const c = canonicalIp(ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip);
  if (c === null) return null;
  if (deny.has(c) || embeddedIPv4s(c).some((v) => deny.has(v))) return 'denied by SAFE_FETCH_DENY_IPS';
  return null;
}

/** The production policy: public addresses only, and none of SAFE_FETCH_DENY_IPS. */
export const defaultAddressPolicy: AddressPolicy = (ip) => ipBlockReason(ip) ?? denyListReason(ip);

// ---- Ports ---------------------------------------------------------------------------------

/** Ports safeFetch may contact unless a caller (tests) injects others. */
export const DEFAULT_ALLOWED_PORTS: readonly number[] = [80, 443];

/** The port a URL connects to (explicit, or implied by the scheme). */
export function effectivePort(url: URL): number {
  if (url.port) return Number(url.port);
  return url.protocol === 'https:' ? 443 : 80;
}

/**
 * Resolves `url`'s host and returns the address to connect to. Every resolved address must pass
 * the policy (an attacker-controlled record set mixing public and private answers is rejected).
 */
export async function resolvePublicAddress(
  url: URL,
  resolver: Resolver = systemResolver,
  policy: AddressPolicy = defaultAddressPolicy,
  signal?: AbortSignal,
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
    // The resolver gets the signal (to cancel its queries); the race makes sure even a resolver
    // that ignores it cannot outlive the deadline.
    addrs = await untilAborted(resolver(host, signal), signal);
  } catch (err) {
    // Deadline / caller abort: let the fetch report timeout / aborted, not a DNS failure.
    if (signal?.aborted) throw err;
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
  /**
   * Returns a reason when an address must not be contacted. Default: public addresses only, minus
   * SAFE_FETCH_DENY_IPS.
   */
  addressPolicy?: AddressPolicy;
  /** Ports that may be contacted, on the first URL and on every redirect hop. Default 80 + 443. */
  allowedPorts?: readonly number[];
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
  const policy = deps.addressPolicy ?? defaultAddressPolicy;
  const allowedPorts = new Set(deps.allowedPorts ?? DEFAULT_ALLOWED_PORTS);

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
        // The port is checked first: a refused URL never even triggers a DNS lookup.
        const port = effectivePort(current);
        if (!allowedPorts.has(port)) throw new SafeFetchError('blocked_host', `port ${port} is not allowed`, current.href);
        addr = await resolvePublicAddress(current, resolver, policy, signal);
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

/** SSRF-safe fetch (public addresses on ports 80/443 only). See the module comment for guarantees. */
export const safeFetch = createSafeFetch();
