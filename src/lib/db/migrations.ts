/**
 * Applying the generated SQL migrations (drizzle/*.sql) — shared by src/db/migrate.ts (container
 * start / `npm run db:migrate`), scripts/dev-db.ts and tests/helpers/db.ts.
 *
 * - Serialised with MySQL GET_LOCK('radar_migrate') on a dedicated connection, so two processes
 *   starting at once (app + worker) never apply the same migration twice.
 * - Note: MySQL DDL auto-commits; a migration that fails half-way must be fixed forward.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/mysql2';
import { migrate } from 'drizzle-orm/mysql2/migrator';
import mysql, { type Pool } from 'mysql2/promise';
import { poolOptions } from './index';

export const MIGRATION_LOCK_NAME = 'radar_migrate';

export interface WaitOptions {
  timeoutMs?: number;
  intervalMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return error instanceof Error ? error.name : 'UNKNOWN';
}

/**
 * Wait until the server accepts connections and answers `SELECT 1` (MySQL containers take a while
 * on first boot). Throws the last error after `timeoutMs`.
 */
export async function waitForDb(url: string, opts: WaitOptions = {}): Promise<void> {
  const timeoutMs = opts.timeoutMs ?? 90_000;
  const intervalMs = opts.intervalMs ?? 1_000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  for (;;) {
    attempt += 1;
    let conn: mysql.Connection | undefined;
    try {
      const o = poolOptions(url, { connectTimeout: 5_000 });
      conn = await mysql.createConnection({
        uri: o.uri,
        connectTimeout: o.connectTimeout,
        timezone: o.timezone,
        charset: o.charset,
        supportBigNumbers: o.supportBigNumbers,
        bigNumberStrings: o.bigNumberStrings,
        multipleStatements: false,
      });
      await conn.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`database not reachable after ${attempt} attempts (${Math.round(timeoutMs / 1000)}s): ${errorCode(error)}`, {
          cause: error,
        });
      }
      opts.onRetry?.(attempt, error);
      await new Promise((r) => setTimeout(r, Math.min(intervalMs * Math.min(attempt, 5), 5_000)));
    } finally {
      await conn?.end().catch(() => undefined);
    }
  }
}

/**
 * Locate the migrations folder: explicit dir → ./drizzle (cwd) → next to / above the running
 * script (bundled dist/migrate.mjs ships with ../drizzle or ./drizzle).
 */
export function resolveMigrationsDir(explicit?: string | null): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(path.resolve(explicit));
  candidates.push(path.resolve(process.cwd(), 'drizzle'));
  const script = process.argv[1];
  if (script) {
    const dir = path.dirname(path.resolve(script));
    candidates.push(path.resolve(dir, 'drizzle'), path.resolve(dir, '..', 'drizzle'), path.resolve(dir, '..', '..', 'drizzle'));
  }
  for (const c of candidates) {
    if (existsSync(path.join(c, 'meta', '_journal.json'))) return c;
  }
  if (explicit) throw new Error(`MIGRATIONS_DIR has no meta/_journal.json: ${path.resolve(explicit)}`);
  throw new Error(`migrations folder not found (looked in: ${candidates.join(', ')})`);
}

export interface MigrateResult {
  folder: string;
  appliedBefore: number;
  appliedAfter: number;
}

async function countApplied(pool: Pool | mysql.PoolConnection): Promise<number> {
  try {
    const [rows] = await pool.query('SELECT COUNT(*) AS n FROM `__drizzle_migrations`');
    return Number((rows as Array<{ n: number }>)[0]?.n ?? 0);
  } catch (error) {
    if (errorCode(error) === 'ER_NO_SUCH_TABLE') return 0;
    throw error;
  }
}

/** Apply all pending migrations in `folder` to the database at `url`. Idempotent. */
export async function runMigrations(url: string, folder: string, lockTimeoutSec = 120): Promise<MigrateResult> {
  const pool = mysql.createPool(poolOptions(url, { connectionLimit: 1 }));
  const conn = await pool.getConnection();
  try {
    await conn.query("SET time_zone = '+00:00'");
    const [lockRows] = await conn.query('SELECT GET_LOCK(?, ?) AS got', [MIGRATION_LOCK_NAME, lockTimeoutSec]);
    if (Number((lockRows as Array<{ got: number | null }>)[0]?.got) !== 1) {
      throw new Error(`could not acquire migration lock within ${lockTimeoutSec}s`);
    }
    try {
      const appliedBefore = await countApplied(conn);
      // A single-connection drizzle instance: the lock and the DDL share one session.
      await migrate(drizzle({ client: conn }), { migrationsFolder: folder });
      const appliedAfter = await countApplied(conn);
      return { folder, appliedBefore, appliedAfter };
    } finally {
      await conn.query('SELECT RELEASE_LOCK(?)', [MIGRATION_LOCK_NAME]).catch(() => undefined);
    }
  } finally {
    conn.release();
    await pool.end();
  }
}
