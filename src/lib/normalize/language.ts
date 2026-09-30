/**
 * Posting language and language requirement (spec §8 "Language", §12 scoring: "English OK" beats
 * "local language required").
 *
 * 1. Posting language: franc-min (ISO 639-3 → 639-1) on a cleaned sample, restricted to the
 *    languages RADAR sees; a stop-word check separates languages franc-min lacks or confuses
 *    (Danish / Norwegian / Swedish, Czech / Slovak, Finnish, Baltic languages, Slovenian …).
 *    CJK, Hangul, Greek and Hebrew are decided by script.
 * 2. Requirement: every language name in the text (in ~30 posting languages) is classified by
 *    the wording around it — required ("fluent German", "Deutsch C1", "maîtrise du français"),
 *    nice to have ("German is a plus", "von Vorteil"), basic only, not required ("no German
 *    needed", "Deutschkenntnisse nicht erforderlich"), English working language ("our working
 *    language is English"), or language courses offered — plus the section it sits in
 *    ("Requirements" / "Nice to have"). Nationality uses ("German citizenship") are ignored.
 * 3. Decision: a non-English language required at working level → local_required; otherwise an
 *    explicit English statement → english_ok (high); English asked for, or the local language only
 *    a plus → english_ok (medium); no statement → decided by posting language, low confidence
 *    for a local-language posting ("unclear").
 *
 * The evidence is a verbatim quote (whitespace collapsed) of the deciding sentence.
 */
import { francAll } from 'franc-min';
import { countryInfo } from '../../data/places/countries';
import type { LanguageValue } from '../contracts/jobs';
import { lowerConfidence, type Confidence, type Fact } from '../contracts/provenance';
import {
  BASIC_CUES,
  NOT_LANGUAGE_AFTER,
  NOT_REQUIRED_CUES,
  ONLY_CUES,
  OTHER_HEADINGS,
  PREFERRED_CUES,
  PREFERRED_HEADINGS,
  PRE_NEGATION_WORDS,
  REQUIRED_CUES,
  REQUIRED_HEADINGS,
  REQUIRED_WEAK_CUES,
  STOPWORDS,
  SUPPORT_CUES,
  WORKING_CUES,
  WORKING_PRE_RE_SOURCES,
  type CueClass,
} from './language-cues';
import { LANGUAGE_LABELS, LANGUAGE_NAMES } from './language-names';
import { collapseWhitespace, fold, foldWithMap, quoteAround } from './text';

export const LANGUAGE_LOGIC_VERSION = 'language@2026-09-30.1';

const MAX_TEXT = 60_000;
const SAMPLE_CHARS = 4_000;
/** Below this many letters the posting language is not guessed (franc is unreliable on short text). */
export const MIN_LETTERS_FOR_DETECTION = 40;
const MIN_LETTERS_CJK = 12;
const WINDOW = 80;
const WEAK_CUE_MAX_DISTANCE = 28;

// ---------------------------------------------------------------------------------------------
// Pattern compilation

const CJK_CHAR_RE = /[぀-ヿ㐀-鿿가-힯豈-﫿]/u;

/** Folded regex body for one form (see the syntax note in language-names.ts). */
function formBody(form: string): string {
  return fold(form.replace(/^\^/, ''))
    .replace(/[.+[\]{}\\$^]/g, '\\$&')
    .replace(/\*/g, '\\p{L}*')
    .replace(/-/g, '[\\s\\-]?')
    .replace(/ +/g, '[\\s\\-]+');
}

function uniqueByLength(forms: readonly string[]): string[] {
  return [...new Set(forms)].sort((a, b) => b.length - a.length);
}

/**
 * One alternation for a list of forms. Word boundaries are applied once around the Latin/Cyrillic
 * group (per-alternative lookbehinds make V8 ~100x slower); CJK forms match anywhere.
 */
function alternation(forms: readonly string[]): string {
  const sorted = uniqueByLength(forms);
  const worded = sorted.filter((f) => !CJK_CHAR_RE.test(f)).map(formBody);
  const cjk = sorted.filter((f) => CJK_CHAR_RE.test(f)).map(formBody);
  const parts: string[] = [];
  if (worded.length) parts.push(`(?<![\\p{L}\\p{N}])(?:${worded.join('|')})(?![\\p{L}\\p{N}])`);
  if (cjk.length) parts.push(`(?:${cjk.join('|')})`);
  return parts.join('|');
}

interface CompiledName {
  code: string;
  exact: RegExp;
}

const NAME_FORMS: { code: string; form: string }[] = Object.entries(LANGUAGE_NAMES).flatMap(([code, forms]) =>
  forms.map((form) => ({ code, form })),
);
const NAME_RE = new RegExp(alternation(NAME_FORMS.map((f) => f.form)), 'gu');
const NAME_CODES: CompiledName[] = Object.entries(LANGUAGE_NAMES).map(([code, forms]) => ({
  code,
  exact: new RegExp(`^(?:${uniqueByLength(forms).map(formBody).join('|')})$`, 'u'),
}));
/** Folded forms that only count with a capital letter in the original ("Polish" vs "polish"). */
const CAPITALISED_ONLY = new Set(NAME_FORMS.filter((f) => f.form.startsWith('^')).map((f) => fold(f.form.slice(1))));

