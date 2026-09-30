/**
 * Legal-form suffixes of company names across the spec §4 countries (plus the common forms of
 * non-target markets that appear in postings). Written as token sequences in the form produced
 * by `companyTokens()` (folded, dots/slashes inside abbreviations removed, "&" → "and"), so
 * "S.à r.l.", "SARL" and "s.a.r.l." all meet on ['sarl'] and "sp. z o.o." on ['sp','z','oo'].
 */

/** Stripped whenever they end a multi-word name ("Acme GmbH", "Acme Ltd"). */
const PLAIN: readonly string[] = [
  // DACH
  'gmbh', 'ggmbh', 'mbh', 'gesmbh', 'kgaa', 'ohg', 'gbr', 'partg', 'mbb', 'partgmbb', 'haftungsbeschrankt', 'haftungsbeschraenkt', 'sagl',
  'ag', 'eg', 'kg', 'ug', 'hf', 'ehf', 'ohf',
  // UK / IE / US / CA / AU / NZ / IL / CY / MT
  'ltd', 'limited', 'plc', 'llp', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'pllc', 'ulc', 'lllp',
  'dac', 'clg', 'pty',
  // FR / BE / LU / CH-romand
  'sas', 'sasu', 'sarl', 'eurl', 'sca', 'snc', 'scs', 'sprl', 'srl', 'bvba', 'cvba', 'scrl', 'asbl', 'gie', 'sci', 'selarl',
  // NL
  'bv', 'nv', 'vof',
  // ES / PT / LatAm
  'sl', 'slu', 'sau', 'sll', 'lda', 'ltda', 'sgps', 'eireli', 'epp',
  // IT
  'spa', 'srls', 'sapa', 'scarl',
  // Nordics / Baltics
  'asa', 'ans', 'aps', 'amba', 'oy', 'oyj', 'publ', 'uab', 'sia',
  // PL / CZ / SK / HU / RO / HR / SI / BG / GR
  'spzoo', 'spk', 'spj', 'ska', 'sro', 'vos', 'kft', 'zrt', 'nyrt', 'kkt', 'doo', 'jdoo', 'eood', 'ood', 'ead', 'ike', 'epe',
  // JP / KR / SG / MY / HK / IN
  'kk', 'gk', 'yk', 'pte', 'bhd', 'berhad', 'pvt',
  // Gulf
  'fzllc', 'fze', 'fzco', 'wll', 'pjsc', 'psc', 'spc',
];

/**
 * Short forms that are also ordinary words or initials ("AS", "SE", "AG", "AB", "SA", "ME"…).
 * Stripped only when written as a legal form: all capitals or with dots/slashes ("A/S", "e.V.").
 */
const AMBIGUOUS: readonly string[] = [
  'se', 'sa', 'ab', 'as', 'is', 'ks', 'hb', 'kb', 'da', 'ky', 'tmi', 'ou', 'bt', 'dd', 'ad', 'ae', 'oe', 'ee', 'ek', 'ev', 'ig',
  'cv', 'pc', 'lp', 'ua',
];

/** Multi-token forms, longest first when matched. */
const SEQUENCES: readonly (readonly string[])[] = [
  ['gmbh', 'and', 'co', 'kgaa'], ['gmbh', 'and', 'co', 'kg'], ['gmbh', 'and', 'co', 'ohg'], ['gmbh', 'co', 'kg'],
  ['ag', 'and', 'co', 'kgaa'], ['ag', 'and', 'co', 'kg'], ['se', 'and', 'co', 'kgaa'], ['se', 'and', 'co', 'kg'],
  ['ug', 'and', 'co', 'kg'], ['ltd', 'and', 'co', 'kg'], ['bv', 'and', 'co', 'kg'], ['and', 'co', 'kg'], ['and', 'co', 'ohg'],
  ['co', 'kg'], ['and', 'co'], ['and', 'cie'], ['et', 'cie'], ['e', 'k'], ['e', 'v'], ['g', 'm', 'b', 'h'],
  ['sp', 'z', 'oo'], ['sp', 'z', 'o', 'o'], ['spz', 'oo'], ['spolka', 'z', 'ograniczona', 'odpowiedzialnoscia'], ['sp', 'k'], ['sp', 'j'],
  ['spol', 's', 'ro'], ['spol', 's', 'r', 'o'], ['s', 'r', 'o'], ['a', 's'], ['k', 's'], ['v', 'o', 's'],
  ['d', 'o', 'o'], ['d', 'd'],
  ['s', 'a', 'de', 'c', 'v'], ['sa', 'de', 'cv'], ['s', 'de', 'rl', 'de', 'cv'], ['sapi', 'de', 'cv'], ['s', 'de', 'rl'],
  ['s', 'a', 's'], ['s', 'a', 'r', 'l'], ['s', 'a', 'u'], ['s', 'l', 'u'], ['s', 'r', 'l'], ['s', 'p', 'a'], ['s', 'a'], ['s', 'l'],
  ['s', 'e'], ['a', 'g'], ['b', 'v'], ['n', 'v'], ['a', 'b'],
  ['cooperatie', 'ua'], ['co', 'ltd'], ['co', 'limited'], ['pty', 'ltd'], ['pty', 'limited'], ['pte', 'ltd'], ['pte', 'limited'],
  ['pvt', 'ltd'], ['private', 'limited'], ['public', 'limited', 'company'], ['limited', 'liability', 'company'],
  ['limited', 'partnership'], ['sdn', 'bhd'],
  ['kabushiki', 'kaisha'], ['godo', 'kaisha'], ['yugen', 'kaisha'],
  ['fz', 'llc'], ['fz', 'co'], ['l', 'l', 'c'], ['ab', 'publ'], ['oy', 'ab'], ['i', 's'], ['a', 'm', 'b', 'a'],
  ['societe', 'anonyme'], ['societe', 'par', 'actions', 'simplifiee'], ['sociedad', 'anonima'], ['sociedad', 'limitada'],
  ['societa', 'per', 'azioni'], ['societa', 'a', 'responsabilita', 'limitata'], ['naamloze', 'vennootschap'],
  ['besloten', 'vennootschap'], ['aktiengesellschaft'], ['gesellschaft', 'mit', 'beschrankter', 'haftung'],
];

export const LEGAL_PLAIN: ReadonlySet<string> = new Set(PLAIN);
export const LEGAL_AMBIGUOUS: ReadonlySet<string> = new Set(AMBIGUOUS);
/** Sequences sorted longest first so "gmbh and co kg" wins over "co kg". */
export const LEGAL_SEQUENCES: readonly (readonly string[])[] = [...SEQUENCES].sort((a, b) => b.length - a.length);

/** Leading words that do not identify the company ("The Acme Company"). */
export const LEADING_NOISE: ReadonlySet<string> = new Set(['the']);
