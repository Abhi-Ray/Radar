/**
 * Local development MySQL 8.4 (no Docker needed).
 *
 *   npm run db:dev                  start in the foreground; Ctrl-C (SIGINT/SIGTERM) shuts it down cleanly
 *   npm run db:dev -- --detach      start in the background and return (keeps running after the shell exits)
 *   npm run db:dev -- --stop        clean shutdown of the background server
 *   npm run db:dev -- --status      is it running? which URL?
 *
 * What it does
 * - Uses the MySQL 8.4.2 binary cached by `mysql-memory-server`
 *   (<os.tmpdir()>/mysqlmsn/binaries/8.4.2/mysql). If it is missing it is downloaded once by starting
 *   and immediately stopping a throwaway mysql-memory-server instance.
 * - Data lives in `.data/mysql` (gitignored) and PERSISTS across restarts. First start runs
 *   `mysqld --initialize-insecure` (root@localhost, empty password — bound to 127.0.0.1 only).
 *   Delete `.data/mysql` (while stopped) to start from scratch.
 * - Listens on 127.0.0.1:3399 (socket /tmp/radar-dev-mysql.sock, X protocol off), UTC server time
 *   zone, utf8mb4, small buffer pool, performance_schema off, no binlog — laptop friendly.
 *   The port can be changed with DEV_DB_PORT or by the port in .env.local's DATABASE_URL, so each
 *   git worktree can run its own dev DB (non-default ports use /tmp/radar-dev-mysql-<port>.sock).
 * - Creates database `radar` if needed and applies pending migrations from ./drizzle.
 * - Prints the DATABASE_URL to use (matches .env.local: mysql://root@127.0.0.1:3399/radar).
 * - Files: .data/mysql.pid (pid), .data/mysql-error.log (server log).
 *
 * Tests never use this server (they start their own ephemeral one via tests/helpers/db.ts).
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { resolveMigrationsDir, runMigrations } from '../src/lib/db/migrations';

const MYSQL_VERSION = '8.4.2';
const DEFAULT_PORT = 3399;
const HOST = '127.0.0.1';
const DB_NAME = 'radar';
const ROOT = path.resolve(__dirname, '..');
const PORT = resolvePort();
const DATA_ROOT = path.join(ROOT, '.data');
const DATADIR = path.join(DATA_ROOT, 'mysql');
const PID_FILE = path.join(DATA_ROOT, 'mysql.pid');
const ERROR_LOG = path.join(DATA_ROOT, 'mysql-error.log');
const INIT_LOG = path.join(DATA_ROOT, 'mysql-init.log');
const SOCKET = PORT === DEFAULT_PORT ? '/tmp/radar-dev-mysql.sock' : `/tmp/radar-dev-mysql-${PORT}.sock`;
const ADMIN_URL = `mysql://root@${HOST}:${PORT}/`;
const APP_URL = `mysql://root@${HOST}:${PORT}/${DB_NAME}`;

const say = (msg: string) => process.stdout.write(`[db:dev] ${msg}\n`);
const fail = (msg: string): never => {
  process.stderr.write(`[db:dev] ERROR: ${msg}\n`);
  process.exit(1);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** DEV_DB_PORT, else the port of DATABASE_URL in .env.local, else 3399. */
function resolvePort(): number {
  let raw = process.env.DEV_DB_PORT?.trim();
  if (!raw) {
    const envFile = path.join(ROOT, '.env.local');
    if (existsSync(envFile)) {
      const m = /^DATABASE_URL=["']?mysql:\/\/[^\s"'/]*:(\d+)\//m.exec(readFileSync(envFile, 'utf8'));
      raw = m?.[1];
    }
  }
  const port = raw ? Number(raw) : DEFAULT_PORT;
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 3306) {
    process.stderr.write(`[db:dev] ERROR: invalid dev DB port ${raw}\n`);
    process.exit(1);
  }
  return port;
}

function mysqlBaseDir(): string {
  return path.join(os.tmpdir(), 'mysqlmsn', 'binaries', MYSQL_VERSION, 'mysql');
}

