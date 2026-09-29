/**
 * Shared column builders. Schema files use RELATIVE imports only (drizzle-kit loads them
 * outside of the Next/tsconfig alias world).
 *
 * Conventions:
 * - ids: BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY, mapped to JS number.
 * - timestamps: DATETIME(3) holding UTC, mapped to JS Date. Defaults are set both in the DB
 *   (CURRENT_TIMESTAMP(3), for raw SQL / backups) and in JS ($defaultFn) so values are exact.
 *   Every connection runs with time_zone '+00:00' (see src/lib/db).
 * - DATE columns are 'YYYY-MM-DD' strings (no time-zone ambiguity).
 * - Indexed varchar columns stay ≤ 191 chars (utf8mb4 index limits); long URLs are indexed via
 *   a sha256 hex companion column.
 */
import { sql } from 'drizzle-orm';
import { bigint, char, datetime } from 'drizzle-orm/mysql-core';

export const id = () => bigint('id', { mode: 'number', unsigned: true }).autoincrement().primaryKey();

/** Foreign-key / reference column (BIGINT UNSIGNED). */
export const ref = (name: string) => bigint(name, { mode: 'number', unsigned: true });

/** UTC timestamp, millisecond precision. */
export const utc = (name: string) => datetime(name, { mode: 'date', fsp: 3 });

export const createdAt = () =>
  utc('created_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$defaultFn(() => new Date());

export const updatedAt = () =>
  utc('updated_at')
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$defaultFn(() => new Date())
    .$onUpdateFn(() => new Date());

/** Timestamp that defaults to "now" (e.g. checked_at, fetched_at). */
export const utcNow = (name: string) =>
  utc(name)
    .notNull()
    .default(sql`CURRENT_TIMESTAMP(3)`)
    .$defaultFn(() => new Date());

/** sha256 hex digest column (64 chars, ascii). */
export const sha256 = (name: string) => char(name, { length: 64 });

/** ISO 3166-1 alpha-2 code (plus the user-assigned 'XW' for Remote/Worldwide). */
export const iso2 = (name: string) => char(name, { length: 2 });
