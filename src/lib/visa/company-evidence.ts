/**
 * Company ↔ sponsor-register matching (spec §13.2, §11.2). Writes the `company_evidence` rows of
 * kind `register_match` that the visa engine (./decide.ts) and the fit score read.
 *
 * "A company matches a register entry only when name and country agree strongly. Weak matches are
 * shown as 'Possible match — verify', never as confirmed." So:
 *
 * - confirmed: the register's normalised organisation name equals one of the company's names
 *   (`normalizeCompanyName`: legal forms, "&"/"and", accents and punctuation folded) AND the
 *   register country is a country the company is known to be in (its HQ, a country-tagged alias,
 *   or the country of one of its jobs), AND the company is not a recruitment agency;
 * - possible ("verify"): the same name without that country agreement; the same name apart from
 *   spacing ("Master Card" / "Mastercard"); the register name is the company name plus a country
 *   or market qualifier ("Okta UK Ltd" for "Okta"); the company name plus descriptive words of a
 *   legal-entity name ("Monzo Bank Ltd" for "Monzo"); a name similarity of at least 0.9 (typos,
 *   plurals); or the name of a parent / subsidiary / sister company (the register may list the
 *   legal entity rather than the brand, §11.2).
 *
 * All register rows of one organisation (the UK lists one row per route, Canada one per position)
 * form one evidence row: evidence = register name / town / route / rating, source =
 * `<register key>@<download date>`, method `official`, `register_entry_id` = the first entry.
 *
 * Re-running is idempotent. A person's decision on a row (setting match_status by hand, e.g.
 * rejecting a possible match or confirming it) is detected against the status the matcher last
 * wrote (`value_json.autoStatus`) and kept from then on (`value_json.manualStatus`); a rejected
 * match is never re-created as possible or confirmed. Rows whose register entries are no longer
 * published are removed (a rejection is kept).
 */
import { and, asc, eq, gt, inArray, isNull, like, sql } from 'drizzle-orm';
import { companies, companyEvidence, jobs, sponsorRegisterEntries as sre } from '../../db/schema';
import type { MATCH_STATUSES } from '../../db/schema/_enums';
import { audit } from '../audit';
import { companyFamily, companyNames, mergedCompanyIds } from '../company/family';
import { brandKey, companyNameKeys, compactKey, coreCompanyTokens, isPlaceholderCompanyName, normalizeCompanyName } from '../company/normalize';
import type { Confidence } from '../contracts/provenance';
import { withTransaction, type DbOrTx } from '../db';
import { canonicalJson } from '../hash';
import { log } from '../log';
import { REGISTER_KEYS, REGISTERS, isRegisterKey, refreshRegisters, type RefreshRegistersOptions, type RegisterDef, type RegisterRefreshResult } from '../registers';
import { reevaluateCompanyVisa } from './persist';
import type { RegisterMatchValue } from './types';

export const REGISTER_MATCH_LOGIC_VERSION = 'register-match@2026-09-30.1';
/** Rows written by any version of this matcher (others' register_match rows are left alone). */
const LOGIC_PREFIX = 'register-match@';
/** A fuzzy name match needs at least this similarity (→ "possible"). */
export const FUZZY_MIN_SIMILARITY = 0.9;
/** At most this many "possible" organisations per register and company (the best ones). */
export const MAX_POSSIBLE_PER_REGISTER = 10;
/** Fuzzy / qualifier candidates are register names sharing the first characters of a company name. */
export const CANDIDATE_PREFIX_CHARS = 5;
const CANDIDATE_LIMIT = 5000;
const MAX_ENTRY_IDS = 50;
const MAX_FAMILY_MEMBERS = 50;
const MAX_FIELD = 300;
export const REGISTER_MATCH_AUDIT_ACTION = 'visa.register_match';

export type MatchStatus = (typeof MATCH_STATUSES)[number];

/**
 * How the company name met the register name:
 * - exact: same normalised name;
 * - spacing: same letters and digits, different spacing / punctuation;
 * - brand: one side is the other plus a country / market qualifier ("Okta UK");
 * - legal_name: one side is the other plus descriptive words ("Monzo Bank", "Lego System");
 * - fuzzy: word-by-word similarity ≥ FUZZY_MIN_SIMILARITY (plurals, one-letter typos).
 */
export type MatchBasis = 'exact' | 'spacing' | 'brand' | 'legal_name' | 'fuzzy';

const BASIS_RANK: Readonly<Record<MatchBasis, number>> = { exact: 5, spacing: 4, brand: 3, legal_name: 2, fuzzy: 1 };

/** value_json of a register_match row written here (a superset of RegisterMatchValue). */
export interface RegisterMatchRecord extends RegisterMatchValue {
  basis: MatchBasis;
  /** The register's normalised organisation name (all entries of the group share it). */
  entryKey: string;
  /** Register entry ids of the group (first MAX_ENTRY_IDS). */
  entryIds: number[];
  entryCount: number;
  /** The company / alias name that met the register name. */
  matchedName: string;
  /** The record that name belongs to (the company, a record merged into it, or a family member). */
  matchedCompanyId: number;
  /** The register country is a country the company is known to be in. */
  countryAgrees: boolean;
  /** Where that country knowledge comes from. */
  countrySources: CountrySource[];
  /** The status this matcher assigned. */
  autoStatus: Extract<MatchStatus, 'confirmed' | 'possible'>;
  /** Set once a person changed match_status; wins over autoStatus from then on. */
  manualStatus?: MatchStatus;
}

export type CountrySource = 'hq' | 'alias' | 'jobs';

// ── Pure name matching ──────────────────────────────────────────────────────────────────────

/**
 * Trailing words that turn a brand into a legal-entity name without naming another company
 * ("Monzo Bank", "Darktrace Holdings", "Meta Platforms", "Microsoft Ireland Operations").
 */
