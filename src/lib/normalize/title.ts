/**
 * Title → canonical role (spec §3, §10). Pure and deterministic.
 *
 * 1. Clean: gender markers, hashtags, requisition ids, German gender endings.
 * 2. Split into segments ("Security Engineer – Cloud (m/w/d) | Berlin" → 3 segments) and fold
 *    words; tag each word/phrase with a concept from the multilingual lexicon (longest phrase
 *    first, then Germanic/Nordic/Finnish compound decomposition).
 * 3. Decide the role from the concepts, the head noun (engineer, analyst …) and word order, so
 *    "Cloud Security Engineer" ≠ "Security Engineer – Cloud" ≠ "Cloud Engineer (Security)".
 *    False friends (guarding, safety, social security, sales, clearance) are consumed first.
 * 4. Anything not recognised is `unknown: true` (it goes to the review queue, never to a guess).
 *
 * Manual decisions from settings `title_overrides` are keyed by `normalizeTitleKey(title)` and
 * win over the dictionary.
 */
import type { RoleFamily, SeniorityWord, TitleResult } from '../contracts/jobs';
import { lowerConfidence, type Confidence } from '../contracts/provenance';
import { DEFAULT_TARGET_ROLES, type TitleOverrides } from '../contracts/settings';
import { lookupCode, lookupPhrase } from '../../data/places';
import { OTHER_ROLE_PHRASES, TERM_GROUPS, type Concept, type TermGroup } from '../../data/titles/lexicon';
import { NEGATIVE_GROUPS } from '../../data/titles/negatives';
import {
  EMPLOYMENT_PHRASES,
  EXPERIENCE_NOTE_RE,
  GENDER_MARKER_RES,
  GERMAN_GENDER_SUFFIX_RES,
  HASHTAG_RE,
  LEVEL_NUMERALS,
  REQUISITION_RES,
  ROMANCE_GENDER_SUFFIX_RE,
  SEGMENT_SPLIT_RE,
  SENIORITY_RANK,
  SENIORITY_TERMS,
  STOPWORDS,
  TOKEN_REWRITES,
} from '../../data/titles/noise';
import type { RoleKey } from '../../data/titles/roles';
import { fold, foldVariants, foldedTokens, normalizePunctuation } from './text';

export const TITLE_LOGIC_VERSION = 'title@2026-09-29.1';
/** Length of title_review_queue.normalized (and of override keys). */
export const TITLE_KEY_MAX = 191;

export interface TargetRoleLists {
  primary: readonly string[];
  secondary: readonly string[];
  fallback: readonly string[];
}

// ── Dictionary ───────────────────────────────────────────────────────────────────────────

interface Entry {
  concept: Concept;
  langs: string[];
  compoundOnly: boolean;
}

const PHRASES = new Map<string, Entry>();
/** Accented spellings ("ingénieur", "sécurité") → languages, to tell apart words that fold alike. */
const ACCENTED = new Map<string, string[]>();
const MORPHEMES = new Map<string, Entry>();
/** Three-letter compound parts that are specific enough ("awssicherheit", "skysikkerhed"). */
const SHORT_MORPHEMES = new Set(['aws', 'gcp', 'iam', 'sky', 'app', 'web', 'api', 'dev', 'sec', 'ict']);
const LINKS = ['es', 'en', 's', 'e', 'n'];
const END_SUFFIXES = ['innen', 'in', 'en', 'er', 'es', 'e', 'r', 'n', 's', ''];
let maxPhraseTokens = 1;

function contentTokens(s: string): string[] {
  return foldedTokens(s).filter((t) => !STOPWORDS.has(t));
}

function register(group: TermGroup): void {
  for (const term of group.terms) {
    const lower = term.normalize('NFC').toLowerCase();
    if (/[^\u0000-\u007f]/u.test(lower)) {
      const langs = ACCENTED.get(lower) ?? [];
      if (!langs.includes(group.lang)) langs.push(group.lang);
      ACCENTED.set(lower, langs);
    }
    for (const variant of foldVariants(term)) {
      const toks = variant.split(' ').filter((t) => t && !STOPWORDS.has(t));
      if (!toks.length) continue;
      const key = toks.join(' ');
      addEntry(PHRASES, key, group, Boolean(group.compoundOnly) && toks.length === 1);
      maxPhraseTokens = Math.max(maxPhraseTokens, toks.length);
      if (group.compound) {
        const joined = toks.join('');
        if (joined.length >= 4 || SHORT_MORPHEMES.has(joined)) addEntry(MORPHEMES, joined, group, false);
      }
    }
  }
}

function addEntry(map: Map<string, Entry>, key: string, group: TermGroup, compoundOnly: boolean): void {
  const cur = map.get(key);
  if (!cur) {
    map.set(key, { concept: group.concept, langs: [group.lang], compoundOnly });
    return;
  }
  // First registration wins the concept (negatives are registered first); languages accumulate.
  if (cur.concept === group.concept && !cur.langs.includes(group.lang)) cur.langs.push(group.lang);
  if (cur.concept === group.concept && !compoundOnly) cur.compoundOnly = false;
}

for (const g of NEGATIVE_GROUPS) register(g);
for (const g of TERM_GROUPS) register(g);

const SENIORITY = new Map<string, { word: SeniorityWord; entry: boolean }>();
let maxSeniorityTokens = 1;
for (const group of SENIORITY_TERMS) {
  for (const term of group.terms) {
    for (const key of foldVariants(term)) {
      if (!SENIORITY.has(key)) SENIORITY.set(key, { word: group.word, entry: Boolean(group.entry) });
      maxSeniorityTokens = Math.max(maxSeniorityTokens, key.split(' ').length);
    }
  }
}

