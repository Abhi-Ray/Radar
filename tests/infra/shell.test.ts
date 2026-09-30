/**
 * The ops shell code (host scripts in ops/, the backup container in ops/backup/, the app-image
 * entrypoint) exercised through bash/sh exactly as it runs — only the parts that need no Docker,
 * MySQL, nginx or network. Everything runs in throwaway temp dirs with a minimal environment.
 */
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
