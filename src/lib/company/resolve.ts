/**
 * Company identity (spec §11.2): one record per employer with its brand and legal names as
 * aliases, merges followed to the surviving record, agencies marked as Agency.
 *
 * `resolveCompany` finds or creates the company of a posting, strongest evidence first:
 *   1. the ATS board slug the posting came from (platform-qualified slugs are unique per board);
 *   2. the normalised name / an alias ("ACME GmbH", "Acme Ltd" and "Acme" meet on "acme"), with
 *      the full legal name, country and domain breaking ties between same-named companies and a
 *      conflicting domain ruling a candidate out;
 *   3. the company domain, when the names are compatible;
 *   4. the brand without a market qualifier ("Acme Deutschland GmbH" → "Acme"), weaker;
 *   5. otherwise a new company, with the raw name (and slug) stored as aliases.
 *
 * Agencies: a known agency or an agency word in the name marks the company; recruiter wording in a
 * posting ("on behalf of our client") marks the POSTING at once, but the company only after it has
 * been seen in several distinct postings — a board may show the client's name above an agency's
 * text, and a real employer must not become an "agency" from one such posting. A manual decision
 * (setCompanyAgency) always wins and is never overridden here.
 *
 * Assumes one pipeline writer at a time (the pipeline run lock); a rare duplicate from concurrent
 * writers is fixed with mergeCompanies.
 */
import { and, asc, eq, inArray, isNull, like, ne, sql } from 'drizzle-orm';
import { companies, companyAliases, companyEvidence } from '../../db/schema';
import { audit } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { collapseWhitespace } from '../normalize/text';
import { tokenSetRatio } from '../dedup/similarity';
import { detectAgency, type AgencyDetection } from './agency';
import { domainMatchesName, domainsCompatible, normalizeDomain } from './domain';
import { canonicalCompanyId } from './family';
import {
  brandKey,
  compactKey,
  companyFullKey,
  companyNameKeys,
  hasLegalSuffix,
  isPlaceholderCompanyName,
  normalizeAtsSlug,
} from './normalize';

export { normalizeCompanyName } from './normalize';

export const COMPANY_LOGIC_VERSION = 'company@2026-09-30.1';

/** Distinct postings with recruiter wording needed before an unknown-type company becomes an agency. */
export const AGENCY_TEXT_POSTINGS_TO_FLAG = 3;
/** Aliases / slugs are learned only from matches at least this sure. */
const LEARN_MIN_CONFIDENCE = 0.85;
const FILL_DOMAIN_MIN_CONFIDENCE = 0.9;
const MAX_CANDIDATES = 50;
const SIMILAR_NAME_MIN = 0.8;

export interface ResolveCompanyInput {
  name: string;
  domain?: string | null;
  countryIso2?: string | null;
  atsSlug?: string | null;
  /** Platform of `atsSlug` ("greenhouse"); qualifies the slug so boards cannot collide. */
  atsPlatform?: string | null;
  /** Posting text, for recruiter wording ("on behalf of our client"). */
  descriptionText?: string | null;
  /** Where the posting came from (apply URL or source:external id), stored with agency evidence. */
  evidenceSource?: string | null;
}

export type CompanyMatchKind = 'ats_slug' | 'name' | 'domain' | 'brand' | 'placeholder' | 'created';

export interface ResolveCompanyResult {
  companyId: number;
  /** This posting comes from an agency: the company is one, or the posting says so. */
  isAgency: boolean;
  /** The company record itself is marked Agency. */
  companyIsAgency: boolean;
  confidence: number;
  created: boolean;
  matchedBy: CompanyMatchKind;
  reasons: string[];
  /** Agency evidence found in this name / posting (strength 'none' when there is none). */
  agency: AgencyDetection;
  /** Other records that may be the same company, for review (never merged automatically). */
  possibleCompanyIds: number[];
  /** The name ("Confidential", "Our client") does not identify one employer. */
  placeholder: boolean;
}

interface CompanyRow {
  id: number;
  name: string;
  normalizedName: string;
  domain: string | null;
  hqCountry: string | null;
  type: string;
  isAgency: boolean;
  mergedIntoId: number | null;
}

