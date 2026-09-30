# Visa rule verification log

Which stored visa rules were compared with the publisher's own page, when, and what happened. The
research import that created the rules is described in [COUNTRY_RULES.md](COUNTRY_RULES.md) (it
stays "unverified" as an import; this file records the checking). A rule is *verified* in the app
when someone marks it on **Countries** with a note; verification expires after 90 days.

**How to verify a rule (5 minutes each):** Countries → the country → open the rule's *Official page* →
compare amount, currency, year, monthly vs annual, degree and experience → *Mark verified today* with a
note of what you compared. If a number differs: *Add rule version* with the right values and a
reason (never edit the old one), then verify the new one.

## 2026-09-30 — checked by Claude at the owner's request

Method: each official page was read on that day; the number on the page was compared with the stored
value (monthly amounts annualised the way RADAR does for that country). Each rule was then marked
verified in the app with the same note, so the audit trail (System) carries it. **Please re-check the
page yourself before relying on a number for an application** — this was an automated read, not legal advice.

| Rule (code) | On the official page | Stored | Result |
|---|---|---|---|
| NL highly skilled migrant, 30+ (`nl_hsm`) | EUR 5,942.00 gross/month in 2026 (holiday allowance excluded) — [IND](https://ind.nl/en/required-amounts-income-requirements) | EUR 77,009/yr (= 5,942 × 12 × 1.08) | matches |
| NL highly skilled migrant, under 30 (`nl_hsm_under_30`) | EUR 4,357.00/month in 2026 | EUR 56,467/yr | matches |
| NL EU Blue Card (`nl_blue_card`) | EUR 5,942.00/month in 2026 (the page also lists EUR 4,754 for graduates — not modelled by this rule version) | EUR 77,009/yr | matches |
| UK Skilled Worker (`gb_skilled_worker`) | GBP 41,700/yr or the going rate, whichever is higher — [gov.uk](https://www.gov.uk/skilled-worker-visa/your-job) | GBP 41,700 (from 2025-07-22) | matches |
| Sweden work permit (`se_work_permit`) | SEK 34,470/month (90% of the median) from 16 June 2026 — Migrationsverket | SEK 413,640/yr (= ×12) | matches |
| Sweden EU Blue Card (`se_blue_card`) | SEK 53,625/month since 15 July 2026; 180 credits or 5 years' experience | SEK 643,500/yr (= ×12) | matches |
| Ireland Critical Skills (`ie_csep`) | EUR 40,904 (Critical Skills occupations); EUR 36,848 for recent graduates — [enterprise.gov.ie](https://enterprise.gov.ie/en/what-we-do/workplace-and-skills/employment-permits/permit-types/critical-skills-employment-permit/) | EUR 40,904 | amount matches; the page states no effective date |
| Ireland General Employment Permit (`ie_gep`) | "generally EUR 36,605" | EUR 36,605 | amount matches; no effective date on the page |
| France Talent Passport – EU Blue Card (`fr_talent_blue_card`) | EUR 59,373 as of 31 Aug 2025 (1.5× the reference salary); 3-year degree or 5 years' experience; contract ≥ 6 months — Business France | EUR 59,373 (2025-08-31) | matches |
| Denmark Pay Limit (`dk_pay_limit`) | DKK 552,000 (2026 level), adjusted every 1 January — [nyidanmark.dk](https://www.nyidanmark.dk/en-GB/You-want-to-apply/Work/Pay-limit-scheme) | DKK 552,000 | matches |
| US H-1B (`us_h1b`) | Specialty occupation + Labor Condition Application; the USD 100,000 payment guidance vacated by a court on 8 June 2026 (stay refused 24 July 2026); 9-11 Biometric Fee from 9 Sept 2026 — [USCIS](https://www.uscis.gov/working-in-the-united-states/h-1b-specialty-occupations) (page updated 2026-09-21) | rule text says the same | matches |

## Not verified (27 rules)

- **Germany Blue Card (`de_blue_card`)** — the official site (make-it-in-germany.com) blocks automated
  readers with a bot check, and the alternative government pages tried returned "not found". Please check in a
  browser: stored EUR 50,700 standard and EUR 45,934.20 reduced (shortage occupations such as IT, and new
  entrants) for 2026, degree recognised via anabin/ZAB, or 3 years' IT experience without a degree.
  Germany is the country with the most matching jobs after the US, so do this one first.
- **Denmark supplementary pay limit (`dk_supplementary_pay_limit`)** — the page only gives the single
  DKK 552,000 figure; the DKK 446,000 supplementary amount is unconfirmed.
- Every other route (AT, BE, CH, CZ, ES, FI, IT, LU, NO, PL, PT, AE, AU, CA, JP, SG, GB Global Talent,
  DE Chancenkarte and §18b, EE, and the routes with no numeric threshold) was not compared with its page.

Countries are still **not switched live**: that is your decision once you are happy with a country's rules.
