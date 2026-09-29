/** Accuracy: golden sample (ground truth), evaluation runs, weekly human spot-checks (spec §17). */
import { type AnyMySqlColumn, boolean, index, int, json, mysqlEnum, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import { createdAt, id, iso2, ref, updatedAt, utcNow } from './_columns';
import { GOLDEN_ORIGINS } from './_enums';
import { jobs } from './jobs';
import { sources } from './sources';

/**
 * Hand-labelled ground truth. `snapshot_json` is a self-contained copy of the posting (title,
 * company, location, description text, source, url) so the sample survives the job being deleted.
 * `labels_json`: {role_match, seniority, visa_status, remote_class, salary{...}, language} —
 * shape defined by GoldenLabels in src/lib/contracts/accuracy.ts. Absent key = not labelled.
 */
export const goldenSamples = mysqlTable(
  'golden_samples',
  {
    id: id(),
    jobId: ref('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    snapshotJson: json('snapshot_json').$type<Record<string, unknown>>().notNull(),
    labelsJson: json('labels_json').$type<Record<string, unknown>>().notNull(),
    /** Denormalised for per-source / per-country accuracy breakdowns. */
    sourceKey: varchar('source_key', { length: 191 }),
    countryIso2: iso2('country_iso2'),
    labeledAt: utcNow('labeled_at'),
    notes: text('notes'),
    origin: mysqlEnum('origin', GOLDEN_ORIGINS).notNull().default('manual'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('golden_samples_job_idx').on(t.jobId),
    index('golden_samples_origin_idx').on(t.origin),
    index('golden_samples_source_idx').on(t.sourceKey),
  ],
);

/**
 * One evaluation of the current logic over the golden sample. `results_json` holds per-field
 * {precision, recall, accuracy, support} (+ per-source breakdown); `blocked` = a regression vs
 * `compared_to_run_id` blocks the change from going live (spec §17.2).
 */
export const accuracyRuns = mysqlTable(
  'accuracy_runs',
  {
    id: id(),
    logicVersionsJson: json('logic_versions_json').$type<Record<string, string>>().notNull(),
    resultsJson: json('results_json').$type<Record<string, unknown>>().notNull(),
    sampleCount: int('sample_count').notNull(),
    blocked: boolean('blocked').notNull().default(false),
    blockedReasonsJson: json('blocked_reasons_json').$type<string[]>(),
    comparedToRunId: ref('compared_to_run_id').references((): AnyMySqlColumn => accuracyRuns.id, { onDelete: 'set null' }),
    /** 'cli' | 'ui' | 'ci' */
    trigger: varchar('trigger', { length: 32 }),
    durationMs: int('duration_ms'),
    createdAt: createdAt(),
  },
  (t) => [index('accuracy_runs_created_idx').on(t.createdAt)],
);

/** Weekly 10-random-jobs human check; each wrong field is logged with an error type. */
export const spotChecks = mysqlTable(
  'spot_checks',
  {
    id: id(),
    jobId: ref('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    sourceId: ref('source_id').references(() => sources.id, { onDelete: 'set null' }),
    field: varchar('field', { length: 64 }).notNull(),
    wasCorrect: boolean('was_correct').notNull(),
    /** e.g. wrong_value | missed | false_positive | stale | parse_error | other */
    errorType: varchar('error_type', { length: 64 }),
    note: text('note'),
    /** Groups the checks done in one sitting, e.g. '2026-W40'. */
    batchKey: varchar('batch_key', { length: 32 }),
    checkedAt: utcNow('checked_at'),
    goldenSampleId: ref('golden_sample_id').references(() => goldenSamples.id, { onDelete: 'set null' }),
  },
  (t) => [
    index('spot_checks_checked_idx').on(t.checkedAt),
    index('spot_checks_field_idx').on(t.field, t.wasCorrect),
    index('spot_checks_job_idx').on(t.jobId),
  ],
);
