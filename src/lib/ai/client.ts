/**
 * OpenRouter chat-completions client (spec §15).
 *
 * The model (default nvidia/nemotron-3-ultra-550b-a55b:free) supports only include_reasoning,
 * max_tokens, reasoning, reasoning_effort, seed, temperature, tool_choice, tools and top_p — there
 * is NO response_format. Structured output therefore uses ONE function tool whose parameters are
 * the task's JSON schema, with tool_choice forcing that function. If a model answers in plain
 * content instead, the first JSON object in the content is used. Either way the caller validates
 * with zod; this module only transports.
 *
 * Budget: every attempt reserves one call atomically BEFORE it is sent (budget.ts). A network
 * error is retried at most once — and that retry is a new reservation. Every attempt is logged in
 * ai_calls (never the prompt, never the key).
 */
import { aiCalls } from '../../db/schema';
import type { DbOrTx } from '../db';
import { log, redactString } from '../log';
import { reserveAiCall, type ReserveResult } from './budget';
import {
  AI_REASONING_EFFORT,
  AI_SEED,
  AI_TEMPERATURE,
  AI_TIMEOUT_MS,
  AI_TOP_P,
  MAX_NETWORK_RETRIES,
  OPENROUTER_CHAT_URL,
  aiApiKey,
  appUrl,
} from './config';
import type { JsonSchema } from './prompts/schema';
import { AiNetworkError, resolveAiFetch, type AiFetch } from './transport';

export { AiNetworkError, resolveAiFetch, setAiFetchForTests, type AiFetch } from './transport';

const alog = log.child({ module: 'ai' });

export class AiHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'AiHttpError';
  }
}

