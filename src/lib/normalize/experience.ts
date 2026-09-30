/**
 * Required experience from posting text (spec §10 "Experience and seniority"), with the title as
 * a low-confidence fallback. Pure.
 *
 * - Finds year phrases in EN/DE/FR/NL/ES/IT/PT/PL/SV/DA/NO (+FI/CS basics): "3+ years",
 *   "2–4 Jahre", "mindestens drei Jahre", "au moins 3 ans", "de 3 a 5 años", "co najmniej 3 lata",
 *   "minst 3 års erfarenhet", "3-jährige Berufserfahrung", "mehrjährige Erfahrung" (vague → low).
 * - A number of years only counts when it is about the candidate: an experience word, a role cue
 *   ("as a …", "in a similar role") or a requirement cue ("+", "at least", a Requirements section).
 *   Company age ("founded 20 years ago", "for over 15 years we have…"), contract length,
 *   education length and benefits ("after 2 years…") are skipped.
 * - Nice-to-have mentions are used only when nothing is required.
 * - `securityStrict`: years counted specifically in security ("3+ years in information security").
 * - The band (core/show/hide) comes from settings profile.experienceBand.
 */
import type { ExperienceBand, ExperienceValue, SeniorityWord } from '../contracts/jobs';
import { lowerConfidence, type Confidence, type Fact } from '../contracts/provenance';
import { detectSeniority } from './title';
import { collapseWhitespace, quoteAround } from './text';

export const EXPERIENCE_LOGIC_VERSION = 'experience@2026-09-29.1';

/** Same shape as settings profile.experienceBand. */
export interface ExperienceBandSettings {
  core: readonly number[];
  show: readonly number[];
  hideBelow: number;
  hideAbove: number;
}

export const DEFAULT_EXPERIENCE_BAND: ExperienceBandSettings = { core: [2, 4], show: [1, 5], hideBelow: 1, hideAbove: 6 };

/** Years assumed from title words when the text says nothing. */
export const TITLE_SENIORITY_YEARS: Readonly<Record<SeniorityWord | 'entry', { min: number; max: number | null }>> = {
  entry: { min: 0, max: 1 },
  junior: { min: 0, max: 2 },
  mid: { min: 2, max: 4 },
  senior: { min: 5, max: null },
  lead: { min: 6, max: null },
  principal: { min: 8, max: null },
};

/** Year numbers above this are company age or tenure, never a requirement. */
const MAX_REQUIRED_YEARS = 20;
const MAX_TEXT = 60_000;

// ── Vocabulary ───────────────────────────────────────────────────────────────────────────

const B = '(?<![\\p{L}\\p{N}])';
const E = '(?![\\p{L}\\p{N}])';

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  // en
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15,
  // de
  ein: 1, eine: 1, einem: 1, einer: 1, eines: 1, einen: 1, zwei: 2, drei: 3, vier: 4, 'fünf': 5, funf: 5, fuenf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9, zehn: 10, 'zwölf': 12,
  // fr
  un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, sept: 7, huit: 8, neuf: 9, dix: 10,
  // nl
  een: 1, 'één': 1, twee: 2, drie: 3, vijf: 5, zes: 6, zeven: 7, negen: 9, tien: 10,
  // es
  uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10,
  // it
  due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10,
  // pt
  um: 1, uma: 1, dois: 2, duas: 2, 'três': 3, quatro: 4, sete: 7, oito: 8, dez: 10,
  // pl
  jeden: 1, jednego: 1, jednym: 1, dwa: 2, 'dwóch': 2, dwoch: 2, trzy: 3, trzech: 3, cztery: 4, czterech: 4, 'pięć': 5, piec: 5, 'pięciu': 5, pieciu: 5,
  'sześć': 6, szesc: 6, siedem: 7, osiem: 8, 'dziesięć': 10,
  // sv / da / no
  en: 1, ett: 1, et: 1, 'två': 2, tva: 2, to: 2, fyra: 4, fire: 4, fem: 5, sex: 6, seks: 6, sju: 7, syv: 7, 'åtta': 8, otte: 8, 'åtte': 8, nio: 9, ni: 9, tio: 10, ti: 10,
  // fi / cs
  yksi: 1, kaksi: 2, kolme: 3, 'neljä': 4, viisi: 5, jeden_cs: 1, dva: 2, 'tři': 3, 'čtyři': 4, 'pět': 5,
};
const NUMBER_WORD_RE = Object.keys(NUMBER_WORDS)
  .filter((w) => !w.includes('_'))
  .sort((x, y) => y.length - x.length)
  .join('|');

const NUM = `(?:\\d{1,2}(?:[.,]\\d)?(?:\\s*\\(\\s*\\d{1,2}\\s*\\))?|${B}(?:${NUMBER_WORD_RE})(?:\\s*\\(\\s*\\d{1,2}\\s*\\))?)`;