async function ensureBinary(): Promise<string> {
  const base = mysqlBaseDir();
  const mysqld = path.join(base, 'bin', 'mysqld');
  if (existsSync(mysqld)) return base;
  say(`MySQL ${MYSQL_VERSION} binary not cached — downloading once via mysql-memory-server…`);
  const { createDB } = await import('mysql-memory-server');
  const tmp = await createDB({ version: MYSQL_VERSION, downloadBinaryOnce: true, xEnabled: 'OFF', logLevel: 'ERROR' });
  await tmp.stop();
  if (!existsSync(mysqld)) fail(`binary still missing at ${mysqld}`);
  return base;
}

function readPid(): number | null {
  if (!existsSync(PID_FILE)) return null;
  const pid = Number.parseInt(readFileSync(PID_FILE, 'utf8').trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * True when `pid` is a mysqld serving OUR data directory. Guards against pid reuse: a stale pid
 * file must never make `--stop` signal an unrelated process. When `ps` itself is unavailable the
 * check degrades to "the pid is alive".
 */
function isOurMysqld(pid: number): boolean {
  const res = spawnSync('ps', ['-ww', '-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  if (res.error) return isAlive(pid);
  if (res.status !== 0) return false;
  const cmd = res.stdout.trim();
  return /(?:^|\/)mysqld(?:\s|$)/.test(cmd) && cmd.includes(`--datadir=${DATADIR}`);
}

/** pid of OUR running server, or null (cleans a stale pid file). */
function runningPid(): number | null {
  const pid = readPid();
  if (pid === null) return null;
  if (isAlive(pid) && isOurMysqld(pid)) return pid;
  rmSync(PID_FILE, { force: true });
  return null;
}

function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.connect({ host: HOST, port });
    sock.once('connect', () => {
      sock.destroy();
      resolve(true);
    });
    sock.once('error', () => resolve(false));
    sock.setTimeout(1000, () => {
      sock.destroy();
      resolve(false);
    });
  });
}

function initializeDataDir(base: string): void {
  mkdirSync(DATA_ROOT, { recursive: true });
  if (existsSync(DATADIR) && readdirSync(DATADIR).length > 0) return;
  say(`initialising a new data directory at ${path.relative(ROOT, DATADIR)} …`);
  mkdirSync(DATADIR, { recursive: true });
  const args = ['--no-defaults', '--initialize-insecure', `--basedir=${base}`, `--datadir=${DATADIR}`, `--log-error=${INIT_LOG}`];
  if (process.getuid?.() === 0) args.push(`--user=${os.userInfo().username}`);
  const res = spawnSync(path.join(base, 'bin', 'mysqld'), args, { stdio: 'inherit' });
  if (res.status !== 0) {
    rmSync(DATADIR, { recursive: true, force: true });
    fail(`mysqld --initialize-insecure failed (exit ${res.status}); see ${INIT_LOG}`);
  }
}

function serverArgs(base: string): string[] {
  const args = [
    '--no-defaults', // must be first
    `--basedir=${base}`,
    `--datadir=${DATADIR}`,
    `--port=${PORT}`,
    `--bind-address=${HOST}`,
    `--socket=${SOCKET}`,
    '--mysqlx=OFF',
    `--pid-file=${PID_FILE}`,
    `--log-error=${ERROR_LOG}`,
    '--default-time-zone=+00:00',
    '--character-set-server=utf8mb4',
    '--collation-server=utf8mb4_0900_ai_ci',
    '--innodb-buffer-pool-size=128M',
    '--innodb-log-buffer-size=8M',
    '--performance-schema=OFF',
    '--disable-log-bin',
    '--max-connections=60',
  ];
  if (process.getuid?.() === 0) args.push(`--user=${os.userInfo().username}`);
  return args;
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

async function waitReady(timeoutMs: number, child?: ChildProcess): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child && hasExited(child)) {
      throw new Error(`mysqld exited during startup (${child.exitCode ?? child.signalCode}); see ${ERROR_LOG}`);
    }
    try {
      const conn = await mysql.createConnection({ uri: ADMIN_URL, connectTimeout: 2000 });
      await conn.query('SELECT 1');
      await conn.end();
      return;
    } catch {
      if (Date.now() > deadline) throw new Error(`mysqld did not accept connections within ${timeoutMs / 1000}s; see ${ERROR_LOG}`);
      await sleep(500);
    }
  }
}