export interface ChatTool {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface ChatRequest {
  model: string;
  system: string;
  user: string;
  tool: ChatTool;
  maxTokens: number;
  /** 'force' (default) = tool_choice names the function; 'auto' lets the model choose. */
  toolChoice?: 'force' | 'auto';
}

export interface ChatResult {
  /** Parsed tool arguments (or JSON object from content); null when neither was usable. */
  args: unknown;
  via: 'tool' | 'content' | null;
  /** The model called the forced function (tool_choice honoured). */
  toolCalled: boolean;
  /** The response carried reasoning text despite exclude:true. */
  reasoningReturned: boolean;
  finishReason: string | null;
  tokensIn: number | null;
  tokensOut: number | null;
  latencyMs: number;
  /** Model id reported by OpenRouter. */
  model: string | null;
  /** Why args is null (for the ai_calls log). */
  parseError: string | null;
}

/** The request body (exported for tests: only parameters the model supports). */
export function chatBody(req: ChatRequest): Record<string, unknown> {
  return {
    model: req.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    tools: [{ type: 'function', function: { name: req.tool.name, description: req.tool.description, parameters: req.tool.parameters } }],
    tool_choice: req.toolChoice === 'auto' ? 'auto' : { type: 'function', function: { name: req.tool.name } },
    temperature: AI_TEMPERATURE,
    top_p: AI_TOP_P,
    seed: AI_SEED,
    max_tokens: Math.max(64, Math.min(16_384, Math.round(req.maxTokens))),
    reasoning: { effort: AI_REASONING_EFFORT, exclude: true },
  };
}

function capError(s: string, max = 500): string {
  const t = redactString(s.replace(/\s+/g, ' ').trim());
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/**
 * First balanced JSON object in a text (```json fences, prose around it and a
 * {"name":…,"arguments":{…}} wrapper are tolerated). Null when there is none.
 */
export function extractJsonObject(content: string): unknown {
  if (typeof content !== 'string') return null;
  const s = content.replace(/```(?:json)?/gi, '');
  for (let start = s.indexOf('{'); start >= 0; start = s.indexOf('{', start + 1)) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = start; i < s.length; i++) {
      const c = s[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === '\\') esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') inStr = true;
      else if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try {
            return unwrapArgs(JSON.parse(s.slice(start, i + 1)));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function unwrapArgs(v: unknown): unknown {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const o = v as Record<string, unknown>;
    if (!('results' in o) && 'arguments' in o) {
      const a = o.arguments;
      if (typeof a === 'string') {
        try {
          return JSON.parse(a) as unknown;
        } catch {
          return null;
        }
      }
      return a;
    }
    if (!('results' in o) && 'parameters' in o && typeof o.parameters === 'object') return o.parameters;
  }
  return v;
}

function numOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;
}

/** Parses an OpenRouter chat-completions JSON body. Throws AiHttpError for error payloads. */
export function parseChatResponse(body: unknown, toolName: string, latencyMs: number): ChatResult {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const err = b.error as { code?: unknown; message?: unknown } | undefined;
  if (err && typeof err === 'object') {
    const code = typeof err.code === 'number' ? err.code : 502;
    throw new AiHttpError(code, capError(String(err.message ?? 'provider error')), code >= 500 || code === 408);
  }
  const choice = Array.isArray(b.choices) ? (b.choices[0] as Record<string, unknown> | undefined) : undefined;
  const msg = (choice?.message ?? {}) as Record<string, unknown>;
  const usage = (b.usage ?? {}) as Record<string, unknown>;
  const reasoning = msg.reasoning;
  const reasoningDetails = msg.reasoning_details;
  const base = {
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : null,
    tokensIn: numOrNull(usage.prompt_tokens),
    tokensOut: numOrNull(usage.completion_tokens),
    latencyMs,
    model: typeof b.model === 'string' ? b.model.slice(0, 128) : null,
    reasoningReturned: (typeof reasoning === 'string' && reasoning.trim().length > 0) || (Array.isArray(reasoningDetails) && reasoningDetails.length > 0),
  };

  const calls = Array.isArray(msg.tool_calls) ? (msg.tool_calls as Record<string, unknown>[]) : [];
  const fnOf = (c: Record<string, unknown>) => (c.function ?? {}) as Record<string, unknown>;
  const call = calls.find((c) => fnOf(c).name === toolName) ?? calls[0];
  if (call) {
    const fn = fnOf(call);
    const raw = fn.arguments;
    let args: unknown = null;
    let parseError: string | null = null;
    if (typeof raw === 'string') {
      try {
        args = JSON.parse(raw) as unknown;
      } catch {
        args = extractJsonObject(raw);
        if (args === null) parseError = 'tool arguments are not valid JSON';
      }
    } else if (raw && typeof raw === 'object') {
      args = raw;
    } else {
      parseError = 'tool call without arguments';
    }
    return { ...base, args, via: args === null ? null : 'tool', toolCalled: fn.name === toolName, parseError };
  }

  const content = typeof msg.content === 'string' ? msg.content : '';
  const fromContent = extractJsonObject(content);
  return {
    ...base,
    args: fromContent,
    via: fromContent === null ? null : 'content',
    toolCalled: false,
    parseError: fromContent === null ? (content.trim() ? 'no JSON object in the answer' : 'empty answer') : null,
  };
}

/** One HTTP attempt (no retry, no budget). */
export async function sendChat(req: ChatRequest, opts: { fetch?: AiFetch | null; timeoutMs?: number } = {}): Promise<ChatResult> {
  const key = aiApiKey();
  if (!key) throw new AiHttpError(401, 'no OpenRouter API key configured', false);
  const doFetch = resolveAiFetch(opts.fetch);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? AI_TIMEOUT_MS);
  const started = Date.now();
  let res: Response;
  try {
    res = await doFetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': appUrl(),
        'X-Title': 'RADAR',
      },
      body: JSON.stringify(chatBody(req)),
      signal: controller.signal,
      redirect: 'error',
    });
  } catch (err) {
    const aborted = controller.signal.aborted;
    throw new AiNetworkError(aborted ? `timed out after ${opts.timeoutMs ?? AI_TIMEOUT_MS} ms` : capError(err instanceof Error ? err.message : String(err)));
  } finally {
    clearTimeout(timer);
  }
  const latencyMs = Date.now() - started;
  let body: unknown = null;
  let text = '';
  try {
    text = await res.text();
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = null;
  }
  if (!res.ok) {
    const m = (body as { error?: { message?: unknown } } | null)?.error?.message;
    const retryable = res.status >= 500 || res.status === 408;
    throw new AiHttpError(res.status, capError(`HTTP ${res.status}: ${typeof m === 'string' ? m : text.slice(0, 200)}`), retryable);
  }
  if (body === null) throw new AiHttpError(502, 'response is not JSON', true);
  return parseChatResponse(body, req.tool.name, latencyMs);
}

export interface AiCallLogRow {
  task: string;
  model: string;
  promptVersion: string;
  jobIds: number[];
  status: 'ok' | 'invalid' | 'error' | 'budget';
  latencyMs?: number | null;
  tokensIn?: number | null;
  tokensOut?: number | null;
  rejectedCount?: number | null;
  error?: string | null;
}

/** ai_calls row (never throws: logging must not break the pipeline). */
export async function logAiCall(db: DbOrTx, row: AiCallLogRow): Promise<void> {
  try {
    await db.insert(aiCalls).values({
      task: row.task.slice(0, 64),
      model: row.model.slice(0, 128),
      promptVersion: row.promptVersion.slice(0, 64),
      jobIdsJson: row.jobIds.slice(0, 50),
      status: row.status,
      latencyMs: row.latencyMs ?? null,
      tokensIn: row.tokensIn ?? null,
      tokensOut: row.tokensOut ?? null,
      rejectedCount: row.rejectedCount ?? null,
      error: row.error ? capError(row.error, 2000) : null,
    });
  } catch (err) {
    alog.warn('ai_calls insert failed', { error: err instanceof Error ? err.message : String(err) });
  }
}

export interface CallAiInput {
  task: string;
  promptVersion: string;
  jobIds: number[];
  request: ChatRequest;
  /** Manual (UI) calls may use the reserve kept for them. */
  manual?: boolean;
  fetch?: AiFetch | null;
  now?: Date;
  /** Attempts allowed for this call (1 + retries), capped at 1 + MAX_NETWORK_RETRIES. */
  maxAttempts?: number;
  timeoutMs?: number;
}

export type CallAiOutcome =
  | { ok: true; result: ChatResult; attempts: number }
  | { ok: false; reason: 'budget' | 'disabled'; reserve: ReserveResult; attempts: number; message: string }
  | { ok: false; reason: 'auth' | 'rate_limited' | 'error'; attempts: number; message: string; status: number | null };

/**
 * Reserve → send → (on a network error, once more: reserve → send). Every attempt is counted
 * and every failed attempt is logged; the successful attempt is logged by the caller once the
 * answer has been validated (status ok/invalid + rejected count).
 */
export async function callAi(db: DbOrTx, input: CallAiInput): Promise<CallAiOutcome> {
  const maxAttempts = Math.max(1, Math.min(1 + MAX_NETWORK_RETRIES, input.maxAttempts ?? 1 + MAX_NETWORK_RETRIES));
  const logBase = { task: input.task, model: input.request.model, promptVersion: input.promptVersion, jobIds: input.jobIds };
  let attempts = 0;
  for (;;) {
    const reserve = await reserveAiCall(db, { manual: input.manual, now: input.now });
    if (!reserve.ok) {
      await logAiCall(db, { ...logBase, status: 'budget', error: reserve.reason === 'disabled' ? 'AI disabled' : `budget: ${reserve.used}/${reserve.limit}` });
      return {
        ok: false,
        reason: reserve.reason,
        reserve,
        attempts,
        message: reserve.reason === 'disabled' ? 'AI is switched off.' : `Today's AI budget is used up (${reserve.used}/${reserve.limit}).`,
      };
    }
    attempts++;
    try {
      const result = await sendChat(input.request, { fetch: input.fetch, timeoutMs: input.timeoutMs });
      return { ok: true, result, attempts };
    } catch (err) {
      const network = err instanceof AiNetworkError || (err instanceof AiHttpError && err.retryable);
      const status = err instanceof AiHttpError ? err.status : null;
      const message = err instanceof Error ? err.message : String(err);
      await logAiCall(db, { ...logBase, status: 'error', error: message });
      alog.warn('ai call failed', { task: input.task, attempt: attempts, status, error: message });
      if (network && attempts < maxAttempts) continue;
      if (status === 401 || status === 403) return { ok: false, reason: 'auth', attempts, message, status };
      if (status === 429) return { ok: false, reason: 'rate_limited', attempts, message, status };
      return { ok: false, reason: 'error', attempts, message, status };
    }
  }
}
