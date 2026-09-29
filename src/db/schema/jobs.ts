/**
 * Jobs and everything attached to them: sources, provenance facts, change history, scores,
 * duplicate candidates, manual overrides, corrections, title review queue, link checks.
 */
import {
  type AnyMySqlColumn,
  boolean,
  double,
  index,
  int,
  json,
  mediumtext,
  mysqlEnum,
  mysqlTable,
  smallint,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { createdAt, id, iso2, ref, sha256, updatedAt, utc, utcNow } from './_columns';
import {
  CONFIDENCES,
  DUPLICATE_STATUSES,
  ELIGIBILITY_RESULTS,
  EXPERIENCE_BANDS,
  GRADES,
  JOB_STATES,
  LANGUAGE_REQUIREMENTS,
  LINK_STATUSES,
  METHODS,
  REMOTE_CLASSES,
  ROLE_FAMILIES,
  SALARY_KINDS,
  SENIORITY_WORDS,
  TITLE_REVIEW_STATUSES,
  VISA_STATUSES,
  WORKPLACE_TYPES,
} from './_enums';
import { goldenSamples } from './accuracy';
import { companies } from './companies';
import { countries } from './geo';
import { pipelineRuns, rawSnapshots } from './pipeline';
import { sources } from './sources';

export const jobs = mysqlTable(
  'jobs',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => companies.id),
    canonicalTitle: varchar('canonical_title', { length: 255 }).notNull(),
    titleRaw: varchar('title_raw', { length: 512 }).notNull(),
    roleKey: varchar('role_key', { length: 64 }),
    roleFamily: mysqlEnum('role_family', ROLE_FAMILIES).notNull().default('other'),
    countryIso2: iso2('country_iso2').references(() => countries.iso2, { onUpdate: 'cascade' }),
    city: varchar('city', { length: 128 }),
    region: varchar('region', { length: 128 }),
    locationRaw: varchar('location_raw', { length: 512 }).notNull().default(''),
    workplaceType: mysqlEnum('workplace_type', WORKPLACE_TYPES),
    /** Sanitised with sanitizePostingHtml() — the ONLY html ever rendered. */
    descriptionHtmlSanitized: mediumtext('description_html_sanitized'),
    descriptionText: mediumtext('description_text').notNull(),
    /** sha256 of normalised description text (dedup + change detection + AI cache). */
    descriptionHash: sha256('description_hash').notNull(),
    applyUrl: varchar('apply_url', { length: 2048 }).notNull(),
    applyUrlClean: varchar('apply_url_clean', { length: 2048 }).notNull(),
    /** sha256(apply_url_clean) — "same link" dedup lookups. */
    applyUrlHash: sha256('apply_url_hash').notNull(),
    bestSourceId: ref('best_source_id').references(() => sources.id, { onDelete: 'set null' }),
    postedAt: utc('posted_at'),
    closingAt: utc('closing_at'),
    firstSeenAt: utcNow('first_seen_at'),
    lastSeenAt: utcNow('last_seen_at'),
    lastConfirmedLiveAt: utc('last_confirmed_live_at'),
    state: mysqlEnum('state', JOB_STATES).notNull().default('new'),
    missingRunCount: int('missing_run_count').notNull().default(0),
    ghostRisk: boolean('ghost_risk').notNull().default(false),
    repostCount: int('repost_count').notNull().default(0),
    linkStatus: mysqlEnum('link_status', LINK_STATUSES).notNull().default('unknown'),
    linkCheckedAt: utc('link_checked_at'),
    needsReview: boolean('needs_review').notNull().default(false),
    hidden: boolean('hidden').notNull().default(false),
    hiddenReason: varchar('hidden_reason', { length: 255 }),
    saved: boolean('saved').notNull().default(false),
    /** Posting language (ISO 639-1). */
    lang: varchar('lang', { length: 8 }),
    contentVersion: int('content_version').notNull().default(1),
    /** Set when merged into another job (the merge persists; this row is kept for history). */
    mergedIntoJobId: ref('merged_into_job_id').references((): AnyMySqlColumn => jobs.id, { onDelete: 'set null' }),

    // ---- Denormalised RESOLVED facts for fast list filtering. Source of truth = job_facts +
    // job_overrides; kept in sync by syncResolvedJobColumns() (src/lib/provenance/store.ts).
    visaStatus: mysqlEnum('visa_status', VISA_STATUSES),
    visaConfidence: mysqlEnum('visa_confidence', CONFIDENCES),
    remoteClass: mysqlEnum('remote_class', REMOTE_CLASSES),
    languageRequirement: mysqlEnum('language_requirement', LANGUAGE_REQUIREMENTS),
    experienceBand: mysqlEnum('experience_band', EXPERIENCE_BANDS),
    experienceMinYears: tinyint('experience_min_years', { unsigned: true }),
    seniority: mysqlEnum('seniority', SENIORITY_WORDS),
    eligibility: mysqlEnum('eligibility', ELIGIBILITY_RESULTS),
    salaryEurMin: int('salary_eur_min', { unsigned: true }),
    salaryEurMax: int('salary_eur_max', { unsigned: true }),
    salaryKind: mysqlEnum('salary_kind', SALARY_KINDS),
    /** Lowest confidence among the resolved displayed facts (for the "confidence" filter). */
    factsConfidence: mysqlEnum('facts_confidence', CONFIDENCES),
    /** Current fit score 0–100 (mirror of job_scores.is_current). */
    score: tinyint('score', { unsigned: true }),
    scoreVersion: varchar('score_version', { length: 64 }),
    resolvedAt: utc('resolved_at'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('jobs_state_country_idx').on(t.state, t.countryIso2),
    index('jobs_posted_idx').on(t.postedAt),
    index('jobs_company_idx').on(t.companyId),
    index('jobs_first_seen_idx').on(t.firstSeenAt),
    index('jobs_apply_url_hash_idx').on(t.applyUrlHash),
    index('jobs_description_hash_idx').on(t.descriptionHash),
    index('jobs_score_idx').on(t.hidden, t.score),
    index('jobs_visa_idx').on(t.visaStatus),
    index('jobs_role_idx').on(t.roleFamily, t.roleKey),
    index('jobs_merged_idx').on(t.mergedIntoJobId),
  ],
);

