/**
 * Posting-text visa signal detector (spec §13.3). Pure and deterministic.
 *
 * Pipeline:
 * 1. Fold the text (lowercase, no diacritics) while keeping an index map back to the original, so
 *    every quote is an exact substring of the input.
 * 2. Split into sentences (". ", "!", "?", ";", newlines, bullets) and each sentence into clauses at
 *    contrastive conjunctions ("but", "aber", "mais", "maar", "pero" …) and subject changes
 *    ("and we", "und wir" …), so "no relocation, but visa sponsorship is available" reads as two
 *    clauses and the "no" does not leak into the second one.
 * 3. Match the phrase rules of src/data/visa/phrases.ts. Explicit refusals, labelled fields and
 *    form questions claim their span first; positive phrases inside a claimed span are dropped.
 * 4. Positive phrases are checked for negation in a window before them (last words of the clause,
 *    stopping at a comma except for noun lists like "we don't offer relocation, visa sponsorship
 *    or …") and right after them ("… is not available"). Negated offers become not_offered
 *    ("without" → right to work required); negated relocation / right-to-work phrases are dropped.
 *    The after-check also runs across a label separator ("Visa sponsorship - we're unable to offer
 *    this", "Visa sponsorship (not available)"). A negation followed by "required/needed"
 *    ("Visa sponsorship is not required for EU citizens") is a need statement: no signal.
 * 5. Job-duty context ("you will manage visa sponsorship", "experience with immigration support",
 *    a "Responsibilities" section) drops a hit: it describes the work, not the employer's offer.
 * 6. Hedged offers ("may be available", "case by case", "nach Absprache") stay offered but drop to
 *    low confidence, which the decision engine reads as "likely", never "confirmed".
 * 7. A bare mention ("visa sponsorship") keeps its confidence only in a benefit context (a
 *    "Benefits" / "What we offer" section or label, an offer verb before it, "… included" after
 *    it). Anywhere else it becomes a low-confidence mention (`#mention`): likely at most.
 * 8. Question sentences (application forms) yield at most a low-confidence right_to_work_required.
 *    One exception: a question about the employer's offer ("Visa sponsorship for this role?",
 *    "Do you offer visa sponsorship?") answered by the next line alone ("Unfortunately not.",
 *    "Yes!") is read from the answer, at medium confidence (`#answer`). Option lists ("Yes / No")
 *    and questions about the candidate ("Are you seeking visa sponsorship?") never count.
 */
import type { VisaSignal, VisaSignalKind } from '../contracts/jobs';
import type { Confidence } from '../contracts/provenance';
import { confidenceRank, minConfidence } from '../contracts/provenance';
import { foldWithMap } from '../normalize/text';
import {
  ANSWER_EN_NO_PHRASES,
  ANSWER_EN_YES_PHRASES,
  ANSWER_NO_WORDS,
  ANSWER_REGRET_NEGATORS,
  ANSWER_REGRET_WORDS,
  ANSWER_YES_WORDS,
  BENEFIT_HEADINGS,
  CANDIDATE_QUESTION_CUES,
  BENEFIT_VERBS,
  CONDITION_CUES,
  DUTY_CUES,
  DUTY_HEADINGS,
  DUTY_SUBJECTS,
  DUTY_VERBS,
  EMPLOYER_QUESTION_CUES,
  EMPLOYER_SUBJECTS,
  HEDGE_CUES,
  LABEL_POSITIVE_RE,
  OFFER_VERBS,
  POST_BENEFIT_CUES,
  POST_DUTY_CUES,
  POST_FILLERS,
  POST_NEGATORS,
  PSEUDO_NEGATIONS,
  QUESTION_STARTERS,
  REQUIREMENT_CUES,
  STRONG_NEGATORS,
  VISA_PHRASE_RULES,
  VISA_PHRASES_VERSION,
  WEAK_NEGATORS,
  type VisaPhraseRule,
} from '../../data/visa/phrases';

export const VISA_SIGNALS_LOGIC_VERSION = 'visa-signals@2026-09-30.4';
export { VISA_PHRASES_VERSION };

