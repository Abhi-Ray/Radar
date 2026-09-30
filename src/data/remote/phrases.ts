/**
 * Remote-eligibility phrase lists (spec §14): what a posting says about WHERE a remote role can be
 * done from, in EN, DE, FR, NL, ES, PT, IT, SV, DA/NO and PL.
 *
 * Patterns run against FOLDED text (lowercase, no diacritics, see `fold()` in
 * src/lib/normalize/text.ts), one sentence at a time. A literal space matches any whitespace run;
 * word boundaries are added by the compiler (src/lib/remote/classify.ts). Place captures:
 * - `{P}`: the rest of the sentence after the phrase. The classifier cuts it at the first clause
 *   break ("… and have", "… with", ", preferably …") and reads every known place in it.
 * - `{S}`: a short place right after the phrase ("Remote - Germany"): only the leading words
 *   that are all places are used.
 * - `{L}`: a list header ("Hiring in:"). The list may follow on the same line or as the next
 *   short lines / bullets.
 * Rules with `before: true` read the place from the words just BEFORE the match ("US only",
 * "Germany (Remote)", "US-Remote"); `codes` limits that to a known uppercase code.
 *
 * Rule kinds:
 * - `worldwide`: the role is open from anywhere ("work from anywhere", "any time zone").
 * - `region`: the role is limited to the captured places ("must be based in the EU").
 *   `vague: true` rules still count as a restriction when no known place is captured
 *   ("must be based in one of our hiring countries").
 * - `region_list`: a list header whose places are the allowed countries.
 * - `exclude`: the captured places are excluded ("we cannot hire in India").
 * - `remote_strong` / `remote_weak`: the role is remote / remote is mentioned without saying the
 *   role is fully remote ("remote-friendly", "remote work possible").
 * - `hybrid` / `onsite` (`strong: true` = the sentence defines the role's own setup).
 *
 * Rule ids are stable (they are stored with the evidence) — never renumber, only add.
 */
import type { Confidence } from '../../lib/contracts/provenance';

export const REMOTE_PHRASES_VERSION = 'remote-phrases@2026-09-30.1';

export type RemoteRuleKind =
  | 'worldwide'
  | 'region'
  | 'region_list'
  | 'exclude'
  | 'remote_strong'
  | 'remote_weak'
  | 'hybrid'
  | 'onsite';

export interface RemotePhraseRule {
  id: string;
  lang: string;
  kind: RemoteRuleKind;
  confidence: Confidence;
  pattern: string;
  /** Places implied by the phrase itself ("deutschlandweit" → DE). */
  places?: readonly string[];
  /** Region rule that counts as a restriction even when no known place is named. */
  vague?: boolean;
  /** Place is read from the words before the match. */
  before?: boolean;
  /** With `before`: only an allow-listed uppercase code directly before counts ("US-Remote"). */
  codes?: boolean;
  /** Workplace rule that states the role's own setup ("this role is hybrid"). */
  strong?: boolean;
}

type Extra = Pick<RemotePhraseRule, 'places' | 'vague' | 'before' | 'codes' | 'strong'>;

const r = (id: string, lang: string, kind: RemoteRuleKind, confidence: Confidence, pattern: string, extra: Extra = {}): RemotePhraseRule => ({
  id,
  lang,
  kind,
  confidence,
  pattern,
  ...extra,
});

// Shared English fragments (folded).
const MODAL =
  "(?:must|must currently|need to|needs to|have to|has to|should|required to|are required to|is required to|will need to|would need to|expected to|are expected to)";
const LIVE = '(?:based|located|living|resident|residing|reside|live|domiciled|situated|physically located|physically based)';
const WHO = '(?:candidates?|applicants?|you|employees?|hires?|talent|people|contractors?|team members?|individuals?|professionals?|engineers?)';
const HIRE_VERB = '(?:hire|employ|recruit|consider|accept|onboard|engage|pay)';
const NEG_AUX =
  "(?:cannot|can't|can not|are unable to|is unable to|unable to|are not able to|aren't able to|not able to|do not|don't|does not|doesn't|will not|won't|are not currently able to|currently cannot|unfortunately cannot|unfortunately can't|are not in a position to|no longer)";
const RTW = '(?:authori[sz]ed|eligible|permitted|entitled|legally able|legally allowed|legally authori[sz]ed|allowed)';

/** Uppercase codes accepted directly before "remote" ("US-Remote", "EU remote"). */
export const REMOTE_PREFIX_CODES: ReadonlySet<string> = new Set([
  'US', 'USA', 'UK', 'GB', 'EU', 'EEA', 'EMEA', 'APAC', 'APJ', 'LATAM', 'AMER', 'NORAM', 'NAMER', 'DACH', 'UKI', 'CEE', 'ANZ', 'MENA', 'GCC',
  'CA', 'MX', 'BR', 'DE', 'NL', 'FR', 'ES', 'PL', 'PT', 'SE', 'DK', 'FI', 'IE', 'AU', 'NZ', 'SG', 'JP', 'CH', 'CZ', 'RO', 'GR', 'BG', 'HU', 'LT', 'LV', 'EE',
]);

