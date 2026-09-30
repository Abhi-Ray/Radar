/**
 * AI layer constants and runtime switches (spec §15). The AI is an upgrade, never a dependency:
 * every reader here fails closed (AI off) when the env is missing or invalid.
 */
import { getEnvVar } from '../env';

/** Fixed endpoints (constants, never derived from data). */
export const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
export const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

export const DEFAULT_AI_MODEL = 'nvidia/nemotron-3-ultra-550b-a55b:free';

/** Free-tier ceiling: whatever the settings say, never more than this per UTC day. */
export const HARD_DAILY_CAP = 50;

/** Per-attempt timeout of one chat completion. */
export const AI_TIMEOUT_MS = 120_000;
/** Timeout of the (free) budget sync GET. */
export const AI_KEY_SYNC_TIMEOUT_MS = 15_000;

/** Low-creativity settings (spec §15.4). */
export const AI_TEMPERATURE = 0;
export const AI_TOP_P = 1;
export const AI_SEED = 20260930;
export const AI_REASONING_EFFORT = 'low' as const;

/** Posting text is capped per job before it is sent. */
export const MAX_JOB_CHARS = 6000;
/** Jobs per call (3–5 keeps one call small enough to validate and cheap enough to retry). */
export const MAX_BATCH = 5;

/** A network error is retried at most once; every attempt counts against the budget. */
export const MAX_NETWORK_RETRIES = 1;

/** Queue item attempts before it is marked failed. */
export const MAX_QUEUE_ATTEMPTS = 3;

/** AI facts are never more than this sure of themselves. */
export const AI_MAX_CONFIDENCE = 'medium' as const;

/** Top-fit threshold for automatic summaries / red flags (fit score 0–100). */
export const TOP_FIT_SCORE = 75;
/** New automatic summary tasks planned per queue run (the rest wait). */
export const MAX_AUTO_SUMMARIES_PER_RUN = 8;
/** Suspicious checks are only planned for jobs at least this relevant. */
export const SUSPICIOUS_MIN_SCORE = 40;
export const MAX_AUTO_SUSPICIOUS_PER_RUN = 8;

function safeEnv<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}

export function aiModel(): string {
  const m = safeEnv(() => getEnvVar('OPENROUTER_MODEL'), DEFAULT_AI_MODEL);
  return typeof m === 'string' && m.trim() ? m.trim().slice(0, 128) : DEFAULT_AI_MODEL;
}

/** Fact `source` of every AI fact: `openrouter:<model>`. */
export function aiSource(model: string = aiModel()): string {
  return `openrouter:${model}`.slice(0, 191);
}

/** The API key, or null (never logged, never returned to a client). */
export function aiApiKey(): string | null {
  const k = safeEnv(() => getEnvVar('OPENROUTER_API_KEY'), undefined as string | undefined);
  return typeof k === 'string' && k.trim() ? k.trim() : null;
}

/** AI_ENABLED=true and a key is configured. The `ai` setting can switch it off on top. */
export function aiEnvEnabled(): boolean {
  return safeEnv(() => getEnvVar('AI_ENABLED'), false) === true && aiApiKey() !== null;
}

export function envDailyLimit(): number {
  const n = safeEnv(() => getEnvVar('AI_DAILY_LIMIT'), HARD_DAILY_CAP);
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.floor(n)) : HARD_DAILY_CAP;
}

export function appUrl(): string {
  return safeEnv(() => getEnvVar('APP_URL'), 'http://localhost');
}
