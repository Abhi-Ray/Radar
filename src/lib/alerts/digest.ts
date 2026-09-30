/**
 * Morning digest (spec §11 step 11): new top matches, follow-ups due, pipeline health and open
 * alerts since the previous digest. Stored as an alert of kind 'digest' (one per local day, dedupe
 * key `digest:YYYY-MM-DD`) and pushed to the enabled channels regardless of minSeverity.
 * Sent at most once per APP_TZ day, not before settings.alerts.digestHour (local).
 */
import { TZDate } from '@date-fns/tz';
import { and, count, desc, eq, gt, gte, inArray, isNull, lte, ne, notInArray, or, sql, sum } from 'drizzle-orm';
import { alerts, applications, companies, jobs, pipelineRuns, reminders, sourceRuns, sources } from '../../db/schema';
import type { DbOrTx } from '../db';
import { getSetting } from '../settings';
import { addCalendarDaysInTz, appTz, DAY_MS, formatDay, localDay, startOfTodayInTz } from '../time';
import { appLink, type AlertChannel } from './channels';
import { raiseAlert } from './index';

export const DIGEST_KIND = 'digest';
const TOP_N = 10;
const OPEN_STATES = ['new', 'active', 'updated'] as const;
const TERMINAL_STAGES = ['accepted', 'rejected', 'withdrawn', 'no_response'] as const;

export function digestDedupeKey(day: string): string {
  return `digest:${day}`;
}

export function localHour(now: Date, tz: string): number {
  return new TZDate(now.getTime(), tz).getHours();
}

/** UTC instant of the next local midnight after `now` (DST-safe). */
export function endOfLocalDay(now: Date, tz: string): Date {
  return addCalendarDaysInTz(startOfTodayInTz(tz, now), 1, tz);
}

export interface DigestTopJob {
  id: number;
  title: string;
  company: string;
  countryIso2: string | null;
  city: string | null;
  score: number | null;
  visaStatus: string | null;
  remoteClass: string | null;
}

export interface DigestContent {
  day: string;
  generatedAt: Date;
  since: Date;
  newJobs: number;
  top: DigestTopJob[];
  runTotals: { runs: number; newCount: number; updatedCount: number; closedCount: number };
  lastDailyRun: { status: string; finishedAt: Date | null } | null;
  troubledSources: { id: number; label: string; consecutiveFailures: number; circuitOpenUntil: Date | null }[];
  followUps: { applicationId: number; title: string; company: string; dueAt: Date; kind: 'reminder' | 'follow_up' }[];
  openAlerts: { critical: number; warn: number; info: number };
}

