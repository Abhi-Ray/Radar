/**
 * Offline harness for pipeline DB tests: scripted fake connectors (no network), seeding helpers
 * and a fixed, steppable clock.
 */
import { count, eq } from 'drizzle-orm';
import { z } from 'zod';
import * as schema from '../../src/db/schema';
import { sourcePlatforms, sources } from '../../src/db/schema';
import { seenOnlyPayload, sourceClosedPayload, type ConnectorModule, type PipelineFetchContext } from '../../src/lib/connectors/types';
import { ParseError } from '../../src/lib/contracts/connectors';
import type { NormalizedJob, RawItem } from '../../src/lib/contracts/jobs';
import type { Db } from '../../src/lib/db';
import type { PipelineDeps } from '../../src/lib/pipeline/runtime';

export interface FakeItem {
  id: string;
  title?: string;
  company?: string;
  desc?: string;
  /** Payload the parser rejects (unless the connector is "fixed"). */
  bad?: boolean;
  /** Source-closed marker. */
  closed?: boolean;
  /** Seen-only marker. */
  seenOnly?: boolean;
  rev?: number;
}

const TITLES = [
  'Cloud Security Engineer',
  'DevSecOps Engineer',
  'Full Stack Developer',
  'Security Engineer',
  'Platform Security Engineer',
  'Application Security Engineer',
  'Site Reliability Engineer',
  'Backend Engineer',
  'Frontend Developer',
  'Security Analyst',
  'Infrastructure Engineer',
  'Detection Engineer',
];
const COMPANY_WORDS = ['Aurora', 'Borealis', 'Cobalt', 'Dynamo', 'Ember', 'Fjordline', 'Granite', 'Harborview', 'Ivory', 'Juniper', 'Kestrel', 'Lumen'];
const WORDS =
  'kubernetes terraform audit threat model detection pipeline cloud workloads incident response vulnerability scanning identity access policy compliance evidence automation observability logging tracing encryption secrets rotation network segmentation zero trust review mentoring roadmap budget relocation hybrid office learning onboarding'.split(
    ' ',
  );

function indexOf(externalId: string): number {
  return Number(externalId.replace(/\D/g, '')) || 0;
}

export class FakeFeed {
  readonly listings = new Map<string, FakeItem[] | Error>();
  readonly partial = new Set<string>();
  readonly fetches: string[] = [];
  /** Parser accepts `bad` payloads (simulates a parser fix). */
  fixed = false;

  /** `now` = the fetch time stamped on raw items (usually the test clock). */
  constructor(readonly now: () => Date = () => new Date('2026-09-30T06:00:00Z')) {}

  set(board: string, items: FakeItem[] | Error): void {
    this.listings.set(board, items);
  }
}

export function items(n: number, prefix = 'j', from = 1): FakeItem[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${prefix}${from + i}` }));
}

/** Distinct, deterministic description per posting (keeps near-duplicate detection quiet). */
function descFor(id: string, rev: number): string {
  let x = (indexOf(id) * 7919 + rev * 104729 + 17) >>> 0;
  const picked: string[] = [];
  for (let i = 0; i < 28; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    picked.push(WORDS[x % WORDS.length]);
  }
  return `Posting ${id} revision ${rev}. You will work on ${picked.join(' ')}. We offer relocation support and a hybrid office in Berlin.`;
}

export function fakeConnector(
  feed: FakeFeed,
  over: { platformKey?: string; listing?: 'full' | 'incremental'; kind?: 'ats' | 'aggregator' } = {},
): ConnectorModule<{ board: string }> {
  const platformKey = over.platformKey ?? 'fakeats';
  return {
    platformKey,
    version: 'fake@1',
    kind: over.kind ?? 'ats',
    listing: over.listing ?? 'full',
    configSchema: z.object({ board: z.string().min(1) }),
    platform: { name: 'Fake', grade: 'A', accessMethod: 'ats_json', termsUrl: null, rateLimitPerMin: 600, dailyCap: 1000, attribution: null, notes: '' },
    sourceKeyFor: (c) => `${platformKey}:${c.board}`,
    async fetch(ctx) {
      const board = (ctx.source.configJson as { board: string }).board;
      feed.fetches.push(board);
      const l = feed.listings.get(board);
      if (l instanceof Error) throw l;
      if (feed.partial.has(board)) (ctx as PipelineFetchContext).markListingPartial?.('item cap reached');
      return (l ?? []).map(
        (it): RawItem => ({
          externalId: it.id,
          payload: it.closed ? sourceClosedPayload({ id: it.id }) : it.seenOnly ? seenOnlyPayload({ id: it.id }) : { ...it, board },
          url: `https://jobs.fake.test/${board}/${it.id}`,
          fetchedAt: feed.now(),
        }),
      );
    },
    parse(item): NormalizedJob {
      const p = item.payload as FakeItem & { board: string };
      if (p.bad && !feed.fixed) throw new ParseError('unexpected payload shape', 'title');
      const n = indexOf(item.externalId);
      return {
        sourceId: 0,
        externalId: item.externalId,
        title: p.title ?? TITLES[n % TITLES.length],
        companyName: p.company ?? `${COMPANY_WORDS[n % COMPANY_WORDS.length]} ${p.board} ${n > 11 ? n : ''}`.trim(),
        locationRaw: 'Berlin, Germany',
        countryHint: 'DE',
        cityHint: 'Berlin',
        descriptionHtml: null,
        descriptionText: p.desc ?? descFor(item.externalId, p.rev ?? 0),
        applyUrl: `https://jobs.fake.test/${p.board}/${item.externalId}/apply`,
        postedAt: new Date('2026-09-01T00:00:00Z'),
      };
    },
  };
}

