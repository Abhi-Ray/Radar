/**
 * Provenance persistence (job_facts, job_overrides, corrections → golden_samples).
 *
 * - ALL candidate facts are kept; the displayed one is resolved by trust order (resolve.ts).
 * - `addFact` replaces the previous active fact from the same (method, source) — a re-run of the
 *   same extractor supersedes its own old answer but never touches other sources — and is
 *   idempotent: re-adding an identical value only refreshes checked_at. Multi-valued keys
 *   (visa_signal, red_flags) accumulate instead; stale ones are removed with `retractFacts`.
 * - Overrides are manual facts: they survive re-scrapes (the pipeline never writes job_overrides)
 *   and every change is audited in the same transaction.
 */
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  companies,
  corrections,
  countries,
  goldenSamples,
  jobFacts,
  jobOverrides,
  jobs,
  sources,
  type JobFactRow,
  type JobOverrideRow,
} from '../../db/schema';
import {
  CONFIDENCES,
  ELIGIBILITY_RESULTS,
  EXPERIENCE_BANDS,
  LANGUAGE_REQUIREMENTS,
  METHODS,
  REMOTE_CLASSES,
  ROLE_FAMILIES,
  SALARY_KINDS,
  SENIORITY_WORDS,
  VISA_STATUSES,
  WORKPLACE_TYPES,
} from '../../db/schema/_enums';
import { goldenLabelsSchema, type GoldenLabels, type GoldenSnapshot } from '../contracts/accuracy';
import { isFactKey, MULTI_VALUED_FACT_KEYS, type Fact, type FactKey, type StoredFact } from '../contracts/provenance';
import { audit, type AuditInput } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { hashJson } from '../hash';
import {
  isColumnOverrideField,
  isFactOverrideField,
  lowestConfidence,
  OVERRIDE_FIELDS,
  resolveJobFacts,
  type ColumnOverrideField,
  type OverrideLike,
  type ResolvedFacts,
} from './resolve';

export { resolveJobFacts } from './resolve';
export type { OverrideLike, ResolvedFacts } from './resolve';

const MAX_EVIDENCE = 4000;
const MAX_SOURCE = 512;
const MAX_LOGIC_VERSION = 64;
const MAX_REASON = 4000;

export class ProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProvenanceError';
  }
}

function includes<T extends string>(list: readonly T[], v: unknown): v is T {
  return typeof v === 'string' && (list as readonly string[]).includes(v);
}

function assertFact(key: string, fact: Fact<unknown>): asserts key is FactKey {
  if (!isFactKey(key)) throw new ProvenanceError(`unknown fact key: ${key}`);
  if (!includes(METHODS, fact.method)) throw new ProvenanceError(`unknown method: ${String(fact.method)}`);
  if (!includes(CONFIDENCES, fact.confidence)) throw new ProvenanceError(`unknown confidence: ${String(fact.confidence)}`);
  if (fact.value === undefined) throw new ProvenanceError('fact value must not be undefined (use null)');
  if (!(fact.checkedAt instanceof Date) || Number.isNaN(fact.checkedAt.getTime())) {
    throw new ProvenanceError('fact checkedAt must be a valid Date');
  }
  if (typeof fact.source !== 'string' || !fact.source.trim()) throw new ProvenanceError('fact source is required');
  if (typeof fact.logicVersion !== 'string' || !fact.logicVersion.trim()) {
    throw new ProvenanceError('fact logicVersion is required');
  }
}

/** JSON round-trip so stored values never contain Dates/undefined (what is read back = what was hashed). */
function toJsonValue(v: unknown): unknown {
  const s = JSON.stringify(v ?? null);
  return s === undefined ? null : (JSON.parse(s) as unknown);
}

export function rowToStoredFact(row: JobFactRow): StoredFact | null {
  if (!isFactKey(row.factKey)) return null;
  return {
    id: row.id,
    key: row.factKey,
    value: row.valueJson,
    valueHash: row.valueHash,
    evidence: row.evidence,
    source: row.source,
    method: row.method,
    confidence: row.confidence,
    checkedAt: row.checkedAt,
    logicVersion: row.logicVersion,
    isActive: row.isActive,
    createdAt: row.createdAt,
  };
}

