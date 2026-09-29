# Global Job Finder — Plan v2 (Robust & Accurate)

**Owner:** Abhishek Ray
**Stack (only this, no configs):** Next.js (frontend + backend) · MySQL
**Optional AI:** OpenRouter free key, about 50 calls/day

> **What changed from v1:** No new headline features. This version makes the same tool **trustworthy**: every fact has proof behind it, failures are loud instead of silent, wrong data gets caught and corrected, and accuracy is measured instead of assumed.

---

## 1. The Idea in Brief

A personal job-hunting engine. Every day it collects fresh jobs from **30–40 developed countries plus remote roles**, from local job sites, company career pages and other platforms, covering startups, mid-size IT companies and big MNCs. It saves them in my database and shows me the ones that matter for my goal: **a well-paid cloud security / DevSecOps role outside India, ideally in the EU, with visa sponsorship**.

Each job page tells me: does the company sponsor a visa, what are the country's criteria, what is the pay, is the language a barrier, and where is the apply link. My profile page tracks every application, with stages, dates and comments.

**The v2 promise:** when the tool says something, I can see *why* it says it, *how sure* it is, and *when it last checked*.

---

## 2. What "Robust" and "Accurate" Mean Here

**Robust** = it keeps working, and when it can't, it tells me.
- One broken source never stops the others.
- Re-running a day never creates duplicates or loses data.
- A source failing is never mistaken for "no jobs today".
- I can always rebuild results from saved raw data.

**Accurate** = what I see is right, or clearly marked as uncertain.
- Every fact carries its **source, evidence, method and confidence**.
- Uncertain beats wrong. "Unknown" is a valid, honest answer.
- Accuracy is **measured** against a hand-checked sample, not assumed.

### Starting targets (tune after real data)

| Area | Target |
|---|---|
| Visa status "Confirmed" | At least 98% correct on spot-check (a wrong "Confirmed" is the worst error) |
| Duplicates visible in the list | Under 2% |
| Jobs shown as "open" that are actually closed | Under 5% |
| Role-match precision in my top 50 | At least 90% relevant |
| New jobs appearing after they're posted | Within 24 hours |
| Silent failures (source dead, nobody told me) | Zero |
| AI facts that fail the evidence check | Rejected, never shown |

---

## 3. Target Profile

Set once in settings. Everything is scored against it.

**Roles**
- Primary: Cloud Security Engineer, DevSecOps Engineer, Application/Product Security Engineer
- Secondary: Cloud Security Analyst, Security Engineer (cloud), GRC/Compliance (cloud), Cloud Engineer (security focus)
- Fallback: Full-stack / Next.js / Node developer roles at companies that sponsor visas

**Experience band (updated):** By Sep 2027 I'll have about 4 years total, with about 1 year 8 months on the cloud project.
- **Core:** postings asking 2–4 years
- **Show:** 1–5 years
- **Hide:** 0–1 years (graduate/junior) and 6+ years
- Roles that count experience strictly in security are marked "stretch".

**Pay:** minimum salary floor, everything converted to EUR.
**Location:** target countries with relocation/visa support, plus remote roles I can really take from India.
**Company types:** startup, scale-up, mid-size IT/services, MNC. None excluded by default.

---

## 4. Country Coverage

**Tier 1 — EU Core (build first):** Germany, Netherlands, Ireland, France, Spain, Portugal, Belgium, Luxembourg, Austria, Italy

**Tier 2 — Nordics & Central/Eastern Europe:** Denmark, Sweden, Finland, Norway, Estonia, Lithuania, Latvia, Czechia, Poland, Slovenia, Malta, Romania, Hungary, Croatia, Slovakia, Bulgaria, Greece, Cyprus

**Tier 3 — Other Developed / High-Pay Markets:** United Kingdom, Switzerland, Canada, United States, Australia, New Zealand, Singapore, Japan, South Korea, UAE, Israel, Hong Kong, Iceland

**Tier 4 — Middle East & Other Markets:** Saudi Arabia, Qatar, Taiwan, Malaysia, Brazil, Mexico

**Plus:** Remote / Worldwide

The list lives in the database, so adding or removing a country never needs a rebuild. **A country only goes live when its rules are verified and its sources pass the source checklist (section 7).**

