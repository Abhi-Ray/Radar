/**
 * The HTTP transport of the AI layer. The OpenRouter endpoints are fixed constants (config.ts),
 * never derived from data, so this is a plain fetch — not the SSRF-guarded safeFetch (which only
 * does GET/HEAD for scraped URLs).
 *
 * Under NODE_ENV=test the real network is refused unless a mock was injected, so a test run can
 * never spend real budget, even with a real key in the environment.
 */

export type AiFetch = (url: string, init: RequestInit) => Promise<Response>;

export class AiNetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiNetworkError';
  }
}

let fetchOverride: AiFetch | null = null;

/** Test hook: route every AI HTTP request through `fn` (null = back to the default). */
export function setAiFetchForTests(fn: AiFetch | null): void {
  fetchOverride = fn;
}

export function resolveAiFetch(explicit?: AiFetch | null): AiFetch {
  if (explicit) return explicit;
  if (fetchOverride) return fetchOverride;
  if (process.env.NODE_ENV === 'test') {
    return async () => {
      throw new AiNetworkError('real AI calls are disabled under NODE_ENV=test (inject a fetch mock)');
    };
  }
  return (url, init) => globalThis.fetch(url, init);
}
