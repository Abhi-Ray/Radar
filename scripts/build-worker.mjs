#!/usr/bin/env node
/**
 * Bundles RADAR's non-Next entry points into self-contained ESM files under dist/ with esbuild.
 * The Docker runner stage ships dist/ next to the Next standalone server, so the worker, the
 * pipeline CLI, the migrator, the seeder and the accuracy eval run with plain `node` — no tsx,
 * no node_modules beyond what the bundle carries.
 *
 *   node scripts/build-worker.mjs                   # all entries; a missing one is an error
 *   node scripts/build-worker.mjs --allow-missing   # LOCAL VERIFICATION ONLY: skip missing entries
 *   node scripts/build-worker.mjs --root <dir> --outdir <dir>
 *
 * Settings: platform node, target node22, format esm, every dependency bundled, a createRequire
 * banner (CJS dependencies call require() on node builtins), the tsconfig `@/*` → `src/*` alias,
 * and `server-only` replaced by an empty module (it throws outside React's server condition, but
 * the worker legitimately shares server modules with the app).
 *
 * After bundling, the build fails if a bundle kept a non-builtin import external (it would not
 * resolve inside the image), pulled in Next.js / React DOM (server-component code leaking into the
 * worker), or does not parse (`node --check`).
 *
 * The Dockerfile runs this WITHOUT --allow-missing, so a missing entry breaks the image build.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Entry points: `src` (relative to the project root) → `dist/<out>`.
 * The first five are the application entries named in the spec; the last two are small
 * operational helpers used by ops/docker/entrypoint.sh.
 */
export const ENTRIES = Object.freeze([
  { name: 'worker', src: 'src/worker/index.ts', out: 'worker.mjs' },
  { name: 'cli', src: 'src/worker/cli.ts', out: 'cli.mjs' },
  { name: 'migrate', src: 'src/db/migrate.ts', out: 'migrate.mjs' },
  { name: 'seed', src: 'scripts/seed.ts', out: 'seed.mjs' },
  { name: 'eval', src: 'src/lib/accuracy/cli.ts', out: 'eval.mjs' },
  { name: 'wait-for-migrations', src: 'ops/docker/wait-for-migrations.ts', out: 'wait-for-migrations.mjs' },
  { name: 'hash-password', src: 'scripts/hash-password.ts', out: 'hash-password.mjs' },
]);

/**
 * Prepended to every bundle. `require` is a real module-scoped binding (bundled CommonJS code
 * calls it for node builtins). `__filename` / `__dirname` are only provided as globals (never
 * `const`) so a bundled ES module that declares its own top-level `__dirname` cannot collide.
 */
export const BANNER = [
  "import { createRequire as __radarCreateRequire } from 'node:module';",
  "import { fileURLToPath as __radarFileURLToPath } from 'node:url';",
  "import { dirname as __radarDirname } from 'node:path';",
  'const require = __radarCreateRequire(import.meta.url);',
  'globalThis.__filename ??= __radarFileURLToPath(import.meta.url);',
  'globalThis.__dirname ??= __radarDirname(globalThis.__filename);',
].join('\n');

const USAGE = `Usage: node scripts/build-worker.mjs [--allow-missing] [--root <dir>] [--outdir <dir>] [--only <name,...>]

  --allow-missing  skip entry points whose source file does not exist (local verification only;
                   the Docker build never passes it)
  --root <dir>     project root (default: the repository containing this script)
  --outdir <dir>   output folder (default: <root>/dist)
  --only <names>   comma-separated subset of: ${ENTRIES.map((e) => e.name).join(', ')}
`;

export class UsageError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Parses CLI flags. Pure; throws UsageError on anything unknown. */
export function parseArgs(argv, defaults) {
  const opts = { allowMissing: false, root: defaults.root, outdir: null, only: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) throw new UsageError(`${arg} needs a value`);
      i += 1;
      return v;
    };
    if (arg === '--allow-missing') opts.allowMissing = true;
    else if (arg === '--root') opts.root = path.resolve(value());
    else if (arg === '--outdir') opts.outdir = path.resolve(value());
    else if (arg === '--only') {
      const names = value()
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const unknown = names.filter((n) => !ENTRIES.some((e) => e.name === n));
      if (unknown.length > 0) throw new UsageError(`unknown entry name(s): ${unknown.join(', ')}`);
      if (names.length === 0) throw new UsageError('--only needs at least one entry name');
      opts.only = names;
    } else if (arg === '--help' || arg === '-h') opts.help = true;
    else throw new UsageError(`unknown argument: ${arg}`);
  }
  if (!opts.outdir) opts.outdir = path.join(opts.root, 'dist');
  return opts;
}

/**
 * Splits the selected entries into present / missing (by source file existence).
 * `exists` is injectable for tests.
 * @param {string} root
 * @param {readonly string[] | null} [only]
 * @param {(file: string) => boolean} [exists]
 */
export function resolveEntries(root, only = null, exists = existsSync) {
  const selected = only ? ENTRIES.filter((e) => only.includes(e.name)) : [...ENTRIES];
  const present = [];
  const missing = [];
  for (const entry of selected) {
    (exists(path.join(root, entry.src)) ? present : missing).push(entry);
  }
  return { present, missing };
}

/** Human-readable failure for missing entries (names both the entry and its source path). */
export function missingEntriesMessage(missing) {
  const list = missing.map((e) => `  - ${e.name}: ${e.src} (→ dist/${e.out})`).join('\n');
  return (
    `build-worker: ${missing.length} entry point(s) missing:\n${list}\n` +
    'Every entry is required for the Docker image. (For a local check of the remaining entries only, ' +
    'pass --allow-missing.)'
  );
}

