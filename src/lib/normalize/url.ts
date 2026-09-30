/**
 * Canonical form of an apply / posting URL for "same link" dedup (spec §11.1): tracking
 * parameters removed, host lowercased, default port / credentials / fragment dropped, path
 * slashes collapsed, trailing slash removed, remaining parameters sorted, plus a few per-ATS
 * rules (Lever / Ashby / Workable "apply" sub-pages, LinkedIn and Indeed view URLs).
 *
 * The result is still a working link (scheme and www. are kept); unparseable or non-http input
 * is returned trimmed.
 */

export const URL_LOGIC_VERSION = 'url@2026-09-29.1';

/** Exact tracking / session parameter names (compared lowercase). */
const TRACKING_PARAMS: ReadonlySet<string> = new Set([
  // ad click ids
  'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'yclid', 'gbraid', 'wbraid', 'twclid', 'ttclid', 'li_fat_id', 'igshid',
  'epik', 'rdt_cid', 'scclid', 'irclickid', 'clickid', 'cjevent', 's_cid', 'ef_id', 'obclid', 'vmcid',
  // mail / marketing automation
  'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'hsctatracking', 'mkt_tok', 'et_cid', 'et_rid', 'vero_id', 'vero_conv', 'oly_anon_id',
  'oly_enc_id', 'rb_clickid', 'wt_mc', 'wt.mc_id', 'sc_o', 'sc_p', 'sc_cmp', 'cmpid', 'spm',
  // analytics
  '_ga', '_gl', '_ke', '_kx',
  // generic referral / source markers
  'ref', 'ref_', 'refid', 'ref_src', 'ref_url', 'referrer', 'referer', 'referral', 'referralsource', 'source', 'src', 'sourcetype',
  'source_type', 'sourceid', 'origin', 'via', 'from', 'share', 'shared', 'sharesource', 'share_source', 'campaign', 'campaignid',
  'campaign_id', 'adgroupid', 'adid', 'ad_id', 'creative', 'placement', 'affiliate', 'aff', 'aff_id',
  // ATS and job-board trackers
  'gh_src', 'lever-source', 'lever-source[]', 'lever-origin', 'lever-via', 'ashby_src', 'jobpipeline', 'trk', 'trkcampaign', 'trkinfo',
  'trackingid', 'tracking_id', 'trackid', 'originalsubdomain', 'ebp', 'recommendedflavor',
  'jsessionid', 'phpsessid', 'sessionid', 'session_id',
  // UI language of the same posting
  'lang', 'language', 'locale', 'hl',
]);

/** Tracking parameter prefixes (compared lowercase). */
const TRACKING_PREFIXES: readonly string[] = ['utm_', 'hsa_', 'pk_', 'mtm_', 'matomo_', 'piwik_', 'mc_', '_hs', '__hs', 'fb_', 'ga_', 'li_', 'ttc_', 'tt_', 'at_'];

/** Parameters that identify the job on some ATS and must survive even if they look generic. */
const KEEP_PARAMS: ReadonlySet<string> = new Set(['gh_jid', 'ashby_jid', 'jk', 'jobid', 'job_id', 'id', 'token', 'for', 'reqid', 'req_id', 'pid']);

/** True when a query parameter only tracks the visit and never selects content. */
export function isTrackingParam(name: string): boolean {
  const key = name.toLowerCase();
  if (KEEP_PARAMS.has(key)) return false;
  return TRACKING_PARAMS.has(key) || TRACKING_PREFIXES.some((p) => key.startsWith(p));
}

interface HostRule {
  host: RegExp;
  /** Rewrites the path (after slash normalisation). */
  path?: (path: string) => string;
  /** When set, only these parameters survive (lowercase names). */
  onlyParams?: ReadonlySet<string>;
}

/** Per-ATS / job-board rules: pages that are the same posting as the canonical page. */
const HOST_RULES: readonly HostRule[] = [
  // jobs.lever.co/acme/<uuid>/apply → the posting
  { host: /(^|\.)lever\.co$/, path: (p) => p.replace(/\/apply$/i, '') },
  // jobs.ashbyhq.com/acme/<uuid>/application
  { host: /(^|\.)ashbyhq\.com$/, path: (p) => p.replace(/\/application$/i, '') },
  // apply.workable.com/acme/j/<id>/apply
  { host: /(^|\.)workable\.com$/, path: (p) => p.replace(/\/apply$/i, '') },
  // job-boards.greenhouse.io and boards.greenhouse.io serve the same posting
  { host: /(^|\.)greenhouse\.io$/, path: (p) => p.replace(/\/application$/i, '') },
  // linkedin.com/jobs/view/<id>/?refId=…&trackingId=… — the id is in the path
  { host: /(^|\.)linkedin\.com$/, onlyParams: new Set(['currentjobid']) },
  // indeed.*/viewjob?jk=<key>&from=… — only jk selects the job
  { host: /(^|\.)indeed\.[a-z.]+$/, onlyParams: new Set(['jk', 'vjk']) },
];

const HOST_ALIASES: Readonly<Record<string, string>> = {
  'job-boards.greenhouse.io': 'boards.greenhouse.io',
  'job-boards.eu.greenhouse.io': 'boards.eu.greenhouse.io',
  'm.linkedin.com': 'www.linkedin.com',
  'linkedin.com': 'www.linkedin.com',
};

function withScheme(raw: string): string {
  if (raw.startsWith('//')) return `https:${raw}`;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(raw) && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?::\d+)?(?:[/?#]|$)/i.test(raw)) return `https://${raw}`;
  return raw;
}

/** Canonical form of an apply URL for "same link" dedup. Unparseable input is returned trimmed. */
export function cleanUrl(url: string): string {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(withScheme(raw));
  } catch {
    return raw;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return raw;

  // Hash routers ("#/jobs/123", "#!/job/1") carry the posting id; other fragments are anchors.
  const keepHash = /^#!?\//.test(u.hash) ? u.hash.replace(/\/+$/, '') : '';
  u.hash = '';
  u.username = '';
  u.password = '';
  let host = u.hostname.toLowerCase().replace(/\.+$/, '');
  host = HOST_ALIASES[host] ?? host;
  u.hostname = host;
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) u.port = '';

  const rule = HOST_RULES.find((r) => r.host.test(host));
  let path = u.pathname.replace(/\/{2,}/g, '/');
  if (path.length > 1) path = path.replace(/\/+$/, '') || '/';
  if (rule?.path) path = rule.path(path) || '/';
  u.pathname = path;

  const seen = new Set<string>();
  const keep: [string, string][] = [];
  for (const [k, v] of u.searchParams.entries()) {
    const key = k.toLowerCase();
    if (rule?.onlyParams ? !rule.onlyParams.has(key) : isTrackingParam(key)) continue;
    const pair = `${k}\u0000${v}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    keep.push([k, v]);
  }
  keep.sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0));
  u.search = '';
  for (const [k, v] of keep) u.searchParams.append(k, v);

  return `${u.href}${keepHash}`;
}

/** True when two URLs clean to the same link. */
export function sameLink(a: string, b: string): boolean {
  const ca = cleanUrl(a);
  return ca !== '' && ca === cleanUrl(b);
}

/** Lowercased host without "www.", or null for unparseable input ("careers.acme.com"). */
export function urlHost(url: string): string | null {
  const raw = typeof url === 'string' ? url.trim() : '';
  if (!raw) return null;
  try {
    const u = new URL(withScheme(raw));
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname.toLowerCase().replace(/\.+$/, '').replace(/^www\./, '') || null;
  } catch {
    return null;
  }
}