const companyColumns = {
  id: companies.id,
  name: companies.name,
  normalizedName: companies.normalizedName,
  domain: companies.domain,
  hqCountry: companies.hqCountry,
  type: companies.type,
  isAgency: companies.isAgency,
  mergedIntoId: companies.mergedIntoId,
};

interface Prepared {
  name: string;
  keys: string[];
  fullKey: string;
  domain: string | null;
  country: string | null;
  slugKey: string | null;
  slugQualified: boolean;
  placeholder: boolean;
  agency: AgencyDetection;
  evidenceSource: string | null;
}

function prepare(input: ResolveCompanyInput): Prepared {
  const name = collapseWhitespace(String(input.name ?? '')).slice(0, 255) || 'Unknown company';
  const keys = companyNameKeys(name).filter(Boolean);
  if (!keys.length) keys.push('unknown company');
  const country = input.countryIso2 && /^[A-Za-z]{2}$/.test(input.countryIso2.trim()) ? input.countryIso2.trim().toUpperCase() : null;
  const slugKey = input.atsSlug ? normalizeAtsSlug(input.atsSlug, input.atsPlatform) : null;
  return {
    name,
    keys,
    fullKey: companyFullKey(name),
    domain: normalizeDomain(input.domain ?? null),
    country,
    slugKey,
    slugQualified: !!(slugKey && slugKey.includes(':')),
    placeholder: isPlaceholderCompanyName(name),
    agency: detectAgency({ name, descriptionText: input.descriptionText ?? null }),
    evidenceSource: input.evidenceSource ? String(input.evidenceSource).slice(0, 512) : null,
  };
}

/** Surviving record id of each of `ids` (following merges); ids on a broken chain are left out. */
async function canonicalMap(db: DbOrTx, ids: readonly number[]): Promise<Map<number, number>> {
  const out = new Map<number, number>();
  const unique = [...new Set(ids)].slice(0, MAX_CANDIDATES * 2);
  if (!unique.length) return out;
  const rows = await db.select({ id: companies.id, mergedIntoId: companies.mergedIntoId }).from(companies).where(inArray(companies.id, unique));
  for (const r of rows) {
    if (r.mergedIntoId === null) out.set(r.id, r.id);
    else {
      const c = await canonicalCompanyId(db, r.id);
      if (c !== null) out.set(r.id, c);
    }
  }
  return out;
}

/** The surviving records of `ids`, in id order, without duplicates. */
async function canonicalRows(db: DbOrTx, ids: readonly number[], map?: Map<number, number>): Promise<CompanyRow[]> {
  const m = map ?? (await canonicalMap(db, ids));
  const targets = [...new Set(m.values())];
  if (!targets.length) return [];
  const rows: CompanyRow[] = await db.select(companyColumns).from(companies).where(inArray(companies.id, targets));
  return rows.filter((r) => r.mergedIntoId === null).sort((a, b) => a.id - b.id);
}

/** Names the input and a company record could share (same brand, or one contained in the other). */
function namesCompatible(company: CompanyRow, p: Prepared): boolean {
  const a = company.normalizedName;
  if (p.keys.includes(a)) return true;
  if (tokenSetRatio(a, p.keys[0]) >= 0.5) return true;
  const ca = compactKey(a);
  const cb = compactKey(p.keys[0]);
  const shorter = ca.length < cb.length ? ca : cb;
  const longer = ca.length < cb.length ? cb : ca;
  if (shorter.length >= 4 && longer.startsWith(shorter)) return true;
  const ba = brandKey(company.name) ?? a;
  const bb = brandKey(p.name) ?? p.keys[0];
  return ba === bb;
}

interface Match {
  company: CompanyRow;
  confidence: number;
  matchedBy: CompanyMatchKind;
  reasons: string[];
  possible: number[];
}

