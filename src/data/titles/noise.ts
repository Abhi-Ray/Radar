/**
 * Title noise: text that carries no role meaning (gender markers, hashtags, requisition ids,
 * employment type, workplace words), stop words for phrase matching, and seniority words.
 * Seniority is detected first and then removed, so "Sr. Cloud Security Engineer II (m/w/d) - Remote"
 * maps like "Cloud Security Engineer".
 */
import type { SeniorityWord } from '../../lib/contracts/jobs';

/**
 * Gender markers: (m/w/d), (w/m/x), (f/m/d), (H/F), (F/H), (M/V), (K/M), (m/ž), (gn), (all genders), (he/she/they).
 * Letters: m, w, f, d, x, h, v, k, n, ž/z, div; separated by / | , . or *.
 */
export const GENDER_MARKER_RES: readonly RegExp[] = [
  /\(\s*(?:[mwfdxhvkzžn]|div\.?|diverse|divers|inter)\s*(?:[/|,.*]\s*(?:[mwfdxhvkzžn]|div\.?|diverse|divers|inter)\s*){1,3}\)/giu,
  /(?<![\p{L}\p{N}])(?:[mwfdh])\s*\/\s*(?:[mwfdh])(?:\s*\/\s*(?:[mwfdxh]|div\.?))?(?![\p{L}\p{N}])/giu,
  /\(\s*(?:mwd|wmd|fmd|mfd|mfx|dmw|gn|gn\*|a\.?g\.?|all genders?|any gender|alle geschlechter|tous genres|toutes et tous|todos los géneros|he\s*\/\s*she(?:\s*\/\s*they)?|she\s*\/\s*he(?:\s*\/\s*they)?|they\s*\/\s*them)\s*\)/giu,
  /\b(?:all genders|alle geschlechter|m\/w\/d|w\/m\/d)\b/giu,
];

/** German gender-inclusive endings: Ingenieur*in, Berater:in, Entwickler/-in, EntwicklerIn, Spezialist_innen, Berater(in). */
export const GERMAN_GENDER_SUFFIX_RES: readonly [RegExp, string][] = [
  [/(\p{Ll})(?:\*|:|_|\/-?|\(-?)in(?:nen)?\)?(?![\p{L}])/gu, '$1'],
  [/(\p{Ll})In(?:nen)?(?![\p{L}])/gu, '$1'],
];

/** Romance / Polish gender endings: ingeniero/a, engenheiro(a), ingénieur(e), ingénieur·e, analista/o. */
export const ROMANCE_GENDER_SUFFIX_RE = /(\p{Ll})(?:\((?:e|a|o|ne|as|es|ère|euse|rice|trice|ka)\)|\/(?:a|e|o|ne|as|ka)|·(?:e|ne|s))(?![\p{L}\p{N}])/gu;

/** LinkedIn / ATS hashtags ("#LI-Remote", "#LI-DNI", "#hiring"). */
export const HASHTAG_RE = /#[\p{L}\p{N}_-]+/gu;