const DESCRIPTORS: ReadonlySet<string> = new Set([
  'bank', 'banking', 'technologies', 'technology', 'tech', 'software', 'labs', 'lab', 'group', 'holdings', 'holding',
  'platforms', 'platform', 'payments', 'services', 'service', 'solutions', 'systems', 'system', 'digital', 'operations',
  'development', 'centre', 'center', 'corporation', 'corp', 'company', 'co', 'enterprises', 'enterprise', 'industries',
  'ventures', 'studios', 'studio', 'games', 'entertainment', 'interactive', 'networks', 'network', 'online',
  'pharmaceuticals', 'pharma', 'research', 'engineering', 'unlimited', 'trading', 'logistics',
  'international', 'global', 'worldwide', 'management', 'communications', 'media', 'financial', 'finance',
  'r and d', 'research and development',
]);

/** A qualifier / descriptor after one of these belongs to the name ("Institute of Technology"). */
const CONNECTORS: ReadonlySet<string> = new Set([
  'of', 'for', 'in', 'at', 'on', 'de', 'des', 'du', 'la', 'le', 'les', 'del', 'di', 'da', 'do', 'dos', 'der', 'die', 'das',
  'den', 'van', 'von', 'voor', 'fur', 'pour', 'para', 'per', 'y', 'e', 'en', 'och', 'og', 'i', 'w', 'z', 'na',
]);

/** A stem of just one of these is a word, not a company. */
const GENERIC_STEMS: ReadonlySet<string> = new Set([
  'the', 'new', 'air', 'national', 'general', 'royal', 'united', 'first', 'city', 'state', 'federal', 'north', 'south',
  'east', 'west', 'central', 'capital', 'prime', 'smart', 'best', 'star', 'euro', 'world', 'green', 'blue',
  'red', 'black', 'white', 'gold', 'golden', 'silver', 'data', 'cloud', 'web', 'net', 'health', 'care', 'home', 'energy',
  'power', 'water', 'food', 'foods', 'auto', 'motor', 'motors', 'travel', 'insurance', 'property', 'properties', 'estate',
  'recruitment', 'staffing', 'people', 'talent', 'jobs', 'careers', 'university', 'school', 'college', 'hospital', 'clinic',
]);

/**
 * `normalizeCompanyName` with trailing descriptive words and country / market qualifiers removed:
 * "Monzo Bank Ltd" → "monzo", "Microsoft Ireland Operations Limited" → "microsoft",
 * "Amazon Development Centre Canada ULC" → "amazon". Null when what is left is too generic to
 * name a company ("Global Services Ltd").
 */
export function legalNameStem(name: string): string | null {
  let words = coreCompanyTokens(name);
  if (!words.length) return null;
  for (let guard = 0; guard < 6; guard++) {
    let changed = false;
    while (words.length > 1) {
      let hit = 0;
      for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
        if (DESCRIPTORS.has(words.slice(words.length - k).join(' '))) {
          hit = k;
          break;
        }
      }
      if (!hit || CONNECTORS.has(words[words.length - hit - 1])) break;
      words = words.slice(0, words.length - hit);
      // "Maersk Logistics and Services" → "maersk logistics and" → "maersk logistics".
      while (words.length > 1 && words[words.length - 1] === 'and') words = words.slice(0, -1);
      changed = true;
    }
    if (words.length > 1) {
      const b = brandKey(words.join(' '));
      if (b && b !== words.join(' ')) {
        words = b.split(' ');
        changed = true;
      }
    }
    if (!changed) break;
  }
  if (words.length === 1 && (GENERIC_STEMS.has(words[0]) || DESCRIPTORS.has(words[0]))) return null;
  const stem = words.join(' ');
  return compactKey(stem).length >= 3 ? stem : null;
}

/** Optimal-string-alignment distance, stopping once it exceeds `max`. */
function osaDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows: number[][] = [];
  for (let i = 0; i <= a.length; i++) rows.push([i, ...new Array<number>(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return max + 1;
  }
  return rows[a.length][b.length];
}

/**
 * Word equivalence for company names: 2 = identical, 1 = the same word in another form
 * (plural "system"/"systems", "technology"/"technologies", one typo in a word of 6+ letters with
 * the same first letter), 0 = different. Words with digits must be identical ("15243921" is a
 * different numbered company from "15243922"). Deliberately stricter than title matching:
 * "revolut" is not "revolution".
 */
export function sameCompanyWord(a: string, b: string): 0 | 1 | 2 {
  if (a === b) return 2;
  if (/\d/.test(a) || /\d/.test(b)) return 0;
  if (Math.min(a.length, b.length) < 4) return 0;
  if (a + 's' === b || b + 's' === a || a + 'es' === b || b + 'es' === a) return 1;
  if ((a.endsWith('ies') && a.slice(0, -3) + 'y' === b) || (b.endsWith('ies') && b.slice(0, -3) + 'y' === a)) return 1;
  if (Math.min(a.length, b.length) >= 6 && a[0] === b[0] && osaDistance(a, b, 1) <= 1) return 1;
  return 0;
}

/**
 * Similarity of two normalised company names in [0, 1]: 1 identical; 0.97 same letters apart from
 * spacing / punctuation; otherwise a Dice coefficient over words where identical words count 1
 * and word variants (sameCompanyWord = 1) count 0.9. One differing word in a two-word name gives
 * 0.5, an extra word 0.67 — only near-identical names reach FUZZY_MIN_SIMILARITY.
 */
export function companyNameSimilarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0;
  const ca = compactKey(a);
  const cb = compactKey(b);
  if (!ca || !cb) return 0;
  if (ca === cb) return 0.97;
  if (Math.min(ca.length, cb.length) / Math.max(ca.length, cb.length) < 0.6) return 0;
  const ta = [...new Set(a.split(' ').filter(Boolean))];
  const tb = [...new Set(b.split(' ').filter(Boolean))];
  if (!ta.length || !tb.length) return 0;
  const used = new Array<boolean>(tb.length).fill(false);
  const open: string[] = [];
  let shared = 0;
  for (const x of ta) {
    const j = tb.findIndex((y, k) => !used[k] && y === x);
    if (j === -1) open.push(x);
    else {
      used[j] = true;
      shared += 1;
    }
  }
  for (const x of open) {
    const j = tb.findIndex((y, k) => !used[k] && sameCompanyWord(x, y) === 1);
    if (j !== -1) {
      used[j] = true;
      shared += 0.9;
    }
  }
  return Math.round(((2 * shared) / (ta.length + tb.length)) * 1000) / 1000;
}

