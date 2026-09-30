/**
 * /applications board and /applications/[id] logbook reads (server only).
 *
 * The URL filters (src/components/tracker/filters.ts) become SQL here; the lane counts ignore the
 * mobile lane choice so every tab shows its own count. Follow-ups are compared in APP_TZ.
 */
import 'server-only';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import {
  applicationEvents,
  applicationSnapshots,
  applications,
  companies,
  countries,
  jobs,
  reminders,
  resumeVersions,
  type ApplicationEventRow,
  type ApplicationRow,
  type ApplicationSnapshotRow,
  type ReminderRow,
} from '@/db/schema';
import type { TrackerFilters } from '@/components/tracker/filters';
import { getDb, type DbOrTx } from '@/lib/db';
import { startOfLocalDay } from '@/lib/time';
import { loadTrackerStats } from '@/lib/tracker';
import { SOON_DAYS, addLocalDays, reminderBucket, type ReminderBucket } from '@/lib/tracker/follow-up';
import { BOARD_STAGES, type ApplicationStage } from '@/lib/tracker/stages';
import type { TrackerStats } from '@/lib/tracker/stats';
import { likeNeedle } from './jobs';

/** Cards loaded onto the board at most (a single person's search stays far below this). */
export const BOARD_CARD_LIMIT = 600;

const OPEN_EXCLUDED: ApplicationStage[] = ['accepted', 'rejected', 'withdrawn', 'no_response'];

export interface BoardCard {
  id: number;
  title: string;
  companyName: string;
  countryIso2: string | null;
  countryName: string | null;
  stage: ApplicationStage;
  appliedAt: Date | null;
  updatedAt: Date;
  nextFollowUpAt: Date | null;
  source: string | null;
  outcome: string | null;
  jobId: number | null;
  /** The linked job is closed / hidden (the snapshot still has the posting). */
  jobClosed: boolean;
  resumeName: string | null;
  events: number;
}

export interface FacetOption {
  value: string;
  label: string;
  count: number;
}

export interface DueReminder {
  id: number;
  applicationId: number;
  title: string;
  companyName: string;
  stage: ApplicationStage;
  dueAt: Date;
  note: string | null;
  bucket: ReminderBucket;
}

export interface BoardData {
  cards: BoardCard[];
  truncated: boolean;
  /** Per lane, filters applied. */
  counts: Partial<Record<ApplicationStage, number>>;
  /** Applications matching the filters. */
  matching: number;
  /** Every application. */
  total: number;
  facets: { country: FacetOption[]; source: FacetOption[] };
  due: DueReminder[];
  stats: TrackerStats;
  resumes: Array<{ id: number; name: string; track: string }>;
  countries: Array<{ iso2: string; name: string }>;
}

/** The instant the local day after `now` starts (end of today, APP_TZ). */
function endOfLocalToday(now: Date, tz: string): Date {
  return startOfLocalDay(addLocalDays(now, 1, tz), tz);
}

export function trackerWhere(f: TrackerFilters, now: Date, tz: string): SQL | undefined {
  const parts: SQL[] = [];
  if (f.q) {
    const needle = likeNeedle(f.q);
    parts.push(sql`(LOWER(${applications.companyName}) LIKE ${needle} OR LOWER(${applications.title}) LIKE ${needle})`);
  }
  if (f.country.length) {
    const codes = f.country.filter((c) => c !== 'none');
    const alts: SQL[] = [];
    if (codes.length) alts.push(inArray(applications.countryIso2, codes));
    if (f.country.includes('none')) alts.push(isNull(applications.countryIso2));
    parts.push(or(...alts) as SQL);
  }
  if (f.source.length) {
    const keys = f.source.filter((s) => s !== 'none');
    const alts: SQL[] = [];
    if (keys.length) alts.push(inArray(sql`LOWER(TRIM(${applications.source}))`, keys));
    if (f.source.includes('none')) alts.push(or(isNull(applications.source), sql`TRIM(${applications.source}) = ''`) as SQL);
    parts.push(or(...alts) as SQL);
  }
  if (f.due) parts.push(and(isNotNull(applications.nextFollowUpAt), lte(applications.nextFollowUpAt, endOfLocalToday(now, tz))) as SQL);
  if (f.open) parts.push(notInArray(applications.currentStage, OPEN_EXCLUDED));
  return parts.length ? and(...parts) : undefined;
}