const CUE_LISTS: [CueClass, readonly string[]][] = [
  ['not_required', NOT_REQUIRED_CUES],
  ['support', SUPPORT_CUES],
  ['preferred', PREFERRED_CUES],
  ['basic', BASIC_CUES],
  ['only', ONLY_CUES],
  ['working', WORKING_CUES],
  ['required', REQUIRED_CUES],
  ['required_weak', REQUIRED_WEAK_CUES],
];
const CUE_RES: [CueClass, RegExp][] = CUE_LISTS.map(([cls, list]) => [cls, new RegExp(alternation(list), 'gu')]);

/** Priority when several cues describe one language: the least demanding reading wins. */
const CUE_PRIORITY: readonly CueClass[] = ['not_required', 'support', 'preferred', 'basic', 'only', 'working', 'required', 'required_weak'];

const CEFR_RE = /(?<![\p{L}\p{N}])(?:(?:niveau|level|nivel|livello|poziom\p{L}*|uroven|szint|taso)[\s\-:]*)?([abc])\s?([12])(?:\s?\+)?(?:\s*[-/]\s*[abc]?[12]\+?)?(?:[\s\-]*(?:niveau|level|nivel|livello))?(?![\p{L}\p{N}])/gu;

const WORKING_PRE_RES: RegExp[] = WORKING_PRE_RE_SOURCES.map((s) => new RegExp(s, 'u'));

const PRE_NEGATION_FILLER =
  'any|prior|previous|knowledge|of|in|the|need|to|speak|know|kenntnisse|vorkenntnisse|sprachkenntnisse|besoin|de|parler|la|langue|' +
  'necesidad|hablar|el|idioma|bisogno|parlare|conoscenza|della|lingua|kennis|van|het|kunskaper|i|kendskab|til|kunnskap|om|' +
  'znajomosci|jezyka|znalosti|jazyka|nyelvtudas|cunostinte|limba|conhecimento|do|poznavanja|znanja|jezika';
