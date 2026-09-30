/**
 * RADAR worker: every scheduled job, in one long-running process (all times UTC).
 *
 *   00:30, 12:30  daily pipeline (then healthcheck ping + digest)
 *   every minute  queued UI runs
 *   hh:15         link check (batch of 150)
 *   hh:05         heartbeat ("didn't run" check) + digest-hour check
 *   01:30, 13:30  AI queue (budgeted)
 *   03:00         sponsor registers        04:00  official visa pages
 *   05:00         retention                15:30  ECB FX rates (after the ~14:00 UTC publication)
 *
 * Starts only after the database is reachable and every shipped migration is applied (the app
 * container runs the migrator). SIGTERM/SIGINT: stop scheduling, abort running tasks, wait for
 * them (≤25 s) so locks are released, close the pool, exit.
 */
import { Cron } from 'croner';
import { closeDb, getDb } from '../lib/db';
import { waitForDb } from '../lib/db/migrations';
import { getEnvVar } from '../lib/env';
import { log } from '../lib/log';
import {
  aiQueueTask,
  dailyPipelineTask,
  fxTask,
  heartbeatTask,
  linkCheckTask,
  officialPagesTask,
  queuedRunsTask,
  registersTask,
  retentionTask,
  waitForMigrations,
  type TaskContext,
  type TaskResult,
} from './tasks';

const wlog = log.child({ module: 'worker' });
const SHUTDOWN_GRACE_MS = 25_000;

interface Schedule {
  name: string;
  pattern: string;
  run: (ctx: TaskContext) => Promise<TaskResult>;
  /** Only log when the task did something (`executed > 0`): the minute poll stays quiet. */
  quiet?: boolean;
}

export const SCHEDULES: readonly Schedule[] = [
  { name: 'pipeline:daily', pattern: '30 0,12 * * *', run: (c) => dailyPipelineTask(c) },
  { name: 'pipeline:queued', pattern: '* * * * *', run: (c) => queuedRunsTask(c), quiet: true },
  { name: 'linkcheck', pattern: '15 * * * *', run: (c) => linkCheckTask(c, { batch: 150 }) },
  { name: 'heartbeat', pattern: '5 * * * *', run: (c) => heartbeatTask(c) },
  { name: 'ai-queue', pattern: '30 1,13 * * *', run: (c) => aiQueueTask(c) },
  { name: 'registers', pattern: '0 3 * * *', run: (c) => registersTask(c) },
  { name: 'official-pages', pattern: '0 4 * * *', run: (c) => officialPagesTask(c) },
  { name: 'retention', pattern: '0 5 * * *', run: (c) => retentionTask(c) },
  { name: 'fx', pattern: '30 15 * * *', run: (c) => fxTask(c) },
];

async function main(): Promise<void> {
  const startedAt = new Date();
  const abort = new AbortController();
  const running = new Map<string, Promise<void>>();
  const crons: Cron[] = [];
  let stopping = false;

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    wlog.info('shutting down', { signal, running: [...running.keys()] });
    for (const c of crons) c.stop();
    abort.abort(new Error(`worker received ${signal}`));
    const all = Promise.allSettled([...running.values()]);
    const timedOut = await Promise.race([all.then(() => false), new Promise<boolean>((r) => setTimeout(() => r(true), SHUTDOWN_GRACE_MS).unref())]);
    if (timedOut) wlog.warn('tasks still running at shutdown; stale locks expire on their own', { running: [...running.keys()] });
    await closeDb().catch(() => undefined);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  wlog.info('starting', { pid: process.pid });
  await waitForDb(getEnvVar('DATABASE_URL'), {
    timeoutMs: 10 * 60_000,
    intervalMs: 2_000,
    onRetry: (attempt) => {
      if (attempt === 1 || attempt % 15 === 0) wlog.info('waiting for database', { attempt });
    },
  });
  const db = getDb();
  await waitForMigrations(db, { signal: abort.signal });
  if (stopping) return;

  const ctx: TaskContext = { db, requestedBy: 'cron', startedAt, signal: abort.signal };
  for (const s of SCHEDULES) {
    const cron = new Cron(s.pattern, { name: s.name, timezone: 'UTC', protect: true, mode: '5-part' }, async () => {
      if (stopping) return;
      const t0 = Date.now();
      const p = (async () => {
        try {
          const result = await s.run(ctx);
          if (!s.quiet || Number(result.executed ?? 0) > 0) wlog.info(`${s.name} done`, { ms: Date.now() - t0, result });
        } catch (err) {
          wlog.error(`${s.name} failed`, { ms: Date.now() - t0, error: err });
        }
      })();
      running.set(s.name, p);
      try {
        await p;
      } finally {
        running.delete(s.name);
      }
    });
    crons.push(cron);
  }
  wlog.info('scheduled', {
    jobs: crons.map((c) => ({ name: c.name, next: c.nextRun()?.toISOString() ?? null })),
  });
}

main().catch(async (err: unknown) => {
  wlog.error('worker failed to start', { error: err });
  await closeDb().catch(() => undefined);
  process.exit(1);
});
