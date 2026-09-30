# Country rules — visa routes and thresholds

> **Status: UNVERIFIED research import, 2026-09-30.** Everything below was collected by the build assistant from the official pages linked on each route. **None of it has been checked by the owner.** Every rule version is stored with `verification_status = 'unverified'`, `last_verified_at = NULL` and the change reason _"Initial research import 2026-09-30 — needs owner verification against the official page"_, so the app shows the "never verified" warning on every job in these countries until the owner verifies the rule (Countries page → the country → check the official page → "Mark verified today").

Source of truth: `src/data/seed/visa.ts` (routes and rules) and `src/data/seed/countries.ts` (country guides). This file is generated from the same data; if they disagree, the seed data wins and this file should be regenerated.

## How the seed treats these rules

- `npm run db:seed` inserts each route and **one** rule version for it. It never edits a rule version in place (spec §13.1: rules are versioned, every change is logged).
- If the research data changes later and the route still has only unverified seed-imported versions, the seed adds a **new** unverified version with the reason _"Research import update (seed data changed) — needs owner verification against the official page"_.
- Once the owner verifies a version or adds one by hand, the seed **never touches that route's rules again**. Routes the owner edits or deletes are also left alone.
- Every official page listed below is registered as an official page watch. The page-watch routine flags "page changed, please review"; it never rewrites a rule by itself.
- Thresholds are **annual gross**. Monthly figures were annualised with the payment count RADAR uses for salaries in that country (NL 12.96 incl. 8 % holiday allowance, AT 14, others 12); fractions are rounded up. Non-EUR thresholds are stored in the local currency only, never as our own EUR conversion.
- A figure the assistant could not confirm on an official page is left empty (NULL), and the rule text says why. Eligibility then answers "Can't tell" rather than guessing.
- A country only goes live when its rules are verified **and** its sources pass the source checklist (spec §4, §7.4). The seed never sets `is_live`.

## What the owner must check for every route

1. Open the official page(s) listed for the route.
2. Compare the salary threshold (amount, currency, year, monthly vs annual), the degree rule and the experience rule with the stored values.
3. If something differs, add a new rule version with the correct values and a reason (never edit the old one), then mark the new one verified.
4. If everything matches, mark the version verified. The next review is due 90 days later (stale warning after that).

## Summary

| Country | Tier | Routes seeded | Stored thresholds |
|---|---|---|---|
| DE — Germany | 1 | `de_blue_card`, `de_skilled_18b`, `de_chancenkarte` | de_blue_card: €45,935 / yr; de_skilled_18b: none stored; de_chancenkarte: none stored |
| NL — Netherlands | 1 | `nl_hsm`, `nl_hsm_under_30`, `nl_blue_card` | nl_hsm: €77,009 / yr; nl_hsm_under_30: €56,467 / yr; nl_blue_card: €77,009 / yr |
| IE — Ireland | 1 | `ie_csep`, `ie_gep` | ie_csep: €40,904 / yr; ie_gep: €36,605 / yr |
| FR — France | 1 | `fr_talent_blue_card` | fr_talent_blue_card: €59,373 / yr |
| ES — Spain | 1 | `es_hqp_blue_card` | es_hqp_blue_card: none stored |
| PT — Portugal | 1 | `pt_hq_activity`, `pt_tech_visa`, `pt_blue_card` | pt_hq_activity: none stored; pt_tech_visa: none stored; pt_blue_card: none stored |
| BE — Belgium | 1 | `be_single_permit_hq` | be_single_permit_hq: none stored |
| LU — Luxembourg | 1 | `lu_blue_card` | lu_blue_card: none stored |
| AT — Austria | 1 | `at_blue_card`, `at_rwr_key_worker` | at_blue_card: €55,678 / yr; at_rwr_key_worker: €48,510 / yr |
| IT — Italy | 1 | `it_blue_card` | it_blue_card: none stored |
| DK — Denmark | 2 | `dk_pay_limit`, `dk_supplementary_pay_limit` | dk_pay_limit: 552,000 DKK / yr; dk_supplementary_pay_limit: 446,000 DKK / yr |
| SE — Sweden | 2 | `se_blue_card`, `se_work_permit` | se_blue_card: 643,500 SEK / yr; se_work_permit: 413,640 SEK / yr |
| FI — Finland | 2 | `fi_specialist` | fi_specialist: none stored |
| NO — Norway | 2 | `no_skilled_worker` | no_skilled_worker: none stored |
| EE — Estonia | 2 | `ee_employment` | ee_employment: €25,104 / yr |
| LT — Lithuania | 2 | — | — |
| LV — Latvia | 2 | — | — |
| CZ — Czechia | 2 | `cz_blue_card` | cz_blue_card: none stored |
| PL — Poland | 2 | `pl_blue_card` | pl_blue_card: none stored |
| SI — Slovenia | 2 | — | — |
| MT — Malta | 2 | — | — |
| RO — Romania | 2 | — | — |
| HU — Hungary | 2 | — | — |
| HR — Croatia | 2 | — | — |
| SK — Slovakia | 2 | — | — |
| BG — Bulgaria | 2 | — | — |
| GR — Greece | 2 | — | — |
| CY — Cyprus | 2 | — | — |
| GB — United Kingdom | 3 | `gb_skilled_worker`, `gb_global_talent` | gb_skilled_worker: 41,700 GBP / yr; gb_global_talent: none stored |
| CH — Switzerland | 3 | `ch_non_eu_permit` | ch_non_eu_permit: none stored |
| CA — Canada | 3 | `ca_global_talent_stream`, `ca_express_entry` | ca_global_talent_stream: none stored; ca_express_entry: none stored |
| US — United States | 3 | `us_h1b` | us_h1b: none stored |
| AU — Australia | 3 | `au_sid_482_core` | au_sid_482_core: 79,423 AUD / yr |
| NZ — New Zealand | 3 | — | — |
| SG — Singapore | 3 | `sg_employment_pass` | sg_employment_pass: 67,200 SGD / yr |
| JP — Japan | 3 | `jp_engineer_specialist` | jp_engineer_specialist: none stored |
| KR — South Korea | 3 | — | — |
| AE — United Arab Emirates | 3 | `ae_work_permit`, `ae_golden_visa` | ae_work_permit: none stored; ae_golden_visa: none stored |
| IL — Israel | 3 | — | — |
| HK — Hong Kong | 3 | — | — |
| IS — Iceland | 3 | — | — |
| SA — Saudi Arabia | 4 | — | — |
| QA — Qatar | 4 | — | — |
| TW — Taiwan | 4 | — | — |
| MY — Malaysia | 4 | — | — |
| BR — Brazil | 4 | — | — |
| MX — Mexico | 4 | — | — |
| XW — Remote / Worldwide | 0 | — | — |

38 routes in 25 countries; 48 countries in total (including the remote pseudo-country `XW`).

## Tier 1 — EU core

### DE — Germany

