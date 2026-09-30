/**
 * Location normaliser (spec §10): maps a free-text posting location onto country / city /
 * region / workplace type using the known place list in src/data/places.
 *
 * Handles local spellings ("München", "Den Haag", "Praha"), region codes ("Austin, TX",
 * "Sydney NSW"), multi-location strings ("Berlin | Munich"), messy remote scopes
 * ("Remote – EMEA", "US-Remote", "Anywhere"), office-day hybrids ("Hybrid, 3 days in office"),
 * postal codes and gender markers ("(m/w/d)"). It never invents a place: an unknown city is only
 * returned next to a known country, flagged `cityKnown: false`, with lower confidence.
 *
 * Pure function. The returned object is a superset of the LocationResult contract.
 */
import type { LocationResult, WorkplaceType } from '../contracts/jobs';
import type { Confidence } from '../contracts/provenance';
import { REMOTE_COUNTRY } from '../contracts/settings';
import {
  CAPITALIZED_ONLY_KEYS,
  COUNTRY_BY_ISO2,
  MAX_PHRASE_TOKENS,
  REGIONS,
  UTC_OFFSET_RE,
  findCities,
  isTargetCountry,
  regionInfo,
  lookupCode,
  lookupPhrase,
  type CityInfo,
  type PlaceEntry,
  type RegionInfo,
} from '../../data/places';
import { collapseWhitespace, fold, normalizePunctuation, titleCase } from './text';

export const LOCATION_LOGIC_VERSION = 'location@2026-09-29.1';

export interface LocationCityMatch {
  name: string;
  countryIso2: string;
  region: string | null;
}

export interface LocationDetails extends LocationResult {
  /** Every country the string names or implies, in order of appearance. */
  countries: string[];
  /** Every known city found, in order (after homonym resolution). */
  cities: LocationCityMatch[];
  /** Macro-region keys (EMEA, EU, DACH, NORDICS, WORLDWIDE …). */
  macroRegions: string[];
  /** Time-zone keys and explicit offsets ("CET", "UTC+1"). */
  timezones: string[];
  postalCode: string | null;
  /** False when `city` is not in the known place list (taken verbatim from the string/hint). */
  cityKnown: boolean;
  /** Whether `countryIso2` is a spec §4 target (XW counts); null when no country. */
  targetCountry: boolean | null;
  /** Office days per week when stated ("3 days in office"). */
  officeDays: number | null;
}

export interface LocationHints {
  country?: string | null;
  city?: string | null;
  /** Structured workplace flag from the source (used only when the string says nothing). */
  workplace?: WorkplaceType | null;
}

// ── Cleaning ────────────────────────────────────────────────────────────────────────────────

const GENDER_RE =
  /\(\s*(?:[mwfdxhi]|div|divers|all\s+genders?|alle\s+geschlechter|gn|any\s+gender)(?:\s*[/|,]\s*(?:[mwfdxhi]|div|divers|\*|in))*\s*\)|\b(?:m\/w\/d|w\/m\/d|m\/f\/d|f\/m\/d|m\/f\/x|f\/m\/x|m\/w\/x|w\/m\/x|m\/f|h\/f|f\/h|m\/w|w\/m|m\/v|v\/m|k\/m|m\/k|m\/ž|ž\/m)\b/gi;

const POSTAL_PATTERNS: readonly RegExp[] = [
  /\b\d{5}-\d{4}\b/g, // US ZIP+4
  /\b(?:D|A|CH|F|L|B|I|E|P|NL|DK|S|N|FI|FIN|PL|CZ|SK|HU|H|RO|HR|SI|SLO|LT|LV|EE|GR|BG|CY|MT|LU|IE)-\s?\d{3,5}\b/g, // D-80331, LT-01100
  /\b[A-Z]{1,2}\d[A-Z\d]?\s\d[A-Z]{2}\b/g, // UK: EC2A 4NE, SW1A 1AA, M1 1AE
  /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\s?\d[ABCEGHJ-NPRSTV-Z]\d\b/g, // Canada: M5V 2T6
  /\b[AC-FHKNPRTV-Y]\d{2}\s[AC-FHKNPRTV-Y\d]{4}\b/g, // Irish Eircode: D02 X285
  /\b\d{4}\s?[A-Z]{2}\b(?!\s*[a-z])/g, // NL: 1011 AB
  /\b\d{4}-\d{3}\b/g, // PT: 1000-001
  /\b\d{2}-\d{3}\b/g, // PL: 00-950
  /\b\d{3}-\d{4}\b/g, // JP: 100-0001
  /\b\d{3}\s\d{2}\b(?!\s*(?:days?|%|x\b))/g, // SE/CZ/SK/GR: 111 22
  /\b\d{4,6}\b/g, // DE/FR/ES/IT/US/AT/CH/BE/DK/NO/HU/AU/SG/IN
];

