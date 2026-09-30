# RADAR — Decisions and lessons

Short records of choices that are not obvious from the code, newest last. Each says what was decided,
why, and what it costs. Product rules are in [SPEC.md](SPEC.md); the running system is in
[OPERATIONS.md](OPERATIONS.md).

**1. One shared VPS, Docker Compose, a free `sslip.io` name (2026-09-29).**
RADAR is the compose project `radar` in `/opt/radar`, published only on `127.0.0.1:3100`, behind one
new nginx vhost. Nothing else on the server was touched. `radar.187-127-129-127.sslip.io` resolves
to the VPS without owning a domain, and Let's Encrypt issues a normal certificate for it.
*Cost:* the name embeds the IP; moving to a real domain is DEPLOY.md §7.

**2. The repository is public; secrets are not in it (2026-09-29).**
Code, docs and the *encrypted* production env (`ops/secrets.env.enc`) and database dumps
(`db-backups`) are on GitHub so nothing is lost with the laptop or the server. The passphrase
(`BACKUP_PASSPHRASE`) lives only in your password manager and the server's `.env`.
*Cost:* the code, the VPS IP and the encrypted blobs are visible to anyone. *Recommended:* make the
repo private, then point `/opt/radar` at the deploy key over SSH (the auto-deploy pulls over public
HTTPS today).

**3. The gate is the proxy, backed by the database (2026-09-30).**
`src/proxy.ts` checks the session row on every non-public request (cached ≤ 5 s), fails closed with
503 on a database error, and every page, action and route handler also calls `requireSession()`.
Signing out therefore ends a copied cookie at once. *Cost:* one small query per request.

**4. Builds run in a capped builder and are deferred when memory is short (2026-09-30).**
`next build` uses Turbopack, whose native memory no V8 flag bounds, and the box has no swap. RADAR
builds in its own BuildKit container (3 GiB, no swap, 1 CPU) and waits for 3.5 GiB of free memory.
*Cost:* builds are slower than on a free machine (about 1 minute warm).

**5. Every database connection runs at READ COMMITTED (2026-09-30).**
The first crawl dead-lettered 682 of 19,616 jobs: concurrent writers deadlocked on gap locks in
`job_facts` under MySQL's default REPEATABLE READ (reproduced: 1,305 of 1,600 test writes
deadlocked; 0 with READ COMMITTED). The retry helper existed, but the collision repeated within its
five attempts. *Cost:* none the app relies on — nothing needs repeatable reads; `mysqldump
--single-transaction` sets its own level.

**6. The Jobs list and the Desk show only your target roles by default (2026-09-30).**
Crawling whole company boards means 96% of collected jobs are other roles. The default view now
hides them with a normal, visible rule ("Not one of your target roles — Show them"), so the
"nothing is hidden silently" rule of the spec still holds. Saved and applied jobs are never hidden,
and a search, role/family filter or "my jobs" view lifts the rule.

**7. Same-source duplicate pairs are cleared automatically; cross-source pairs never are (2026-09-30).**
99.6% of the first crawl's "possible duplicates" were two postings from one source. The source
itself keeps them apart (usually one role in several cities — kept separate on purpose: location
matters for relocation). Only *exact twins* (same company, title, city and text) are merged, the
older job kept. Pairs from different sources are the real duplicates and stay for a human.
*Cost:* job merges cannot be undone from a screen yet (`splitJobs` exists, no UI).

**8. Unknown titles with no technical word are ignored automatically (2026-09-30).**
70% of the unknown-title queue was sales, HR, retail and trades. They were already scored as
not-a-target-role, so ignoring them changes nothing (status only, no override entry). Anything with
a technical word waits for a person, because a title like "Forward Deployed Engineer" may deserve a role.

**9. Sponsor registers feed company evidence nightly; weak matches stay weak (2026-09-30).**
The scheduler imported the registers but never matched companies, so no job ever got register
evidence (the table was empty in production). It now runs `refreshRegistersAndEvidence`. Result on
the first load (217,064 register rows, 609 companies): 44 confirmed and 292 possible company
matches; among the 945 target-role jobs, jobs with a Confirmed or Likely answer went from 72 to 649 —
but 545 of those are *Likely · low* (a sister company sponsors elsewhere). The engine's rule is
kept: a fuzzy match can support *Likely (low)* but never *Confirmed*.

**10. Visa rules are marked verified only against an official page, with a note (2026-09-30).**
Eleven rules were checked against the publisher's own page that day (NL ×3, GB, SE ×2, IE ×2, FR, DK,
US) and marked verified with the source and what matched; see the log in
[RULE_VERIFICATION.md](RULE_VERIFICATION.md). Germany's official site blocks automated readers, so the
German rule stays unverified until someone checks it in a browser. The checks were done by the
assistant at the owner's request — re-check before relying on a number for an application.

**11. Raw pages are kept 14 days, not 90 (2026-09-30).**
The default would have grown the database and the daily GitHub backup without benefit; 14 days is
enough to re-process after a rule change. *Cost:* re-processing older history needs a re-crawl.

**12. AI is a budgeted helper, best-fit first (2026-09-29).**
A free OpenRouter model, 50 calls a day, 5 reserved for *Ask AI*; the queue is worked by fit score in
two batches. AI can support *Likely* but never *Confirmed*, and quotes must exist in the posting.
