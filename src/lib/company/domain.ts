/**
 * Company web domains: "https://careers.acme.co.uk/jobs?x=1", "jobs@acme.de" and "www.acme.com"
 * all reduce to the registrable domain ("acme.co.uk", "acme.de", "acme.com"). Domains that do not
 * identify an employer — ATS and job boards, free mail, form and link hosts — give null, so a
 * shared "greenhouse.io" never ties two companies together.
 */
import { compactKey } from './normalize';

/** Second-level labels under which registrations happen (acme.co.uk, acme.com.au …). */
const SECOND_LEVEL: ReadonlySet<string> = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'ltd.uk', 'plc.uk', 'me.uk', 'net.uk', 'co.jp', 'or.jp', 'ne.jp', 'ac.jp', 'co.kr', 'or.kr',
  'com.au', 'net.au', 'org.au', 'edu.au', 'gov.au', 'co.nz', 'org.nz', 'net.nz', 'com.br', 'net.br', 'org.br', 'com.mx', 'org.mx',
  'com.ar', 'com.co', 'com.pe', 'com.uy', 'com.tr', 'com.cn', 'com.hk', 'com.sg', 'com.my', 'com.tw', 'com.ph', 'com.vn', 'co.in',
  'net.in', 'org.in', 'co.id', 'co.th', 'co.za', 'org.za', 'co.il', 'org.il', 'com.pl', 'net.pl', 'org.pl', 'com.es', 'org.es',
  'com.pt', 'com.gr', 'com.cy', 'com.mt', 'co.at', 'or.at', 'ac.at', 'gv.at', 'com.ua', 'com.ru', 'com.eg', 'com.sa', 'com.qa',
  'com.kw', 'com.bh', 'com.om', 'co.ae', 'com.ng', 'co.ke', 'com.pk', 'com.bd', 'com.lk', 'com.np', 'co.cr', 'com.ro', 'com.hr',
  'co.hu', 'com.de', 'com.fr', 'com.lu', 'com.be', 'co.no', 'com.ee', 'com.lv', 'com.lt',
]);