const CONNECTOR_WORDS = new Set(['or', 'oder', 'ou', 'o', 'of', 'and', 'und', 'et', 'y', 'e', 'en', 'i', 'eller', 'tai', 'lub', 'albo', 'nebo', 'vagy', 'sau']);

/** Words that may surround a code without making its position "prose" ("US-Remote", "Remote (UK) only"). */
const WORKPLACE_WORDS = new Set([
  'remote', 'remotely', 'hybrid', 'hybride', 'onsite', 'on', 'site', 'office', 'in', 'based', 'only', 'fully', 'full', 'time', 'first', 'friendly',
  'wfh', 'anywhere', 'from', 'home', 'work', 'within', 'location', 'locations', 'region', 'country', 'countries', 'area', 'the', 'any', 'all',
  'remoto', 'remota', 'teletravail', 'homeoffice', 'distance', 'hq', 'headquarters', 'multiple', 'various', 'city', 'metro', 'greater',
]);

/** Tokens that are never an unknown-city candidate. */
const NOT_A_CITY = new Set([
  ...WORKPLACE_WORDS,
  ...CONNECTOR_WORDS,
  'days', 'day', 'week', 'per', 'a', 'x', 'tage', 'jours', 'dias', 'giorni', 'dagen', 'dni', 'mobile', 'flexible', 'flex', 'hybrid', 'possible',
  'optional', 'option', 'required', 'preferred', 'eligible', 'open', 'to', 'relocation', 'relocate', 'visa', 'sponsorship', 'europe', 'emea',
  'international', 'global', 'worldwide', 'n', 'na', 'tbd', 'unknown', 'various', 'several', 'other', 'others', 'etc', 'new', 'job', 'jobs',
  'mwd', 'wmd', 'gn', 'all', 'genders', 'office', 'offices', 'campus', 'building', 'floor', 'street', 'str', 'strasse', 'straße', 'rue', 'road',
  'avenue', 'calle', 'via', 'weg', 'laan', 'straat', 'plein', 'platz', 'ulica', 'ul', 'suite', 'unit', 'po', 'box',
]);

// ── Workplace detection (on folded text) ────────────────────────────────────────────────────

const NEG_REMOTE_RE =
  /\b(?:no|not|non|kein(?:e|en)?|nicht|pas\s+de|pas\s+en|sans|sin|senza|niet|geen|ikke|inte|ei)[\s-]+(?:fully[\s-]+)?(?:remote|home[\s-]?office|teletravail|teletrabajo|remoto|telelavoro|thuiswerken)\b|\bremote\s+(?:work\s+)?(?:is\s+)?(?:not|nicht|pas)\s+(?:possible|available|offered|an\s+option|moglich|possible)\b/;

const STRONG_REMOTE_RE =
  /\b(?:fully[\s-]+remote|full[\s-]+remote|100\s?%\s*(?:remote|home[\s-]?office|teletravail|remoto|zdalnie)|remote[\s-]+first|remote[\s-]+only|all[\s-]+remote|work[\s-]+from[\s-]+anywhere|anywhere|worldwide|weltweit|location[\s-]+independent|teletravail\s+(?:total|complet|100)|volledig\s+(?:remote|thuis)|komplett\s+remote|vollstandig\s+remote|praca\s+w\s+pelni\s+zdalna|w\s+pelni\s+zdaln\w*|totalmente\s+(?:remoto|en\s+remoto)|100\s?%\s*remote)\b/;

const REMOTE_RE =
  /\b(?:remote(?:ly)?|work(?:ing)?\s+from\s+home|wfh|wfa|telework(?:ing)?|tele[\s-]?commut\w*|teletravail|teletrabajo|trabajo\s+remoto|en\s+remoto|remoto|remota|a\s+distancia|da\s+remoto|in\s+remoto|telelavoro|thuiswerk(?:en)?|op\s+afstand|zdaln(?:ie|a|y|ej)|praca\s+zdalna|na\s+dalku|prace\s+z\s+domova|etatyo|etatoissa|distansarbete|pa\s+distans|fjernarbejde|fjernarbeid|hjemmefra|tavmunka|la\s+distanta|distributed|anywhere|worldwide|weltweit)\b/;

