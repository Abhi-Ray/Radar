/**
 * SSRF guard tests. Pure address/host/URL classification, then real HTTP against a throw-away
 * server on 127.0.0.1 (OS-assigned port). Loopback is only reachable through createSafeFetch()
 * with an injected resolver + policy; the production `safeFetch` must refuse it.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import zlib from 'node:zlib';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createSafeFetch,
  hostBlockReason,
  ipBlockReason,
  ipv4BlockReason,
  isPublicIp,
  parseIPv4,
  parseIPv6,
  resolvePublicAddress,
  safeFetch,
  SafeFetchError,
  type Resolver,
  type SafeFetchErrorCode,
  validateUrl,
} from '../../src/lib/security/safe-fetch';

async function expectCode(p: Promise<unknown> | (() => unknown), code: SafeFetchErrorCode): Promise<SafeFetchError> {
  try {
    await (typeof p === 'function' ? p() : p);
  } catch (e) {
    expect(e).toBeInstanceOf(SafeFetchError);
    expect((e as SafeFetchError).code).toBe(code);
    return e as SafeFetchError;
  }
  throw new Error(`expected SafeFetchError ${code}`);
}

describe('IP parsing', () => {
  it('parses IPv4 strictly', () => {
    expect(parseIPv4('127.0.0.1')).toBe(0x7f000001);
    expect(parseIPv4('255.255.255.255')).toBe(0xffffffff);
    for (const bad of ['256.1.1.1', '01.2.3.4', '1.2.3', '1.2.3.4.5', ' 1.2.3.4', '0x7f.0.0.1', '']) expect(parseIPv4(bad)).toBeNull();
  });

  it('parses IPv6 incl. compression, embedded IPv4, brackets and zones', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('::')).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('::ffff:127.0.0.1')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x7f00, 1]);
    expect(parseIPv6('[2001:db8::1]')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('fe80::1%en0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('1:2:3:4:5:6:7:8')).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parseIPv6('1:2:3:4:5:6:1.2.3.4')).toEqual([1, 2, 3, 4, 5, 6, 0x102, 0x304]);
    for (const bad of ['1:2:3:4:5:6:7:8:9', '1::2::3', '12345::', 'g::1', '1:2:3:4:5:6:7', '::1.2.3.256', '1.2.3.4']) {
      expect(parseIPv6(bad)).toBeNull();
    }
  });
});

describe('address classification', () => {
  it('blocks every non-public IPv4 range', () => {
    const blocked: [string, string][] = [
      ['0.0.0.0', 'this-network'],
      ['10.1.2.3', 'private'],
      ['100.64.0.1', 'cgnat'],
      ['127.0.0.1', 'loopback'],
      ['127.255.255.254', 'loopback'],
      ['169.254.169.254', 'link-local'],
      ['172.16.0.1', 'private'],
      ['172.31.255.255', 'private'],
      ['192.0.0.8', 'ietf-protocol'],
      ['192.0.2.1', 'documentation'],
      ['192.168.1.1', 'private'],
      ['198.18.0.1', 'benchmark'],
      ['198.51.100.7', 'documentation'],
      ['203.0.113.9', 'documentation'],
      ['224.0.0.1', 'multicast'],
      ['240.0.0.1', 'reserved'],
      ['255.255.255.255', 'reserved'],
    ];
    for (const [ip, label] of blocked) expect(ipBlockReason(ip), ip).toBe(label);
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '93.184.216.34']) expect(isPublicIp(ip), ip).toBe(true);
    expect(ipv4BlockReason(0x7f000001)).toBe('loopback');
  });

  it('blocks non-public IPv6 incl. IPv4 embeddings (mapped, translated, NAT64, 6to4)', () => {
    const blocked: [string, string][] = [
      ['::', 'unspecified'],
      ['::1', 'loopback'],
      ['[::1]', 'loopback'],
      ['::ffff:127.0.0.1', 'loopback'],
      ['::ffff:7f00:1', 'loopback'],
      ['::ffff:169.254.169.254', 'link-local'],
      ['::ffff:0:10.0.0.1', 'private'],
      ['::127.0.0.1', 'ipv4-compatible'],
      ['64:ff9b::10.0.0.1', 'private'],
      ['64:ff9b::a9fe:a9fe', 'link-local'],
      ['64:ff9b:1::1', 'nat64-local'],
      ['2002:7f00:1::', 'loopback'],
      ['2002:c0a8:101::1', 'private'],
      ['2001::1', 'teredo'],
      ['2001:db8::1', 'documentation'],
      ['fc00::1', 'unique-local'],
      ['fd12:3456::1', 'unique-local'],
      ['fe80::1', 'link-local'],
      ['fe80::1%en0', 'link-local'],
      ['fec0::1', 'site-local'],
      ['ff02::1', 'multicast'],
      ['100::1', 'discard'],
      ['4000::1', 'reserved'],
    ];
    for (const [ip, label] of blocked) expect(ipBlockReason(ip), ip).toBe(label);
    for (const ip of ['2606:4700:4700::1111', '2a00:1450:4001:80b::200e', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8', '2002:808:808::1']) {
      expect(isPublicIp(ip), ip).toBe(true);
    }
  });

  it('treats non-IPs as invalid (never public)', () => {
    for (const x of ['example.com', '', '1.2.3', 'localhost', '::g']) {
      expect(ipBlockReason(x)).toBe('invalid');
      expect(isPublicIp(x)).toBe(false);
    }
  });
});

describe('host + URL validation', () => {
  it('refuses internal-looking host names', () => {
    for (const h of ['localhost', 'LOCALHOST.', 'app.localhost', 'printer.local', 'db.internal', 'metadata', 'metadata.google.internal', 'nas.home.arpa', 'router.lan', 'intranet', 'ip6-localhost', '']) {
      expect(hostBlockReason(h), h).not.toBeNull();
    }
    for (const h of ['example.com', 'boards.greenhouse.io', 'example.com.', '8.8.8.8']) expect(hostBlockReason(h), h).toBeNull();
  });

  it('allows only http(s) without credentials and with a public literal host', async () => {
    expect(validateUrl('https://example.com/jobs?x=1').href).toBe('https://example.com/jobs?x=1');
    expect(validateUrl(new URL('http://8.8.8.8:8080/')).port).toBe('8080');
    await expectCode(() => validateUrl('not a url'), 'invalid_url');
    for (const u of ['ftp://example.com/', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/plain,hi', 'gopher://example.com/']) {
      await expectCode(() => validateUrl(u), 'blocked_scheme');
    }
    const cred = await expectCode(() => validateUrl('https://user:s3cret@example.com/'), 'blocked_credentials');
    expect(cred.url).not.toContain('s3cret');
    expect(cred.message).not.toContain('s3cret');
    for (const u of ['http://localhost:8080/', 'http://localhost./', 'http://metadata.google.internal/computeMetadata/v1/', 'http://intranet/']) {
      await expectCode(() => validateUrl(u), 'blocked_host');
    }
    // Every spelling the WHATWG parser normalises to a private address.
    for (const u of [
      'http://127.0.0.1/',
      'http://2130706433/',
      'http://0x7f.1/',
      'http://0177.0.0.1/',
      'http://127.1/',
      'http://0/',
      'http://169.254.169.254/latest/meta-data/',
      'http://[::1]/',
      'http://[::ffff:127.0.0.1]/',
      'http://[fd00::1]/',
      'http://[64:ff9b::a9fe:a9fe]/',
    ]) {
      await expectCode(() => validateUrl(u), 'blocked_ip');
    }
  });
});

describe('resolvePublicAddress', () => {
  const resolverOf =
    (map: Record<string, string[]>): Resolver =>
    async (host) => {
      const ips = map[host];
      if (!ips) throw new Error('ENOTFOUND');
      return ips.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    };

  it('requires every answer to be public and prefers IPv4', async () => {
    const r = resolverOf({
      'ok.example': ['2606:4700::1', '93.184.216.34'],
      'v6.example': ['2606:4700::1'],
      'mixed.example': ['93.184.216.34', '10.0.0.5'],
      'rebind.example': ['::ffff:127.0.0.1'],
      'empty.example': [],
    });
    expect(await resolvePublicAddress(new URL('https://ok.example/'), r)).toEqual({ address: '93.184.216.34', family: 4 });
    expect(await resolvePublicAddress(new URL('https://v6.example/'), r)).toEqual({ address: '2606:4700::1', family: 6 });
    expect(await resolvePublicAddress(new URL('https://8.8.4.4/'), r)).toEqual({ address: '8.8.4.4', family: 4 });
    await expectCode(resolvePublicAddress(new URL('https://mixed.example/'), r), 'blocked_ip');
    await expectCode(resolvePublicAddress(new URL('https://rebind.example/'), r), 'blocked_ip');
    await expectCode(resolvePublicAddress(new URL('https://empty.example/'), r), 'dns_error');
    await expectCode(resolvePublicAddress(new URL('https://missing.example/'), r), 'dns_error');
    await expectCode(resolvePublicAddress(new URL('http://[fe80::1]/'), r), 'blocked_ip');
  });
});

// ---- live HTTP -------------------------------------------------------------------------------

const RESERVED_PORTS = new Set([3000, 3001, 3306, 3399]);
let server: http.Server;
let port = 0;
const hits: string[] = [];
const pendingTimers = new Set<NodeJS.Timeout>();

function later(ms: number, fn: () => void) {
  const t = setTimeout(() => {
    pendingTimers.delete(t);
    fn();
  }, ms);
  pendingTimers.add(t);
  return t;
}

beforeAll(async () => {
  const bomb = zlib.gzipSync(Buffer.alloc(20 * 1024 * 1024));
  server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://placeholder');
    hits.push(`${req.headers.host}${url.pathname}`);
    const send = (status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers });
      res.end(body);
    };
    switch (url.pathname) {
      case '/hello':
        return send(200, 'hello');
      case '/echo':
        return send(200, JSON.stringify({ method: req.method, headers: req.headers }), { 'content-type': 'application/json' });
      case '/redirect':
        return send(Number(url.searchParams.get('status') ?? 302), 'moved', { location: url.searchParams.get('to') ?? '/hello' });
      case '/loop':
        return send(302, '', { location: '/loop' });
      case '/chain': {
        const n = Number(url.searchParams.get('n') ?? 0);
        return n > 0 ? send(301, '', { location: `/chain?n=${n - 1}` }) : send(200, 'end of chain');
      }
      case '/no-location':
        return send(302, 'no location header');
      case '/bad-redirect':
        return send(302, '', { location: 'http://[oops' });
      case '/declared-big':
        res.writeHead(200, { 'content-length': String(2 * 1024 * 1024) });
        return res.end(Buffer.alloc(2 * 1024 * 1024, 97));
      case '/streamed-big': {
        res.writeHead(200, { 'content-type': 'application/octet-stream' });
        let sent = 0;
        const pump = () => {
          while (sent < 2 * 1024 * 1024) {
            sent += 64 * 1024;
            if (!res.write(Buffer.alloc(64 * 1024, 98))) return void res.once('drain', pump);
          }
          res.end();
        };
        res.on('error', () => {});
        return pump();
      }
      case '/gzip':
        return send(200, zlib.gzipSync(JSON.stringify({ ok: true, word: 'grüße' })), {
          'content-type': 'application/json; charset=utf-8',
          'content-encoding': 'gzip',
        });
      case '/brotli':
        return send(200, zlib.brotliCompressSync('brotli body'), { 'content-encoding': 'br' });
      case '/bomb':
        return send(200, bomb, { 'content-encoding': 'gzip', 'content-type': 'application/octet-stream' });
      case '/latin1':
        return send(200, Buffer.from([0x63, 0x61, 0x66, 0xe9]), { 'content-type': 'text/plain; charset=ISO-8859-1' });
      case '/slow': {
        const t = later(3000, () => send(200, 'too late'));
        return void res.on('close', () => clearTimeout(t));
      }
      case '/slow-body': {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.write('first chunk ');
        const t = later(3000, () => res.end('rest'));
        return void res.on('close', () => clearTimeout(t));
      }
      case '/truncated':
        res.writeHead(200, { 'content-length': '100' });
        res.write('only a part');
        return void later(20, () => res.socket?.destroy());
      case '/hangup':
        return void req.socket.destroy();
      default:
        return send(404, 'not found');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
  expect(RESERVED_PORTS.has(port)).toBe(false);
});

afterAll(async () => {
  for (const t of pendingTimers) clearTimeout(t);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

const LOOPBACK_OK = (ip: string) => (ip === '127.0.0.1' ? null : ipBlockReason(ip));
let resolverCalls: string[] = [];
const testResolver: Resolver = async (host) => {
  resolverCalls.push(host);
  const table: Record<string, string> = {
    'site-a.test': '127.0.0.1',
    'site-b.test': '127.0.0.1',
    'private.test': '10.0.0.5',
    'meta.test': '169.254.169.254',
  };
  if (host === 'mixed.test') {
    return [
      { address: '127.0.0.1', family: 4 },
      { address: '192.168.0.10', family: 4 },
    ];
  }
  const ip = table[host];
  if (!ip) throw new Error(`ENOTFOUND ${host}`);
  return [{ address: ip, family: 4 }];
};
const fetchLocal = createSafeFetch({ resolver: testResolver, addressPolicy: LOOPBACK_OK });
const A = () => `http://site-a.test:${port}`;
const B = () => `http://site-b.test:${port}`;

describe('safeFetch over HTTP', () => {
  it('fetches, decodes text/json and reports the pinned address', async () => {
    resolverCalls = [];
    const res = await fetchLocal(`${A()}/hello`);
    expect(res).toMatchObject({ status: 200, ok: true, finalUrl: `${A()}/hello`, redirects: [], remoteAddress: '127.0.0.1' });
    expect(res.text()).toBe('hello');
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(resolverCalls).toEqual(['site-a.test']);

    const echo = await fetchLocal(`${A()}/echo`, { headers: { 'X-Custom': 'yes', Host: 'evil.example', Connection: 'upgrade' } });
    const seen = echo.json<{ method: string; headers: Record<string, string> }>();
    expect(seen.method).toBe('GET');
    expect(seen.headers['x-custom']).toBe('yes');
    expect(seen.headers.host).toBe(`site-a.test:${port}`);
    expect(seen.headers['user-agent']).toMatch(/radar/i);
    expect(seen.headers['accept-encoding']).toContain('gzip');

    expect((await fetchLocal(`${A()}/latin1`)).text()).toBe('café');
    expect((await fetchLocal(`${A()}/missing`)).ok).toBe(false);
  });

  it('decompresses gzip/br and bounds the decompressed size (compression bomb)', async () => {
    expect((await fetchLocal(`${A()}/gzip`)).json()).toEqual({ ok: true, word: 'grüße' });
    expect((await fetchLocal(`${A()}/brotli`)).text()).toBe('brotli body');
    await expectCode(fetchLocal(`${A()}/bomb`, { maxBytes: 1024 * 1024 }), 'body_too_large');
  });

  it('enforces the body limit from content-length and while streaming', async () => {
    await expectCode(fetchLocal(`${A()}/declared-big`, { maxBytes: 1024 * 1024 }), 'body_too_large');
    await expectCode(fetchLocal(`${A()}/streamed-big`, { maxBytes: 1024 * 1024 }), 'body_too_large');
    expect((await fetchLocal(`${A()}/streamed-big`, { maxBytes: 3 * 1024 * 1024 })).body.length).toBe(2 * 1024 * 1024);
  });

  it('HEAD returns headers only', async () => {
    const res = await fetchLocal(`${A()}/declared-big`, { method: 'HEAD', maxBytes: 10 });
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(0);
    expect(res.headers.get('content-length')).toBe(String(2 * 1024 * 1024));
  });

  it('follows redirects, re-resolving every hop, up to the limit', async () => {
    resolverCalls = [];
    const res = await fetchLocal(`${A()}/redirect?to=${encodeURIComponent(`${B()}/chain?n=2`)}`);
    expect(res.text()).toBe('end of chain');
    expect(res.finalUrl).toBe(`${B()}/chain?n=0`);
    expect(res.redirects).toEqual([`${A()}/redirect?to=${encodeURIComponent(`${B()}/chain?n=2`)}`, `${B()}/chain?n=2`, `${B()}/chain?n=1`]);
    expect(resolverCalls).toEqual(['site-a.test', 'site-b.test', 'site-b.test', 'site-b.test']);

    expect((await fetchLocal(`${A()}/chain?n=5`)).text()).toBe('end of chain');
    await expectCode(fetchLocal(`${A()}/chain?n=6`), 'too_many_redirects');
    await expectCode(fetchLocal(`${A()}/loop`), 'too_many_redirects');
    await expectCode(fetchLocal(`${A()}/chain?n=2`, { maxRedirects: 1 }), 'too_many_redirects');
    // maxRedirects is capped at 5 whatever the caller asks for.
    await expectCode(fetchLocal(`${A()}/chain?n=6`, { maxRedirects: 50 }), 'too_many_redirects');

    const raw = await fetchLocal(`${A()}/redirect?to=/hello&status=307`, { maxRedirects: 0 });
    expect(raw.status).toBe(307);
    expect(raw.headers.get('location')).toBe('/hello');
    expect(raw.text()).toBe('moved');
    expect((await fetchLocal(`${A()}/no-location`)).status).toBe(302);
    await expectCode(fetchLocal(`${A()}/bad-redirect`), 'bad_redirect');
  });

  it('re-validates redirect targets (internal hosts, literals, schemes, DNS)', async () => {
    const via = (to: string) => fetchLocal(`${A()}/redirect?to=${encodeURIComponent(to)}`);
    const before = hits.length;
    // Loopback literals are refused even though the injected policy allows 127.0.0.1 via DNS.
    await expectCode(via(`http://127.0.0.1:${port}/hello`), 'blocked_ip');
    await expectCode(via(`http://[::ffff:127.0.0.1]:${port}/hello`), 'blocked_ip');
    await expectCode(via('http://169.254.169.254/latest/meta-data/'), 'blocked_ip');
    await expectCode(via(`http://localhost:${port}/hello`), 'blocked_host');
    await expectCode(via('file:///etc/passwd'), 'blocked_scheme');
    await expectCode(via('https://user:pw@site-b.test/'), 'blocked_credentials');
    await expectCode(via('http://private.test/'), 'blocked_ip');
    await expectCode(via('http://meta.test/'), 'blocked_ip');
    await expectCode(via(`http://mixed.test:${port}/hello`), 'blocked_ip');
    await expectCode(via('http://unknown.test/'), 'dns_error');
    // Only the 10 initial /redirect requests reached the server; no blocked target was contacted.
    expect(hits.slice(before).every((h) => h === `site-a.test:${port}/redirect`)).toBe(true);
    expect(hits.length - before).toBe(10);
  });

  it('drops cookies on every redirect and authorization across origins', async () => {
    const headers = { authorization: 'Bearer token-123', cookie: 'sid=abc', 'x-trace': 't1' };
    const same = await fetchLocal(`${A()}/redirect?to=/echo`, { headers });
    const sameSeen = same.json<{ headers: Record<string, string> }>().headers;
    expect(sameSeen.authorization).toBe('Bearer token-123');
    expect(sameSeen.cookie).toBeUndefined();
    expect(sameSeen['x-trace']).toBe('t1');

    const cross = await fetchLocal(`${A()}/redirect?to=${encodeURIComponent(`${B()}/echo`)}`, { headers });
    const crossSeen = cross.json<{ headers: Record<string, string> }>().headers;
    expect(crossSeen.authorization).toBeUndefined();
    expect(crossSeen.cookie).toBeUndefined();
    expect(crossSeen['x-trace']).toBe('t1');

    // Without a redirect both are sent as given.
    const direct = (await fetchLocal(`${A()}/echo`, { headers })).json<{ headers: Record<string, string> }>().headers;
    expect(direct).toMatchObject({ authorization: 'Bearer token-123', cookie: 'sid=abc' });
  });

  it('times out on slow headers and slow bodies; distinguishes caller aborts', async () => {
    const t0 = Date.now();
    await expectCode(fetchLocal(`${A()}/slow`, { timeoutMs: 200 }), 'timeout');
    await expectCode(fetchLocal(`${A()}/slow-body`, { timeoutMs: 200 }), 'timeout');
    expect(Date.now() - t0).toBeLessThan(2500);

    const ctl = new AbortController();
    later(100, () => ctl.abort());
    await expectCode(fetchLocal(`${A()}/slow`, { signal: ctl.signal }), 'aborted');
    await expectCode(fetchLocal(`${A()}/hello`, { signal: AbortSignal.abort() }), 'aborted');
  });

  it('reports broken connections as network errors', async () => {
    await expectCode(fetchLocal(`${A()}/hangup`), 'network_error');
    await expectCode(fetchLocal(`${A()}/truncated`, { timeoutMs: 5000 }), 'network_error');
    const closed = http.createServer();
    await new Promise<void>((resolve) => closed.listen(0, '127.0.0.1', resolve));
    const deadPort = (closed.address() as AddressInfo).port;
    await new Promise<void>((resolve) => closed.close(() => resolve()));
    await expectCode(fetchLocal(`http://site-a.test:${deadPort}/`), 'network_error');
  });

  it('the production safeFetch never reaches loopback', async () => {
    const before = hits.length;
    await expectCode(safeFetch(`http://127.0.0.1:${port}/hello`), 'blocked_ip');
    await expectCode(safeFetch(`http://localhost:${port}/hello`), 'blocked_host');
    await expectCode(safeFetch(`http://[::1]:${port}/hello`), 'blocked_ip');
    // The default policy also rejects loopback coming back from DNS.
    const viaDns = createSafeFetch({ resolver: testResolver });
    await expectCode(viaDns(`${A()}/hello`), 'blocked_ip');
    expect(hits.length).toBe(before);
  });
});
