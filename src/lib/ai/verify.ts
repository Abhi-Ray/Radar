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

/** The normal form both sides are compared in. */
export function normalizeQuoteText(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032`\u00b4]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g, '"')
    .replace(/[\u2010-\u2015\u2212\u2e3a\u2e3b]/g, '-')
    .replace(/[\u00a0\u2007\u202f\u200b-\u200d\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
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
  if (!normalizeQuoteText(text).includes(q)) return 'not_found';
  if (looksLikeInjection(q)) return 'injection';
  return null;
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
  /\byou are (?:now )?(?:an? |the )?(?:ai|assistant|language model|llm|chat ?gpt|model)\b/i,
  /\b(?:as an ai|ai assistant|language model)\b/i,
  /<\/?\s*(?:system|assistant|user|tool|posting)\b/i,
  /\[\/?inst\]|<<<|>>>|<\|im_(?:start|end)\|>/i,
  /\b(?:call|use|invoke)\s+the\s+(?:function|tool)\b/i,
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
