/**
 * First-level subdivisions (states, provinces, Länder, regions) that appear in location strings,
 * e.g. "Austin, TX", "Toronto, ON", "Sydney NSW", "Milan, Lombardy, Italy",
 * "Bengaluru, Karnataka, India". `code` is the short code returned as LocationResult.region.
 * Codes are only matched as UPPERCASE tokens and only where `codeInText` is set (US/CA/AU),
 * because elsewhere they are not written in postings and collide with country codes.
 */

export interface RegionInfo {
  country: string;
  code: string;
  name: string;
  aliases: readonly string[];
  /** The code itself is commonly written in location strings ("Austin, TX"). */
  codeInText: boolean;
}

type Row = readonly [code: string, name: string, ...aliases: string[]];

function build(country: string, codeInText: boolean, rows: readonly Row[]): RegionInfo[] {
  return rows.map(([code, name, ...aliases]) => ({ country, code, name, aliases, codeInText }));
}

const US: Row[] = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California', 'Calif', 'Kalifornien', 'Californie'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia', 'Washington DC', 'Washington D.C.'],
  ['FL', 'Florida', 'Floride'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'],
  ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
  ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'],
  ['NM', 'New Mexico'], ['NY', 'New York State'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'],
  ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'],
  ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'],
  ['WA', 'Washington State'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'],
];

const CA: Row[] = [
  ['AB', 'Alberta'], ['BC', 'British Columbia', 'Colombie-Britannique'], ['MB', 'Manitoba'], ['NB', 'New Brunswick', 'Nouveau-Brunswick'],
  ['NL', 'Newfoundland and Labrador', 'Newfoundland', 'Terre-Neuve-et-Labrador'], ['NS', 'Nova Scotia', 'Nouvelle-Écosse'],
  ['NT', 'Northwest Territories'], ['NU', 'Nunavut'], ['ON', 'Ontario'], ['PE', 'Prince Edward Island', 'PEI', 'Île-du-Prince-Édouard'],
  ['QC', 'Quebec', 'Québec', 'Province of Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

const AU: Row[] = [
  ['NSW', 'New South Wales'], ['VIC', 'Victoria'], ['QLD', 'Queensland'], ['WA', 'Western Australia'], ['SA', 'South Australia'],
  ['TAS', 'Tasmania'], ['ACT', 'Australian Capital Territory'], ['NT', 'Northern Territory'],
];

const GB: Row[] = [['ENG', 'England'], ['SCT', 'Scotland'], ['WLS', 'Wales', 'Cymru'], ['NIR', 'Northern Ireland'], ['LDN', 'Greater London']];

const DE: Row[] = [
  ['BW', 'Baden-Württemberg', 'Baden-Wuerttemberg', 'Baden Wurttemberg'], ['BY', 'Bavaria', 'Bayern', 'Bavière', 'Baviera', 'Beieren'],
  ['BE', 'Berlin State', 'Land Berlin'], ['BB', 'Brandenburg'], ['HB', 'Free Hanseatic City of Bremen'], ['HH', 'Free and Hanseatic City of Hamburg'],
  ['HE', 'Hesse', 'Hessen'], ['MV', 'Mecklenburg-Vorpommern', 'Mecklenburg-Western Pomerania'], ['NI', 'Lower Saxony', 'Niedersachsen', 'Basse-Saxe'],
  ['NW', 'North Rhine-Westphalia', 'Nordrhein-Westfalen', 'NRW', 'Rhénanie-du-Nord-Westphalie'], ['RP', 'Rhineland-Palatinate', 'Rheinland-Pfalz'],
  ['SL', 'Saarland'], ['SN', 'Saxony', 'Sachsen', 'Saxe'], ['ST', 'Saxony-Anhalt', 'Sachsen-Anhalt'], ['SH', 'Schleswig-Holstein'], ['TH', 'Thuringia', 'Thüringen'],
];

const AT: Row[] = [
  ['W', 'Vienna State', 'Bundesland Wien'], ['NO', 'Lower Austria', 'Niederösterreich'], ['OO', 'Upper Austria', 'Oberösterreich'],
  ['ST', 'Styria', 'Steiermark'], ['T', 'Tyrol', 'Tirol'], ['K', 'Carinthia', 'Kärnten'], ['S', 'Salzburg State', 'Land Salzburg'],
  ['V', 'Vorarlberg'], ['B', 'Burgenland'],
];

const CH: Row[] = [
  ['ZH', 'Canton of Zurich', 'Kanton Zürich'], ['BE', 'Canton of Bern', 'Kanton Bern'], ['VD', 'Vaud', 'Canton de Vaud', 'Waadt'],
  ['GE', 'Canton of Geneva', 'Canton de Genève'], ['BS', 'Basel-Stadt', 'Basel-City'], ['BL', 'Basel-Landschaft', 'Basel-Country'],
  ['ZG', 'Canton of Zug', 'Kanton Zug'], ['LU', 'Canton of Lucerne', 'Kanton Luzern'], ['TI', 'Ticino', 'Tessin'], ['AG', 'Aargau', 'Argovie'],
  ['SG', 'St. Gallen Canton', 'Kanton St. Gallen'], ['VS', 'Valais', 'Wallis'], ['FR', 'Fribourg Canton', 'Canton de Fribourg'], ['NE', 'Neuchâtel Canton'],
  ['SZ', 'Schwyz'], ['SO', 'Solothurn'], ['TG', 'Thurgau'], ['GR', 'Graubünden', 'Grisons'],
];

const NL: Row[] = [
  ['NH', 'North Holland', 'Noord-Holland'], ['ZH', 'South Holland', 'Zuid-Holland'], ['UT', 'Utrecht Province', 'Provincie Utrecht'],
  ['NB', 'North Brabant', 'Noord-Brabant'], ['GE', 'Gelderland'], ['OV', 'Overijssel'], ['LI', 'Limburg (NL)', 'Nederlands Limburg'],
  ['GR', 'Groningen Province'], ['FR', 'Friesland', 'Fryslân'], ['DR', 'Drenthe'], ['FL', 'Flevoland'], ['ZE', 'Zeeland'],
];

const BE: Row[] = [
  ['VLG', 'Flanders', 'Vlaanderen', 'Flandre', 'Flemish Region', 'Vlaams Gewest'],
  ['WAL', 'Wallonia', 'Wallonie', 'Walloon Region', 'Région wallonne'],
  ['BRU', 'Brussels-Capital Region', 'Brussels Capital Region', 'Région de Bruxelles-Capitale', 'Brussels Hoofdstedelijk Gewest'],
];

const FR: Row[] = [
  ['IDF', 'Île-de-France', 'Ile de France', 'Paris Region'], ['ARA', 'Auvergne-Rhône-Alpes'], ['BFC', 'Bourgogne-Franche-Comté'], ['BRE', 'Brittany', 'Bretagne'],
  ['CVL', 'Centre-Val de Loire'], ['COR', 'Corsica', 'Corse'], ['GES', 'Grand Est'], ['HDF', 'Hauts-de-France'], ['NOR', 'Normandy', 'Normandie'],
  ['NAQ', 'Nouvelle-Aquitaine'], ['OCC', 'Occitanie', 'Occitania'], ['PDL', 'Pays de la Loire'], ['PAC', "Provence-Alpes-Côte d'Azur", 'PACA', 'Provence'],
];

const IT: Row[] = [
  ['LOM', 'Lombardy', 'Lombardia', 'Lombardei'], ['LAZ', 'Lazio', 'Latium'], ['PIE', 'Piedmont', 'Piemonte'], ['VEN', 'Veneto'],
  ['EMR', 'Emilia-Romagna'], ['TOS', 'Tuscany', 'Toscana'], ['CAM', 'Campania'], ['SIC', 'Sicily', 'Sicilia'], ['PUG', 'Apulia', 'Puglia'],
  ['LIG', 'Liguria'], ['FVG', 'Friuli-Venezia Giulia'], ['TAA', 'Trentino-Alto Adige', 'Trentino-South Tyrol', 'Südtirol'], ['SAR', 'Sardinia', 'Sardegna'],
  ['MAR', 'Marche'], ['ABR', 'Abruzzo'], ['UMB', 'Umbria'], ['CAL', 'Calabria'],
];

const ES: Row[] = [
  ['MD', 'Community of Madrid', 'Comunidad de Madrid', 'Madrid Region'], ['CT', 'Catalonia', 'Cataluña', 'Catalunya', 'Catalogne'],
  ['VC', 'Valencian Community', 'Comunidad Valenciana', 'Comunitat Valenciana'], ['AN', 'Andalusia', 'Andalucía'],
  ['PV', 'Basque Country', 'País Vasco', 'Euskadi'], ['GA', 'Galicia'], ['CL', 'Castile and León', 'Castilla y León'],
  ['CM', 'Castilla-La Mancha'], ['AR', 'Aragon', 'Aragón'], ['MC', 'Region of Murcia', 'Región de Murcia'], ['IB', 'Balearic Islands', 'Illes Balears', 'Islas Baleares'],
  ['CN', 'Canary Islands', 'Islas Canarias', 'Canarias'], ['AS', 'Asturias'], ['NC', 'Navarre', 'Navarra'], ['CB', 'Cantabria'], ['EX', 'Extremadura'], ['RI', 'La Rioja'],
];

const PT: Row[] = [['LIS', 'Lisbon District', 'Distrito de Lisboa'], ['POR', 'Porto District', 'Distrito do Porto'], ['NOR', 'Norte Region'], ['ALG', 'Algarve'], ['MAD', 'Madeira'], ['ACO', 'Azores', 'Açores']];

const PL: Row[] = [
  ['MZ', 'Masovian Voivodeship', 'Mazowieckie', 'Masovia', 'Mazovia'], ['MA', 'Lesser Poland', 'Małopolskie', 'Lesser Poland Voivodeship'],
  ['DS', 'Lower Silesian Voivodeship', 'Dolnośląskie', 'Lower Silesia'], ['SL', 'Silesian Voivodeship', 'Śląskie', 'Silesia'],
  ['WP', 'Greater Poland', 'Wielkopolskie', 'Greater Poland Voivodeship'], ['PM', 'Pomeranian Voivodeship', 'Pomorskie', 'Pomerania'],
  ['LD', 'Łódź Voivodeship', 'Łódzkie'], ['KP', 'Kuyavian-Pomeranian', 'Kujawsko-Pomorskie'], ['LU', 'Lublin Voivodeship', 'Lubelskie'],
  ['PK', 'Subcarpathian', 'Podkarpackie'], ['ZP', 'West Pomeranian', 'Zachodniopomorskie'], ['WN', 'Warmian-Masurian', 'Warmińsko-Mazurskie'],
  ['PD', 'Podlaskie'], ['SK', 'Świętokrzyskie'], ['OP', 'Opolskie'], ['LB', 'Lubuskie'],
];

const IE: Row[] = [
  ['D', 'County Dublin', 'Co. Dublin', 'Co Dublin', 'Dublin County'], ['C', 'County Cork', 'Co. Cork', 'Co Cork'], ['G', 'County Galway', 'Co. Galway', 'Co Galway'],
  ['L', 'County Limerick', 'Co. Limerick', 'Co Limerick'], ['KE', 'County Kildare', 'Co. Kildare'], ['WD', 'County Waterford', 'Co. Waterford'],
  ['M', 'Munster'], ['LE', 'Leinster'], ['CN', 'Connacht', 'Connaught'],
];

const SE: Row[] = [['AB', 'Stockholm County', 'Stockholms län'], ['O', 'Västra Götaland', 'Västra Götalands län'], ['M', 'Skåne', 'Scania', 'Skåne län']];
const DK: Row[] = [['84', 'Capital Region of Denmark', 'Region Hovedstaden', 'Hovedstaden'], ['82', 'Central Denmark Region', 'Region Midtjylland'], ['81', 'North Denmark Region', 'Region Nordjylland'], ['83', 'Region of Southern Denmark', 'Region Syddanmark'], ['85', 'Region Zealand', 'Region Sjælland']];
const FI: Row[] = [['18', 'Uusimaa', 'Nyland'], ['11', 'Pirkanmaa'], ['19', 'Southwest Finland', 'Varsinais-Suomi']];
const NO: Row[] = [['03', 'Oslo County', 'Oslo fylke'], ['46', 'Vestland'], ['50', 'Trøndelag', 'Trondelag'], ['32', 'Akershus'], ['30', 'Viken']];
const CZ: Row[] = [['10', 'Prague Region', 'Hlavní město Praha'], ['64', 'South Moravian Region', 'Jihomoravský kraj'], ['80', 'Moravian-Silesian Region', 'Moravskoslezský kraj']];
const RO: Row[] = [['B', 'Bucharest-Ilfov', 'Municipiul București'], ['CJ', 'Cluj County', 'Județul Cluj'], ['IS', 'Iași County'], ['TM', 'Timiș County']];
const HU: Row[] = [['BU', 'Budapest Region', 'Közép-Magyarország']];
const GR: Row[] = [['I', 'Attica', 'Attiki', 'Αττική'], ['B', 'Central Macedonia', 'Κεντρική Μακεδονία']];

const IN: Row[] = [
  ['KA', 'Karnataka'], ['MH', 'Maharashtra'], ['TN', 'Tamil Nadu'], ['TG', 'Telangana'], ['DL', 'Delhi NCR', 'NCR', 'National Capital Region'],
  ['UP', 'Uttar Pradesh'], ['HR', 'Haryana'], ['GJ', 'Gujarat'], ['WB', 'West Bengal'], ['KL', 'Kerala'], ['AP', 'Andhra Pradesh'],
  ['RJ', 'Rajasthan'], ['MP', 'Madhya Pradesh'], ['PB', 'Punjab (India)'], ['OR', 'Odisha', 'Orissa'],
];

export const REGIONS: readonly RegionInfo[] = [
  ...build('US', true, US),
  ...build('CA', true, CA),
  ...build('AU', true, AU),
  ...build('GB', false, GB),
  ...build('DE', false, DE),
  ...build('AT', false, AT),
  ...build('CH', false, CH),
  ...build('NL', false, NL),
  ...build('BE', false, BE),
  ...build('FR', false, FR),
  ...build('IT', false, IT),
  ...build('ES', false, ES),
  ...build('PT', false, PT),
  ...build('PL', false, PL),
  ...build('IE', false, IE),
  ...build('SE', false, SE),
  ...build('DK', false, DK),
  ...build('FI', false, FI),
  ...build('NO', false, NO),
  ...build('CZ', false, CZ),
  ...build('RO', false, RO),
  ...build('HU', false, HU),
  ...build('GR', false, GR),
  ...build('IN', false, IN),
];

/** Regions whose code is written in location strings, keyed by the uppercase code. */
export const REGIONS_BY_TEXT_CODE: ReadonlyMap<string, readonly RegionInfo[]> = (() => {
  const m = new Map<string, RegionInfo[]>();
  for (const r of REGIONS) {
    if (!r.codeInText) continue;
    const list = m.get(r.code) ?? [];
    list.push(r);
    m.set(r.code, list);
  }
  return m;
})();

export function regionInfo(country: string, code: string): RegionInfo | null {
  return REGIONS.find((r) => r.country === country && r.code === code) ?? null;
}
