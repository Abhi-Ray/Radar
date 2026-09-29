/**
 * JSON-lines logger. One line per event: {...fields,"ts","level","msg"} (reserved keys win).
 * - info/debug → stdout, warn/error → stderr.
 * - Field keys matching SECRET_KEY_RE are replaced with "[REDACTED]" (recursively); a short
 *   allowlist of identifier fields (factKey, platformKey, dedupeKey, …) stays readable.
 * - String values are scrubbed for obvious secret shapes (API keys, JWTs, scrypt hashes,
 *   passwords inside connection URLs) so an error message can't leak them either.
 * - debug is suppressed in production; info/debug are suppressed under NODE_ENV=test to keep
 *   test output readable (warn/error still print).
 * Deliberately does NOT import env.ts: it must work while the env is invalid.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type LogFields = Record<string, unknown>;

export const SECRET_KEY_RE = /secret|password|passwd|key|token|authorization|cookie/i;
/** Identifier-style "...Key" fields that are never secrets (kept readable in logs). */
const SAFE_KEY_RE = /^(fact|platform|source|dedupe|cache|role|register|setting|settings|entity|task|lock|run|country|route)_?keys?$/i;

export function isSecretKey(key: string): boolean {
  return SECRET_KEY_RE.test(key) && !SAFE_KEY_RE.test(key);
}
const REDACTED = '[REDACTED]';
const MAX_DEPTH = 6;
const MAX_STRING = 4000;

const VALUE_PATTERNS: [RegExp, string | ((m: string, ...g: string[]) => string)][] = [
  [/sk-or-v1-[A-Za-z0-9]{16,}/g, 'sk-or-v1-' + REDACTED],
  [/\bsk-[A-Za-z0-9_-]{20,}/g, 'sk-' + REDACTED],
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, '[JWT ' + REDACTED + ']'],
  [/scrypt:\d+:\d+:\d+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+/g, 'scrypt:' + REDACTED],
  // user:password@host inside URLs (mysql://, smtp://, https://)
  [/([a-z][a-z0-9+.-]*:\/\/[^\s:/@]+):[^\s@/]+@/gi, (_m, pre: string) => `${pre}:${REDACTED}@`],
  [/(\bbot)\d{6,}:[A-Za-z0-9_-]{20,}/g, (_m, pre: string) => `${pre}${REDACTED}`],
];

export function redactString(value: string): string {
  let out = value;
  for (const [re, rep] of VALUE_PATTERNS) {
    out = typeof rep === 'string' ? out.replace(re, rep) : out.replace(re, rep as (m: string) => string);
  }
  return out.length > MAX_STRING ? `${out.slice(0, MAX_STRING)}…[truncated ${out.length - MAX_STRING}]` : out;
}

function serializeError(err: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: redactString(err.message),
  };
  if (err.stack) out.stack = redactString(err.stack);
  const code = (err as { code?: unknown }).code;
  if (code !== undefined) out.code = code;
  if (err.cause !== undefined && depth < MAX_DEPTH) out.cause = redact(err.cause, depth + 1, seen);
  return out;
}

/** Deep-copies `value` with secret-looking keys and values redacted. Handles cycles. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Depth]';
  seen.add(value);
  if (value instanceof Error) return serializeError(value, depth, seen);
  if (Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1, seen));
  if (value instanceof Map) return redact(Object.fromEntries(value), depth, seen);
  if (value instanceof Set) return redact([...value], depth, seen);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSecretKey(k) && v !== null && v !== undefined && v !== '' ? REDACTED : redact(v, depth + 1, seen);
  }
  return out;
}

const nodeEnv = (): string | undefined => process.env.NODE_ENV;

function enabled(level: LogLevel): boolean {
  const e = nodeEnv();
  if (level === 'debug') return e !== 'production' && e !== 'test';
  if (level === 'info') return e !== 'test';
  return true;
}

function write(level: LogLevel, msg: string, fields?: LogFields, base?: LogFields): void {
  if (!enabled(level)) return;
  // Reserved keys last: a field named ts/level/msg can never overwrite them.
  const record: Record<string, unknown> = {
    ...(base ? (redact(base) as Record<string, unknown>) : {}),
    ...(fields ? (redact(fields) as Record<string, unknown>) : {}),
    ts: new Date().toISOString(),
    level,
    msg: redactString(msg),
  };
  let line: string;
  try {
    line = JSON.stringify(record);
  } catch {
    line = JSON.stringify({ ts: record.ts, level, msg: record.msg, note: 'unserializable fields' });
  }
  if (level === 'warn' || level === 'error') process.stderr.write(line + '\n');
  else process.stdout.write(line + '\n');
}

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  /** Logger that adds `fields` to every line (e.g. {module:'pipeline', runId}). */
  child(fields: LogFields): Logger;
}

function makeLogger(base?: LogFields): Logger {
  return {
    debug: (m, f) => write('debug', m, f, base),
    info: (m, f) => write('info', m, f, base),
    warn: (m, f) => write('warn', m, f, base),
    error: (m, f) => write('error', m, f, base),
    child: (f) => makeLogger({ ...(base ?? {}), ...f }),
  };
}

export const log: Logger = makeLogger();