const EMPLOYMENT = new Set<string>();
let maxEmploymentTokens = 1;
for (const p of EMPLOYMENT_PHRASES) {
  const key = foldedTokens(p).join(' ');
  if (!key) continue;
  EMPLOYMENT.add(key);
  maxEmploymentTokens = Math.max(maxEmploymentTokens, key.split(' ').length);
}

const OTHER_ROLE_KEYS = new Set(OTHER_ROLE_PHRASES.map((p) => contentTokens(p).join(' ')));

// ── Concept groups ───────────────────────────────────────────────────────────────────────

type Head =
  | 'H_ENG'
  | 'H_SPEC'
  | 'H_ARCH'
  | 'H_CONSULT'
  | 'H_ANALYST'
  | 'H_DEV'
  | 'H_ADMIN'
  | 'H_MANAGER'
  | 'H_OFFICER'
  | 'H_AUDITOR'
  | 'H_TESTER'
  | 'H_RESEARCHER'
  | 'H_TECH'
  | 'H_LEAD'
  | 'H_OPERATOR'
  | 'H_SUPERVISOR';

/** Which head noun names the job when a title has several ("Security Research Engineer" → research). */
const HEAD_PRIORITY: readonly Head[] = [
  'H_RESEARCHER', 'H_ENG', 'H_DEV', 'H_ARCH', 'H_ANALYST', 'H_SPEC', 'H_CONSULT', 'H_AUDITOR', 'H_TESTER', 'H_ADMIN', 'H_OFFICER',
  'H_LEAD', 'H_MANAGER', 'H_TECH', 'H_OPERATOR', 'H_SUPERVISOR',
];
const HEADS: ReadonlySet<Concept> = new Set<Concept>(HEAD_PRIORITY);

/** Concepts that make an ambiguous security word ("Sicherheit", "sécurité") mean IT security. */
const CONTEXT: ReadonlySet<Concept> = new Set<Concept>([
  'TECH', 'CLOUD', 'CONTAINER', 'DEVOPS', 'SRE', 'PLATFORM', 'INFRA', 'AUTOMATION', 'PIPELINE', 'APPLICATION', 'SOFTWARE', 'NETWORK', 'OT',
  'SEC_CYBER', 'APPSEC', 'PRODSEC', 'DEVSECOPS', 'GRC_STRONG', 'SOC', 'OFFENSIVE', 'DEFENSIVE', 'VULN', 'IAM', 'CRYPTO', 'PRIVACY', 'H_DEV',
  'FRONTEND', 'BACKEND', 'JS', 'FULLSTACK', 'NODE', 'NEXTJS',
]);

/** Security specialisations that stand on their own (no "security" word needed). */
const STRONG_SECURITY: ReadonlySet<Concept> = new Set<Concept>([
  'SEC_CYBER', 'APPSEC', 'PRODSEC', 'DEVSECOPS', 'GRC_STRONG', 'SOC', 'OFFENSIVE', 'DEFENSIVE', 'VULN', 'IAM', 'CRYPTO',
]);
const SPECIAL_SECURITY: readonly Concept[] = ['SOC', 'OFFENSIVE', 'DEFENSIVE', 'VULN', 'PRIVACY', 'CRYPTO'];
const NEGATIVE_ANYWHERE_UNLESS_STRONG: readonly Concept[] = ['NEG_GUARD', 'NEG_SAFETY', 'NEG_SOCIAL'];
const ENGINEERING_HEADS: ReadonlySet<Head | null> = new Set<Head | null>(['H_ENG', 'H_DEV', 'H_SPEC', 'H_ARCH', 'H_CONSULT', 'H_LEAD', 'H_ADMIN', null]);
const GRC_HEADS: ReadonlySet<Head | null> = new Set<Head | null>(['H_ANALYST', 'H_AUDITOR', 'H_OFFICER', 'H_MANAGER', 'H_CONSULT', 'H_SPEC', null]);
const OTHER_WITHOUT_HEAD: ReadonlySet<Concept> = new Set<Concept>(['NONTARGET', 'DEVOPS', 'SRE', 'FRONTEND', 'BACKEND']);
const GOVERNANCE_WORDS = new Set(['governance', 'gouvernance', 'gobierno', 'governanca', 'gouvernement']);

// ── Preparation ──────────────────────────────────────────────────────────────────────────

interface Token {
  raw: string;
  f: string;
  seg: number;
  i: number;
  stop: boolean;
}

interface Tag {
  concept: Concept;
  langs: string[];
  seg: number;
  /** Token index (+ 0.1 per compound part) for word-order rules. */
  pos: number;
  start: number;
  end: number;
  text: string;
}

interface Prepared {
  tokens: Token[];
  segCount: number;
  tags: Tag[];
  seniority: { word: SeniorityWord | null; matched: string | null; entry: boolean; tokenIdx: Set<number> };
}

const GENDER_WORD_EXCEPTIONS = /(?:linked|built|check|plug|log|sign|opt|walk|drive|stand|break|add|fade|zoom|spin|skin|mix|cab|adm|beg|mart|kev|rob|colo)$/i;

