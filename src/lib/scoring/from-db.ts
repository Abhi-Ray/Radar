/**
 * DB glue for the Fit Score: build a `ScoringInput` from a job's RESOLVED facts (manual
 * overrides win, spec §5), score it, and store it in job_scores (one `is_current` row per job)
 * mirrored onto jobs.score / jobs.score_version.
 *
 * Changing weights re-scores from saved data without re-scraping: `rescoreAll` reads only facts.
 * A job whose score, version and components did not change keeps its current row (no churn).
 */
import { and, asc, eq, gt, inArray, isNull } from 'drizzle-orm';
import { companies, companyEvidence, jobs, jobScores } from '../../db/schema';
import type {
  EligibilityResult,
  ExperienceValue,
  LanguageValue,
  RemoteValue,
  ScoreComponent,
  ScoreResult,
  ScoringInput,
  VisaStatus,
} from '../contracts/jobs';
import type { Confidence, StoredFact } from '../contracts/provenance';
import { CONFIDENCE_ORDER } from '../contracts/provenance';
import type { Profile, ScoreWeights } from '../contracts/settings';
import { withTransaction, type DbOrTx } from '../db';
import { hashJson } from '../hash';
import { loadResolvedFacts, type ResolvedFacts } from '../provenance/store';
import { getSetting } from '../settings';
import { toSalaryValue } from '../visa/persist';
import { isActiveEvidence, parseRegisterMatch, parseSponsorsFlag } from '../visa/types';
import { SCORE_VERSION, scoreJob } from './score';

const ROLE_FAMILIES = ['primary', 'secondary', 'fallback', 'other'] as const;
const VISA_STATUSES: readonly VisaStatus[] = ['confirmed', 'likely', 'unknown', 'not_offered', 'conflicting'];
const REMOTE_CLASSES = ['worldwide', 'region_limited', 'timezone_limited', 'unclear', 'not_remote'] as const;
const LANGUAGE_REQUIREMENTS = ['english_ok', 'local_required', 'unclear'] as const;
const EXPERIENCE_BANDS = ['core', 'show', 'hide', 'unknown'] as const;
const ELIGIBILITY_RESULTS: readonly EligibilityResult[] = ['meets', 'borderline', 'doesnt_meet', 'cant_tell'];

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function pick<T extends string>(allowed: readonly T[], v: unknown): T | null {
  return typeof v === 'string' && (allowed as readonly string[]).includes(v) ? (v as T) : null;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
}

function conf(f: StoredFact): Confidence {
  return (CONFIDENCE_ORDER as readonly string[]).includes(f.confidence) ? f.confidence : 'low';
}

/** Evidence rows that show the company sponsored before (register match, other posting, my note). */
export function hasSponsorHistory(rows: readonly { kind: string; valueJson: unknown; matchStatus: string }[]): boolean {
  return rows.some((r) => {
    if (!isActiveEvidence({ matchStatus: r.matchStatus as 'confirmed' | 'possible' | 'rejected' })) return false;
    if (r.kind === 'register_match') return r.matchStatus === 'confirmed' && parseRegisterMatch(r.valueJson) !== null;
    if (r.kind === 'posting_history' || r.kind === 'manual_note') return parseSponsorsFlag(r.valueJson)?.sponsors === true;
    return false;
  });
}

export interface JobScoringRow {
  countryIso2: string | null;
  workplaceType: ScoringInput['workplaceType'];
  roleKey: string | null;
  roleFamily: ScoringInput['role']['roleFamily'];
  postedAt: Date | null;
  firstSeenAt: Date;
  lastConfirmedLiveAt: Date | null;
  linkStatus: ScoringInput['linkStatus'];
  ghostRisk: boolean;
}