/** Every place a job appeared. One job keeps ALL its source links; best grade shown first. */
export const jobSources = mysqlTable(
  'job_sources',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    sourceId: ref('source_id')
      .notNull()
      .references(() => sources.id, { onDelete: 'cascade' }),
    externalId: varchar('external_id', { length: 255 }).notNull(),
    url: varchar('url', { length: 2048 }).notNull(),
    grade: mysqlEnum('grade', GRADES).notNull(),
    firstSeenAt: utcNow('first_seen_at'),
    lastSeenAt: utcNow('last_seen_at'),
    rawSnapshotId: ref('raw_snapshot_id').references(() => rawSnapshots.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('job_sources_source_external_uq').on(t.sourceId, t.externalId),
    index('job_sources_job_idx').on(t.jobId),
  ],
);

/**
 * Provenance facts. ALL candidates are kept; the displayed value is resolved by trust order
 * (src/lib/provenance/resolve.ts). A newer candidate from the same (method, source) supersedes
 * the older one (is_active=false) instead of deleting it.
 */
export const jobFacts = mysqlTable(
  'job_facts',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    /** FactKey (src/lib/contracts/provenance.ts). */
    factKey: varchar('fact_key', { length: 32 }).notNull(),
    valueJson: json('value_json').notNull(),
    /** sha256 of the canonical JSON value (idempotent re-adds). */
    valueHash: sha256('value_hash').notNull(),
    evidence: text('evidence'),
    source: varchar('source', { length: 512 }).notNull(),
    method: mysqlEnum('method', METHODS).notNull(),
    confidence: mysqlEnum('confidence', CONFIDENCES).notNull(),
    checkedAt: utcNow('checked_at'),
    logicVersion: varchar('logic_version', { length: 64 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    index('job_facts_job_key_active_idx').on(t.jobId, t.factKey, t.isActive),
    index('job_facts_key_method_idx').on(t.factKey, t.method),
  ],
);

/** History of changes to title / salary / description / dates etc. (spec §12). */
export const jobChanges = mysqlTable(
  'job_changes',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    field: varchar('field', { length: 64 }).notNull(),
    oldValue: mediumtext('old_value'),
    newValue: mediumtext('new_value'),
    changedAt: utcNow('changed_at'),
    runId: ref('run_id').references(() => pipelineRuns.id, { onDelete: 'set null' }),
  },
  (t) => [index('job_changes_job_idx').on(t.jobId, t.changedAt)],
);

