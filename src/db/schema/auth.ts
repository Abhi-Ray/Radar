/** Auth & ops tables: sessions, login_attempts, audit_log, settings, alerts, backup_runs. */
import { bigint, boolean, index, int, json, mysqlEnum, mysqlTable, text, uniqueIndex, varchar } from 'drizzle-orm/mysql-core';
import { createdAt, id, sha256, updatedAt, utc, utcNow } from './_columns';
import { ALERT_SEVERITIES, BACKUP_KINDS, BACKUP_STATUSES, LOGIN_OUTCOMES } from './_enums';

/** One row per login session. The cookie JWT carries `sid`; only sha256(sid) is stored. */
export const sessions = mysqlTable(
  'sessions',
  {
    id: id(),
    sidHash: sha256('sid_hash').notNull(),
    email: varchar('email', { length: 254 }).notNull(),
    createdAt: createdAt(),
    lastSeenAt: utcNow('last_seen_at'),
    /** Last time the cookie/JWT was re-issued (sliding renewal). */
    renewedAt: utc('renewed_at'),
    ip: varchar('ip', { length: 64 }),
    userAgent: varchar('user_agent', { length: 512 }),
    revokedAt: utc('revoked_at'),
    revokedReason: varchar('revoked_reason', { length: 64 }),
  },
  (t) => [uniqueIndex('sessions_sid_hash_uq').on(t.sidHash), index('sessions_revoked_idx').on(t.revokedAt)],
);

/**
 * Every login attempt (success or failure). Rate limiting and lockouts are derived from here.
 * A row with outcome 'lockout' marks the start of a lockout and carries `locked_until`.
 */
export const loginAttempts = mysqlTable(
  'login_attempts',
  {
    id: id(),
    ip: varchar('ip', { length: 64 }).notNull(),
    outcome: mysqlEnum('outcome', LOGIN_OUTCOMES).notNull(),
    success: boolean('success').notNull().default(false),
    userAgent: varchar('user_agent', { length: 512 }),
    /** Only set on outcome 'lockout'. */
    lockedUntil: utc('locked_until'),
    /** 1 = first lockout (15 min), doubling per level, capped at 24h. */
    lockoutLevel: int('lockout_level'),
    at: utcNow('at'),
  },
  (t) => [index('login_attempts_ip_at_idx').on(t.ip, t.at), index('login_attempts_at_idx').on(t.at)],
);

/** Append-only audit trail for settings, visa rules, overrides, merges, auth events. */
export const auditLog = mysqlTable(
  'audit_log',
  {
    id: id(),
    /** 'admin' (the single user), 'system', 'worker', 'anonymous' (failed logins). */
    actor: varchar('actor', { length: 64 }).notNull().default('admin'),
    action: varchar('action', { length: 96 }).notNull(),
    entityType: varchar('entity_type', { length: 64 }).notNull(),
    entityId: varchar('entity_id', { length: 128 }),
    beforeJson: json('before_json'),
    afterJson: json('after_json'),
    reason: text('reason'),
    ip: varchar('ip', { length: 64 }),
    at: utcNow('at'),
  },
  (t) => [
    index('audit_entity_idx').on(t.entityType, t.entityId),
    index('audit_at_idx').on(t.at),
    index('audit_action_idx').on(t.action),
  ],
);

/** Typed JSON settings (see src/lib/settings.ts). Writes bump `version` and are audited. */
export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 64 }).primaryKey(),
  valueJson: json('value_json').notNull(),
  version: int('version').notNull().default(1),
  updatedAt: updatedAt(),
});

export const alerts = mysqlTable(
  'alerts',
  {
    id: id(),
    kind: varchar('kind', { length: 64 }).notNull(),
    severity: mysqlEnum('severity', ALERT_SEVERITIES).notNull(),
    title: varchar('title', { length: 255 }).notNull(),
    body: text('body'),
    entityType: varchar('entity_type', { length: 64 }),
    entityId: varchar('entity_id', { length: 128 }),
    /** Same dedupe_key while unacknowledged → bump `occurrences` instead of a new row. */
    dedupeKey: varchar('dedupe_key', { length: 191 }),
    occurrences: int('occurrences').notNull().default(1),
    createdAt: createdAt(),
    lastRaisedAt: utcNow('last_raised_at'),
    acknowledgedAt: utc('acknowledged_at'),
    sentChannelsJson: json('sent_channels_json'),
  },
  (t) => [
    index('alerts_dedupe_idx').on(t.dedupeKey, t.acknowledgedAt),
    index('alerts_created_idx').on(t.createdAt),
    index('alerts_ack_idx').on(t.acknowledgedAt, t.severity),
  ],
);

export const backupRuns = mysqlTable(
  'backup_runs',
  {
    id: id(),
    kind: mysqlEnum('kind', BACKUP_KINDS).notNull(),
    status: mysqlEnum('status', BACKUP_STATUSES).notNull().default('running'),
    startedAt: utcNow('started_at'),
    finishedAt: utc('finished_at'),
    sizeBytes: bigint('size_bytes', { mode: 'number', unsigned: true }),
    sha256: sha256('sha256'),
    detailsJson: json('details_json'),
    error: text('error'),
  },
  (t) => [index('backup_runs_kind_started_idx').on(t.kind, t.startedAt)],
);
