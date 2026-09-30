/**
 * The Desk ('/') reads (server only). Each panel is loaded independently: one failing query shows
 * an honest "could not load" in that panel instead of taking the whole page down.
 */
import 'server-only';
import { and, count, desc, eq, gte, inArray, isNotNull, isNull, lt, notInArray, sql } from 'drizzle-orm';
import {
  alerts,
  applications,
  auditLog,
  backupRuns,
  companies,
  countries,
  goldenSamples,
  jobs,
  pipelineRuns,
  reminders,
  sources,
  visaRoutes,
  visaRuleVersions,
  type BackupRunRow,
  type PipelineRunRow,
} from '@/db/schema';
import { EMPTY_FILTERS, activeDefaultRules } from '@/components/jobs/filters';
import { getAiBudget, type AiBudget } from '@/lib/ai';
import { getDb, type DbOrTx } from '@/lib/db';
import { log } from '@/lib/log';
import { getSetting, getSettingRaw } from '@/lib/settings';
import { addCalendarDaysInTz, appTz, startOfTodayInTz } from '@/lib/time';
import { listColumns, ruleCondition, toListRow, type JobListRow } from './jobs';

export type Section<T> = { ok: true; data: T } | { ok: false; error: string };

async function section<T>(name: string, fn: () => Promise<T>): Promise<Section<T>> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    log.warn(`desk: ${name} failed`, { err });
    return { ok: false, error: `The ${name} panel could not be loaded.` };
  }
}

/** Stages after which no follow-up is expected. */
export const TERMINAL_STAGES = ['accepted', 'rejected', 'withdrawn', 'no_response'] as const;

/** The default /jobs view (remote-limited, out-of-band, closed and hidden jobs are left out). */
function defaultViewWhere(now: Date) {
  const f = EMPTY_FILTERS;
  return and(isNull(jobs.mergedIntoJobId), ...activeDefaultRules(f).map((id) => ruleCondition(id, f, now)));
}

export interface TopMatches {
  rows: JobListRow[];
  /** Jobs first seen today (APP_TZ), in the default view. */
  newToday: number;
  since: Date;
}

async function topMatches(db: DbOrTx, now: Date, since: Date): Promise<TopMatches> {
  const where = and(defaultViewWhere(now), gte(jobs.firstSeenAt, since));
  const [rows, [total]] = await Promise.all([
    db
      .select(listColumns)
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .leftJoin(countries, eq(countries.iso2, jobs.countryIso2))
      .where(where)
      .orderBy(sql`${jobs.score} IS NULL`, desc(jobs.score), desc(jobs.firstSeenAt), desc(jobs.id))
      .limit(6),
    db.select({ n: count() }).from(jobs).innerJoin(companies, eq(companies.id, jobs.companyId)).where(where),
  ]);
  return { rows: rows.map(toListRow), newToday: total?.n ?? 0, since };
}

export interface FollowUp {
  key: string;
  kind: 'reminder' | 'follow_up';
  applicationId: number;
  jobId: number | null;
  title: string;
  company: string;
  stage: string;
  dueAt: Date;
  note: string | null;
  overdue: boolean;
}

export interface FollowUps {
  items: FollowUp[];
  /** All due items (the list is capped). */
  total: number;
}

const FOLLOW_UP_LIMIT = 10;

async function followUps(db: DbOrTx, startOfToday: Date, startOfTomorrow: Date): Promise<FollowUps> {
  const [reminderRows, appRows] = await Promise.all([
    db
      .select({
        id: reminders.id,
        dueAt: reminders.dueAt,
        note: reminders.note,
        applicationId: applications.id,
        jobId: applications.jobId,
        title: applications.title,
        company: applications.companyName,
        stage: applications.currentStage,
      })
      .from(reminders)
      .innerJoin(applications, eq(applications.id, reminders.applicationId))
      .where(and(isNull(reminders.doneAt), lt(reminders.dueAt, startOfTomorrow)))
      .orderBy(reminders.dueAt, reminders.id)
      .limit(50),
    db
      .select({
        applicationId: applications.id,
        jobId: applications.jobId,
        title: applications.title,
        company: applications.companyName,
        stage: applications.currentStage,
        dueAt: applications.nextFollowUpAt,
      })
      .from(applications)
      .where(
        and(
          isNotNull(applications.nextFollowUpAt),
          lt(applications.nextFollowUpAt, startOfTomorrow),
          notInArray(applications.currentStage, [...TERMINAL_STAGES]),
        ),
      )
      .orderBy(applications.nextFollowUpAt, applications.id)
      .limit(50),
  ]);
  const items: FollowUp[] = reminderRows.map((r) => ({
    key: `r${r.id}`,
    kind: 'reminder',
    applicationId: r.applicationId,
    jobId: r.jobId,
    title: r.title,
    company: r.company,
    stage: r.stage,
    dueAt: r.dueAt,
    note: r.note,
    overdue: r.dueAt.getTime() < startOfToday.getTime(),
  }));
  // A follow-up date that already has an open reminder for the same application is the same chore.
  const withReminder = new Set(items.map((i) => i.applicationId));
  for (const a of appRows) {
    if (!a.dueAt || withReminder.has(a.applicationId)) continue;
    items.push({
      key: `a${a.applicationId}`,
      kind: 'follow_up',
      applicationId: a.applicationId,
      jobId: a.jobId,
      title: a.title,
      company: a.company,
      stage: a.stage,
      dueAt: a.dueAt,
      note: null,
      overdue: a.dueAt.getTime() < startOfToday.getTime(),
    });
  }
  items.sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime() || a.key.localeCompare(b.key));
  return { items: items.slice(0, FOLLOW_UP_LIMIT), total: items.length };
}

