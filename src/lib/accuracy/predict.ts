/**
 * What the current rules say about one golden snapshot (spec §17.2). Runs exactly the pure
 * normalise stage the pipeline runs (prepareJob: title, location, experience, language, salary,
 * remote, visa signals) plus the visa decision on the posting's own signals — no DB, no AI, no
 * network — so the same snapshot and logic always give the same prediction.
 *
 * Visa: only what the posting says counts here (no company registers / notes / AI). Golden
 * labels are written from the posting text, so that is the fair comparison.
 */
import { COUNTRIES } from '../../data/places/countries';
import type { GoldenField, GoldenSnapshot } from '../contracts/accuracy';
import type { FxTable, NormalizedJob, WorkplaceType } from '../contracts/jobs';
import { profileSchema, type Profile, type TitleOverrides } from '../contracts/settings';
import { prepareJob } from '../pipeline/stages/normalise';
import { decideVisaStatus } from '../visa/decide';

export interface PredictEnv {
  profile: Profile;
  titleOverrides: TitleOverrides;
  fx: FxTable;
  now: Date;
}

/** Default profile, no title overrides, empty FX table (stated salaries are compared as written). */
export function defaultPredictEnv(now: Date = new Date()): PredictEnv {
  return { profile: profileSchema.parse({}), titleOverrides: {}, fx: { date: null, rates: {} }, now };
}

export interface SalaryPrediction {
  stated: boolean;
  currency: string | null;
  period: 'hour' | 'day' | 'month' | 'year' | null;
  min: number | null;
  max: number | null;
}

/** One prediction per golden field (null = the rules say "none / not stated"). */
export interface Prediction {
  role_match: boolean;
  role_key: string | null;
  seniority: string | null;
  visa_status: string;
  remote_class: string;
  salary: SalaryPrediction;
  language: string;
  country_iso2: string | null;
  experience_min_years: number | null;
  /** The rules could not process the snapshot at all (e.g. empty text). */
  error?: string;
}

const KNOWN_COUNTRIES: ReadonlySet<string> = new Set(COUNTRIES.map((c) => c.iso2));

const WORKPLACE: readonly WorkplaceType[] = ['onsite', 'hybrid', 'remote'];

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** Coerces snapshot_json (DB or file) into the snapshot shape; null when unusable. */
export function readSnapshot(raw: unknown): GoldenSnapshot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const title = str(r.title) ?? str(r.titleRaw) ?? str(r.canonicalTitle);
  const descriptionText = typeof r.descriptionText === 'string' ? r.descriptionText : null;
  if (!title || descriptionText === null) return null;
  const hint = r.salaryHint && typeof r.salaryHint === 'object' ? (r.salaryHint as Record<string, unknown>) : null;
  const workplace = str(r.workplaceHint);
  return {
    title,
    company: str(r.company) ?? '',
    locationRaw: typeof r.locationRaw === 'string' ? r.locationRaw : '',
    countryHint: str(r.countryHint),
    descriptionText,
    applyUrl: str(r.applyUrl),
    sourceKey: str(r.sourceKey),
    salaryHint: hint
      ? { min: num(hint.min), max: num(hint.max), currency: str(hint.currency) ?? undefined, period: str(hint.period) ?? undefined, raw: str(hint.raw) ?? undefined }
      : null,
    workplaceHint: workplace && (WORKPLACE as readonly string[]).includes(workplace) ? (workplace as WorkplaceType) : null,
  };
}

function toNormalizedJob(s: GoldenSnapshot): NormalizedJob {
  return {
    sourceId: 0,
    externalId: 'golden',
    title: s.title,
    companyName: s.company,
    locationRaw: s.locationRaw,
    countryHint: s.countryHint ?? null,
    cityHint: null,
    workplaceHint: s.workplaceHint ?? null,
    descriptionHtml: null,
    descriptionText: s.descriptionText,
    applyUrl: s.applyUrl || 'https://golden.invalid/posting',
    postedAt: null,
    salaryHint: s.salaryHint ?? null,
  };
}

const EMPTY: Prediction = {
  role_match: false,
  role_key: null,
  seniority: null,
  visa_status: 'unknown',
  remote_class: 'unclear',
  salary: { stated: false, currency: null, period: null, min: null, max: null },
  language: 'unclear',
  country_iso2: null,
  experience_min_years: null,
};

export function predictSnapshot(snapshot: GoldenSnapshot, env: PredictEnv): Prediction {
  let p;
  try {
    p = prepareJob(toNormalizedJob(snapshot), { countryIso2: null }, {
      profile: env.profile,
      titleOverrides: env.titleOverrides,
      fx: env.fx,
      knownCountries: KNOWN_COUNTRIES,
      now: env.now,
    });
  } catch (err) {
    return { ...EMPTY, error: err instanceof Error ? err.message : String(err) };
  }
  const f = p.facts;
  const visa = decideVisaStatus({
    postingSignals: f.visaSignals.map((s) => s.value),
    companyEvidence: [],
    manualNotes: [],
    aiSignals: [],
    countryIso2: p.countryIso2,
    now: env.now,
  });
  // A title-only seniority guess ("Senior" → 5–8 years) is not a stated requirement.
  const exp = f.experience;
  const titleGuess = exp.source === 'posting title' && exp.confidence === 'low';
  const salary = f.salary && f.salary.value.kind === 'stated' ? f.salary.value : null;
  return {
    role_match: f.role.value.roleFamily !== 'other',
    role_key: f.role.value.roleKey,
    seniority: f.seniority?.value.word ?? null,
    visa_status: visa.value.status,
    remote_class: f.remote.value.class,
    salary: salary
      ? { stated: true, currency: salary.currency, period: salary.period, min: salary.min, max: salary.max }
      : { stated: false, currency: null, period: null, min: null, max: null },
    language: f.language.value.requirement,
    country_iso2: p.countryIso2,
    experience_min_years: titleGuess ? null : exp.value.minYears,
  };
}

/** The fields a prediction covers (all of them). */
export function predictedFields(): readonly GoldenField[] {
  return ['role_match', 'role_key', 'seniority', 'visa_status', 'remote_class', 'salary', 'language', 'country_iso2', 'experience_min_years'];
}
