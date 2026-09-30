/**
 * The ops shell code (host scripts in ops/, the backup container in ops/backup/, the app-image
 * entrypoint) exercised through bash/sh exactly as it runs — only the parts that need no Docker,
 * MySQL, nginx or network. Everything runs in throwaway temp dirs with a minimal environment.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { envSchema } from '../../src/lib/env';
import { findMysqlBin } from './mysql-bin';

const REPO = path.resolve(__dirname, '../..');
const COMMON = path.join(REPO, 'ops/lib/common.sh');
const BACKUP_LIB = path.join(REPO, 'ops/backup/lib.sh');
const SCHEDULER = path.join(REPO, 'ops/backup/scheduler.sh');
const SECRETS = path.join(REPO, 'ops/secrets.sh');
const ENTRYPOINT = path.join(REPO, 'ops/docker/entrypoint.sh');

/** A clean environment: nothing from the developer's shell (no real passphrases) leaks in. */
function cleanEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: tmpdir(), TMPDIR: tmpdir(), LC_ALL: 'C', NODE_ENV: 'test', ...extra };
}

/** Runs `script` in bash after sourcing `lib`; extra args are available as "$@". */
function bashWith(lib: string, script: string, args: string[] = [], env: Record<string, string> = {}): SpawnSyncReturns<string> {
  return spawnSync('bash', ['-c', `. "$0"; ${script}`, lib, ...args], { encoding: 'utf8', env: cleanEnv(env) });
}

function listScripts(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listScripts(p));
    else if (name.endsWith('.sh')) out.push(p);
  }
  return out;
}

const iso = (epoch: number) => new Date(epoch * 1000).toISOString().replace('.000Z', 'Z');
const epochOf = (s: string) => Date.parse(s) / 1000;

describe('syntax', () => {
  it('every ops shell script parses (bash -n; the entrypoint with POSIX sh -n)', () => {
    const scripts = listScripts(path.join(REPO, 'ops'));
    expect(scripts.length).toBeGreaterThanOrEqual(12);
    for (const file of scripts) {
      const shell = file === ENTRYPOINT ? 'sh' : 'bash';
      const r = spawnSync(shell, ['-n', file], { encoding: 'utf8' });
      expect(r.status, `${path.relative(REPO, file)}: ${r.stderr}`).toBe(0);
    }
  });
});

describe('backup lib: civil date math (no GNU/BSD date differences)', () => {
  it('matches the JS calendar across leap years, centuries and the epoch', () => {
    const days = [-719468, -1, 0, 1, 59, 789, 10956, 11016, 11017, 19782, 20361, 20362, 20727, 47482, 47541, 47542];
    const r = bashWith(BACKUP_LIB, 'for d in "$@"; do rb_civil_from_days "$d"; done', days.map(String));
    expect(r.status, r.stderr).toBe(0);
    const lines = r.stdout.trim().split('\n');
    days.forEach((d, i) => {
      const dt = new Date(d * 86_400_000);
      expect(lines[i], String(d)).toBe(`${dt.getUTCFullYear()} ${dt.getUTCMonth() + 1} ${dt.getUTCDate()}`);
    });
  });

  it('days_from_civil is the inverse, and iso_from_epoch formats UTC', () => {
    const r = bashWith(
      BACKUP_LIB,
      'rb_days_from_civil 1970 1 1; rb_days_from_civil 2000 2 29; rb_days_from_civil 2100 3 1; rb_days_from_civil 2026 9 30; rb_iso_from_epoch 0; rb_iso_from_epoch 1790767321',
    );
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim().split('\n')).toEqual([
      '0',
      String(Date.UTC(2000, 1, 29) / 86_400_000),
      String(Date.UTC(2100, 2, 1) / 86_400_000),
      String(Date.UTC(2026, 8, 30) / 86_400_000),
      '1970-01-01T00:00:00Z',
      iso(1790767321),
    ]);
  });
});

