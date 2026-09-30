/**
 * Country seed (spec §4 tiers + the Remote / Worldwide pseudo-country 'XW', tier 0) with the
 * country-guide content the /countries pages show: salary ranges, best local job sites, language
 * notes and CV conventions.
 *
 * Honesty rules for this file:
 * - Every salary figure is an ESTIMATE (basis 'estimate'), derived from the RADAR indicative table
 *   in src/data/salary/estimates.ts (public salary surveys, rounded; the 2–5-year band). Junior and
 *   senior bands are derived from it with fixed multipliers; non-EUR countries are converted to EUR
 *   at the approximate rates below. They are guide figures, never used as stated pay.
 * - Job sites marked `manualOnly` (LinkedIn, Indeed, Glassdoor) are for browsing by hand — their
 *   terms forbid scraping and RADAR never fetches them (spec §7.3).
 * - `isLive` is always false: a country goes live only when its visa rules are verified by the
 *   owner and its sources pass the checklist (spec §4, §7.4).
 *
 * Content compiled 2026-09-30 by the build assistant; the owner should review it.
 */
import { REMOTE_COUNTRY, TIER_1_COUNTRIES, TIER_2_COUNTRIES, TIER_3_COUNTRIES, TIER_4_COUNTRIES } from '../../lib/contracts/settings';
import { ESTIMATES_AS_OF, ESTIMATES_SOURCE, SALARY_ESTIMATES } from '../salary/estimates';

export const COUNTRY_GUIDES_AS_OF = '2026-09-30';

/**
 * Approximate units of local currency per 1 EUR (rounded mid-2026 levels), used ONLY to show the
 * guide's salary estimates in EUR. The pipeline uses ECB daily rates for real conversions.
 */
export const GUIDE_FX_PER_EUR: Readonly<Record<string, number>> = {
  EUR: 1,
  DKK: 7.46,
  SEK: 11.0,
  NOK: 11.6,
  CZK: 24.6,
  PLN: 4.25,
  RON: 5.05,
  HUF: 395,
  GBP: 0.86,
  CHF: 0.93,
  CAD: 1.58,
  USD: 1.15,
  AUD: 1.75,
  NZD: 1.93,
  SGD: 1.48,
  JPY: 168,
  KRW: 1580,
  AED: 4.22,
  ILS: 3.9,
  HKD: 9.0,
  ISK: 143,
  SAR: 4.31,
  QAR: 4.19,
  TWD: 35.5,
  MYR: 4.95,
  BRL: 6.3,
  MXN: 21.5,
};

export interface SeedSalaryRange {
  label: string;
  currency: 'EUR';
  min: number;
  max: number;
  basis: 'estimate';
  source: string;
  asOf: string;
  note: string;
}

export interface SeedSalaryRanges {
  currency: 'EUR';
  ranges: SeedSalaryRange[];
}

export interface SeedJobSite {
  name: string;
  url: string;
  note: string;
  /** Terms forbid automated access: browse by hand only. */
  manualOnly?: boolean;
}

export interface SeedCvConventions {
  length: string;
  photo: string;
  personalDetails: string;
  language: string;
  format: string;
  coverLetter?: string;
  references?: string;
  notes?: string[];
}

export interface SeedCountry {
  iso2: string;
  name: string;
  tier: 0 | 1 | 2 | 3 | 4;
  region: string;
  currency: string | null;
  /** Official / national languages (English names). */
  languages: string[];
  isLive: false;
  notes: string;
  salaryRanges: SeedSalaryRanges | null;
  bestSites: SeedJobSite[];
  cvConventions: SeedCvConventions;
  languageNotes: string;
}

// ---- shared site entries --------------------------------------------------------------------

const LINKEDIN: SeedJobSite = {
  name: 'LinkedIn Jobs',
  url: 'https://www.linkedin.com/jobs/',
  note: 'Manual only — LinkedIn terms forbid scraping; RADAR never fetches it. Use it to cross-check postings and find recruiters.',
  manualOnly: true,
};
const INDEED: SeedJobSite = {
  name: 'Indeed',
  url: 'https://www.indeed.com/',
  note: 'Manual only — Indeed terms forbid automated access; RADAR never fetches it.',
  manualOnly: true,
};
const GLASSDOOR: SeedJobSite = {
  name: 'Glassdoor',
  url: 'https://www.glassdoor.com/',
  note: 'Manual only — Glassdoor terms forbid scraping; useful for salary and interview reports by hand.',
  manualOnly: true,
};
const MANUAL = [LINKEDIN, INDEED, GLASSDOOR];

const site = (name: string, url: string, note: string): SeedJobSite => ({ name, url, note });

// ---- salary derivation ------------------------------------------------------------------------

const JUNIOR = [0.72, 0.95] as const;
const SENIOR = [1.05, 1.4] as const;

function roundK(eur: number): number {
  return Math.round(eur / 1000) * 1000;
}

/** Cloud security / DevSecOps bands in EUR from the RADAR indicative table (null when absent). */
export function securitySalaryRanges(iso2: string, crossCheck: string): SeedSalaryRanges | null {
  const est = SALARY_ESTIMATES[iso2];
  if (!est) return null;
  const fx = GUIDE_FX_PER_EUR[est.currency];
  if (!fx) return null;
  const [lo, hi] = est.security;
  const eurLo = lo / fx;
  const eurHi = hi / fx;
  const local = est.currency === 'EUR' ? '' : ` Local: ${est.currency} ${lo.toLocaleString('en-GB')}–${hi.toLocaleString('en-GB')} (mid band), converted at ≈${fx} ${est.currency}/EUR.`;
  const source = `${ESTIMATES_SOURCE}; cross-check: ${crossCheck}`;
  const make = (label: string, min: number, max: number, how: string): SeedSalaryRange => ({
    label,
    currency: 'EUR',
    min: roundK(min),
    max: roundK(max),
    basis: 'estimate',
    source,
    asOf: ESTIMATES_AS_OF,
    note: `Estimate, annual gross. ${how}${local}`,
  });
  return {
    currency: 'EUR',
    ranges: [
      make('Cloud security / DevSecOps — junior (0–2 yrs)', eurLo * JUNIOR[0], eurLo * JUNIOR[1], 'Derived from the mid band (×0.72–0.95 of its lower end).'),
      make('Cloud security / DevSecOps — mid (2–5 yrs)', eurLo, eurHi, 'The RADAR table band (≈25th–75th percentile).'),
      make('Cloud security / DevSecOps — senior (5+ yrs)', eurHi * SENIOR[0], eurHi * SENIOR[1], 'Derived from the mid band (×1.05–1.4 of its upper end).'),
      {
        ...make('Full-stack / Node / Next.js — mid (2–5 yrs, fallback track)', est.development[0] / fx, est.development[1] / fx, 'The RADAR table development band.'),
        note: `Estimate, annual gross. The RADAR table development band.${est.currency === 'EUR' ? '' : ` Local: ${est.currency} ${est.development[0].toLocaleString('en-GB')}–${est.development[1].toLocaleString('en-GB')}, converted at ≈${fx} ${est.currency}/EUR.`}`,
      },
    ],
  };
}

