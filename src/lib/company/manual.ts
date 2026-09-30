/**
 * Manual company fixes (spec §11.2: "a manual merge/split tool lets me fix mistakes, and the fix
 * persists"). Every change runs in one transaction with its audit row.
 *
 * Merge (`mergeCompanies`): the dropped record is kept (merged_into_id → the kept one) with its
 * names, so resolveCompany keeps sending those names to the survivor and a re-run can never split
 * them again. Jobs, sources and evidence move to the survivor (each job move is written to
 * job_changes); subsidiaries are re-pointed; empty fields of the survivor are filled. What moved
 * is recorded in the audit row so a later split can bring it back.
 *
 * Split (`splitCompany`): the selected names (aliases) leave the company.
 *  - Names of a record that was merged in: that record is restored with what the merge moved
 *    (still-unchanged jobs, sources, evidence, subsidiaries, filled fields) and the names the
 *    survivor learned from it since.
 *  - Names of the company itself: a new company takes them, plus any jobs / sources I pick.
 * Afterwards resolveCompany sends those names to the split-off record: its aliases carry the full
 * legal name, which outranks the shared short name.
 *
 * Also: `setCompanyAgency` (a manual agency decision that the resolver never overrides) and
 * `setParentCompany` (parent / subsidiary links, cycle-checked).
 */
import { and, asc, desc, eq, gte, inArray, ne, notInArray, sql } from 'drizzle-orm';
import { auditLog, companies, companyAliases, companyEvidence, jobChanges, jobSources, jobs, sources } from '../../db/schema';
import { COMPANY_TYPES } from '../../db/schema/_enums';
import { audit, type AuditInput } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { canonicalJson } from '../hash';
import { collapseWhitespace } from '../normalize/text';
import { canonicalCompanyId, companyAncestors } from './family';
import { companyNameKeys, hasLegalSuffix, normalizeCompanyName } from './normalize';

export interface ManualCompanyResult {
  ok: boolean;
  message: string;
  /** The company the change was made on (the survivor of a merge / the company split). */
  companyId?: number;
  /** Split: the record that took the selected names (new or restored). */
  newCompanyId?: number;
  /** Split: true when a previously merged record was restored instead of a new one created. */
  restored?: boolean;
  /** Nothing had to change (already merged / already set). */
  noop?: boolean;
  movedJobIds?: number[];
  movedSourceIds?: number[];
}

export interface ManualCompanyOptions {
  actor?: AuditInput['actor'];
  ip?: string | null;
}

export interface SplitCompanyOptions extends ManualCompanyOptions {
  /** Name of the new company (default: the first selected name). */
  name?: string | null;
  /** Jobs that belong to the split-off company. */
  jobIds?: number[];
  /** Company-specific sources (boards) that belong to the split-off company; their jobs follow. */
  sourceIds?: number[];
}

export const MANUAL_COMPANY_SOURCE = 'manual';
const MANUAL_LOGIC_VERSION = 'manual';
const MAX_REASON = 2000;
const CHUNK = 100;
const MAX_IDS = 10_000;

type CompanyType = (typeof COMPANY_TYPES)[number];

interface FullCompany {
  id: number;
  name: string;
  normalizedName: string;
  domain: string | null;
  hqCountry: string | null;
  sizeBand: string | null;
  type: CompanyType;
  isAgency: boolean;
  parentCompanyId: number | null;
  mergedIntoId: number | null;
  sponsorSummaryJson: unknown;
}

const fullColumns = {
  id: companies.id,
  name: companies.name,
  normalizedName: companies.normalizedName,
  domain: companies.domain,
  hqCountry: companies.hqCountry,
  sizeBand: companies.sizeBand,
  type: companies.type,
  isAgency: companies.isAgency,
  parentCompanyId: companies.parentCompanyId,
  mergedIntoId: companies.mergedIntoId,
  sponsorSummaryJson: companies.sponsorSummaryJson,
};

const FILLABLE = ['domain', 'hqCountry', 'sizeBand', 'sponsorSummaryJson'] as const;
type Fillable = (typeof FILLABLE)[number];

function fail(message: string): ManualCompanyResult {
  return { ok: false, message };
}

function cleanReason(reason: unknown): string {
  return typeof reason === 'string' ? collapseWhitespace(reason).slice(0, MAX_REASON) : '';
}

function validId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
}

function uniqueIds(ids: readonly unknown[] | null | undefined): number[] {
  return [...new Set((ids ?? []).filter(validId))].slice(0, MAX_IDS);
}