async function matchBySlug(db: DbOrTx, p: Prepared): Promise<Match | null> {
  if (!p.slugKey) return null;
  const rows = await db
    .select({ companyId: companyAliases.companyId })
    .from(companyAliases)
    .where(and(eq(companyAliases.normalizedAlias, p.slugKey), eq(companyAliases.kind, 'ats_slug')))
    .limit(MAX_CANDIDATES);
  const found = await canonicalRows(
    db,
    rows.map((r) => r.companyId),
  );
  if (!found.length) return null;
  const compatible = found.filter((c) => namesCompatible(c, p));
  if (p.slugQualified) {
    const pick = compatible[0] ?? found[0];
    const nameOk = compatible.length > 0;
    return {
      company: pick,
      confidence: nameOk ? 0.97 : 0.85,
      matchedBy: 'ats_slug',
      reasons: nameOk ? ['same job board (ATS slug)'] : ['same job board (ATS slug)', 'the board now shows a different name'],
      possible: found.filter((c) => c.id !== pick.id).map((c) => c.id),
    };
  }
  if (compatible.length === 1) {
    return { company: compatible[0], confidence: 0.93, matchedBy: 'ats_slug', reasons: ['same board slug and a compatible name'], possible: [] };
  }
  return null;
}

async function aliasesOf(db: DbOrTx, companyIds: number[]) {
  if (!companyIds.length) return [];
  return db
    .select({
      companyId: companyAliases.companyId,
      alias: companyAliases.alias,
      normalizedAlias: companyAliases.normalizedAlias,
      kind: companyAliases.kind,
      countryIso2: companyAliases.countryIso2,
    })
    .from(companyAliases)
    .where(inArray(companyAliases.companyId, companyIds));
}

async function matchByName(db: DbOrTx, p: Prepared, keys: readonly string[], kind: 'name' | 'brand'): Promise<Match | null> {
  const direct = await db
    .select({ id: companies.id })
    .from(companies)
    .where(inArray(companies.normalizedName, [...keys]))
    .limit(MAX_CANDIDATES);
  const viaAlias = await db
    .select({ id: companyAliases.companyId })
    .from(companyAliases)
    .where(and(inArray(companyAliases.normalizedAlias, [...keys]), ne(companyAliases.kind, 'ats_slug')))
    .limit(MAX_CANDIDATES);
  const matchedIds = [...new Set([...direct.map((r) => r.id), ...viaAlias.map((r) => r.id)])];
  const canonicalOf = await canonicalMap(db, matchedIds);
  const found = await canonicalRows(db, matchedIds, canonicalOf);
  if (!found.length) return null;

  // Aliases of the candidates and of the (merged) records that matched, for full-name / country checks.
  const aliasRows = await aliasesOf(db, [...new Set([...found.map((c) => c.id), ...matchedIds])]);

  const scored: { c: CompanyRow; score: number; reasons: string[]; sameDomain: boolean }[] = [];
  const conflicts: number[] = [];
  for (const c of found) {
    const reasons: string[] = [kind === 'name' ? 'same company name' : 'same brand without the country part'];
    let score = 0;
    let sameDomain = false;
    if (p.domain && c.domain) {
      if (p.domain === c.domain) {
        score += 3;
        sameDomain = true;
        reasons.push('same website');
      } else if (domainsCompatible(p.domain, c.domain)) {
        score += 1;
        reasons.push('same website name in another country');
      } else {
        conflicts.push(c.id);
        continue;
      }
    }
    const own = aliasRows.filter((a) => a.companyId === c.id || canonicalOf.get(a.companyId) === c.id);
    if (companyFullKey(c.name) === p.fullKey || own.some((a) => a.kind !== 'ats_slug' && companyFullKey(a.alias) === p.fullKey)) {
      score += 2;
      reasons.push('same full legal name');
    }
    if (p.country && (c.hqCountry === p.country || own.some((a) => a.countryIso2 === p.country))) {
      score += 1;
      reasons.push('same country');
    }
    scored.push({ c, score, reasons, sameDomain });
  }
  if (!scored.length) return null;
  scored.sort((a, b) => b.score - a.score || a.c.id - b.c.id);
  const [best, second] = scored;
  const tie = !!second && second.score === best.score;
  const others = [...scored.slice(1).map((s) => s.c.id), ...conflicts];
  let confidence: number;
  if (kind === 'brand') confidence = best.sameDomain ? 0.85 : 0.75;
  else if (tie) confidence = 0.7;
  else if (best.sameDomain) confidence = 0.97;
  else confidence = scored.length > 1 ? 0.85 : 0.9;
  const reasons = tie ? [...best.reasons, 'several companies share this name'] : best.reasons;
  return { company: best.c, confidence, matchedBy: kind, reasons, possible: others };
}