export async function seedPlatform(db: Db, key = 'fakeats', over: Partial<typeof sourcePlatforms.$inferInsert> = {}): Promise<void> {
  const [p] = await db.select({ key: sourcePlatforms.key }).from(sourcePlatforms).where(eq(sourcePlatforms.key, key)).limit(1);
  if (p) {
    if (Object.keys(over).length) await db.update(sourcePlatforms).set(over).where(eq(sourcePlatforms.key, key));
    return;
  }
  await db.insert(sourcePlatforms).values({ key, name: key, grade: 'A', accessMethod: 'ats_json', termsStatus: 'allowed', rateLimitPerMin: 600, dailyCap: 1000, ...over });
}

export async function seedFakeSource(db: Db, board: string, over: Partial<typeof sources.$inferInsert> = {}): Promise<number> {
  const platformKey = over.platformKey ?? 'fakeats';
  await seedPlatform(db, platformKey);
  const [res] = await db.insert(sources).values({
    sourceKey: `${platformKey}:${board}`,
    platformKey,
    configJson: { board },
    label: `Fake ${board}`,
    status: 'live',
    ...over,
  });
  return Number(res.insertId);
}

export class Clock {
  constructor(public t: Date = new Date('2026-09-30T06:00:00Z')) {}
  now = (): Date => new Date(this.t.getTime());
  advance(ms: number): Date {
    this.t = new Date(this.t.getTime() + ms);
    return this.now();
  }
}

export function testDeps(feed: FakeFeed, clock: Clock, extra: Partial<PipelineDeps> = {}): PipelineDeps {
  const full = fakeConnector(feed);
  const inc = fakeConnector(feed, { platformKey: 'fakeinc', listing: 'incremental', kind: 'aggregator' });
  return {
    connectors: (k) => (k === 'fakeats' ? full : k === 'fakeinc' ? inc : null),
    channels: [],
    now: clock.now,
    lockPollMs: 20,
    heartbeatMs: 60_000,
    ...extra,
  };
}

/** Row counts of the tables a pipeline run may touch. */
export async function rowCounts(db: Db): Promise<Record<string, number>> {
  const tables = {
    jobs: schema.jobs,
    jobSources: schema.jobSources,
    rawSnapshots: schema.rawSnapshots,
    sourceRuns: schema.sourceRuns,
    deadLetters: schema.deadLetters,
    alerts: schema.alerts,
    jobChanges: schema.jobChanges,
    jobFacts: schema.jobFacts,
    jobScores: schema.jobScores,
    companies: schema.companies,
    aiQueue: schema.aiQueue,
    titleReviewQueue: schema.titleReviewQueue,
    duplicateCandidates: schema.duplicateCandidates,
    pipelineRuns: schema.pipelineRuns,
  } as const;
  const out: Record<string, number> = {};
  for (const [name, table] of Object.entries(tables)) {
    const [row] = await db.select({ n: count() }).from(table);
    out[name] = Number(row?.n ?? 0);
  }
  return out;
}
