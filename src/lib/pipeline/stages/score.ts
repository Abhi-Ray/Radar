/**
 * Score stage: builds the ScoringInput of a job from its row + resolved facts, runs the scorer and
 * keeps job_scores / jobs.score in sync.
 *
 * History without churn: a new job_scores row is written only when the score, its components or
 * the scorer version change. Unchanged inputs (same inputs hash) write nothing; changed inputs
 * that give the same result only refresh the current row's hash.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import { companies, companyEvidence, jobScores, jobs } from '../../../db/schema';
import type {
  ExperienceValue,
  LanguageValue,
  RemoteValue,
  RoleFamily,
  RoleValue,
  SalaryValue,
  ScoreResult,
  ScoringInput,
  SkillsValue,
  VisaDecisionValue,
} from '../../contracts/jobs';
import type { Profile, ScoreWeights } from '../../contracts/settings';
import type { DbOrTx } from '../../db';
import { hashJson } from '../../hash';
import { loadResolvedFacts, type ResolvedFacts } from '../../provenance/store';
import { scoreJob } from '../../scoring/score';
import { utcDay } from '../../time';

export interface ScoreOptions {
  weights: ScoreWeights;
  profile: Profile;
  now: Date;
  /** Re-score even when the inputs hash is unchanged. */
  force?: boolean;
  resolved?: ResolvedFacts;
}

export interface ScoreOutcome {
  score: number;
  version: string;
  /** 'unchanged' = inputs identical; 'refreshed' = same result, new inputs; 'rescored' = new job_scores row. */
  action: 'unchanged' | 'refreshed' | 'rescored';
}

function clampScore(n: number): number {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
}

function withConfidence<T>(r: ResolvedFacts, key: keyof ResolvedFacts): { value: T; confidence: 'high' | 'medium' | 'low' } | null {
  const w = r[key]?.winner;
  return w ? { value: w.value as T, confidence: w.confidence } : null;
}

