/**
 * Salary wording across the posting languages (EN/DE/FR/NL/ES/IT/PT/PL/SV/DA/NO/FI/CS/HU/RO,
 * EL/HR/SL/SK/BG/ET/LV/LT for the Tier 2 job boards, JA/KO for the common pay words).
 * Everything here is a regex SOURCE fragment, matched case-insensitively with Unicode word
 * boundaries by the salary parser.
 */
import type { SalaryPeriod } from '../../lib/contracts/jobs';

/** Period words. Order matters only for readability; the parser picks the one nearest the amount. */
export const PERIOD_PATTERNS: Readonly<Record<SalaryPeriod, readonly string[]>> = {
  year: [
    'per year', 'per annum', 'a year', 'each year', 'yearly', 'annual(?:ly)?', 'annum', 'p\\.\\s?a\\.?', 'pa', '/\\s?(?:year|yr|y|annum|a)',
    'per jahr', 'pro jahr', 'im jahr', 'jährlich', 'jahres\\p{L}*', 'brutto\\s?/\\s?jahr', '/\\s?jahr', 'bruttojahres\\p{L}*',
    'par an', '/\\s?an', 'annuel(?:le)?s?', 'brut annuel', 'brut/an', 'par année',
    'al año', 'por año', 'anual(?:es)?', '/\\s?año', 'brutos? anuales?', 'brutos al año',
    "all'anno", "l'anno", 'annu[oiae]', 'annua lorda', 'lordi annui', 'ral', '/\\s?anno',
    'por ano', 'ao ano', 'anual', '/\\s?ano',
    'per jaar', 'jaarsalaris', 'bruto per jaar', 'jaarlijks', '/\\s?jaar', 'op jaarbasis',
    'per år', 'om året', 'i året', 'årslön', 'årsløn', 'årslønn', '/\\s?år', 'pr\\.? år',
    'rocznie', 'na rok', '/\\s?rok', 'w skali roku', 'brutto rocznie',
    'vuodessa', 'vuosipalkka', 'ročně', 'za rok', 'évi', 'évente', 'pe an', 'anual', '年収', '年俸', '연봉',
    'ετησίως', 'ετησιως', 'ετήσι(?:ος|ες|α|ο|ων)', 'ετησι(?:ος|ες|α|ο|ων)', 'το χρόνο', 'τον χρόνο', 'ανά έτος', 'ανα ετος', 'το έτος', '/\\s?έτος',
    'godišnje', 'godisnje', 'na godinu', 'po godini', 'letno', 'na leto', 'ročne', 'rocne', 'годишно', 'на година', '/\\s?год\\.?',
    'aastas', 'aastapalk', '/\\s?aasta', 'gadā', 'per metus', 'metinis', 'metinė',
  ],
  month: [
    'per month', 'a month', 'each month', 'monthly', '/\\s?(?:month|mo|mth|m)', 'p\\.?\\s?m\\.?', 'pcm', 'per calendar month',
    'pro monat', 'im monat', 'monatlich', 'monats\\p{L}*', 'bruttomonats\\p{L}*', '/\\s?monat', 'brutto\\s?/\\s?monat', 'mtl\\.?', 'p\\.\\s?m\\.',
    'par mois', '/\\s?mois', 'mensuel(?:le)?s?', 'brut mensuel', 'brut/mois',
    'al mes', 'por mes', 'mensual(?:es)?', '/\\s?mes', 'brutos? mensuales?',
    'al mese', 'mensil[ei]', '/\\s?mese', 'netti mensili', 'lordi mensili',
    'por mês', 'por mes', 'ao mês', 'mensa(?:l|is)', '/\\s?mês',
    'per maand', 'p/m', 'maandsalaris', 'bruto per maand', 'maandelijks', '/\\s?maand', 'pm',
    'per månad', 'i månaden', 'månadslön', '/\\s?mån', 'om måneden', 'pr\\.? måned', 'per måned', 'i måneden', 'månedsløn', 'månedslønn', '/\\s?md\\.?', '/\\s?mnd\\.?',
    'miesięcznie', 'mies\\.?', '/\\s?mies\\.?', '/\\s?msc\\.?', 'mc', '/\\s?m-c', 'na miesiąc', 'brutto miesięcznie', 'netto miesięcznie',
    'kuukaudessa', '/\\s?kk', 'kuukausipalkka', 'měsíčně', '/\\s?měs\\.?', 'za měsíc', 'havi', 'havonta', '/\\s?hó', 'pe lună', 'lunar', '月給', '월급',
    'το μήνα', 'τον μήνα', 'ανά μήνα', 'ανα μηνα', 'μηνιαίως', 'μηνιαιως', 'μηνιαί(?:ος|ες|α|ο|ων)', 'μηνιαι(?:ος|ες|α|ο|ων)', '/\\s?μήνα',
    'mjesečno', 'mjesecno', 'na mjesec', 'po mjesecu', '/\\s?mj\\.?', 'mesečno', 'mesecno', 'na mesec', 'mesačne', 'mesacne', 'za mesiac', '/\\s?mesiac', '/\\s?mes\\.?',
    'месечно', 'на месец', '/\\s?месец', '/\\s?мес\\.?', 'kuus(?=\\s*(?:$|[.,;:()/\\n]|bruto|neto))', 'kuupalk', '/\\s?kuu', 'mēnesī', 'menesi', '/\\s?mēn\\.?', 'per mėnesį', 'per menesi', '/\\s?mėn\\.?', 'mėnesinis',
  ],
  day: [
    'per day', 'a day', 'daily', 'day rate', 'daily rate', '/\\s?(?:day|d)', 'per diem rate',
    'pro tag', '/\\s?tag', 'tagessatz', 'tagesrate', 'par jour', '/\\s?jour', 'tjm', 'taux journalier',
    'por día', 'al día', '/\\s?día', 'al giorno', '/\\s?giorno', 'tariffa giornaliera', 'por dia', '/\\s?dia',
    'per dag', 'dagtarief', '/\\s?dag', 'om dagen', 'pr\\.? dag', 'dziennie', '/\\s?dzień', 'za dzień', 'za md', 'man-?days?', 'person-?days?', 'člověkoden', 'päivässä', 'na den', 'za den',
  ],
  hour: [
    'per hour', 'an hour', 'hourly', 'hourly rate', '/\\s?(?:hour|hr|h)', 'p\\.?\\s?h\\.?', 'per hr',
    'pro stunde', '/\\s?std\\.?', 'stundenlohn', 'stundensatz', 'die stunde',
    'par heure', '/\\s?heure', "de l'heure", 'taux horaire', 'por hora', '/\\s?hora', "all'ora", 'tariffa oraria', '/\\s?ora',
    'per uur', 'uurloon', 'uurtarief', 'p/u', '/\\s?uur', 'per timme', 'i timmen', 'timlön', '/\\s?tim', 'i timen', 'pr\\.? time', 'per time', 'timeløn', 'timelønn',
    'na godzinę', 'za godzinę', '/\\s?godz\\.?', 'godzinowo', 'stawka godzinowa', 'tunnissa', 'tuntipalkka', 'za hodinu', '/\\s?hod\\.?', 'óránként', 'pe oră',
    'την ώρα', 'ανά ώρα', 'ανα ωρα', '/\\s?ώρα', 'po satu', 'na sat', 'na uro', 'на час', 'tunnis', '/\\s?tund', 'stundā', 'per valandą', '/\\s?val\\.?',
  ],
};

