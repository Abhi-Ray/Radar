/**
 * Remote eligibility (spec §14): can I do this role from home (India, UTC+5:30)?
 *
 * Classes, from my point of view:
 * - `worldwide`: remote and open to where I live (explicitly worldwide, or a region list that
 *   includes India / APAC / Asia).
 * - `region_limited`: remote, but only from places that exclude India ("must be based in the EU",
 *   "US only", "we cannot hire in India").
 * - `timezone_limited`: remote, but the working-hours window is not workable from India
 *   ("within CET ±2h", "4 hours overlap with EST").
 * - `unclear`: remote (or maybe remote) without enough to decide, or the posting contradicts itself.
 * - `not_remote`: on-site or hybrid.
 *
 * Inputs: the posting text (phrase rules in src/data/remote/phrases.ts, matched on folded text one
 * sentence at a time) and the normalised location (its workplace type and the raw remote scope,
 * e.g. "Remote (Germany)" / "Remote - EMEA" / "Remote, CET ±2").
 *
 * Every fact carries exact quotes from the posting (joined with " … ") and the reason in
 * `value.reason`. Time zones use standard-time offsets (DST is ignored, ±1h at most).
 */
import { MACRO_REGION_BY_KEY, TIMEZONES, countryInfo } from '../../data/places';
import { UPPERCASE_ONLY_TZ } from '../../data/places/timezones';
import {
  EXTRA_PLACE_CODES,
  PERK_CONTEXT_RE,
  PLACE_FORM_ALIASES,
  REGION_CONDITIONS,
  REGION_NEGATORS,
  REGION_SUPPORT_CUES,
  REMOTE_PHRASE_RULES,
  REMOTE_PREFIX_CODES,
  TZ_CUE_RE,
  TZ_MACRO_WINDOWS,
  type RemotePhraseRule,
} from '../../data/remote/phrases';
import type { LocationResult, RemoteClass, RemoteValue, WorkplaceType } from '../contracts/jobs';
import { confidenceRank, lowerConfidence, minConfidence, type Confidence, type Fact } from '../contracts/provenance';
import { normalizeLocation } from '../normalize/location';
import { escapeRegExp, fold, foldWithMap, normalizePunctuation } from '../normalize/text';
import { compilePatternSource, exactQuote, origEnd, splitSentences } from '../visa/signals';

export const REMOTE_LOGIC_VERSION = 'remote@2026-09-30.1';
export const REMOTE_SOURCE = 'posting text';

/** Where I would work from. */
export interface RemoteHome {
  countryIso2: string;
  /** Standard-time UTC offset in hours. */
  utcOffset: number;
}

export const DEFAULT_REMOTE_HOME: RemoteHome = { countryIso2: 'IN', utcOffset: 5.5 };

/** `RemoteValue` plus the explanation (a superset: `class` / `regions` keep their meaning). */
export interface RemoteDetails extends RemoteValue {
  /** Plain-language explanation of the class. */
  reason: string;
  /** Exact quotes the decision rests on (also joined into the fact's `evidence`). */
  quotes: string[];
  /** Workplace type the classifier settled on (null when unknown). */
  workplace: WorkplaceType | null;
  /** Home country the classification is for. */
  home: string;
}

export interface ClassifyRemoteOptions {
  home?: RemoteHome;
  now?: Date;
}

// ── Compiled phrase rules ───────────────────────────────────────────────────────────────────

type CaptureMode = 'P' | 'S' | 'L';

interface CompiledRule {
  rule: RemotePhraseRule;
  re: RegExp;
  groups: string[];
  mode: CaptureMode | null;
}

const WORD_CHAR = '[\\p{L}\\p{N}]';

function compileRule(rule: RemotePhraseRule): CompiledRule {
  let mode: CaptureMode | null = null;
  const groups: string[] = [];
  let src = compilePatternSource(rule.pattern).replace(/(?<!\\[pP])\{([PSL])\}/g, (_m, m: CaptureMode) => {
    mode = m;
    const g = `p${groups.length}`;
    groups.push(g);
    return m === 'S' ? `(?<${g}>[^()\\[\\]\\n|]{1,80})` : `(?<${g}>.*)`;
  });
  const lead = rule.pattern.startsWith('[') || rule.pattern.startsWith('^') ? '' : `(?<!${WORD_CHAR})`;
  src = `${lead}(?:${src})(?!${WORD_CHAR})`;
  return { rule, re: new RegExp(src, 'dgu'), groups, mode };
}

const COMPILED: readonly CompiledRule[] = REMOTE_PHRASE_RULES.map(compileRule);

// ── Word lists and small regexes ────────────────────────────────────────────────────────────

function wordListRe(words: readonly string[], flags = 'u'): RegExp {
  const alts = [...words].sort((a, b) => b.length - a.length).map((w) => escapeRegExp(fold(w)).replace(/ /g, '\\s+'));
  return new RegExp(`(?<![\\p{L}\\p{N}'])(?:${alts.join('|')})(?![\\p{L}\\p{N}])`, flags);
}

const NEGATOR_RE = wordListRe(REGION_NEGATORS);
const CONDITION_RE = wordListRe(REGION_CONDITIONS);
const SUPPORT_RE = wordListRe(REGION_SUPPORT_CUES);

