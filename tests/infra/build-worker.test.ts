import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  BANNER,
  ENTRIES,
  UsageError,
  buildOptions,
  checkMetafile,
  isBuiltin,
  missingEntriesMessage,
  parseArgs,
  resolveEntries,
} from '../../scripts/build-worker.mjs';

const REPO = path.resolve(__dirname, '../..');
const SCRIPT = path.join(REPO, 'scripts/build-worker.mjs');

describe('ENTRIES', () => {
  it('names the five application entry points from the spec with their sources', () => {
    const byName = Object.fromEntries(ENTRIES.map((e: { name: string; src: string; out: string }) => [e.name, e]));
    expect(byName.worker).toMatchObject({ src: 'src/worker/index.ts', out: 'worker.mjs' });
    expect(byName.cli).toMatchObject({ src: 'src/worker/cli.ts', out: 'cli.mjs' });
    expect(byName.migrate).toMatchObject({ src: 'src/db/migrate.ts', out: 'migrate.mjs' });
    expect(byName.seed).toMatchObject({ src: 'scripts/seed.ts', out: 'seed.mjs' });
    expect(byName.eval).toMatchObject({ src: 'src/lib/accuracy/cli.ts', out: 'eval.mjs' });
    // Output names are unique (one bundle per file).
    expect(new Set(ENTRIES.map((e: { out: string }) => e.out)).size).toBe(ENTRIES.length);
  });

  it('references every bundle that ops/docker/entrypoint.sh starts', () => {
    const entrypoint = readFileSync(path.join(REPO, 'ops/docker/entrypoint.sh'), 'utf8');
    const used = [...entrypoint.matchAll(/dist\/([a-z-]+\.mjs)/g)].map((m) => m[1]);
    expect(used.length).toBeGreaterThan(0);
    const outs = new Set(ENTRIES.map((e: { out: string }) => e.out));
    for (const out of used) expect(outs.has(out), out).toBe(true);
  });
});

describe('parseArgs', () => {
  const root = '/repo';

  it('defaults: strict, outdir = <root>/dist', () => {
    expect(parseArgs([], { root })).toEqual({
      allowMissing: false,
      root,
      outdir: path.join(root, 'dist'),
      only: null,
      help: false,
    });
  });

  it('reads every flag', () => {
    const o = parseArgs(['--allow-missing', '--root', '/x', '--outdir', '/y', '--only', 'worker, migrate'], { root });
    expect(o).toEqual({ allowMissing: true, root: '/x', outdir: '/y', only: ['worker', 'migrate'], help: false });
    expect(parseArgs(['-h'], { root }).help).toBe(true);
    expect(parseArgs(['--root', '/x'], { root }).outdir).toBe(path.join('/x', 'dist'));
  });

  it('rejects unknown flags, missing values and unknown entry names', () => {
    expect(() => parseArgs(['--allow-mising'], { root })).toThrow(UsageError);
    expect(() => parseArgs(['--root'], { root })).toThrow(/--root needs a value/);
    expect(() => parseArgs(['--outdir', '--allow-missing'], { root })).toThrow(/--outdir needs a value/);
    expect(() => parseArgs(['--only', 'worker,nope'], { root })).toThrow(/unknown entry name\(s\): nope/);
    expect(() => parseArgs(['--only', ' , '], { root })).toThrow(/at least one/);
  });
});

describe('resolveEntries / missingEntriesMessage', () => {
  it('splits by source existence and honours --only', () => {
    const present = new Set(['/r/src/db/migrate.ts', '/r/scripts/hash-password.ts']);
    const exists = (p: string) => present.has(p);
    const all = resolveEntries('/r', null, exists);
    expect(all.present.map((e: { name: string }) => e.name)).toEqual(['migrate', 'hash-password']);
    expect(all.missing.map((e: { name: string }) => e.name)).toEqual(['worker', 'cli', 'seed', 'eval', 'wait-for-migrations']);

    const only = resolveEntries('/r', ['worker', 'migrate'], exists);
    expect(only.present.map((e: { name: string }) => e.name)).toEqual(['migrate']);
    expect(only.missing.map((e: { name: string }) => e.name)).toEqual(['worker']);
  });

  it('names each missing entry, its source and the escape hatch', () => {
    const { missing } = resolveEntries('/r', ['worker', 'eval'], () => false);
    const msg = missingEntriesMessage(missing);
    expect(msg).toContain('2 entry point(s) missing');
    expect(msg).toContain('worker: src/worker/index.ts (→ dist/worker.mjs)');
    expect(msg).toContain('eval: src/lib/accuracy/cli.ts (→ dist/eval.mjs)');
    expect(msg).toContain('--allow-missing');
  });
});

describe('isBuiltin', () => {
  it('accepts node builtins in every spelling', () => {
    for (const s of ['fs', 'node:fs', 'fs/promises', 'node:fs/promises', 'crypto', 'node:test', 'node:sqlite']) {
      expect(isBuiltin(s), s).toBe(true);
    }
  });
  it('rejects packages', () => {
    for (const s of ['mysql2', 'mysql2/promise', 'next/server', 'drizzle-orm/mysql2', '@/lib/db', 'fsx']) {
      expect(isBuiltin(s), s).toBe(false);
    }
  });
});