/** Payments per year stated in the posting: "14 Gehälter", "13 mensilità", "(14x)". Group `n` = count. */
export const INSTALLMENT_PATTERNS: readonly string[] = [
  '(?<n>1[2-6])\\s*(?:x\\s*)?(?:monthly\\s+)?(?:salaries|salary payments|payments|instal(?:l)?ments|monthly salaries|gehälter|monatsgehälter|monatsgehältern|gehältern|monatslöhne|monatslöhnen|löhne|mensilità|mensualità|pagas|pagamentos|salários|prestações|mois de salaire|salaires|maandsalarissen|månadslöner|månedslønninger|pensji|platů|havi fizetés|μισθοί|μισθοι|μισθούς|μισθους|μισθών|μισθων|plaća|plaće|plač|platov|заплати)',
  '\\(\\s*(?<n>1[2-6])\\s*(?:x|×|mal)\\s*\\)',
  '\\(\\s*(?:x|×)\\s*(?<n>1[2-6])\\s*\\)',
  // "3.500 € x 14", "3.500 brutto x 14", "14 x 3.500 €": a multiplication written next to an amount.
  '(?<=\\d{3}|[€$£]|brutto|gross|netto|zł|kč|eur)\\s*(?:x|×)\\s*(?<n>1[2-6])(?![\\p{N}])',
  '(?<n>1[2-6])\\s*(?:x|×)\\s*(?:€\\s?)?\\d',
];