export function rowToOverride(row: JobOverrideRow): OverrideLike {
  return {
    id: row.id,
    field: row.field,
    valueJson: row.valueJson,
    reason: row.reason,
    createdAt: row.createdAt,
    active: row.active,
  };
}

// ---- facts ---------------------------------------------------------------------------------

export interface AddFactResult {
  id: number;
  /** false when an identical active fact from the same method+source already existed. */
  created: boolean;
  /** ids of facts this one superseded (same method+source, different value). */
  deactivated: number[];
}

/**
 * Stores a candidate fact. A previous active fact from the same (key, method, source) is
 * superseded (kept, is_active=false); an identical value only refreshes checked_at/confidence/
 * evidence/logic version. Facts from other sources are never touched. For multi-valued keys
 * (MULTI_VALUED_FACT_KEYS) nothing is superseded: each distinct value is its own active fact.
 */
export async function addFact<T>(db: DbOrTx, jobId: number, key: FactKey, fact: Fact<T>): Promise<AddFactResult> {
  assertFact(key, fact as Fact<unknown>);
  const value = toJsonValue(fact.value);
  const valueHash = hashJson(value);
  const source = fact.source.trim().slice(0, MAX_SOURCE);
  const evidence = fact.evidence === null || fact.evidence === undefined ? null : String(fact.evidence).slice(0, MAX_EVIDENCE);
  const logicVersion = fact.logicVersion.trim().slice(0, MAX_LOGIC_VERSION);

  return withTransaction(db, async (tx) => {
    const existing = await tx
      .select({ id: jobFacts.id, valueHash: jobFacts.valueHash })
      .from(jobFacts)
      .where(
        and(
          eq(jobFacts.jobId, jobId),
          eq(jobFacts.factKey, key),
          eq(jobFacts.method, fact.method),
          eq(jobFacts.source, source),
          eq(jobFacts.isActive, true),
        ),
      )
      .orderBy(desc(jobFacts.id))
      .for('update');

    const same = existing.find((e) => e.valueHash === valueHash);
    const multi = MULTI_VALUED_FACT_KEYS.includes(key);
    const stale = multi ? [] : existing.filter((e) => e !== same).map((e) => e.id);
    if (stale.length) await tx.update(jobFacts).set({ isActive: false }).where(inArray(jobFacts.id, stale));

    if (same) {
      await tx
        .update(jobFacts)
        .set({ checkedAt: fact.checkedAt, confidence: fact.confidence, evidence, logicVersion })
        .where(eq(jobFacts.id, same.id));
      return { id: same.id, created: false, deactivated: stale };
    }
    const [res] = await tx.insert(jobFacts).values({
      jobId,
      factKey: key,
      valueJson: value,
      valueHash,
      evidence,
      source,
      method: fact.method,
      confidence: fact.confidence,
      checkedAt: fact.checkedAt,
      logicVersion,
      isActive: true,
    });
    return { id: Number(res.insertId), created: true, deactivated: stale };
  });
}

/**
 * Deactivates active facts of `key` (optionally only from `source`/`method`) — e.g. a signal
 * that is no longer in the posting. Returns the number of facts deactivated.
 */
export async function retractFacts(
  db: DbOrTx,
  jobId: number,
  key: FactKey,
  filter: { source?: string; method?: Fact<unknown>['method'] } = {},
): Promise<number> {
  const conds = [eq(jobFacts.jobId, jobId), eq(jobFacts.factKey, key), eq(jobFacts.isActive, true)];
  if (filter.source !== undefined) conds.push(eq(jobFacts.source, filter.source.trim().slice(0, MAX_SOURCE)));
  if (filter.method !== undefined) conds.push(eq(jobFacts.method, filter.method));
  const [res] = await db
    .update(jobFacts)
    .set({ isActive: false })
    .where(and(...conds));
  return res.affectedRows;
}

