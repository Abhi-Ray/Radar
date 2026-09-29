/** Pipeline: runs (also the UI → worker run queue), the single-run lock, raw snapshots, dead letters. */
import {
  boolean,
  index,
  int,
  json,
  longtext,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { createdAt, id, ref, sha256, updatedAt, utc, utcNow } from './_columns';
import { DEAD_LETTER_STAGES, DEAD_LETTER_STATUSES, RUN_KINDS, RUN_STATUSES } from './_enums';
import { sources } from './sources';

/**
 * A pipeline run. The web app never runs the pipeline in-process: it inserts status='queued'
 * (see src/lib/pipeline/queue.ts) and the worker executes queued rows in order.
 * `stats_json.params` carries the queued parameters (e.g. {sourceIds}).
 */
export const pipelineRuns = mysqlTable(
  'pipeline_runs',
  {
    id: id(),
    kind: mysqlEnum('kind', RUN_KINDS).notNull(),
    status: mysqlEnum('status', RUN_STATUSES).notNull().default('queued'),
    /** 'ui' | 'cron' | 'cli' | 'system' */
    requestedBy: varchar('requested_by', { length: 32 }).notNull(),
    startedAt: utc('started_at'),
    finishedAt: utc('finished_at'),
    lockOwner: varchar('lock_owner', { length: 128 }),
    statsJson: json('stats_json').$type<Record<string, unknown>>(),
    logicVersionsJson: json('logic_versions_json').$type<Record<string, string>>(),
    dryRun: boolean('dry_run').notNull().default(false),
    error: text('error'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('pipeline_runs_status_created_idx').on(t.status, t.createdAt),
    index('pipeline_runs_kind_created_idx').on(t.kind, t.createdAt),
  ],
);

/**
 * Named locks with heartbeat (row 'pipeline' = the single-run lock). Acquire with an
 * INSERT … ON DUPLICATE KEY UPDATE guarded by expires_at; a stale lock (no heartbeat) expires.
 */
export const pipelineLock = mysqlTable('pipeline_lock', {
  name: varchar('name', { length: 64 }).primaryKey(),
  owner: varchar('owner', { length: 128 }),
  runId: ref('run_id'),
  acquiredAt: utc('acquired_at'),
  heartbeatAt: utc('heartbeat_at'),
  expiresAt: utc('expires_at'),
});

/** Untouched source data. Never edited. Retained 90 days unless linked to a saved/applied job. */
export const rawSnapshots = mysqlTable(
  'raw_snapshots',
  {
    id: id(),
    sourceId: ref('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    runId: ref('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
    /** ≤255 chars; connectors hash longer natural ids. */
    externalId: varchar('external_id', { length: 255 }).notNull(),
    /** sha256 of the canonical JSON payload. */
    contentHash: sha256('content_hash').notNull(),
    /** JSON text exactly as received (after JSON.stringify). */
    payload: longtext('payload').notNull(),
    url: varchar('url', { length: 2048 }),
    fetchedAt: utcNow('fetched_at'),
    parserVersion: varchar('parser_version', { length: 64 }).notNull(),
    /** true = keep beyond the retention window (linked to a saved/applied job). */
    retained: boolean('retained').notNull().default(false),
  },
  (t) => [
    uniqueIndex('raw_snapshots_source_ext_hash_uq').on(t.sourceId, t.externalId, t.contentHash),
    index('raw_snapshots_fetched_idx').on(t.fetchedAt),
    index('raw_snapshots_run_idx').on(t.runId),
  ],
);

export const deadLetters = mysqlTable(
  'dead_letters',
  {
    id: id(),
    sourceId: ref('source_id').references(() => sources.id, { onDelete: 'cascade' }),
    runId: ref('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
    rawSnapshotId: ref('raw_snapshot_id').references(() => rawSnapshots.id, { onDelete: 'set null' }),
    externalId: varchar('external_id', { length: 255 }),
    stage: mysqlEnum('stage', DEAD_LETTER_STAGES).notNull(),
    error: text('error').notNull(),
    payloadExcerpt: text('payload_excerpt'),
    status: mysqlEnum('status', DEAD_LETTER_STATUSES).notNull().default('open'),
    retryCount: int('retry_count').notNull().default(0),
    parserVersion: varchar('parser_version', { length: 64 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    resolvedAt: utc('resolved_at'),
  },
  (t) => [
    index('dead_letters_status_created_idx').on(t.status, t.createdAt),
    index('dead_letters_source_idx').on(t.sourceId, t.status),
  ],
);
