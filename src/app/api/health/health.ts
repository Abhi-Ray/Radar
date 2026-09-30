/**
 * Health probe logic for GET /api/health (kept out of route.ts so it can be unit-tested and so
 * the route module only exports HTTP handlers + route config).
 *
 * The endpoint is PUBLIC (no login — Docker's HEALTHCHECK, uptime monitors). It therefore returns
 * only coarse facts: whether the database answers, how old the last completed pipeline run is,
 * and the deployed git revision. Never error messages, hostnames, counts or configuration.
 */
import 'server-only';
import type { Pool } from 'mysql2/promise';
import { log } from '@/lib/log';

export interface HealthPayload {
  /** true ⇔ the database answered within the timeout. */
  ok: boolean;
  db: 'up' | 'down';
  /** Hours since the last completed (ok/partial, non-dry) daily or manual pipeline run; null = none yet / unknown. */
  lastRunAgeHours: number | null;
  /** Deployed revision (GIT_SHA build arg), sanitised; null when not set. */
  version: string | null;
}

/** Budget for the whole database probe (connection + query). */
export const DB_TIMEOUT_MS = 2_000;

/** One cheap indexed-or-small query: pipeline_runs holds a few rows per day. */
export const LAST_RUN_SQL =
  "SELECT MAX(finished_at) AS last_finished FROM pipeline_runs " +
  "WHERE dry_run = 0 AND status IN ('ok','partial') AND kind IN ('daily','manual')";

const VERSION_RE = /^[0-9A-Za-z._-]{1,40}$/;

/**
 * Accepts only short, harmless revision strings (a git SHA, a tag like v1.2.3). Anything else is
 * dropped rather than echoed back on a public endpoint.
 */
export function sanitizeVersion(raw: string | undefined | null): string | null {
  if (raw === undefined || raw === null) return null;
  const v = raw.trim();
  if (v === '' || v === 'unknown') return null;
  return VERSION_RE.test(v) ? v : null;
}

/** Whole hours are too coarse for "ran 20 minutes ago": one decimal. Never negative (clock skew). */
export function ageHours(last: Date | null, now: Date): number | null {
  if (!last || Number.isNaN(last.getTime())) return null;
  const hours = (now.getTime() - last.getTime()) / 3_600_000;
  return Math.max(0, Math.round(hours * 10) / 10);
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`timed out after ${ms} ms`);
    this.name = 'TimeoutError';
  }
}

/** Rejects with TimeoutError if `promise` has not settled within `ms`. The timer never keeps the process alive. */
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
    timer.unref?.();
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return error instanceof Error ? error.name : 'UNKNOWN';
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string' || typeof value === 'number') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export interface HealthDeps {
  /** Lazily returns the process-wide pool (not called until the probe runs). */
  pool: () => Pick<Pool, 'query'>;
  now?: () => Date;
  version?: string | null;
  timeoutMs?: number;
  /** Receives probe failures (rate-limited logging lives in the caller). */
  onError?: (code: string) => void;
}

/**
 * Probes the database. A missing pipeline_runs table (fresh DB mid-migration) still counts as
 * "db up" with an unknown last run; any other failure or a timeout is "db down".
 */
export async function getHealth(deps: HealthDeps): Promise<HealthPayload> {
  const now = deps.now ?? (() => new Date());
  const timeoutMs = deps.timeoutMs ?? DB_TIMEOUT_MS;
  const version = deps.version ?? null;
  try {
    const run = async () => {
      const [rows] = await deps.pool().query({ sql: LAST_RUN_SQL, timeout: timeoutMs });
      return rows as Array<{ last_finished: unknown }>;
    };
    const rows = await withTimeout(run(), timeoutMs);
    const last = toDate(rows[0]?.last_finished);
    return { ok: true, db: 'up', lastRunAgeHours: ageHours(last, now()), version };
  } catch (error) {
    const code = errorCode(error);
    if (code === 'ER_NO_SUCH_TABLE') return { ok: true, db: 'up', lastRunAgeHours: null, version };
    deps.onError?.(code);
    return { ok: false, db: 'down', lastRunAgeHours: null, version };
  }
}

/** Logs a probe failure at most once per `intervalMs` (Docker probes every 30 s; don't flood). */
export function rateLimitedWarn(intervalMs = 60_000, clock: () => number = Date.now): (code: string) => void {
  let lastAt = -Infinity;
  let suppressed = 0;
  return (code: string) => {
    const t = clock();
    if (t - lastAt < intervalMs) {
      suppressed += 1;
      return;
    }
    log.warn('health: database probe failed', { code, suppressedSinceLast: suppressed });
    lastAt = t;
    suppressed = 0;
  };
}

/**
 * The deployed revision. Read here directly because it is build metadata baked into the image
 * (Dockerfile `ARG/ENV GIT_SHA`), not application configuration validated by src/lib/env.ts.
 */
export function deployedVersion(): string | null {
  return sanitizeVersion(process.env.GIT_SHA);
}
