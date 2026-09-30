/**
 * Salary parsing and estimation (spec §10 "Salary — the most error-prone field"). Pure.
 *
 * - Structured connector data (`salaryHint`) wins over text; text is scanned for currency-anchored
 *   amounts: "€45k", "45.000 €", "45,000 EUR", "45 000 zł", "CHF 120'000", "60-70.000 €",
 *   "between $90,000 and $110,000", "ab 60.000 € brutto/Jahr", "RAL 35.000", "600万円".
 * - Period (hour/day/month/year), gross/net, B2B invoice rates, open ranges ("up to", "ab") and
 *   stated payment counts ("14 Gehälter", "13 mensilità") are detected in EN/DE/FR/NL/ES/IT/PT/
 *   PL/SV/DA/NO/FI/CS/HU/RO.
 * - Monthly figures are annualised with the posting's stated payment count, else the country's
 *   customary one (AT/PT/GR 14, IT 13, BE 13.92, NL 12.96), and labelled via `installments`.
 * - Converted to EUR with the ECB table (pegs for AED/SAR/QAR); the rate and its date are stored.
 * - Sanity checks catch annual/monthly mix-ups and non-salary amounts (budgets, funding, bonuses).
 *
 * `analyzeSalary` returns the fact plus flags explaining every inference; `parseSalary` returns the
 * fact only. Estimates (`estimateSalary`) are kind 'estimated', method 'estimate', never mixed in.
 */
import type { FxTable, NormalizedJob, SalaryPeriod, SalaryValue } from '../contracts/jobs';
import { lowerConfidence, type Confidence, type Fact } from '../contracts/provenance';
import { countryInfo } from '../../data/places';
import { AMBIGUOUS_SYMBOLS, CURRENCIES, CURRENCY_BY_CODE, KNOWN_CURRENCY_CODES } from '../../data/salary/currencies';
import { ESTIMATES_AS_OF, ESTIMATES_SOURCE, SALARY_ESTIMATES, estimateTrackFor, type CountrySalaryEstimate } from '../../data/salary/estimates';
import { DEFAULT_INSTALLMENTS, installmentRule } from '../../data/salary/installments';
import {
  B2B_PATTERNS,
  EMPLOYMENT_CONTRACT_PATTERNS,
  EXTRA_MONTH_13,
  EXTRA_MONTH_14,
  GROSS_PATTERNS,
  HOLIDAY_ALLOWANCE_INCLUDED,
  INSTALLMENT_PATTERNS,
  NET_PATTERNS,
  NON_SALARY_CONTEXT,
  OPEN_MAX_PATTERNS,
  OPEN_MIN_PATTERNS,
  PERIOD_PATTERNS,
  SALARY_KEYWORDS,
} from '../../data/salary/vocab';
import { lookupRate } from '../fx/rates';
import { collapseWhitespace, escapeRegExp, quoteAround } from './text';

export const SALARY_LOGIC_VERSION = 'salary@2026-09-29.1';

/** Working time used to annualise hourly and daily rates. */
export const HOURS_PER_YEAR = 1760;
export const DAYS_PER_YEAR = 220;

/** Plausible gross pay in EUR per period; outside these an amount is not a salary (or the period is wrong). */
export const PLAUSIBLE_EUR: Readonly<Record<SalaryPeriod, readonly [number, number]>> = {
  hour: [5, 500],
  day: [50, 4000],
  month: [300, 30000],
  year: [3000, 800000],
};

export type SalaryFlag =
  | 'period_inferred'
  | 'period_corrected'
  | 'period_from_week'
  | 'currency_inferred'
  | 'currency_ambiguous'
  | 'installments_stated'
  | 'installments_customary'
  | 'range_inverted'
  | 'range_wide'
  | 'open_min'
  | 'open_max'
  | 'implausible'
  | 'fx_missing'
  | 'fx_peg'
  | 'net_amount'
  | 'b2b_invoice'
  | 'ote'
  | 'multiple_amounts'
  | 'hint_text_mismatch';

export interface SalaryAnalysis {
  fact: Fact<SalaryValue>;
  flags: SalaryFlag[];
  /** Human label for the payment count used (e.g. "14 payments (…Austria)"), when annualising a monthly figure. */
  installmentsLabel: string | null;
}

export interface SalaryInput {
  hint?: NormalizedJob['salaryHint'];
  text: string;
  countryIso2: string | null;
}

export interface SalaryOptions {
  now?: Date;
}

// ── Numbers ──────────────────────────────────────────────────────────────────────────────

const MULTIPLIERS: readonly [string, number, string | null][] = [
  ['TEUR', 1e3, 'EUR'], ['kEUR', 1e3, 'EUR'], ['KEUR', 1e3, 'EUR'], ['T€', 1e3, 'EUR'], ['K€', 1e3, 'EUR'], ['k€', 1e3, 'EUR'],
  ['Tsd\\.', 1e3, null], ['tsd\\.', 1e3, null], ['TSD', 1e3, null], ['Tsd', 1e3, null], ['tys\\.', 1e3, null], ['tys', 1e3, null], ['tis\\.', 1e3, null],
  ['mil', 1e3, null], ['mille', 1e3, null], ['k', 1e3, null], ['K', 1e3, null],
  ['Mio\\.', 1e6, null], ['Mio', 1e6, null], ['mio\\.', 1e6, null], ['mio', 1e6, null], ['millions', 1e6, null], ['million', 1e6, null], ['Millionen', 1e6, null],
  ['millones', 1e6, null], ['milioni', 1e6, null], ['milhões', 1e6, null], ['mln', 1e6, null], ['M', 1e6, null],
  ['lakhs', 1e5, null], ['lakh', 1e5, null], ['LPA', 1e5, 'INR'], ['lpa', 1e5, 'INR'], ['万', 1e4, null], ['만', 1e4, null],
];
const MULT_SRC = MULTIPLIERS.map(([m]) => m).join('|');
const MULT_BY_TEXT = new Map(MULTIPLIERS.map(([m, v, c]) => [m.replace(/\\/g, ''), { value: v, currency: c }]));

