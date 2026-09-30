/**
 * Normalise stage (pure): turns a validated NormalizedJob into the job-row fields plus the
 * source-level fact candidates (role, seniority, experience, language, stated salary, remote,
 * visa signals, closing date, skills). No DB access: the same input always gives the same output,
 * which is what makes reprocessFromRaw reproducible.
 */
import { GENDER_MARKER_RES } from '../../../data/titles/noise';
import type { SourceRow } from '../../../db/schema';
import type {
  ExperienceValue,
  FxTable,
  NormalizedJob,
  RemoteValue,
  RoleValue,
  SalaryValue,
  SeniorityValue,
  SkillsValue,
  TitleResult,
  VisaSignal,
  WorkplaceType,
} from '../../contracts/jobs';
import type { Fact } from '../../contracts/provenance';
import type { Profile, TitleOverrides } from '../../contracts/settings';
import { sha256Hex, normalizeTextForHash } from '../../hash';
import { extractExperience } from '../../normalize/experience';
import { detectLanguage } from '../../normalize/language';
import { normalizeLocation, type LocationDetails } from '../../normalize/location';
import { parseSalary } from '../../normalize/salary';
import { mapTitle, TITLE_LOGIC_VERSION } from '../../normalize/title';
import { cleanUrl } from '../../normalize/url';
import { classifyRemote } from '../../remote/classify';
import { htmlToPlainText, sanitizePostingHtml } from '../../security/sanitize';
import { detectVisaSignals, VISA_SIGNALS_LOGIC_VERSION } from '../../visa/signals';
import { skillsFact } from './skills';

export const MAX_CANONICAL_TITLE = 255;
export const MAX_CITY = 128;
export const MAX_REGION = 128;
/** Facts copied verbatim from structured source fields (closing date). */
export const SOURCE_DATA_LOGIC_VERSION = 'source-data@2026-09-30.1';
/** Old/new values of description changes kept in job_changes. */
export const CHANGE_TEXT_MAX = 10_000;

export class NormaliseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NormaliseError';
  }
}

export interface PrepareOptions {
  profile: Profile;
  titleOverrides: TitleOverrides;
  fx: FxTable;
  knownCountries: ReadonlySet<string>;
  now: Date;
}

export interface LanguageFactValue {
  postingLang: string | null;
  requirement: string;
  languages: string[];
  [k: string]: unknown;
}

export interface SourceFacts {
  role: Fact<RoleValue>;
  seniority: Fact<SeniorityValue> | null;
  experience: Fact<ExperienceValue>;
  language: Fact<LanguageFactValue>;
  salary: Fact<SalaryValue> | null;
  remote: Fact<RemoteValue>;
  visaSignals: Fact<VisaSignal>[];
  closingDate: Fact<{ date: string }> | null;
  skills: Fact<SkillsValue>;
}

export interface PreparedJob {
  job: NormalizedJob;
  titleRaw: string;
  canonicalTitle: string;
  title: TitleResult;
  location: LocationDetails;
  locationRaw: string;
  countryIso2: string | null;
  city: string | null;
  region: string | null;
  workplaceType: WorkplaceType | null;
  descriptionHtmlSanitized: string | null;
  descriptionText: string;
  descriptionHash: string;
  applyUrl: string;
  applyUrlClean: string;
  applyUrlHash: string;
  postedAt: Date | null;
  closingAt: Date | null;
  lang: string | null;
  facts: SourceFacts;
  warnings: string[];
}

/** Display title: the raw title without gender markers ("(m/w/d)"), whitespace collapsed. */
export function displayTitle(titleRaw: string): string {
  let t = titleRaw;
  for (const re of GENDER_MARKER_RES) t = t.replace(re, ' ');
  t = t
    .replace(/\s+/g, ' ')
    .replace(/\s+([,)|\-–—:])(?=\s|$)/g, '$1')
    .replace(/[\s,|\-–—:(]+$/, '')
    .trim();
  return (t || titleRaw.trim()).slice(0, MAX_CANONICAL_TITLE);
}

