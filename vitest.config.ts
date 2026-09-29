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
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules/**', 'tests/e2e/**', '.next/**', 'dist/**'],
    environment: 'node',
    pool: 'forks',
    // DB-backed test files each start their own MySQL (tests/helpers/db.ts); keep the laptop usable.
    maxWorkers: 3,
    testTimeout: 30_000,
    // Starting an ephemeral MySQL can take a while on a cold machine.
    hookTimeout: 180_000,
    env: { NODE_ENV: 'test', TZ: 'UTC' },
  },
});
