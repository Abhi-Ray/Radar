/**
 * DB-backed checks for the /jobs and Desk reads: the SQL rules in src/lib/queries/jobs.ts must
 * agree with `passesRule()` / `breakdownOf()` (src/components/jobs/filters.ts) on the same rows,
 * sort + paginate the way the UI promises, and the detail / Desk reads must surface what the
 * pages render (override history, stale visa rules, follow-ups due today in APP_TZ).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  alerts,
  applications,
  companies,
  jobSources,
  jobs,
  reminders,
  visaRoutes,
  visaRuleVersions,
} from '../../src/db/schema';
import { historyItems } from '../../src/components/jobs/detail/detail-model';
import {
  JOBS_PAGE_SIZE,
  activeDefaultRules,
  breakdownOf,
  parseJobFilters,
  passesRule,
  type HiddenBreakdown,
  type JobFilterSubject,
  type JobFilters,
} from '../../src/components/jobs/filters';
import type { CompanyType, ConfidenceKey, JobState, RemoteClass, RoleFamily } from '../../src/components/jobs/labels';
import type { Fact } from '../../src/lib/contracts/provenance';
import { addFact, clearOverride, setOverride } from '../../src/lib/provenance/store';
import { getDeskData } from '../../src/lib/queries/dashboard';
import { RULE_STALE_DAYS, getJobDetail, hiddenBreakdown, jobFacets, likeNeedle, listJobs } from '../../src/lib/queries/jobs';
import { addCalendarDaysInTz, appTz, startOfTodayInTz } from '../../src/lib/time';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCountry, seedJob, seedSource } from '../helpers/fixtures';

const NOW = new Date('2026-09-30T06:00:00.000Z');
const DAY = 86_400_000;

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
});

afterAll(async () => {
  await t?.stop();
});

// ---- a deterministic matrix of jobs covering every filter dimension (incl. NULLs) ------------

const REMOTES: (RemoteClass | null)[] = [null, 'worldwide', 'region_limited', 'timezone_limited', 'unclear', 'not_remote'];
const BANDS: ('core' | 'show' | 'hide' | 'unknown' | null)[] = [null, 'core', 'show', 'hide', 'unknown'];
const STATES: JobState[] = ['new', 'active', 'updated', 'stale', 'closed', 'expired', 'suspicious'];
const VISAS: (JobFilterSubject['visaStatus'])[] = [null, 'confirmed', 'likely', 'unknown', 'not_offered', 'conflicting'];
const FAMILIES: RoleFamily[] = ['primary', 'secondary', 'fallback', 'other'];
const ROLES = [null, 'cloud_security_engineer', 'security_engineer', 'devsecops_engineer'];
const COUNTRIES = [null, 'DE', 'IE', 'NL'];
const CTYPES: CompanyType[] = ['startup', 'scaleup', 'midsize', 'mnc', 'agency', 'unknown'];
const SIZES = [null, '1-50', '51-250', '1000+'];
const CONFS: (ConfidenceKey | null)[] = [null, 'high', 'medium', 'low'];
const TITLES = ['Cloud Security Engineer', 'Security Engineer', 'Platform Engineer', 'Data_Analyst (100% remote)'];
const SALARIES: [number | null, number | null][] = [
  [null, null],
  [50_000, null],
  [55_000, 70_000],
  [null, 90_000],
  [40_000, 45_000],
];
const KINDS: ('stated' | 'estimated' | null)[] = [null, 'stated', 'estimated'];
const N = 60;

interface Seeded {
  subject: JobFilterSubject & { id: number };
  platform: 'greenhouse' | 'lever' | 'both';
}

function specFor(i: number) {
  const [salaryEurMin, salaryEurMax] = SALARIES[i % SALARIES.length];
  const firstSeenAt = new Date(NOW.getTime() - ((i * 7) % 60) * DAY - i * 60_000);
  return {
    title: TITLES[i % TITLES.length],
    company: `${i % 2 ? 'Acme' : 'Globex'} ${i}`,
    countryIso2: COUNTRIES[i % COUNTRIES.length],
    remoteClass: REMOTES[i % REMOTES.length],
    roleFamily: FAMILIES[i % FAMILIES.length],
    roleKey: ROLES[(i >> 1) % ROLES.length],
    companySize: SIZES[(i >> 2) % SIZES.length],
    companyType: CTYPES[i % CTYPES.length],
    isAgency: i % 11 === 3,
    visaStatus: VISAS[(i * 5) % VISAS.length],
    salaryEurMin,
    salaryEurMax,
    salaryKind: KINDS[i % KINDS.length],
    postedAt: i % 4 === 0 ? null : new Date(NOW.getTime() - (i % 40) * DAY - 3_600_000),
    firstSeenAt,
    score: i % 6 === 0 ? null : (i * 37) % 101,
    factsConfidence: CONFS[(i >> 1) % CONFS.length],
    state: STATES[i % STATES.length],
    experienceBand: BANDS[(i * 3) % BANDS.length],
    hidden: i % 9 === 0,
    saved: i % 5 === 2,
    stage: i % 7 === 1 ? ('applied' as const) : i % 7 === 4 ? ('saved' as const) : null,
    platform: i % 3 === 0 ? ('both' as const) : i % 3 === 1 ? ('lever' as const) : ('greenhouse' as const),
  };
}

let seeded: Seeded[] = [];
let mergedId = 0;

async function seedMatrix(): Promise<void> {
  await t.truncateAll();
  for (const iso of ['DE', 'IE', 'NL']) await seedCountry(t.db, iso, `Country ${iso}`);
  const lever = await seedSource(t.db, { platformKey: 'lever' });
  const out: Seeded[] = [];
  for (let i = 0; i < N; i++) {
    const s = specFor(i);
    const { jobId, companyId, sourceId } = await seedJob(t.db, { title: s.title, companyName: s.company, countryIso2: s.countryIso2 });
    await t.db.update(companies).set({ type: s.companyType, sizeBand: s.companySize, isAgency: s.isAgency }).where(eq(companies.id, companyId));
    await t.db
      .update(jobs)
      .set({
        roleFamily: s.roleFamily,
        roleKey: s.roleKey,
        remoteClass: s.remoteClass,
        visaStatus: s.visaStatus,
        salaryEurMin: s.salaryEurMin,
        salaryEurMax: s.salaryEurMax,
        salaryKind: s.salaryKind,
        postedAt: s.postedAt,
        firstSeenAt: s.firstSeenAt,
        score: s.score,
        factsConfidence: s.factsConfidence,
        state: s.state,
        experienceBand: s.experienceBand,
        hidden: s.hidden,
        saved: s.saved,
      })
      .where(eq(jobs.id, jobId));
    const platformKeys: string[] = [];
    if (s.platform !== 'lever' && sourceId) {
      await t.db.insert(jobSources).values({ jobId, sourceId, externalId: `g${i}`, url: `https://boards.example.test/g/${i}`, grade: 'B' });
      platformKeys.push('greenhouse');
    }
    if (s.platform !== 'greenhouse') {
      await t.db.insert(jobSources).values({ jobId, sourceId: lever, externalId: `l${i}`, url: `https://jobs.example.test/l/${i}`, grade: 'A' });
      platformKeys.push('lever');
    }
    if (s.stage) await t.db.insert(applications).values({ jobId, companyName: s.company, title: s.title, currentStage: s.stage });
    out.push({
      platform: s.platform,
      subject: {
        id: jobId,
        title: s.title,
        company: s.company,
        countryIso2: s.countryIso2,
        remoteClass: s.remoteClass,
        roleFamily: s.roleFamily,
        roleKey: s.roleKey,
        companySize: s.companySize,
        companyType: s.companyType,
        isAgency: s.isAgency,
        visaStatus: s.visaStatus,
        salaryEurMin: s.salaryEurMin,
        salaryEurMax: s.salaryEurMax,
        salaryKind: s.salaryKind,
        postedAt: s.postedAt,
        firstSeenAt: s.firstSeenAt,
        platformKeys,
        score: s.score,
        factsConfidence: s.factsConfidence,
        state: s.state,
        experienceBand: s.experienceBand,
        hidden: s.hidden,
        saved: s.saved,
        applied: s.stage === 'applied',
      },
    });
  }
  // A duplicate merged into the first job: never listed, never counted.
  const dup = await seedJob(t.db, { title: TITLES[0], companyName: 'Globex dup', countryIso2: 'DE' });
  await t.db.update(jobs).set({ mergedIntoJobId: out[0].subject.id, score: 99, remoteClass: 'worldwide', experienceBand: 'core' }).where(eq(jobs.id, dup.jobId));
  mergedId = dup.jobId;
  seeded = out;
}

const subjects = () => seeded.map((s) => s.subject);

function shape(b: HiddenBreakdown) {
  return { total: b.total, shown: b.shown, hidden: b.hidden, multi: b.multi, byRule: b.byRule.map((r) => [r.rule.id, r.count]) };
}

function passesAll(f: JobFilters, s: JobFilterSubject): boolean {
  return breakdownOf(f, [s], NOW).shown === 1;
}

const top = (s: JobFilterSubject) => s.salaryEurMax ?? s.salaryEurMin;
const nullsLast = (a: number | null, b: number | null) => (a === null ? 1 : 0) - (b === null ? 1 : 0);

function expectedOrder(f: JobFilters): number[] {
  const rows = subjects().filter((s) => passesAll(f, s));
  rows.sort((a, b) => {
    switch (f.sort) {
      case 'posted':
        return (b.postedAt ?? b.firstSeenAt).getTime() - (a.postedAt ?? a.firstSeenAt).getTime() || b.id - a.id;
      case 'salary':
        return (
          nullsLast(top(a), top(b)) ||
          (top(b) ?? 0) - (top(a) ?? 0) ||
          nullsLast(a.score, b.score) ||
          (b.score ?? 0) - (a.score ?? 0) ||
          b.id - a.id
        );
      case 'fit':
        return nullsLast(a.score, b.score) || (b.score ?? 0) - (a.score ?? 0) || b.firstSeenAt.getTime() - a.firstSeenAt.getTime() || b.id - a.id;
    }
  });
  return rows.map((r) => r.id);
}

const CASES = [
  '',
  'show=all',
  'show=all&show=hidden',
  'show=remote&show=closed',
  'show=experience',
  'remote=region_limited&remote=worldwide',
  'visa=unknown',
  'visa=confirmed&visa=likely&salary=60000',
  'stated=1&salary=50000',
  'salary=90000&show=all',
  'posted=7',
  'posted=30&sort=posted',
  'fit=60&conf=medium',
  'conf=high&sort=salary',
  'state=closed&state=expired',
  'mine=saved&mine=applied',
  'mine=hidden',
  'ctype=agency',
  'ctype=startup&ctype=mnc&show=all',
  'size=51-250&size=1000%2B',
  'source=lever',
  'source=greenhouse&source=lever&sort=posted',
  'country=DE&country=IE&family=primary',
  'role=cloud_security_engineer&role=devsecops_engineer',
  'q=security',
  'q=ACME',
  'q=100%25',
  'q=data_',
  'q=_x',
  'show=all&show=hidden&sort=salary',
  'country=NL&remote=unclear&visa=likely&visa=unknown&conf=low&show=closed',
];

describe('/jobs list: SQL rules agree with passesRule()', () => {
  beforeAll(seedMatrix, 240_000);

  it('seeds a matrix wide enough to exercise every rule both ways', () => {
    const all = subjects();
    expect(all).toHaveLength(N);
    const f = parseJobFilters({ show: 'all' });
    // Every default rule hides something and keeps something.
    for (const id of ['remote_limited', 'experience_band', 'closed', 'hidden'] as const) {
      const passing = all.filter((s) => passesRule(id, f, s, NOW)).length;
      expect(passing, id).toBeGreaterThan(0);
      expect(passing, id).toBeLessThan(N);
    }
    // The default view shows some jobs and hides others; "show all + hidden" spans several pages.
    const shownByDefault = all.filter((s) => passesAll(parseJobFilters({}), s)).length;
    expect(shownByDefault).toBeGreaterThan(0);
    expect(shownByDefault).toBeLessThan(N);
    expect(all.filter((s) => passesAll(parseJobFilters({ show: ['all', 'hidden'] }), s)).length).toBeGreaterThan(JOBS_PAGE_SIZE);
  });

  it.each(CASES)('breakdown and rows agree for ?%s', async (qs) => {
    const f = parseJobFilters(Object.fromEntries([...new URLSearchParams(qs).keys()].map((k) => [k, new URLSearchParams(qs).getAll(k)])));
    const sql = await hiddenBreakdown(t.db, f, NOW);
    expect(shape(sql)).toEqual(shape(breakdownOf(f, subjects(), NOW)));
    expect(sql.total).toBe(N);

    const expected = expectedOrder(f);
    const res = await listJobs(f, { db: t.db, now: NOW });
    expect(res.total).toBe(expected.length);
    expect(res.rows.map((r) => r.id)).toEqual(expected.slice(0, JOBS_PAGE_SIZE));
    expect(res.rows.some((r) => r.id === mergedId)).toBe(false);
  });

  it('paginates and clamps the page to the last one', async () => {
    const f = parseJobFilters({ show: ['all', 'hidden'] });
    const expected = expectedOrder(f);
    expect(expected.length).toBeGreaterThan(JOBS_PAGE_SIZE);
    const lastPage = Math.ceil(expected.length / JOBS_PAGE_SIZE);
    const p2 = await listJobs({ ...f, page: 2 }, { db: t.db, now: NOW });
    expect(p2.rows.map((r) => r.id)).toEqual(expected.slice(JOBS_PAGE_SIZE, 2 * JOBS_PAGE_SIZE));
    const beyond = await listJobs({ ...f, page: 99 }, { db: t.db, now: NOW });
    expect(beyond.filters.page).toBe(lastPage);
    expect(beyond.rows.map((r) => r.id)).toEqual(expected.slice((lastPage - 1) * JOBS_PAGE_SIZE));
  });

  it('maps card columns: applied (past "saved" only), grade and source count', async () => {
    const res = await listJobs(parseJobFilters({ show: ['all', 'hidden'], mine: ['applied', 'saved', 'hidden'] }), { db: t.db, now: NOW });
    const byId = new Map(seeded.map((s) => [s.subject.id, s]));
    expect(res.rows.length).toBeGreaterThan(0);
    for (const row of res.rows) {
      const s = byId.get(row.id);
      expect(s).toBeDefined();
      if (!s) continue;
      expect(row.applied).toBe(s.subject.applied);
      expect(row.saved).toBe(s.subject.saved);
      expect(row.hidden).toBe(s.subject.hidden);
      expect(row.sourceCount).toBe(s.platform === 'both' ? 2 : 1);
      expect(row.bestGrade).toBe(s.platform === 'greenhouse' ? 'B' : 'A');
    }
  });

  it('facet counts are taken over the default view and keep selected values', async () => {
    const f = parseJobFilters({ country: ['DE', 'FR'], source: 'lever' });
    const facets = await jobFacets(t.db, f, NOW);
    const base = subjects().filter((s) => activeDefaultRules(f).every((id) => passesRule(id, f, s, NOW)));
    const byCountry = new Map<string, number>();
    for (const s of base) if (s.countryIso2) byCountry.set(s.countryIso2, (byCountry.get(s.countryIso2) ?? 0) + 1);
    expect(Object.fromEntries(facets.countries.map((c) => [c.value, c.count]))).toEqual({ ...Object.fromEntries(byCountry), FR: 0 });
    expect(facets.countries.find((c) => c.value === 'DE')?.label).toBe('Country DE');
    const lever = base.filter((s) => s.platformKeys.includes('lever')).length;
    expect(facets.platforms.find((p) => p.value === 'lever')?.count).toBe(lever);
    const roles = base.filter((s) => s.roleKey === 'security_engineer').length;
    expect(facets.roles.find((r) => r.value === 'security_engineer')).toMatchObject({ count: roles, label: 'Security engineer' });
  });

  it('escapes LIKE metacharacters in the search needle', () => {
    expect(likeNeedle('100%')).toBe('%100\\%%');
    expect(likeNeedle('a_b')).toBe('%a\\_b%');
    expect(likeNeedle('C:\\x')).toBe('%c:\\\\x%');
  });
});

// ---- detail --------------------------------------------------------------------------------

function posting<T>(value: T): Fact<T> {
  return {
    value,
    evidence: 'We cannot sponsor visas for this role.',
    source: 'greenhouse:acme',
    method: 'posting',
    confidence: 'high',
    checkedAt: new Date('2026-09-20T10:00:00.000Z'),
    logicVersion: 'test-1',
  };
}

describe('getJobDetail', () => {
  it('returns null for a job that does not exist', async () => {
    await t.truncateAll();
    expect(await getJobDetail(424242, { db: t.db, now: NOW })).toBeNull();
  });

  it('keeps removed and replaced overrides apart in the history', async () => {
    await t.truncateAll();
    const { jobId } = await seedJob(t.db, { countryIso2: 'IE', city: 'Dublin' });
    await addFact(t.db, jobId, 'visa_status', posting({ status: 'not_offered', reasons: [] }));
    const first = await setOverride(t.db, jobId, 'visa_status', { status: 'likely', reasons: [] }, 'Recruiter hinted at it');
    const second = await setOverride(t.db, jobId, 'visa_status', { status: 'confirmed', reasons: [] }, 'HR confirmed by email');
    expect(await clearOverride(t.db, jobId, 'visa_status', 'Email was about another team')).toBe(true);

    const d = await getJobDetail(jobId, { db: t.db, now: NOW });
    expect(d).not.toBeNull();
    if (!d) return;
    expect(d.overrides.map((o) => [o.id, o.active])).toEqual([
      [second.id, false],
      [first.id, false],
    ]);
    expect(d.overrideEnds.map((e) => e.overrideId).sort((a, b) => a - b)).toEqual([first.id, second.id]);
    expect(d.overrideClears).toEqual([{ field: 'visa_status', at: expect.any(Date), reason: 'Email was about another team' }]);
    // With the override gone the posting decides again.
    expect(d.visaStatus).toBe('not_offered');
    expect(d.currentValues.city).toBe('Dublin');

    const items = historyItems({ changes: d.changes, overrides: d.overrides, corrections: d.corrections, overrideEnds: d.overrideEnds, overrideClears: d.overrideClears });
    const removed = items.filter((i) => i.kind === 'override_removed');
    expect(removed.map((i) => i.id)).toEqual([`x${second.id}`]);
    expect(removed[0].body).toBe('“Email was about another team”');
  });

  it('flags a verified visa rule older than the stale window', async () => {
    await t.truncateAll();
    const { jobId } = await seedJob(t.db, { countryIso2: 'DE' });
    const [route] = await t.db.insert(visaRoutes).values({ countryIso2: 'DE', code: 'eu_blue_card', name: 'EU Blue Card', officialUrl: 'https://www.make-it-in-germany.com/' });
    const routeId = Number(route.insertId);
    await t.db.insert(visaRuleVersions).values([
      { routeId, version: 1, effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31', salaryThresholdEur: 45_300, verificationStatus: 'verified', lastVerifiedAt: new Date('2025-02-01T00:00:00Z') },
      { routeId, version: 2, effectiveFrom: '2026-01-01', salaryThresholdEur: 48_300, verificationStatus: 'verified', lastVerifiedAt: new Date(NOW.getTime() - (RULE_STALE_DAYS + 30) * DAY) },
    ]);
    const d = await getJobDetail(jobId, { db: t.db, now: NOW });
    expect(d?.visaRules).toHaveLength(1);
    const [rule] = d?.visaRules ?? [];
    expect(rule).toMatchObject({ routeCode: 'eu_blue_card', current: true, verified: true, ageDays: RULE_STALE_DAYS + 30, stale: true });
    expect(rule.rule?.version).toBe(2);
    expect(d?.eligibility.rule?.routeId).toBe(routeId);
  });
});

// ---- the Desk ------------------------------------------------------------------------------

describe('getDeskData', () => {
  it('loads every panel on an empty station', async () => {
    await t.truncateAll();
    const d = await getDeskData({ db: t.db, now: NOW });
    expect(d.totalJobs).toEqual({ ok: true, data: 0 });
    expect(d.top).toMatchObject({ ok: true, data: { rows: [], newToday: 0 } });
    expect(d.followUps).toEqual({ ok: true, data: { items: [], total: 0 } });
    expect(d.ticker).toEqual({ ok: true, data: [] });
    expect(d.health.lastRun).toEqual({ ok: true, data: null });
    expect(d.health.backup).toEqual({ ok: true, data: null });
    expect(d.health.alerts).toEqual({ ok: true, data: { open: 0, critical: 0, newest: null } });
    expect(d.health.sources).toMatchObject({ ok: true, data: { ok: 0, warn: 0, live: 0, lastSuccessAt: null } });
    expect(d.onboarding).toMatchObject({ ok: true, data: { settingsWritten: false, goldenSamples: 0, liveSources: 0 } });
  });

  it("shows today's default-view matches, due follow-ups and the newest visible blips", async () => {
    await t.truncateAll();
    const tz = appTz();
    const today = startOfTodayInTz(tz, NOW);
    const tomorrow = addCalendarDaysInTz(today, 1, tz);
    const job = async (title: string, set: Partial<typeof jobs.$inferInsert>) => {
      const { jobId } = await seedJob(t.db, { title, companyName: `${title} Co` });
      await t.db.update(jobs).set(set).where(eq(jobs.id, jobId));
      return jobId;
    };
    const fresh = await job('Fresh match', { firstSeenAt: new Date(today.getTime() + 60_000), score: 80, remoteClass: 'worldwide' });
    await job('Fresh but hidden', { firstSeenAt: new Date(today.getTime() + 120_000), score: 90, hidden: true });
    await job('Fresh but region-limited', { firstSeenAt: new Date(today.getTime() + 180_000), score: 95, remoteClass: 'region_limited' });
    const old = await job('Yesterday', { firstSeenAt: new Date(today.getTime() - 60_000), score: 99 });

    const app = async (title: string, stage: typeof applications.$inferInsert.currentStage, followUp: Date | null) => {
      const [r] = await t.db.insert(applications).values({ jobId: fresh, companyName: 'Fresh match Co', title, currentStage: stage, nextFollowUpAt: followUp });
      return Number(r.insertId);
    };
    const overdue = await app('Overdue', 'applied', new Date(today.getTime() - DAY));
    const dueToday = await app('Due today', 'technical', new Date(tomorrow.getTime() - 60_000));
    await app('Due tomorrow', 'applied', new Date(tomorrow.getTime() + 60_000));
    await app('Rejected long ago', 'rejected', new Date(today.getTime() - 3 * DAY));
    const withReminder = await app('Reminder wins', 'screening', new Date(today.getTime() + 3_600_000));
    await t.db.insert(reminders).values([
      { applicationId: withReminder, dueAt: new Date(today.getTime() + 7_200_000), note: 'Ping the recruiter' },
      { applicationId: withReminder, dueAt: new Date(today.getTime() - DAY), note: 'Already done', doneAt: new Date(today.getTime() - 3_600_000) },
    ]);
    await t.db.insert(alerts).values({ kind: 'source_failing', severity: 'critical', title: 'Greenhouse feed failing', dedupeKey: 'src:1', lastRaisedAt: NOW });

    const d = await getDeskData({ db: t.db, now: NOW });
    expect(d.top.ok && d.top.data.rows.map((r) => r.id)).toEqual([fresh]);
    expect(d.top.ok && d.top.data.newToday).toBe(1);
    expect(d.followUps.ok && d.followUps.data.items.map((i) => [i.key, i.overdue])).toEqual([
      [`a${overdue}`, true],
      [expect.stringMatching(/^r\d+$/), false],
      [`a${dueToday}`, false],
    ]);
    expect(d.followUps.ok && d.followUps.data.items[1]).toMatchObject({ kind: 'reminder', applicationId: withReminder, note: 'Ping the recruiter' });
    const ticker = d.ticker.ok ? d.ticker.data.map((x) => x.title) : [];
    expect(ticker).toEqual(['Fresh but region-limited', 'Fresh match', 'Yesterday']);
    expect(d.scope.ok && d.scope.data.map((r) => r.id)).toEqual([old, fresh]);
    expect(d.health.alerts).toMatchObject({ ok: true, data: { open: 1, critical: 1, newest: { title: 'Greenhouse feed failing' } } });
    expect(d.totalJobs).toEqual({ ok: true, data: 4 });
  });
});
