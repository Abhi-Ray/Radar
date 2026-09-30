/**
 * Shared text folding for the normalisers. `fold` gives the diacritic-insensitive, lowercase
 * key used by every dictionary lookup (places, titles, companies), so "München", "MUNCHEN" and
 * "Munchen" meet on one key; `foldGerman` additionally spells umlauts out ("muenchen").
 */

const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  ẞ: 'ss',
  ø: 'o',
  Ø: 'o',
  æ: 'ae',
  Æ: 'ae',
  œ: 'oe',
  Œ: 'oe',
  ł: 'l',
  Ł: 'l',
  đ: 'd',
  Đ: 'd',
  ð: 'd',
  Ð: 'd',
  þ: 'th',
  Þ: 'th',
  ı: 'i',
  ħ: 'h',
  Ħ: 'h',
};

const SPECIAL_RE = /[ßẞøØæÆœŒłŁđĐðÐþÞıħĦ]/g;

/** Typographic variants that should behave like their ASCII form. */
const PUNCT_RE = /[\u2018\u2019\u201a\u201b\u2032\u00b4`]/g;
const DASH_RE = /[\u2010-\u2015\u2212\u2e3a\u2e3b]/g;

/** Unify quotes/dashes/spaces without changing case or letters. */
export function normalizePunctuation(s: string): string {
  return s
    .replace(PUNCT_RE, "'")
    .replace(DASH_RE, '-')
    .replace(/[\u00a0\u2000-\u200b\u202f\u205f\u3000]/g, ' ')
    .replace(/\u00ad/g, '');
}

/** Lowercase, strip diacritics (ß→ss, ø→o, æ→ae, ł→l …), unify punctuation. Keeps word separators. */
export function fold(s: string): string {
  return normalizePunctuation(s)
    .replace(SPECIAL_RE, (c) => SPECIAL_LETTERS[c] ?? c)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '');
}

/** Like `fold` but spells German umlauts out first (ä→ae, ö→oe, ü→ue), e.g. "Muenchen". */
export function foldGerman(s: string): string {
  return fold(
    s
      .replace(/[äÄ]/g, (c) => (c === 'ä' ? 'ae' : 'Ae'))
      .replace(/[öÖ]/g, (c) => (c === 'ö' ? 'oe' : 'Oe'))
      .replace(/[üÜ]/g, (c) => (c === 'ü' ? 'ue' : 'Ue')),
  );
}

export interface FoldedText {
  folded: string;
  /** `map[i]` = index in the original string of the character that produced `folded[i]`. */
  map: number[];
}

const foldCharCache = new Map<string, string>();

/**
 * `fold()` applied code point by code point, with an index map back to the original, so a match
 * found in folded text can be quoted verbatim from the original (fold may change lengths: ß→ss).
 */
export function foldWithMap(s: string): FoldedText {
  let folded = '';
  const map: number[] = [];
  let i = 0;
  for (const ch of s) {
    let f = foldCharCache.get(ch);
    if (f === undefined) {
      f = fold(ch);
      if (foldCharCache.size < 20_000) foldCharCache.set(ch, f);
    }
    folded += f;
    for (let k = 0; k < f.length; k++) map.push(i);
    i += ch.length;
  }
  map.push(s.length);
  return { folded, map };
}

/** Folded words (letters/digits only), in order. */
export function foldedTokens(s: string): string[] {
  return fold(s)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Folded key for dictionary lookups: tokens joined by one space. */
export function foldKey(s: string): string {
  return foldedTokens(s).join(' ');
}

/** All lookup keys of a name: the plain fold, plus the umlaut spelled-out form when different. */
export function foldVariants(s: string): string[] {
  const a = foldKey(s);
  const b = foldedTokens(foldGerman(s)).join(' ');
  return a === b ? [a] : [a, b];
}

export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Escape a literal for use inside a RegExp. */
export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A short quote around [start, end) of `text`, trimmed to word boundaries, max ~`max` chars. */
export function quoteAround(text: string, start: number, end: number, max = 160): string {
  const len = end - start;
  if (len >= max) return collapseWhitespace(text.slice(start, start + max));
  const pad = Math.floor((max - len) / 2);
  let a = Math.max(0, start - pad);
  let b = Math.min(text.length, end + pad);
  // Prefer sentence/line boundaries inside the window.
  const before = text.slice(a, start);
  const cut = Math.max(before.lastIndexOf('. '), before.lastIndexOf('\n'), before.lastIndexOf('• '));
  if (cut !== -1) a += cut + 2;
  const after = text.slice(end, b);
  const stops = [after.indexOf('. '), after.indexOf('\n'), after.indexOf('; ')].filter((i) => i !== -1);
  if (stops.length) b = end + Math.min(...stops) + 1;
  if (a > 0 && /\S/.test(text[a - 1] ?? '')) {
    const sp = text.indexOf(' ', a);
    if (sp !== -1 && sp < start) a = sp + 1;
  }
  if (b < text.length && /\S/.test(text[b] ?? '')) {
    const sp = text.lastIndexOf(' ', b);
    if (sp > end) b = sp;
  }
  return collapseWhitespace(text.slice(a, b));
}

/** Title-case a folded or raw place fragment for display ("new york" → "New York"). */
export function titleCase(s: string): string {
  return s.replace(/\p{L}[\p{L}'’]*/gu, (w) => (w.length <= 1 ? w.toUpperCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()));
}