const HYBRID_RE =
  /\b(?:hybrid|hybride|hibrido|hibrida|ibrido|ibrida|hybrydow\w*|hybridni|hybridne|hibrid|hybridi|hybridt|hybrid-?work\w*|partial(?:ly)?[\s-]+remote|partly[\s-]+remote|part[\s-]+remote|semi[\s-]+remote|occasional(?:ly)?[\s-]+remote|some[\s-]+remote|remote[\s-]+days?|flexible[\s-]+(?:working|work|location|office)|flex[\s-]+office|smart[\s-]+working|teletravail\s+(?:partiel|possible|hybride|\d)|home[\s-]?office|mobiles?\s+arbeiten|\d\s*(?:days?|x|tage?n?|jours?|dias?|giorni|dagen|dni|dny|dagar|dage|dager)\s+(?:(?:a|per|\/|pro|par|por|al|la|in\s+der|w)\s+)?(?:(?:week|woche|semaine|semana|settimana|tygodniu|tydnu|veckan|ugen|uken)\s+)?(?:remote|from\s+home|home[\s-]?office|wfh|teletravail|thuis))\b/;

const ONSITE_RE =
  /\b(?:on[\s-]?site|onsite|in[\s-]office|office[\s-]based|in[\s-]person|fully\s+in\s+office|vor\s+ort|presencial|presenziale|in\s+presenza|en\s+presentiel|sur\s+site|op\s+locatie|op\s+kantoor|stacjonarn\w*|na\s+miejscu|kontorbaseret|pa\s+kontoret|i\s+kontoret)\b/;

/** "Amsterdam or Remote", "Remote / Hybrid", "Onsite or remote": remote is one of the options. */
const REMOTE_OPTION_RE = /\b(?:or|oder|ou|o|of|\/|&)\s*(?:fully\s+)?remote\b|\bremote\s*(?:or|oder|ou|o|of|\/)\s*(?:hybrid|office|on[\s-]?site|in[\s-]office)\b/;

const OFFICE_DAYS_RES: readonly RegExp[] = [
  /\b([1-5])\s*(?:-\s*[1-5]\s*)?(?:days?|x|tage?n?|jours?|dias?|giorni|dagen|dni|dny|dagar|dage|dager)\b[^.;]{0,24}?\b(?:office|buro|bureau|oficina|ufficio|kantoor|biurze|biura|kancelari|kontoret|kontor|sede|site|onsite|on-site|vor\s+ort|presencial|in\s+person|premises)\b/,
  /\b(?:office|onsite|on-site|on\s+site|in\s+person|vor\s+ort|kantoor|bureau)\s*(?:[:\-–]\s*)?([1-5])\s*(?:days?|x|tage?|jours?|dagen)\b/,
];

function detectWorkplace(folded: string): { type: WorkplaceType | null; strength: 'strong' | 'normal' | 'none'; why: string | null; officeDays: number | null } {
  let officeDays: number | null = null;
  for (const re of OFFICE_DAYS_RES) {
    const m = re.exec(folded);
    if (m) {
      officeDays = Number(m[1]);
      break;
    }
  }
  const neg = NEG_REMOTE_RE.exec(folded);
  const hybrid = HYBRID_RE.exec(folded);
  if (neg) {
    if (hybrid && !/home[\s-]?office|remote/.test(hybrid[0])) return { type: 'hybrid', strength: 'normal', why: hybrid[0], officeDays };
    return { type: 'onsite', strength: 'normal', why: neg[0], officeDays };
  }
  const strong = STRONG_REMOTE_RE.exec(folded);
  if (strong) return { type: 'remote', strength: 'strong', why: strong[0], officeDays };
  const option = REMOTE_OPTION_RE.exec(folded);
  if (option) return { type: 'remote', strength: 'normal', why: option[0].trim(), officeDays };
  if (officeDays !== null && officeDays < 5) return { type: 'hybrid', strength: 'normal', why: `${officeDays} office days`, officeDays };
  if (hybrid) return { type: 'hybrid', strength: 'normal', why: hybrid[0], officeDays };
  const remote = REMOTE_RE.exec(folded);
  if (remote) return { type: 'remote', strength: 'normal', why: remote[0], officeDays };
  const onsite = ONSITE_RE.exec(folded);
  if (onsite) return { type: 'onsite', strength: 'normal', why: onsite[0], officeDays };
  if (officeDays === 5) return { type: 'onsite', strength: 'normal', why: '5 office days', officeDays };
  return { type: null, strength: 'none', why: null, officeDays };
}

// ── Tokenising / matching ───────────────────────────────────────────────────────────────────

interface Token {
  orig: string;
  folded: string;
  seg: number;
}

