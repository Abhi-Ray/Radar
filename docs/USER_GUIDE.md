# RADAR — User guide

For the owner, using the site day to day. Running the server is in [OPERATIONS.md](OPERATIONS.md);
the product rules are in [SPEC.md](SPEC.md).

## 1. What RADAR does without you

| When (UTC · IST) | What |
|---|---|
| 00:30 · 06:00 and 12:30 · 18:00 | Collects jobs from every source, cleans and scores them, then tidies the review queues (§6) |
| 01:30 · 07:00 and 13:30 · 19:00 | Lets the AI read the best-matching jobs (free model, at most 50 calls a day) |
| 03:00 · 08:30 | Refreshes the sponsor registers (UK, NL, DK, IE, CA) and matches every company against them |
| 04:00 · 09:30 | Checks the official immigration pages you rely on and raises an alert if one changed |
| every hour | Checks apply links and that a run happened |
| 21:00 · 02:30 | Encrypted backup of the database to GitHub |

Nothing needs you for any of this. Alerts show on **System**; Telegram or e-mail need keys on the
server (see OPERATIONS.md).

## 2. First-time set-up (about 20 minutes)

1. **Sign in.** Email plus password. The session lasts a year on that browser; *Sign out* ends it
   everywhere.
2. **Settings → Profile.** Your passport, degree, years of experience, salary floor, which roles
   are *primary / secondary / fallback*, and your target countries. The Jobs list and Desk show only
   these roles. Save each section; every save is in the audit trail.
3. **Countries → verify the rules.** Open each target country, open the official page linked on the
   rule, compare the numbers, then *Mark verified today* (add a note saying what you checked). A rule
   that was never verified makes the "Am I eligible?" answer say so. Rules are re-checked every 90 days.
4. **Kit.** Add your resume versions and letter templates once; the tailoring sheet on each job uses them.

## 3. The screens

- **Desk.** Today at a glance: the best new matches, follow-ups that are due, and a health strip
  (sources, last run, AI budget, backup, alerts). The "Newest" strip shows only your target roles.
- **Jobs.** Opens on your target roles, best fit first. The bar *"N hidden by filters — Why?"*
  lists every rule that hides something, with a *Show them* link for each, so nothing disappears
  silently: not a target role · region-limited remote · experience outside your band · closed or
  expired · hidden by you. A search, a role filter or a "my jobs" view lifts the target-roles rule.
  Filters live in the address bar, so a view can be bookmarked.
