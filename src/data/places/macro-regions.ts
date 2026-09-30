/**
 * Multi-country region words used in remote scopes and multi-location postings
 * ("Remote – EMEA", "anywhere in the EU", "DACH", "Nordics"). `countries` lists the ISO2 codes a
 * region covers, so the remote classifier can check whether a target country is included.
 * EMEA / APAC / worldwide are listed by their target-relevant members only where the full list
 * would be meaningless; `open` marks those as "and others".
 */

export interface MacroRegion {
  key: string;
  label: string;
  aliases: readonly string[];
  /** Case-sensitive (uppercase) spellings that are ambiguous in lowercase ("EU", "US&C"). */
  codes?: readonly string[];
  countries: readonly string[];
  /** True when the region has more members than `countries` lists. */
  open: boolean;
}

const EU27 = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
] as const;
const EEA = [...EU27, 'IS', 'LI', 'NO'] as const;
const EUROPE = [...EEA, 'GB', 'CH', 'RS', 'BA', 'MK', 'AL', 'ME', 'MD', 'UA', 'BY', 'TR', 'AD', 'MC'] as const;
const NORDICS = ['DK', 'SE', 'NO', 'FI', 'IS'] as const;
const BALTICS = ['EE', 'LV', 'LT'] as const;
const CEE = ['PL', 'CZ', 'SK', 'HU', 'RO', 'BG', 'HR', 'SI', 'EE', 'LV', 'LT', 'RS', 'BA', 'MK', 'AL', 'ME', 'MD', 'UA'] as const;
const MIDDLE_EAST = ['AE', 'SA', 'QA', 'BH', 'KW', 'OM', 'IL', 'JO', 'LB', 'EG', 'TR'] as const;
const GCC = ['AE', 'SA', 'QA', 'BH', 'KW', 'OM'] as const;
const APAC = ['AU', 'NZ', 'SG', 'JP', 'KR', 'HK', 'TW', 'MY', 'IN', 'CN', 'ID', 'PH', 'TH', 'VN', 'PK', 'BD', 'LK', 'NP'] as const;
const LATAM = ['BR', 'MX', 'AR', 'CL', 'CO', 'PE', 'UY', 'CR'] as const;

