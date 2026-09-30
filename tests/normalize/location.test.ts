import { describe, expect, it } from 'vitest';
import { normalizeLocation, regionName, type LocationHints } from '@/lib/normalize/location';
import { COUNTRIES, CITIES, MACRO_REGIONS, findCities, findCountry, lookupCode } from '@/data/places';
import { TIER_1_COUNTRIES as TIER_1, TIER_2_COUNTRIES as TIER_2, TIER_3_COUNTRIES as TIER_3, TIER_4_COUNTRIES as TIER_4 } from '@/lib/contracts/settings';

type Expect = {
  country: string | null;
  city?: string | null;
  region?: string | null;
  wp?: 'remote' | 'hybrid' | 'onsite' | null;
  conf?: 'high' | 'medium' | 'low';
  known?: boolean;
  macro?: string[];
  tz?: string[];
  countries?: string[];
  officeDays?: number | null;
};

const CASES: [string, Expect, LocationHints?][] = [
  // Remote scopes
  ['Remote – EMEA', { country: 'XW', city: null, wp: 'remote', conf: 'medium', macro: ['EMEA'] }],
  ['Anywhere', { country: 'XW', wp: 'remote', conf: 'medium', macro: ['WORLDWIDE'] }],
  ['Remote', { country: 'XW', wp: 'remote', conf: 'low' }],
  ['Remote (Europe)', { country: 'XW', wp: 'remote', conf: 'medium', macro: ['EUROPE'] }],
  ['Remote in the EU', { country: 'XW', wp: 'remote', conf: 'medium', macro: ['EU'] }],
  ['Remote (UK&I)', { country: 'XW', wp: 'remote', macro: ['UKI'] }],
  ['Nordics (remote)', { country: 'XW', wp: 'remote', macro: ['NORDICS'] }],
  ['APAC, remote', { country: 'XW', wp: 'remote', macro: ['APAC'] }],
  ['Remote - Americas', { country: 'XW', wp: 'remote', macro: ['AMERICAS'] }],
  ['DACH', { country: null, wp: null, conf: 'low', macro: ['DACH'] }],
  ['LATAM', { country: null, macro: ['LATAM'] }],
  ['Remote - CET +/- 2h', { country: 'XW', wp: 'remote', conf: 'medium', tz: ['CET'] }],
  ['Remote – Europe (CET ± 3 hours)', { country: 'XW', macro: ['EUROPE'], tz: ['CET'] }],
  ['Remote (EST hours)', { country: 'XW', tz: ['ET'] }],
  ['Remote, ET hours', { country: 'XW', tz: ['ET'] }],
  ['UTC+1 to UTC+3, remote', { country: 'XW', wp: 'remote', tz: ['UTC', 'UTC+1', 'UTC+3'] }],
  ['US-Remote', { country: 'US', city: null, wp: 'remote', conf: 'high' }],
  ['Remote, US', { country: 'US', wp: 'remote' }],
  ['Remote, USA', { country: 'US', wp: 'remote' }],
  ['Remote, DE', { country: 'DE', wp: 'remote', conf: 'high' }],
  ['Remote - PT', { country: 'PT', wp: 'remote' }],
  ['Remote - NO', { country: 'NO', wp: 'remote' }],
  ['Portugal (Remote)', { country: 'PT', wp: 'remote' }],
  ['Remote (Germany only)', { country: 'DE', wp: 'remote' }],
  ['Remote from Poland', { country: 'PL', wp: 'remote' }],
  ['Remote, India', { country: 'IN', wp: 'remote' }],
  ['Remote - US or Canada', { country: 'US', wp: 'remote', countries: ['US', 'CA'] }],
  ['Remote (US) or Remote (Canada)', { country: 'US', countries: ['US', 'CA'] }],
  ['Germany, Netherlands, Spain (Remote)', { country: 'DE', wp: 'remote', countries: ['DE', 'NL', 'ES'] }],
  ['Remote - Germany or Austria', { country: 'DE', countries: ['DE', 'AT'] }],
  ['100% Homeoffice', { country: 'XW', wp: 'remote' }],
  ['Praca zdalna', { country: 'XW', wp: 'remote' }],
  ['Teletrabajo (España)', { country: 'ES', city: null, wp: 'remote', conf: 'high' }],
  ['Remote OR Hybrid', { country: 'XW', wp: 'remote' }],
  ['Remote in IN', { country: 'XW', wp: 'remote' }],
  // Hybrid / onsite
  ['Hybrid, 3 days in office', { country: null, wp: 'hybrid', conf: 'low', officeDays: 3 }],
  ['Hybrid (2 days/week in the office), Dublin', { country: 'IE', city: 'Dublin', wp: 'hybrid', officeDays: 2 }],
  ['3 Tage im Büro, Köln', { country: 'DE', city: 'Cologne', region: 'NW', wp: 'hybrid', officeDays: 3 }],
  ['2 jours sur site par semaine - Lyon', { country: 'FR', city: 'Lyon', wp: 'hybrid', officeDays: 2 }],
  ['Remote - 2 days per week in office', { wp: 'hybrid', country: null, officeDays: 2 }],
  ['Berlin, Germany (Hybrid)', { country: 'DE', city: 'Berlin', region: 'BE', wp: 'hybrid', conf: 'high' }],
  ['Hybrid remote in Amsterdam', { country: 'NL', city: 'Amsterdam', wp: 'hybrid' }],
  ['Homeoffice möglich, Hamburg', { country: 'DE', city: 'Hamburg', wp: 'hybrid' }],
  ['Télétravail partiel, Paris', { country: 'FR', city: 'Paris', wp: 'hybrid' }],
  ['Hybrid - Madrid', { country: 'ES', city: 'Madrid', wp: 'hybrid' }],
  ['Amsterdam or Remote (NL)', { country: 'NL', city: 'Amsterdam', region: 'NH', wp: 'remote', conf: 'high' }],
  ['Berlin or Remote', { country: 'DE', city: 'Berlin', wp: 'remote' }],
  ['No remote, Berlin', { country: 'DE', city: 'Berlin', wp: 'onsite' }],
  ['On-site - Lisbon', { country: 'PT', city: 'Lisbon', wp: 'onsite' }],
  // Cities, local spellings, postal codes, markers
  ['London, England, United Kingdom', { country: 'GB', city: 'London', region: 'ENG', conf: 'high' }],
  ['Berlin | Munich', { country: 'DE', city: 'Berlin' }],
  ['10115 Berlin', { country: 'DE', city: 'Berlin' }],
  ['Frankfurt am Main (m/w/d)', { country: 'DE', city: 'Frankfurt', region: 'HE' }],
  ['München', { country: 'DE', city: 'Munich', region: 'BY' }],
  ['Muenchen, Bayern', { country: 'DE', city: 'Munich', region: 'BY' }],
  ['Munich, Bavaria, Germany', { country: 'DE', city: 'Munich', region: 'BY' }],
  ['Munich, BY', { country: 'DE', city: 'Munich', region: 'BY' }],
  ['Munich, BY, DE', { country: 'DE', city: 'Munich', region: 'BY' }],
  ['Den Haag', { country: 'NL', city: 'The Hague', region: 'ZH' }],
  ["'s-Gravenhage, Zuid-Holland", { country: 'NL', city: 'The Hague' }],
  ['Lisboa, Portugal', { country: 'PT', city: 'Lisbon' }],
  ['Praha, Česko', { country: 'CZ', city: 'Prague' }],
  ['Warszawa, Polska', { country: 'PL', city: 'Warsaw', region: 'MZ' }],
  ['Wien, Österreich', { country: 'AT', city: 'Vienna', region: 'W' }],
  ['Zürich, Schweiz', { country: 'CH', city: 'Zurich', region: 'ZH' }],
  ['Genève, Suisse', { country: 'CH', city: 'Geneva' }],
  ['Geneva, GE', { country: 'CH', city: 'Geneva', region: 'GE' }],
  ['Göteborg, Sverige', { country: 'SE', city: 'Gothenburg' }],
  ['København, Danmark', { country: 'DK', city: 'Copenhagen' }],
  ['Bruxelles, Belgique', { country: 'BE', city: 'Brussels' }],
  ['Brussel', { country: 'BE', city: 'Brussels' }],
  ['Milano, Lombardia, Italia', { country: 'IT', city: 'Milan', region: 'LOM' }],
  ['Roma', { country: 'IT', city: 'Rome' }],
  ['Torino', { country: 'IT', city: 'Turin' }],
  ['Napoli', { country: 'IT', city: 'Naples' }],
  ['Gdańsk', { country: 'PL', city: 'Gdańsk' }],
  ['Łódź', { country: 'PL', city: 'Łódź' }],
  ['Kraków, Małopolskie, Poland', { country: 'PL', city: 'Kraków' }],
  ['Cluj-Napoca', { country: 'RO', city: 'Cluj-Napoca' }],
  ['București, România', { country: 'RO', city: 'Bucharest' }],
  ['Ljubljana', { country: 'SI', city: 'Ljubljana' }],
  ['Zagreb, Hrvatska', { country: 'HR', city: 'Zagreb' }],
  ['Bratislava, Slovensko', { country: 'SK', city: 'Bratislava' }],
  ['Budapest, Magyarország', { country: 'HU', city: 'Budapest' }],
  ['Sofia, Bulgaria', { country: 'BG', city: 'Sofia' }],
  ['Nicosia, Cyprus', { country: 'CY', city: 'Nicosia' }],
  ['Limassol', { country: 'CY', city: 'Limassol' }],
  ['Helsinki, Suomi', { country: 'FI', city: 'Helsinki' }],
  ['Oslo, Norge', { country: 'NO', city: 'Oslo' }],
  ['Oslo, NO', { country: 'NO', city: 'Oslo' }],
  ['Vilnius', { country: 'LT', city: 'Vilnius' }],
  ['Rīga', { country: 'LV', city: 'Riga' }],
  ['Tartu', { country: 'EE', city: 'Tartu' }],
  ['Tallinn, Harjumaa, Estonia', { country: 'EE', city: 'Tallinn' }],
  ['Stockholm, Stockholm County, Sweden', { country: 'SE', city: 'Stockholm', region: 'AB' }],
  ['Reykjavik', { country: 'IS', city: 'Reykjavík' }],
  ['Valletta, Malta', { country: 'MT', city: 'Valletta' }],
  ["St. Julian's, Malta", { country: 'MT', city: "St. Julian's" }],
  ['Sliema, MT', { country: 'MT', city: 'Sliema' }],
  ['Luxembourg City', { country: 'LU', city: 'Luxembourg City' }],
  ['Esch-sur-Alzette, Luxembourg', { country: 'LU', city: 'Esch-sur-Alzette' }],
  ['Luxembourg', { country: 'LU', city: null }],
  ['Dublin 2, Ireland', { country: 'IE', city: 'Dublin' }],
  ['D02 X285 Dublin', { country: 'IE', city: 'Dublin' }],
  ['EC2A 4NE London', { country: 'GB', city: 'London' }],
  ['Cambridge', { country: 'GB', city: 'Cambridge' }],
  ['Split, Croatia', { country: 'HR', city: 'Split' }],
  ['Stuttgart-Vaihingen', { country: 'DE', city: 'Stuttgart' }],
  ['Walldorf, Baden-Württemberg, Germany', { country: 'DE', city: 'Walldorf', region: 'BW' }],
  ['Eschborn bei Frankfurt, Germany', { country: 'DE', city: 'Eschborn' }],
  ['Oficina: Barcelona, España', { country: 'ES', city: 'Barcelona' }],
  // Unknown towns next to a known country
  ['Neu-Isenburg, Germany', { country: 'DE', city: 'Neu-Isenburg', known: false, conf: 'medium' }],
  // North America: states, provinces, homonyms
  ['Austin, TX 78701', { country: 'US', city: 'Austin', region: 'TX', conf: 'high' }],
  ['San Francisco, CA', { country: 'US', city: 'San Francisco', region: 'CA' }],
  ['SF Bay Area', { country: 'US', city: 'San Francisco' }],
  ['New York, NY', { country: 'US', city: 'New York', region: 'NY' }],
  ['NYC', { country: 'US', city: 'New York' }],
  ['Wilmington, DE', { country: 'US', city: 'Wilmington', region: 'DE' }],
  ['Portland, OR', { country: 'US', city: 'Portland', region: 'OR' }],
  ['Cambridge, MA', { country: 'US', city: 'Cambridge', region: 'MA' }],
  ['Paris, Texas', { country: 'US', city: 'Paris', region: 'TX' }],
  ['Atlanta, Georgia', { country: 'US', city: 'Atlanta', region: 'GA' }],
  ['Atlanta, GA', { country: 'US', city: 'Atlanta', region: 'GA' }],
  ['Tbilisi, Georgia', { country: 'GE', city: 'Tbilisi' }],
  ['Vienna, VA', { country: 'US', city: 'Vienna', region: 'VA', known: false, countries: ['US'] }],
  ['Berlin, CT', { country: 'US', city: 'Berlin', region: 'CT', known: false }],
  ['Toronto, ON, Canada', { country: 'CA', city: 'Toronto', region: 'ON' }],
  ['London, ON', { country: 'CA', city: 'London', region: 'ON' }],
  ['Sydney NSW', { country: 'AU', city: 'Sydney', region: 'NSW' }],
  ['Minsk, BY', { country: 'BY', city: 'Minsk' }],
  // Rest of world
  ['Bengaluru, Karnataka, India', { country: 'IN', city: 'Bengaluru', region: 'KA' }],
  ['Pune, IN', { country: 'IN', city: 'Pune' }],
  ['Chennai / Hyderabad / Remote (India)', { country: 'IN', city: 'Chennai', wp: 'remote' }],
  ['Singapore', { country: 'SG', city: 'Singapore' }],
  ['Hong Kong SAR', { country: 'HK' }],
  ['Tokyo, Japan', { country: 'JP', city: 'Tokyo' }],
  ['Seoul, South Korea', { country: 'KR', city: 'Seoul' }],
  ['Taipei City, Taiwan', { country: 'TW', city: 'Taipei' }],
  ['Kuala Lumpur, Malaysia', { country: 'MY', city: 'Kuala Lumpur' }],
  ['KL', { country: 'MY', city: 'Kuala Lumpur' }],
  ['Dubai, UAE', { country: 'AE', city: 'Dubai' }],
  ['Riyadh, KSA', { country: 'SA', city: 'Riyadh' }],
  ['Tel Aviv-Yafo, Israel', { country: 'IL', city: 'Tel Aviv' }],
  ['São Paulo, Brazil', { country: 'BR', city: 'São Paulo' }],
  ['CDMX', { country: 'MX', city: 'Mexico City' }],
  ['Ciudad de México', { country: 'MX', city: 'Mexico City' }],
  ['Ελλάδα', { country: 'GR', city: null }],
  ['Αθήνα, Ελλάδα', { country: 'GR', city: 'Athens' }],
  ['Κύπρος', { country: 'CY' }],
  ['Éire', { country: 'IE' }],
  ['IT', { country: 'IT' }],
  // Nothing usable
  ['', { country: null, city: null, wp: null, conf: 'low' }],
  ['Multiple Locations', { country: null, city: null, conf: 'low' }],
  // Hints
  ['Berlin', { country: 'DE', city: 'Berlin', conf: 'high' }, { country: 'DE' }],
  ['Remote', { country: 'DE', wp: 'remote', conf: 'medium' }, { country: 'DE' }],
  ['London', { country: 'CA', city: 'London', region: 'ON' }, { country: 'CA' }],
  ['London, UK', { country: 'GB', city: 'London', conf: 'low' }, { country: 'DE' }],
  ['', { country: 'NL', city: 'Utrecht', conf: 'medium' }, { country: 'NL', city: 'Utrecht' }],
  ['', { country: 'DE', city: 'Munich', region: 'BY' }, { country: 'DE', city: 'Muenchen' }],
  ['Some Town', { country: 'FR', city: 'Some Town', known: false, conf: 'medium' }, { country: 'FR' }],
  ['Remote', { country: 'XW', wp: 'remote' }, { workplace: 'remote' }],
  ['Office', { country: null, wp: 'onsite' }, { workplace: 'onsite' }],
  ['Bozeman, MT', { country: 'US', city: 'Bozeman', region: 'MT' }, { country: 'US' }],
  ['Wilmington, DE', { country: 'US', city: 'Wilmington', conf: 'low' }, { country: 'DE' }],
  ['Berlin', { country: 'DE' }, { country: 'Deutschland' }],
];

