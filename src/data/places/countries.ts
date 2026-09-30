/**
 * Known countries (spec §4 targets plus the common non-target countries postings mention, so
 * those can be recognised and flagged instead of guessed). Names cover English, the local
 * language(s) and the main posting languages; matching is diacritic-insensitive.
 *
 * `codes` are matched only as UPPERCASE standalone tokens (they collide with words: "IT", "IN",
 * "NO", "DE"), `aliases` are matched case-insensitively anywhere.
 */
import { TIER_1_COUNTRIES, TIER_2_COUNTRIES, TIER_3_COUNTRIES, TIER_4_COUNTRIES } from '../../lib/contracts/settings';

export interface CountryInfo {
  iso2: string;
  iso3: string;
  /** English short name. */
  name: string;
  /** Other names (local, exonyms in posting languages, abbreviations). */
  aliases: readonly string[];
  /** Extra uppercase-only codes besides iso2/iso3 (e.g. 'UK' for GB). */
  codes?: readonly string[];
  /** The English name is also a common other place (Georgia = US state): match aliases only. */
  nameIsAmbiguous?: boolean;
  /** Spec §4 tier, or null when not a target country. */
  tier: 1 | 2 | 3 | 4 | null;
  /** ISO 4217 currency used for salaries. */
  currency: string;
  /** Official / business languages, ISO 639-1, most common first. */
  languages: readonly string[];
}

type Raw = Omit<CountryInfo, 'tier'>;