/** Longest quote we store around a hit (the whole sentence when shorter). */
const MAX_QUOTE = 240;
/** Words before a hit that are searched for a negation / condition cue. */
const PRE_WINDOW_WORDS = 10;
/** Words before a bare hit (whole clause, across commas) searched for duty / offer context. */
const CLAUSE_WINDOW_WORDS = 15;
/** A line under a section heading counts as a list item of that section up to this many words. */
const SECTION_ITEM_MAX_WORDS = 14;

const L = '[\\p{L}\\p{N}]';

/**
 * Turn a phrase-table pattern into a RegExp source: a literal space outside a character class
 * matches any whitespace run (" ?" / " *" → optional whitespace).
 */
export function compilePatternSource(pattern: string): string {
  let out = '';
  let inClass = false;
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];
    if (c === '\\') {
      out += c + (pattern[i + 1] ?? '');
      i++;
      continue;
    }
    if (inClass) {
      if (c === ']') inClass = false;
      out += c;
      continue;
    }
    if (c === '[') {
      inClass = true;
      out += c;
      continue;
    }
    if (c === ' ') {
      const next = pattern[i + 1];
      if (next === '?' || next === '*') {
        out += '\\s*';
        i++;
      } else {
        out += '\\s+';
      }
      continue;
    }
    out += c;
  }
  return out;
}

function boundedRe(source: string, flags = 'gu'): RegExp {
  return new RegExp(`(?<!${L})(?:${source})(?!${L})`, flags);
}

function alternation(words: readonly string[]): string {
  return words.map((w) => compilePatternSource(w)).join('|');
}

interface CompiledRule {
  rule: VisaPhraseRule;
  re: RegExp;
}

const COMPILED: CompiledRule[] = VISA_PHRASE_RULES.map((rule) => ({
  rule,
  re: boundedRe(compilePatternSource(rule.pattern)),
}));

// Negators: "n'" (French elision) is followed by a letter, so it gets no trailing boundary. A cue
// followed by "-" ("non-EU", "nicht-EU") is a prefix, not a negation.
const STRONG_WORDS = STRONG_NEGATORS.filter((w) => !w.endsWith("'"));
const ELISIONS = STRONG_NEGATORS.filter((w) => w.endsWith("'"));
const STRONG_NEG_RE = new RegExp(
  `(?<!${L})(?:(?:${alternation(STRONG_WORDS)})(?!${L}|-)${ELISIONS.length ? `|(?:${alternation(ELISIONS)})` : ''})`,
  'u',
);
const WEAK_NEG_RE = new RegExp(`(?<!${L})(?:${alternation(WEAK_NEGATORS)})(?!${L}|-)`, 'u');
const PSEUDO_RE = boundedRe(alternation(PSEUDO_NEGATIONS));
const HEDGE_RE = new RegExp(`(?<!${L})(?:${alternation(HEDGE_CUES)})(?!${L})`, 'u');
const CONDITION_RE = new RegExp(`(?<!${L})(?:${alternation(CONDITION_CUES)})(?!${L})`, 'u');
const REQUIREMENT_RE = new RegExp(`(?<!${L})(?:${alternation(REQUIREMENT_CUES)})(?!${L})`, 'u');
/** Coordinated noun right after a hit: "visa sponsorship and relocation are not offered". */
const POST_COORD =
  '(?:(?:and|or|nor|und|oder|sowie|et|ou|en|of|y|o|e|och|eller|og|ja|tai|i|lub|a|nebo)\\s+|[&/]\\s*)[\\p{L}-]+(?:\\s+[\\p{L}-]+)?\\s+';