function iso2OrNull(v: string | null | undefined): string | null {
  return v && /^[A-Za-z]{2}$/.test(v) ? v.toUpperCase() : null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function prepareJob(job: NormalizedJob, source: Pick<SourceRow, 'countryIso2'>, opts: PrepareOptions): PreparedJob {
  const warnings: string[] = [];
  const now = opts.now;

  // ---- title
  const titleRaw = job.title;
  const canonicalTitle = displayTitle(titleRaw);
  const title = mapTitle(titleRaw, opts.titleOverrides, opts.profile.targetRoles);

  // ---- location (FK-safe country)
  const countryHint = iso2OrNull(job.countryHint) ?? iso2OrNull(source.countryIso2);
  const location = normalizeLocation(job.locationRaw, {
    country: countryHint,
    city: job.cityHint ?? null,
    workplace: job.workplaceHint ?? null,
  });
  let countryIso2 = iso2OrNull(location.countryIso2);
  if (countryIso2 && !opts.knownCountries.has(countryIso2)) {
    warnings.push(`country ${countryIso2} is not in the countries table (stored without country)`);
    countryIso2 = null;
  }
  const city = location.city ? location.city.slice(0, MAX_CITY) : null;
  const region = location.region ? location.region.slice(0, MAX_REGION) : null;
  const workplaceType = location.workplaceType ?? job.workplaceHint ?? null;

  // ---- description
  const descriptionHtmlSanitized = job.descriptionHtml ? sanitizePostingHtml(job.descriptionHtml) || null : null;
  const descriptionText = (job.descriptionText.trim() || htmlToPlainText(descriptionHtmlSanitized ?? '')).trim();
  if (!descriptionText) throw new NormaliseError('description is empty after sanitising');
  const descriptionHash = sha256Hex(normalizeTextForHash(descriptionText));

  // ---- apply link
  const applyUrl = job.applyUrl;
  const applyUrlClean = (cleanUrl(applyUrl) || applyUrl).slice(0, 2048);
  const applyUrlHash = sha256Hex(applyUrlClean);

  const postedAt = job.postedAt ?? null;
  const closingAt = job.closingAt ?? null;

  // ---- facts
  const role: Fact<RoleValue> = {
    value: { roleKey: title.roleKey, roleFamily: title.roleFamily, canonicalTitle },
    evidence: title.matched ?? titleRaw.slice(0, 500),
    source: 'job title',
    method: 'rule',
    confidence: title.confidence,
    checkedAt: now,
    logicVersion: TITLE_LOGIC_VERSION,
  };
  const seniority: Fact<SeniorityValue> | null = title.seniorityWord
    ? {
        value: { word: title.seniorityWord },
        evidence: titleRaw.slice(0, 500),
        source: 'job title',
        method: 'rule',
        confidence: 'high',
        checkedAt: now,
        logicVersion: TITLE_LOGIC_VERSION,
      }
    : null;
  const experience = extractExperience(descriptionText, titleRaw, opts.profile.experienceBand, { now });
  const languageFact = detectLanguage(descriptionText, { countryIso2, now });
  const language = languageFact as unknown as Fact<LanguageFactValue>;
  const lang = languageFact.value.postingLang ? languageFact.value.postingLang.slice(0, 8) : null;
  const salary = parseSalary({ hint: job.salaryHint ?? null, text: descriptionText, countryIso2 }, opts.fx, { now });
  const remote = { ...classifyRemote(descriptionText, location), checkedAt: now };
  const visaSignals: Fact<VisaSignal>[] = detectVisaSignals(descriptionText).map((s) => ({
    value: s,
    evidence: s.quote,
    source: 'posting text',
    method: 'posting',
    confidence: s.confidence,
    checkedAt: now,
    logicVersion: VISA_SIGNALS_LOGIC_VERSION,
  }));
  const closingDate: Fact<{ date: string }> | null = closingAt
    ? {
        value: { date: isoDay(closingAt) },
        evidence: `Closing date given by the source: ${isoDay(closingAt)}`,
        source: 'source data',
        method: 'posting',
        confidence: 'high',
        checkedAt: now,
        logicVersion: SOURCE_DATA_LOGIC_VERSION,
      }
    : null;
  const skills = skillsFact(descriptionText, titleRaw, opts.profile.skills, now);

  return {
    job,
    titleRaw,
    canonicalTitle,
    title,
    location,
    locationRaw: job.locationRaw,
    countryIso2,
    city,
    region,
    workplaceType,
    descriptionHtmlSanitized,
    descriptionText,
    descriptionHash,
    applyUrl,
    applyUrlClean,
    applyUrlHash,
    postedAt,
    closingAt,
    lang,
    facts: { role, seniority, experience, language, salary, remote, visaSignals, closingDate, skills },
    warnings,
  };
}