/** Pure: resolved facts + the job row + company signals → ScoringInput. Exported for tests. */
export function buildScoringInput(
  job: JobScoringRow,
  resolved: ResolvedFacts,
  company: ScoringInput['company'],
  now: Date,
): ScoringInput {
  const roleF = resolved.role?.winner ?? null;
  const roleV = obj(roleF?.value);
  const role: ScoringInput['role'] = roleF && roleV && pick(ROLE_FAMILIES, roleV.roleFamily)
    ? { roleKey: typeof roleV.roleKey === 'string' ? roleV.roleKey : null, roleFamily: pick(ROLE_FAMILIES, roleV.roleFamily)!, confidence: conf(roleF) }
    : { roleKey: job.roleKey, roleFamily: job.roleFamily, confidence: 'low' };

  const expF = resolved.experience?.winner ?? null;
  const expV = obj(expF?.value);
  const experience: ScoringInput['experience'] =
    expF && expV
      ? {
          value: {
            minYears: numOrNull(expV.minYears),
            maxYears: numOrNull(expV.maxYears),
            band: pick(EXPERIENCE_BANDS, expV.band) ?? 'unknown',
            securityStrict: expV.securityStrict === true,
          } satisfies ExperienceValue,
          confidence: conf(expF),
        }
      : null;

  const visaR = resolved.visa_status;
  const visaStatus = visaR?.winner ? (visaR.conflict ? 'conflicting' : pick(VISA_STATUSES, obj(visaR.winner.value)?.status)) : null;
  const visa: ScoringInput['visa'] = visaR?.winner && visaStatus ? { status: visaStatus, confidence: conf(visaR.winner) } : null;

  const salF = resolved.salary?.winner ?? null;
  const salV = salF ? toSalaryValue(salF.value, salF.method) : null;
  const salary: ScoringInput['salary'] = salF && salV ? { value: salV, confidence: conf(salF) } : null;

  const remF = resolved.remote?.winner ?? null;
  const remV = obj(remF?.value);
  const remoteClass = pick(REMOTE_CLASSES, remV?.class);
  const remote: ScoringInput['remote'] =
    remF && remV && remoteClass ? { value: { class: remoteClass, regions: strings(remV.regions) } satisfies RemoteValue, confidence: conf(remF) } : null;

  const langF = resolved.language?.winner ?? null;
  const langV = obj(langF?.value);
  const requirement = pick(LANGUAGE_REQUIREMENTS, langV?.requirement);
  const language: ScoringInput['language'] =
    langF && langV && requirement
      ? {
          value: { postingLang: typeof langV.postingLang === 'string' ? langV.postingLang : null, requirement, languages: strings(langV.languages) } satisfies LanguageValue,
          confidence: conf(langF),
        }
      : null;

  const skillsV = resolved.skills?.winner?.value;
  const skillsO = obj(skillsV);
  const skills = [...new Set(skillsO ? [...strings(skillsO.found), ...strings(skillsO.matched)] : strings(skillsV))];

  const eligibility = pick(ELIGIBILITY_RESULTS, obj(resolved.eligibility?.winner?.value)?.result);

  return {
    role,
    experience,
    visa,
    salary,
    remote,
    workplaceType: job.workplaceType,
    countryIso2: job.countryIso2,
    language,
    postedAt: job.postedAt,
    firstSeenAt: job.firstSeenAt,
    lastConfirmedLiveAt: job.lastConfirmedLiveAt,
    linkStatus: job.linkStatus,
    ghostRisk: job.ghostRisk,
    skills,
    company,
    eligibility,
    now,
  };
}