/** Where a place capture ends ("based in Germany with 3 years of …"). */
const STOP_RE = wordListRe(
  [
    'without', 'with', 'who', 'which', 'that', 'to', 'for', 'but', 'because', 'as', 'so', 'while', 'during', 'at', 'if', 'when', 'by', 'via',
    'since', 'unless', 'where', 'whilst', 'however', 'ohne', 'mit', 'pour', 'avec', 'sans', 'met', 'zonder', 'con', 'sin', 'para', 'com',
    'sem', 'per', 'senza', 'med', 'utan', 'uden', 'uten', 'und haben', 'and have', 'and be', 'and are', 'and hold', 'and can', 'and must',
  ],
  'iu',
);
const EXCLUDE_WORDS_RE = wordListRe(
  ['excluding', 'except', 'other than', 'apart from', 'but not', 'not including', 'with the exception of', 'ausser', 'ausgenommen', 'sauf', 'excepto', 'salvo', 'hors'],
  'iu',
);
const CONNECTOR_SPLIT_RE = /\s*(?:[,/&;:+()[\]]|(?<![\p{L}\p{N}])(?:and|or|und|oder|et|ou|y|o|e|en|eller|tai|lub|i|nor|as well as|sowie|plus)(?![\p{L}\p{N}]))\s*/iu;
/** A sentence tail that makes a region wish, not a limit ("… is a plus"). */
const PREFERENCE_RE = wordListRe(
  [
    'preferably', 'ideally', 'preferred', 'is a plus', 'a plus', 'nice to have', 'is an advantage', 'an advantage', 'advantageous', 'bonus',
    'von vorteil', 'wunschenswert', 'bevorzugt', 'un atout', 'un plus', 'se valora', 'valorable', 'sera un plus', 'een pre', 'pluspunt',
    'meriterande', 'mile widziane', 'costituisce titolo preferenziale', 'preferencialmente', 'de preferencia',
  ],
);
/** Words that make a statement a requirement. */
const REQUIRE_RE = wordListRe(
  [
    'must', 'need', 'needs', 'required', 'require', 'requires', 'have to', 'has to', 'should', 'only', 'exclusively', 'expected', 'mandatory',
    'necessary', 'within', 'muss', 'mussen', 'musst', 'erforderlich', 'voraussetzung', 'nur', 'doit', 'devez', 'obligatoire', 'uniquement',
    'debe', 'debes', 'necesario', 'imprescindible', 'requisito', 'solo', 'deve', 'devi', 'moet', 'vereist', 'alleen', 'maste', 'skal', 'musi',
    'wymagane', 'tylko',
  ],
);
/** Words that make a worldwide / time-zone mention descriptive ("our HQ is in CET"). */
const DESCRIPTIVE_RE = wordListRe([
  'hq',
  'headquarters',
  'headquartered',
  'office',
  'offices',
  'founded',
  'our team',
  'our teams',
  'our company',
  'our people',
  'our engineers',
  'colleagues',
  'teammates',
  'clients',
  'customers',
]);
const POSSESSIVE_BEFORE_RE = /(?:^|[^\p{L}])(?:our|unsere?n?|nos|notre|nuestros?|nossos?|nostri|onze|vara|vores|vare|nasi)\s+$/u;
/** Exclusion "except …" phrases only count in sentences about where the role can be done from. */
const EXCLUDE_CONTEXT_RE = /remote|anywhere|worldwide|global|countr|hire|hiring|recruit|locat|based|reside|eligib|homeoffice|teletravail|remoto|pays|land|lander|paises|paesi|landen/;
const EXCLUDE_CONTEXT_RULES = new Set(['en.ex.except', 'de.ex.ausser', 'fr.ex.sauf', 'es.ex.excepto']);
/** "We don't have an entity in India, so we hire contractors there" is not an exclusion. */
const ENTITY_WORKAROUND_RE = /contractor|freelanc|\beor\b|employer of record|deel|oyster|remote\.com|papaya|via an? /;
/** Hybrid words that are about technology, not the workplace. */
const HYBRID_TECH_NEXT_RE = /^[\s-]*(?:cloud|apps?|applications?|mobile|infrastructure|environments?|systems?|architectures?|solutions?|vehicles?|cars?|search|integrations?|approach|events?|meetings?|deployments?|it\b|networks?|storage|databases?|energy|electric|powertrain|work ?loads?|models? of computation|recommenders?|rag|retrieval|quantum)/;
/** On-site words that are an occasional visit, not the workplace. */
const ONSITE_VISIT_NEXT_RE = /^[\s-]*(?:visits?|meetings?|events?|workshops?|days?|interviews?|support|installations?|customers?|clients?|training|offsites?|retreats?|gatherings?|team ?building|kick-?offs?|presence (?:is )?(?:occasionally|sometimes))/;
const ONSITE_VISIT_BEFORE_RE = /(?:occasional(?:ly)?|quarterly|annual(?:ly)?|yearly|sometimes|periodic(?:ally)?|regular|some|optional|gelegentlich|occasionnel\w*|ocasional\w*)\s+(?:\S+\s+){0,2}$/;
/** Words that make a capture part a time-zone reference rather than a place. */
const TZ_PART_RE = /time ?zones?|timezones?|\btz\b|\bhours?\b|±|\+\/-|\butc\b|\bgmt\b|zeitzone|fuseau|zona horaria|fuso orario|tijdzone|tidszon/i;
const UPPER_TZ_RE = new RegExp(`(?<![\\p{L}\\p{N}])(?:${[...UPPERCASE_ONLY_TZ].sort((a, b) => b.length - a.length).join('|')})(?![\\p{L}\\p{N}])`, 'u');

// ── Places ──────────────────────────────────────────────────────────────────────────────────

interface PlaceSet {
  countries: string[];
  macros: string[];
  /** The part named a time zone rather than a place. */
  tz: boolean;
  /** The place is a city or state, not a whole country ("California", "Berlin"). */
  sub?: boolean;
}

const placeCache = new Map<string, PlaceSet | null>();

function placeOfCode(code: string): PlaceSet {
  return MACRO_REGION_BY_KEY.has(code) ? { countries: [], macros: [code], tz: false } : { countries: [code], macros: [], tz: false };
}

function fromLocation(raw: string): PlaceSet | null {
  const det = normalizeLocation(raw);
  const countries = det.countries.filter((c) => c !== 'XW');
  let macros = [...det.macroRegions];
  // "anywhere in LATAM" is LATAM, not worldwide.
  if (macros.includes('WORLDWIDE') && (countries.length || macros.length > 1)) macros = macros.filter((m) => m !== 'WORLDWIDE');
  const sub = det.cities.length > 0 || det.region !== null;
  if (countries.length || macros.length) return { countries, macros, tz: false, sub: sub && macros.length === 0 };
  if (det.timezones.length) return { countries: [], macros: [], tz: true };
  return null;
}