/** Id lists are stored in chunks of 100: the audit redactor cuts arrays at 100 items. */
export function chunkIds(ids: readonly number[], size = CHUNK): number[][] {
  const out: number[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** Every positive integer in a (nested) JSON array; the inverse of `chunkIds`. */
export function flattenIds(value: unknown): number[] {
  const out: number[] = [];
  const walk = (v: unknown, depth: number) => {
    if (depth > 4 || out.length >= MAX_IDS) return;
    if (Array.isArray(v)) for (const x of v) walk(x, depth + 1);
    else if (validId(v)) out.push(v);
  };
  walk(value, 0);
  return [...new Set(out)];
}

function sameValue(a: unknown, b: unknown): boolean {
  return canonicalJson(a ?? null) === canonicalJson(b ?? null);
}

function summary(c: FullCompany) {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    hqCountry: c.hqCountry,
    type: c.type,
    isAgency: c.isAgency,
    parentCompanyId: c.parentCompanyId,
    mergedIntoId: c.mergedIntoId,
  };
}

async function lockCompanies(tx: DbOrTx, ids: number[]): Promise<Map<number, FullCompany>> {
  const rows = (await tx
    .select(fullColumns)
    .from(companies)
    .where(inArray(companies.id, ids))
    .orderBy(asc(companies.id))
    .for('update')) as FullCompany[];
  return new Map(rows.map((r) => [r.id, r]));
}

/** Writes one job_changes row per moved job (field company_id). */
async function recordJobCompanyMoves(tx: DbOrTx, moves: { jobId: number; from: number }[], to: number): Promise<void> {
  for (let i = 0; i < moves.length; i += 500) {
    const part = moves.slice(i, i + 500);
    await tx.insert(jobChanges).values(part.map((m) => ({ jobId: m.jobId, field: 'company_id', oldValue: String(m.from), newValue: String(to) })));
  }
}

/** Moves the given jobs to `to`, writing job_changes. Returns the ids moved. */
async function moveJobs(tx: DbOrTx, jobRows: { id: number; companyId: number }[], to: number): Promise<number[]> {
  const moves = jobRows.filter((j) => j.companyId !== to).map((j) => ({ jobId: j.id, from: j.companyId }));
  if (!moves.length) return [];
  const ids = moves.map((m) => m.jobId);
  for (const part of chunkIds(ids, 500)) await tx.update(jobs).set({ companyId: to }).where(inArray(jobs.id, part));
  await recordJobCompanyMoves(tx, moves, to);
  return ids;
}

/** Jobs of `companyIds` whose every link comes from one of `sourceIds` (a company-specific board). */
async function jobsOnlyFromSources(tx: DbOrTx, companyIds: number[], sourceIds: number[]): Promise<{ id: number; companyId: number }[]> {
  if (!sourceIds.length || !companyIds.length) return [];
  const linked = await tx
    .selectDistinct({ jobId: jobSources.jobId })
    .from(jobSources)
    .innerJoin(jobs, eq(jobs.id, jobSources.jobId))
    .where(and(inArray(jobSources.sourceId, sourceIds), inArray(jobs.companyId, companyIds)))
    .limit(MAX_IDS);
  const ids = linked.map((r) => r.jobId);
  if (!ids.length) return [];
  const out: { id: number; companyId: number }[] = [];
  for (const part of chunkIds(ids, 500)) {
    const other = await tx
      .selectDistinct({ jobId: jobSources.jobId })
      .from(jobSources)
      .where(and(inArray(jobSources.jobId, part), notInArray(jobSources.sourceId, sourceIds)));
    const mixed = new Set(other.map((r) => r.jobId));
    const rows = await tx.select({ id: jobs.id, companyId: jobs.companyId }).from(jobs).where(inArray(jobs.id, part));
    for (const r of rows) if (!mixed.has(r.id)) out.push(r);
  }
  return out;
}

/** Latest manual agency decision on a company (setCompanyAgency), or null. */
export async function manualAgencyDecision(db: DbOrTx, companyId: number): Promise<{ id: number; isAgency: boolean } | null> {
  const [row] = await db
    .select({ id: companyEvidence.id, valueJson: companyEvidence.valueJson })
    .from(companyEvidence)
    .where(
      and(
        eq(companyEvidence.companyId, companyId),
        eq(companyEvidence.kind, 'manual_note'),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${companyEvidence.valueJson}, '$.field')) = 'is_agency'`,
      ),
    )
    .orderBy(desc(companyEvidence.id))
    .limit(1);
  if (!row) return null;
  const v = row.valueJson as { isAgency?: unknown } | null;
  return { id: row.id, isAgency: v?.isAgency === true };
}

function agencyType(current: CompanyType, isAgency: boolean): CompanyType {
  if (isAgency) return 'agency';
  return current === 'agency' ? 'unknown' : current;
}

// ---- merge ---------------------------------------------------------------------------------

interface ParentChange {
  id: number;
  from: number | null;
  to: number | null;
}

/**
 * Merges company `dropId` into `keepId`. The dropped record stays (merged_into_id = keepId) with
 * its names; jobs, sources and evidence move; the fix persists across re-runs.
 */
export async function mergeCompanies(
  db: DbOrTx,
  keepId: number,
  dropId: number,
  reason: string,
  opts: ManualCompanyOptions = {},
): Promise<ManualCompanyResult> {
  const why = cleanReason(reason);
  if (!validId(keepId) || !validId(dropId)) return fail('Pick the two companies to merge.');
  if (keepId === dropId) return fail('A company cannot be merged into itself.');
  if (!why) return fail('Give a reason for the merge.');

  return withTransaction(db, async (tx) => {
    const locked = await lockCompanies(tx, [keepId, dropId]);
    const keep = locked.get(keepId);
    const drop = locked.get(dropId);
    if (!keep || !drop) return fail(`Company #${keep ? dropId : keepId} does not exist.`);
    if (drop.mergedIntoId === keepId) {
      return { ok: true, noop: true, companyId: keepId, message: `Company #${dropId} is already merged into #${keepId}.` };
    }
    if (keep.mergedIntoId !== null) {
      return fail(`Company #${keepId} was itself merged into #${keep.mergedIntoId}; merge into that record instead.`);
    }
    if (drop.mergedIntoId !== null) return fail(`Company #${dropId} was already merged into #${drop.mergedIntoId}.`);

    // Records merged into the dropped one now point straight at the survivor (short chains).
    const flattened = (await tx.select({ id: companies.id }).from(companies).where(eq(companies.mergedIntoId, dropId))).map((r) => r.id);
    const absorbed = [dropId, ...flattened];

    // Jobs (normally all on dropId; stragglers on older merged records too).
    const jobRows = await tx.select({ id: jobs.id, companyId: jobs.companyId }).from(jobs).where(inArray(jobs.companyId, absorbed));
    const movedJobIds = await moveJobs(tx, jobRows, keepId);

    // Company-specific sources (boards).
    const sourceIds = (await tx.select({ id: sources.id }).from(sources).where(inArray(sources.companyId, absorbed))).map((r) => r.id);
    for (const part of chunkIds(sourceIds, 500)) await tx.update(sources).set({ companyId: keepId }).where(inArray(sources.id, part));

    // Evidence. A manual agency decision of the dropped record only moves when the survivor has none.
    const keepDecision = await manualAgencyDecision(tx, keepId);
    const dropDecision = await manualAgencyDecision(tx, dropId);
    const evidenceRows = await tx
      .select({ id: companyEvidence.id, kind: companyEvidence.kind, valueJson: companyEvidence.valueJson })
      .from(companyEvidence)
      .where(inArray(companyEvidence.companyId, absorbed));
    const evidenceIds = evidenceRows
      .filter((e) => !(keepDecision && e.kind === 'manual_note' && (e.valueJson as { field?: unknown } | null)?.field === 'is_agency'))
      .map((e) => e.id);
    for (const part of chunkIds(evidenceIds, 500)) {
      await tx.update(companyEvidence).set({ companyId: keepId }).where(inArray(companyEvidence.id, part));
    }

    // Empty fields of the survivor are filled from the dropped record.
    const filled: Partial<Record<Fillable, { before: unknown; after: unknown }>> = {};
    const patch: Partial<Record<Fillable, unknown>> = {};
    for (const f of FILLABLE) {
      if ((keep[f] === null || keep[f] === undefined) && drop[f] !== null && drop[f] !== undefined) {
        patch[f] = drop[f];
        filled[f] = { before: keep[f] ?? null, after: drop[f] };
      }
    }
    let agency: { before: { type: CompanyType; isAgency: boolean }; after: { type: CompanyType; isAgency: boolean } } | null = null;
    if (!keepDecision && dropDecision) {
      const after = { type: agencyType(keep.type, dropDecision.isAgency), isAgency: dropDecision.isAgency };
      if (after.type !== keep.type || after.isAgency !== keep.isAgency) agency = { before: { type: keep.type, isAgency: keep.isAgency }, after };
    } else if (!keepDecision && keep.type === 'unknown' && drop.type !== 'unknown') {
      agency = { before: { type: keep.type, isAgency: keep.isAgency }, after: { type: drop.type, isAgency: drop.isAgency } };
    }

    // Parent / subsidiary links.
    const parentChanges: ParentChange[] = [];
    const notes: string[] = [];
    const keepAncestors = await companyAncestors(tx, keepId);
    const dropParent = drop.parentCompanyId === null ? null : await canonicalCompanyId(tx, drop.parentCompanyId);
    const pathIdx = keepAncestors.indexOf(dropId);
    // The link on the survivor's own parent chain that points at the dropped record is spliced
    // past it (to the dropped record's parent), or the chain would loop back to the survivor.
    const onPath = pathIdx === -1 ? null : pathIdx === 0 ? keepId : keepAncestors[pathIdx - 1];
    const pathAbove = pathIdx === -1 ? [] : [keepId, ...keepAncestors.slice(0, pathIdx)];
    let keepParent = keep.parentCompanyId;
    if (onPath !== null) {
      const [row] = await tx.select({ parent: companies.parentCompanyId }).from(companies).where(eq(companies.id, onPath)).limit(1);
      const to = dropParent !== null && !pathAbove.includes(dropParent) && dropParent !== dropId ? dropParent : null;
      if (row && row.parent !== to) {
        await tx.update(companies).set({ parentCompanyId: to }).where(eq(companies.id, onPath));
        parentChanges.push({ id: onPath, from: row.parent, to });
        if (onPath === keepId) keepParent = to;
      }
    }
    const children = await tx
      .select({ id: companies.id, parent: companies.parentCompanyId })
      .from(companies)
      .where(and(eq(companies.parentCompanyId, dropId), ne(companies.id, keepId)));
    for (const c of children) {
      if (c.id === onPath) continue;
      await tx.update(companies).set({ parentCompanyId: keepId }).where(eq(companies.id, c.id));
      parentChanges.push({ id: c.id, from: c.parent, to: keepId });
    }
    if (keepParent === null && onPath === null && dropParent !== null && dropParent !== keepId) {
      const above = await companyAncestors(tx, dropParent);
      if (!above.includes(keepId)) {
        await tx.update(companies).set({ parentCompanyId: dropParent }).where(eq(companies.id, keepId));
        parentChanges.push({ id: keepId, from: null, to: dropParent });
      }
    } else if (keepParent !== null && dropParent !== null && onPath === null && (await canonicalCompanyId(tx, keepParent)) !== dropParent) {
      notes.push(`kept #${keepParent} as the parent (the merged record listed #${dropParent})`);
    }

    const keepPatch: Record<string, unknown> = { ...patch };
    if (agency) {
      keepPatch.type = agency.after.type;
      keepPatch.isAgency = agency.after.isAgency;
    }
    if (Object.keys(keepPatch).length) await tx.update(companies).set(keepPatch).where(eq(companies.id, keepId));
    if (flattened.length) await tx.update(companies).set({ mergedIntoId: keepId }).where(inArray(companies.id, flattened));
    await tx.update(companies).set({ mergedIntoId: keepId }).where(eq(companies.id, dropId));

    await audit(tx, {
      action: 'company.merge',
      entityType: 'company',
      entityId: dropId,
      before: { keep: summary(keep), drop: summary(drop) },
      after: {
        keepId,
        dropId,
        jobIds: chunkIds(movedJobIds),
        sourceIds: chunkIds(sourceIds),
        evidenceIds: chunkIds(evidenceIds),
        flattenedIds: chunkIds(flattened),
        parentChanges,
        filled,
        agency,
      },
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });

    const parts = [`Merged "${drop.name}" (#${dropId}) into "${keep.name}" (#${keepId})`];
    parts.push(`${movedJobIds.length} job${movedJobIds.length === 1 ? '' : 's'} moved`);
    if (sourceIds.length) parts.push(`${sourceIds.length} source${sourceIds.length === 1 ? '' : 's'} moved`);
    if (evidenceIds.length) parts.push(`${evidenceIds.length} evidence row${evidenceIds.length === 1 ? '' : 's'} moved`);
    return {
      ok: true,
      companyId: keepId,
      message: `${[parts.join(', '), ...notes].join('; ')}.`,
      movedJobIds,
      movedSourceIds: sourceIds,
    };
  });
}