const BUILTINS = new Set(builtinModules.flatMap((m) => [m, `node:${m}`]));

/** True for `fs`, `node:fs`, `fs/promises`, `node:test`, … */
export function isBuiltin(specifier) {
  if (BUILTINS.has(specifier)) return true;
  if (specifier.startsWith('node:')) return true;
  const base = specifier.split('/')[0];
  return BUILTINS.has(base);
}

const FORBIDDEN_INPUTS = [
  { re: /(^|\/)node_modules\/next\//, why: 'Next.js internals' },
  { re: /(^|\/)node_modules\/react-dom\//, why: 'React DOM' },
];

/**
 * Inspects an esbuild metafile. Returns a list of problems (empty = fine):
 * non-builtin imports left external, and forbidden packages pulled into a bundle.
 */
export function checkMetafile(metafile) {
  const problems = [];
  for (const [outFile, output] of Object.entries(metafile.outputs ?? {})) {
    if (outFile.endsWith('.map')) continue;
    for (const imp of output.imports ?? []) {
      if (imp.external && !isBuiltin(imp.path)) {
        problems.push(`${outFile}: import "${imp.path}" was left external and would not resolve in the image`);
      }
    }
    for (const input of Object.keys(output.inputs ?? {})) {
      for (const f of FORBIDDEN_INPUTS) {
        if (f.re.test(input)) {
          problems.push(`${outFile}: bundles ${f.why} (${input}); worker code must not import app/Next modules`);
          break;
        }
      }
    }
  }
  return problems;
}

/** esbuild plugin: `server-only` → empty module; `@/x` → `<root>/src/x` (mirrors tsconfig paths). */
export function radarResolvePlugin(root) {
  const srcDir = path.join(root, 'src');
  return {
    name: 'radar-resolve',
    setup(build) {
      build.onResolve({ filter: /^server-only$/ }, () => ({ path: 'server-only', namespace: 'radar-empty' }));
      build.onLoad({ filter: /.*/, namespace: 'radar-empty' }, () => ({ contents: 'export {};\n', loader: 'js' }));
      build.onResolve({ filter: /^@\// }, (args) =>
        build.resolve(`./${args.path.slice(2)}`, { resolveDir: srcDir, kind: args.kind, importer: args.importer }),
      );
    },
  };
}

/** esbuild options shared by every entry (exported for tests). */
export function buildOptions(root, outdir, entries) {
  return {
    absWorkingDir: root,
    entryPoints: Object.fromEntries(entries.map((e) => [e.out.replace(/\.mjs$/, ''), path.join(root, e.src)])),
    outdir,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    splitting: false,
    platform: 'node',
    target: 'node22',
    format: 'esm',
    packages: 'bundle',
    tsconfig: path.join(root, 'tsconfig.json'),
    mainFields: ['module', 'main'],
    conditions: ['node', 'import', 'default'],
    banner: { js: BANNER },
    sourcemap: 'linked',
    sourcesContent: false,
    keepNames: true,
    minify: false,
    legalComments: 'eof',
    metafile: true,
    logLevel: 'warning',
    plugins: [radarResolvePlugin(root)],
  };
}

function formatBytes(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`;
}

async function main() {
  const scriptRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2), { root: scriptRoot });
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}`);
    return 2;
  }
  if (opts.help) {
    process.stdout.write(USAGE);
    return 0;
  }

  const { present, missing } = resolveEntries(opts.root, opts.only);
  if (missing.length > 0) {
    if (!opts.allowMissing) {
      process.stderr.write(`${missingEntriesMessage(missing)}\n`);
      return 1;
    }
    for (const e of missing) {
      process.stderr.write(`build-worker: WARNING skipping missing entry ${e.name} (${e.src}) [--allow-missing]\n`);
    }
  }
  if (present.length === 0) {
    process.stderr.write('build-worker: nothing to build\n');
    return 1;
  }

  // Stale bundles from an older build must never ship: remove every selected output first
  // (with --only, the other bundles in the folder are left alone).
  const selected = opts.only ? ENTRIES.filter((e) => opts.only.includes(e.name)) : ENTRIES;
  for (const e of selected) {
    rmSync(path.join(opts.outdir, e.out), { force: true });
    rmSync(path.join(opts.outdir, `${e.out}.map`), { force: true });
  }
  mkdirSync(opts.outdir, { recursive: true });

  const { build } = await import('esbuild');
  const started = Date.now();
  const result = await build(buildOptions(opts.root, opts.outdir, present));

  const problems = checkMetafile(result.metafile);
  if (problems.length > 0) {
    process.stderr.write(`build-worker: bundle check failed:\n  - ${problems.join('\n  - ')}\n`);
    return 1;
  }

  for (const e of present) {
    const file = path.join(opts.outdir, e.out);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) {
      process.stderr.write(`build-worker: ${e.out} does not parse:\n${check.stderr}\n`);
      return 1;
    }
    process.stdout.write(`build-worker: ${path.relative(opts.root, file) || file}  ${formatBytes(statSync(file).size)}\n`);
  }
  process.stdout.write(`build-worker: ${present.length} bundle(s) in ${Date.now() - started} ms\n`);
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      // esbuild already printed located diagnostics; keep the summary short.
      process.stderr.write(`build-worker: failed: ${error instanceof Error ? error.message : String(error)}\n`);
      process.exitCode = 1;
    },
  );
}
