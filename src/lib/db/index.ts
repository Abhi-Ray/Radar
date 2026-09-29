/**
 * Database client: one lazily-created mysql2 pool + drizzle instance per process.
 *
 * - Nothing connects at import time (safe for `next build`, tests, CLI imports). The pool is created
 *   on first use of `getDb()` / `db`.
 * - Every pooled connection runs `SET time_zone = '+00:00'`, and mysql2 serialises JS Dates as UTC
 *   (`timezone: 'Z'`), so CURRENT_TIMESTAMP(3) defaults, NOW() and bound Dates are all UTC.
 * - Deliberately NOT `server-only`: the worker (esbuild bundle), CLIs (tsx) and tests use it too.
 *   It must still never be imported from a client component (mysql2 would not bundle anyway).
 *
 * Usage: `import { db } from '@/lib/db'` (lazy proxy) or `const db = getDb()`.
 */
import { drizzle, type MySql2Database } from 'drizzle-orm/mysql2';
import mysql, { type Pool, type PoolOptions } from 'mysql2/promise';
import * as schema from '../../db/schema';
import { getEnvVar } from '../env';

export type Schema = typeof schema;
/** Drizzle database handle. Transactions (`Tx`) are assignable to it, so helpers accept both. */
export type Db = MySql2Database<Schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
/** Anything that can run queries: the root db or an open transaction. */
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  pool: Pool;
}

/** Pool options shared by the app, the worker, migrations and tests. */
export function poolOptions(url: string, overrides: Partial<PoolOptions> = {}): PoolOptions {
  return {
    uri: url,
    connectionLimit: 10,
    maxIdle: 10,
    idleTimeout: 60_000,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10_000,
    connectTimeout: 10_000,
    timezone: 'Z',
    // Matches MySQL 8.4's server default collation (no "illegal mix of collations" surprises).
    charset: 'utf8mb4_0900_ai_ci',
    supportBigNumbers: true,
    bigNumberStrings: false,
    decimalNumbers: true,
    multipleStatements: false,
    dateStrings: false,
    ...overrides,
  };
}

/** Creates a NEW pool (caller owns it). Prefer `getDb()` in app code. */
export function createPool(url: string, overrides: Partial<PoolOptions> = {}): Pool {
  const pool = mysql.createPool(poolOptions(url, overrides));
  // `pool.pool` is the core (callback) pool; its 'connection' event fires once per new physical
  // connection, before the connection is handed out, so this command is queued ahead of any query.
  pool.pool.on('connection', (conn) => {
    conn.query("SET time_zone = '+00:00'");
  });
  return pool;
}

/** Wraps an existing pool in drizzle with the full schema (relational queries enabled). */
export function createDb(pool: Pool): Db {
  return drizzle({ client: pool, schema, mode: 'default' });
}

/** Creates a pool + drizzle pair for a given URL (used by tests, migrations, scripts). */
export function connect(url: string, overrides: Partial<PoolOptions> = {}): DbHandle {
  const pool = createPool(url, overrides);
  return { pool, db: createDb(pool) };
}

// Survive Next dev HMR (module re-evaluation) without leaking pools.
const globalKey = Symbol.for('radar.db.handle');
type GlobalWithDb = typeof globalThis & { [globalKey]?: DbHandle };
const g = globalThis as GlobalWithDb;

function handle(): DbHandle {
  let h = g[globalKey];
  if (!h) {
    h = connect(getEnvVar('DATABASE_URL'));
    g[globalKey] = h;
  }
  return h;
}

/** The process-wide drizzle instance (lazy). */
export function getDb(): Db {
  return handle().db;
}

/** The process-wide mysql2 pool (lazy) — for GET_LOCK etc. that need a dedicated connection. */
export function getPool(): Pool {
  return handle().pool;
}

/**
 * Lazy proxy so `import { db } from '@/lib/db'` works without connecting at import time.
 * Every property access is forwarded to the real instance (created on first access).
 */
export const db: Db = new Proxy({} as Db, {
  get(_target, prop) {
    const real = getDb() as unknown as Record<PropertyKey, unknown>;
    const value = real[prop];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(real) : value;
  },
  has(_target, prop) {
    return prop in (getDb() as object);
  },
});

/**
 * Runs `fn` inside a transaction. If `dbOrTx` is already a transaction, drizzle opens a SAVEPOINT
 * (nested transaction) so the helper composes.
 */
export async function withTransaction<T>(dbOrTx: DbOrTx, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbOrTx.transaction(fn);
}

/** Closes the process-wide pool (worker shutdown, CLI exit). Safe to call when never opened. */
export async function closeDb(): Promise<void> {
  const h = g[globalKey];
  if (!h) return;
  delete g[globalKey];
  await h.pool.end();
}
