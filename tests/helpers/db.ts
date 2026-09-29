/**
 * Ephemeral, isolated MySQL for tests.
 *
 *   let t: TestDb;
 *   beforeAll(async () => { t = await startTestDb(); });
 *   afterAll(async () => { await t?.stop(); });
 *   beforeEach(async () => { await t.truncateAll(); });   // optional
 *
 * - Default: starts a private MySQL 8.4.2 via mysql-memory-server on a random port (X protocol off),
 *   applies the generated migrations from ./drizzle, and returns a drizzle handle.
 * - If TEST_DATABASE_URL is set (e.g. a CI service container), a uniquely-named database is created
 *   on that server instead and dropped by stop(). Port 3399 (the dev DB) is refused.
 * - `{ bindGlobal: true }` also points the process-wide `getDb()`/`db` (src/lib/db) at the test DB, for
 *   code under test that doesn't take a `db` argument (e.g. session helpers).
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { closeDb, connect, type Db } from '../../src/lib/db';
import { runMigrations } from '../../src/lib/db/migrations';
import { resetEnvCacheForTests } from '../../src/lib/env';

export interface TestDb {
  db: Db;
  pool: mysql.Pool;
  url: string;
  /** Deletes all rows from every table (keeps the schema + migration journal). */
  truncateAll(): Promise<void>;
  stop(): Promise<void>;
}

export interface StartTestDbOptions {
  bindGlobal?: boolean;
}

const MIGRATIONS = path.resolve(__dirname, '../../drizzle');
const DEV_PORT = 3399;

function withDatabase(serverUrl: string, dbName: string): string {
  const u = new URL(serverUrl);
  u.pathname = `/${dbName}`;
  return u.toString();
}

async function startServer(): Promise<{ serverUrl: string; dbName: string; stopServer: () => Promise<void> }> {
  const external = process.env.TEST_DATABASE_URL?.trim();
  const dbName = `radar_test_${randomBytes(4).toString('hex')}`;
  if (external) {
    const u = new URL(external);
    if (Number(u.port || 3306) === DEV_PORT) throw new Error('TEST_DATABASE_URL must not point at the dev database port 3399');
    const admin = await mysql.createConnection({ uri: withDatabase(external, '') });
    await admin.query(`CREATE DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await admin.end();
    return {
      serverUrl: external,
      dbName,
      stopServer: async () => {
        const c = await mysql.createConnection({ uri: withDatabase(external, '') });
        await c.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
        await c.end();
      },
    };
  }
  const { createDB } = await import('mysql-memory-server');
  const server = await createDB({
    version: '8.4.2',
    dbName,
    xEnabled: 'OFF',
    logLevel: 'ERROR',
    downloadBinaryOnce: true,
  });
  if (server.port === DEV_PORT) {
    await server.stop();
    throw new Error('ephemeral MySQL landed on the dev port 3399 — retry');
  }
  return {
    serverUrl: `mysql://${server.username}@127.0.0.1:${server.port}/`,
    dbName,
    stopServer: () => server.stop(),
  };
}

export async function startTestDb(opts: StartTestDbOptions = {}): Promise<TestDb> {
  const { serverUrl, dbName, stopServer } = await startServer();
  const url = withDatabase(serverUrl, dbName);
  try {
    await runMigrations(url, MIGRATIONS);
  } catch (error) {
    await stopServer().catch(() => undefined);
    throw error;
  }
  const { db, pool } = connect(url, { connectionLimit: 5 });

  const previousUrl = process.env.DATABASE_URL;
  if (opts.bindGlobal) {
    await closeDb();
    process.env.DATABASE_URL = url;
    resetEnvCacheForTests();
  }

  let tables: string[] | null = null;
  const truncateAll = async () => {
    const conn = await pool.getConnection();
    try {
      if (!tables) {
        const [rows] = await conn.query(
          "SELECT table_name AS t FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE' AND table_name <> '__drizzle_migrations'",
        );
        tables = (rows as Array<{ t: string }>).map((r) => r.t);
      }
      await conn.query('SET FOREIGN_KEY_CHECKS = 0');
      for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t.replace(/`/g, '')}\``);
      await conn.query('SET FOREIGN_KEY_CHECKS = 1');
    } finally {
      conn.release();
    }
  };

  let stopped = false;
  const stop = async () => {
    if (stopped) return;
    stopped = true;
    await pool.end().catch(() => undefined);
    if (opts.bindGlobal) {
      await closeDb();
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      resetEnvCacheForTests();
    }
    await stopServer();
  };

  return { db, pool, url, truncateAll, stop };
}