describe('backup lib: quoting helpers', () => {
  it('rb_json_str produces valid JSON for hostile input (control chars dropped)', () => {
    const input = 'he said "hi"\\ \n\ttab\r \u0001bell /path\u001f';
    const r = bashWith(BACKUP_LIB, 'rb_json_str "$1"', [input]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toBe('he said "hi"\\ \n\ttab\r bell /path');
  });

  it('rb_sql_str hex-encodes values so nothing needs SQL quoting', () => {
    const r = bashWith(BACKUP_LIB, 'rb_sql_str ""; echo; rb_sql_str "$1"', ["a'b; DROP"]);
    expect(r.status, r.stderr).toBe(0);
    const [empty, value] = r.stdout.split('\n');
    expect(empty).toBe("''");
    expect(value).toBe(`CONVERT(UNHEX('${Buffer.from("a'b; DROP").toString('hex')}') USING utf8mb4)`);
  });

  it('rb_is_uint / rb_valid_ident', () => {
    const r = bashWith(
      BACKUP_LIB,
      'for v in 0 42 "" -1 1.5 x; do rb_is_uint "$v" && echo "u:$v:y" || echo "u:$v:n"; done; for v in radar radar_restore_test "a-b" "x;y" ""; do rb_valid_ident "$v" && echo "i:$v:y" || echo "i:$v:n"; done',
    );
    expect(r.stdout.trim().split('\n')).toEqual([
      'u:0:y',
      'u:42:y',
      'u::n',
      'u:-1:n',
      'u:1.5:n',
      'u:x:n',
      'i:radar:y',
      'i:radar_restore_test:y',
      'i:a-b:n',
      'i:x;y:n',
      'i::n',
    ]);
  });
});

describe('backup lib: usage text and the client option file', () => {
  const BACKUP_DIR = path.join(REPO, 'ops/backup');

  /** What rb_usage must print: line 2 up to the first non-comment line, '# ' / '#' stripped. */
  function expectedUsage(file: string): string {
    const out: string[] = [];
    for (const line of readFileSync(file, 'utf8').split('\n').slice(1)) {
      if (!line.startsWith('#')) break;
      out.push(line.startsWith('# ') ? line.slice(2) : line.slice(1));
    }
    return `${out.join('\n')}\n`;
  }

  it('--help works without any external command (the mysql:8.4 image has no awk)', () => {
    const cases: [string, string[]][] = [
      ['backup.sh', ['--help']],
      ['restore.sh', ['--help']],
      ['restore-test.sh', ['--help']],
      ['radar-alert.sh', ['--help']],
      ['scheduler.sh', ['help']],
    ];
    for (const [name, args] of cases) {
      const file = path.join(BACKUP_DIR, name);
      // No PATH at all: only bash builtins can run.
      const r = spawnSync('/bin/bash', [file, ...args], {
        encoding: 'utf8',
        env: { PATH: '/nonexistent', RADAR_BACKUP_HOME: BACKUP_DIR, LC_ALL: 'C', NODE_ENV: 'test' },
      });
      expect(r.status, `${name}: ${r.stderr}`).toBe(0);
      expect(r.stderr, name).toBe('');
      expect(r.stdout, name).toBe(expectedUsage(file));
      expect(r.stdout.split('\n')[0], name).not.toMatch(/^[#!]/);
      expect(r.stdout.length, name).toBeGreaterThan(40);
    }
  });

  it('rb_write_mycnf: mode 600, escaped values, and only mysqldump-compatible options in [client]', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'radar-mycnf-'));
    try {
      const password = String.raw`p\a#s s;w'o=rd`;
      const r = bashWith(
        BACKUP_LIB,
        'RB_TMP=$1 MYSQL_HOST=db.internal MYSQL_PORT=3306 BACKUP_DB_USER=root BACKUP_DB_PASSWORD=$2; rb_write_mycnf; printf "%s" "$RB_MYCNF"',
        [dir, password],
      );
      expect(r.status, r.stderr).toBe(0);
      const cnf = r.stdout;
      expect(cnf).toBe(path.join(dir, 'client.cnf'));
      expect(statSync(cnf).mode & 0o777).toBe(0o600);

      const groups: Record<string, Record<string, string>> = {};
      let group = '';
      for (const line of readFileSync(cnf, 'utf8').split('\n')) {
        if (!line) continue;
        const g = /^\[(.+)\]$/.exec(line);
        if (g) {
          group = g[1];
          groups[group] = {};
          continue;
        }
        const i = line.indexOf('=');
        groups[group][line.slice(0, i)] = line.slice(i + 1);
      }
      // [client] is read by EVERY client program (mysqldump included, which rejects unknown options).
      expect(Object.keys(groups.client).sort()).toEqual(['default-character-set', 'host', 'password', 'port', 'protocol', 'user']);
      expect(groups.client.password).toBe(`"${password.replace(/\\/g, '\\\\')}"`);
      expect(groups.client.host).toBe('"db.internal"');
      expect(groups.mysql).toEqual({ 'connect-timeout': '15' });

      // With real client tools: both programs accept the file, and the password reads back verbatim.
      const bin = findMysqlBin();
      if (bin) {
        for (const prog of ['mysqldump', 'mysql']) {
          const v = spawnSync(path.join(bin, prog), [`--defaults-extra-file=${cnf}`, '--version'], { encoding: 'utf8', env: cleanEnv() });
          expect(v.status, `${prog}: ${v.stderr}`).toBe(0);
        }
        const printDefaults = path.join(bin, 'my_print_defaults');
        if (existsSync(printDefaults)) {
          const printed = spawnSync(printDefaults, [`--defaults-file=${cnf}`, '--show', 'client'], { encoding: 'utf8', env: cleanEnv() });
          expect(printed.status, printed.stderr).toBe(0);
          expect(printed.stdout.trim().split('\n')).toEqual([
            '--host=db.internal',
            '--port=3306',
            '--user=root',
            `--password=${password}`,
            '--protocol=TCP',
            '--default-character-set=utf8mb4',
          ]);
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('backup lib: job lock and temp dirs in the shared work volume', () => {
  let work: string;
  const now = () => Math.floor(Date.now() / 1000);
  const DEAD_PID = '2147480000';
  const lockDir = () => path.join(work, 'locks/db-job.lock');
  function plant(owner: string | null, mtime?: number): void {
    mkdirSync(lockDir(), { recursive: true });
    if (owner !== null) writeFileSync(path.join(lockDir(), 'owner'), `${owner}\n`);
    if (mtime) utimesSync(lockDir(), mtime, mtime);
  }
  /** rb_lock as the scheduler container "sched-a" would run it. */
  const take = () => bashWith(BACKUP_LIB, 'BACKUP_WORK_DIR="$1"; rb_lock; cat "$RB_LOCK_DIR/owner"', [work], { HOSTNAME: 'sched-a' });

  beforeEach(() => {
    work = mkdtempSync(path.join(tmpdir(), 'radar-lock-'));
  });
  afterEach(() => {
    rmSync(work, { recursive: true, force: true });
  });

  it('takes a free lock and records pid, host and time', () => {
    const r = take();
    expect(r.status, r.stderr).toBe(0);
    const [pid, host, at] = r.stdout.trim().split(' ');
    expect(Number(pid)).toBeGreaterThan(0);
    expect(host).toBe('sched-a');
    expect(Math.abs(Number(at) - now())).toBeLessThan(60);
  });

  it('same host: busy while the owner pid is alive, stale once it is gone', () => {
    plant(`${process.pid} sched-a ${now()}`);
    const busy = take();
    expect(busy.status).toBe(75);
    expect(busy.stderr).toContain('another backup/restore job is running');
    expect(existsSync(lockDir())).toBe(true);

    rmSync(lockDir(), { recursive: true });
    plant(`${DEAD_PID} sched-a ${now()}`);
    const stale = take();
    expect(stale.status, stale.stderr).toBe(0);
    expect(stale.stderr).toContain('breaking stale lock');
  });

  it('another container (its pid is not visible here) or a legacy owner: busy until 6 h old', () => {
    for (const owner of [`${DEAD_PID} run-1f2e3d ${now() - 3600}`, `${DEAD_PID} ${now() - 3600}`]) {
      rmSync(lockDir(), { recursive: true, force: true });
      plant(owner);
      expect(take().status, owner).toBe(75);
    }
    for (const owner of [`${DEAD_PID} run-1f2e3d ${now() - 7 * 3600}`, `${DEAD_PID} ${now() - 7 * 3600}`, `${process.pid} sched-a ${now() - 7 * 3600}`]) {
      rmSync(lockDir(), { recursive: true, force: true });
      plant(owner);
      const r = take();
      expect(r.status, `${owner}: ${r.stderr}`).toBe(0);
      expect(r.stderr).toContain('breaking stale lock');
    }
  });

  it('an owner file not written yet: busy for a minute, then stale', () => {
    plant(null);
    expect(take().status).toBe(75);
    rmSync(lockDir(), { recursive: true });
    plant(null, now() - 300);
    expect(take().status).toBe(0);
  });

  it('scheduler start-up only breaks locks of its own (previous) container', () => {
    const cases: [string, string, boolean][] = [
      [`${process.pid} sched-old ${now()}`, 'sched-old', true], // re-created container: previous host
      [`${process.pid} sched-a ${now()}`, 'sched-old', true], // restarted container: same host
      [`${process.pid} run-1f2e3d ${now()}`, 'sched-old', false], // a `docker compose run` job
      [`${process.pid} run-1f2e3d ${now()}`, '', false],
      [`${process.pid} ${now()}`, 'sched-old', false], // legacy owner: left to rb_lock's 6 h rule
    ];
    for (const [owner, prev, broken] of cases) {
      rmSync(lockDir(), { recursive: true, force: true });
      plant(owner);
      const r = bashWith(BACKUP_LIB, 'BACKUP_WORK_DIR="$1"; rb_break_own_stale_lock "$2"', [work, prev], { HOSTNAME: 'sched-a' });
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(lockDir()), `${owner} / ${prev}`).toBe(!broken);
    }
  });

  it('rb_prune_stale_tmp removes only radar-backup.* dirs older than 6 h', () => {
    const tmp = path.join(work, 'tmp');
    const old = now() - 7 * 3600;
    for (const name of ['radar-backup.fresh1', 'radar-backup.old1', 'other.old']) mkdirSync(path.join(tmp, name), { recursive: true });
    writeFileSync(path.join(tmp, 'radar-backup.old1', 'part'), 'x');
    utimesSync(path.join(tmp, 'radar-backup.old1'), old, old);
    utimesSync(path.join(tmp, 'other.old'), old, old);
    const r = bashWith(BACKUP_LIB, 'rb_prune_stale_tmp', [], { TMPDIR: tmp });
    expect(r.status, r.stderr).toBe(0);
    expect(readdirSync(tmp).sort()).toEqual(['other.old', 'radar-backup.fresh1']);
  });

  it('the scheduler no longer deletes the lock or temp dirs unconditionally', () => {
    const src = readFileSync(SCHEDULER, 'utf8');
    expect(src).not.toMatch(/rm -rf "\$BACKUP_WORK_DIR\/locks/);
    expect(src).not.toMatch(/rm -rf "\$\{TMPDIR/);
    expect(src).toContain('rb_break_own_stale_lock');
    expect(src).toContain('rb_prune_stale_tmp');
  });
});

describe('backup scheduler: next slots (UTC)', () => {
  function slots(now: string, env: Record<string, string> = {}): { backup: string; restore: string } {
    const r = spawnSync('bash', [SCHEDULER, 'next-slots', String(epochOf(now))], { encoding: 'utf8', env: cleanEnv(env) });
    expect(r.status, r.stderr).toBe(0);
    const out = Object.fromEntries(
      r.stdout
        .trim()
        .split('\n')
        .map((l) => {
          const [name, epoch, when] = l.split(' ');
          expect(iso(Number(epoch))).toBe(when); // epoch and ISO agree
          return [name, when];
        }),
    );
    return { backup: out.backup, restore: out['restore-test'] };
  }

  it('defaults: backup daily 21:00, restore test on day 1 at 22:00', () => {
    expect(slots('2026-09-30T12:00:00Z')).toEqual({ backup: '2026-09-30T21:00:00Z', restore: '2026-10-01T22:00:00Z' });
  });

  it('a slot is strictly after "now"', () => {
    expect(slots('2026-09-30T21:00:00Z').backup).toBe('2026-10-01T21:00:00Z');
    expect(slots('2026-10-01T21:59:59Z').restore).toBe('2026-10-01T22:00:00Z');
    expect(slots('2026-10-01T22:00:00Z').restore).toBe('2026-11-01T22:00:00Z');
  });

  it('rolls over months and years', () => {
    expect(slots('2026-12-01T22:00:00Z')).toEqual({ backup: '2026-12-02T21:00:00Z', restore: '2027-01-01T22:00:00Z' });
    expect(slots('2026-12-31T21:30:00Z').backup).toBe('2027-01-01T21:00:00Z');
  });

  it('honours the BACKUP_* / RESTORE_TEST_* settings (leading zeros are decimal)', () => {
    const env = { BACKUP_HOUR_UTC: '09', BACKUP_MINUTE_UTC: '08', RESTORE_TEST_DAY: '28', RESTORE_TEST_HOUR_UTC: '0', RESTORE_TEST_MINUTE_UTC: '5' };
    expect(slots('2028-02-28T23:00:00Z', env)).toEqual({ backup: '2028-02-29T09:08:00Z', restore: '2028-03-28T00:05:00Z' });
  });

  it('rejects invalid schedules and arguments', () => {
    const invalid: Record<string, string>[] = [
      { BACKUP_HOUR_UTC: '24' },
      { BACKUP_MINUTE_UTC: '60' },
      { RESTORE_TEST_DAY: '29' },
      { RESTORE_TEST_DAY: '0' },
      { BACKUP_HOUR_UTC: 'x' },
    ];
    for (const env of invalid) {
      const r = spawnSync('bash', [SCHEDULER, 'next-slots', '0'], { encoding: 'utf8', env: cleanEnv(env) });
      expect(r.status, JSON.stringify(env)).toBe(1);
    }
    const bad = spawnSync('bash', [SCHEDULER, 'next-slots', 'soon'], { encoding: 'utf8', env: cleanEnv() });
    expect(bad.status).toBe(2);
  });
});

describe('host helpers (ops/lib/common.sh)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'radar-common-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('radar_sslip_domain / radar_valid_domain', () => {
    const r = bashWith(COMMON, 'radar_sslip_domain 187.127.129.127; radar_sslip_domain not-an-ip || echo rejected');
    expect(r.stdout.trim().split('\n')).toEqual(['radar.187-127-129-127.sslip.io', 'rejected']);
    const valid = ['radar.187-127-129-127.sslip.io', 'radar.example.com', 'a.b.co'];
    const invalid = ['localhost', 'Radar.Example.com', '-x.example.com', 'a..b.com', 'x.com;reboot', 'x.com/evil', 'x.123', ''];
    const v = bashWith(COMMON, 'for d in "$@"; do radar_valid_domain "$d" && echo y || echo n; done', [...valid, ...invalid]);
    expect(v.stdout.trim().split('\n')).toEqual([...valid.map(() => 'y'), ...invalid.map(() => 'n')]);
  });

  it('radar_version_ge compares dotted versions numerically', () => {
    const cases: [string, string, boolean][] = [
      ['1.24.0', '1.25.1', false],
      ['1.25.1', '1.25.1', true],
      ['1.25.10', '1.25.9', true],
      ['1.26', '1.25.1', true],
      ['2.0.0', '1.99.99', true],
      ['1.9', '1.10', false],
    ];
    const r = bashWith(COMMON, 'while [ "$#" -gt 0 ]; do radar_version_ge "$1" "$2" && echo y || echo n; shift 2; done', cases.flatMap(([a, b]) => [a, b]));
    expect(r.stdout.trim().split('\n')).toEqual(cases.map(([, , ge]) => (ge ? 'y' : 'n')));
  });

  it('radar_env_get: last assignment wins, quotes and CR stripped, missing is empty', () => {
    const f = path.join(dir, 'get.env');
    writeFileSync(f, 'A=1\n# A=commented\nB="two words"\nC=\'x=y\'\nA=3\nD=crlf\r\nE=\n');
    const r = bashWith(COMMON, 'for k in A B C D E MISSING; do printf "%s=[%s]\\n" "$k" "$(radar_env_get "$k" "$1")"; done; radar_env_get A /nonexistent; echo "rc=$?"', [f]);
    expect(r.stdout.trim().split('\n')).toEqual(['A=[3]', 'B=[two words]', 'C=[x=y]', 'D=[crlf]', 'E=[]', 'MISSING=[]', 'rc=0']);
  });

  it('radar_env_set: replaces the last assignment verbatim, appends otherwise, keeps the mode', () => {
    const f = path.join(dir, 'set.env');
    writeFileSync(f, '# comment\nA=1\nB=2\nA=old', { mode: 0o600 });
    const value = String.raw`a&b/c\d$e|f'g"h`;
    const r = bashWith(COMMON, 'radar_env_set A "$2" "$1" && radar_env_set NEW v "$1" && radar_env_set B "" "$1"', [f, value]);
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(f, 'utf8')).toBe(`# comment\nA=1\nB=\nA=${value}\nNEW=v\n`);
    expect(statSync(f).mode & 0o777).toBe(0o600);
    const multi = bashWith(COMMON, 'radar_env_set A "$(printf "x\\ny")" "$1"', [f]);
    expect(multi.status).toBe(1);
    const badKey = bashWith(COMMON, 'radar_env_set "A B" v "$1"', [f]);
    expect(badKey.status).toBe(1);
  });

  it('radar_env_invalid_lines lists what is not blank / comment / KEY=VALUE', () => {
    const f = path.join(dir, 'invalid.env');
    writeFileSync(f, 'A=1\n\n  # ok\nexport B=2\nC = 3\n9X=1\n_OK=\n');
    const r = bashWith(COMMON, 'radar_env_invalid_lines "$1"', [f]);
    expect(r.stdout.trim().split('\n')).toEqual(['4', '5', '6']);
  });

  it('radar_render_nginx fills exactly the three placeholders and keeps nginx variables', () => {
    const tpl = path.join(REPO, 'ops/nginx/radar.conf.template');
    const plain = bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com "" ""', [tpl]);
    expect(plain.status, plain.stderr).toBe(0);
    const body = plain.stdout.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    expect(body).not.toContain('${');
    expect(body).toContain('server_name radar.example.com;');
    expect(body).toContain('ssl_certificate     /etc/letsencrypt/live/radar.example.com/fullchain.pem;');
    expect(body).toMatch(/listen 443 ssl;/);
    expect(body).not.toMatch(/http2/);
    expect(body).toContain('$request_uri');
    expect(body).not.toMatch(/default_server/);
    expect(body).toMatch(/proxy_pass http:\/\/radar_app/);

    const legacy = bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com " http2" ""', [tpl]);
    expect(legacy.stdout).toMatch(/listen 443 ssl http2;/);
    const modern = bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com "" "http2 on;"', [tpl]);
    expect(modern.stdout).toMatch(/listen 443 ssl;\n\s+http2 on;/);

    const bootstrap = bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com "" ""', [path.join(REPO, 'ops/nginx/radar-http-only.conf.template')]);
    expect(bootstrap.status, bootstrap.stderr).toBe(0);
    expect(bootstrap.stdout).toContain('server_name radar.example.com;');
    expect(bootstrap.stdout).toContain('/var/www/radar-acme');
    expect(bootstrap.stdout).not.toMatch(/listen 443/);
  });

  it('radar_render_nginx refuses bad domains, bad http2 values and leftover placeholders', () => {
    const tpl = path.join(REPO, 'ops/nginx/radar.conf.template');
    expect(bashWith(COMMON, 'radar_render_nginx "$1" "x.com;evil" "" ""', [tpl]).status).toBe(1);
    expect(bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com " http3" ""', [tpl]).status).toBe(1);
    expect(bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com "" "listen 1;"', [tpl]).status).toBe(1);
    const odd = path.join(dir, 'odd.template');
    writeFileSync(odd, 'server_name ${DOMAIN};\nroot ${WEBROOT};\n');
    const r = bashWith(COMMON, 'radar_render_nginx "$1" radar.example.com "" ""', [odd]);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('unrendered placeholder');
  });

  it('radar_nginx_ports_without_default finds sockets with no default_server (NGINX-1)', () => {
    const dump = path.join(dir, 'nginx-T.txt');
    const check = (conf: string) => {
      writeFileSync(dump, conf);
      const r = bashWith(COMMON, 'radar_nginx_ports_without_default "$1" 80 443', [dump]);
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim().split('\n').filter(Boolean);
    };
    expect(check('server {\n    listen 80 default_server;\n    listen [::]:80 default_server;\n}\nserver {\n  listen 443 ssl default_server;\n}\n')).toEqual([]);
    expect(check('server {\n\tlisten 0.0.0.0:80 default_server;\n}\nserver { listen 443 ssl; }\n')).toEqual(['443']);
    expect(check('server {\n  listen [::]:443 ssl http2 default_server;\n  listen 80;\n}\n')).toEqual(['80']);
    // Other ports, comments and look-alikes do not count.
    expect(check('server {\n  listen 8080 default_server;\n  # listen 80 default_server;\n  listen 443 ssl; # default_server\n  listen 4430 default_server;\n}\n')).toEqual(['80', '443']);
    expect(check('')).toEqual(['80', '443']);
  });

  it('radar_is_public_ip / radar_public_ips: local detection of this host\'s own public addresses (SSRF-1)', () => {
    const pub = ['8.8.8.8', '187.127.129.127', '100.128.0.1', '172.15.0.1', '2a02:4780:12:abcd::1', '2001:4860:4860::8888', '2a00:1:2:3:4:5:6:7'];
    const priv = ['10.1.1.1', '100.64.0.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.17.0.1', '192.168.1.1', '192.0.2.5', '198.18.0.1', '203.0.113.9',
      '224.0.0.1', '255.255.255.255', '0.0.0.0', '1.2.3', '01.2.3.4', '256.1.1.1', '2001:db8::1', 'fe80::1', '::1', '::', 'fd00::1', 'fc00::1', 'ff02::1',
      '::ffff:8.8.8.8', '2a00:::1', '2a00::1::2', '2a00:1:', '2a00:1:2:3:4:5:6', '2a00:1:2:3:4:5:6:7:8', 'fe80::1%eth0', 'garbage', ''];
    const r = bashWith(COMMON, 'for a in "$@"; do radar_is_public_ip "$a" && echo y || echo n; done', [...pub, ...priv]);
    expect(r.stdout.trim().split('\n')).toEqual([...pub.map(() => 'y'), ...priv.map(() => 'n')]);

    const bin = path.join(dir, 'bin');
    mkdirSync(bin, { recursive: true });
    const fake = (name: string, body: string) => writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    // `ip -o addr show scope global` on a VPS with docker bridges (sample output, one line each).
    fake('ip', `cat <<'EOF'
2: eth0    inet 187.127.129.127/24 metric 100 brd 187.127.129.255 scope global dynamic eth0\\       valid_lft 86251sec preferred_lft 86251sec
3: docker0    inet 172.17.0.1/16 brd 172.17.255.255 scope global docker0\\       valid_lft forever preferred_lft forever
4: br-1a2b3c    inet 10.20.0.1/16 brd 10.20.255.255 scope global br-1a2b3c\\       valid_lft forever preferred_lft forever
2: eth0    inet6 2A02:4780:12:ABCD::1/64 scope global \\       valid_lft forever preferred_lft forever
2: eth0    inet6 fd00::5/64 scope global \\       valid_lft forever preferred_lft forever
2: eth0    inet 187.127.129.127/32 scope global eth0\\       valid_lft forever preferred_lft forever
EOF`);
    fake('hostname', 'echo "must not be used" >&2; exit 1');
    const PATH = `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`;
    const viaIp = bashWith(COMMON, 'radar_public_ips', [], { PATH });
    expect(viaIp.status, viaIp.stderr).toBe(0);
    const list = viaIp.stdout.trim();
    expect(list).toBe('187.127.129.127,2a02:4780:12:abcd::1');
    // What install.sh writes is exactly what the app's env schema accepts.
    expect(envSchema.shape.SAFE_FETCH_DENY_IPS.parse(list)).toEqual(['187.127.129.127', '2a02:4780:12:abcd:0:0:0:1']);

    // No `ip` output → `hostname -I`.
    fake('ip', 'exit 1');
    fake('hostname', '[ "$1" = -I ] && echo "10.0.0.4 187.127.129.127 172.17.0.1 2a02:4780:12:abcd::1 "');
    expect(bashWith(COMMON, 'radar_public_ips', [], { PATH }).stdout.trim()).toBe('187.127.129.127,2a02:4780:12:abcd::1');
    // Nothing public → empty output, still success.
    fake('hostname', 'echo "10.0.0.4 172.17.0.1"');
    const none = bashWith(COMMON, 'radar_public_ips; echo "rc=$?"', [], { PATH });
    expect(none.stdout).toBe('rc=0\n');
  });

  it('install.sh writes SAFE_FETCH_DENY_IPS once, only when the key is absent (SSRF-1)', () => {
    const install = readFileSync(path.join(REPO, 'ops/install.sh'), 'utf8');
    const fn = /^setup_fetch_deny_list\(\) \{\n[\s\S]*?\n\}\n/m.exec(install)?.[0];
    expect(fn).toBeTruthy();
    // Runs after .env exists and is checked, before anything uses it.
    expect(install).toMatch(/\n  check_env\n  setup_fetch_deny_list\n  setup_deploy_key\n/);
    const bin = path.join(dir, 'bin-install');
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, 'ip'), '#!/bin/sh\necho "2: eth0    inet 187.127.129.127/24 scope global eth0"\n', { mode: 0o755 });
    const PATH = `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`;
    const env = path.join(dir, 'install.env');
    const run = () => bashWith(COMMON, `${fn}\nENV_FILE="$1"; setup_fetch_deny_list`, [env], { PATH });

    writeFileSync(env, 'DOMAIN=radar.example.com\nMYSQL_PASSWORD=x', { mode: 0o600 });
    const first = run();
    expect(first.status, first.stderr).toBe(0);
    expect(readFileSync(env, 'utf8')).toBe('DOMAIN=radar.example.com\nMYSQL_PASSWORD=x\nSAFE_FETCH_DENY_IPS=187.127.129.127\n');
    expect(statSync(env).mode & 0o777).toBe(0o600);
    // Idempotent: a second run (even on a host whose address changed) keeps the key as it is.
    writeFileSync(path.join(bin, 'ip'), '#!/bin/sh\necho "2: eth0    inet 8.8.8.8/24 scope global eth0"\n', { mode: 0o755 });
    expect(run().status).toBe(0);
    expect(readFileSync(env, 'utf8')).toBe('DOMAIN=radar.example.com\nMYSQL_PASSWORD=x\nSAFE_FETCH_DENY_IPS=187.127.129.127\n');
    // An operator's (even empty) value is kept.
    writeFileSync(env, 'SAFE_FETCH_DENY_IPS=\n');
    expect(run().status).toBe(0);
    expect(readFileSync(env, 'utf8')).toBe('SAFE_FETCH_DENY_IPS=\n');
    // Nothing detected: warn, write nothing, do not fail the install.
    writeFileSync(path.join(bin, 'ip'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    writeFileSync(path.join(bin, 'hostname'), '#!/bin/sh\necho 10.0.0.4\n', { mode: 0o755 });
    writeFileSync(env, 'DOMAIN=radar.example.com\n');
    const none = run();
    expect(none.status).toBe(0);
    expect(none.stderr).toContain('set SAFE_FETCH_DENY_IPS in .env by hand');
    expect(readFileSync(env, 'utf8')).toBe('DOMAIN=radar.example.com\n');
  });

  it('build memory guard: MemAvailable from /proc/meminfo, deferral without a failed attempt, one alert a day (VPS-1)', () => {
    const meminfo = path.join(dir, 'meminfo');
    const state = path.join(dir, 'state');
    mkdirSync(state, { recursive: true });
    const setAvail = (kb: number | null) =>
      writeFileSync(meminfo, `MemTotal:        8123456 kB\nMemFree:          412345 kB\n${kb === null ? '' : `MemAvailable:    ${kb} kB\n`}Buffers:           12345 kB\n`);
    const env = { RADAR_MEMINFO: meminfo, RADAR_STATE_DIR: state };
    const ok = () => bashWith(COMMON, 'radar_mem_available_kb; radar_build_memory_ok && echo ok || echo low', [], env).stdout.trim().split('\n');
    setAvail(3670016);
    expect(ok()).toEqual(['3670016', 'ok']);
    setAvail(3670015);
    expect(ok()).toEqual(['3670015', 'low']);
    setAvail(null);
    expect(ok()).toEqual(['0', 'low']);
    expect(bashWith(COMMON, 'radar_mem_available_kb', [], { RADAR_MEMINFO: path.join(dir, 'missing') }).stdout.trim()).toBe('0');

    // radar_deploy_rev with too little memory: returns 4 before touching git/docker, records no
    // failure, and stores the deploy_deferred alert only once per UTC day.
    setAvail(1024 * 1024);
    const sha = 'a'.repeat(40);
    const script = `alerts="$RADAR_STATE_DIR/alerts"
radar_alert() { printf '%s|%s|%s\\n' "$1" "$2" "$5" >>"$alerts"; }
radar_git() { echo "git must not run" >&2; return 99; }
radar_compose() { echo "compose must not run" >&2; return 99; }
radar_deploy_rev "$1" "$2"; echo "rc=$?"; radar_deploy_rev "$1" "$2"; echo "rc=$?"`;
    const r = bashWith(COMMON, script, [sha, 'b'.repeat(40)], env);
    expect(r.stdout).toBe('rc=4\nrc=4\n');
    expect(r.stderr).not.toMatch(/must not run/);
    expect(r.stderr).toContain(`deploy of ${sha.slice(0, 12)} deferred: MemAvailable is 1024 MiB, a build needs 3584 MiB`);
    const day = new Date().toISOString().slice(0, 10);
    expect(readFileSync(path.join(state, 'alerts'), 'utf8')).toBe(`deploy_deferred|warn|deploy_deferred:${day}\n`);
    expect(existsSync(path.join(state, 'failed-sha'))).toBe(false);
    // A stamp from an earlier day allows the next alert.
    writeFileSync(path.join(state, 'deploy-deferred-day'), '2000-01-01\n');
    bashWith(COMMON, script, [sha, ''], env);
    expect(readFileSync(path.join(state, 'alerts'), 'utf8').trim().split('\n')).toHaveLength(2);
  });
});

describe('ops/secrets.sh (init → encrypt → check → decrypt)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'radar-secrets-test-'));
  });
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const run = (args: string[], env: Record<string, string> = {}) =>
    spawnSync('bash', [SECRETS, ...args], { encoding: 'utf8', env: cleanEnv(env), input: '' });

  it('round-trips an env file without ever printing a value', () => {
    const envFile = path.join(dir, 'generated.env');
    const init = run(['init', '--domain', 'radar.example.com', '--email', 'me@example.com', '--out', envFile]);
    expect(init.status, init.stderr).toBe(0);
    expect(statSync(envFile).mode & 0o777).toBe(0o600);

    const text = readFileSync(envFile, 'utf8');
    const get = (k: string) => (text.match(new RegExp(`^${k}=(.*)$`, 'm')) ?? [])[1];
    expect(get('DOMAIN')).toBe('radar.example.com');
    expect(get('APP_URL')).toBe('https://radar.example.com');
    expect(get('ADMIN_EMAIL')).toBe('me@example.com');
    expect(get('SESSION_SECRET')).toMatch(/^[0-9a-f]{64}$/);
    expect(get('MYSQL_ROOT_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
    expect(get('MYSQL_PASSWORD')).toMatch(/^[0-9a-f]{48}$/);
    const pass = get('BACKUP_PASSPHRASE') ?? '';
    expect(pass).toMatch(/^[0-9a-f]{64}$/);
    expect(get('ADMIN_PASSWORD_HASH')).toBe('');
    // Every key of .env.example is still there.
    const exampleKeys = [...readFileSync(path.join(REPO, '.env.example'), 'utf8').matchAll(/^([A-Z_][A-Z0-9_]*)=/gm)].map((m) => m[1]);
    for (const k of exampleKeys) expect(text, k).toMatch(new RegExp(`^${k}=`, 'm'));

    const secrets = ['SESSION_SECRET', 'MYSQL_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'BACKUP_PASSPHRASE'].map((k) => get(k) ?? '');
    const noLeak = (r: SpawnSyncReturns<string>) => {
      for (const s of secrets) expect(r.stdout + r.stderr).not.toContain(s);
    };
    noLeak(init);

    // encrypt: passphrase taken from the input file's BACKUP_PASSPHRASE line.
    const enc = path.join(dir, 'secrets.env.enc');
    const e = run(['encrypt', '--in', envFile, '--out', enc]);
    expect(e.status, e.stderr).toBe(0);
    noLeak(e);
    expect(readFileSync(enc).subarray(0, 8).toString('latin1')).toBe('Salted__');

    // check: key names only.
    const c = run(['check', '--in', enc], { BACKUP_PASSPHRASE: pass });
    expect(c.status, c.stderr).toBe(0);
    expect(c.stderr).toContain('SESSION_SECRET');
    noLeak(c);

    // decrypt: byte-identical, mode 600, refuses to overwrite without --force.
    const out = path.join(dir, 'restored.env');
    const d = run(['decrypt', '--in', enc, '--out', out], { BACKUP_PASSPHRASE: pass });
    expect(d.status, d.stderr).toBe(0);
    noLeak(d);
    expect(readFileSync(out, 'utf8')).toBe(text);
    expect(statSync(out).mode & 0o777).toBe(0o600);
    const again = run(['decrypt', '--in', enc, '--out', out], { BACKUP_PASSPHRASE: pass });
    expect(again.status).toBe(1);
    expect(again.stderr).toContain('--force');
    expect(run(['decrypt', '--in', enc, '--out', out, '--force'], { BACKUP_PASSPHRASE: pass }).status).toBe(0);

    // The documented manual command (docs/RECOVERY.md) decrypts the same file.
    const manual = spawnSync(
      'openssl',
      ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-iter', '600000', '-md', 'sha256', '-pass', 'env:BACKUP_PASSPHRASE', '-in', enc],
      { encoding: 'utf8', env: cleanEnv({ BACKUP_PASSPHRASE: pass }) },
    );
    expect(manual.status, manual.stderr).toBe(0);
    expect(manual.stdout).toBe(text);

    // Wrong passphrase, no passphrase (no TTY), too-short passphrase.
    const wrong = run(['decrypt', '--in', enc, '--out', path.join(dir, 'x.env')], { BACKUP_PASSPHRASE: 'wrong-passphrase-wrong-passphrase' });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('wrong BACKUP_PASSPHRASE');
    const none = run(['check', '--in', enc]);
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('no terminal');
    const plain = path.join(dir, 'plain.env');
    writeFileSync(plain, 'A=1\n');
    const short = run(['encrypt', '--in', plain, '--out', path.join(dir, 'short.enc')], { BACKUP_PASSPHRASE: 'short' });
    expect(short.status).toBe(1);
    expect(short.stderr).toContain('at least 24 characters');
  });

  it('refuses a non-env input and usage errors', () => {
    const junk = path.join(dir, 'junk.env');
    writeFileSync(junk, 'this is not\nan env file\n');
    const r = run(['encrypt', '--in', junk, '--out', path.join(dir, 'junk.enc')], { BACKUP_PASSPHRASE: 'x'.repeat(32) });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('not a KEY=VALUE file');
    expect(run([]).status).toBe(2);
    expect(run(['encrypt', '--bogus']).status).toBe(2);
    expect(run(['init', '--domain', 'bad_domain', '--email', 'me@example.com', '--out', path.join(dir, 'i.env')]).status).toBe(1);
  });
});

describe('app-image entrypoint', () => {
  it('prints its usage and execs unknown modes as commands', () => {
    const env = cleanEnv({ RADAR_APP_DIR: tmpdir() });
    const help = spawnSync('sh', [ENTRYPOINT, 'help'], { encoding: 'utf8', env });
    expect(help.status, help.stderr).toBe(0);
    for (const mode of ['web', 'worker', 'cli|pipeline', 'migrate', 'seed', 'eval', 'hash-password']) {
      expect(help.stdout).toContain(mode);
    }
    const passthrough = spawnSync('sh', [ENTRYPOINT, 'printf', '%s', 'passthrough-ok'], { encoding: 'utf8', env });
    expect(passthrough.stdout).toBe('passthrough-ok');
  });
});