/** Pre-computed forms of one name (a company name or a register organisation name). */
export interface NameForm {
  name: string;
  /** Primary normalised key. */
  key: string;
  /** All lookup keys (normalised + umlaut-spelled variant + a stored key). */
  keys: string[];
  /** The keys without spaces ("mastercard" for "master card"). */
  compacts: string[];
  /** Compact brand key (country / market qualifiers dropped), null when there is none. */
  brand: string | null;
  /** Compact legal-name stem (descriptive words and qualifiers dropped), null when too generic. */
  stem: string | null;
}

function compactOrNull(s: string | null): string | null {
  const c = s ? compactKey(s) : '';
  return c.length >= 3 ? c : null;
}

export function nameForm(name: string, storedKey?: string | null): NameForm {
  const keys = companyNameKeys(name).filter(Boolean);
  if (storedKey && !keys.includes(storedKey)) keys.push(storedKey);
  return {
    name,
    key: keys[0] ?? '',
    keys,
    compacts: [...new Set(keys.map(compactKey).filter((c) => c.length >= 3))],
    brand: compactOrNull(brandKey(name)),
    stem: compactOrNull(legalNameStem(name)),
  };
}

export interface NameMatch {
  basis: MatchBasis;
  similarity: number;
}

/** How a company name meets a register organisation name (null: no match). */
export function matchNameForms(company: NameForm, entry: NameForm): NameMatch | null {
  if (!company.key || !entry.key) return null;
  if (company.keys.some((k) => entry.keys.includes(k))) return { basis: 'exact', similarity: 1 };
  if (company.compacts.some((c) => entry.compacts.includes(c))) return { basis: 'spacing', similarity: 0.97 };
  const eb = entry.brand;
  const cb = company.brand;
  if ((eb && company.compacts.includes(eb)) || (cb && entry.compacts.includes(cb)) || (eb && eb === cb)) return { basis: 'brand', similarity: 0.95 };
  if (company.stem && company.stem === entry.stem) return { basis: 'legal_name', similarity: 0.9 };
  const sim = companyNameSimilarity(company.key, entry.key);
  if (sim >= FUZZY_MIN_SIMILARITY) return { basis: 'fuzzy', similarity: sim };
  return null;
}

/** True when `a` is a stronger match than `b`. */
export function strongerMatch(a: NameMatch, b: NameMatch): boolean {
  return BASIS_RANK[a.basis] !== BASIS_RANK[b.basis] ? BASIS_RANK[a.basis] > BASIS_RANK[b.basis] : a.similarity > b.similarity;
}

// ── Pure: register groups → planned evidence rows ──────────────────────────────────────────

export interface RegisterEntryLite {
  id: number;
  registerKey: string;
  countryIso2: string;
  orgName: string;
  normalizedName: string;
  town: string | null;
  route: string | null;
  rating: string | null;
  registerVersion: string;
}

/** All entries of one organisation in one register. */
export interface EntryGroup {
  registerKey: string;
  countryIso2: string;
  entryKey: string;
  /** Sorted by id; the first is the representative. */
  entries: RegisterEntryLite[];
}

export function groupEntries(entries: readonly RegisterEntryLite[]): EntryGroup[] {
  const map = new Map<string, EntryGroup>();
  for (const e of [...entries].sort((a, b) => a.id - b.id)) {
    const k = matchKey(e.registerKey, e.normalizedName);
    let g = map.get(k);
    if (!g) {
      g = { registerKey: e.registerKey, countryIso2: e.countryIso2, entryKey: e.normalizedName, entries: [] };
      map.set(k, g);
    }
    if (!g.entries.some((x) => x.id === e.id)) g.entries.push(e);
  }
  return [...map.values()];
}

export function matchKey(registerKey: string, entryKey: string): string {
  return `${registerKey}|${entryKey}`;
}