const UNITS = [
  'years?', "years'", 'yrs?', 'jahre?n?', 'jahres', 'ans?', 'années?', 'annees?', 'jaar', 'jaren', 'años?', 'anos?', 'anni', 'anno',
  'lat', 'lata', 'rok', 'roku', 'lat[aą]', 'år', 'års', 'åren', 'vuotta', 'vuoden', 'vuosi', 'let', 'roky', 'roků', 'yoe', 'j\\.',
  // adjectival: 3-jährige, 3-letnie, 3-jarige, 3-årig, 3-vuotinen
  'jährig\\p{L}*', 'jahrig\\p{L}*', 'letni\\p{L}*', 'jarig\\p{L}*', 'årig\\p{L}*', 'vuotinen',
].join('|');
const MONTH_UNITS = ['months?', 'monate?n?', 'monats', 'mois', 'meses', 'mes', 'mesi', 'maanden', 'maand', 'månader', 'månad', 'måneder', 'måned', 'miesięcy', 'miesiące', 'kuukautta', 'měsíců'].join('|');
const UNIT_RE = new RegExp(`(?<![\\p{L}])(?:(?<y>${UNITS})|(?<mo>${MONTH_UNITS}))(?![\\p{L}])`, 'giu');

const PRE_MIN = [
  'at least', 'a minimum of', 'minimum of', 'minimum', 'min\\.?', 'no less than', 'not less than', 'mindestens', 'mind\\.?', 'wenigstens', 'minimal',
  'au moins', 'minimum de', 'au minimum', 'al menos', 'mínimo de', 'mínimo', 'minimo de', 'minimo di', 'minimo', 'como mínimo', 'almeno', 'pelo menos',
  'no mínimo', 'minimaal', 'ten minste', 'tenminste', 'minstens', 'co najmniej', 'conajmniej', 'minst', 'mindst', 'vähintään', 'alespoň', 'minimálně',
];
const PRE_MORE = [
  'more than', 'over', 'in excess of', 'upwards of', 'über', 'mehr als', 'plus de', 'más de', 'mas de', 'più di', 'oltre', 'mais de', 'meer dan', 'ruim',
  'ponad', 'powyżej', 'mer än', 'över', 'mere end', 'mer enn', 'yli', 'více než', 'přes',
];
const PRE_UPTO = ['up to', 'bis zu', "jusqu'à", "jusqu'a", 'hasta', 'fino a', 'até', 'upp till', 'op til', 'opp til', 'enintään', 'do'];
const PRE_LESS = ['less than', 'under', 'weniger als', 'unter', 'moins de', 'menos de', 'meno di', 'minder dan', 'mniej niż', 'mindre än', 'mindre end', 'mindre enn', 'méně než'];
const PRE_BETWEEN = ['between', 'zwischen', 'entre', 'tra', 'fra', 'tussen', 'mellan', 'mellem', 'od', 'från', 'from', 'von', 'de', 'da'];
const PRE_APPROX = ['about', 'around', 'approximately', 'approx\\.?', 'circa', 'ca\\.?', 'rund', 'etwa', 'environ', 'alrededor de', 'cerca de', 'ongeveer', 'omkring', 'około', 'noin', 'zhruba'];
const SEPARATORS = ['-', 'to', 'bis', 'à', 'a', 'au', 'tot', 'till', 'til', 'do', 'and', 'und', 'et', 'y', 'e', 'en', 'och', 'og', 'i', 'ja', 'až', 'or', 'oder', 'ou', 'o', 'lub', 'eller', 'of'];
const POST_MIN = [
  'or more', 'or longer', 'or above', 'minimum', 'at least', 'plus', 'oder mehr', 'oder länger', 'ou plus', 'au minimum', 'o más', 'como mínimo', 'o più',
  'ou mais', 'no mínimo', 'of meer', 'of langer', 'minimaal', 'lub więcej', 'i więcej', 'eller mer', 'eller mere', 'eller mer', 'tai enemmän', 'a více', 'nebo více',
];

const alt = (xs: readonly string[]) => xs.map((x) => x.replace(/ /g, '\\s+')).sort((x, y) => y.length - x.length).join('|');

/** Anchored at the end of the text before a unit: "[prefix] N [+] [sep N] [+] [or more] [-]". */
const BEFORE_UNIT_RE = new RegExp(
  `${B}(?:(?<pre>${alt([...PRE_MIN, ...PRE_MORE, ...PRE_UPTO, ...PRE_LESS, ...PRE_BETWEEN])})\\s*)?(?:(?:${alt(PRE_APPROX)})\\s+)?` +
    `(?<a>${NUM})(?:\\s*(?<plusA>\\+))?` +
    `(?:\\s*(?<sep>${alt(SEPARATORS)})\\s*(?<b>${NUM}))?` +
    `(?:\\s*(?<plus>\\+|plus))?(?:\\s+(?<ormore>or more|or above|oder mehr|ou plus|o más|o più|ou mais|of meer|eller mer|eller mere|lub więcej|i więcej))?` +
    `\\s*-?\\s*$`,
  'iu',
);
const AFTER_UNIT_MIN_RE = new RegExp(`^['’]?\\s*(?:\\+|(?:\\(?\\s*(?:${alt(POST_MIN)})\\s*\\)?))${E}`, 'iu');
/** Number words glued to an adjectival unit: "dreijährige", "trzyletnie", "tweejarige", "mehrjährige". */
const GLUED_RE = new RegExp(
  `${B}(?<w>zwei|drei|vier|fünf|funf|sechs|sieben|acht|zehn|mehr|lang|viel|dwu|trzy|cztero|pięcio|piecio|kilku|wielo|twee|drie|vijf|meer|två|tre|fyra|fem|fler|flere|mange|många)(?<u>jährig\\p{L}*|jahrig\\p{L}*|letni\\p{L}*|jarig\\p{L}*|årig\\p{L}*)${E}`,
  'giu',
);
const GLUED_VALUE: Readonly<Record<string, number | 'several' | 'many'>> = {
  zwei: 2, drei: 3, vier: 4, 'fünf': 5, funf: 5, sechs: 6, sieben: 7, acht: 8, zehn: 10, dwu: 2, trzy: 3, cztero: 4, 'pięcio': 5, piecio: 5,
  twee: 2, drie: 3, vijf: 5, 'två': 2, tre: 3, fyra: 4, fem: 5,
  mehr: 'several', kilku: 'several', meer: 'several', fler: 'several', flere: 'several',
  lang: 'many', viel: 'many', wielo: 'many', mange: 'many', 'många': 'many',
};