export const jobScores = mysqlTable(
  'job_scores',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    score: tinyint('score', { unsigned: true }).notNull(),
    componentsJson: json('components_json').notNull(),
    scoreVersion: varchar('score_version', { length: 64 }).notNull(),
    /** sha256 of scoring inputs + weights; unchanged hash → no re-score needed. */
    inputsHash: sha256('inputs_hash'),
    computedAt: utcNow('computed_at'),
    isCurrent: boolean('is_current').notNull().default(true),
  },
  (t) => [index('job_scores_job_current_idx').on(t.jobId, t.isCurrent), index('job_scores_current_score_idx').on(t.isCurrent, t.score)],
);

/** Uncertain duplicate pairs for review. Convention: job_a < job_b. */
export const duplicateCandidates = mysqlTable(
  'duplicate_candidates',
  {
    id: id(),
    jobA: ref('job_a')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    jobB: ref('job_b')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    score: double('score').notNull(),
    reasonsJson: json('reasons_json').$type<string[]>(),
    status: mysqlEnum('status', DUPLICATE_STATUSES).notNull().default('open'),
    decidedAt: utc('decided_at'),
    decidedReason: text('decided_reason'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('duplicate_candidates_pair_uq').on(t.jobA, t.jobB), index('duplicate_candidates_status_idx').on(t.status)],
);

/** My manual fixes. Survive re-scrapes; the active one per (job, field) wins over everything. */
export const jobOverrides = mysqlTable(
  'job_overrides',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    field: varchar('field', { length: 64 }).notNull(),
    valueJson: json('value_json').notNull(),
    reason: text('reason').notNull(),
    createdAt: createdAt(),
    active: boolean('active').notNull().default(true),
    deactivatedAt: utc('deactivated_at'),
  },
  (t) => [index('job_overrides_job_field_idx').on(t.jobId, t.field, t.active)],
);

/** "Report wrong info" entries; each also lands in the golden sample. */
export const corrections = mysqlTable(
  'corrections',
  {
    id: id(),
    jobId: ref('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    field: varchar('field', { length: 64 }).notNull(),
    wrongValueJson: json('wrong_value_json'),
    correctValueJson: json('correct_value_json'),
    note: text('note'),
    createdAt: createdAt(),
    addedToGolden: boolean('added_to_golden').notNull().default(false),
    goldenSampleId: ref('golden_sample_id').references((): AnyMySqlColumn => goldenSamples.id, { onDelete: 'set null' }),
  },
  (t) => [index('corrections_job_idx').on(t.jobId), index('corrections_field_idx').on(t.field, t.createdAt)],
);

/** Titles that mapTitle() could not map — reviewed by hand instead of guessed. */
export const titleReviewQueue = mysqlTable(
  'title_review_queue',
  {
    id: id(),
    titleRaw: varchar('title_raw', { length: 512 }).notNull(),
    normalized: varchar('normalized', { length: 191 }).notNull(),
    count: int('count').notNull().default(1),
    lang: varchar('lang', { length: 8 }),
    sampleJobId: ref('sample_job_id').references(() => jobs.id, { onDelete: 'set null' }),
    firstSeen: utcNow('first_seen'),
    lastSeen: utcNow('last_seen'),
    status: mysqlEnum('status', TITLE_REVIEW_STATUSES).notNull().default('open'),
    mappedRoleKey: varchar('mapped_role_key', { length: 64 }),
    decidedAt: utc('decided_at'),
  },
  (t) => [uniqueIndex('title_review_normalized_uq').on(t.normalized), index('title_review_status_idx').on(t.status, t.count)],
);

export const linkChecks = mysqlTable(
  'link_checks',
  {
    id: id(),
    jobId: ref('job_id')
      .notNull()
      .references(() => jobs.id, { onDelete: 'cascade' }),
    url: varchar('url', { length: 2048 }).notNull(),
    statusCode: smallint('status_code', { unsigned: true }),
    finalUrl: varchar('final_url', { length: 2048 }),
    ok: boolean('ok').notNull(),
    durationMs: int('duration_ms'),
    checkedAt: utcNow('checked_at'),
    error: text('error'),
  },
  (t) => [index('link_checks_job_idx').on(t.jobId, t.checkedAt)],
);
