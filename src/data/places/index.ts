/**
 * Gazetteer index over countries, regions, cities, macro-regions and time-zone words.
 * Two lookups:
 *  - `PHRASES`: folded, diacritic-insensitive phrase → entries ("munchen", "muenchen", "den haag").
 *  - `CODES`: UPPERCASE-only short codes → entries ("DE", "CA", "NSW", "CET", "EU", "SF").
 *    Codes collide with ordinary words ("IT", "IN", "NO", "OR"), so callers only accept them in
 *    code-like positions (standalone segment, next to a city, next to "remote").
 */
import { foldKey, foldVariants } from '../../lib/normalize/text';
import { CITIES, type CityInfo } from './cities';
import { COUNTRIES, COUNTRY_BY_ISO2, type CountryInfo } from './countries';
import { MACRO_REGIONS, type MacroRegion } from './macro-regions';
import { REGIONS, type RegionInfo } from './regions';
import { TIMEZONES, UPPERCASE_ONLY_TZ, type TimezoneWord } from './timezones';

export { CITIES, COUNTRIES, COUNTRY_BY_ISO2, MACRO_REGIONS, REGIONS, TIMEZONES };
export type { CityInfo, CountryInfo, MacroRegion, RegionInfo, TimezoneWord };
export { countryInfo, isTargetCountry } from './countries';
export { MACRO_REGION_BY_KEY } from './macro-regions';
export { REGIONS_BY_TEXT_CODE, regionInfo } from './regions';
export { UTC_OFFSET_RE } from './timezones';

export type PlaceEntry =
  | { kind: 'country'; country: CountryInfo }
  | { kind: 'region'; region: RegionInfo }
  | { kind: 'city'; city: CityInfo }
  | { kind: 'macro'; macro: MacroRegion }
  | { kind: 'tz'; tz: TimezoneWord };

/**
 * City names that are also ordinary words: matched only when written with a capital letter
 * ("Split, Croatia" but not "split 3/2 office/remote").
 */
export const CAPITALIZED_ONLY_KEYS: ReadonlySet<string> = new Set([
  'split', 'reading', 'bath', 'nice', 'tours', 'mons', 'natal', 'salvador', 'chandler', 'madison', 'irving', 'ogre', 'marsa', 'paola',
  'plano', 'derby', 'chester', 'hull', 'eger', 'sion', 'pau', 'mobile', 'victoria', 'waterloo', 'lima', 'cali', 'nancy',
  'sofia', 'florence', 'regina', 'kingston', 'richmond', 'phoenix', 'aurora', 'surrey', 'wellington', 'hamilton', 'nelson', 'napier',
  'arlington', 'columbus', 'durham', 'lund', 'asker', 'hamar', 'horten', 'kalmar', 'lahti', 'pori', 'vasa', 'rabat', 'ruse',
  'metz', 'brest', 'nitra', 'arad', 'lecce', 'bari', 'pisa', 'parma', 'udine', 'gent', 'zug', 'baar', 'chur', 'thun', 'biel', 'baden',
]);

/** ISO3 codes that are also uppercase words or time zones ("AND", "PER", "EST"): not used as codes. */
const ISO3_WORD_COLLISIONS = new Set(['AND', 'ARE', 'PER', 'NOR', 'FIN', 'BRA', 'ARM', 'COL', 'LIE', 'EST', 'MAR', 'TUR', 'POL', 'GEO', 'CAN', 'ITA', 'BEL', 'IND']);

const phrases = new Map<string, PlaceEntry[]>();
const codes = new Map<string, PlaceEntry[]>();
let maxPhraseTokens = 1;

function addPhrase(name: string, entry: PlaceEntry): void {
  for (const key of foldVariants(name)) {
    if (!key) continue;
    const list = phrases.get(key) ?? [];
    if (!list.some((e) => sameEntry(e, entry))) list.push(entry);
    phrases.set(key, list);
    maxPhraseTokens = Math.max(maxPhraseTokens, key.split(' ').length);
  }
}

function addCode(code: string, entry: PlaceEntry): void {
  const key = code.toUpperCase();
  const list = codes.get(key) ?? [];
  if (!list.some((e) => sameEntry(e, entry))) list.push(entry);
  codes.set(key, list);
}