const POST_NEG_SRC = `^[\\s:(\\-]*(?:${POST_COORD})?(?:(?:${alternation(POST_FILLERS)})\\s+){0,5}(?:${alternation(POST_NEGATORS)})(?!${L}|-)`;
const POST_NEG_RE = new RegExp(POST_NEG_SRC, 'u');
/** "… is not required / not needed": the negation belongs to a need, not to an offer. */
const POST_NEG_NEED_RE = new RegExp(
  `${POST_NEG_SRC}\\s+(?:(?:be|currently|strictly|necessarily|always)\\s+)?(?:required|needed|necessary|a requirement|mandatory|erforderlich|notwendig|notig|benotigt|nodig|vereist|requise?|necessaire|necesario|requerido|necessario|richiesto)(?!${L})`,
  'u',
);
const HEAD_ONLY_RE = /^[\s\-*•·▪●◦>\d.)(]*$/u;
const LABEL_SEP_RE = /^\s*(?::|\(|-\s|–)/u;
const DUTY_CUE_RE = boundedRe(alternation(DUTY_CUES), 'u');
const DUTY_VERB_RE = boundedRe(alternation(DUTY_VERBS), 'u');
const EMPLOYER_SUBJECT_RE = boundedRe(alternation(EMPLOYER_SUBJECTS), 'u');
const DUTY_SUBJECT_RE = boundedRe(alternation(DUTY_SUBJECTS), 'gu');
const BENEFIT_VERB_START_RE = new RegExp(`^\\s*(?:(?:also|then|now)\\s+)?(?:${alternation(BENEFIT_VERBS)})(?!${L})`, 'u');
const OFFER_VERB_RE = boundedRe(alternation(OFFER_VERBS), 'u');
const POST_DUTY_RE = new RegExp(`^[\\s:]*(?:${alternation(POST_DUTY_CUES)})(?!${L})`, 'u');
const POST_BENEFIT_RE = new RegExp(
  `^[\\s:(\\-]*(?:(?:is|are|ist|sind|wird|est|es|e|zijn|wordt)\\s+)?(?:${alternation(POST_BENEFIT_CUES)})(?!${L})`,
  'u',
);
const HEADING_LABEL = (list: readonly string[]) =>
  new RegExp(`^[\\s\\-*•·▪●◦>\\d.)(#]*(?:${alternation(list)})\\s*(?:[:\\-–]|$)`, 'u');
const BENEFIT_HEADING_RE = HEADING_LABEL(BENEFIT_HEADINGS);
const DUTY_HEADING_RE = HEADING_LABEL(DUTY_HEADINGS);
/** Any short "Something:" line is a heading that ends the previous section. */
const GENERIC_HEADING_RE = /^[\s\-*•·▪●◦>\d.)(#]*[\p{L}][^:]{0,50}:\s*$/u;
const POST_REQUIREMENT_RE =
  /^[\s:]*(?:(?:is|are|ist|est|es|e|is|wordt|jest|je)\s+)?(?:required|needed|necessary|erforderlich|notwendig|notig|benotigt|requise?|necessaire|nodig|vereist|necesario|requerido|necessario|richiesto|kravs|kraeves|kreves|vaaditaan|wymagane|nutne)(?![\p{L}\p{N}])/u;
const QUESTION_START_RE = new RegExp(`^(?:${alternation(QUESTION_STARTERS)})(?!${L})`, 'u');
/** A short answer stands alone: punctuation, the end of the line, or (for "yes") "we do / we can". */
const ANSWER_END = `\\s*(?:[,.!;:)]|$)`;
const ANSWER_LEAD = '^[\\s\\-*>()\\[\\]]*';
const ANSWER_YES_RE = new RegExp(
  `${ANSWER_LEAD}(?:(?:${alternation(ANSWER_YES_WORDS)})(?:${ANSWER_END}|\\s+(?=we\\s))|(?:${alternation(ANSWER_EN_YES_PHRASES)})${ANSWER_END})`,
  'u',
);
const ANSWER_NO_RE = new RegExp(
  `${ANSWER_LEAD}(?:(?:${alternation(ANSWER_REGRET_WORDS)})[\\s,!.:-]*)?(?:(?:${alternation(ANSWER_NO_WORDS)})${ANSWER_END}|(?:${alternation(ANSWER_EN_NO_PHRASES)})${ANSWER_END})`,
  'u',
);
const ANSWER_REGRET_NO_RE = new RegExp(
  `${ANSWER_LEAD}(?:${alternation(ANSWER_REGRET_WORDS)})[\\s,!.:-]*(?:${alternation(ANSWER_REGRET_NEGATORS)})(?!${L})`,
  'u',
);
/** A bare yes/no token on its own: one option of an option list when another follows. */
const ANSWER_TOKEN_RE = new RegExp(`${ANSWER_LEAD}(?:${alternation([...ANSWER_YES_WORDS, ...ANSWER_NO_WORDS])})[\\s.!)\\]]*$`, 'u');
const CANDIDATE_Q_RE = boundedRe(alternation(CANDIDATE_QUESTION_CUES), 'u');
const EMPLOYER_Q_RE = boundedRe(alternation(EMPLOYER_QUESTION_CUES), 'u');
/** The most words an answer line may have to be read as an answer. */
const ANSWER_MAX_WORDS = 8;
/** Verbs that let a negation distribute over a comma list ("we don't offer relocation, visa sponsorship …"). */
const LIST_VERB_RE =
  /(?<![\p{L}\p{N}])(?:offer|offers|provide|provides|sponsor|support|cover|include|bieten|anbieten|ubernehmen|offrons|proposons|fournissons|bieden|ofrecemos|ofrece|oferecemos|oferece|offriamo|forniamo|erbjuder|tilbyder|tilbyr|tarjoa|oferujemy|zapewniamy|nabizime|poskytujeme)(?![\p{L}\p{N}])/u;

const CONTRAST_RE =
  /(?:,\s*|\s)(?:but|however|although|though|whereas|while|aber|jedoch|allerdings|sondern|mais|cependant|toutefois|maar|echter|pero|sin embargo|aunque|porem|contudo|no entanto|tuttavia|comunque|mutta|jednak|vsak|and we|and they|und wir|et nous|en wij|en we|y nosotros|e nos|e noi|och vi|og vi|ja me|i my|a my)(?![\p{L}\p{N}])|,\s*(?:ma|men|mas|ale|dock|men)(?![\p{L}\p{N}])|\s-\s/gu;

const ABBREVIATIONS = new Set([
  'etc', 'approx', 'incl', 'inkl', 'bzw', 'ca', 'vs', 'resp', 'nr', 'dr', 'mr', 'ms', 'mrs', 'st', 'jr', 'sr', 'z', 'ggf', 'evtl', 'usw', 'dh', 'ua', 'zb',
]);

interface Span {
  start: number;
  end: number;
}

interface Hit extends Span {
  rule: VisaPhraseRule;
  value?: string;
}

/** Sentence ranges over the folded text (end exclusive). */
export function splitSentences(folded: string): Span[] {
  const spans: Span[] = [];
  let start = 0;
  const push = (end: number) => {
    if (end > start) spans.push({ start, end });
    start = end;
  };
  for (let i = 0; i < folded.length; i++) {
    const c = folded[i];
    if (c === '\n' || c === '\r' || c === '•' || c === '·' || c === '|' || c === ';' || c === '▪' || c === '●' || c === '◦') {
      push(i);
      start = i + 1;
      continue;
    }
    if (c === '!' || c === '?') {
      push(i + 1);
      continue;
    }
    if (c === '.') {
      const next = folded[i + 1];
      if (next !== undefined && !/\s/.test(next)) continue;
      // Word before the dot: skip abbreviations ("e.g.", "u.s.", "approx.").
      let w = i - 1;
      while (w >= start && /[\p{L}.]/u.test(folded[w])) w--;
      const word = folded.slice(w + 1, i);
      if (/^(?:\p{L}\.)+\p{L}$/u.test(word) || /^\p{L}$/u.test(word) || ABBREVIATIONS.has(word.replace(/\./g, ''))) continue;
      push(i + 1);
    }
  }
  push(folded.length);
  return spans;
}

/** Clause start offsets (relative to the sentence) at contrastive conjunctions. */
function clauseStarts(sentence: string): number[] {
  const starts = [0];
  CONTRAST_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CONTRAST_RE.exec(sentence)) !== null) {
    starts.push(m.index);
    if (m[0].length === 0) CONTRAST_RE.lastIndex++;
  }
  return starts;
}

