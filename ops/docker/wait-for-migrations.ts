/**
 * Blocks until the database schema matches the migrations shipped in the image, then exits 0.
 * Used by ops/docker/entrypoint.sh before starting the worker or the seeder: only the `web`
 * container applies migrations (dist/migrate.mjs), everything else waits for it.
 *
 *   node dist/wait-for-migrations.mjs [--timeout <seconds>]     (default 300)
 *
 * Env: DATABASE_URL (required), MIGRATIONS_DIR (optional, as for the migrator).
 * Exit codes: 0 = schema current, 1 = timed out / misconfigured, 2 = bad arguments.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { poolOptions } from '@/lib/db';
import { resolveMigrationsDir, waitForDb } from '@/lib/db/migrations';
import { getEnvVar } from '@/lib/env';
import { log } from '@/lib/log';
import { migrationStatus, parseJournal, parseWaitArgs, type AppliedState } from './migration-status';

const POLL_MS = 2_000;

async function readApplied(url: string): Promise<AppliedState> {
  const o = poolOptions(url, { connectTimeout: 5_000 });
  const conn = await mysql.createConnection({
    uri: o.uri,
    connectTimeout: o.connectTimeout,
    timezone: o.timezone,
    charset: o.charset,
    supportBigNumbers: true,
    bigNumberStrings: false,
  });
  try {
    const [rows] = await conn.query('SELECT COUNT(*) AS n, MAX(created_at) AS m FROM `__drizzle_migrations`');
    const row = (rows as Array<{ n: number | string; m: number | string | null }>)[0];
    return { count: Number(row?.n ?? 0), maxCreatedAt: row?.m === null || row?.m === undefined ? null : Number(row.m) };
  } catch (error) {
    if ((error as { code?: string }).code === 'ER_NO_SUCH_TABLE') return { count: 0, maxCreatedAt: null };
    throw error;
  } finally {
    await conn.end().catch(() => undefined);
  }
}

async function main(): Promise<number> {
  let timeoutSec: number;
  try {
    ({ timeoutSec } = parseWaitArgs(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`wait-for-migrations: ${(error as Error).message}\n`);
    return 2;
  }
  const deadline = Date.now() + timeoutSec * 1000;
  const url = getEnvVar('DATABASE_URL');
  const folder = resolveMigrationsDir(getEnvVar('MIGRATIONS_DIR'));
  const journal = parseJournal(JSON.parse(readFileSync(path.join(folder, 'meta', '_journal.json'), 'utf8')));

  await waitForDb(url, { timeoutMs: timeoutSec * 1000 });
  let polls = 0;
  for (;;) {
    polls += 1;
    let status;
    try {
      status = migrationStatus(journal, await readApplied(url));
    } catch (error) {
      // Transient (DB restarting): keep polling until the deadline.
      if (polls === 1 || polls % 15 === 0) log.warn('wait-for-migrations: probe failed', { error });
      status = null;
    }
    if (status?.satisfied) {
      log.info('wait-for-migrations: schema current', { applied: status.applied, latest: status.latestTag });
      return 0;
    }
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) {
      log.error('wait-for-migrations: timed out', {
        timeoutSec,
        expected: journal.length,
        applied: status?.applied ?? null,
        latest: status?.latestTag ?? null,
      });
      return 1;
    }
    if (polls === 1 || polls % 15 === 0) {
      log.info('wait-for-migrations: waiting for the web container to apply migrations', {
        expected: journal.length,
        applied: status?.applied ?? null,
      });
    }
    // The last poll lands exactly on the deadline, so a migration finishing late still counts.
    await new Promise((r) => setTimeout(r, Math.min(POLL_MS, remainingMs)));
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log.error('wait-for-migrations: failed', { error });
    process.exit(1);
  },
);