export interface SourceHealth {
  ok: number;
  warn: number;
  paused: number;
  /** draft sources (not yet feeding anything). */
  draft: number;
  live: number;
  lastSuccessAt: Date | null;
}

async function sourceHealth(db: DbOrTx, now: Date): Promise<SourceHealth> {
  const rows = await db
    .select({ status: sources.status, failures: sources.consecutiveFailures, circuitOpenUntil: sources.circuitOpenUntil, lastSuccessAt: sources.lastSuccessAt })
    .from(sources);
  const h: SourceHealth = { ok: 0, warn: 0, paused: 0, draft: 0, live: 0, lastSuccessAt: null };
  for (const s of rows) {
    if (s.status === 'live') h.live++;
    if (s.status === 'live' || s.status === 'trial') {
      const circuitOpen = s.circuitOpenUntil !== null && s.circuitOpenUntil.getTime() > now.getTime();
      if (s.failures > 0 || circuitOpen) h.warn++;
      else h.ok++;
    } else if (s.status === 'paused' || s.status === 'disabled') h.paused++;
    else h.draft++;
    if (s.lastSuccessAt && (!h.lastSuccessAt || s.lastSuccessAt > h.lastSuccessAt)) h.lastSuccessAt = s.lastSuccessAt;
  }
  return h;
}

export interface AlertSummary {
  open: number;
  critical: number;
  newest: { id: number; title: string; severity: string; lastRaisedAt: Date } | null;
}

async function alertSummary(db: DbOrTx): Promise<AlertSummary> {
  const [counts, [newest]] = await Promise.all([
    db
      .select({ severity: alerts.severity, n: count() })
      .from(alerts)
      .where(isNull(alerts.acknowledgedAt))
      .groupBy(alerts.severity),
    db
      .select({ id: alerts.id, title: alerts.title, severity: alerts.severity, lastRaisedAt: alerts.lastRaisedAt })
      .from(alerts)
      .where(isNull(alerts.acknowledgedAt))
      .orderBy(sql`${alerts.severity} = ${'critical'} DESC`, desc(alerts.lastRaisedAt), desc(alerts.id))
      .limit(1),
  ]);
  return {
    open: counts.reduce((a, r) => a + r.n, 0),
    critical: counts.find((r) => r.severity === 'critical')?.n ?? 0,
    newest: newest ?? null,
  };
}

export interface HealthStrip {
  sources: Section<SourceHealth>;
  lastRun: Section<Pick<PipelineRunRow, 'id' | 'kind' | 'status' | 'startedAt' | 'finishedAt' | 'createdAt' | 'error' | 'dryRun'> | null>;
  ai: Section<AiBudget>;
  backup: Section<Pick<BackupRunRow, 'id' | 'status' | 'startedAt' | 'finishedAt' | 'error'> | null>;
  alerts: Section<AlertSummary>;
}

export interface TickerJob {
  id: number;
  title: string;
  company: string;
  countryIso2: string | null;
  score: number | null;
  firstSeenAt: Date;
}

export interface Onboarding {
  settingsWritten: boolean;
  goldenSamples: number;
  targetCountries: number;
  verifiedTargetCountries: number;
  liveSources: number;
}

