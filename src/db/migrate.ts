/**
 * Applies pending SQL migrations, then exits.
 *
 *   npm run db:migrate                 (dev: tsx, reads .env.local)
 *   node dist/migrate.mjs              (Docker entrypoint, before server.js; bundled with esbuild)
 *
 * Env: DATABASE_URL (required), MIGRATIONS_DIR (optional; default ./drizzle next to cwd/script).
 * Waits up to 90s for the database to accept connections. Exit code 0 = schema up to date,
 * 1 = failure (the entrypoint must not start the app).
 */
import { getEnvVar } from '../lib/env';
import { log } from '../lib/log';
import { resolveMigrationsDir, runMigrations, waitForDb } from '../lib/db/migrations';

async function main(): Promise<void> {
  const started = Date.now();
  const url = getEnvVar('DATABASE_URL');
  const folder = resolveMigrationsDir(getEnvVar('MIGRATIONS_DIR'));
  await waitForDb(url, {
    timeoutMs: 90_000,
    onRetry: (attempt) => {
      if (attempt === 1 || attempt % 10 === 0) log.info('migrate: waiting for database', { attempt });
    },
  });
  const res = await runMigrations(url, folder);
  log.info('migrate: schema up to date', {
    folder: res.folder,
    newlyApplied: res.appliedAfter - res.appliedBefore,
    total: res.appliedAfter,
    ms: Date.now() - started,
  });
}

main().then(
  () => process.exit(0),
  (error: unknown) => {
    log.error('migrate: failed', { error });
    process.exit(1);
  },
);