const ARTICLE_RE = /^(?:the|der|die|das|dem|den|le|la|les|l'|el|los|las|il|lo|gli|het|de|o|a|os|as|ganz|all of|whole of|entire)\s+/;

/** Known places in one short capture part ("the EU", "Deutschlands", "Polsce", "UE"). */
export function resolvePlacePart(raw: string): PlaceSet | null {
  const s = normalizePunctuation(raw)
    .replace(/^[\s"'“”«»(\[{.,:;!?-]+/u, '')
    .replace(/[\s"'“”«»)\]}.,:;!?-]+$/u, '')
    .trim();
  if (!s || s.length > 60) return null;
  const cached = placeCache.get(s);
  if (cached !== undefined) return cached;
  const result = resolveUncached(s);
  if (placeCache.size > 5000) placeCache.clear();
  placeCache.set(s, result);
  return result;
}

function resolveUncached(s: string): PlaceSet | null {
  if (TZ_PART_RE.test(s) || (UPPER_TZ_RE.test(s) && s.split(/\s+/).length <= 3 && !/^[A-Z]{2}$/.test(s))) {
    // "CET ±2", "European time zones", "US hours": a working-hours reference.
    return { countries: [], macros: [], tz: true };
  }
  const f = fold(s);
  const alias = PLACE_FORM_ALIASES[f] ?? PLACE_FORM_ALIASES[f.replace(ARTICLE_RE, '')];
  if (alias) return placeOfCode(alias);
  const extra = EXTRA_PLACE_CODES[s];
  if (extra) return placeOfCode(extra);
  const words = s.split(/\s+/);
  if (words.length > 6) return null;
  const direct = fromLocation(s);
  if (direct) return direct;
  // German genitive ("Deutschlands", "Europas", "Österreichs").
  if (/\p{L}{4,}s$/u.test(s)) {
    const gen = fromLocation(s.slice(0, -1));
    if (gen) return gen;
  }
  // "the state of California", "all of the United Kingdom": the last one or two words.
  for (const k of [2, 1]) {
    if (words.length <= k) continue;
    const tail = words.slice(-k).join(' ');
    const a = PLACE_FORM_ALIASES[fold(tail)];
    if (a) return placeOfCode(a);
    if (k === 1 && /^\p{Ll}/u.test(tail)) continue;
    const r = fromLocation(tail);
    if (r) return r;
  }
  return null;
}

function splitParts(capture: string): string[] {
  return capture
    .split(CONNECTOR_SPLIT_RE)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

interface CaptureResult {
  places: PlaceSet;
  /** Original-text length of the capture that was read (for quoting). */
  usedLength: number;
  found: boolean;
}

function emptyPlaces(): PlaceSet {
  return { countries: [], macros: [], tz: false };
}

function mergeInto(target: PlaceSet, add: PlaceSet): void {
  for (const c of add.countries) if (!target.countries.includes(c)) target.countries.push(c);
  for (const m of add.macros) if (!target.macros.includes(m)) target.macros.push(m);
  if (add.tz) target.tz = true;
}

function cutAt(s: string, re: RegExp): string {
  const m = re.exec(s);
  return m ? s.slice(0, m.index) : s;
}

/**
 * Places in a phrase capture (original text). `strict`: only the leading parts that are all
 * places ("Remote - Germany / Austria | Senior"); otherwise parts are read until the first part
 * that is not a place once a place was found ("based in Germany or Austria and have …").
 */
function readCapture(capture: string, opts: { strict: boolean; exclusion?: boolean }): CaptureResult {
  let text = cutAt(capture, STOP_RE);
  if (!opts.exclusion) text = cutAt(text, EXCLUDE_WORDS_RE);
  if (opts.strict) text = text.split(/[)\]]/)[0];
  const places = emptyPlaces();
  let found = false;
  let skipped = 0;
  const parts = splitParts(text);
  let lastPart = '';
  for (const part of parts) {
    const words = part.split(/\s+/).length;
    if (opts.strict && words > 4) break;
    const r = resolvePlacePart(part);
    if (r && opts.exclusion && r.sub) {
      // "(excluding California)": a state or city inside an allowed country is not a country exclusion.
      lastPart = part;
      continue;
    }
    if (r) {
      mergeInto(places, r);
      found = found || r.countries.length > 0 || r.macros.length > 0;
      lastPart = part;
      continue;
    }
    if (opts.strict) break;
    if (!found && skipped + words <= 8) {
      skipped += words;
      continue;
    }
    break;
  }
  const idx = lastPart ? text.lastIndexOf(lastPart) : -1;
  return { places, found, usedLength: idx >= 0 ? idx + lastPart.length : text.length };
}

const BEFORE_TOKEN_RE = /^(?:\p{Lu}[\p{L}\p{M}.'&/-]*|and|or|the|und|oder|et|ou|y|e|i|en|&|\/)$/u;

/** Longest run of words just before a hit that is all places ("EU-based only", "Germany (Remote)"). */
function readBefore(before: string, codesOnly: boolean): PlaceSet | null {
  const trimmed = before.replace(/[\s\-(\[,:/|]+$/u, '');
  if (codesOnly) {
    const m = /([A-Z][A-Za-z&]{1,5})$/.exec(trimmed);
    if (!m || !REMOTE_PREFIX_CODES.has(m[1]) || !/^[A-Z&]+$/.test(m[1])) return null;
    if (m.index > 0 && /[\p{L}\p{N}]/u.test(trimmed[m.index - 1])) return null;
    return fromLocation(m[1]) ?? placeOfCodeIfKnown(m[1]);
  }
  // Only a trailing run of place-like words: capitalised words, codes, articles, connectors.
  const all = trimmed.split(/\s+/).filter(Boolean);
  let run = 0;
  for (let i = all.length - 1; i >= 0 && run < 6; i--, run++) {
    if (!BEFORE_TOKEN_RE.test(all[i].replace(/,$/, ''))) break;
  }
  const words = all.slice(all.length - run);
  for (let k = words.length; k >= 1; k--) {
    const cand = words.slice(-k).join(' ');
    const parts = splitParts(cand);
    if (!parts.length) continue;
    const merged = emptyPlaces();
    let ok = true;
    for (const p of parts) {
      const r = resolvePlacePart(p);
      if (!r || r.tz || (!r.countries.length && !r.macros.length)) {
        ok = false;
        break;
      }
      mergeInto(merged, r);
    }
    if (ok) return merged;
  }
  return null;
}

function placeOfCodeIfKnown(code: string): PlaceSet | null {
  const up = code === 'UK' ? 'GB' : code;
  if (MACRO_REGION_BY_KEY.has(up) || countryInfo(up)) return placeOfCode(up);
  return null;
}

function placeCodes(p: PlaceSet): string[] {
  return [...p.countries, ...p.macros];
}

function includesHome(codes: readonly string[], home: RemoteHome): boolean {
  return codes.some((c) => c === home.countryIso2 || c === 'WORLDWIDE' || (MACRO_REGION_BY_KEY.get(c)?.countries.includes(home.countryIso2) ?? false));
}

/** Home named outright (or "worldwide"), not only through a macro region. */
function namesHomeExplicitly(codes: readonly string[], home: RemoteHome): boolean {
  return codes.includes(home.countryIso2) || codes.includes('WORLDWIDE');
}

// ── Time zones ──────────────────────────────────────────────────────────────────────────────

export interface TzConstraint {
  label: string;
  lo: number;
  hi: number;
  /** Tolerance around [lo, hi] in hours. */
  pm: number;
  /** Required overlap of working hours (null: must be inside the window). */
  overlap: number | null;
  confidence: Confidence;
  /** Whether my home offset can meet it. */
  satisfiable: boolean;
  /** The window was stated explicitly (a range, ± or a zone list), not just an overlap. */
  window: boolean;
}

interface TzAnchor {
  start: number;
  end: number;
  lo: number;
  hi: number;
  label: string;
  kind: 'offset' | 'range' | 'zone' | 'macro';
  ambiguous: boolean;
  pm: number | null;
}

const HOURS_UNIT = '(?:h\\b|hrs?\\b|hours?\\b|stunden\\b|std\\b|heures?\\b|horas?\\b|ore\\b|uur\\b|timer\\b|godz\\w*)';
const PM_SIGN = '(?:±|\\+\\/-|\\+\\/−|\\+-|plus or minus|plus\\/minus|\\+\\/ -)';
const PM_AFTER_RE = new RegExp(`^\\s*\\(?\\s*${PM_SIGN}\\s*(\\d{1,2}(?:[.,]5)?)\\s*${HOURS_UNIT}?`, 'i');
const PM_BEFORE_RE = new RegExp(
  `(?:(?:within|up to|max(?:imum)?|no more than|innerhalb von|entro|dans un rayon de)\\s+)?(${PM_SIGN})?\\s*(\\d{1,2}(?:[.,]5)?)\\s*-?\\s*${HOURS_UNIT}\\s*(?:of|from|von|de|di|van|around|either side of|around the)\\s*(?:the\\s+)?$`,
  'i',
);
const OFFSET_RE = /(?<![\p{L}\p{N}])(UTC|GMT)(?:\s?([+\-−±])\s?(\d{1,2})(?:[:.](\d{2}))?)?(?![\p{L}\p{N}])/giu;
const RANGE_TAIL_RE = /^\s*(?:to|-|–|—|and|until|through|thru|bis|à|a|hasta|tot|till)\s*(?:(?:UTC|GMT)\s?)?([+\-−])\s?(\d{1,2})(?:[:.](\d{2}))?/i;
const OVERLAP_WORD_RE = /overlap|uberschneid|überschneid|chevauch|solap|superposi|sovrappos|overlapp/i;
const HOURS_NUMBER_RE = /(?:at least|minimum(?: of)?|min\.?|mindestens|au moins|al menos|almeno|minstens)?\s*(\d{1,2})(?:\s*(?:-|–|to)\s*\d{1,2})?\s*\+?\s*-?\s*(?:h\b|hrs?\b|hours?\b|stunden\b|std\b|heures?\b|horas?\b|ore\b|uur\b)/gi;
const BUSINESS_HOURS_RE = /(?:business|working|office|work|normal|regular) hours|arbeitszeit|heures (?:de bureau|ouvrables|de travail)|horario (?:laboral|de oficina)|werktijden|kantoortijden|orario (?:di )?(?:lavoro|ufficio)/i;
const CORE_HOURS_RE = /core (?:working )?hours|kernarbeitszeit|heures? (?:de )?coeur/i;
const ANY_TZ_RE = /(?:any|all|every|your (?:own|local)|own) time ?zones?|regardless of (?:your )?time ?zones?|irrespective of (?:your )?time ?zones?|jede[rn]? zeitzone|n'importe quel fuseau|cualquier zona horaria/i;

function circDist(a: number, b: number): number {
  const d = Math.abs(a - b) % 24;
  return Math.min(d, 24 - d);
}

function distToWindow(h: number, lo: number, hi: number): number {
  if (h >= lo && h <= hi) return 0;
  return Math.min(circDist(h, lo), circDist(h, hi));
}

function fmtOffset(n: number): string {
  if (n === 0) return 'UTC';
  const sign = n > 0 ? '+' : '-';
  const a = Math.abs(n);
  const hh = Math.floor(a);
  const mm = Math.round((a - hh) * 60);
  return `UTC${sign}${hh}${mm ? `:${String(mm).padStart(2, '0')}` : ''}`;
}

function offsetValue(sign: string, h: string, m: string | undefined): number {
  const v = Number(h) + (m ? Number(m) / 60 : 0);
  return sign === '-' || sign === '−' ? -v : v;
}

interface ZonePattern {
  re: RegExp;
  lo: number;
  hi: number;
  key: string;
  ambiguous: boolean;
  /** Two-letter abbreviation ("PT", "ET"): only in sentences that talk about time zones. */
  twoLetter: boolean;
  /** Match on the folded text (names); abbreviations match the original, case-sensitively. */
  useFold: boolean;
}

const ZONE_PATTERNS: readonly ZonePattern[] = TIMEZONES.filter((z) => z.key !== 'UTC').flatMap((z) =>
  z.aliases
    .filter((a) => a !== 'UTC' && a !== 'GMT')
    .map((alias): ZonePattern => {
      const upper = UPPERCASE_ONLY_TZ.has(alias);
      const body = upper ? escapeRegExp(alias) : escapeRegExp(fold(alias)).replace(/ /g, '\\s+');
      return {
        re: new RegExp(`(?<![\\p{L}\\p{N}])${body}(?![\\p{L}\\p{N}])`, upper ? 'gu' : 'giu'),
        lo: z.offsets[0],
        hi: z.offsets[1],
        key: z.key,
        ambiguous: z.ambiguous === true,
        twoLetter: upper && alias.length === 2,
        useFold: !upper,
      };
    }),
);

const MACRO_TZ_PATTERNS = TZ_MACRO_WINDOWS.map((w) => ({
  ...w,
  forward: new RegExp(
    `(?:${w.re.source})[\\s-]*(?:(?:business|working|office|core|work)\\s+)?(?:time\\s?zones?|timezones?|hours|time|tz|zeitzonen?|arbeitszeiten|fuseaux? horaires?|zonas? horarias?|hours of operation)`,
    'giu',
  ),
  reverse: new RegExp(
    `(?:time\\s?zones?|timezones?|hours|zeitzonen?|fuseaux? horaires?)\\s+(?:in|of|across|within|from|throughout)\\s+(?:the\\s+)?(?:${w.re.source})|(?:time\\s?zones?|timezones?|tz|zeitzonen?|fuseaux? horaires?|zonas? horarias?)\\s*[:=–-]\\s*(?:the\\s+)?(?:${w.re.source})`,
    'giu',
  ),
}));

function overlaps(a: { start: number; end: number }, spans: readonly { start: number; end: number }[]): boolean {
  return spans.some((s) => a.start < s.end && s.start < a.end);
}

/**
 * Time-zone constraints in one sentence (original text) for a home offset. `fromLocation`: the
 * text is a location string ("Remote (CET ±2)"), so a plain zone is a real constraint.
 */
export function parseTimezoneConstraints(sentence: string, homeOffset: number, opts: { fromLocation?: boolean } = {}): TzConstraint[] {
  const s = normalizePunctuation(sentence);
  const f = fold(s);
  if (f.length !== s.length) return parseTimezoneConstraintsAligned(s, s, homeOffset, opts);
  return parseTimezoneConstraintsAligned(s, f, homeOffset, opts);
}

function parseTimezoneConstraintsAligned(s: string, f: string, homeOffset: number, opts: { fromLocation?: boolean }): TzConstraint[] {
  if (ANY_TZ_RE.test(f)) return [];
  const cue = TZ_CUE_RE.test(f);
  const anchors: TzAnchor[] = [];

  // 1. Macro windows ("European time zones", "US business hours", "time zones across APAC").
  for (const w of MACRO_TZ_PATTERNS) {
    for (const re of [w.forward, w.reverse]) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(s)) !== null) {
        const macroWord = /\b(us|u\.s\.)\b/i.exec(m[0]);
        if (macroWord && w.label.startsWith('US') && macroWord[1] === 'us') continue; // pronoun "us"
        const a = { start: m.index, end: m.index + m[0].length };
        if (!overlaps(a, anchors)) anchors.push({ ...a, lo: w.lo, hi: w.hi, label: w.label, kind: 'macro', ambiguous: false, pm: null });
      }
    }
  }

  // 2. Explicit offsets and ranges ("UTC+1", "UTC±2", "UTC-3 to UTC+3", "GMT+5:30").
  OFFSET_RE.lastIndex = 0;
  let om: RegExpExecArray | null;
  const consumed: { start: number; end: number }[] = [];
  while ((om = OFFSET_RE.exec(s)) !== null) {
    const span = { start: om.index, end: om.index + om[0].length };
    if (overlaps(span, anchors) || overlaps(span, consumed)) continue;
    const [, , sign, h, mm] = om;
    if (sign === '±' && h) {
      anchors.push({ ...span, lo: 0, hi: 0, label: `UTC ±${Number(h)}h`, kind: 'offset', ambiguous: false, pm: Number(h) });
      continue;
    }
    const v = sign && h ? offsetValue(sign, h, mm) : 0;
    const tail = RANGE_TAIL_RE.exec(s.slice(span.end));
    if (tail) {
      const v2 = offsetValue(tail[1], tail[2], tail[3]);
      const lo = Math.min(v, v2);
      const hi = Math.max(v, v2);
      const end = span.end + tail[0].length;
      consumed.push({ start: span.end, end });
      anchors.push({ start: span.start, end, lo, hi, label: `${fmtOffset(lo)}..${fmtOffset(hi)}`, kind: 'range', ambiguous: false, pm: 0 });
      continue;
    }
    anchors.push({ ...span, lo: v, hi: v, label: fmtOffset(v), kind: 'offset', ambiguous: false, pm: null });
  }

  // 3. Zone names ("CET", "EST", "Central European Time", "India Standard Time").
  for (const z of ZONE_PATTERNS) {
    if (z.twoLetter && !cue && !opts.fromLocation) continue;
    const hay = z.useFold ? f : s;
    z.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = z.re.exec(hay)) !== null) {
      const span = { start: m.index, end: m.index + m[0].length };
      if (overlaps(span, anchors)) continue;
      anchors.push({ ...span, lo: z.lo, hi: z.hi, label: z.key === 'US_TIMEZONES' ? 'US time zones' : z.key, kind: z.key === 'US_TIMEZONES' ? 'macro' : 'zone', ambiguous: z.ambiguous, pm: null });
    }
  }
  if (!anchors.length) return [];
  anchors.sort((a, b) => a.start - b.start);
  // "US business hours (EST)": the named zone is more precise than the macro window around it.
  const precise = anchors.filter(
    (a) => a.kind === 'macro' && anchors.some((b) => b.kind !== 'macro' && b.lo >= a.lo && b.hi <= a.hi),
  );
  for (const p of precise) anchors.splice(anchors.indexOf(p), 1);

  // Zone ranges ("between CET and EET", "PST to EST").
  const merged: TzAnchor[] = [];
  for (const a of anchors) {
    const prev = merged[merged.length - 1];
    if (prev && prev.kind !== 'range' && a.kind !== 'range' && /^\s*(?:to|-|–|—|and|until|through|bis|à|a|hasta|tot)\s*$/i.test(s.slice(prev.end, a.start)) && /(?:between|from|zwischen|entre|tra|tussen)\s+$/i.test(s.slice(Math.max(0, prev.start - 12), prev.start)) ) {
      merged[merged.length - 1] = {
        start: prev.start,
        end: a.end,
        lo: Math.min(prev.lo, a.lo),
        hi: Math.max(prev.hi, a.hi),
        label: `${prev.label}..${a.label}`,
        kind: 'range',
        ambiguous: prev.ambiguous || a.ambiguous,
        pm: 0,
      };
      continue;
    }
    merged.push(a);
  }

  const hasOverlap = OVERLAP_WORD_RE.test(f);
  const business = BUSINESS_HOURS_RE.test(f);
  const core = CORE_HOURS_RE.test(f);
  const require = REQUIRE_RE.test(f);
  const descriptive = DESCRIPTIVE_RE.test(f) && !require && !hasOverlap;

  // Hour counts that are not a ± tolerance → overlap hours.
  const pmSpans: { start: number; end: number }[] = [];
  const out: TzConstraint[] = [];
  for (const a of merged) {
    let pm = a.pm;
    let explicit = a.kind === 'range' || (a.kind === 'offset' && pm !== null);
    if (pm === null) {
      const after = PM_AFTER_RE.exec(s.slice(a.end, a.end + 40));
      if (after) {
        pm = Number(after[1].replace(',', '.'));
        pmSpans.push({ start: a.end, end: a.end + after[0].length });
        explicit = true;
      } else {
        const beforeText = s.slice(Math.max(0, a.start - 60), a.start);
        const before = PM_BEFORE_RE.exec(beforeText);
        if (before && (before[1] || /within|up to|max|no more than|innerhalb|entro/i.test(before[0]))) {
          pm = Number(before[2].replace(',', '.'));
          pmSpans.push({ start: a.start - beforeText.length + before.index, end: a.start });
          explicit = true;
        }
      }
    }
    let overlap: number | null = null;
    if (hasOverlap) {
      HOURS_NUMBER_RE.lastIndex = 0;
      let hm: RegExpExecArray | null;
      while ((hm = HOURS_NUMBER_RE.exec(s)) !== null) {
        const span = { start: hm.index, end: hm.index + hm[0].length };
        if (overlaps(span, pmSpans) || overlaps(span, merged)) continue;
        overlap = Number(hm[1]);
        explicit = true;
        break;
      }
      overlap ??= 4;
    } else if (core) {
      overlap = 4;
    } else if (business && pm === null) {
      overlap = 8;
    }
    if (pm === null) pm = overlap === null && (a.kind === 'zone' || a.kind === 'offset') ? 1 : 0;
    if (descriptive && !explicit && !opts.fromLocation) continue;
    if (!opts.fromLocation && !cue && !require) continue;

    const lo = a.lo - pm;
    const hi = a.hi + pm;
    const d = distToWindow(homeOffset, lo, hi);
    const satisfiable = overlap !== null ? 9 - d >= overlap : d === 0;
    // Explicit numbers or requirement wording → high; plain mentions and "business hours" → medium;
    // ambiguous abbreviations (IST, CST) → low.
    let confidence: Confidence = explicit || require ? 'high' : 'medium';
    if (!explicit && (business || core)) confidence = 'medium';
    if (a.ambiguous) confidence = 'low';
    const pmLabel = pm > 0 && a.kind !== 'range' && a.kind !== 'macro' && !a.label.includes('±') ? ` ±${pm}h` : '';
    const label = `${a.label}${pmLabel}${overlap !== null ? ` overlap ${overlap}h` : ''}`;
    out.push({ label, lo: a.lo, hi: a.hi, pm, overlap, confidence, satisfiable, window: overlap === null || a.kind === 'range' });
  }
  return out;
}

// ── Text analysis ───────────────────────────────────────────────────────────────────────────

interface Quote {
  text: string;
  start: number;
}

interface Restriction {
  places: string[];
  confidence: Confidence;
  quote: Quote;
  ruleId: string;
}

interface Cue {
  ruleId: string;
  confidence: Confidence;
  quote: Quote;
}

interface TzFinding extends TzConstraint {
  quote: Quote;
}

export interface RemoteTextAnalysis {
  restrictions: Restriction[];
  exclusions: Restriction[];
  vague: Cue[];
  worldwide: Cue[];
  timezones: TzFinding[];
  remoteStrong: Cue[];
  remoteWeak: Cue[];
  hybridStrong: Cue[];
  hybridWeak: Cue[];
  onsiteStrong: Cue[];
  onsiteWeak: Cue[];
}

interface Sentence {
  start: number;
  end: number;
  text: string;
}

function preWindow(sentence: string, hitRel: number, words: number): string {
  let pre = sentence.slice(0, hitRel);
  const cut = Math.max(pre.lastIndexOf(','), pre.lastIndexOf(':'), pre.lastIndexOf('('), pre.lastIndexOf('.'));
  if (cut !== -1) pre = pre.slice(cut + 1);
  return pre.split(/\s+/).filter(Boolean).slice(-words).join(' ');
}

function emptyAnalysis(): RemoteTextAnalysis {
  return { restrictions: [], exclusions: [], vague: [], worldwide: [], timezones: [], remoteStrong: [], remoteWeak: [], hybridStrong: [], hybridWeak: [], onsiteStrong: [], onsiteWeak: [] };
}

/** Every remote-relevant statement in a posting text (exported for tests and debugging). */
export function analyzeRemoteText(text: string, home: RemoteHome = DEFAULT_REMOTE_HOME): RemoteTextAnalysis {
  const out = emptyAnalysis();
  if (!text || !text.trim()) return out;
  const { folded, map } = foldWithMap(text);
  const sentences: Sentence[] = [];
  for (const sp of splitSentences(folded)) {
    let a = sp.start;
    while (a < sp.end && /\s/.test(folded[a])) a++;
    if (a < sp.end) sentences.push({ start: a, end: sp.end, text: folded.slice(a, sp.end) });
  }
  const orig = (fs: number, fe: number) => text.slice(map[fs], origEnd(map, fe));
  const quote = (s: Sentence, hs: number, he: number, extendTo?: number): Quote => {
    const qs = map[s.start];
    const qe = origEnd(map, extendTo ?? s.end);
    return { text: exactQuote(text, qs, qe, map[hs], origEnd(map, he)), start: qs };
  };
  const tzSentences = new Set<number>();

  sentences.forEach((s, si) => {
    for (const c of COMPILED) {
      c.re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = c.re.exec(s.text)) !== null) {
        if (m[0].length === 0) {
          c.re.lastIndex++;
          continue;
        }
        const rel = m.index;
        const hs = s.start + rel;
        const he = hs + m[0].length;
        const rule = c.rule;
        const gname = c.groups.find((g) => m!.groups?.[g] !== undefined);
        const capSpan = gname ? m.indices?.groups?.[gname] : undefined;
        const capRel = capSpan ? capSpan[0] : -1;
        const capText = gname ? m.groups![gname] : '';
        const pre = preWindow(s.text, rel, 8);
        const tail = s.text.slice(rel);
        const q = () => quote(s, hs, he);

        switch (rule.kind) {
          case 'worldwide': {
            const ctx = folded.slice(Math.max(s.start, hs - 40), Math.min(s.end, he + 40));
            if (PERK_CONTEXT_RE.test(ctx)) break;
            if (CONDITION_RE.test(preWindow(s.text, rel, 3)) || SUPPORT_RE.test(preWindow(s.text, rel, 3))) break;
            const after = s.text.slice(rel + m[0].length);
            const within = /^\s*(?:in|within|across|throughout|inside|from)\s+(?:the\s+)?/.exec(after);
            if (within) {
              const r = readCapture(orig(he + within[0].length, s.end), { strict: false });
              if (r.found && !r.places.macros.includes('WORLDWIDE')) break; // "anywhere in the EU" → region rules
            }
            if (NEGATOR_RE.test(preWindow(s.text, rel, 4))) {
              out.vague.push({ ruleId: `${rule.id}#negated`, confidence: 'medium', quote: q() });
              break;
            }
            out.worldwide.push({ ruleId: rule.id, confidence: rule.confidence, quote: q() });
            break;
          }
          case 'region': {
            if (NEGATOR_RE.test(pre) || CONDITION_RE.test(pre) || SUPPORT_RE.test(pre)) break;
            if (PREFERENCE_RE.test(tail)) break;
            let places: PlaceSet | null = null;
            let tz = false;
            let usedEnd = he;
            if (rule.places) {
              places = { countries: [], macros: [], tz: false };
              for (const p of rule.places) mergeInto(places, placeOfCode(p));
            } else if (rule.before) {
              const beforeOrig = orig(s.start, hs);
              places = readBefore(beforeOrig, rule.codes === true);
              if (places && !rule.codes) {
                // "Germany (Remote)" in a title only counts when nothing negates it right before.
                if (NEGATOR_RE.test(preWindow(s.text, rel, 2))) places = null;
              }
            } else if (capRel >= 0) {
              const capOrig = orig(s.start + capRel, s.start + capRel + capText.length);
              const r = readCapture(capOrig, { strict: c.mode === 'S' });
              if (r.found) places = r.places;
              tz = r.places.tz;
              usedEnd = Math.min(s.end, s.start + capRel + capText.length);
            }
            if (tz) tzSentences.add(si);
            if (places && (places.countries.length || places.macros.length)) {
              if (rule.id === 'en.rg.who_based' && POSSESSIVE_BEFORE_RE.test(s.text.slice(0, rel)) && !REQUIRE_RE.test(m[0])) break;
              out.restrictions.push({ places: placeCodes(places), confidence: rule.confidence, quote: quote(s, hs, usedEnd), ruleId: rule.id });
            } else if (rule.vague && !tz && (REQUIRE_RE.test(m[0].slice(0, capRel >= 0 ? capRel - rel : undefined)) || REQUIRE_RE.test(pre))) {
              out.vague.push({ ruleId: rule.id, confidence: 'medium', quote: q() });
            }
            break;
          }
          case 'region_list': {
            if (NEGATOR_RE.test(pre) || CONDITION_RE.test(pre)) break;
            const places = emptyPlaces();
            let found = false;
            if (capText.trim()) {
              const r = readCapture(orig(s.start + capRel, s.start + capRel + capText.length), { strict: false });
              if (r.found) {
                mergeInto(places, r.places);
                found = true;
              }
            }
            let lastEnd = s.end;
            // The list may continue on the next short lines / bullets.
            if (!capText.trim() || !found) {
              for (let k = si + 1, n = 0; k < sentences.length && n < 40; k++, n++) {
                const next = sentences[k];
                if (next.text.split(/\s+/).length > 8) break;
                const r = readCapture(orig(next.start, next.end), { strict: true });
                if (!r.found) break;
                mergeInto(places, r.places);
                found = true;
                lastEnd = next.end;
              }
            }
            if (!found) break;
            const extend = lastEnd - s.start <= 300 ? lastEnd : s.end;
            out.restrictions.push({ places: placeCodes(places), confidence: rule.confidence, quote: quote(s, hs, he, extend), ruleId: rule.id });
            break;
          }
          case 'exclude': {
            if (EXCLUDE_CONTEXT_RULES.has(rule.id) && !EXCLUDE_CONTEXT_RE.test(s.text)) break;
            if (rule.id === 'en.ex.no_entity' && ENTITY_WORKAROUND_RE.test(s.text)) break;
            if (capRel < 0) break;
            const r = readCapture(orig(s.start + capRel, s.start + capRel + capText.length), { strict: false, exclusion: true });
            if (!r.found) break;
            out.exclusions.push({ places: placeCodes(r.places), confidence: rule.confidence, quote: q(), ruleId: rule.id });
            break;
          }
          case 'remote_strong': {
            const cue = { ruleId: rule.id, confidence: rule.confidence, quote: q() };
            if (NEGATOR_RE.test(preWindow(s.text, rel, 3))) out.hybridStrong.push({ ...cue, ruleId: `${rule.id}#negated` });
            else out.remoteStrong.push(cue);
            break;
          }
          case 'remote_weak': {
            if (NEGATOR_RE.test(preWindow(s.text, rel, 2))) break;
            out.remoteWeak.push({ ruleId: rule.id, confidence: rule.confidence, quote: q() });
            break;
          }
          case 'hybrid': {
            if (!rule.strong && HYBRID_TECH_NEXT_RE.test(s.text.slice(rel + m[0].length))) break;
            if (NEGATOR_RE.test(preWindow(s.text, rel, 2)) && !rule.strong) break;
            (rule.strong ? out.hybridStrong : out.hybridWeak).push({ ruleId: rule.id, confidence: rule.confidence, quote: q() });
            break;
          }
          case 'onsite': {
            if (!rule.strong) {
              if (ONSITE_VISIT_NEXT_RE.test(s.text.slice(rel + m[0].length))) break;
              if (ONSITE_VISIT_BEFORE_RE.test(s.text.slice(0, rel))) break;
              if (NEGATOR_RE.test(preWindow(s.text, rel, 3))) break;
            }
            (rule.strong ? out.onsiteStrong : out.onsiteWeak).push({ ruleId: rule.id, confidence: rule.confidence, quote: q() });
            break;
          }
        }
        if (c.mode === 'P' || c.mode === 'L') break;
      }
    }
    // Time zones.
    const sentOrig = orig(s.start, s.end);
    if (tzSentences.has(si) || TZ_CUE_RE.test(s.text) || UPPER_TZ_RE.test(sentOrig)) {
      for (const t of parseTimezoneConstraints(sentOrig, home.utcOffset)) {
        out.timezones.push({ ...t, quote: { text: exactQuote(text, map[s.start], origEnd(map, s.end), map[s.start], origEnd(map, s.end)), start: map[s.start] } });
      }
    }
  });
  return out;
}

// ── Decision ────────────────────────────────────────────────────────────────────────────────

function best(cues: readonly { confidence: Confidence }[]): Confidence | null {
  let b: Confidence | null = null;
  for (const c of cues) if (b === null || confidenceRank(c.confidence) < confidenceRank(b)) b = c.confidence;
  return b;
}

function strongest<T extends { confidence: Confidence }>(cues: readonly T[]): T | null {
  let b: T | null = null;
  for (const c of cues) if (b === null || confidenceRank(c.confidence) < confidenceRank(b.confidence)) b = c;
  return b;
}

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function homeLabel(home: RemoteHome): string {
  const name = countryInfo(home.countryIso2)?.name ?? home.countryIso2;
  return `${name} (${fmtOffset(home.utcOffset)})`;
}

function placeLabel(codes: readonly string[]): string {
  const names = codes.map((c) => (c.startsWith('-') ? `not ${placeLabel([c.slice(1)])}` : (MACRO_REGION_BY_KEY.get(c)?.label ?? countryInfo(c)?.name ?? c)));
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}

interface Decision {
  cls: RemoteClass;
  regions: string[];
  confidence: Confidence;
  reason: string;
  quotes: Quote[];
  workplace: WorkplaceType | null;
}

type Workplace = { type: WorkplaceType | null; confidence: Confidence; reason: string; quotes: Quote[]; conflict: boolean };

function workplaceWord(t: WorkplaceType): string {
  return t === 'onsite' ? 'on-site' : t;
}

/**
 * Remote / hybrid / on-site from the location's workplace type and the text. A clear contradiction
 * ("Remote" location, "this role is hybrid, 3 days in the office" text) is a conflict.
 */
function resolveWorkplace(loc: LocationResult, a: RemoteTextAnalysis, locRemote: boolean): Workplace {
  const strongOff = [...a.hybridStrong, ...a.onsiteStrong];
  const offType: WorkplaceType = a.onsiteStrong.length > a.hybridStrong.length ? 'onsite' : 'hybrid';
  const firstQuotes = (cs: Cue[]) => cs.slice(0, 2).map((c) => c.quote);
  const locType = locRemote ? 'remote' : loc.workplaceType;
  if (locType === 'remote') {
    if (strongOff.length && !a.remoteStrong.length) {
      return { type: null, confidence: 'low', reason: `the location says remote, but the text says ${workplaceWord(offType)}`, quotes: firstQuotes(strongOff), conflict: true };
    }
    return { type: 'remote', confidence: 'high', reason: 'the location says remote', quotes: [], conflict: false };
  }
  if (locType === 'hybrid' || locType === 'onsite') {
    if (a.remoteStrong.some((c) => c.confidence === 'high') && !strongOff.length) {
      return { type: null, confidence: 'low', reason: `the location says ${workplaceWord(locType)}, but the text says fully remote`, quotes: firstQuotes(a.remoteStrong), conflict: true };
    }
    return { type: locType, confidence: 'high', reason: `the location says ${workplaceWord(locType)}`, quotes: firstQuotes(strongOff), conflict: false };
  }
  // No workplace from the location: read the text.
  if (a.remoteStrong.length && !strongOff.length) {
    return { type: 'remote', confidence: best(a.remoteStrong) ?? 'medium', reason: 'the text says the role is remote', quotes: firstQuotes(a.remoteStrong), conflict: false };
  }
  if (a.remoteStrong.length && strongOff.length) {
    return { type: null, confidence: 'low', reason: 'the text says both remote and on-site/hybrid', quotes: [...firstQuotes(a.remoteStrong), ...firstQuotes(strongOff)].slice(0, 3), conflict: true };
  }
  if (strongOff.length || a.hybridWeak.length || a.onsiteWeak.length) {
    const cues = strongOff.length ? strongOff : [...a.hybridWeak, ...a.onsiteWeak];
    const type: WorkplaceType = strongOff.length ? offType : a.onsiteWeak.length > a.hybridWeak.length ? 'onsite' : 'hybrid';
    return { type, confidence: 'medium', reason: `the text says ${workplaceWord(type)}`, quotes: firstQuotes(cues), conflict: false };
  }
  if (a.remoteWeak.length || a.worldwide.length) {
    return { type: null, confidence: 'low', reason: 'remote is mentioned, but not that this role is fully remote', quotes: firstQuotes([...a.remoteWeak, ...a.worldwide]), conflict: false };
  }
  return { type: null, confidence: 'low', reason: 'the posting does not mention remote work', quotes: [], conflict: false };
}

interface LocationScope {
  restrictions: Restriction[];
  timezones: TzFinding[];
  worldwide: Cue | null;
}

/** The location's remote scope ("Remote (Germany)", "Remote - EMEA", "Remote, CET ±2"). */
function readLocationScope(loc: LocationResult, home: RemoteHome): LocationScope {
  const out: LocationScope = { restrictions: [], timezones: [], worldwide: null };
  const scopeRaw = loc.remoteScopeRaw?.trim() || null;
  if (!scopeRaw) return out;
  const det = normalizeLocation(scopeRaw);
  const q: Quote = { text: scopeRaw, start: -1 };
  const countries = det.countries.filter((c) => c !== 'XW');
  const macros = det.macroRegions.filter((m) => m !== 'WORLDWIDE');
  if (countries.length || macros.length) {
    // "Berlin or Remote": a city makes the scope less certain than "Remote (Germany)".
    out.restrictions.push({ places: [...countries, ...macros], confidence: det.cities.length ? 'medium' : 'high', quote: q, ruleId: 'location.scope' });
  } else if (det.macroRegions.includes('WORLDWIDE')) {
    out.worldwide = { ruleId: 'location.worldwide', confidence: 'high', quote: q };
  }
  if (det.timezones.length || TZ_PART_RE.test(scopeRaw) || UPPER_TZ_RE.test(scopeRaw)) {
    for (const t of parseTimezoneConstraints(scopeRaw, home.utcOffset, { fromLocation: true })) out.timezones.push({ ...t, quote: q });
  }
  return out;
}

function realCountryOf(loc: LocationResult): string | null {
  return loc.countryIso2 && loc.countryIso2 !== 'XW' ? loc.countryIso2 : null;
}

function decide(text: string, loc: LocationResult, home: RemoteHome): Decision {
  const a = analyzeRemoteText(text, home);
  const scope = readLocationScope(loc, home);
  const locRemote = loc.workplaceType === 'remote' || (loc.workplaceType === null && loc.countryIso2 === 'XW');
  const wp = resolveWorkplace(loc, a, locRemote);
  const realCountry = realCountryOf(loc);

  if (wp.conflict) {
    const places = uniq([...scope.restrictions, ...a.restrictions].flatMap((r) => r.places));
    return { cls: 'unclear', regions: places, confidence: 'low', reason: `Unclear whether this is remote: ${wp.reason}.`, quotes: wp.quotes, workplace: null };
  }
  if (wp.type === 'hybrid' || wp.type === 'onsite') {
    return { cls: 'not_remote', regions: [], confidence: wp.confidence, reason: `Not remote: ${wp.reason}.`, quotes: wp.quotes, workplace: wp.type };
  }
  if (wp.type === null && !a.remoteWeak.length && !a.worldwide.length) {
    if (realCountry) {
      return { cls: 'not_remote', regions: [], confidence: 'medium', reason: `Not remote: no remote option is mentioned and the job is in ${placeLabel([realCountry])}.`, quotes: [], workplace: null };
    }
    return { cls: 'unclear', regions: [], confidence: 'low', reason: `Unclear: ${wp.reason} and no job country is known.`, quotes: [], workplace: null };
  }

  const d = remoteScope(a, scope, home, wp, realCountry);
  const confidence = wp.type === 'remote' ? minConfidence(d.confidence, wp.confidence) : 'low';
  return { ...d, confidence, workplace: wp.type };
}

/** Where a (probably) remote role can be done from. */
function remoteScope(a: RemoteTextAnalysis, scope: LocationScope, home: RemoteHome, wp: Workplace, realCountry: string | null): Decision {
  const homeName = homeLabel(home);
  const prefix = wp.type === 'remote' ? 'Remote' : 'Maybe remote (only mentioned)';
  const make = (cls: RemoteClass, regions: string[], confidence: Confidence, reason: string, quotes: Quote[]): Decision => ({
    cls,
    regions,
    confidence,
    reason,
    quotes: uniqQuotes(quotes).slice(0, 3),
    workplace: wp.type,
  });

  // 1. An exclusion that covers home ("we cannot hire in India").
  const excludedTags = uniq(a.exclusions.flatMap((e) => e.places)).map((c) => `-${c}`);
  const homeExcluded = a.exclusions.filter((e) => !e.places.includes('WORLDWIDE') && includesHome(e.places, home));
  if (homeExcluded.length) {
    const e = strongest(homeExcluded)!;
    return make(
      'region_limited',
      uniq([...a.restrictions.flatMap((r) => r.places), ...excludedTags]),
      e.confidence,
      `${prefix}, but ${placeLabel(e.places)} is excluded, which covers ${homeName}.`,
      homeExcluded.map((x) => x.quote),
    );
  }

  const restrictions = [...scope.restrictions, ...a.restrictions];
  const allPlaces = uniq(restrictions.flatMap((r) => r.places));
  const inc = restrictions.filter((r) => includesHome(r.places, home));
  const exc = restrictions.filter((r) => !includesHome(r.places, home));
  const tz = [...scope.timezones, ...a.timezones];
  const tzBad = tz.filter((t) => !t.satisfiable);
  const tzGood = tz.filter((t) => t.satisfiable);
  const tzLabels = (ts: readonly TzFinding[]) => uniq(ts.map((t) => t.label));

  // 2. Only places that exclude home.
  if (restrictions.length && !inc.length) {
    return make(
      'region_limited',
      uniq([...allPlaces, ...excludedTags]),
      strongest(exc)!.confidence,
      `${prefix}, limited to ${placeLabel(allPlaces)}; ${homeName} is not included.`,
      exc.map((x) => x.quote),
    );
  }
  // 3. The posting names regions that do and don't include home.
  if (inc.length && exc.length) {
    return make(
      'unclear',
      uniq([...allPlaces, ...excludedTags]),
      'medium',
      `${prefix}, but the posting names different regions (${placeLabel(uniq(exc.flatMap((x) => x.places)))} vs. ${placeLabel(uniq(inc.flatMap((x) => x.places)))}); check where they can hire.`,
      [...exc, ...inc].map((x) => x.quote),
    );
  }
  // 4. Working hours I cannot meet.
  if (tzBad.length) {
    return make(
      'timezone_limited',
      uniq([...tzLabels(tzBad), ...allPlaces, ...excludedTags]),
      strongest(tzBad)!.confidence,
      `${prefix}, but the working hours (${tzLabels(tzBad).join('; ')}) are not workable from ${homeName}.`,
      tzBad.map((x) => x.quote),
    );
  }
  // 5. Places that include home ("Remote - APAC", "hiring in: India, Germany").
  if (inc.length) {
    const explicit = inc.filter((r) => namesHomeExplicitly(r.places, home));
    const top = strongest(explicit.length ? explicit : inc)!;
    const conf: Confidence = explicit.length ? top.confidence : lowerConfidence(top.confidence);
    const onlyWorld = allPlaces.length === 1 && allPlaces[0] === 'WORLDWIDE';
    return make(
      'worldwide',
      uniq([...allPlaces, ...excludedTags]),
      conf,
      onlyWorld ? `${prefix} from anywhere.` : `${prefix}, open to ${placeLabel(allPlaces)}, which includes ${homeName}.`,
      inc.map((x) => x.quote),
    );
  }
  // 6. Explicitly worldwide ("work from anywhere").
  const ww = [...(scope.worldwide ? [scope.worldwide] : []), ...a.worldwide];
  const wwStrong = ww.filter((c) => c.confidence !== 'low');
  if (wwStrong.length && !a.vague.length) {
    const top = strongest(wwStrong)!;
    const tzNote = tzGood.length ? ` Working hours: ${tzLabels(tzGood).join('; ')} (workable from ${homeName}).` : '';
    return make(
      'worldwide',
      uniq(['WORLDWIDE', ...excludedTags]),
      tzGood.length ? minConfidence(top.confidence, 'medium') : top.confidence,
      `${prefix} from anywhere.${tzNote}`,
      [top.quote, ...tzGood.map((t) => t.quote)],
    );
  }
  // 7. Only a working-hours window, and I can meet it.
  if (tzGood.length) {
    const windowed = tzGood.filter((t) => t.window);
    if (windowed.length && !a.vague.length) {
      const top = strongest(windowed)!;
      return make(
        'worldwide',
        uniq([...tzLabels(windowed), ...excludedTags]),
        lowerConfidence(top.confidence),
        `${prefix} within ${tzLabels(windowed).join('; ')}, which is workable from ${homeName}; no country limit is stated.`,
        windowed.map((t) => t.quote),
      );
    }
    return make(
      'unclear',
      uniq([...tzLabels(tzGood), ...excludedTags]),
      'medium',
      `${prefix}; the hours (${tzLabels(tzGood).join('; ')}) are workable from ${homeName}, but it doesn't say which countries they hire in.`,
      tzGood.map((t) => t.quote),
    );
  }
  // 8. A limit without a known place ("must be based in one of our hiring countries").
  if (a.vague.length) {
    return make('unclear', excludedTags, 'medium', `${prefix}, but limited to locations the posting doesn't name clearly.`, a.vague.map((v) => v.quote));
  }
  if (ww.length) {
    return make('unclear', excludedTags, 'low', `${prefix}; the posting mentions a global team, but not that the role is open worldwide.`, ww.map((c) => c.quote));
  }
  // 9. Remote without a scope.
  if (realCountry) {
    return make(
      'unclear',
      uniq([realCountry, ...excludedTags]),
      'low',
      `${prefix}, listed in ${placeLabel([realCountry])}; it doesn't say whether it can be done from ${homeName}.`,
      wp.quotes,
    );
  }
  return make('unclear', excludedTags, 'low', `${prefix}, but the posting doesn't say from where.`, wp.quotes);
}

function uniqQuotes(qs: readonly Quote[]): Quote[] {
  const seen = new Set<string>();
  const out: Quote[] = [];
  for (const q of qs) {
    if (!q.text || seen.has(q.text)) continue;
    // Drop a quote contained in one already kept (the same sentence quoted twice).
    if (out.some((o) => o.text.includes(q.text))) continue;
    seen.add(q.text);
    out.push(q);
  }
  return out;
}

/**
 * Classify the remote eligibility of one job. Returns a `remote` fact (method rule, source
 * "posting text") whose value is `RemoteDetails` — a superset of `RemoteValue`.
 */
export function classifyRemote(text: string, loc: LocationResult, opts: ClassifyRemoteOptions = {}): Fact<RemoteDetails> {
  const home = opts.home ?? DEFAULT_REMOTE_HOME;
  const d = decide(text ?? '', loc, home);
  const quotes = uniqQuotes(d.quotes).map((q) => q.text);
  return {
    value: { class: d.cls, regions: d.regions, reason: d.reason, quotes, workplace: d.workplace, home: home.countryIso2 },
    evidence: quotes.length ? quotes.join(' … ') : null,
    source: REMOTE_SOURCE,
    method: 'rule',
    confidence: d.confidence,
    checkedAt: opts.now ?? new Date(),
    logicVersion: REMOTE_LOGIC_VERSION,
  };
}
