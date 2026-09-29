/**
 * drizzle-kit config. `npm run db:generate` diffs src/db/schema against drizzle/meta and writes a
 * new SQL migration into drizzle/ (committed). Migrations are APPLIED by src/db/migrate.ts
 * (container start, `npm run db:migrate`, scripts/dev-db.ts, tests/helpers/db.ts) — never by
 * `drizzle-kit push` against production.
 *
 * DATABASE_URL is only needed for drizzle-kit commands that talk to a DB (studio/check); generate
 * works offline.
 */
import { defineConfig } from 'drizzle-kit';

const url = process.env.DATABASE_URL;

export default defineConfig({
  dialect: 'mysql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
  breakpoints: true,
  ...(url ? { dbCredentials: { url } } : {}),
});