interface Match {
  entries: readonly PlaceEntry[];
  text: string;
  seg: number;
  start: number;
  end: number;
  isCode: boolean;
}

/** Hard separators: a phrase never spans them. */
const SEGMENT_SPLIT_RE = /[,;|/()[\]{}•·\n]|\s[-–—]\s|\s-(?=\S)|(?<=\S)-\s|:\s/;

function tokenize(text: string): { tokens: Token[]; segments: string[] } {
  const segments = text.split(SEGMENT_SPLIT_RE).map((s) => (s ?? '').trim());
  const tokens: Token[] = [];
  segments.forEach((seg, i) => {
    for (const m of seg.matchAll(/[\p{L}\p{M}\p{N}]+/gu)) {
      const f = fold(m[0]).replace(/[^\p{L}\p{N}]+/gu, '');
      if (f) tokens.push({ orig: m[0], folded: f, seg: i });
    }
  });
  return { tokens, segments };
}

function isUpperCode(s: string): boolean {
  return /^[A-Z]{2,4}$/.test(s);
}

function scan(tokens: Token[]): Match[] {
  const out: Match[] = [];
  let i = 0;
  while (i < tokens.length) {
    let found: Match | null = null;
    const seg = tokens[i].seg;
    let maxLen = 0;
    while (maxLen < MAX_PHRASE_TOKENS && i + maxLen < tokens.length && tokens[i + maxLen].seg === seg) maxLen++;
    for (let len = maxLen; len >= 1 && !found; len--) {
      const slice = tokens.slice(i, i + len);
      const key = slice.map((t) => t.folded).join(' ');
      let entries = lookupPhrase(key);
      if (len === 1 && entries.length && CAPITALIZED_ONLY_KEYS.has(key) && !/^\p{Lu}/u.test(slice[0].orig)) {
        entries = entries.filter((e) => e.kind !== 'city');
      }
      if (entries.length) {
        found = { entries, text: slice.map((t) => t.orig).join(' '), seg, start: i, end: i + len, isCode: false };
      } else if (len === 1 && isUpperCode(slice[0].orig)) {
        const codeEntries = lookupCode(slice[0].orig);
        if (codeEntries.length) found = { entries: codeEntries, text: slice[0].orig, seg, start: i, end: i + 1, isCode: true };
      }
    }
    if (found) {
      out.push(found);
      i = found.end;
    } else i++;
  }
  return out;
}

/**
 * Segment consists of this code plus only workplace/connector words or other country / macro-region
 * names ("US-Remote", "(DE)", "Remote UK only", "US or Canada").
 */
function codeStandsAlone(tokens: Token[], m: Match, matches: readonly Match[]): boolean {
  const covered = (idx: number): boolean =>
    matches.some((o) => o !== m && !o.isCode && idx >= o.start && idx < o.end && o.entries.some((e) => e.kind === 'country' || e.kind === 'macro'));
  return tokens.every(
    (t, idx) => t.seg !== m.seg || (idx >= m.start && idx < m.end) || WORKPLACE_WORDS.has(t.folded) || CONNECTOR_WORDS.has(t.folded) || covered(idx),
  );
}

/** Uppercase codes that are also common English/other words in location strings. */
const WORD_LIKE_CODES = new Set(['OR', 'IN', 'ON', 'ME', 'NO', 'IT', 'IS', 'AT', 'AS', 'BE', 'DO', 'GO', 'HI', 'ID', 'OH', 'OK', 'PA', 'MA', 'LA', 'TO', 'SO', 'AM', 'AN', 'MY', 'NE', 'DE', 'SE', 'ES', 'EL', 'DA', 'DI', 'EN', 'ET', 'UM', 'IE']);

const TZ_CONTEXT_WORDS = new Set(['time', 'timezone', 'timezones', 'zone', 'zones', 'hours', 'tz', 'overlap', 'utc', 'gmt']);

// ── Main ────────────────────────────────────────────────────────────────────────────────────

function hintCountry(h: string | null | undefined): string | null {
  const t = h?.trim();
  if (!t) return null;
  if (/^[A-Za-z]{2}$/.test(t)) {
    const up = t.toUpperCase();
    return up === REMOTE_COUNTRY || COUNTRY_BY_ISO2.has(up) ? up : null;
  }
  const hit = lookupPhrase(fold(t).replace(/[^\p{L}\p{N}]+/gu, ' ').trim()).find((e) => e.kind === 'country');
  return hit && hit.kind === 'country' ? hit.country.iso2 : null;
}

function pushUnique<T>(arr: T[], v: T): void {
  if (!arr.includes(v)) arr.push(v);
}

