/**
 * Recruiter / agency detection (spec §11.2: agencies are marked Agency, not treated as the
 * employer). Three kinds of evidence, strongest first:
 *
 *  1. a known agency ("Hays", "Randstad", "Michael Page" …) — matched on the whole normalised
 *     name, optionally followed only by generic words ("Hays Technology Solutions", "Randstad
 *     Deutschland"), so "Hudson River Trading" or "Reed Elsevier" are not agencies;
 *  2. an agency word in the name ("… Recruitment Ltd", "… Personalberatung", "… Uitzendbureau");
 *  3. a posting written by a recruiter for somebody else ("on behalf of our client", "im Auftrag
 *     unseres Kunden", "pour le compte de notre client" …). IT consultancies and body-leasing firms
 *     that employ the people they place (Accenture, Capgemini, EPAM …) are never flagged by text.
 *
 * Pure: no DB. The resolver decides what to store.
 */
import { lookupPhrase } from '../../data/places';
import { foldWithMap, quoteAround } from '../normalize/text';
import { coreCompanyTokens } from './normalize';

export type AgencyStrength = 'strong' | 'weak' | 'none';

export interface AgencyDetection {
  isAgency: boolean;
  strength: AgencyStrength;
  confidence: number;
  /** Where it came from: the name, or a verbatim quote from the posting. */
  evidence: string | null;
  ruleId: string | null;
  kind: 'known_agency' | 'name_keyword' | 'description' | null;
}

const NONE: AgencyDetection = { isAgency: false, strength: 'none', confidence: 0, evidence: null, ruleId: null, kind: null };

/** Normalised names (see normalizeCompanyName) of well-known recruitment / staffing firms. */
export const KNOWN_AGENCIES: readonly string[] = [
  // Global / UK / US
  'hays', 'randstad', 'randstad professionals', 'randstad technologies', 'randstad sourceright', 'michael page', 'page personnel',
  'page executive', 'pagegroup', 'page group', 'robert half', 'robert walters', 'walters people', 'adecco', 'adecco group', 'lhh',
  'modis', 'spring professional', 'badenoch and clark', 'harvey nash', 'nash squared', 'computer futures', 'jefferson frank',
  'nigel frank', 'mason frank', 'frank recruitment group', 'tenth revolution group', 'experis', 'manpower', 'manpowergroup',
  'jefferson wells', 'kelly services', 'kforce', 'reed', 'reed specialist recruitment', 'sthree', 'progressive recruitment',
  'real staffing', 'huxley', 'huxley associates', 'madison black', 'orgtel', 'global enterprise partners', 'hydrogen group',
  'morgan mckinley', 'cpl', 'sigmar recruitment', 'brightwater', 'lincoln recruitment', 'pertemps', 'blue arrow', 'office angels',
  'goodman masson', 'la fosse', 'la fosse associates', 'oliver bernard', 'understanding recruitment', 'harnham', 'xcede', 'venquis',
  'templeton and partners', 'square one resources', 'gi group', 'grafton recruitment', 'antal', 'antal international', 'allegis group',
  'aerotek', 'teksystems', 'aston carter', 'insight global', 'apex systems', 'cybercoders', 'motion recruitment', 'jobot',
  'alexander mann solutions', 'cielo', 'cielo talent', 'guidant global', 'hudson', 'hudson global', 'hudson rpo', 'korn ferry futurestep',
  'kornferry futurestep', 'heidrick and struggles', 'spencer stuart', 'egon zehnder', 'russell reynolds associates', 'odgers berndtson',
  'boyden', 'stanton chase', 'lorien', 'resourcing solutions', 'nicoll curtin', 'salt recruitment', 'trinity resource solutions',
  'volt europe', 'kelly outsourcing and consulting group', 'staffmark', 'express employment professionals', 'hirequest',
  // Benelux / France / Iberia / Italy
  'tempo team', 'tempoteam', 'start people', 'synergie', 'synergie italia', 'proman', 'expectra', 'fed group', 'fed it', 'fed finance',
  'brunel', 'yacht', 'youbahn', 'undutchables', 'headfirst', 'headfirst group', 'actief', 'covebo', 'otto work force', 'otto workforce',
  'umana', 'openjobmetis', 'etjca', 'lavoropiu', 'orienta', 'eurointerim', 'multitalent',
  // DACH
  'amadeus fire', 'gulp', 'gulp information services', 'etengo', 'solcom', 'hager unternehmensberatung', 'i potentials', 'ipotentials',
  'personalwerk', 'orizon', 'persona service', 'piening', 'tempton', 'timepartner', 'dekra arbeit', 'trenkwalder', 'iperdi', 'bindan',
  'zag personaldienstleistungen', 'jobs in time', 'hofmann personal', 'i k hofmann', 'ikh', 'adecco personaldienstleistungen',
  'randstad deutschland', 'hays professional solutions', 'sthree deutschland', 'arwa personaldienstleistungen', 'expertum',
  'unique personalservice', 'yer deutschland', 'westhouse', 'westhouse consulting', 'questax', 'emagine', 'avantgarde experts',
  'kienbaum', 'kienbaum consultants', 'mercuri urval', 'rochus mummert', 'hapeko', 'michael bailey associates', 'rockit recruitment',
  // Nordics / Baltics / CEE
  'academic work', 'poolia', 'lernia', 'bemannia', 'ework', 'ework group', 'dfind', 'wise professionals', 'jurek', 'nexer recruit',
  'studentconsulting', 'uniflex', 'proffice', 'nigel wright', 'devire', 'talent place', 'hrk', 'work service', 'grafton',
];

