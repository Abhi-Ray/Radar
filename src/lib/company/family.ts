/**
 * Company graph helpers: merges (merged_into_id → the surviving record) and parent / subsidiary
 * links (parent_company_id). Spec §11.2: a sponsor register may list the legal entity or the
 * parent rather than the brand, so visa checks look at the whole family.
 *
 * Every walk is cycle-safe and bounded; bad data (a cycle, a dangling id) ends the walk instead of
 * looping.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { companies, companyAliases } from '../../db/schema';
import type { DbOrTx } from '../db';

export const MAX_COMPANY_DEPTH = 10;
const MAX_FAMILY_SIZE = 500;

/** Follows merged_into_id to the surviving company (itself when not merged); null on a cycle / missing id. */
export async function canonicalCompanyId(db: DbOrTx, companyId: number): Promise<number | null> {
  let current = companyId;
  const seen = new Set<number>();
  for (let i = 0; i <= MAX_COMPANY_DEPTH; i++) {
    if (seen.has(current)) return null;
    seen.add(current);
    const [row] = await db.select({ next: companies.mergedIntoId }).from(companies).where(eq(companies.id, current)).limit(1);
    if (!row) return null;
    if (row.next === null) return current;
    current = row.next;
  }
  return null;
}

/** Ids of every record merged (directly or through a chain) into `companyId`, not including it. */
export async function mergedCompanyIds(db: DbOrTx, companyId: number): Promise<number[]> {
  const out: number[] = [];
  const seen = new Set<number>([companyId]);
  let frontier = [companyId];
  for (let depth = 0; depth < MAX_COMPANY_DEPTH && frontier.length && out.length < MAX_FAMILY_SIZE; depth++) {
    const rows = await db.select({ id: companies.id }).from(companies).where(inArray(companies.mergedIntoId, frontier));
    frontier = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r.id);
      frontier.push(r.id);
    }
  }
  return out;
}

/** Parent chain of a company, nearest first (canonical ids, no cycles). */
export async function companyAncestors(db: DbOrTx, companyId: number): Promise<number[]> {
  const start = (await canonicalCompanyId(db, companyId)) ?? companyId;
  const out: number[] = [];
  const seen = new Set<number>([start]);
  let current = start;
  for (let i = 0; i < MAX_COMPANY_DEPTH; i++) {
    const [row] = await db.select({ parent: companies.parentCompanyId }).from(companies).where(eq(companies.id, current)).limit(1);
    if (!row || row.parent === null) break;
    const parent = (await canonicalCompanyId(db, row.parent)) ?? row.parent;
    if (seen.has(parent)) break;
    seen.add(parent);
    out.push(parent);
    current = parent;
  }
  return out;
}

/** Direct and indirect subsidiaries of a company (canonical, not merged records). */
export async function companyDescendants(db: DbOrTx, companyId: number): Promise<number[]> {
  const start = (await canonicalCompanyId(db, companyId)) ?? companyId;
  const out: number[] = [];
  const seen = new Set<number>([start]);
  let frontier = [start];
  for (let depth = 0; depth < MAX_COMPANY_DEPTH && frontier.length && out.length < MAX_FAMILY_SIZE; depth++) {
    const rows = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(inArray(companies.parentCompanyId, frontier), isNull(companies.mergedIntoId)));
    frontier = [];
    for (const r of rows) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r.id);
      frontier.push(r.id);
    }
  }
  return out;
}

export interface CompanyFamily {
  /** The surviving record of the company asked about. */
  companyId: number;
  /** Top of the parent chain (the company itself when it has no parent). */
  rootId: number;
  ancestors: number[];
  /** Everything under the root, including the company and its siblings. */
  members: number[];
  /** Records merged into any member (their aliases still name the family). */
  mergedIds: number[];
}

/** The company's corporate family: root, ancestors, every member under the root, merged records. */
export async function companyFamily(db: DbOrTx, companyId: number): Promise<CompanyFamily | null> {
  const canonical = await canonicalCompanyId(db, companyId);
  if (canonical === null) return null;
  const ancestors = await companyAncestors(db, canonical);
  const rootId = ancestors.length ? ancestors[ancestors.length - 1] : canonical;
  const members = [rootId, ...(await companyDescendants(db, rootId))];
  if (!members.includes(canonical)) members.push(canonical);
  const mergedIds: number[] = [];
  for (const m of members) {
    if (mergedIds.length >= MAX_FAMILY_SIZE) break;
    for (const id of await mergedCompanyIds(db, m)) if (!mergedIds.includes(id)) mergedIds.push(id);
  }
  return { companyId: canonical, rootId, ancestors, members, mergedIds };
}

/** All ids that stand for the family (members + merged records), for evidence / register lookups. */
export async function companyFamilyIds(db: DbOrTx, companyId: number): Promise<number[]> {
  const f = await companyFamily(db, companyId);
  if (!f) return [companyId];
  return [...new Set([...f.members, ...f.mergedIds])];
}

export interface CompanyName {
  companyId: number;
  name: string;
  normalized: string;
  kind: 'name' | 'brand' | 'legal' | 'ats_slug' | 'other';
  countryIso2: string | null;
}

/**
 * Every name the company is known by: its own name and aliases plus those of records merged
 * into it (the sponsor register may list any of them). ATS slugs are left out unless asked for.
 */
export async function companyNames(db: DbOrTx, companyId: number, opts: { includeSlugs?: boolean } = {}): Promise<CompanyName[]> {
  const canonical = (await canonicalCompanyId(db, companyId)) ?? companyId;
  const ids = [canonical, ...(await mergedCompanyIds(db, canonical))];
  const rows = await db
    .select({ id: companies.id, name: companies.name, normalized: companies.normalizedName, hq: companies.hqCountry })
    .from(companies)
    .where(inArray(companies.id, ids));
  const aliases = await db
    .select({
      companyId: companyAliases.companyId,
      alias: companyAliases.alias,
      normalized: companyAliases.normalizedAlias,
      kind: companyAliases.kind,
      country: companyAliases.countryIso2,
    })
    .from(companyAliases)
    .where(inArray(companyAliases.companyId, ids));
  const out: CompanyName[] = [];
  const seen = new Set<string>();
  const push = (n: CompanyName) => {
    const key = `${n.kind}|${n.normalized}|${n.countryIso2 ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(n);
  };
  for (const r of rows.sort((a, b) => Number(b.id === canonical) - Number(a.id === canonical) || a.id - b.id)) {
    push({ companyId: r.id, name: r.name, normalized: r.normalized, kind: 'name', countryIso2: r.hq });
  }
  for (const a of aliases.sort((x, y) => x.companyId - y.companyId)) {
    if (a.kind === 'ats_slug' && !opts.includeSlugs) continue;
    push({ companyId: a.companyId, name: a.alias, normalized: a.normalized, kind: a.kind, countryIso2: a.country });
  }
  return out;
}

/**
 * Pure: would making `parentId` the parent of `childId` create a loop? `parentOf` maps a company
 * to its current parent (null / missing = none).
 */
export function wouldCreateParentCycle(parentOf: ReadonlyMap<number, number | null>, childId: number, parentId: number): boolean {
  if (childId === parentId) return true;
  let current: number | null | undefined = parentId;
  const seen = new Set<number>();
  for (let i = 0; i <= MAX_COMPANY_DEPTH * 10 && current != null; i++) {
    if (current === childId) return true;
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf.get(current) ?? null;
  }
  return false;
}