export function normalizeLocation(raw: string, hints?: LocationHints): LocationDetails {
  const original = collapseWhitespace(normalizePunctuation(typeof raw === 'string' ? raw : '')).slice(0, 1000);
  const evidence: string[] = [];

  let text = original.replace(GENDER_RE, ' ');
  text = text
    .replace(/\bU\.\s?S\.\s?A\.?/g, 'USA')
    .replace(/\bU\.\s?A\.\s?E\.?/g, 'UAE')
    .replace(/\bU\.\s?S\.?(?=[\s,;)/-]|$)/g, 'US')
    .replace(/\bU\.\s?K\.?(?=[\s,;)/-]|$)/g, 'UK');

  let postalCode: string | null = null;
  // Office-day counts ("3 days") and percentages are short numbers, so the ≥4-digit patterns never eat them.
  for (const re of POSTAL_PATTERNS) {
    text = text.replace(re, (m) => {
      if (postalCode === null) postalCode = m.trim();
      return ' ';
    });
  }
  if (postalCode) evidence.push(`postal code "${postalCode}" ignored`);
  text = collapseWhitespace(text);

  const folded = fold(text);
  const wp = detectWorkplace(folded);
  let workplaceType: WorkplaceType | null = wp.type;
  if (wp.type) evidence.push(`"${wp.why}" → ${wp.type}`);
  else if (hints?.workplace) {
    workplaceType = hints.workplace;
    evidence.push(`workplace from source hint: ${hints.workplace}`);
  }

  const { tokens, segments } = tokenize(text);
  const matches = scan(tokens);

  const macroRegions: string[] = [];
  const timezones: string[] = [];
  const explicitCountries: string[] = [];
  const countryPos = new Map<string, number>();
  const addExplicitCountry = (iso2: string, pos: number): void => {
    pushUnique(explicitCountries, iso2);
    if (!countryPos.has(iso2) || (countryPos.get(iso2) ?? 0) > pos) countryPos.set(iso2, pos);
  };
  const regionMentions: RegionInfo[] = [];
  const regionsFromPhrase = new Set<RegionInfo>();
  const cityMatches: { m: Match; candidates: CityInfo[] }[] = [];
  const codeMatches: Match[] = [];

  for (const m of matches) {
    if (m.isCode) {
      codeMatches.push(m);
      continue;
    }
    const cities = m.entries.filter((e): e is Extract<PlaceEntry, { kind: 'city' }> => e.kind === 'city').map((e) => e.city);
    for (const e of m.entries) {
      if (e.kind === 'country') addExplicitCountry(e.country.iso2, m.start);
      else if (e.kind === 'region') {
        regionMentions.push(e.region);
        regionsFromPhrase.add(e.region);
      }
      else if (e.kind === 'macro') pushUnique(macroRegions, e.macro.key);
      else if (e.kind === 'tz') pushUnique(timezones, e.tz.key);
    }
    if (cities.length) cityMatches.push({ m, candidates: [...cities].sort((a, b) => Number(a.secondary) - Number(b.secondary)) });
    const kinds = [...new Set(m.entries.map((e) => e.kind))].join('/');
    evidence.push(`"${m.text}" → ${kinds}`);
  }

  // Codes: decide per position whether it is a code at all, then which meaning applies.
  const cityCountriesSoFar = (beforeSeg: number): Set<string> => {
    const s = new Set<string>();
    for (const c of cityMatches) if (c.m.seg <= beforeSeg) for (const cand of c.candidates) s.add(cand.country);
    return s;
  };
  const hintIso = hintCountry(hints?.country);
  for (const m of codeMatches) {
    const code = m.text;
    const nextTok = tokens[m.end]?.folded;
    const prevTok = m.start > 0 ? tokens[m.start - 1]?.folded : undefined;
    const alone = codeStandsAlone(tokens, m, matches);
    const sameSegCity = cityMatches.some((c) => c.m.seg === m.seg && c.m.end <= m.start);
    const macro = m.entries.find((e) => e.kind === 'macro');
    const tz = m.entries.find((e) => e.kind === 'tz');
    const country = m.entries.find((e) => e.kind === 'country');
    const regions = m.entries.filter((e): e is Extract<PlaceEntry, { kind: 'region' }> => e.kind === 'region').map((e) => e.region);
    const cityCode = m.entries.filter((e): e is Extract<PlaceEntry, { kind: 'city' }> => e.kind === 'city').map((e) => e.city);

    if (macro && macro.kind === 'macro') {
      pushUnique(macroRegions, macro.macro.key);
      evidence.push(`"${code}" → ${macro.macro.label}`);
      continue;
    }
    const tzContext = (nextTok && TZ_CONTEXT_WORDS.has(nextTok)) || (prevTok && TZ_CONTEXT_WORDS.has(prevTok));
    // "Hartford, CT" / "Bozeman, MT": after a place name, a state code wins over the time zone.
    const placeBefore = tokens.some((t, idx) => idx < m.start && t.seg < m.seg && !WORKPLACE_WORDS.has(t.folded) && !CONNECTOR_WORDS.has(t.folded));
    const regionOverTz = regions.some((r) => r.codeInText) && placeBefore && !tzContext;
    if (tz && tz.kind === 'tz' && !regionOverTz && (!country || tzContext) && (code.length >= 3 || tzContext || alone)) {
      pushUnique(timezones, tz.tz.key);
      evidence.push(`"${code}" → time zone ${tz.tz.key}`);
      continue;
    }
    // Codes that are also everyday words ("OR", "IN", "ON", "ME") count only as a bare segment ("Portland, OR").
    const bare = tokens.every((t, idx) => t.seg !== m.seg || (idx >= m.start && idx < m.end));
    if (WORD_LIKE_CODES.has(code) && !bare) continue;
    const consistentWithCity =
      sameSegCity &&
      cityMatches.some(
        (c) => c.m.seg === m.seg && c.candidates.some((cand) => (country?.kind === 'country' && country.country.iso2 === cand.country) || regions.some((r) => r.country === cand.country)),
      );
    if (!alone && !consistentWithCity && !(cityCode.length && code.length >= 3)) continue;

    // Region of an already-named city's country ("Austin, TX", "Wilmington, DE", "Cambridge, MA").
    const ctx = cityCountriesSoFar(m.seg);
    const ctxRegion = regions.find((r) => ctx.has(r.country) || explicitCountries.includes(r.country));
    if (ctxRegion) {
      regionMentions.push(ctxRegion);
      evidence.push(`"${code}" → region ${ctxRegion.code} (${ctxRegion.country})`);
      continue;
    }
    // Subdivision code of the named city's country that is not normally written ("Munich, BY", "Geneva, GE").
    const cityRegion = country && country.kind === 'country' && ctx.has(country.country.iso2)
      ? null
      : [...ctx].map((c) => regionInfo(c, code)).find((r): r is RegionInfo => r !== null);
    if (cityRegion) {
      regionMentions.push(cityRegion);
      evidence.push(`"${code}" → region ${cityRegion.code} (${cityRegion.country})`);
      continue;
    }
    // "Bozeman, MT" from a US source: the source country's state code beats Malta.
    const hintRegion = hintIso ? regions.find((r) => r.country === hintIso) : undefined;
    if (hintRegion && !(country && country.kind === 'country' && country.country.iso2 === hintIso)) {
      regionMentions.push(hintRegion);
      evidence.push(`"${code}" → region ${hintRegion.code} (${hintRegion.country}, source country)`);
      continue;
    }
    if (country && country.kind === 'country') {
      addExplicitCountry(country.country.iso2, m.start);
      evidence.push(`"${code}" → country ${country.country.iso2}`);
      continue;
    }
    if (cityCode.length) {
      cityMatches.push({ m, candidates: cityCode });
      evidence.push(`"${code}" → city`);
      continue;
    }
    if (regions.length) {
      const hc = hintCountry(hints?.country);
      const r = regions.find((x) => x.country === hc) ?? regions[0];
      regionMentions.push(r);
      evidence.push(`"${code}" → region ${r.code} (${r.country})`);
    }
  }

  explicitCountries.sort((a, b) => (countryPos.get(a) ?? 0) - (countryPos.get(b) ?? 0));
  const hint = hintCountry(hints?.country);
  const regionCountries = [...new Set(regionMentions.map((r) => r.country))];

  // Resolve each city mention to one candidate.
  const resolvedCities: { city: CityInfo; ambiguous: boolean; text: string }[] = [];
  for (const { m, candidates } of cityMatches) {
    const pick =
      candidates.find((c) => explicitCountries.includes(c.country)) ??
      candidates.find((c) => regionMentions.some((r) => r.country === c.country)) ??
      (hint ? candidates.find((c) => c.country === hint) : undefined) ??
      candidates.find((c) => !c.secondary);
    if (!pick) {
      evidence.push(`"${m.text}" → no matching country for this city name`);
      continue;
    }
    const primaryCountries = new Set(candidates.filter((c) => !c.secondary).map((c) => c.country));
    const confirmed = explicitCountries.includes(pick.country) || regionCountries.includes(pick.country) || hint === pick.country;
    resolvedCities.push({ city: pick, ambiguous: !confirmed && primaryCountries.size > 1, text: m.text });
  }

  const cityCountries: string[] = [];
  for (const c of resolvedCities) pushUnique(cityCountries, c.city.country);

  // Countries in order of appearance: explicit, then region-implied, then city-implied.
  const countries: string[] = [];
  for (const c of explicitCountries) pushUnique(countries, c);
  for (const c of regionCountries) pushUnique(countries, c);
  for (const c of cityCountries) pushUnique(countries, c);

  let countryIso2: string | null = null;
  let countrySource: 'hint-confirmed' | 'explicit' | 'region' | 'city' | 'hint' | 'remote' | null = null;
  let conflict = false;
  if (hint && hint !== REMOTE_COUNTRY && countries.includes(hint)) {
    countryIso2 = hint;
    countrySource = 'hint-confirmed';
  } else if (explicitCountries.length) {
    countryIso2 = explicitCountries[0];
    countrySource = 'explicit';
  } else if (regionCountries.length) {
    countryIso2 = regionCountries.find((c) => cityCountries.includes(c)) ?? regionCountries[0];
    countrySource = 'region';
  } else if (cityCountries.length) {
    countryIso2 = cityCountries[0];
    countrySource = 'city';
  } else if (hint) {
    countryIso2 = hint;
    countrySource = 'hint';
  } else if (workplaceType === 'remote') {
    countryIso2 = REMOTE_COUNTRY;
    countrySource = 'remote';
  }
  if (hint && hint !== REMOTE_COUNTRY && countryIso2 && countryIso2 !== hint && countrySource !== 'hint') {
    conflict = true;
    evidence.push(`source hint country ${hint} disagrees with the text (${countryIso2})`);
  }
  if (countrySource === 'hint') evidence.push(`country from source hint ${hint}`);
  if (countrySource === 'remote') evidence.push(macroRegions.length ? `remote, scope ${macroRegions.join('/')}` : 'remote, no country named');

  // City: hint (if consistent), else the first known city in the chosen country, else a verbatim fallback.
  let city: string | null = null;
  let region: string | null = null;
  let cityKnown = false;
  let cityAmbiguous = false;
  const hintCity = hints?.city?.trim() ? collapseWhitespace(hints.city).slice(0, 128) : null;
  if (hintCity) {
    const known = findCities(hintCity);
    const k = known.find((c) => c.country === countryIso2) ?? (countryIso2 ? undefined : known.find((c) => !c.secondary));
    if (k) {
      city = k.name;
      region = k.region;
      cityKnown = true;
      if (!countryIso2) {
        countryIso2 = k.country;
        countrySource = 'city';
        pushUnique(countries, k.country);
      }
      evidence.push(`city from source hint "${hintCity}" → ${k.name}`);
    } else {
      city = hintCity;
      evidence.push(`city from source hint "${hintCity}" (not in place list)`);
    }
  }
  const inCountry = resolvedCities.filter((c) => c.city.country === countryIso2);
  if (!city && inCountry.length) {
    city = inCountry[0].city.name;
    region = inCountry[0].city.region;
    cityKnown = true;
    cityAmbiguous = inCountry[0].ambiguous;
  }
  // "Vienna, VA": the region code outranks the gazetteer's Vienna (AT); keep the name, drop AT.
  // "Tbilisi, Georgia": a region name that is also the name of the city's country means the country.
  if (!city && countrySource === 'region' && resolvedCities.length && !explicitCountries.length) {
    const other = resolvedCities[0];
    const cityCountry = COUNTRY_BY_ISO2.get(other.city.country);
    const sameName = cityCountry
      ? regionMentions.find((r) => r.country === countryIso2 && regionsFromPhrase.has(r) && fold(r.name) === fold(cityCountry.name))
      : undefined;
    if (sameName && cityCountry) {
      countryIso2 = cityCountry.iso2;
      countrySource = 'city';
      const idx = regionMentions.indexOf(sameName);
      regionMentions.splice(idx, 1);
      const cIdx = countries.indexOf(sameName.country);
      if (cIdx >= 0 && !regionMentions.some((r) => r.country === sameName.country)) countries.splice(cIdx, 1);
      pushUnique(countries, cityCountry.iso2);
      city = other.city.name;
      region = other.city.region;
      cityKnown = true;
      evidence.push(`"${sameName.name}" read as the country ${cityCountry.iso2} (city ${other.city.name})`);
    }
  }
  if (!city && countrySource === 'region' && resolvedCities.length && !explicitCountries.length) {
    const other = resolvedCities[0];
    city = other.text;
    evidence.push(`"${other.text}" read as a city in ${countryIso2} (region code), not ${other.city.country}`);
    const drop = other.city.country;
    if (!regionCountries.includes(drop)) {
      const idx = countries.indexOf(drop);
      if (idx >= 0) countries.splice(idx, 1);
      resolvedCities.splice(0, 1);
    }
  }
  if (!city && countryIso2 && countryIso2 !== REMOTE_COUNTRY) {
    const guess = unknownCityCandidate(tokens, segments, matches);
    if (guess) {
      city = guess;
      evidence.push(`"${guess}" taken as city (not in place list)`);
    }
  }
  if (!region) {
    const r = regionMentions.find((x) => x.country === countryIso2);
    if (r) region = r.code;
  }

  for (const m of text.matchAll(UTC_OFFSET_RE)) {
    const sign = m[1] === '-' ? '-' : m[1] === '±' ? '±' : '+';
    pushUnique(timezones, `UTC${sign}${Number(m[2])}${m[3] && m[3] !== '00' ? ':' + m[3] : ''}`);
  }

  // Confidence.
  let confidence: Confidence;
  if (!countryIso2) confidence = 'low';
  else if (conflict) confidence = 'low';
  else if (countrySource === 'remote') confidence = macroRegions.length || timezones.length ? 'medium' : 'low';
  else if (countrySource === 'hint') confidence = 'medium';
  else if (countrySource === 'city') confidence = cityAmbiguous || resolvedCities.some((c) => c.ambiguous) ? 'medium' : 'high';
  else confidence = 'high';
  if (confidence === 'high' && city && !cityKnown) confidence = 'medium';

  const remoteScopeRaw = workplaceType === 'remote' ? original.slice(0, 255) || null : null;
  const cities: LocationCityMatch[] = [];
  for (const c of resolvedCities) {
    if (!cities.some((x) => x.name === c.city.name && x.countryIso2 === c.city.country)) {
      cities.push({ name: c.city.name, countryIso2: c.city.country, region: c.city.region });
    }
  }

  return {
    countryIso2,
    city,
    region,
    workplaceType,
    remoteScopeRaw,
    confidence,
    evidence: evidence.length ? evidence.join('; ').slice(0, 500) : original ? `no known place in "${original.slice(0, 80)}"` : 'empty location',
    countries,
    cities,
    macroRegions,
    timezones,
    postalCode,
    cityKnown,
    targetCountry: countryIso2 ? countryIso2 === REMOTE_COUNTRY || isTargetCountry(countryIso2) : null,
    officeDays: wp.officeDays,
  };
}

