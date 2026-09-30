/**
 * Facts stage: writes the provenance candidates of one posting through `addFact` (never by hand),
 * then the job-level derived facts (salary estimate, visa decision, eligibility).
 *
 * Source-level facts carry the source in their `source` label ("posting text · greenhouse:gitlab")
 * so each source keeps its own candidate and the resolver picks by trust order. A value that is no
 * longer in the posting is retracted (deactivated), never deleted.
 */
import { and, asc, eq, gte, inArray, isNull, lte, ne, or } from 'drizzle-orm';
import { companyEvidence, jobFacts, jobs, visaRoutes, visaRuleVersions, type VisaRuleVersionRow } from '../../../db/schema';
import type { SalaryValue, VisaSignal } from '../../contracts/jobs';
import type { Fact, FactKey, StoredFact } from '../../contracts/provenance';
import { REMOTE_COUNTRY } from '../../contracts/settings';
import type { DbOrTx } from '../../db';
import { estimateSalary } from '../../normalize/salary';
import { addFact, getFacts, retractFacts } from '../../provenance/store';
import { checkEligibility } from '../../visa/eligibility';
import { decideVisaStatus } from '../../visa/decide';
import type { RunContext } from './context';
import type { PreparedJob } from './normalise';

/** Keys a source writes (one active candidate per source, except visa_signal). */
export const SOURCE_FACT_KEYS = ['role', 'seniority', 'experience', 'language', 'salary', 'remote', 'closing_date', 'skills', 'visa_signal'] as const;
/** Methods the source-level stage writes; manual / official / ai facts are never touched. */
const SOURCE_METHODS = ['posting', 'rule'] as const;

export function sourceLabel(factSource: string, sourceKey: string): string {
  return `${factSource} · ${sourceKey}`.slice(0, 512);
}

function sourceSuffix(sourceKey: string): string {
  return ` · ${sourceKey}`;
}

/**
 * Writes this source's candidates for the job and retracts this source's candidates that the
 * posting no longer supports. Returns the number of new or changed facts.
 */
export async function writeSourceFacts(db: DbOrTx, jobId: number, prepared: PreparedJob, sourceKey: string): Promise<number> {
  const f = prepared.facts;
  const single: [FactKey, Fact<unknown> | null][] = [
    ['role', f.role],
    ['seniority', f.seniority],
    ['experience', f.experience],
    ['language', f.language],
    ['salary', f.salary],
    ['remote', f.remote],
    ['closing_date', f.closingDate],
    ['skills', f.skills],
  ];
  const keep = new Set<number>();
  let changed = 0;
  for (const [key, fact] of single) {
    if (!fact) continue;
    const res = await addFact(db, jobId, key, { ...fact, source: sourceLabel(fact.source, sourceKey) });
    keep.add(res.id);
    if (res.created) changed++;
  }
  for (const fact of f.visaSignals) {
    const res = await addFact<VisaSignal>(db, jobId, 'visa_signal', { ...fact, source: sourceLabel(fact.source, sourceKey) });
    keep.add(res.id);
    if (res.created) changed++;
  }

  // Retract this source's candidates that were not (re)written now: the posting no longer says so.
  const active = await db
    .select({ id: jobFacts.id, source: jobFacts.source })
    .from(jobFacts)
    .where(
      and(
        eq(jobFacts.jobId, jobId),
        eq(jobFacts.isActive, true),
        inArray(jobFacts.factKey, [...SOURCE_FACT_KEYS]),
        inArray(jobFacts.method, [...SOURCE_METHODS]),
      ),
    );
  const suffix = sourceSuffix(sourceKey);
  const stale = active.filter((r) => r.source.endsWith(suffix) && !keep.has(r.id)).map((r) => r.id);
  if (stale.length) {
    await db.update(jobFacts).set({ isActive: false }).where(inArray(jobFacts.id, stale));
    changed += stale.length;
  }
  return changed;
}

// ---- job-level facts -------------------------------------------------------------------------

function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The visa rule used for the eligibility check of a job in `countryIso2`: among the country's
 * active routes, the currently effective rule version with the lowest salary threshold (the most
 * accessible skilled-worker route). Null for remote/no country or when no rule is stored.
 */
