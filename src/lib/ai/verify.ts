// STUB(AI+ACCURACY): minimal but real quote check — an AI claim is only kept when its quote
// appears in the posting (case/whitespace/quote-style insensitive). Keep the exported signature.

export const MIN_QUOTE_LENGTH = 8;

function norm(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
    .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u200b-\u200d\u2060\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** True when `quote` (≥ 8 chars after normalising) occurs verbatim in `text`. */
export function verifyQuote(quote: string, text: string): boolean {
  if (typeof quote !== 'string' || typeof text !== 'string') return false;
  const q = norm(quote).replace(/^["'\s.\u2026]+|["'\s.\u2026]+$/g, '');
  if (q.length < MIN_QUOTE_LENGTH) return false;
  return norm(text).includes(q);
}