/**
 * Inflected place forms the gazetteer does not list (German genitive is handled in code by
 * stripping a trailing "s"). Keys are folded; values are ISO2 codes or macro-region keys.
 */
export const PLACE_FORM_ALIASES: Readonly<Record<string, string>> = {
  polsce: 'PL', niemczech: 'DE', europie: 'EUROPE', europy: 'EUROPE', 'unii europejskiej': 'EU', 'unia europejska': 'EU',
  czechach: 'CZ', hiszpanii: 'ES', holandii: 'NL', irlandii: 'IE', szwecji: 'SE', francji: 'FR', 'wielkiej brytanii': 'GB',
  indiach: 'IN', indii: 'IN', 'the world': 'WORLDWIDE', world: 'WORLDWIDE', globe: 'WORLDWIDE', 'the globe': 'WORLDWIDE',
  welt: 'WORLDWIDE', 'der welt': 'WORLDWIDE', monde: 'WORLDWIDE', 'le monde': 'WORLDWIDE', mundo: 'WORLDWIDE', 'el mundo': 'WORLDWIDE',
  mondo: 'WORLDWIDE', wereld: 'WORLDWIDE', 'de wereld': 'WORLDWIDE', varlden: 'WORLDWIDE', verden: 'WORLDWIDE', swiecie: 'WORLDWIDE',
};

/** Uppercase-only codes the gazetteer lacks ("UE" = EU in FR/ES/IT/PT). */
export const EXTRA_PLACE_CODES: Readonly<Record<string, string>> = { UE: 'EU', EWG: 'EU', EER: 'EEA', EOG: 'EEA' };