Largest EU tech market (Berlin, Munich, Hamburg, Frankfurt). Non-EU routes: EU Blue Card (reduced threshold for ICT/shortage occupations and new entrants), §18g Blue Card for IT specialists without a degree (3 of the last 7 years in IT), §18b skilled worker with a recognised degree, and the Chancenkarte job-search card. Degree recognition: check anabin (KMK) for the university/degree.

#### EU Blue Card (Blaue Karte EU, §18g AufenthG) (`de_blue_card`)

- **Why it matters:** Main route for the target roles. ICT jobs (ISCO 25) are shortage occupations, so the reduced threshold applies with Federal Employment Agency approval. Degree must be recognised or comparable (anabin / ZAB).
- **Stored threshold:** €45,935 / yr
- **Degree rule:** Recognised German or comparable foreign university degree (check anabin/ZAB). IT specialists without a degree: see the experience rule.
- **Experience rule:** None with a degree. Without a degree, IT specialists qualify with at least 3 years of comparable IT experience within the last 7 years (at the reduced threshold).
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","yearsInsteadOfDegree":3,"standardThresholdEur":50700,"reducedThresholdEur":45934.2,"reducedThresholdAppliesTo":"shortage occupations incl. ICT professionals (ISCO 25), new entrants (degree within the last 3 years) and IT specialists without a degree — requires Federal Employment Agency approval","degreeRecognition":"anabin H+ university and a degree listed as equivalent, or a ZAB Statement of Comparability","thresholdYear":2026}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** make-it-in-germany.com (2026-09-30): gross annual salary of at least €50,700 (as of 2026); €45,934.20 (as of 2026) for shortage occupations (incl. ICT) if the Federal Employment Agency approves, and for new entrants who graduated within the last three years. Stored threshold: €45,935 (reduced figure rounded up) because every target role is an ICT occupation — standard €50,700 kept in other_rules_json. The IT-specialists and BAMF pages were blocked by a bot check on 2026-09-30, so the without-degree rule (3 of the last 7 years) is from the Blue Card page summary and needs checking.
- **Official pages (watched):** <https://www.make-it-in-germany.com/en/visa-residence/types/eu-blue-card> · <https://www.make-it-in-germany.com/en/visa-residence/types/it-specialists> · <https://www.bamf.de/EN/Themen/MigrationAufenthalt/ZuwandererDrittstaaten/Migrationsrecht/BlaueKarteEU/blauekarteeu-node.html>
- **Owner must verify:**
  - [ ] Part of the official source could not be read by the build assistant on 2026-09-30 (see "What was found"): read it yourself.
  - [ ] The stored threshold (€45,935 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`, `yearsInsteadOfDegree`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Skilled worker with academic training (§18b AufenthG) (`de_skilled_18b`)

- **Why it matters:** Fallback when the Blue Card salary is not reached: needs a recognised degree and a job that is appropriate for the qualification; no general salary threshold under 45 years of age.
- **Stored threshold:** none stored
- **Degree rule:** Recognised German or comparable foreign university degree (anabin/ZAB); the job must be one a degree holder would normally do.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary: NULL — no general minimum salary for applicants under 45 (pay must match comparable German employees); a separate minimum applies to first-time applicants aged 45+. The official page (make-it-in-germany.com/…/work-qualified-professionals) returned a bot-check page on every attempt on 2026-09-30, so neither the age-45 figure nor the details could be confirmed — owner to check.
- **Official pages (watched):** <https://www.make-it-in-germany.com/en/visa-residence/types/work-qualified-professionals>
- **Owner must verify:**
  - [ ] Part of the official source could not be read by the build assistant on 2026-09-30 (see "What was found"): read it yourself.
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Opportunity Card (Chancenkarte, §20a AufenthG) — job search (`de_chancenkarte`)

- **Why it matters:** Job-independent: a residence permit to look for work (points system), with limited part-time work allowed. Useful before an offer exists; not tied to a posting.
- **Stored threshold:** none stored
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"jobIndependent":"Job-search permit: no job offer needed, so no per-job salary, degree or experience check applies.","summary":"Recognised qualification counts directly; otherwise a points system (qualification, language, experience, age, previous stays) with proof of funds."}`
- **Effective from:** 2024-06-01
- **What was found (2026-09-30):** Job-independent route — eligibility is not evaluated per job. Points threshold, proof-of-funds amount and part-time allowance NOT confirmed: the official page returned a bot-check page on 2026-09-30. Owner to check the official page before relying on it.
- **Official pages (watched):** <https://www.make-it-in-germany.com/en/visa-residence/types/job-search-opportunity-card>
- **Owner must verify:**
  - [ ] Part of the official source could not be read by the build assistant on 2026-09-30 (see "What was found"): read it yourself.
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2024-06-01) is right, and the official pages listed above are still the current ones.

### NL — Netherlands

Amsterdam, Rotterdam, Eindhoven and Utrecht hubs; English widely used in tech. Highly skilled migrant (kennismigrant) permit requires an IND-recognised sponsor; salary criteria by age (30+ / under 30). EU Blue Card is an alternative. The 30% ruling (tax) may apply to incoming skilled workers.

#### Highly skilled migrant (kennismigrant), aged 30 or older (`nl_hsm`)