function clean(title: string): string {
  let s = normalizePunctuation(String(title ?? '')).slice(0, 1000);
  for (const [re, rep] of TOKEN_REWRITES) s = s.replace(re, rep);
  // Keep standard numbers attached so id stripping does not eat "ISO 27001" / "IEC 62443".
  s = s.replace(/\biso\s*\/\s*iec\s*(\d{4,5})/giu, 'iso$1').replace(/\b(iso|iec)[\s/-]*(\d{4,5})\b/giu, (_m, a: string, b: string) => `${a}${b}`);
  for (const re of GENDER_MARKER_RES) s = s.replace(re, ' ');
  s = s.replace(ROMANCE_GENDER_SUFFIX_RE, '$1');
  const [suffixRe, suffixRep] = GERMAN_GENDER_SUFFIX_RES[0];
  s = s.replace(suffixRe, suffixRep);
  const [camelRe] = GERMAN_GENDER_SUFFIX_RES[1];
  s = s.replace(camelRe, (m: string, last: string, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 12), offset + 1);
    return GENDER_WORD_EXCEPTIONS.test(before) ? m : last;
  });
  s = s.replace(HASHTAG_RE, ' ').replace(EXPERIENCE_NOTE_RE, ' ');
  for (const re of REQUISITION_RES) s = s.replace(re, ' ');
  return s;
}

function tokenize(title: string): { tokens: Token[]; segCount: number } {
  const tokens: Token[] = [];
  let seg = 0;
  for (const part of clean(title).split(SEGMENT_SPLIT_RE)) {
    const words = (part ?? '').match(/[\p{L}\p{N}]+/gu);
    if (!words) continue;
    let added = false;
    for (const raw of words) {
      const f = fold(raw);
      if (!f) continue;
      tokens.push({ raw, f, seg, i: tokens.length, stop: STOPWORDS.has(f) });
      added = true;
    }
    if (added) seg++;
  }
  return { tokens, segCount: seg };
}

function decompose(word: string): Entry[] | null {
  const n = word.length;
  if (n < 6 || /\d/.test(word)) return null;
  type Cell = { pieces: number; prev: number; start: number; entry: Entry } | null;
  const best: Cell[] = new Array<Cell>(n + 1).fill(null);
  const reach: boolean[] = new Array<boolean>(n + 1).fill(false);
  reach[0] = true;
  const piecesAt = (i: number): number => (i === 0 ? 0 : (best[i]?.pieces ?? Infinity));
  for (let i = 0; i < n; i++) {
    if (!reach[i]) continue;
    const starts = [i];
    if (i > 0) for (const l of LINKS) if (word.startsWith(l, i)) starts.push(i + l.length);
    for (const s of starts) {
      for (let j = s + 3; j <= n; j++) {
        const entry = MORPHEMES.get(word.slice(s, j));
        if (!entry) continue;
        const pieces = piecesAt(i) + 1;
        if (!best[j] || pieces < (best[j]?.pieces ?? Infinity)) {
          best[j] = { pieces, prev: i, start: s, entry };
          reach[j] = true;
        }
      }
    }
  }
  let end = -1;
  for (const suf of END_SUFFIXES) {
    const e = n - suf.length;
    if (e > 0 && word.endsWith(suf) && best[e] && (best[e]?.pieces ?? 0) >= (suf ? 1 : 2)) {
      if (end === -1 || (best[e]?.pieces ?? Infinity) < (best[end]?.pieces ?? Infinity)) end = e;
    }
  }
  if (end === -1) return null;
  const out: Entry[] = [];
  for (let at = end; at > 0; ) {
    const cell = best[at];
    if (!cell) return null;
    out.unshift(cell.entry);
    at = cell.prev;
  }
  return out;
}

function tagTokens(tokens: Token[], segCount: number): Tag[] {
  const tags: Tag[] = [];
  for (let seg = 0; seg < segCount; seg++) {
    const words = tokens.filter((t) => t.seg === seg && !t.stop);
    for (let k = 0; k < words.length; ) {
      let matched = 0;
      for (let len = Math.min(maxPhraseTokens, words.length - k); len >= 1 && !matched; len--) {
        const span = words.slice(k, k + len);
        const spaced = span.map((w) => w.f).join(' ');
        const entry = PHRASES.get(spaced) ?? (len > 1 ? PHRASES.get(span.map((w) => w.f).join('')) : undefined);
        if (!entry || (len === 1 && entry.compoundOnly)) continue;
        const first = span[0];
        const last = span[span.length - 1];
        tags.push({ concept: entry.concept, langs: entry.langs, seg, pos: first.i, start: first.i, end: last.i, text: span.map((w) => w.raw).join(' ') });
        matched = len;
      }
      if (matched) {
        k += matched;
        continue;
      }
      const w = words[k];
      const parts = decompose(w.f);
      if (parts) {
        parts.forEach((entry, sub) => {
          tags.push({ concept: entry.concept, langs: entry.langs, seg, pos: w.i + sub / 10, start: w.i, end: w.i, text: w.raw });
        });
      }
      k++;
    }
  }
  return tags;
}

