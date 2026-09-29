import path from 'node:path';
import { defineConfig } from 'vitest/config';

const root = __dirname;

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${path.join(root, 'src')}/` },
      // `server-only` throws outside the react-server condition; tests import server modules directly.
      { find: /^server-only$/, replacement: path.join(root, 'node_modules/server-only/empty.js') },
    ],
  },
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.next/**', 'dist/**'],
    environment: 'node',
    pool: 'forks',
    // DB-backed files each start their own MySQL (tests/helpers/db.ts). One file at a time keeps
    // the 8 GB laptop usable and guarantees at most one ephemeral MySQL.
    fileParallelism: false,
    testTimeout: 120_000,
    // A cold ephemeral MySQL start + migrations can take a while.
    hookTimeout: 240_000,
    env: { NODE_ENV: 'test', TZ: 'UTC' },
  },
});