/** Scoring input of one job (null when the job does not exist). Exported for tests / explain. */
export async function buildScoringInput(db: DbOrTx, jobId: number, now: Date, resolved?: ResolvedFacts): Promise<ScoringInput | null> {
  const [row] = await db
    .select({
      companyId: jobs.companyId,
      roleKey: jobs.roleKey,
      roleFamily: jobs.roleFamily,
      countryIso2: jobs.countryIso2,
      workplaceType: jobs.workplaceType,
      postedAt: jobs.postedAt,
      firstSeenAt: jobs.firstSeenAt,
      lastConfirmedLiveAt: jobs.lastConfirmedLiveAt,
      linkStatus: jobs.linkStatus,
      ghostRisk: jobs.ghostRisk,
      visaStatus: jobs.visaStatus,
      eligibility: jobs.eligibility,
      isAgency: companies.isAgency,
      companyType: companies.type,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) return null;
  const r = resolved ?? (await loadResolvedFacts(db, jobId));

  const roleFact = r.role?.winner ?? null;
  const roleValue = roleFact?.value as RoleValue | undefined;
  const role = {
    roleKey: roleValue?.roleKey ?? row.roleKey,
    roleFamily: (roleValue?.roleFamily ?? row.roleFamily) as RoleFamily,
    confidence: roleFact?.confidence ?? ('low' as const),
  };
  const visaFact = r.visa_status?.winner ?? null;
  const visa = visaFact
    ? { status: row.visaStatus ?? (visaFact.value as VisaDecisionValue).status, confidence: visaFact.confidence }
    : null;
  const skills = (r.skills?.winner?.value as SkillsValue | undefined)?.matched ?? [];

  const [sponsor] = await db
    .select({ id: companyEvidence.id })
    .from(companyEvidence)
    .where(
      and(
        eq(companyEvidence.companyId, row.companyId),
        eq(companyEvidence.matchStatus, 'confirmed'),
        inArray(companyEvidence.kind, ['register_match', 'posting_history']),
      ),
    )
    .limit(1);

  return {
    role,
    experience: withConfidence<ExperienceValue>(r, 'experience'),
    visa,
    salary: withConfidence<SalaryValue>(r, 'salary'),
    remote: withConfidence<RemoteValue>(r, 'remote'),
    workplaceType: row.workplaceType,
    countryIso2: row.countryIso2,
    language: withConfidence<LanguageValue>(r, 'language'),
    postedAt: row.postedAt,
    firstSeenAt: row.firstSeenAt,
    lastConfirmedLiveAt: row.lastConfirmedLiveAt,
    linkStatus: row.linkStatus,
    ghostRisk: row.ghostRisk,
    skills: [...skills],
    company: { isAgency: row.isAgency, type: row.companyType, sponsorHistory: !!sponsor },
    eligibility: row.eligibility,
    now,
  };
}

/**
 * Hash of everything the score depends on. Dates are reduced to UTC days (a score cannot depend on
 * the minute) and `now` enters only as the current day, so a job is re-checked at most daily.
 */
export function scoringInputsHash(input: ScoringInput, weights: ScoreWeights, profile: Profile, version: string): string {
  const day = (d: Date | null) => (d ? utcDay(d) : null);
  return hashJson({
    ...input,
    postedAt: day(input.postedAt),
    firstSeenAt: day(input.firstSeenAt),
    lastConfirmedLiveAt: day(input.lastConfirmedLiveAt),
    now: day(input.now),
    weights,
    profile,
    version,
  });
}

function resultHash(res: Pick<ScoreResult, 'score' | 'version' | 'components'>): string {
  return hashJson({ score: clampScore(res.score), version: res.version, components: res.components });
}

export async function scoreJobById(db: DbOrTx, jobId: number, opts: ScoreOptions): Promise<ScoreOutcome | null> {
  const input = await buildScoringInput(db, jobId, opts.now, opts.resolved);
  if (!input) return null;
  const result = scoreJob(input, opts.weights, opts.profile);
  const score = clampScore(result.score);
  const version = result.version.slice(0, 64);
  const inputsHash = scoringInputsHash(input, opts.weights, opts.profile, version);

  const [current] = await db
    .select({
      id: jobScores.id,
      score: jobScores.score,
      scoreVersion: jobScores.scoreVersion,
      componentsJson: jobScores.componentsJson,
      inputsHash: jobScores.inputsHash,
    })
    .from(jobScores)
    .where(and(eq(jobScores.jobId, jobId), eq(jobScores.isCurrent, true)))
    .orderBy(desc(jobScores.id))
    .limit(1);

  if (current && !opts.force && current.inputsHash === inputsHash && current.scoreVersion === version) {
    return { score: current.score, version, action: 'unchanged' };
  }
  const sameResult =
    current &&
    current.scoreVersion === version &&
    resultHash({ score: current.score, version: current.scoreVersion, components: (current.componentsJson ?? []) as ScoreResult['components'] }) ===
      resultHash({ score, version, components: result.components });

  if (current && sameResult) {
    await db.update(jobScores).set({ inputsHash, computedAt: opts.now }).where(eq(jobScores.id, current.id));
    await db.update(jobs).set({ score, scoreVersion: version }).where(eq(jobs.id, jobId));
    return { score, version, action: 'refreshed' };
  }
  await db
    .update(jobScores)
    .set({ isCurrent: false })
    .where(and(eq(jobScores.jobId, jobId), eq(jobScores.isCurrent, true)));
  await db.insert(jobScores).values({
    jobId,
    score,
    componentsJson: result.components,
    scoreVersion: version,
    inputsHash,
    computedAt: opts.now,
    isCurrent: true,
  });
  await db.update(jobs).set({ score, scoreVersion: version }).where(eq(jobs.id, jobId));
  return { score, version, action: 'rescored' };
}