// ---- split ---------------------------------------------------------------------------------

interface MergeRecord {
  at: Date;
  keepId: number;
  jobIds: number[];
  sourceIds: number[];
  evidenceIds: number[];
  flattenedIds: number[];
  parentChanges: ParentChange[];
  filled: Partial<Record<Fillable, { before: unknown; after: unknown }>>;
  agency: { before: { type: CompanyType; isAgency: boolean }; after: { type: CompanyType; isAgency: boolean } } | null;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function nullableId(v: unknown): number | null {
  return validId(v) ? v : null;
}

function parseAgencyState(v: unknown): { type: CompanyType; isAgency: boolean } | null {
  const r = asRecord(v);
  const type = (COMPANY_TYPES as readonly string[]).includes(String(r.type)) ? (r.type as CompanyType) : null;
  return type && typeof r.isAgency === 'boolean' ? { type, isAgency: r.isAgency } : null;
}

/** The latest merge of `companyId` into another record, as written by mergeCompanies. */
async function lastMergeRecord(db: DbOrTx, companyId: number): Promise<MergeRecord | null> {
  const [row] = await db
    .select({ afterJson: auditLog.afterJson, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.entityType, 'company'), eq(auditLog.entityId, String(companyId)), eq(auditLog.action, 'company.merge')))
    .orderBy(desc(auditLog.id))
    .limit(1);
  if (!row) return null;
  const a = asRecord(row.afterJson);
  const keepId = nullableId(a.keepId);
  if (keepId === null) return null;
  const parentChanges: ParentChange[] = [];
  if (Array.isArray(a.parentChanges)) {
    for (const p of a.parentChanges) {
      const r = asRecord(p);
      const id = nullableId(r.id);
      if (id !== null) parentChanges.push({ id, from: nullableId(r.from), to: nullableId(r.to) });
    }
  }
  const filled: MergeRecord['filled'] = {};
  const f = asRecord(a.filled);
  for (const k of FILLABLE) {
    const e = asRecord(f[k]);
    if ('after' in e) filled[k] = { before: e.before ?? null, after: e.after };
  }
  const ag = asRecord(a.agency);
  const before = parseAgencyState(ag.before);
  const after = parseAgencyState(ag.after);
  return {
    at: row.at,
    keepId,
    jobIds: flattenIds(a.jobIds),
    sourceIds: flattenIds(a.sourceIds),
    evidenceIds: flattenIds(a.evidenceIds),
    flattenedIds: flattenIds(a.flattenedIds),
    parentChanges,
    filled,
    agency: before && after ? { before, after } : null,
  };
}