function distinctJoined(values: readonly (string | null)[]): string | null {
  const out: string[] = [];
  for (const v of values) {
    const t = v?.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  if (!out.length) return null;
  const s = out.join('; ');
  return s.length > MAX_FIELD ? `${s.slice(0, MAX_FIELD - 1)}…` : s;
}

/** A company name to match, with the record it belongs to. */
export interface CompanyNameForm extends NameForm {
  companyId: number;
  /** A family member's name (parent / subsidiary / sister), not the company's own. */
  family: boolean;
}

export interface CompanyMatchContext {
  companyId: number;
  isAgency: boolean;
  names: readonly CompanyNameForm[];
  /** Countries the company is known to be in, with where that is known from. */
  countries: ReadonlyMap<string, readonly CountrySource[]>;
}

export interface PlannedMatch {
  key: string;
  registerEntryId: number;
  value: RegisterMatchRecord;
  /** Confidence when the row ends up confirmed (by the matcher or by a person). */
  confirmedConfidence: Confidence;
  /** Confidence while it is only possible. */
  possibleConfidence: Confidence;
  isAgency: boolean;
}

const B_RATING = /^B rating/i;
const PROVISIONAL = /^Provisional/i;

/** Every stated rating of the group is B or provisional (a downgraded / limited licence). */
function limitedLicence(ratings: readonly (string | null)[]): boolean {
  const rs = ratings.filter((r): r is string => !!r);
  return rs.length > 0 && rs.every((r) => B_RATING.test(r) || PROVISIONAL.test(r));
}

/**
 * Best match of the company against one register group, or null. Own names win over family
 * names; family names count only for exact / spacing / brand / legal-name matches.
 */
export function bestGroupMatch(ctx: CompanyMatchContext, entry: NameForm): { match: NameMatch; name: CompanyNameForm } | null {
  let best: { match: NameMatch; name: CompanyNameForm } | null = null;
  for (const family of [false, true]) {
    for (const n of ctx.names) {
      if (n.family !== family) continue;
      const m = matchNameForms(n, entry);
      if (!m || (family && m.basis === 'fuzzy')) continue;
      if (!best || strongerMatch(m, best.match)) best = { match: m, name: n };
    }
    if (best) return best;
  }
  return null;
}

/**
 * Plans the evidence row for one group (null when the company does not match it).
 * Confirmed needs an exact own-name match, country agreement and a company that is not an agency.
 */
export function planGroupMatch(ctx: CompanyMatchContext, def: Pick<RegisterDef, 'key' | 'name' | 'countryIso2' | 'evidenceKind'>, group: EntryGroup): PlannedMatch | null {
  const rep = group.entries[0];
  if (!rep) return null;
  const entry = nameForm(rep.orgName, group.entryKey);
  const found = bestGroupMatch(ctx, entry);
  if (!found) return null;
  const { match, name } = found;
  const sources = ctx.countries.get(def.countryIso2) ?? [];
  const countryAgrees = sources.length > 0;
  const autoStatus = match.basis === 'exact' && !name.family && countryAgrees && !ctx.isAgency ? 'confirmed' : 'possible';
  const ratings = group.entries.map((e) => e.rating);
  const value: RegisterMatchRecord = {
    registerKey: def.key,
    registerName: def.name,
    countryIso2: def.countryIso2,
    orgName: rep.orgName,
    town: distinctJoined(group.entries.map((e) => e.town)),
    route: distinctJoined(group.entries.map((e) => e.route)),
    rating: distinctJoined(ratings),
    registerVersion: rep.registerVersion,
    evidenceKind: def.evidenceKind,
    matchType: name.family ? 'parent' : match.basis === 'exact' ? 'exact' : 'similar',
    similarity: match.similarity,
    basis: match.basis,
    entryKey: group.entryKey,
    entryIds: group.entries.slice(0, MAX_ENTRY_IDS).map((e) => e.id),
    entryCount: group.entries.length,
    matchedName: name.name,
    matchedCompanyId: name.companyId,
    countryAgrees,
    countrySources: [...sources],
    autoStatus,
  };
  const confirmedConfidence: Confidence = def.evidenceKind === 'licensed_sponsor' ? (limitedLicence(ratings) ? 'medium' : 'high') : 'medium';
  const possibleConfidence: Confidence = match.basis === 'exact' && !name.family ? 'medium' : 'low';
  return { key: matchKey(def.key, group.entryKey), registerEntryId: rep.id, value, confirmedConfidence, possibleConfidence, isAgency: ctx.isAgency };
}

/**
 * Plans all rows: every group that matches, keeping all confirmed ones and the best
 * MAX_POSSIBLE_PER_REGISTER possible ones per register (plus any a person already decided on).
 */
export function planRegisterMatches(
  ctx: CompanyMatchContext,
  groups: readonly EntryGroup[],
  keepKeys: ReadonlySet<string> = new Set(),
): PlannedMatch[] {
  const planned: PlannedMatch[] = [];
  for (const g of groups) {
    if (!isRegisterKey(g.registerKey)) continue;
    const p = planGroupMatch(ctx, REGISTERS[g.registerKey], g);
    if (p) planned.push(p);
  }
  const out: PlannedMatch[] = [];
  for (const key of REGISTER_KEYS) {
    const mine = planned.filter((p) => p.value.registerKey === key);
    const possible = mine
      .filter((p) => p.value.autoStatus === 'possible' && !keepKeys.has(p.key))
      .sort(
        (a, b) =>
          Number(a.value.matchType === 'parent') - Number(b.value.matchType === 'parent') ||
          BASIS_RANK[b.value.basis] - BASIS_RANK[a.value.basis] ||
          b.value.similarity - a.value.similarity ||
          a.registerEntryId - b.registerEntryId,
      )
      .slice(0, MAX_POSSIBLE_PER_REGISTER);
    for (const p of mine) if (p.value.autoStatus === 'confirmed' || keepKeys.has(p.key) || possible.includes(p)) out.push(p);
  }
  return out;
}

// ── Pure: evidence text ─────────────────────────────────────────────────────────────────────

function basisText(v: RegisterMatchRecord): string {
  const n = `"${v.matchedName}"`;
  const family = v.matchType === 'parent' ? ` — a related company (parent, subsidiary or sister company) of this one` : '';
  switch (v.basis) {
    case 'exact':
      return `the same name as ${n}${family}`;
    case 'spacing':
      return `the same name as ${n} apart from spacing / punctuation${family}`;
    case 'brand':
      return `${n} with a country / market qualifier${family}`;
    case 'legal_name':
      return `${n} with descriptive words of a legal-entity name${family}`;
    case 'fuzzy':
      return `a name ${Math.round(v.similarity * 100)}% similar to ${n}${family}`;
  }
}

const SOURCE_TEXT: Readonly<Record<CountrySource, string>> = { hq: 'its HQ', alias: 'a company name tagged with that country', jobs: 'its jobs there' };

/** The human evidence sentence of a row (what the register says and how it was matched). */
export function registerEvidenceText(v: RegisterMatchRecord, status: MatchStatus, isAgency = false): string {
  const where = [v.town, v.route, v.rating].filter(Boolean).join('; ');
  const entry = `"${v.orgName}"${where ? ` (${where})` : ''} on the ${v.registerName}, version ${v.registerVersion}`;
  const lead =
    status === 'rejected'
      ? 'Rejected register match'
      : status === 'possible'
        ? 'Possible match — verify'
        : v.manualStatus === 'confirmed'
          ? 'Register match (confirmed by hand)'
          : 'Register match';
  const country = v.countryAgrees
    ? `${v.countryIso2} agrees with ${v.countrySources.map((s) => SOURCE_TEXT[s]).join(', ')}`
    : `no known presence of the company in ${v.countryIso2}`;
  const notes: string[] = [];
  if (v.rating && /(^|; )B rating/i.test(v.rating)) {
    notes.push('B rating: the licence was downgraded; the sponsor must follow a Home Office action plan and cannot assign new certificates of sponsorship until it is A-rated again.');
  }
  if (v.rating && /(^|; )Provisional/i.test(v.rating)) {
    notes.push('Provisional rating: a UK Expansion Worker licence, limited to staff sent to set up the UK business — not general hiring.');
  }
  if (v.evidenceKind === 'sponsorship_history') notes.push('This register shows past permits (sponsorship history), not a current offer.');
  if (isAgency) notes.push('This company is a recruitment agency: its licence covers its own staff, not necessarily the client employer.');
  if (v.entryCount > 1) notes.push(`${v.entryCount} register rows.`);
  return `${lead}: ${entry} — ${basisText(v)}; ${country}.${notes.length ? ` ${notes.join(' ')}` : ''}`;
}

export function registerMatchSource(registerKey: string, registerVersion: string): string {
  return `${registerKey}@${registerVersion}`;
}

// ── Pure: reconcile stored rows with the plan ───────────────────────────────────────────────

export interface StoredMatchRow {
  id: number;
  matchStatus: MatchStatus;
  confidence: Confidence;
  valueJson: unknown;
  evidence: string | null;
  source: string;
  registerEntryId: number | null;
  logicVersion: string;
}

export interface MatchWrite {
  matchStatus: MatchStatus;
  confidence: Confidence;
  valueJson: RegisterMatchRecord;
  evidence: string;
  source: string;
  registerEntryId: number;
  logicVersion: string;
}

export interface ReconcilePlan {
  insert: MatchWrite[];
  /** `material`: the status or confidence changed (job verdicts must be re-decided). */
  update: { id: number; row: MatchWrite; material: boolean }[];
  remove: { id: number; material: boolean }[];
  unchanged: number[];
  /** Final (key, status) of every row this matcher owns after the change. */
  final: { key: string; status: MatchStatus; value: RegisterMatchRecord | null }[];
}

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function isMatchStatus(v: unknown): v is MatchStatus {
  return v === 'confirmed' || v === 'possible' || v === 'rejected';
}

/** Group key of a stored row (null when its value is unreadable). */
export function storedMatchKey(valueJson: unknown): string | null {
  const o = obj(valueJson);
  if (!o || typeof o.registerKey !== 'string' || !o.registerKey) return null;
  const entryKey = typeof o.entryKey === 'string' && o.entryKey ? o.entryKey : typeof o.orgName === 'string' ? normalizeCompanyName(o.orgName) : '';
  return entryKey ? matchKey(o.registerKey, entryKey) : null;
}

/**
 * A person's decision on a stored row, or null when the row still carries the matcher's own
 * status. The matcher never writes "rejected", so a rejected row is always a person's decision.
 */
export function manualStatusOf(row: Pick<StoredMatchRow, 'matchStatus' | 'valueJson'>): MatchStatus | null {
  if (row.matchStatus === 'rejected') return 'rejected';
  const o = obj(row.valueJson) ?? {};
  const prevManual = isMatchStatus(o.manualStatus) ? o.manualStatus : null;
  if (prevManual) return row.matchStatus !== prevManual ? row.matchStatus : prevManual;
  const prevAuto = isMatchStatus(o.autoStatus) ? o.autoStatus : null;
  if (prevAuto && row.matchStatus !== prevAuto) return row.matchStatus;
  return null;
}

function sameWrite(s: StoredMatchRow, w: MatchWrite): boolean {
  return (
    s.matchStatus === w.matchStatus &&
    s.confidence === w.confidence &&
    s.evidence === w.evidence &&
    s.source === w.source &&
    s.registerEntryId === w.registerEntryId &&
    s.logicVersion === w.logicVersion &&
    canonicalJson(s.valueJson) === canonicalJson(w.valueJson)
  );
}

export function reconcileRegisterMatches(stored: readonly StoredMatchRow[], planned: readonly PlannedMatch[]): ReconcilePlan {
  const plan: ReconcilePlan = { insert: [], update: [], remove: [], unchanged: [], final: [] };
  const primary = new Map<string, StoredMatchRow>();
  for (const s of [...stored].filter((r) => r.logicVersion.startsWith(LOGIC_PREFIX)).sort((a, b) => a.id - b.id)) {
    const key = storedMatchKey(s.valueJson);
    if (!key) {
      plan.remove.push({ id: s.id, material: s.matchStatus !== 'rejected' });
      continue;
    }
    const current = primary.get(key);
    if (!current) primary.set(key, s);
    else if (!manualStatusOf(current) && manualStatusOf(s)) {
      // Duplicates (e.g. after merging two companies that matched the same organisation): the
      // one a person decided on wins.
      plan.remove.push({ id: current.id, material: false });
      primary.set(key, s);
    } else plan.remove.push({ id: s.id, material: false });
  }

  const seen = new Set<string>();
  for (const p of planned) {
    if (seen.has(p.key)) continue;
    seen.add(p.key);
    const s = primary.get(p.key);
    const manual = s ? manualStatusOf(s) : null;
    const status: MatchStatus = manual ?? p.value.autoStatus;
    const value: RegisterMatchRecord = { ...p.value };
    delete value.manualStatus;
    if (manual) value.manualStatus = manual;
    const row: MatchWrite = {
      matchStatus: status,
      confidence: status === 'confirmed' ? p.confirmedConfidence : p.possibleConfidence,
      valueJson: value,
      evidence: registerEvidenceText(value, status, p.isAgency),
      source: registerMatchSource(value.registerKey, value.registerVersion),
      registerEntryId: p.registerEntryId,
      logicVersion: REGISTER_MATCH_LOGIC_VERSION,
    };
    plan.final.push({ key: p.key, status, value });
    if (!s) plan.insert.push(row);
    else if (sameWrite(s, row)) plan.unchanged.push(s.id);
    else plan.update.push({ id: s.id, row, material: s.matchStatus !== row.matchStatus || s.confidence !== row.confidence });
  }
  for (const [key, s] of primary) {
    if (seen.has(key)) continue;
    if (manualStatusOf(s) === 'rejected') {
      // Kept so the rejection still applies if the organisation matches again.
      plan.unchanged.push(s.id);
      plan.final.push({ key, status: 'rejected', value: null });
    } else plan.remove.push({ id: s.id, material: true });
  }
  return plan;
}

// ── Pure: company summary ───────────────────────────────────────────────────────────────────

export interface SponsorSummary {
  /**
   * confirmed: a confirmed licensed-sponsor match; likely: a confirmed sponsorship-history match
   * (past permits); possible: only matches still to verify; unknown: no match.
   */
  status: 'confirmed' | 'likely' | 'possible' | 'unknown';
  /** Countries with a confirmed licensed-sponsor match. */
  sponsorCountries: string[];
  /** Countries with a confirmed sponsorship-history match. */
  historyCountries: string[];
  possibleMatches: number;
  registers: { registerKey: string; countryIso2: string; orgName: string; matchStatus: MatchStatus; matchType: RegisterMatchValue['matchType']; registerVersion: string }[];
  at: string;
  logicVersion: string;
}

/** Denormalised `companies.sponsor_summary_json` from the final matches. */
export function sponsorSummary(final: ReconcilePlan['final'], now: Date): SponsorSummary {
  const active = final.filter((f): f is { key: string; status: MatchStatus; value: RegisterMatchRecord } => f.value !== null && f.status !== 'rejected');
  const confirmed = active.filter((f) => f.status === 'confirmed');
  const uniq = (xs: string[]) => [...new Set(xs)].sort();
  const sponsorCountries = uniq(confirmed.filter((f) => f.value.evidenceKind === 'licensed_sponsor').map((f) => f.value.countryIso2));
  const historyCountries = uniq(confirmed.filter((f) => f.value.evidenceKind === 'sponsorship_history').map((f) => f.value.countryIso2));
  const possibleMatches = active.length - confirmed.length;
  const ranked = [...active].sort((a, b) => Number(b.status === 'confirmed') - Number(a.status === 'confirmed') || a.key.localeCompare(b.key));
  return {
    status: sponsorCountries.length ? 'confirmed' : historyCountries.length ? 'likely' : active.length ? 'possible' : 'unknown',
    sponsorCountries,
    historyCountries,
    possibleMatches,
    registers: ranked.slice(0, 20).map((f) => ({
      registerKey: f.value.registerKey,
      countryIso2: f.value.countryIso2,
      orgName: f.value.orgName,
      matchStatus: f.status,
      matchType: f.value.matchType,
      registerVersion: f.value.registerVersion,
    })),
    at: now.toISOString(),
    logicVersion: REGISTER_MATCH_LOGIC_VERSION,
  };
}

// ── DB ──────────────────────────────────────────────────────────────────────────────────────

export interface MatchCompanyOptions {
  now?: Date;
  /** Re-decide the company's job visa verdicts when a match appeared, went or changed status (default true). */
  reevaluateJobs?: boolean;
}

export interface CompanyRegisterMatchResult {
  /** The surviving (canonical) company that was matched. */
  companyId: number;
  confirmed: number;
  possible: number;
  rejected: number;
  inserted: number;
  updated: number;
  removed: number;
  /** A match appeared, went or changed status / confidence. */
  changed: boolean;
  /** Set when nothing was done (company missing / merged into a missing record). */
  skipped: string | null;
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

async function companyNameForms(db: DbOrTx, companyId: number, family: boolean): Promise<{ forms: CompanyNameForm[]; countries: Map<string, Set<CountrySource>> }> {
  const forms: CompanyNameForm[] = [];
  const countries = new Map<string, Set<CountrySource>>();
  for (const n of await companyNames(db, companyId)) {
    if (n.countryIso2) {
      const set = countries.get(n.countryIso2) ?? new Set<CountrySource>();
      set.add(n.kind === 'name' ? 'hq' : 'alias');
      countries.set(n.countryIso2, set);
    }
    if (isPlaceholderCompanyName(n.name)) continue;
    const f = nameForm(n.name, n.normalized);
    if (!f.key) continue;
    forms.push({ ...f, companyId: n.companyId, family });
  }
  return { forms, countries };
}

/** Names and countries of the company (merged records included) and its corporate family. */
export async function loadCompanyMatchContext(db: DbOrTx, companyId: number): Promise<CompanyMatchContext | null> {
  const [company] = await db
    .select({ id: companies.id, isAgency: companies.isAgency, parent: companies.parentCompanyId })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1);
  if (!company) return null;
  const own = await companyNameForms(db, companyId, false);
  const countries = own.countries;
  const ids = [companyId, ...(await mergedCompanyIds(db, companyId))];
  const jobCountries = await db
    .selectDistinct({ c: jobs.countryIso2 })
    .from(jobs)
    .where(and(inArray(jobs.companyId, ids), isNull(jobs.mergedIntoJobId)));
  for (const { c } of jobCountries) {
    if (!c) continue;
    const set = countries.get(c) ?? new Set<CountrySource>();
    set.add('jobs');
    countries.set(c, set);
  }

  const names: CompanyNameForm[] = [...own.forms];
  let hasFamily = company.parent !== null;
  if (!hasFamily) {
    const [child] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(inArray(companies.parentCompanyId, ids), isNull(companies.mergedIntoId)))
      .limit(1);
    hasFamily = !!child;
  }
  if (hasFamily) {
    const fam = await companyFamily(db, companyId);
    const members = (fam?.members ?? []).filter((m) => m !== companyId).slice(0, MAX_FAMILY_MEMBERS);
    const ownKeys = new Set(names.flatMap((n) => n.keys));
    for (const m of members) {
      for (const f of (await companyNameForms(db, m, true)).forms) {
        // A family member sharing the company's own name adds nothing.
        if (!f.keys.some((k) => ownKeys.has(k))) names.push(f);
      }
    }
  }
  const order: CountrySource[] = ['hq', 'alias', 'jobs'];
  return {
    companyId,
    isAgency: company.isAgency,
    names,
    countries: new Map([...countries].map(([c, s]) => [c, order.filter((o) => s.has(o))])),
  };
}

