/**
 * Job pipeline contracts: raw items, the normalised job shape, and the value types of every
 * enrichment function (location, title, experience, salary, language, visa, remote, score).
 * Pure types; safe to import anywhere.
 */
import type {
  ELIGIBILITY_RESULTS,
  EXPERIENCE_BANDS,
  LANGUAGE_REQUIREMENTS,
  REMOTE_CLASSES,
  ROLE_FAMILIES,
  SENIORITY_WORDS,
  VISA_STATUSES,
  WORKPLACE_TYPES,
} from '../../db/schema/_enums';
import type { Confidence } from './provenance';

export type WorkplaceType = (typeof WORKPLACE_TYPES)[number];
export type RoleFamily = (typeof ROLE_FAMILIES)[number];
export type SeniorityWord = (typeof SENIORITY_WORDS)[number];
export type VisaStatus = (typeof VISA_STATUSES)[number];
export type RemoteClass = (typeof REMOTE_CLASSES)[number];
export type LanguageRequirement = (typeof LANGUAGE_REQUIREMENTS)[number];
export type ExperienceBand = (typeof EXPERIENCE_BANDS)[number];
export type EligibilityResult = (typeof ELIGIBILITY_RESULTS)[number];

export interface RawItem {
  externalId: string;
  payload: unknown;
  url?: string;
  fetchedAt: Date;
}

export interface SalaryHint {
  min?: number;
  max?: number;
  currency?: string;
  period?: string;
  raw?: string;
}

export interface NormalizedJob {
  sourceId: number;
  externalId: string;
  title: string;
  companyName: string;
  companyDomain?: string | null;
  locationRaw: string;
  countryHint?: string | null;
  cityHint?: string | null;
  workplaceHint?: WorkplaceType | null;
  descriptionHtml: string | null;
  descriptionText: string;
  applyUrl: string;
  postedAt: Date | null;
  closingAt?: Date | null;
  salaryHint?: SalaryHint | null;
  employmentType?: string | null;
  extra?: Record<string, unknown>;
}

export interface LocationResult {
  countryIso2: string | null;
  city: string | null;
  region: string | null;
  workplaceType: WorkplaceType | null;
  remoteScopeRaw: string | null;
  confidence: Confidence;
  evidence: string;
}

export interface TitleResult {
  roleKey: string | null;
  roleFamily: RoleFamily;
  seniorityWord: SeniorityWord | null;
  matched: string | null;
  lang: string | null;
  confidence: Confidence;
  unknown: boolean;
}

export interface ExperienceValue {
  minYears: number | null;
  maxYears: number | null;
  band: ExperienceBand;
  securityStrict: boolean;
}

export type SalaryPeriod = 'hour' | 'day' | 'month' | 'year';

export interface SalaryValue {
  min: number | null;
  max: number | null;
  currency: string;
  period: SalaryPeriod;
  grossNet: 'gross' | 'net' | 'unknown';
  installments: number | null;
  annualEurMin: number | null;
  annualEurMax: number | null;
  fxRate: number | null;
  fxDate: string | null;
  kind: 'stated' | 'estimated';
}

export interface FxTable {
  /** ECB reference date 'YYYY-MM-DD' (null when no rates are available yet). */
  date: string | null;
  /** 1 EUR = rates[CUR] CUR. EUR itself is always 1. */
  rates: Record<string, number>;
}

export interface LanguageValue {
  postingLang: string | null;
  requirement: LanguageRequirement;
  languages: string[];
}

export type VisaSignalKind = 'offered' | 'not_offered' | 'relocation' | 'right_to_work_required';

export interface VisaSignal {
  signal: VisaSignalKind;
  quote: string;
  lang: string;
  ruleId: string;
  confidence: Confidence;
}

export interface VisaDecisionValue {
  status: VisaStatus;
  reasons: string[];
  sides?: { for: string[]; against: string[] };
}

export interface EligibilityValue {
  result: EligibilityResult;
  reason: string;
  marginPct: number | null;
  ruleVerifiedAt: Date | null;
  /** Which route/rule version was used (e.g. 'DE eu_blue_card v2'). */
  rule?: string | null;
}

export interface RemoteValue {
  class: RemoteClass;
  regions: string[];
}

export interface RoleValue {
  roleKey: string | null;
  roleFamily: RoleFamily;
  canonicalTitle: string;
}

export interface SeniorityValue {
  word: SeniorityWord | null;
}

export interface SkillsValue {
  matched: string[];
  found: string[];
}

export interface ScoreComponent {
  key: string;
  label: string;
  /** 0..1 before weighting. */
  raw: number;
  weight: number;
  /** Points added to the 0–100 score. */
  contribution: number;
  confidence: Confidence;
  reason: string;
}

export interface ScoreResult {
  score: number;
  version: string;
  components: ScoreComponent[];
}

export interface ScoringInput {
  role: { roleKey: string | null; roleFamily: RoleFamily; confidence: Confidence };
  experience: { value: ExperienceValue; confidence: Confidence } | null;
  visa: { status: VisaStatus; confidence: Confidence } | null;
  salary: { value: SalaryValue; confidence: Confidence } | null;
  remote: { value: RemoteValue; confidence: Confidence } | null;
  workplaceType: WorkplaceType | null;
  countryIso2: string | null;
  language: { value: LanguageValue; confidence: Confidence } | null;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastConfirmedLiveAt: Date | null;
  linkStatus: 'ok' | 'dead' | 'unknown' | 'redirected';
  ghostRisk: boolean;
  skills: string[];
  company: { isAgency: boolean; type: string; sponsorHistory: boolean };
  eligibility: EligibilityResult | null;
  now: Date;
}

export interface DedupCandidate {
  jobIdToIgnore?: number | null;
  companyId: number;
  canonicalTitle: string;
  titleRaw: string;
  countryIso2: string | null;
  city: string | null;
  applyUrlHash: string;
  descriptionHash: string;
  descriptionText: string;
}

export type DedupResult =
  | { action: 'merge'; jobId: number; confidence: number; reasons: string[] }
  | { action: 'possible'; jobIds: number[]; score: number; reasons: string[] }
  | { action: 'new' };