/**
 * Splits the names `aliasIds` off company `companyId` (see the module comment). `opts.jobIds` /
 * `opts.sourceIds` pick jobs and boards that belong to the split-off company.
 */
export async function splitCompany(
  db: DbOrTx,
  companyId: number,
  aliasIds: number[],
  reason: string,
  opts: SplitCompanyOptions = {},
): Promise<ManualCompanyResult> {
  const why = cleanReason(reason);
  const ids = uniqueIds(aliasIds);
  if (!validId(companyId)) return fail('Pick the company to split.');
  if (!ids.length) return fail('Pick the names that belong to the other company.');
  if (!why) return fail('Give a reason for the split.');

  return withTransaction(db, async (tx) => {
    const locked = await lockCompanies(tx, [companyId]);
    const company = locked.get(companyId);
    if (!company) return fail(`Company #${companyId} does not exist.`);
    if (company.mergedIntoId !== null) return fail(`Company #${companyId} was merged into #${company.mergedIntoId}; split that record instead.`);

    const aliases = await tx.select().from(companyAliases).where(inArray(companyAliases.id, ids));
    if (aliases.length !== ids.length) return fail('Some of the selected names no longer exist; reload and try again.');
    const owners = [...new Set(aliases.map((a) => a.companyId))];
    if (owners.length !== 1) return fail('The selected names belong to different records; split them one record at a time.');
    const [owner] = owners;

    if (owner === companyId) return splitIntoNewCompany(tx, company, aliases, why, opts);

    const canonical = await canonicalCompanyId(tx, owner);
    if (canonical !== companyId) return fail(`The selected names belong to company #${owner}, not to #${companyId}.`);
    return restoreMergedCompany(tx, company, owner, why, opts);
  });
}

