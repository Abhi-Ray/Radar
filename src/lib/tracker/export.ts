/**
 * Tracker export (spec §20 "export"): everything I logged, as JSON (nested: application → events,
 * snapshots, reminders) or CSV (one table per part: applications, events, snapshots). Nothing is
 * left out — the timeline and the posting copies are the point of keeping a logbook.
 */
import { asc, eq, inArray } from 'drizzle-orm';
import { applicationEvents, applications, applicationSnapshots, reminders, resumeVersions } from '../../db/schema';
import type { DbOrTx } from '../db';
import { toCsv, type CsvColumn } from './csv';
import { parseCommentMeta } from './meta';

export const EXPORT_VERSION = 'tracker-export@2026-09-30.1';
export const EXPORT_PARTS = ['applications', 'events', 'snapshots'] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];
export const EXPORT_FORMATS = ['json', 'csv'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export interface ExportEvent {
  id: number;
  kind: string;
  stageFrom: string | null;
  stageTo: string | null;
  body: string | null;
  meta: Record<string, unknown> | null;
  occurredAt: string;
  createdAt: string;
}

export interface ExportSnapshot {
  id: number;
  capturedAt: string;
  applyUrl: string | null;
  requirementsText: string | null;
  descriptionHtmlSanitized: string | null;
  salary: unknown;
  job: Record<string, unknown>;
}

export interface ExportReminder {
  id: number;
  dueAt: string;
  note: string | null;
  doneAt: string | null;
}

export interface ExportApplication {
  id: number;
  jobId: number | null;
  companyName: string;
  title: string;
  countryIso2: string | null;
  currentStage: string;
  source: string | null;
  appliedAt: string | null;
  nextFollowUpAt: string | null;
  outcome: string | null;
  resumeVersion: { id: number; name: string; track: string } | null;
  createdAt: string;
  updatedAt: string;
  events: ExportEvent[];
  snapshots: ExportSnapshot[];
  reminders: ExportReminder[];
}

export interface TrackerExport {
  version: string;
  exportedAt: string;
  timeZone: string;
  counts: { applications: number; events: number; snapshots: number; reminders: number };
  applications: ExportApplication[];
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function buildTrackerExport(db: DbOrTx, opts: { now?: Date; timeZone: string }): Promise<TrackerExport> {
  const apps = await db
    .select({ app: applications, rv: { id: resumeVersions.id, name: resumeVersions.name, track: resumeVersions.track } })
    .from(applications)
    .leftJoin(resumeVersions, eq(resumeVersions.id, applications.resumeVersionId))
    .orderBy(asc(applications.id));
  const ids = apps.map((a) => a.app.id);
  const [events, snaps, rems] = ids.length
    ? await Promise.all([
        db.select().from(applicationEvents).where(inArray(applicationEvents.applicationId, ids)).orderBy(asc(applicationEvents.occurredAt), asc(applicationEvents.id)),
        db.select().from(applicationSnapshots).where(inArray(applicationSnapshots.applicationId, ids)).orderBy(asc(applicationSnapshots.capturedAt), asc(applicationSnapshots.id)),
        db.select().from(reminders).where(inArray(reminders.applicationId, ids)).orderBy(asc(reminders.dueAt), asc(reminders.id)),
      ])
    : [[], [], []];
  const group = <T extends { applicationId: number }>(rows: T[]) => {
    const m = new Map<number, T[]>();
    for (const r of rows) m.set(r.applicationId, [...(m.get(r.applicationId) ?? []), r]);
    return m;
  };
  const ev = group(events);
  const sn = group(snaps);
  const rm = group(rems);
  const out: ExportApplication[] = apps.map(({ app, rv }) => ({
    id: app.id,
    jobId: app.jobId,
    companyName: app.companyName,
    title: app.title,
    countryIso2: app.countryIso2,
    currentStage: app.currentStage,
    source: app.source,
    appliedAt: iso(app.appliedAt),
    nextFollowUpAt: iso(app.nextFollowUpAt),
    outcome: app.outcome,
    resumeVersion: rv && rv.id !== null ? { id: rv.id, name: rv.name, track: rv.track } : null,
    createdAt: app.createdAt.toISOString(),
    updatedAt: app.updatedAt.toISOString(),
    events: (ev.get(app.id) ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      stageFrom: e.stageFrom,
      stageTo: e.stageTo,
      body: e.body,
      meta: e.metaJson ?? null,
      occurredAt: e.occurredAt.toISOString(),
      createdAt: e.createdAt.toISOString(),
    })),
    snapshots: (sn.get(app.id) ?? []).map((s) => ({
      id: s.id,
      capturedAt: s.capturedAt.toISOString(),
      applyUrl: s.applyUrl,
      requirementsText: s.requirementsText,
      descriptionHtmlSanitized: s.descriptionHtmlSanitized,
      salary: s.salaryJson ?? null,
      job: s.jobJson,
    })),
    reminders: (rm.get(app.id) ?? []).map((r) => ({ id: r.id, dueAt: r.dueAt.toISOString(), note: r.note, doneAt: iso(r.doneAt) })),
  }));
  return {
    version: EXPORT_VERSION,
    exportedAt: (opts.now ?? new Date()).toISOString(),
    timeZone: opts.timeZone,
    counts: { applications: out.length, events: events.length, snapshots: snaps.length, reminders: rems.length },
    applications: out,
  };
}