describe('normalizeLocation (table)', () => {
  it.each(CASES)('%s', (raw, exp, hints) => {
    const r = normalizeLocation(raw, hints);
    expect(r.countryIso2).toBe(exp.country);
    if (exp.city !== undefined) expect(r.city).toBe(exp.city);
    if (exp.region !== undefined) expect(r.region).toBe(exp.region);
    if (exp.wp !== undefined) expect(r.workplaceType).toBe(exp.wp);
    if (exp.conf) expect(r.confidence).toBe(exp.conf);
    if (exp.known !== undefined) expect(r.cityKnown).toBe(exp.known);
    if (exp.macro) expect(r.macroRegions).toEqual(expect.arrayContaining(exp.macro));
    if (exp.tz) expect(r.timezones).toEqual(expect.arrayContaining(exp.tz));
    if (exp.countries) expect(r.countries).toEqual(exp.countries);
    if (exp.officeDays !== undefined) expect(r.officeDays).toBe(exp.officeDays);
    expect(r.evidence.length).toBeGreaterThan(0);
    expect(r.evidence.length).toBeLessThanOrEqual(500);
  });
});

describe('normalizeLocation details', () => {
  it('records the postal code and strips gender markers', () => {
    const r = normalizeLocation('80331 München (m/w/d)');
    expect(r.postalCode).toBe('80331');
    expect(r.city).toBe('Munich');
    expect(r.evidence).toContain('postal code');
  });

  it('keeps the remote scope text only for remote jobs', () => {
    expect(normalizeLocation('Remote – EMEA').remoteScopeRaw).toBe('Remote - EMEA');
    expect(normalizeLocation('Berlin').remoteScopeRaw).toBeNull();
  });

  it('flags target countries', () => {
    expect(normalizeLocation('Berlin').targetCountry).toBe(true);
    expect(normalizeLocation('Pune, India').targetCountry).toBe(false);
    expect(normalizeLocation('Remote').targetCountry).toBe(true);
    expect(normalizeLocation('').targetCountry).toBeNull();
  });

  it('does not read everyday words as place codes', () => {
    expect(normalizeLocation('Remote OR Hybrid').countries).toEqual([]);
    expect(normalizeLocation('Work in IT from home').countries).toEqual([]);
    expect(normalizeLocation('split 3/2 office/remote').cities).toEqual([]);
  });

  it('lists every city found', () => {
    const r = normalizeLocation('Berlin | Munich | Hamburg');
    expect(r.cities.map((c) => c.name)).toEqual(['Berlin', 'Munich', 'Hamburg']);
  });

  it('survives hostile input', () => {
    expect(() => normalizeLocation(undefined as unknown as string)).not.toThrow();
    expect(normalizeLocation('x'.repeat(5000)).evidence.length).toBeLessThanOrEqual(500);
    expect(normalizeLocation('(((,,,///|||)))').countryIso2).toBeNull();
  });

  it('regionName resolves stored codes', () => {
    expect(regionName('US', 'CA')).toBe('California');
    expect(regionName('DE', 'BY')).toBe('Bavaria');
    expect(regionName(null, 'CA')).toBeNull();
  });
});

