/**
 * Company-name keys (spec §11.2). One employer shows up as "Acme", "ACME GmbH", "Acme Ltd.",
 * "Acme & Co. KG" or "The Acme Company"; `normalizeCompanyName` gives all of them one key so they
 * meet on one company record, with the raw spellings kept as aliases.
 *
 *  - folded (diacritics removed, ß→ss, ø→o …) and lowercased,
 *  - "&" and "+" between words read as "and",
 *  - dotted / slashed abbreviations joined ("B.V." → bv, "A/S" → as, "J.P." → jp),
 *  - legal-form suffixes stripped from the end, longest form first, repeatedly ("GmbH & Co. KG",
 *    "Pty Ltd", "sp. z o.o.", "S.à r.l."); forms that are also ordinary words ("AS", "SE", "SA",
 *    "AB") only when written like a legal form (capitals, dots or a slash),
 *  - a leading "the" dropped; a name is never stripped down to nothing.
 *
 * Country qualifiers ("Acme Deutschland GmbH", "Acme (UK) Ltd") stay in the key: they usually are
 * the same employer but not always, so `brandKey` exposes the qualifier-free form and the resolver
 * only uses it as a weaker, separately reported match.
 */
import { lookupPhrase } from '../../data/places';
import { fold, normalizePunctuation } from '../normalize/text';
import { LEADING_NOISE, LEGAL_AMBIGUOUS, LEGAL_PLAIN, LEGAL_SEQUENCES } from './legal-forms';

export const MAX_COMPANY_KEY = 191;

export interface CompanyToken {
  /** Folded token (letters/digits only). */
  text: string;
  /** Written as a legal form: all capitals (2+ letters), inner capital ("SpA") or dotted/slashed ("e.V.", "A/S"). */
  formal: boolean;
}

const SLASHED_ABBREV = /^\p{L}{1,2}(?:\/\p{L}{1,2})+$/u;
/** "Inc." / "Ltd." / "Sp." (one word + dot) or "B.V." / "S.p.A." / "e.V" (1–2 letter pieces). */
const DOTTED_ABBREV = /^(?:\p{L}{1,4}\.|(?:\p{L}{1,2}\.)+\p{L}{0,2}\.?)$/u;

function isFormal(raw: string): boolean {
  const letters = raw.replace(/[^\p{L}]/gu, '');
  if (!letters) return false;
  if (/[./]/.test(raw)) return true;
  if (letters.length >= 2 && letters === letters.toUpperCase() && letters !== letters.toLowerCase()) return true;
  // Inner capital: "SpA", "GmbH", "KGaA", "eK".
  return /\p{Ll}\p{Lu}/u.test(letters);
}

/** Tokens of a company name in order, with legal-form hints. */
export function companyTokens(name: string): CompanyToken[] {
  let s = normalizePunctuation(String(name ?? ''));
  // "&" and "+" between words mean "and" ("Kuehne + Nagel", "Procter & Gamble"); "C++" stays.
  s = s.replace(/&/g, ' and ').replace(/(?<=[\p{L}\p{N}])\s*\+\s*(?=[\p{L}\p{N}])/gu, ' and ');
  // Apostrophes join ("McDonald's", "L'Oréal"); brackets are just separators.
  s = s.replace(/(?<=\p{L})['’](?=\p{L})/gu, '').replace(/['’]/g, ' ');
  const out: CompanyToken[] = [];
  for (const chunk of s.split(/[\s,;:()[\]{}"«»„“”|]+/u)) {
    if (!chunk) continue;
    const trimmed = chunk.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}.]+$/u, '');
    if (!trimmed) continue;
    if (SLASHED_ABBREV.test(trimmed) || (DOTTED_ABBREV.test(trimmed) && trimmed.replace(/[^\p{L}]/gu, '').length <= 6)) {
      const text = fold(trimmed).replace(/[^\p{L}\p{N}]/gu, '');
      if (text) out.push({ text, formal: true });
      continue;
    }
    for (const part of trimmed.split(/[^\p{L}\p{N}]+/u)) {
      if (!part) continue;
      const text = fold(part).replace(/[^\p{L}\p{N}]/gu, '');
      if (text) out.push({ text, formal: isFormal(part) || /\.$/.test(trimmed) });
    }
  }
  return out;
}

/** Length of the legal-form suffix ending `tokens` (0 when none). */
function legalSuffixLength(tokens: readonly CompanyToken[]): number {
  const n = tokens.length;
  for (const seq of LEGAL_SEQUENCES) {
    if (seq.length > n) continue;
    let ok = true;
    for (let i = 0; i < seq.length; i++) {
      if (tokens[n - seq.length + i].text !== seq[i]) {
        ok = false;
        break;
      }
    }
    if (ok) return seq.length;
  }
  // Spaced-out abbreviations: "S A", "s r o", "sp z o o" → joined form is a legal form.
  for (let k = Math.min(6, n); k >= 2; k--) {
    const run = tokens.slice(n - k);
    if (!run.every((t) => t.text.length <= 2)) continue;
    const joined = run.map((t) => t.text).join('');
    if (LEGAL_PLAIN.has(joined) || LEGAL_AMBIGUOUS.has(joined)) return k;
  }
  const last = tokens[n - 1];
  if (LEGAL_PLAIN.has(last.text)) return 1;
  if (LEGAL_AMBIGUOUS.has(last.text) && last.formal) return 1;
  return 0;
}

