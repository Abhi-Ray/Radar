/**
 * Pure similarity measures used by job de-duplication: Jaro–Winkler for short strings, a fuzzy
 * token-set ratio for titles, word shingles + Jaccard / containment for description text.
 */
import { normalizeTextForHash } from '../hash';
import { fold, foldKey, foldVariants } from '../normalize/text';
import { detectSeniority, normalizeTitleKey } from '../normalize/title';
import { findCities } from '../../data/places';

/** Jaro–Winkler similarity in [0, 1] (prefix scale 0.1, max prefix 4). */
export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const aMatch = new Array<boolean>(a.length).fill(false);
  const bMatch = new Array<boolean>(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bMatch[j] || a[i] !== b[j]) continue;
      aMatch[i] = true;
      bMatch[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let k = 0;
  let transpositions = 0;
  for (let i = 0; i < a.length; i++) {
    if (!aMatch[i]) continue;
    while (!bMatch[k]) k++;
    if (a[i] !== b[k]) transpositions++;
    k++;
  }
  const m = matches;
  const jaro = (m / a.length + m / b.length + (m - transpositions / 2) / m) / 3;
  let prefix = 0;
  while (prefix < Math.min(4, a.length, b.length) && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

/** Two words count as the same token when equal or (both ≥ 5 letters) Jaro–Winkler ≥ this. */
const FUZZY_TOKEN_MIN = 0.93;

function tokensOf(s: string): string[] {
  return foldKey(s).split(' ').filter(Boolean);
}

/**
 * Dice coefficient over word tokens, where near-identical long words ("engineer"/"engineers",
 * "analyst"/"analist") count as shared. 1 = same token set, 0 = nothing in common.
 */
export function tokenSetRatio(a: string, b: string): number {
  const ta = [...new Set(tokensOf(a))];
  const tb = [...new Set(tokensOf(b))];
  if (!ta.length && !tb.length) return 1;
  if (!ta.length || !tb.length) return 0;
  const used = new Array<boolean>(tb.length).fill(false);
  let shared = 0;
  for (const x of ta) {
    let hit = tb.findIndex((y, j) => !used[j] && y === x);
    if (hit === -1 && x.length >= 5) {
      hit = tb.findIndex((y, j) => !used[j] && y.length >= 5 && jaroWinkler(x, y) >= FUZZY_TOKEN_MIN);
    }
    if (hit !== -1) {
      used[hit] = true;
      shared++;
    }
  }
  return (2 * shared) / (ta.length + tb.length);
}

// ── Titles ───────────────────────────────────────────────────────────────────────────────────

export interface DedupTitle {
  /** normalizeTitleKey(): gender markers, ids, seniority, workplace and location words removed. */
  base: string;
  seniority: string | null;
  /** Level suffix ("II", "3", "L2"), which separates otherwise identical titles. */
  level: string | null;
}

const ROMAN: Readonly<Record<string, string>> = { i: '1', ii: '2', iii: '3', iv: '4', v: '5', vi: '6' };
const LEVEL_RE = /(?:^|[\s,(/-])(?:(?:level|lvl|stufe|niveau)\s*([1-6])|l([1-6])|(i{1,3}|iv|v|vi)|([1-6]))(?=$|[\s,)/-])/giu;

/** "m/w/d", "(m/v)", "H/F", "f/m/x": gender markers whose letters would read as roman levels. */
const SLASH_MARKER_RE = /\p{L}{1,4}(?:\s*\/\s*\p{L}{1,4})+/gu;

function levelOf(title: string): string | null {
  let found: string | null = null;
  for (const m of fold(title).replace(SLASH_MARKER_RE, ' ').matchAll(LEVEL_RE)) {
    const v = m[1] ?? m[2] ?? (m[3] ? ROMAN[m[3].toLowerCase()] : undefined) ?? m[4];
    if (v) found = v;
  }
  return found;
}

const titleCache = new Map<string, DedupTitle>();
const TITLE_CACHE_MAX = 5000;

/** Comparable form of a title (cached; titles repeat heavily within one company). */
export function dedupTitle(title: string): DedupTitle {
  const raw = typeof title === 'string' ? title : '';
  const hit = titleCache.get(raw);
  if (hit) return hit;
  const base = normalizeTitleKey(raw) || foldKey(raw);
  const out: DedupTitle = { base, seniority: detectSeniority(raw).word, level: levelOf(raw) };
  if (titleCache.size >= TITLE_CACHE_MAX) titleCache.delete(titleCache.keys().next().value as string);
  titleCache.set(raw, out);
  return out;
}

export interface TitleComparison {
  /** Same base, seniority and level — the "normalized title" equality of spec §11.1. */
  equal: boolean;
  similarity: number;
}

/** Title similarity; different seniority or level words pull the score down hard. */
export function compareTitles(a: DedupTitle, b: DedupTitle): TitleComparison {
  if (!a.base || !b.base) return { equal: false, similarity: 0 };
  const equal = a.base === b.base && a.seniority === b.seniority && a.level === b.level;
  if (equal) return { equal, similarity: 1 };
  let sim = a.base === b.base ? 1 : tokenSetRatio(a.base, b.base);
  if (a.seniority !== b.seniority) sim *= a.seniority && b.seniority ? 0.6 : 0.85;
  if (a.level !== b.level) sim *= a.level && b.level ? 0.6 : 0.9;
  return { equal: false, similarity: round3(sim) };
}

// ── Places ───────────────────────────────────────────────────────────────────────────────────

/**
 * City similarity: 1 for the same known city under any spelling ("Munich"/"München"), 0.95 when
 * one name contains the other ("Frankfurt"/"Frankfurt am Main"), Jaro–Winkler ≥ 0.9 for close
 * spellings, else 0. Null when either side is unknown.
 */
export function citySimilarity(a: string | null | undefined, b: string | null | undefined, countryIso2?: string | null): number | null {
  const ka = a ? foldKey(a) : '';
  const kb = b ? foldKey(b) : '';
  if (!ka || !kb) return null;
  if (ka === kb) return 1;
  const va = foldVariants(a as string);
  const vb = foldVariants(b as string);
  if (va.some((x) => vb.includes(x))) return 1;
  const inCountry = (c: { country: string }) => !countryIso2 || c.country === countryIso2;
  const ca = findCities(a as string).filter(inCountry);
  if (ca.length) {
    const cb = findCities(b as string).filter(inCountry);
    if (ca.some((c) => cb.includes(c))) return 1;
    // Two different known cities are different places, however similar the spelling.
    if (cb.length) return 0;
  }
  const ta = ka.split(' ');
  const tb = kb.split(' ');
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (short.join(' ').length >= 4 && short.every((t) => long.includes(t))) return 0.95;
  const jw = jaroWinkler(ka, kb);
  return jw >= 0.9 ? round3(jw) : 0;
}

// ── Descriptions ─────────────────────────────────────────────────────────────────────────────

/** Words per shingle (spec: description shingle Jaccard). */
export const SHINGLE_SIZE = 5;
/** Descriptions are compared on their first N words (long legal footers add nothing). */
const MAX_SHINGLE_WORDS = 20_000;

/** 32-bit FNV-1a; shingles are compared as hashes to keep memory flat. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashed word shingles of a text (lowercased, NFKC, punctuation ignored). */
export function shingles(text: string, size = SHINGLE_SIZE): Set<number> {
  const words = normalizeTextForHash(typeof text === 'string' ? text : '')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, MAX_SHINGLE_WORDS);
  const out = new Set<number>();
  if (!words.length) return out;
  if (words.length < size) {
    out.add(fnv1a(words.join(' ')));
    return out;
  }
  for (let i = 0; i + size <= words.length; i++) out.add(fnv1a(words.slice(i, i + size).join(' ')));
  return out;
}

/** |A∩B| / |A∪B|; two empty sets are not evidence of anything (0). */
export function jaccard(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** |A∩B| / min(|A|,|B|): high when one text is the other plus a preamble or footer. */
export function containment(a: ReadonlySet<number>, b: ReadonlySet<number>): number {
  if (!a.size || !b.size) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const x of small) if (large.has(x)) inter++;
  return inter / small.size;
}

export interface DescriptionComparison {
  jaccard: number;
  containment: number;
  /** Fewer than 3 shingles on a side: the numbers are not meaningful. */
  tooShort: boolean;
}

export function compareDescriptions(a: string | ReadonlySet<number>, b: string | ReadonlySet<number>): DescriptionComparison {
  const sa = typeof a === 'string' ? shingles(a) : a;
  const sb = typeof b === 'string' ? shingles(b) : b;
  return {
    jaccard: round3(jaccard(sa, sb)),
    containment: round3(containment(sa, sb)),
    tooShort: sa.size < 3 || sb.size < 3,
  };
}

export function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