export interface GetFactsOptions {
  includeInactive?: boolean;
  keys?: readonly FactKey[];
}

/** Candidate facts of one job (active only by default), newest first within each key. */
export async function getFacts(db: DbOrTx, jobId: number, opts: GetFactsOptions = {}): Promise<StoredFact[]> {
  const conds = [eq(jobFacts.jobId, jobId)];
  if (!opts.includeInactive) conds.push(eq(jobFacts.isActive, true));
  if (opts.keys?.length) conds.push(inArray(jobFacts.factKey, [...opts.keys]));
  const rows = await db
    .select()
    .from(jobFacts)
    .where(and(...conds))
    .orderBy(jobFacts.factKey, desc(jobFacts.checkedAt), desc(jobFacts.id));
  return rows.map(rowToStoredFact).filter((f): f is StoredFact => f !== null);
}

/** Overrides of one job (active only by default), newest first. */
export async function getOverrides(
  db: DbOrTx,
  jobId: number,
  opts: { includeInactive?: boolean } = {},
): Promise<OverrideLike[]> {
  const conds = [eq(jobOverrides.jobId, jobId)];
  if (!opts.includeInactive) conds.push(eq(jobOverrides.active, true));
  const rows = await db
    .select()
    .from(jobOverrides)
    .where(and(...conds))
    .orderBy(desc(jobOverrides.createdAt), desc(jobOverrides.id));
  return rows.map(rowToOverride);
}

/** Facts + overrides of one job, resolved by trust order. */
export async function loadResolvedFacts(db: DbOrTx, jobId: number): Promise<ResolvedFacts> {
  const facts = await getFacts(db, jobId);
  const overrides = await getOverrides(db, jobId);
  return resolveJobFacts(facts, overrides);
}

// ---- overrides -----------------------------------------------------------------------------

export interface ActorOptions {
  actor?: AuditInput['actor'];
  ip?: string | null;
}

export interface SetOverrideResult {
  id: number;
  /** Value of the override this one replaced (null when none). */
  previous: unknown;
}

function requireReason(reason: unknown, what: string): string {
  const why = typeof reason === 'string' ? reason.trim() : '';
  if (!why) throw new ProvenanceError(`${what} needs a reason`);
  return why.slice(0, MAX_REASON);
}

async function assertJobExists(db: DbOrTx, jobId: number): Promise<void> {
  const [job] = await db.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId)).limit(1).for('update');
  if (!job) throw new ProvenanceError(`job ${jobId} not found`);
}

/**
 * Sets a manual override (method 'manual' — beats every other source). Replaces the active
 * override of the same field; column fields (title/country/city/workplace_type) are also written
 * to the job row, fact fields re-sync the denormalised columns. Audited in the same transaction.
 */
export async function setOverride(
  db: DbOrTx,
  jobId: number,
  field: string,
  value: unknown,
  reason: string,
  opts: ActorOptions = {},
): Promise<SetOverrideResult> {
  if (!OVERRIDE_FIELDS.includes(field)) throw new ProvenanceError(`field cannot be overridden: ${field}`);
  const why = requireReason(reason, 'an override');
  if (value === undefined) throw new ProvenanceError('override value must not be undefined (use null)');
  const valueJson = toJsonValue(value);
  if (isColumnOverrideField(field)) validateColumnOverride(field, valueJson);

  return withTransaction(db, async (tx) => {
    await assertJobExists(tx, jobId);
    if (isColumnOverrideField(field) && field === 'country' && valueJson !== null) {
      const [c] = await tx.select({ iso2: countries.iso2 }).from(countries).where(eq(countries.iso2, String(valueJson))).limit(1);
      if (!c) throw new ProvenanceError(`unknown country: ${String(valueJson)}`);
    }
    const previousRows = await tx
      .select()
      .from(jobOverrides)
      .where(and(eq(jobOverrides.jobId, jobId), eq(jobOverrides.field, field), eq(jobOverrides.active, true)))
      .orderBy(desc(jobOverrides.createdAt), desc(jobOverrides.id))
      .for('update');
    const now = new Date();
    if (previousRows.length) {
      await tx
        .update(jobOverrides)
        .set({ active: false, deactivatedAt: now })
        .where(inArray(jobOverrides.id, previousRows.map((r) => r.id)));
    }
    const [res] = await tx.insert(jobOverrides).values({ jobId, field, valueJson, reason: why, active: true, createdAt: now });
    const id = Number(res.insertId);
    const previous = previousRows[0]?.valueJson ?? null;

    if (isColumnOverrideField(field)) await writeColumnOverride(tx, jobId, field, valueJson);
    else await syncResolvedJobColumns(tx, jobId);

    await audit(tx, {
      action: 'job.override.set',
      entityType: 'job',
      entityId: jobId,
      before: previousRows.length ? { field, value: previous } : null,
      after: { field, value: valueJson, overrideId: id },
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });
    return { id, previous };
  });
}