/** Big employers whose name contains an agency word ("Recruit Holdings" is Indeed's parent). */
const NOT_AGENCIES: ReadonlySet<string> = new Set([
  'recruit holdings', 'recruit', 'recruitee', 'recruiterbox', 'recruitly', 'linkedin', 'indeed', 'stepstone', 'xing', 'glassdoor',
  'personio', 'greenhouse', 'lever', 'workday', 'smartrecruiters', 'teamtailor', 'join', 'hibob',
]);

/**
 * Consultancies and IT-service firms that employ the people they place: postings mention "our
 * client" all the time, but they are the employer, so text phrases never mark them as agencies.
 */
export const KNOWN_CONSULTANCIES: readonly string[] = [
  'accenture', 'capgemini', 'capgemini engineering', 'sogeti', 'sopra steria', 'atos', 'eviden', 'cgi', 'cognizant', 'infosys',
  'tata consultancy services', 'tcs', 'wipro', 'hcl', 'hcltech', 'hcl technologies', 'ibm', 'deloitte', 'pwc',
  'pricewaterhousecoopers', 'ey', 'ernst and young', 'kpmg', 'thoughtworks', 'epam', 'epam systems', 'globant', 'endava', 'nagarro',
  'luxoft', 'dxc technology', 'ntt data', 'fujitsu', 'tech mahindra', 'mphasis', 'ltimindtree', 'hexaware', 'virtusa', 'mckinsey',
  'mckinsey and company', 'boston consulting group', 'bcg', 'bain', 'bain and company', 'oliver wyman', 'roland berger', 'booz allen hamilton',
  'bearingpoint', 'msg', 'msg systems', 'adesso', 'materna', 'cancom', 'bechtle', 'computacenter', 'allgeier', 'netcompany', 'tietoevry',
  'knowit', 'sigma', 'avanade', 'slalom', 'publicis sapient', 'valtech', 'reply', 'alten', 'altran', 'bertrandt', 'edag', 'iav',
  'expleo', 'assystem', 'segula', 'akka', 'devoteam', 'inetum', 'gft', 'gft technologies', 'zuhlke', 'zuehlke', 'netlight', 'bouvet',
  'sii', 'sii poland', 'softwaremind', 'software mind', 'stx next', '10clouds', 'netguru', 'ciklum', 'softserve', 'n ix', 'intellias',
  'dataart', 'grid dynamics', 'emerging it', 'x team', 'toptal', 'andela', 'turing',
];