/** Registrable domains that host many employers or no employer at all. */
const GENERIC_DOMAINS: ReadonlySet<string> = new Set([
  // ATS / hiring tools
  'greenhouse.io', 'lever.co', 'ashbyhq.com', 'workable.com', 'smartrecruiters.com', 'myworkdayjobs.com', 'myworkdaysite.com',
  'workday.com', 'personio.de', 'personio.com', 'recruitee.com', 'teamtailor.com', 'bamboohr.com', 'jobvite.com',
  'icims.com', 'taleo.net', 'successfactors.com', 'successfactors.eu', 'sapsf.com', 'sapsf.eu', 'breezy.hr', 'join.com', 'softgarden.io',
  'softgarden.de', 'rexx-systems.com', 'onlyfy.jobs', 'prescreen.io', 'jobylon.com', 'homerun.co', 'pinpointhq.com', 'comeet.co',
  'comeet.com', 'jazzhr.com', 'applytojob.com', 'zohorecruit.com', 'zohorecruit.eu', 'rippling-ats.com', 'adp.com', 'ultipro.com',
  'paylocity.com', 'dayforcehcm.com', 'oraclecloud.com', 'eightfold.ai', 'phenompeople.com', 'avature.net', 'csod.com',
  'cornerstoneondemand.com', 'hibob.com', 'kenjo.io', 'dvinci.de', 'dvinci-easy.com', 'umantis.com', 'concludis.de', 'traffit.com',
  'recruitcrm.io', 'manatal.com', 'freshteam.com', 'hirehive.com', 'hire.trakstar.com', 'trakstar.com', 'gem.com', 'dover.com',
  'welcomekit.co', 'occupop.com', 'talentlyft.com', 'erecruiter.pl', 'emply.com', 'hr-manager.net', 'varbi.com', 'reachmee.com',
  'jobs.personio.de', 'factorialhr.com', 'workwise.io', 'jobbase.io', 'recruiterbox.com', 'polymer.co', 'bullhornstaffing.com',
  // Job boards / aggregators / social
  'stepstone.de', 'stepstone.com', 'indeed.com', 'indeed.de', 'linkedin.com', 'lnkd.in', 'glassdoor.com', 'glassdoor.de', 'xing.com',
  'monster.com', 'monster.de', 'arbeitnow.com', 'remotive.com', 'remotive.io', 'weworkremotely.com', 'remoteok.com', 'remoteok.io',
  'himalayas.app', 'wellfound.com', 'angel.co', 'workatastartup.com', 'otta.com', 'welcometothejungle.com', 'jobs.ch', 'karriere.at',
  'stackoverflow.com', 'github.com', 'github.io', 'gitlab.com', 'gitlab.io', 'bundesagentur.de', 'arbeitsagentur.de', 'eures.europa.eu',
  'europa.eu', 'jobteaser.com', 'totaljobs.com', 'reed.co.uk', 'cv-library.co.uk', 'jobsite.co.uk', 'adzuna.com', 'jooble.org',
  'talent.com', 'careerjet.com', 'jobrapido.com', 'ziprecruiter.com', 'dice.com', 'builtin.com',
  'upwork.com', 'freelancer.com', 'malt.com', 'malt.de', 'malt.fr', 'freelancermap.de', 'gulp.de', 'jobs.lever.co', 'pracuj.pl',
  'nofluffjobs.com', 'justjoin.it', 'jobs.cz', 'profesia.sk', 'infojobs.net', 'infojobs.it', 'indeed.co.uk', 'jobindex.dk', 'finn.no',
  'arbetsformedlingen.se', 'duunitori.fi', 'nationalevacaturebank.nl', 'werk.nl', 'apec.fr', 'welcome-to-the-jungle.com',
  'facebook.com', 'instagram.com', 'twitter.com', 'x.com', 't.co', 'youtube.com', 'medium.com', 'substack.com', 'discord.com',
  'discord.gg', 'slack.com', 'telegram.org', 't.me', 'whatsapp.com', 'reddit.com',
  // Free mail
  'gmail.com', 'googlemail.com', 'outlook.com', 'outlook.de', 'hotmail.com', 'hotmail.de', 'hotmail.co.uk', 'hotmail.fr', 'live.com',
  'live.de', 'msn.com', 'yahoo.com', 'yahoo.de', 'yahoo.co.uk', 'yahoo.fr', 'ymail.com', 'icloud.com', 'me.com', 'mac.com',
  'gmx.de', 'gmx.net', 'gmx.at', 'gmx.ch', 'gmx.com', 'web.de', 't-online.de', 'freenet.de', 'posteo.de', 'mailbox.org', 'proton.me',
  'protonmail.com', 'pm.me', 'aol.com', 'mail.com', 'orange.fr', 'free.fr', 'laposte.net', 'sfr.fr', 'libero.it', 'virgilio.it',
  'wp.pl', 'o2.pl', 'onet.pl', 'interia.pl', 'seznam.cz', 'centrum.cz', 'yandex.com', 'yandex.ru', 'mail.ru', 'tutanota.com',
  'hey.com', 'fastmail.com', 'zoho.eu',
  // Forms, link shorteners, site builders, hosting
  'forms.gle', 'goo.gl', 'bit.ly', 'tinyurl.com', 'ow.ly', 'buff.ly', 'rebrand.ly', 'typeform.com', 'jotform.com', 'tally.so',
  'notion.site', 'notion.so', 'wixsite.com', 'webflow.io', 'squarespace.com', 'wordpress.com', 'blogspot.com', 'carrd.co',
  'herokuapp.com', 'vercel.app', 'netlify.app', 'pages.dev', 'framer.website', 'framer.ai', 'sharepoint.com', 'office.com',
  'microsoft365.com', 'surveymonkey.com', 'calendly.com', 'dropbox.com', 'box.com', 'wetransfer.com', 'airtable.com',
  'example.com', 'example.org', 'localhost',
]);