/**
 * First segment made only of unmatched, place-like words ("Eschborn" in "Eschborn, Germany").
 * Returns null when the segment looks like prose, an address or a workplace phrase.
 */
function unknownCityCandidate(tokens: Token[], segments: string[], matches: Match[]): string | null {
  const matched = new Set<number>();
  for (const m of matches) for (let i = m.start; i < m.end; i++) matched.add(i);
  const bySeg = new Map<number, number[]>();
  tokens.forEach((t, i) => {
    const list = bySeg.get(t.seg) ?? [];
    list.push(i);
    bySeg.set(t.seg, list);
  });
  for (const [seg, idxs] of bySeg) {
    if (idxs.some((i) => matched.has(i))) continue;
    const words = idxs.map((i) => tokens[i]);
    if (!words.length || words.length > 4) continue;
    if (words.some((w) => NOT_A_CITY.has(w.folded) || /\d/.test(w.orig) || w.orig.length < 2)) continue;
    const segText = collapseWhitespace(segments[seg] ?? '').replace(/^[-–—.\s]+|[-–—.\s]+$/g, '');
    if (!segText || !/^\p{L}[\p{L}\p{M}'’. -]*$/u.test(segText)) continue;
    const segFolded = fold(segText);
    if (REMOTE_RE.test(segFolded) || HYBRID_RE.test(segFolded) || ONSITE_RE.test(segFolded) || STRONG_REMOTE_RE.test(segFolded)) continue;
    const allSameCase = segText === segText.toLowerCase() || segText === segText.toUpperCase();
    return (allSameCase ? titleCase(segText) : segText).slice(0, 128);
  }
  return null;
}

/** Region display name for a stored region code ("CA" in US → "California"). */
export function regionName(countryIso2: string | null, code: string | null): string | null {
  if (!countryIso2 || !code) return null;
  return REGIONS.find((r) => r.country === countryIso2 && r.code === code)?.name ?? null;
}
