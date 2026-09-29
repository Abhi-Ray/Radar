/** Source registry: platforms (terms, grade, politeness), source instances, per-run results. */
import { index, int, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { createdAt, id, iso2, ref, updatedAt, utc } from './_columns';
import { GRADES, SOURCE_RUN_STATUSES, SOURCE_STATUSES, TERMS_STATUSES } from './_enums';
import { companies } from './companies';
import { countries } from './geo';
import { pipelineRuns } from './pipeline';

/** One row per platform/connector type (greenhouse, lever, arbeitnow, bundesagentur, ...). */
export const sourcePlatforms = mysqlTable('source_platforms', {
  key: varchar('key', { length: 64 }).primaryKey(),
  name: varchar('name', { length: 128 }).notNull(),
  grade: mysqlEnum('grade', GRADES).notNull(),
  /** api | feed | ats_json | html | register | csv */
  accessMethod: varchar('access_method', { length: 64 }).notNull(),
  termsUrl: varchar('terms_url', { length: 2048 }),
  termsStatus: mysqlEnum('terms_status', TERMS_STATUSES).notNull().default('unknown'),
  termsReviewedAt: utc('terms_reviewed_at'),
  termsNotes: text('terms_notes'),
  rateLimitPerMin: int('rate_limit_per_min').notNull().default(30),
  dailyCap: int('daily_cap').notNull().default(1000),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

/** Per spec §7.4 — each item {done, at, note}. */
export type SourceChecklistItem = { done: boolean; at: string | null; note: string | null };
export type SourceChecklist = {
  terms_reviewed: SourceChecklistItem;
  samples_saved: SourceChecklistItem;
  parser_handles_samples: SourceChecklistItem;
  baseline_recorded: SourceChecklistItem;
  rate_limit_set: SourceChecklistItem;
  alerts_configured: SourceChecklistItem;
  hand_checked_20: SourceChecklistItem;
};
export type SourceBaseline = {
  volume_min: number | null;
  volume_max: number | null;
  freshness_hours: number | null;
  /** field → share of records (0..1) that normally carry it. */
  field_presence: Record<string, number>;
};

/** One configured source instance (e.g. greenhouse board "gitlab"). */
export const sources = mysqlTable(
  'sources',
  {
    id: id(),
    /** Stable natural key for idempotent seeding, e.g. 'greenhouse:gitlab'. */
    sourceKey: varchar('source_key', { length: 191 }).notNull(),
    platformKey: varchar('platform_key', { length: 64 })
      .notNull()
      .references(() => sourcePlatforms.key, { onUpdate: 'cascade' }),
    /** Connector config, e.g. {board: 'gitlab'}. Never secrets. */
    configJson: json('config_json').$type<Record<string, unknown>>().notNull(),
    label: varchar('label', { length: 191 }).notNull(),
    countryIso2: iso2('country_iso2').references(() => countries.iso2, { onUpdate: 'cascade' }),
    companyId: ref('company_id').references(() => companies.id, { onDelete: 'set null' }),
    status: mysqlEnum('status', SOURCE_STATUSES).notNull().default('draft'),
    checklistJson: json('checklist_json').$type<SourceChecklist>(),
    baselineJson: json('baseline_json').$type<SourceBaseline>(),
    consecutiveFailures: int('consecutive_failures').notNull().default(0),
    circuitOpenUntil: utc('circuit_open_until'),
    lastRunAt: utc('last_run_at'),
    lastSuccessAt: utc('last_success_at'),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('sources_source_key_uq').on(t.sourceKey),
    index('sources_platform_idx').on(t.platformKey),
    index('sources_status_idx').on(t.status),
    index('sources_country_idx').on(t.countryIso2),
  ],
);

/** Result of one source inside one pipeline run. */
export const sourceRuns = mysqlTable(
  'source_runs',
  {
    id: id(),
    runId: ref('run_id')
      .notNull()
      .references(() => pipelineRuns.id, { onDelete: 'cascade' }),
    sourceId: ref('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    status: mysqlEnum('status', SOURCE_RUN_STATUSES).notNull().default('running'),
    fetched: int('fetched').notNull().default(0),
    parsed: int('parsed').notNull().default(0),
    newCount: int('new_count').notNull().default(0),
    updatedCount: int('updated_count').notNull().default(0),
    closedCount: int('closed_count').notNull().default(0),
    failedParse: int('failed_parse').notNull().default(0),
    durationMs: int('duration_ms'),
    error: text('error'),
    /** e.g. {volume_drop: true, parse_fail_pct: 0.3, schema_drift: ['salary']} */
    healthFlagsJson: json('health_flags_json'),
    startedAt: utc('started_at'),
    finishedAt: utc('finished_at'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('source_runs_run_source_uq').on(t.runId, t.sourceId),
    index('source_runs_source_created_idx').on(t.sourceId, t.createdAt),
  ],
);
