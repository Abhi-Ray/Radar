/**
 * DB glue for the visa engine: store posting/AI visa signals as `visa_signal` facts, and turn
 * them + company evidence into one `visa_status` fact per job (spec §13.4, §5).
 *
 * `visa_status` facts all use source "visa engine". Because the provenance store only supersedes
 * facts with the same (method, source), a new decision first retracts the engine's facts under
 * every OTHER method, so exactly one engine verdict is ever active (manual overrides live in
 * job_overrides and still win in the resolver).
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { companyEvidence, jobs } from '../../db/schema';
import type { EligibilityValue, SalaryValue, VisaDecisionValue, VisaSignal, VisaSignalKind } from '../contracts/jobs';
import type { Fact, Method } from '../contracts/provenance';
import { CONFIDENCE_ORDER, TRUST_ORDER } from '../contracts/provenance';
import { withTransaction, type DbOrTx } from '../db';
import { hashJson } from '../hash';
import { addFact, getFacts, loadResolvedFacts, retractFacts, syncResolvedJobColumns } from '../provenance/store';
import { REMOTE_COUNTRY } from '../contracts/settings';
import { getSetting } from '../settings';
import { decideVisaStatus, VISA_ENGINE_SOURCE, type DecideVisaInput } from './decide';
import { checkEligibilityForCountry, ELIGIBILITY_SOURCE } from './eligibility';
import { currentRulesForCountry } from './rules';
import { VISA_SIGNALS_LOGIC_VERSION } from './signals';

/** Default `source` of posting-text visa signals. */
export const VISA_SIGNAL_POSTING_SOURCE = 'posting text';

const SIGNAL_KINDS: readonly VisaSignalKind[] = ['offered', 'not_offered', 'relocation', 'right_to_work_required'];

/** A `visa_signal` fact value read back from JSON (null when malformed). */
export function parseVisaSignal(v: unknown): VisaSignal | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (typeof o.signal !== 'string' || !(SIGNAL_KINDS as readonly string[]).includes(o.signal)) return null;
  if (typeof o.quote !== 'string' || !o.quote.trim()) return null;
  const confidence = typeof o.confidence === 'string' && (CONFIDENCE_ORDER as readonly string[]).includes(o.confidence) ? o.confidence : 'low';
  return {
    signal: o.signal as VisaSignalKind,
    quote: o.quote,
    lang: typeof o.lang === 'string' ? o.lang : 'und',
    ruleId: typeof o.ruleId === 'string' ? o.ruleId : 'unknown',
    confidence: confidence as VisaSignal['confidence'],
  };
}

export interface WriteSignalsOptions {
  method: Extract<Method, 'posting' | 'ai' | 'manual'>;
  source?: string;
  logicVersion?: string;
  now?: Date;
}

/**
 * Replaces the job's active visa_signal facts from (method, source) with `signals`. Identical
 * signals only refresh checked_at; if any old signal disappeared, the set is rewritten.
 * Returns the number of active signals from this source afterwards.
 */
export async function writeVisaSignals(db: DbOrTx, jobId: number, signals: VisaSignal[], opts: WriteSignalsOptions): Promise<number> {
  const source = opts.source ?? VISA_SIGNAL_POSTING_SOURCE;
  const now = opts.now ?? new Date();
  const logicVersion = opts.logicVersion ?? VISA_SIGNALS_LOGIC_VERSION;
  return withTransaction(db, async (tx) => {
    const wanted = new Set(signals.map((s) => hashJson(s)));
    const current = (await getFacts(tx, jobId, { keys: ['visa_signal'] })).filter((f) => f.method === opts.method && f.source === source);
    const stale = current.some((f) => !wanted.has(f.valueHash));
    if (stale) await retractFacts(tx, jobId, 'visa_signal', { source, method: opts.method });
    for (const s of signals) {
      await addFact(tx, jobId, 'visa_signal', {
        value: s,
        evidence: s.quote,
        source,
        method: opts.method,
        confidence: s.confidence,
        checkedAt: now,
        logicVersion,
      });
    }
    return new Set(signals.map((s) => hashJson(s))).size;
  });
}

/** Stores `fact` as the job's single active engine verdict (see module comment). */
export async function writeVisaDecision(db: DbOrTx, jobId: number, fact: Fact<VisaDecisionValue>): Promise<void> {
  await withTransaction(db, async (tx) => {
    for (const method of TRUST_ORDER) {
      if (method !== fact.method) await retractFacts(tx, jobId, 'visa_status', { source: VISA_ENGINE_SOURCE, method });
    }
    await addFact(tx, jobId, 'visa_status', fact);
  });
}