---

## 5. Core Principle: Every Fact Has Provenance

Nothing is stored or shown as a bare value. Each important fact (visa status, salary, seniority, remote eligibility, language, closing date) is stored together with:

| Part | Meaning |
|---|---|
| **Value** | What the fact says |
| **Evidence** | The exact quote or record it came from |
| **Source** | Where it came from (link, register name, my own note) |
| **Method** | Official record · Rule · AI · Manual (me) |
| **Confidence** | High · Medium · Low |
| **Checked at** | When it was last verified |
| **Rule/prompt version** | Which version of the logic produced it |

**The trust order (highest first):** my manual correction → official record → explicit statement in the posting → rule-based detection → AI extraction → estimate.
A lower level can never overwrite a higher one. An AI result can never beat an official record.

---

## 6. Data Flow: Raw In, Clean Out

The data moves through separate stages. Each stage saves its output, so any stage can be re-run without repeating the others.

1. **Raw snapshot:** the untouched data from the source, saved as it was received, with the time and the source version. This is never edited.
2. **Normalised job:** one common shape (title, company, location, salary, dates, description, link).
3. **Enriched job:** company info, country rules, visa evidence, remote check.
4. **Scored job:** the Fit Score with each component saved.
5. **Displayed job:** what I see, with my manual overrides applied on top.

**Why this matters for accuracy:** when I improve a rule, I re-process the saved raw data. I don't wait for jobs to be scraped again. I also keep raw snapshots for 90 days (then keep only what I applied to or saved).

---

## 7. Sources: Grades, Registry and the "Definition of Done"

### 7.1 Source grades

| Grade | Type | Trust |
|---|---|---|
| **A** | Official APIs, government job boards, official registers | Highest |
| **B** | Company career pages via public hiring-platform listings | High (it's the company's own posting) |
| **C** | Local job sites (only where their terms allow) | Medium |
| **D** | Aggregators and remote job boards | Lower (may be stale or reposted) |

When the same job appears in several grades, the **highest grade wins** for facts like the apply link and the posted date.

### 7.2 Source registry (one row per source)
Each source records: grade · country · how it's accessed · terms-of-use status with **last-reviewed date** · polite request rate · normal volume range · normal freshness · expected data shape · owner-notes.

### 7.3 Rules (unchanged, still strict)
- **No LinkedIn, Indeed or Glassdoor scraping.** They forbid it and block it. I use them by hand for cross-checking only.
- Prefer official APIs, feeds and public listings.
- Respect each site's rules. Go slowly, spread requests out, identify politely.
- Store only what's needed and always link back to the original.
- **No auto-apply.**

### 7.4 A source is only "live" when it passes this checklist
- [ ] Terms of use reviewed and recorded, with a date
- [ ] Sample raw responses saved as test samples (a few normal, a few odd)
- [ ] Parser handles the samples correctly, including missing fields
- [ ] Normal volume and freshness baseline recorded
- [ ] Request rate set and respected
- [ ] Alerts on: silent source, volume drop, parse failures
- [ ] 20 jobs from it checked by hand against the original site

---

## 8. Pipeline Reliability Rules

- **Source isolation:** each source runs on its own. One failing never blocks the rest.
- **Idempotent:** running the same day twice gives the same result, with no duplicates.
- **No overlapping runs:** a new run waits (or skips) if the last one hasn't finished.
- **Timeouts and retries:** every request has a time limit. Failed requests retry a few times with growing pauses.
- **Circuit breaker:** after repeated failures a source is paused automatically and flagged. It's retried later, not hammered.
- **Politeness:** per-source rate limits and daily caps are enforced by the system, not by memory.
- **Dead-letter store:** records that can't be parsed are saved with the error, shown in the admin page, and re-tried after a fix. They are never silently dropped.
- **Versioned logic:** parsers, rules and AI prompts all have version numbers, and every result records which version made it.
- **Dry-run mode:** the whole pipeline can run without saving, so I can test changes safely.
- **Never mass-close on failure:** if a source run failed or returned far fewer jobs than normal, its jobs are **not** marked closed. Missing data from a broken source doesn't mean the jobs are gone.

---

## 9. Data Quality Gates