describe('checkMetafile', () => {
  it('passes builtin externals and ordinary inputs', () => {
    const problems = checkMetafile({
      outputs: {
        'dist/worker.mjs': {
          imports: [
            { path: 'node:fs', external: true },
            { path: 'crypto', external: true },
            { path: 'src/lib/db/index.ts', external: false },
          ],
          inputs: { 'src/worker/index.ts': {}, 'node_modules/mysql2/index.js': {} },
        },
      },
    });
    expect(problems).toEqual([]);
  });

  it('flags non-builtin externals and Next/React DOM leaking into a bundle', () => {
    const problems = checkMetafile({
      outputs: {
        'dist/cli.mjs': {
          imports: [{ path: 'mysql2', external: true }],
          inputs: {
            'node_modules/next/dist/server/web/exports/index.js': {},
            'node_modules/react-dom/server.js': {},
          },
        },
        'dist/cli.mjs.map': { imports: [{ path: 'ignored', external: true }], inputs: {} },
      },
    });
    expect(problems).toHaveLength(3);
    expect(problems[0]).toMatch(/dist\/cli\.mjs: import "mysql2" was left external/);
    expect(problems.join('\n')).toMatch(/Next\.js internals/);
    expect(problems.join('\n')).toMatch(/React DOM/);
    expect(problems.join('\n')).not.toMatch(/ignored/);
  });

  it('tolerates an empty metafile', () => {
    expect(checkMetafile({})).toEqual([]);
  });
});

describe('buildOptions', () => {
  it('bundles everything for Node 22 ESM with the require banner and the resolve plugin', () => {
    const entries = ENTRIES.filter((e: { name: string }) => e.name === 'migrate' || e.name === 'worker');
    const o = buildOptions('/r', '/r/dist', entries);
    expect(o).toMatchObject({
      platform: 'node',
      target: 'node22',
      format: 'esm',
      bundle: true,
      packages: 'bundle',
      splitting: false,
      outdir: '/r/dist',
      outExtension: { '.js': '.mjs' },
      metafile: true,
      tsconfig: path.join('/r', 'tsconfig.json'),
    });
    expect(o.entryPoints).toEqual({ worker: '/r/src/worker/index.ts', migrate: '/r/src/db/migrate.ts' });
    expect(o.banner.js).toBe(BANNER);
    expect(BANNER).toContain('createRequire');
    expect(BANNER).toContain('const require = ');
    expect(o.plugins.map((p: { name: string }) => p.name)).toEqual(['radar-resolve']);
  });
});

// End to end: the real script against a throwaway project root (never touches the repo's dist/).
describe('build-worker CLI', () => {
  let root: string;

  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'radar-build-worker-'));
    mkdirSync(path.join(root, 'src/db'), { recursive: true });
    mkdirSync(path.join(root, 'src/lib'), { recursive: true });
    writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }));
    writeFileSync(path.join(root, 'src/lib/greeting.ts'), "import 'server-only';\nexport const greeting: string = 'migrate-ok';\n");
    // Uses the @/ alias, server-only, a node builtin, and `require` from the banner.
    writeFileSync(
      path.join(root, 'src/db/migrate.ts'),
      [
        "import 'server-only';",
        "import { greeting } from '@/lib/greeting';",
        "import { basename } from 'node:path';",
        "const os = require('node:os') as { EOL: string };",
        'process.stdout.write(`${greeting} ${basename(__filename)} ${os.EOL.length}\\n`);',
      ].join('\n'),
    );
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });

  const run = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, '--root', root, ...args], { encoding: 'utf8' });

  it('fails (exit 1) and lists the missing entries without --allow-missing', () => {
    const r = run();
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('entry point(s) missing');
    expect(r.stderr).toContain('worker: src/worker/index.ts');
    expect(r.stderr).toContain('cli: src/worker/cli.ts');
    expect(existsSync(path.join(root, 'dist/migrate.mjs'))).toBe(false);
  });

  it('exits 2 on a usage error', () => {
    const r = run('--bogus');
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown argument: --bogus');
    expect(r.stderr).toContain('Usage:');
  });

  it('bundles a present entry into a runnable, self-contained ESM file', () => {
    const r = run('--only', 'migrate');
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const out = path.join(root, 'dist/migrate.mjs');
    expect(readFileSync(out, 'utf8').startsWith(BANNER.split('\n')[0])).toBe(true);
    const exec = spawnSync(process.execPath, [out], { encoding: 'utf8', cwd: tmpdir() });
    expect(exec.stderr).toBe('');
    expect(exec.stdout.trim()).toBe('migrate-ok migrate.mjs 1');
  });

  it('--allow-missing skips missing entries with a warning, builds the rest and drops stale bundles', () => {
    const dist = path.join(root, 'dist');
    mkdirSync(dist, { recursive: true });
    writeFileSync(path.join(dist, 'worker.mjs'), '// stale bundle from an older build\n');
    const r = run('--allow-missing');
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('WARNING skipping missing entry worker');
    expect(r.stdout).toContain('1 bundle(s)');
    expect(existsSync(path.join(dist, 'worker.mjs'))).toBe(false);
    expect(existsSync(path.join(dist, 'migrate.mjs'))).toBe(true);
  });

  it('--only rebuilds just the named bundles and leaves the others in place', () => {
    const other = path.join(root, 'dist/hash-password.mjs');
    writeFileSync(other, '// built earlier\n');
    const r = run('--only', 'migrate');
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(other, 'utf8')).toBe('// built earlier\n');
  });
});
