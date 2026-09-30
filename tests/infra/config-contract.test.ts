/**
 * Static contracts of the deployment files that no local run exercises (no Docker / nginx /
 * systemd on a dev laptop): VPS isolation, image hardening and the CI gates. Text-level checks on
 * purpose — they pin the few lines whose silent change would hurt production.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
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

  it('the internet-facing containers never get the root password, the backup key or the backup DB account', () => {
    expect(code(text)).toMatch(/x-app-env: &app-env[\s\S]*?MYSQL_ROOT_PASSWORD: ""[\s\S]*?BACKUP_PASSPHRASE: ""/);
    const body = code(text);
    const appEnv = body.slice(body.indexOf('x-app-env: &app-env'), body.indexOf('\nservices:\n'));
    for (const key of ['MYSQL_ROOT_PASSWORD', 'BACKUP_PASSPHRASE', 'BACKUP_DB_USER', 'BACKUP_DB_PASSWORD']) {
      expect(appEnv, key).toMatch(new RegExp(`^\\s+${key}: ""$`, 'm'));
    }
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

/** Every host/backup shell script under ops/ (comments stripped). */
function opsShell(): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(path.join(REPO, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(REPO, rel)).isDirectory()) walk(rel);
      else if (name.endsWith('.sh')) out[rel] = code(read(rel));
    }
  };
  walk('ops');
  return out;
}

/** The body of a shell function `name() { … }` (up to the first line that is just `}`). */
function shellFn(text: string, name: string): string {
  const m = new RegExp(`^${name}\\(\\) \\{[^\\n]*\\n([\\s\\S]*?)^\\}$`, 'm').exec(text);
  expect(m, name).toBeTruthy();
  return m?.[1] ?? '';
}