export async function eligibilityRuleFor(db: DbOrTx, countryIso2: string | null, now: Date, cache?: Map<string, VisaRuleVersionRow | null>): Promise<VisaRuleVersionRow | null> {
  if (!countryIso2 || countryIso2 === REMOTE_COUNTRY) return null;
  if (cache?.has(countryIso2)) return cache.get(countryIso2) ?? null;
  const day = today(now);
  const rows = await db
    .select({ rule: visaRuleVersions })
    .from(visaRuleVersions)
    .innerJoin(visaRoutes, eq(visaRoutes.id, visaRuleVersions.routeId))
    .where(
      and(
        eq(visaRoutes.countryIso2, countryIso2),
        eq(visaRoutes.isActive, true),
        or(isNull(visaRuleVersions.effectiveFrom), lte(visaRuleVersions.effectiveFrom, day)),
        or(isNull(visaRuleVersions.effectiveTo), gte(visaRuleVersions.effectiveTo, day)),
      ),
    )
    .orderBy(asc(visaRuleVersions.routeId), asc(visaRuleVersions.version));
  // Latest version per route, then the lowest threshold (unknown thresholds last).
  const latest = new Map<number, VisaRuleVersionRow>();
  for (const r of rows) latest.set(r.rule.routeId, r.rule);
  const best =
    [...latest.values()].sort((a, b) => (a.salaryThresholdEur ?? Number.MAX_SAFE_INTEGER) - (b.salaryThresholdEur ?? Number.MAX_SAFE_INTEGER) || a.id - b.id)[0] ??
    null;
  cache?.set(countryIso2, best);
  return best;
}

function winnerOf<T>(facts: StoredFact[], key: FactKey, pred: (f: StoredFact) => boolean = () => true): StoredFact<T> | null {
  // Same order as the resolver for one key: trust first, then confidence, then newest.
  const TRUST = ['manual', 'official', 'posting', 'rule', 'ai', 'estimate'];
  const CONF = ['high', 'medium', 'low'];
  const list = facts.filter((f) => f.key === key && f.isActive && pred(f));
  list.sort(
    (a, b) =>
      TRUST.indexOf(a.method) - TRUST.indexOf(b.method) ||
      CONF.indexOf(a.confidence) - CONF.indexOf(b.confidence) ||
      b.checkedAt.getTime() - a.checkedAt.getTime() ||
      b.id - a.id,
  );
  return (list[0] as StoredFact<T> | undefined) ?? null;
}

export interface JobFactsInput {
  jobId: number;
  companyId: number;
  countryIso2: string | null;
  roleKey: string | null;
}

/**
 * Job-level facts derived from all sources' candidates:
 * - salary estimate (method 'estimate') only while no stated salary exists;
 * - visa decision from posting signals + company evidence + manual notes + AI signals;
 * - eligibility from the resolved salary and the country's visa rule.
 */
export async function writeJobFacts(db: DbOrTx, ctx: Pick<RunContext, 'now' | 'fx' | 'settings' | 'ruleCache'>, input: JobFactsInput): Promise<void> {
  const now = ctx.now;
  let facts = await getFacts(db, input.jobId, { keys: ['salary', 'visa_signal'] });

  // ---- salary estimate
  const stated = facts.some((f) => f.key === 'salary' && f.method !== 'estimate');
  if (stated) {
    if (facts.some((f) => f.key === 'salary' && f.method === 'estimate')) await retractFacts(db, input.jobId, 'salary', { method: 'estimate' });
  } else {
    const est = estimateSalary(input.countryIso2, input.roleKey, ctx.fx, { now });
    if (est) await addFact(db, input.jobId, 'salary', est);
    else await retractFacts(db, input.jobId, 'salary', { method: 'estimate' });
  }
  facts = await getFacts(db, input.jobId, { keys: ['salary', 'visa_signal'] });

  // ---- visa decision
  const evidence = await db
    .select()
    .from(companyEvidence)
    .where(and(eq(companyEvidence.companyId, input.companyId), ne(companyEvidence.matchStatus, 'rejected')));
  const manualNotes = evidence
    .filter((e) => e.kind === 'manual_note')
    .map((e) => {
      const v = e.valueJson && typeof e.valueJson === 'object' ? (e.valueJson as Record<string, unknown>) : {};
      return {
        sponsors: v.sponsors === true,
        note: (typeof v.note === 'string' ? v.note : e.evidence) ?? '',
        at: e.checkedAt,
      };
    });
  const signals = facts.filter((f) => f.key === 'visa_signal');
  const decision = decideVisaStatus({
    postingSignals: signals.filter((f) => f.method !== 'ai').map((f) => f.value as VisaSignal),
    companyEvidence: evidence.filter((e) => e.kind !== 'manual_note'),
    manualNotes,
    aiSignals: signals.filter((f) => f.method === 'ai').map((f) => f.value as VisaSignal),
  });
  await addFact(db, input.jobId, 'visa_status', { ...decision, checkedAt: now });

  // ---- eligibility
  const salary = winnerOf<SalaryValue>(facts, 'salary');
  const rule = await eligibilityRuleFor(db, input.countryIso2, now, ctx.ruleCache);
  const elig = checkEligibility({ salary: salary?.value ?? null, rule, profile: ctx.settings.profile, now });
  await addFact(db, input.jobId, 'eligibility', elig);
}

/** Current job columns the job-level facts depend on (after column overrides). */
export async function jobFactInputs(db: DbOrTx, jobId: number): Promise<JobFactsInput | null> {
  const [row] = await db
    .select({ companyId: jobs.companyId, countryIso2: jobs.countryIso2, roleKey: jobs.roleKey })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  return row ? { jobId, ...row } : null;
}