export const REMOTE_PHRASE_RULES: readonly RemotePhraseRule[] = [
  // ── Worldwide ────────────────────────────────────────────────────────────────────────────────
  r('en.ww.anywhere', 'en', 'worldwide', 'high', '(?:work|working|live and work|remote(?:ly)?|from) (?:remotely )?(?:from )?anywhere(?: in the world| on (?:the )?(?:earth|planet|globe))?'),
  r('en.ww.anywhere_world', 'en', 'worldwide', 'high', '(?:anywhere|everywhere|any ?where) (?:in|around|across) the (?:world|globe)'),
  r('en.ww.remote_global', 'en', 'worldwide', 'high', '(?:(?:fully|100 ?%|full) )?remote ?[(,:-]? ?(?:worldwide|global(?:ly)?|anywhere|international(?:ly)?)'),
  r('en.ww.global_remote', 'en', 'worldwide', 'high', '(?:worldwide|global(?:ly)?|internationally) (?:remote|distributed)'),
  r('en.ww.location_independent', 'en', 'worldwide', 'medium', 'location[ -]?(?:independent|agnostic|flexible)'),
  r('en.ww.regardless', 'en', 'worldwide', 'high', "(?:regardless|irrespective) of (?:your |where you(?:'re| are)? )?(?:location|country|where you (?:live|are|are based|reside)|geography|time ?zone|residence)"),
  r('en.ww.no_matter', 'en', 'worldwide', 'high', "no matter where (?:you|in the world you) (?:live|are|reside|are based|'re based|call home)"),
  r('en.ww.any_country', 'en', 'worldwide', 'high', '(?:from|in) any (?:country|location|place|corner of the world)'),
  r('en.ww.any_tz', 'en', 'worldwide', 'high', '(?:any|all|every) time ?zones?'),
  r('en.ww.hire_global', 'en', 'worldwide', 'high', '(?:we )?(?:hire|hiring|recruit|recruiting|employ) (?:talent |people |engineers )?(?:globally|worldwide|internationally|from anywhere|anywhere|across the (?:world|globe)|around the world|from all over the world)'),
  r('en.ww.open_anywhere', 'en', 'worldwide', 'high', '(?:open|available) to (?:candidates|applicants|people|talent|everyone|anyone) (?:from |located |based )?(?:anywhere|worldwide|globally|all over the world|around the world|in any country)'),
  r('en.ww.team_global', 'en', 'worldwide', 'low', '(?:team|people|colleagues|employees) (?:is |are )?(?:spread |distributed |located )?(?:across|around|all over) (?:the (?:world|globe)|\\d+ countries)'),
  r('de.ww.ueberall', 'de', 'worldwide', 'high', '(?:von|ab|aus) (?:uberall|ueberall)(?: (?:auf|in) der welt| aus)?'),
  r('de.ww.weltweit', 'de', 'worldwide', 'high', '(?:weltweit (?:remote|arbeiten|von uberall)|remote (?:aus|von|in) (?:der )?(?:ganzen )?welt|weltweit remote)'),
  r('de.ww.ortsunabhaengig', 'de', 'worldwide', 'low', 'ortsunabhangig\\w*'),
  r('fr.ww.nimporte', 'fr', 'worldwide', 'high', "(?:depuis|de|d') ?n'importe (?:ou|quel pays)|partout dans le monde|ou que vous soyez(?: dans le monde)?"),
  r('es.ww.cualquier', 'es', 'worldwide', 'high', 'desde cualquier (?:lugar|parte|pais)(?: del mundo)?|en cualquier parte del mundo|desde donde quieras'),
  r('pt.ww.qualquer', 'pt', 'worldwide', 'high', 'de qualquer (?:lugar|parte|pais)(?: do mundo)?|de onde (?:voce )?quiser'),
  r('it.ww.qualsiasi', 'it', 'worldwide', 'high', "da qualsiasi (?:luogo|parte|paese)(?: del mondo)?|ovunque (?:nel mondo|tu sia|ti trovi)"),
  r('nl.ww.overal', 'nl', 'worldwide', 'high', '(?:vanaf|van) (?:elke|iedere) (?:locatie|plek)(?: ter wereld)?|overal ter wereld|waar (?:je )?(?:ook )?ter wereld|waar je maar wilt'),
  r('sv.ww.varsomhelst', 'sv', 'worldwide', 'high', 'var som helst(?: i varlden)?|fran var du vill'),
  r('da.ww.hvorsomhelst', 'da', 'worldwide', 'high', 'hvor som helst(?: i verden)?|hvorfra du vil|hvor du vil i verden'),
  r('pl.ww.dowolnego', 'pl', 'worldwide', 'high', 'z dowolnego miejsca(?: na swiecie)?|z kazdego miejsca na swiecie'),

  // ── Region limits: English ───────────────────────────────────────────────────────────────────
  r('en.rg.must_be_based', 'en', 'region', 'high', `${MODAL} (?:currently )?(?:be )?${LIVE} (?:in|within|out of|inside) {P}`, { vague: true }),
  r('en.rg.who_based', 'en', 'region', 'high', `${WHO} (?:who are |that are |currently |already )?(?:must be |should be |need to be |are required to be |have to be )?(?:${LIVE}) (?:in|within|inside) {P}`, { vague: true }),
  r('en.rg.open_to', 'en', 'region', 'high', `(?:only |exclusively )?(?:open|available) (?:only |exclusively )?(?:to|for) ${WHO.replace('you|', '')}? ?(?:who are |that are |currently )?(?:${LIVE} )?(?:in|from|within) {P}`, { vague: true }),
  r('en.rg.only_hire', 'en', 'region', 'high', `(?:we )?(?:can |are able to |are only able to |currently )?only (?:${HIRE_VERB}) (?:${WHO} )?(?:who (?:are |live |reside )?)?(?:${LIVE} )?(?:in|from|within) {P}`, { vague: true }),
  r('en.rg.hiring_in', 'en', 'region', 'medium', '(?:we(?:\'re| are)? )?(?:only |currently |exclusively )?(?:hiring|recruiting) (?:only |exclusively )?(?:in|from|within) {P}'),
  r('en.rg.legal_entity', 'en', 'region', 'medium', '(?:legal |local )?entit(?:y|ies) (?:in|within) {P}'),
  r('en.rg.eor', 'en', 'region', 'medium', '(?:payroll|employer of record|eor) (?:in|within) {P}'),
  r('en.rg.authorized', 'en', 'region', 'high', `${RTW} to (?:legally )?(?:work|be employed|live and work) (?:in|within|for) {P}`),
  r('en.rg.right_to_work', 'en', 'region', 'high', '(?:right|authori[sz]ation|eligibility|permission|legal right) to (?:live and )?work (?:in|within|for) {P}'),
  r('en.rg.work_permit', 'en', 'region', 'high', 'work (?:authori[sz]ation|permit|visa|eligibility|rights) (?:in|for|within) {P}'),
  r('en.rg.remote_within', 'en', 'region', 'high', '(?:remote(?:ly)?|work from home|wfh|distributed) (?:work |role |position |job )?(?:within|in|from|across|throughout|inside|anywhere in|anywhere within) (?:the )?{P}'),
  r('en.rg.anywhere_in', 'en', 'region', 'high', '(?:anywhere|everywhere) (?:in|within|across|throughout|inside) (?:the )?{P}'),
  r('en.rg.only_in', 'en', 'region', 'high', '(?:only|exclusively) (?:in|within|from|for) (?:the )?{P}'),
  r('en.rg.residents_of', 'en', 'region', 'high', '(?:residents|citizens|nationals) of {P}'),
  r('en.rg.x_only', 'en', 'region', 'high', '(?:(?:-|based|residents?|citizens?|candidates?|applicants?|employees?|hires?|nationals?|people|talent|contractors?) )?only', { before: true }),
  r('en.rg.x_remote_paren', 'en', 'region', 'high', '[(\\[] ?(?:fully |100 ?% )?remote ?[)\\]]', { before: true }),
  r('en.rg.code_remote', 'en', 'region', 'high', 'remote', { before: true, codes: true }),
  r('en.rg.remote_paren', 'en', 'region', 'high', 'remote ?[(\\[] ?{S}'),
  r('en.rg.remote_dash', 'en', 'region', 'high', 'remote ?(?:-|:|\\||,|/) ?{S}'),
  r('en.rg.for_residents', 'en', 'region', 'high', 'for {S}(?:-| )(?:based )?(?:residents|citizens|candidates|applicants|nationals)'),
  r('en.rg.location_line', 'en', 'region_list', 'medium', '^(?:job |work |role |remote )?locations? ?: ?{L}'),
  r('en.rg.hiring_list', 'en', 'region_list', 'high', "(?:we(?:'re| are)? )?(?:currently )?(?:hiring|recruiting|able to hire|can hire|hire|employ|accepting applications) (?:in|from)(?: the following(?: countries| locations| regions)?)? ?: ?{L}"),
  r('en.rg.countries_list', 'en', 'region_list', 'high', '(?:eligible|supported|approved|hiring|open|available|accepted) (?:countries|locations|regions)(?: for this (?:role|position|job))? ?: ?{L}'),
  r('en.rg.we_hire_list', 'en', 'region_list', 'high', "(?:countries|locations|regions) (?:we (?:can |currently )?(?:hire|employ|recruit) (?:in|from)|where we (?:can )?(?:hire|employ)|we're hiring in|we are hiring in|open for this (?:role|position)|this role is open (?:to|in)) ?: ?{L}"),
  r('en.rg.open_in_list', 'en', 'region_list', 'high', '(?:this (?:role|position|job) is )?open (?:to candidates |to applicants )?in (?:the following|these|one of these|one of the following) (?:countries|locations|regions) ?: ?{L}'),

  // ── Region limits: other languages ───────────────────────────────────────────────────────────
  r('de.rg.wohnsitz', 'de', 'region', 'high', '(?:wohnsitz|wohnort|lebensmittelpunkt|hauptwohnsitz) (?:in|innerhalb) (?:von )?{P}', { vague: true }),
  r('de.rg.wohnhaft', 'de', 'region', 'high', '(?:wohnhaft|ansassig|ansaessig|sesshaft) (?:in|innerhalb) {P}', { vague: true }),
  r('de.rg.remote_aus', 'de', 'region', 'high', '(?:remote|mobil|mobiles arbeiten|homeoffice|home-office|home office|von zu hause) (?:aus|in|innerhalb|von|uberall in) (?:ganz )?{P}'),
  r('de.rg.erlaubnis', 'de', 'region', 'high', '(?:arbeitserlaubnis|arbeitsgenehmigung|aufenthaltstitel|arbeitsberechtigung|aufenthaltserlaubnis) (?:fur|in|fuer) {P}'),
  r('de.rg.nur_aus', 'de', 'region', 'high', '(?:nur|ausschliesslich|ausschlie\\w+) (?:bewerber\\w* |kandidat\\w* |personen )?(?:aus|in|mit wohnsitz in) {P}'),
  r('de.rg.deutschlandweit', 'de', 'region', 'high', '(?:remote|homeoffice|home-office|mobil\\w*|arbeiten)(?: [\\p{L}-]+){0,3} (?:deutschlandweit|bundesweit)|(?:deutschlandweit|bundesweit)(?: [\\p{L}-]+){0,2} (?:remote|homeoffice|home-office|mobil\\w*)', { places: ['DE'] }),
  r('de.rg.oesterreichweit', 'de', 'region', 'high', '(?:remote|homeoffice|home-office|mobil\\w*)(?: [\\p{L}-]+){0,3} (?:osterreichweit|oesterreichweit)|(?:osterreichweit|oesterreichweit)(?: [\\p{L}-]+){0,2} (?:remote|homeoffice|home-office)', { places: ['AT'] }),
  r('de.rg.schweizweit', 'de', 'region', 'high', '(?:remote|homeoffice|home-office|mobil\\w*)(?: [\\p{L}-]+){0,3} schweizweit|schweizweit(?: [\\p{L}-]+){0,2} (?:remote|homeoffice|home-office)', { places: ['CH'] }),
  r('de.rg.europaweit', 'de', 'region', 'high', '(?:remote|homeoffice|home-office|mobil\\w*)(?: [\\p{L}-]+){0,3} (?:europaweit|eu-weit)|(?:europaweit|eu-weit)(?: [\\p{L}-]+){0,2} (?:remote|homeoffice|home-office)', { places: ['EUROPE'] }),
  r('fr.rg.resider', 'fr', 'region', 'high', '(?:resider|residant|residante|residez|resident|residente|domicilie|domiciliee|base|basee|installe|installee|localise|localisee) (?:en|au|aux|dans|sur le territoire|sur) {P}', { vague: true }),
  r('fr.rg.teletravail', 'fr', 'region', 'high', '(?:teletravail|full remote|remote|a distance) (?:depuis|partout en|partout au|dans toute la|dans tout le|en|au) {P}'),
  r('fr.rg.autorise', 'fr', 'region', 'high', '(?:autorise|autorisee|habilite|habilitee) a travailler (?:en|au|aux|dans|sur) {P}|(?:permis|autorisation) de travail (?:en|au|aux|pour|valide en|valable en) {P}'),
  r('es.rg.residir', 'es', 'region', 'high', '(?:residir|resides|residente|residentes|residencia|ubicad[oa]s?|basad[oa]s?|vivir|radicad[oa]s?|afincad[oa]s?) en {P}', { vague: true }),
  r('es.rg.remoto', 'es', 'region', 'high', '(?:remoto|teletrabajo|en remoto|a distancia|trabajo remoto) (?:desde|en|dentro de|en todo|en toda) {P}'),
  r('es.rg.permiso', 'es', 'region', 'high', '(?:permiso|autorizacion) de trabajo (?:en|para|valido en|vigente en) {P}'),
  r('pt.rg.residir', 'pt', 'region', 'high', '(?:residir|resides|residente|residentes|residencia|baseado|baseada|morar|mora|localizado|localizada) (?:em|no|na|nos|nas) {P}', { vague: true }),
  r('pt.rg.remoto', 'pt', 'region', 'high', '(?:remoto|trabalho remoto|home office|teletrabalho) (?:de|a partir de|em|no|na|dentro d[eoa]) {P}'),
  r('it.rg.residenza', 'it', 'region', 'high', "(?:residente|residenti|residenza|domiciliat[oaie]|domicilio|basat[oaie]) (?:in|nel|nella|nei|negli|a|all'interno d\\w+) {P}", { vague: true }),
  r('it.rg.remoto', 'it', 'region', 'high', "(?:da remoto|in remoto|full remote|smart working) (?:da|dall'|dalla|in|nel|nella|dentro|all'interno d\\w+|su tutto il territorio d\\w*) ?{P}"),
  r('nl.rg.woonachtig', 'nl', 'region', 'high', '(?:woonachtig|wonend|woonplaats|gevestigd|gebaseerd|wonen) (?:in|binnen) {P}', { vague: true }),
  r('nl.rg.remote', 'nl', 'region', 'high', '(?:remote|thuis|op afstand|thuiswerken) (?:vanuit|binnen|overal in|in heel) {P}'),
  r('nl.rg.vergunning', 'nl', 'region', 'high', '(?:werkvergunning|verblijfsvergunning|tewerkstellingsvergunning) (?:voor|in) {P}'),
  r('sv.rg.bosatt', 'sv', 'region', 'high', '(?:bosatt|bosatta|baserad|baserade|folkbokford|folkbokforda) (?:i|inom) {P}', { vague: true }),
  r('sv.rg.distans', 'sv', 'region', 'high', '(?:pa distans|distansarbete|remote) (?:inom|i|fran) {P}'),
  r('da.rg.bosat', 'da', 'region', 'high', '(?:bosat|bosiddende|bosatt|bosted|baseret|basert) (?:i|inden for|innenfor) {P}', { vague: true }),
  r('da.rg.remote', 'da', 'region', 'high', '(?:hjemmefra|fjernarbejde|fjernarbeid|remote) (?:i|fra|inden for|innenfor) {P}'),
  r('pl.rg.mieszkac', 'pl', 'region', 'high', '(?:mieszkac|mieszkasz|zamieszkal\\w*|zamieszkuj\\w*|z siedziba|przebywa\\w*) (?:w|na terenie) {P}', { vague: true }),
  r('pl.rg.zdalnie', 'pl', 'region', 'high', '(?:zdalnie|praca zdalna|zdalna) (?:z|w|na terenie|z terenu) {P}'),

  // ── Exclusions ───────────────────────────────────────────────────────────────────────────────
  r('en.ex.cannot_hire', 'en', 'exclude', 'high', `${NEG_AUX} (?:currently |yet )?(?:${HIRE_VERB}|hiring|support hiring|support employment|accept applications|process applications|consider applications|sponsor employment) (?:${WHO} )?(?:who (?:are |live |reside )?)?(?:${LIVE} )?(?:in|from) {P}`),
  r('en.ex.not_open', 'en', 'exclude', 'high', `(?:not|isn't|is not|aren't|are not) (?:open|available) (?:to|for) (?:${WHO} )?(?:${LIVE} )?(?:in|from) {P}`),
  r('en.ex.no_entity', 'en', 'exclude', 'high', "(?:do not|don't|does not|doesn't) (?:currently )?have (?:a |an |any )?(?:legal |local )?(?:entity|entities|presence|payroll) in {P}"),
  r('en.ex.except', 'en', 'exclude', 'high', '(?:excluding|except(?: for)?|with the exception of|other than|apart from|but not(?: in)?|not including) (?:the )?{P}'),
  r('de.ex.ausser', 'de', 'exclude', 'high', '(?:ausser|auser|ausgenommen|mit ausnahme von) {P}'),
  r('fr.ex.sauf', 'fr', 'exclude', 'high', "(?:sauf|excepte|a l'exception de|hors) {P}"),
  r('es.ex.excepto', 'es', 'exclude', 'high', '(?:excepto|salvo|a excepcion de|menos) {P}'),

  // ── Workplace: remote ────────────────────────────────────────────────────────────────────────
  r('en.wp.fully_remote', 'en', 'remote_strong', 'high', '(?:fully|100 ?%|completely|entirely|totally|full|all|100 percent) (?:-|- )?remote'),
  r('en.wp.remote_only', 'en', 'remote_strong', 'high', 'remote[ -](?:only|native)'),
  r('en.wp.this_is_remote', 'en', 'remote_strong', 'high', "(?:this|the) (?:role|position|job|opportunity|vacancy) (?:is|will be|can be) (?:a )?(?:fully |100 ?% |completely |entirely )?(?:remote|remotely|done remotely|performed remotely|based remotely|home[ -]based)"),
  r('en.wp.remote_role', 'en', 'remote_strong', 'medium', '(?:is|as) a (?:fully )?remote (?:role|position|job|opportunity)|(?:remote|work from home|wfh|home[ -]based) (?:role|position|job|opportunity|contract)'),
  r('en.wp.work_remotely', 'en', 'remote_strong', 'medium', '(?:you(?:\'ll| will)?|you can|work|working) (?:fully |100 ?% )?remotely'),
  r('en.wp.distributed', 'en', 'remote_strong', 'medium', '(?:fully|100 ?%) distributed(?: team| company)?'),
  r('en.wp.remote_first', 'en', 'remote_weak', 'medium', 'remote[ -](?:first|friendly|flexible|possible|optional|option|available|ok|welcome)'),
  r('en.wp.remote_mention', 'en', 'remote_weak', 'low', 'remote(?:ly)?|work from home|wfh|telework\\w*|tele-?commut\\w*'),
  r('de.wp.voll_remote', 'de', 'remote_strong', 'high', '(?:komplett|vollstandig|voll|100 ?%|ausschliesslich|rein) (?:-|- )?(?:remote|im homeoffice|homeoffice|home-office|mobil|von zu hause)|full[ -]remote'),
  r('de.wp.remote_stelle', 'de', 'remote_strong', 'medium', 'remote[ -](?:stelle|position|job|tatigkeit)'),
  r('de.wp.homeoffice_moeglich', 'de', 'hybrid', 'medium', '(?:homeoffice|home-office|home office|mobiles arbeiten|mobile arbeit|remote)(?:-| )?(?:moglich\\w*|option\\w*|anteil\\w*|tage?n?|regelung\\w*|moglichkeit\\w*)|teilweise (?:remote|homeoffice|mobil)'),
  r('fr.wp.full_remote', 'fr', 'remote_strong', 'high', '(?:100 ?%|entierement|totalement|completement) (?:en )?(?:teletravail|remote|a distance)|teletravail (?:complet|total|a 100 ?%|integral)|full remote'),
  r('es.wp.remoto', 'es', 'remote_strong', 'high', '(?:100 ?%|totalmente|completamente) (?:en )?remoto|teletrabajo (?:total|100 ?%|completo)'),
  r('pt.wp.remoto', 'pt', 'remote_strong', 'high', '(?:100 ?%|totalmente|completamente) (?:em )?remoto|trabalho 100 ?% remoto'),
  r('it.wp.remoto', 'it', 'remote_strong', 'high', '(?:100 ?%|completamente|totalmente|interamente) (?:da |in )?remoto|full remote'),
  r('nl.wp.remote', 'nl', 'remote_strong', 'high', '(?:volledig|100 ?%|helemaal) (?:remote|thuis|op afstand|vanuit huis)'),
  r('sv.wp.distans', 'sv', 'remote_strong', 'high', 'helt pa distans|100 ?% (?:pa )?distans|helt remote'),
  r('da.wp.remote', 'da', 'remote_strong', 'high', '(?:fuldt|helt|100 ?%) (?:remote|hjemmefra|fjernarbejde|fjernarbeid)'),
  r('pl.wp.zdalna', 'pl', 'remote_strong', 'high', '(?:w pelni|calkowicie|100 ?%) zdaln\\w*|praca w pelni zdalna'),

  // ── Workplace: hybrid ────────────────────────────────────────────────────────────────────────
  r('en.wp.hybrid_role', 'en', 'hybrid', 'high', "(?:this|the) (?:role|position|job) (?:is|will be) (?:a )?hybrid|hybrid (?:role|position|job|working model|work model|model|setup|set-up|arrangement|schedule|working|work)", { strong: true }),
  r('en.wp.office_days', 'en', 'hybrid', 'high', '(?:[1-4]|one|two|three|four)(?: ?- ?[2-5])? (?:days?|x) (?:a |per |each |every )?(?:week )?(?:in|at|from) (?:the |our |an )?(?:office|hq|headquarters|studio|site)', { strong: true }),
  r('en.wp.hybrid', 'en', 'hybrid', 'medium', 'hybrid|partial(?:ly)? remote|partly remote|part[ -]remote|semi[ -]remote|mix of (?:remote|home) and office'),
  r('de.wp.hybrid', 'de', 'hybrid', 'high', '(?:[1-4]|ein|zwei|drei|vier) (?:tage?n?|x) (?:pro woche |die woche |wochentlich )?(?:im buro|im office|vor ort|am standort|in der firma)|hybrides? (?:arbeiten|arbeitsmodell|modell)', { strong: true }),
  r('fr.wp.hybrid', 'fr', 'hybrid', 'high', '(?:[1-4]|un|deux|trois|quatre) jours? (?:de teletravail|sur site|au bureau)|teletravail partiel|mode hybride|travail hybride', { strong: true }),
  r('es.wp.hybrid', 'es', 'hybrid', 'high', '(?:modelo|modalidad|trabajo|formato) (?:de trabajo )?hibrid[oa]|(?:[1-4]|uno|dos|tres|cuatro) dias? (?:en la oficina|presenciales?)', { strong: true }),
  r('nl.wp.hybrid', 'nl', 'hybrid', 'high', 'hybride (?:werken|werkvorm|model)|(?:[1-4]|een|twee|drie|vier) dagen? (?:op kantoor|op locatie)|thuiswerkdag\\w*', { strong: true }),
  r('it.wp.hybrid', 'it', 'hybrid', 'high', "(?:modalita|lavoro|modello) ibrid[oa]|(?:[1-4]|uno|due|tre|quattro) giorni? (?:in ufficio|in sede|in presenza)", { strong: true }),
  r('pl.wp.hybrid', 'pl', 'hybrid', 'high', 'prac\\w* hybrydow\\w*|model hybrydowy|hybrydow\\w*', { strong: true }),
  r('xx.wp.hybrid_word', 'xx', 'hybrid', 'medium', 'hybrid[eo]?|hibrid[oa]|ibrid[oa]|hybridi|hybridt'),

  // ── Workplace: on-site ───────────────────────────────────────────────────────────────────────
  r('en.wp.onsite_role', 'en', 'onsite', 'high', "(?:this|the) (?:role|position|job) (?:is|will be|requires (?:you to be|being)) (?:fully |100 ?% )?(?:on[ -]?site|in[ -](?:the[ -])?office|office[ -]based|in[ -]person|based (?:in|at|out of) (?:our|the) (?:office|hq|headquarters|site))|(?:on[ -]?site|in[ -]office|office[ -]based|in[ -]person) (?:role|position|job)(?! (?:visits?|meetings?|events?))", { strong: true }),
  r('en.wp.five_days', 'en', 'onsite', 'high', '(?:5|five|full[ -]time) (?:days? )?(?:a |per )?(?:week )?(?:in|at) (?:the |our )?office|fully (?:on[ -]?site|in[ -]office)|100 ?% (?:on[ -]?site|in[ -]office)', { strong: true }),
  r('en.wp.not_remote', 'en', 'onsite', 'high', "(?:this|the) (?:role|position|job) is not (?:a )?(?:fully )?remote|(?:no|not a) remote (?:work|role|position|option|possible)|(?:not|isn't) (?:a )?remote (?:role|position|job)|remote (?:work )?is not (?:possible|available|an option|offered)|no remote", { strong: true }),
  r('de.wp.vor_ort', 'de', 'onsite', 'high', '(?:kein|keine|nicht) (?:remote|homeoffice|home-office|mobiles arbeiten)(?: moglich)?|(?:100 ?%|ausschliesslich|vollzeit) vor ort|prasenzpflicht|anwesenheit vor ort', { strong: true }),
  r('fr.wp.presentiel', 'fr', 'onsite', 'high', "(?:100 ?% |entierement )?en presentiel|pas de teletravail|sur site (?:a|uniquement|exclusivement)", { strong: true }),
  r('es.wp.presencial', 'es', 'onsite', 'high', '(?:100 ?% |totalmente )?presencial|sin teletrabajo|no (?:es )?remoto', { strong: true }),
  r('nl.wp.kantoor', 'nl', 'onsite', 'high', '(?:volledig|100 ?%) op kantoor|geen thuiswerk\\w*|niet remote', { strong: true }),
  r('it.wp.presenza', 'it', 'onsite', 'high', '(?:100 ?% |interamente )?in presenza|non (?:e )?(?:da )?remoto', { strong: true }),
  r('en.wp.onsite', 'en', 'onsite', 'medium', 'on[ -]?site|in[ -]office|office[ -]based|in[ -]person|vor ort|sur site|presencial|op kantoor|op locatie|stacjonarn\\w*|na miejscu|pa kontoret|i kontoret|pa plats'),
];