function detectSeniorityIn(tokens: Token[], tags: Tag[]): Prepared['seniority'] {
  const tagged = new Set<number>();
  for (const t of tags) for (let i = t.start; i <= t.end; i++) tagged.add(i);
  const headAt = new Set<number>();
  for (const t of tags) if (HEADS.has(t.concept)) headAt.add(t.end);
  let bestWord: SeniorityWord | null = null;
  let bestText: string | null = null;
  let entry = false;
  const tokenIdx = new Set<number>();
  const consider = (word: SeniorityWord, text: string, isEntry: boolean, idx: number[]) => {
    idx.forEach((i) => tokenIdx.add(i));
    if (isEntry) entry = true;
    if (!bestWord || SENIORITY_RANK[word] > SENIORITY_RANK[bestWord]) {
      bestWord = word;
      bestText = text;
    }
  };
  for (let k = 0; k < tokens.length; ) {
    let len = Math.min(maxSeniorityTokens, tokens.length - k);
    let hit = 0;
    for (; len >= 1; len--) {
      const span = tokens.slice(k, k + len);
      if (span.some((t) => t.seg !== span[0].seg)) continue;
      const s = SENIORITY.get(span.map((t) => t.f).join(' '));
      if (!s) continue;
      consider(s.word, span.map((t) => t.raw).join(' '), s.entry, span.map((t) => t.i));
      hit = len;
      break;
    }
    if (hit) {
      k += hit;
      continue;
    }
    const tok = tokens[k];
    const level = LEVEL_NUMERALS[tok.f];
    const prev = tokens[k - 1];
    const next = tokens[k + 1];
    const lastInSeg = !next || next.seg !== tok.seg;
    if (level && prev && prev.seg === tok.seg && tagged.has(prev.i)) {
      const strictPosition = tok.f === 'i' || tok.f === 'v' || /^\d$/.test(tok.f);
      if (!strictPosition || (lastInSeg && (headAt.has(prev.i) || tok.f !== 'i' || tagged.has(prev.i)))) {
        if (!(/^\d$/.test(tok.f) && !headAt.has(prev.i))) consider(level, tok.raw, false, [tok.i]);
      }
    }
    k++;
  }
  return { word: bestWord, matched: bestText, entry, tokenIdx };
}

function prepare(title: string): Prepared {
  const { tokens, segCount } = tokenize(title);
  const tags = tagTokens(tokens, segCount);
  // Resolve ambiguous "security/safety" words by context.
  const hasContext = tags.some((t) => CONTEXT.has(t.concept));
  if (hasContext) for (const t of tags) if (t.concept === 'SEC_AMBIG') t.concept = 'SEC';
  const seniority = detectSeniorityIn(tokens, tags);
  return { tokens, segCount, tags, seniority };
}

// ── Title key (review queue / overrides) ─────────────────────────────────────────────────

function isPlaceSpan(span: Token[]): boolean {
  const key = span.map((t) => t.f).join(' ');
  if (lookupPhrase(key).length) return true;
  if (span.length === 1) {
    const raw = span[0].raw;
    if (/^[A-Z]{2,3}$/.test(raw) && lookupCode(raw).length) return true;
  }
  return false;
}

/**
 * Stable key of a title for the review queue and `title_overrides`: folded, without gender
 * markers, ids, seniority words, level numerals, contract/workplace words, stop words and
 * location segments. "Sr. Cloud Security Engineer II (m/w/d) – Berlin, Remote" → "cloud security engineer".
 */
export function normalizeTitleKey(title: string): string {
  return keyOf(prepare(title), title);
}

function keyOf(p: Prepared, title: string): string {
  const { tokens, tags, seniority } = p;
  const lexicon = new Set<number>();
  for (const t of tags) if (t.concept !== 'IGNORE') for (let i = t.start; i <= t.end; i++) lexicon.add(i);
  // A seniority word that is also a head noun is kept only when it is the head ("Security Lead"),
  // not when it modifies another head ("Lead Cloud Security Engineer").
  const mainSeg = p.tags.filter((t) => HEADS.has(t.concept)).reduce((m, t) => Math.min(m, t.seg), Infinity);
  const head = pickHead(p.tags.filter((t) => HEADS.has(t.concept) && t.seg === mainSeg));
  const onlyHeadTags = (i: number) => {
    const at = tags.filter((t) => t.start <= i && i <= t.end && t.concept !== 'IGNORE');
    return at.length > 0 && at.every((t) => HEADS.has(t.concept));
  };
  const drop = new Set<number>();
  for (const t of tokens) {
    if (t.stop) drop.add(t.i);
    if (!seniority.tokenIdx.has(t.i)) continue;
    if (!lexicon.has(t.i) || (onlyHeadTags(t.i) && head && !(head.start <= t.i && t.i <= head.end))) drop.add(t.i);
  }
  for (const t of tags) if (t.concept === 'IGNORE') for (let i = t.start; i <= t.end; i++) drop.add(i);
  // Contract / workplace phrases.
  for (let k = 0; k < tokens.length; k++) {
    for (let len = Math.min(maxEmploymentTokens, tokens.length - k); len >= 1; len--) {
      const span = tokens.slice(k, k + len);
      if (span.some((t) => t.seg !== span[0].seg || lexicon.has(t.i))) continue;
      if (EMPLOYMENT.has(span.map((t) => t.f).join(' '))) {
        span.forEach((t) => drop.add(t.i));
        k += len - 1;
        break;
      }
    }
  }
  // Place names: whole location segments, and leading/trailing place words of other segments.
  const place = new Set<number>();
  for (let k = 0; k < tokens.length; k++) {
    if (lexicon.has(tokens[k].i)) continue;
    for (let len = Math.min(3, tokens.length - k); len >= 1; len--) {
      const span = tokens.slice(k, k + len);
      if (span.some((t) => t.seg !== span[0].seg || lexicon.has(t.i))) continue;
      if (isPlaceSpan(span)) {
        span.forEach((t) => place.add(t.i));
        k += len - 1;
        break;
      }
    }
  }
  for (let seg = 0; seg < p.segCount; seg++) {
    const segTokens = tokens.filter((t) => t.seg === seg);
    const remaining = segTokens.filter((t) => !drop.has(t.i));
    if (remaining.length && remaining.every((t) => place.has(t.i))) {
      remaining.forEach((t) => drop.add(t.i));
      continue;
    }
    if (!segTokens.some((t) => lexicon.has(t.i))) continue;
    for (let k = remaining.length - 1; k >= 0 && place.has(remaining[k].i); k--) drop.add(remaining[k].i);
    for (let k = 0; k < remaining.length && place.has(remaining[k].i); k++) drop.add(remaining[k].i);
  }
  const kept = tokens.filter((t) => !drop.has(t.i)).map((t) => t.f);
  let key = kept.join(' ');
  if (!key) key = foldedTokens(title).join(' ');
  if (key.length > TITLE_KEY_MAX) {
    key = key.slice(0, TITLE_KEY_MAX);
    const cut = key.lastIndexOf(' ');
    if (cut > TITLE_KEY_MAX / 2) key = key.slice(0, cut);
  }
  return key;
}