Before a job is saved as usable, it passes checks. Failures go to the dead-letter store or get a "needs review" flag.

**Per-job checks**
- Required parts present: title, company, a working link, a source, and a date or first-seen time
- Posted date isn't in the future or absurdly old
- Salary passes sanity checks (for example, annual and monthly weren't mixed up)
- Country and city match a known place
- Title and description aren't empty or obviously spam

**Per-source checks (run every day)**
- Volume compared with the usual: a sudden drop or spike raises an alert
- Share of records that failed parsing: above a limit raises an alert
- Missing-field rate compared with normal: **schema drift** (the site quietly changed its format) raises an alert
- A few known "canary" jobs still appear as expected

---

## 10. Normalisation Accuracy

**Location:** map every place to a country and city using a known place list. It handles local spellings ("München"/"Munich"), region codes, and messy remote strings ("Remote – EMEA", "Hybrid, 3 days in office").

**Title mapping:** map titles and synonyms, including major non-English ones, to canonical roles. "Ingénieur sécurité cloud" and "Cloud Security Engineer" map to the same role. Unknown titles go to a review list, not to a guess.

**Experience and seniority:** extract "3+ years", "2–4 Jahre" and similar phrases across main languages. Where the posting says nothing, use title words (Junior/Senior/Lead) with a lower confidence.

**Salary — the most error-prone field**
- Detect the **period** (hourly, monthly, annual) and the **currency**.
- Detect **gross vs. net** when stated, and **range vs. single number**.
- Handle formats like "45k" and local number styles ("45.000" vs "45,000").
- Some countries pay in **13 or 14 installments**, so "monthly" figures can mislead. Convert carefully and label it.
- Convert to EUR using an exchange rate, and **store the rate and its date** with the result.
- Mark salary as **Stated** (from the posting) or **Estimated** (country average). They look different in the UI and are never mixed silently.

**Language:** detect the posting's language and any language requirement ("fluent German required"). Label "English OK", "Local language required" or "Unclear".

---

## 11. Deduplication & Company Identity

### 11.1 Job de-duplication (careful, not aggressive)
1. **Same link:** clean tracking parts from links, then match exactly.
2. **Same company + title + location:** fuzzy match.
3. **Similar description text:** compared for close matches.
4. **A wrongly merged pair is worse than a missed duplicate.** So high-confidence matches merge automatically, and uncertain matches appear as **"Possible duplicate"** for me to confirm or split.
5. One job keeps **all** its source links, and shows the best-grade source first.

### 11.2 Company identity (matters a lot for visa accuracy)
- Each company is one record with **aliases and legal names** (for example, brand name vs. "X GmbH" vs. "X Ltd").
- Track **parent and subsidiary** relationships, since a sponsor register may list the legal entity, not the brand.
- Recruiters and agencies are marked **Agency**, not treated as the employer.
- A **manual merge/split tool** lets me fix mistakes, and the fix persists.

---

## 12. Job Lifecycle & Liveness

**States:** New → Active → Updated → Stale → Closed (or Expired / Suspicious)

- **Freshness:** every job shows "first seen" and "last confirmed live".
- **Closing:** a job is only marked closed after it's been missing across **more than one successful run** of a healthy source, or its own page says it's closed.
- **Link health:** apply links are re-checked regularly. Dead links are flagged, and the link checker only fetches public web addresses (never internal ones).
- **Reposts and ghost jobs:** the same job reposted repeatedly, or open for a very long time, gets a **Ghost risk** flag and a lower rank.
- **Changes:** if a job's title, salary or description changes, the change is kept as history.

---

## 13. Visa Accuracy Engine (the most important part)

**Rule: a wrong "Confirmed" costs me the most, so "Confirmed" is hard to earn.**

### 13.1 Layer 1 — Country rules knowledge base
- One record per country and visa route, with **effective date, salary threshold, degree/experience rules, official source link, last-verified date, next-review date**.
- Rules are **versioned**, so I can see what was true on any date.
- **Stale warning:** any rule not verified in over 90 days shows a warning on every job in that country.
- **Change watch:** the system checks the official immigration pages for changes and flags "page changed, please review". It never rewrites rules by itself.
- Every rule change is logged (what, when, why, source).

### 13.2 Layer 2 — Company evidence
- Import public sponsor registers and employer data where they exist (for example the UK, the Netherlands, and US/Canada public records; each country's availability must be verified). Save the **register name and download date**.
- **Careful matching:** a company matches a register entry only when name and country agree strongly. Weak matches are shown as **"Possible match — verify"**, never as confirmed.
- **Learn from my own applications:** if a recruiter tells me "we do/don't sponsor", I record it, and it becomes evidence (marked as coming from me).

### 13.3 Layer 3 — What the posting says
- Multilingual phrase lists cover both directions: sponsorship offered and sponsorship refused.
- **Negation and context are handled**, so "no visa sponsorship", "must already have the right to work", "kein Visa-Sponsoring" all count as *Not offered*.
- The **exact quote** is saved as evidence.

### 13.4 How the final status is decided

| Status | Requires |
|---|---|
| **Confirmed** | An official record match, or an explicit statement in the posting (or from the company to me) |
| **Likely** | Company has a sponsorship history, or the posting mentions relocation support |
| **Unknown** | No evidence either way (the default) |
| **Not offered** | The posting says so |
| **Conflicting** | Evidence disagrees. Shown with both sides for me to judge |

- An explicit "not offered" in the posting overrides everything except my own confirmed note.
- **AI alone can never produce "Confirmed".**

### 13.5 "Am I eligible?" check
Using my facts (Indian passport, B.Tech degree, years of experience, expected salary) against the country's rule, the job shows:
**Meets · Borderline · Doesn't meet · Can't tell**, with the reason. For example: "Job salary €48k vs. threshold €45k (rule verified 2026-10-05): meets, thin margin". A thin margin is labelled honestly.

---

## 14. Remote Eligibility Accuracy

**Classes:** Worldwide (open to me) · Region-limited (EU-only, US-only and so on) · Time-zone-limited · Unclear.

- Detect location restrictions and phrases such as "must be based in", "legal entity in", or "authorised to work in".
- Each result stores its **evidence quote and confidence**.
- The default view shows only **Worldwide** and **Unclear** roles, with the count of hidden ones. I can show all.
- Cases hit by an AI check are labelled "AI-checked".

---

## 15. AI Reliability Layer (OpenRouter free key, ~50 calls/day)

**Principle:** rules do the heavy lifting. AI is a small, budgeted helper that must show its evidence.

### Where AI is used
- Extracting facts from long or messy postings when rules aren't sure (visa language, experience, skills, language, remote limits, salary in text)
- Short summaries and "red flags" for my highest-fit jobs
- A suspicious-posting check

### Accuracy safeguards
1. **Strict structured output:** AI must return a fixed structure. Anything else is thrown away.
2. **Evidence check:** for each fact the AI must return the exact quote from the posting. **The system checks that the quote really exists in the text.** If not, the fact is rejected. This removes most made-up answers.
3. **Allowed values only:** for example, visa signal can only be one of a fixed set.
4. **Low creativity settings and short, fixed prompts.**
5. **Conflicts:** if AI disagrees with a rule or record, the higher-trust source wins (section 5) and the case is flagged.
6. **Labelled:** AI facts show "AI-extracted" plus the model name and prompt version.
7. **Untrusted text:** posting text is treated only as data. Instructions hidden inside a posting (prompt injection) are ignored, and the AI's output is always validated by code.
8. **Model changes:** free models change or vanish. Before switching models or prompts, I run them on my hand-checked sample (section 17) and compare accuracy.

### Making 50 calls go far
- Batch several jobs per call
- Only jobs that pass the rule filters or score high
- Cache by content, so the same text is never sent twice
- A daily budget counter stops cleanly at the limit
- Priority queue: top-fit jobs first, the rest wait until tomorrow
- **Everything works without AI.** AI is an upgrade, never a dependency.

---

## 16. Scoring (explainable and testable)

A 0–100 Fit Score built from weighted parts:

| Factor | Notes |
|---|---|
| Role match | Cloud security / DevSecOps highest |
| Experience match | Core band 2–4 years scores highest |
| Visa signal | Heavily weighted, but only by status and confidence |
| Salary vs. floor | Stated salary counts fully, estimated counts less |
| Remote eligibility | Only counts if I can really take it |
| Language | "English OK" beats "local language required" |
| Freshness and liveness | Old, ghost or dead-link jobs drop |
| Skills overlap | AWS, Azure, IAM, Terraform, Kubernetes, GDPR and so on |
| Company signals | Size, reputation, sponsor history |

- The score is **deterministic and versioned**. Same input, same score.
- Every component is saved, so the job page can show **why** it scored that way.
- **Low confidence lowers the score** instead of being treated as neutral.
- Changing weights re-scores from saved data without re-scraping.
- Later, I compare scores with what I actually saved and applied to, to check the weights make sense.

---

## 17. Testing & Measuring Accuracy

### 17.1 Golden sample (my ground truth)
- Hand-label about **200 real jobs** across countries and sources: correct role match, seniority, visa status, remote eligibility, salary, and language.
- Keep it growing: every mistake I find is added to it.

### 17.2 Automatic checks before any rule or prompt change goes live
- Run the sample and compare **precision and recall** for each field.
- Changes that make results worse are blocked.
- Per-source parser tests using the saved raw samples.
- Scoring tests: given a job and settings, expect a known score.
- Visa tests: many small cases including negations and other languages.

### 17.3 Human spot-check (weekly, 15 minutes)
- Open **10 random jobs** and check them against the original posting.
- Log each error with its type. The **accuracy log** shows which areas need work.

### 17.4 Accuracy dashboard
Shows, per field and per source: correct rate on the golden sample, error counts from spot-checks, and the trend over time.

---

## 18. Observability & Alerts

**Daily run report** (also shown in the admin page): for each source, jobs found, new, updated, closed, failed, parse failures, time taken; AI calls used; jobs sent to review.

**Alerts sent to me (Telegram or email):**
- Pipeline **didn't run** at all (a "heartbeat" check that notices the absence of a run)
- A source is silent, paused by the circuit breaker, or its volume dropped sharply
- Parse failures or missing fields spiked (possible site change)
- AI budget exhausted, or AI outputs failing validation
- A visa rule is stale, or an official page changed
- Backup failed

**Logs:** every decision (why a job was hidden, merged, or scored a certain way) can be traced. An **audit trail** records changes to settings, visa rules, overrides and merges.

---

## 19. Frontend: Accuracy You Can See

1. **Dashboard:** today's new top matches, follow-ups due, and a small health strip (sources OK / warning, last run, AI budget).
2. **Jobs list:** filters for country, remote type, role, company size, visa status, salary, posted date, source, fit score, and confidence. A "hidden by filters" counter with reasons, so nothing disappears without me knowing.
3. **Job detail page:**
   - Title, company, location, salary (labelled Stated or Estimated), posted date, "last confirmed live"
   - **Visa & criteria panel:** status, confidence, the evidence quote, source, the country rule with its verified date, and the "Am I eligible?" result
   - Remote eligibility and language, each with evidence
   - Fit score with "why" breakdown
   - Apply link and other sources, with link health
   - **"Report wrong info" button:** records a correction and adds the case to the golden sample
   - **Manual override:** I can fix any field, and my fix survives re-scrapes and is logged
   - Buttons: Save · Mark applied · Hide
4. **Companies:** browse with filters (sponsors visas, size, country) and their evidence.
5. **Country guides:** rules, criteria, salary ranges, best sites, language notes, verified dates, with stale warnings.
6. **My Applications:** the tracker (section 20).
7. **Application kit:** resume and cover-letter templates, per-country CV conventions, tailoring checklist.
8. **Review queue:** possible duplicates, unknown titles, weak company matches, and parse failures waiting for me.
9. **Sources & accuracy:** source health, last run, accuracy dashboard, and AI usage.
10. **Settings:** target roles, countries, salary floor, score weights, alerts.

**UI rules:** show "as of" times everywhere. Estimates look different from facts. Low-confidence items are visibly marked. Nothing is hidden silently.

---

## 20. Application Tracker (safe and complete)

**Stages:** Saved → Applied → Screening → Technical round(s) → Final round → Offer → Accepted
Or ends as: Rejected · Withdrawn · No response

**Robustness**
- **Append-only timeline:** every stage change and comment is a new dated entry. Edits are logged, and nothing is silently rewritten.
- **Snapshot at apply time:** when I mark a job as applied, a copy of the posting (description, requirements, link, salary) is saved, so I can prepare for the interview even if the posting disappears.
- Save which **resume version** I used.
- **Follow-up reminders** with dates, using one consistent time zone.
- Comments for each step: interviewer, questions asked, what went well, next steps.
- **Regular export/backup** of all my applications.

**Stats that teach me:** total applied, rejected, interviews, offers, response rate, average days to reply, and results by country, source and role. Small numbers get a "too few to conclude" note, so I don't over-read them.

---

## 21. Security & Data Safety

- **Backups:** automatic and encrypted, kept off the server, with a **restore test every month**. A backup that has never been restored doesn't count.
- **Access:** secure login for me only, protected admin pages, rate limiting, and lockout after failed attempts. The database user has only the permissions it needs.
- **Secrets:** never in the code or the repository. Keys are rotated if exposed.
- **Untrusted content:** all posting text is cleaned before being displayed, so hidden scripts can't run in my browser.
- **Server:** hardened VPS (key-only SSH, firewall, automatic security updates, minimal open ports, monitoring).
- **Personal data:** my resumes and notes stay private and are included in encrypted backups.
- **Retention:** raw snapshots are removed after 90 days, unless linked to a saved or applied job.
- **Legal register:** each source's terms are recorded with the review date. If a source objects or its rules change, it's switched off.

---

## 22. Application Kit

- **Per-country CV conventions:** length, photo or no photo, personal details, language.
- **Resume versions:** cloud security, DevSecOps, and full-stack. Each is a template I own.
- **Cover letter templates** with fill-in fields. I finish them by hand, or by pasting one job into a free AI chat.
- **Tailoring checklist per job:** the key skills to mirror and one line on why this company.
- **Outreach templates** for recruiters and hiring managers.

---

## 23. Data — What the Database Holds (ideas, not schema)

- **Countries and visa rule versions:** rule text, thresholds, effective dates, verified dates
- **Sources:** grade, terms review date, health, baselines
- **Raw snapshots:** untouched source data with time and parser version
- **Companies, aliases and legal names**, with parent links and sponsor evidence
- **Jobs:** normalised fields, state, first-seen, last-confirmed-live
- **Facts with provenance:** value, evidence, source, method, confidence, checked-at, logic version
- **Job sources:** every place a job appeared
- **Manual overrides, corrections and merges**
- **Golden sample and accuracy results**
- **Applications, events and job snapshots at apply time**
- **Templates and settings**
- **Pipeline runs, dead-letter records, alerts, AI usage and the audit trail**

---

## 24. Build Steps (robust-first order)

**Rule for every step:** read, run and understand it before moving on. Each step ends with a **measurable** "done when".

### Step 0 — Define & start the golden sample (1 day)
- Confirm target roles, countries (Tier 1 first), salary floor, experience band.
- Hand-label the **first 30 real jobs** from a few sites (yours by hand). This is the start of the golden sample.
- **Done when:** settings are written and 30 labelled jobs exist.

### Step 1 — Foundation with safety built in (2–3 days)
- App with login, database, core tables, **audit trail, and automatic backups with one restore test**.
- Fill Tier 1 country rules by hand, with official links and verified dates.
- **Done when:** I can log in, view country guides, and restore a backup.

### Step 2 — First sources, done properly (3–4 days)
- Build the connector pattern with **raw snapshots, isolation, retries, rate limits and run reports**.
- Add two or three grade-A/B sources, each passing the source checklist (section 7.4).
- **Done when:** running twice gives no duplicates, and a deliberately broken source raises an alert without stopping the others.

### Step 3 — Quality gates & normalisation (3–4 days)
- Add validation, dead-letter store, location/title/salary/experience normalisation.
- **Done when:** the golden sample shows correct normalisation on at least 90% of jobs, and bad records land in the review list.

### Step 4 — Dedup & company identity (2–3 days)
- Job de-duplication with a "possible duplicate" review queue, and company aliases.
- **Done when:** duplicates in the list are under 2% on a manual check.

### Step 5 — Jobs list & detail pages with provenance (3 days)
- Filters, the detail page, evidence display, freshness, "report wrong info" and manual override.
- **Done when:** every visible fact has a source and confidence, and an override survives a re-run.

### Step 6 — Tracker (2–3 days)
- Append-only timeline, apply-time snapshot, reminders, stats, export.
- **Done when:** a full journey (Saved → Offer/Rejected) is recorded, and the snapshot still opens after the posting is removed.

### Step 7 — Rules, scoring & testing (3–4 days)
- Role, experience, language and remote rules. The explainable Fit Score. The automatic accuracy check on the golden sample.
- **Done when:** my top 50 are at least 90% relevant, and a worse rule change is blocked by the tests.

### Step 8 — Visa engine (4–5 days)
- Country rule versions with stale warnings, company evidence from public registers with careful matching, posting-text signals with negation handling, the status decision logic, and the "Am I eligible?" check.
- **Done when:** on 50 hand-checked jobs, "Confirmed" has no wrong cases.

### Step 9 — Career pages & scale (ongoing, one country/source at a time)
- Load 100–200 target companies, then add sources country by country, each through the checklist.
- **Done when:** Tier 1 is complete and healthy. Then Tier 2, then Tier 3.

### Step 10 — AI layer (2–3 days)
- Add strict structured output, quote verification, budget counter, batching, caching and fallbacks. Test prompts on the golden sample.
- **Done when:** AI facts without a matching quote are rejected, the budget never breaks the pipeline, and everything works with AI off.

### Step 11 — Monitoring, digest & automation (2 days)
- Daily schedule, run report, alerts (including the "didn't run" heartbeat), the morning digest and reminders.
- **Done when:** I wake up to results, and I get an alert within a day when something breaks.

### Step 12 — Harden & document (2 days)
- VPS and app hardening, monthly restore routine, README and architecture diagram.
- **Done when:** someone else could understand and rebuild it.

### Step 13 — Use it from now on
- Start the daily run early. Six months of data shows which skills, certs and countries appear most.
- Start applying by **month 6** with tailored resumes, whatever the tool's state.

---

## 25. Routines

**Weekly (about 20 minutes)**
- Check source health and the review queue
- Spot-check 10 random jobs and log errors
- Check that stale-rule warnings are handled for countries I'm applying to

**Monthly**
- Verify visa rules for my active countries against official pages
- Restore-test the latest backup
- Review the accuracy dashboard and update weights or rules if needed
- Review source terms for anything that changed

---

## 26. Failure Playbook

| What goes wrong | How it's detected | Automatic response | What I do |
|---|---|---|---|
| A source changes its format | Parse failures or missing fields spike | Pause the source, keep old jobs | Fix the parser, re-run from raw |
| A source goes silent | Volume drop or zero jobs | Don't close its jobs, alert me | Check the site, fix or disable |
| Pipeline doesn't run | Heartbeat missing | Alert me | Check the server |
| Wrong visa status found | My "report wrong info", spot-check | Add to golden sample | Fix the rule, re-process |
| AI invents a fact | Quote not found in posting | Reject the fact | Nothing, or tune the prompt |
| AI limit hit or model gone | Budget counter, API errors | Skip AI, rules only | Switch the model after testing |
| Visa rule is out of date | Stale date or changed official page | Warning on every job in that country | Re-verify and update |
| Bad data merged | Review queue or me | Manual split tool | Split, and the fix persists |
| Server or database lost | Failed backup alert or outage | Restore from backup | Restore and check |
| Site asks me to stop | Terms review or direct contact | Disable the source | Remove its data if asked |

---

## 27. Rules for Myself

1. **Uncertain beats wrong.** "Unknown" is a fine answer. A false "Confirmed" is not.
2. **Every fact needs a source, a date and a confidence.**
3. **Measure, don't assume.** If I change a rule, the golden sample decides.
4. **Loud failures only.** If something breaks, I must hear about it.
5. **Rules first, AI second, and AI must show its quote.**
6. **Understand every module before adding the next.**
7. **Quality applications beat quantity.** The tool finds; I tailor and apply.
8. **The goal is the role in the EU within a year.** If a feature doesn't help that, it waits.