async function onboarding(db: DbOrTx): Promise<Onboarding> {
  const [profile, profileRaw, [audited], [golden], [live]] = await Promise.all([
    getSetting(db, 'profile'),
    getSettingRaw(db, 'profile'),
    db
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'settings.update'), eq(auditLog.entityType, 'settings'), eq(auditLog.entityId, 'profile')))
      .limit(1),
    db.select({ n: count() }).from(goldenSamples),
    db.select({ n: count() }).from(sources).where(eq(sources.status, 'live')),
  ]);
  // XW is the "worldwide remote" pseudo-country: there is no visa rule to verify for it.
  const targets = [...new Set(profile.targetCountries.map((c) => c.toUpperCase()))].filter((c) => c !== 'XW');
  const verified = targets.length
    ? await db
        .selectDistinct({ iso2: visaRoutes.countryIso2 })
        .from(visaRoutes)
        .innerJoin(visaRuleVersions, eq(visaRuleVersions.routeId, visaRoutes.id))
        .where(and(inArray(visaRoutes.countryIso2, targets), eq(visaRoutes.isActive, true), eq(visaRuleVersions.verificationStatus, 'verified')))
    : [];
  return {
    settingsWritten: Boolean(audited) || (profileRaw?.version ?? 1) > 1,
    goldenSamples: golden?.n ?? 0,
    targetCountries: targets.length,
    verifiedTargetCountries: verified.length,
    liveSources: live?.n ?? 0,
  };
}

export interface DeskData {
  now: Date;
  tz: string;
  startOfToday: Date;
  top: Section<TopMatches>;
  followUps: Section<FollowUps>;
  health: HealthStrip;
  ticker: Section<TickerJob[]>;
  scope: Section<JobListRow[]>;
  onboarding: Section<Onboarding>;
  /** Jobs RADAR knows about at all (drives the "empty station" copy). */
  totalJobs: Section<number>;
}

export async function getDeskData(opts: { db?: DbOrTx; now?: Date } = {}): Promise<DeskData> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const tz = appTz();
  const startOfToday = startOfTodayInTz(tz, now);
  const startOfTomorrow = addCalendarDaysInTz(startOfToday, 1, tz);

  const [top, due, srcs, lastRun, ai, backup, alertsSec, ticker, scope, onboard, totalJobs] = await Promise.all([
    section('top matches', () => topMatches(db, now, startOfToday)),
    section('follow-ups', () => followUps(db, startOfToday, startOfTomorrow)),
    section('sources', () => sourceHealth(db, now)),
    section('last run', async () => {
      const [r] = await db
        .select({
          id: pipelineRuns.id,
          kind: pipelineRuns.kind,
          status: pipelineRuns.status,
          startedAt: pipelineRuns.startedAt,
          finishedAt: pipelineRuns.finishedAt,
          createdAt: pipelineRuns.createdAt,
          error: pipelineRuns.error,
          dryRun: pipelineRuns.dryRun,
        })
        .from(pipelineRuns)
        .where(inArray(pipelineRuns.kind, ['daily', 'manual']))
        .orderBy(desc(pipelineRuns.createdAt), desc(pipelineRuns.id))
        .limit(1);
      return r ?? null;
    }),
    section('AI budget', () => getAiBudget(db, now)),
    section('backup', async () => {
      const [b] = await db
        .select({ id: backupRuns.id, status: backupRuns.status, startedAt: backupRuns.startedAt, finishedAt: backupRuns.finishedAt, error: backupRuns.error })
        .from(backupRuns)
        .where(eq(backupRuns.kind, 'backup'))
        .orderBy(desc(backupRuns.startedAt), desc(backupRuns.id))
        .limit(1);
      return b ?? null;
    }),
    section('alerts', () => alertSummary(db)),
    section('ticker', () =>
      db
        .select({ id: jobs.id, title: jobs.canonicalTitle, company: companies.name, countryIso2: jobs.countryIso2, score: jobs.score, firstSeenAt: jobs.firstSeenAt })
        .from(jobs)
        .innerJoin(companies, eq(companies.id, jobs.companyId))
        .where(and(isNull(jobs.mergedIntoJobId), eq(jobs.hidden, false)))
        .orderBy(desc(jobs.firstSeenAt), desc(jobs.id))
        .limit(12),
    ),
    section('scope', async () =>
      (
        await db
          .select(listColumns)
          .from(jobs)
          .innerJoin(companies, eq(companies.id, jobs.companyId))
          .leftJoin(countries, eq(countries.iso2, jobs.countryIso2))
          .where(defaultViewWhere(now))
          .orderBy(sql`${jobs.score} IS NULL`, desc(jobs.score), desc(jobs.firstSeenAt), desc(jobs.id))
          .limit(24)
      ).map(toListRow),
    ),
    section('onboarding', () => onboarding(db)),
    section('job count', async () => {
      const [r] = await db.select({ n: count() }).from(jobs).where(isNull(jobs.mergedIntoJobId));
      return r?.n ?? 0;
    }),
  ]);

  return {
    now,
    tz,
    startOfToday,
    top,
    followUps: due,
    health: { sources: srcs, lastRun, ai, backup, alerts: alertsSec },
    ticker,
    scope,
    onboarding: onboard,
    totalJobs,
  };
}