// ── Decision ─────────────────────────────────────────────────────────────────────────────

interface Decision {
  roleKey: RoleKey | null;
  confidence: Confidence;
  unknown: boolean;
  basis: Tag[];
}

type Scope = 'main' | 'any';

class Analysis {
  readonly tags: Tag[];
  readonly main: number;
  readonly head: Tag | null;
  readonly headKind: Head | null;
  readonly hasContext: boolean;
  readonly entry: boolean;
  readonly key: string;

  constructor(p: Prepared, key: string) {
    this.tags = p.tags.filter((t) => t.concept !== 'IGNORE');
    this.entry = p.seniority.entry;
    this.key = key;
    const headTags = this.tags.filter((t) => HEADS.has(t.concept));
    const firstHeadSeg = headTags.length ? Math.min(...headTags.map((t) => t.seg)) : null;
    const firstTagSeg = this.tags.length ? Math.min(...this.tags.map((t) => t.seg)) : 0;
    this.main = firstHeadSeg ?? firstTagSeg;
    this.head = pickHead(headTags.filter((t) => t.seg === this.main));
    this.headKind = (this.head?.concept as Head | undefined) ?? null;
    this.hasContext = this.tags.some((t) => CONTEXT.has(t.concept));
  }

  inScope(t: Tag, scope: Scope): boolean {
    return scope === 'any' || t.seg === this.main;
  }

  has(c: Concept | readonly Concept[], scope: Scope = 'any'): boolean {
    const list = typeof c === 'string' ? [c] : c;
    return this.tags.some((t) => list.includes(t.concept) && this.inScope(t, scope));
  }

  find(c: Concept | readonly Concept[], scope: Scope = 'any'): Tag[] {
    const list = typeof c === 'string' ? [c] : c;
    return this.tags.filter((t) => list.includes(t.concept) && this.inScope(t, scope));
  }

  /** Any word that makes this an IT-security title. */
  security(scope: Scope): boolean {
    return this.tags.some((t) => this.inScope(t, scope) && (t.concept === 'SEC' || STRONG_SECURITY.has(t.concept) || t.concept === 'PRIVACY'));
  }

  /** Security without doubt: a cyber word, a specialisation, or "security" next to tech context. */
  strongSecurity(scope: Scope): boolean {
    return this.tags.some(
      (t) => this.inScope(t, scope) && (STRONG_SECURITY.has(t.concept) || (t.concept === 'SEC' && this.hasContext) || t.concept === 'CLOUD'),
    );
  }

  grcStrong(scope: Scope): boolean {
    if (this.has('GRC_STRONG', scope)) return true;
    const grc = this.find('GRC', scope);
    return grc.some((t) => GOVERNANCE_WORDS.has(fold(t.text))) && grc.length >= 2;
  }

  basis(scope: Scope): Tag[] {
    return this.tags.filter((t) => this.inScope(t, scope) || HEADS.has(t.concept));
  }
}

function pickHead(heads: Tag[]): Tag | null {
  if (!heads.length) return null;
  const weak = (t: Tag) => t.concept === 'H_ENG' && fold(t.text) === 'engineering';
  const strong = heads.filter((t) => !weak(t));
  const pool = strong.length ? strong : heads;
  let best: Tag | null = null;
  for (const t of pool) {
    const rank = HEAD_PRIORITY.indexOf(t.concept as Head);
    const bestRank = best ? HEAD_PRIORITY.indexOf(best.concept as Head) : Infinity;
    if (rank < bestRank || (rank === bestRank && best && t.pos > best.pos)) best = t;
  }
  return best;
}

function result(roleKey: RoleKey | null, confidence: Confidence, basis: Tag[]): Decision {
  return { roleKey, confidence, unknown: roleKey === null, basis };
}

function unknown(a: Analysis): Decision {
  return { roleKey: null, confidence: 'low', unknown: true, basis: a.tags };
}