/** [start, end) of the name words in `all`: a leading "the" and trailing legal forms left out. */
function coreRange(all: readonly CompanyToken[]): [number, number] {
  const start = all.length > 1 && LEADING_NOISE.has(all[0].text) ? 1 : 0;
  const tokens = all.slice(start);
  let end = tokens.length;
  for (let guard = 0; guard < 8 && end > 1; guard++) {
    const k = legalSuffixLength(tokens.slice(0, end));
    if (!k || end - k < 1) break;
    end -= k;
  }
  return [start, start + end];
}

/** Tokens with a leading "the" and trailing legal forms removed (never empty for a non-empty name). */
export function coreCompanyTokens(name: string): string[] {
  const all = companyTokens(name);
  const [start, end] = coreRange(all);
  return all.slice(start, end).map((t) => t.text);
}

function capKey(s: string): string {
  if (s.length <= MAX_COMPANY_KEY) return s;
  const cut = s.slice(0, MAX_COMPANY_KEY);
  const sp = cut.lastIndexOf(' ');
  return sp > 100 ? cut.slice(0, sp) : cut;
}

/** Company identity key: folded, "&" = "and", legal forms stripped (≤191 chars). */
export function normalizeCompanyName(name: string): string {
  return capKey(coreCompanyTokens(name).join(' '));
}

/**
 * All lookup keys of a name: `normalizeCompanyName` plus the umlaut-spelled-out form when it
 * differs ("Kühne + Nagel" → ["kuhne and nagel", "kuehne and nagel"]), so both spellings meet.
 */
export function companyNameKeys(name: string): string[] {
  const plain = normalizeCompanyName(name);
  // Spelled out only inside the name words, so a legal form keeps its own spelling ("Acme OÜ"
  // must not become "Acme OUe"). Spelling out never changes where words start or end.
  const original = companyTokens(name);
  const spelled = companyTokens(spellOutUmlauts(String(name ?? '')));
  if (spelled.length !== original.length) return [plain];
  const [start, end] = coreRange(original);
  const german = capKey(
    spelled
      .slice(start, end)
      .map((t) => t.text)
      .join(' '),
  );
  return !german || plain === german ? [plain] : [plain, german];
}

function spellOutUmlauts(s: string): string {
  return s.replace(/[äÄöÖüÜ]/g, (c) => ({ ä: 'ae', Ä: 'Ae', ö: 'oe', Ö: 'Oe', ü: 'ue', Ü: 'Ue' })[c] ?? c);
}

/** Folded key WITHOUT stripping legal forms ("acme gmbh"): tells "Acme GmbH" and "Acme Ltd" apart. */
export function companyFullKey(name: string): string {
  return capKey(
    companyTokens(name)
      .map((t) => t.text)
      .join(' '),
  );
}

/** True when the name ends with a legal form ("Acme GmbH", "Acme S.A."): a legal name, not a brand. */
export function hasLegalSuffix(name: string): boolean {
  const tokens = companyTokens(name);
  return tokens.length > 1 && legalSuffixLength(tokens) > 0 && legalSuffixLength(tokens) < tokens.length;
}

/** Words that qualify a brand by market rather than name a different company. */
const QUALIFIER_WORDS: ReadonlySet<string> = new Set([
  'europe', 'emea', 'dach', 'benelux', 'nordics', 'nordic', 'international', 'intl', 'iberia', 'cee', 'apac', 'eu', 'uk', 'usa',
  'us', 'uae', 'ksa',
]);

/** A qualifier after these is part of the name ("Bank of America", "Banco de España"). */
const CONNECTORS: ReadonlySet<string> = new Set([
  'of', 'for', 'in', 'and', 'de', 'des', 'du', 'la', 'le', 'les', 'del', 'di', 'da', 'do', 'dos', 'der', 'die', 'das', 'den',
  'van', 'von', 'voor', 'fur', 'pour', 'para', 'per', 'et', 'und', 'y', 'e', 'en', 'och', 'og', 'i', 'w', 'z', 'na',
]);

