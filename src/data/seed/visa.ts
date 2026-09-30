/**
 * Visa routes and their first rule versions (spec §13), researched 2026-09-30 by the build
 * assistant from the official pages listed on each route. NOTHING here is owner-verified: every
 * rule is imported as verification_status 'unverified' (last_verified_at NULL), so the app keeps
 * showing the "never verified" warning until the owner checks the page and marks it verified.
 *
 * Conventions:
 * - Thresholds are ANNUAL GROSS. Where a page states a monthly figure, it is annualised with the
 *   same payment count RADAR uses for salaries in that country (src/data/salary/installments.ts:
 *   NL 12.96 incl. the 8% holiday allowance, AT 14, others 12) so the comparison is like-for-like;
 *   the rule text states the published figure and the arithmetic. Fractions are rounded UP.
 * - Non-EUR thresholds are stored as salary_threshold_local + currency only (the EUR figure would be
 *   our own conversion, not an official number); eligibility converts at the job's FX rate.
 * - A figure that could not be confirmed on an official page on 2026-09-30 stays NULL, and the rule
 *   text says why (page blocked, 404, no general threshold, …).
 * - Structured checks (other_rules_json.minDegreeLevel / yearsInsteadOfDegree / minYearsExperience)
 *   are set only when the fetched official page states them; otherwise the requirement is text only
 *   (eligibility then treats it as "check", never as a definite yes/no).
 * - Job-independent routes (job-search cards, talent/points visas) carry no degree/experience/salary
 *   checks, so eligibility answers "can't tell" for them and never hides a job-based route.
 */

export const VISA_RESEARCH_DATE = '2026-09-30';
export const VISA_CHANGE_REASON = 'Initial research import 2026-09-30 — needs owner verification against the official page';

export type DegreeLevelKey = 'none' | 'bachelor' | 'master' | 'phd';

export interface SeedVisaRule {
  effectiveFrom: string;
  salaryThresholdEur: number | null;
  salaryThresholdLocal: number | null;
  currency: string | null;
  degreeRule: string | null;
  experienceRule: string | null;
  otherRulesJson: Record<string, unknown> | null;
  ruleText: string;
  officialSourceUrl: string;
}

export interface SeedVisaRoute {
  countryIso2: string;
  code: string;
  name: string;
  officialUrl: string;
  isActive: boolean;
  notes: string;
  /** Other official pages to watch for this route (legal texts, amounts tables). */
  watchUrls?: string[];
  rule: SeedVisaRule;
}

const MIG = 'https://www.make-it-in-germany.com/en/visa-residence/types';
const IND_AMOUNTS = 'https://ind.nl/en/required-amounts-income-requirements';
const IE_PERMITS = 'https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types';
const AIMA = 'https://aima.gov.pt/pt/trabalhar';