const KNOWN_AGENCY_SET: ReadonlySet<string> = new Set(KNOWN_AGENCIES);
const KNOWN_CONSULTANCY_SET: ReadonlySet<string> = new Set(KNOWN_CONSULTANCIES);
/** Known agency names that are also ordinary words: only an exact (not prefix) name match counts. */
const EXACT_ONLY: ReadonlySet<string> = new Set(['reed', 'hudson', 'yacht', 'cielo', 'boyden', 'brightwater', 'westhouse', 'grafton', 'jurek', 'actief']);

/** Words that may follow a known agency name without making it a different company. */
const GENERIC_AFTER_AGENCY: ReadonlySet<string> = new Set([
  'recruitment', 'recruiting', 'staffing', 'group', 'international', 'global', 'professional', 'professionals', 'specialist',
  'specialists', 'it', 'technology', 'technologies', 'tech', 'digital', 'engineering', 'consulting', 'consultants', 'solutions',
  'search', 'executive', 'talent', 'personnel', 'resourcing', 'resources', 'services', 'associates', 'partners', 'and', 'workforce',
  'finance', 'legal', 'healthcare', 'life', 'sciences', 'sales', 'marketing', 'office', 'support', 'contracting', 'interim',
  'personal', 'personalservice', 'personaldienstleistungen', 'personaldienstleistung', 'personalberatung', 'personalvermittlung',
  'zeitarbeit', 'uitzendbureau', 'direct', 'select', 'selection', 'people', 'career', 'careers', 'jobs', 'hr', 'outsourcing',
  'managed', 'rpo', 'plc', 'holding', 'holdings', 'emea', 'europe', 'dach', 'benelux', 'nordics', 'nordic', 'uk', 'usa', 'us',
]);

function isGenericAfterAgency(token: string): boolean {
  if (GENERIC_AFTER_AGENCY.has(token)) return true;
  if (KNOWN_AGENCY_SET.has(token)) return true;
  return lookupPhrase(token).some((e) => e.kind === 'country' || e.kind === 'city' || e.kind === 'macro');
}

/** The known agency a normalised name belongs to, else null. */
export function knownAgencyOf(normalizedName: string): string | null {
  const key = normalizedName.trim();
  if (!key) return null;
  if (NOT_AGENCIES.has(key)) return null;
  if (KNOWN_AGENCY_SET.has(key)) return key;
  const words = key.split(' ');
  for (let k = Math.min(words.length - 1, 5); k >= 1; k--) {
    const head = words.slice(0, k).join(' ');
    if (!KNOWN_AGENCY_SET.has(head) || EXACT_ONLY.has(head)) continue;
    if (words.slice(k).every(isGenericAfterAgency)) return head;
  }
  return null;
}

export function isKnownConsultancy(normalizedName: string): boolean {
  const key = normalizedName.trim();
  if (KNOWN_CONSULTANCY_SET.has(key)) return true;
  const words = key.split(' ');
  for (let k = Math.min(words.length - 1, 4); k >= 1; k--) {
    const head = words.slice(0, k).join(' ');
    if (KNOWN_CONSULTANCY_SET.has(head) && words.slice(k).every(isGenericAfterAgency)) return true;
  }
  return false;
}