const NUMBER_RE = new RegExp(
  `(?<![\\p{N}.,'])(?<num>\\d{1,3}(?<sep>[.,' ])\\d{3}(?:\\k<sep>\\d{3})*(?:[.,]\\d{1,2})?|\\d+(?:[.,]\\d{1,2})?)(?![\\p{N}])(?:\\s?(?<mult>${MULT_SRC})(?![\\p{Lu}\\p{Ll}]))?`,
  'gu',
);

/** "45.000" / "45,000" / "45 000" / "45'000" / "45.000,50" / "4,5" → number; null when malformed. */
export function parseLocaleNumber(raw: string): number | null {
  const s = raw.trim();
  const grouped = /^(\d{1,3})((?:([.,' ])\d{3})(?:\3\d{3})*)(?:([.,])(\d{1,2}))?$/.exec(s);
  if (grouped) {
    const groupSep = grouped[3];
    const decSep = grouped[4];
    if (decSep && decSep === groupSep) return null;
    const int = Number(grouped[1] + grouped[2].replace(/[.,' ]/g, ''));
    const dec = grouped[5] ? Number(grouped[5]) / 10 ** grouped[5].length : 0;
    return int + dec;
  }
  const plain = /^(\d+)(?:[.,](\d{1,2}))?$/.exec(s);
  if (plain) return Number(plain[1]) + (plain[2] ? Number(plain[2]) / 10 ** plain[2].length : 0);
  return null;
}

// ── Currency tokens ──────────────────────────────────────────────────────────────────────

interface CurrencyTokenInfo {
  code: string | null;
  ambiguous: boolean;
}

const CI_TOKENS = new Map<string, CurrencyTokenInfo>();
const CS_TOKENS = new Map<string, CurrencyTokenInfo>();
for (const c of CURRENCIES) {
  for (const s of c.symbols) CI_TOKENS.set(s.toLowerCase(), { code: c.code, ambiguous: false });
  for (const w of c.words) CI_TOKENS.set(w.toLowerCase(), { code: c.code, ambiguous: false });
  for (const w of c.caseSensitive ?? []) CS_TOKENS.set(w, { code: c.code, ambiguous: false });
}
for (const code of KNOWN_CURRENCY_CODES) CS_TOKENS.set(code, { code, ambiguous: false });
for (const k of Object.keys(AMBIGUOUS_SYMBOLS)) CI_TOKENS.set(k.toLowerCase(), { code: null, ambiguous: true });

const tokenAlt = (keys: Iterable<string>) =>
  [...keys]
    .sort((a, b) => b.length - a.length)
    .map((k) => (/^\p{L}/u.test(k) ? `(?<![\\p{L}])${escapeRegExp(k)}` : escapeRegExp(k)))
    .join('|');
const CI_ALT = tokenAlt(CI_TOKENS.keys());
const CS_ALT = tokenAlt(CS_TOKENS.keys());
const CUR_BEFORE_CI = new RegExp(`(?:${CI_ALT})\\.?\\s?$`, 'iu');
const CUR_BEFORE_CS = new RegExp(`(?:${CS_ALT})\\.?\\s?$`, 'u');
const CUR_AFTER_CI = new RegExp(`^(?:,-{1,2}|\\.-|,–)?\\s?(?:${CI_ALT})(?![\\p{L}])`, 'iu');
const CUR_AFTER_CS = new RegExp(`^(?:,-{1,2}|\\.-|,–)?\\s?(?:${CS_ALT})(?![\\p{L}])`, 'u');

function resolveToken(token: string, countryIso2: string | null): { code: string | null; ambiguous: boolean } {
  const t = token.replace(/\.$/, '').trim();
  const cs = CS_TOKENS.get(t) ?? CS_TOKENS.get(token.trim());
  if (cs) return { code: cs.code, ambiguous: false };
  const key = token.trim().toLowerCase();
  const amb = AMBIGUOUS_SYMBOLS[key] ?? AMBIGUOUS_SYMBOLS[key.replace(/\.$/, '')];
  if (amb) {
    const byCountry = countryIso2 ? amb.byCountry[countryIso2] : undefined;
    if (byCountry) return { code: byCountry, ambiguous: false };
    return { code: amb.fallback, ambiguous: true };
  }
  const ci = CI_TOKENS.get(key) ?? CI_TOKENS.get(key.replace(/\.$/, ''));
  return { code: ci?.code ?? null, ambiguous: false };
}

function currencyBefore(t: string, start: number): { token: string; from: number } | null {
  const window = t.slice(Math.max(0, start - 14), start);
  const m = CUR_BEFORE_CS.exec(window) ?? CUR_BEFORE_CI.exec(window);
  if (!m) return null;
  return { token: m[0].replace(/\s+$/, ''), from: start - window.length + m.index };
}

function currencyAfter(t: string, end: number): { token: string; to: number } | null {
  const window = t.slice(end, end + 24);
  const m = CUR_AFTER_CS.exec(window) ?? CUR_AFTER_CI.exec(window);
  if (!m) return null;
  return { token: m[0].replace(/^(?:,-{1,2}|\.-|,–)?\s?/, ''), to: end + m[0].length };
}

// ── Vocabulary regexes ───────────────────────────────────────────────────────────────────

const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';
const words = (xs: readonly string[]) => xs.map((x) => x.replace(/ /g, '\\s+')).join('|');
const wordRe = (xs: readonly string[], flags = 'iu') => new RegExp(`${B}(?:${words(xs)})${E}`, flags);

const PERIOD_RES: readonly [SalaryPeriod, RegExp][] = (Object.keys(PERIOD_PATTERNS) as SalaryPeriod[]).map((p) => [
  p,
  new RegExp(`(?:${B}|(?=/))(?:${words(PERIOD_PATTERNS[p])})(?![\\p{L}])`, 'giu'),
]);
const GROSS_RE = wordRe(GROSS_PATTERNS);
// ".NET" is a framework, not take-home pay.
const NET_RE = new RegExp(`(?<![\\p{L}\\p{N}.])(?:${words(NET_PATTERNS)})${E}`, 'iu');
const B2B_RE = new RegExp(`(?:${B}|(?=\\+))(?:${words(B2B_PATTERNS)})${E}`, 'iu');
const EMPLOYMENT_RE = wordRe(EMPLOYMENT_CONTRACT_PATTERNS);
const KEYWORD_RE = wordRe(SALARY_KEYWORDS);
const NON_SALARY_G = new RegExp(`${B}(?:${words(NON_SALARY_CONTEXT)})${E}`, 'giu');
const KEYWORD_G = new RegExp(`${B}(?:${words(SALARY_KEYWORDS)})${E}`, 'giu');
/** "€50M in funding", "€1,000 signing bonus", "€500 learning budget": the word right after the amount. */
const NON_SALARY_AFTER_RE = new RegExp(
  `^\\s*(?:[-–:]\\s*)?(?:(?!(?:plus|and|und|et|y|e|with|mit|avec|con|com|og|och|oraz|i|a|en)\\s)\\p{L}+\\s+){0,2}(?:${words(NON_SALARY_CONTEXT)})${E}`,
  'iu',
);
const OTE_RE = /(?<![\p{L}])(?:OTE|on[- ]target earnings)(?![\p{L}])/u;
/** "£75k + bonus", "$150k plus equity": a figure followed by the usual pay extras is pay itself. */
const CONTRACT_LABEL_RE = /(?<![\p{L}])(?:uop|b2b|umowa o pracę|hpp|ičo|cdi|freelance|contract(?:or)?)\s*[:=-]?\s*$/iu;
const PAY_EXTRAS_AFTER_RE = /^\s*(?:[a-z]{0,6}\s+)?(?:\+|plus|and|und|&|\+\s*)\s*(?:(?:annual|yearly|performance|target|variable)\s+)?(?:bonus|bonuses|benefits|equity|stock|commission|provision|prämie|variable)/iu;
const OPEN_MAX_RE = new RegExp(`${B}(?:${words(OPEN_MAX_PATTERNS)})\\s*$`, 'iu');
const OPEN_MIN_RE = new RegExp(`${B}(?:${words(OPEN_MIN_PATTERNS)})\\s*$`, 'iu');
const BETWEEN_RE = /(?<![\p{L}])(?:between|zwischen|entre|tra|fra|tussen|mellan|mellem|między|pomiędzy|välillä|mezi)\s*$/iu;
const PERIOD_PREFIX_RE = new RegExp(
  `^\\s*(?:(?:${words(GROSS_PATTERNS)})\\s*)?(?:${Object.values(PERIOD_PATTERNS).flat().map((x) => x.replace(/ /g, '\\s+')).join('|')})(?![\\p{L}])`,
  'iu',
);
const RANGE_SEP_RE = /^\s*(?:-{1,2}|–|—|~|to|bis|à|a|au|tot|till|til|do|até|ate|al|hasta|-\s*bis)\s*$/iu;
const AND_SEP_RE = /^\s*(?:and|und|et|y|e|en|och|og|i|ja|a)\s*$/iu;
const INSTALLMENT_RES = INSTALLMENT_PATTERNS.map((p) => new RegExp(p.startsWith('(?<=') ? p : `${B}${p}`, 'iu'));
const EXTRA_13_RE = new RegExp(`${B}(?:${EXTRA_MONTH_13})${E}`, 'iu');
const EXTRA_14_RE = new RegExp(`${B}(?:${EXTRA_MONTH_14})${E}`, 'iu');
const HOLIDAY_INCLUDED_RE = new RegExp(`${B}${HOLIDAY_ALLOWANCE_INCLUDED}`, 'iu');

// ── Scanning ─────────────────────────────────────────────────────────────────────────────

interface AmountToken {
  start: number;
  end: number;
  numStart: number;
  numEnd: number;
  value: number;
  multiplier: number;
  grouped: boolean;
  currencyToken: string | null;
  currency: string | null;
  currencyAmbiguous: boolean;
  /** Period implied by the multiplier itself ("12 LPA" = lakh per annum). */
  periodHint: SalaryPeriod | null;
}

export interface SalaryMention {
  start: number;
  end: number;
  min: number | null;
  max: number | null;
  currency: string | null;
  currencyExplicit: boolean;
  currencyAmbiguous: boolean;
  period: SalaryPeriod | null;
  grossNet: SalaryValue['grossNet'];
  b2b: boolean;
  employment: boolean;
  keyword: boolean;
  /** Grouped ("45.000") or multiplied ("45k") number, i.e. clearly a money-sized figure. */
  sized: boolean;
  nonSalaryContext: boolean;
  ote: boolean;
  openMin: boolean;
  openMax: boolean;
  inverted: boolean;
  quote: string;
}

/** Index-preserving cleanup (same length) so quotes can be cut from the original. */
function prep(s: string): string {
  return s
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u00a0\u2002\u2003\u2007\u2009\u202f]/g, ' ')
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/[\u301c\uff5e]/g, '~');
}

function lastIndexOfMatch(re: RegExp, s: string): number {
  re.lastIndex = 0;
  let last = -1;
  for (let m = re.exec(s); m; m = re.exec(s)) {
    last = m.index;
    if (m[0].length === 0) re.lastIndex++;
  }
  return last;
}

/** Numbers scanned per posting; far above any real posting, a bound for pathological input. */
const MAX_TOKENS = 4000;

function tokens(t: string, countryIso2: string | null): AmountToken[] {
  const out: AmountToken[] = [];
  NUMBER_RE.lastIndex = 0;
  for (let m = NUMBER_RE.exec(t); m && out.length < MAX_TOKENS; m = NUMBER_RE.exec(t)) {
    const numText = m.groups?.num ?? '';
    const base = parseLocaleNumber(numText);
    if (base === null) continue;
    const multText = m.groups?.mult ?? null;
    const mult = multText ? MULT_BY_TEXT.get(multText) ?? null : null;
    const numStart = m.index;
    const numEnd = m.index + numText.length;
    const end0 = m.index + m[0].length;
    let currencyToken: string | null = null;
    let start = numStart;
    let end = end0;
    const before = currencyBefore(t, numStart);
    // Digits glued to letters ("B2B", "ISO27001", "S3") are not amounts unless the letters are a currency ("EUR45k").
    if (numStart > 0 && /\p{L}/u.test(t[numStart - 1]) && !(before && before.from + before.token.length === numStart)) continue;
    const after = currencyAfter(t, end0);
    if (mult?.currency) currencyToken = mult.currency;
    else if (before) {
      currencyToken = before.token;
      start = before.from;
    } else if (after) {
      currencyToken = after.token;
      end = after.to;
    }
    if (mult?.currency && after) end = after.to;
    const resolved = currencyToken ? resolveToken(currencyToken, countryIso2) : { code: null, ambiguous: false };
    out.push({
      start,
      end,
      numStart,
      numEnd,
      value: base * (mult?.value ?? 1),
      multiplier: mult?.value ?? 1,
      grouped: /[.,' ]\d{3}/.test(numText),
      currencyToken,
      currency: resolved.code,
      currencyAmbiguous: resolved.ambiguous,
      periodHint: multText && /^lpa$/i.test(multText) ? 'year' : null,
    });
  }
  return out;
}

function lineBounds(t: string, start: number, end: number): [number, number] {
  let a = start;
  while (a > 0 && !/[\n;•|]/.test(t[a - 1]) && start - a < 160) a--;
  let b = end;
  while (b < t.length && !/[\n;•|]/.test(t[b]) && b - end < 160) b++;
  return [a, b];
}

function previousLine(t: string, lineStart: number): string {
  if (lineStart <= 0) return '';
  const prevEnd = lineStart - 1;
  let a = prevEnd;
  while (a > 0 && t[a - 1] !== '\n' && prevEnd - a < 120) a--;
  return t.slice(a, prevEnd);
}

function nearestPeriod(s: string, fromEnd: boolean): SalaryPeriod | null {
  let best: { p: SalaryPeriod; pos: number } | null = null;
  for (const [p, re] of PERIOD_RES) {
    re.lastIndex = 0;
    for (let m = re.exec(s); m; m = re.exec(s)) {
      const pos = fromEnd ? s.length - (m.index + m[0].length) : m.index;
      if (!best || pos < best.pos) best = { p, pos };
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return best && best.pos <= (fromEnd ? 50 : 45) ? best.p : null;
}

function grossNetOf(s: string): SalaryValue['grossNet'] {
  const g = GROSS_RE.exec(s);
  const n = NET_RE.exec(s);
  if (g && !n) return 'gross';
  if (n && !g) return 'net';
  if (g && n) return g.index <= n.index ? 'gross' : 'net';
  return 'unknown';
}

/** All salary-like amounts in the text with their context (exported for tests and review UIs). */
export function findSalaryMentions(text: string, countryIso2: string | null = null): SalaryMention[] {
  const original = String(text ?? '').slice(0, 60_000);
  const t = prep(original);
  const spans = pairRanges(t, tokens(t, countryIso2));
  const mentions: SalaryMention[] = [];
  for (let i = 0; i < spans.length; i++) {
    const { a, b, lo, hi, start, end } = spans[i];
    const [ls, le] = lineBounds(t, start, end);
    // Wording between two amounts is split at the separator ("…brutto (UoP) lub 18 000…",
    // "…€60k, bonus €10k"), so one amount's labels are not attributed to its neighbour.
    const prev = spans[i - 1];
    const next = spans[i + 1];
    const clipStart = prev && prev.end > ls ? prev.end + clauseSplit(t.slice(prev.end, start)).nextFrom : ls;
    const clipEnd = next && next.start < le ? end + clauseSplit(t.slice(end, next.start)).prevTo : le;
    const pre = t.slice(clipStart, start);
    const post = t.slice(end, clipEnd);
    const linePre = t.slice(ls, start);
    const keywordScope = linePre.replace(/[^\p{L}]/gu, '').length < 3 ? `${previousLine(t, ls)} ${linePre}` : linePre;
    const period = a.periodHint ?? b?.periodHint ?? nearestPeriod(post.slice(0, 60), false) ?? nearestPeriod(pre.slice(-60), true);
    const preNear = pre.slice(-50);
    const nonSalaryAt = lastIndexOfMatch(NON_SALARY_G, preNear);
    const nonSalaryContext = (nonSalaryAt >= 0 && nonSalaryAt > lastIndexOfMatch(KEYWORD_G, preNear)) || NON_SALARY_AFTER_RE.test(post);
    const postNear = post.slice(0, 50);
    const preCtx = pre.slice(-60);
    const openMax = !b && OPEN_MAX_RE.test(pre.slice(-24));
    const openMin = !b && !openMax && OPEN_MIN_RE.test(pre.slice(-64));
    const currencyTok = a.currency || a.currencyToken ? a : b && (b.currency || b.currencyToken) ? b : null;
    const currency = currencyTok?.currency ?? null;
    let min: number | null = lo;
    let max: number | null = hi ?? lo;
    let inverted = false;
    if (hi !== null && lo > hi) {
      inverted = true;
      min = hi;
      max = lo;
    }
    if (openMax) min = null;
    if (openMin) max = null;
    // Contract type is read after the amount first ("… zł netto + VAT (B2B)"), then before ("B2B: …").
    const b2bAfter = B2B_RE.test(postNear);
    const employmentAfter = EMPLOYMENT_RE.test(postNear);
    const contractAfter = b2bAfter || employmentAfter;
    const grossNetAfter = grossNetOf(postNear);
    mentions.push({
      start,
      end,
      min,
      max,
      currency,
      currencyExplicit: Boolean(currency) && !currencyTok?.currencyAmbiguous,
      currencyAmbiguous: Boolean(currencyTok?.currencyAmbiguous),
      period,
      grossNet: grossNetAfter !== 'unknown' ? grossNetAfter : grossNetOf(preCtx),
      b2b: contractAfter ? b2bAfter : B2B_RE.test(preCtx),
      employment: contractAfter ? employmentAfter : EMPLOYMENT_RE.test(preCtx),
      // "UoP: 15 000 zł", "B2B: 18 000 zł": a contract label is as good as a pay word.
      keyword:
        KEYWORD_RE.test(keywordScope) ||
        KEYWORD_RE.test(post.slice(0, 30)) ||
        PAY_EXTRAS_AFTER_RE.test(post) ||
        CONTRACT_LABEL_RE.test(pre.slice(-12)),
      sized: a.grouped || a.multiplier > 1 || Boolean(b && (b.grouped || b.multiplier > 1)) || lo >= 1000,
      nonSalaryContext,
      ote: OTE_RE.test(`${preCtx.slice(-20)} ${postNear.slice(0, 20)}`),
      openMin,
      openMax,
      inverted,
      quote: quoteAround(original, start, end, 160),
    });
  }
  return mentions;
}

interface Span {
  a: AmountToken;
  b: AmountToken | null;
  lo: number;
  hi: number | null;
  start: number;
  end: number;
}

/** Pair adjacent amounts into ranges ("45.000 - 55.000 €", "between $90k and $110k", "60-70k"). */
function pairRanges(t: string, toks: AmountToken[]): Span[] {
  const spans: Span[] = [];
  for (let i = 0; i < toks.length; i++) {
    const a = toks[i];
    let b: AmountToken | null = null;
    const next = toks[i + 1];
    if (next) {
      // "€4,000/month - €5,000/month": a period word may sit between the two ends of a range.
      const between = t.slice(a.end, next.start).replace(PERIOD_PREFIX_RE, '');
      const compatible = !a.currency || !next.currency || a.currency === next.currency;
      const isRange = RANGE_SEP_RE.test(between) || (AND_SEP_RE.test(between) && BETWEEN_RE.test(t.slice(Math.max(0, a.start - 14), a.start)));
      if (compatible && isRange) b = next;
    }
    let lo = a.value;
    let hi: number | null = null;
    if (b) {
      hi = b.value;
      // "60-70.000 €", "60 - 70k": the first number borrows the second's scale.
      if (lo < 1000 && hi >= 1000 && a.multiplier === 1) {
        const factor = b.multiplier > 1 ? b.multiplier : 1000;
        if (lo * factor <= hi * 1.01 && lo * factor >= hi / 4) lo *= factor;
      }
      // Not one range: "2 - 70.000", "70.000 - 3".
      if (lo < hi / 4 || hi < lo / 3) {
        b = null;
        hi = null;
        lo = a.value;
      }
    }
    spans.push({ a, b, lo, hi, start: a.start, end: b ? b.end : a.end });
    if (b) i++;
  }
  return spans;
}

const CLAUSE_SEP_RE = /[,;(|/]|\s(?:or|oder|ou|o|lub|albo|nebo|eller|of|oppure|vagy|sau)\s|\s[-–]\s/giu;

/** Where the text between two amounts splits: [0, prevTo) belongs to the first, [nextFrom, end) to the second. */
function clauseSplit(gap: string): { prevTo: number; nextFrom: number } {
  CLAUSE_SEP_RE.lastIndex = 0;
  let last: RegExpExecArray | null = null;
  for (let m = CLAUSE_SEP_RE.exec(gap); m; m = CLAUSE_SEP_RE.exec(gap)) last = m;
  if (!last) return { prevTo: gap.length, nextFrom: 0 };
  return { prevTo: last.index, nextFrom: last.index + last[0].length };
}

// ── Periods, installments, conversion ────────────────────────────────────────────────────

/** Hint period strings from connectors ("YEAR", "per_month", "hourly", "annual", "Jahr" …). */
export function normalizePeriodWord(raw: string | null | undefined): SalaryPeriod | 'week' | null {
  const s = String(raw ?? '').trim().toLowerCase().replace(/[_-]+/g, ' ');
  if (!s) return null;
  if (/^(?:y|yr|year|years|yearly|annual|annually|annum|per (?:year|annum)|p\.?a\.?|jahr|jährlich|an|année|annuel|año|anual|anno|annuo|ano|jaar|år|rok|salary)$/.test(s)) return 'year';
  if (/^(?:m|mo|mth|month|months|monthly|per month|monat|monatlich|mois|mensuel|mes|mensual|mese|mensile|mês|mensal|maand|månad|måned|miesiąc|miesięcznie)$/.test(s)) return 'month';
  if (/^(?:w|wk|week|weeks|weekly|per week|woche|wöchentlich|semaine|semana|settimana|week|vecka|uge|tydzień)$/.test(s)) return 'week';
  if (/^(?:d|day|days|daily|per day|tag|täglich|jour|día|dia|giorno|dag|dzień)$/.test(s)) return 'day';
  if (/^(?:h|hr|hour|hours|hourly|per hour|stunde|stündlich|heure|hora|ora|uur|timme|time|godzina)$/.test(s)) return 'hour';
  return null;
}

/** Payments per year stated anywhere in the posting ("14 Gehälter", "(14x)", "13th month salary"). */
export function statedInstallments(text: string): number | null {
  const t = prep(String(text ?? '').slice(0, 60_000));
  for (const re of INSTALLMENT_RES) {
    const m = re.exec(t);
    const n = m?.groups?.n ? Number(m.groups.n) : null;
    if (n && n >= 12 && n <= 16) return n;
  }
  if (EXTRA_14_RE.test(t)) return 14;
  if (EXTRA_13_RE.test(t)) return 13;
  return null;
}

/** Amount per year for a stated period. */
export function annualize(amount: number, period: SalaryPeriod, installments: number | null = null): number {
  switch (period) {
    case 'year':
      return amount;
    case 'month':
      return amount * (installments ?? DEFAULT_INSTALLMENTS);
    case 'day':
      return amount * DAYS_PER_YEAR;
    case 'hour':
      return amount * HOURS_PER_YEAR;
  }
}

/** Rough EUR value used only for plausibility when no FX rate exists. */
function roughEur(amount: number, currency: string, fx: FxTable): number | null {
  const r = lookupRate(fx, currency);
  if (r) return amount / r.rate;
  const info = CURRENCY_BY_CODE.get(currency);
  return info ? amount / info.magnitudePerEur : null;
}

function plausible(eur: number, period: SalaryPeriod): boolean {
  const [lo, hi] = PLAUSIBLE_EUR[period];
  return eur >= lo && eur <= hi;
}

/** Period from magnitude when the posting does not say (EUR-equivalent of the lower amount). */
export function inferPeriod(eurAmount: number): SalaryPeriod | null {
  if (eurAmount >= 12000) return eurAmount <= PLAUSIBLE_EUR.year[1] ? 'year' : null;
  if (eurAmount >= 700) return 'month';
  if (eurAmount >= 150) return 'day';
  if (eurAmount >= PLAUSIBLE_EUR.hour[0]) return 'hour';
  return null;
}

function countryCurrency(countryIso2: string | null): string | null {
  return countryInfo(countryIso2)?.currency ?? null;
}

interface BuildInput {
  min: number | null;
  max: number | null;
  currency: string;
  period: SalaryPeriod | null;
  grossNet: SalaryValue['grossNet'];
  countryIso2: string | null;
  statedInstallments: number | null;
  holidayIncluded: boolean;
  flags: Set<SalaryFlag>;
}

interface Built {
  value: SalaryValue;
  installmentsLabel: string | null;
  plausible: boolean;
}

function build(inp: BuildInput, fx: FxTable): Built | null {
  const { flags } = inp;
  const ref = inp.min ?? inp.max;
  if (ref === null || ref <= 0) return null;
  const eurRef = roughEur(ref, inp.currency, fx);
  let period = inp.period;
  if (!period) {
    period = eurRef === null ? null : inferPeriod(eurRef);
    if (!period) return null;
    flags.add('period_inferred');
  } else if (eurRef !== null && !plausible(eurRef, period)) {
    // Period word misread or misused ("€60,000 per month", "€2,500 per year"): trust the magnitude.
    const corrected = inferPeriod(eurRef);
    if (corrected && corrected !== period && plausible(eurRef, corrected)) {
      period = corrected;
      flags.add('period_corrected');
    } else {
      flags.add('implausible');
    }
  }
  let installments: number | null = null;
  let installmentsLabel: string | null = null;
  if (period === 'month') {
    if (inp.statedInstallments) {
      installments = inp.statedInstallments;
      installmentsLabel = `${installments} payments (stated in the posting)`;
      flags.add('installments_stated');
    } else {
      const rule = installmentRule(inp.countryIso2);
      if (rule && !(inp.countryIso2 === 'NL' && inp.holidayIncluded)) {
        installments = rule.count;
        installmentsLabel = rule.label;
        flags.add('installments_customary');
      } else {
        installments = DEFAULT_INSTALLMENTS;
        installmentsLabel = `${DEFAULT_INSTALLMENTS} payments`;
      }
    }
  } else if (inp.statedInstallments) {
    installments = inp.statedInstallments;
  }
  let { min, max } = inp;
  if (min !== null && max !== null && min > max) {
    [min, max] = [max, min];
    flags.add('range_inverted');
  }
  if (min !== null && max !== null && max > min * 2.5) flags.add('range_wide');
  const rate = lookupRate(fx, inp.currency);
  if (!rate) flags.add('fx_missing');
  else if (rate.source === 'usd_peg') flags.add('fx_peg');
  const toAnnualEur = (v: number | null) => (v === null || !rate ? null : Math.round(annualize(v, period, installments) / rate.rate));
  const annualEurMin = toAnnualEur(min);
  const annualEurMax = toAnnualEur(max);
  const eurCheck = annualEurMin ?? annualEurMax;
  const isPlausible = !flags.has('implausible') && (eurCheck === null || plausible(eurCheck, 'year'));
  if (!isPlausible) flags.add('implausible');
  const value: SalaryValue = {
    min: min === null ? null : roundMoney(min),
    max: max === null ? null : roundMoney(max),
    currency: inp.currency,
    period,
    grossNet: inp.grossNet,
    installments,
    annualEurMin,
    annualEurMax,
    fxRate: rate ? rate.rate : null,
    fxDate: rate ? rate.date : null,
    kind: 'stated',
  };
  return { value, installmentsLabel, plausible: isPlausible };
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

// ── Mention selection ────────────────────────────────────────────────────────────────────

interface Candidate {
  mention: SalaryMention;
  built: Built;
  flags: Set<SalaryFlag>;
  score: number;
  currencyInferred: boolean;
}

const YEARLIKE = (n: number) => Number.isInteger(n) && n >= 1900 && n <= 2100;

function candidateFrom(m: SalaryMention, input: SalaryInput, fx: FxTable, installments: number | null, holidayIncluded: boolean): Candidate | null {
  const flags = new Set<SalaryFlag>();
  let currency = m.currency;
  let currencyInferred = false;
  if (m.nonSalaryContext) return null;
  if (!currency) {
    // Amounts without a currency only count when clearly labelled as pay.
    const ref = m.min ?? m.max ?? 0;
    const strongNumber = m.sized && !(YEARLIKE(ref) && (m.min === null || m.max === null || m.min === m.max));
    if (!m.keyword || !strongNumber) return null;
    currency = countryCurrency(input.countryIso2);
    if (!currency) return null;
    currencyInferred = true;
    flags.add('currency_inferred');
  }
  if (m.currencyAmbiguous) flags.add('currency_ambiguous');
  let grossNet = m.grossNet;
  if (m.b2b) {
    flags.add('b2b_invoice');
    // "netto + VAT" on a B2B invoice is before income tax: neither gross salary nor take-home pay.
    if (grossNet === 'net') grossNet = 'unknown';
  }
  if (grossNet === 'net') flags.add('net_amount');
  if (m.ote) flags.add('ote');
  if (m.openMin) flags.add('open_min');
  if (m.openMax) flags.add('open_max');
  if (m.inverted) flags.add('range_inverted');
  const built = build(
    { min: m.min, max: m.max, currency, period: m.period, grossNet, countryIso2: input.countryIso2, statedInstallments: installments, holidayIncluded, flags },
    fx,
  );
  if (!built) return null;
  // Without a pay word, an amount whose stated period had to be corrected is not a salary.
  if ((!built.plausible || flags.has('period_corrected')) && !m.keyword) return null;
  let score = 0;
  if (!currencyInferred) score += 4;
  if (m.keyword) score += 3;
  if (m.period) score += 2;
  if (m.max !== null && m.min !== null && m.max !== m.min) score += 1;
  if (m.grossNet !== 'unknown') score += 1;
  if (m.employment) score += 1;
  if (m.b2b) score -= 1;
  // "OTE €90k (base €60k)": the guaranteed base is the salary.
  if (m.ote) score -= 1;
  if (!built.plausible) score -= 4;
  if (built.value.period === 'year') score += 0.5;
  // Bare currency amounts need at least one salary signal.
  if (!m.keyword && !m.period && !(m.max !== null && m.min !== null && m.max !== m.min)) return null;
  return { mention: m, built, flags, score, currencyInferred };
}

function annualEurMid(v: SalaryValue): number | null {
  const a = v.annualEurMin ?? v.annualEurMax;
  const b = v.annualEurMax ?? v.annualEurMin;
  return a === null || b === null ? null : (a + b) / 2;
}

function confidenceFor(c: Candidate): Confidence {
  let conf: Confidence = 'high';
  if (!c.mention.period) conf = lowerConfidence(conf);
  if (!c.mention.keyword) conf = lowerConfidence(conf);
  if (c.currencyInferred || c.flags.has('currency_ambiguous')) conf = lowerConfidence(conf);
  if (c.flags.has('implausible') || c.flags.has('period_corrected') || c.flags.has('multiple_amounts')) conf = 'low';
  return conf;
}

function hintAnalysis(input: SalaryInput, fx: FxTable, now: Date, installments: number | null, holidayIncluded: boolean): SalaryAnalysis | null {
  const hint = input.hint;
  if (!hint) return null;
  const hmin = typeof hint.min === 'number' && Number.isFinite(hint.min) && hint.min > 0 ? hint.min : null;
  const hmax = typeof hint.max === 'number' && Number.isFinite(hint.max) && hint.max > 0 ? hint.max : null;
  const raw = collapseWhitespace(String(hint.raw ?? ''));
  if (hmin === null && hmax === null) {
    if (!raw) return null;
    const fromRaw = textAnalysis({ ...input, text: raw }, fx, now, installments, holidayIncluded, true);
    if (!fromRaw) return null;
    return { ...fromRaw, fact: { ...fromRaw.fact, source: 'posting data', method: 'posting' } };
  }
  const flags = new Set<SalaryFlag>();
  const rawMention = raw ? findSalaryMentions(raw, input.countryIso2)[0] ?? null : null;
  let currency: string | null = null;
  if (hint.currency) {
    const c = hint.currency.trim();
    currency = KNOWN_CURRENCY_CODES.has(c.toUpperCase()) ? c.toUpperCase() : resolveToken(c, input.countryIso2).code;
  }
  if (!currency && rawMention?.currency) currency = rawMention.currency;
  if (!currency) {
    currency = countryCurrency(input.countryIso2);
    if (!currency) return null;
    flags.add('currency_inferred');
  }
  let period: SalaryPeriod | null = null;
  let min = hmin;
  let max = hmax;
  const p = normalizePeriodWord(hint.period) ?? rawMention?.period ?? null;
  if (p === 'week') {
    min = min === null ? null : min * 52;
    max = max === null ? null : max * 52;
    period = 'year';
    flags.add('period_from_week');
  } else period = p;
  const grossNet = raw ? grossNetOf(raw) : 'unknown';
  if (grossNet === 'net') flags.add('net_amount');
  if (min === null && max !== null) flags.add('open_max');
  if (max === null && min !== null) flags.add('open_min');
  const built = build({ min, max: max ?? null, currency, period, grossNet, countryIso2: input.countryIso2, statedInstallments: installments, holidayIncluded, flags }, fx);
  if (!built) return null;
  let conf: Confidence = 'high';
  if (flags.has('period_inferred')) conf = lowerConfidence(conf);
  if (flags.has('currency_inferred')) conf = lowerConfidence(conf);
  if (flags.has('implausible') || flags.has('period_corrected')) conf = 'low';
  const textResult = textAnalysis(input, fx, now, installments, holidayIncluded, false);
  if (textResult) {
    const a = annualEurMid(textResult.fact.value);
    const b = annualEurMid(built.value);
    if (a !== null && b !== null && Math.abs(a - b) / Math.max(a, b) > 0.2) {
      flags.add('hint_text_mismatch');
      conf = lowerConfidence(conf);
    }
  }
  const evidence = raw || formatSalary(built.value);
  return {
    fact: { value: built.value, evidence: evidence.slice(0, 200), source: 'posting data', method: 'posting', confidence: conf, checkedAt: now, logicVersion: SALARY_LOGIC_VERSION },
    flags: [...flags],
    installmentsLabel: built.installmentsLabel,
  };
}

function textAnalysis(input: SalaryInput, fx: FxTable, now: Date, installments: number | null, holidayIncluded: boolean, lenient: boolean): SalaryAnalysis | null {
  const mentions = findSalaryMentions(input.text, input.countryIso2);
  const candidates: Candidate[] = [];
  for (const m of mentions) {
    const c = candidateFrom(lenient ? { ...m, keyword: true } : m, input, fx, installments, holidayIncluded);
    if (c && c.score >= 5) candidates.push(c);
  }
  if (!candidates.length) return null;
  candidates.sort((x, y) => y.score - x.score || x.mention.start - y.mention.start);
  const best = candidates[0];
  const bestMid = annualEurMid(best.built.value);
  const distinct = candidates.slice(1).some((c) => {
    if (c.score < best.score - 2 || c.mention.ote !== best.mention.ote) return false;
    const mid = annualEurMid(c.built.value);
    return mid !== null && bestMid !== null && Math.abs(mid - bestMid) / Math.max(mid, bestMid) > 0.15 && c.mention.b2b === best.mention.b2b;
  });
  if (distinct) best.flags.add('multiple_amounts');
  return {
    fact: {
      value: best.built.value,
      evidence: best.mention.quote,
      source: 'posting text',
      method: 'rule',
      confidence: confidenceFor(best),
      checkedAt: now,
      logicVersion: SALARY_LOGIC_VERSION,
    },
    flags: [...best.flags],
    installmentsLabel: best.built.installmentsLabel,
  };
}

/** "45,000–55,000 EUR per year" (for evidence when only structured data exists). */
export function formatSalary(v: Pick<SalaryValue, 'min' | 'max' | 'currency' | 'period'>): string {
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  const range =
    v.min !== null && v.max !== null && v.min !== v.max
      ? `${fmt(v.min)}–${fmt(v.max)}`
      : v.min !== null && v.max === null
        ? `from ${fmt(v.min)}`
        : v.min === null && v.max !== null
          ? `up to ${fmt(v.max)}`
          : fmt((v.min ?? v.max) as number);
  return `${range} ${v.currency} per ${v.period}`;
}

// ── Public API ───────────────────────────────────────────────────────────────────────────

/** Salary with every inference flagged. Hint (connector data) first, then text. Null = no salary stated. */
export function analyzeSalary(input: SalaryInput, fx: FxTable, opts: SalaryOptions = {}): SalaryAnalysis | null {
  const now = opts.now ?? new Date();
  const text = String(input.text ?? '');
  const installments = statedInstallments(`${text}\n${input.hint?.raw ?? ''}`);
  const holidayIncluded = HOLIDAY_INCLUDED_RE.test(text);
  const safeInput: SalaryInput = { ...input, text, countryIso2: input.countryIso2 ? input.countryIso2.toUpperCase() : null };
  return hintAnalysis(safeInput, fx, now, installments, holidayIncluded) ?? textAnalysis(safeInput, fx, now, installments, holidayIncluded, false);
}

export function parseSalary(input: SalaryInput, fx: FxTable, opts: SalaryOptions = {}): Fact<SalaryValue> | null {
  return analyzeSalary(input, fx, opts)?.fact ?? null;
}

export interface EstimateOptions {
  now?: Date;
  /** Override table (tests, or country-guide data). */
  table?: Readonly<Record<string, CountrySalaryEstimate>>;
}

/** Country-average estimate (kind 'estimated', method 'estimate', confidence low). */
export function estimateSalary(countryIso2: string | null, roleKey: string | null, fx: FxTable, opts: EstimateOptions = {}): Fact<SalaryValue> | null {
  if (!countryIso2) return null;
  const iso = countryIso2.toUpperCase();
  const row = (opts.table ?? SALARY_ESTIMATES)[iso];
  if (!row) return null;
  const track = estimateTrackFor(roleKey);
  const [lo, hi] = row[track ?? 'development'];
  const rate = lookupRate(fx, row.currency);
  const value: SalaryValue = {
    min: lo,
    max: hi,
    currency: row.currency,
    period: 'year',
    grossNet: 'gross',
    installments: null,
    annualEurMin: rate ? Math.round(lo / rate.rate) : null,
    annualEurMax: rate ? Math.round(hi / rate.rate) : null,
    fxRate: rate ? rate.rate : null,
    fxDate: rate ? rate.date : null,
    kind: 'estimated',
  };
  const name = countryInfo(iso)?.name ?? iso;
  const what = track === 'security' ? 'security engineering roles' : track === 'development' ? 'software development roles' : 'tech roles (no role-specific figure)';
  return {
    value,
    evidence: `Indicative range for ${what} in ${name}: ${formatSalary(value)}, gross, roughly 2–5 years of experience (${ESTIMATES_SOURCE}, reviewed ${ESTIMATES_AS_OF}).`,
    source: `salary estimates ${ESTIMATES_AS_OF}`,
    method: 'estimate',
    confidence: 'low',
    checkedAt: opts.now ?? new Date(),
    logicVersion: SALARY_LOGIC_VERSION,
  };
}