function decideNegatives(a: Analysis): Decision | null {
  const negs = (c: readonly Concept[], scope: Scope) => a.find(c, scope);
  const mainHard = negs(['NEG_SALES', 'NEG_SALES_WORD', 'NEG_NONTECH'], 'main');
  if (mainHard.length) return result('other', 'high', mainHard);
  const sales = negs(['NEG_SALES'], 'any');
  if (sales.length) return result('other', 'medium', sales);
  const soft = negs(NEGATIVE_ANYWHERE_UNLESS_STRONG, 'any');
  if (soft.length && !a.strongSecurity('main')) {
    const inMain = soft.some((t) => t.seg === a.main);
    return result('other', inMain ? 'high' : 'medium', soft);
  }
  return null;
}

function cloudRule(a: Analysis, scope: Scope): Decision {
  const basis = a.basis(scope);
  const head = a.headKind;
  const lowerIfNonTarget = (c: Confidence): Confidence => (a.has('NONTARGET', 'main') ? lowerConfidence(c) : c);
  const headTag = a.head;
  const inHeadSeg = (t: Tag) => (headTag ? t.seg === headTag.seg : t.seg === a.main);
  const preHead = (t: Tag) => inHeadSeg(t) && headTag !== null && t.pos < headTag.pos;
  const grcPreHead = a.find('GRC', scope).some(preHead);
  if (a.grcStrong(scope) || grcPreHead) return result('grc_cloud', 'high', basis);
  if (a.has('OFFENSIVE', scope)) return result('other_security', 'medium', basis);
  if (a.has(['SOC', 'DEFENSIVE', 'VULN'], scope)) {
    return head === 'H_ANALYST' ? result('cloud_security_analyst', 'high', basis) : result('cloud_security_engineer', lowerIfNonTarget('medium'), basis);
  }
  const secTags = a.tags.filter((t) => (t.concept === 'SEC' || t.concept === 'SEC_CYBER' || t.concept === 'IAM' || t.concept === 'CRYPTO') && a.inScope(t, scope));
  const cloudTags = a.find('CLOUD', scope);
  const secIn = secTags.some(inHeadSeg);
  const cloudIn = cloudTags.some(inHeadSeg);
  const both = secIn && cloudIn;
  switch (head) {
    case 'H_ANALYST':
      return result('cloud_security_analyst', both ? 'high' : 'medium', basis);
    case 'H_AUDITOR':
      return result('grc_cloud', 'high', basis);
    case 'H_OFFICER':
      return result('grc_cloud', 'medium', basis);
    case 'H_TESTER':
    case 'H_RESEARCHER':
      return result('other_security', 'medium', basis);
    case 'H_SUPERVISOR':
    case 'H_OPERATOR':
    case 'H_TECH':
      return result('cloud_security_engineer', 'low', basis);
    default:
      break;
  }
  const base: Confidence =
    head === 'H_ENG' || head === 'H_DEV' || head === 'H_SPEC' || head === 'H_ADMIN' ? 'high' : head === null ? 'low' : 'medium';
  const contentBefore = headTag ? a.tags.some((t) => t.seg === headTag.seg && t.pos < headTag.pos && !HEADS.has(t.concept)) : true;
  let role: RoleKey;
  if (headTag && !contentBefore) {
    // Head first (Romance order, or "Engineer – Cloud Security"): modifiers follow the head.
    role = both || (!secIn && !cloudIn) ? 'cloud_security_engineer' : secIn ? 'security_engineer_cloud' : 'cloud_engineer_security';
  } else {
    const secPre = secTags.some(preHead) || (!headTag && secIn);
    const cloudPre = cloudTags.some(preHead) || (!headTag && cloudIn);
    role = secPre && cloudPre ? 'cloud_security_engineer' : secPre ? 'security_engineer_cloud' : cloudPre ? 'cloud_engineer_security' : 'cloud_security_engineer';
  }
  let conf = base;
  // "Security Engineer – Cloud Security": the qualifier segment names the whole field.
  const qualifierBoth = headTag
    ? [...new Set(secTags.filter((t) => t.seg !== headTag.seg).map((t) => t.seg))].some((seg) => cloudTags.some((c) => c.seg === seg))
    : false;
  if (role === 'security_engineer_cloud' && qualifierBoth) role = 'cloud_security_engineer';
  if (role === 'cloud_security_engineer' && !both) conf = lowerConfidence(conf);
  return result(role, lowerIfNonTarget(conf), basis);
}