/**
 * Removes the active override of a field; the resolved value falls back to the best fact.
 * Column fields keep their current job-row value until the pipeline next re-normalises the job.
 * Audited. Returns false when there was nothing to clear.
 */
export async function clearOverride(
  db: DbOrTx,
  jobId: number,
  field: string,
  reason: string,
  opts: ActorOptions = {},
): Promise<boolean> {
  const why = requireReason(reason, 'clearing an override');
  return withTransaction(db, async (tx) => {
    const rows = await tx
      .select()
      .from(jobOverrides)
      .where(and(eq(jobOverrides.jobId, jobId), eq(jobOverrides.field, field), eq(jobOverrides.active, true)))
      .orderBy(desc(jobOverrides.createdAt), desc(jobOverrides.id))
      .for('update');
    if (!rows.length) return false;
    await tx
      .update(jobOverrides)
      .set({ active: false, deactivatedAt: new Date() })
      .where(inArray(jobOverrides.id, rows.map((r) => r.id)));
    if (isFactOverrideField(field)) await syncResolvedJobColumns(tx, jobId);
    await audit(tx, {
      action: 'job.override.clear',
      entityType: 'job',
      entityId: jobId,
      before: { field, value: rows[0].valueJson },
      after: null,
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });
    return true;
  });
}

function validateColumnOverride(field: ColumnOverrideField, value: unknown): void {
  if (value !== null && typeof value !== 'string') {
    throw new ProvenanceError(`override value for ${field} must be a string or null`);
  }
  const str = value === null ? null : value.trim();
  switch (field) {
    case 'title':
      if (!str) throw new ProvenanceError('title override must not be empty');
      if (str.length > 255) throw new ProvenanceError('title override is too long');
      return;
    case 'country':
      if (str !== null && !/^[A-Z]{2}$/.test(str)) throw new ProvenanceError('country override must be an upper-case ISO2 code');
      return;
    case 'city':
      if (str !== null && str.length > 128) throw new ProvenanceError('city override is too long');
      return;
    case 'workplace_type':
      if (str !== null && !includes(WORKPLACE_TYPES, str)) {
        throw new ProvenanceError('workplace_type override must be onsite, hybrid, remote or null');
      }
      return;
  }
}

async function writeColumnOverride(db: DbOrTx, jobId: number, field: ColumnOverrideField, value: unknown): Promise<void> {
  const str = typeof value === 'string' ? value.trim() : null;
  switch (field) {
    case 'title':
      if (str) await db.update(jobs).set({ canonicalTitle: str }).where(eq(jobs.id, jobId));
      return;
    case 'country':
      await db.update(jobs).set({ countryIso2: str }).where(eq(jobs.id, jobId));
      return;
    case 'city':
      await db.update(jobs).set({ city: str || null }).where(eq(jobs.id, jobId));
      return;
    case 'workplace_type':
      await db
        .update(jobs)
        .set({ workplaceType: includes(WORKPLACE_TYPES, str) ? str : null })
        .where(eq(jobs.id, jobId));
      return;
  }
}

/**
 * Re-applies the active column overrides to the job row. The pipeline calls this after it
 * rewrites title/country/city/workplace_type so manual fixes survive re-scrapes.
 * Returns the number of fields re-applied. Invalid stored values are skipped.
 */
