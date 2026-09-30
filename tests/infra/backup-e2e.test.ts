/**
 * The backup container's scripts (ops/backup/*.sh) end to end, exactly as the container runs them
 * — minus Docker: a real MySQL (tests/helpers/db.ts), the real mysql/mysqldump/openssl/git tools,
 * and a local bare repository standing in for the GitHub `db-backups` branch.
 *
 *   backup → LATEST.json + one orphan commit → second backup replaces it → restore test →
 *   restore into a scratch DB → live-restore guards → tampered backup → shrink guard
 *
 * Needs the mysql 8.4 client tools (mysql-memory-server's download cache, RADAR_MYSQL_BIN or
 * PATH); skipped otherwise. RADAR_BACKUP_E2E=0 skips, =1 also accepts older client versions.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDb, type TestDb } from '../helpers/db';
import { findMysqlBin } from './mysql-bin';

const REPO = path.resolve(__dirname, '../..');
const BACKUP_DIR = path.join(REPO, 'ops/backup');
const PASSPHRASE = 'e2e-dummy-passphrase-not-a-secret-0123';
const UNICODE = `Grüße — 日本語 'single' "double" \\ back\\slash 🚀`;
const SEED_ROWS = 120; // the shrink guard only protects stored backups of more than 100 rows

function clientVersionOk(bin: string | null): boolean {
  if (!bin || process.env.RADAR_BACKUP_E2E === '0') return false;
  if (process.env.RADAR_BACKUP_E2E === '1') return true;
  const r = spawnSync(path.join(bin, 'mysqldump'), ['--version'], { encoding: 'utf8' });
  const m = /(\d+)\.(\d+)\.\d+/.exec(r.stdout ?? '');
  return !!m && (Number(m[1]) > 8 || (Number(m[1]) === 8 && Number(m[2]) >= 4));
}

interface LatestJson {
  format: string;
  database: string;
  sizeBytes: number;
  sha256: string;
  parts: { name: string; sizeBytes: number; sha256: string }[];
  rowCounts: Record<string, number>;
  totalRows: number;
  migrationsApplied: number;
  lastMigration: { createdAt: number; hash: string | null; tag: string | null } | null;
  runId: number | null;
}

const BIN = findMysqlBin();
const ENABLED = clientVersionOk(BIN);

describe.skipIf(!ENABLED)('backup container scripts end to end', () => {
  let t: TestDb;
  let dbName: string;
  let work: string;
  let remote: string;
  let env: NodeJS.ProcessEnv;
  let restoreTestDb: string;
  let scratchDb: string;
  const journal = JSON.parse(readFileSync(path.join(REPO, 'drizzle/meta/_journal.json'), 'utf8')) as { entries: { tag: string; when: number }[] };

  const run = (script: string, args: string[] = [], extra: Record<string, string> = {}): SpawnSyncReturns<string> =>
    spawnSync('bash', [path.join(BACKUP_DIR, script), ...args], { encoding: 'utf8', env: { ...env, ...extra }, timeout: 110_000 });
  const git = (...args: string[]) => {
    const r = spawnSync('git', args, { encoding: 'utf8', env });
    expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
    return r.stdout;
  };
  const gitBuffer = (...args: string[]) => spawnSync('git', args, { env }).stdout as Buffer;
  const q = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> => {
    const [rows] = await t.pool.query(sql, params);
    return rows as T[];
  };
  const latest = () => JSON.parse(git('--git-dir', remote, 'show', 'db-backups:LATEST.json')) as LatestJson;
  const commits = () => git('--git-dir', remote, 'rev-list', 'db-backups').trim().split('\n');
  const schemaExists = async (name: string) =>
    (await q<{ n: number }>('SELECT COUNT(*) AS n FROM information_schema.schemata WHERE schema_name = ?', [name]))[0].n === 1;
  const today = () => new Date().toISOString().slice(0, 10);
  const expectOk = (r: SpawnSyncReturns<string>) => expect(r.status, `${r.stderr}\n${r.stdout}`).toBe(0);

  beforeAll(async () => {
    t = await startTestDb();
    const u = new URL(t.url);
    dbName = u.pathname.slice(1);
    restoreTestDb = `${dbName}_rt`;
    scratchDb = `${dbName}_sc`;
    work = mkdtempSync(path.join(tmpdir(), 'radar-backup-e2e-'));
    remote = path.join(work, 'remote.git');
    mkdirSync(path.join(work, 'tmp'));
    env = {
      PATH: `${BIN}:${process.env.PATH ?? '/usr/bin:/bin'}`,
      HOME: work,
      NODE_ENV: 'test',
      LC_ALL: 'C',
      TZ: 'UTC',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      MYSQL_HOST: u.hostname,
      MYSQL_PORT: u.port || '3306',
      MYSQL_DATABASE: dbName,
      BACKUP_DB_USER: decodeURIComponent(u.username),
      BACKUP_DB_PASSWORD: decodeURIComponent(u.password),
      RESTORE_TEST_DB: restoreTestDb,
      BACKUP_REPO: remote,
      BACKUP_BRANCH: 'db-backups',
      BACKUP_WORK_DIR: path.join(work, 'work'),
      TMPDIR: path.join(work, 'tmp'),
      RADAR_BACKUP_HOME: BACKUP_DIR,
      RADAR_MIGRATIONS_DIR: path.join(REPO, 'drizzle'),
      BACKUP_KNOWN_HOSTS: path.join(BACKUP_DIR, 'github_known_hosts'),
      BACKUP_PASSPHRASE: PASSPHRASE,
    };
    const init = spawnSync('git', ['init', '--bare', '--quiet', remote], { encoding: 'utf8', env });
    expect(init.status, init.stderr).toBe(0);

    const values = Array.from({ length: SEED_ROWS }, (_, i) => ['admin', `e2e.action.${i}`, 'e2e', String(i), `${UNICODE} #${i}`]);
    await t.pool.query('INSERT INTO audit_log (actor, action, entity_type, entity_id, reason) VALUES ?', [values]);
  });

  afterAll(async () => {
    if (t) {
      for (const d of [restoreTestDb, scratchDb]) await t.pool.query(`DROP DATABASE IF EXISTS \`${d}\``).catch(() => undefined);
      await t.stop();
    }
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it('backup: encrypted dump + LATEST.json published as one orphan commit, run recorded', async () => {
    const r = run('backup.sh');
    expectOk(r);
    expect(r.stdout + r.stderr).not.toContain(PASSPHRASE);

    expect(commits()).toHaveLength(1);
    expect(git('--git-dir', remote, 'ls-tree', '--name-only', 'db-backups').trim().split('\n')).toEqual(['LATEST.json', 'radar-db.sql.gz.enc']);

    const meta = latest();
    const blob = gitBuffer('--git-dir', remote, 'show', 'db-backups:radar-db.sql.gz.enc');
    expect(meta.format).toBe('radar-db-backup/1');
    expect(meta.database).toBe(dbName);
    expect(meta.sizeBytes).toBe(blob.length);
    expect(meta.sha256).toBe(createHash('sha256').update(blob).digest('hex'));
    expect(meta.parts).toEqual([{ name: 'radar-db.sql.gz.enc', sizeBytes: blob.length, sha256: meta.sha256 }]);
    expect(meta.rowCounts.audit_log).toBe(SEED_ROWS);
    expect(meta.totalRows).toBeGreaterThan(100);
    expect(meta.migrationsApplied).toBe(journal.entries.length);
    expect(meta.lastMigration).toMatchObject({ tag: journal.entries.at(-1)?.tag, createdAt: journal.entries.at(-1)?.when });
    expect(typeof meta.runId).toBe('number');

    const [runRow] = await q<{ kind: string; status: string; sha256: string; size_bytes: number }>(
      'SELECT kind, status, sha256, size_bytes FROM backup_runs WHERE id = ?',
      [meta.runId],
    );
    expect(runRow).toMatchObject({ kind: 'backup', status: 'ok', sha256: meta.sha256, size_bytes: blob.length });

    // Encrypted at rest; the documented manual recovery (docs/RECOVERY.md) reads it back.
    expect(blob.subarray(0, 8).toString('latin1')).toBe('Salted__');
    expect(blob.includes(Buffer.from('e2e.action.'))).toBe(false);
    writeFileSync(path.join(work, 'blob.enc'), blob);
    const decrypted = spawnSync(
      'bash',
      ['-c', 'set -o pipefail; openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 -md sha256 -pass env:BACKUP_PASSPHRASE -in "$1" | gunzip -c', 'x', path.join(work, 'blob.enc')],
      { env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    );
    expect(decrypted.status, decrypted.stderr).toBe(0);
    expect(decrypted.stdout).toContain('-- Dump completed');
    expect(decrypted.stdout).toContain('CREATE TABLE `audit_log`');
  });

  it('a second backup replaces the first: the branch never grows past one commit', async () => {
    const before = commits();
    await t.pool.query("INSERT INTO audit_log (actor, action, entity_type, reason) VALUES ('admin', 'e2e.second', 'e2e', ?)", [UNICODE]);
    expectOk(run('backup.sh'));
    const after = commits();
    expect(after).toHaveLength(1);
    expect(after[0]).not.toBe(before[0]);
    expect(latest().rowCounts.audit_log).toBe(SEED_ROWS + 1);
  });

  it('restore test: restores into the throw-away DB, matches every count, drops it, records ok', async () => {
    const r = run('restore-test.sh');
    expectOk(r);
    expect(await schemaExists(restoreTestDb)).toBe(false);
    const [row] = await q<{ status: string; sha256: string; error: string | null }>(
      "SELECT status, sha256, error FROM backup_runs WHERE kind = 'restore_test' ORDER BY id DESC LIMIT 1",
    );
    expect(row).toMatchObject({ status: 'ok', sha256: latest().sha256, error: null });
    expect(await schemaExists(dbName)).toBe(true);
  });

  it('restore --target: an identical scratch copy whose own backup_runs row is finished', async () => {
    const meta = latest();
    expectOk(run('restore.sh', ['--target', scratchDb]));
    const sum = async (db: string) => (await q<{ Checksum: number }>(`CHECKSUM TABLE \`${db}\`.audit_log`))[0].Checksum;
    expect(await sum(scratchDb)).toBe(await sum(dbName));
    const [u] = await q<{ reason: string }>(`SELECT reason FROM \`${scratchDb}\`.audit_log WHERE action = 'e2e.second'`);
    expect(u.reason).toBe(UNICODE);

    // The dump holds this backup's own run as 'running': radar-restore finishes it, so the next
    // backup on the restored server does not mark it failed.
    const [runRow] = await q<{ status: string; sha256: string; details_json: unknown }>(
      `SELECT status, sha256, details_json FROM \`${scratchDb}\`.backup_runs WHERE id = ?`,
      [meta.runId],
    );
    const details = typeof runRow.details_json === 'string' ? JSON.parse(runRow.details_json) : runRow.details_json;
    expect(runRow).toMatchObject({ status: 'ok', sha256: meta.sha256 });
    expect(details).toMatchObject({ finishedBy: 'radar-restore', format: 'radar-db-backup/1' });
    const [running] = await q<{ n: number }>(`SELECT COUNT(*) AS n FROM \`${scratchDb}\`.backup_runs WHERE status = 'running'`);
    expect(running.n).toBe(0);
    await t.pool.query(`DROP DATABASE \`${scratchDb}\``);
  });

  it('the live database is guarded: --yes-i-know is required and open connections block the restore', async () => {
    const count = async () => (await q<{ n: number }>('SELECT COUNT(*) AS n FROM audit_log'))[0].n;
    const before = await count();

    const refused = run('restore.sh');
    expect(refused.status).toBe(1);
    expect(refused.stderr).toContain('without --yes-i-know');

    // The app still holds a connection to the live DB (compose stop app worker was forgotten).
    const conn = await t.pool.getConnection();
    try {
      const busy = run('restore.sh', ['--yes-i-know', '--no-safety-dump']);
      expect(busy.status).toBe(1);
      expect(busy.stderr).toMatch(/other connection\(s\) are using/);
    } finally {
      conn.release();
    }
    expect(await count()).toBe(before);
  });

  it('a tampered backup fails the restore test: failed runs + one deduplicated critical alert', async () => {
    const clone = path.join(work, 'tamper');
    git('clone', '--quiet', '--branch', 'db-backups', remote, clone);
    const file = path.join(clone, 'radar-db.sql.gz.enc');
    const bytes = readFileSync(file);
    bytes[Math.floor(bytes.length / 2)] ^= 0xff; // same size, different content
    writeFileSync(file, bytes);
    git('-C', clone, '-c', 'user.name=e2e', '-c', 'user.email=e2e@localhost.invalid', 'commit', '--quiet', '--amend', '-am', 'tampered');
    git('-C', clone, 'push', '--quiet', '--force', 'origin', 'HEAD:refs/heads/db-backups');

    for (let i = 0; i < 2; i++) {
      const r = run('restore-test.sh');
      expect(r.status, r.stderr).toBe(1);
      expect(r.stderr).toMatch(/sha256/i);
    }
    expect(await schemaExists(restoreTestDb)).toBe(false);
    const failed = await q<{ error: string }>("SELECT error FROM backup_runs WHERE kind = 'restore_test' AND status = 'failed'");
    expect(failed).toHaveLength(2);
    const alerts = await q<{ severity: string; occurrences: number; acknowledged_at: unknown }>(
      "SELECT severity, occurrences, acknowledged_at FROM alerts WHERE kind = 'restore_test_failed' AND dedupe_key = ?",
      [`restore_test_failed:${today()}`],
    );
    expect(alerts).toEqual([{ severity: 'critical', occurrences: 2, acknowledged_at: null }]);

    // A manual restore refuses the same file before touching any database.
    await t.pool.query(`DROP DATABASE IF EXISTS \`${scratchDb}\``);
    const r = run('restore.sh', ['--target', scratchDb]);
    expect(r.status).toBe(1);
    expect(await schemaExists(scratchDb)).toBe(false);
  });

  it('shrink guard: an emptied database never replaces the stored backup (failed run + alert)', async () => {
    const stored = commits()[0];
    await t.truncateAll();
    const r = run('backup.sh');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('refusing to replace the stored backup');
    expect(commits()).toEqual([stored]);

    const [runRow] = await q<{ status: string; error: string }>("SELECT status, error FROM backup_runs WHERE kind = 'backup' ORDER BY id DESC LIMIT 1");
    expect(runRow.status).toBe('failed');
    expect(runRow.error).toContain('refusing to replace');
    const alerts = await q<{ severity: string; occurrences: number }>('SELECT severity, occurrences FROM alerts WHERE dedupe_key = ?', [`backup_failed:${today()}`]);
    expect(alerts).toEqual([{ severity: 'critical', occurrences: 1 }]);

    // Deliberate replacement.
    expectOk(run('backup.sh', ['--allow-shrink']));
    expect(commits()).toHaveLength(1);
    expect(commits()[0]).not.toBe(stored);
    expect(latest().rowCounts.audit_log).toBe(0);
  });
});