/** Hosts of big companies that also serve other people's content (docs.google.com is not Google hiring). */
const GENERIC_HOSTS: ReadonlySet<string> = new Set([
  'docs.google.com', 'forms.google.com', 'sites.google.com', 'drive.google.com', 'jobs.google.com',
  'forms.office.com', 'forms.microsoft.com', 'apps.apple.com', 'play.google.com', 'jobs.smartrecruiters.com', 'boards.greenhouse.io',
  'job-boards.greenhouse.io', 'jobs.ashbyhq.com', 'apply.workable.com',
]);

const HOST_RE = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;

function hostOf(input: string): string | null {
  let s = String(input ?? '').trim().toLowerCase();
  if (!s) return null;
  const at = s.lastIndexOf('@');
  if (at !== -1 && !s.includes('/')) s = s.slice(at + 1);
  else if (s.startsWith('mailto:')) s = s.slice(7).split('@').pop() ?? '';
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `http://${s}`;
  let host: string;
  try {
    host = new URL(s).hostname;
  } catch {
    return null;
  }
  // URL gives IDNs as punycode; anything else that is not a plain host name is rejected.
  host = host.replace(/\.+$/, '');
  if (!HOST_RE.test(host)) return null;
  if (/^\d+(?:\.\d+){3}$/.test(host)) return null;
  return host;
}

/** "careers.acme.co.uk" → "acme.co.uk". */
export function registrableDomain(host: string): string {
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  const last2 = labels.slice(-2).join('.');
  if (SECOND_LEVEL.has(last2)) return labels.slice(-3).join('.');
  return last2;
}

/**
 * Registrable domain of a URL, host or e-mail address, lowercased and without "www."; null for
 * invalid input, IP addresses and generic domains (ATS, job boards, free mail, forms).
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  if (!input) return null;
  const host = hostOf(input);
  if (!host) return null;
  const bare = host.replace(/^(?:www\d?|m)\./, '');
  if (GENERIC_HOSTS.has(bare)) return null;
  const reg = registrableDomain(bare);
  if (GENERIC_DOMAINS.has(reg) || GENERIC_DOMAINS.has(bare)) return null;
  if (!reg.includes('.')) return null;
  return reg.slice(0, 191);
}

export function isGenericDomain(input: string): boolean {
  const host = hostOf(input);
  if (!host) return false;
  const bare = host.replace(/^(?:www\d?|m)\./, '');
  return GENERIC_HOSTS.has(bare) || GENERIC_DOMAINS.has(registrableDomain(bare)) || GENERIC_DOMAINS.has(bare);
}

/** The name part of a registrable domain ("acme.co.uk" → "acme", "acme-robotics.de" → "acme-robotics"). */
export function domainLabel(domain: string): string {
  const reg = registrableDomain(domain);
  const labels = reg.split('.');
  return labels.length >= 3 && SECOND_LEVEL.has(labels.slice(-2).join('.')) ? labels[labels.length - 3] : labels[0];
}

/**
 * Two company domains that may belong to one company: the same registrable domain, or the same
 * name under another country ending ("acme.de" / "acme.co.uk").
 */
export function domainsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return true;
  if (a === b) return true;
  return domainLabel(a) === domainLabel(b);
}

/** The domain spells the company name ("Acme Robotics" ↔ acmerobotics.com / acme-robotics.de). */
export function domainMatchesName(domain: string, normalizedName: string): boolean {
  const label = compactKey(domainLabel(domain));
  const name = compactKey(normalizedName);
  if (!label || !name) return false;
  if (label === name) return true;
  const shorter = label.length < name.length ? label : name;
  const longer = label.length < name.length ? name : label;
  return shorter.length >= 4 && longer.startsWith(shorter);
}