/** "13th month" style wording → at least 13 payments (14 when the 14th is named too). */
export const EXTRA_MONTH_13 = '13(?:th|\\.|ème|e|º|°)?\\s*(?:month(?:ly)?(?:\\s+salary)?|salary|monatsgehalt|monatslohn|gehalt|mois|mes|mese|mês|maand|månadslön|månedsløn|salário|salario)|tredicesima|treizième mois|dertiende maand|13\\.?\\s*gehalt|décimo terceiro|decimo terceiro';
export const EXTRA_MONTH_14 = '14(?:th|\\.|ème|e|º|°)?\\s*(?:month(?:ly)?(?:\\s+salary)?|salary|monatsgehalt|monatslohn|gehalt|mois|mes|mese|mês)|quattordicesima';

/** The Dutch 8% holiday allowance is already inside the quoted monthly amount. */
export const HOLIDAY_ALLOWANCE_INCLUDED = '(?:incl(?:\\.|usief)?|including|inclusive of|inkl\\.?)\\s+(?:8\\s?%\\s+)?(?:vakantiegeld|vakantietoeslag|holiday allowance|holiday pay)';

export const GROSS_PATTERNS: readonly string[] = [
  'gross', 'brutto', 'bruto', 'bruta', 'brutos', 'brutas', 'brut', 'brute', 'bruts', 'lord[oaie]', 'ral', 'bruttó', 'före skatt', 'før skat', 'før skatt',
  'before tax(?:es)?', 'pre[- ]tax', 'hrub(?:á|ého|ý|é)', 'brutt?olön', 'bruttoløn', 'bruttolønn', 'bruttopalkka',
  'μικτ(?:ά|ές|ός|ό|ή)', 'μεικτ(?:ά|ές|ός|ό|ή)', 'μικτ(?:α|ες|ος|ο|η)', 'μεικτ(?:α|ες|ος|ο|η)', 'бруто', 'brutopalk', 'neatskaičius mokesčių',
];
export const NET_PATTERNS: readonly string[] = [
  'net', 'netto', 'neto', 'neta', 'netos', 'netas', 'nette', 'nets', 'nett', 'netti', 'nettó', 'after tax(?:es)?', 'take[- ]home', 'in hand', 'na rękę',
  'čist(?:á|ého|ý|é)', 'efter skatt', 'efter skat', 'etter skatt', 'nettopalkka',
  'καθαρ(?:ά|ές|ός|ό|ή)', 'καθαρ(?:α|ες|ος|ο|η)', 'нето', 'netopalk', 'į rankas', 'i rankas',
];
/** Polish/Czech B2B invoices are quoted "netto" = before VAT, not after income tax. */
export const B2B_PATTERNS: readonly string[] = ['b2b', '\\+\\s?vat', 'plus vat', 'faktura', 'fakturze', 'na fakturę', 'invoice', 'ičo', 'živnost', 'freelance', 'contractor rate', 'self-employed', 'auto-?entrepreneur', 'freiberuflich'];
export const EMPLOYMENT_CONTRACT_PATTERNS: readonly string[] = ['uop', 'umowa o pracę', 'umowie o pracę', 'employment contract', 'permanent', 'festanstellung', 'cdi', 'hpp', 'pracovní smlouva', 'contrato indefinido', 'tempo indeterminato', 'vast contract'];

/** Words that make a nearby amount a salary. */
export const SALARY_KEYWORDS: readonly string[] = [
  'salary', 'salaries', 'compensation', 'pay', 'pay range', 'pay band', 'base', 'base pay', 'remuneration', 'wage', 'wages', 'rate', 'day rate', 'package', 'ote', 'earnings', 'earn', 'stipend', 'income', 'paid',
  'gehalt', 'gehälter', 'jahresgehalt', 'bruttojahresgehalt', 'jahresbruttogehalt', 'monatsgehalt', 'vergütung', 'verguetung', 'entgelt', 'lohn', 'einstiegsgehalt', 'gehaltsrahmen', 'gehaltsspanne', 'gehaltsband', 'mindestgehalt', 'grundgehalt', 'zielgehalt', 'bezahlung', 'kv', 'überzahlung',
  'salaire', 'rémunération', 'remuneration', 'rémunéré', 'fourchette', 'package salarial', 'tjm',
  'salario', 'sueldo', 'retribución', 'remuneración', 'banda salarial', 'rango salarial', 'ral', 'retribuzione', 'stipendio', 'compenso', 'range retributiva',
  'salário', 'remuneração', 'vencimento', 'faixa salarial', 'salaris', 'loon', 'beloning', 'bruto maandsalaris', 'salarisindicatie', 'salarisschaal',
  'lön', 'lön:', 'løn', 'lønn', 'månadslön', 'lönespann', 'wynagrodzenie', 'stawka', 'pensja', 'widełki', 'widełki płacowe', 'palkka', 'palkkaus', 'mzda', 'plat', 'odměna', 'fizetés', 'bér', 'salariu', '年収', '年俸', '月給', '給与', '연봉', '월급',
  'μισθός', 'μισθος', 'μισθοί', 'μισθοι', 'αποδοχές', 'αποδοχες', 'αμοιβή', 'αμοιβη', 'plaća', 'placa', 'plača', 'primanja', 'odmena', 'odmeňovanie', 'заплата', 'възнаграждение', 'заплащане',
  'palk', 'palga', 'palgavahemik', 'töötasu', 'alga', 'atalgojums', 'atalgojuma', 'atlyginimas', 'atlyginimo', 'darbo užmokestis',
];