function salaryText(v: unknown): string {
  if (v === null || v === undefined) return '';
  return JSON.stringify(v);
}

const APPLICATION_COLUMNS: CsvColumn<ExportApplication>[] = [
  { header: 'application_id', value: (a) => a.id },
  { header: 'job_id', value: (a) => a.jobId },
  { header: 'company', value: (a) => a.companyName },
  { header: 'title', value: (a) => a.title },
  { header: 'country', value: (a) => a.countryIso2 },
  { header: 'stage', value: (a) => a.currentStage },
  { header: 'source', value: (a) => a.source },
  { header: 'applied_at', value: (a) => a.appliedAt },
  { header: 'next_follow_up_at', value: (a) => a.nextFollowUpAt },
  { header: 'outcome', value: (a) => a.outcome },
  { header: 'resume_version', value: (a) => a.resumeVersion?.name ?? null },
  { header: 'events', value: (a) => a.events.length },
  { header: 'snapshots', value: (a) => a.snapshots.length },
  { header: 'open_reminders', value: (a) => a.reminders.filter((r) => !r.doneAt).length },
  { header: 'last_event_at', value: (a) => a.events.at(-1)?.occurredAt ?? null },
  { header: 'snapshot_apply_url', value: (a) => a.snapshots.at(-1)?.applyUrl ?? null },
  { header: 'created_at', value: (a) => a.createdAt },
  { header: 'updated_at', value: (a) => a.updatedAt },
];

interface EventRow {
  app: ExportApplication;
  e: ExportEvent;
}

const EVENT_COLUMNS: CsvColumn<EventRow>[] = [
  { header: 'application_id', value: (r) => r.app.id },
  { header: 'company', value: (r) => r.app.companyName },
  { header: 'title', value: (r) => r.app.title },
  { header: 'event_id', value: (r) => r.e.id },
  { header: 'kind', value: (r) => r.e.kind },
  { header: 'stage_from', value: (r) => r.e.stageFrom },
  { header: 'stage_to', value: (r) => r.e.stageTo },
  { header: 'occurred_at', value: (r) => r.e.occurredAt },
  { header: 'body', value: (r) => r.e.body },
  { header: 'interviewer', value: (r) => parseCommentMeta(r.e.meta).interviewer ?? null },
  { header: 'questions', value: (r) => parseCommentMeta(r.e.meta).questions ?? null },
  { header: 'went_well', value: (r) => parseCommentMeta(r.e.meta).wentWell ?? null },
  { header: 'next_steps', value: (r) => parseCommentMeta(r.e.meta).nextSteps ?? null },
  { header: 'meta_json', value: (r) => (r.e.meta ? JSON.stringify(r.e.meta) : null) },
];

interface SnapshotRow {
  app: ExportApplication;
  s: ExportSnapshot;
}

const SNAPSHOT_COLUMNS: CsvColumn<SnapshotRow>[] = [
  { header: 'application_id', value: (r) => r.app.id },
  { header: 'company', value: (r) => r.app.companyName },
  { header: 'title', value: (r) => r.app.title },
  { header: 'snapshot_id', value: (r) => r.s.id },
  { header: 'captured_at', value: (r) => r.s.capturedAt },
  { header: 'apply_url', value: (r) => r.s.applyUrl },
  { header: 'salary_json', value: (r) => salaryText(r.s.salary) },
  { header: 'requirements_text', value: (r) => r.s.requirementsText },
  { header: 'description_text', value: (r) => (typeof r.s.job.descriptionText === 'string' ? r.s.job.descriptionText : null) },
];

export function exportCsv(data: TrackerExport, part: ExportPart): string {
  switch (part) {
    case 'applications':
      return toCsv(data.applications, APPLICATION_COLUMNS);
    case 'events':
      return toCsv(
        data.applications.flatMap((app) => app.events.map((e) => ({ app, e }))),
        EVENT_COLUMNS,
      );
    case 'snapshots':
      return toCsv(
        data.applications.flatMap((app) => app.snapshots.map((s) => ({ app, s }))),
        SNAPSHOT_COLUMNS,
      );
  }
}

/** "radar-applications-2026-09-30.json" / "radar-applications-events-2026-09-30.csv". */
export function exportFilename(format: ExportFormat, part: ExportPart, localDay: string): string {
  const safeDay = /^\d{4}-\d{2}-\d{2}$/.test(localDay) ? localDay : 'export';
  if (format === 'json') return `radar-applications-${safeDay}.json`;
  return part === 'applications' ? `radar-applications-${safeDay}.csv` : `radar-applications-${part}-${safeDay}.csv`;
}
