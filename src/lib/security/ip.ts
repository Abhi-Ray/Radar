/**
 * IP literal parsing (pure, dependency-free: env.ts validates SAFE_FETCH_DENY_IPS with it, and
 * safe-fetch.ts classifies addresses with it).
 */

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

/**
 * Canonical text form of an IP literal (null when it is none): IPv4 as dotted quad, IPv6 as eight
 * lower-case hex groups without zero compression. IPv4-mapped IPv6 (::ffff:a.b.c.d) → the IPv4.
 */
export function canonicalIp(input: string): string | null {
  const v4 = parseIPv4(input.trim());
  if (v4 !== null) return ipv4ToString(v4);
  const g = parseIPv6(input);
  if (!g) return null;
  if (g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff) return ipv4ToString(((g[6] << 16) >>> 0) + g[7]);
  return g.map((x) => x.toString(16)).join(':');
}

export function ipv4ToString(n: number): string {
  return [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff].join('.');
}