/** "Several years of experience" without a number. */
const VAGUE_RE = new RegExp(
  `${B}(?:(?<several>several|multiple|a few|a couple of|some|mehrere|einige|plusieurs|quelques|varios|algunos|diversi|alcuni|vari|vários|varios|alguns|meerdere|enkele|flera|flere|flere|kilka|useamman|několik)\\s+(?:years?|jahre?n?|années|ans|años|anni|anos|jaren|jaar|års?|lat|vuoden|let)` +
    `|(?<many>(?:many|extensive|long|de nombreuses|muchos|molti|muitos|vele|mange|många|wiele)\\s+(?:years?|années|años|anni|anos|jaren|års?|lat)|jarenlange|jahrelange\\p{L}*|mångårig\\p{L}*))${E}`,
  'giu',
);
const NO_EXPERIENCE_RE = new RegExp(
  `${B}(?:no (?:prior |previous |professional )?experience (?:is )?(?:required|needed|necessary)|keine (?:vorherige |einschlägige )?(?:berufs)?erfahrung (?:erforderlich|notwendig|nötig|vorausgesetzt)` +
    `|sans expérience|aucune expérience (?:n'est )?(?:requise|exigée|nécessaire)|sin experiencia(?: previa)?|no se requiere experiencia|nessuna esperienza (?:richiesta|necessaria)|` +
    `sem experiência|geen (?:werk)?ervaring (?:vereist|nodig)|ingen (?:tidigare )?erfarenhet (?:krävs|behövs)|ingen erfaring (?:kræves|påkrævet|kreves|nødvendig)|` +
    `bez doświadczenia|doświadczenie nie jest wymagane|ei vaadita kokemusta|bez praxe)${E}`,
  'giu',
);

const EXPERIENCE_WORD_RE =
  /experien|(?<![\p{L}])yoe(?![\p{L}])|(?<![\p{L}])exp\.?(?![\p{L}])|erfahrung|expérience|experience|experiência|experiencia|esperienz|ervaring|erfarenhet|erfaring|doświadczeni|doswiadczeni|kokemus|zkušenost|praxis|praxe|berufspraxis|track record|background in|hands-on/iu;
const ROLE_CUE_RE = new RegExp(
  `${B}(?:as an?|als|en tant que|como|come|jako|som|in (?:an? )?(?:similar|comparable|relevant|equivalent)? ?(?:role|position)|in the (?:field|industry|area)|` +
    `im bereich|in der|dans le domaine|en el (?:área|campo|sector)|nel (?:settore|campo|ruolo)|na área|op het gebied|inom|w obszarze|w branży|working (?:in|with|as|on)|worked|building|developing|designing|operating)${E}`,
  'iu',
);
const CANDIDATE_CUE_RE = new RegExp(
  `${B}(?:you|your|du|dein\\p{L}*|sie|ihr\\p{L}*|vous|votre|tu|tienes|cuentas|posees|usted|hai|possiedi|você|tens|jij|je|u|din|masz|posiadasz|` +
    `candidate|kandidat\\p{L}*|candidat\\p{L}*|bewerber\\p{L}*|applicant|we are looking for|we're looking for|wir suchen|nous recherchons|buscamos|cerchiamo|procuramos|` +
    `wij zoeken|we zoeken|vi söker|vi søger|vi søker|szukamy|etsimme|hledáme|required|requires|require|must|need|needed|erforderlich|vorausgesetzt|requis\\p{L}*|exigé\\p{L}*|` +
    `requerid\\p{L}*|imprescindible|richiest\\p{L}*|necessári\\p{L}*|vereist|krävs|kræves|kreves|wymagan\\p{L}*|vaaditaan|vyžadujeme|bring|mitbringst|mitbringen|verfügst|verfügen)${E}`,
  'iu',
);
const COMPANY_SELF_RE = new RegExp(
  `${B}(?:(?:we|wir|nous|nosotros|noi|wij|vi|my)\\s+(?:have|has|had|hat|haben|avons|tenemos|abbiamo|hebben|har|mamy|olemme|máme|are|sind|sommes|somos|siamo|zijn|är|er|jesteśmy|been|seit)` +
    `|(?:our|unser\\p{L}*|notre|nos|nuestr\\p{L}*|nostr\\p{L}*|nosso|nossa|onze|vår|vores|nasz\\p{L}*)\\s+(?:company|team|firm|group|history|unternehmen|firma|entreprise|société|empresa|azienda|bedrijf|företag|virksomhed|selskap|zespół|spółka|clients|customers|kunden))${E}`,
  'iu',
);
/** Nice-to-have words that qualify what follows ("ideally 5 years") — only checked before an amount. */
const PREFERRED_LEAD = 'preferably|ideally|idealerweise|idéalement|idealmente|preferiblemente|preferibilmente|preferencialmente|bij voorkeur|helst|gerne|gern|bonus';
/** Nice-to-have words that qualify what precedes ("5 years … is a plus") — checked on both sides. */
const PREFERRED_TAIL =
  'nice[ -]to[ -]have|preferred|a plus|is a plus|advantage\\p{L}*|desirable|beneficial|wünschenswert|von vorteil|vorteilhaft|wäre ein plus|ein plus|optional|' +
  'souhaitée?s?|serait un plus|un plus|atout|deseable|valorable|se valorará|preferible|preferibile|gradit[ao]|costituisce un plus|desejável|diferencial|gewenst|' +
  'pluspunt|is een plus|meriterande|meriterende|meritterende|fordel|en fordel|er et plus|mile widziane|dodatkowym atutem|atutem|výhodou|eduksi';