async function splitIntoNewCompany(
  tx: DbOrTx,
  company: FullCompany,
  aliases: (typeof companyAliases.$inferSelect)[],
  why: string,
  opts: SplitCompanyOptions,
): Promise<ManualCompanyResult> {
  const named = aliases.find((a) => a.kind !== 'ats_slug');
  const name = collapseWhitespace(String(opts.name ?? '')).slice(0, 255) || named?.alias || '';
  if (!name) return fail('Give the new company a name (only board slugs were selected).');
  const normalizedName = normalizeCompanyName(name);
  if (!normalizedName) return fail('The new company name is empty after normalising; pick another name.');

  const [res] = await tx.insert(companies).values({
    name,
    normalizedName,
    type: 'unknown',
    isAgency: false,
    notes: `Split from company #${company.id}: ${why}`.slice(0, 4000),
  });
  const newId = Number(res.insertId);
  await tx.update(companyAliases).set({ companyId: newId }).where(
    inArray(
      companyAliases.id,
      aliases.map((a) => a.id),
    ),
  );
  if (opts.name) {
    const kind = hasLegalSuffix(name) ? 'legal' : 'brand';
    for (const key of companyNameKeys(name)) {
      if (!key || aliases.some((a) => a.normalizedAlias === key && a.kind === kind)) continue;
      await tx
        .insert(companyAliases)
        .values({ companyId: newId, alias: name, normalizedAlias: key.slice(0, 191), kind })
        .onDuplicateKeyUpdate({ set: { alias: sql`${companyAliases.alias}` } });
    }
  }

  const sourceIds = uniqueIds(opts.sourceIds);
  const ownSources = sourceIds.length
    ? (await tx.select({ id: sources.id }).from(sources).where(and(inArray(sources.id, sourceIds), eq(sources.companyId, company.id)))).map((r) => r.id)
    : [];
  if (ownSources.length) await tx.update(sources).set({ companyId: newId }).where(inArray(sources.id, ownSources));

  const pickedJobs = uniqueIds(opts.jobIds);
  const jobRows = pickedJobs.length
    ? await tx.select({ id: jobs.id, companyId: jobs.companyId }).from(jobs).where(and(inArray(jobs.id, pickedJobs), eq(jobs.companyId, company.id)))
    : [];
  const fromSources = await jobsOnlyFromSources(tx, [company.id], ownSources);
  const byId = new Map([...jobRows, ...fromSources].map((j) => [j.id, j]));
  const movedJobIds = await moveJobs(tx, [...byId.values()], newId);

  await audit(tx, {
    action: 'company.split',
    entityType: 'company',
    entityId: company.id,
    before: { company: summary(company), aliases: aliases.map((a) => ({ id: a.id, alias: a.alias, kind: a.kind })) },
    after: {
      newCompanyId: newId,
      restored: false,
      name,
      aliasIds: chunkIds(aliases.map((a) => a.id)),
      jobIds: chunkIds(movedJobIds),
      sourceIds: chunkIds(ownSources),
    },
    reason: why,
    actor: opts.actor ?? 'admin',
    ip: opts.ip ?? null,
  });
  const skipped = pickedJobs.length - jobRows.length;
  const msg = [`Split ${aliases.length} name${aliases.length === 1 ? '' : 's'} off "${company.name}" into new company "${name}" (#${newId})`];
  msg.push(`${movedJobIds.length} job${movedJobIds.length === 1 ? '' : 's'} moved`);
  if (ownSources.length) msg.push(`${ownSources.length} source${ownSources.length === 1 ? '' : 's'} moved`);
  if (skipped > 0) msg.push(`${skipped} picked job${skipped === 1 ? ' was' : 's were'} not on this company and stayed`);
  return {
    ok: true,
    companyId: company.id,
    newCompanyId: newId,
    restored: false,
    message: `${msg.join(', ')}.`,
    movedJobIds,
    movedSourceIds: ownSources,
  };
}

