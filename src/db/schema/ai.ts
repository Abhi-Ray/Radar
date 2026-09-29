/** AI layer bookkeeping: daily budget counter, call log, content cache, priority queue (spec §15). */
import { index, int, json, mysqlEnum, mysqlTable, smallint, text, uniqueIndex, varchar, date } from 'drizzle-orm/mysql-core';
import { createdAt, id, ref, sha256, updatedAt, utc } from './_columns';
import { AI_CALL_STATUSES, AI_QUEUE_STATUSES } from './_enums';
import { jobs } from './jobs';

/**
 * One row per UTC day. `calls_used` is incremented atomically BEFORE each call
 * (UPDATE … SET calls_used = calls_used + 1 WHERE day = ? AND calls_used < calls_limit);
 * zero affected rows = budget exhausted. `remote_used` mirrors OpenRouter's own counter
 * (GET /api/v1/key → data.free_model_daily_requests) when synced.
 */
export const aiUsage = mysqlTable(
  'ai_usage',
  {
    id: id(),
    /** 'YYYY-MM-DD' (UTC day). */
    day: date('day', { mode: 'string' }).notNull(),
    callsUsed: int('calls_used').notNull().default(0),
    callsLimit: int('calls_limit').notNull(),
    remoteUsed: int('remote_used'),
    syncedAt: utc('synced_at'),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('ai_usage_day_uq').on(t.day)],
);

/** Every attempted call (including ones refused for budget) — never contains secrets or full prompts. */
export const aiCalls = mysqlTable(
  'ai_calls',
  {
    id: id(),
    task: varchar('task', { length: 64 }).notNull(),
    model: varchar('model', { length: 128 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    jobIdsJson: json('job_ids_json').$type<number[]>(),
    status: mysqlEnum('status', AI_CALL_STATUSES).notNull(),
    latencyMs: int('latency_ms'),
    tokensIn: int('tokens_in'),
    tokensOut: int('tokens_out'),
    /** Number of facts rejected by validation / quote verification in this call. */
    rejectedCount: int('rejected_count'),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_calls_created_idx').on(t.createdAt), index('ai_calls_status_idx').on(t.status, t.createdAt)],
);

/**
 * Content-addressed cache so the same text is never sent twice.
 * `cache_key` = sha256(content_hash + '|' + task + '|' + prompt_version) — the UNIQUE contract of
 * (content_hash, task, prompt_version) in one bounded index.
 */
export const aiCache = mysqlTable(
  'ai_cache',
  {
    id: id(),
    cacheKey: sha256('cache_key').notNull(),
    contentHash: sha256('content_hash').notNull(),
    task: varchar('task', { length: 64 }).notNull(),
    promptVersion: varchar('prompt_version', { length: 64 }).notNull(),
    model: varchar('model', { length: 128 }),
    responseJson: json('response_json').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('ai_cache_key_uq').on(t.cacheKey),
    index('ai_cache_content_idx').on(t.contentHash, t.task),
  ],
);

/** Priority queue: top-fit jobs first; the rest wait for tomorrow's budget. */
export const aiQueue = mysqlTable(
  'ai_queue',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    task: varchar('task', { length: 64 }).notNull(),
    /** Higher = sooner (typically the fit score; manual requests get a boost). */
    priority: smallint('priority').notNull().default(0),
    status: mysqlEnum('status', AI_QUEUE_STATUSES).notNull().default('queued'),
    attempts: int('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: createdAt(),
    doneAt: utc('done_at'),
  },
  (t) => [
    index('ai_queue_status_priority_idx').on(t.status, t.priority, t.createdAt),
    index('ai_queue_job_task_idx').on(t.jobId, t.task, t.status),
  ],
);