function clauseOf(starts: number[], pos: number, sentenceLength: number): Span {
  let s = 0;
  let e = sentenceLength;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= pos) {
      s = starts[i];
      e = i + 1 < starts.length ? starts[i + 1] : sentenceLength;
    }
  }
  return { start: s, end: e };
}

function lastWords(s: string, n: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean);
  return words.slice(-n).join(' ');
}

function stripPseudo(s: string): string {
  PSEUDO_RE.lastIndex = 0;
  return s.replace(PSEUDO_RE, ' ');
}

function isQuestion(sentence: string): boolean {
  const t = sentence.trim();
  if (t.endsWith('?')) return true;
  const head = t.replace(/^[\s\-*•·▪●◦>\d.)(]+/u, '');
  return QUESTION_START_RE.test(head);
}

/** True when a question asks about the employer's offer rather than about the candidate. */
function asksEmployer(question: string): boolean {
  return EMPLOYER_Q_RE.test(question) || !CANDIDATE_Q_RE.test(question);
}

interface Answer {
  yes: boolean;
  /** Folded index just past the answer line. */
  end: number;
}

/**
 * The FAQ answer right after question `i` ("Visa sponsorship? Unfortunately not."), or null. The
 * answer line must be short and carry no visa phrase of its own (then its own words decide), and a
 * lone "Yes" / "No" followed by another option ("Yes | No", one option per line) is a form.
 */