describe('place data', () => {
  it('covers every target-tier country', () => {
    const iso = new Set(COUNTRIES.map((c) => c.iso2));
    for (const c of [...TIER_1, ...TIER_2, ...TIER_3, ...TIER_4]) expect(iso.has(c)).toBe(true);
  });

  it('knows cities for every target country', () => {
    const withCities = new Set(CITIES.map((c) => c.country));
    for (const c of [...TIER_1, ...TIER_2, ...TIER_3, ...TIER_4]) expect(withCities.has(c)).toBe(true);
  });

  it('has a non-trivial Indian city list for non-target flagging', () => {
    expect(CITIES.filter((c) => c.country === 'IN').length).toBeGreaterThanOrEqual(15);
    expect(findCities('Bangalore')[0]?.country).toBe('IN');
    expect(findCities('Gurgaon')[0]?.country).toBe('IN');
  });

  it('finds countries by local name and code', () => {
    expect(findCountry('Deutschland')?.iso2).toBe('DE');
    expect(findCountry('Nederland')?.iso2).toBe('NL');
    expect(findCountry('Sverige')?.iso2).toBe('SE');
    expect(findCountry('Česká republika')?.iso2).toBe('CZ');
    expect(findCountry('UK')?.iso2).toBe('GB');
    expect(findCountry('de')?.iso2).toBe('DE');
    expect(findCountry('Atlantis')).toBeNull();
  });

  it('city lookup is diacritic-insensitive', () => {
    expect(findCities('Malmo')[0]?.name).toBe(findCities('Malmö')[0]?.name);
    expect(findCities('Dusseldorf')[0]?.name).toBe(findCities('Düsseldorf')[0]?.name);
    expect(findCities('Duesseldorf')[0]?.country).toBe('DE');
  });

  it('macro-region keys are unique and members are known countries', () => {
    const keys = MACRO_REGIONS.map((m) => m.key);
    expect(new Set(keys).size).toBe(keys.length);
    const iso = new Set(COUNTRIES.map((c) => c.iso2));
    for (const m of MACRO_REGIONS) for (const c of m.countries) expect(iso.has(c)).toBe(true);
  });

  it('indexes codes only in uppercase', () => {
    expect(lookupCode('DE').length).toBeGreaterThan(0);
    expect(lookupCode('de')).toEqual([]);
  });
});
