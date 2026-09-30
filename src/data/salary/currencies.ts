/**
 * Currencies seen in postings for the spec §4 countries (plus the common non-target ones), with
 * the symbols, codes and words that name them. Matching is case-insensitive except where a token
 * is marked `caseSensitive` (short tokens that collide with words: "Ft", "RM", "SR", "QR", "kr").
 *
 * `magnitudePerEur` is an order-of-magnitude figure (units per 1 EUR, rounded) used ONLY to judge
 * whether an amount is plausibly hourly / monthly / annual when the posting does not say. It is
 * never used to convert money: conversion always uses the ECB table (or an official peg).
 */

export interface CurrencyInfo {
  code: string;
  /** Symbols that unambiguously mean this currency. */
  symbols: readonly string[];
  /** Words and local abbreviations (case-insensitive). */
  words: readonly string[];
  /** Short tokens only matched with this exact casing. */
  caseSensitive?: readonly string[];
  magnitudePerEur: number;
  /** Amounts are usually quoted in millions / ten-thousands (JPY, KRW, HUF, ISK …). */
  largeUnits?: boolean;
}

export const CURRENCIES: readonly CurrencyInfo[] = [
  { code: 'EUR', symbols: ['€'], words: ['eur', 'euro', 'euros', 'evro', 'евро', 'ευρώ', 'eura', 'eurot', 'euroa', 'eurų', 'eiro'], magnitudePerEur: 1 },
  { code: 'USD', symbols: ['US$', 'U$S'], words: ['usd', 'us dollar', 'us dollars', 'dollars us', 'dólares estadounidenses', 'us-dollar'], magnitudePerEur: 1 },
  { code: 'GBP', symbols: ['£'], words: ['gbp', 'pound', 'pounds', 'pounds sterling', 'sterling', 'pfund', 'livres sterling', 'libras'], magnitudePerEur: 1 },
  { code: 'CHF', symbols: ['SFr.', 'SFr'], words: ['chf', 'franken', 'schweizer franken', 'francs suisses', 'franchi', 'swiss francs'], magnitudePerEur: 1 },
  { code: 'CAD', symbols: ['C$', 'CA$', 'CAN$'], words: ['cad', 'canadian dollars', 'dollars canadiens'], magnitudePerEur: 1.5 },
  { code: 'AUD', symbols: ['A$', 'AU$'], words: ['aud', 'australian dollars'], magnitudePerEur: 1.7 },
  { code: 'NZD', symbols: ['NZ$'], words: ['nzd', 'new zealand dollars'], magnitudePerEur: 1.8 },
  { code: 'SGD', symbols: ['S$'], words: ['sgd', 'singapore dollars'], magnitudePerEur: 1.5 },
  { code: 'HKD', symbols: ['HK$'], words: ['hkd', 'hong kong dollars'], magnitudePerEur: 8.5 },
  { code: 'TWD', symbols: ['NT$'], words: ['twd', 'ntd', 'new taiwan dollars', '新台幣'], magnitudePerEur: 35 },
  { code: 'MXN', symbols: ['MX$', 'Mex$'], words: ['mxn', 'pesos mexicanos'], magnitudePerEur: 20 },
  { code: 'BRL', symbols: ['R$'], words: ['brl', 'reais', 'reais brasileiros'], magnitudePerEur: 6 },
  { code: 'SEK', symbols: [], words: ['sek', 'kronor', 'svenska kronor', 'schwedische kronen', 'swedish krona', 'swedish kronor'], magnitudePerEur: 11 },
  { code: 'DKK', symbols: [], words: ['dkk', 'danske kroner', 'dänische kronen', 'danish kroner'], magnitudePerEur: 7.5 },
  { code: 'NOK', symbols: [], words: ['nok', 'norske kroner', 'norwegische kronen', 'norwegian kroner'], magnitudePerEur: 11.5 },
  { code: 'ISK', symbols: [], words: ['isk', 'íslenskar krónur', 'icelandic krona', 'krónur'], magnitudePerEur: 145, largeUnits: true },
  { code: 'PLN', symbols: ['zł'], words: ['pln', 'złotych', 'zlotych', 'złoty', 'zloty', 'zł.', 'zl'], magnitudePerEur: 4.3 },
  { code: 'CZK', symbols: ['Kč'], words: ['czk', 'korun', 'kč/měs', 'czech koruna'], magnitudePerEur: 25 },
  { code: 'HUF', symbols: [], words: ['huf', 'forint'], caseSensitive: ['Ft', 'Ft.'], magnitudePerEur: 400, largeUnits: true },
  { code: 'RON', symbols: [], words: ['lei', 'leu'], caseSensitive: ['RON'], magnitudePerEur: 5 },
  { code: 'BGN', symbols: [], words: ['bgn', 'лв', 'лева', 'leva'], magnitudePerEur: 2 },
  { code: 'JPY', symbols: ['¥', '円'], words: ['jpy', 'yen', 'japanese yen'], magnitudePerEur: 165, largeUnits: true },
  { code: 'CNY', symbols: ['CN¥', 'RMB¥'], words: ['cny', 'rmb', 'yuan', 'renminbi'], magnitudePerEur: 8 },
  { code: 'KRW', symbols: ['₩', '원'], words: ['krw'], magnitudePerEur: 1500, largeUnits: true },
  { code: 'ILS', symbols: ['₪'], words: ['ils', 'nis', 'shekel', 'shekels', 'שקל', 'ש"ח'], magnitudePerEur: 4 },
  { code: 'AED', symbols: ['د.إ'], words: ['aed', 'dirham', 'dirhams', 'dhs'], caseSensitive: ['Dh', 'DH', 'Dhs'], magnitudePerEur: 4 },
  { code: 'SAR', symbols: ['﷼', 'ر.س'], words: ['sar', 'saudi riyal', 'saudi riyals'], caseSensitive: ['SR'], magnitudePerEur: 4 },
  { code: 'QAR', symbols: ['ر.ق'], words: ['qar', 'qatari riyal', 'qatari riyals'], caseSensitive: ['QR'], magnitudePerEur: 4 },
  { code: 'MYR', symbols: [], words: ['myr', 'ringgit'], caseSensitive: ['RM'], magnitudePerEur: 5 },
  { code: 'INR', symbols: ['₹'], words: ['inr', 'rupees', 'rupee', 'lpa'], magnitudePerEur: 95 },
  { code: 'PKR', symbols: [], words: ['pkr'], magnitudePerEur: 310 },
  { code: 'PHP', symbols: ['₱'], words: ['philippine peso', 'philippine pesos'], magnitudePerEur: 63 },
  { code: 'IDR', symbols: [], words: ['idr', 'rupiah'], caseSensitive: ['Rp'], magnitudePerEur: 18000, largeUnits: true },
  { code: 'TRY', symbols: ['₺'], words: ['türk lirası', 'turkish lira'], magnitudePerEur: 45 },
  { code: 'ZAR', symbols: [], words: ['zar'], magnitudePerEur: 20 },
  { code: 'THB', symbols: ['฿'], words: ['thb', 'baht'], magnitudePerEur: 38 },
];