function answerAfter(folded: string, sents: Span[], i: number): Answer | null {
  const next = sents[i + 1];
  if (!next) return null;
  const line = folded.slice(next.start, next.end);
  if (!/\p{L}/u.test(line) || wordCount(line) > ANSWER_MAX_WORDS) return null;
  if (collectHits(line).length > 0) return null;
  if (ANSWER_TOKEN_RE.test(line)) {
    const sep = folded[next.end];
    if (sep === '|' || sep === '/') return null;
    const after = sents[i + 2];
    if (after && ANSWER_TOKEN_RE.test(folded.slice(after.start, after.end))) return null;
  }
  const plain = stripPseudo(line);
  if (ANSWER_NO_RE.test(plain) || ANSWER_REGRET_NO_RE.test(plain)) return { yes: false, end: next.end };
  if (ANSWER_YES_RE.test(plain)) {
    // "Yes, but not for this role" is no clean answer.
    const m = ANSWER_YES_RE.exec(plain);
    const rest = m ? plain.slice(m[0].length) : '';
    if (STRONG_NEG_RE.test(rest) || WEAK_NEG_RE.test(rest)) return null;
    return { yes: true, end: next.end };
  }
  return null;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}

const CLAIM_PRIORITY: Record<string, number> = { form: 0, negative: 1, labelled: 2 };

function collectHits(sentence: string): Hit[] {
  const hits: Hit[] = [];
  for (const { rule, re } of COMPILED) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(sentence)) !== null) {
      if (m[0].length === 0) {
        re.lastIndex++;
        continue;
      }
      hits.push({ rule, start: m.index, end: m.index + m[0].length, value: m.groups?.v });
    }
  }
  return hits;
}

/** Keep non-overlapping hits: claimers by priority then length, positives per signal by length. */
function resolveOverlaps(hits: Hit[]): { claims: Hit[]; positives: Hit[] } {
  const claimers = hits
    .filter((h) => h.rule.kind in CLAIM_PRIORITY)
    .sort(
      (a, b) =>
        CLAIM_PRIORITY[a.rule.kind] - CLAIM_PRIORITY[b.rule.kind] || b.end - b.start - (a.end - a.start) || a.start - b.start,
    );
  const claims: Hit[] = [];
  for (const h of claimers) if (!claims.some((c) => overlaps(c, h))) claims.push(h);

  const positives: Hit[] = [];
  const candidates = hits
    .filter((h) => !(h.rule.kind in CLAIM_PRIORITY) && !claims.some((c) => overlaps(c, h)))
    .sort(
      (a, b) =>
        (a.rule.kind === 'statement' ? 0 : 1) - (b.rule.kind === 'statement' ? 0 : 1) ||
        b.end - b.start - (a.end - a.start) ||
        a.start - b.start,
    );
  for (const h of candidates) {
    if (!positives.some((p) => p.rule.signal === h.rule.signal && overlaps(p, h))) positives.push(h);
  }
  return { claims, positives };
}

type Negation = 'none' | 'strong' | 'weak';

/** Section of the posting a line belongs to (from the nearest heading or an inline label). */
export type PostingSection = 'benefit' | 'duty' | null;

interface Context {
  negation: Negation;
  conditional: boolean;
  requirement: boolean;
  /** A negation that belongs to a need ("… is not required for EU citizens"). */
  negatedNeed: boolean;
  /** "may be available", "case by case", "nach Absprache" … anywhere in the clause. */
  hedged: boolean;
  /** Local job-duty context ("you will manage …", "experience with …", "… processes"). */
  duty: boolean;
  /** The line sits under a duty / requirements heading. */
  dutySection: boolean;
  /** Benefit context for a bare mention (benefit section or label, offer verb, "… included"). */
  benefit: boolean;
}