const RAW: readonly Raw[] = [
  // ── Tier 1 ──
  { iso2: 'DE', iso3: 'DEU', name: 'Germany', currency: 'EUR', languages: ['de'],
    aliases: ['Deutschland', 'Allemagne', 'Alemania', 'Germania', 'Duitsland', 'Alemanha', 'Niemcy', 'Německo', 'Nemecko', 'Tyskland', 'Saksa', 'Németország', 'Njemačka', 'Nemčija', 'Γερμανία', 'Federal Republic of Germany', 'Bundesrepublik Deutschland'], codes: ['BRD'] },
  { iso2: 'NL', iso3: 'NLD', name: 'Netherlands', currency: 'EUR', languages: ['nl'],
    aliases: ['The Netherlands', 'Nederland', 'Holland', 'Pays-Bas', 'Países Bajos', 'Paesi Bassi', 'Niederlande', 'Países Baixos', 'Holandia', 'Nizozemsko', 'Holandsko', 'Nederländerna', 'Nederlandene', 'Alankomaat', 'Hollandia', 'Nizozemska', 'Ολλανδία', 'Κάτω Χώρες', 'Kingdom of the Netherlands'] },
  { iso2: 'IE', iso3: 'IRL', name: 'Ireland', currency: 'EUR', languages: ['en', 'ga'],
    aliases: ['Éire', 'Republic of Ireland', 'Irland', 'Irlande', 'Irlanda', 'Ierland', 'Irlandia', 'Irsko', 'Irlanti', 'Írország', 'Irska', 'Ιρλανδία'] },
  { iso2: 'FR', iso3: 'FRA', name: 'France', currency: 'EUR', languages: ['fr'],
    aliases: ['Frankreich', 'Francia', 'Frankrijk', 'França', 'Francja', 'Francie', 'Francúzsko', 'Frankrike', 'Frankrig', 'Ranska', 'Franciaország', 'Francuska', 'Γαλλία', 'République française'] },
  { iso2: 'ES', iso3: 'ESP', name: 'Spain', currency: 'EUR', languages: ['es', 'ca', 'eu', 'gl'],
    aliases: ['España', 'Espana', 'Spanien', 'Espagne', 'Spagna', 'Spanje', 'Espanha', 'Hiszpania', 'Španělsko', 'Španielsko', 'Espanja', 'Spanyolország', 'Španjolska', 'Ισπανία', 'Espanya', 'Kingdom of Spain'] },
  { iso2: 'PT', iso3: 'PRT', name: 'Portugal', currency: 'EUR', languages: ['pt'],
    aliases: ['Portogallo', 'Portugalia', 'Portugalsko', 'Portugali', 'Portugália', 'Portugalska', 'Πορτογαλία', 'República Portuguesa'] },
  { iso2: 'BE', iso3: 'BEL', name: 'Belgium', currency: 'EUR', languages: ['nl', 'fr', 'de'],
    aliases: ['België', 'Belgique', 'Belgien', 'Bélgica', 'Belgio', 'Belgia', 'Belgie', 'Belgicko', 'Belgia', 'Belgium', 'Belgija', 'Βέλγιο'] },
  { iso2: 'LU', iso3: 'LUX', name: 'Luxembourg', currency: 'EUR', languages: ['fr', 'de', 'lb'],
    aliases: ['Luxemburg', 'Lëtzebuerg', 'Luxemburgo', 'Lussemburgo', 'Luksemburg', 'Lucembursko', 'Luxemburg', 'Luxemburgi', 'Luksemburg', 'Λουξεμβούργο', 'Grand Duchy of Luxembourg', 'Grand-Duché de Luxembourg'] },
  { iso2: 'AT', iso3: 'AUT', name: 'Austria', currency: 'EUR', languages: ['de'],
    aliases: ['Österreich', 'Oesterreich', 'Autriche', 'Oostenrijk', 'Áustria', 'Rakousko', 'Rakúsko', 'Österrike', 'Østrig', 'Østerrike', 'Itävalta', 'Ausztria', 'Austrija', 'Αυστρία', 'Republik Österreich'] },
  { iso2: 'IT', iso3: 'ITA', name: 'Italy', currency: 'EUR', languages: ['it'],
    aliases: ['Italia', 'Italien', 'Italie', 'Italië', 'Itália', 'Włochy', 'Itálie', 'Taliansko', 'Italia', 'Olaszország', 'Italija', 'Ιταλία', 'Repubblica Italiana'] },
  // ── Tier 2 ──
  { iso2: 'DK', iso3: 'DNK', name: 'Denmark', currency: 'DKK', languages: ['da'],
    aliases: ['Danmark', 'Dänemark', 'Danemark', 'Dinamarca', 'Danimarca', 'Denemarken', 'Dania', 'Dánsko', 'Tanska', 'Dánia', 'Danska', 'Δανία'] },
  { iso2: 'SE', iso3: 'SWE', name: 'Sweden', currency: 'SEK', languages: ['sv'],
    aliases: ['Sverige', 'Schweden', 'Suède', 'Suecia', 'Svezia', 'Zweden', 'Suécia', 'Szwecja', 'Švédsko', 'Ruotsi', 'Svédország', 'Švedska', 'Σουηδία'] },
  { iso2: 'FI', iso3: 'FIN', name: 'Finland', currency: 'EUR', languages: ['fi', 'sv'],
    aliases: ['Suomi', 'Finnland', 'Finlande', 'Finlandia', 'Finlândia', 'Finsko', 'Finnország', 'Finska', 'Φινλανδία'] },
  { iso2: 'NO', iso3: 'NOR', name: 'Norway', currency: 'NOK', languages: ['no', 'nb', 'nn'],
    aliases: ['Norge', 'Noreg', 'Norwegen', 'Norvège', 'Noruega', 'Norvegia', 'Noorwegen', 'Norwegia', 'Norsko', 'Nórsko', 'Norja', 'Norvégia', 'Norveška', 'Νορβηγία'] },
  { iso2: 'EE', iso3: 'EST', name: 'Estonia', currency: 'EUR', languages: ['et'],
    aliases: ['Eesti', 'Estland', 'Estonie', 'Estónia', 'Estonsko', 'Viro', 'Észtország', 'Estonija', 'Εσθονία'] },
  { iso2: 'LT', iso3: 'LTU', name: 'Lithuania', currency: 'EUR', languages: ['lt'],
    aliases: ['Lietuva', 'Litauen', 'Lituanie', 'Lituania', 'Litouwen', 'Lituânia', 'Litwa', 'Litva', 'Liettua', 'Litvánia', 'Λιθουανία'] },
  { iso2: 'LV', iso3: 'LVA', name: 'Latvia', currency: 'EUR', languages: ['lv'],
    aliases: ['Latvija', 'Lettland', 'Lettonie', 'Letonia', 'Lettonia', 'Letland', 'Letónia', 'Łotwa', 'Lotyšsko', 'Lotyšsko', 'Latvia', 'Lettország', 'Λετονία'] },
  { iso2: 'CZ', iso3: 'CZE', name: 'Czechia', currency: 'CZK', languages: ['cs'],
    aliases: ['Czech Republic', 'Česko', 'Česká republika', 'Tschechien', 'Tschechische Republik', 'Tchéquie', 'République tchèque', 'Chequia', 'República Checa', 'Repubblica Ceca', 'Cechia', 'Tsjechië', 'Tjekkiet', 'Tjeckien', 'Tsjekkia', 'Tšekki', 'Czechy', 'Republika Czeska', 'Csehország', 'Češka', 'Česko', 'Τσεχία'] },
  { iso2: 'PL', iso3: 'POL', name: 'Poland', currency: 'PLN', languages: ['pl'],
    aliases: ['Polska', 'Polen', 'Pologne', 'Polonia', 'Polónia', 'Polsko', 'Poľsko', 'Puola', 'Lengyelország', 'Poljska', 'Πολωνία', 'Rzeczpospolita Polska'] },
  { iso2: 'SI', iso3: 'SVN', name: 'Slovenia', currency: 'EUR', languages: ['sl'],
    aliases: ['Slovenija', 'Slowenien', 'Slovénie', 'Eslovenia', 'Slovenië', 'Eslovénia', 'Słowenia', 'Slovinsko', 'Slovenien', 'Szlovénia', 'Σλοβενία'] },
  { iso2: 'MT', iso3: 'MLT', name: 'Malta', currency: 'EUR', languages: ['mt', 'en'],
    aliases: ['Malte', 'Μάλτα', 'Republic of Malta'] },
  { iso2: 'RO', iso3: 'ROU', name: 'Romania', currency: 'RON', languages: ['ro'],
    aliases: ['România', 'Rumänien', 'Roumanie', 'Rumania', 'Roemenië', 'Roménia', 'Rumunia', 'Rumunsko', 'Romania', 'Rumunjska', 'Románia', 'Ρουμανία'] },
  { iso2: 'HU', iso3: 'HUN', name: 'Hungary', currency: 'HUF', languages: ['hu'],
    aliases: ['Magyarország', 'Ungarn', 'Hongrie', 'Hungría', 'Ungheria', 'Hongarije', 'Hungria', 'Węgry', 'Maďarsko', 'Unkari', 'Ungern', 'Mađarska', 'Ουγγαρία'] },
  { iso2: 'HR', iso3: 'HRV', name: 'Croatia', currency: 'EUR', languages: ['hr'],
    aliases: ['Hrvatska', 'Kroatien', 'Croatie', 'Croacia', 'Croazia', 'Kroatië', 'Croácia', 'Chorwacja', 'Chorvatsko', 'Chorvátsko', 'Kroatia', 'Horvátország', 'Κροατία'] },
  { iso2: 'SK', iso3: 'SVK', name: 'Slovakia', currency: 'EUR', languages: ['sk'],
    aliases: ['Slovensko', 'Slowakei', 'Slovaquie', 'Eslovaquia', 'Slovacchia', 'Slowakije', 'Eslováquia', 'Słowacja', 'Slovakien', 'Slovakia', 'Szlovákia', 'Slovačka', 'Σλοβακία', 'Slovak Republic'] },
  { iso2: 'BG', iso3: 'BGR', name: 'Bulgaria', currency: 'EUR', languages: ['bg'],
    aliases: ['България', 'Balgariya', 'Bulgarien', 'Bulgarie', 'Bulgarije', 'Bulgária', 'Bułgaria', 'Bulharsko', 'Bulgaria', 'Bugarska', 'Βουλγαρία'] },
  { iso2: 'GR', iso3: 'GRC', name: 'Greece', currency: 'EUR', languages: ['el'],
    aliases: ['Ελλάδα', 'Ελλάς', 'Hellas', 'Ellada', 'Griechenland', 'Grèce', 'Grecia', 'Griekenland', 'Grécia', 'Grecja', 'Řecko', 'Grécko', 'Grekland', 'Grækenland', 'Hellas', 'Kreikka', 'Görögország', 'Grčka', 'Hellenic Republic'] },
  { iso2: 'CY', iso3: 'CYP', name: 'Cyprus', currency: 'EUR', languages: ['el', 'tr', 'en'],
    aliases: ['Κύπρος', 'Kypros', 'Kıbrıs', 'Zypern', 'Chypre', 'Chipre', 'Cipro', 'Cyprus', 'Cypr', 'Kypr', 'Cypern', 'Kypros', 'Ciprus', 'Cipar'] },
  // ── Tier 3 ──
  { iso2: 'GB', iso3: 'GBR', name: 'United Kingdom', currency: 'GBP', languages: ['en'], codes: ['UK'],
    aliases: ['UK', 'Great Britain', 'Britain', 'England', 'Scotland', 'Wales', 'Northern Ireland', 'Vereinigtes Königreich', 'Großbritannien', 'Royaume-Uni', 'Grande-Bretagne', 'Reino Unido', 'Regno Unito', 'Verenigd Koninkrijk', 'Wielka Brytania', 'Spojené království', 'Velká Británie', 'Storbritannien', 'Förenade kungariket', 'Storbritannia', 'Yhdistynyt kuningaskunta', 'Iso-Britannia', 'Egyesült Királyság', 'Ujedinjeno Kraljevstvo', 'Ηνωμένο Βασίλειο', 'United Kingdom of Great Britain and Northern Ireland'] },
  { iso2: 'CH', iso3: 'CHE', name: 'Switzerland', currency: 'CHF', languages: ['de', 'fr', 'it', 'rm'],
    aliases: ['Schweiz', 'Suisse', 'Svizzera', 'Svizra', 'Suiza', 'Zwitserland', 'Suíça', 'Szwajcaria', 'Švýcarsko', 'Švajčiarsko', 'Sveits', 'Schweiz', 'Sveitsi', 'Svájc', 'Švicarska', 'Ελβετία', 'Confoederatio Helvetica', 'Helvetia'] },
  { iso2: 'CA', iso3: 'CAN', name: 'Canada', currency: 'CAD', languages: ['en', 'fr'],
    aliases: ['Kanada', 'Canadá', 'Καναδάς'] },
  { iso2: 'US', iso3: 'USA', name: 'United States', currency: 'USD', languages: ['en'], codes: ['US'],
    aliases: ['USA', 'United States of America', 'America', 'Vereinigte Staaten', 'Vereinigte Staaten von Amerika', 'États-Unis', 'Etats-Unis', 'Estados Unidos', 'EEUU', 'EE.UU.', 'Stati Uniti', "Stati Uniti d'America", 'Verenigde Staten', 'Estados Unidos da América', 'Stany Zjednoczone', 'Spojené státy', 'Spojené státy americké', 'USA', 'Förenta staterna', 'Yhdysvallat', 'Amerikai Egyesült Államok', 'Sjedinjene Američke Države', 'Ηνωμένες Πολιτείες'] },
  { iso2: 'AU', iso3: 'AUS', name: 'Australia', currency: 'AUD', languages: ['en'],
    aliases: ['Australien', 'Australie', 'Australië', 'Austrália', 'Australia', 'Austrálie', 'Ausztrália', 'Australija', 'Αυστραλία', 'Commonwealth of Australia'] },
  { iso2: 'NZ', iso3: 'NZL', name: 'New Zealand', currency: 'NZD', languages: ['en', 'mi'],
    aliases: ['Aotearoa', 'Neuseeland', 'Nouvelle-Zélande', 'Nueva Zelanda', 'Nuova Zelanda', 'Nieuw-Zeeland', 'Nova Zelândia', 'Nowa Zelandia', 'Nový Zéland', 'Nya Zeeland', 'New Zealand', 'Uusi-Seelanti', 'Új-Zéland', 'Novi Zeland', 'Νέα Ζηλανδία'] },
  { iso2: 'SG', iso3: 'SGP', name: 'Singapore', currency: 'SGD', languages: ['en', 'zh', 'ms', 'ta'],
    aliases: ['Singapur', 'Singapour', 'Singapura', 'Singapore', 'Singapore City', 'Σιγκαπούρη', '新加坡'] },
  { iso2: 'JP', iso3: 'JPN', name: 'Japan', currency: 'JPY', languages: ['ja'],
    aliases: ['Nippon', 'Nihon', '日本', 'Japon', 'Japón', 'Giappone', 'Japão', 'Japonia', 'Japonsko', 'Japani', 'Japán', 'Japan', 'Ιαπωνία'] },
  { iso2: 'KR', iso3: 'KOR', name: 'South Korea', currency: 'KRW', languages: ['ko'],
    aliases: ['Korea', 'Republic of Korea', 'Korea, Republic of', 'Korea (South)', '대한민국', '한국', 'Südkorea', 'Corée du Sud', 'Corea del Sur', 'Corea del Sud', 'Zuid-Korea', 'Coreia do Sul', 'Korea Południowa', 'Jižní Korea', 'Sydkorea', 'Etelä-Korea', 'Dél-Korea', 'Južna Koreja', 'Νότια Κορέα'] },
  { iso2: 'AE', iso3: 'ARE', name: 'United Arab Emirates', currency: 'AED', languages: ['ar', 'en'], codes: ['UAE'],
    aliases: ['UAE', 'Emirates', 'the Emirates', 'الإمارات', 'Vereinigte Arabische Emirate', 'Émirats arabes unis', 'Emiratos Árabes Unidos', 'Emirati Arabi Uniti', 'Verenigde Arabische Emiraten', 'Emirados Árabes Unidos', 'Zjednoczone Emiraty Arabskie', 'Spojené arabské emiráty', 'Förenade Arabemiraten', 'Arabiemiirikunnat', 'Egyesült Arab Emírségek', 'Ujedinjeni Arapski Emirati', 'Ηνωμένα Αραβικά Εμιράτα'] },
  { iso2: 'IL', iso3: 'ISR', name: 'Israel', currency: 'ILS', languages: ['he', 'ar', 'en'],
    aliases: ['ישראל', 'Israël', 'Izrael', 'Israele', 'Israel', 'Izrael', 'Israel', 'Ισραήλ'] },
  { iso2: 'HK', iso3: 'HKG', name: 'Hong Kong', currency: 'HKD', languages: ['zh', 'en'],
    aliases: ['Hong Kong SAR', 'Hong Kong SAR China', 'Hongkong', '香港', 'HKSAR'] },
  { iso2: 'IS', iso3: 'ISL', name: 'Iceland', currency: 'ISK', languages: ['is'],
    // 'Island'/'Ísland' (DE/DA/SV/IS) are left out: they fold to the English word "island" (Long Island, Rhode Island).
    aliases: ['Islande', 'Islandia', 'Islanda', 'IJsland', 'Islândia', 'Islanti', 'Izland', 'Ισλανδία'] },
  // ── Tier 4 ──
  { iso2: 'SA', iso3: 'SAU', name: 'Saudi Arabia', currency: 'SAR', languages: ['ar', 'en'], codes: ['KSA'],
    aliases: ['KSA', 'Kingdom of Saudi Arabia', 'السعودية', 'Saudi-Arabien', 'Arabie saoudite', 'Arabia Saudita', 'Arabia Saudí', 'Saoedi-Arabië', 'Arábia Saudita', 'Arabia Saudyjska', 'Saúdská Arábie', 'Saudiarabien', 'Saudi-Arabia', 'Szaúd-Arábia', 'Saudijska Arabija', 'Σαουδική Αραβία'] },
  { iso2: 'QA', iso3: 'QAT', name: 'Qatar', currency: 'QAR', languages: ['ar', 'en'],
    aliases: ['قطر', 'Katar', 'Catar', 'Κατάρ', 'State of Qatar'] },
  { iso2: 'TW', iso3: 'TWN', name: 'Taiwan', currency: 'TWD', languages: ['zh'],
    aliases: ['臺灣', '台灣', 'Taiwán', 'Taïwan', 'Tajwan', 'Tchaj-wan', 'Tajvan', 'Ταϊβάν', 'Republic of China', 'Taiwan, Province of China', 'Chinese Taipei'] },
  { iso2: 'MY', iso3: 'MYS', name: 'Malaysia', currency: 'MYR', languages: ['ms', 'en'],
    aliases: ['Malaisie', 'Malasia', 'Malesia', 'Maleisië', 'Malásia', 'Malezja', 'Malajsie', 'Malesia', 'Malajzia', 'Malezija', 'Μαλαισία'] },
  { iso2: 'BR', iso3: 'BRA', name: 'Brazil', currency: 'BRL', languages: ['pt'],
    aliases: ['Brasil', 'Brasilien', 'Brésil', 'Brasile', 'Brazilië', 'Brazylia', 'Brazílie', 'Brazília', 'Βραζιλία'] },
  { iso2: 'MX', iso3: 'MEX', name: 'Mexico', currency: 'MXN', languages: ['es'],
    aliases: ['México', 'Mexiko', 'Mexique', 'Messico', 'Mexico', 'Meksyk', 'Mexikó', 'Meksiko', 'Μεξικό', 'Estados Unidos Mexicanos'] },
  // ── Not targets: recognised so they are flagged, never mistaken for a target ──
  { iso2: 'IN', iso3: 'IND', name: 'India', currency: 'INR', languages: ['hi', 'en'],
    aliases: ['Bharat', 'भारत', 'Indien', 'Inde', 'Indie', 'Índia', 'Indie', 'Intia', 'Indija', 'Ινδία', 'Republic of India'] },
  { iso2: 'PK', iso3: 'PAK', name: 'Pakistan', currency: 'PKR', languages: ['ur', 'en'], aliases: ['پاکستان'] },
  { iso2: 'BD', iso3: 'BGD', name: 'Bangladesh', currency: 'BDT', languages: ['bn'], aliases: ['বাংলাদেশ'] },
  { iso2: 'LK', iso3: 'LKA', name: 'Sri Lanka', currency: 'LKR', languages: ['si', 'ta'], aliases: [] },
  { iso2: 'NP', iso3: 'NPL', name: 'Nepal', currency: 'NPR', languages: ['ne'], aliases: [] },
  { iso2: 'PH', iso3: 'PHL', name: 'Philippines', currency: 'PHP', languages: ['en', 'tl'], aliases: ['Pilipinas', 'Philippinen', 'Filipinas', 'Filippine'] },
  { iso2: 'ID', iso3: 'IDN', name: 'Indonesia', currency: 'IDR', languages: ['id'], aliases: ['Indonesien', 'Indonésie', 'Indonésia'] },
  { iso2: 'VN', iso3: 'VNM', name: 'Vietnam', currency: 'VND', languages: ['vi'], aliases: ['Viet Nam', 'Việt Nam'] },
  { iso2: 'TH', iso3: 'THA', name: 'Thailand', currency: 'THB', languages: ['th'], aliases: ['Thaïlande', 'Tailandia', 'ประเทศไทย'] },
  { iso2: 'CN', iso3: 'CHN', name: 'China', currency: 'CNY', languages: ['zh'], aliases: ['中国', 'Chine', 'Cina', "People's Republic of China", 'PRC', 'Mainland China'] },
  { iso2: 'RU', iso3: 'RUS', name: 'Russia', currency: 'RUB', languages: ['ru'], aliases: ['Russian Federation', 'Россия', 'Russland', 'Russie', 'Rusia', 'Rosja', 'Rusko'] },
  { iso2: 'UA', iso3: 'UKR', name: 'Ukraine', currency: 'UAH', languages: ['uk'], aliases: ['Україна', 'Ucrania', 'Ucraina', 'Oekraïne', 'Ukraina', 'Ukrajina'] },
  { iso2: 'BY', iso3: 'BLR', name: 'Belarus', currency: 'BYN', languages: ['be', 'ru'], aliases: ['Беларусь', 'Weißrussland', 'Białoruś'] },
  { iso2: 'TR', iso3: 'TUR', name: 'Turkey', currency: 'TRY', languages: ['tr'], aliases: ['Türkiye', 'Turkiye', 'Türkei', 'Turquie', 'Turquía', 'Turchia', 'Turcja'] },
  { iso2: 'EG', iso3: 'EGY', name: 'Egypt', currency: 'EGP', languages: ['ar'], aliases: ['مصر', 'Ägypten', 'Égypte', 'Egipto'] },
  { iso2: 'ZA', iso3: 'ZAF', name: 'South Africa', currency: 'ZAR', languages: ['en', 'af', 'zu'], codes: ['RSA'], aliases: ['Südafrika', 'Afrique du Sud', 'Sudáfrica', 'Zuid-Afrika'] },
  { iso2: 'NG', iso3: 'NGA', name: 'Nigeria', currency: 'NGN', languages: ['en'], aliases: [] },
  { iso2: 'KE', iso3: 'KEN', name: 'Kenya', currency: 'KES', languages: ['en', 'sw'], aliases: [] },
  { iso2: 'MA', iso3: 'MAR', name: 'Morocco', currency: 'MAD', languages: ['ar', 'fr'], aliases: ['Maroc', 'Marokko', 'Marruecos', 'المغرب'] },
  { iso2: 'TN', iso3: 'TUN', name: 'Tunisia', currency: 'TND', languages: ['ar', 'fr'], aliases: ['Tunisie', 'Tunesien', 'Túnez'] },
  { iso2: 'AR', iso3: 'ARG', name: 'Argentina', currency: 'ARS', languages: ['es'], aliases: ['Argentinien', 'Argentine'] },
  { iso2: 'CL', iso3: 'CHL', name: 'Chile', currency: 'CLP', languages: ['es'], aliases: ['Chili'] },
  { iso2: 'CO', iso3: 'COL', name: 'Colombia', currency: 'COP', languages: ['es'], aliases: ['Kolumbien', 'Colombie'] },
  { iso2: 'PE', iso3: 'PER', name: 'Peru', currency: 'PEN', languages: ['es'], aliases: ['Perú', 'Pérou'] },
  { iso2: 'UY', iso3: 'URY', name: 'Uruguay', currency: 'UYU', languages: ['es'], aliases: [] },
  { iso2: 'CR', iso3: 'CRI', name: 'Costa Rica', currency: 'CRC', languages: ['es'], aliases: [] },
  { iso2: 'RS', iso3: 'SRB', name: 'Serbia', currency: 'RSD', languages: ['sr'], aliases: ['Srbija', 'Србија', 'Serbien', 'Serbie'] },
  { iso2: 'BA', iso3: 'BIH', name: 'Bosnia and Herzegovina', currency: 'BAM', languages: ['bs', 'hr', 'sr'], aliases: ['Bosnia', 'Bosna i Hercegovina', 'Bosnien und Herzegowina'] },
  { iso2: 'MK', iso3: 'MKD', name: 'North Macedonia', currency: 'MKD', languages: ['mk'], // Plain 'Macedonia' is also a Greek region, so only the unambiguous names are listed.
    aliases: ['Северна Македонија', 'Nordmazedonien', 'Republic of North Macedonia'] },
  { iso2: 'AL', iso3: 'ALB', name: 'Albania', currency: 'ALL', languages: ['sq'], aliases: ['Shqipëria', 'Albanien', 'Albanie'] },
  { iso2: 'ME', iso3: 'MNE', name: 'Montenegro', currency: 'EUR', languages: ['sr'], aliases: ['Crna Gora'] },
  { iso2: 'MD', iso3: 'MDA', name: 'Moldova', currency: 'MDL', languages: ['ro'], aliases: ['Republic of Moldova', 'Moldawien', 'Moldavie'] },
  { iso2: 'GE', iso3: 'GEO', name: 'Georgia', nameIsAmbiguous: true, currency: 'GEL', languages: ['ka'], aliases: ['Sakartvelo', 'საქართველო', 'Republic of Georgia'] },
  { iso2: 'AM', iso3: 'ARM', name: 'Armenia', currency: 'AMD', languages: ['hy'], aliases: ['Հայաստան', 'Armenien', 'Arménie'] },
  { iso2: 'AZ', iso3: 'AZE', name: 'Azerbaijan', currency: 'AZN', languages: ['az'], aliases: ['Azərbaycan', 'Aserbaidschan'] },
  { iso2: 'KZ', iso3: 'KAZ', name: 'Kazakhstan', currency: 'KZT', languages: ['kk', 'ru'], aliases: ['Қазақстан', 'Kasachstan'] },
  { iso2: 'BH', iso3: 'BHR', name: 'Bahrain', currency: 'BHD', languages: ['ar', 'en'], aliases: ['البحرين'] },
  { iso2: 'KW', iso3: 'KWT', name: 'Kuwait', currency: 'KWD', languages: ['ar', 'en'], aliases: ['الكويت'] },
  { iso2: 'OM', iso3: 'OMN', name: 'Oman', currency: 'OMR', languages: ['ar', 'en'], aliases: ['عمان'] },
  { iso2: 'JO', iso3: 'JOR', name: 'Jordan', currency: 'JOD', languages: ['ar', 'en'], aliases: ['الأردن', 'Jordanien', 'Jordanie'] },
  { iso2: 'LB', iso3: 'LBN', name: 'Lebanon', currency: 'LBP', languages: ['ar', 'fr'], aliases: ['Liban', 'Libanon', 'لبنان'] },
  { iso2: 'LI', iso3: 'LIE', name: 'Liechtenstein', currency: 'CHF', languages: ['de'], aliases: [] },
  { iso2: 'MC', iso3: 'MCO', name: 'Monaco', currency: 'EUR', languages: ['fr'], aliases: [] },
  { iso2: 'AD', iso3: 'AND', name: 'Andorra', currency: 'EUR', languages: ['ca'], aliases: [] },
];

function tierOf(iso2: string): CountryInfo['tier'] {
  if ((TIER_1_COUNTRIES as readonly string[]).includes(iso2)) return 1;
  if ((TIER_2_COUNTRIES as readonly string[]).includes(iso2)) return 2;
  if ((TIER_3_COUNTRIES as readonly string[]).includes(iso2)) return 3;
  if ((TIER_4_COUNTRIES as readonly string[]).includes(iso2)) return 4;
  return null;
}

export const COUNTRIES: readonly CountryInfo[] = RAW.map((c) => ({
  ...c,
  aliases: [...new Set(c.aliases)],
  tier: tierOf(c.iso2),
}));

export const COUNTRY_BY_ISO2: ReadonlyMap<string, CountryInfo> = new Map(COUNTRIES.map((c) => [c.iso2, c]));

export function countryInfo(iso2: string | null | undefined): CountryInfo | null {
  if (!iso2) return null;
  return COUNTRY_BY_ISO2.get(iso2.toUpperCase()) ?? null;
}

/** True for spec §4 target countries (any tier). */
export function isTargetCountry(iso2: string | null | undefined): boolean {
  return countryInfo(iso2)?.tier != null;
}