function sameEntry(a: PlaceEntry, b: PlaceEntry): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'country':
      return a.country.iso2 === (b as typeof a).country.iso2;
    case 'region':
      return a.region === (b as typeof a).region;
    case 'city':
      return a.city === (b as typeof a).city;
    case 'macro':
      return a.macro.key === (b as typeof a).macro.key;
    case 'tz':
      return a.tz.key === (b as typeof a).tz.key;
  }
}

/** Short all-caps aliases ("LA", "SF", "NYC", "KL") are codes, not phrases. */
function isShortCode(alias: string): boolean {
  return /^[A-Z.]{2,4}$/.test(alias) && alias.replace(/\./g, '').length <= 4;
}

for (const country of COUNTRIES) {
  const entry: PlaceEntry = { kind: 'country', country };
  if (!country.nameIsAmbiguous) addPhrase(country.name, entry);
  for (const a of country.aliases) addPhrase(a, entry);
  addCode(country.iso2, entry);
  if (!ISO3_WORD_COLLISIONS.has(country.iso3)) addCode(country.iso3, entry);
  for (const c of country.codes ?? []) addCode(c, entry);
}

for (const region of REGIONS) {
  const entry: PlaceEntry = { kind: 'region', region };
  addPhrase(region.name, entry);
  for (const a of region.aliases) {
    if (isShortCode(a)) addCode(a.replace(/\./g, ''), entry);
    else addPhrase(a, entry);
  }
  if (region.codeInText) addCode(region.code, entry);
}

for (const city of CITIES) {
  const entry: PlaceEntry = { kind: 'city', city };
  addPhrase(city.name, entry);
  for (const a of city.aliases) {
    if (isShortCode(a)) addCode(a.replace(/\./g, ''), entry);
    else addPhrase(a, entry);
  }
}

for (const macro of MACRO_REGIONS) {
  const entry: PlaceEntry = { kind: 'macro', macro };
  for (const a of macro.aliases) addPhrase(a, entry);
  // Codes with punctuation ("UK&I") are matched through their phrase alias instead.
  for (const c of macro.codes ?? []) if (/^[A-Z]+$/.test(c)) addCode(c, entry);
}

for (const tz of TIMEZONES) {
  const entry: PlaceEntry = { kind: 'tz', tz };
  for (const a of tz.aliases) {
    if (UPPERCASE_ONLY_TZ.has(a)) addCode(a, entry);
    else addPhrase(a, entry);
  }
}

export const MAX_PHRASE_TOKENS = maxPhraseTokens;

/** Entries for a folded phrase key (see `foldKey`). */
export function lookupPhrase(key: string): readonly PlaceEntry[] {
  return phrases.get(key) ?? [];
}

/** Entries for an UPPERCASE code (caller decides whether the position allows a code). */
export function lookupCode(code: string): readonly PlaceEntry[] {
  return codes.get(code) ?? [];
}

/** Known cities with this name (any spelling), best candidates first (primary before secondary). */
export function findCities(name: string): CityInfo[] {
  const out: CityInfo[] = [];
  for (const key of foldVariants(name)) {
    for (const e of phrases.get(key) ?? []) if (e.kind === 'city' && !out.includes(e.city)) out.push(e.city);
  }
  const code = name.trim().toUpperCase();
  if (name.trim() === code) for (const e of codes.get(code) ?? []) if (e.kind === 'city' && !out.includes(e.city)) out.push(e.city);
  return out.sort((a, b) => Number(a.secondary) - Number(b.secondary));
}

/** Country for a free-text name or code ("Deutschland", "DE", "Czech Republic"), else null. */
export function findCountry(nameOrCode: string): CountryInfo | null {
  const t = nameOrCode.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) {
    const direct = COUNTRY_BY_ISO2.get(t.toUpperCase());
    if (direct) return direct;
  }
  const byCode = (codes.get(t.toUpperCase()) ?? []).find((e) => e.kind === 'country');
  if (byCode && t === t.toUpperCase()) return (byCode as { country: CountryInfo }).country;
  const hit = (phrases.get(foldKey(t)) ?? []).find((e) => e.kind === 'country');
  return hit ? (hit as { country: CountryInfo }).country : null;
}