export const SEED_VISA_ROUTES: readonly SeedVisaRoute[] = [
  // ───────────────────────────── Germany ─────────────────────────────
  {
    countryIso2: 'DE',
    code: 'de_blue_card',
    name: 'EU Blue Card (Blaue Karte EU, §18g AufenthG)',
    officialUrl: `${MIG}/eu-blue-card`,
    isActive: true,
    notes: 'Main route for the target roles. ICT jobs (ISCO 25) are shortage occupations, so the reduced threshold applies with Federal Employment Agency approval. Degree must be recognised or comparable (anabin / ZAB).',
    watchUrls: [
      `${MIG}/it-specialists`,
      'https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/Migrationsrecht/BlaueKarteEU/blauekarteeu-node.html',
    ],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 45935,
      salaryThresholdLocal: 45935,
      currency: 'EUR',
      degreeRule: 'Recognised German or comparable foreign university degree (check anabin/ZAB). IT specialists without a degree: see the experience rule.',
      experienceRule: 'None with a degree. Without a degree, IT specialists qualify with at least 3 years of comparable IT experience within the last 7 years (at the reduced threshold).',
      otherRulesJson: {
        minDegreeLevel: 'bachelor',
        yearsInsteadOfDegree: 3,
        standardThresholdEur: 50700,
        reducedThresholdEur: 45934.2,
        reducedThresholdAppliesTo: 'shortage occupations incl. ICT professionals (ISCO 25), new entrants (degree within the last 3 years) and IT specialists without a degree — requires Federal Employment Agency approval',
        degreeRecognition: 'anabin H+ university and a degree listed as equivalent, or a ZAB Statement of Comparability',
        thresholdYear: 2026,
      },
      ruleText:
        'make-it-in-germany.com (2026-09-30): gross annual salary of at least €50,700 (as of 2026); €45,934.20 (as of 2026) for shortage occupations (incl. ICT) if the Federal Employment Agency approves, and for new entrants who graduated within the last three years. Stored threshold: €45,935 (reduced figure rounded up) because every target role is an ICT occupation — standard €50,700 kept in other_rules_json. The IT-specialists and BAMF pages were blocked by a bot check on 2026-09-30, so the without-degree rule (3 of the last 7 years) is from the Blue Card page summary and needs checking.',
      officialSourceUrl: `${MIG}/eu-blue-card`,
    },
  },
  {
    countryIso2: 'DE',
    code: 'de_skilled_18b',
    name: 'Skilled worker with academic training (§18b AufenthG)',
    officialUrl: `${MIG}/work-qualified-professionals`,
    isActive: true,
    notes: 'Fallback when the Blue Card salary is not reached: needs a recognised degree and a job that is appropriate for the qualification; no general salary threshold under 45 years of age.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Recognised German or comparable foreign university degree (anabin/ZAB); the job must be one a degree holder would normally do.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'Salary: NULL — no general minimum salary for applicants under 45 (pay must match comparable German employees); a separate minimum applies to first-time applicants aged 45+. The official page (make-it-in-germany.com/…/work-qualified-professionals) returned a bot-check page on every attempt on 2026-09-30, so neither the age-45 figure nor the details could be confirmed — owner to check.',
      officialSourceUrl: `${MIG}/work-qualified-professionals`,
    },
  },
  {
    countryIso2: 'DE',
    code: 'de_chancenkarte',
    name: 'Opportunity Card (Chancenkarte, §20a AufenthG) — job search',
    officialUrl: `${MIG}/job-search-opportunity-card`,
    isActive: true,
    notes: 'Job-independent: a residence permit to look for work (points system), with limited part-time work allowed. Useful before an offer exists; not tied to a posting.',
    rule: {
      effectiveFrom: '2024-06-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: {
        jobIndependent: 'Job-search permit: no job offer needed, so no per-job salary, degree or experience check applies.',
        summary: 'Recognised qualification counts directly; otherwise a points system (qualification, language, experience, age, previous stays) with proof of funds.',
      },
      ruleText:
        'Job-independent route — eligibility is not evaluated per job. Points threshold, proof-of-funds amount and part-time allowance NOT confirmed: the official page returned a bot-check page on 2026-09-30. Owner to check the official page before relying on it.',
      officialSourceUrl: `${MIG}/job-search-opportunity-card`,
    },
  },

  // ───────────────────────────── Netherlands ─────────────────────────────
  {
    countryIso2: 'NL',
    code: 'nl_hsm',
    name: 'Highly skilled migrant (kennismigrant), aged 30 or older',
    officialUrl: 'https://ind.nl/en/residence-permits/work/highly-skilled-migrant',
    isActive: true,
    notes: 'Employer must be an IND-recognised sponsor. No degree requirement; salary criterion depends on age. For applicants under 30 see nl_hsm_under_30.',
    watchUrls: [IND_AMOUNTS],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 77009,
      salaryThresholdLocal: 77009,
      currency: 'EUR',
      degreeRule: 'No degree requirement (salary-based route).',
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'none', minAge: 30, monthlyGrossExclHolidayAllowanceEur: 5942, annualExclHolidayAllowanceEur: 71304, recognisedSponsorRequired: true },
      ruleText:
        'IND required amounts (2026-09-30): highly skilled migrants 30 years or older €5,942.00 gross per month EXCLUDING the 8% holiday allowance. Stored annual threshold €77,009 = 5,942 × 12.96, matching how RADAR annualises Dutch salaries (holiday allowance included); without holiday allowance that is €71,304/yr. The reduced criterion (€3,122) applies only to graduates of Dutch or top-ranked universities and orientation-year holders — not applicable by default. Employer must be a recognised sponsor.',
      officialSourceUrl: IND_AMOUNTS,
    },
  },
  {
    countryIso2: 'NL',
    code: 'nl_hsm_under_30',
    name: 'Highly skilled migrant (kennismigrant), younger than 30',
    officialUrl: 'https://ind.nl/en/residence-permits/work/highly-skilled-migrant',
    isActive: true,
    notes: 'Same route as nl_hsm with the lower salary criterion for applicants younger than 30 at the time of application. RADAR does not know my age: only rely on this if I am under 30 when applying.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 56467,
      salaryThresholdLocal: 56467,
      currency: 'EUR',
      degreeRule: 'No degree requirement (salary-based route).',
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'none', maxAge: 29, monthlyGrossExclHolidayAllowanceEur: 4357, annualExclHolidayAllowanceEur: 52284, recognisedSponsorRequired: true },
      ruleText:
        'IND required amounts (2026-09-30): highly skilled migrants younger than 30 €4,357.00 gross per month EXCLUDING holiday allowance. Stored annual threshold €56,467 = 4,357 × 12.96 (RADAR annualises Dutch pay incl. holiday allowance); €52,284/yr without it. Only valid if I am under 30 on the application date — the eligibility check cannot test age.',
      officialSourceUrl: IND_AMOUNTS,
    },
  },
  {
    countryIso2: 'NL',
    code: 'nl_blue_card',
    name: 'European Blue Card (Netherlands)',
    officialUrl: 'https://ind.nl/en/residence-permits/work/european-blue-card',
    isActive: true,
    notes: 'Needs a higher-education degree and a 6-month+ contract; the employer does not have to be a recognised sponsor. The highly skilled migrant route is usually easier.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 77009,
      salaryThresholdLocal: 77009,
      currency: 'EUR',
      degreeRule: 'Higher-education degree (bachelor or higher) — from the EU Blue Card Directive; the IND Blue Card page did not load on 2026-09-30.',
      experienceRule: null,
      otherRulesJson: { monthlyGrossExclHolidayAllowanceEur: 5942, reducedMonthlyExclHolidayAllowanceEur: 4754, reducedAppliesTo: 'recent graduates (per IND) — conditions not confirmed' },
      ruleText:
        'IND required amounts (2026-09-30): European Blue Card €5,942.00 gross per month excluding holiday allowance; reduced criterion €4,754.00. Stored annual threshold €77,009 = 5,942 × 12.96 (holiday allowance included, as RADAR annualises Dutch pay); reduced: €61,612 incl. / €57,048 excl. The Blue Card page itself returned almost no content, so the degree and reduced-criterion conditions are unconfirmed.',
      officialSourceUrl: IND_AMOUNTS,
    },
  },

  // ───────────────────────────── Ireland ─────────────────────────────
  {
    countryIso2: 'IE',
    code: 'ie_csep',
    name: 'Critical Skills Employment Permit',
    officialUrl: `${IE_PERMITS}/critical-skills-employment-permit/`,
    isActive: true,
    notes: 'ICT professional roles are on the Critical Skills Occupations List. Leads to Stamp 4 after 2 years. Job offer must be for at least 2 years; permit fee €1,000.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 40904,
      salaryThresholdLocal: 40904,
      currency: 'EUR',
      degreeRule: 'For the €40,904 tier (Critical Skills Occupations List): a relevant degree qualification or higher is required.',
      experienceRule: null,
      otherRulesJson: {
        minDegreeLevel: 'bachelor',
        allOccupationsThresholdEur: 68911,
        recentGraduateThresholdEur: 36848,
        offerMinYears: 2,
        feeEur: 1000,
        occupationList: 'Critical Skills Occupations List (ICT professionals included — check the exact SOC code of the role)',
      },
      ruleText:
        'enterprise.gov.ie (2026-09-30): minimum annual remuneration €40,904 for occupations on the Critical Skills Occupations List (relevant degree or higher required); €36,848 when the qualification was obtained within the 12 months before applying; all other eligible occupations need over €68,911. Job offer of at least 2 years. Stored: €40,904 (CSOL tier, since the target roles are ICT).',
      officialSourceUrl: `${IE_PERMITS}/critical-skills-employment-permit/`,
    },
  },
  {
    countryIso2: 'IE',
    code: 'ie_gep',
    name: 'General Employment Permit',
    officialUrl: `${IE_PERMITS}/general-employment-permit/`,
    isActive: true,
    notes: 'Fallback when a role is not on the Critical Skills list: requires a Labour Market Needs Test unless pay is at least €68,911 or the role is on the CSOL. Fee €500 (up to 6 months) / €1,000.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 36605,
      salaryThresholdLocal: 36605,
      currency: 'EUR',
      degreeRule: null,
      experienceRule: 'Qualifications, skills or experience required for the employment (no fixed minimum stated).',
      otherRulesJson: { labourMarketNeedsTest: 'required unless pay ≥ €68,911 or the occupation is on the CSOL', lmntExemptThresholdEur: 68911, recentIrishGraduateThresholdEur: 34009 },
      ruleText:
        'enterprise.gov.ie (2026-09-30): minimum annual remuneration generally €36,605 (€34,009 for a relevant degree from an Irish third-level college in the previous 12 months; €32,691 for a few listed care/food roles). A Labour Market Needs Test is required in most cases, except for CSOL occupations or pay of at least €68,911.',
      officialSourceUrl: `${IE_PERMITS}/general-employment-permit/`,
    },
  },

  // ───────────────────────────── France ─────────────────────────────
  {
    countryIso2: 'FR',
    code: 'fr_talent_blue_card',
    name: 'Talent passport — EU Blue Card (Passeport talent – carte bleue européenne)',
    officialUrl: 'https://www.welcometofrance.com/en/fiche/talent-passport-eu-blue-card',
    isActive: true,
    notes: 'Contract of at least 6 months with an employer established in France. Multi-year permit up to 4 years; family accompanies.',
    watchUrls: ['https://www.service-public.fr/particuliers/vosdroits/F17359', 'https://france-visas.gouv.fr/en/web/france-visas/talent-passport'],
    rule: {
      effectiveFrom: '2025-08-31',
      salaryThresholdEur: 59373,
      salaryThresholdLocal: 59373,
      currency: 'EUR',
      degreeRule: 'Diploma equivalent to at least three years of higher education.',
      experienceRule: 'Or five years of professional experience at a comparable level (instead of the diploma).',
      otherRulesJson: { minDegreeLevel: 'bachelor', yearsInsteadOfDegree: 5, contractMinMonths: 6 },
      ruleText:
        'Welcome to France (official Business France portal, page verified May 11, 2026; read 2026-09-30): annual gross salary at least 1.5× the average annual gross reference salary, i.e. €59,373 as of August 31, 2025; diploma of 3+ years of higher education or 5 years of comparable experience; contract ≥ 6 months. The France-Visas talent page returned no content on 2026-09-30 — check whether the figure was updated for 2026.',
      officialSourceUrl: 'https://www.welcometofrance.com/en/fiche/talent-passport-eu-blue-card',
    },
  },

  // ───────────────────────────── Spain ─────────────────────────────
  {
    countryIso2: 'ES',
    code: 'es_hqp_blue_card',
    name: 'Highly qualified professional / EU Blue Card (Ley 14/2013, UGE)',
    officialUrl: 'https://www.inclusion.gob.es/web/unidadgrandesempresas/profesionales-altamente-cualificados',
    isActive: true,
    notes: 'Handled by the Unidad de Grandes Empresas y Colectivos Estratégicos (fast track, employer applies online).',
    watchUrls: ['https://www.inclusion.gob.es/web/unidadgrandesempresas/tarjeta-azul-ue', 'https://www.inclusion.gob.es/web/unidadgrandesempresas/autorizaciones-y-requisitos'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Higher-education degree for a highly qualified position.',
      experienceRule: 'Or at least 3 years of professional experience comparable to a degree (per the UGE page).',
      otherRulesJson: { minDegreeLevel: 'bachelor', yearsInsteadOfDegree: 3 },
      ruleText:
        'inclusion.gob.es UGE highly-qualified-professionals page (2026-09-30): degree, or ≥ 3 years of comparable experience. Salary: NULL — the pages read on 2026-09-30 state no amount (the Blue Card threshold is set by ministerial order and the tarjeta-azul-ue page returned no figures). Owner to confirm the current threshold.',
      officialSourceUrl: 'https://www.inclusion.gob.es/web/unidadgrandesempresas/profesionales-altamente-cualificados',
    },
  },

  // ───────────────────────────── Portugal ─────────────────────────────
  {
    countryIso2: 'PT',
    code: 'pt_hq_activity',
    name: 'Residence permit for highly qualified activity (Art. 90.º)',
    officialUrl: `${AIMA}/autorizacao-de-residencia-para-atividade-altamente-qualificada-art-90-o`,
    isActive: true,
    notes: 'National highly qualified route (AIMA). Salary criterion is a multiple of the national average salary (or of the IAS).',
    rule: {
      effectiveFrom: '2024-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Certificate of qualifications or document proving the specialisation.',
      experienceRule: null,
      otherRulesJson: {
        monthlyOptionAverageSalaryEur: 2157,
        monthlyOptionIasEur: '3 × IAS (≈ €1,527.78 with the 2024 IAS of €509.26)',
        shortageMonthlyEur: 1725.6,
        shortageMonthlyIasEur: 1018.52,
        referenceYears: 'average salary 2023, IAS 2024 (per AIMA)',
      },
      ruleText:
        'AIMA (2026-09-30): employment contract with a minimum salary of 1.5× the national average gross salary (€2,157.00/month) OR three times the IAS; for ISCO major groups 1–2 professions listed as in shortage, 1.2× (€1,725.60/month) or twice the IAS (€1,018.52/month). Reference values are from 2023 (average salary) and 2024 (IAS). Salary stored as NULL: the page offers alternative criteria and it is unclear which one AIMA applies, and the figures are dated — owner to confirm. Annualised with 14 payments, €2,157/month is €30,198/yr.',
      officialSourceUrl: `${AIMA}/autorizacao-de-residencia-para-atividade-altamente-qualificada-art-90-o`,
    },
  },
  {
    countryIso2: 'PT',
    code: 'pt_tech_visa',
    name: 'Tech Visa (highly qualified activity for an IAPMEI-certified company)',
    officialUrl: `${AIMA}/autorizacao-de-residencia-para-atividade-altamente-qualificada-exercida-para-empresa-certificada-art-90-o-tech-visa`,
    isActive: true,
    notes: 'Only for companies certified under the IAPMEI Tech Visa programme (the company issues a term of responsibility).',
    rule: {
      effectiveFrom: '2024-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Qualification at ISCED-2011 level 6 or higher (bachelor), or level 5 with exceptional specialised skills.',
      experienceRule: 'With an ISCED level 5 qualification: at least 5 years of experience.',
      otherRulesJson: { minDegreeLevel: 'bachelor', contractMinMonths: 12, salaryRule: '2.5 × IAS per month', certifiedCompanyRequired: 'IAPMEI Tech Visa certification', languages: 'Portuguese, English, French or Spanish adequate for the job' },
      ruleText:
        'AIMA (2026-09-30): minimum salary 2.5× the IAS (Indexante de Apoios Sociais); contract of at least 12 months; ISCED 6, or ISCED 5 plus 5 years of experience; company certified by IAPMEI. Salary stored as NULL because the page does not state the IAS year in force (with the 2024 IAS of €509.26 it would be €1,273.15/month) — owner to confirm the current IAS.',
      officialSourceUrl: `${AIMA}/autorizacao-de-residencia-para-atividade-altamente-qualificada-exercida-para-empresa-certificada-art-90-o-tech-visa`,
    },
  },
  {
    countryIso2: 'PT',
    code: 'pt_blue_card',
    name: 'EU Blue Card (Cartão Azul UE, Portugal)',
    officialUrl: 'https://aima.gov.pt/pt/viver/autorizacao-de-residencia/cartao-azul-ue',
    isActive: true,
    notes: 'EU Blue Card via AIMA. Details could not be read on 2026-09-30.',
    rule: {
      effectiveFrom: '2024-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Higher-education qualification (EU Blue Card Directive) — not confirmed on the AIMA page.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'The AIMA Cartão Azul UE page returned a not-found page on 2026-09-30, so no threshold or condition could be confirmed. Salary NULL until the owner checks the official page.',
      officialSourceUrl: 'https://aima.gov.pt/pt/viver/autorizacao-de-residencia/cartao-azul-ue',
    },
  },

  // ───────────────────────────── Belgium ─────────────────────────────
  {
    countryIso2: 'BE',
    code: 'be_single_permit_hq',
    name: 'Single permit — highly qualified worker / EU Blue Card',
    officialUrl: 'https://dofi.ibz.be/en/themes/third-country-nationals/work',
    isActive: true,
    notes: 'The region where the job is (Flanders, Wallonia, Brussels) decides the work part; salary thresholds differ by region and are indexed yearly.',
    watchUrls: ['https://economy-employment.brussels/highly-qualified-worker', 'https://dofi.ibz.be/en/themes/third-country-nationals/work/eu-blue-card'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Higher-education degree for highly qualified / Blue Card permits — not confirmed on the regional pages.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'Salary NULL: thresholds are set per region and indexed every year, and the Immigration Office (dofi.ibz.be) and Brussels pages returned almost no content on 2026-09-30. Owner to check the region of the job (VLAIO/Werk Flanders, Brussels Economy & Employment, SPW Wallonia).',
      officialSourceUrl: 'https://dofi.ibz.be/en/themes/third-country-nationals/work',
    },
  },

  // ───────────────────────────── Luxembourg ─────────────────────────────
  {
    countryIso2: 'LU',
    code: 'lu_blue_card',
    name: 'EU Blue Card — highly qualified worker (Luxembourg)',
    officialUrl: 'https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/hautement-qualifie.html',
    isActive: true,
    notes: 'Guichet.lu highly qualified worker route; an impatriate tax regime may apply.',
    watchUrls: ['https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/salarie/carte-bleue-europeenne.html'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Higher-education qualification, or equivalent professional experience for some ICT roles — not confirmed on the fetched page.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'Salary NULL: the Guichet.lu overview read on 2026-09-30 lists the sub-pages but not the threshold (set by Grand-Ducal regulation, updated yearly); the sub-page with the conditions was not readable. Owner to check the salaried-work sub-page.',
      officialSourceUrl: 'https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/hautement-qualifie.html',
    },
  },

  // ───────────────────────────── Austria ─────────────────────────────
  {
    countryIso2: 'AT',
    code: 'at_blue_card',
    name: 'EU Blue Card (Austria)',
    officialUrl: 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/eu-blue-card/',
    isActive: true,
    notes: 'Needs a binding job offer matching the education and a labour market test. Application fee €218.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 55678,
      salaryThresholdLocal: 55678,
      currency: 'EUR',
      degreeRule: 'Completed university (or tertiary) studies of at least three years.',
      experienceRule: 'ICT professionals: at least three years of relevant professional experience within the last seven years instead of the degree, if comparable to a three-year degree.',
      otherRulesJson: { minDegreeLevel: 'bachelor', yearsInsteadOfDegree: 3, labourMarketTest: true, feeEur: 218, salaryIncludesSpecialPayments: true },
      ruleText:
        'migration.gv.at (2026-09-30): at least the average gross annual income of full-time employees — in 2026 at least €55,678 (annual salary plus special payments); degree of 3+ years, or for ICT professionals 3 years of relevant experience within the last 7 years; labour market test (Arbeitsmarktprüfung).',
      officialSourceUrl: 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/eu-blue-card/',
    },
  },
  {
    countryIso2: 'AT',
    code: 'at_rwr_key_worker',
    name: 'Red-White-Red Card — other key workers',
    officialUrl: 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/other-key-workers/',
    isActive: true,
    notes: 'Points-based (55 of 90 points: qualification, experience, languages, age) plus a labour market test. Valid 24 months.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: 48510,
      salaryThresholdLocal: 48510,
      currency: 'EUR',
      degreeRule: 'Points for completed qualification (up to 30 points); no fixed degree requirement.',
      experienceRule: 'Points for work experience; minimum 55 points overall.',
      otherRulesJson: { minDegreeLevel: 'none', monthlyGrossEur: 3465, pointsRequired: 55, labourMarketTest: true },
      ruleText:
        'migration.gv.at (2026-09-30): employer pays at least the statutory minimum of €3,465 (2026) gross per month; no equally qualified jobseeker registered with AMS (labour market test); at least 55 points. Stored annual threshold €48,510 = 3,465 × 14 (Austria pays 14 monthly salaries; RADAR annualises Austrian pay ×14). Points are not checked by RADAR.',
      officialSourceUrl: 'https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/other-key-workers/',
    },
  },

  // ───────────────────────────── Italy ─────────────────────────────
  {
    countryIso2: 'IT',
    code: 'it_blue_card',
    name: 'EU Blue Card (Carta Blu UE, Italy)',
    officialUrl: 'https://www.integrazionemigranti.gov.it/en-gb/Ricerca-news/Dettaglio-news/id/3445/EU-Blue-Card',
    isActive: true,
    notes: 'Outside the decreto flussi quotas. Employer applies to the Sportello Unico per l’Immigrazione.',
    watchUrls: ['https://www.poliziadistato.it/articolo/carta-blu-ue'],
    rule: {
      effectiveFrom: '2024-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Higher-education qualification (at least 3 years) or, for some ICT roles, equivalent professional experience — not confirmed on the fetched pages.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'Salary NULL: the Integrazione Migranti news page and the Polizia di Stato page read on 2026-09-30 do not state the current annual threshold. Owner to confirm the figure in force.',
      officialSourceUrl: 'https://www.integrazionemigranti.gov.it/en-gb/Ricerca-news/Dettaglio-news/id/3445/EU-Blue-Card',
    },
  },

  // ───────────────────────────── United Kingdom ─────────────────────────────
  {
    countryIso2: 'GB',
    code: 'gb_skilled_worker',
    name: 'Skilled Worker visa',
    officialUrl: 'https://www.gov.uk/skilled-worker-visa/your-job',
    isActive: true,
    notes: 'Employer must hold a sponsor licence (check the register of licensed sponsors) and the occupation must be eligible. Salary: the higher of the general threshold and the going rate for the occupation code.',
    watchUrls: ['https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers'],
    rule: {
      effectiveFrom: '2025-07-22',
      salaryThresholdEur: null,
      salaryThresholdLocal: 41700,
      currency: 'GBP',
      degreeRule: 'No personal degree requirement; the job must be at the required skill level.',
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'none', lowerThresholdGbp: 33400, goingRateApplies: true, sponsorLicenceRequired: true },
      ruleText:
        'gov.uk (2026-09-30): minimum salary is the highest of £41,700 per year or the going rate for the occupation; it may be as low as £33,400 in listed cases (e.g. new entrant, PhD, immigration salary list). Stored: £41,700 (local currency; no official EUR figure). Effective date of the £41,700 figure (22 July 2025) is from background knowledge — the page does not state it; owner to confirm, and check the occupation’s going rate.',
      officialSourceUrl: 'https://www.gov.uk/skilled-worker-visa/your-job',
    },
  },
  {
    countryIso2: 'GB',
    code: 'gb_global_talent',
    name: 'Global Talent visa (digital technology)',
    officialUrl: 'https://www.gov.uk/global-talent',
    isActive: true,
    notes: 'Job-independent: needs an endorsement (digital technology) or a prestigious prize. No sponsor needed.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'GBP',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { jobIndependent: 'Endorsement-based visa: not tied to a job offer, so no per-job checks apply.', applicationFeeGbp: 766 },
      ruleText:
        'gov.uk (2026-09-30): for leaders or potential leaders in academia/research, arts and culture, or digital technology; requires an endorsement (or an eligible award). Application fee £766 (endorsement + visa stages). Job-independent — eligibility is not evaluated per job.',
      officialSourceUrl: 'https://www.gov.uk/global-talent',
    },
  },

  // ───────────────────────────── Nordics / Baltics ─────────────────────────────
  {
    countryIso2: 'SE',
    code: 'se_blue_card',
    name: 'EU Blue Card (Sweden)',
    officialUrl:
      'https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Employed/Special-rules-for-certain-occupations-and-citizens-of-certain-countries/EU-Blue-Card.html',
    isActive: true,
    notes: 'Employment of at least 6 months in a highly qualified job.',
    rule: {
      effectiveFrom: '2026-07-15',
      salaryThresholdEur: null,
      salaryThresholdLocal: 643500,
      currency: 'SEK',
      degreeRule: 'Higher education of at least 180 higher-education credits.',
      experienceRule: 'Alternatively at least five years of relevant professional experience.',
      otherRulesJson: { minDegreeLevel: 'bachelor', yearsInsteadOfDegree: 5, monthlyThresholdSek: 53625, contractMinMonths: 6 },
      ruleText:
        'Migrationsverket (2026-09-30): salary at least 1.25× the average Swedish gross salary; since 15 July 2026 SEK 53,625 per month. Stored annual SEK 643,500 = 53,625 × 12. Higher education of 180 credits or 5 years of relevant experience; highly qualified employment of at least 6 months.',
      officialSourceUrl:
        'https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Employed/Special-rules-for-certain-occupations-and-citizens-of-certain-countries/EU-Blue-Card.html',
    },
  },
  {
    countryIso2: 'SE',
    code: 'se_work_permit',
    name: 'Work permit (Sweden)',
    officialUrl: 'https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Employed/Work-permit-requirements.html',
    isActive: true,
    notes: 'General work permit: offer advertised in the EU, terms in line with collective agreements, insurance from the start.',
    rule: {
      effectiveFrom: '2026-06-16',
      salaryThresholdEur: null,
      salaryThresholdLocal: 413640,
      currency: 'SEK',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'none', monthlyThresholdSek: 34470, basis: '90% of the median salary (SEK 38,300 as of 16 June 2026)' },
      ruleText:
        'Migrationsverket (2026-09-30): as of 16 June 2026 the median salary is SEK 38,300, so the salary must be at least SEK 34,470 per month (90% of the median). Stored annual SEK 413,640 = 34,470 × 12. New rules for work permits came into effect on 1 June 2026 — owner to check other conditions.',
      officialSourceUrl: 'https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Employed/Work-permit-requirements.html',
    },
  },
  {
    countryIso2: 'DK',
    code: 'dk_pay_limit',
    name: 'Pay Limit Scheme (Denmark)',
    officialUrl: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme',
    isActive: true,
    notes: 'Salary-only scheme: no degree check. Processing fee DKK 6,810. Salary must be paid to a Danish bank account.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: 552000,
      currency: 'DKK',
      degreeRule: 'No degree requirement (salary-based scheme).',
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'none', supplementaryPayLimitDkk: 446000 },
      ruleText:
        'nyidanmark.dk (2026-09-30): job offer with a salary of DKK 552,000 or higher per year. SIRI announced (17-09-2026) updated income statistics for applications from 1 October 2026 — the figure may change; owner to re-check after 1 October.',
      officialSourceUrl: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme',
    },
  },
  {
    countryIso2: 'DK',
    code: 'dk_supplementary_pay_limit',
    name: 'Supplementary Pay Limit Scheme (Denmark)',
    officialUrl: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/The-Pay-Limit-Schemes/Supplementary-Pay-Limit-scheme',
    isActive: true,
    notes: 'Lower salary limit, only for positions the employer has advertised on Jobnet/EURES and when Danish unemployment is below a set level.',
    watchUrls: ['https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: 446000,
      currency: 'DKK',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'none' },
      ruleText:
        'nyidanmark.dk Pay Limit page (2026-09-30): with an annual salary of at least DKK 446,000 the company can choose to apply under the Supplementary Pay Limit Scheme. Its own page (this route’s URL, linked from the Pay Limit page) was not read — conditions such as the advertising requirement are from background knowledge; owner to check.',
      officialSourceUrl: 'https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme',
    },
  },
  {
    countryIso2: 'FI',
    code: 'fi_specialist',
    name: 'Residence permit for a specialist (Finland)',
    officialUrl: 'https://migri.fi/en/specialist',
    isActive: true,
    notes: 'Specialist permit (fast track available). Salary threshold is set by Migri and changes yearly.',
    watchUrls: ['https://migri.fi/en/eu-blue-card'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'EUR',
      degreeRule: 'Usually a higher-education degree — not confirmed on the fetched page.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'Salary NULL: the Migri specialist and EU Blue Card pages returned almost no content on 2026-09-30 (script-rendered). Owner to check the current monthly threshold on migri.fi.',
      officialSourceUrl: 'https://migri.fi/en/specialist',
    },
  },
  {
    countryIso2: 'NO',
    code: 'no_skilled_worker',
    name: 'Residence permit for skilled workers (Norway)',
    officialUrl: 'https://www.udi.no/en/want-to-apply/work-immigration/skilled-workers/',
    isActive: true,
    notes: 'Needs vocational or higher education relevant to the job and pay at the normal Norwegian level for the job.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'NOK',
      degreeRule: 'Higher education or vocational training relevant to the position — not confirmed on the fetched page.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText:
        'Salary NULL: pay must be at the normal Norwegian level for the occupation (tariff or normal pay), not a single figure; the UDI page returned almost no content on 2026-09-30. Owner to check.',
      officialSourceUrl: 'https://www.udi.no/en/want-to-apply/work-immigration/skilled-workers/',
    },
  },
  {
    countryIso2: 'EE',
    code: 'ee_employment',
    name: 'Temporary residence permit for employment (Estonia)',
    officialUrl: 'https://www.politsei.ee/en/instructions/residence-permit-for-employment',
    isActive: true,
    notes: 'Employer registered in Estonia; employer needs permission from the Unemployment Insurance Fund (Töötukassa) in the general case. Exceptions for top specialists, start-ups, IT.',
    rule: {
      effectiveFrom: '2026-03-05',
      salaryThresholdEur: 25104,
      salaryThresholdLocal: 25104,
      currency: 'EUR',
      degreeRule: 'Appropriate education for the job (no fixed level stated).',
      experienceRule: 'Appropriate work experience for the job (no fixed minimum stated).',
      otherRulesJson: { monthlyThresholdEur: 2092, basis: 'average gross salary in Estonia (general requirement, subject to exceptions)' },
      ruleText:
        'politsei.ee (2026-09-30): the employer pays at least the average gross salary in Estonia; for 05.03.2026 – March 2027 that is €2,092 per month. Stored annual €25,104 = 2,092 × 12. Employer must obtain a permit from the Unemployment Insurance Fund in the general case.',
      officialSourceUrl: 'https://www.politsei.ee/en/instructions/residence-permit-for-employment',
    },
  },

  // ───────────────────────────── Central Europe ─────────────────────────────
  {
    countryIso2: 'PL',
    code: 'pl_blue_card',
    name: 'EU Blue Card (Niebieska Karta UE, Poland)',
    officialUrl: 'https://www.gov.pl/web/udsc/niebieska-karta-ue',
    isActive: true,
    notes: 'Via the voivodeship office where the job is. Threshold announced yearly by ministerial notice.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'PLN',
      degreeRule: 'Higher-education qualification or equivalent professional experience — not confirmed on the official page.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText: 'Salary NULL: gov.pl timed out on 2026-09-30, so the current PLN threshold could not be confirmed. Owner to check.',
      officialSourceUrl: 'https://www.gov.pl/web/udsc/niebieska-karta-ue',
    },
  },
  {
    countryIso2: 'CZ',
    code: 'cz_blue_card',
    name: 'EU Blue Card (Czechia)',
    officialUrl: 'https://ipc.gov.cz/en/visa-and-residence-permit-types/third-country-nationals/long-term-residence/eu-blue-card/',
    isActive: true,
    notes: 'Ministry of the Interior (OAMP). The Employee Card is the alternative national route.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'CZK',
      degreeRule: 'Higher education or, for ICT, equivalent professional experience — not confirmed on the official page.',
      experienceRule: null,
      otherRulesJson: null,
      ruleText: 'Salary NULL: the IPC Blue Card page returned almost no content on 2026-09-30 (only the home page loaded). Owner to check the CZK threshold.',
      officialSourceUrl: 'https://ipc.gov.cz/en/visa-and-residence-permit-types/third-country-nationals/long-term-residence/eu-blue-card/',
    },
  },
  {
    countryIso2: 'CH',
    code: 'ch_non_eu_permit',
    name: 'Work permit for non-EU/EFTA nationals (Switzerland, B/L quota permits)',
    officialUrl: 'https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige.html',
    isActive: true,
    notes: 'Quota-based; the employer must show no suitable Swiss/EU/EFTA candidate exists and pay customary local wages. Cantonal authority + SEM approval.',
    watchUrls: ['https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige/verfahren_erwerbstaetigkeit.html'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'CHF',
      degreeRule: 'Highly qualified: essentially a degree from a university or institution of higher education.',
      experienceRule: 'Plus a number of years of professional work experience (no fixed number stated).',
      otherRulesJson: { minDegreeLevel: 'bachelor', priorityForSwissAndEuWorkers: true, quotas: true, customaryWages: true },
      ruleText:
        'SEM (2026-09-30): only highly qualified workers (managers, specialists, other skilled professionals) — essentially a university/higher-education degree plus several years of experience; employer must prove no suitable Swiss/EU/EFTA candidate; salary and terms must be customary for the region and sector. Salary NULL: there is no fixed threshold.',
      officialSourceUrl: 'https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige.html',
    },
  },

  // ───────────────────────────── Outside Europe ─────────────────────────────
  {
    countryIso2: 'CA',
    code: 'ca_global_talent_stream',
    name: 'Global Talent Stream (LMIA work permit)',
    officialUrl: 'https://www.canada.ca/en/employment-social-development/services/foreign-workers/global-talent.html',
    isActive: true,
    notes: 'Employer-led LMIA stream with 2-week processing for listed tech occupations (Category B) or referred companies (Category A); employer signs a Labour Market Benefits Plan.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'CAD',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { wageRule: 'at least the prevailing wage for the occupation and region (Job Bank)', lmiaRequired: true },
      ruleText: 'canada.ca (2026-09-30): Global Talent Stream of the Temporary Foreign Worker Program. Salary NULL: the wage must meet the prevailing wage for the occupation/region — no single threshold.',
      officialSourceUrl: 'https://www.canada.ca/en/employment-social-development/services/foreign-workers/global-talent.html',
    },
  },
  {
    countryIso2: 'CA',
    code: 'ca_express_entry',
    name: 'Express Entry (permanent residence)',
    officialUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html',
    isActive: true,
    notes: 'Job-independent: points-based (CRS) permanent residence; a job offer is not required. Language test and credential assessment (ECA) needed.',
    watchUrls: ['https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/eligibility.html'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'CAD',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { jobIndependent: 'Points-based permanent residence; not tied to a posting.' },
      ruleText: 'Job-independent route (canada.ca, 2026-09-30) — eligibility is not evaluated per job. Draw cut-offs change every round.',
      officialSourceUrl: 'https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html',
    },
  },
  {
    countryIso2: 'US',
    code: 'us_h1b',
    name: 'H-1B specialty occupation',
    officialUrl: 'https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations',
    isActive: true,
    notes: 'Annual cap with a registration lottery (employer registers in March). Treat as low-probability; L-1 after a year with a multinational is the more predictable path.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'USD',
      degreeRule: "Bachelor's degree or higher (or equivalent) in a specific specialty related to the job.",
      experienceRule: null,
      otherRulesJson: { minDegreeLevel: 'bachelor', lottery: true, wageRule: 'at least the actual or prevailing wage (Labor Condition Application)' },
      ruleText:
        'USCIS (2026-09-30): specialty occupation; Labor Condition Application with the prevailing wage — salary NULL (no single threshold). Alerts on the page: a $100,000 payment requirement for certain petitions was vacated by a district court on June 8, 2026 (stay denied by the First Circuit on July 24, 2026; DHS says it will collect if the order is lifted); a 9-11 Biometric Fee rule applies to covered employers from Sept 9, 2026.',
      officialSourceUrl: 'https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations',
    },
  },
  {
    countryIso2: 'AU',
    code: 'au_sid_482_core',
    name: 'Skills in Demand visa (subclass 482) — Core Skills stream',
    officialUrl: 'https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-482',
    isActive: true,
    notes: 'Employer-sponsored; occupation must be on the Core Skills Occupation List. Specialist Skills stream for pay at or above the SSIT.',
    watchUrls: ['https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/sponsoring-workers/nominating-a-position/salary-requirements'],
    rule: {
      effectiveFrom: '2026-07-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: 79423,
      currency: 'AUD',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { specialistSkillsThresholdAud: 146576, marketSalaryRule: 'the higher of the annual market salary rate and the threshold' },
      ruleText:
        'Home Affairs salary requirements (2026-09-30): Core Skills Income Threshold AUD 79,423 for nominations lodged 1 July 2026 – 30 June 2027 (Specialist Skills Income Threshold AUD 146,576). Pay must also meet the annual market salary rate. Work-experience requirement (commonly 1 year) not confirmed on the fetched page — not stored.',
      officialSourceUrl: 'https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/sponsoring-workers/nominating-a-position/salary-requirements',
    },
  },
  {
    countryIso2: 'SG',
    code: 'sg_employment_pass',
    name: 'Employment Pass (Singapore)',
    officialUrl: 'https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility',
    isActive: true,
    notes: 'Two stages: qualifying salary (rises with age) and the COMPASS points framework. Job must be advertised on MyCareersFuture first (with exceptions).',
    rule: {
      effectiveFrom: '2025-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: 67200,
      currency: 'SGD',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: {
        monthlyMinimumSgd: 5600,
        ageDependent: 'SGD 5,600 is the floor (age 23); rises progressively to SGD 10,700 at age 45+ — the real threshold for me is higher than the floor',
        financialServicesMonthlySgd: 6200,
        from2027MonthlySgd: 6000,
        compass: 'COMPASS points (salary, qualifications, diversity, local employment) — not checked by RADAR',
      },
      ruleText:
        'MOM (2026-09-30): current minimum qualifying salary SGD 5,600/month (all sectors except financial services), increasing with age up to SGD 10,700 at 45+; from 1 Jan 2027 for new applications SGD 6,000 (up to 11,500). Stored annual SGD 67,200 = 5,600 × 12 — the age-23 floor, so a "meets" is optimistic; also requires passing COMPASS.',
      officialSourceUrl: 'https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility',
    },
  },
  {
    countryIso2: 'JP',
    code: 'jp_engineer_specialist',
    name: 'Engineer / Specialist in Humanities / International Services',
    officialUrl: 'https://www.moj.go.jp/isa/applications/status/gijinkoku.html',
    isActive: true,
    notes: 'Standard work status for software/security engineers. Highly Skilled Professional (points) is a faster path to permanent residence.',
    watchUrls: ['https://www.isa.go.jp/en/publications/materials/newimmiact_3_index.html'],
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'JPY',
      degreeRule: 'University degree related to the work, or long practical experience — not confirmed on an official page.',
      experienceRule: null,
      otherRulesJson: { wageRule: 'equal to or more than a Japanese national doing comparable work' },
      ruleText:
        'Salary NULL: no fixed threshold (pay must be at least that of a Japanese national in comparable work). The ISA page fetched on 2026-09-30 redirected to the ISA home page, so the degree/experience conditions (degree, or 10 years of experience, background knowledge) are unconfirmed. The route URL (ISA, Japanese-language status page) answered 200 on 2026-09-30 but was not read — owner to check.',
      officialSourceUrl: 'https://www.moj.go.jp/isa/applications/status/gijinkoku.html',
    },
  },
  {
    countryIso2: 'AE',
    code: 'ae_work_permit',
    name: 'Employer-sponsored work permit and residence visa (UAE)',
    officialUrl: 'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/residence-visa-for-working-in-the-uae',
    isActive: true,
    notes: 'Employer obtains the MOHRE work permit and sponsors the residence visa. No general salary threshold.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'AED',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: null,
      ruleText: 'Salary NULL: no general threshold for the standard employment visa. The u.ae page timed out on 2026-09-30 — owner to check.',
      officialSourceUrl: 'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/residence-visa-for-working-in-the-uae',
    },
  },
  {
    countryIso2: 'AE',
    code: 'ae_golden_visa',
    name: 'Golden visa — skilled professionals (UAE)',
    officialUrl: 'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/golden-visa',
    isActive: true,
    notes: 'Long-term (5/10-year) residence without a sponsor. Categories include skilled professionals.',
    rule: {
      effectiveFrom: '2026-01-01',
      salaryThresholdEur: null,
      salaryThresholdLocal: null,
      currency: 'AED',
      degreeRule: null,
      experienceRule: null,
      otherRulesJson: { jobIndependent: 'Residence status not tied to one posting; not evaluated per job.' },
      ruleText:
        'u.ae (2026-09-30): 5- or 10-year renewable residence, no sponsor needed. The skilled-professional conditions (commonly reported as a bachelor’s degree and a monthly salary of AED 30,000) were in a table the fetch did not capture — NOT confirmed, so nothing is stored. Treated as job-independent.',
      officialSourceUrl: 'https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/golden-visa',
    },
  },
];