export const CURRENCY_BY_CODE: ReadonlyMap<string, CurrencyInfo> = new Map(CURRENCIES.map((c) => [c.code, c]));

/**
 * Symbols shared by several currencies, resolved by the posting country. The first entry is
 * the fallback when the country is unknown or uses none of them (null = cannot tell).
 */
export const AMBIGUOUS_SYMBOLS: Readonly<Record<string, { byCountry: Readonly<Record<string, string>>; fallback: string | null }>> = {
  $: { byCountry: { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', TW: 'TWD', MX: 'MXN' }, fallback: 'USD' },
  dollars: { byCountry: { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', TW: 'TWD' }, fallback: 'USD' },
  dollar: { byCountry: { US: 'USD', CA: 'CAD', AU: 'AUD', NZ: 'NZD', SG: 'SGD', HK: 'HKD', TW: 'TWD' }, fallback: 'USD' },
  kr: { byCountry: { SE: 'SEK', DK: 'DKK', NO: 'NOK', IS: 'ISK' }, fallback: null },
  'kr.': { byCountry: { SE: 'SEK', DK: 'DKK', NO: 'NOK', IS: 'ISK' }, fallback: null },
  kronor: { byCountry: { SE: 'SEK' }, fallback: 'SEK' },
  kroner: { byCountry: { DK: 'DKK', NO: 'NOK' }, fallback: null },
  krone: { byCountry: { DK: 'DKK', NO: 'NOK' }, fallback: null },
  'kč': { byCountry: { CZ: 'CZK' }, fallback: 'CZK' },
  riyal: { byCountry: { SA: 'SAR', QA: 'QAR' }, fallback: null },
  riyals: { byCountry: { SA: 'SAR', QA: 'QAR' }, fallback: null },
  rs: { byCountry: { IN: 'INR', PK: 'PKR' }, fallback: null },
  'rs.': { byCountry: { IN: 'INR', PK: 'PKR' }, fallback: null },
  '¥': { byCountry: { JP: 'JPY', CN: 'CNY' }, fallback: 'JPY' },
  fr: { byCountry: { CH: 'CHF' }, fallback: null },
  'fr.': { byCountry: { CH: 'CHF' }, fallback: null },
  pesos: { byCountry: { MX: 'MXN' }, fallback: null },
};

/** ISO codes accepted verbatim when written in upper case ("PHP" and "TRY" only this way). */
export const KNOWN_CURRENCY_CODES: ReadonlySet<string> = new Set(CURRENCIES.map((c) => c.code));