/** A brand key of just one of these is a word, not a company ("Air France" is not "Air"). */
const GENERIC_BRAND_WORDS: ReadonlySet<string> = new Set([
  'air', 'bank', 'business', 'national', 'general', 'royal', 'united', 'global', 'invest', 'visit', 'radio', 'post', 'telecom',
  'energy', 'group', 'holding', 'holdings', 'consulting', 'services', 'solutions', 'systems', 'software', 'digital', 'tech',
  'technology', 'technologies', 'media', 'studio', 'studios', 'labs', 'lab', 'capital', 'partners', 'ventures', 'health',
  'insurance', 'finance', 'financial', 'trade', 'trading', 'logistics', 'transport', 'railways', 'rail', 'airlines', 'airways',
  'motors', 'electric', 'power', 'water', 'gas', 'oil', 'mobile', 'cloud', 'data', 'network', 'networks', 'foods', 'pharma',
  'games', 'gaming', 'marketing', 'recruitment', 'staffing', 'jobs', 'careers', 'talent', 'people', 'team', 'the', 'new',
  'university', 'school', 'institute', 'hospital', 'museum', 'city', 'state', 'federal', 'ministry', 'government',
]);

function isQualifierPhrase(words: readonly string[]): boolean {
  const key = words.join(' ');
  if (words.length === 1 && QUALIFIER_WORDS.has(key)) return true;
  if (key.replace(/ /g, '').length < 4) return false;
  return lookupPhrase(key).some((e) => e.kind === 'country' || e.kind === 'macro');
}

/**
 * `normalizeCompanyName` without trailing market qualifiers: "Acme Deutschland GmbH",
 * "Acme (UK) Ltd" and "Acme Europe B.V." → "acme". Null when there is no qualifier to drop or
 * what is left is too generic to name a company ("Air France", "Bank of America").
 */
export function brandKey(name: string): string | null {
  const words = coreCompanyTokens(name);
  let end = words.length;
  let changed = false;
  for (let guard = 0; guard < 3 && end > 1; guard++) {
    let hit = 0;
    for (let k = Math.min(3, end - 1); k >= 1; k--) {
      if (isQualifierPhrase(words.slice(end - k, end))) {
        hit = k;
        break;
      }
    }
    if (!hit || CONNECTORS.has(words[end - hit - 1])) break;
    end -= hit;
    changed = true;
  }
  if (!changed) return null;
  const rest = words.slice(0, end);
  if (rest.length === 1 && (GENERIC_BRAND_WORDS.has(rest[0]) || rest[0].length < 3)) return null;
  const key = capKey(rest.join(' '));
  return key.replace(/ /g, '').length >= 3 ? key : null;
}

/** Compact form ("acme corp" → "acmecorp") used to compare names with slugs and domains. */
export function compactKey(s: string): string {
  return fold(s).replace(/[^\p{L}\p{N}]/gu, '');
}

/**
 * Stored key of an ATS board slug ("acme-corp" on Greenhouse → "greenhouse:acmecorp"). The
 * platform qualifies the slug because different boards reuse the same short slugs.
 */
export function normalizeAtsSlug(slug: string, platform?: string | null): string | null {
  const s = compactKey(String(slug ?? '')).slice(0, 150);
  if (s.length < 2) return null;
  const p = platform ? compactKey(platform).slice(0, 30) : '';
  return p ? `${p}:${s}` : s;
}

/**
 * Placeholder names that do not identify one employer ("Confidential", "Our client", "Stealth
 * startup"). Jobs under them are never treated as "same company" by de-duplication.
 */
const PLACEHOLDER_KEYS: ReadonlySet<string> = new Set(
  [
  'confidential', 'confidential company', 'company confidential', 'confidential employer', 'confidential client',
  'anonymous', 'anonymous company', 'anonymous employer', 'undisclosed', 'undisclosed company', 'undisclosed client',
  'undisclosed employer', 'private', 'private company', 'private employer', 'stealth', 'stealth startup',
  'stealth mode startup', 'stealth company', 'our client', 'client', 'a client', 'leading company', 'unknown',
  'unknown company', 'not specified', 'n a', 'na', 'none', 'various', 'various employers', 'multiple companies',
  'vertraulich', 'anonym', 'anonymes unternehmen', 'unser kunde', 'unser mandant', 'namhaftes unternehmen',
  'entreprise confidentielle', 'confidentiel', 'notre client', 'client confidentiel', 'vertrouwelijk', 'onze klant',
  'confidencial', 'empresa confidencial', 'nuestro cliente', 'riservato', 'azienda riservata', 'nostro cliente',
  'poufne', 'fortrolig', 'konfidentiell', 'luottamuksellinen', 'unknown company name', 'hidden', 'hidden company',
  'company', 'employer', 'recruiter', 'n/a', 'tbd', 'tba', 'nicht angegeben', 'non communique', 'non specifie',
  ].map((k) => fold(k).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()),
);

export function isPlaceholderCompanyName(name: string): boolean {
  const key = companyFullKey(name);
  if (!key) return true;
  return PLACEHOLDER_KEYS.has(key) || PLACEHOLDER_KEYS.has(normalizeCompanyName(name));
}
