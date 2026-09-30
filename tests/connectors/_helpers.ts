/**
 * Offline helpers for connector tests: fixture loading, a fake source row and a scripted
 * PoliteHttp that serves fixtures by URL pattern and records every request.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { PoliteHttp } from '../../src/lib/contracts/connectors';
import type { RawItem } from '../../src/lib/contracts/jobs';
import type { SourceRow } from '../../src/db/schema';
import { HttpStatusError } from '../../src/lib/http/polite';
import type { PipelineFetchContext } from '../../src/lib/connectors/types';

const FIXTURES = path.resolve(__dirname, '../fixtures/connectors');

export function fixtureText(key: string, file: string): string {
  return readFileSync(path.join(FIXTURES, key, file), 'utf8');
}

export function fixtureJson<T = unknown>(key: string, file: string): T {
  return JSON.parse(fixtureText(key, file)) as T;
}

export function fakeSource(platformKey: string, configJson: Record<string, unknown>, over: Partial<SourceRow> = {}): SourceRow {
  const now = new Date('2026-09-30T00:00:00Z');
  return {
    id: 7,
    sourceKey: `${platformKey}:test`,
    platformKey,
    configJson,
    label: `${platformKey} test`,
    countryIso2: null,
    companyId: null,
    status: 'live',
    checklistJson: null,
    baselineJson: null,
    consecutiveFailures: 0,
    circuitOpenUntil: null,
    lastRunAt: null,
    lastSuccessAt: null,
    notes: null,
    createdAt: now,
    updatedAt: now,
    ...over,
  } as SourceRow;
}

export type RouteBody = unknown | ((url: string, init: RequestInit | undefined) => unknown);

export interface Route {
  match: RegExp;
  body?: RouteBody;
  /** Non-2xx → HttpStatusError, like PoliteHttp. */
  status?: number;
  /** Raw text instead of JSON (getText). */
  text?: string;
}

export interface RecordedCall {
  url: string;
  headers: Record<string, string>;
}

export class FakeHttp implements PoliteHttp {
  readonly calls: RecordedCall[] = [];
  constructor(private readonly routes: Route[]) {}

  private route(url: string, init?: RequestInit): Route {
    const headers: Record<string, string> = {};
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v));
    this.calls.push({ url, headers });
    const r = this.routes.find((x) => x.match.test(url));
    if (!r) throw new Error(`FakeHttp: unexpected request ${url}`);
    if (r.status && (r.status < 200 || r.status > 299)) throw new HttpStatusError(url, r.status, '');
    return r;
  }

  async getJson<T>(url: string, init?: RequestInit): Promise<T> {
    const r = this.route(url, init);
    const body = typeof r.body === 'function' ? (r.body as (u: string, i?: RequestInit) => unknown)(url, init) : r.body;
    return (r.text !== undefined ? JSON.parse(r.text) : structuredClone(body)) as T;
  }

  async getText(url: string, init?: RequestInit): Promise<string> {
    const r = this.route(url, init);
    if (r.text !== undefined) return r.text;
    const body = typeof r.body === 'function' ? (r.body as (u: string, i?: RequestInit) => unknown)(url, init) : r.body;
    return typeof body === 'string' ? body : JSON.stringify(body);
  }
}

export interface TestFetchContext extends PipelineFetchContext {
  logs: string[];
  partial: string[];
}

export function fetchCtx(source: SourceRow, http: PoliteHttp, known?: Iterable<string>): TestFetchContext {
  const logs: string[] = [];
  const partial: string[] = [];
  return {
    source,
    http,
    signal: new AbortController().signal,
    log: (m) => logs.push(m),
    knownExternalIds: known ? new Set(known) : undefined,
    markListingPartial: (r) => partial.push(r),
    logs,
    partial,
  };
}

export function raw(externalId: string, payload: unknown): RawItem {
  return { externalId, payload, fetchedAt: new Date('2026-09-30T00:00:00Z') };
}