const ENTRY_COLUMNS = {
  id: sre.id,
  registerKey: sre.registerKey,
  countryIso2: sre.countryIso2,
  orgName: sre.orgName,
  normalizedName: sre.normalizedName,
  town: sre.town,
  route: sre.route,
  rating: sre.rating,
  registerVersion: sre.registerVersion,
};

/**
 * Register entries that can meet the company's names: exact normalised names, plus every entry
 * starting with the first CANDIDATE_PREFIX_CHARS characters of a name (qualifier, legal-name,
 * spacing and fuzzy candidates; at most CANDIDATE_LIMIT per prefix).
 */
export async function loadCandidateGroups(db: DbOrTx, names: readonly NameForm[]): Promise<EntryGroup[]> {
  const keys = [...new Set(names.flatMap((n) => n.keys))].filter(Boolean);
  if (!keys.length) return [];
  const rows: RegisterEntryLite[] = [];
  for (let i = 0; i < keys.length; i += 200) {
    rows.push(
      ...(await db
        .select(ENTRY_COLUMNS)
        .from(sre)
        .where(and(inArray(sre.registerKey, [...REGISTER_KEYS]), inArray(sre.normalizedName, keys.slice(i, i + 200))))),
    );
  }
  // Qualifier / legal-name matches share the first word, fuzzy ones (almost) all of it: take every
  // entry whose name starts like the first word of a company name.
  const prefixes = new Set<string>();
  const compacts = new Set<string>();
  for (const k of keys) {
    const compact = compactKey(k);
    if (compact.length < 3) continue;
    prefixes.add((k.split(' ')[0] ?? k).slice(0, CANDIDATE_PREFIX_CHARS));
    // Spacing variants ("pay pal europe" for "paypal") may split the first word: same letters.
    compacts.add(compact);
  }
  const inRegisters = inArray(sre.registerKey, [...REGISTER_KEYS]);
  for (const p of prefixes) {
    const found = await db
      .select(ENTRY_COLUMNS)
      .from(sre)
      .where(and(inRegisters, like(sre.normalizedName, `${escapeLike(p)}%`)))
      .orderBy(asc(sre.registerKey), asc(sre.normalizedName))
      .limit(CANDIDATE_LIMIT);
    if (found.length === CANDIDATE_LIMIT) log.warn('register match: candidate limit reached', { prefix: p, limit: CANDIDATE_LIMIT });
    rows.push(...found);
  }
  for (const c of compacts) {
    rows.push(
      ...(await db
        .select(ENTRY_COLUMNS)
        .from(sre)
        .where(and(inRegisters, like(sre.normalizedName, `${escapeLike(c.slice(0, 2))}%`), sql`REPLACE(${sre.normalizedName}, ' ', '') LIKE ${`${escapeLike(c)}%`}`))
        .limit(CANDIDATE_LIMIT)),
    );
  }
  return groupEntries(rows);
}