/** Everything the decision needs for one job, read from job facts + company evidence. */
export async function loadVisaDecisionInput(db: DbOrTx, jobId: number, now: Date = new Date()): Promise<DecideVisaInput | null> {
  const [job] = await db
    .select({ companyId: jobs.companyId, countryIso2: jobs.countryIso2 })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!job) return null;
  const facts = await getFacts(db, jobId, { keys: ['visa_signal'] });
  const postingSignals: VisaSignal[] = [];
  const aiSignals: VisaSignal[] = [];
  for (const f of facts) {
    const s = parseVisaSignal(f.value);
    if (!s) continue;
    if (f.method === 'ai' || f.method === 'estimate') aiSignals.push(s);
    else postingSignals.push(s);
  }
  const evidence = await db
    .select({
      kind: companyEvidence.kind,
      valueJson: companyEvidence.valueJson,
      evidence: companyEvidence.evidence,
      source: companyEvidence.source,
      method: companyEvidence.method,
      confidence: companyEvidence.confidence,
      matchStatus: companyEvidence.matchStatus,
      checkedAt: companyEvidence.checkedAt,
    })
    .from(companyEvidence)
    .where(eq(companyEvidence.companyId, job.companyId))
    .orderBy(asc(companyEvidence.id));
  return { postingSignals, aiSignals, companyEvidence: evidence, manualNotes: [], countryIso2: job.countryIso2, now };
}

export interface EvaluateOptions {
  now?: Date;
  /** Re-sync the denormalised job columns afterwards (default true). */
  sync?: boolean;
}

/** Decide and store the visa status of one job. Returns the stored fact (null: job not found). */
export async function evaluateJobVisa(db: DbOrTx, jobId: number, opts: EvaluateOptions = {}): Promise<Fact<VisaDecisionValue> | null> {
  const input = await loadVisaDecisionInput(db, jobId, opts.now ?? new Date());
  if (!input) return null;
  const fact = decideVisaStatus(input);
  await writeVisaDecision(db, jobId, fact);
  if (opts.sync !== false) await syncResolvedJobColumns(db, jobId);
  return fact;
}

/** Re-decide every live (unmerged) job of a company, e.g. after its register evidence changed. */
export async function reevaluateCompanyVisa(db: DbOrTx, companyId: number, opts: EvaluateOptions = {}): Promise<number> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.companyId, companyId), isNull(jobs.mergedIntoJobId)));
  for (const r of rows) await evaluateJobVisa(db, r.id, opts);
  return rows.length;
}

/** A resolved salary fact value → SalaryValue (estimates forced to kind 'estimated'). */
export function toSalaryValue(value: unknown, method: Method): SalaryValue | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const o = value as Partial<SalaryValue>;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  if (n(o.annualEurMin) === null && n(o.annualEurMax) === null) return null;
  return {
    min: n(o.min),
    max: n(o.max),
    currency: typeof o.currency === 'string' ? o.currency : 'EUR',
    period: o.period === 'hour' || o.period === 'day' || o.period === 'month' ? o.period : 'year',
    grossNet: o.grossNet === 'gross' || o.grossNet === 'net' ? o.grossNet : 'unknown',
    installments: n(o.installments),
    annualEurMin: n(o.annualEurMin),
    annualEurMax: n(o.annualEurMax),
    fxRate: n(o.fxRate),
    fxDate: typeof o.fxDate === 'string' ? o.fxDate : null,
    kind: method === 'estimate' || o.kind === 'estimated' ? 'estimated' : 'stated',
  };
}

/**
 * Check eligibility of one job against its country's current rules (resolved salary, overrides
 * included) and store it as the `eligibility` fact. Jobs without a country get "can't tell".
 */
export async function evaluateJobEligibility(db: DbOrTx, jobId: number, opts: EvaluateOptions = {}): Promise<Fact<EligibilityValue> | null> {
  const now = opts.now ?? new Date();
  const [job] = await db.select({ countryIso2: jobs.countryIso2 }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
  if (!job) return null;
  const resolved = await loadResolvedFacts(db, jobId);
  const winner = resolved.salary?.winner ?? null;
  const salary = winner ? toSalaryValue(winner.value, winner.method) : null;
  const profile = await getSetting(db, 'profile');
  const country = job.countryIso2 && job.countryIso2 !== REMOTE_COUNTRY ? job.countryIso2 : null;
  const routes = country ? await currentRulesForCountry(db, country, now) : [];
  let fact = checkEligibilityForCountry({ salary, routes, profile, now });
  if (!country) {
    fact = { ...fact, value: { ...fact.value, reason: "No job country (remote or unknown location), so no visa rule applies: can't tell." } };
  }
  await addFact(db, jobId, 'eligibility', { ...fact, source: ELIGIBILITY_SOURCE });
  if (opts.sync !== false) await syncResolvedJobColumns(db, jobId);
  return fact;
}
