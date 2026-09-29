/** Company identity: companies, aliases/legal names, sponsor registers, evidence. */
import {
  type AnyMySqlColumn,
  boolean,
  foreignKey,
  index,
  json,
  mysqlEnum,
  mysqlTable,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core';
import { createdAt, id, iso2, ref, sha256, updatedAt, utcNow } from './_columns';
import { ALIAS_KINDS, COMPANY_TYPES, CONFIDENCES, EVIDENCE_KINDS, MATCH_STATUSES, METHODS } from './_enums';

export const companies = mysqlTable(
  'companies',
  {
    id: id(),
    name: varchar('name', { length: 255 }).notNull(),
    /** Lowercased, legal suffixes/punctuation stripped (see src/lib/company). */
    normalizedName: varchar('normalized_name', { length: 191 }).notNull(),
    domain: varchar('domain', { length: 191 }),
    hqCountry: iso2('hq_country'),
    /** Free-form band, e.g. '1-50', '51-250', '251-1000', '1000+'. */
    sizeBand: varchar('size_band', { length: 32 }),
    type: mysqlEnum('type', COMPANY_TYPES).notNull().default('unknown'),
    isAgency: boolean('is_agency').notNull().default(false),
    parentCompanyId: ref('parent_company_id').references((): AnyMySqlColumn => companies.id, { onDelete: 'set null' }),
    /** Set when this record was merged into another (merges persist across re-runs). */
    mergedIntoId: ref('merged_into_id').references((): AnyMySqlColumn => companies.id, { onDelete: 'set null' }),
    notes: text('notes'),
    /** Denormalised summary of company_evidence (e.g. {status:'likely', registers:[...], at}). */
    sponsorSummaryJson: json('sponsor_summary_json'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('companies_normalized_name_idx').on(t.normalizedName),
    index('companies_domain_idx').on(t.domain),
    index('companies_merged_into_idx').on(t.mergedIntoId),
  ],
);

export const companyAliases = mysqlTable(
  'company_aliases',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    alias: varchar('alias', { length: 255 }).notNull(),
    normalizedAlias: varchar('normalized_alias', { length: 191 }).notNull(),
    kind: mysqlEnum('kind', ALIAS_KINDS).notNull().default('other'),
    countryIso2: iso2('country_iso2'),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex('company_aliases_company_alias_kind_uq').on(t.companyId, t.normalizedAlias, t.kind),
    index('company_aliases_normalized_idx').on(t.normalizedAlias),
  ],
);

/** Public sponsor-register rows (e.g. UK Home Office, NL IND), one import = one register_version. */
export const sponsorRegisterEntries = mysqlTable(
  'sponsor_register_entries',
  {
    id: id(),
    /** uk_home_office | nl_ind | ... */
    registerKey: varchar('register_key', { length: 64 }).notNull(),
    countryIso2: iso2('country_iso2').notNull(),
    orgName: varchar('org_name', { length: 512 }).notNull(),
    normalizedName: varchar('normalized_name', { length: 191 }).notNull(),
    town: varchar('town', { length: 128 }),
    route: varchar('route', { length: 191 }),
    rating: varchar('rating', { length: 64 }),
    rawJson: json('raw_json'),
    /** sha256 of the canonical raw row — makes re-imports idempotent. */
    entryHash: sha256('entry_hash').notNull(),
    importedAt: utcNow('imported_at'),
    /** Download date of the register file, 'YYYY-MM-DD'. */
    registerVersion: varchar('register_version', { length: 32 }).notNull(),
  },
  (t) => [
    uniqueIndex('sponsor_register_version_entry_uq').on(t.registerKey, t.registerVersion, t.entryHash),
    index('sponsor_register_name_idx').on(t.registerKey, t.normalizedName),
    index('sponsor_register_country_name_idx').on(t.countryIso2, t.normalizedName),
  ],
);

export const companyEvidence = mysqlTable(
  'company_evidence',
  {
    id: id(),
    companyId: ref('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    kind: mysqlEnum('kind', EVIDENCE_KINDS).notNull(),
    /** e.g. {sponsors: true, route: 'Skilled Worker', rating: 'A'} */
    valueJson: json('value_json'),
    evidence: text('evidence'),
    source: varchar('source', { length: 512 }).notNull(),
    method: mysqlEnum('method', METHODS).notNull(),
    confidence: mysqlEnum('confidence', CONFIDENCES).notNull(),
    matchStatus: mysqlEnum('match_status', MATCH_STATUSES).notNull().default('possible'),
    /** FK declared below with an explicit name (the generated one exceeds MySQL's 64-char limit). */
    registerEntryId: ref('register_entry_id'),
    checkedAt: utcNow('checked_at'),
    logicVersion: varchar('logic_version', { length: 64 }).notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('company_evidence_company_kind_idx').on(t.companyId, t.kind),
    index('company_evidence_match_idx').on(t.matchStatus),
    foreignKey({
      name: 'company_evidence_register_entry_fk',
      columns: [t.registerEntryId],
      foreignColumns: [sponsorRegisterEntries.id],
    }).onDelete('set null'),
  ],
);
