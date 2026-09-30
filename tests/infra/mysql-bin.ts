import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Directory holding the mysql + mysqldump client tools, or null when this machine has none:
 * RADAR_MYSQL_BIN, then mysql-memory-server's 8.4.2 download cache (present after any local
 * DB-backed test run), then PATH.
 */
export function findMysqlBin(): string | null {
  const has = (dir: string) => existsSync(path.join(dir, 'mysqldump')) && existsSync(path.join(dir, 'mysql'));
  const explicit = process.env.RADAR_MYSQL_BIN?.trim();
  if (explicit) return has(explicit) ? explicit : null;
  const cached = path.join(tmpdir(), 'mysqlmsn/binaries/8.4.2/mysql/bin');
  if (has(cached)) return cached;
  const r = spawnSync('bash', ['-c', 'command -v mysqldump'], { encoding: 'utf8' });
  const dump = r.status === 0 ? r.stdout.trim() : '';
  return dump && has(path.dirname(dump)) ? path.dirname(dump) : null;
}