/**
 * Worldwide phrases that are a perk, not the job's setup ("work from anywhere for 4 weeks a year").
 * Checked on the ~40 characters around the hit.
 */
export const PERK_CONTEXT_RE =
  /(?:\b\d{1,3}|\bone|\btwo|\bthree|\bfour|\bfive|\bsix|\beight|\bten)\s*(?:\+\s*)?(?:weeks?|days?|months?|wochen|tage|semaines|jours|semanas|dias|settimane|giorni|weken|dagen)\b|\b(?:policy|program|programme|allowance|stipend|budget|weeks|scheme|perk|benefit)\b/;

/** Words before a region hit that make it a non-restriction ("you don't need to be based in …"). */
export const REGION_NEGATORS: readonly string[] = [
  'no', 'not', 'never', "don't", 'dont', 'do not', "doesn't", 'does not', "needn't", 'no need', 'not required', 'not necessary', 'not necessarily',
  "isn't", 'is not', "aren't", 'are not', 'without', 'regardless', 'irrespective', 'nor', 'neither', 'kein', 'keine', 'nicht', 'ohne', 'pas', 'sans',
  'sin', 'niet', 'geen', 'zonder', 'non', 'senza', 'nie', 'inte', 'ikke', 'nao', 'yet',
];

/** Words before a region hit that make it conditional ("if you are based in …"). */
export const REGION_CONDITIONS: readonly string[] = [
  'if', 'whether', 'in case', 'unless', 'when', 'where possible', 'wenn', 'falls', 'sofern', 'ob', 'si', 'indien', 'mocht', 'jesli', 'jezeli', 'om du', 'hvis', 'jos',
  'preferably', 'ideally', 'bonus', 'nice to have', 'plus', 'vorzugsweise', 'idealerweise', 'de preference', 'preferiblemente', 'bij voorkeur', 'preferibilmente',
];