/** Shuts down a server THIS invocation started (startup failed): SIGTERM, then SIGKILL after 60s. */
async function stopChild(child: ChildProcess): Promise<void> {
  if (!hasExited(child) && child.pid !== undefined) {
    child.kill('SIGTERM');
    if (!(await waitExit(child.pid, 60_000))) child.kill('SIGKILL');
  }
  rmSync(PID_FILE, { force: true });
}

async function ensureDatabaseAndMigrate(): Promise<void> {
  const conn = await mysql.createConnection({ uri: ADMIN_URL });
  try {
    await conn.query(
      `CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`,
    );
  } finally {
    await conn.end();
  }
  const folder = resolveMigrationsDir(path.join(ROOT, 'drizzle'));
  const res = await runMigrations(APP_URL, folder);
  say(`migrations: ${res.appliedAfter - res.appliedBefore} applied now, ${res.appliedAfter} total`);
}

async function waitExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isAlive(pid)) return true;
    await sleep(250);
  }
  return !isAlive(pid);
}

async function stop(): Promise<void> {
  const pid = runningPid();
  if (pid === null) {
    say('not running');
    return;
  }
  say(`stopping mysqld (pid ${pid}) …`);
  process.kill(pid, 'SIGTERM'); // mysqld treats SIGTERM as a clean SHUTDOWN
  if (!(await waitExit(pid, 60_000))) fail(`mysqld (pid ${pid}) did not exit within 60s`);
  rmSync(PID_FILE, { force: true });
  say('stopped (data kept in .data/mysql)');
}

async function status(): Promise<void> {
  const pid = runningPid();
  if (pid === null) {
    say('not running');
    process.exitCode = 3;
    return;
  }
  say(`running (pid ${pid}) — DATABASE_URL=${APP_URL}`);
}

async function start(detach: boolean): Promise<void> {
  const existing = runningPid();
  if (existing !== null) {
    await waitReady(30_000);
    await ensureDatabaseAndMigrate();
    say(`already running (pid ${existing}) — DATABASE_URL=${APP_URL}`);
    say('stop it with: npm run db:dev -- --stop');
    return;
  }
  if (await portInUse(PORT)) fail(`port ${PORT} is already in use by another process`);

  const base = await ensureBinary();
  initializeDataDir(base);
  rmSync(SOCKET, { force: true });

  const mysqld = path.join(base, 'bin', 'mysqld');
  const out = openSync(ERROR_LOG, 'a');
  const child = spawn(mysqld, serverArgs(base), {
    detached: detach,
    stdio: ['ignore', out, out],
  });
  child.on('error', (e) => fail(`could not start mysqld: ${e.message}`));
  say(`starting mysqld ${MYSQL_VERSION} on ${HOST}:${PORT} (pid ${child.pid}) …`);
  try {
    await waitReady(90_000, child);
    await ensureDatabaseAndMigrate();
  } catch (error) {
    // Never leave a half-started server behind (it would survive this process in both modes).
    await stopChild(child);
    fail(`startup failed, mysqld stopped: ${error instanceof Error ? error.message : String(error)}`);
  }
  say(`ready — DATABASE_URL=${APP_URL}`);

  if (detach) {
    child.unref();
    say('running in the background; stop with: npm run db:dev -- --stop');
    return;
  }

  say('foreground mode — press Ctrl-C to stop');
  let stopping = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (stopping) return;
    stopping = true;
    say(`${signal} received — shutting down mysqld cleanly …`);
    child.kill('SIGTERM');
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
  rmSync(PID_FILE, { force: true });
  say(`mysqld exited (code ${child.exitCode ?? 'signal'}) — data kept in .data/mysql`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const known = new Set(['--detach', '--stop', '--status']);
  for (const a of args) if (!known.has(a)) fail(`unknown option ${a} (use --detach, --stop or --status)`);
  if (args.has('--stop')) return stop();
  if (args.has('--status')) return status();
  return start(args.has('--detach'));
}

main().then(
  // Exit explicitly: in --detach mode no stray handle may keep the CLI attached to the server.
  () => process.exit(process.exitCode ?? 0),
  (error: unknown) => fail(error instanceof Error ? error.message : String(error)),
);