async function matchByDomain(db: DbOrTx, p: Prepared): Promise<{ match: Match | null; possible: number[] }> {
  if (!p.domain) return { match: null, possible: [] };
  const rows = await db.select({ id: companies.id }).from(companies).where(eq(companies.domain, p.domain)).limit(MAX_CANDIDATES);
  const found = await canonicalRows(
    db,
    rows.map((r) => r.id),
  );
  if (!found.length) return { match: null, possible: [] };
  const domain = p.domain;
  const compatible = found.filter((c) => namesCompatible(c, p) || (domainMatchesName(domain, c.normalizedName) && domainMatchesName(domain, p.keys[0])));
  if (!compatible.length) return { match: null, possible: found.map((c) => c.id) };
  const [pick] = compatible;
  return {
    match: {
      company: pick,
      confidence: 0.85,
      matchedBy: 'domain',
      reasons: ['same website', 'similar company name'],
      possible: found.filter((c) => c.id !== pick.id).map((c) => c.id),
    },
    possible: [],
  };
}

/** Existing records with a close but different name ("Acme Systems" vs "Acme System"), for review. */
async function similarNames(db: DbOrTx, key: string, excludeId?: number): Promise<number[]> {
  const first = key.split(' ')[0];
  if (!first || first.length < 3) return [];
  const escaped = first.replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db
    .select({ id: companies.id, normalizedName: companies.normalizedName })
    .from(companies)
    .where(and(like(companies.normalizedName, `${escaped}%`), isNull(companies.mergedIntoId)))
    .orderBy(asc(companies.id))
    .limit(MAX_CANDIDATES);
  return rows
    .filter((r) => r.id !== excludeId && r.normalizedName !== key && tokenSetRatio(r.normalizedName, key) >= SIMILAR_NAME_MIN)
    .map((r) => r.id)
    .slice(0, 5);
}

/** True when I decided this company's agency status by hand (never overridden automatically). */
export async function hasManualAgencyDecision(db: DbOrTx, companyId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: companyEvidence.id })
    .from(companyEvidence)
    .where(
      and(
        eq(companyEvidence.companyId, companyId),
        eq(companyEvidence.kind, 'manual_note'),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${companyEvidence.valueJson}, '$.field')) = 'is_agency'`,
      ),
    )
    .limit(1);
  return !!row;
}

/** Agency-wording evidence rows for a company (one per distinct posting). */
async function agencyTextPostings(db: DbOrTx, companyId: number): Promise<{ id: number; source: string }[]> {
  return db
    .select({ id: companyEvidence.id, source: companyEvidence.source })
    .from(companyEvidence)
    .where(
      and(
        eq(companyEvidence.companyId, companyId),
        eq(companyEvidence.kind, 'posting_history'),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${companyEvidence.valueJson}, '$.field')) = 'is_agency'`,
      ),
    )
    .limit(100);
}

async function recordAgencyEvidence(db: DbOrTx, companyId: number, d: AgencyDetection, source: string, status: 'confirmed' | 'possible') {
  await db.insert(companyEvidence).values({
    companyId,
    kind: 'posting_history',
    valueJson: { field: 'is_agency', isAgency: true, ruleId: d.ruleId, detectedBy: d.kind },
    evidence: d.evidence,
    source,
    method: 'rule',
    confidence: d.kind === 'description' ? 'medium' : 'high',
    matchStatus: status,
    logicVersion: COMPANY_LOGIC_VERSION,
  });
}

async function markAgency(db: DbOrTx, company: CompanyRow, reason: string): Promise<void> {
  await db.update(companies).set({ isAgency: true, type: 'agency' }).where(eq(companies.id, company.id));
  await audit(db, {
    action: 'company.agency_detected',
    entityType: 'company',
    entityId: company.id,
    before: { isAgency: company.isAgency, type: company.type },
    after: { isAgency: true, type: 'agency' },
    reason,
    actor: 'system',
  });
  company.isAgency = true;
  company.type = 'agency';
}