// ---- CV convention presets ----------------------------------------------------------------------

const CV_EU_NEUTRAL: SeedCvConventions = {
  length: '1–2 pages',
  photo: 'Optional; leave it out for international tech companies',
  personalDetails: 'Name, city, phone, email, LinkedIn/GitHub. Nationality/work-permit status optional; no marital status',
  language: 'English is accepted by international tech employers; use the local language for local companies',
  format: 'Reverse-chronological, skills section near the top, PDF',
  coverLetter: 'Short motivation letter (half to one page) when the form asks for it',
  references: 'On request',
};

const CV_CEE: SeedCvConventions = {
  ...CV_EU_NEUTRAL,
  photo: 'Common in local companies, optional for international ones',
  notes: ['Many local employers expect a GDPR consent clause at the bottom of the CV (data-processing consent for recruitment).'],
};

const CV_NORDIC: SeedCvConventions = {
  length: '1–2 pages',
  photo: 'Optional (fairly common in Sweden/Denmark); fine to leave out',
  personalDetails: 'Name, city, phone, email, LinkedIn/GitHub; no date of birth needed',
  language: 'English is fine for tech roles; Nordic-language CV only for local-language roles',
  format: 'Concise, reverse-chronological, a short personal profile at the top, PDF',
  coverLetter: 'Short and personal: why this team, how you work; avoid formal boilerplate',
  references: 'Usually 2 referees asked for late in the process',
};

const CV_NORTH_AMERICA: SeedCvConventions = {
  length: '1 page (up to 2 pages with 5+ years)',
  photo: 'Never — anti-discrimination norms',
  personalDetails: 'Name, city/region, phone, email, LinkedIn/GitHub. No date of birth, marital status, photo or nationality; state work-authorisation needs only if asked',
  language: 'English (French too for Québec roles)',
  format: 'Achievement bullets with numbers, ATS-friendly single column, PDF or DOCX',
  coverLetter: 'Often optional; keep it short and specific',
  references: 'Not on the resume; provide when asked',
};

const CV_ANZ: SeedCvConventions = {
  length: '2–3 pages',
  photo: 'No',
  personalDetails: 'Name, city, phone, email, LinkedIn; visa/work-rights status is commonly stated',
  language: 'English',
  format: 'Reverse-chronological with a key-skills summary, PDF',
  coverLetter: 'Expected for most applications, one page',
  references: 'Two referees, often listed at the end or "available on request"',
};

const CV_GULF: SeedCvConventions = {
  length: '2 pages',
  photo: 'Common',
  personalDetails: 'Name, phone, email, nationality and current visa status are usually expected; date of birth common',
  language: 'English',
  format: 'Reverse-chronological, certifications prominent (e.g. CISSP, AWS), PDF',
  coverLetter: 'Short cover note',
  references: 'On request',
};

const CV_EAST_ASIA_INTL: SeedCvConventions = {
  length: '1–2 pages',
  photo: 'Common for local companies; leave out for international ones',
  personalDetails: 'Name, phone, email, nationality and visa status often included',
  language: 'English for international employers; local language for local companies',
  format: 'Reverse-chronological, PDF',
  coverLetter: 'Short cover note',
  references: 'On request',
};

// ---- the countries --------------------------------------------------------------------------------

const EURO_CROSS = 'national statistics office pay data, Levels.fyi, Glassdoor (by hand)';

type CountryInput = Omit<SeedCountry, 'tier' | 'isLive' | 'salaryRanges'> & { crossCheck?: string };