/** Requisition ids and reference numbers ("Req. 12345", "JR-10234", "(R0012345)", "Job ID: A-123", "Ref 2024/15"). */
export const REQUISITION_RES: readonly RegExp[] = [
  /\b(?:req(?:uisition)?|job\s*(?:id|no|code|ref)|ref(?:erence)?|vacancy(?:\s*id)?|stellen(?:-?id|nummer)?|kennziffer|referenz|réf(?:érence)?|id|jr|r|p)\s*(?:no\.?|nr\.?|#)?\s*[:#.\-]?\s*[A-Z]{0,4}[-_/]?\d[\w\-/]{2,}/giu,
  /\(\s*[A-Z]{0,4}[-_]?\d{4,}[\w-]*\s*\)/gu,
  /(?<![\p{L}\p{N}.])\d{4,}(?![\p{L}\p{N}])/gu,
];

/** Experience notes inside titles ("(5+ years)", "3-5 Jahre", "min. 2 ans") — handled by the experience parser. */
export const EXPERIENCE_NOTE_RE =
  /(?:\b(?:min(?:imum)?\.?|mind(?:estens)?\.?|at least|ab)\s*)?\d{1,2}\s*(?:\+|plus)?\s*(?:[-–]\s*\d{1,2}\s*)?\+?\s*(?:years?|yrs?|y|jahre?n?|j|ans?|années?|anos?|años?|anni|jaar|jaren|år|ar|vuotta|lat|let|roku)\b(?:\s*(?:of\s+)?(?:experience|exp|erfahrung|berufserfahrung|d['’]?\s*expérience|experiencia|experiência|esperienza|ervaring|erfarenhet|erfaring|kokemusta|doświadczenia|zkušeností))?/giu;

/** Written forms of tech tokens whose punctuation would be lost by folding. */
export const TOKEN_REWRITES: readonly [RegExp, string][] = [
  [/(?<![\p{L}\p{N}])c#(?![\p{L}\p{N}])/giu, 'csharp'],
  [/(?<![\p{L}\p{N}])c\+\+(?![\p{L}\p{N}])/giu, 'cplusplus'],
  [/(?<![\p{L}\p{N}])\.net(?![\p{L}\p{N}])/giu, 'dotnet'],
  [/(?<![\p{L}\p{N}])asp\.net(?![\p{L}\p{N}])/giu, 'dotnet'],
];

/** Segment separators: , ; | ( ) [ ] { } : @ • · and dashes/slashes with spaces around them. */
export const SEGMENT_SPLIT_RE = /\s+[-–—/]\s+|[,;|()[\]{}:@•·]|\s+[-–—]|[-–—]\s+/u;

/** Workplace, schedule and contract words (folded): removed from the title key, never mapped. */
export const EMPLOYMENT_PHRASES: readonly string[] = [
  'remote', 'fully remote', 'full remote', '100 remote', 'remote first', 'remote only', 'remote friendly', 'remote possible', 'remote option',
  'hybrid', 'hybrid remote', 'onsite', 'on site', 'in office', 'office based', 'home office', 'homeoffice', 'home based', 'work from home', 'wfh',
  'telework', 'teletravail', 'teletravail possible', 'full teletravail', 'teletrabajo', 'remoto', 'remota', 'en remoto', 'da remoto', 'smart working',
  'thuiswerken', 'op afstand', 'distans', 'pa distans', 'hjemmekontor', 'fjernarbejde', 'etatyo', 'praca zdalna', 'zdalnie', 'zdalna', 'hybrydowo',
  'hybrydowa', 'prace z domova', 'mobiles arbeiten', 'mobile work', 'full time', 'fulltime', 'part time', 'parttime', 'vollzeit', 'teilzeit',
  'permanent', 'perm', 'festanstellung', 'feste anstellung', 'unbefristet', 'befristet', 'contract', 'contractor', 'contracting', 'freelance',
  'freelancer', 'freiberuflich', 'temporary', 'temp', 'fixed term', 'interim', 'cdi', 'cdd', 'b2b', 'uop', 'umowa o prace', 'hpp', 'tempo integral',
  'tiempo completo', 'jornada completa', 'media jornada', 'tempo pieno', 'tempo indeterminato', 'tempo determinato', 'vaste baan', 'vast contract',
  'fulltime', 'deeltijd', 'heltid', 'deltid', 'fuldtid', 'deltid', 'kokoaikainen', 'osa aikainen', 'pelny etat', 'plny uvazek', 'urgent',
  'immediate start', 'asap', 'ab sofort', 'zum nachstmoglichen zeitpunkt', 'we are hiring', 'hiring', 'now hiring', 'new', 'neu', 'nouveau',
  'multiple positions', 'multiple roles', 'various locations', 'multiple locations', 'relocation', 'relocation support', 'visa sponsorship',
  'visa sponsored', 'sponsorship available', 'hibrido', 'hibrida', 'ibrido', 'hybride', 'hybriden', 'hybrydowy', 'hybridni', 'presencial',
  'presenziale', 'sur site', 'op locatie', 'vor ort', 'english speaking', 'english', 'german speaking', 'french speaking', 'dutch speaking',
  'emea', 'apac', 'dach', 'benelux', 'nordics', 'europe', 'eu', 'worldwide', 'global', 'anywhere', 'latam', 'americas', 'uk', 'usa', 'us',
];

/** Stop words dropped before phrase matching (EN/DE/FR/NL/ES/PT/IT/Nordic/PL/CS). */
export const STOPWORDS: ReadonlySet<string> = new Set([
  'a', 'al', 'an', 'and', 'at', 'au', 'aux', 'bei', 'con', 'com', 'd', 'da', 'das', 'de', 'dei', 'del', 'della', 'delle', 'dello', 'der', 'des',
  'di', 'die', 'dla', 'do', 'dos', 'ds', 'du', 'e', 'el', 'en', 'et', 'for', 'fur', 'fuer', 'im', 'in', 'l', 'la', 'le', 'les', 'lo', 'los', 'mit',
  'na', 'nel', 'nella', 'och', 'of', 'og', 'on', 'op', 'per', 'pro', 'sa', 'sur', 'the', 'to', 'u', 'um', 'und', 've', 'van', 'voor', 'w', 'with',
  'y', 'z', 'ze', 'zu', 'zur', 'zum', 'as', 'spraw', 'ramach', 'within', 'team', 'area', 'dept', 'department', 'abteilung', 'bereich', 'focus',
  'focused', 'fokus', 'schwerpunkt', 'orientiert', 'oriented', 'minded', 'specialized', 'specialised', 'spezialisiert', 'like', 'type',
  'i', 'o', 'ou', 'or', 'oder', 'eller', 'tai', 'lub', 'nebo', 'of', 'ja', 'und', 'from', 'by', 'via', 'into',
]);

export interface SeniorityTerm {
  word: SeniorityWord;
  /** Internship / apprenticeship / graduate wording (experience fallback treats it as 0–1 years). */
  entry?: boolean;
  terms: readonly string[];
}

/** Seniority words (folded matching, multi-word allowed). The highest rank found wins. */
export const SENIORITY_TERMS: readonly SeniorityTerm[] = [
  { word: 'junior', entry: true, terms: [
    'intern', 'interns', 'internship', 'werkstudent', 'werkstudentin', 'working student', 'praktikant', 'praktikantin', 'praktikum', 'pflichtpraktikum',
    'stagiaire', 'stage', 'alternant', 'alternante', 'alternance', 'apprenti', 'apprentie', 'apprentissage', 'becario', 'becaria', 'practicas',
    'practicante', 'estagiario', 'estagiaria', 'estagio', 'tirocinante', 'tirocinio', 'stagista', 'stagiair', 'stage', 'afstudeerder', 'afstudeerstage',
    'praktikant', 'harjoittelija', 'kesatyontekija', 'stazysta', 'stazystka', 'praktykant', 'praktykantka', 'staz', 'praktyki', 'staz', 'brigadnik',
    'trainee', 'graduate', 'grad', 'new grad', 'graduate programme', 'graduate program', 'apprentice', 'apprenticeship', 'auszubildende',
    'auszubildender', 'ausbildung', 'azubi', 'duales studium', 'dualer student', 'absolvent', 'absolventin', 'berufseinsteiger', 'berufseinsteigerin',
    'einsteiger', 'debutant', 'debutante', 'jeune diplome', 'jeune diplomee', 'recien graduado', 'recien titulado', 'recem formado', 'neolaureato',
    'nyutexaminerad', 'nyuddannet', 'nyutdannet', 'vastavalmistunut', 'absolwent', 'student', 'studentin', 'etudiant', 'estudiante', 'thesis student',
    'entry level', 'entry', 'early career', 'summer intern', 'co op', 'coop',
  ] },
  { word: 'junior', terms: ['junior', 'jr', 'jnr', 'associate', 'mlodszy', 'mlodsza', 'nuorempi', 'l1', 'level 1', 'tier 1'] },
  { word: 'mid', terms: ['mid', 'mid level', 'midlevel', 'intermediate', 'medior', 'confirme', 'confirmee', 'semi senior', 'semisenior', 'ssr', 'pleno', 'regular', 'l2', 'level 2', 'tier 2', 'professional level'] },
  { word: 'senior', terms: ['senior', 'sr', 'snr', 'sen', 'experienced', 'erfahren', 'erfahrener', 'erfahrene', 'ervaren', 'experimente', 'experimentee', 'senior level', 'sénior', 'starszy', 'starsza', 'vanhempi', 'l3', 'level 3', 'tier 3', 'seniorni'] },
  { word: 'lead', terms: ['lead', 'staff', 'team lead', 'teamlead', 'team leader', 'tech lead', 'technical lead', 'teamleiter', 'teamleiterin', 'gruppenleiter', 'gruppenleiterin', 'leitender', 'leitende', 'chef d equipe', 'lider', 'lider tecnico', 'teamleider', 'tiiminvetaja', 'glowny', 'glowna', 'vedouci tymu', 'squad lead', 'chapter lead', 'l4', 'level 4'] },
  { word: 'principal', terms: ['principal', 'distinguished', 'fellow', 'director', 'directeur', 'directrice', 'directora', 'diretor', 'direttore', 'direktor', 'head of', 'head', 'vp', 'vice president', 'svp', 'evp', 'chief', 'cto', 'ciso', 'cso', 'cio', 'bereichsleiter', 'abteilungsleiter', 'hauptabteilungsleiter', 'leiter', 'leiterin'] },
];

/** Roman / arabic level suffixes ("Engineer II", "Analyst 3"). */
export const LEVEL_NUMERALS: Readonly<Record<string, SeniorityWord>> = {
  i: 'junior',
  '1': 'junior',
  ii: 'mid',
  '2': 'mid',
  iii: 'senior',
  '3': 'senior',
  iv: 'lead',
  '4': 'lead',
  v: 'principal',
};

export const SENIORITY_RANK: Readonly<Record<SeniorityWord, number>> = { junior: 1, mid: 2, senior: 3, lead: 4, principal: 5 };
