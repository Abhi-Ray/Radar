# RADAR — User guide

The complete tour of the site, for the owner: where everything is, what each screen is for, what
every button does, what RADAR does by itself, and — honestly — what is only a label or not built
yet. Written against the live site on 30 Sep 2026. Running the server is in
[OPERATIONS.md](OPERATIONS.md); the product rules are in [SPEC.md](SPEC.md); why things are the way
they are is in [DECISIONS.md](DECISIONS.md).

**Contents:** [The site in one minute](#the-site-in-one-minute) ·
[1 Getting in and around](#1-getting-in-and-getting-around) ·
[2 First-time set-up](#2-first-time-set-up-about-20-minutes) ·
[3 The screens](#3-the-screens-one-by-one) · [4 Recipes](#4-recipes) ·
[5 Words and signs](#5-words-and-signs) · [6 What RADAR does by itself](#6-what-radar-does-by-itself) ·
[7 What works, what is only a label](#7-what-works-what-is-only-a-label-what-is-not-built) ·
[8 If something looks wrong](#8-if-something-looks-wrong)

## The site in one minute

RADAR reads about 200 company career pages and job boards twice a day. For every posting it works
out *what the role is, where it is, what it pays and whether the company can sponsor your visa* —
each fact with its evidence — and ranks the postings against your profile.

Your daily path: **Desk** (what is new) → **Jobs** (browse and filter) → **a job page** (the proof,
then your decision) → **Save** or **Mark applied** → **Tracker** (follow-ups). Around it:
**Companies**, **Countries** and **Kit** are reference; **Review**, **Sources**, **Accuracy**,
**System** and **Settings** are upkeep.

The rule behind everything: a stamp ("Confirmed", "Likely", "Meets") never comes alone — the receipt
(quote, source, method, date) is next to it. Where money or a visa is at stake, open the official
page the receipt points to before you rely on it.

If you only do three things: fill in **Settings → Profile**, open the **Desk** each morning, and on a
job you like press **Save** or **Mark applied**.

## 1. Getting in and getting around

### 1.1 Signing in and out

- Open the site address, enter the owner email and password. There is no sign-up page; anyone else
  only ever sees the sign-in page. A signed-in browser goes straight past it.
- The session lasts **one year** on that browser. **Sign out** ends it at once — even a copied cookie
  stops working. Sign out is at the foot of the left rail (computer) or in the **More** sheet (phone).
- Five wrong tries lock that network address for 15 minutes (the button says *Locked*); repeat
  lockouts double, up to 24 hours. Wrong tries are logged.
- There is no screen yet to sign out *other* devices — see [§7](#7-what-works-what-is-only-a-label-what-is-not-built).

### 1.2 The layout on a computer

A dark **left rail** stays in view. The wordmark at the top always returns to the Desk. Below it,
three groups with a two-digit section code:

| Group | Screens |
|---|---|
| **Hunt** — the job search itself | 00 Desk · 01 Jobs · 02 Tracker |
| **Intel** — reference | 03 Companies · 04 Countries · 05 Kit |
| **Ops** — keeping RADAR honest | 06 Review · 07 Sources · 08 Accuracy · 09 System · 10 Settings |

- **Count badges.** *Review* shows how many things wait for you (possible duplicates + unknown titles +
  failed postings + doubtful jobs). *System* shows unacknowledged alerts, red when one is critical.
- **Foot of the rail:** the signed-in email ("Operator"), **Sign out**, and a small *UI kit ·
  styleguide* link (a design reference page — nothing to do with your job search).
- **Every page** starts with its code and name and a one-line description; most also show an **AS OF**
  chip that says when the page's data was read ("just now"). A *Skip to content* link exists for
  keyboards.

### 1.3 The layout on a phone

- A slim **top bar** shows the wordmark (tap for the Desk) and the code and name of where you are.
- **Bottom tabs:** Desk · Jobs · Tracker · Review · **More**. *More* opens a sheet with the other
  seven screens (Companies, Countries, Kit, Sources, Accuracy, System, Settings), each with a
  one-line description, plus your email, **Sign out** and the styleguide link.
- Filter panels open from a **Filters** button as a drawer. The Tracker shows one stage at a time,
  with tabs to switch.

### 1.4 Every address

| Address | What it shows |
|---|---|
| `/` | Desk |
| `/jobs` | Jobs list. Filters live in the address: `/jobs?sort=posted`, `/jobs?show=roles`, `/jobs?q=Databricks`, `?page=2` … |
| `/jobs/123` | One job |
| `/applications` · `/applications/45` | Tracker · one application |
| `/companies` · `/companies/48` | Companies · one company |
| `/countries` · `/countries/de` | Countries · one country (`?asof=2026-06-01` shows the rules as they were that day) |
| `/kit` | Kit; tabs `?tab=resumes`, `templates`, `conventions`, `tailor` |
| `/review` | Review; tabs `?tab=titles`, `jobs`, `failed` (the first tab, duplicates, has no parameter) |
| `/sources` · `/sources/10` | Sources (`?view=attention`, `live`, `trial`, `draft`, `off`) · one source |
| `/accuracy` · `/system` · `/settings` | Accuracy · System (`?run=7#report` opens run 7) · Settings |
| `/login` | Sign-in |
| `/styleguide` | The UI kit reference page |
| `/api/health` | Public "is it up" check for monitors; says only `ok` and `db` |
| `/api/export/applications?format=…` | The tracker downloads (§3.4) |

Because filters live in the address, you can **bookmark a view**, and the browser **Back** button
returns to the previous filter state.

### 1.5 How the screens link together

- **Desk** → a job card → **the job** → its company name → **the company** → its jobs / its sponsor
  evidence. The job's *Country rules* panel points at **the country**.
- A job's **Mark applied** creates the application in **Tracker**; the job page and the application
  page link to each other, and the application links to its CV in **Kit**.
- **Kit → Tailor for a job** lists jobs you saved or applied to.
- **Desk** health tiles → **System** or **Sources**; the Desk's setup checklist → **Settings**,
  **Accuracy**, **Countries**, **Sources**.
- **Review** cards link to the jobs involved; **System → Runs** links to each run's report.
- A company page has **Its jobs**, which opens Jobs filtered to that name.

### 1.6 Things that work the same everywhere

- **Times** are shown in your time zone (IST) — "30 Sep 2026, 23:32 IST · 4h ago".
- **Receipt tags.** Facts carry a *method* (rule, AI, official record, manual, estimate), a
  *confidence* (high / medium / low) and a check date, so you can tell a proven fact from a guess.
- **Pop-ups** (dialogs) close with **Esc** or **Cancel**. Anything that changes data that matters asks
  for a reason where it counts, and lands in the audit trail (System → Trail).
- After a change, a short confirmation appears in a corner; errors appear in red inside the form.
- Lists show 24 items per page with page links at the bottom.
- There are no keyboard shortcuts beyond the usual (Tab, Enter, Esc, arrow keys in tab bars).

## 2. First-time set-up (about 20 minutes)

1. **Sign in** (§1.1).
2. **Settings → Profile & targets.** Your passport (country code), degree and level, years of
   experience, years in cloud, expected salary and salary floor (€/yr), the *experience bands*, which of
   the 12 roles are **Primary / Secondary / Fallback / Not a target** (pick at least one primary), target
   countries, company types and skills. **Save profile.** The other four forms on that page are fine
   with their defaults; each saves on its own.
3. **Countries → verify the rules.** For each country you care about, open the official page linked on
   the rule, compare the numbers, then **Mark verified today** (and say what you checked). A rule that
   was never verified makes "Am I eligible?" say so. Rules are re-checked every 90 days.
4. **Kit.** Replace the three starter resumes' `[placeholders]` with your real text; add the letters
   you use. The tailoring sheet on each job uses them.
5. The **Desk → Calibrate the station** box tracks four steps — settings written, 30 golden samples
   labelled, target countries verified, a source put live — and disappears when they are done. The last
   one is optional in practice; see §3.9.

## 3. The screens, one by one

### 3.1 Desk (00) — `/`

**For:** your morning look. Nothing here needs a decision; it tells you where to look.

Top to bottom:

1. **Newest** — a scrolling strip of the newest jobs in your target roles: *title · company*, then
   *country · fit score*. Click a title to open the job. **Pause ticker** stops the movement.
2. **Station health** — five tiles: *Sources* (how many run, warnings, paused), *Last run* (kind,
   result, when), *AI budget today* (used of 50), *Last backup*, *Open alerts* (the first alert's
   text). Each opens Sources or System.
3. **Calibrate the station** — the four-step setup box (§2), with a button per step.
4. **Today's top matches** — the six best-fit jobs first seen since midnight, in your default view.
   *"N new today · list newest"* opens Jobs sorted by newest.
5. **Follow-ups due** — sticky notes for tracker follow-ups and reminders due today or overdue (ten at
   most), overdue first. **Done** closes a reminder and writes it in the logbook. Empty = "Nothing due today".
6. **On the radar** — the scope picture. Each dot is one of the 24 best jobs in your default view:
   *distance from the centre = fit* (closer is better), *direction = region* (clockwise from north:
   Nordics & Baltics, Asia-Pacific, Americas, Southern & Western Europe, Remote / worldwide,
   Elsewhere), *colour = visa status*, *a ring = first seen today*. **As a list** has the same jobs as
   text, grouped by region.

The Desk and Jobs use the same **default view** (§3.2), so a job you hid or a non-target role never
shows here.

### 3.2 Jobs (01) — `/jobs`

**For:** browsing, searching and filtering every job RADAR holds. **Opens on your target roles, best
fit first.**

**The list.** A heading like *"507 jobs · showing 1–24"*; sort links (**Best fit**, **Newest posted**,
**Highest salary**); page links at the foot. Each **job card** shows, in this order: company, a
**NEW** badge (if new), the title, the place and work mode, the **FIT** score, the **visa status** with
its confidence, the **eligibility** verdict (§5), the salary (or *not stated*, or an *estimate*), a
data-confidence chip, **SEEN** (when RADAR first saw it), **LIVE** (when its apply link last still
worked; *never* = not checked yet) and the best source grade with the number of sources ("A · 2 SRC").
Cards are links; there are no save/hide buttons on them — you do that on the job page.

**The filters** (a panel beside the list; on a phone the **Filters** button). **Apply filters**
submits; **Reset** clears. Groups:

| Group | Fields |
|---|---|
| Top | **Search** (title or company) · **Sort by** |
| Visa & money | **Visa status** (Confirmed / Likely / Unknown / Not offered / Conflicting) · **Salary at least** (annual €; the top of the range must reach it) · **Stated salary only** (leaves out estimates) |
| Where | **Country** (with counts) · **Remote** (Worldwide / Region-limited / Time-zone-limited / Unclear / Not remote) |
| Role & company | **Role family** (Primary target / Secondary target / Fallback / Other) · **Role** (with counts) · **Company size** · **Company type** (Startup / Scale-up / Mid-size / MNC / Agency / Unknown) |
| Quality & freshness | **Fit at least** · **Confidence** (Any / Medium+ / High+ / Low+ known) · **Posted within** (24 hours … 90 days) · **Source** (which feed) · **State** (New / Active / Updated / Stale / Closed / Expired / Suspicious) |
| Mine | **Only jobs I…** Saved / Applied / Hidden |
| Default view | the "left out unless you ask" boxes below |

**The default view — nothing is hidden silently.** RADAR leaves some jobs out of the list on
purpose. A bar under the sort links says **"N hidden by filters — of M on the scope · K shown"** with
a **Why?** link listing each rule that hides something, how many it hides, and a **Show them** link:

| Rule (as worded on screen) | What it leaves out | How to see them |
|---|---|---|
| Not one of your target roles | Jobs whose role is not one you track — the large majority, because whole company boards are collected — except jobs you saved or applied to | *Show them*, or tick **Not one of my target roles**. A search, a role or role-family filter, or **Mine** lifts it by itself |
| Remote, but region- or time-zone-limited | Remote jobs limited to a region or time zone | *Show them* / **Region / time-zone-limited remote** |
| Experience ask outside your band | Years asked beyond your *hide below / hide at or above* limits (Settings) | *Show them* / **Outside my experience band** |
| Closed or expired | Postings that are gone | **Closed or expired** |
| Jobs you hid | Jobs you pressed *Hide* on | **Jobs I hid**, or **Mine → Hidden** |

**Show everything** ticks all of them at once. The "on the scope" figure counts every job RADAR holds.

### 3.3 A job — `/jobs/123`

**For:** deciding. Everything on the page is a claim with a receipt.

**Header:** job number and state, *facts as of* time, company (link), title, place, work mode,
region, salary, dates (*posted · first seen · last live · closes*), data confidence, the **fit** score
with its band, the **visa** chip and the **eligibility** chip.

**Buttons** (under the header):

| Button | What it does |
|---|---|
| **Apply on site** | Opens the original posting in a new tab |
| **Save** / *Saved* | Toggles your shortlist (**Mine → Saved**, and the Kit's *Tailor* list). Does **not** create a tracker entry |
| **Mark applied** | Asks for an optional note, then logs an application at stage *applied* **and keeps a copy of the posting text** in case the ad disappears. If the tracker already has the job it moves *saved → applied* and never backwards. Afterwards a button **In tracker · applied** opens the application |
| **Hide** | Optional reason. The job leaves the default list and the Desk; nothing is deleted. A hidden job shows an **Unhide** button |
| **Report wrong info** | Pick the field, give the right answer (or say you don't know and describe the problem), optionally apply it as an override. Recorded as a correction and added to the **golden sample** that measures RADAR's accuracy |
| **Override a field** | Pick a field, give your value and a **reason** (3–500 characters). Your value beats every automatic source and every re-crawl; it is logged and can be removed later (*Remove override*, also with a reason) |

**Jump links** under the buttons: Visa · Receipts · Fit · Provenance · Sources · Posting · History.

**Sections, in order:**

- **A · Can they sponsor you?** — the visa status, its confidence, the reason in plain words with the
  evidence quote and where it came from. If the evidence disagrees, both sides are listed (*For
  sponsorship* / *Against*). **Country rules** shows the rule(s) of the job's country, or "no country
  resolved" for worldwide jobs. **Am I eligible?** compares your profile with the country rule
  (*Meets / Borderline / Doesn't meet / Can't tell*) and says why; *Check my profile* opens Settings.
  A small **Wrong?** button next to a fact starts *Report wrong info* for that field.
- **B · Where, which language, how much (Receipts)** — remote class and regions, language
  requirement, salary (stated, or an *estimate* clearly labelled — **Set it** lets you enter it),
  years of experience asked, seniority. Each has its evidence quote, source, method, confidence, date
  and the version of the logic that produced it.
- **C · Why this score** — the fit score out of 100, split into nine parts (role match, experience
  fit, visa, salary, remote, language, freshness, skills, company), the points earned of the points
  possible, and a reason for each. Weak evidence counts for less; the weights are yours (Settings).
- **D · Every fact and where it came from (Provenance)** — every candidate value for each field, which
  one is shown, and which ones disagree ("1 conflict"). Trust order: **manual → official → posting →
  rule → AI → estimate**; a lower level never overwrites a higher one. *Override* / *Report wrong*
  buttons per field; *Posting fields* (title, country, city, workplace) have **Edit** = override.
- **E · Seen in N places (Sources)** — each feed that lists it: the apply-link check (*link OK*, HTTP
  status, time), source grade, terms status, first and last seen, **Open on …**.
- **F · The ad, as posted** — the posting text (formatting stripped to a safe subset) and its language.
- **G · Change log (History)** — what changed since RADAR first saw the job.
- **H · AI summary** — a short summary from the free AI model. It costs **1 of the day's 50 calls**
  (the meter shows used/left); cached answers are free; every quote is checked against the posting.
  **Ask again** re-runs it. The AI never sets a *Confirmed* visa.
- **I · Overrides** — your manual overrides in force, with reasons, and *Remove override*.
- **J · Corrections reported** and **K · Your application** appear when there are some.

### 3.4 Tracker (02) — `/applications`

**For:** every application from *saved* to *offer*, with its logbook, reminders and statistics.
Stages only move forward — a step back is a *correction* with a reason, never an edit.

**On the page**

- **Log an application** — for a job RADAR never saw (a referral, a company site, a recruiter mail).
  Fields: Company\*, Job title\*, Stage (default *applied*), Applied on, Country, Source, Resume
  version, Posting link, Note, and an optional **Paste the posting text** (kept as the snapshot).
  **Log it** opens the new logbook.
- **Reminder notes** — follow-ups due or coming up within a few days, overdue first, each with **Done**.
- **What the replies say** — *Applied* (how many are still open), *Response rate*, *1st reply* (time),
  *Interviews* (and offers), *No reply / rejected*. **Break the stats down by** country, source or
  role; rows with too few applications are hatched "Too few to conclude".
- **Filters** — **Search** (company or job title), the quick boxes **Follow-up due** (due today or
  overdue) and **Open only** (hides accepted, rejected, withdrawn and no-response), and the **Country**
  and **Source** lists. The stage is the board column (on a phone, the tab).
- **The board** — one column per stage: Saved · Applied · Screening · Technical · Final · Offer ·
  Accepted · Rejected · Withdrawn · No reply. A card shows the job, company and whether a follow-up is
  overdue; click it to open the application. The most recently updated cards are shown (a notice says
  when it is capped). On a phone: one column at a time.
- **Export** — *Everything · JSON*, *Applications · CSV*, *Logbook · CSV*, *Snapshots · CSV*. Always the
  whole tracker, not just the current view.

**Stage rules.** Forward only. *Rejected* and *No response* need *Applied* first. *Withdrawn* is always
allowed. *Technical* can repeat (one entry per round). *Accepted*, *Rejected* and *Withdrawn* are
closed; reopening is a correction. A late reply moves *No response* to *Screening* or later.

**An application — `/applications/45`.** A breadcrumb, a header (title, company, stage, dates) with
**Edit the details** (company, title, country, source, applied-on, outcome; every change logs old and
new value), then:

- **A · Logbook — what happened, in order.** The append-only timeline. *Add to the logbook*: a comment
  and/or interview notes (interviewer, questions asked, what went well, next steps) with an optional
  time.
- **B · Move it along.** Pick the next stage (only sensible moves are offered) with an optional note; tick
  **This is a correction** to move anywhere, with a reason.
- **C · Next nudge.** **Set follow-up** (or **Move / Clear follow-up**): quick picks in days, a day,
  a time (default 10:00) and a note. The default gap is 7 days. Due reminders show on the Desk.
- **D · What you applied to.** The saved copy(ies) of the posting. **Copy the posting again** takes a
  fresh snapshot.
- **E · CV that went out.** Which resume version you sent; a link opens it in the Kit.

### 3.5 Companies (03) — `/companies`

**For:** checking an employer, and recording what you learn about sponsorship.

**The list** — every employer RADAR has seen (609 on 30 Sep). Filters: **Search** (name, other names or domain), **Sponsor
evidence**, **Size**, **Type**, **HQ country**, **Agency**, **Sort** (most open jobs, name A–Z, recently
updated). Quick chips at the top: *Confirmed sponsor*, *Possible sponsor*, *No sponsor evidence*, *No
agencies* (each with a count). A card shows the name, domain, sponsor stamp, HQ country, type,
*"3 registers · newest 2026-09-30"*, *"· 2 to check"* (possible matches to verify), open jobs, and
*"#48 · +2 names"* (other names it is known by).

**A company — `/companies/48`.** Header: name, website, type, HQ, size, open jobs (and how many were
ever seen), applications, on file since; buttons **Its jobs**, **Mark as agency**, **Set a parent**.

- **A · Receipts, not guesses.** The sponsor verdict and the **register receipts**: each entry from an
  official sponsor list (UK Home Office, Dutch IND, Danish SIRI, Irish DETE, Canadian LMIA) — the name
  listed, how it matched (*exact name*, *brand + country qualifier* …), country, route, town, rating,
  quote, source and confidence. A *possible* match says "check the town and legal name".
  **Your notes**: what you learned yourself. **Add your own evidence** — *Does X sponsor visas?* Yes /
  No, **How do you know** (required: who, where, when), an optional link, **Record the note**. Your
  note never edits a register match and a newer note supersedes an older one.
- **Jobs** — the company's jobs RADAR has seen.
- **Who this is** — its other names, its family (parent / children) and **Fix the record**: **Split
  names off**, **Merge another record in**. Company merges have an **Undo the merge**.
- **Applications** — your applications to it.

"No evidence" means nothing was found — **not** that they refuse to sponsor.

### 3.6 Countries (04) — `/countries`

**For:** the visa rules per country, each with its official page and the day it was last checked.

**The list.** Four tiles — *Live*, *Rules verified* (countries whose rules were checked within 90
days), *Stale or unverified*, *Pages to review* (official pages that changed) — then the countries by
tier (Remote / Worldwide; Tier 1 EU core; Tier 2 Nordics & Central/Eastern Europe; Tier 3 other
high-pay markets; Tier 4 Middle East & other). A card shows the name, region and currency, an
**On/Off** stamp, a rules marker (*verified / stale / unverified / no rules yet*), the number of visa
routes and the next review date. Some countries have no visa route on file yet ("Can't tell").

**A country — `/countries/de`.** Header with the marker, language, currency, routes in use, next
review, the tier and a **Switch live / Switch off** button (§7 explains what it does — and does not do).

- **A · Visa rules — in effect today.** One block per route (for example *EU Blue Card*): the salary
  threshold, degree, experience, when it is in effect, **last verified**, **next review**, *why this
  version*, the evidence quote and the **Official page** link. Buttons: **Mark verified today**
  (opens a dialog for a note about what you checked) and **Add rule version** (when the rules
  changed; old versions stay in *Version history*). **See the rules as of [date] · Show** time-travels.
- **B · Change log** — every verification and version, newest first, with the why and the source.
- **C · Official pages** — the immigration pages RADAR watches, when each was last fetched, and a flag
  when one changed. The watcher runs daily at 04:00 UTC; a page reads "not checked yet" until then.
- **D · Salaries** — typical ranges by track and seniority, labelled *EST.* with their source.
- **E · Where to look** — best job sites, languages, notes. **F · CV conventions** — "A CV for …":
  the country's CV conventions and your convention template.

A rule counts as **verified** only after a person compared it with the official page. Unverified rules
make "Am I eligible?" answer *Can't tell* or *Borderline*.

### 3.7 Kit (05) — `/kit`

**For:** your application documents. Four tabs, with counts:

- **Resumes** — the versions list (name, track, when last sent) and **New version**. The editor has
  **Version name**\*, **Track** (Cloud security / DevSecOps / Full-stack / Other), **File note** (where
  the PDF lives) and **Resume text (Markdown)**\* with a live **Preview** and word count. **Save
  changes**, **Save as a new version**, **Delete**. Only the text is stored, not the PDF.
- **Templates** — 60 starters: cover letters by country (Germany, Ireland, UK, Netherlands & Nordics,
  general EU), outreach messages (ask about visas, follow-up, hiring manager, recruiter, referral,
  thank-you), a per-job tailoring checklist, and one CV-convention note per country. Pick one and fill
  the fields at the top (*My name, city, email, phone, Company, Hiring manager, Company address, Date,
  Role, Job reference …*): the text updates live. **Copy text** or **Copy Markdown**, **Clear the
  fields**. **Change the wording** edits the template itself; **Save template**; **New template**.
- **CV conventions** — one card per country: length, photo, personal details, language, format,
  cover letter, references, plus a "before sending" checklist. *Country guide* opens the country;
  *Edit* opens the template. They are general hiring practice — the posting's own instructions win.
- **Tailor for a job** — pick a job you saved or applied to; the sheet lists the skills to mirror
  from the posting, the gaps, a *why this company* draft and a checklist to tick.

### 3.8 Review (06) — `/review`

**For:** the questions RADAR asks instead of guessing. **Nothing here is decided for you.** Four tabs:

- **Possible duplicates** — pairs of jobs that may be one posting, highest match first, with why they
  look alike (same company, same title, same city, description % similar …). **Same job — keep
  left / keep right** merges them (the kept job takes the other's links); **Different jobs** keeps
  both. Every merge is in the audit trail; a *job* merge cannot be undone from a screen yet.
- **Unknown titles** — titles RADAR cannot place, most common first, with how many times each was
  seen and an example company. **This title is a…** picks one of your roles (or *Not a role I track*)
  and **Save** applies it to new and re-processed jobs.
- **Needs a look** — jobs flagged as doubtful; **Looks fine** clears the flag.
- **Parse failures** — postings that could not be saved; they are kept and retried by the next run.
  The list with reasons is on System.

Above the pairs, buttons appear when there is bulk work: **Merge N exact twins**, **Keep both for N
pairs**, **Ignore N unrelated titles** (§6 explains what those do). After every crawl RADAR runs them
itself, so they are normally empty.

### 3.9 Sources (07) — `/sources`

**For:** the job feeds RADAR reads and whether they are healthy.

**The list.** Tiles: *Sources* (live · trial · draft), *Healthy*, *Need attention*, *Last run*. View
chips: **All · Needs attention · Live · Trial · Draft · Paused / off**; **Find a source**. The table
columns are source, health, platform (with its grade), country, a sparkline of jobs fetched per run,
last run and the checklist progress (e.g. 3/7). **+ Add a source** at the foot of the list: **Connector**\* (the kind
of feed), **Label**\*, **Country**, **Config (JSON)**\* → **Add as draft**. A draft does not run until
you start its trial.

**A source — `/sources/10`.**

- **A · Status & controls.** The health verdict and what to do next; *last run*, *last success*,
  *failed in a row*, raw snapshots and jobs linked. **Promote to live**, **Pause**, **Disable** (each
  with an optional reason), **Run now** and **Dry run** (queued for the worker within a minute; a dry
  run changes nothing), **Reset the baseline** (needs a reason), and **Reset the breaker** when the
  source has failed so often that it paused itself.
- **B · Volume & runs.** *What it fetched lately* against its normal range, and the recent runs table.
- **C · Definition of done.** The 7-point **promotion checklist**. Most ticks itself (terms recorded,
  samples saved, parser clean, baseline from 5+ healthy runs, rate limit set, alerts on). One is
  yours: **I checked this** — "20 jobs checked by hand against the original site".
- **D · Configuration.** Label, country, config JSON, notes → **Save configuration**.
- **E · Platform & terms.** The platform's grade, access method and rate limit; **Terms of use say**
  (allowed / restricted / unknown / forbidden), *reviewed on*, terms URL, notes → **Record the review**.
- **F · Every change to this source.**

**Trial vs live.** Both **trial** and **live** sources run in every daily crawl and their jobs appear
in Jobs. *Live* only means you signed the source off with the checklist. So the Desk's "Put a source
live" step stays open until you do that for at least one source; it does not mean nothing is arriving.

### 3.10 Accuracy (08) — `/accuracy`

**For:** measuring how right RADAR is, in 15 minutes a week.

- **Tiles:** *Golden sample* (labelled jobs, target 30+), *Spot-checks this week* (of 10), *Correct
  rate*, *Last evaluation*.
- **A · This week's spot-check.** Ten jobs. For each: open **Original posting**, then for every field
  (role, seniority, visa status, remote, salary, language, country, minimum years) mark **✓ Right**,
  **✗ Wrong** (then give the true value and a note) or **Skip** if the posting does not say. **Log this
  job.** Right answers and your fixes both go into the golden sample.
- **B · Accuracy log — last 12 weeks.** The weekly correct rate per field.
- **C · Evaluation on the golden sample.** **Run the evaluation** compares what RADAR computes today
  with your labelled answers, field by field. Numbers below 30 samples mean little.

### 3.11 System (09) — `/system`

**For:** "is the station healthy?" and the audit trail.

Tiles: *Last run*, *Open alerts*, *Backup*, *AI today* (used/left, UTC day), *Jobs on file*, *Failed
items waiting*, *Version* (the deployed commit).

- **A · Pipeline — Runs.** The latest runs (kind, result, start, duration, sources, new, updated, failed
  items, who started it). **Run all sources now** queues a full crawl (about 35–40 minutes; do not
  deploy meanwhile); **Dry run (change nothing)** tests it. The worker picks them up within a minute.
- **B · Run report.** Click a run number: per-source results, what it brought in, problems first.
- **C · Alerts.** Warnings and notes (including the morning digest); **Acknowledge** one or **Acknowledge
  all**. Every alert always shows here; pushing them to Telegram or email needs server keys.
- **D · Safety — Backups.** The last good backup, the list of backups and restore tests. Encrypted dumps
  are pushed to GitHub every day at 21:00 UTC, replacing the previous one; a restore test runs monthly.
- **E · Data quality — Failed items.** Postings that could not be saved, with the stage and reason.
- **F · Trail — Everything that was changed.** The audit log: logins, rule verifications, merges,
  settings saves, overrides, AI disagreements … newest first.

### 3.12 Settings (10) — `/settings`

**For:** who you are, what you are looking for, how jobs are scored, when RADAR speaks up. Five
separate forms, each with its own save button; **every save is logged**. If you changed the same form
in another tab, the save is refused so nothing is overwritten by a stale copy.

| Form | What is in it |
|---|---|
| **Profile & targets** | Passport, degree and level, years of experience and in cloud, expected salary, salary floor, *experience bands* (core / show / hide below / hide at or above), **target roles** (12, each Primary / Secondary / Fallback / Not a target), target countries, company types, skills |
| **Score weights** | Nine weights (role match, experience fit, visa, salary, remote, language, freshness, skills, company); must add up to 100 |
| **When RADAR speaks up** | Push to Telegram / email, morning digest, minimum severity, digest hour (local), heartbeat hours, volume-drop / spike %, parse-failure %, field-drift points |
| **AI budget** | Use the AI on/off, daily limit (can only be lowered from the server's 50), calls kept for manual asks (5) |
| **Data retention** | How many days raw pages are kept (14) |

What the profile fields do: the **primary** roles count most in the score and **fallback** roles are
shown but ranked lower; roles you set to *Not a target* fall under "not one of your target roles" in
the default view. The **salary floor** and **expected salary** feed the salary part of the score. The
**experience bands** drive the "outside your band" rule. **Company types** you untick get 0 for
the "company signals" part of the score. **Skills** feed the skills part of the score. **Target countries** are only
used by the Desk checklist (§7).

### 3.13 Sign-in, sign-out and the styleguide

- **Sign-in `/login`** — email + password + *Sign in*. It shows the lockout rule and "stays signed in
  on this device for 1 year". Private instance, not indexed, no sign-ups.
- **Sign out** — the button in the rail / More sheet (§1.1).
- **Styleguide `/styleguide`** — the UI kit (colours, buttons, badges). It is a developer reference, not
  part of the job hunt.

## 4. Recipes

### 4.0 Routines

- **Daily, 5 minutes.** Desk → the best new matches → open one → **Save**, **Hide** or **Mark applied**.
  Tracker → reminders → **Done** / **Move follow-up**.
- **Weekly, 15 minutes.** Accuracy → this week's ten jobs. Then Review (duplicates, titles), then a
  glance at System (alerts, failed items).
- **Monthly.** Countries → any rule whose review is due. System → Backups (is the monthly restore test
  green?). Sources → anything failing or paused.

### 4.1 Finding and judging jobs

- **Only jobs that can sponsor me in Germany.** Jobs → **Visa status**: Confirmed + Likely; **Country**:
  Germany → *Apply filters*. Add **Confidence: Medium+** to drop the "sister company elsewhere" guesses.
- **Everything at one company.** Company page → **Its jobs**, or Jobs → **Search** the name.
- **A role I don't see.** Jobs → the *hidden by filters* bar → **Why?** → **Show them**; or search for it.
- **Newest first.** Desk → *N new today · list newest*, or Jobs → **Newest posted**.
- **Why did this job get 62?** Job page → **C · Why this score**.
- **Can I trust "Likely"?** Job page → **A**: read the quote and the confidence. *Likely · low* usually
  means a group company is on a sponsor list somewhere — check this job's country.

### 4.2 Applying and following up

1. On a job: **Save** (shortlist) and/or **Kit → Tailor for a job** for the skills to mirror.
2. Write the letter from **Kit → Templates**, fill the fields, **Copy text**.
3. Apply on the original site (**Apply on site**), then **Mark applied** (add which CV you used).
4. Tracker → the application → **Next nudge** → **Set follow-up**.
5. When a recruiter replies: **Move it along** to the new stage; write the call notes in the logbook.
6. A job you applied to outside RADAR: Tracker → **Log an application**.

### 4.3 Fixing what RADAR got wrong

- **A fact is wrong once, and you want it counted:** job page → **Report wrong info** (feeds the accuracy
  numbers). Tick "apply as an override" if you also want the page corrected.
- **You simply know better:** **Override a field** (or **Edit** in the provenance list). Your value survives
  every re-crawl. Undo it with **Remove override**.
- **A company's sponsorship:** Company page → **Add your own evidence** (Yes/No, how you know, link).
- **Two records for one employer:** Company page → **Merge another record in** (undo: **Undo the merge**).
- **A title RADAR cannot place:** Review → **Unknown titles**.
- **Two jobs that are one posting:** Review → **Same job — keep left / right**.

### 4.4 Keeping the rules honest

- **Check a country's rule:** Countries → the country → open the **Official page** → compare with the
  numbers → **Mark verified today** and write what you checked. If the rule changed: **Add rule version**.
- **Change what a "good match" is:** Settings → **Target roles** and **Score weights**.
- **Change what counts as too junior/senior:** Settings → **Experience bands**.

### 4.5 Sources and data

- **Add a feed:** Sources → *Add a source* → the source page → **Start trial** → watch a couple of runs →
  work the checklist → **Promote to live**.
- **Test a feed without touching data:** the source page → **Dry run**.
- **Crawl now:** System → **Run all sources now** (or one source: **Run now** on its page).
- **A feed keeps failing:** its page → recent runs and the failing run's note; fix the config, **Dry
  run**, then **Reset the breaker**.
- **Export my applications:** Tracker → *Export*.

### 4.6 What can be undone

| Action | Undo |
|---|---|
| Save | Press **Saved** again |
| Hide | **Mine → Hidden** (or **Jobs I hid**) → open the job → **Unhide** |
| Override a field | **Remove override** |
| A company merge | **Undo the merge** |
| A wrong stage in the tracker | Move it back with **This is a correction** (logged) |
| A follow-up | **Clear follow-up** |
| A **job** merge in Review | **Not possible from a screen yet** |
| Marked a rule verified | Add a new rule version, or verify again; the change log keeps both |

## 5. Words and signs

**Visa status** (conservative on purpose — a wrong *Confirmed* costs you the most):

| Status | Meaning |
|---|---|
| **Confirmed** | The posting offers sponsorship, or the company is on an official licensed-sponsor register *in the job's country*, or you noted it after talking to a recruiter |
| **Likely** | Sponsorship history, a sister company that sponsors elsewhere, relocation support mentioned, a hedged offer, or a *possible* register match. Check the **confidence** next to it |
| **Conflicting** | The posting argues both ways; both sides are shown |
| **Not offered** | The posting says no sponsorship / right to work required (it overrides register matches) |
| **Unknown** | No evidence either way — the honest default |

**Eligibility** ("Am I eligible?", your profile against the country rule): **Meets** · **Borderline**
(thin margin, an estimated salary, a stale rule, or one criterion uncertain) · **Doesn't meet** ·
**Can't tell** (no salary or no verified rule to compare against).

**Confidence** is high / medium / low. *Likely · low* is a lead, not an answer. AI can support
*Likely* but never *Confirmed*.
**Fit** is 0–100: **Strong** 80+, **Good** 60–79, **Fair** 40–59, **Weak** below 40, or *Unscored*.
**Source grade** A–D is how much a feed is trusted (A = official / structured). **Source status**:
draft → trial → live, or paused / disabled. **Job state**: New · Active · Updated · Stale · Closed ·
Expired · Suspicious. **Circuit breaker**: a source that keeps failing pauses itself.

**Method tags** on receipts: *Rule* (a fixed rule read it from the text), *AI*, *Official record* (a
register or government page), *Manual* (you), *Estimate*. **Trust order:** manual → official →
posting → rule → AI → estimate. **Golden sample:** jobs whose right answers you confirmed; the yardstick
for accuracy.

**Tracker stages:** Saved → Applied → Screening → Technical round → Final round → Offer → Accepted; or
Rejected · Withdrawn · No response.

## 6. What RADAR does by itself

| When (UTC · IST) | What |
|---|---|
| 00:30 · 06:00 and 12:30 · 18:00 | Collects jobs from every source that is on trial or live, cleans and scores them, tidies the review queues, sends the digest (35–40 minutes) |
| 01:30 · 07:00 and 13:30 · 19:00 | Lets the AI read the best-matching jobs (free model, at most 50 calls a day, 5 kept for you) |
| 03:00 · 08:30 | Refreshes the sponsor registers (UK, NL, DK, IE, CA) and matches every company against them |
| 04:00 · 09:30 | Checks the official immigration pages you rely on and raises an alert if one changed |
| 05:00 · 10:30 | Deletes raw page copies older than the retention setting, old caches and login attempts |
| 15:30 · 21:00 | Refreshes the ECB exchange rates used for salaries |
| every hour | Checks 150 apply links (:15) and that a run happened recently (:05) |
| every minute | Starts runs you queued from Sources or System |
| 21:00 · 02:30 | Encrypted backup of the database to GitHub (monthly restore test on day 1) |

Nothing here needs you. After every crawl RADAR also tidies two queues:

- **Possible duplicates from the same source** are kept as two jobs — when one source lists two jobs it
  is telling you they are two postings (often one role in several cities). *Exact twins* — same
  company, title, city and text — are merged, the older job kept. Pairs from *different* sources are
  never touched: those are the real duplicates and wait for you.
- **Unknown titles with no technical word** (sales, HR, retail, trades …) are marked "not a role I
  track". They were already scored as not-a-target-role, so nothing changes. Titles with a technical
  word wait for you.

It **never** sets a *Confirmed* visa from the AI, merges jobs from different sources without you,
changes your settings or rules, or deletes your data. Postings that failed to save are kept and
retried; closed postings are marked closed. Every merge, decision and setting change is in the audit
trail (System).

## 7. What works, what is only a label, what is not built

**Working and checked on the live site (30 Sep 2026):** sign-in and sign-out (a signed-out cookie is
refused), all screens, the filters and the hidden-by-filters bar, job pages with their receipts,
Report wrong info / Override, Countries verification (11 rules verified against official pages),
Sources controls, Review actions, System, Settings, the encrypted backup and its restore test.
The **Tracker has never been used with real data** (it is empty); its flow was tested end to end on a
copy of the database.

**Labels that promise more than they do:**

| Where | It suggests | What is true today |
|---|---|---|
| Countries → **Switch live / off** | Live countries' jobs are "in scope" | It records your decision and requires a verified rule. **The Jobs list and Desk do not use it** — jobs from every country show either way |
| Settings → **Target countries** | Which countries are searched | Only the Desk checklist ("verify your target countries") uses them; they do not filter or re-rank jobs |
| Settings → **Salary floor** | Hides jobs paying less | It only lowers the salary part of the score |
| Sources → **Live** | Live sources feed the scope | Trial sources feed it too; *Live* is your sign-off (20 jobs checked by hand) |
| Settings → **Telegram / email** switches | Pushes alerts to your phone | Nothing is pushed until the server has Telegram or SMTP keys (OPERATIONS.md) |
| Any **salary marked EST.** | A salary | A guess from an indicative table — never use it for a visa threshold |

**Not built yet** (all in [NEXT_STEPS.md](NEXT_STEPS.md)):

- No screen to **see or end other sessions**; sign-out ends only the current browser. To end every
  session at once, rotate `SESSION_SECRET` ([DEPLOY.md §6](DEPLOY.md)).
- No screen to **undo a job merge**.
- No save/hide buttons on job cards (only on the job page).
- 27 visa rules are still **unverified**, including Germany's (the official site blocks automated
  readers — check the two Blue Card figures in a browser). The watched-pages check has not run yet in
  production; its first run is 04:00 UTC.
- No calendar feed for follow-ups, and the same role posted in several cities is still several cards.

## 8. If something looks wrong

- **A job is missing.** Jobs → the hidden-by-filters bar → **Why?** → **Show them**, or search for the
  company. If it is a target-role job, check it was not hidden by you (**Mine → Hidden**).
- **Everything says "visa unknown" or "likely · low".** Expected where a company has no register match.
  Registers refresh every night; a company's evidence is on its page.
- **A source is failing.** Sources → that source → the run history and the failing run's note →
  **Dry run** → **Reset the breaker**.
- **A number looks wrong.** Job page → **Report wrong info** or **Override a field**.
- **The Desk says "Last run: Skipped".** A queued run that was cancelled before it started; the next
  daily run replaces it.
- **The site is slow or shows an error right after a change.** The app restarts on every deploy; wait
  a minute. Otherwise [RECOVERY.md](RECOVERY.md).
- **Locked out.** Wait out the lockout (§1.1). Changing the password: [DEPLOY.md §6](DEPLOY.md).
