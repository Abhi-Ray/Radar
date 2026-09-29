// STUB(NORMALIZE): minimal but real cleaner (tracking params, host case, fragment, trailing
// slash). Extend with per-ATS rules; keep the exported signature.

export const URL_LOGIC_VERSION = 'url-stub-0';

const TRACKING_PARAMS = new Set(['gclid', 'fbclid', 'msclkid', 'dclid', 'yclid', 'mc_cid', 'mc_eid', 'ref', 'referrer', 'source', 'src', '_hsenc', '_hsmi', 'igshid', 'trk', 'trackingid']);

/** Canonical form of an apply URL for "same link" dedup. Unparseable input is returned trimmed. */
export function cleanUrl(url: string): string {
  const raw = typeof url === 'string' ? url.trim() : '';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;
  u.hash = '';
  u.hostname = u.hostname.toLowerCase().replace(/\.$/, '');
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';
  const keep = [...u.searchParams.entries()].filter(([k]) => {
    const key = k.toLowerCase();
    return !key.startsWith('utm_') && !TRACKING_PARAMS.has(key);
  });
  keep.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) u.pathname = u.pathname.replace(/\/+$/, '') || '/';
  return u.href;
}
