/** Application tracker + application kit (spec §20, §22). */
import { index, json, mediumtext, mysqlEnum, mysqlTable, text, varchar } from 'drizzle-orm/mysql-core';
import { createdAt, id, iso2, ref, updatedAt, utc, utcNow } from './_columns';
import { APPLICATION_EVENT_KINDS, APPLICATION_STAGES, RESUME_TRACKS, TEMPLATE_KINDS } from './_enums';
import { countries } from './geo';
import { jobs } from './jobs';

export const resumeVersions = mysqlTable('resume_versions', {
  id: id(),
  name: varchar('name', { length: 191 }).notNull(),
  track: mysqlEnum('track', RESUME_TRACKS).notNull().default('other'),
  contentMd: mediumtext('content_md').notNull(),
  fileNote: varchar('file_note', { length: 512 }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const applications = mysqlTable(
  'applications',
  {
    id: id(),
    /** Nullable: applications can be logged for jobs RADAR never saw; survives job deletion. */
    jobId: ref('job_id').references(() => jobs.id, { onDelete: 'set null' }),
    companyName: varchar('company_name', { length: 255 }).notNull(),
    title: varchar('title', { length: 512 }).notNull(),
    countryIso2: iso2('country_iso2').references(() => countries.iso2, { onUpdate: 'cascade' }),
    currentStage: mysqlEnum('current_stage', APPLICATION_STAGES).notNull().default('saved'),
    resumeVersionId: ref('resume_version_id').references(() => resumeVersions.id, { onDelete: 'set null' }),
    appliedAt: utc('applied_at'),
    /** Where I found / applied (source label or free text). */
    source: varchar('source', { length: 191 }),
    nextFollowUpAt: utc('next_follow_up_at'),
    /** Free-form outcome note for terminal stages. */
    outcome: varchar('outcome', { length: 255 }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('applications_stage_idx').on(t.currentStage, t.updatedAt),
    index('applications_job_idx').on(t.jobId),
    index('applications_follow_up_idx').on(t.nextFollowUpAt),
  ],
);

/** APPEND-ONLY timeline. Never UPDATE or DELETE rows; corrections are new 'edit' events. */
export const applicationEvents = mysqlTable(
  'application_events',
  {
    id: id(),
    applicationId: ref('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', APPLICATION_EVENT_KINDS).notNull(),
    stageFrom: mysqlEnum('stage_from', APPLICATION_STAGES),
    stageTo: mysqlEnum('stage_to', APPLICATION_STAGES),
    body: text('body'),
    /** {interviewer, questions, went_well, next_steps, ...} */
    metaJson: json('meta_json').$type<Record<string, unknown>>(),
    occurredAt: utcNow('occurred_at'),
    createdAt: createdAt(),
  },
  (t) => [index('application_events_app_idx').on(t.applicationId, t.occurredAt)],
);

/** Copy of the posting taken when marked applied — interview prep survives the posting vanishing. */
export const applicationSnapshots = mysqlTable(
  'application_snapshots',
  {
    id: id(),
    applicationId: ref('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    jobJson: json('job_json').$type<Record<string, unknown>>().notNull(),
    descriptionHtmlSanitized: mediumtext('description_html_sanitized'),
    requirementsText: mediumtext('requirements_text'),
    applyUrl: varchar('apply_url', { length: 2048 }),
    salaryJson: json('salary_json'),
    capturedAt: utcNow('captured_at'),
  },
  (t) => [index('application_snapshots_app_idx').on(t.applicationId)],
);

export const templates = mysqlTable(
  'templates',
  {
    id: id(),
    kind: mysqlEnum('kind', TEMPLATE_KINDS).notNull(),
    name: varchar('name', { length: 191 }).notNull(),
    bodyMd: mediumtext('body_md').notNull(),
    /** Fill-in fields, e.g. [{key:'company', label:'Company'}]. */
    fieldsJson: json('fields_json').$type<unknown[]>(),
    countryIso2: iso2('country_iso2').references(() => countries.iso2, { onUpdate: 'cascade' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('templates_kind_idx').on(t.kind, t.countryIso2)],
);

/** Follow-up reminders. `due_at` is UTC; displayed/compared in APP_TZ. */
export const reminders = mysqlTable(
  'reminders',
  {
    id: id(),
    applicationId: ref('application_id')
      .notNull()
      .references(() => applications.id, { onDelete: 'cascade' }),
    dueAt: utc('due_at').notNull(),
    note: text('note'),
    doneAt: utc('done_at'),
    /** When the digest/alert about this reminder was sent (avoid repeats). */
    notifiedAt: utc('notified_at'),
    createdAt: createdAt(),
  },
  (t) => [index('reminders_due_idx').on(t.doneAt, t.dueAt), index('reminders_app_idx').on(t.applicationId)],
);
