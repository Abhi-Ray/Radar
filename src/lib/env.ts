/**
 * The ONLY place in the app that reads `process.env` (NODE_ENV aside).
 *
 * - Parsing is lazy: nothing is validated at import time, so `next build` (which imports
 *   route modules without runtime env) keeps working. The first access validates and caches.
 * - Empty strings are treated as "unset" (docker-compose / .env files often carry `KEY=`).
 * - `getEnv()` validates everything (app + worker). `getEnvVar(key)` validates a single key,
 *   for tools that only need one value (e.g. the migrator only needs DATABASE_URL).
 */
import { z } from 'zod';
import { canonicalIp } from './security/ip';

const boolFromString = z
  .enum(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off'])
  .transform((v) => v === 'true' || v === '1' || v === 'yes' || v === 'on');

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const httpUrl = z
  .url()
  .refine((u) => /^https?:\/\//i.test(u), 'must be an http(s) URL');

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((u) => /^mysql:\/\//i.test(u), 'must be a mysql:// URL'),
  ADMIN_EMAIL: z.string().trim().toLowerCase().pipe(z.email()),
  ADMIN_PASSWORD_HASH: z
    .string()
    .regex(
      /^scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/,
      'must be scrypt:N:r:p:<salt b64url>:<key b64url> (see scripts/hash-password.ts)',
    ),
  SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  APP_URL: httpUrl.transform((u) => u.replace(/\/+$/, '')),
  APP_TZ: z.string().default('Asia/Kolkata').refine(isValidTimeZone, 'must be a valid IANA time zone'),
  OPENROUTER_API_KEY: z.string().optional(),
  OPENROUTER_MODEL: z.string().default('nvidia/nemotron-3-ultra-550b-a55b:free'),
  AI_ENABLED: boolFromString.default(false),
  AI_DAILY_LIMIT: z.coerce.number().int().min(0).max(1000).default(50),
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  SMTP_URL: z
    .string()
    .refine((u) => /^smtps?:\/\//i.test(u), 'must be an smtp:// or smtps:// URL')
    .optional(),
  ALERT_EMAIL_TO: z.email().optional(),
  HEALTHCHECK_PING_URL: httpUrl.optional(),
  /** Overrides the migrations folder (the Docker image ships them at /app/drizzle). */
  MIGRATIONS_DIR: z.string().optional(),
  /**
   * Extra addresses safeFetch must never contact, comma-separated IPv4/IPv6 — ops/install.sh
   * writes the VPS's own public addresses here. Parsed to canonical forms (see security/ip.ts).
   */
  SAFE_FETCH_DENY_IPS: z
    .string()
    .optional()
    .transform((raw, ctx) => {
      const out: string[] = [];
      const parts = (raw ?? '').split(',').map((p) => p.trim()).filter(Boolean);
      for (const [i, part] of parts.entries()) {
        const ip = canonicalIp(part);
        if (ip === null) {
          // Position only: never echo env values.
          ctx.addIssue({ code: 'custom', message: `entry ${i + 1} is not an IPv4/IPv6 address` });
          return z.NEVER;
        }
        if (!out.includes(ip)) out.push(ip);
      }
      return out;
    }),
});

export type Env = z.output<typeof envSchema>;
export type EnvKey = keyof Env;

function rawEnv(): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const key of Object.keys(envSchema.shape)) {
    const v = process.env[key];
    out[key] = v === undefined || v.trim() === '' ? undefined : v;
  }
  return out;
}

export class EnvError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvError';
  }
}

function formatIssues(error: z.ZodError): string[] {
  // Never echo values: they may be secrets. Only key + reason.
  return error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

let cached: Env | undefined;
const keyCache = new Map<EnvKey, unknown>();

/** Validated, typed environment. Throws EnvError (without values) on first access if invalid. */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(rawEnv());
  if (!parsed.success) throw new EnvError(formatIssues(parsed.error));
  cached = Object.freeze(parsed.data) as Env;
  return cached;
}

/** Validate and return a single key without requiring the rest of the env to be present. */
export function getEnvVar<K extends EnvKey>(key: K): Env[K] {
  if (cached) return cached[key];
  if (keyCache.has(key)) return keyCache.get(key) as Env[K];
  const schema = envSchema.shape[key] as unknown as z.ZodType<Env[K]>;
  const raw = rawEnv()[key];
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new EnvError(parsed.error.issues.map((i) => `${String(key)}: ${i.message}`));
  }
  keyCache.set(key, parsed.data);
  return parsed.data;
}

/** Lazy typed accessor: `env.APP_URL`. Each property access goes through `getEnv()`. */
export const env: Env = new Proxy({} as Env, {
  get(_target, prop) {
    if (typeof prop !== 'string') return undefined;
    return getEnv()[prop as EnvKey];
  },
  has(_target, prop) {
    return typeof prop === 'string' && prop in envSchema.shape;
  },
  ownKeys() {
    return Object.keys(envSchema.shape);
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop !== 'string' || !(prop in envSchema.shape)) return undefined;
    return { enumerable: true, configurable: true, value: getEnv()[prop as EnvKey] };
  },
});

export function isProduction(): boolean {
  return getEnvVar('NODE_ENV') === 'production';
}

/** True when the public URL is https (production behind TLS) → Secure cookies, HSTS. */
export function isHttpsApp(): boolean {
  return getEnvVar('APP_URL').startsWith('https://');
}

/** AI can only run when enabled by env AND a key is configured. The `ai` setting can further disable it. */
export function aiEnvAvailable(): boolean {
  return getEnvVar('AI_ENABLED') && Boolean(getEnvVar('OPENROUTER_API_KEY'));
}

/** Test-only: drop the cache so a test can change process.env and re-parse. */
export function resetEnvCacheForTests(): void {
  cached = undefined;
  keyCache.clear();
}