/** Whole words in a company name that make it an agency. */
const NAME_WORDS: ReadonlySet<string> = new Set([
  'recruitment', 'recruiting', 'recruiters', 'recruiter', 'staffing', 'headhunter', 'headhunters', 'headhunting', 'resourcing',
  'personnel', 'personalberatung', 'personalvermittlung', 'personaldienstleistung', 'personaldienstleistungen', 'personaldienstleister',
  'personalservice', 'personalagentur', 'personalleasing', 'zeitarbeit', 'arbeitnehmeruberlassung', 'arbeitsvermittlung',
  'stellenvermittlung', 'jobvermittlung', 'uitzendbureau', 'uitzendorganisatie', 'detacheringsbureau', 'recrutement', 'recrutamento',
  'reclutamiento', 'rekrytering', 'rekrytointi', 'henkilostopalvelu', 'henkilostopalvelut', 'bemanning', 'bemanningsbyra',
  'bemandingsbureau', 'rekruttering', 'vikarbureau', 'rekrutacja', 'rekrutacyjna', 'personalvermittler', 'interim', 'interimaire',
]);

/** Multi-word agency phrases in a company name. */
const NAME_PHRASES: readonly string[] = [
  'executive search', 'employment agency', 'employment services', 'recruitment agency', 'staffing agency', 'staffing solutions',
  'workforce solutions', 'talent acquisition partners', 'search and selection', 'werving en selectie', 'werving and selectie',
  'cabinet de recrutement', 'travail temporaire', 'agence d emploi', 'agence interim', 'empresa de trabajo temporal',
  'seleccion de personal', 'agenzia per il lavoro', 'selezione del personale', 'agencja pracy', 'agencja zatrudnienia',
  'personal service', 'personal services', 'personal management',
];

/** German / Dutch compounds recognised inside a word ("Müller Personalberatungsgesellschaft"). */
const NAME_STEMS: readonly string[] = [
  'personalberatung', 'personalvermittlung', 'personaldienstleist', 'zeitarbeit', 'arbeitnehmeruberlass', 'personalleasing',
  'uitzendbureau', 'uitzendorganis', 'detacheringsbureau', 'bemanningsbyra', 'bemandingsbureau', 'headhunt', 'rekryterings',
];

/** Agency evidence from the company name alone. */
export function detectAgencyFromName(name: string): AgencyDetection {
  const tokens = coreCompanyTokens(name);
  const key = tokens.join(' ');
  if (!key || NOT_AGENCIES.has(key)) return NONE;
  const known = knownAgencyOf(key);
  if (known) {
    return { isAgency: true, strength: 'strong', confidence: 0.95, evidence: `Known recruitment agency: ${name.trim()}`, ruleId: `agency.known.${known.replace(/ /g, '_')}`, kind: 'known_agency' };
  }
  if (isKnownConsultancy(key)) return NONE;
  const word = tokens.find((t) => NAME_WORDS.has(t));
  const padded = ` ${key} `;
  const phrase = NAME_PHRASES.find((p) => padded.includes(` ${p} `));
  const stem = word || phrase ? null : NAME_STEMS.find((s) => tokens.some((t) => t.length > s.length && t.includes(s)));
  const hit = word ?? phrase ?? stem;
  if (!hit) return NONE;
  return { isAgency: true, strength: 'strong', confidence: 0.9, evidence: `Agency word in the name: ${name.trim()}`, ruleId: `agency.name.${hit.replace(/ /g, '_')}`, kind: 'name_keyword' };
}

interface TextRule {
  id: string;
  re: RegExp;
  strength: 'strong' | 'weak';
}

/**
 * Posting phrases, matched on folded text (lowercase, no diacritics).
 *
 * Strong = a recruiter filling a job for a hidden client ("on behalf of our client", "für unseren
 * Kunden suchen wir"). Consultancies and body-leasing firms also talk about "our client" — where
 * you will be placed — but they are the employer, so the client-phrases of languages where both
 * usages are common need a recruiting verb nearby ("… recherche", "… suchen wir", "… zoeken wij").
 * Weak = an agency may be involved; reported, never acted on alone.
 */
