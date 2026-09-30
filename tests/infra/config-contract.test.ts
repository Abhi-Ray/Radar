/**
 * Static contracts of the deployment files that no local run exercises (no Docker / nginx /
 * systemd on a dev laptop): VPS isolation, image hardening and the CI gates. Text-level checks on
 * purpose — they pin the few lines whose silent change would hurt production.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(__dirname, '../..');
const read = (p: string) => readFileSync(path.join(REPO, p), 'utf8');
/** Drops comment lines (and trailing comments on YAML/shell-like lines). */
const code = (text: string) =>
  text
    .split('\n')
    .filter((l) => !/^\s*#/.test(l))
    .map((l) => l.replace(/\s+#\s.*$/, ''))
    .join('\n');

/** Splits the `services:` section of docker-compose.yml into per-service blocks (2-space indent). */
function composeServices(text: string): Record<string, string> {
  const body = code(text);
  const start = body.indexOf('\nservices:\n');
  const end = body.indexOf('\nvolumes:\n', start);
  expect(start).toBeGreaterThan(-1);
  const section = body.slice(start + '\nservices:\n'.length, end === -1 ? undefined : end);
  const out: Record<string, string> = {};
  let name = '';
  for (const line of section.split('\n')) {
    const m = /^ {2}([a-z][a-z0-9_-]*):\s*$/.exec(line);
    if (m) {
      name = m[1];
      out[name] = '';
    } else if (name) out[name] += `${line}\n`;
  }
  return out;
}

describe('docker-compose.yml: isolated from everything else on the VPS', () => {
  const text = read('docker-compose.yml');
  const services = composeServices(text);

  it('own project name, the four services, named volumes', () => {
    expect(code(text)).toMatch(/^name: radar$/m);
    expect(Object.keys(services).sort()).toEqual(['app', 'backup', 'mysql', 'worker']);
    expect(code(text)).toMatch(/^ {2}radar_mysql:\n {4}name: radar_mysql$/m);
  });

  it('publishes exactly one port: the app on 127.0.0.1:3100 (never 80/443/3000/3001/3306 on the host)', () => {
    const published = [...code(text).matchAll(/^\s*ports:\s*\n((?:\s+- .*\n)+)/gm)].flatMap((m) =>
      m[1]
        .trim()
        .split('\n')
        .map((l) => l.trim().replace(/^- /, '').replace(/"/g, '')),
    );
    expect(published).toEqual(['127.0.0.1:3100:3000']);
    expect(services.app).toMatch(/ports:\s*\n\s+- "127\.0\.0\.1:3100:3000"/);
    expect(services.mysql).not.toMatch(/ports:/);
    expect(code(text)).not.toMatch(/network_mode:\s*host/);
  });

  it('MySQL sits on the internal-only network; every service is resource-limited and hardened', () => {
    expect(code(text)).toMatch(/^ {2}internal:\n {4}internal: true$/m);
    expect(services.mysql).toMatch(/networks: \[internal\]/);
    for (const [name, block] of Object.entries(services)) {
      expect(block, name).toMatch(/mem_limit: \d+m/);
      expect(block, name).toMatch(/cpus: /);
      expect(block, name).toMatch(/restart: unless-stopped/);
      expect(block, name).toMatch(/logging: \*logging/);
      // mysql keeps its capabilities (the entrypoint chowns its datadir) but not privilege escalation.
      expect(block, name).toMatch(name === 'mysql' ? /no-new-privileges:true/ : /<<: \*hardening/);
    }
    expect(code(text)).toMatch(/x-hardening: &hardening\n\s+security_opt:\n\s+- no-new-privileges:true\n\s+cap_drop:\n\s+- ALL/);
  });

  it('the internet-facing containers never get the root password or the backup key', () => {
    expect(code(text)).toMatch(/x-app-env: &app-env[\s\S]*?MYSQL_ROOT_PASSWORD: ""[\s\S]*?BACKUP_PASSPHRASE: ""/);
    expect(services.app).toMatch(/<<: \*app-env/);
    expect(services.worker).toMatch(/<<: \*app-env/);
    expect(services.backup).toMatch(/OPENROUTER_API_KEY: ""/);
    expect(services.backup).toMatch(/SESSION_SECRET: ""/);
    // The deploy key is mounted read-only and never auto-created as an empty directory.
    expect(services.backup).toMatch(/target: \/run\/secrets\/deploy_key\n\s+read_only: true\n\s+bind:\n\s+create_host_path: false/);
    // Required secrets fail loudly instead of defaulting to an empty password.
    expect(services.mysql).toMatch(/MYSQL_ROOT_PASSWORD: \$\{MYSQL_ROOT_PASSWORD:\?/);
  });
});

describe('Dockerfile (app image)', () => {
  const text = code(read('Dockerfile'));
  const runner = text.slice(text.lastIndexOf('\nFROM '));

  it('builds every bundle strictly (a missing entry point fails the image build)', () => {
    expect(text).toMatch(/RUN node scripts\/build-worker\.mjs/);
    expect(text).not.toMatch(/--allow-missing/);
    expect(text).toMatch(/npm ci/);
    expect(text).toMatch(/ARG NODE_IMAGE=node:22-/);
  });

  it('runner: non-root, tini as PID 1, health check on /api/health, migrations shipped', () => {
    expect(runner).toMatch(/AS runner/);
    expect(runner).toMatch(/^USER radar$/m);
    expect(runner.indexOf('USER radar')).toBeLessThan(runner.indexOf('ENTRYPOINT'));
    expect(runner).toMatch(/ENTRYPOINT \["\/usr\/bin\/tini", "-g", "--", "\/usr\/local\/bin\/radar-entrypoint"\]/);
    expect(runner).toMatch(/HEALTHCHECK [\s\S]*\/api\/health/);
    expect(runner).toMatch(/COPY --from=build \/app\/drizzle \.\/drizzle/);
    expect(runner).toMatch(/COPY --from=build \/app\/dist \.\/dist/);
    // No source, dev dependencies or package manager caches in the final stage.
    expect(runner).not.toMatch(/COPY \. \./);
    expect(runner).not.toMatch(/npm (ci|install)/);
  });

  it('.dockerignore keeps secrets, VCS data and local state out of the build context', () => {
    const ignore = code(read('.dockerignore')).split('\n').map((l) => l.trim());
    for (const p of ['**/.env', '**/.env.*', 'secrets/', '.git/', 'node_modules/', '.next/', 'dist/', '**/*.enc', '**/id_ed25519*', '.data/']) {
      expect(ignore, p).toContain(p);
    }
    expect(ignore).toContain('!.env.example');
  });
});

describe('backup image', () => {
  const text = code(read('ops/backup/Dockerfile'));

  it('same MySQL major as the server, smoke-tested at build time, never runs mysqld', () => {
    expect(text).toMatch(/ARG MYSQL_IMAGE=mysql:8\.4/);
    expect(code(read('docker-compose.yml'))).toMatch(/^ {4}image: mysql:8\.4$/m);
    expect(text).toMatch(/for s in \/opt\/radar-backup\/\*\.sh; do bash -n "\$s"; done/);
    expect(text).toMatch(/radar-backup-scheduler next-slots 0/);
    expect(text).toMatch(/for s in radar-backup radar-restore radar-restore-test radar-alert; do "\$s" --help/);
    expect(text).toMatch(/^ENTRYPOINT \[\]$/m);
    expect(text).toMatch(/^CMD \["radar-backup-scheduler"\]$/m);
  });
});

describe('nginx vhost', () => {
  const text = code(read('ops/nginx/radar.conf.template'));

  it('proxies only to the app on 127.0.0.1:3100 and never claims the default server', () => {
    expect(text).toMatch(/upstream radar_app \{\s+server 127\.0\.0\.1:3100;/);
    expect(text).not.toMatch(/default_server/);
    expect([...text.matchAll(/^\s*listen (\S+)/gm)].map((m) => m[1])).toEqual(['80;', '443']);
    expect(text).toMatch(/add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;/);
    expect(text).toMatch(/location = \/api\/auth\/login \{\s+limit_req zone=radar_login/);
    // Globally unique names: the conf lands in the shared http{} context next to other sites.
    expect(text).toMatch(/zone=radar_login:/);
    expect(text).toMatch(/ssl_session_cache shared:radar_tls:/);
  });
});

describe('CI workflow', () => {
  const text = code(read('.github/workflows/ci.yml'));

  it('runs on main + pull requests (never on the db-backups branch) with read-only permissions', () => {
    expect(text).toMatch(/on:\n\s+push:\n\s+branches: \[main\]\n\s+pull_request:\n\s+branches-ignore: \[db-backups\]/);
    expect(text).toMatch(/^permissions:\n\s+contents: read$/m);
  });

  it('gates on lint, typecheck, tests against MySQL 8.4, both builds, the images and a secret scan', () => {
    for (const step of ['npm ci', 'npm run lint', 'npm run typecheck', 'npm test', 'npm run build', 'npm run build:worker']) {
      expect(text, step).toContain(`- run: ${step}`);
    }
    expect(text).toMatch(/image: mysql:8\.4/);
    expect(text).toMatch(/TEST_DATABASE_URL: mysql:\/\/root:ci-root@127\.0\.0\.1:3306\//);
    expect(text).toMatch(/docker compose config --quiet/);
    expect(text).toMatch(/docker build .* -t radar-app:ci \./);
    expect(text).toMatch(/docker build -t radar-backup:ci ops\/backup/);
    expect(text).toMatch(/gitleaks\/gitleaks-action@v2/);
    // The only secret CI touches is its own token.
    expect([...text.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1])).toEqual(['GITHUB_TOKEN']);
  });

  it('package.json has the scripts CI calls', () => {
    const scripts = (JSON.parse(read('package.json')) as { scripts: Record<string, string> }).scripts;
    for (const s of ['lint', 'typecheck', 'test', 'build', 'build:worker']) expect(scripts[s], s).toBeTruthy();
    expect(scripts['build:worker']).toBe('node scripts/build-worker.mjs');
  });
});