/** Amounts near these are budgets, funding, bonuses or benefits, not pay. */
export const NON_SALARY_CONTEXT: readonly string[] = [
  'funding', 'raised', 'raise[ds]?', 'series [a-f]', 'seed round', 'revenue', 'revenues', 'turnover', 'umsatz', 'chiffre d.affaires', 'facturación', 'fatturato', 'omzet', 'omsättning', 'obroty', 'przychody',
  'valuation', 'bewertung', 'investment', 'investors?', 'capital', 'kapital', 'budget', 'weiterbildungsbudget', 'trainingsbudget', 'learning budget', 'education budget', 'home office budget',
  'equipment budget', 'budżet', 'signing bonus', 'sign-on bonus', 'referral bonus', 'relocation', 'umzug\\p{L}*', 'allowance', 'zuschuss', 'zuschüsse', 'subsidy', 'subvention', 'voucher', 'gutschein\\p{L}*',
  'jobticket', 'deutschlandticket', 'jobrad', 'bike leasing', 'gym', 'fitness', 'urban sports', 'wellpass', 'meal', 'lunch', 'essens\\p{L}*', 'tickets? restaurant', 'chèques?', 'mutuelle', 'pension', 'insurance',
  'versicherung', 'reimburse\\p{L}*', 'erstattung', 'rent', 'miete', 'price', 'preis', 'prix', 'precio', 'cost', 'costs', 'kosten', 'fee', 'fees', 'gebühr\\p{L}*', 'donat\\p{L}*', 'spende\\p{L}*',
  'prize', 'award', 'hackathon', 'portfolio', 'aum', 'assets under management', 'deal size', 'quota', 'worth', 'projects? worth', 'customers', 'users', 'clients', 'kunden', 'employees', 'mitarbeiter\\p{L}*',
  'per employee', 'pro mitarbeiter', 'penalty', 'bußgeld', 'grant', 'stipendium', 'scholarship', 'rabatt', 'discount', 'sachbezug', 'benefit\\p{L}*', 'budget of',
  'bonus', 'bonuses', 'annual bonus', 'yearly bonus', 'jahresbonus', 'prämie\\p{L}*', 'bonus annuel', 'prime', 'primes', 'premio', 'premi', 'prémio', 'bonificación',
  'equity', 'stock', 'stocks', 'rsus?', 'shares', 'stock options', 'options', 'aktien', 'esop', 'vsop',
];

/** Before an amount: "up to €80k" → max only. */
export const OPEN_MAX_PATTERNS: readonly string[] = [
  'up to', 'upto', 'max\\.?', 'maximum', 'bis zu', 'bis', 'höchstens', 'maximal', "jusqu'à", "jusqu'a", 'hasta', 'fino a', 'até', 'tot', 'tot maximaal', 'upp till', 'op til', 'opp til', 'do', 'maksymalnie', 'maks\\.?', 'enintään', 'až',
  'έως', 'εως', 'μέχρι', 'μεχρι', 'до', 'kuni', 'līdz', 'iki',
];
/** Before an amount: "from €60k", "ab 60.000 €", "Mindestgehalt € 3.500" → min only. */
export const OPEN_MIN_PATTERNS: readonly string[] = [
  'from', 'starting (?:at|from)', 'starts at', 'min\\.?', 'minimum', 'at least', 'no less than', 'ab', 'mindestens', 'mindestgehalt(?:\\s+[\\p{L}.]+){0,5}?\\s*(?:(?:beträgt|von|liegt bei|in höhe von|of|:)\\s*)?(?:brutto\\s*)?',
  'à partir de', 'dès', 'a partir de', 'desde', 'a partire da', 'da', 'vanaf', 'minimaal', 'från', 'fra', 'od', 'minimalnie', 'alkaen', 'vähintään', 'nejméně', 'minimálně',
  'από', 'απο', 'от', 'alates', 'nuo',
];
