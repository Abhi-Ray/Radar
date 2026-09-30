/**
 * Loads RADAR's reference data, then exits.
 *
 *   npm run db:seed [-- --json]        (dev: tsx, reads .env.local)
 *   node dist/seed.mjs [--json]        (Docker entrypoint `seed`; bundled with esbuild)
 *
 * Env: DATABASE_URL (required). Run after `db:migrate`. Idempotent: a repeat run changes nothing
 * and rows the owner changed are never overwritten (see src/db/seed/index.ts).
 * Exit code 0 = done, 1 = failure (nothing written: the seed runs in one transaction),
 * 2 = bad arguments.
 */
import { formatSeedSummary, parseSeedArgs, SEED_USAGE, SeedUsageError, seedDatabase, totalTally } from '../src/db/seed';
import { connect } from '../src/lib/db';
import { waitForDb } from '../src/lib/db/migrations';
import { getEnvVar } from '../src/lib/env';
import { log } from '../src/lib/log';

async function main(): Promise<number> {
  let args;
  try {
    args = parseSeedArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof SeedUsageError) {
      process.stderr.write(`${error.message}\n\n${SEED_USAGE}\n`);
      return 2;
    }
    throw error;
  }
  if (args.help) {
    process.stdout.write(`${SEED_USAGE}\n`);
    return 0;
  }
  const url = getEnvVar('DATABASE_URL');
  await waitForDb(url, {
    timeoutMs: 90_000,
    onRetry: (attempt) => {
      if (attempt === 1 || attempt % 10 === 0) log.info('seed: waiting for database', { attempt });
    },
  });
  const { db, pool } = connect(url);
  try {
    const summary = await seedDatabase(db);
    process.stdout.write(`${args.json ? JSON.stringify(summary, null, 2) : formatSeedSummary(summary)}\n`);
    const total = totalTally(summary.sections);
    log.info('seed: reference data up to date', { ...total, settingsCreated: summary.settingsCreated.length, ms: summary.durationMs });
    return 0;
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    log.error('seed: failed', { error });
    process.exit(1);
  },
);