async function restoreMergedCompany(
  tx: DbOrTx,
  survivor: FullCompany,
  revivedId: number,
  why: string,
  opts: SplitCompanyOptions,
): Promise<ManualCompanyResult> {
  const lockedRevived = await lockCompanies(tx, [revivedId]);
  const revived = lockedRevived.get(revivedId);
  if (!revived) return fail(`Company #${revivedId} does not exist.`);
  const rec = await lastMergeRecord(tx, revivedId);
  const holders = [...new Set([survivor.id, ...(rec ? [rec.keepId] : [])])];

  await tx.update(companies).set({ mergedIntoId: null }).where(eq(companies.id, revivedId));

  // Records that were merged into the revived one before its merge go back to it.
  let flattenedBack: number[] = [];
  if (rec?.flattenedIds.length) {
    flattenedBack = (
      await tx
        .select({ id: companies.id })
        .from(companies)
        .where(and(inArray(companies.id, rec.flattenedIds), inArray(companies.mergedIntoId, holders)))
    ).map((r) => r.id);
    if (flattenedBack.length) await tx.update(companies).set({ mergedIntoId: revivedId }).where(inArray(companies.id, flattenedBack));
  }

  // Sources the merge moved, and any I picked.
  const wantedSources = uniqueIds([...(rec?.sourceIds ?? []), ...uniqueIds(opts.sourceIds)]);
  const sourceIds = wantedSources.length
    ? (await tx.select({ id: sources.id }).from(sources).where(and(inArray(sources.id, wantedSources), inArray(sources.companyId, holders)))).map((r) => r.id)
    : [];
  if (sourceIds.length) await tx.update(sources).set({ companyId: revivedId }).where(inArray(sources.id, sourceIds));

  // Jobs the merge moved (still on the survivor), jobs only from its boards, and any I picked.
  const wantedJobs = uniqueIds([...(rec?.jobIds ?? []), ...uniqueIds(opts.jobIds)]);
  const jobRows: { id: number; companyId: number }[] = [];
  for (const part of chunkIds(wantedJobs, 500)) {
    jobRows.push(...(await tx.select({ id: jobs.id, companyId: jobs.companyId }).from(jobs).where(and(inArray(jobs.id, part), inArray(jobs.companyId, holders)))));
  }
  const fromSources = await jobsOnlyFromSources(tx, holders, sourceIds);
  const byId = new Map([...jobRows, ...fromSources].map((j) => [j.id, j]));
  const movedJobIds = await moveJobs(tx, [...byId.values()], revivedId);

  // Evidence the merge moved.
  let evidenceBack: number[] = [];
  if (rec?.evidenceIds.length) {
    evidenceBack = (
      await tx
        .select({ id: companyEvidence.id })
        .from(companyEvidence)
        .where(and(inArray(companyEvidence.id, rec.evidenceIds), inArray(companyEvidence.companyId, holders)))
    ).map((r) => r.id);
    for (const part of chunkIds(evidenceBack, 500)) {
      await tx.update(companyEvidence).set({ companyId: revivedId }).where(inArray(companyEvidence.id, part));
    }
  }

  // Names the survivor learned from the revived record's postings since the merge.
  const revivedAliases = await tx
    .select({ normalizedAlias: companyAliases.normalizedAlias, kind: companyAliases.kind })
    .from(companyAliases)
    .where(eq(companyAliases.companyId, revivedId));
  const revivedKeys = new Set([revived.normalizedName, ...revivedAliases.map((a) => a.normalizedAlias)]);
  revivedKeys.delete(survivor.normalizedName);
  const learnedBack: number[] = [];
  const learnedDropped: number[] = [];
  if (rec && revivedKeys.size) {
    const learned = await tx
      .select({ id: companyAliases.id, normalizedAlias: companyAliases.normalizedAlias, kind: companyAliases.kind })
      .from(companyAliases)
      .where(
        and(
          inArray(companyAliases.companyId, holders),
          inArray(companyAliases.normalizedAlias, [...revivedKeys]),
          gte(companyAliases.createdAt, rec.at),
        ),
      );
    for (const a of learned) {
      if (revivedAliases.some((r) => r.normalizedAlias === a.normalizedAlias && r.kind === a.kind)) learnedDropped.push(a.id);
      else {
        learnedBack.push(a.id);
        revivedAliases.push({ normalizedAlias: a.normalizedAlias, kind: a.kind });
      }
    }
    if (learnedBack.length) await tx.update(companyAliases).set({ companyId: revivedId }).where(inArray(companyAliases.id, learnedBack));
    if (learnedDropped.length) await tx.delete(companyAliases).where(inArray(companyAliases.id, learnedDropped));
  }

  // Parent links the merge changed, where nobody changed them since.
  const parentBack: ParentChange[] = [];
  for (const p of rec?.parentChanges ?? []) {
    const [row] = await tx.select({ parent: companies.parentCompanyId }).from(companies).where(eq(companies.id, p.id)).limit(1);
    if (!row || row.parent !== p.to) continue;
    let target = p.from;
    if (target !== null && target !== revivedId) {
      // A link that pointed at the revived record's own merged records now points at the revived record.
      const canon = await canonicalCompanyId(tx, target);
      if (canon === revivedId) target = revivedId;
    }
    if (target !== null && (target === p.id || (await companyAncestors(tx, target)).includes(p.id))) continue;
    await tx.update(companies).set({ parentCompanyId: target }).where(eq(companies.id, p.id));
    parentBack.push({ id: p.id, from: row.parent, to: target });
  }

  // Fields the merge filled on the survivor, where they still hold the filled value.
  const restoredFields: string[] = [];
  const [current] = (await tx.select(fullColumns).from(companies).where(eq(companies.id, rec?.keepId ?? survivor.id)).limit(1)) as FullCompany[];
  if (rec && current) {
    const patch: Record<string, unknown> = {};
    for (const f of FILLABLE) {
      const e = rec.filled[f];
      if (e && sameValue(current[f], e.after)) {
        patch[f] = e.before;
        restoredFields.push(f);
      }
    }
    if (rec.agency && current.type === rec.agency.after.type && current.isAgency === rec.agency.after.isAgency) {
      patch.type = rec.agency.before.type;
      patch.isAgency = rec.agency.before.isAgency;
      restoredFields.push('type');
    }
    if (Object.keys(patch).length) await tx.update(companies).set(patch).where(eq(companies.id, current.id));
  }

  await audit(tx, {
    action: 'company.split',
    entityType: 'company',
    entityId: survivor.id,
    before: { company: summary(survivor), revived: summary(revived) },
    after: {
      newCompanyId: revivedId,
      restored: true,
      mergeFound: !!rec,
      jobIds: chunkIds(movedJobIds),
      sourceIds: chunkIds(sourceIds),
      evidenceIds: chunkIds(evidenceBack),
      flattenedIds: chunkIds(flattenedBack),
      aliasIdsMoved: chunkIds(learnedBack),
      aliasIdsRemoved: chunkIds(learnedDropped),
      parentChanges: parentBack,
      restoredFields,
    },
    reason: why,
    actor: opts.actor ?? 'admin',
    ip: opts.ip ?? null,
  });

  const msg = [`Restored "${revived.name}" (#${revivedId}) as its own company`];
  msg.push(`${movedJobIds.length} job${movedJobIds.length === 1 ? '' : 's'} moved back`);
  if (sourceIds.length) msg.push(`${sourceIds.length} source${sourceIds.length === 1 ? '' : 's'} moved back`);
  if (!rec) msg.push('no merge record was found, so only the picked jobs moved');
  return {
    ok: true,
    companyId: survivor.id,
    newCompanyId: revivedId,
    restored: true,
    message: `${msg.join(', ')}.`,
    movedJobIds,
    movedSourceIds: sourceIds,
  };
}

