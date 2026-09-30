# RADAR — what is live, and what is left

Updated 2026-09-30, end of day. How to use it: [USER_GUIDE.md](USER_GUIDE.md). How to run it:
[OPERATIONS.md](OPERATIONS.md).

## Live

- https://radar.187-127-129-127.sslip.io — sign in with the owner email; the cookie lasts a year and
  sign-out ends a session everywhere. Nothing else on the shared VPS was touched.
- All screens are real (Desk, Jobs, Tracker, Companies, Countries, Kit, Review, Sources, Accuracy,
  System, Settings). About 20,000 jobs from 207 sources in 40+ countries, refreshed twice a day.
- **Jobs and Desk open on your target roles** (about 500 jobs); everything else is one *Show them* click away.
- **Sponsor registers are loaded** (UK 142,598 · CA 45,078 · IE 15,424 · NL 12,982 · DK 982 entries) and every
  company is matched against them each night. Among the 945 target-role jobs, 54 are *Confirmed*, 50 are
  *Likely* at medium confidence and 545 are *Likely · low* (a sister company sponsors elsewhere).
- **The Review queue is short**: 31 real cross-source duplicate pairs and 780 unknown titles that contain
  a technical word. Same-source pairs and unrelated titles are tidied automatically after every run.
- **11 visa rules verified against the official pages** ([RULE_VERIFICATION.md](RULE_VERIFICATION.md)).
- Encrypted backup to GitHub every night (first restore test passed: 46 of 46 tables). Deploys are
  automatic, health-checked and roll back on failure. 3,900+ tests pass.

## Left, in this order

1. **Check the German Blue Card rule in a browser** (the official site blocks automated readers) and
   work through the other 26 unverified rules — 5 minutes each, steps in RULE_VERIFICATION.md.
2. **An undo for job merges.** Exact twins are merged automatically; `splitJobs` (src/lib/dedup/manual.ts)
   can undo it, but no screen calls it yet (company merges do have *Undo the merge*).
3. **Phone alerts and an outside monitor.** Telegram or e-mail keys in `/opt/radar/.env`
   (OPERATIONS.md) for the morning digest and failure alerts; a free ping monitor
   (`HEALTHCHECK_PING_URL`) so you hear about it if the whole server is down.
4. **Independent review and browser tests.** Nobody but the builder has read the tracker, ops and
   review code, and there are no Playwright tests for the new screens. Include a second security review of the server actions.
5. **Your data:** write your profile on Settings, label ten jobs a week on Accuracy (30 make the
   numbers meaningful), and decide the 780 technical-looking unknown titles on Review.
6. **Ideas, not promised:** group the same role posted in several cities into one card; more sources
   (France Travail, Adzuna, EURES); an ICS calendar feed for follow-ups.

## Owner tasks (outside the code)

- Rotate the VPS root password and the OpenRouter key — both were pasted into a chat. Prefer key-only SSH.
- Make the GitHub repository private, then point `/opt/radar` at the deploy key over SSH so the
  auto-deploy keeps working (it pulls over public HTTPS today). See DECISIONS.md #2.
- Optional: a real domain (DEPLOY.md §7).

## FYI

- Any push restarts the worker and cuts a running crawl short — push between 01:15–12:15 and 13:15–00:15 UTC (OPERATIONS.md §3).
- The VPS's default Docker build cache is ~23 GB and is shared with other projects; RADAR's own builder cache (~5 GB) is pruned automatically. 57 GB of disk is free.