/** Words before a region hit that describe help, not a requirement ("we help you get the right to work in …"). */
export const REGION_SUPPORT_CUES: readonly string[] = [
  'help', 'helps', 'helping', 'support', 'supports', 'supporting', 'assist', 'assists', 'sponsor', 'sponsors', 'sponsoring', 'obtain', 'obtaining', 'get',
  'apply for', 'relocate', 'relocation', 'relocating', 'move', 'moving', 'unterstutzen', 'unterstutzung', 'helfen', 'aider', 'accompagner', 'accompagnons',
  'ayudamos', 'ayudar', 'apoyamos', 'ajudamos', 'aiutiamo', 'helpen', 'ondersteunen', 'hjalper', 'hjaelper', 'hjelper', 'pomagamy', 'offices', 'office', 'clients',
  'customers', 'teams', 'headquartered', 'hq', 'headquarters', 'founded', 'offices in',
];

/** Sentences that talk about working hours / time zones (the time-zone reader only runs on these). */
export const TZ_CUE_RE =
  /time ?zones?|timezones?|\btz\b|overlap|\b(?:uk|u\.k\.|us|u\.s\.|eu|emea|apac|latam|americas|european|american|asian|indian|british|pacific|eastern|central|mountain) (?:business |working |office )?(?:hours|time)\b|(?:business|working|office|core|work|local) hours|hours? (?:ahead|behind|difference)|±|\+\/-|\+\/−|\+-\s?\d|plus or minus|\butc\b|\bgmt\b|zeitzone\w*|arbeitszeit\w*|fuseaux? horaires?|heures? de bureau|zonas? horarias?|horario|tijdzone\w*|werktijden|fuso orario|fusi orari|orario|strefie czasowej|strefa czasow\w*|tidszon\w*|tidszone\w*/i;