const PREFERRED_RE = new RegExp(`${B}(?:${PREFERRED_TAIL}|${PREFERRED_LEAD})${E}`, 'iu');
const PREFERRED_TAIL_RE = new RegExp(`${B}(?:${PREFERRED_TAIL})${E}`, 'iu');
const SECURITY_RE = new RegExp(
  `${B}(?:security|cyber\\p{L}*|infosec|it-sicherheit|informationssicherheit|cybersicherheit|it-security|\\p{L}*sicherheit|sécurité|securite|cybersécurité|\\p{L}*seguridad|sicurezza|` +
    `\\p{L}*segurança|\\p{L}*beveiliging|\\p{L}*säkerhet|\\p{L}*sikkerhed|\\p{L}*sikkerhet|\\p{L}*bezpieczeństw\\p{L}*|\\p{L}*bezpieczenstw\\p{L}*|tietoturv\\p{L}*|kyberturv\\p{L}*|` +
    `bezpečnost\\p{L}*|pentest\\p{L}*|penetration test\\p{L}*|appsec|devsecops|soc|siem|incident response|threat\\p{L}*|vulnerabilit\\p{L}*|red team\\p{L}*|grc|iso ?27001)${E}`,
  'iu',
);
const NON_SECURITY_SAFETY_RE = /arbeitssicherheit|arbeitsschutz|betriebssicherheit|lebensmittelsicherheit|social security|seguridad social|sécurité sociale|previdenza/iu;

/** Right before the number: company age, recurring periods, time frames. */
const NEG_BEFORE_RE = new RegExp(
  `${B}(?:ago|founded|gegründet|vor|il y a|hace|há|since|seit|depuis|desde hace|desde|sinds|sedan|siden|within|innerhalb(?:\\s+(?:von|der))?|binnen|inom|inden for|w ciągu|every|alle|tous les|cada|ogni|elke|varje|hvert|` +
    `last|past|letzten|vergangenen|derniers|dernières|últimos|ultimi|afgelopen|senaste|seneste|ostatnich|next|nächsten|kommenden|prochaines|próximos|prossimi|komende|kommande|kommende|następnych|` +
    `after|nach|après|después de|dopo|efter|already|bereits|déjà|già|redan|allerede|już|anniversary|celebrat\\p{L}*|jubiläum)` +
    `\\s+(?:(?:the|den|die|der|les|los|las|gli|than|als|más de|mehr als|über|over|plus de|more than|about|around|circa|ca\\.?|rund|etwa|environ|cerca de|ongeveer|omkring|około|mindestens|at least)\\s+){0,3}$`,
  'iu',
);
/** Right after the unit: contract/education/company length, age. */
const NEG_AFTER_RE = new RegExp(
  `^['’]?\\s*(?:-\\s*)?(?:(?:fixed[- ]term|full[- ]time|befristete\\p{L}*|temporary)\\s+)?(?:ago|fa|geleden|temu|sitten|zpět|or older|and older|of age|old|alt|oud|gammal|gammel|d'âge|de edad|di età|contract\\p{L}*|vertrag\\p{L}*|laufzeit|contrat|contrato|contratto|` +
    `kontrakt|umow\\p{L}*|warranty|garantie|garantía|garanzia|history|geschichte|d'histoire|de historia|di storia|de história|geschiedenis|historie|anniversary|jubiläum|mandate|assignment|` +
    `placement|secondment|roadmap|term|period|zeitraum|degree|bachelor\\p{L}*|master\\p{L}*|studium|studies|study|studiengang|diploma|diplôme|licence|ausbildung|lehre|apprenticeship|` +
    `training|formation|formación|formazione|formação|opleiding|utbildning|uddannelse|utdanning|studi\\p{L}*|program\\p{L}*|in (?:the )?(?:market|business|industry)|am markt|` +
    `sur le marché|en el mercado|sul mercato|op de markt|på marknaden|på markedet|na rynku|of (?:growth|operation|existence|success|innovation|history|tradition)|im geschäft|in business|` +
    `de existencia|d'existence|di attività|of (?:combined|collective|joint|shared|cumulative|cumulated)|with (?:us|the company)|bei uns|chez nous|con nosotros|con noi|bij ons|hos oss|hos os|u nas|tenure|seniority|betriebszugehörigkeit)${E}`,
  'iu',
);