// ---- agency / parent -----------------------------------------------------------------------

/**
 * My decision that a company is (or is not) a recruiter / agency. Stored as manual evidence, so the
 * resolver never flips it back from posting wording.
 */
export async function setCompanyAgency(
  db: DbOrTx,
  companyId: number,
  isAgency: boolean,
  reason: string,
  opts: ManualCompanyOptions = {},
): Promise<ManualCompanyResult> {
  const why = cleanReason(reason);
  if (!validId(companyId)) return fail('Pick a company.');
  if (typeof isAgency !== 'boolean') return fail('Say whether the company is an agency.');
  if (!why) return fail('Give a reason.');
  return withTransaction(db, async (tx) => {
    const company = (await lockCompanies(tx, [companyId])).get(companyId);
    if (!company) return fail(`Company #${companyId} does not exist.`);
    if (company.mergedIntoId !== null) return fail(`Company #${companyId} was merged into #${company.mergedIntoId}; change that record instead.`);
    const previous = await manualAgencyDecision(tx, companyId);
    const type = agencyType(company.type, isAgency);
    if (previous?.isAgency === isAgency && company.isAgency === isAgency && company.type === type) {
      return { ok: true, noop: true, companyId, message: `"${company.name}" is already marked ${isAgency ? 'as an agency' : 'as not an agency'}.` };
    }
    await tx.insert(companyEvidence).values({
      companyId,
      kind: 'manual_note',
      valueJson: { field: 'is_agency', isAgency },
      evidence: why,
      source: MANUAL_COMPANY_SOURCE,
      method: 'manual',
      confidence: 'high',
      matchStatus: 'confirmed',
      logicVersion: MANUAL_LOGIC_VERSION,
    });
    await tx.update(companies).set({ isAgency, type }).where(eq(companies.id, companyId));
    await audit(tx, {
      action: 'company.set_agency',
      entityType: 'company',
      entityId: companyId,
      before: { isAgency: company.isAgency, type: company.type },
      after: { isAgency, type },
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });
    return { ok: true, companyId, message: `"${company.name}" is now marked ${isAgency ? 'as an agency' : 'as not an agency'}.` };
  });
}