describe('image builds on the shared, swapless VPS (VPS-1)', () => {
  const common = code(read('ops/lib/common.sh'));
  const shell = opsShell();

  it('builds only in radar-builder: docker-container driver, 3 GiB RAM = RAM+swap, 1 CPU', () => {
    expect(common).toMatch(/^RADAR_BUILDER="\$\{RADAR_BUILDER:-radar-builder\}"$/m);
    expect(common).toMatch(/^RADAR_BUILD_MEMORY=3g$/m);
    const ensure = shellFn(common, 'radar_ensure_builder');
    expect(ensure).toMatch(/docker buildx inspect "\$RADAR_BUILDER"/);
    expect(ensure).toMatch(/docker buildx create --name "\$RADAR_BUILDER" --driver docker-container/);
    for (const opt of ['"memory=$RADAR_BUILD_MEMORY"', '"memory-swap=$RADAR_BUILD_MEMORY"', 'cpu-quota=100000', 'cpu-period=100000']) {
      expect(ensure, opt).toContain(`--driver-opt ${opt}`);
    }
    const build = shellFn(common, 'radar_compose_build');
    expect(build).toMatch(/radar_ensure_builder/);
    expect(build).toMatch(/GIT_SHA=\$1 radar_compose build --builder "\$RADAR_BUILDER"/);
    // The image must have been loaded into the local store at exactly this revision.
    expect(build).toMatch(/docker image inspect .*org\.opencontainers\.image\.revision.* radar-app:latest/);
    expect(code(read('Dockerfile'))).toMatch(/org\.opencontainers\.image\.revision="\$\{GIT_SHA\}"/);
    const deploy = shellFn(common, 'radar_compose_deploy');
    expect(deploy).toMatch(/radar_compose_build "\$1" \|\| return 1\n\s+GIT_SHA=\$1 radar_compose up -d --no-build --remove-orphans/);
  });

  it('no ops script builds any other way; clean-up is RADAR-scoped', () => {
    for (const [file, text] of Object.entries(shell)) {
      expect(text, file).not.toMatch(/up -d[^\n]*--build\b/);
      expect(text, file).not.toMatch(/radar_compose build(?! --builder)/);
      expect(text, file).not.toMatch(/docker (system|builder) prune|docker image prune[^\n]*-a\b|docker buildx prune(?! --builder)/);
    }
    const deploy = shellFn(common, 'radar_compose_deploy');
    expect(deploy).toMatch(/docker image prune -f --filter "label=com\.radar\.project=radar"/);
    expect(deploy).toMatch(/docker buildx prune --builder "\$RADAR_BUILDER" -f --filter until=168h/);
    // Every entry point makes sure the builder exists (an upgrade of Docker may have lost it).
    expect(shell['ops/install.sh']).toMatch(/radar_ensure_builder \|\| radar_die/);
    expect(shell['ops/deploy.sh']).toMatch(/radar_ensure_builder \|\| radar_warn[^\n]*\n(?:.*\n){0,2}radar_deploy_rev /);
    expect(shell['ops/autodeploy.sh']).toMatch(/radar_ensure_builder \|\| radar_warn[^\n]*\n(?:.*\n){0,2}radar_deploy_rev /);
  });

  it('memory guard: < 3.5 GiB MemAvailable defers the deploy (exit 4) before anything changes, never counts as a failure', () => {
    expect(common).toMatch(/^RADAR_BUILD_MIN_AVAILABLE_KB="\$\{RADAR_BUILD_MIN_AVAILABLE_KB:-3670016\}"$/m);
    expect(3670016).toBe(3.5 * 1024 * 1024);
    const rev = shellFn(common, 'radar_deploy_rev');
    const guard = /if ! radar_build_memory_ok; then\n\s+radar_defer_deploy "\$target"\n\s+return 4\n\s+fi/.exec(rev);
    expect(guard).toBeTruthy();
    expect(rev.indexOf(guard?.[0] ?? '#')).toBeLessThan(rev.indexOf('radar_git reset'));
    expect(rev.indexOf(guard?.[0] ?? '#')).toBeLessThan(rev.indexOf('radar_record_failure'));
    const defer = shellFn(common, 'radar_defer_deploy');
    expect(defer).not.toMatch(/radar_record_failure|radar_git|radar_compose /);
    expect(defer).toMatch(/radar_alert deploy_deferred warn /);
    expect(defer).toMatch(/"deploy_deferred:\$day"/);
    // autodeploy: deferred = success for systemd (the next tick retries); deploy.sh passes 4 on.
    expect(shell['ops/autodeploy.sh']).toMatch(/radar_deploy_rev "\$target" "\$deployed" \|\| rc=\$\?\n\[ "\$rc" = 4 \] && rc=0\nexit "\$rc"/);
    expect(shell['ops/deploy.sh']).toMatch(/radar_deploy_rev "\$target" "\$prev" \|\| rc=\$\?/);
    expect(shell['ops/install.sh']).toMatch(/radar_build_memory_ok \|\|\n\s+radar_die/);
  });

  it('keeps a V8 heap cap below the builder cgroup, and the comments tell the truth', () => {
    const docker = read('Dockerfile');
    const heap = Number(/^ARG BUILD_MAX_OLD_SPACE_MB=(\d+)$/m.exec(docker)?.[1]);
    expect(heap).toBeGreaterThan(0);
    expect(heap).toBeLessThan(3 * 1024);
    expect(code(docker)).toMatch(/NODE_OPTIONS="--max-old-space-size=\$\{BUILD_MAX_OLD_SPACE_MB\}" npm run build/);
    expect(docker).not.toMatch(/fails? cleanly/);
    expect(docker).toMatch(/radar-builder/);
    const unit = read('ops/systemd/radar-autodeploy.service');
    expect(unit).not.toMatch(/heap is capped in the Dockerfile/);
    expect(unit).toMatch(/radar-builder BuildKit container/);
    const deployDoc = read('docs/DEPLOY.md');
    expect(deployDoc).toContain('docker buildx create --name radar-builder --driver docker-container');
    expect(deployDoc).toContain('--driver-opt memory=3g --driver-opt memory-swap=3g');
    expect(deployDoc).toContain('--driver-opt cpu-quota=100000 --driver-opt cpu-period=100000');
    expect(deployDoc).toMatch(/GHCR/);
    for (const doc of ['docs/DEPLOY.md', 'docs/RECOVERY.md', 'docs/ARCHITECTURE.md', 'README.md']) {
      expect(read(doc), doc).not.toMatch(/`[^`\n]*up -d --build[^`\n]*`/);
      // Only RADAR-scoped pruning is ever recommended.
      expect(read(doc), doc).not.toMatch(/`sudo docker (builder|system) prune[^`]*`/);
    }
  });
});

describe('nginx site name and default server (NGINX-1)', () => {
  const install = code(read('ops/install.sh'));

  it('enables the vhost as sites-enabled/zz-radar and removes only our own old radar link', () => {
    expect(install).toMatch(/^NGINX_ENABLED=\/etc\/nginx\/sites-enabled\/zz-radar$/m);
    expect(install).toMatch(/^NGINX_ENABLED_OLD=\/etc\/nginx\/sites-enabled\/radar$/m);
    expect(install).toMatch(/nginx_old_link_is_ours\(\) \{ \[ -L "\$NGINX_ENABLED_OLD" \] && \[ "\$\(readlink "\$NGINX_ENABLED_OLD"\)" = "\$NGINX_AVAIL" \]; \}/);
    const vhost = shellFn(install, 'nginx_install_vhost');
    expect(vhost).toMatch(/ln -sfn "\$NGINX_AVAIL" "\$NGINX_ENABLED"/);
    expect(vhost).toMatch(/nginx_old_link_is_ours[^\n]*\n?[^\n]*rm -f "\$NGINX_ENABLED_OLD"/);
    // The http2 neighbour check ignores RADAR's own file under both names.
    expect(install).toMatch(/grep -v -e "\^\$NGINX_ENABLED:" -e "\^\$NGINX_ENABLED_OLD:"/);
    // `zz-radar` sorts after any plausible neighbour name in the sites-enabled/* glob.
    for (const neighbour of ['default', 'growviax', 'loop', 'radar', 'sahithya', 'shop', 'www', 'zeta']) {
      expect(['zz-radar', neighbour].sort()[1]).toBe('zz-radar');
    }
  });

  it('warns (does not fail) when nginx -T shows no default_server for :80 / :443', () => {
    const check = shellFn(install, 'nginx_default_server_check');
    expect(check).toMatch(/nginx -T/);
    expect(check).toMatch(/radar_nginx_ports_without_default "[^"]+" 80 443/);
    expect(check).toMatch(/radar_warn/);
    expect(check).not.toMatch(/radar_die|exit /);
    expect(shellFn(install, 'setup_nginx')).toMatch(/nginx_default_server_check/);
  });

  it('docs name the new link (and the old one only as the pre-upgrade name)', () => {
    for (const doc of ['docs/DEPLOY.md', 'docs/RECOVERY.md']) {
      const text = read(doc);
      expect(text, doc).toContain('/etc/nginx/sites-enabled/zz-radar');
      for (const m of text.matchAll(/sites-enabled\/radar\b/g)) {
        const around = text.slice(Math.max(0, (m.index ?? 0) - 160), (m.index ?? 0) + 160);
        expect(around, doc).toMatch(/older installs|before (this|that) name|readlink/);
      }
    }
  });
});