export async function reapplyColumnOverrides(db: DbOrTx, jobId: number): Promise<number> {
  const latest = new Map<ColumnOverrideField, unknown>();
  for (const o of await getOverrides(db, jobId)) {
    // getOverrides is newest-first: the first one per field wins.
    if (isColumnOverrideField(o.field) && !latest.has(o.field)) latest.set(o.field, o.valueJson);
  }
  let applied = 0;
  for (const [field, value] of latest) {
    try {
      validateColumnOverride(field, value);
    } catch {
      continue;
    }
    await writeColumnOverride(db, jobId, field, value);
    applied += 1;
  }
  return applied;
}

// ---- denormalised job columns --------------------------------------------------------------

function prop(v: unknown, k: string): unknown {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>)[k] : undefined;
}

function pick<T extends string>(list: readonly T[], v: unknown): T | null {
  return includes(list, v) ? v : null;
}

function intOrNull(v: unknown, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.min(Math.round(v), max) : null;
}

/** Keys whose confidence feeds jobs.facts_confidence (the weakest displayed fact). */
export const CORE_FACT_KEYS: readonly FactKey[] = ['visa_status', 'salary', 'experience', 'remote', 'language', 'role'];

const INT_UNSIGNED_MAX = 4_294_967_295;
const TINYINT_UNSIGNED_MAX = 255;

/** Maps resolved winners onto the denormalised jobs columns (pure; exported for tests). */
export function resolvedToJobColumns(r: ResolvedFacts, now: Date = new Date()) {
  const visa = r.visa_status;
  const salary = r.salary?.winner ?? null;
  const experience = r.experience?.winner?.value;
  const role = r.role?.winner?.value;
  const visaStatus = visa?.winner ? (visa.conflict ? 'conflicting' : pick(VISA_STATUSES, prop(visa.winner.value, 'status'))) : null;
  const cols = {
    visaStatus,
    visaConfidence: visa?.winner ? visa.winner.confidence : null,
    remoteClass: pick(REMOTE_CLASSES, prop(r.remote?.winner?.value, 'class')),
    languageRequirement: pick(LANGUAGE_REQUIREMENTS, prop(r.language?.winner?.value, 'requirement')),
    experienceBand: pick(EXPERIENCE_BANDS, prop(experience, 'band')),
    experienceMinYears: intOrNull(prop(experience, 'minYears'), TINYINT_UNSIGNED_MAX),
    seniority: pick(SENIORITY_WORDS, prop(r.seniority?.winner?.value, 'word')),
    eligibility: pick(ELIGIBILITY_RESULTS, prop(r.eligibility?.winner?.value, 'result')),
    salaryEurMin: intOrNull(prop(salary?.value, 'annualEurMin'), INT_UNSIGNED_MAX),
    salaryEurMax: intOrNull(prop(salary?.value, 'annualEurMax'), INT_UNSIGNED_MAX),
    salaryKind: salary
      ? salary.method === 'estimate'
        ? ('estimated' as const)
        : (pick(SALARY_KINDS, prop(salary.value, 'kind')) ?? ('stated' as const))
      : null,
    factsConfidence: lowestConfidence(r, CORE_FACT_KEYS),
    resolvedAt: now,
  };
  const roleCols =
    role !== undefined && pick(ROLE_FAMILIES, prop(role, 'roleFamily'))
      ? {
          roleKey: typeof prop(role, 'roleKey') === 'string' ? (prop(role, 'roleKey') as string).slice(0, 64) : null,
          roleFamily: pick(ROLE_FAMILIES, prop(role, 'roleFamily')) ?? ('other' as const),
        }
      : {};
  return { ...cols, ...roleCols };
}

/**
 * Writes the resolved winners into the denormalised jobs columns used for list filtering and
 * sorting. The job page always reads the facts themselves.
 */