/** Sets (or clears, with null) the parent company. Refuses links that would make a loop. */
export async function setParentCompany(
  db: DbOrTx,
  childId: number,
  parentId: number | null,
  reason: string,
  opts: ManualCompanyOptions = {},
): Promise<ManualCompanyResult> {
  const why = cleanReason(reason);
  if (!validId(childId)) return fail('Pick a company.');
  if (parentId !== null && !validId(parentId)) return fail('Pick the parent company.');
  if (!why) return fail('Give a reason.');
  return withTransaction(db, async (tx) => {
    const locked = await lockCompanies(tx, parentId === null ? [childId] : [childId, parentId]);
    const child = locked.get(childId);
    if (!child) return fail(`Company #${childId} does not exist.`);
    if (child.mergedIntoId !== null) return fail(`Company #${childId} was merged into #${child.mergedIntoId}; change that record instead.`);
    if (parentId !== null) {
      const parent = locked.get(parentId);
      if (!parent) return fail(`Company #${parentId} does not exist.`);
      if (parent.mergedIntoId !== null) return fail(`Company #${parentId} was merged into #${parent.mergedIntoId}; pick that record instead.`);
      if (parentId === childId) return fail('A company cannot be its own parent.');
      if ((await companyAncestors(tx, parentId)).includes(childId)) {
        return fail(`#${parentId} is already a subsidiary of #${childId}; that link would make a loop.`);
      }
    }
    if (child.parentCompanyId === parentId) return { ok: true, noop: true, companyId: childId, message: 'The parent is already set that way.' };
    await tx.update(companies).set({ parentCompanyId: parentId }).where(eq(companies.id, childId));
    await audit(tx, {
      action: 'company.set_parent',
      entityType: 'company',
      entityId: childId,
      before: { parentCompanyId: child.parentCompanyId },
      after: { parentCompanyId: parentId },
      reason: why,
      actor: opts.actor ?? 'admin',
      ip: opts.ip ?? null,
    });
    return {
      ok: true,
      companyId: childId,
      message: parentId === null ? `"${child.name}" no longer has a parent company.` : `"${child.name}" is now a subsidiary of #${parentId}.`,
    };
  });
}