const TEXT_RULES: readonly TextRule[] = [
  // English
  { id: 'en.on_behalf_of_client', strength: 'strong', re: /\b(?:on behalf of|recruiting for|representing|hiring for)\s+(?:our|my|a|an|one of our|one of my)\s+(?:[a-z-]+\s+){0,2}?client(?:'s)?\b(?!s)|\bon behalf of one of (?:our|my) clients\b/ },
  { id: 'en.our_client_is', strength: 'strong', re: /\b(?:our|my) client (?:is|are) (?:a|an|one of|currently|now|looking|seeking|searching|hiring|recruiting|based|located|headquartered|expanding|growing|actively)\b/ },
  { id: 'en.our_client_verb', strength: 'strong', re: /\b(?:our|my) client (?:seeks|needs|wants|requires|has asked|has engaged|has retained|is keen)\b/ },
  { id: 'en.agency_notice', strength: 'strong', re: /\bacting as an? (?:employment agency|employment business|recruitment agency|recruitment business|agency)\b|\b(?:employment agency|employment business) (?:in relation to|for (?:this|the) (?:vacancy|role|position))\b/ },
  { id: 'en.first_person_recruiter', strength: 'strong', re: /\b(?:i am|i'm|i have been|i've been) (?:currently |exclusively )?(?:working|partnering|partnered|recruiting) (?:with|for) (?:a|an)\b[^.]{0,80}\bclient\b|\b(?:exclusively|retained) (?:working |partnering |partnered )?(?:with|by) (?:a|an)\b[^.]{0,80}\bclient\b/ },
  { id: 'en.client_of_ours', strength: 'strong', re: /\ba client of (?:ours|mine)\b/ },
  { id: 'en.our_client', strength: 'weak', re: /\b(?:our|my) client\b(?!s)|\bon behalf of (?:our|my) clients\b/ },
  // German
  { id: 'de.im_auftrag', strength: 'strong', re: /\b(?:im auftrag|fur) (?:unseres|unserer|eines|einer|unseren|unsere|einen|einen unserer) (?:[a-z-]+ ){0,2}?(?:kunden|mandanten|klienten|auftraggebers|auftraggeber|kundin|kundenunternehmens|kundenunternehmen)\b[^.]{0,120}?\b(?:suchen wir|sind wir (?:derzeit |aktuell )?auf der suche|besetzen wir|wir suchen|suchen (?:wir )?(?:ab sofort|zum nachstmoglichen))/ },
  { id: 'de.unser_mandant', strength: 'strong', re: /\bunser(?:e|es|en)? (?:mandant|mandantin|mandanten|auftraggeber|auftraggeberin)\b(?! ?(?:innen|beziehung))|\bunser(?:e)? (?:kunde|kundin|klient) (?:ist|sucht|gehort|zahlt|bietet|mit sitz)\b/ },
  { id: 'de.direktvermittlung', strength: 'strong', re: /\b(?:direktvermittlung|im rahmen (?:der|einer) (?:personalvermittlung|direktvermittlung)|vermittlungsprovision|provisionsfrei fur (?:sie|bewerber))\b/ },
  { id: 'de.agency_words', strength: 'weak', re: /\b(?:arbeitnehmeruberlassung|zeitarbeit|personaldienstleister|personalvermittler|personalberatung|bei unserem kunden)\b/ },
  // French
  { id: 'fr.client_recherche', strength: 'strong', re: /\b(?:notre client(?:e)?|pour le compte (?:de|d') ?(?:notre|un de nos|l'un de nos|un|une) client(?:e)?)\b[^.]{0,80}?\b(?:recherche|recrute|souhaite (?:recruter|renforcer|integrer)|est a la recherche|nous recherchons|nous recrutons)\b|\b(?:nous recherchons|nous recrutons|recherchons|recrutons) pour (?:le compte (?:de|d') ?)?(?:notre|un de nos|l'un de nos|un|une) (?:[a-z-]+ )?client(?:e)?\b/ },
  { id: 'fr.cabinet', strength: 'weak', re: /\b(?:cabinet de recrutement|agence d'interim|agence de travail temporaire|entreprise de travail temporaire|notre client)\b/ },
  // Dutch
  { id: 'nl.opdrachtgever', strength: 'strong', re: /\b(?:voor|namens) (?:onze|een van onze|een) (?:[a-z-]+ )?(?:opdrachtgever|klant|relatie)\b[^.]{0,80}?\b(?:zoeken wij|zoeken we|zijn wij (?:op zoek|opzoek)|zijn we (?:op zoek|opzoek)|op zoek naar)\b|\bonze (?:opdrachtgever|klant) (?:is|zoekt|is op zoek)\b/ },
  { id: 'nl.agency_words', strength: 'weak', re: /\b(?:uitzendbureau|werving en selectie|werving & selectie|onze opdrachtgever)\b/ },
  // Spanish
  { id: 'es.cliente_busca', strength: 'strong', re: /\b(?:para|en nombre de|por cuenta de) (?:nuestro|un|una|importante|importante empresa|empresa) ?(?:importante |empresa )?cliente\b[^.]{0,80}?\b(?:buscamos|seleccionamos|precisa|necesita|busca|incorporar|incorporara)\b|\b(?:seleccionamos|buscamos) para (?:importante |nuestro |un |una )?(?:empresa )?cliente\b|\bnuestro cliente (?:busca|precisa|necesita|es una|es un|esta buscando)\b/ },
  { id: 'es.ett', strength: 'weak', re: /\b(?:empresa de trabajo temporal|nuestro cliente)\b/ },
  // Italian
  { id: 'it.cliente_ricerca', strength: 'strong', re: /\b(?:per|per conto di) (?:un |una |il )?(?:nostro |nostra |importante |primaria |nota |storica )?(?:azienda cliente|societa cliente|cliente)\b[^.]{0,80}?\b(?:ricerchiamo|cerchiamo|selezioniamo|ricerca|cerca|stiamo cercando|siamo alla ricerca)\b|\b(?:ricerchiamo|cerchiamo|selezioniamo) per (?:un |una )?(?:nostro |nostra |importante |primaria )?(?:azienda cliente|societa cliente|cliente)\b|\b(?:il )?nostro cliente (?:ricerca|cerca|e un|e una|sta cercando)\b/ },
  { id: 'it.agenzia', strength: 'weak', re: /\b(?:agenzia per il lavoro|somministrazione di lavoro|in somministrazione|azienda cliente)\b/ },
  // Portuguese
  { id: 'pt.cliente_procura', strength: 'strong', re: /\b(?:para|em nome d[oa]) (?:o |a )?(?:nosso|nossa|um|uma) (?:empresa )?cliente\b[^.]{0,80}?\b(?:procuramos|recrutamos|procura|seleciona|selecionamos|pretende)\b|\bo nosso cliente (?:procura|e uma|e um|pretende|esta a recrutar)\b|\b(?:recrutamos|procuramos) para (?:o )?(?:nosso|um|uma) (?:empresa )?cliente\b/ },
  // Swedish / Danish / Norwegian
  { id: 'sv.kunds_rakning', strength: 'strong', re: /\b(?:for|pa uppdrag av) (?:var|en av vara|en) (?:kunds? rakning|kund|uppdragsgivare)\b[^.]{0,80}?\b(?:soker vi|rekryterar vi|soker)\b|\bfor (?:var|en) kunds rakning\b|\bvar kund (?:soker|ar ett|ar en)\b/ },
  { id: 'da.vores_kunde', strength: 'strong', re: /\b(?:pa vegne af|for) (?:vores|en af vores|en) (?:kunde|klient)\b[^.]{0,80}?\b(?:soger vi|soger)\b|\bpa vegne af (?:vores|en) (?:kunde|klient)\b|\bvores (?:kunde|klient) (?:soger|er en|er et)\b/ },
  { id: 'no.var_kunde', strength: 'strong', re: /\b(?:pa vegne av|for) (?:var|en av vare|en) (?:kunde|oppdragsgiver)\b[^.]{0,80}?\b(?:soker vi|soker)\b|\bpa vegne av (?:var|en) (?:kunde|oppdragsgiver)\b|\bvar (?:kunde|oppdragsgiver) (?:soker|er en|er et)\b/ },
  { id: 'nordic.bemanning', strength: 'weak', re: /\b(?:bemanningsforetag|bemanningsbyra|bemanningsbureau|rekrutteringsbureau|rekryteringsforetag|vikarbureau)\b/ },
  // Polish / Czech / Slovak
  { id: 'pl.nasz_klient', strength: 'strong', re: /\b(?:dla|w imieniu) (?:naszego|jednego z naszych|naszej) (?:[a-z-]+ )?(?:klienta|klientow|klientki|partnera)\b|\bnasz klient (?:to|jest|poszukuje|oferuje|zatrudni)\b/ },
  { id: 'pl.agencja', strength: 'weak', re: /\bagencj[aie] (?:pracy|zatrudnienia)\b/ },
  { id: 'cs.nas_klient', strength: 'strong', re: /\bpro (?:naseho|nasi|naseho vyznamneho) (?:klienta|zakaznika|klientku)\b[^.]{0,80}?\b(?:hledame|hleda|pripravujeme|vybirame)\b|\b(?:hledame|vybirame) pro (?:naseho|nasi) (?:klienta|zakaznika|klientku)\b|\bnas (?:klient|zakaznik) (?:hleda|je)\b/ },
  // Finnish / Hungarian
  { id: 'fi.asiakkaamme', strength: 'strong', re: /\b(?:asiakasyrityksemme|asiakasyritykseemme|toimeksiantajamme|toimeksiantajallemme)\b|\bhaemme asiakkaallemme\b|\basiakkaamme (?:etsii|hakee)\b/ },
  { id: 'hu.partnerunk', strength: 'strong', re: /\b(?:partnerunk|ugyfelunk|megbizonk|megbizonk) (?:szamara|reszere)\b[^.]{0,80}?\bkeres(?:unk|ek|)\b|\b(?:ugyfelunk|megbizonk) (?:keres|egy)\b/ },
];

/** Agency evidence from the posting text (a verbatim quote), ignoring known consultancies. */
export function detectAgencyFromText(text: string | null | undefined, companyNormalizedName?: string | null): AgencyDetection {
  if (!text || !text.trim()) return NONE;
  if (companyNormalizedName && isKnownConsultancy(companyNormalizedName)) return NONE;
  const sample = text.length > 20_000 ? text.slice(0, 20_000) : text;
  const { folded, map } = foldWithMap(sample);
  let weak: AgencyDetection | null = null;
  for (const rule of TEXT_RULES) {
    rule.re.lastIndex = 0;
    const m = rule.re.exec(folded);
    if (!m) continue;
    const start = map[m.index] ?? 0;
    const end = map[m.index + m[0].length] ?? sample.length;
    const evidence = quoteAround(sample, start, end);
    if (rule.strength === 'strong') {
      return { isAgency: true, strength: 'strong', confidence: 0.85, evidence, ruleId: `agency.text.${rule.id}`, kind: 'description' };
    }
    weak ??= { isAgency: false, strength: 'weak', confidence: 0.5, evidence, ruleId: `agency.text.${rule.id}`, kind: 'description' };
  }
  return weak ?? NONE;
}

/** Name evidence first (it describes the company), then the posting text. */
export function detectAgency(input: { name: string; descriptionText?: string | null }): AgencyDetection {
  const byName = detectAgencyFromName(input.name);
  if (byName.isAgency) return byName;
  const key = coreCompanyTokens(input.name).join(' ');
  return detectAgencyFromText(input.descriptionText, key);
}