- **A job.** *Can they sponsor you?* (visa status, confidence, the evidence quote, the country
  rule and its verified date, "Am I eligible?"), *Where, which language, how much*, *Why this score*
  (the fit score part by part), *Every fact and where it came from*, the ad as posted and a change log. Buttons: *Save*, *Mark applied* (also snapshots the posting),
  *Hide*, *Report wrong info* (records the correction and adds it to the golden sample), *Override a
  field* (your value wins over every re-crawl and is logged) and *Ask AI for a summary* (uses 1 of
  the day's calls, shows the remaining budget).
- **Tracker.** Your applications from *saved* to *offer*, an append-only logbook, follow-up
  reminders, the posting as it was when you applied, and CSV/JSON export.
- **Companies.** Every employer seen, with the sponsor-register evidence behind each verdict.
  Merge, split and undo-merge for company records are here.
- **Countries.** Rules, salary thresholds, best sites and language notes per country, with dates
  and stale warnings. *Mark verified today* and *Add rule version* live here.
- **Kit.** Resumes, letter templates with fill-in fields, per-country CV conventions, tailoring sheet.
- **Review** — where RADAR asks instead of guessing (§6): possible duplicates, unknown titles,
  postings that look doubtful.
- **Sources.** Every job feed: health, what it fetched against its normal range, terms of use,
  the checklist for going live, *Run now* / *Dry run*. A source that keeps failing pauses itself
  (the circuit breaker); *Reset the breaker* re-arms it.
- **Accuracy.** The weekly 15-minute spot-check (§5), the accuracy log per field and the
  evaluation on your labelled jobs.
- **System.** Runs and what each source brought in, alerts (acknowledge them), backups, postings
  that failed to save, and the audit trail of every change.
- **Settings.** Profile, score weights (must add up to 100), alert thresholds, AI budget,
  how long raw pages are kept.

## 4. Words you will see

**Visa status** (conservative on purpose — a wrong *Confirmed* costs you the most):

| Status | Meaning |
|---|---|
| Confirmed | The posting offers sponsorship, or the company is on an official licensed-sponsor register *in the job's country*, or you noted it after talking to a recruiter |
| Likely | Sponsorship history, a sister company that sponsors elsewhere, relocation support mentioned, a hedged offer, or a *possible* register match. Check the **confidence** next to it |
| Conflicting | The posting argues both ways; both sides are shown |
| Not offered | The posting says no sponsorship / right to work required (it overrides register matches) |
| Unknown | No evidence either way (the honest default) |

**Confidence** is high / medium / low. *Likely · low* usually means "a group company is on a
sponsor register somewhere; check this job's country". AI can raise *Likely* but never *Confirmed*.
**Fit** is a 0–100 score with the factors listed next to it. **Source grade** A–D is how much a feed
is trusted (A = official/structured). **Source status**: draft → trial → live, or paused / disabled.

## 5. Routines

- **Daily, 5 minutes.** Desk → best new matches; Tracker → follow-ups due; save, hide or apply.
- **Weekly, 15 minutes.** Accuracy → the week's ten jobs: open the original posting, mark each field
  *Right / Wrong / Skip*, give the right answer when wrong. Right answers and fixes go into the golden
  sample; 30 labelled jobs make the accuracy numbers meaningful. Then Review, then a glance at System.
- **Monthly.** Countries → any rule whose review is due (open the official page, re-verify). System →
  Backups shows the monthly restore test result. Sources → anything failing or paused.

## 6. What RADAR tidies by itself — and what it never does

After every run (and when you press the buttons on **Review**):

- **Possible duplicates from the same source** are kept as two jobs. When one source lists two
  jobs, it is telling you they are two postings (usually one role in several cities). Exact twins —
  same company, title, city and text — are merged, the older job kept. Pairs from *different*
  sources are never touched: those are the real duplicates and wait for you.
- **Unknown titles with no technical word** (sales, HR, retail, trades …) are marked "not a role I
  track". They were already scored as not-a-target-role, so nothing changes. Titles with a
  technical word wait for you: pick the role they belong to, or "not a role I track".
- Postings that failed to save are kept and retried on the next run; closed postings are marked
  closed; links are re-checked.

It **never** decides a *Confirmed* visa from the AI, merges jobs from different sources without
you, changes your settings or rules, or deletes your data. Every merge, decision and setting change
is in the audit trail (System). *Note:* there is no screen yet to undo a **job** merge (company
merges have *Undo the merge*); it is on the list in [NEXT_STEPS.md](NEXT_STEPS.md).

## 7. If something looks wrong

- **A job is missing.** Jobs → the hidden-by-filters bar → *Why?* → *Show them*, or search by company.
- **Everything says "visa unknown" / "likely · low".** Expected for companies with no register match.
  Sponsor registers refresh nightly; the evidence for a company is on its Companies page.
- **A source is failing.** Sources → that source → the run history and the note on the failing run;
  *Dry run* to test, *Reset the breaker* once it is fixed.
- **A number looks wrong.** Job page → *Report wrong info* (feeds the golden sample) or *Override a field*.
- **The site is slow or down.** Wait a minute after a deploy (the app restarts); otherwise
  [RECOVERY.md](RECOVERY.md).
- **Locked out.** Repeated wrong passwords lock the IP for a while; wait and try again.
  Changing the password: [DEPLOY.md §6](DEPLOY.md).