/** Macro-region words in time-zone sentences ("European time zones") → UTC offset window (standard time). */
export const TZ_MACRO_WINDOWS: readonly { re: RegExp; label: string; lo: number; hi: number }[] = [
  { re: /\b(?:europe(?:an)?|eu|emea|european union|europa|europaisch\w*|europeen\w*|europe[oa]s?)\b/i, label: 'European time zones', lo: 0, hi: 3 },
  { re: /\b(?:uk|u\.k\.|british|britain)\b/i, label: 'UK time', lo: 0, hi: 1 },
  { re: /\b(?:us|u\.s\.|american|north american|usa|us-based|noram)\b/i, label: 'US time zones', lo: -10, hi: -3.5 },
  { re: /\b(?:americas|amer)\b/i, label: 'Americas time zones', lo: -10, hi: -3 },
  { re: /\b(?:latam|latin american?|south american?)\b/i, label: 'Latin American time zones', lo: -6, hi: -3 },
  { re: /\b(?:apac|asia[- ]pacific|asian?|asiatic)\b/i, label: 'APAC time zones', lo: 5, hi: 12 },
  { re: /\b(?:australian?|anz|oceania|new zealand)\b/i, label: 'Australia/NZ time zones', lo: 8, hi: 13 },
  { re: /\b(?:indian?|india standard)\b/i, label: 'Indian time', lo: 5.5, hi: 5.5 },
];