const PRE_NEGATION_RE = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${uniqueByLength(PRE_NEGATION_WORDS).map(formBody).join('|')})(?:[\\s\\-]+(?:${PRE_NEGATION_FILLER})){0,3}[\\s\\-]*$`,
  'u',
);

const NOT_LANGUAGE_AFTER_RE = new RegExp(`^[\\s\\-]*(?:${uniqueByLength(NOT_LANGUAGE_AFTER).map(formBody).join('|')})(?![\\p{L}\\p{N}])`, 'u');

/** "-sprachig", "-talig", "anglophone": the name itself means "speaking that language". */
const SPEAKING_FORM_RE = /(?:sprachig|talig|sprakig|sproget|spraklig|kielinen|kielise|jezyczn|anglophon|francophon|francofon)/u;
const ENVIRONMENT_AFTER_RE = new RegExp(
  `^[\\s\\-]*(?:\\p{L}+\\s+)?(?:${[
    'team*', 'umfeld', 'arbeitsumfeld', 'arbeitsumgebung', 'umgebung', 'unternehmen', 'firma', 'omgeving', 'werkomgeving', 'bedrijf',
    'organisatie', 'miljø', 'miljö', 'arbetsmiljö', 'ympäristö*', 'työympäristö*', 'środowisk*', 'prostřed*', 'prostred*',
    'environnement', 'équipe', 'entorno', 'ambiente', 'environment', 'company', 'office', 'workplace', 'kollegium', 'tiimi*',
  ].map(formBody).join('|')})(?![\\p{L}\\p{N}])`,
  'u',
);

/** "send your CV in English", "Bewerbung auf Deutsch": the language of the application, not of the job. */
const APPLICATION_PRE_RE =
  /(?:cv|cvs|resume|resumes|lebenslauf|bewerbung\p{L}*|unterlagen|application\p{L}*|anschreiben|cover letter|motivation letter|lettre de motivation|candidature|curriculum|sollicitatie\p{L}*|ansokan|ansogning|soknad|zgloszeni\p{L}*|zivotopis|hakemus\p{L}*)(?:[\s,]+\p{L}+){0,4}[\s,]+(?:in|auf|en|em|op|pa|w|po|na|su|v|ve)(?:\s+(?:the|het|el|o|la|lingua|idioma|langue))?\s*$/u;

/** Name forms that carry their own cue: "Deutschkenntnisse", "Deutschkurs", "deutschsprachig". */
const FORM_IMPLIED: [RegExp, CueClass][] = [
  [/(?:kurs|kurz|cours|course|lesson|unterricht|lessen|cursus)/u, 'support'],
  [/(?:kenntnis|kunskap|kundskab|kunnskap|faerdighed|kielitaito|tudas|niveau)/u, 'required_weak'],
  [SPEAKING_FORM_RE, 'required'],
];

/** "English is a must, Dutch is not": an elliptic negation closing the clause. */
const ELLIPTIC_NOT_RE = /^[\s\-]*(?:is|are|ist|sind|est|es|e|è|is|er|ar|är|jest|je|nem)\s+(?:not|nicht|pas|no|non|niet|inte|ikke|nie|ne)\s*[.!]?\s*$/u;

const CONNECTOR_WORDS =
  'and|und|et|y|e|en|och|og|i|a|ja|es|si|ve|и|і|και|as well as|sowie|plus|or|oder|ou|o|of|eller|lub|albo|nebo|alebo|tai|vagy|sau|veya|или|або|ή|ili|ali';
const CONNECTOR_GAP_RE = new RegExp(`^(?:[\\s\\-,/&+]|(?<![\\p{L}])(?:${CONNECTOR_WORDS})(?![\\p{L}]))*$`, 'u');
const OR_WORD_RE = /(?<![\p{L}])(?:or|oder|ou|o|of|eller|lub|albo|nebo|alebo|tai|vagy|sau|veya|или|або|ή|ili|ali)(?![\p{L}])/u;
const AND_OR_RE = /(?<![\p{L}])(?:and|und|et|y|e|en)\s*\/\s*(?:or|oder|ou|o|of)(?![\p{L}])/u;
const GAP_SPLIT_RE =
  /[,;:()[\]]|\s(?:and|but|und|aber|sowie|et|mais|y|pero|e|ma|en|maar|och|men|og|i|ale|a|ja|mutta|es|de|si|dar|ve|ama|и|но|і|але|while|whereas|während)\s/gu;
const CLAUSE_CUT_RE = /[,;]|\s(?:but|aber|mais|pero|ma|maar|men|mutta|ale|dar|ama|но|але|while|whereas|während)\s/gu;

const SEGMENT_RE = /[\n\r.!?;•·▪●|。！？；]+/gu;
const BULLET_PREFIX_RE = /^[\s\-*•·▪●–—>\d.)(]+/u;

function headingRe(list: readonly string[]): { own: RegExp; inline: RegExp } {
  const alts = uniqueByLength(list).map(formBody).join('|');
  return { own: new RegExp(`^(?:${alts})\\s*:?\\s*$`, 'u'), inline: new RegExp(`^(?:${alts})\\s*:\\s*\\S`, 'u') };
}
const HEADINGS: [SectionMode, { own: RegExp; inline: RegExp }][] = [
  ['preferred', headingRe(PREFERRED_HEADINGS)],
  ['required', headingRe(REQUIRED_HEADINGS)],
  ['other', headingRe(OTHER_HEADINGS)],
];

// ---------------------------------------------------------------------------------------------
// Posting language

const FRANC_TO_ISO1: Readonly<Record<string, string>> = {
  eng: 'en', deu: 'de', fra: 'fr', nld: 'nl', spa: 'es', ita: 'it', por: 'pt', pol: 'pl', swe: 'sv', ces: 'cs', hun: 'hu', ron: 'ro',
  hrv: 'hr', bos: 'bs', srp: 'sr', tur: 'tr', ind: 'id', zlm: 'ms', vie: 'vi', tgl: 'tl', swh: 'sw',
  rus: 'ru', ukr: 'uk', bul: 'bg', bel: 'be', kaz: 'kk', arb: 'ar', urd: 'ur', pes: 'fa', hin: 'hi', mar: 'mr', npi: 'ne',
  ben: 'bn', tam: 'ta', tha: 'th', ell: 'el', cmn: 'zh', jpn: 'ja', kor: 'ko',
};
const LATIN_FRANC = ['eng', 'deu', 'fra', 'nld', 'spa', 'ita', 'por', 'pol', 'swe', 'ces', 'hun', 'ron', 'hrv', 'bos', 'srp', 'tur', 'ind', 'zlm', 'vie', 'tgl', 'swh'];
const CYRILLIC_FRANC = ['rus', 'ukr', 'bul', 'bel', 'kaz', 'srp'];
const ARABIC_FRANC = ['arb', 'urd', 'pes'];
const DEVANAGARI_FRANC = ['hin', 'mar', 'npi'];

/** Languages franc-min confuses with each other; the stop-word check picks within the family. */
const FAMILIES: Readonly<Record<string, readonly string[]>> = {
  sv: ['sv', 'da', 'no'],
  cs: ['cs', 'sk'],
  hr: ['hr', 'sl', 'bs', 'sr'],
  bs: ['hr', 'sl', 'bs', 'sr'],
  sr: ['hr', 'sl', 'bs', 'sr'],
};
/** Latin-script languages franc-min does not know at all. */
const STOPWORD_ONLY = ['fi', 'et', 'lv', 'lt', 'is', 'mt', 'ca', 'sk', 'sl', 'da', 'no'];

const STOPWORD_SETS: ReadonlyMap<string, ReadonlySet<string>> = new Map(Object.entries(STOPWORDS).map(([k, v]) => [k, new Set(v)]));

export interface PostingLanguage {
  /** ISO 639-1, or null when the text is too short / not recognised. */
  lang: string | null;
  confidence: Confidence;
  method: 'script' | 'franc' | 'stopwords' | 'none';
}

type Script = 'latin' | 'cyrillic' | 'greek' | 'arabic' | 'hebrew' | 'han' | 'kana' | 'hangul' | 'devanagari' | 'thai' | 'other';

function scriptOf(ch: string): Script {
  if (/\p{Script=Latin}/u.test(ch)) return 'latin';
  if (/\p{Script=Cyrillic}/u.test(ch)) return 'cyrillic';
  if (/\p{Script=Greek}/u.test(ch)) return 'greek';
  if (/\p{Script=Arabic}/u.test(ch)) return 'arabic';
  if (/\p{Script=Hebrew}/u.test(ch)) return 'hebrew';
  if (/[\p{Script=Hiragana}\p{Script=Katakana}]/u.test(ch)) return 'kana';
  if (/\p{Script=Han}/u.test(ch)) return 'han';
  if (/\p{Script=Hangul}/u.test(ch)) return 'hangul';
  if (/\p{Script=Devanagari}/u.test(ch)) return 'devanagari';
  if (/\p{Script=Thai}/u.test(ch)) return 'thai';
  return 'other';
}

/** Text prepared for detection: no URLs, e-mails or code-like tokens, whitespace collapsed. */
function detectionSample(text: string): string {
  return text
    .slice(0, SAMPLE_CHARS * 5)
    .replace(/https?:\/\/\S+|www\.\S+/gi, ' ')
    .replace(/\S+@\S+\.\S+/g, ' ')
    .replace(/\b[\w-]*[_/\\][\w/\\.-]*\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SAMPLE_CHARS);
}

function stopwordRatios(sample: string): Map<string, number> {
  const tokens = sample.toLowerCase().match(/\p{L}+/gu) ?? [];
  const out = new Map<string, number>();
  if (!tokens.length) return out;
  for (const [lang, set] of STOPWORD_SETS) {
    let hits = 0;
    for (const t of tokens) if (set.has(t)) hits++;
    out.set(lang, hits / tokens.length);
  }
  return out;
}

function francTop(sample: string, only: string[]): { lang: string | null; margin: number } {
  const ranked = francAll(sample, { only, minLength: 10 });
  const [first, second] = ranked;
  if (!first || first[0] === 'und') return { lang: null, margin: 0 };
  return { lang: FRANC_TO_ISO1[first[0]] ?? null, margin: second ? first[1] - second[1] : 1 };
}

/** Detects the posting language (ISO 639-1). */
export function detectPostingLanguage(text: string): PostingLanguage {
  const sample = detectionSample(String(text ?? ''));
  const counts: Record<Script, number> = { latin: 0, cyrillic: 0, greek: 0, arabic: 0, hebrew: 0, han: 0, kana: 0, hangul: 0, devanagari: 0, thai: 0, other: 0 };
  for (const ch of sample) if (/\p{L}/u.test(ch)) counts[scriptOf(ch)]++;
  const letters = Object.values(counts).reduce((a, b) => a + b, 0);
  const cjk = counts.han + counts.kana + counts.hangul;
  // One CJK character carries roughly a word; weight it so English tech terms do not outvote it.
  const weighted: [Script | 'cjk', number][] = (Object.entries(counts) as [Script, number][]).filter(
    ([s]) => s !== 'han' && s !== 'kana' && s !== 'hangul',
  );
  weighted.push(['cjk', cjk * 3]);
  weighted.sort((a, b) => b[1] - a[1]);
  const top = weighted[0]?.[1] ? weighted[0][0] : null;
  const none: PostingLanguage = { lang: null, confidence: 'low', method: 'none' };
  if (!top) return none;

  if (top === 'cjk') {
    if (cjk < MIN_LETTERS_CJK) return none;
    const confidence: Confidence = cjk >= 40 ? 'high' : 'medium';
    if (counts.hangul > counts.kana && counts.hangul >= counts.han) return { lang: 'ko', confidence, method: 'script' };
    if (counts.kana >= Math.max(3, cjk * 0.05)) return { lang: 'ja', confidence, method: 'script' };
    return { lang: 'zh', confidence, method: 'script' };
  }
  if (letters < MIN_LETTERS_FOR_DETECTION) return none;
  const lengthConfidence = (c: Confidence): Confidence => (letters < 200 ? lowerConfidence(c) : c);
  if (top === 'greek') return { lang: 'el', confidence: lengthConfidence('high'), method: 'script' };
  if (top === 'hebrew') return { lang: 'he', confidence: lengthConfidence('high'), method: 'script' };
  if (top === 'thai') return { lang: 'th', confidence: lengthConfidence('high'), method: 'script' };
  if (top === 'other') return none;

  const only = top === 'cyrillic' ? CYRILLIC_FRANC : top === 'arabic' ? ARABIC_FRANC : top === 'devanagari' ? DEVANAGARI_FRANC : LATIN_FRANC;
  const f = francTop(sample, only);
  let lang = f.lang;
  let method: PostingLanguage['method'] = 'franc';
  let confidence: Confidence = f.margin >= 0.08 ? 'high' : f.margin >= 0.03 ? 'medium' : 'low';

  if (top === 'latin') {
    const ratios = stopwordRatios(sample);
    const own = lang ? (ratios.get(lang) ?? 0) : 0;
    const family = lang ? FAMILIES[lang] : undefined;
    if (lang && family) {
      const best = [...family].sort((a, b) => (ratios.get(b) ?? 0) - (ratios.get(a) ?? 0))[0];
      if (best !== lang && (ratios.get(best) ?? 0) > own + 0.02) {
        lang = best;
        method = 'stopwords';
        confidence = (ratios.get(best) ?? 0) >= 0.2 ? 'high' : 'medium';
      }
    }
    if (method === 'franc') {
      let bestMissing: string | null = null;
      let bestRatio = 0;
      for (const l of STOPWORD_ONLY) {
        const r = ratios.get(l) ?? 0;
        if (l !== lang && r >= 0.12 && r >= own * 1.4 + 0.03 && r > bestRatio) {
          bestMissing = l;
          bestRatio = r;
        }
      }
      if (bestMissing) {
        lang = bestMissing;
        method = 'stopwords';
        confidence = bestRatio >= 0.2 ? 'high' : 'medium';
      }
    }
  }
  if (!lang) return none;
  return { lang, confidence: lengthConfidence(confidence), method };
}

// ---------------------------------------------------------------------------------------------
// Requirement mentions

type SectionMode = 'required' | 'preferred' | 'other';

export type MentionClass = CueClass | 'section_required' | 'section_preferred' | 'mentioned';

export interface LanguageMention {
  /** ISO 639-1. */
  lang: string;
  cls: MentionClass;
  /** Other languages offered as alternatives in the same phrase ("English or German"). */
  alternatives: string[];
  /** Verbatim quote around the mention and its cue. */
  quote: string;
  /** Offsets in the original text (mention + deciding cue). */
  start: number;
  end: number;
}

interface NameHit {
  code: string;
  start: number;
  end: number;
  form: string;
}

interface CueHit {
  cls: CueClass;
  start: number;
  end: number;
}

interface Segment {
  start: number;
  end: number;
  mode: SectionMode | null;
  /** Folded offset of the heading that set `mode` (quoted with section-based evidence). */
  headingStart: number | null;
}

function segmentsOf(folded: string): Segment[] {
  const out: Segment[] = [];
  let last = 0;
  let mode: SectionMode | null = null;
  let modeHeading: number | null = null;
  const push = (start: number, end: number) => {
    const raw = folded.slice(start, end);
    const head = raw.replace(BULLET_PREFIX_RE, '').trim();
    if (!head) return;
    let segMode = mode;
    let segHeading = modeHeading;
    for (const [m, re] of HEADINGS) {
      if (head.length <= 60 && re.own.test(head)) {
        mode = m === 'other' ? null : m;
        modeHeading = mode ? start : null;
        segMode = mode;
        segHeading = modeHeading;
        break;
      }
      if (re.inline.test(head)) {
        segMode = m === 'other' ? null : m;
        segHeading = segMode ? start : null;
        break;
      }
    }
    out.push({ start, end, mode: segMode, headingStart: segHeading });
  };
  for (const m of folded.matchAll(SEGMENT_RE)) {
    push(last, m.index);
    last = m.index + m[0].length;
  }
  push(last, folded.length);
  return out;
}

function findNames(folded: string, original: string, map: number[]): NameHit[] {
  const out: NameHit[] = [];
  NAME_RE.lastIndex = 0;
  for (const m of folded.matchAll(NAME_RE)) {
    const form = m[0];
    const start = m.index;
    const end = start + form.length;
    if (CAPITALISED_ONLY.has(form)) {
      const first = original[map[start]] ?? '';
      if (first === first.toLowerCase()) continue;
    }
    if (NOT_LANGUAGE_AFTER_RE.test(folded.slice(end, end + 40))) continue;
    if (APPLICATION_PRE_RE.test(folded.slice(Math.max(0, start - 60), start))) continue;
    const code = NAME_CODES.find((c) => c.exact.test(form))?.code;
    if (code) out.push({ code, start, end, form });
  }
  return out;
}

function findCues(window: string, base: number): CueHit[] {
  const hits: CueHit[] = [];
  for (const [cls, re] of CUE_RES) {
    re.lastIndex = 0;
    for (const m of window.matchAll(re)) if (m[0].length) hits.push({ cls, start: base + m.index, end: base + m.index + m[0].length });
  }
  CEFR_RE.lastIndex = 0;
  for (const m of window.matchAll(CEFR_RE)) {
    const level = `${m[1]}${m[2]}`;
    const cls: CueClass = level === 'a1' || level === 'a2' ? 'basic' : level === 'b1' ? 'required_weak' : 'required';
    hits.push({ cls, start: base + m.index, end: base + m.index + m[0].length });
  }
  // Longest match wins where cues overlap ("not required" over "required").
  hits.sort((a, b) => b.end - b.start - (a.end - a.start) || CUE_PRIORITY.indexOf(a.cls) - CUE_PRIORITY.indexOf(b.cls));
  const kept: CueHit[] = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  return kept;
}

function strongest(hits: CueHit[]): CueHit | null {
  let best: CueHit | null = null;
  for (const h of hits) if (!best || CUE_PRIORITY.indexOf(h.cls) < CUE_PRIORITY.indexOf(best.cls)) best = h;
  return best;
}

function lastMatchEnd(re: RegExp, s: string): number {
  let end = -1;
  re.lastIndex = 0;
  for (const m of s.matchAll(re)) end = m.index + m[0].length;
  return end;
}

function firstMatchStart(re: RegExp, s: string): number {
  re.lastIndex = 0;
  const m = re.exec(s);
  re.lastIndex = 0;
  return m ? m.index : -1;
}

interface Group {
  hits: NameHit[];
  start: number;
  end: number;
  alternatives: boolean;
  segment: Segment;
}

/** Joins "English, German and French" / "Deutsch- und Englischkenntnisse" into one group. */
function groupNames(hits: NameHit[], folded: string, segments: Segment[]): Group[] {
  const groups: Group[] = [];
  let si = 0;
  for (const h of hits) {
    while (si < segments.length - 1 && segments[si].end <= h.start) si++;
    const seg = segments[si];
    const prev = groups[groups.length - 1];
    if (prev && prev.segment === seg) {
      const gap = folded.slice(prev.end, h.start);
      if (gap.length <= 24 && CONNECTOR_GAP_RE.test(gap)) {
        if (!prev.hits.some((p) => p.code === h.code)) prev.hits.push(h);
        prev.end = h.end;
        if (OR_WORD_RE.test(gap) && !AND_OR_RE.test(gap)) prev.alternatives = true;
        continue;
      }
    }
    groups.push({ hits: [h], start: h.start, end: h.end, alternatives: false, segment: seg });
  }
  return groups;
}

interface Classified {
  code: string;
  cls: MentionClass;
  cue: CueHit | null;
  group: Group;
}

function classifyGroups(groups: Group[], folded: string): Classified[] {
  const out: Classified[] = [];
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    const prev = groups[gi - 1];
    const next = groups[gi + 1];
    let preStart = Math.max(g.segment.start, g.start - WINDOW);
    if (prev && prev.segment === g.segment) {
      const gap = folded.slice(prev.end, g.start);
      const cut = lastMatchEnd(GAP_SPLIT_RE, gap);
      preStart = Math.max(preStart, cut === -1 ? prev.end : prev.end + cut);
    }
    let postEnd = Math.min(g.segment.end, g.end + WINDOW);
    if (next && next.segment === g.segment) {
      const gap = folded.slice(g.end, next.start);
      GAP_SPLIT_RE.lastIndex = 0;
      let lastSplit = -1;
      for (const m of gap.matchAll(GAP_SPLIT_RE)) lastSplit = m.index;
      postEnd = Math.min(postEnd, lastSplit === -1 ? next.start : g.end + lastSplit);
    }
    let pre = folded.slice(preStart, g.start);
    const preCut = lastMatchEnd(CLAUSE_CUT_RE, pre);
    if (preCut !== -1) {
      preStart += preCut;
      pre = folded.slice(preStart, g.start);
    }
    let post = folded.slice(g.end, postEnd);
    const postCut = firstMatchStart(CLAUSE_CUT_RE, post);
    if (postCut !== -1) {
      postEnd = g.end + postCut;
      post = folded.slice(g.end, postEnd);
    }

    const preHits = findCues(pre, preStart).filter((h) => h.cls !== 'required_weak' || g.start - h.end <= WEAK_CUE_MAX_DISTANCE);
    const postHits = findCues(post, g.end).filter((h) => h.cls !== 'required_weak' || h.start - g.end <= WEAK_CUE_MAX_DISTANCE);
    if (PRE_NEGATION_RE.test(pre)) {
      const m = PRE_NEGATION_RE.exec(pre);
      if (m) preHits.push({ cls: 'not_required', start: preStart + m.index, end: g.start });
    }
    if (ELLIPTIC_NOT_RE.test(post)) postHits.push({ cls: 'not_required', start: g.end, end: postEnd });
    if (WORKING_PRE_RES.some((re) => re.test(pre))) preHits.push({ cls: 'working', start: preStart, end: g.start });
    const lastHit = g.hits[g.hits.length - 1];
    const speakingEnvironment = SPEAKING_FORM_RE.test(lastHit.form) && ENVIRONMENT_AFTER_RE.test(post);
    if (speakingEnvironment) postHits.push({ cls: 'working', start: g.end, end: postEnd });
    const impliedOf = (h: NameHit): CueHit | null => {
      const cls = FORM_IMPLIED.find(([re]) => re.test(h.form))?.[1];
      return cls ? { cls, start: h.start, end: h.end } : null;
    };
    const lastImplied = speakingEnvironment ? null : impliedOf(lastHit);

    const preCue = strongest(preHits);
    const postCue = strongest(postHits);
    const demanding = (c: CueHit | null) => !!c && (c.cls === 'required' || c.cls === 'required_weak' || c.cls === 'only' || c.cls === 'working');
    const lenient = (c: CueHit | null) => !!c && (c.cls === 'preferred' || c.cls === 'basic' || c.cls === 'not_required' || c.cls === 'support');
    const sectionCls: MentionClass =
      g.segment.mode === 'required' ? 'section_required' : g.segment.mode === 'preferred' ? 'section_preferred' : 'mentioned';

    g.hits.forEach((h, i) => {
      let cue: CueHit | null;
      if (g.hits.length > 1 && !g.alternatives && demanding(preCue) && lenient(postCue)) {
        // "Fluent English and German is a plus": the trailing cue belongs to the last language.
        cue = i === g.hits.length - 1 ? postCue : preCue;
      } else {
        cue = strongest([preCue, postCue].filter((c): c is CueHit => !!c));
      }
      // A cue inside the word itself only counts when nothing around it says otherwise.
      if (!cue && !speakingEnvironment) cue = impliedOf(h) ?? lastImplied;
      out.push({ code: h.code, cls: cue ? cue.cls : sectionCls, cue, group: g });
    });
  }
  return out;
}

/** All language mentions with their requirement class (exported for tests and the job page). */
export function findLanguageMentions(text: string): LanguageMention[] {
  const original = String(text ?? '').slice(0, MAX_TEXT);
  const { folded, map } = foldWithMap(original);
  const segments = segmentsOf(folded);
  const names = findNames(folded, original, map);
  if (!names.length) return [];
  const classified = classifyGroups(groupNames(names, folded, segments), folded);
  return classified.map((c) => {
    let fs = Math.min(c.group.start, c.cue?.start ?? c.group.start);
    const fe = Math.max(c.group.end, c.cue?.end ?? c.group.end);
    const heading = c.group.segment.headingStart;
    // Section-based evidence quotes the heading too ("Requirements: - German").
    if ((c.cls === 'section_required' || c.cls === 'section_preferred') && heading !== null && fe - heading <= 150) fs = Math.min(fs, heading);
    const start = map[fs] ?? 0;
    const end = fe > 0 ? (map[fe - 1] ?? original.length - 1) + 1 : 0;
    return {
      lang: c.code,
      cls: c.cls,
      alternatives: c.group.alternatives ? c.group.hits.map((h) => h.code).filter((x) => x !== c.code) : [],
      quote: quoteSpan(original, start, end),
      start,
      end,
    };
  });
}

const MIN_QUOTE_CHARS = 12;

/** `quoteAround`, widened to neighbouring words when the sentence is too short to verify ("German"). */
function quoteSpan(original: string, start: number, end: number): string {
  const q = quoteAround(original, start, end, 160);
  if (q.length >= MIN_QUOTE_CHARS) return q;
  let a = Math.max(0, start - 40);
  let b = Math.min(original.length, end + 40);
  if (a > 0) {
    const sp = original.slice(a, start).search(/\s/);
    if (sp !== -1) a += sp;
  }
  if (b < original.length) {
    const tail = original.slice(end, b);
    const m = /\s\S*$/.exec(tail);
    if (m) b = end + m.index;
  }
  const wide = collapseWhitespace(original.slice(a, b));
  return wide.length > q.length ? wide : q;
}

// ---------------------------------------------------------------------------------------------
// Decision

export interface LanguageDetails extends LanguageValue {
  /** Non-English languages required at working level. */
  required: string[];
  /** Languages that are a plus / basic level only. */
  preferred: string[];
  /** Languages the posting says are not needed. */
  notRequired: string[];
  /** The posting states English is the working language / English only. */
  englishWorking: boolean;
  /** What the decision rests on. */
  basis: 'statement' | 'posting_language' | 'none';
  note: string | null;
}

export interface DetectLanguageOptions {
  /** Job country; an English posting in an English-speaking country is English OK with high confidence. */
  countryIso2?: string | null;
  now?: Date;
}

const REQUIRED_CLASSES: ReadonlySet<MentionClass> = new Set(['required', 'only', 'working']);
const WEAK_REQUIRED_CLASSES: ReadonlySet<MentionClass> = new Set(['required_weak', 'section_required']);
const PREFERRED_CLASSES: ReadonlySet<MentionClass> = new Set(['preferred', 'basic', 'section_preferred']);

function label(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

function listLabels(codes: string[]): string {
  return codes.map(label).join(', ');
}

function fact(value: LanguageDetails, evidence: string | null, confidence: Confidence, now: Date): Fact<LanguageDetails> {
  return { value, evidence, source: 'posting text', method: 'rule', confidence, checkedAt: now, logicVersion: LANGUAGE_LOGIC_VERSION };
}

function unique(codes: string[]): string[] {
  return [...new Set(codes)];
}

/**
 * Posting language and language requirement of a posting. `requirement` is 'local_required' when
 * a language other than English is required at working level, 'english_ok' when English is
 * enough (explicitly, or implied by an English posting), 'unclear' otherwise.
 */
export function detectLanguage(text: string, opts: DetectLanguageOptions = {}): Fact<LanguageDetails> {
  const now = opts.now ?? new Date();
  const body = String(text ?? '').slice(0, MAX_TEXT);
  const posting = detectPostingLanguage(body);
  const mentions = findLanguageMentions(body);
  const country = countryInfo(opts.countryIso2 ?? null);
  const englishCountry = country?.languages[0] === 'en';
  const englishAmongCountry = !country || country.languages.includes('en');

  const enRequired: LanguageMention[] = [];
  const enWorking: LanguageMention[] = [];
  const strongLocal: LanguageMention[] = [];
  const weakLocal: LanguageMention[] = [];
  const preferred: LanguageMention[] = [];
  const notRequired: LanguageMention[] = [];
  const support: LanguageMention[] = [];

  for (const m of mentions) {
    const englishAlternative = m.alternatives.includes('en');
    if (m.lang === 'en') {
      if (m.cls === 'only' || m.cls === 'working') enWorking.push(m);
      else if (REQUIRED_CLASSES.has(m.cls) || WEAK_REQUIRED_CLASSES.has(m.cls)) enRequired.push(m);
      continue;
    }
    if (m.cls === 'not_required') notRequired.push(m);
    else if (m.cls === 'support') support.push(m);
    else if (PREFERRED_CLASSES.has(m.cls)) preferred.push(m);
    else if (REQUIRED_CLASSES.has(m.cls)) (englishAlternative ? enRequired : strongLocal).push(m);
    else if (WEAK_REQUIRED_CLASSES.has(m.cls)) (englishAlternative ? enRequired : weakLocal).push(m);
  }

  const negated = new Set(notRequired.map((m) => m.lang));
  // A mention that only counts as required because it sits under a requirements heading
  // ("the Danish Fast-track scheme") yields to an explicit "Danish is not required".
  const contradictory = unique(
    [...strongLocal, ...weakLocal.filter((m) => m.cls !== 'section_required')].map((m) => m.lang).filter((l) => negated.has(l)),
  );
  const reqStrong = strongLocal.filter((m) => !negated.has(m.lang));
  const reqWeak = weakLocal.filter((m) => !negated.has(m.lang));
  const requiredCodes = unique([...reqStrong, ...reqWeak].map((m) => m.lang));
  const preferredCodes = unique(preferred.map((m) => m.lang)).filter((l) => !requiredCodes.includes(l));
  const notRequiredCodes = unique(notRequired.map((m) => m.lang)).filter((l) => !contradictory.includes(l));
  const englishWorking = enWorking.length > 0;
  const englishAsked = enRequired.length > 0 || englishWorking;
  const languages = unique([...requiredCodes, ...(englishAsked ? ['en'] : []), ...preferredCodes]);
  const postingLang = posting.lang;

  const value = (requirement: LanguageValue['requirement'], basis: LanguageDetails['basis'], note: string | null): LanguageDetails => ({
    postingLang,
    requirement,
    languages,
    required: requiredCodes,
    preferred: preferredCodes,
    notRequired: notRequiredCodes,
    englishWorking,
    basis,
    note,
  });

  if (requiredCodes.length) {
    let confidence: Confidence = reqStrong.length ? 'high' : 'medium';
    const englishSignals = englishWorking || notRequiredCodes.length > 0;
    if (englishSignals) confidence = lowerConfidence(confidence);
    const deciding = reqStrong[0] ?? reqWeak[0];
    const note = `${listLabels(requiredCodes)} required${englishSignals ? '; the posting also says English works, check the details' : ''}.`;
    return fact(value('local_required', 'statement', note), deciding.quote, confidence, now);
  }
  if (contradictory.length) {
    const deciding = notRequired.find((m) => contradictory.includes(m.lang)) ?? notRequired[0];
    return fact(value('unclear', 'statement', `The posting both requires and waives ${listLabels(contradictory)}.`), deciding.quote, 'low', now);
  }
  if (englishWorking || notRequiredCodes.length) {
    const deciding = notRequired[0] ?? enWorking[0];
    const note = notRequiredCodes.length ? `${listLabels(notRequiredCodes)} not required.` : 'English is the working language.';
    return fact(value('english_ok', 'statement', note), deciding.quote, 'high', now);
  }
  if (enRequired.length) {
    const englishAlternative = enRequired.some((m) => m.alternatives.length > 0);
    if (postingLang && postingLang !== 'en' && !preferredCodes.length && !englishAlternative) {
      // A German-language posting asking only for English usually expects German too.
      const note = `Posting is written in ${label(postingLang)} and asks for English; ${label(postingLang)} is probably expected.`;
      return fact(value('unclear', 'statement', note), enRequired[0].quote, 'low', now);
    }
    const confidence: Confidence = englishCountry ? 'high' : 'medium';
    const note = preferredCodes.length ? `English required; ${listLabels(preferredCodes)} a plus.` : 'English required; no other language asked for.';
    return fact(value('english_ok', 'statement', note), enRequired[0].quote, confidence, now);
  }
  if (preferredCodes.length) {
    const confidence: Confidence = postingLang && postingLang !== 'en' ? 'low' : 'medium';
    return fact(value('english_ok', 'statement', `${listLabels(preferredCodes)} a plus, not required.`), preferred[0].quote, confidence, now);
  }
  if (support.length && (!postingLang || postingLang === 'en')) {
    return fact(value('english_ok', 'statement', `${label(support[0].lang)} courses or learning support offered.`), support[0].quote, 'low', now);
  }
  if (postingLang === 'en') {
    const confidence: Confidence = englishCountry ? 'high' : englishAmongCountry ? 'medium' : 'low';
    const base: Confidence = posting.confidence === 'low' ? lowerConfidence(confidence) : confidence;
    return fact(value('english_ok', 'posting_language', 'Posting is written in English; no language requirement stated.'), null, base, now);
  }
  if (postingLang) {
    return fact(value('unclear', 'posting_language', `Posting is written in ${label(postingLang)}; no language requirement stated.`), null, 'low', now);
  }
  return fact(value('unclear', 'none', null), null, 'low', now);
}
