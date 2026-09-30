/**
 * Public sponsor / employer registers (spec §13.2): what is imported, from where, and what each
 * one proves. Every register was checked by hand against the live publisher page on 2026-09-30.
 *
 * - `licensed_sponsor`: the register lists employers that are licensed / recognised to sponsor
 *   work permits today (UK Home Office, NL IND, DK SIRI). A strong same-country match is official
 *   "Confirmed" evidence.
 * - `sponsorship_history`: the register lists employers that obtained permits in the past
 *   (Ireland DETE, Canada LMIA). It proves history, not a current offer → "Likely" at most.
 *
 * Registers that exist but are NOT imported are listed in UNSUPPORTED_REGISTERS with the reason,
 * so the gap is visible instead of silently missing.
 */
import type { RegisterEvidenceKind } from '../visa/types';

export const REGISTER_KEYS = ['uk_home_office', 'nl_ind', 'dk_siri', 'ie_dete', 'ca_lmia'] as const;
export type RegisterKey = (typeof REGISTER_KEYS)[number];

export interface RegisterDef {
  key: RegisterKey;
  /** Human name shown as the evidence source ("on the UK Home Office register of licensed sponsors"). */
  name: string;
  countryIso2: string;
  evidenceKind: RegisterEvidenceKind;
  publisher: string;
  /** Page a person can open to check an entry by hand. */
  homepage: string;
  /** How often the publisher updates it. */
  cadence: string;
  /** Hosts downloads may come from (defence in depth on top of the SSRF-safe fetcher). */
  allowedHosts: readonly string[];
  /**
   * Fewer parsed entries than this means the download or the format is broken: the import fails
   * and the previous version stays in use.
   */
  minEntries: number;
  /** What an entry means, one sentence. */
  meaning: string;
}

export const REGISTERS: Readonly<Record<RegisterKey, RegisterDef>> = {
  uk_home_office: {
    key: 'uk_home_office',
    name: 'UK Home Office register of licensed sponsors (workers)',
    countryIso2: 'GB',
    evidenceKind: 'licensed_sponsor',
    publisher: 'UK Home Office (UK Visas and Immigration)',
    homepage: 'https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers',
    cadence: 'every working day',
    allowedHosts: ['www.gov.uk', 'assets.publishing.service.gov.uk'],
    minEntries: 50_000,
    meaning: 'The organisation holds a licence to sponsor Worker / Temporary Worker visas on the listed route.',
  },
  nl_ind: {
    key: 'nl_ind',
    name: 'IND public register of recognised sponsors (work)',
    countryIso2: 'NL',
    evidenceKind: 'licensed_sponsor',
    publisher: 'Immigratie- en Naturalisatiedienst (IND)',
    homepage: 'https://ind.nl/en/public-register-recognised-sponsors/public-register-work',
    cadence: 'monthly',
    allowedHosts: ['ind.nl'],
    minEntries: 5_000,
    meaning: 'The organisation is a recognised sponsor for work and highly skilled migrant permits.',
  },
  dk_siri: {
    key: 'dk_siri',
    name: 'SIRI certified companies (Fast-track scheme)',
    countryIso2: 'DK',
    evidenceKind: 'licensed_sponsor',
    publisher: 'Danish Agency for International Recruitment and Integration (SIRI)',
    homepage: 'https://www.nyidanmark.dk/en-GB/Words-and-concepts/SIRI/Certified-companies',
    cadence: 'irregular (several times a month)',
    allowedHosts: ['www.nyidanmark.dk', 'nyidanmark.dk'],
    minEntries: 300,
    meaning: 'The company is certified by SIRI to hire foreign employees under the Fast-track scheme.',
  },
  ie_dete: {
    key: 'ie_dete',
    name: 'Ireland DETE employment permits issued to companies',
    countryIso2: 'IE',
    evidenceKind: 'sponsorship_history',
    publisher: 'Department of Enterprise, Tourism and Employment (DETE)',
    homepage: 'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/statistics/',
    cadence: 'monthly (year to date) — this year and last year are imported',
    allowedHosts: ['enterprise.gov.ie'],
    minEntries: 1_000,
    meaning: 'The company was issued Irish employment permits in the listed year (history, not a promise).',
  },
  ca_lmia: {
    key: 'ca_lmia',
    name: 'Canada TFWP positive LMIA employers list',
    countryIso2: 'CA',
    evidenceKind: 'sponsorship_history',
    publisher: 'Employment and Social Development Canada (ESDC), via open.canada.ca',
    homepage: 'https://open.canada.ca/data/en/dataset/90fed587-1364-4f33-a9ee-208181dc0b97',
    cadence: 'quarterly — the latest four quarters are imported',
    allowedHosts: ['open.canada.ca', 'opencanada.blob.core.windows.net'],
    minEntries: 2_000,
    meaning: 'The employer received a positive Labour Market Impact Assessment in the listed quarter (history).',
  },
};

export function isRegisterKey(v: unknown): v is RegisterKey {
  return typeof v === 'string' && (REGISTER_KEYS as readonly string[]).includes(v);
}

export function registerDef(key: RegisterKey): RegisterDef {
  return REGISTERS[key];
}

/** Registers that exist but are not imported, and why (reviewed 2026-09-30). */
export interface UnsupportedRegister {
  countryIso2: string;
  name: string;
  url: string;
  reason: string;
}

export const UNSUPPORTED_REGISTERS: readonly UnsupportedRegister[] = [
  {
    countryIso2: 'US',
    name: 'USCIS H-1B Employer Data Hub / DOL OFLC LCA disclosure data',
    url: 'https://www.uscis.gov/archive/h-1b-employer-data-hub-files',
    reason:
      'Checked: the USCIS bulk CSV files are archived and stop at fiscal year 2023; the live hub is an interactive tool without a ' +
      'stable file. The DOL LCA disclosure files are very large quarterly spreadsheets (above the 50 MB download cap) and list ' +
      'applications, not approvals. Candidate for a later, streamed importer.',
  },
  {
    countryIso2: 'NZ',
    name: 'Immigration New Zealand accredited employers',
    url: 'https://www.immigration.govt.nz/work/for-employers/',
    reason: 'Checked: the former accredited-employer list pages return 404 and no downloadable list was found on the site.',
  },
  {
    countryIso2: 'DE',
    name: 'Germany',
    url: 'https://www.make-it-in-germany.com',
    reason: 'Germany has no employer sponsor licensing, so there is no register; the job-level Blue Card / skilled-worker rules apply.',
  },
  {
    countryIso2: 'XX',
    name: 'Other target countries (AU, SE, BE, LU, FR, ES, PT, IT, AT, SG, CH, JP, …)',
    url: 'https://immigration-portal.ec.europa.eu',
    reason:
      'No public, downloadable list of sponsoring employers was found for these countries; add one here when a stable ' +
      'official file is published.',
  },
];