function decideSpecialised(a: Analysis, scope: Scope): Decision | null {
  const basis = a.basis(scope);
  const head = a.headKind;
  const conf = (c: Confidence): Confidence => (scope === 'main' ? c : lowerConfidence(c));
  if (a.has('DEVSECOPS', scope)) {
    if (head === 'H_TESTER') return result('other_security', 'medium', basis);
    const c: Confidence = head === 'H_ANALYST' || head === 'H_MANAGER' || head === 'H_OFFICER' ? 'medium' : head ? 'high' : 'medium';
    return result('devsecops_engineer', conf(c), basis);
  }
  if (a.has('APPSEC', scope)) {
    if (a.has('OFFENSIVE', scope) || head === 'H_TESTER') return result('other_security', conf('high'), basis);
    const c: Confidence = head === 'H_ANALYST' || head === 'H_MANAGER' || head === 'H_OFFICER' || head === 'H_AUDITOR' ? 'medium' : head ? 'high' : 'medium';
    return result('appsec_engineer', conf(c), basis);
  }
  if (a.has('PRODSEC', scope)) {
    if (a.has('OFFENSIVE', scope) || head === 'H_TESTER') return result('other_security', conf('high'), basis);
    const c: Confidence = head === 'H_ANALYST' || head === 'H_MANAGER' || head === 'H_OFFICER' ? 'medium' : head ? 'high' : 'medium';
    return result('product_security_engineer', conf(c), basis);
  }
  if (a.security(scope) && a.has('CLOUD', scope)) return cloudRule(a, scope);
  if (a.grcStrong(scope) && (scope === 'main' || GRC_HEADS.has(head))) {
    const inferred = !a.has('GRC_STRONG', scope);
    let c: Confidence = a.has('CLOUD') ? 'high' : 'medium';
    if (inferred) c = lowerConfidence(c);
    return result('grc_cloud', conf(c), basis);
  }
  // Risk / compliance / audit words next to security, cloud or IT ("Information Security Compliance
  // Specialist", "Cloud Risk & Compliance Manager", "IT-Risikomanager").
  if (a.has('GRC', scope) && (scope === 'main' || GRC_HEADS.has(head)) && head !== 'H_TESTER' && head !== 'H_RESEARCHER') {
    if (a.security('any') || a.has('CLOUD')) return result('grc_cloud', conf('medium'), basis);
    if (a.has('TECH') && GRC_HEADS.has(head)) return result('grc_cloud', conf('low'), basis);
  }
  const special = a.find(SPECIAL_SECURITY, scope);
  if (special.length) {
    if (a.has('CLOUD') && !a.has('OFFENSIVE', scope)) {
      return head === 'H_ANALYST' ? result('cloud_security_analyst', 'medium', basis) : result('cloud_security_engineer', 'medium', basis);
    }
    return result('other_security', conf('high'), basis);
  }
  if (a.has('OT', scope) && a.security('any')) return result('other_security', conf('medium'), basis);
  return null;
}

function decideGenericSecurity(a: Analysis): Decision | null {
  const head = a.headKind;
  const basis = a.tags;
  const plain = a.has(['SEC', 'SEC_CYBER', 'IAM']);
  if (!plain) {
    if (a.has('SEC_AMBIG')) {
      // "Sicherheitsmitarbeiter", "Técnico de seguridad" without any IT word: guarding / safety.
      if (head === 'H_SUPERVISOR' || head === 'H_OPERATOR' || head === 'H_TECH' || head === 'H_OFFICER') return result('other', 'medium', basis);
      return unknown(a);
    }
    return null;
  }
  const strong = a.strongSecurity('any');
  const engineering = ENGINEERING_HEADS.has(head);
  if (engineering) {
    const infra = a.find(['CONTAINER', 'PLATFORM', 'INFRA']);
    if (infra.length) {
      const inHead = infra.some((t) => t.seg === a.main);
      return result(inHead ? 'cloud_security_engineer' : 'security_engineer_cloud', 'medium', basis);
    }
    if (a.has(['DEVOPS', 'SRE', 'AUTOMATION', 'PIPELINE'])) return result('devsecops_engineer', 'medium', basis);
    if (a.has(['APPLICATION', 'SOFTWARE']) || head === 'H_DEV') return result('appsec_engineer', 'medium', basis);
    if (a.has('IAM') && head !== 'H_ADMIN') return result('security_engineer_cloud', 'medium', basis);
  } else if (head === 'H_ANALYST' && a.has(['CONTAINER', 'PLATFORM', 'INFRA', 'DEVOPS', 'SRE', 'AUTOMATION', 'PIPELINE'])) {
    return result('other_security', 'medium', basis);
  }
  if (a.has('NETWORK')) return result('other_security', 'medium', basis);
  if (a.has('NONTARGET', 'main') || a.has('OT')) return result('other_security', 'low', basis);
  if (a.has('IAM')) return result('other_security', 'medium', basis);
  switch (head) {
    case 'H_ANALYST':
      return result('other_security', 'medium', basis);
    case 'H_ENG':
      return result('security_engineer_cloud', 'medium', basis);
    case 'H_SPEC':
      return result('security_engineer_cloud', strong ? 'medium' : 'low', basis);
    case 'H_ARCH':
    case 'H_CONSULT':
    case 'H_LEAD':
      return result('security_engineer_cloud', 'low', basis);
    case 'H_ADMIN':
      return result('other_security', 'low', basis);
    case 'H_RESEARCHER':
    case 'H_TESTER':
      return result('other_security', 'medium', basis);
    case 'H_AUDITOR':
      return result('grc_cloud', 'medium', basis);
    case 'H_MANAGER':
      // "Director of Security Engineering", "Security Engineering Manager": leads engineers.
      if (a.has('H_ENG')) return result('security_engineer_cloud', 'low', basis);
      return strong ? result('grc_cloud', 'low', basis) : unknown(a);
    case 'H_OFFICER':
      return strong ? result('grc_cloud', 'low', basis) : result('other', 'medium', basis);
    case 'H_SUPERVISOR':
    case 'H_OPERATOR':
    case 'H_TECH':
      return strong ? result('other_security', 'low', basis) : result('other', 'medium', basis);
    case 'H_DEV':
      return result('appsec_engineer', 'medium', basis);
    default:
      return strong && a.entry ? result('other_security', 'low', basis) : unknown(a);
  }
}