export async function buildDigest(db: DbOrTx, now: Date, tz: string = appTz()): Promise<DigestContent> {
  const day = localDay(now, tz);
  const [prev] = await db
    .select({ at: alerts.createdAt })
    .from(alerts)
    .where(eq(alerts.kind, DIGEST_KIND))
    .orderBy(desc(alerts.createdAt))
    .limit(1);
  const floor = new Date(now.getTime() - 7 * DAY_MS);
  const fallback = new Date(now.getTime() - DAY_MS);
  const since = prev?.at && prev.at > floor ? prev.at : fallback;
  const endOfToday = endOfLocalDay(now, tz);

  const freshJobs = and(gte(jobs.firstSeenAt, since), isNull(jobs.mergedIntoJobId));
  const [{ n: newJobs }] = await db.select({ n: count() }).from(jobs).where(freshJobs);
  const topRows = await db
    .select({
      id: jobs.id,
      title: jobs.canonicalTitle,
      company: companies.name,
      countryIso2: jobs.countryIso2,
      city: jobs.city,
      score: jobs.score,
      visaStatus: jobs.visaStatus,
      remoteClass: jobs.remoteClass,
    })
    .from(jobs)
    .innerJoin(companies, eq(companies.id, jobs.companyId))
    .where(and(freshJobs, eq(jobs.hidden, false), inArray(jobs.state, [...OPEN_STATES])))
    .orderBy(sql`${jobs.score} IS NULL`, desc(jobs.score), desc(jobs.firstSeenAt))
    .limit(TOP_N);

  const [totals] = await db
    .select({
      runs: sql<number>`COUNT(DISTINCT ${sourceRuns.runId})`,
      newCount: sum(sourceRuns.newCount),
      updatedCount: sum(sourceRuns.updatedCount),
      closedCount: sum(sourceRuns.closedCount),
    })
    .from(sourceRuns)
    .innerJoin(pipelineRuns, eq(pipelineRuns.id, sourceRuns.runId))
    .where(and(gte(sourceRuns.finishedAt, since), eq(pipelineRuns.dryRun, false)));

  const [lastDaily] = await db
    .select({ status: pipelineRuns.status, finishedAt: pipelineRuns.finishedAt })
    .from(pipelineRuns)
    .where(and(eq(pipelineRuns.kind, 'daily'), eq(pipelineRuns.dryRun, false), notInArray(pipelineRuns.status, ['queued', 'running'])))
    .orderBy(desc(pipelineRuns.id))
    .limit(1);

  const troubled = await db
    .select({ id: sources.id, label: sources.label, consecutiveFailures: sources.consecutiveFailures, circuitOpenUntil: sources.circuitOpenUntil })
    .from(sources)
    .where(and(inArray(sources.status, ['live', 'trial']), or(gt(sources.consecutiveFailures, 0), gt(sources.circuitOpenUntil, now))))
    .orderBy(desc(sources.consecutiveFailures))
    .limit(20);

  const dueReminders = await db
    .select({ applicationId: applications.id, title: applications.title, company: applications.companyName, dueAt: reminders.dueAt })
    .from(reminders)
    .innerJoin(applications, eq(applications.id, reminders.applicationId))
    .where(and(isNull(reminders.doneAt), lte(reminders.dueAt, endOfToday)))
    .orderBy(reminders.dueAt)
    .limit(20);
  const dueApps = await db
    .select({ applicationId: applications.id, title: applications.title, company: applications.companyName, dueAt: applications.nextFollowUpAt })
    .from(applications)
    .where(and(lte(applications.nextFollowUpAt, endOfToday), notInArray(applications.currentStage, [...TERMINAL_STAGES])))
    .orderBy(applications.nextFollowUpAt)
    .limit(20);
  const followUps: DigestContent['followUps'] = [
    ...dueReminders.map((r) => ({ ...r, kind: 'reminder' as const })),
    ...dueApps
      .filter((a): a is typeof a & { dueAt: Date } => a.dueAt !== null)
      .filter((a) => !dueReminders.some((r) => r.applicationId === a.applicationId))
      .map((a) => ({ ...a, kind: 'follow_up' as const })),
  ].sort((a, b) => a.dueAt.getTime() - b.dueAt.getTime());

  const alertRows = await db
    .select({ severity: alerts.severity, n: count() })
    .from(alerts)
    .where(and(isNull(alerts.acknowledgedAt), ne(alerts.kind, DIGEST_KIND)))
    .groupBy(alerts.severity);
  const openAlerts = { critical: 0, warn: 0, info: 0 };
  for (const r of alertRows) openAlerts[r.severity] = Number(r.n);

  return {
    day,
    generatedAt: now,
    since,
    newJobs: Number(newJobs),
    top: topRows,
    runTotals: {
      runs: Number(totals?.runs ?? 0),
      newCount: Number(totals?.newCount ?? 0),
      updatedCount: Number(totals?.updatedCount ?? 0),
      closedCount: Number(totals?.closedCount ?? 0),
    },
    lastDailyRun: lastDaily ? { status: lastDaily.status, finishedAt: lastDaily.finishedAt } : null,
    troubledSources: troubled,
    followUps,
    openAlerts,
  };
}

function place(j: DigestTopJob): string {
  return [j.city, j.countryIso2].filter(Boolean).join(', ') || 'location unknown';
}