/** Agency handling for a matched company; returns whether the record is (now) an agency. */
async function applyAgency(db: DbOrTx, company: CompanyRow, p: Prepared): Promise<boolean> {
  const d = p.agency;
  if (company.isAgency || d.strength !== 'strong') return company.isAgency;
  if (company.type !== 'unknown') return false;
  if (await hasManualAgencyDecision(db, company.id)) return false;
  if (d.kind === 'known_agency' || d.kind === 'name_keyword') {
    await recordAgencyEvidence(db, company.id, d, 'company name', 'confirmed');
    await markAgency(db, company, `${d.evidence ?? 'agency name'} (${d.ruleId})`);
    return true;
  }
  // Recruiter wording: counted per distinct posting, acted on only when it keeps coming back.
  if (!p.evidenceSource) return false;
  const seen = await agencyTextPostings(db, company.id);
  if (!seen.some((r) => r.source === p.evidenceSource)) {
    await recordAgencyEvidence(db, company.id, d, p.evidenceSource, 'possible');
    seen.push({ id: 0, source: p.evidenceSource });
  }
  const distinct = new Set(seen.map((r) => r.source)).size;
  if (distinct >= AGENCY_TEXT_POSTINGS_TO_FLAG) {
    await markAgency(db, company, `Recruiter wording in ${distinct} postings, e.g. "${d.evidence ?? ''}" (${d.ruleId})`);
    return true;
  }
  return false;
}

async function addAlias(db: DbOrTx, companyId: number, alias: string, normalizedAlias: string, kind: 'brand' | 'legal' | 'ats_slug' | 'other', country: string | null) {
  if (!normalizedAlias) return;
  await db
    .insert(companyAliases)
    .values({ companyId, alias: alias.slice(0, 255), normalizedAlias: normalizedAlias.slice(0, 191), kind, countryIso2: country })
    .onDuplicateKeyUpdate({ set: { alias: sql`${companyAliases.alias}` } });
}

/** Stores the raw name (as a legal or brand alias, with its umlaut variant) and the board slug when missing. */
async function learnAliases(db: DbOrTx, company: CompanyRow, p: Prepared): Promise<void> {
  const existing = await db
    .select({ normalizedAlias: companyAliases.normalizedAlias, kind: companyAliases.kind })
    .from(companyAliases)
    .where(eq(companyAliases.companyId, company.id));
  const nameKind = hasLegalSuffix(p.name) ? 'legal' : 'brand';
  for (const key of p.keys) {
    if (existing.some((a) => a.normalizedAlias === key && a.kind === nameKind)) continue;
    await addAlias(db, company.id, p.name, key, nameKind, p.country);
  }
  if (p.slugKey && !existing.some((a) => a.normalizedAlias === p.slugKey && a.kind === 'ats_slug')) {
    await addAlias(db, company.id, p.slugKey, p.slugKey, 'ats_slug', null);
  }
}

async function createCompany(db: DbOrTx, p: Prepared, possible: number[]): Promise<ResolveCompanyResult> {
  const nameAgency = p.agency.strength === 'strong' && p.agency.kind !== 'description';
  const [res] = await db.insert(companies).values({
    name: p.name,
    normalizedName: p.keys[0],
    domain: p.domain,
    type: nameAgency ? 'agency' : 'unknown',
    isAgency: nameAgency,
    notes: p.placeholder ? 'Placeholder name: postings under it are not one employer.' : null,
  });
  const companyId = Number(res.insertId);
  const nameKind = hasLegalSuffix(p.name) ? 'legal' : 'brand';
  for (const key of p.keys) await addAlias(db, companyId, p.name, key, nameKind, p.country);
  if (p.slugKey) await addAlias(db, companyId, p.slugKey, p.slugKey, 'ats_slug', null);
  if (nameAgency) await recordAgencyEvidence(db, companyId, p.agency, 'company name', 'confirmed');
  else if (p.agency.strength === 'strong' && p.evidenceSource) await recordAgencyEvidence(db, companyId, p.agency, p.evidenceSource, 'possible');

  const similar = p.placeholder ? [] : await similarNames(db, p.keys[0], companyId);
  const others = [...new Set([...possible, ...similar])].filter((id) => id !== companyId).slice(0, 5);
  const reasons = ['new company'];
  if (others.length) reasons.push('a company with a similar name exists');
  return {
    companyId,
    isAgency: nameAgency || p.agency.strength === 'strong',
    companyIsAgency: nameAgency,
    confidence: p.placeholder ? 0.3 : others.length ? 0.6 : 0.9,
    created: true,
    matchedBy: p.placeholder ? 'placeholder' : 'created',
    reasons: p.placeholder ? ['placeholder company name'] : reasons,
    agency: p.agency,
    possibleCompanyIds: others,
    placeholder: p.placeholder,
  };
}