// ── Sections ─────────────────────────────────────────────────────────────────────────────

type Section = 'required' | 'preferred' | 'company' | 'offer' | 'neutral';

const SECTION_HEADERS: readonly [Section, RegExp][] = [
  ['preferred', /nice[ -]to[ -]have|bonus (?:points|skills|qualifications)|preferred|pluses|good to have|desirable|wünschenswert|von vorteil|idealerweise|atouts|serait un plus|souhaité|deseable|valorable|se valorará|preferibile|gradit|desejável|diferencial|pluspunten|meriterande|fordel|mile widziane|dodatkowe|výhodou|eduksi/iu],
  ['required', /requirement|qualification|must[- ]haves?|what you(?:'ll| will)? bring|what we(?:'re| are) looking for|who you are|your profile|about you|you have|skills|anforderung|ihr profil|dein profil|das bringst du mit|was du mitbringst|was sie mitbringen|qualifikation|voraussetzung|profil recherché|votre profil|compétences|prérequis|requis|perfil|requisitos|lo que buscamos|qué buscamos|requisiti|il tuo profilo|profilo|competenze|o que procuramos|functie-eisen|wat vraag|wat breng je mee|jouw profiel|profiel|eisen|kvalifikation|krav|vi söker dig|din profil|om dig|kvalifikasjon|kompetencer|wymagania|oczekujemy|twój profil|vaatimukset|požadavky/iu],
  ['company', /about us|who we are|about the company|about the team|über uns|wer wir sind|das sind wir|qui sommes-nous|à propos|sobre nosotros|quiénes somos|chi siamo|sobre nós|quem somos|over ons|wie zijn wij|wie wij zijn|om oss|om os|o nas|meistä|o nás/iu],
  ['offer', /what we offer|benefits|we offer|perks|wir bieten|was wir bieten|unser angebot|deine vorteile|nous offrons|ce que nous offrons|avantages|ofrecemos|qué ofrecemos|beneficios|offriamo|cosa offriamo|oferecemos|benefícios|wij bieden|wat bieden wij|arbeidsvoorwaarden|vi erbjuder|vi tilbyder|vi tilbyr|oferujemy|benefity|tarjoamme|nabízíme/iu],
  ['neutral', /responsibilit|your tasks|what you(?:'ll| will) do|the role|aufgaben|deine rolle|missions|vos missions|responsabilidades|funciones|mansioni|responsabilità|atividades|taken|verantwoordelijkheden|arbetsuppgifter|opgaver|arbeidsoppgaver|obowiązki|zakres obowiązków|tehtävät|náplň práce/iu],
];

function sectionOfLine(line: string): Section | null {
  if (/^\s*[-•·*–>]\s/u.test(line)) return null;
  const s = line.replace(/^[\s#*]+/u, '').trim();
  if (!s || s.length > 60 || /\d/.test(s)) return null;
  const words = s.split(/\s+/).length;
  if (!(s.endsWith(':') || words <= 6)) return null;
  for (const [section, re] of SECTION_HEADERS) if (re.test(s)) return section;
  return null;
}

function sectionMap(text: string): { starts: number[]; sections: Section[] } {
  const starts: number[] = [];
  const sections: Section[] = [];
  let current: Section = 'neutral';
  let pos = 0;
  for (const line of text.split('\n')) {
    const header = sectionOfLine(line);
    if (header) current = header;
    starts.push(pos);
    sections.push(current);
    pos += line.length + 1;
  }
  return { starts, sections };
}

function sectionAt(map: { starts: number[]; sections: Section[] }, index: number): Section {
  let lo = 0;
  let hi = map.starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (map.starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return map.sections[lo] ?? 'neutral';
}

// ── Mentions ─────────────────────────────────────────────────────────────────────────────

export interface ExperienceMention {
  minYears: number;
  maxYears: number | null;
  kind: 'numeric' | 'vague' | 'none';
  /** explicit = an experience word; cue = requirement/role cue only. */
  strength: 'explicit' | 'cue';
  preferred: boolean;
  security: boolean;
  start: number;
  end: number;
  quote: string;
}

const ABBREVIATIONS = /(?:^|[^\p{L}])(?:min|mind|max|ca|approx|etc|e\.g|i\.e|z\.b|bzw|inkl|incl|resp|vs|nr|no|dr|prof|ggf|evtl|u\.a|d\.h|bspw|ej|env|cf|ex|dvs|np|tzn|itp|ok|sr|jr)$/iu;

function clauseBounds(t: string, start: number, end: number): [number, number] {
  let a = start;
  const minA = Math.max(0, start - 240);
  while (a > minA) {
    const c = t[a - 1];
    if (c === '\n' || c === ';' || c === '•' || c === '|') break;
    if ((c === '.' || c === '!' || c === '?') && /\s/.test(t[a] ?? '') && !ABBREVIATIONS.test(t.slice(Math.max(0, a - 7), a - 1))) break;
    a--;
  }
  let b = end;
  const maxB = Math.min(t.length, end + 240);
  while (b < maxB) {
    const c = t[b];
    if (c === '\n' || c === ';' || c === '•' || c === '|') break;
    if ((c === '.' || c === '!' || c === '?') && (b + 1 >= t.length || /\s/.test(t[b + 1] ?? '')) && !ABBREVIATIONS.test(t.slice(Math.max(0, b - 6), b))) break;
    b++;
  }
  return [a, b];
}

function numberValue(s: string): number | null {
  const digits = s.match(/\d{1,2}(?:[.,]\d)?/);
  if (digits) return Number(digits[0].replace(',', '.'));
  const w = s.trim().toLowerCase().normalize('NFC');
  return NUMBER_WORDS[w] ?? null;
}

/** Index-preserving cleanup (same length) so quotes can be cut from the original text. */
function prep(s: string): string {
  return s
    .replace(/[‐-―−]/g, '-')
    .replace(/[    ]/g, ' ')
    .replace(/[‘’ʼ]/g, "'");
}

const MIN_PREFIXES = new RegExp(`^(?:${alt(PRE_MIN)}|${alt(PRE_MORE)})$`, 'iu');
const UPTO_PREFIXES = new RegExp(`^(?:${alt(PRE_UPTO)}|${alt(PRE_LESS)})$`, 'iu');

interface Raw {
  start: number;
  end: number;
  min: number;
  max: number | null;
  kind: ExperienceMention['kind'];
  hasMinCue: boolean;
  /** Month-based amounts only count next to an explicit experience word ("18 months of experience"). */
  months: boolean;
}

const roundYears = (n: number) => Math.round(n * 10) / 10;

function rawNumericMentions(t: string): Raw[] {
  const out: Raw[] = [];
  UNIT_RE.lastIndex = 0;
  for (let m = UNIT_RE.exec(t); m; m = UNIT_RE.exec(t)) {
    const u0 = m.index;
    const u1 = u0 + m[0].length;
    const beforeFrom = Math.max(0, u0 - 70);
    const before = t.slice(beforeFrom, u0);
    const bm = BEFORE_UNIT_RE.exec(before);
    if (!bm?.groups) continue;
    const g = bm.groups;
    const a = numberValue(g.a ?? '');
    if (a === null) continue;
    const b = g.b && g.sep ? numberValue(g.b) : null;
    const months = Boolean(m.groups?.mo);
    // Singular articles only count with a singular unit ("a year", "un an"), never "a years".
    if (/^(?:a|an|en|et|un|une|um|uma|ein)$/iu.test((g.a ?? '').trim()) && /s$|en$|lat|jaren|anni|années|mesi|meses|maanden|monate|monaten/iu.test(m[0])) continue;
    const start = beforeFrom + bm.index;
    let end = u1;
    const after = t.slice(u1, u1 + 40);
    const post = AFTER_UNIT_MIN_RE.exec(after);
    if (post) end = u1 + post[0].length;
    const pre = (g.pre ?? '').replace(/\s+/g, ' ').toLowerCase();
    const scale = months ? 1 / 12 : 1;
    let min: number;
    let max: number | null;
    if (b !== null) {
      min = Math.min(a, b) * scale;
      max = Math.max(a, b) * scale;
    } else if (pre && UPTO_PREFIXES.test(pre)) {
      min = 0;
      max = a * scale;
    } else {
      min = a * scale;
      max = null;
    }
    min = roundYears(min);
    max = max === null ? null : roundYears(max);
    if (min > MAX_REQUIRED_YEARS || (max !== null && max > MAX_REQUIRED_YEARS + 5)) continue;
    const hasMinCue = Boolean(g.plusA || g.plus || g.ormore || post || (pre && MIN_PREFIXES.test(pre)));
    out.push({ start, end, min, max, kind: 'numeric', hasMinCue, months });
  }
  GLUED_RE.lastIndex = 0;
  for (let m = GLUED_RE.exec(t); m; m = GLUED_RE.exec(t)) {
    const v = GLUED_VALUE[(m.groups?.w ?? '').toLowerCase()];
    if (v === undefined) continue;
    const start = m.index;
    const end = start + m[0].length;
    if (typeof v === 'number') out.push({ start, end, min: v, max: null, kind: 'numeric', hasMinCue: false, months: false });
    else out.push({ start, end, min: v === 'many' ? 5 : 2, max: null, kind: 'vague', hasMinCue: false, months: false });
  }
  VAGUE_RE.lastIndex = 0;
  for (let m = VAGUE_RE.exec(t); m; m = VAGUE_RE.exec(t)) {
    const start = m.index;
    out.push({ start, end: start + m[0].length, min: m.groups?.many ? 5 : 2, max: null, kind: 'vague', hasMinCue: false, months: false });
  }
  NO_EXPERIENCE_RE.lastIndex = 0;
  for (let m = NO_EXPERIENCE_RE.exec(t); m; m = NO_EXPERIENCE_RE.exec(t)) {
    const start = m.index;
    out.push({ start, end: start + m[0].length, min: 0, max: 0, kind: 'none', hasMinCue: false, months: false });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Ends the domain of a year count: "3 years of Java, ideally with security exposure" is not security years. */
const SCOPE_CUT_RE = new RegExp(
  `[,(]|${B}(?:with|including|incl\\.?|such as|e\\.g\\.?|like|plus|as well as|mit|inklusive|avec|dont|con|incluyendo|inclusi|com|incluindo|met|inclusief|med|inklusive|z|w tym|ideally|preferably|idealerweise|idéalement|idealmente|bij voorkeur)${E}`,
  'iu',
);

/** Years counted in security: the domain after the unit ("… in information security") or a short lead-in ("IT security: 3+ years"). */
function isSecurityScoped(before: string, after: string): boolean {
  const cut = after.slice(0, 90);
  const idx = cut.search(SCOPE_CUT_RE);
  const domain = idx >= 0 ? cut.slice(0, idx) : cut;
  const preferredAt = domain.search(PREFERRED_RE);
  const scoped = preferredAt >= 0 ? domain.slice(0, preferredAt) : domain;
  const leadIn = before.length <= 45 ? before : '';
  const hit = (s: string) => SECURITY_RE.test(s) && !NON_SECURITY_SAFETY_RE.test(s);
  return hit(scoped) || hit(leadIn);
}

export interface FindMentionsOptions {
  /** Treat every year amount as a requirement (used for titles: "Cloud Engineer (3-5 years)"). */
  assumeRequirement?: boolean;
}

/** Every candidate-experience statement in the text, with the reason it counts. */
export function findExperienceMentions(text: string, opts: FindMentionsOptions = {}): ExperienceMention[] {
  const original = String(text ?? '').slice(0, MAX_TEXT);
  const t = prep(original);
  const sections = sectionMap(t);
  const raws = rawNumericMentions(t);
  const mentions: ExperienceMention[] = [];
  let lastEnd = -1;
  for (let i = 0; i < raws.length; i++) {
    const r = raws[i];
    if (r.start < lastEnd) continue;
    const [ca, cb] = clauseBounds(t, r.start, r.end);
    const clause = t.slice(ca, cb);
    const before = t.slice(ca, r.start);
    const after = t.slice(r.end, cb);
    if (r.kind !== 'none') {
      if (NEG_BEFORE_RE.test(t.slice(Math.max(ca, r.start - 60), r.start))) continue;
      if (NEG_AFTER_RE.test(after)) continue;
    }
    const section = sectionAt(sections, r.start);
    const explicit = EXPERIENCE_WORD_RE.test(clause) || r.kind === 'none';
    const candidate = CANDIDATE_CUE_RE.test(clause);
    const companySelf = COMPANY_SELF_RE.test(before);
    if (companySelf && !candidate) continue;
    if ((section === 'company' || section === 'offer') && !(explicit && candidate)) continue;
    if ((r.kind === 'vague' || r.months) && !explicit) continue;
    const roleCue = ROLE_CUE_RE.test(after.slice(0, 60)) || ROLE_CUE_RE.test(before.slice(-40));
    const requirementCue = r.hasMinCue || section === 'required' || section === 'preferred' || candidate || opts.assumeRequirement === true;
    if (!explicit && !roleCue && !requirementCue) continue;
    // Without an experience word a double-digit number of years is age, tenure or history.
    if (!explicit && r.min >= 10) continue;
    // Nice-to-have wording belongs to the nearest amount: "2-3 Jahre Erfahrung, idealerweise 5 Jahre".
    const prevEnd = i > 0 ? Math.max(ca, raws[i - 1].end) : ca;
    const next = raws.slice(i + 1).find((x) => x.start >= r.end);
    const ownAfter = next && next.start < cb ? '' : after.slice(0, 100);
    const preferred = section === 'preferred' || PREFERRED_RE.test(t.slice(prevEnd, r.start)) || PREFERRED_TAIL_RE.test(ownAfter);
    const security = r.kind !== 'none' && isSecurityScoped(before, after);
    mentions.push({
      minYears: r.min,
      maxYears: r.max,
      kind: r.kind,
      strength: explicit ? 'explicit' : 'cue',
      preferred,
      security,
      start: r.start,
      end: r.end,
      quote: quoteAround(original, r.start, r.end, 160),
    });
    lastEnd = r.end;
  }
  return mentions;
}

// ── Band ─────────────────────────────────────────────────────────────────────────────────

/** Place a requirement in the user's band (settings profile.experienceBand). */
export function experienceBandFor(minYears: number | null, maxYears: number | null, band: ExperienceBandSettings = DEFAULT_EXPERIENCE_BAND): ExperienceBand {
  if (minYears === null && maxYears === null) return 'unknown';
  const min = minYears ?? 0;
  const upper = maxYears ?? min;
  const [coreLo = 2, coreHi = 4] = band.core;
  const [showLo = 1, showHi = 5] = band.show;
  if (min >= band.hideAbove) return 'hide';
  if (upper < band.hideBelow || (min < band.hideBelow && upper <= band.hideBelow)) return 'hide';
  if (min >= coreLo && min <= coreHi) return 'core';
  if ((min >= showLo && min <= showHi) || (min < showLo && upper >= showLo)) return 'show';
  return 'show';
}

// ── Public API ───────────────────────────────────────────────────────────────────────────

function fact(value: ExperienceValue, evidence: string | null, source: string, confidence: Confidence, now: Date): Fact<ExperienceValue> {
  return { value, evidence, source, method: 'rule', confidence, checkedAt: now, logicVersion: EXPERIENCE_LOGIC_VERSION };
}

export interface ExtractExperienceOptions {
  now?: Date;
}

/** "3+ years with a degree or 5+ years without" — the second amount is an alternative, not a higher bar. */
const ALTERNATIVE_RE = /(?<![\p{L}])(?:or|oder|ou|o|eller|lub|albo|nebo|tai|alternatively|alternativ|alternativement|of (?=\d)|oppure)(?![\p{L}])/iu;

function dropAlternatives(pool: ExperienceMention[], text: string): ExperienceMention[] {
  const sorted = [...pool].sort((x, y) => x.start - y.start);
  const dropped = new Set<ExperienceMention>();
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const between = text.slice(prev.end, cur.start);
    if (between.length > 100 || /[\n;•|]/u.test(between) || !ALTERNATIVE_RE.test(between)) continue;
    dropped.add(prev.minYears > cur.minYears ? prev : cur);
  }
  return sorted.filter((m) => !dropped.has(m));
}

function pickRequirement(pool: ExperienceMention[], text: string): { chosen: ExperienceMention; conflicting: boolean } {
  const candidates = dropAlternatives(pool, text);
  const chosen = [...candidates].sort(
    (x, y) => y.minYears - x.minYears || (x.maxYears === null ? 1 : 0) - (y.maxYears === null ? 1 : 0) || x.start - y.start,
  )[0];
  const conflicting = candidates.some((m) => m !== chosen && m.maxYears !== null && m.maxYears < chosen.minYears && !m.security && !chosen.security);
  return { chosen, conflicting };
}

/**
 * Required years of experience for a posting. `band` = settings profile.experienceBand.
 * Text wins; an experience note in the title ("(5+ years)") comes next; title seniority words
 * (Junior/Senior/Lead/Werkstudent …) are a low-confidence fallback.
 */
export function extractExperience(
  text: string,
  title: string,
  band: ExperienceBandSettings = DEFAULT_EXPERIENCE_BAND,
  opts: ExtractExperienceOptions = {},
): Fact<ExperienceValue> {
  const now = opts.now ?? new Date();
  const body = String(text ?? '').slice(0, MAX_TEXT);
  const titleText = String(title ?? '');
  const mentions = findExperienceMentions(body);
  const securityStrict =
    mentions.some((m) => m.security && !m.preferred && m.minYears > 0) ||
    (mentions.length > 0 && mentions.every((m) => m.preferred) && mentions.some((m) => m.security && m.minYears > 0));
  const required = mentions.filter((m) => !m.preferred);
  const numericRequired = required.filter((m) => m.kind !== 'vague');
  const numericPreferred = mentions.filter((m) => m.preferred && m.kind !== 'vague');

  const pool = numericRequired.length ? numericRequired : numericPreferred;
  if (pool.length) {
    const { chosen, conflicting } = pickRequirement(pool, prep(body));
    let confidence: Confidence = chosen.kind === 'none' ? 'medium' : chosen.strength === 'explicit' ? 'high' : 'medium';
    if (!numericRequired.length) confidence = lowerConfidence(confidence);
    if (conflicting) confidence = lowerConfidence(confidence);
    const value: ExperienceValue = {
      minYears: chosen.minYears,
      maxYears: chosen.maxYears,
      band: experienceBandFor(chosen.minYears, chosen.maxYears, band),
      securityStrict,
    };
    return fact(value, chosen.quote, 'posting text', confidence, now);
  }

  const titleNote = findExperienceMentions(titleText, { assumeRequirement: true }).find((m) => m.kind === 'numeric');
  if (titleNote) {
    const value: ExperienceValue = {
      minYears: titleNote.minYears,
      maxYears: titleNote.maxYears,
      band: experienceBandFor(titleNote.minYears, titleNote.maxYears, band),
      securityStrict: securityStrict || titleNote.security,
    };
    return fact(value, titleNote.quote, 'posting title', 'medium', now);
  }

  const seniority = detectSeniority(titleText);
  const titleRange = seniority.word ? TITLE_SENIORITY_YEARS[seniority.entry ? 'entry' : seniority.word] : null;
  const vague = required.find((m) => m.kind === 'vague') ?? mentions.find((m) => m.kind === 'vague');
  if (vague && !titleRange) {
    const value: ExperienceValue = { minYears: vague.minYears, maxYears: null, band: experienceBandFor(vague.minYears, null, band), securityStrict };
    return fact(value, vague.quote, 'posting text', 'low', now);
  }
  if (titleRange) {
    const value: ExperienceValue = {
      minYears: titleRange.min,
      maxYears: titleRange.max,
      band: experienceBandFor(titleRange.min, titleRange.max, band),
      securityStrict,
    };
    return fact(value, collapseWhitespace(titleText).slice(0, 160), 'posting title', 'low', now);
  }
  return fact({ minYears: null, maxYears: null, band: 'unknown', securityStrict: false }, null, 'posting text', 'low', now);
}