/** Plain-text digest body (pure; exported for tests). */
export function renderDigest(d: DigestContent, tz: string = appTz(), appUrl: string | null = null): string {
  const link = (p: string) => (appUrl ? ` ${appUrl}${p}` : '');
  const lines: string[] = [];
  lines.push(`${d.newJobs} new job${d.newJobs === 1 ? '' : 's'} since ${formatDay(d.since, tz)}.`);
  if (d.top.length > 0) {
    lines.push('', 'Top new matches:');
    for (const j of d.top) {
      const extras = [j.visaStatus ? `visa ${j.visaStatus}` : null, j.remoteClass && j.remoteClass !== 'not_remote' ? `remote ${j.remoteClass}` : null]
        .filter(Boolean)
        .join(', ');
      lines.push(`- ${j.score ?? '–'} · ${j.title} — ${j.company} (${place(j)})${extras ? ` · ${extras}` : ''}${link(`/jobs/${j.id}`)}`);
    }
  }
  if (d.followUps.length > 0) {
    lines.push('', `Follow-ups due (${d.followUps.length}):`);
    for (const f of d.followUps.slice(0, 10)) lines.push(`- ${f.title} — ${f.company} (due ${formatDay(f.dueAt, tz)})${link(`/applications/${f.applicationId}`)}`);
  }
  lines.push('', 'Pipeline:');
  if (d.lastDailyRun) {
    lines.push(`- Last daily run: ${d.lastDailyRun.status}${d.lastDailyRun.finishedAt ? `, finished ${d.lastDailyRun.finishedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` : ''}`);
  } else lines.push('- No daily run yet.');
  lines.push(`- ${d.runTotals.runs} run(s): ${d.runTotals.newCount} new, ${d.runTotals.updatedCount} updated, ${d.runTotals.closedCount} closed.`);
  for (const s of d.troubledSources.slice(0, 10)) {
    const open = s.circuitOpenUntil && s.circuitOpenUntil.getTime() > d.generatedAt.getTime();
    lines.push(`- Source "${s.label}": ${s.consecutiveFailures} failed run(s)${open ? ', paused by circuit breaker' : ''}${link(`/sources/${s.id}`)}`);
  }
  const a = d.openAlerts;
  if (a.critical + a.warn + a.info > 0) lines.push('', `Open alerts: ${a.critical} critical, ${a.warn} warning, ${a.info} info.${link('/system')}`);
  return lines.join('\n');
}

export type DigestStatus = 'sent' | 'disabled' | 'too_early' | 'already_sent';

export interface SendDigestOptions {
  now?: Date;
  /** Ignore digestHour (CLI `digest`). Never sends twice for the same day. */
  force?: boolean;
  channels?: readonly AlertChannel[];
  tz?: string;
  appUrl?: string | null;
}

export async function sendMorningDigest(db: DbOrTx, opts: SendDigestOptions = {}): Promise<{ status: DigestStatus; alertId?: number; day: string }> {
  const now = opts.now ?? new Date();
  const tz = opts.tz ?? appTz();
  const day = localDay(now, tz);
  const settings = await getSetting(db, 'alerts');
  if (!settings.digest) return { status: 'disabled', day };
  if (!opts.force && localHour(now, tz) < settings.digestHour) return { status: 'too_early', day };
  const key = digestDedupeKey(day);
  const [existing] = await db.select({ id: alerts.id }).from(alerts).where(eq(alerts.dedupeKey, key)).limit(1);
  if (existing) return { status: 'already_sent', alertId: existing.id, day };

  const content = await buildDigest(db, now, tz);
  const appUrl = opts.appUrl === undefined ? appLink('') : opts.appUrl;
  const body = renderDigest(content, tz, appUrl);
  const { alertId } = await raiseAlert(
    db,
    {
      kind: DIGEST_KIND,
      severity: 'info',
      title: `Morning digest ${formatDay(now, tz)}: ${content.newJobs} new, ${content.followUps.length} follow-up(s) due`,
      body,
      dedupeKey: key,
      entityType: 'digest',
      entityId: day,
    },
    { now, channels: opts.channels, ignoreMinSeverity: true, linkPath: '/' },
  );
  // Reminders included in a digest are marked notified (the column exists to avoid repeat pushes).
  if (content.followUps.some((f) => f.kind === 'reminder')) {
    const endOfToday = endOfLocalDay(now, tz);
    await db
      .update(reminders)
      .set({ notifiedAt: now })
      .where(and(isNull(reminders.doneAt), isNull(reminders.notifiedAt), lte(reminders.dueAt, endOfToday)));
  }
  return { status: 'sent', alertId, day };
}