async function finishMatch(db: DbOrTx, p: Prepared, m: Match): Promise<ResolveCompanyResult> {
  const company = m.company;
  if (m.confidence >= LEARN_MIN_CONFIDENCE) await learnAliases(db, company, p);
  if (!company.domain && p.domain && m.confidence >= FILL_DOMAIN_MIN_CONFIDENCE) {
    const [taken] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.domain, p.domain), isNull(companies.mergedIntoId), ne(companies.id, company.id)))
      .limit(1);
    if (!taken) await db.update(companies).set({ domain: p.domain }).where(eq(companies.id, company.id));
  }
  const companyIsAgency = await applyAgency(db, company, p);
  return {
    companyId: company.id,
    isAgency: companyIsAgency || p.agency.strength === 'strong',
    companyIsAgency,
    confidence: m.confidence,
    created: false,
    matchedBy: m.matchedBy,
    reasons: m.reasons,
    agency: p.agency,
    possibleCompanyIds: [...new Set(m.possible)].filter((id) => id !== company.id).slice(0, 5),
    placeholder: p.placeholder,
  };
}

/** Finds or creates the company of a posting (see the module comment for the order of evidence). */
export async function resolveCompany(db: DbOrTx, input: ResolveCompanyInput): Promise<ResolveCompanyResult> {
  const p = prepare(input);
  return withTransaction(db, async (tx) => {
    const bySlug = await matchBySlug(tx, p);
    if (bySlug) return finishMatch(tx, p, bySlug);

    if (p.placeholder) {
      const [row] = await tx
        .select(companyColumns)
        .from(companies)
        .where(and(eq(companies.normalizedName, p.keys[0]), isNull(companies.mergedIntoId)))
        .orderBy(asc(companies.id))
        .limit(1);
      if (row) {
        return {
          companyId: row.id,
          isAgency: row.isAgency || p.agency.strength === 'strong',
          companyIsAgency: row.isAgency,
          confidence: 0.3,
          created: false,
          matchedBy: 'placeholder',
          reasons: ['placeholder company name'],
          agency: p.agency,
          possibleCompanyIds: [],
          placeholder: true,
        };
      }
      return createCompany(tx, p, []);
    }

    const byName = await matchByName(tx, p, p.keys, 'name');
    if (byName) return finishMatch(tx, p, byName);

    const byDomain = await matchByDomain(tx, p);
    if (byDomain.match) return finishMatch(tx, p, byDomain.match);

    const brand = brandKey(p.name);
    if (brand && !p.keys.includes(brand)) {
      const byBrand = await matchByName(tx, p, [brand], 'brand');
      if (byBrand && !byBrand.reasons.includes('several companies share this name')) {
        // A legal entity of a known brand: keep its legal name on the brand record (spec §11.2).
        if (byBrand.confidence < LEARN_MIN_CONFIDENCE) await learnAliases(tx, byBrand.company, p);
        return finishMatch(tx, p, byBrand);
      }
    }
    return createCompany(tx, p, byDomain.possible);
  });
}

/** True when the company's name is a placeholder ("Confidential"): its jobs are not one employer's. */
export async function isPlaceholderCompany(db: DbOrTx, companyId: number | null | undefined): Promise<boolean> {
  if (!companyId) return false;
  const [row] = await db.select({ name: companies.name }).from(companies).where(eq(companies.id, companyId)).limit(1);
  return !!row && isPlaceholderCompanyName(row.name);
}
