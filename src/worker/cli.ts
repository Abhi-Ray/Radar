/**
 * One-off worker tasks from the shell:
 *
 *   npm run pipeline -- run|dry-run|reprocess|queued|linkcheck|registers|official-pages|fx|digest|heartbeat|retention|ai
 *                       [--source=ID ...] [--since=ISO] [--max-calls=N] [--batch=N] [--force] [--daily]
 *
 * Prints the task summary as JSON on stdout. Exit code 0 = ok, 1 = task failed, 2 = bad arguments.
 */
import { closeDb, getDb } from '../lib/db';
import { log } from '../lib/log';
import { CLI_USAGE, CliArgError, parseCliArgs, type CliArgs } from './args';
import {
  aiQueueTask,
  dailyPipelineTask,
  digestTask,
  fxTask,
  heartbeatTask,
  linkCheckTask,
  manualPipelineTask,
  officialPagesTask,
  queuedRunsTask,
  reprocessTask,
  registersTask,
  retentionTask,
  type TaskContext,
  type TaskResult,
} from './tasks';

async function dispatch(args: CliArgs, ctx: TaskContext): Promise<TaskResult> {
  switch (args.command) {
    case 'run':
      return args.daily ? dailyPipelineTask(ctx, { sourceIds: args.sourceIds }) : manualPipelineTask(ctx, { dryRun: false, sourceIds: args.sourceIds });
    case 'dry-run':
      return manualPipelineTask(ctx, { dryRun: true, sourceIds: args.sourceIds });
    case 'reprocess':
      return reprocessTask(ctx, { sourceIds: args.sourceIds, since: args.since });
    case 'queued':
      return queuedRunsTask(ctx);
    case 'linkcheck':
      return linkCheckTask(ctx, { batch: args.batch });
    case 'registers':
      return registersTask(ctx);
    case 'official-pages':
      return officialPagesTask(ctx);
    case 'fx':
      return fxTask(ctx);
    case 'digest':
      return digestTask(ctx, { force: args.force });
    case 'heartbeat':
      return heartbeatTask(ctx);
    case 'retention':
      return retentionTask(ctx);
    case 'ai':
      return aiQueueTask(ctx, { maxCalls: args.maxCalls });
  }
}

function statusFailed(result: TaskResult): boolean {
  return result.status === 'failed';
}

async function main(): Promise<number> {
  let args: CliArgs;
  try {
    args = parseCliArgs(process.argv.slice(2));
  } catch (err) {
    if (err instanceof CliArgError) {
      process.stderr.write(`${err.message === 'missing command' ? '' : `error: ${err.message}\n\n`}${CLI_USAGE}\n`);
      return 2;
    }
    throw err;
  }
  const abort = new AbortController();
  const onSignal = () => abort.abort(new Error('interrupted'));
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);
  const ctx: TaskContext = { db: getDb(), requestedBy: 'cli', startedAt: null, signal: abort.signal };
  try {
    const result = await dispatch(args, ctx);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return statusFailed(result) ? 1 : 0;
  } catch (err) {
    log.error(`pipeline cli: ${args.command} failed`, { error: err });
    return 1;
  } finally {
    await closeDb().catch(() => undefined);
  }
}

main().then(
  (code) => process.exit(code),
  (err: unknown) => {
    log.error('pipeline cli crashed', { error: err });
    process.exit(1);
  },
);