- **Why it matters:** Employer must be an IND-recognised sponsor. No degree requirement; salary criterion depends on age. For applicants under 30 see nl_hsm_under_30.
- **Stored threshold:** €77,009 / yr
- **Degree rule:** No degree requirement (salary-based route).
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"none","minAge":30,"monthlyGrossExclHolidayAllowanceEur":5942,"annualExclHolidayAllowanceEur":71304,"recognisedSponsorRequired":true}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** IND required amounts (2026-09-30): highly skilled migrants 30 years or older €5,942.00 gross per month EXCLUDING the 8% holiday allowance. Stored annual threshold €77,009 = 5,942 × 12.96, matching how RADAR annualises Dutch salaries (holiday allowance included); without holiday allowance that is €71,304/yr. The reduced criterion (€3,122) applies only to graduates of Dutch or top-ranked universities and orientation-year holders — not applicable by default. Employer must be a recognised sponsor.
- **Official pages (watched):** <https://ind.nl/en/residence-permits/work/highly-skilled-migrant> · <https://ind.nl/en/required-amounts-income-requirements>
- **Owner must verify:**
  - [ ] The stored threshold (€77,009 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Highly skilled migrant (kennismigrant), younger than 30 (`nl_hsm_under_30`)

- **Why it matters:** Same route as nl_hsm with the lower salary criterion for applicants younger than 30 at the time of application. RADAR does not know my age: only rely on this if I am under 30 when applying.
- **Stored threshold:** €56,467 / yr
- **Degree rule:** No degree requirement (salary-based route).
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"none","maxAge":29,"monthlyGrossExclHolidayAllowanceEur":4357,"annualExclHolidayAllowanceEur":52284,"recognisedSponsorRequired":true}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** IND required amounts (2026-09-30): highly skilled migrants younger than 30 €4,357.00 gross per month EXCLUDING holiday allowance. Stored annual threshold €56,467 = 4,357 × 12.96 (RADAR annualises Dutch pay incl. holiday allowance); €52,284/yr without it. Only valid if I am under 30 on the application date — the eligibility check cannot test age.
- **Official pages (watched):** <https://ind.nl/en/residence-permits/work/highly-skilled-migrant> · <https://ind.nl/en/required-amounts-income-requirements>
- **Owner must verify:**
  - [ ] The stored threshold (€56,467 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### European Blue Card (Netherlands) (`nl_blue_card`)

- **Why it matters:** Needs a higher-education degree and a 6-month+ contract; the employer does not have to be a recognised sponsor. The highly skilled migrant route is usually easier.
- **Stored threshold:** €77,009 / yr
- **Degree rule:** Higher-education degree (bachelor or higher) — from the EU Blue Card Directive; the IND Blue Card page did not load on 2026-09-30.
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"monthlyGrossExclHolidayAllowanceEur":5942,"reducedMonthlyExclHolidayAllowanceEur":4754,"reducedAppliesTo":"recent graduates (per IND) — conditions not confirmed"}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** IND required amounts (2026-09-30): European Blue Card €5,942.00 gross per month excluding holiday allowance; reduced criterion €4,754.00. Stored annual threshold €77,009 = 5,942 × 12.96 (holiday allowance included, as RADAR annualises Dutch pay); reduced: €61,612 incl. / €57,048 excl. The Blue Card page itself returned almost no content, so the degree and reduced-criterion conditions are unconfirmed.
- **Official pages (watched):** <https://ind.nl/en/residence-permits/work/european-blue-card> · <https://ind.nl/en/required-amounts-income-requirements>
- **Owner must verify:**
  - [ ] The stored threshold (€77,009 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### IE — Ireland

EMEA headquarters of many US tech/security companies (Dublin, Cork). Critical Skills Employment Permit covers ICT roles on the Critical Skills Occupations List (lower threshold with a relevant degree) and leads to Stamp 4; General Employment Permit needs a labour market needs test below the higher threshold.

#### Critical Skills Employment Permit (`ie_csep`)

- **Why it matters:** ICT professional roles are on the Critical Skills Occupations List. Leads to Stamp 4 after 2 years. Job offer must be for at least 2 years; permit fee €1,000.
- **Stored threshold:** €40,904 / yr
- **Degree rule:** For the €40,904 tier (Critical Skills Occupations List): a relevant degree qualification or higher is required.
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","allOccupationsThresholdEur":68911,"recentGraduateThresholdEur":36848,"offerMinYears":2,"feeEur":1000,"occupationList":"Critical Skills Occupations List (ICT professionals included — check the exact SOC code of the role)"}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** enterprise.gov.ie (2026-09-30): minimum annual remuneration €40,904 for occupations on the Critical Skills Occupations List (relevant degree or higher required); €36,848 when the qualification was obtained within the 12 months before applying; all other eligible occupations need over €68,911. Job offer of at least 2 years. Stored: €40,904 (CSOL tier, since the target roles are ICT).
- **Official pages (watched):** <https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types/critical-skills-employment-permit/>
- **Owner must verify:**
  - [ ] The stored threshold (€40,904 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### General Employment Permit (`ie_gep`)

- **Why it matters:** Fallback when a role is not on the Critical Skills list: requires a Labour Market Needs Test unless pay is at least €68,911 or the role is on the CSOL. Fee €500 (up to 6 months) / €1,000.
- **Stored threshold:** €36,605 / yr
- **Degree rule:** — (none stored)
- **Experience rule:** Qualifications, skills or experience required for the employment (no fixed minimum stated).
- **Structured checks / extra data:** `{"labourMarketNeedsTest":"required unless pay ≥ €68,911 or the occupation is on the CSOL","lmntExemptThresholdEur":68911,"recentIrishGraduateThresholdEur":34009}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** enterprise.gov.ie (2026-09-30): minimum annual remuneration generally €36,605 (€34,009 for a relevant degree from an Irish third-level college in the previous 12 months; €32,691 for a few listed care/food roles). A Labour Market Needs Test is required in most cases, except for CSOL occupations or pay of at least €68,911.
- **Official pages (watched):** <https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types/general-employment-permit/>
- **Owner must verify:**
  - [ ] The stored threshold (€36,605 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### FR — France

Paris is the main hub (plus Lyon, Toulouse, Nice/Sophia Antipolis). Non-EU route: Passeport Talent — carte bleue européenne (degree of 3+ years or 5 years of experience; salary threshold 1.5× the average reference salary).

#### Talent passport — EU Blue Card (Passeport talent – carte bleue européenne) (`fr_talent_blue_card`)

- **Why it matters:** Contract of at least 6 months with an employer established in France. Multi-year permit up to 4 years; family accompanies.
- **Stored threshold:** €59,373 / yr
- **Degree rule:** Diploma equivalent to at least three years of higher education.
- **Experience rule:** Or five years of professional experience at a comparable level (instead of the diploma).
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","yearsInsteadOfDegree":5,"contractMinMonths":6}`
- **Effective from:** 2025-08-31
- **What was found (2026-09-30):** Welcome to France (official Business France portal, page verified May 11, 2026; read 2026-09-30): annual gross salary at least 1.5× the average annual gross reference salary, i.e. €59,373 as of August 31, 2025; diploma of 3+ years of higher education or 5 years of comparable experience; contract ≥ 6 months. The France-Visas talent page returned no content on 2026-09-30 — check whether the figure was updated for 2026.
- **Official pages (watched):** <https://www.welcometofrance.com/en/fiche/talent-passport-eu-blue-card> · <https://www.service-public.fr/particuliers/vosdroits/F17359> · <https://france-visas.gouv.fr/en/web/france-visas/talent-passport>
- **Owner must verify:**
  - [ ] The stored threshold (€59,373 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`, `yearsInsteadOfDegree`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2025-08-31) is right, and the official pages listed above are still the current ones.

### ES — Spain

Madrid, Barcelona, Valencia and Málaga hubs. Highly qualified professional / EU Blue Card route via the Unidad de Grandes Empresas (Ley 14/2013). Lower salaries than northern Europe; many remote-first companies hire here.

#### Highly qualified professional / EU Blue Card (Ley 14/2013, UGE) (`es_hqp_blue_card`)

- **Why it matters:** Handled by the Unidad de Grandes Empresas y Colectivos Estratégicos (fast track, employer applies online).
- **Stored threshold:** none stored
- **Degree rule:** Higher-education degree for a highly qualified position.
- **Experience rule:** Or at least 3 years of professional experience comparable to a degree (per the UGE page).
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","yearsInsteadOfDegree":3}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** inclusion.gob.es UGE highly-qualified-professionals page (2026-09-30): degree, or ≥ 3 years of comparable experience. Salary: NULL — the pages read on 2026-09-30 state no amount (the Blue Card threshold is set by ministerial order and the tarjeta-azul-ue page returned no figures). Owner to confirm the current threshold.
- **Official pages (watched):** <https://www.inclusion.gob.es/web/unidadgrandesempresas/profesionales-altamente-cualificados> · <https://www.inclusion.gob.es/web/unidadgrandesempresas/tarjeta-azul-ue> · <https://www.inclusion.gob.es/web/unidadgrandesempresas/autorizaciones-y-requisitos>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The structured checks (`minDegreeLevel`, `yearsInsteadOfDegree`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### PT — Portugal

Lisbon and Porto tech hubs with many international companies. Routes: highly qualified activity residence permit (Art. 90.º), Tech Visa for IAPMEI-certified companies, and the EU Blue Card. Salaries are lower than in northern Europe.

#### Residence permit for highly qualified activity (Art. 90.º) (`pt_hq_activity`)

- **Why it matters:** National highly qualified route (AIMA). Salary criterion is a multiple of the national average salary (or of the IAS).
- **Stored threshold:** none stored
- **Degree rule:** Certificate of qualifications or document proving the specialisation.
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"monthlyOptionAverageSalaryEur":2157,"monthlyOptionIasEur":"3 × IAS (≈ €1,527.78 with the 2024 IAS of €509.26)","shortageMonthlyEur":1725.6,"shortageMonthlyIasEur":1018.52,"referenceYears":"average salary 2023, IAS 2024 (per AIMA)"}`
- **Effective from:** 2024-01-01
- **What was found (2026-09-30):** AIMA (2026-09-30): employment contract with a minimum salary of 1.5× the national average gross salary (€2,157.00/month) OR three times the IAS; for ISCO major groups 1–2 professions listed as in shortage, 1.2× (€1,725.60/month) or twice the IAS (€1,018.52/month). Reference values are from 2023 (average salary) and 2024 (IAS). Salary stored as NULL: the page offers alternative criteria and it is unclear which one AIMA applies, and the figures are dated — owner to confirm. Annualised with 14 payments, €2,157/month is €30,198/yr.
- **Official pages (watched):** <https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-atividade-altamente-qualificada-art-90-o>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2024-01-01) is right, and the official pages listed above are still the current ones.

#### Tech Visa (highly qualified activity for an IAPMEI-certified company) (`pt_tech_visa`)

- **Why it matters:** Only for companies certified under the IAPMEI Tech Visa programme (the company issues a term of responsibility).
- **Stored threshold:** none stored
- **Degree rule:** Qualification at ISCED-2011 level 6 or higher (bachelor), or level 5 with exceptional specialised skills.
- **Experience rule:** With an ISCED level 5 qualification: at least 5 years of experience.
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","contractMinMonths":12,"salaryRule":"2.5 × IAS per month","certifiedCompanyRequired":"IAPMEI Tech Visa certification","languages":"Portuguese, English, French or Spanish adequate for the job"}`
- **Effective from:** 2024-01-01
- **What was found (2026-09-30):** AIMA (2026-09-30): minimum salary 2.5× the IAS (Indexante de Apoios Sociais); contract of at least 12 months; ISCED 6, or ISCED 5 plus 5 years of experience; company certified by IAPMEI. Salary stored as NULL because the page does not state the IAS year in force (with the 2024 IAS of €509.26 it would be €1,273.15/month) — owner to confirm the current IAS.
- **Official pages (watched):** <https://aima.gov.pt/pt/trabalhar/autorizacao-de-residencia-para-atividade-altamente-qualificada-exercida-para-empresa-certificada-art-90-o-tech-visa>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2024-01-01) is right, and the official pages listed above are still the current ones.

#### EU Blue Card (Cartão Azul UE, Portugal) (`pt_blue_card`)

- **Why it matters:** EU Blue Card via AIMA. Details could not be read on 2026-09-30.
- **Stored threshold:** none stored
- **Degree rule:** Higher-education qualification (EU Blue Card Directive) — not confirmed on the AIMA page.
- **Experience rule:** — (none stored)
- **Effective from:** 2024-01-01
- **What was found (2026-09-30):** The AIMA Cartão Azul UE page returned a not-found page on 2026-09-30, so no threshold or condition could be confirmed. Salary NULL until the owner checks the official page.
- **Official pages (watched):** <https://aima.gov.pt/pt/viver/autorizacao-de-residencia/cartao-azul-ue>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2024-01-01) is right, and the official pages listed above are still the current ones.

### BE — Belgium

Brussels (EU institutions, consultancies), Antwerp and Ghent. Single permit for highly qualified workers or EU Blue Card, handled by the region where you will work (Flanders, Wallonia, Brussels).

#### Single permit — highly qualified worker / EU Blue Card (`be_single_permit_hq`)

- **Why it matters:** The region where the job is (Flanders, Wallonia, Brussels) decides the work part; salary thresholds differ by region and are indexed yearly.
- **Stored threshold:** none stored
- **Degree rule:** Higher-education degree for highly qualified / Blue Card permits — not confirmed on the regional pages.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: thresholds are set per region and indexed every year, and the Immigration Office (dofi.ibz.be) and Brussels pages returned almost no content on 2026-09-30. Owner to check the region of the job (VLAIO/Werk Flanders, Brussels Economy & Employment, SPW Wallonia).
- **Official pages (watched):** <https://dofi.ibz.be/en/themes/third-country-nationals/work> · <https://economy-employment.brussels/highly-qualified-worker> · <https://dofi.ibz.be/en/themes/third-country-nationals/work/eu-blue-card>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### LU — Luxembourg

Financial centre with strong security/compliance demand (banks, funds, EU institutions). EU Blue Card via the Guichet.lu highly qualified worker route. High salaries and high cost of living; many staff commute from FR/BE/DE.

#### EU Blue Card — highly qualified worker (Luxembourg) (`lu_blue_card`)

- **Why it matters:** Guichet.lu highly qualified worker route; an impatriate tax regime may apply.
- **Stored threshold:** none stored
- **Degree rule:** Higher-education qualification, or equivalent professional experience for some ICT roles — not confirmed on the fetched page.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: the Guichet.lu overview read on 2026-09-30 lists the sub-pages but not the threshold (set by Grand-Ducal regulation, updated yearly); the sub-page with the conditions was not readable. Owner to check the salaried-work sub-page.
- **Official pages (watched):** <https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/hautement-qualifie.html> · <https://guichet.public.lu/en/citoyens/immigration/plus-3-mois/ressortissant-tiers/salarie/carte-bleue-europeenne.html>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### AT — Austria

Vienna, Graz and Linz. Red-White-Red Card for key workers (points system) or the EU Blue Card (degree or, for ICT, 3 years of experience).

#### EU Blue Card (Austria) (`at_blue_card`)

- **Why it matters:** Needs a binding job offer matching the education and a labour market test. Application fee €218.
- **Stored threshold:** €55,678 / yr
- **Degree rule:** Completed university (or tertiary) studies of at least three years.
- **Experience rule:** ICT professionals: at least three years of relevant professional experience within the last seven years instead of the degree, if comparable to a three-year degree.
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","yearsInsteadOfDegree":3,"labourMarketTest":true,"feeEur":218,"salaryIncludesSpecialPayments":true}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** migration.gv.at (2026-09-30): at least the average gross annual income of full-time employees — in 2026 at least €55,678 (annual salary plus special payments); degree of 3+ years, or for ICT professionals 3 years of relevant experience within the last 7 years; labour market test (Arbeitsmarktprüfung).
- **Official pages (watched):** <https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/eu-blue-card/>
- **Owner must verify:**
  - [ ] The stored threshold (€55,678 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`, `yearsInsteadOfDegree`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Red-White-Red Card — other key workers (`at_rwr_key_worker`)

- **Why it matters:** Points-based (55 of 90 points: qualification, experience, languages, age) plus a labour market test. Valid 24 months.
- **Stored threshold:** €48,510 / yr
- **Degree rule:** Points for completed qualification (up to 30 points); no fixed degree requirement.
- **Experience rule:** Points for work experience; minimum 55 points overall.
- **Structured checks / extra data:** `{"minDegreeLevel":"none","monthlyGrossEur":3465,"pointsRequired":55,"labourMarketTest":true}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** migration.gv.at (2026-09-30): employer pays at least the statutory minimum of €3,465 (2026) gross per month; no equally qualified jobseeker registered with AMS (labour market test); at least 55 points. Stored annual threshold €48,510 = 3,465 × 14 (Austria pays 14 monthly salaries; RADAR annualises Austrian pay ×14). Points are not checked by RADAR.
- **Official pages (watched):** <https://www.migration.gv.at/en/types-of-immigration/permanent-immigration/other-key-workers/>
- **Owner must verify:**
  - [ ] The stored threshold (€48,510 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### IT — Italy

Milan is the main tech/finance hub, then Rome, Turin and Bologna. EU Blue Card (carta blu UE) exists; entry for many non-EU workers depends on the annual decreto flussi quotas. Lower salaries than northern Europe.

#### EU Blue Card (Carta Blu UE, Italy) (`it_blue_card`)

- **Why it matters:** Outside the decreto flussi quotas. Employer applies to the Sportello Unico per l’Immigrazione.
- **Stored threshold:** none stored
- **Degree rule:** Higher-education qualification (at least 3 years) or, for some ICT roles, equivalent professional experience — not confirmed on the fetched pages.
- **Experience rule:** — (none stored)
- **Effective from:** 2024-01-01
- **What was found (2026-09-30):** Salary NULL: the Integrazione Migranti news page and the Polizia di Stato page read on 2026-09-30 do not state the current annual threshold. Owner to confirm the figure in force.
- **Official pages (watched):** <https://www.integrazionemigranti.gov.it/en-gb/Ricerca-news/Dettaglio-news/id/3445/EU-Blue-Card> · <https://www.poliziadistato.it/articolo/carta-blu-ue>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2024-01-01) is right, and the official pages listed above are still the current ones.

## Tier 2 — Nordics & Central/Eastern Europe

### DK — Denmark

Copenhagen and Aarhus. Pay Limit Scheme (salary-based, no degree check), Supplementary Pay Limit Scheme, Fast-track via certified employers, and the EU Blue Card.

#### Pay Limit Scheme (Denmark) (`dk_pay_limit`)

- **Why it matters:** Salary-only scheme: no degree check. Processing fee DKK 6,810. Salary must be paid to a Danish bank account.
- **Stored threshold:** 552,000 DKK / yr
- **Degree rule:** No degree requirement (salary-based scheme).
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"none","supplementaryPayLimitDkk":446000}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** nyidanmark.dk (2026-09-30): job offer with a salary of DKK 552,000 or higher per year. SIRI announced (17-09-2026) updated income statistics for applications from 1 October 2026 — the figure may change; owner to re-check after 1 October.
- **Official pages (watched):** <https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme>
- **Owner must verify:**
  - [ ] The stored threshold (552,000 DKK / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Supplementary Pay Limit Scheme (Denmark) (`dk_supplementary_pay_limit`)

- **Why it matters:** Lower salary limit, only for positions the employer has advertised on Jobnet/EURES and when Danish unemployment is below a set level.
- **Stored threshold:** 446,000 DKK / yr
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"none"}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** nyidanmark.dk Pay Limit page (2026-09-30): with an annual salary of at least DKK 446,000 the company can choose to apply under the Supplementary Pay Limit Scheme. Its own page (this route’s URL, linked from the Pay Limit page) was not read — conditions such as the advertising requirement are from background knowledge; owner to check.
- **Official pages (watched):** <https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/The-Pay-Limit-Schemes/Supplementary-Pay-Limit-scheme> · <https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme>
- **Owner must verify:**
  - [ ] The stored threshold (446,000 DKK / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### SE — Sweden

Stockholm, Gothenburg and Malmö. Work permit needs an offer at 90% of the median salary; EU Blue Card at 1.25× the average salary (degree or 5 years of experience).

#### EU Blue Card (Sweden) (`se_blue_card`)

- **Why it matters:** Employment of at least 6 months in a highly qualified job.
- **Stored threshold:** 643,500 SEK / yr
- **Degree rule:** Higher education of at least 180 higher-education credits.
- **Experience rule:** Alternatively at least five years of relevant professional experience.
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","yearsInsteadOfDegree":5,"monthlyThresholdSek":53625,"contractMinMonths":6}`
- **Effective from:** 2026-07-15
- **What was found (2026-09-30):** Migrationsverket (2026-09-30): salary at least 1.25× the average Swedish gross salary; since 15 July 2026 SEK 53,625 per month. Stored annual SEK 643,500 = 53,625 × 12. Higher education of 180 credits or 5 years of relevant experience; highly qualified employment of at least 6 months.
- **Official pages (watched):** <https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Employed/Special-rules-for-certain-occupations-and-citizens-of-certain-countries/EU-Blue-Card.html>
- **Owner must verify:**
  - [ ] The stored threshold (643,500 SEK / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`, `yearsInsteadOfDegree`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-07-15) is right, and the official pages listed above are still the current ones.

#### Work permit (Sweden) (`se_work_permit`)

- **Why it matters:** General work permit: offer advertised in the EU, terms in line with collective agreements, insurance from the start.
- **Stored threshold:** 413,640 SEK / yr
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"none","monthlyThresholdSek":34470,"basis":"90% of the median salary (SEK 38,300 as of 16 June 2026)"}`
- **Effective from:** 2026-06-16
- **What was found (2026-09-30):** Migrationsverket (2026-09-30): as of 16 June 2026 the median salary is SEK 38,300, so the salary must be at least SEK 34,470 per month (90% of the median). Stored annual SEK 413,640 = 34,470 × 12. New rules for work permits came into effect on 1 June 2026 — owner to check other conditions.
- **Official pages (watched):** <https://www.migrationsverket.se/English/Private-individuals/Working-in-Sweden/Employed/Work-permit-requirements.html>
- **Owner must verify:**
  - [ ] The stored threshold (413,640 SEK / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-06-16) is right, and the official pages listed above are still the current ones.

### FI — Finland

Helsinki, Tampere, Oulu. Specialist residence permit and EU Blue Card via Migri; fast-track for specialists.

#### Residence permit for a specialist (Finland) (`fi_specialist`)

- **Why it matters:** Specialist permit (fast track available). Salary threshold is set by Migri and changes yearly.
- **Stored threshold:** none stored
- **Degree rule:** Usually a higher-education degree — not confirmed on the fetched page.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: the Migri specialist and EU Blue Card pages returned almost no content on 2026-09-30 (script-rendered). Owner to check the current monthly threshold on migri.fi.
- **Official pages (watched):** <https://migri.fi/en/specialist> · <https://migri.fi/en/eu-blue-card>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### NO — Norway

Oslo, Bergen, Trondheim; high salaries. Skilled worker permit via UDI (education or special qualifications, pay at Norwegian level).

#### Residence permit for skilled workers (Norway) (`no_skilled_worker`)

- **Why it matters:** Needs vocational or higher education relevant to the job and pay at the normal Norwegian level for the job.
- **Stored threshold:** none stored
- **Degree rule:** Higher education or vocational training relevant to the position — not confirmed on the fetched page.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: pay must be at the normal Norwegian level for the occupation (tariff or normal pay), not a single figure; the UDI page returned almost no content on 2026-09-30. Owner to check.
- **Official pages (watched):** <https://www.udi.no/en/want-to-apply/work-immigration/skilled-workers/>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### EE — Estonia

Tallinn and Tartu; strong security ecosystem (e-government, cyber defence). Residence permit for employment requires pay at least the average gross salary (employer asks the Unemployment Insurance Fund for permission).

#### Temporary residence permit for employment (Estonia) (`ee_employment`)

- **Why it matters:** Employer registered in Estonia; employer needs permission from the Unemployment Insurance Fund (Töötukassa) in the general case. Exceptions for top specialists, start-ups, IT.
- **Stored threshold:** €25,104 / yr
- **Degree rule:** Appropriate education for the job (no fixed level stated).
- **Experience rule:** Appropriate work experience for the job (no fixed minimum stated).
- **Structured checks / extra data:** `{"monthlyThresholdEur":2092,"basis":"average gross salary in Estonia (general requirement, subject to exceptions)"}`
- **Effective from:** 2026-03-05
- **What was found (2026-09-30):** politsei.ee (2026-09-30): the employer pays at least the average gross salary in Estonia; for 05.03.2026 – March 2027 that is €2,092 per month. Stored annual €25,104 = 2,092 × 12. Employer must obtain a permit from the Unemployment Insurance Fund in the general case.
- **Official pages (watched):** <https://www.politsei.ee/en/instructions/residence-permit-for-employment>
- **Owner must verify:**
  - [ ] The stored threshold (€25,104 / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-03-05) is right, and the official pages listed above are still the current ones.

### LT — Lithuania

Vilnius fintech and shared-service centres. EU Blue Card and national work permits via the Migration Department.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### LV — Latvia

Riga. EU Blue Card and work permits via the OCMA (PMLP).

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### CZ — Czechia

Prague and Brno security/tech centres (security vendors, shared-service centres). Employee Card and EU Blue Card via the Ministry of the Interior (IPC).

#### EU Blue Card (Czechia) (`cz_blue_card`)

- **Why it matters:** Ministry of the Interior (OAMP). The Employee Card is the alternative national route.
- **Stored threshold:** none stored
- **Degree rule:** Higher education or, for ICT, equivalent professional experience — not confirmed on the official page.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: the IPC Blue Card page returned almost no content on 2026-09-30 (only the home page loaded). Owner to check the CZK threshold.
- **Official pages (watched):** <https://ipc.gov.cz/en/visa-and-residence-permit-types/third-country-nationals/long-term-residence/eu-blue-card/>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### PL — Poland

Warsaw, Kraków, Wrocław, Gdańsk — large engineering and shared-service centres. Work permit + temporary residence, or EU Blue Card.

#### EU Blue Card (Niebieska Karta UE, Poland) (`pl_blue_card`)

- **Why it matters:** Via the voivodeship office where the job is. Threshold announced yearly by ministerial notice.
- **Stored threshold:** none stored
- **Degree rule:** Higher-education qualification or equivalent professional experience — not confirmed on the official page.
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: gov.pl timed out on 2026-09-30, so the current PLN threshold could not be confirmed. Owner to check.
- **Official pages (watched):** <https://www.gov.pl/web/udsc/niebieska-karta-ue>
- **Owner must verify:**
  - [ ] Part of the official source could not be read by the build assistant on 2026-09-30 (see "What was found"): read it yourself.
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### SI — Slovenia

Ljubljana. EU Blue Card and single permit.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### MT — Malta

iGaming, fintech and financial services. Single permit via Identità; Key Employee Initiative for highly skilled roles.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### RO — Romania

Bucharest, Cluj-Napoca, Iași — security vendors and engineering centres. Work permit (IGI) or EU Blue Card.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### HU — Hungary

Budapest shared-service and engineering centres. Single permit or EU Blue Card; Hungary has tightened guest-worker rules.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### HR — Croatia

Zagreb and Split. Stay-and-work permit (MUP) or EU Blue Card.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### SK — Slovakia

Bratislava and Košice (security vendors, shared-service centres). Single permit or EU Blue Card.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### BG — Bulgaria

Sofia and Plovdiv engineering centres. Uses the euro since 1 January 2026. EU Blue Card or single permit.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### GR — Greece

Athens and Thessaloniki; growing tech centres. EU Blue Card and national work permits.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### CY — Cyprus

Limassol and Nicosia (fintech, forex, relocated tech companies). Business Facilitation Unit fast-track for third-country staff of qualifying companies; EU Blue Card.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

## Tier 3 — other developed / high-pay markets

### GB — United Kingdom

London is Europe’s largest security job market (plus Manchester, Edinburgh, Bristol, Cheltenham). Skilled Worker visa needs a licensed sponsor and a "higher skilled" occupation at the higher of the general threshold or the going rate; Global Talent (digital technology) needs an endorsement. Check the Home Office register of licensed sponsors.

#### Skilled Worker visa (`gb_skilled_worker`)

- **Why it matters:** Employer must hold a sponsor licence (check the register of licensed sponsors) and the occupation must be eligible. Salary: the higher of the general threshold and the going rate for the occupation code.
- **Stored threshold:** 41,700 GBP / yr
- **Degree rule:** No personal degree requirement; the job must be at the required skill level.
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"none","lowerThresholdGbp":33400,"goingRateApplies":true,"sponsorLicenceRequired":true}`
- **Effective from:** 2025-07-22
- **What was found (2026-09-30):** gov.uk (2026-09-30): minimum salary is the highest of £41,700 per year or the going rate for the occupation; it may be as low as £33,400 in listed cases (e.g. new entrant, PhD, immigration salary list). Stored: £41,700 (local currency; no official EUR figure). Effective date of the £41,700 figure (22 July 2025) is from background knowledge — the page does not state it; owner to confirm, and check the occupation’s going rate.
- **Official pages (watched):** <https://www.gov.uk/skilled-worker-visa/your-job> · <https://www.gov.uk/government/publications/register-of-licensed-sponsors-workers>
- **Owner must verify:**
  - [ ] The stored threshold (41,700 GBP / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2025-07-22) is right, and the official pages listed above are still the current ones.

#### Global Talent visa (digital technology) (`gb_global_talent`)

- **Why it matters:** Job-independent: needs an endorsement (digital technology) or a prestigious prize. No sponsor needed.
- **Stored threshold:** none stored
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"jobIndependent":"Endorsement-based visa: not tied to a job offer, so no per-job checks apply.","applicationFeeGbp":766}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** gov.uk (2026-09-30): for leaders or potential leaders in academia/research, arts and culture, or digital technology; requires an endorsement (or an eligible award). Application fee £766 (endorsement + visa stages). Job-independent — eligibility is not evaluated per job.
- **Official pages (watched):** <https://www.gov.uk/global-talent>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### CH — Switzerland

Zurich, Geneva, Basel, Lausanne, Zug; highest salaries in Europe. Non-EU/EFTA permits only for highly qualified specialists (degree plus years of experience), subject to annual quotas, priority for Swiss/EU workers and customary pay. Employers apply to the cantonal authority; SEM approves.

#### Work permit for non-EU/EFTA nationals (Switzerland, B/L quota permits) (`ch_non_eu_permit`)

- **Why it matters:** Quota-based; the employer must show no suitable Swiss/EU/EFTA candidate exists and pay customary local wages. Cantonal authority + SEM approval.
- **Stored threshold:** none stored
- **Degree rule:** Highly qualified: essentially a degree from a university or institution of higher education.
- **Experience rule:** Plus a number of years of professional work experience (no fixed number stated).
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","priorityForSwissAndEuWorkers":true,"quotas":true,"customaryWages":true}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** SEM (2026-09-30): only highly qualified workers (managers, specialists, other skilled professionals) — essentially a university/higher-education degree plus several years of experience; employer must prove no suitable Swiss/EU/EFTA candidate; salary and terms must be customary for the region and sector. Salary NULL: there is no fixed threshold.
- **Official pages (watched):** <https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige.html> · <https://www.sem.admin.ch/sem/en/home/themen/arbeit/nicht-eu_efta-angehoerige/verfahren_erwerbstaetigkeit.html>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### CA — Canada

Toronto, Vancouver, Montreal, Ottawa. Employer routes: LMIA-based work permits incl. the Global Talent Stream (fast processing); permanent residence via Express Entry (points-based, no job offer required).

#### Global Talent Stream (LMIA work permit) (`ca_global_talent_stream`)

- **Why it matters:** Employer-led LMIA stream with 2-week processing for listed tech occupations (Category B) or referred companies (Category A); employer signs a Labour Market Benefits Plan.
- **Stored threshold:** none stored
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"wageRule":"at least the prevailing wage for the occupation and region (Job Bank)","lmiaRequired":true}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** canada.ca (2026-09-30): Global Talent Stream of the Temporary Foreign Worker Program. Salary NULL: the wage must meet the prevailing wage for the occupation/region — no single threshold.
- **Official pages (watched):** <https://www.canada.ca/en/employment-social-development/services/foreign-workers/global-talent.html>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Express Entry (permanent residence) (`ca_express_entry`)

- **Why it matters:** Job-independent: points-based (CRS) permanent residence; a job offer is not required. Language test and credential assessment (ECA) needed.
- **Stored threshold:** none stored
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"jobIndependent":"Points-based permanent residence; not tied to a posting."}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Job-independent route (canada.ca, 2026-09-30) — eligibility is not evaluated per job. Draw cut-offs change every round.
- **Official pages (watched):** <https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry.html> · <https://www.canada.ca/en/immigration-refugees-citizenship/services/immigrate-canada/express-entry/eligibility.html>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### US — United States

Largest security market, but H-1B is a lottery with annual caps and changing fees — very hard to plan around from abroad. L-1 (intra-company transfer) and O-1 are the other routes.

#### H-1B specialty occupation (`us_h1b`)

- **Why it matters:** Annual cap with a registration lottery (employer registers in March). Treat as low-probability; L-1 after a year with a multinational is the more predictable path.
- **Stored threshold:** none stored
- **Degree rule:** Bachelor's degree or higher (or equivalent) in a specific specialty related to the job.
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"minDegreeLevel":"bachelor","lottery":true,"wageRule":"at least the actual or prevailing wage (Labor Condition Application)"}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** USCIS (2026-09-30): specialty occupation; Labor Condition Application with the prevailing wage — salary NULL (no single threshold). Alerts on the page: a $100,000 payment requirement for certain petitions was vacated by a district court on June 8, 2026 (stay denied by the First Circuit on July 24, 2026; DHS says it will collect if the order is lifted); a 9-11 Biometric Fee rule applies to covered employers from Sept 9, 2026.
- **Official pages (watched):** <https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The structured checks (`minDegreeLevel`) match the page: eligibility applies them as hard rules.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### AU — Australia

Sydney, Melbourne, Brisbane, Canberra. Skills in Demand (subclass 482) visa: Core Skills stream (occupation list + income threshold) and Specialist Skills stream (higher threshold). Many security roles in government/defence need citizenship and clearance.

#### Skills in Demand visa (subclass 482) — Core Skills stream (`au_sid_482_core`)

- **Why it matters:** Employer-sponsored; occupation must be on the Core Skills Occupation List. Specialist Skills stream for pay at or above the SSIT.
- **Stored threshold:** 79,423 AUD / yr
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"specialistSkillsThresholdAud":146576,"marketSalaryRule":"the higher of the annual market salary rate and the threshold"}`
- **Effective from:** 2026-07-01
- **What was found (2026-09-30):** Home Affairs salary requirements (2026-09-30): Core Skills Income Threshold AUD 79,423 for nominations lodged 1 July 2026 – 30 June 2027 (Specialist Skills Income Threshold AUD 146,576). Pay must also meet the annual market salary rate. Work-experience requirement (commonly 1 year) not confirmed on the fetched page — not stored.
- **Official pages (watched):** <https://immi.homeaffairs.gov.au/visas/getting-a-visa/visa-listing/skills-in-demand-482> · <https://immi.homeaffairs.gov.au/visas/employing-and-sponsoring-someone/sponsoring-workers/nominating-a-position/salary-requirements>
- **Owner must verify:**
  - [ ] The stored threshold (79,423 AUD / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-07-01) is right, and the official pages listed above are still the current ones.

### NZ — New Zealand

Auckland and Wellington. Accredited Employer Work Visa (employer must be accredited; median-wage rules).

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### SG — Singapore

Regional HQs and a large security market. Employment Pass: age-rising qualifying salary plus the COMPASS points framework; higher figures for financial services.

#### Employment Pass (Singapore) (`sg_employment_pass`)

- **Why it matters:** Two stages: qualifying salary (rises with age) and the COMPASS points framework. Job must be advertised on MyCareersFuture first (with exceptions).
- **Stored threshold:** 67,200 SGD / yr
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"monthlyMinimumSgd":5600,"ageDependent":"SGD 5,600 is the floor (age 23); rises progressively to SGD 10,700 at age 45+ — the real threshold for me is higher than the floor","financialServicesMonthlySgd":6200,"from2027MonthlySgd":6000,"compass":"COMPASS points (salary, qualifications, diversity, local employment) — not checked by RADAR"}`
- **Effective from:** 2025-01-01
- **What was found (2026-09-30):** MOM (2026-09-30): current minimum qualifying salary SGD 5,600/month (all sectors except financial services), increasing with age up to SGD 10,700 at 45+; from 1 Jan 2027 for new applications SGD 6,000 (up to 11,500). Stored annual SGD 67,200 = 5,600 × 12 — the age-23 floor, so a "meets" is optimistic; also requires passing COMPASS.
- **Official pages (watched):** <https://www.mom.gov.sg/passes-and-permits/employment-pass/eligibility>
- **Owner must verify:**
  - [ ] The stored threshold (67,200 SGD / yr) matches the figure on the official page for the current year, including how monthly figures were annualised.
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2025-01-01) is right, and the official pages listed above are still the current ones.

### JP — Japan

Tokyo, Osaka, Fukuoka. Engineer/Specialist in Humanities/International Services visa for most tech jobs; Highly Skilled Professional (points) for faster permanent residence.

#### Engineer / Specialist in Humanities / International Services (`jp_engineer_specialist`)

- **Why it matters:** Standard work status for software/security engineers. Highly Skilled Professional (points) is a faster path to permanent residence.
- **Stored threshold:** none stored
- **Degree rule:** University degree related to the work, or long practical experience — not confirmed on an official page.
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"wageRule":"equal to or more than a Japanese national doing comparable work"}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: no fixed threshold (pay must be at least that of a Japanese national in comparable work). The ISA page fetched on 2026-09-30 redirected to the ISA home page, so the degree/experience conditions (degree, or 10 years of experience, background knowledge) are unconfirmed. The route URL (ISA, Japanese-language status page) answered 200 on 2026-09-30 but was not read — owner to check.
- **Official pages (watched):** <https://www.moj.go.jp/isa/applications/status/gijinkoku.html> · <https://www.isa.go.jp/en/publications/materials/newimmiact_3_index.html>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### KR — South Korea

Seoul and Pangyo. E-7 (special occupation) visa for professionals.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### AE — United Arab Emirates

Dubai and Abu Dhabi; tax-free salaries. Employer-sponsored work permit + residence visa (MOHRE); Golden Visa for high earners and specialists.

#### Employer-sponsored work permit and residence visa (UAE) (`ae_work_permit`)

- **Why it matters:** Employer obtains the MOHRE work permit and sponsors the residence visa. No general salary threshold.
- **Stored threshold:** none stored
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** Salary NULL: no general threshold for the standard employment visa. The u.ae page timed out on 2026-09-30 — owner to check.
- **Official pages (watched):** <https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/residence-visa-for-working-in-the-uae>
- **Owner must verify:**
  - [ ] Part of the official source could not be read by the build assistant on 2026-09-30 (see "What was found"): read it yourself.
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

#### Golden visa — skilled professionals (UAE) (`ae_golden_visa`)

- **Why it matters:** Long-term (5/10-year) residence without a sponsor. Categories include skilled professionals.
- **Stored threshold:** none stored
- **Degree rule:** — (none stored)
- **Experience rule:** — (none stored)
- **Structured checks / extra data:** `{"jobIndependent":"Residence status not tied to one posting; not evaluated per job."}`
- **Effective from:** 2026-01-01
- **What was found (2026-09-30):** u.ae (2026-09-30): 5- or 10-year renewable residence, no sponsor needed. The skilled-professional conditions (commonly reported as a bachelor’s degree and a monthly salary of AED 30,000) were in a table the fetch did not capture — NOT confirmed, so nothing is stored. Treated as job-independent.
- **Official pages (watched):** <https://u.ae/en/information-and-services/visa-and-emirates-id/residence-visas/golden-visa>
- **Owner must verify:**
  - [ ] No salary threshold is stored: confirm that the route really has no general minimum (or enter it as a new rule version).
  - [ ] The extra data in other_rules_json matches the page.
  - [ ] The effective date (2026-01-01) is right, and the official pages listed above are still the current ones.

### IL — Israel

Tel Aviv is a global cyber-security hub. HIT expert work visa for high-tech experts (salary at least twice the average wage); security clearance limits some roles.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### HK — Hong Kong

Finance-heavy security market. General Employment Policy visa (employer-sponsored) and the Top Talent Pass Scheme.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### IS — Iceland

Small market (Reykjavík). Work permit for experts (Directorate of Labour).

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

## Tier 4 — Middle East & other markets

### SA — Saudi Arabia

Riyadh and Jeddah; large public-sector and giga-project security demand. Employer-sponsored work visa; Premium Residency for some profiles. Saudisation quotas affect hiring.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### QA — Qatar

Doha; employer-sponsored work visa.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### TW — Taiwan

Taipei and Hsinchu (semiconductors). Employment Gold Card for professionals and regular work permits.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### MY — Malaysia

Kuala Lumpur and Penang shared-service/security operations centres. Employment Pass categories by salary.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### BR — Brazil

São Paulo and other large tech centres. Temporary work visa (VITEM V) with employer authorisation.

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

### MX — Mexico

Mexico City, Guadalajara, Monterrey (nearshoring for US companies). Temporary resident visa with a job offer (INM).

_No visa route seeded yet._ RADAR cannot judge visa eligibility here ("Can't tell"). Before this country goes live, research its work-permit route(s) on the official immigration site and add them with a first rule version.

## Remote / Worldwide

### XW — Remote / Worldwide

Pseudo-country for remote roles. Remote postings are only useful when they allow India/Asia/"anywhere" or an EU country where I can legally work — check the eligible regions and time zones (RADAR reads them into the remote-eligibility fact).

_Remote / Worldwide is a pseudo-country: there is no visa route. Remote jobs are judged by the remote-eligibility rules (spec §14), not by a visa threshold._