export const MACRO_REGIONS: readonly MacroRegion[] = [
  { key: 'WORLDWIDE', label: 'Worldwide', open: true, countries: [],
    aliases: ['Worldwide', 'Anywhere', 'Anywhere in the world', 'Global', 'Globally', 'Work from anywhere', 'Location independent',
      'Weltweit', 'Überall', 'Partout dans le monde', 'Monde entier', 'En cualquier lugar', 'Cualquier lugar', 'Todo el mundo', 'Ovunque', 'Wereldwijd', 'Overal', 'Mundial', 'Qualquer lugar', 'Cały świat'] },
  { key: 'EMEA', label: 'EMEA', open: true, countries: [...EUROPE, ...MIDDLE_EAST, 'ZA', 'NG', 'KE', 'MA', 'TN'],
    aliases: ['EMEA', 'Europe, Middle East and Africa', 'Europe Middle East Africa', 'Europe, Middle East & Africa'] },
  { key: 'EU', label: 'European Union', open: false, countries: EU27, codes: ['EU'],
    aliases: ['European Union', 'Europäische Union', 'Union européenne', 'Unión Europea', 'Unione Europea', 'Europese Unie', 'União Europeia', 'Unia Europejska', 'Evropská unie', 'Europeiska unionen', 'Den Europæiske Union', 'Euroopan unioni'] },
  { key: 'EEA', label: 'EEA', open: false, countries: EEA, codes: ['EEA', 'EWR', 'EEE'],
    aliases: ['European Economic Area', 'Europäischer Wirtschaftsraum', 'Espace économique européen', 'Espacio Económico Europeo'] },
  { key: 'EUROPE', label: 'Europe', open: false, countries: EUROPE,
    aliases: ['Europe', 'European', 'Europa', 'Evropa', 'Eurooppa', 'Európa', 'Ευρώπη', 'Continental Europe', 'Western Europe', 'Westeuropa', 'Europe de l\'Ouest', 'Europa Occidental', 'Southern Europe', 'Northern Europe', 'Central Europe', 'Mitteleuropa', 'Zentraleuropa'] },
  { key: 'DACH', label: 'DACH', open: false, countries: ['DE', 'AT', 'CH'], aliases: ['DACH', 'D-A-CH', 'DACH region', 'DACH-Region'] },
  { key: 'NORDICS', label: 'Nordics', open: false, countries: NORDICS,
    aliases: ['Nordics', 'Nordic', 'Nordic countries', 'Nordic region', 'Scandinavia', 'Scandinavian', 'Skandinavien', 'Skandinavia', 'Scandinavie', 'Escandinavia', 'Pohjoismaat', 'Nordeuropa'] },
  { key: 'BENELUX', label: 'Benelux', open: false, countries: ['BE', 'NL', 'LU'], aliases: ['Benelux', 'BeNeLux', 'Benelux countries'] },
  { key: 'BALTICS', label: 'Baltics', open: false, countries: BALTICS, aliases: ['Baltics', 'Baltic states', 'Baltic countries', 'Baltikum', 'Pays baltes'] },
  { key: 'CEE', label: 'Central & Eastern Europe', open: false, countries: CEE,
    aliases: ['CEE', 'Central and Eastern Europe', 'Central & Eastern Europe', 'Central Eastern Europe', 'Eastern Europe', 'Osteuropa', 'Mittel- und Osteuropa', 'Europe de l\'Est', 'Europa del Este', 'Europa Wschodnia', 'Europa Środkowo-Wschodnia'] },
  { key: 'IBERIA', label: 'Iberia', open: false, countries: ['ES', 'PT'], aliases: ['Iberia', 'Iberian Peninsula', 'Península Ibérica', 'Iberische Halbinsel'] },
  { key: 'UKI', label: 'UK & Ireland', open: false, countries: ['GB', 'IE'], codes: ['UK&I', 'UKI', 'UK&IE'],
    aliases: ['UK&I', 'UK & I', 'UK and Ireland', 'UK & Ireland', 'UKI', 'UK&IE', 'Great Britain and Ireland', 'British Isles'] },
  { key: 'MIDDLE_EAST', label: 'Middle East', open: false, countries: MIDDLE_EAST, aliases: ['Middle East', 'Naher Osten', 'Mittlerer Osten', 'Moyen-Orient', 'Oriente Medio', 'Medio Oriente'] },
  { key: 'MENA', label: 'MENA', open: false, countries: [...MIDDLE_EAST, 'MA', 'TN'], aliases: ['MENA', 'Middle East and North Africa', 'Middle East & North Africa'] },
  { key: 'GCC', label: 'GCC', open: false, countries: GCC, aliases: ['GCC', 'Gulf region', 'Gulf countries', 'Gulf Cooperation Council', 'Arabian Gulf'] },
  { key: 'APAC', label: 'APAC', open: true, countries: APAC, aliases: ['APAC', 'APJ', 'APJC', 'Asia Pacific', 'Asia-Pacific', 'Asia/Pacific', 'Asien-Pazifik', 'Asie-Pacifique'] },
  { key: 'ASIA', label: 'Asia', open: true, countries: APAC.filter((c) => c !== 'AU' && c !== 'NZ'), aliases: ['Asia', 'Asien', 'Asie', 'Southeast Asia', 'South East Asia', 'SEA region', 'South Asia'] },
  { key: 'ANZ', label: 'Australia & New Zealand', open: false, countries: ['AU', 'NZ'], aliases: ['ANZ', 'Australia and New Zealand', 'Australia & New Zealand', 'Oceania', 'Australasia'] },
  { key: 'NORTH_AMERICA', label: 'North America', open: false, countries: ['US', 'CA', 'MX'],
    aliases: ['North America', 'NA region', 'NORAM', 'NAMER', 'AMER', 'US & Canada', 'US and Canada', 'USA & Canada', 'USA and Canada', 'Nordamerika', 'Amérique du Nord', 'América del Norte', 'Nord America'] },
  { key: 'AMERICAS', label: 'Americas', open: true, countries: ['US', 'CA', ...LATAM], aliases: ['Americas', 'The Americas', 'Amerika', 'Amériques', 'Américas'] },
  { key: 'LATAM', label: 'Latin America', open: true, countries: LATAM,
    aliases: ['LATAM', 'LatAm', 'Latin America', 'South America', 'Central America', 'Lateinamerika', 'Südamerika', 'Amérique latine', 'América Latina', 'Latinoamérica', 'Sudamérica', 'América do Sul'] },
];

export const MACRO_REGION_BY_KEY: ReadonlyMap<string, MacroRegion> = new Map(MACRO_REGIONS.map((m) => [m.key, m]));