const INPUT: readonly CountryInput[] = [
  // ─────────────────────────── Tier 1 ───────────────────────────
  {
    iso2: 'DE', name: 'Germany', region: 'Western Europe', currency: 'EUR', languages: ['German'],
    notes: 'Largest EU tech market (Berlin, Munich, Hamburg, Frankfurt). Non-EU routes: EU Blue Card (reduced threshold for ICT/shortage occupations and new entrants), §18g Blue Card for IT specialists without a degree (3 of the last 7 years in IT), §18b skilled worker with a recognised degree, and the Chancenkarte job-search card. Degree recognition: check anabin (KMK) for the university/degree.',
    crossCheck: 'Destatis earnings data, StepStone Gehaltsreport, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('StepStone', 'https://www.stepstone.de/', 'Largest German job board; many corporate security roles.'),
      site('Bundesagentur für Arbeit — Jobbörse', 'https://www.arbeitsagentur.de/jobsuche/', 'Official federal job board; RADAR reads it through the Jobsuche API.'),
      site('XING Jobs', 'https://www.xing.com/jobs', 'German professional network; recruiters active.'),
      site('Arbeitnow', 'https://www.arbeitnow.com/', 'English-friendly jobs, visa-sponsorship filter; RADAR reads its public API.'),
      site('GermanTechJobs', 'https://germantechjobs.de/', 'Tech-only board with salary ranges.'),
      site('Berlin Startup Jobs', 'https://berlinstartupjobs.com/', 'Berlin startups, mostly English-speaking.'),
      site('Make it in Germany — job listings', 'https://www.make-it-in-germany.com/en/working-in-germany/job-listings', 'Government portal for international skilled workers.'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '1–2 pages (tabular Lebenslauf)',
      photo: 'Traditional but optional (AGG anti-discrimination law); international tech companies prefer none',
      personalDetails: 'Name, address/city, phone, email, LinkedIn/GitHub; date of birth and nationality optional; no marital status or religion',
      language: 'English for English-language postings; German CV + Anschreiben for German-language postings',
      format: 'Reverse-chronological, tabular with month/year dates, gaps explained; PDF bundle (CV, letter, certificates)',
      coverLetter: 'Formal Anschreiben, one page, addressed to a named person where possible',
      references: 'Arbeitszeugnisse (employer references) and degree certificates are often requested; mention anabin recognition',
      notes: ['Put the degree recognition status (anabin H+ university, Zeugnisbewertung if you have one) in the education section.'],
    },
    languageNotes: 'German is the working language in most Mittelstand and public-sector employers. English-only teams are common at Berlin and Munich tech companies and at scale-ups; security/GRC roles in banks, insurers and public bodies usually need German (B2+). Listing German (A2/B1 in progress) helps.',
  },
  {
    iso2: 'NL', name: 'Netherlands', region: 'Western Europe', currency: 'EUR', languages: ['Dutch'],
    notes: 'Amsterdam, Rotterdam, Eindhoven and Utrecht hubs; English widely used in tech. Highly skilled migrant (kennismigrant) permit requires an IND-recognised sponsor; salary criteria by age (30+ / under 30). EU Blue Card is an alternative. The 30% ruling (tax) may apply to incoming skilled workers.',
    crossCheck: 'CBS pay statistics, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('IND public register of recognised sponsors', 'https://ind.nl/en/public-register-recognised-sponsors', 'Check the employer is a recognised sponsor before applying.'),
      site('werk.nl (UWV)', 'https://www.werk.nl/', 'Official Dutch employment service vacancies.'),
      site('Nationale Vacaturebank', 'https://www.nationalevacaturebank.nl/', 'Large Dutch job board.'),
      site('IamExpat Jobs', 'https://www.iamexpat.nl/career/jobs-netherlands', 'English-language jobs for internationals.'),
      site('Undutchables', 'https://www.undutchables.nl/', 'Recruiter for international (non-Dutch-speaking) candidates.'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '1–2 pages',
      photo: 'Optional; not expected in tech',
      personalDetails: 'Name, city, phone, email, LinkedIn/GitHub; nationality/permit status optional; no marital status',
      language: 'English is standard in tech',
      format: 'Direct and factual; reverse-chronological; PDF',
      coverLetter: 'Concise motivation (a few paragraphs); Dutch style values directness over formality',
      references: 'On request',
    },
    languageNotes: 'English is the default working language in most tech companies and scale-ups; Dutch is a plus for public sector, banks and customer-facing roles.',
  },
  {
    iso2: 'IE', name: 'Ireland', region: 'Western Europe', currency: 'EUR', languages: ['English', 'Irish'],
    notes: 'EMEA headquarters of many US tech/security companies (Dublin, Cork). Critical Skills Employment Permit covers ICT roles on the Critical Skills Occupations List (lower threshold with a relevant degree) and leads to Stamp 4; General Employment Permit needs a labour market needs test below the higher threshold.',
    crossCheck: 'CSO earnings data, Hays/Morgan McKinley salary guides, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('IrishJobs.ie', 'https://www.irishjobs.ie/', 'Largest Irish job board.'),
      site('Jobs.ie', 'https://www.jobs.ie/', 'Irish job board.'),
      site('Recruit Ireland', 'https://www.recruitireland.com/', 'Irish job board, tech section.'),
      site('Silicon Republic Jobs', 'https://www.siliconrepublic.com/jobs', 'Irish tech news site with a jobs section.'),
      site('Employment permit statistics (DETE)', 'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/statistics/', 'Employers that received permits — a sponsor signal.'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '2 pages',
      photo: 'No',
      personalDetails: 'Name, phone, email, LinkedIn/GitHub, city; no date of birth, marital status or photo; state permit needs (e.g. "requires Critical Skills Employment Permit") briefly',
      language: 'English',
      format: 'Reverse-chronological, achievement bullets, PDF',
      coverLetter: 'One page, specific to the role; mention the permit route you qualify for',
      references: '"Available on request"',
    },
    languageNotes: 'English-speaking market; Irish is not needed for private-sector tech roles.',
  },
  {
    iso2: 'FR', name: 'France', region: 'Western Europe', currency: 'EUR', languages: ['French'],
    notes: 'Paris is the main hub (plus Lyon, Toulouse, Nice/Sophia Antipolis). Non-EU route: Passeport Talent — carte bleue européenne (degree of 3+ years or 5 years of experience; salary threshold 1.5× the average reference salary).',
    crossCheck: 'INSEE earnings data, APEC salary studies, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('Welcome to the Jungle', 'https://www.welcometothejungle.com/fr/jobs', 'Startup and scale-up jobs, many in English.'),
      site('France Travail', 'https://www.francetravail.fr/', 'Official French employment service (formerly Pôle emploi).'),
      site('APEC', 'https://www.apec.fr/', 'Jobs for cadres (managers/engineers).'),
      site('HelloWork', 'https://www.hellowork.com/', 'Large French job board.'),
      site('Free-Work', 'https://www.free-work.com/', 'IT jobs and freelance missions.'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '1 page (2 with 5+ years)',
      photo: 'Common but optional; leave out for international companies',
      personalDetails: 'Name, city, phone, email, LinkedIn; age/date of birth optional; no marital status needed',
      language: 'French CV + lettre de motivation for French companies; English for international teams',
      format: 'Clear sections (Expérience, Formation, Compétences, Langues), reverse-chronological, PDF',
      coverLetter: 'Formal lettre de motivation (vous/moi/nous structure) when requested',
      references: 'Rarely requested up front',
      notes: ['Give the French-equivalent level of your degree (e.g. "Bac+4, B.Tech") — recruiters think in Bac+N.'],
    },
    languageNotes: 'French is the working language in most companies; English-only roles exist mainly in Paris scale-ups and US/UK tech offices. Security/GRC roles in banks and public bodies usually require fluent French.',
  },
  {
    iso2: 'ES', name: 'Spain', region: 'Southern Europe', currency: 'EUR', languages: ['Spanish', 'Catalan', 'Basque', 'Galician'],
    notes: 'Madrid, Barcelona, Valencia and Málaga hubs. Highly qualified professional / EU Blue Card route via the Unidad de Grandes Empresas (Ley 14/2013). Lower salaries than northern Europe; many remote-first companies hire here.',
    crossCheck: 'INE earnings data, Manfred salary report, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('InfoJobs', 'https://www.infojobs.net/', 'Largest Spanish job board.'),
      site('Tecnoempleo', 'https://www.tecnoempleo.com/', 'IT-only job board.'),
      site('Manfred', 'https://www.getmanfred.com/', 'Tech recruiting platform with salary transparency.'),
      site('Welcome to the Jungle (ES)', 'https://www.welcometothejungle.com/es/jobs', 'Startup jobs.'),
      ...MANUAL,
    ],
    cvConventions: {
      ...CV_EU_NEUTRAL,
      photo: 'Common in local companies; optional for international ones',
      language: 'Spanish for local companies; English for international tech teams',
    },
    languageNotes: 'Spanish is needed in most local companies; English-speaking teams are common in Barcelona and Madrid tech hubs and remote-first firms.',
  },
  {
    iso2: 'PT', name: 'Portugal', region: 'Southern Europe', currency: 'EUR', languages: ['Portuguese'],
    notes: 'Lisbon and Porto tech hubs with many international companies. Routes: highly qualified activity residence permit (Art. 90.º), Tech Visa for IAPMEI-certified companies, and the EU Blue Card. Salaries are lower than in northern Europe.',
    crossCheck: 'INE / Pordata earnings data, Landing.jobs tech salary report, Glassdoor (by hand)',
    bestSites: [
      site('ITJobs.pt', 'https://www.itjobs.pt/', 'IT-only job board.'),
      site('Landing.jobs', 'https://landing.jobs/', 'Tech jobs in Portugal, relocation-friendly.'),
      site('Net-Empregos', 'https://www.net-empregos.com/', 'Large Portuguese job board.'),
      site('IEFP', 'https://iefponline.iefp.pt/', 'Official Portuguese employment service.'),
      ...MANUAL,
    ],
    cvConventions: {
      ...CV_EU_NEUTRAL,
      photo: 'Common in local companies; optional for international ones',
      format: 'Reverse-chronological or Europass, PDF',
      language: 'English is widely accepted in tech; Portuguese for local companies',
    },
    languageNotes: 'English is widely used in Lisbon/Porto tech and at international companies; Portuguese is needed for public sector and many local firms.',
  },
  {
    iso2: 'BE', name: 'Belgium', region: 'Western Europe', currency: 'EUR', languages: ['Dutch', 'French', 'German'],
    notes: 'Brussels (EU institutions, consultancies), Antwerp and Ghent. Single permit for highly qualified workers or EU Blue Card, handled by the region where you will work (Flanders, Wallonia, Brussels).',
    crossCheck: 'Statbel earnings data, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('VDAB', 'https://www.vdab.be/vindeenjob', 'Flemish public employment service.'),
      site('Actiris', 'https://www.actiris.brussels/', 'Brussels public employment service.'),
      site('Le Forem', 'https://www.leforem.be/', 'Walloon public employment service.'),
      site('ICTjob.be', 'https://www.ictjob.be/', 'IT-only job board.'),
      site('StepStone Belgium', 'https://www.stepstone.be/', 'Large job board.'),
      site('Jobat', 'https://www.jobat.be/', 'Flemish job board.'),
      ...MANUAL,
    ],
    cvConventions: {
      ...CV_EU_NEUTRAL,
      notes: ['List every language with a level (Dutch, French, English, German) — Belgian recruiters check it first.'],
    },
    languageNotes: 'Dutch (Flanders) or French (Wallonia/Brussels) is often required; English-only roles exist in Brussels international firms and EU-facing consultancies.',
  },
  {
    iso2: 'LU', name: 'Luxembourg', region: 'Western Europe', currency: 'EUR', languages: ['Luxembourgish', 'French', 'German'],
    notes: 'Financial centre with strong security/compliance demand (banks, funds, EU institutions). EU Blue Card via the Guichet.lu highly qualified worker route. High salaries and high cost of living; many staff commute from FR/BE/DE.',
    crossCheck: 'STATEC earnings data, Glassdoor (by hand)',
    bestSites: [
      site('Jobs.lu', 'https://www.jobs.lu/', 'Main Luxembourg job board.'),
      site('Moovijob', 'https://www.moovijob.com/', 'Greater Region job board (LU/FR/BE/DE).'),
      site('ADEM', 'https://adem.public.lu/', 'Official Luxembourg employment agency.'),
      ...MANUAL,
    ],
    cvConventions: {
      ...CV_EU_NEUTRAL,
      photo: 'Common',
      language: 'English or French; list French/German/Luxembourgish levels',
      notes: ['Regulated finance roles value certifications (CISSP, CISM, ISO 27001 LA) — list them near the top.'],
    },
    languageNotes: 'English is common in finance and tech; French is the main business language, German helps. Luxembourgish is rarely required in private tech roles.',
  },
  {
    iso2: 'AT', name: 'Austria', region: 'Western Europe', currency: 'EUR', languages: ['German'],
    notes: 'Vienna, Graz and Linz. Red-White-Red Card for key workers (points system) or the EU Blue Card (degree or, for ICT, 3 years of experience).',
    crossCheck: 'Statistik Austria earnings data, karriere.at Gehaltsrechner, Glassdoor (by hand)',
    bestSites: [
      site('AMS alle jobs', 'https://jobs.ams.at/', 'Official Austrian employment service job search.'),
      site('karriere.at', 'https://www.karriere.at/', 'Large Austrian job board.'),
      site('StepStone Austria', 'https://www.stepstone.at/', 'Large job board.'),
      site('derStandard Karriere', 'https://jobs.derstandard.at/', 'Newspaper job board.'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '1–2 pages (tabular Lebenslauf)',
      photo: 'Common in Austria; optional for international companies',
      personalDetails: 'Name, address, phone, email; date of birth commonly given; no marital status needed',
      language: 'German for most employers; English for international tech teams',
      format: 'Tabular, reverse-chronological, PDF',
      coverLetter: 'Formal Motivationsschreiben, one page',
      references: 'Dienstzeugnisse (employer references) may be requested',
    },
    languageNotes: 'German is required in most companies outside Vienna startups and international firms; English-only security roles are rarer than in Germany.',
  },
  {
    iso2: 'IT', name: 'Italy', region: 'Southern Europe', currency: 'EUR', languages: ['Italian'],
    notes: 'Milan is the main tech/finance hub, then Rome, Turin and Bologna. EU Blue Card (carta blu UE) exists; entry for many non-EU workers depends on the annual decreto flussi quotas. Lower salaries than northern Europe.',
    crossCheck: 'ISTAT earnings data, JobPricing observatory, Glassdoor (by hand)',
    bestSites: [
      site('InfoJobs Italia', 'https://www.infojobs.it/', 'Large Italian job board.'),
      site('Monster Italia', 'https://www.monster.it/', 'Job board.'),
      ...MANUAL,
    ],
    cvConventions: {
      ...CV_EU_NEUTRAL,
      length: '2 pages',
      format: 'Europass is common; reverse-chronological, PDF',
      notes: ['Italian employers expect a GDPR consent line at the bottom ("Autorizzo il trattamento dei miei dati personali ai sensi del Regolamento UE 2016/679").'],
    },
    languageNotes: 'Italian is required in most companies; English-only roles exist mainly at multinationals in Milan.',
  },

  // ─────────────────────────── Tier 2 ───────────────────────────
  {
    iso2: 'DK', name: 'Denmark', region: 'Nordics', currency: 'DKK', languages: ['Danish'],
    notes: 'Copenhagen and Aarhus. Pay Limit Scheme (salary-based, no degree check), Supplementary Pay Limit Scheme, Fast-track via certified employers, and the EU Blue Card.',
    bestSites: [
      site('Jobindex', 'https://www.jobindex.dk/', 'Largest Danish job board.'),
      site('Jobnet', 'https://job.jobnet.dk/', 'Official Danish job portal.'),
      site('The Hub', 'https://thehub.io/', 'Nordic startup jobs.'),
      ...MANUAL,
    ],
    cvConventions: CV_NORDIC,
    languageNotes: 'English is widely used in tech; Danish helps for public sector and many mid-size companies.',
  },
  {
    iso2: 'SE', name: 'Sweden', region: 'Nordics', currency: 'SEK', languages: ['Swedish'],
    notes: 'Stockholm, Gothenburg and Malmö. Work permit needs an offer at 90% of the median salary; EU Blue Card at 1.25× the average salary (degree or 5 years of experience).',
    bestSites: [
      site('Platsbanken (Arbetsförmedlingen)', 'https://arbetsformedlingen.se/platsbanken/', 'Official Swedish job board; RADAR reads it through the JobTech API.'),
      site('The Hub', 'https://thehub.io/', 'Nordic startup jobs.'),
      ...MANUAL,
    ],
    cvConventions: CV_NORDIC,
    languageNotes: 'English is the working language in many Stockholm tech companies; Swedish is expected in public sector and many traditional firms.',
  },
  {
    iso2: 'FI', name: 'Finland', region: 'Nordics', currency: 'EUR', languages: ['Finnish', 'Swedish'],
    notes: 'Helsinki, Tampere, Oulu. Specialist residence permit and EU Blue Card via Migri; fast-track for specialists.',
    bestSites: [
      site('Job Market Finland (Työmarkkinatori)', 'https://tyomarkkinatori.fi/en', 'Official Finnish job portal.'),
      site('Duunitori', 'https://duunitori.fi/', 'Large Finnish job board.'),
      site('The Hub', 'https://thehub.io/', 'Nordic startup jobs.'),
      ...MANUAL,
    ],
    cvConventions: CV_NORDIC,
    languageNotes: 'English is common in tech companies; Finnish is needed for most public-sector and local roles.',
  },
  {
    iso2: 'NO', name: 'Norway', region: 'Nordics', currency: 'NOK', languages: ['Norwegian'],
    notes: 'Oslo, Bergen, Trondheim; high salaries. Skilled worker permit via UDI (education or special qualifications, pay at Norwegian level).',
    bestSites: [
      site('arbeidsplassen.no (NAV)', 'https://arbeidsplassen.nav.no/', 'Official Norwegian job board; RADAR reads the NAV feed.'),
      site('FINN jobb', 'https://www.finn.no/job/', 'Largest Norwegian job board.'),
      ...MANUAL,
    ],
    cvConventions: CV_NORDIC,
    languageNotes: 'English is accepted in many tech teams; Norwegian is often expected for security roles in public sector, energy and finance.',
  },
  {
    iso2: 'EE', name: 'Estonia', region: 'Baltics', currency: 'EUR', languages: ['Estonian'],
    notes: 'Tallinn and Tartu; strong security ecosystem (e-government, cyber defence). Residence permit for employment requires pay at least the average gross salary (employer asks the Unemployment Insurance Fund for permission).',
    bestSites: [site('CV Keskus', 'https://www.cvkeskus.ee/', 'Estonian job board.'), site('CV.ee', 'https://www.cv.ee/', 'Estonian job board.'), ...MANUAL],
    cvConventions: CV_EU_NEUTRAL,
    languageNotes: 'English is widely used in Tallinn tech companies; Estonian is needed for public sector.',
  },
  {
    iso2: 'LT', name: 'Lithuania', region: 'Baltics', currency: 'EUR', languages: ['Lithuanian'],
    notes: 'Vilnius fintech and shared-service centres. EU Blue Card and national work permits via the Migration Department.',
    bestSites: [site('CV Bankas', 'https://www.cvbankas.lt/', 'Lithuanian job board.'), site('CVonline.lt', 'https://www.cvonline.lt/', 'Lithuanian job board.'), ...MANUAL],
    cvConventions: CV_EU_NEUTRAL,
    languageNotes: 'English is common in fintech and international companies.',
  },
  {
    iso2: 'LV', name: 'Latvia', region: 'Baltics', currency: 'EUR', languages: ['Latvian'],
    notes: 'Riga. EU Blue Card and work permits via the OCMA (PMLP).',
    bestSites: [site('CV.lv', 'https://www.cv.lv/', 'Latvian job board.'), ...MANUAL],
    cvConventions: CV_EU_NEUTRAL,
    languageNotes: 'English is common in international companies; Latvian (and often Russian) in local ones.',
  },
  {
    iso2: 'CZ', name: 'Czechia', region: 'Central & Eastern Europe', currency: 'CZK', languages: ['Czech'],
    notes: 'Prague and Brno security/tech centres (security vendors, shared-service centres). Employee Card and EU Blue Card via the Ministry of the Interior (IPC).',
    bestSites: [site('Jobs.cz', 'https://www.jobs.cz/', 'Largest Czech job board.'), site('StartupJobs.cz', 'https://www.startupjobs.cz/', 'Startup jobs, many in English.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English is common in Prague/Brno tech and security companies; Czech needed for local firms.',
  },
  {
    iso2: 'PL', name: 'Poland', region: 'Central & Eastern Europe', currency: 'PLN', languages: ['Polish'],
    notes: 'Warsaw, Kraków, Wrocław, Gdańsk — large engineering and shared-service centres. Work permit + temporary residence, or EU Blue Card.',
    bestSites: [
      site('Just Join IT', 'https://justjoin.it/', 'IT jobs with salary ranges.'),
      site('No Fluff Jobs', 'https://nofluffjobs.com/', 'IT jobs, mandatory salary ranges.'),
      site('Pracuj.pl', 'https://www.pracuj.pl/', 'Largest Polish job board.'),
      ...MANUAL,
    ],
    cvConventions: {
      ...CV_CEE,
      notes: ['Polish employers expect the GDPR consent clause ("Wyrażam zgodę na przetwarzanie moich danych osobowych…") at the bottom of the CV.'],
    },
    languageNotes: 'English is the working language in many engineering centres; Polish helps for local companies.',
  },
  {
    iso2: 'SI', name: 'Slovenia', region: 'Central & Eastern Europe', currency: 'EUR', languages: ['Slovene'],
    notes: 'Ljubljana. EU Blue Card and single permit.',
    bestSites: [site('MojeDelo', 'https://www.mojedelo.com/', 'Slovenian job board.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English is used in international tech companies; Slovene for most local roles.',
  },
  {
    iso2: 'MT', name: 'Malta', region: 'Southern Europe', currency: 'EUR', languages: ['Maltese', 'English'],
    notes: 'iGaming, fintech and financial services. Single permit via Identità; Key Employee Initiative for highly skilled roles.',
    bestSites: [site('Jobsplus', 'https://jobsplus.gov.mt/', 'Official Maltese employment service.'), site('Keepmeposted', 'https://www.keepmeposted.com.mt/', 'Maltese job board.'), ...MANUAL],
    cvConventions: CV_EU_NEUTRAL,
    languageNotes: 'English is an official language and the business language.',
  },
  {
    iso2: 'RO', name: 'Romania', region: 'Central & Eastern Europe', currency: 'RON', languages: ['Romanian'],
    notes: 'Bucharest, Cluj-Napoca, Iași — security vendors and engineering centres. Work permit (IGI) or EU Blue Card.',
    bestSites: [site('eJobs', 'https://www.ejobs.ro/', 'Largest Romanian job board.'), site('BestJobs', 'https://www.bestjobs.eu/', 'Job board.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English is common in tech companies; Romanian for local roles.',
  },
  {
    iso2: 'HU', name: 'Hungary', region: 'Central & Eastern Europe', currency: 'HUF', languages: ['Hungarian'],
    notes: 'Budapest shared-service and engineering centres. Single permit or EU Blue Card; Hungary has tightened guest-worker rules.',
    bestSites: [site('Profession.hu', 'https://www.profession.hu/', 'Largest Hungarian job board.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English is used in multinational centres; Hungarian for local companies.',
  },
  {
    iso2: 'HR', name: 'Croatia', region: 'Southern Europe', currency: 'EUR', languages: ['Croatian'],
    notes: 'Zagreb and Split. Stay-and-work permit (MUP) or EU Blue Card.',
    bestSites: [site('MojPosao', 'https://www.moj-posao.net/', 'Largest Croatian job board.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English in tech companies; Croatian for most local roles.',
  },
  {
    iso2: 'SK', name: 'Slovakia', region: 'Central & Eastern Europe', currency: 'EUR', languages: ['Slovak'],
    notes: 'Bratislava and Košice (security vendors, shared-service centres). Single permit or EU Blue Card.',
    bestSites: [site('Profesia.sk', 'https://www.profesia.sk/', 'Largest Slovak job board.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English in international companies; Slovak for local roles.',
  },
  {
    iso2: 'BG', name: 'Bulgaria', region: 'Central & Eastern Europe', currency: 'EUR', languages: ['Bulgarian'],
    notes: 'Sofia and Plovdiv engineering centres. Uses the euro since 1 January 2026. EU Blue Card or single permit.',
    bestSites: [site('DEV.BG', 'https://dev.bg/', 'IT-only job board.'), site('Jobs.bg', 'https://www.jobs.bg/', 'Largest Bulgarian job board.'), ...MANUAL],
    cvConventions: CV_CEE,
    languageNotes: 'English is common in the tech sector; Bulgarian for local roles.',
  },
  {
    iso2: 'GR', name: 'Greece', region: 'Southern Europe', currency: 'EUR', languages: ['Greek'],
    notes: 'Athens and Thessaloniki; growing tech centres. EU Blue Card and national work permits.',
    bestSites: [site('Kariera.gr', 'https://www.kariera.gr/', 'Greek job board.'), site('Skywalker.gr', 'https://www.skywalker.gr/', 'Greek job board.'), ...MANUAL],
    cvConventions: { ...CV_EU_NEUTRAL, format: 'Reverse-chronological or Europass, PDF' },
    languageNotes: 'English is common in tech; Greek for local and public-sector roles.',
  },
  {
    iso2: 'CY', name: 'Cyprus', region: 'Southern Europe', currency: 'EUR', languages: ['Greek', 'Turkish'],
    notes: 'Limassol and Nicosia (fintech, forex, relocated tech companies). Business Facilitation Unit fast-track for third-country staff of qualifying companies; EU Blue Card.',
    bestSites: [site('Ergodotisi', 'https://www.ergodotisi.com/', 'Cypriot job board.'), ...MANUAL],
    cvConventions: { ...CV_EU_NEUTRAL, format: 'Reverse-chronological or Europass, PDF' },
    languageNotes: 'English is widely used in business; Greek helps for local companies.',
  },

  // ─────────────────────────── Tier 3 ───────────────────────────
  {
    iso2: 'GB', name: 'United Kingdom', region: 'Western Europe', currency: 'GBP', languages: ['English'],
    notes: 'London is Europe’s largest security job market (plus Manchester, Edinburgh, Bristol, Cheltenham). Skilled Worker visa needs a licensed sponsor and a "higher skilled" occupation at the higher of the general threshold or the going rate; Global Talent (digital technology) needs an endorsement. Check the Home Office register of licensed sponsors.',
    crossCheck: 'ONS ASHE earnings data, ITJobsWatch, Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('Register of licensed sponsors (gov.uk)', 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers', 'Check the employer holds a Skilled Worker licence.'),
      site('Find a job (DWP)', 'https://findajob.dwp.gov.uk/', 'Official UK government job board.'),
      site('CWJobs', 'https://www.cwjobs.co.uk/', 'IT-only job board.'),
      site('Totaljobs', 'https://www.totaljobs.com/', 'Large UK job board.'),
      site('Reed', 'https://www.reed.co.uk/', 'Large UK job board.'),
      site('CyberSecurityJobsite', 'https://www.cybersecurityjobsite.com/', 'Security-only job board.'),
      site('Welcome to the Jungle (formerly Otta)', 'https://app.welcometothejungle.com/', 'Startup/scale-up jobs with visa-sponsorship filters.'),
      site('ITJobsWatch', 'https://www.itjobswatch.co.uk/', 'Salary and demand statistics by skill (research, not a board).'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '2 pages',
      photo: 'No',
      personalDetails: 'Name, phone, email, LinkedIn/GitHub, city; no date of birth, photo or marital status. State "requires Skilled Worker sponsorship" only where the form asks',
      language: 'English (UK spelling)',
      format: 'Reverse-chronological, personal statement at the top, achievement bullets, PDF or Word',
      coverLetter: 'Short (3–4 paragraphs), tailored; many applications use form questions instead',
      references: '"References available on request"; two referees asked at offer stage',
      notes: ['Security-cleared roles (SC/DV) require UK residency history — skip them when screening.'],
    },
    languageNotes: 'English-speaking market.',
  },
  {
    iso2: 'CH', name: 'Switzerland', region: 'Western Europe', currency: 'CHF', languages: ['German', 'French', 'Italian', 'Romansh'],
    notes: 'Zurich, Geneva, Basel, Lausanne, Zug; highest salaries in Europe. Non-EU/EFTA permits only for highly qualified specialists (degree plus years of experience), subject to annual quotas, priority for Swiss/EU workers and customary pay. Employers apply to the cantonal authority; SEM approves.',
    crossCheck: 'Federal Statistical Office wage data (Salarium), Levels.fyi, Glassdoor (by hand)',
    bestSites: [
      site('jobs.ch', 'https://www.jobs.ch/', 'Largest Swiss job board (German-speaking regions).'),
      site('jobup.ch', 'https://www.jobup.ch/', 'French-speaking Switzerland.'),
      site('Job-Room (SECO)', 'https://www.job-room.ch/', 'Official Swiss public employment service portal.'),
      site('SwissDevJobs', 'https://swissdevjobs.ch/', 'Tech jobs with salary ranges.'),
      site('JobScout24', 'https://www.jobscout24.ch/', 'Swiss job board.'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '2 pages',
      photo: 'Common and often expected',
      personalDetails: 'Name, address, phone, email, date of birth, nationality and permit status are usually included',
      language: 'German/French/Italian by region; English for international companies',
      format: 'Tabular, reverse-chronological, PDF dossier with certificates',
      coverLetter: 'Formal, one page',
      references: 'Arbeitszeugnisse (employer references) and diplomas are expected in the dossier',
    },
    languageNotes: 'English-only roles exist in Zurich/Geneva tech and big-tech offices; most employers expect German (Zurich, Basel, Bern) or French (Geneva, Lausanne).',
  },
  {
    iso2: 'CA', name: 'Canada', region: 'North America', currency: 'CAD', languages: ['English', 'French'],
    notes: 'Toronto, Vancouver, Montreal, Ottawa. Employer routes: LMIA-based work permits incl. the Global Talent Stream (fast processing); permanent residence via Express Entry (points-based, no job offer required).',
    bestSites: [site('Job Bank', 'https://www.jobbank.gc.ca/', 'Official Government of Canada job board.'), site('Eluta', 'https://www.eluta.ca/', 'Canadian job search engine (direct from employers).'), ...MANUAL],
    cvConventions: CV_NORTH_AMERICA,
    languageNotes: 'English; French is required for most roles in Québec.',
  },
  {
    iso2: 'US', name: 'United States', region: 'North America', currency: 'USD', languages: ['English'],
    notes: 'Largest security market, but H-1B is a lottery with annual caps and changing fees — very hard to plan around from abroad. L-1 (intra-company transfer) and O-1 are the other routes.',
    bestSites: [
      site('Dice', 'https://www.dice.com/', 'Tech-only job board.'),
      site('Wellfound', 'https://wellfound.com/jobs', 'Startup jobs.'),
      site('Built In', 'https://builtin.com/jobs', 'Tech jobs by city.'),
      site('MyVisaJobs', 'https://www.myvisajobs.com/', 'H-1B sponsor history from public LCA data (research, not a board).'),
      ...MANUAL,
    ],
    cvConventions: { ...CV_NORTH_AMERICA, length: '1 page (2 only with long experience)' },
    languageNotes: 'English.',
  },
  {
    iso2: 'AU', name: 'Australia', region: 'Asia-Pacific', currency: 'AUD', languages: ['English'],
    notes: 'Sydney, Melbourne, Brisbane, Canberra. Skills in Demand (subclass 482) visa: Core Skills stream (occupation list + income threshold) and Specialist Skills stream (higher threshold). Many security roles in government/defence need citizenship and clearance.',
    bestSites: [site('SEEK', 'https://www.seek.com.au/', 'Largest Australian job board.'), site('Workforce Australia', 'https://www.workforceaustralia.gov.au/', 'Official government job board.'), ...MANUAL],
    cvConventions: CV_ANZ,
    languageNotes: 'English.',
  },
  {
    iso2: 'NZ', name: 'New Zealand', region: 'Asia-Pacific', currency: 'NZD', languages: ['English', 'Māori', 'NZ Sign Language'],
    notes: 'Auckland and Wellington. Accredited Employer Work Visa (employer must be accredited; median-wage rules).',
    bestSites: [site('SEEK NZ', 'https://www.seek.co.nz/', 'Largest NZ job board.'), site('Trade Me Jobs', 'https://www.trademe.co.nz/a/jobs', 'NZ classifieds job board.'), ...MANUAL],
    cvConventions: CV_ANZ,
    languageNotes: 'English.',
  },
  {
    iso2: 'SG', name: 'Singapore', region: 'Asia-Pacific', currency: 'SGD', languages: ['English', 'Malay', 'Mandarin', 'Tamil'],
    notes: 'Regional HQs and a large security market. Employment Pass: age-rising qualifying salary plus the COMPASS points framework; higher figures for financial services.',
    bestSites: [site('MyCareersFuture', 'https://www.mycareersfuture.gov.sg/', 'Official Singapore job portal (employers must advertise here for EP roles).'), site('NodeFlair', 'https://nodeflair.com/jobs', 'Tech jobs with salary data.'), site('JobStreet Singapore', 'https://sg.jobstreet.com/', 'Large job board.'), ...MANUAL],
    cvConventions: CV_EAST_ASIA_INTL,
    languageNotes: 'English is the business language.',
  },
  {
    iso2: 'JP', name: 'Japan', region: 'Asia-Pacific', currency: 'JPY', languages: ['Japanese'],
    notes: 'Tokyo, Osaka, Fukuoka. Engineer/Specialist in Humanities/International Services visa for most tech jobs; Highly Skilled Professional (points) for faster permanent residence.',
    bestSites: [site('TokyoDev', 'https://www.tokyodev.com/', 'English-speaking developer jobs in Japan.'), site('Japan Dev', 'https://japan-dev.com/', 'English-friendly tech jobs.'), site('Daijob', 'https://www.daijob.com/en/', 'Bilingual job board.'), ...MANUAL],
    cvConventions: {
      ...CV_EAST_ASIA_INTL,
      notes: ['Japanese companies use a rirekisho (standard form with photo) plus a shokumu keirekisho (work history); international companies accept an English résumé.'],
    },
    languageNotes: 'Japanese is required in most companies; English-only roles exist at international and some tech companies (TokyoDev/Japan Dev list them).',
  },
  {
    iso2: 'KR', name: 'South Korea', region: 'Asia-Pacific', currency: 'KRW', languages: ['Korean'],
    notes: 'Seoul and Pangyo. E-7 (special occupation) visa for professionals.',
    bestSites: [site('Wanted', 'https://www.wanted.co.kr/', 'Tech jobs.'), site('Saramin', 'https://www.saramin.co.kr/', 'Large Korean job board.'), ...MANUAL],
    cvConventions: CV_EAST_ASIA_INTL,
    languageNotes: 'Korean is required in most companies; English-only roles are rare outside multinationals.',
  },
  {
    iso2: 'AE', name: 'United Arab Emirates', region: 'Middle East', currency: 'AED', languages: ['Arabic'],
    notes: 'Dubai and Abu Dhabi; tax-free salaries. Employer-sponsored work permit + residence visa (MOHRE); Golden Visa for high earners and specialists.',
    bestSites: [site('Bayt', 'https://www.bayt.com/', 'Largest Gulf job board.'), site('GulfTalent', 'https://www.gulftalent.com/', 'Gulf professional jobs.'), site('NaukriGulf', 'https://www.naukrigulf.com/', 'Gulf jobs, popular with Indian applicants.'), ...MANUAL],
    cvConventions: CV_GULF,
    languageNotes: 'English is the business language; Arabic is a plus for government roles.',
  },
  {
    iso2: 'IL', name: 'Israel', region: 'Middle East', currency: 'ILS', languages: ['Hebrew', 'Arabic'],
    notes: 'Tel Aviv is a global cyber-security hub. HIT expert work visa for high-tech experts (salary at least twice the average wage); security clearance limits some roles.',
    bestSites: [site('AllJobs', 'https://www.alljobs.co.il/', 'Large Israeli job board.'), site('Drushim', 'https://www.drushim.co.il/', 'Israeli job board.'), ...MANUAL],
    cvConventions: CV_EU_NEUTRAL,
    languageNotes: 'English is common in tech; Hebrew for most local companies.',
  },
  {
    iso2: 'HK', name: 'Hong Kong', region: 'Asia-Pacific', currency: 'HKD', languages: ['Chinese', 'English'],
    notes: 'Finance-heavy security market. General Employment Policy visa (employer-sponsored) and the Top Talent Pass Scheme.',
    bestSites: [site('JobsDB Hong Kong', 'https://hk.jobsdb.com/', 'Largest HK job board.'), site('CTgoodjobs', 'https://www.ctgoodjobs.hk/', 'HK job board.'), site('eFinancialCareers', 'https://www.efinancialcareers.hk/', 'Finance and fintech jobs.'), ...MANUAL],
    cvConventions: CV_EAST_ASIA_INTL,
    languageNotes: 'English is used in finance and MNCs; Cantonese/Mandarin often preferred.',
  },
  {
    iso2: 'IS', name: 'Iceland', region: 'Nordics', currency: 'ISK', languages: ['Icelandic'],
    notes: 'Small market (Reykjavík). Work permit for experts (Directorate of Labour).',
    bestSites: [site('Alfred', 'https://alfred.is/', 'Icelandic job board.'), site('Vinnumálastofnun', 'https://vinnumalastofnun.is/', 'Official Directorate of Labour.'), ...MANUAL],
    cvConventions: CV_NORDIC,
    languageNotes: 'English is widely spoken; Icelandic for most local roles.',
  },

  // ─────────────────────────── Tier 4 ───────────────────────────
  {
    iso2: 'SA', name: 'Saudi Arabia', region: 'Middle East', currency: 'SAR', languages: ['Arabic'],
    notes: 'Riyadh and Jeddah; large public-sector and giga-project security demand. Employer-sponsored work visa; Premium Residency for some profiles. Saudisation quotas affect hiring.',
    bestSites: [site('Bayt', 'https://www.bayt.com/', 'Largest Gulf job board.'), site('GulfTalent', 'https://www.gulftalent.com/', 'Gulf professional jobs.'), ...MANUAL],
    cvConventions: CV_GULF,
    languageNotes: 'English in multinational and tech roles; Arabic valued for government.',
  },
  {
    iso2: 'QA', name: 'Qatar', region: 'Middle East', currency: 'QAR', languages: ['Arabic'],
    notes: 'Doha; employer-sponsored work visa.',
    bestSites: [site('Bayt', 'https://www.bayt.com/', 'Largest Gulf job board.'), site('GulfTalent', 'https://www.gulftalent.com/', 'Gulf professional jobs.'), ...MANUAL],
    cvConventions: CV_GULF,
    languageNotes: 'English is the business language in most companies.',
  },
  {
    iso2: 'TW', name: 'Taiwan', region: 'Asia-Pacific', currency: 'TWD', languages: ['Mandarin'],
    notes: 'Taipei and Hsinchu (semiconductors). Employment Gold Card for professionals and regular work permits.',
    bestSites: [site('104 Job Bank', 'https://www.104.com.tw/', 'Largest Taiwanese job board.'), site('Yourator', 'https://www.yourator.co/', 'Startup jobs.'), site('Cake', 'https://www.cake.me/jobs', 'Tech jobs.'), ...MANUAL],
    cvConventions: CV_EAST_ASIA_INTL,
    languageNotes: 'Mandarin is needed in most companies; some English-speaking roles at international firms.',
  },
  {
    iso2: 'MY', name: 'Malaysia', region: 'Asia-Pacific', currency: 'MYR', languages: ['Malay'],
    notes: 'Kuala Lumpur and Penang shared-service/security operations centres. Employment Pass categories by salary.',
    bestSites: [site('JobStreet Malaysia', 'https://my.jobstreet.com/', 'Largest Malaysian job board.'), site('Hiredly', 'https://my.hiredly.com/', 'Malaysian job board.'), site('MYFutureJobs', 'https://myfuturejobs.gov.my/', 'Official Malaysian job portal.'), ...MANUAL],
    cvConventions: CV_EAST_ASIA_INTL,
    languageNotes: 'English is widely used in business; Malay/Mandarin a plus.',
  },
  {
    iso2: 'BR', name: 'Brazil', region: 'Latin America', currency: 'BRL', languages: ['Portuguese'],
    notes: 'São Paulo and other large tech centres. Temporary work visa (VITEM V) with employer authorisation.',
    bestSites: [site('Gupy', 'https://www.gupy.io/', 'Popular Brazilian recruiting platform.'), site('Vagas.com', 'https://www.vagas.com.br/', 'Brazilian job board.'), site('Programathor', 'https://programathor.com.br/', 'Tech jobs.'), ...MANUAL],
    cvConventions: { ...CV_EU_NEUTRAL, language: 'Portuguese for local companies; English for international ones' },
    languageNotes: 'Portuguese is required in most companies.',
  },
  {
    iso2: 'MX', name: 'Mexico', region: 'Latin America', currency: 'MXN', languages: ['Spanish'],
    notes: 'Mexico City, Guadalajara, Monterrey (nearshoring for US companies). Temporary resident visa with a job offer (INM).',
    bestSites: [site('OCC Mundial', 'https://www.occ.com.mx/', 'Large Mexican job board.'), site('Computrabajo', 'https://mx.computrabajo.com/', 'Job board.'), site('Get on Board', 'https://www.getonbrd.com/', 'LatAm tech jobs.'), ...MANUAL],
    cvConventions: { ...CV_EU_NEUTRAL, language: 'Spanish for local companies; English for US-facing ones' },
    languageNotes: 'Spanish is required in most companies; English for US nearshoring roles.',
  },

  // ─────────────────────────── Remote ───────────────────────────
  {
    iso2: REMOTE_COUNTRY, name: 'Remote / Worldwide', region: 'Remote', currency: null, languages: ['English'],
    notes: 'Pseudo-country for remote roles. Remote postings are only useful when they allow India/Asia/"anywhere" or an EU country where I can legally work — check the eligible regions and time zones (RADAR reads them into the remote-eligibility fact).',
    bestSites: [
      site('Himalayas', 'https://himalayas.app/jobs', 'Remote jobs with location restrictions stated; RADAR reads its public API (attribution required).'),
      site('Remotive', 'https://remotive.com/', 'Curated remote jobs; RADAR reads its public API (attribution required).'),
      site('Remote OK', 'https://remoteok.com/', 'Remote jobs; RADAR reads its public API (link back required).'),
      site('Jobicy', 'https://jobicy.com/', 'Remote jobs; RADAR reads its public API (attribution required).'),
      site('We Work Remotely', 'https://weworkremotely.com/', 'Large remote job board (browse by hand).'),
      ...MANUAL,
    ],
    cvConventions: {
      length: '1–2 pages',
      photo: 'No',
      personalDetails: 'Name, email, LinkedIn/GitHub, current country and time zone; say if you can work as a contractor/EOR employee',
      language: 'English',
      format: 'Achievement bullets, async/remote-work evidence (docs, written communication), PDF',
      coverLetter: 'Short; address the time-zone overlap and eligible locations explicitly',
      references: 'On request',
    },
    languageNotes: 'English.',
  },
];

function tierOf(iso2: string): 0 | 1 | 2 | 3 | 4 {
  if (iso2 === REMOTE_COUNTRY) return 0;
  if ((TIER_1_COUNTRIES as readonly string[]).includes(iso2)) return 1;
  if ((TIER_2_COUNTRIES as readonly string[]).includes(iso2)) return 2;
  if ((TIER_3_COUNTRIES as readonly string[]).includes(iso2)) return 3;
  if ((TIER_4_COUNTRIES as readonly string[]).includes(iso2)) return 4;
  throw new Error(`country ${iso2} is not in a spec §4 tier`);
}

export const SEED_COUNTRIES: readonly SeedCountry[] = INPUT.map(({ crossCheck, ...c }) => ({
  ...c,
  tier: tierOf(c.iso2),
  isLive: false,
  salaryRanges: securitySalaryRanges(c.iso2, crossCheck ?? EURO_CROSS),
}));

export const SEED_COUNTRY_CODES: readonly string[] = SEED_COUNTRIES.map((c) => c.iso2);
