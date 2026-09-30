/** Argument parsing for `npm run pipeline -- <command> [flags]` (pure; unit-tested). */

export const CLI_COMMANDS = [
  'run',
  'dry-run',
  'reprocess',
  'queued',
  'linkcheck',
  'registers',
  'official-pages',
  'fx',
  'digest',
  'heartbeat',
  'retention',
  'ai',
] as const;
export type CliCommand = (typeof CLI_COMMANDS)[number];

export interface CliArgs {
  command: CliCommand;
  sourceIds?: number[];
  maxCalls?: number;
  batch?: number;
  since?: Date;
  force: boolean;
  /** `run --daily`: record the run as the scheduled daily run (heartbeat, digest, ping). */
  daily: boolean;
}

export const CLI_USAGE = `Usage: npm run pipeline -- <command> [flags]

Commands:
  run              run the pipeline now (kind manual; --daily records it as the daily run)
  dry-run          fetch + parse + compare, write only the run report
  reprocess        rebuild jobs from stored raw snapshots with the current logic
  queued           execute queued UI runs
  linkcheck        check apply links (--batch=N, default 150)
  registers        refresh sponsor registers
  official-pages   check watched official visa pages
  fx               refresh ECB FX rates
  digest           send the morning digest now (--force ignores the digest hour)
  heartbeat        run the "didn't run" check
  retention        prune old raw snapshots, AI cache, dead letters, login attempts
  ai               process the AI queue (--max-calls=N)

Flags:
  --source=ID      limit to source id(s); repeat or comma-separate
  --since=ISO      reprocess snapshots fetched since this date
  --max-calls=N    AI calls for this batch
  --batch=N        link-check batch size
  --force          digest: ignore the digest hour
  --daily          run: record as the daily run`;

export class CliArgError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CliArgError';
  }
}

function positiveInt(flag: string, v: string, max: number): number {
  if (!/^\d+$/.test(v)) throw new CliArgError(`${flag} must be a positive integer`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0 || n > max) throw new CliArgError(`${flag} must be between 1 and ${max}`);
  return n;
}

export function parseCliArgs(argv: readonly string[]): CliArgs {
  const [cmd, ...rest] = argv.filter((a) => a !== '--');
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') throw new CliArgError('missing command');
  if (!(CLI_COMMANDS as readonly string[]).includes(cmd)) throw new CliArgError(`unknown command "${cmd}"`);
  const out: CliArgs = { command: cmd as CliCommand, force: false, daily: false };
  const sources: number[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new CliArgError(`unexpected argument "${arg}"`);
    const flag = m[1];
    let value = m[2];
    const needValue = () => {
      if (value === undefined) {
        const next = rest[i + 1];
        if (next === undefined || next.startsWith('--')) throw new CliArgError(`--${flag} needs a value`);
        value = next;
        i++;
      }
      return value;
    };
    switch (flag) {
      case 'source':
      case 'sources':
        for (const part of needValue().split(',')) {
          const t = part.trim();
          if (t) sources.push(positiveInt('--source', t, 2 ** 31));
        }
        break;
      case 'max-calls':
        out.maxCalls = positiveInt('--max-calls', needValue(), 1000);
        break;
      case 'batch':
        out.batch = positiveInt('--batch', needValue(), 5000);
        break;
      case 'since': {
        const v = needValue();
        const d = new Date(v);
        if (!/^\d{4}-\d{2}-\d{2}/.test(v) || Number.isNaN(d.getTime())) throw new CliArgError('--since must be an ISO date (YYYY-MM-DD[THH:MM])');
        out.since = d;
        break;
      }
      case 'force':
        out.force = true;
        break;
      case 'daily':
        out.daily = true;
        break;
      default:
        throw new CliArgError(`unknown flag --${flag}`);
    }
  }
  if (sources.length > 0) out.sourceIds = [...new Set(sources)];
  return out;
}