/** True when the words before a hit describe the candidate's work rather than the employer's offer. */
function dutyBefore(pre: string): boolean {
  if (DUTY_VERB_RE.test(pre) && !EMPLOYER_SUBJECT_RE.test(pre)) return true;
  DUTY_SUBJECT_RE.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  let m: RegExpExecArray | null;
  while ((m = DUTY_SUBJECT_RE.exec(pre)) !== null) last = m;
  if (!last) return false;
  const rest = pre.slice(last.index + last[0].length);
  if (EMPLOYER_SUBJECT_RE.test(rest)) return false;
  return !BENEFIT_VERB_START_RE.test(rest);
}

function contextOf(sentence: string, starts: number[], hit: Hit, section: PostingSection): Context {
  const clause = clauseOf(starts, hit.start, sentence.length);
  const before = sentence.slice(clause.start, hit.start);
  // Stop at the last comma unless this is a noun list distributed by a negated verb.
  let window = before;
  const comma = before.lastIndexOf(',');
  if (comma !== -1) {
    const tail = before.slice(comma + 1);
    const head = before.slice(0, comma);
    const listLike = /^\s*(?:(?:and|or|nor|und|oder|et|ou|en|of|y|o|e|och|eller|og|ja|tai|i|lub|a|nebo)\s+)?$/u.test(tail);
    const distributes =
      listLike && (hit.rule.kind === 'bare' || hit.rule.signal === 'relocation') && LIST_VERB_RE.test(head) && STRONG_NEG_RE.test(stripPseudo(head));
    window = distributes ? before : tail;
  }
  const pre = stripPseudo(lastWords(window, PRE_WINDOW_WORDS));
  const clausePre = stripPseudo(lastWords(before, CLAUSE_WINDOW_WORDS));

  const clauseEnd = clause.end;
  let after = sentence.slice(hit.end, clauseEnd);
  const cut = after.indexOf(',');
  if (cut !== -1) after = after.slice(0, cut);
  after = stripPseudo(after);
  // "Visa sponsorship - we're unable to offer this" / "Visa sponsorship (not available)": a hit that
  // opens the line and is followed by a label separator is checked across the separator too.
  let labelAfter = '';
  const rest = sentence.slice(hit.end);
  if (HEAD_ONLY_RE.test(sentence.slice(0, hit.start)) && LABEL_SEP_RE.test(rest)) {
    labelAfter = rest;
    const c = labelAfter.search(/[,;]/u);
    if (c !== -1) labelAfter = labelAfter.slice(0, c);
    labelAfter = stripPseudo(labelAfter);
  }

  let negation: Negation = 'none';
  if (STRONG_NEG_RE.test(pre) || POST_NEG_RE.test(after) || (labelAfter !== '' && POST_NEG_RE.test(labelAfter))) negation = 'strong';
  else if (WEAK_NEG_RE.test(pre)) negation = 'weak';

  const bare = hit.rule.kind === 'bare';
  const postRequirement = POST_REQUIREMENT_RE.test(after);
  const matched = sentence.slice(hit.start, hit.end);
  return {
    negation,
    conditional: CONDITION_RE.test(pre),
    requirement: REQUIREMENT_RE.test(pre) || postRequirement,
    negatedNeed:
      negation !== 'none' && (postRequirement || POST_NEG_NEED_RE.test(after) || (labelAfter !== '' && POST_NEG_NEED_RE.test(labelAfter))),
    hedged: HEDGE_RE.test(`${pre} ${matched} ${after}`),
    duty: dutyBefore(pre) || (bare && (DUTY_CUE_RE.test(clausePre) || POST_DUTY_RE.test(after))),
    dutySection: section === 'duty',
    benefit: bare && (section === 'benefit' || OFFER_VERB_RE.test(clausePre) || POST_BENEFIT_RE.test(after)),
  };
}

interface Emitted {
  signal: VisaSignalKind;
  confidence: Confidence;
  ruleId: string;
}

const NEUTRAL: Context = {
  negation: 'none',
  conditional: false,
  requirement: false,
  negatedNeed: false,
  hedged: false,
  duty: false,
  dutySection: false,
  benefit: false,
};

