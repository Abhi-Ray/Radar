/** Geography & visa knowledge base (versioned rules, change log, official page watches). */
import {
  boolean,
  date,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  tinyint,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { createdAt, id, iso2, ref, sha256, updatedAt, utc, utcNow } from './_columns';
import { PAGE_WATCH_STATUSES, VERIFICATION_STATUSES } from './_enums';

export const countries = mysqlTable(
  'countries',
  {
    /** ISO 3166-1 alpha-2; 'XW' = Remote / Worldwide pseudo-country (tier 0). */
    iso2: iso2('iso2').primaryKey(),
    name: varchar('name', { length: 100 }).notNull(),
    /** 1–4 per spec §4; 0 = remote. */
    tier: tinyint('tier', { unsigned: true }).notNull(),
    region: varchar('region', { length: 64 }),
    currency: varchar('currency', { length: 3 }),
    /** Goes live only when rules are verified and sources pass the checklist (spec §4, §7.4). */
    isLive: boolean('is_live').notNull().default(false),
    languagesJson: json('languages_json').$type<string[]>(),
    notes: text('notes'),
    salaryRangesJson: json('salary_ranges_json'),
    bestSitesJson: json('best_sites_json'),
    cvConventionsJson: json('cv_conventions_json'),
    languageNotes: text('language_notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index('countries_tier_idx').on(t.tier)],
);

export const visaRoutes = mysqlTable(
  'visa_routes',
  {
    id: id(),
    countryIso2: iso2('country_iso2')
      .notNull()
      .references(() => countries.iso2, { onUpdate: 'cascade' }),
    /** Stable code, e.g. 'eu_blue_card', 'uk_skilled_worker'. */
    code: varchar('code', { length: 64 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    officialUrl: varchar('official_url', { length: 2048 }),
    isActive: boolean('is_active').notNull().default(true),
    notes: text('notes'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex('visa_routes_country_code_uq').on(t.countryIso2, t.code)],
);

/** Versioned rules: never edited in place once verified — a change = a new version row. */
export const visaRuleVersions = mysqlTable(
  'visa_rule_versions',
  {
    id: id(),
    routeId: ref('route_id')
      .notNull()
      .references(() => visaRoutes.id, { onDelete: 'cascade' }),
    version: int('version').notNull(),
    /** 'YYYY-MM-DD' */
    effectiveFrom: date('effective_from', { mode: 'string' }),
    effectiveTo: date('effective_to', { mode: 'string' }),
    /** Annual gross EUR threshold (converted if the rule is in local currency). */
    salaryThresholdEur: int('salary_threshold_eur', { unsigned: true }),
    salaryThresholdLocal: int('salary_threshold_local', { unsigned: true }),
    currency: varchar('currency', { length: 3 }),
    degreeRule: text('degree_rule'),
    experienceRule: text('experience_rule'),
    otherRulesJson: json('other_rules_json'),
    ruleText: text('rule_text'),
    officialSourceUrl: varchar('official_source_url', { length: 2048 }),
    verificationStatus: mysqlEnum('verification_status', VERIFICATION_STATUSES).notNull().default('unverified'),
    lastVerifiedAt: utc('last_verified_at'),
    nextReviewAt: utc('next_review_at'),
    verifiedBy: varchar('verified_by', { length: 64 }),
    changeReason: text('change_reason'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('visa_rule_versions_route_version_uq').on(t.routeId, t.version),
    index('visa_rule_versions_effective_idx').on(t.routeId, t.effectiveFrom),
  ],
);

/** Log of every rule change (what, when, why, source) — spec §13.1. */
export const visaRuleChanges = mysqlTable(
  'visa_rule_changes',
  {
    id: id(),
    routeId: ref('route_id')
      .notNull()
      .references(() => visaRoutes.id, { onDelete: 'cascade' }),
    ruleVersionId: ref('rule_version_id').references(() => visaRuleVersions.id, { onDelete: 'set null' }),
    /** created | updated | verified | retired | page_changed */
    changeKind: varchar('change_kind', { length: 32 }).notNull(),
    what: text('what').notNull(),
    why: text('why'),
    sourceUrl: varchar('source_url', { length: 2048 }),
    beforeJson: json('before_json'),
    afterJson: json('after_json'),
    actor: varchar('actor', { length: 64 }).notNull().default('admin'),
    changedAt: utcNow('changed_at'),
  },
  (t) => [index('visa_rule_changes_route_idx').on(t.routeId, t.changedAt)],
);

/** Official immigration pages watched for changes (never auto-rewrites rules). */
export const officialPageWatches = mysqlTable(
  'official_page_watches',
  {
    id: id(),
    url: varchar('url', { length: 2048 }).notNull(),
    urlHash: sha256('url_hash').notNull(),
    routeId: ref('route_id').references(() => visaRoutes.id, { onDelete: 'set null' }),
    lastHash: sha256('last_hash'),
    lastCheckedAt: utc('last_checked_at'),
    changedAt: utc('changed_at'),
    status: mysqlEnum('status', PAGE_WATCH_STATUSES).notNull().default('unchecked'),
    lastError: text('last_error'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('official_page_watches_url_uq').on(t.urlHash), index('official_page_watches_status_idx').on(t.status)],
);