/** The scoring input of one job from its resolved facts (overrides included). Null: no such job. */
export async function scoreInputFromDb(db: DbOrTx, jobId: number, now: Date = new Date()): Promise<ScoringInput | null> {
  const [job] = await db
    .select({
      companyId: jobs.companyId,
      countryIso2: jobs.countryIso2,
      workplaceType: jobs.workplaceType,
      roleKey: jobs.roleKey,
      roleFamily: jobs.roleFamily,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
      lastConfirmedLiveAt: jobs.lastConfirmedLiveAt,
      linkStatus: jobs.linkStatus,
      ghostRisk: jobs.ghostRisk,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;
  const [co] = await db.select({ isAgency: companies.isAgency, type: companies.type }).from(companies).where(eq(companies.id, job.companyId)).limit(1);
  const evidence = await db
    .select({ kind: companyEvidence.kind, valueJson: companyEvidence.valueJson, matchStatus: companyEvidence.matchStatus })
    .from(companyEvidence)
    .where(eq(companyEvidence.companyId, job.companyId));
  const resolved = await loadResolvedFacts(db, jobId);
  const company: ScoringInput['company'] = {
    isAgency: co?.isAgency ?? false,
    type: co?.type ?? 'unknown',
    sponsorHistory: hasSponsorHistory(evidence),
  };
  return buildScoringInput(job, resolved, company, now);
}

/** Hash of what the score depends on (the clock excluded), stored as job_scores.inputs_hash. */
export function scoringInputsHash(input: ScoringInput, weights: ScoreWeights, profile: Profile): string {
  const { now: _now, ...rest } = input;
  void _now;
  return hashJson({ version: SCORE_VERSION, input: rest, weights, profile });
}

function sameComponents(a: unknown, b: ScoreComponent[]): boolean {
  return hashJson(a) === hashJson(b);
}

export interface StoreScoreResult {
  result: ScoreResult;
  /** False when the current row already had this exact score, version and components. */
  written: boolean;
}

/** Store `result` as the job's current score (previous rows kept with is_current = false). */
export async function storeJobScore(db: DbOrTx, jobId: number, result: ScoreResult, inputsHash: string | null, now: Date = new Date()): Promise<boolean> {
  return withTransaction(db, async (tx) => {
    const [current] = await tx
      .select({ id: jobScores.id, score: jobScores.score, scoreVersion: jobScores.scoreVersion, componentsJson: jobScores.componentsJson, inputsHash: jobScores.inputsHash })
      .from(jobScores)
      .where(and(eq(jobScores.jobId, jobId), eq(jobScores.isCurrent, true)))
      .orderBy(asc(jobScores.id))
      .limit(1);
    if (
      current &&
      current.score === result.score &&
      current.scoreVersion === result.version &&
      current.inputsHash === inputsHash &&
      sameComponents(current.componentsJson, result.components)
    ) {
      return false;
    }
    await tx.update(jobScores).set({ isCurrent: false }).where(and(eq(jobScores.jobId, jobId), eq(jobScores.isCurrent, true)));
    await tx.insert(jobScores).values({ jobId, score: result.score, componentsJson: result.components, scoreVersion: result.version, inputsHash, computedAt: now, isCurrent: true });
    await tx.update(jobs).set({ score: result.score, scoreVersion: result.version }).where(eq(jobs.id, jobId));
    return true;
  });
}

export interface ScoringContext {
  weights: ScoreWeights;
  profile: Profile;
}

export async function loadScoringContext(db: DbOrTx): Promise<ScoringContext> {
  const [weights, profile] = await Promise.all([getSetting(db, 'score_weights'), getSetting(db, 'profile')]);
  return { weights, profile };
}

/** Score one job from its facts and store it. Null when the job does not exist. */
export async function rescoreJob(
  db: DbOrTx,
  jobId: number,
  opts: { now?: Date; context?: ScoringContext } = {},
): Promise<StoreScoreResult | null> {
  const now = opts.now ?? new Date();
  const ctx = opts.context ?? (await loadScoringContext(db));
  const input = await scoreInputFromDb(db, jobId, now);
  if (!input) return null;
  const result = scoreJob(input, ctx.weights, ctx.profile);
  const written = await storeJobScore(db, jobId, result, scoringInputsHash(input, ctx.weights, ctx.profile), now);
  return { result, written };
}

export interface RescoreAllOptions {
  now?: Date;
  /** Only these jobs (default: every job not merged into another). */
  jobIds?: number[];
  /** Page size of the job id scan. */
  batchSize?: number;
}

export interface RescoreAllResult {
  scored: number;
  written: number;
  unchanged: number;
  version: string;
}

/**
 * Re-score every live (unmerged) job from saved facts with the current weights and profile.
 * Runs job by job (each in its own transaction) so a long run never holds a big lock.
 */
export async function rescoreAll(db: DbOrTx, opts: RescoreAllOptions = {}): Promise<RescoreAllResult> {
  const now = opts.now ?? new Date();
  const context = await loadScoringContext(db);
  const batch = Math.max(1, Math.min(opts.batchSize ?? 500, 5000));
  const out: RescoreAllResult = { scored: 0, written: 0, unchanged: 0, version: SCORE_VERSION };
  const run = async (ids: number[]) => {
    for (const id of ids) {
      const r = await rescoreJob(db, id, { now, context });
      if (!r) continue;
      out.scored++;
      if (r.written) out.written++;
      else out.unchanged++;
    }
  };
  if (opts.jobIds) {
    const wanted = [...new Set(opts.jobIds)];
    for (let i = 0; i < wanted.length; i += batch) {
      const slice = wanted.slice(i, i + batch);
      const rows = await db
        .select({ id: jobs.id })
        .from(jobs)
        .where(and(inArray(jobs.id, slice), isNull(jobs.mergedIntoJobId)))
        .orderBy(asc(jobs.id));
      await run(rows.map((r) => r.id));
    }
    return out;
  }
  let after = 0;
  for (;;) {
    const rows = await db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(gt(jobs.id, after), isNull(jobs.mergedIntoJobId)))
      .orderBy(asc(jobs.id))
      .limit(batch);
    if (!rows.length) break;
    await run(rows.map((r) => r.id));
    after = rows[rows.length - 1].id;
  }
  return out;
}