function interpret(hit: Hit, ctx: Context | null, question: boolean): Emitted | null {
  const { rule } = hit;
  if (rule.kind === 'form') return { signal: 'right_to_work_required', confidence: 'low', ruleId: rule.id };

  let out: Emitted | null;
  if (rule.kind === 'negative') {
    out = { signal: rule.signal, confidence: rule.confidence, ruleId: rule.id };
  } else if (rule.kind === 'labelled') {
    const v = (hit.value ?? '').replace(/\s+/g, ' ').trim();
    if (v === 'n/a' || v === 'na' || v === 'n a') return null;
    const positive = LABEL_POSITIVE_RE.test(v);
    if (rule.signal === 'offered') out = { signal: positive ? 'offered' : 'not_offered', confidence: rule.confidence, ruleId: rule.id };
    else out = positive ? { signal: rule.signal, confidence: rule.confidence, ruleId: rule.id } : null;
  } else {
    const c: Context = ctx ?? NEUTRAL;
    const bare = rule.kind === 'bare';
    // The text is about the job's work ("you will manage visa sponsorship"), not the employer's offer.
    if (c.duty && rule.signal !== 'right_to_work_required') return null;
    if (bare && c.conditional) return null;
    if (bare && rule.signal === 'offered' && c.requirement) return null;
    if (rule.signal === 'right_to_work_required' && c.conditional) return null;
    if (c.negatedNeed) return null;
    if (c.negation !== 'none') {
      if (rule.signal !== 'offered') return null;
      out =
        c.negation === 'strong'
          ? { signal: 'not_offered', confidence: rule.confidence, ruleId: `${rule.id}#negated` }
          : { signal: 'right_to_work_required', confidence: minConfidence(rule.confidence, 'medium'), ruleId: `${rule.id}#without` };
    } else if (rule.signal === 'offered' && c.hedged) {
      // Checked before the duty-section drop: "Visa sponsorship may be considered" is a hedged
      // employer statement even when the last heading was "Your profile" (low = likely at most).
      out = { signal: 'offered', confidence: 'low', ruleId: `${rule.id}#hedged` };
    } else if (bare && rule.signal === 'offered' && c.dutySection) {
      return null;
    } else if (bare && rule.signal === 'offered' && !c.benefit) {
      out = { signal: 'offered', confidence: 'low', ruleId: `${rule.id}#mention` };
    } else {
      out = { signal: rule.signal, confidence: rule.confidence, ruleId: rule.id };
    }
  }
  if (!out) return null;
  if (question) {
    if (out.signal === 'relocation') return null;
    return { signal: 'right_to_work_required', confidence: 'low', ruleId: `${out.ruleId}#question` };
  }
  return out;
}