function decideFallbackDeveloper(a: Analysis): Decision | null {
  const head = a.headKind;
  if (!a.has(['FULLSTACK', 'NEXTJS', 'NODE'])) return null;
  if (!(head === null || head === 'H_DEV' || head === 'H_ENG' || head === 'H_LEAD' || head === 'H_ARCH' || head === 'H_CONSULT' || head === 'H_SPEC')) return null;
  const base: Confidence = head === 'H_DEV' || head === 'H_ENG' ? 'high' : head === null ? 'low' : 'medium';
  const otherStack = a.has('NONTARGET', 'main');
  const basis = a.tags;
  if (a.has('FULLSTACK', 'main')) return result('fullstack_developer', otherStack ? lowerConfidence(base) : base, basis);
  if (a.has('NEXTJS')) return result('nextjs_developer', a.has('NEXTJS', 'main') ? base : lowerConfidence(base), basis);
  if (a.has('NODE')) return result('node_developer', a.has('NODE', 'main') ? base : lowerConfidence(base), basis);
  return result('fullstack_developer', lowerConfidence(base), basis);
}

function decideOther(a: Analysis): Decision | null {
  if (OTHER_ROLE_KEYS.has(a.key)) return result('other', 'high', a.tags);
  const content = a.tags.filter((t) => !HEADS.has(t.concept));
  if (a.head && content.length) return result('other', 'medium', a.tags);
  if (!a.head && content.some((t) => OTHER_WITHOUT_HEAD.has(t.concept))) return result('other', 'low', a.tags);
  return null;
}

function decide(a: Analysis): Decision {
  return (
    decideNegatives(a) ??
    decideSpecialised(a, 'main') ??
    decideSpecialised(a, 'any') ??
    decideGenericSecurity(a) ??
    decideFallbackDeveloper(a) ??
    decideOther(a) ??
    unknown(a)
  );
}

// ── Language ─────────────────────────────────────────────────────────────────────────────

/** Title language: the language of words that are not English (shared with English → 'en'). */
function titleLang(tags: Tag[]): string | null {
  if (!tags.length) return null;
  const counts = new Map<string, number>();
  for (const t of tags) {
    const langs = ACCENTED.get(t.text.normalize('NFC').toLowerCase()) ?? t.langs;
    if (langs.includes('en')) continue;
    // Head nouns are shared by neighbouring languages (analista, specialista); subject words decide.
    const weight = HEADS.has(t.concept) ? 0.6 : 1;
    for (const l of langs) counts.set(l, (counts.get(l) ?? 0) + weight / langs.length);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [l, n] of counts) {
    if (n > bestN) {
      best = l;
      bestN = n;
    }
  }
  return best ?? 'en';
}

// ── Public API ───────────────────────────────────────────────────────────────────────────

export function familyForRole(roleKey: string | null, targetRoles: TargetRoleLists = DEFAULT_TARGET_ROLES): RoleFamily {
  if (!roleKey) return 'other';
  if (targetRoles.primary.includes(roleKey)) return 'primary';
  if (targetRoles.secondary.includes(roleKey)) return 'secondary';
  if (targetRoles.fallback.includes(roleKey)) return 'fallback';
  return 'other';
}

/** Seniority from title words (Junior/Senior/Lead/Staff/II/Werkstudent/Stagiaire …), highest rank wins. */
export function detectSeniority(title: string): { word: SeniorityWord | null; matched: string | null; entry: boolean } {
  const { word, matched, entry } = prepare(title).seniority;
  return { word, matched, entry };
}

export interface TitleExplanation {
  key: string;
  tags: { concept: Concept; text: string; segment: number; langs: string[] }[];
  head: string | null;
  mainSegment: number;
}

/** Debug view of how a title was read (for the review queue UI and tests). */
export function explainTitle(title: string): TitleExplanation {
  const p = prepare(title);
  const key = keyOf(p, title);
  const a = new Analysis(p, key);
  return {
    key,
    tags: p.tags.map((t) => ({ concept: t.concept, text: t.text, segment: t.seg, langs: [...t.langs] })),
    head: a.head?.text ?? null,
    mainSegment: a.main,
  };
}

/**
 * Map a job title to a canonical role. `overrides` = settings `title_overrides` (manual review
 * decisions keyed by `normalizeTitleKey`); `targetRoles` = profile.targetRoles (role → family).
 */
export function mapTitle(title: string, overrides?: TitleOverrides | null, targetRoles?: TargetRoleLists): TitleResult {
  const p = prepare(title);
  const key = keyOf(p, title);
  const lang = titleLang(p.tags.filter((t) => t.concept !== 'IGNORE'));
  const override = overrides ? (overrides[key] ?? overrides[foldedTokens(String(title ?? '')).join(' ')]) : undefined;
  if (override) {
    return {
      roleKey: override.roleKey,
      roleFamily: override.roleFamily,
      seniorityWord: override.seniorityWord ?? p.seniority.word,
      matched: 'manual override',
      lang,
      confidence: 'high',
      unknown: false,
    };
  }
  const a = new Analysis(p, key);
  const d = decide(a);
  const matched = d.unknown ? null : matchedText(d.basis);
  return {
    roleKey: d.roleKey,
    roleFamily: familyForRole(d.roleKey, targetRoles ?? DEFAULT_TARGET_ROLES),
    seniorityWord: p.seniority.word,
    matched,
    lang,
    confidence: d.unknown ? 'low' : d.confidence,
    unknown: d.unknown,
  };
}

function matchedText(tags: Tag[]): string | null {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const t of [...tags].sort((x, y) => x.pos - y.pos)) {
    const k = `${t.start}:${t.text}`;
    if (seen.has(k)) continue;
    seen.add(k);
    parts.push(t.text);
  }
  const s = parts.join(' ').trim();
  return s ? s.slice(0, TITLE_KEY_MAX) : null;
}