/**
 * Matches one company (resolved to its surviving record) against every imported register and
 * brings its register_match evidence up to date. Never touches rows written by others.
 */
export async function matchCompanyToRegisters(db: DbOrTx, companyId: number, opts: MatchCompanyOptions = {}): Promise<CompanyRegisterMatchResult> {
  const now = opts.now ?? new Date();
  const result = await withTransaction(db, async (tx): Promise<CompanyRegisterMatchResult> => {
    const blank = (id: number, skipped: string | null): CompanyRegisterMatchResult => ({
      companyId: id,
      confirmed: 0,
      possible: 0,
      rejected: 0,
      inserted: 0,
      updated: 0,
      removed: 0,
      changed: false,
      skipped,
    });
    // Follow merges by hand under a row lock, so two runs for one company serialise.
    let id = companyId;
    for (let hop = 0; ; hop++) {
      const [row] = await tx.select({ id: companies.id, next: companies.mergedIntoId }).from(companies).where(eq(companies.id, id)).for('update');
      if (!row) return blank(companyId, 'company not found');
      if (row.next === null) break;
      if (hop >= 10) return blank(companyId, 'merge chain too long or cyclic');
      id = row.next;
    }
    const ctx = await loadCompanyMatchContext(tx, id);
    if (!ctx) return blank(id, 'company not found');

    const stored = await tx
      .select({
        id: companyEvidence.id,
        matchStatus: companyEvidence.matchStatus,
        confidence: companyEvidence.confidence,
        valueJson: companyEvidence.valueJson,
        evidence: companyEvidence.evidence,
        source: companyEvidence.source,
        registerEntryId: companyEvidence.registerEntryId,
        logicVersion: companyEvidence.logicVersion,
      })
      .from(companyEvidence)
      .where(and(eq(companyEvidence.companyId, id), eq(companyEvidence.kind, 'register_match')))
      .orderBy(asc(companyEvidence.id));
    const decided = new Set(
      stored
        .filter((s) => s.logicVersion.startsWith(LOGIC_PREFIX) && manualStatusOf(s))
        .map((s) => storedMatchKey(s.valueJson))
        .filter((k): k is string => k !== null),
    );
    const groups = await loadCandidateGroups(tx, ctx.names);
    const planned = planRegisterMatches(ctx, groups, decided);
    const plan = reconcileRegisterMatches(stored, planned);

    if (plan.insert.length) {
      await tx.insert(companyEvidence).values(plan.insert.map((w) => ({ companyId: id, kind: 'register_match' as const, method: 'official' as const, checkedAt: now, ...w })));
    }
    for (const u of plan.update) {
      await tx
        .update(companyEvidence)
        .set({ ...u.row, method: 'official', checkedAt: now })
        .where(eq(companyEvidence.id, u.id));
    }
    const removeIds = plan.remove.map((r) => r.id);
    for (let i = 0; i < removeIds.length; i += 500) {
      await tx.delete(companyEvidence).where(inArray(companyEvidence.id, removeIds.slice(i, i + 500)));
    }
    const changed = plan.insert.length > 0 || plan.update.some((u) => u.material) || plan.remove.some((r) => r.material);

    const summary = sponsorSummary(plan.final, now);
    const [current] = await tx.select({ s: companies.sponsorSummaryJson }).from(companies).where(eq(companies.id, id));
    const prev = obj(current?.s);
    const comparable = (s: Record<string, unknown> | null) => (s ? canonicalJson({ ...s, at: null }) : null);
    if (comparable(prev) !== comparable(summary as unknown as Record<string, unknown>)) {
      await tx.update(companies).set({ sponsorSummaryJson: summary }).where(eq(companies.id, id));
    }

    const counts = {
      confirmed: plan.final.filter((f) => f.status === 'confirmed').length,
      possible: plan.final.filter((f) => f.status === 'possible').length,
      rejected: plan.final.filter((f) => f.status === 'rejected').length,
    };
    if (changed) {
      const label = (f: ReconcilePlan['final'][number]) => (f.value ? `${f.value.registerKey}: ${f.value.orgName}` : f.key);
      await audit(tx, {
        action: REGISTER_MATCH_AUDIT_ACTION,
        entityType: 'company',
        entityId: id,
        actor: 'worker',
        before: {
          confirmed: stored.filter((s) => s.logicVersion.startsWith(LOGIC_PREFIX) && s.matchStatus === 'confirmed').map((s) => storedMatchKey(s.valueJson)),
          possible: stored.filter((s) => s.logicVersion.startsWith(LOGIC_PREFIX) && s.matchStatus === 'possible').map((s) => storedMatchKey(s.valueJson)),
        },
        after: {
          confirmed: plan.final.filter((f) => f.status === 'confirmed').map(label),
          possible: plan.final.filter((f) => f.status === 'possible').map(label),
          logic: REGISTER_MATCH_LOGIC_VERSION,
        },
        reason: `Sponsor register matches: ${counts.confirmed} confirmed, ${counts.possible} possible (${plan.insert.length} new, ${plan.update.length} updated, ${plan.remove.length} removed)`,
      });
    }
    return { companyId: id, ...counts, inserted: plan.insert.length, updated: plan.update.length, removed: plan.remove.length, changed, skipped: null };
  });
  if (result.changed && opts.reevaluateJobs !== false) await reevaluateCompanyVisa(db, result.companyId, { now });
  return result;
}

