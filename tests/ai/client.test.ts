/**
 * OpenRouter client: only the parameters the model supports (no response_format), one forced
 * function tool, content-JSON fallback, headers, and no real network under test.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiHttpError,
  AiNetworkError,
  chatBody,
  extractJsonObject,
  parseChatResponse,
  resolveAiFetch,
  sendChat,
  type ChatRequest,
} from '../../src/lib/ai/client';
import { AI_SEED, OPENROUTER_CHAT_URL } from '../../src/lib/ai/config';
import { resetEnvCacheForTests } from '../../src/lib/env';

const REQ: ChatRequest = {
  model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  system: 'sys',
  user: 'usr',
  maxTokens: 2000,
  tool: { name: 'report_job_facts', description: 'd', parameters: { type: 'object' } },
};

const saved = { ...process.env };
beforeEach(() => {
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.APP_URL = 'https://radar.example.test';
  resetEnvCacheForTests();
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCacheForTests();
});

describe('chatBody', () => {
  it('uses only supported parameters and forces the function', () => {
    const body = chatBody(REQ);
    const supported = ['include_reasoning', 'max_tokens', 'reasoning', 'reasoning_effort', 'seed', 'temperature', 'tool_choice', 'tools', 'top_p'];
    for (const k of Object.keys(body)) expect(['model', 'messages', ...supported]).toContain(k);
    expect(body).not.toHaveProperty('response_format');
    expect(body.tool_choice).toEqual({ type: 'function', function: { name: 'report_job_facts' } });
    expect(body.temperature).toBe(0);
    expect(body.seed).toBe(AI_SEED);
    expect(body.reasoning).toEqual({ effort: 'low', exclude: true });
    expect(body.max_tokens).toBe(2000);
    expect((body.tools as unknown[]).length).toBe(1);
  });
});

describe('parseChatResponse', () => {
  it('reads the forced tool call arguments', () => {
    const r = parseChatResponse(
      {
        model: 'nvidia/x',
        choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: 'report_job_facts', arguments: '{"results":[]}' } }] } }],
        usage: { prompt_tokens: 100, completion_tokens: 20 },
      },
      'report_job_facts',
      42,
    );
    expect(r.args).toEqual({ results: [] });
    expect(r.via).toBe('tool');
    expect(r.toolCalled).toBe(true);
    expect(r.tokensIn).toBe(100);
    expect(r.reasoningReturned).toBe(false);
  });

  it('falls back to a JSON object in the content', () => {
    const r = parseChatResponse(
      { choices: [{ message: { content: 'Here you go:\n```json\n{"results":[{"id":"j1"}]}\n```', reasoning: 'thinking…' } }] },
      'report_job_facts',
      1,
    );
    expect(r.via).toBe('content');
    expect(r.toolCalled).toBe(false);
    expect(r.args).toEqual({ results: [{ id: 'j1' }] });
    expect(r.reasoningReturned).toBe(true);
  });

  it('prose without JSON gives no args (and a reason)', () => {
    const r = parseChatResponse({ choices: [{ message: { content: 'I cannot help with that.' } }] }, 't', 1);
    expect(r.args).toBeNull();
    expect(r.parseError).toMatch(/no JSON/);
  });

  it('provider errors become AiHttpError', () => {
    expect(() => parseChatResponse({ error: { code: 429, message: 'rate limited' } }, 't', 1)).toThrow(AiHttpError);
  });

  it('extractJsonObject unwraps {name, arguments} and skips broken objects', () => {
    expect(extractJsonObject('{"name":"f","arguments":"{\\"results\\":[1]}"}')).toEqual({ results: [1] });
    expect(extractJsonObject('nothing here')).toBeNull();
    expect(extractJsonObject('{"a": "}"} tail')).toEqual({ a: '}' });
  });
});

describe('sendChat', () => {
  it('posts to OpenRouter with the right headers and never leaks the key into the body', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const fetch = async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ choices: [{ message: { tool_calls: [{ function: { name: 'report_job_facts', arguments: '{"results":[]}' } }] } }] }), { status: 200 });
    };
    const r = await sendChat(REQ, { fetch });
    expect(r.toolCalled).toBe(true);
    expect(seen!.url).toBe(OPENROUTER_CHAT_URL);
    const h = seen!.init.headers as Record<string, string>;
    expect(h.Authorization).toBe('Bearer test-key-not-real');
    expect(h['HTTP-Referer']).toBe('https://radar.example.test');
    expect(h['X-Title']).toBe('RADAR');
    expect(String(seen!.init.body)).not.toContain('test-key-not-real');
  });

  it('HTTP errors: 5xx retryable, 4xx not', async () => {
    const f = (status: number) => async () => new Response('{"error":{"message":"nope"}}', { status });
    await expect(sendChat(REQ, { fetch: f(503) })).rejects.toMatchObject({ status: 503, retryable: true });
    await expect(sendChat(REQ, { fetch: f(401) })).rejects.toMatchObject({ status: 401, retryable: false });
  });

  it('a timeout is a network error', async () => {
    const fetch = (_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    await expect(sendChat(REQ, { fetch, timeoutMs: 20 })).rejects.toBeInstanceOf(AiNetworkError);
  });

  it('without a key nothing is sent', async () => {
    delete process.env.OPENROUTER_API_KEY;
    resetEnvCacheForTests();
    let called = false;
    await expect(
      sendChat(REQ, {
        fetch: async () => {
          called = true;
          return new Response('{}');
        },
      }),
    ).rejects.toMatchObject({ status: 401 });
    expect(called).toBe(false);
  });

  it('under NODE_ENV=test the default transport refuses the real network', async () => {
    await expect(resolveAiFetch()('https://openrouter.ai/api/v1/key', {})).rejects.toBeInstanceOf(AiNetworkError);
  });
});