export async function loadBoard(f: TrackerFilters, opts: { db?: DbOrTx; now?: Date; tz: string }): Promise<BoardData> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const where = trackerWhere(f, now, opts.tz);
  const filtered = where !== undefined;

  const eventCount = db
    .select({ applicationId: applicationEvents.applicationId, n: count().as('n') })
    .from(applicationEvents)
    .groupBy(applicationEvents.applicationId)
    .as('ev');

  const [rows, laneRows, [{ total }], countryRows, sourceRows, dueRows, resumes, countryList] = await Promise.all([
    db
      .select({
        id: applications.id,
        title: applications.title,
        companyName: applications.companyName,
        countryIso2: applications.countryIso2,
        countryName: countries.name,
        stage: applications.currentStage,
        appliedAt: applications.appliedAt,
        updatedAt: applications.updatedAt,
        nextFollowUpAt: applications.nextFollowUpAt,
        source: applications.source,
        outcome: applications.outcome,
        jobId: applications.jobId,
        jobState: jobs.state,
        jobHidden: jobs.hidden,
        resumeName: resumeVersions.name,
        events: eventCount.n,
      })
      .from(applications)
      .leftJoin(countries, eq(countries.iso2, applications.countryIso2))
      .leftJoin(jobs, eq(jobs.id, applications.jobId))
      .leftJoin(resumeVersions, eq(resumeVersions.id, applications.resumeVersionId))
      .leftJoin(eventCount, eq(eventCount.applicationId, applications.id))
      .where(where)
      .orderBy(desc(applications.updatedAt), desc(applications.id))
      .limit(BOARD_CARD_LIMIT + 1),
    db.select({ stage: applications.currentStage, n: count() }).from(applications).where(where).groupBy(applications.currentStage),
    db.select({ total: count() }).from(applications),
    db
      .select({ iso2: applications.countryIso2, name: countries.name, n: count() })
      .from(applications)
      .leftJoin(countries, eq(countries.iso2, applications.countryIso2))
      .groupBy(applications.countryIso2, countries.name),
    db
      .select({ key: sql<string | null>`NULLIF(LOWER(TRIM(${applications.source})), '')`, label: sql<string | null>`MIN(TRIM(${applications.source}))`, n: count() })
      .from(applications)
      .groupBy(sql`NULLIF(LOWER(TRIM(${applications.source})), '')`),
    db
      .select({
        id: reminders.id,
        applicationId: reminders.applicationId,
        dueAt: reminders.dueAt,
        note: reminders.note,
        title: applications.title,
        companyName: applications.companyName,
        stage: applications.currentStage,
      })
      .from(reminders)
      .innerJoin(applications, eq(applications.id, reminders.applicationId))
      .where(and(isNull(reminders.doneAt), lte(reminders.dueAt, startOfLocalDay(addLocalDays(now, SOON_DAYS + 1, opts.tz), opts.tz))))
      .orderBy(asc(reminders.dueAt))
      .limit(40),
    db.select({ id: resumeVersions.id, name: resumeVersions.name, track: resumeVersions.track }).from(resumeVersions).orderBy(desc(resumeVersions.updatedAt)),
    db.select({ iso2: countries.iso2, name: countries.name }).from(countries).orderBy(asc(countries.name)),
  ]);

  const truncated = rows.length > BOARD_CARD_LIMIT;
  const cards: BoardCard[] = rows.slice(0, BOARD_CARD_LIMIT).map((r) => ({
    id: r.id,
    title: r.title,
    companyName: r.companyName,
    countryIso2: r.countryIso2,
    countryName: r.countryName,
    stage: r.stage,
    appliedAt: r.appliedAt,
    updatedAt: r.updatedAt,
    nextFollowUpAt: r.nextFollowUpAt,
    source: r.source,
    outcome: r.outcome,
    jobId: r.jobId,
    jobClosed: r.jobId !== null && (r.jobHidden === true || r.jobState === 'closed' || r.jobState === 'expired'),
    resumeName: r.resumeName,
    events: Number(r.events ?? 0),
  }));
  const counts: Partial<Record<ApplicationStage, number>> = {};
  let matching = 0;
  for (const l of laneRows) {
    counts[l.stage] = Number(l.n);
    matching += Number(l.n);
  }

  let statsIds: number[] | undefined;
  if (filtered) {
    statsIds = (await db.select({ id: applications.id }).from(applications).where(where)).map((r) => r.id);
  }
  const stats = await loadTrackerStats(db, statsIds ? { ids: statsIds } : {});

  const country: FacetOption[] = countryRows
    .map((c) => ({ value: c.iso2 ?? 'none', label: c.iso2 ? (c.name ?? c.iso2) : 'No country', count: Number(c.n) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  const source: FacetOption[] = sourceRows
    .map((s) => ({ value: s.key ?? 'none', label: s.key ? (s.label ?? s.key) : 'Not recorded', count: Number(s.n) }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

  return {
    cards,
    truncated,
    counts,
    matching,
    total: Number(total),
    facets: { country, source },
    due: dueRows.map((d) => ({ ...d, bucket: reminderBucket(d.dueAt, now, opts.tz) })),
    stats,
    resumes,
    countries: countryList,
  };
}

// ---- detail ----------------------------------------------------------------------------------

export interface ApplicationJobLink {
  id: number;
  title: string;
  companyId: number;
  companyName: string;
  state: string;
  hidden: boolean;
  applyUrl: string;
}

export interface ApplicationDetail {
  app: ApplicationRow;
  countryName: string | null;
  resume: { id: number; name: string; track: string } | null;
  job: ApplicationJobLink | null;
  /** The job id the snapshots point to when the job itself is gone. */
  goneJobId: number | null;
  /** The company record (via the job, or by exact name for a manual application). */
  companyId: number | null;
  events: ApplicationEventRow[];
  snapshots: ApplicationSnapshotRow[];
  reminders: ReminderRow[];
  resumes: Array<{ id: number; name: string; track: string }>;
  countries: Array<{ iso2: string; name: string }>;
}

function snapshotJobId(s: ApplicationSnapshotRow): number | null {
  const v = (s.jobJson as Record<string, unknown> | null)?.jobId;
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
}

export async function loadApplication(id: number, opts: { db?: DbOrTx } = {}): Promise<ApplicationDetail | null> {
  const db = opts.db ?? getDb();
  const [row] = await db
    .select({ app: applications, countryName: countries.name })
    .from(applications)
    .leftJoin(countries, eq(countries.iso2, applications.countryIso2))
    .where(eq(applications.id, id))
    .limit(1);
  if (!row) return null;
  const app = row.app;
  const [events, snapshots, reminderRows, resumes, countryList, jobRows, resumeRows] = await Promise.all([
    db.select().from(applicationEvents).where(eq(applicationEvents.applicationId, id)).orderBy(asc(applicationEvents.occurredAt), asc(applicationEvents.id)),
    db.select().from(applicationSnapshots).where(eq(applicationSnapshots.applicationId, id)).orderBy(desc(applicationSnapshots.capturedAt), desc(applicationSnapshots.id)),
    db.select().from(reminders).where(eq(reminders.applicationId, id)).orderBy(desc(reminders.dueAt), desc(reminders.id)),
    db.select({ id: resumeVersions.id, name: resumeVersions.name, track: resumeVersions.track }).from(resumeVersions).orderBy(desc(resumeVersions.updatedAt)),
    db.select({ iso2: countries.iso2, name: countries.name }).from(countries).orderBy(asc(countries.name)),
    app.jobId !== null
      ? db
          .select({
            id: jobs.id,
            title: jobs.canonicalTitle,
            companyId: jobs.companyId,
            companyName: companies.name,
            state: jobs.state,
            hidden: jobs.hidden,
            applyUrl: jobs.applyUrl,
          })
          .from(jobs)
          .innerJoin(companies, eq(companies.id, jobs.companyId))
          .where(eq(jobs.id, app.jobId))
          .limit(1)
      : Promise.resolve([] as ApplicationJobLink[]),
    app.resumeVersionId !== null
      ? db.select({ id: resumeVersions.id, name: resumeVersions.name, track: resumeVersions.track }).from(resumeVersions).where(eq(resumeVersions.id, app.resumeVersionId)).limit(1)
      : Promise.resolve([] as Array<{ id: number; name: string; track: string }>),
  ]);
  const job = jobRows[0] ?? null;
  const goneJobId = job ? null : (snapshots.map(snapshotJobId).find((v) => v !== null) ?? null);
  let companyId = job?.companyId ?? null;
  if (companyId === null) {
    const [c] = await db
      .select({ id: companies.id })
      .from(companies)
      .where(and(eq(companies.name, app.companyName), isNull(companies.mergedIntoId)))
      .limit(1);
    companyId = c?.id ?? null;
  }
  return {
    app,
    countryName: row.countryName,
    resume: resumeRows[0] ?? null,
    job,
    goneJobId,
    companyId,
    events,
    snapshots,
    reminders: reminderRows,
    resumes,
    countries: countryList,
  };
}

/** Applications for one company family (for /companies/[id]). */
export async function applicationsForCompany(db: DbOrTx, companyIds: readonly number[], names: readonly string[]) {
  if (!companyIds.length && !names.length) return [];
  const alts: SQL[] = [];
  if (companyIds.length) alts.push(inArray(jobs.companyId, [...companyIds]));
  if (names.length) alts.push(and(isNull(applications.jobId), inArray(applications.companyName, [...names])) as SQL);
  return db
    .select({
      id: applications.id,
      title: applications.title,
      companyName: applications.companyName,
      stage: applications.currentStage,
      appliedAt: applications.appliedAt,
      updatedAt: applications.updatedAt,
      countryIso2: applications.countryIso2,
    })
    .from(applications)
    .leftJoin(jobs, eq(jobs.id, applications.jobId))
    .where(or(...alts))
    .orderBy(desc(applications.updatedAt))
    .limit(100);
}

export { BOARD_STAGES };