export async function syncResolvedJobColumns(db: DbOrTx, jobId: number, resolved?: ResolvedFacts): Promise<void> {
  const r = resolved ?? (await loadResolvedFacts(db, jobId));
  await db.update(jobs).set(resolvedToJobColumns(r)).where(eq(jobs.id, jobId));
}

// ---- corrections → golden sample -----------------------------------------------------------

export interface RecordCorrectionInput {
  jobId: number;
  /** Fact key or column field that was wrong (e.g. 'visa_status', 'salary', 'country'). */
  field: string;
  wrongValue?: unknown;
  correctValue?: unknown;
  note?: string | null;
  /** Default true: the case is added to the golden sample (spec §17). */
  addToGolden?: boolean;
  /** Also apply the correct value as a manual override (needs correctValue and an override field). */
  applyAsOverride?: boolean;
}

export interface RecordCorrectionResult {
  correctionId: number;
  goldenSampleId: number | null;
  overrideId: number | null;
}

/**
 * Maps a corrected field/value onto golden-sample labels. Values may be the plain label
 * ('likely') or the fact value object ({status: 'likely', …}). Unmappable input → {} (the sample
 * is still stored, with the correction in its notes, for labelling later).
 */
export function correctionToLabels(fieldName: string, correct: unknown): GoldenLabels {
  const v = correct;
  const str = (k: string): unknown => (typeof v === 'string' ? v : prop(v, k));
  const c: Record<string, unknown> = {};
  switch (fieldName) {
    case 'visa_status':
      c.visa_status = str('status');
      break;
    case 'remote':
    case 'remote_class':
      c.remote_class = str('class');
      break;
    case 'language':
      c.language = str('requirement');
      break;
    case 'seniority':
      c.seniority = v === null ? null : str('word');
      break;
    case 'role':
    case 'role_key': {
      c.role_key = v === null ? null : str('roleKey');
      const fam = prop(v, 'roleFamily');
      if (includes(ROLE_FAMILIES, fam)) c.role_match = fam !== 'other';
      break;
    }
    case 'role_match':
      c.role_match = v;
      break;
    case 'experience':
    case 'experience_min_years':
      c.experience_min_years = typeof v === 'number' || v === null ? v : prop(v, 'minYears');
      break;
    case 'country':
    case 'country_iso2':
      c.country_iso2 = typeof v === 'string' ? v.trim().toUpperCase() : v === null ? null : undefined;
      break;
    case 'salary': {
      if (v === null) {
        c.salary = { stated: false };
      } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
        const kind = prop(v, 'kind');
        const stated = prop(v, 'stated');
        c.salary = {
          stated: typeof stated === 'boolean' ? stated : kind !== 'estimated',
          currency: prop(v, 'currency') ?? null,
          period: prop(v, 'period') ?? null,
          min: prop(v, 'min') ?? null,
          max: prop(v, 'max') ?? null,
        };
      }
      break;
    }
    default:
      break;
  }
  for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];
  const parsed = goldenLabelsSchema.safeParse(c);
  return parsed.success ? parsed.data : {};
}

export type JobSnapshot = GoldenSnapshot & {
  jobId: number;
  capturedAt: string;
  canonicalTitle: string;
  city: string | null;
  /** Resolved winners at the time of the snapshot (what the app showed). */
  resolved: Record<string, { value: unknown; method: string; confidence: string; source: string }>;
};

