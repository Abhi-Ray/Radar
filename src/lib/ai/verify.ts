/**
 * Evidence checks for AI output (spec §15.2): an AI claim is only kept when its quote really
 * occurs in the posting. Comparison is insensitive to case, Unicode compatibility forms, curly vs
 * straight quotes, dash variants, non-breaking / zero-width spaces and runs of whitespace — and
 * nothing else (no fuzzy matching: a paraphrase is a rejection).
 *
 * On top of the substring check, claims that carry a number (years, salary) must show that number
 * inside their quote, a skill must be named in its quote, and quotes that look like instructions
 * aimed at the model (prompt injection) are rejected.
 */

export const MIN_QUOTE_LENGTH = 8;
/** A quote longer than this proves nothing (the model could quote the whole posting). */
export const MAX_QUOTE_LENGTH = 320;

function mapChars(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032`\u00b4]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212\u2e3a\u2e3b]/g, '-')
    .replace(/[\u00a0\u2007\u202f\u200b-\u200d\u2060\ufeff]/g, ' ');
}

/** The normal form both sides are compared in. */
export function normalizeQuoteText(s: string): string {
  return mapChars(s).replace(/\s+/g, ' ').trim();
}

/**
 * Same as normalizeQuoteText but line breaks survive (as single '\n'), so replacing '\n' by ' '
 * gives exactly normalizeQuoteText(s) — the indexes of both forms line up.
 */
function normalizeKeepLines(s: string): string {
  return mapChars(s)
    .replace(/\s*\n\s*/g, '\n')
    .replace(/[^\S\n]+/g, ' ')
    .trim();
}

function trimQuote(normalized: string): string {
  return normalized.replace(/^["'\s.\u2026]+|["'\s.\u2026]+$/g, '');
}

/** True when `quote` (≥ 8 chars after normalising) occurs verbatim in `text`. */
export function verifyQuote(quote: string, text: string): boolean {
  if (typeof quote !== 'string' || typeof text !== 'string') return false;
  const q = trimQuote(normalizeQuoteText(quote));
  if (q.length < MIN_QUOTE_LENGTH) return false;
  return normalizeQuoteText(text).includes(q);
}

/** Why an AI quote was refused (null = accepted). */
export type QuoteRejection = 'missing' | 'too_short' | 'too_long' | 'not_found' | 'injection';

/**
 * Full evidence check of one AI quote: present, 8–320 chars, verbatim in `text`, and not an
 * instruction aimed at the model.
 */
export function checkEvidence(quote: unknown, text: string): QuoteRejection | null {
  if (typeof quote !== 'string' || !quote.trim()) return 'missing';
  const q = trimQuote(normalizeQuoteText(quote));
  if (q.length < MIN_QUOTE_LENGTH) return 'too_short';
  if (q.length > MAX_QUOTE_LENGTH) return 'too_long';
  const lined = normalizeKeepLines(text);
  const flat = lined.replace(/\n/g, ' ');
  let idx = flat.indexOf(q);
  if (idx < 0) return 'not_found';
  if (looksLikeInjection(q)) return 'injection';
  // The sentence around the quote must not be an instruction either: a posting can plant a
  // harmless-looking sentence inside an injected one and ask the model to quote it.
  for (let n = 0; idx >= 0 && n < 20; idx = flat.indexOf(q, idx + 1), n++) {
    if (!looksLikeInjection(sentenceAround(lined, idx, q.length))) return null;
  }
  return 'injection';
}

const SENTENCE_END_RE = /[.!?](?=\s)|\n/g;

/** The sentence(s) of `lined` that contain [start, start+len). */
function sentenceAround(lined: string, start: number, len: number): string {
  let from = 0;
  let to = lined.length;
  SENTENCE_END_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = SENTENCE_END_RE.exec(lined))) {
    const end = m.index + 1;
    if (end <= start) from = end;
    else if (m.index >= start + len) {
      to = end;
      break;
    }
  }
  return lined.slice(from, to);
}

/** Clean display form of a quote (whitespace collapsed, capped). */
export function displayQuote(quote: string, max = MAX_QUOTE_LENGTH): string {
  const s = quote.replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

// ---- prompt injection ------------------------------------------------------------------------

const INJECTION_RES: readonly RegExp[] = [
  /\b(?:ignore|disregard|forget|override|bypass)\b[^.\n]{0,60}\b(?:instructions?|prompts?|rules|guidelines|above|previous|prior|earlier|system)\b/i,
  /\b(?:system prompt|developer message|jailbreak|prompt injection)\b/i,
  /\byou are now\b[^.\n]{0,40}\b(?:ai|assistant|model|bot|gpt)\b/i,
  /\byou are (?:an? |the )?(?:\w+ ){0,2}(?:ai|language model|llm|chat ?gpt)\b/i,
  /\bfrom now on\b[^.\n]{0,40}\b(?:respond|answer|reply|output|say)\b/i,
  /\b(?:as an ai|ai assistant|language model)\b/i,
  /<\/?\s*(?:system|assistant|user|tool|posting)\b/i,
  /\[\/?inst\]|<<<|>>>|<\|im_(?:start|end)\|>/i,
  /\b(?:call|use|invoke)\s+the\s+(?:function|tool)\b/i,
  /\b(?:visa_signals|red_flags|summary_quotes|min_years|max_years|tool_choice|tool_calls|function_call)\b/i,
  /\b(?:report|return|output|answer|mark)\b[^.\n]{0,80}\bwith (?:the )?quote\b/i,
  /\b(?:ignorier\w*|missachte\w*)\b[^.\n]{0,60}\b(?:anweisung\w*|vorgaben|regeln)\b/i,
  /\b(?:ignorez|ignorer|oubliez)\b[^.\n]{0,60}\b(?:instructions?|consignes|règles)\b/i,
  /\b(?:negeer|vergeet)\b[^.\n]{0,60}\b(?:instructies|opdrachten|regels)\b/i,
  /\b(?:ignora|olvida)\b[^.\n]{0,60}\b(?:instrucciones|reglas)\b/i,
];

/** True when a text looks like an instruction aimed at an AI model rather than posting content. */
export function looksLikeInjection(text: string): boolean {
  const t = normalizeQuoteText(text);
  return INJECTION_RES.some((re) => re.test(t));
}

// ---- numbers in quotes -----------------------------------------------------------------------

const NUMBER_WORDS: Readonly<Record<number, readonly string[]>> = {
  1: ['one', 'a year', 'ein', 'eine', 'einem', 'einjährige', 'un', 'une', 'een', 'uno', 'una'],
  2: ['two', 'zwei', 'deux', 'twee', 'dos', 'couple'],
  3: ['three', 'drei', 'trois', 'drie', 'tres'],
  4: ['four', 'vier', 'quatre', 'cuatro'],
  5: ['five', 'fünf', 'fuenf', 'cinq', 'vijf', 'cinco'],
  6: ['six', 'sechs', 'zes', 'seis'],
  7: ['seven', 'sieben', 'sept', 'zeven', 'siete'],
  8: ['eight', 'acht', 'huit', 'ocho'],
  9: ['nine', 'neun', 'neuf', 'negen', 'nueve'],
  10: ['ten', 'zehn', 'dix', 'tien', 'diez'],
  12: ['twelve', 'zwölf', 'douze', 'twaalf', 'doce'],
  15: ['fifteen', 'fünfzehn', 'quinze', 'vijftien', 'quince'],
};

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the quote states the integer `n` (as digits or as a number word in EN/DE/FR/NL/ES). */
export function quoteMentionsNumber(quote: string, n: number): boolean {
  if (!Number.isFinite(n)) return false;
  const q = normalizeQuoteText(quote);
  if (!Number.isInteger(n)) {
    // "1.5 years" / "1,5 Jahre"
    const [i, f] = String(n).split('.');
    return new RegExp(`(?<![\\d.,])${i}[.,]${f}(?![\\d])`).test(q);
  }
  const int = Math.round(n);
  if (new RegExp(`(?<![\\d.,])${int}(?![\\d])`).test(q)) return true;
  const words = NUMBER_WORDS[int] ?? [];
  return words.some((w) => new RegExp(`(?<![\\p{L}])${escapeRe(w)}(?![\\p{L}])`, 'u').test(q));
}

const THOUSAND_SUFFIX_RE = /^\s?(?:k\b|tsd\b|teur\b|tausend\b|mil\b|mille\b|duizend\b)/i;

function parseAmountToken(token: string): number | null {
  const t = token.replace(/[\s'\u00a0\u202f\u2009]/g, '');
  if (!/\d/.test(t)) return null;
  const lastDot = t.lastIndexOf('.');
  const lastComma = t.lastIndexOf(',');
  let normalized: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const thousands = decimal === '.' ? ',' : '.';
    normalized = t.split(thousands).join('').replace(decimal, '.');
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? '.' : ',';
    const parts = t.split(sep);
    const tail = parts[parts.length - 1];
    // "60.000" / "60,000" / "1.234.567" = thousands; "4,5" / "12.50" = decimals.
    normalized = parts.length > 2 || tail.length === 3 ? parts.join('') : `${parts.slice(0, -1).join('')}.${tail}`;
  } else {
    normalized = t;
  }
  const v = Number(normalized);
  return Number.isFinite(v) ? v : null;
}

/** Every amount written in a quote ("€60.000", "60k", "4 500,00", "85,000–95,000"). */
export function quoteAmounts(quote: string): number[] {
  const q = quote.normalize('NFKC');
  const out: number[] = [];
  const re = /\d(?:[\d.,'\u00a0\u202f\u2009 ]*\d)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(q))) {
    const raw = m[0];
    // "60 000 - 70 000": a space followed by 3 digits is a thousands group; otherwise split.
    const pieces = raw.split(/ (?!\d{3}(?!\d))/);
    let offset = m.index;
    for (const piece of pieces) {
      const v = parseAmountToken(piece);
      const after = q.slice(offset + piece.length, offset + piece.length + 12);
      if (v !== null) out.push(THOUSAND_SUFFIX_RE.test(after) ? v * 1000 : v);
      offset += piece.length + 1;
    }
  }
  return out;
}

/** True when the quote states the amount `n` (±0.5%, "60k" = 60000). */
export function quoteMentionsAmount(quote: string, n: number): boolean {
  if (!Number.isFinite(n) || n <= 0) return false;
  const tol = Math.max(0.5, n * 0.005);
  return quoteAmounts(quote).some((a) => Math.abs(a - n) <= tol);
}

/** True when `term` (e.g. a skill name) appears in the quote, word-bounded, case-insensitive. */
export function quoteMentionsTerm(quote: string, term: string): boolean {
  const q = normalizeQuoteText(quote);
  const t = normalizeQuoteText(term);
  if (!t) return false;
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(t)}(?![\\p{L}\\p{N}])`, 'u').test(q);
}