export interface MatchAllOptions extends MatchCompanyOptions {
  /** Companies per page (default 200). */
  batchSize?: number;
}

export interface MatchAllResult {
  companies: number;
  changed: number;
  failed: number;
  confirmed: number;
  possible: number;
  inserted: number;
  updated: number;
  removed: number;
  durationMs: number;
}

/**
 * Matches every surviving company (daily, after the register refresh). One transaction per
 * company; a failing company is logged and counted, never thrown.
 */
export async function matchAllCompaniesToRegisters(db: DbOrTx, opts: MatchAllOptions = {}): Promise<MatchAllResult> {
  const started = Date.now();
  const out: MatchAllResult = { companies: 0, changed: 0, failed: 0, confirmed: 0, possible: 0, inserted: 0, updated: 0, removed: 0, durationMs: 0 };
  const size = Math.max(1, opts.batchSize ?? 200);
  let last = 0;
  for (;;) {
    const page = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(isNull(companies.mergedIntoId), gt(companies.id, last)))
      .orderBy(asc(companies.id))
      .limit(size);
    if (!page.length) break;
    for (const { id } of page) {
      last = id;
      try {
        const r = await matchCompanyToRegisters(db, id, opts);
        if (r.skipped) continue;
        out.companies++;
        if (r.changed) out.changed++;
        out.confirmed += r.confirmed;
        out.possible += r.possible;
        out.inserted += r.inserted;
        out.updated += r.updated;
        out.removed += r.removed;
      } catch (err) {
        out.failed++;
        log.warn('register match failed for a company', { companyId: id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
  out.durationMs = Date.now() - started;
  log.info('register matching done', { ...out });
  return out;
}

export interface RefreshRegisterEvidenceResult {
  registers: RegisterRefreshResult[];
  /** Null when no register was (re)checked, so the evidence could not have changed. */
  evidence: MatchAllResult | null;
}

/**
 * The daily job: refresh the registers (./registers, skipped within 20 h) and, when any register
 * was checked (imported or unchanged — the download date moves either way), re-match every
 * company. Never throws for a register failure (alerts are raised by the importer).
 */
export async function refreshRegistersAndEvidence(
  db: DbOrTx,
  opts: RefreshRegistersOptions & { match?: MatchAllOptions } = {},
): Promise<RefreshRegisterEvidenceResult> {
  const registers = await refreshRegisters(db, opts);
  const checked = registers.some((r) => r.status === 'imported' || r.status === 'unchanged');
  const evidence = checked ? await matchAllCompaniesToRegisters(db, { now: opts.now, ...opts.match }) : null;
  return { registers, evidence };
}