/** Self-contained copy of a job (survives the job being deleted). Null when the job does not exist. */
export async function buildJobSnapshot(
  db: DbOrTx,
  jobId: number,
  now: Date = new Date(),
): Promise<{ snapshot: JobSnapshot; sourceKey: string | null; countryIso2: string | null } | null> {
  const [row] = await db
    .select({
      id: jobs.id,
      titleRaw: jobs.titleRaw,
      canonicalTitle: jobs.canonicalTitle,
      company: companies.name,
      locationRaw: jobs.locationRaw,
      countryIso2: jobs.countryIso2,
      city: jobs.city,
      workplaceType: jobs.workplaceType,
      descriptionText: jobs.descriptionText,
      applyUrl: jobs.applyUrl,
      sourceKey: sources.sourceKey,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .leftJoin(sources, eq(sources.id, jobs.bestSourceId))
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!row) return null;
  const resolved = await loadResolvedFacts(db, jobId);
  const values: JobSnapshot['resolved'] = {};
  for (const [k, v] of Object.entries(resolved)) {
    if (v?.winner) {
      values[k] = { value: v.winner.value, method: v.winner.method, confidence: v.winner.confidence, source: v.winner.source };
    }
  }
  return {
    snapshot: {
      jobId: row.id,
      capturedAt: now.toISOString(),
      title: row.titleRaw,
      canonicalTitle: row.canonicalTitle,
      company: row.company,
      locationRaw: row.locationRaw,
      countryHint: row.countryIso2,
      city: row.city,
      descriptionText: row.descriptionText,
      applyUrl: row.applyUrl,
      sourceKey: row.sourceKey,
      workplaceHint: row.workplaceType,
      resolved: values,
    },
    sourceKey: row.sourceKey,
    countryIso2: row.countryIso2,
  };
}

/**
 * "Report wrong info" (spec §17): stores the correction, adds the case to the golden sample
 * (origin 'correction', labelled with the correct value, with a snapshot of the job) and
 * optionally applies the fix as a manual override. All in one transaction, audited.
 */
export async function recordCorrection(
  db: DbOrTx,
  input: RecordCorrectionInput,
  opts: ActorOptions = {},
): Promise<RecordCorrectionResult> {
  const fieldName = typeof input.field === 'string' ? input.field.trim() : '';
  if (!fieldName || fieldName.length > 64) throw new ProvenanceError('correction field is required (max 64 chars)');
  const addToGolden = input.addToGolden ?? true;
  const wrong = input.wrongValue === undefined ? null : toJsonValue(input.wrongValue);
  const correct = input.correctValue === undefined ? null : toJsonValue(input.correctValue);
  const note = typeof input.note === 'string' && input.note.trim() ? input.note.trim().slice(0, MAX_REASON) : null;
  if (input.applyAsOverride && (input.correctValue === undefined || !OVERRIDE_FIELDS.includes(fieldName))) {
    throw new ProvenanceError(`cannot apply a correction of ${fieldName} as an override`);
  }

  return withTransaction(db, async (tx) => {
    const snap = await buildJobSnapshot(tx, input.jobId);
    if (!snap) throw new ProvenanceError(`job ${input.jobId} not found`);
    const [res] = await tx.insert(corrections).values({
      jobId: input.jobId,
      field: fieldName,
      wrongValueJson: wrong,
      correctValueJson: correct,
      note,
      addedToGolden: false,
    });
    const correctionId = Number(res.insertId);

    let goldenSampleId: number | null = null;
    if (addToGolden) {
      const labels = input.correctValue === undefined ? {} : correctionToLabels(fieldName, correct);
      const [g] = await tx.insert(goldenSamples).values({
        jobId: input.jobId,
        snapshotJson: snap.snapshot as unknown as Record<string, unknown>,
        labelsJson: labels as Record<string, unknown>,
        sourceKey: snap.sourceKey,
        countryIso2: snap.countryIso2,
        origin: 'correction',
        notes: [`correction #${correctionId} (${fieldName})`, note].filter(Boolean).join(': ').slice(0, MAX_REASON),
      });
      goldenSampleId = Number(g.insertId);
      await tx.update(corrections).set({ addedToGolden: true, goldenSampleId }).where(eq(corrections.id, correctionId));
    }

    let overrideId: number | null = null;
    if (input.applyAsOverride) {
      const o = await setOverride(tx, input.jobId, fieldName, correct, note ?? `correction #${correctionId}`, opts);
      overrideId = o.id;
    }

    await audit(tx, {
      action: 'job.correction',
      entityType: 'job',
      entityId: input.jobId,
      before: { field: fieldName, value: wrong },
      after: { field: fieldName, value: correct, correctionId, goldenSampleId, overrideId },
      reason: note,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });
    return { correctionId, goldenSampleId, overrideId };
  });
}