function wordCount(s: string): number {
  return s.split(/\s+/u).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

/** Heading kind of a line that is only a heading ("Benefits:", "What we offer"), else undefined. */
function headingOf(sentence: string): PostingSection | undefined {
  const t = sentence.trim();
  if (!t || wordCount(t) > 7) return undefined;
  const onlyLabel = (re: RegExp) => {
    const m = re.exec(t);
    return m !== null && /^[\s:\-–]*$/u.test(t.slice(m[0].length));
  };
  if (onlyLabel(BENEFIT_HEADING_RE)) return 'benefit';
  if (onlyLabel(DUTY_HEADING_RE)) return 'duty';
  if (GENERIC_HEADING_RE.test(t)) return null;
  return undefined;
}

/** Section of one line: its own inline label ("Benefits: …") or the current heading for short items. */
function sectionOf(sentence: string, current: PostingSection): PostingSection {
  if (BENEFIT_HEADING_RE.test(sentence)) return 'benefit';
  if (DUTY_HEADING_RE.test(sentence)) return 'duty';
  return wordCount(sentence) <= SECTION_ITEM_MAX_WORDS ? current : null;
}

/** Original-text index just past the folded index range ending at `fEnd`. */
export function origEnd(map: number[], fEnd: number): number {
  if (fEnd <= 0) return map[0] ?? 0;
  const o = map[fEnd - 1];
  let j = fEnd;
  while (j < map.length - 1 && map[j] === o) j++;
  return map[j];
}

const LEAD_TRIM_RE = /^[\s\-*•·▪●◦>]+/u;

/** Exact substring of `text` covering the sentence (or a window around the hit when long). */
export function exactQuote(text: string, sentStart: number, sentEnd: number, hitStart: number, hitEnd: number): string {
  let a = sentStart;
  let b = sentEnd;
  if (b - a > MAX_QUOTE) {
    const pad = Math.max(40, Math.floor((MAX_QUOTE - (hitEnd - hitStart)) / 2));
    const na = Math.max(a, hitStart - pad);
    const nb = Math.min(b, hitEnd + pad);
    a = na;
    b = nb;
    if (a > sentStart && /\S/.test(text[a - 1] ?? '')) {
      const sp = text.slice(a, hitStart).search(/\s/);
      if (sp !== -1) a += sp + 1;
    }
    if (b < sentEnd && /\S/.test(text[b] ?? '')) {
      const sp = text.slice(hitEnd, b).lastIndexOf(' ');
      if (sp !== -1) b = hitEnd + sp;
    }
  }
  let q = text.slice(a, b);
  const lead = LEAD_TRIM_RE.exec(q);
  if (lead && a + lead[0].length <= hitStart) q = q.slice(lead[0].length);
  return q.trimEnd().trimStart();
}

/**
 * Detect visa signals in posting text. Every `quote` is an exact substring of `text`.
 * Signals are ordered by position; duplicates (same signal and quote) keep the highest confidence.
 */
export function detectVisaSignals(text: string): VisaSignal[] {
  if (!text || !text.trim()) return [];
  const { folded, map } = foldWithMap(text);
  const found: (VisaSignal & { pos: number })[] = [];

  let current: PostingSection = null;
  const sents = splitSentences(folded);
  for (let si = 0; si < sents.length; si++) {
    const sent = sents[si];
    const sentence = folded.slice(sent.start, sent.end);
    if (!/[\p{L}]/u.test(sentence)) continue;
    const heading = headingOf(sentence);
    if (heading !== undefined) {
      current = heading;
      continue;
    }
    const hits = collectHits(sentence);
    if (hits.length === 0) continue;
    const section = sectionOf(sentence, current);
    const { claims, positives } = resolveOverlaps(hits);
    const question = isQuestion(sentence);
    const starts = clauseStarts(sentence);
    const answer = question && asksEmployer(sentence) ? answerAfter(folded, sents, si) : null;

    for (const hit of [...claims, ...positives]) {
      const ctx = hit.rule.kind === 'statement' || hit.rule.kind === 'bare' ? contextOf(sentence, starts, hit, section) : null;
      let emitted = interpret(hit, ctx, question);
      if (!emitted) continue;
      let quoteEnd = sent.end;
      if (answer && hit.rule.kind !== 'form' && interpret(hit, ctx, false)?.signal === 'offered') {
        emitted = { signal: answer.yes ? 'offered' : 'not_offered', confidence: 'medium', ruleId: `${hit.rule.id}#answer` };
        quoteEnd = answer.end;
      }
      const oSentStart = map[sent.start];
      const oSentEnd = origEnd(map, quoteEnd);
      const oHitStart = map[sent.start + hit.start];
      const oHitEnd = origEnd(map, sent.start + hit.end);
      const quote = exactQuote(text, oSentStart, oSentEnd, oHitStart, oHitEnd);
      if (!quote) continue;
      found.push({ ...emitted, quote, lang: hit.rule.lang, pos: oHitStart });
    }
  }

  found.sort((a, b) => a.pos - b.pos);
  const out: VisaSignal[] = [];
  const index = new Map<string, number>();
  for (const f of found) {
    const key = `${f.signal}\u0000${f.quote}`;
    const at = index.get(key);
    const sig: VisaSignal = { signal: f.signal, quote: f.quote, lang: f.lang, ruleId: f.ruleId, confidence: f.confidence };
    if (at === undefined) {
      index.set(key, out.length);
      out.push(sig);
    } else if (confidenceRank(f.confidence) < confidenceRank(out[at].confidence)) {
      out[at] = sig;
    }
  }
  return out;
}

/** Number of phrase rules per language (used by tests and the admin "about" page). */
export function visaRuleStats(): Record<string, number> {
  const stats: Record<string, number> = {};
  for (const r of VISA_PHRASE_RULES) stats[r.lang] = (stats[r.lang] ?? 0) + 1;
  return stats;
}
