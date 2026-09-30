import { and, asc, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiQueue, applications, auditLog, duplicateCandidates, jobChanges, jobFacts, jobOverrides, jobSources, jobs } from '@/db/schema';
import { resolveCompany } from '@/lib/company/resolve';
import type { Fact } from '@/lib/contracts/provenance';
import type { DbOrTx } from '@/lib/db';
import { canonicalJobId, findDuplicate, neverMergeIds, recordPossibleDuplicates, type DedupCandidateInput } from '@/lib/dedup';
import { confirmDuplicate, dismissDuplicate, mergeJobs, parseJobMergeRecord, splitJobs } from '@/lib/dedup/manual';
import { sha256Hex } from '@/lib/hash';
import { cleanUrl } from '@/lib/normalize/url';
import { addFact, setOverride } from '@/lib/provenance/store';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedCompany, seedCountry, seedSource } from '../helpers/fixtures';

let t: TestDb;

beforeAll(async () => {
  t = await startTestDb();
}, 240_000);

afterAll(async () => {
  await t?.stop();
});

beforeEach(async () => {
  await t.truncateAll();
  await seedCountry(t.db, 'DE');
  await seedCountry(t.db, 'NL');
});

const DAY = 86_400_000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY);

const BODY =
  'You will design and run the services behind our payments platform, own them end to end in production, review code with ' +
  'your team, mentor two junior colleagues, talk to product managers every week, write clear design documents, improve our ' +
  'on-call runbooks and help us move the last old monolith parts to small services running on Kubernetes in two regions.';
const OTHER =
  'Our sales team grows enterprise accounts across the whole region, builds long relationships with buyers, runs product demos, ' +
  'negotiates yearly contracts, forecasts revenue every month with finance, trains new colleagues and travels to trade fairs ' +
  'in spring and autumn while keeping the customer records tidy for the support and success teams.';
const text = (intro: string, body = BODY) => `${intro} ${body}`;

let seq = 0;
interface JobSpec {
  companyId: number;
  title?: string;
  city?: string | null;
  countryIso2?: string | null;
  description?: string;
  url?: string;
  firstSeenAt?: Date;
  lastSeenAt?: Date;
  postedAt?: Date | null;
  saved?: boolean;
  hidden?: boolean;
}

function urlOf(spec: JobSpec): string {
  return spec.url ?? `https://boards.greenhouse.io/acme/jobs/${1000 + ++seq}`;
}

async function addJob(db: DbOrTx, spec: JobSpec): Promise<number> {
  const title = spec.title ?? 'Backend Engineer';
  const description = spec.description ?? text('Acme builds payment software in Berlin.');
  const url = urlOf(spec);
  const clean = cleanUrl(url) || url;
  const [res] = await db.insert(jobs).values({
    companyId: spec.companyId,
    canonicalTitle: title,
    titleRaw: title,
    countryIso2: spec.countryIso2 === undefined ? 'DE' : spec.countryIso2,
    city: spec.city === undefined ? 'Berlin' : spec.city,
    locationRaw: spec.city ?? '',
    descriptionText: description,
    descriptionHash: sha256Hex(description),
    applyUrl: url,
    applyUrlClean: clean,
    applyUrlHash: sha256Hex(clean),
    firstSeenAt: spec.firstSeenAt ?? new Date(),
    lastSeenAt: spec.lastSeenAt ?? new Date(),
    postedAt: spec.postedAt ?? null,
    saved: spec.saved ?? false,
    hidden: spec.hidden ?? false,
  });
  return Number(res.insertId);
}

async function addLink(
  db: DbOrTx,
  jobId: number,
  opts: { sourceId?: number; url?: string; grade?: 'A' | 'B' | 'C' | 'D'; firstSeenAt?: Date } = {},
): Promise<{ id: number; sourceId: number }> {
  const sourceId = opts.sourceId ?? (await seedSource(db));
  const url = opts.url ?? `https://boards.greenhouse.io/acme/jobs/${5000 + ++seq}`;
  const [res] = await db.insert(jobSources).values({
    jobId,
    sourceId,
    externalId: `ext-${++seq}`,
    url,
    grade: opts.grade ?? 'A',
    firstSeenAt: opts.firstSeenAt ?? new Date(),
    lastSeenAt: new Date(),
  });
  return { id: Number(res.insertId), sourceId };
}

function candidate(spec: JobSpec & { jobIdToIgnore?: number | null; sourceId?: number | null }): DedupCandidateInput {
  const title = spec.title ?? 'Backend Engineer';
  const description = spec.description ?? text('Acme builds payment software in Berlin.');
  const url = urlOf(spec);
  const clean = cleanUrl(url) || url;
  return {
    jobIdToIgnore: spec.jobIdToIgnore ?? null,
    companyId: spec.companyId,
    canonicalTitle: title,
    titleRaw: title,
    countryIso2: spec.countryIso2 === undefined ? 'DE' : spec.countryIso2,
    city: spec.city === undefined ? 'Berlin' : spec.city,
    applyUrlHash: sha256Hex(clean),
    descriptionHash: sha256Hex(description),
    descriptionText: description,
    sourceId: spec.sourceId ?? null,
    postedAt: spec.postedAt ?? null,
  };
}

async function job(id: number) {
  const [row] = await t.db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

async function linkIds(jobId: number): Promise<number[]> {
  return (await t.db.select({ id: jobSources.id }).from(jobSources).where(eq(jobSources.jobId, jobId)).orderBy(asc(jobSources.id))).map((r) => r.id);
}

async function pair(x: number, y: number) {
  const [row] = await t.db
    .select()
    .from(duplicateCandidates)
    .where(and(eq(duplicateCandidates.jobA, Math.min(x, y)), eq(duplicateCandidates.jobB, Math.max(x, y))));
  return row;
}

async function addPair(x: number, y: number, status: 'open' | 'dismissed' | 'split' | 'merged' = 'open'): Promise<number> {
  const [res] = await t.db
    .insert(duplicateCandidates)
    .values({ jobA: Math.min(x, y), jobB: Math.max(x, y), score: 0.8, reasonsJson: ['same company'], status, decidedReason: status === 'open' ? null : 'test' });
  return Number(res.insertId);
}

function fact<T>(value: T, source: string, checkedAt: Date, method: Fact<T>['method'] = 'posting'): Fact<T> {
  return { value, evidence: null, source, method, confidence: 'high', checkedAt, logicVersion: 'test@1' };
}

async function factsOf(jobId: number) {
  return t.db.select().from(jobFacts).where(eq(jobFacts.jobId, jobId)).orderBy(asc(jobFacts.id));
}

async function changes(jobId: number, field: string) {
  return t.db
    .select()
    .from(jobChanges)
    .where(and(eq(jobChanges.jobId, jobId), eq(jobChanges.field, field)))
    .orderBy(asc(jobChanges.id));
}

// ────────────────────────────────────────────────────────────────────────────────────────────

describe('findDuplicate: same link', () => {
  it('a specific posting link on the same company merges', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const url = 'https://boards.greenhouse.io/acme/jobs/4567890';
    const existing = await addJob(t.db, { companyId: c, url });
    const r = await findDuplicate(t.db, candidate({ companyId: c, url, city: 'Munich', description: 'short' }));
    expect(r).toMatchObject({ action: 'merge', jobId: existing, confidence: 0.99 });
    if (r.action === 'merge') expect(r.reasons).toEqual(['same apply link', 'same title', 'same company']);
  });

  it('the same link under another company name still merges, a bit less sure', async () => {
    const a = await seedCompany(t.db, 'Acme');
    const b = await seedCompany(t.db, 'Acme Recruiting Partner');
    const url = 'https://jobs.lever.co/acme/2f7c1a8e-4b1d-4c2e-9f0a-1b2c3d4e5f60';
    const existing = await addJob(t.db, { companyId: a, url });
    const r = await findDuplicate(t.db, candidate({ companyId: b, url, title: 'Backend Engineer (m/w/d)' }));
    expect(r).toMatchObject({ action: 'merge', jobId: existing, confidence: 0.95 });
  });

  it('tracking parameters do not hide the same link', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const existing = await addJob(t.db, { companyId: c, url: 'https://boards.greenhouse.io/acme/jobs/777' });
    const r = await findDuplicate(t.db, candidate({ companyId: c, url: 'https://boards.greenhouse.io/acme/jobs/777?utm_source=linkedin&utm_medium=social' }));
    expect(r).toMatchObject({ action: 'merge', jobId: existing });
  });

  it('a generic careers page is not evidence', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const url = 'https://acme.com/careers';
    await addJob(t.db, { companyId: c, url, title: 'Sales Manager', description: text('Acme sells software.', OTHER) });
    const r = await findDuplicate(t.db, candidate({ companyId: c, url, title: 'Backend Engineer' }));
    expect(r).toEqual({ action: 'new' });
  });

  it('the same link with an unrelated title goes to review', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const url = 'https://boards.greenhouse.io/acme/jobs/31337';
    const existing = await addJob(t.db, { companyId: c, url, title: 'Sales Manager', description: text('x', OTHER) });
    const r = await findDuplicate(t.db, candidate({ companyId: c, url, title: 'Backend Engineer' }));
    expect(r).toMatchObject({ action: 'possible', jobIds: [existing], score: 0.75 });
  });

  it('one link already on several jobs needs a human', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const url = 'https://boards.greenhouse.io/acme/jobs/2222';
    const j1 = await addJob(t.db, { companyId: c, url, city: 'Berlin' });
    const j2 = await addJob(t.db, { companyId: c, url, city: 'Hamburg', description: text('Hamburg office.', OTHER) });
    const r = await findDuplicate(t.db, candidate({ companyId: c, url, city: 'Munich', description: 'short text' }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') {
      expect(r.jobIds.sort()).toEqual([j1, j2].sort());
      expect(r.reasons).toContain('link shared by several jobs');
    }
  });

  it('a job that already carries the same source is another posting of it', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const url = 'https://boards.greenhouse.io/acme/jobs/9999';
    const existing = await addJob(t.db, { companyId: c, url });
    const { sourceId } = await addLink(t.db, existing);
    const r = await findDuplicate(t.db, candidate({ companyId: c, url, sourceId }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') expect(r.reasons).toContain('the same source lists it as another posting');
  });

  it('a link of a merged job leads to the surviving job', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const keep = await addJob(t.db, { companyId: c });
    const dropUrl = 'https://jobs.lever.co/acme/aaaa-bbbb-cccc';
    const drop = await addJob(t.db, { companyId: c, url: dropUrl, city: 'Munich' });
    await addLink(t.db, keep);
    await addLink(t.db, drop, { url: dropUrl });
    expect((await mergeJobs(t.db, keep, drop, 'same posting')).ok).toBe(true);
    const r = await findDuplicate(t.db, candidate({ companyId: c, url: dropUrl, city: 'Munich' }));
    expect(r).toMatchObject({ action: 'merge', jobId: keep });
  });
});

describe('findDuplicate: same company', () => {
  it('same title + city + identical description merges', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const existing = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(10), lastSeenAt: daysAgo(2) });
    const r = await findDuplicate(t.db, candidate({ companyId: c, title: 'Backend Engineer (m/w/d)' }));
    expect(r.action).toBe('merge');
    if (r.action === 'merge') {
      expect(r.jobId).toBe(existing);
      expect(r.confidence).toBeGreaterThanOrEqual(0.9);
      expect(r.reasons).toEqual(expect.arrayContaining(['same company', 'same title', 'identical description']));
    }
  });

  it('a near-identical description (small edit) still merges', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const existing = await addJob(t.db, { companyId: c, description: text('Acme builds payment software in Berlin.') });
    const r = await findDuplicate(t.db, candidate({ companyId: c, description: `${text('Acme builds payment software in Berlin.')} Apply now!` }));
    expect(r).toMatchObject({ action: 'merge', jobId: existing });
  });

  it('a partly different description is only a possible duplicate', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const existing = await addJob(t.db, { companyId: c });
    const half = BODY.split(' ').slice(0, 35).join(' ');
    const r = await findDuplicate(t.db, candidate({ companyId: c, description: `${half} ${OTHER}` }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') {
      expect(r.jobIds).toEqual([existing]);
      expect(r.score).toBeGreaterThanOrEqual(0.7);
      expect(r.score).toBeLessThan(0.9);
    }
  });

  it.each([
    ['another city', { city: 'Munich' }],
    ['no city on the posting', { city: null }],
    ['a different seniority', { title: 'Senior Backend Engineer' }],
  ])('%s → never merged', async (_label, change) => {
    const c = await seedCompany(t.db, 'Acme');
    await addJob(t.db, { companyId: c });
    const r = await findDuplicate(t.db, candidate({ companyId: c, ...change }));
    expect(r.action).not.toBe('merge');
  });

  it('a different job at the same company is new', async () => {
    const c = await seedCompany(t.db, 'Acme');
    await addJob(t.db, { companyId: c });
    const r = await findDuplicate(t.db, candidate({ companyId: c, title: 'Sales Manager', description: text('Acme sells.', OTHER) }));
    expect(r).toEqual({ action: 'new' });
  });

  it('jobs outside the 45-day window are not compared', async () => {
    const c = await seedCompany(t.db, 'Acme');
    await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(200), lastSeenAt: daysAgo(100) });
    expect(await findDuplicate(t.db, candidate({ companyId: c }))).toEqual({ action: 'new' });
  });

  it('two equally good matches → review instead of a guess', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const j1 = await addJob(t.db, { companyId: c });
    const j2 = await addJob(t.db, { companyId: c });
    const r = await findDuplicate(t.db, candidate({ companyId: c }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') expect(r.jobIds.sort()).toEqual([j1, j2].sort());
  });

  it('a job carrying the same source is never merged on content', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const existing = await addJob(t.db, { companyId: c });
    const { sourceId } = await addLink(t.db, existing);
    const r = await findDuplicate(t.db, candidate({ companyId: c, sourceId }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') expect(r.reasons).toContain('the same source lists it as another posting');
  });

  it('under a placeholder company nothing is merged on content', async () => {
    const { companyId } = await resolveCompany(t.db, { name: 'Confidential' });
    const existing = await addJob(t.db, { companyId });
    const r = await findDuplicate(t.db, candidate({ companyId }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') {
      expect(r.jobIds).toEqual([existing]);
      expect(r.reasons).toContain('company name is a placeholder');
    }
  });

  it('merged jobs are not compared again', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const keep = await addJob(t.db, { companyId: c, title: 'Platform Engineer', description: text('Platform.', OTHER) });
    const drop = await addJob(t.db, { companyId: c });
    await mergeJobs(t.db, keep, drop, 'same');
    expect(await findDuplicate(t.db, candidate({ companyId: c }))).toEqual({ action: 'new' });
  });

  it('re-checking a job never matches the job itself', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const self = await addJob(t.db, { companyId: c, url: 'https://boards.greenhouse.io/acme/jobs/1' });
    const r = await findDuplicate(t.db, candidate({ companyId: c, url: 'https://boards.greenhouse.io/acme/jobs/1', jobIdToIgnore: self }));
    expect(r).toEqual({ action: 'new' });
  });
});

describe('findDuplicate: different company', () => {
  it('the same long description elsewhere is a possible repost, never a merge', async () => {
    const employer = await seedCompany(t.db, 'Acme');
    const agency = await seedCompany(t.db, 'Talent Scouts Ltd');
    const existing = await addJob(t.db, { companyId: employer });
    const r = await findDuplicate(t.db, candidate({ companyId: agency }));
    expect(r.action).toBe('possible');
    if (r.action === 'possible') {
      expect(r.jobIds).toEqual([existing]);
      expect(r.reasons[0]).toBe('different company');
    }
  });

  it('short identical texts across companies are ignored', async () => {
    const a = await seedCompany(t.db, 'Acme');
    const b = await seedCompany(t.db, 'Globex');
    await addJob(t.db, { companyId: a, description: 'Backend engineer wanted.' });
    expect(await findDuplicate(t.db, candidate({ companyId: b, description: 'Backend engineer wanted.' }))).toEqual({ action: 'new' });
  });
});

describe('never proposing decided pairs again', () => {
  it.each(['dismissed', 'split'] as const)('a %s pair is not proposed for the re-checked job', async (status) => {
    const c = await seedCompany(t.db, 'Acme');
    const a = await addJob(t.db, { companyId: c });
    const b = await addJob(t.db, { companyId: c });
    await addPair(a, b, status);
    expect([...(await neverMergeIds(t.db, b))]).toEqual([a]);
    expect(await findDuplicate(t.db, candidate({ companyId: c, jobIdToIgnore: b }))).toEqual({ action: 'new' });
    expect(await findDuplicate(t.db, candidate({ companyId: c, jobIdToIgnore: a }))).toEqual({ action: 'new' });
  });

  it('open and merged pairs do not block', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const a = await addJob(t.db, { companyId: c });
    const b = await addJob(t.db, { companyId: c });
    await addPair(a, b, 'open');
    expect((await neverMergeIds(t.db, a)).size).toBe(0);
    expect(await findDuplicate(t.db, candidate({ companyId: c, jobIdToIgnore: b }))).toMatchObject({ action: 'merge', jobId: a });
    expect((await neverMergeIds(t.db, null)).size).toBe(0);
  });
});

describe('recordPossibleDuplicates', () => {
  it('creates, updates and never reopens decided pairs', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const [a, b, x] = [await addJob(t.db, { companyId: c }), await addJob(t.db, { companyId: c }), await addJob(t.db, { companyId: c })];
    expect(await recordPossibleDuplicates(t.db, x, { jobIds: [a, b, x, b, -1], score: 0.8, reasons: ['same company'] })).toEqual({ created: 2, updated: 0, decided: 0 });
    const p = await pair(x, a);
    expect(p).toMatchObject({ jobA: a, jobB: x, status: 'open', score: 0.8, reasonsJson: ['same company'] });
    expect(await recordPossibleDuplicates(t.db, x, { jobIds: [a, b], score: 1.7, reasons: ['again'] })).toEqual({ created: 0, updated: 2, decided: 0 });
    expect(await pair(a, x)).toMatchObject({ score: 1, reasonsJson: ['again'] });

    expect((await dismissDuplicate(t.db, p.id, 'different teams')).ok).toBe(true);
    expect(await recordPossibleDuplicates(t.db, x, { jobIds: [a, b], score: 0.9, reasons: ['third'] })).toEqual({ created: 0, updated: 1, decided: 1 });
    expect(await pair(a, x)).toMatchObject({ status: 'dismissed', reasonsJson: ['again'] });
    expect(await recordPossibleDuplicates(t.db, x, { jobIds: [], score: 0.9, reasons: [] })).toEqual({ created: 0, updated: 0, decided: 0 });
  });
});

// ────────────────────────────────────────────────────────────────────────────────────────────

/** Two postings of one job with links, facts, overrides and an application on each side. */
async function mergeFixture() {
  const c = await seedCompany(t.db, 'Acme');
  const keep = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(5), lastSeenAt: daysAgo(1), postedAt: daysAgo(6) });
  const drop = await addJob(t.db, { companyId: c, city: 'Berlin', firstSeenAt: daysAgo(10), lastSeenAt: new Date(), postedAt: daysAgo(12), saved: true });
  const keepLink = await addLink(t.db, keep, { grade: 'B', firstSeenAt: daysAgo(5) });
  const dropLink = await addLink(t.db, drop, { grade: 'A', firstSeenAt: daysAgo(10) });
  await t.db.update(jobs).set({ bestSourceId: keepLink.sourceId }).where(eq(jobs.id, keep));
  await t.db.update(jobs).set({ bestSourceId: dropLink.sourceId }).where(eq(jobs.id, drop));

  const shared = 'greenhouse:acme';
  const keepRemote = await addFact(t.db, keep, 'remote', fact({ class: 'not_remote' }, shared, daysAgo(3)));
  const dropRemote = await addFact(t.db, drop, 'remote', fact({ class: 'worldwide' }, shared, daysAgo(1)));
  const keepSignal = await addFact(t.db, keep, 'visa_signal', fact({ phrase: 'visa sponsorship' }, shared, daysAgo(3)));
  const dropSignal = await addFact(t.db, drop, 'visa_signal', fact({ phrase: 'visa sponsorship' }, shared, daysAgo(1)));
  const dropSkills = await addFact(t.db, drop, 'skills', fact({ skills: ['go'] }, 'lever:acme', daysAgo(1)));
  const keepOverride = await setOverride(t.db, keep, 'language', { requirement: 'english_ok' }, 'I checked');
  const dropOverride = await setOverride(t.db, drop, 'language', { requirement: 'local_required' }, 'I checked too');
  const dropOnlyOverride = await setOverride(t.db, drop, 'experience', { band: 'core', minYears: 2 }, 'from the posting');
  const [app] = await t.db.insert(applications).values({ jobId: drop, companyName: 'Acme', title: 'Backend Engineer' });
  const [queued] = await t.db.insert(aiQueue).values({ jobId: drop, task: 'summary' });
  return {
    c,
    keep,
    drop,
    keepLink,
    dropLink,
    keepRemote: keepRemote.id,
    dropRemote: dropRemote.id,
    keepSignal: keepSignal.id,
    dropSignal: dropSignal.id,
    dropSkills: dropSkills.id,
    keepOverride: keepOverride.id,
    dropOverride: dropOverride.id,
    dropOnlyOverride: dropOnlyOverride.id,
    applicationId: Number(app.insertId),
    queueId: Number(queued.insertId),
  };
}

describe('mergeJobs', () => {
  it('moves everything to the kept job and records what moved', async () => {
    const f = await mergeFixture();
    const before = { keep: await job(f.keep), drop: await job(f.drop) };
    const res = await mergeJobs(t.db, f.keep, f.drop, 'Same posting on two boards', { actor: 'admin', ip: '10.0.0.1' });
    expect(res).toMatchObject({ ok: true, jobId: f.keep });
    expect(res.message).toContain('1 link moved');
    expect(res.message).toContain('1 application moved');

    // Links + best source (drop's grade A link wins).
    expect(await linkIds(f.keep)).toEqual([f.keepLink.id, f.dropLink.id]);
    expect(await linkIds(f.drop)).toEqual([]);
    const keep = await job(f.keep);
    expect(keep.bestSourceId).toBe(f.dropLink.sourceId);

    // Dates: the widest span, the earliest posting date; saved carries over.
    expect(keep.firstSeenAt.getTime()).toBe(before.drop.firstSeenAt.getTime());
    expect(keep.lastSeenAt.getTime()).toBe(before.drop.lastSeenAt.getTime());
    expect(keep.postedAt?.getTime()).toBe(before.drop.postedAt?.getTime());
    expect(keep.saved).toBe(true);

    // Facts: all moved; same (key, method, source): the newer answer stays active.
    const facts = await factsOf(f.keep);
    const byId = new Map(facts.map((x) => [x.id, x]));
    expect(facts).toHaveLength(5);
    expect(byId.get(f.dropRemote)?.isActive).toBe(true);
    expect(byId.get(f.keepRemote)?.isActive).toBe(false);
    expect(byId.get(f.keepSignal)?.isActive).toBe(true);
    expect(byId.get(f.dropSignal)?.isActive).toBe(false);
    expect(byId.get(f.dropSkills)?.isActive).toBe(true);
    expect(keep.remoteClass).toBe('worldwide');

    // Overrides: keep's own fix wins per field; drop's other fixes apply.
    const overrides = await t.db.select().from(jobOverrides).where(eq(jobOverrides.jobId, f.keep));
    const ov = new Map(overrides.map((o) => [o.id, o]));
    expect(ov.get(f.keepOverride)?.active).toBe(true);
    expect(ov.get(f.dropOverride)?.active).toBe(false);
    expect(ov.get(f.dropOnlyOverride)?.active).toBe(true);
    expect(keep.languageRequirement).toBe('english_ok');
    expect(keep.experienceBand).toBe('core');

    // Applications follow; queued AI work for the dropped job is skipped.
    const [app] = await t.db.select().from(applications).where(eq(applications.id, f.applicationId));
    expect(app.jobId).toBe(f.keep);
    const [q] = await t.db.select().from(aiQueue).where(eq(aiQueue.id, f.queueId));
    expect(q).toMatchObject({ status: 'skipped', lastError: `merged into job #${f.keep}` });

    // The dropped row stays, hidden, pointing at keep.
    const drop = await job(f.drop);
    expect(drop).toMatchObject({ mergedIntoJobId: f.keep, hidden: true, hiddenReason: `Merged into job #${f.keep}` });
    expect(await canonicalJobId(t.db, f.drop)).toBe(f.keep);

    // Pair, history, audit.
    expect(await pair(f.keep, f.drop)).toMatchObject({ status: 'merged', decidedReason: 'Same posting on two boards' });
    const [m] = await changes(f.keep, 'merge');
    const rec = parseJobMergeRecord(m.newValue);
    expect(rec).toMatchObject({
      v: 1,
      dropId: f.drop,
      jobSourceIds: [f.dropLink.id],
      deactivatedFactIds: [f.dropSignal],
      keepDeactivatedFactIds: [f.keepRemote],
      deactivatedOverrideIds: [f.dropOverride],
      applicationIds: [f.applicationId],
      dropBefore: { hidden: false, hiddenReason: null },
    });
    expect(rec?.factIds.sort()).toEqual([f.dropRemote, f.dropSignal, f.dropSkills].sort());
    expect(rec?.keepBefore.firstSeenAt).toBe(before.keep.firstSeenAt.toISOString());
    expect((await changes(f.drop, 'merged_into'))[0].newValue).toBe(String(f.keep));
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.merge'));
    expect(a).toMatchObject({ entityType: 'job', entityId: String(f.drop), reason: 'Same posting on two boards', ip: '10.0.0.1', actor: 'admin' });
    expect(a.afterJson).toMatchObject({ keepId: f.keep, dropId: f.drop, links: 1, facts: 3, overrides: 2, applications: 1 });
  });

  it('repeating a merge is a no-op; bad merges fail and change nothing', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const [a, b, x] = [await addJob(t.db, { companyId: c }), await addJob(t.db, { companyId: c }), await addJob(t.db, { companyId: c })];
    expect((await mergeJobs(t.db, a, a, 'x')).message).toBe('A job cannot be merged into itself.');
    expect((await mergeJobs(t.db, a, b, '  ')).message).toBe('Give a reason for the merge.');
    expect((await mergeJobs(t.db, a, 987_654, 'x')).message).toBe('Job #987654 does not exist.');
    expect((await mergeJobs(t.db, 0, b, 'x')).ok).toBe(false);
    expect((await mergeJobs(t.db, a, b, 'same')).ok).toBe(true);
    expect(await mergeJobs(t.db, a, b, 'same')).toMatchObject({ ok: true, noop: true });
    expect((await mergeJobs(t.db, b, x, 'x')).message).toMatch(/was itself merged into/);
    expect((await mergeJobs(t.db, x, b, 'x')).message).toMatch(/already merged into/);
    expect(await job(x)).toMatchObject({ mergedIntoJobId: null, hidden: false });
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.merge'))).toHaveLength(1);
  });

  it('jobs merged into the dropped job are re-pointed at the survivor', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const [a, b, x] = [await addJob(t.db, { companyId: c }), await addJob(t.db, { companyId: c }), await addJob(t.db, { companyId: c })];
    await mergeJobs(t.db, b, x, 'x is b');
    await mergeJobs(t.db, a, b, 'b is a');
    expect(await job(x)).toMatchObject({ mergedIntoJobId: a });
    expect(await canonicalJobId(t.db, x)).toBe(a);
  });

  it('open review pairs move to the survivor; "different job" decisions carry over', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const keep = await addJob(t.db, { companyId: c });
    const drop = await addJob(t.db, { companyId: c });
    const openOther = await addJob(t.db, { companyId: c, title: 'Backend Engineer II' });
    const ruledOut = await addJob(t.db, { companyId: c, city: 'Hamburg' });
    const both = await addJob(t.db, { companyId: c, city: 'Munich' });
    await addPair(drop, openOther, 'open');
    await addPair(drop, ruledOut, 'dismissed');
    await addPair(drop, both, 'open');
    await addPair(keep, both, 'open');

    const res = await mergeJobs(t.db, keep, drop, 'same');
    expect(res.ok).toBe(true);
    expect(await pair(drop, openOther)).toBeUndefined();
    expect(await pair(keep, openOther)).toMatchObject({ status: 'open' });
    expect(await pair(keep, ruledOut)).toMatchObject({ status: 'dismissed', decidedReason: `Carried over from merged job #${drop}: test` });
    expect(await pair(drop, ruledOut)).toMatchObject({ status: 'dismissed' });
    expect(await pair(drop, both)).toBeUndefined();
    expect(await pair(keep, both)).toMatchObject({ status: 'open' });
    // The carried decision keeps blocking the survivor.
    expect(await neverMergeIds(t.db, ruledOut)).toEqual(new Set([drop, keep]));
    const recheck = await findDuplicate(t.db, candidate({ companyId: c, jobIdToIgnore: ruledOut }));
    expect(recheck.action).toBe('possible');
    if (recheck.action === 'possible') {
      expect(recheck.jobIds).not.toContain(keep);
      expect(recheck.jobIds.sort()).toEqual([openOther, both].sort());
    }
  });

  it('a manual merge overrides an earlier "not the same job"', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const a = await addJob(t.db, { companyId: c });
    const b = await addJob(t.db, { companyId: c });
    await addPair(a, b, 'dismissed');
    expect((await mergeJobs(t.db, a, b, 'on second look they are the same')).ok).toBe(true);
    expect(await pair(a, b)).toMatchObject({ status: 'merged', decidedReason: 'on second look they are the same' });
  });
});

describe('splitJobs', () => {
  it('restores a merged job with everything the merge moved', async () => {
    const f = await mergeFixture();
    const before = { keep: await job(f.keep), drop: await job(f.drop) };
    await mergeJobs(t.db, f.keep, f.drop, 'looked the same');

    const res = await splitJobs(t.db, f.keep, [f.dropLink.id], 'Different teams', { ip: '10.0.0.2' });
    expect(res).toMatchObject({ ok: true, jobId: f.keep, otherJobId: f.drop, restored: true });

    const drop = await job(f.drop);
    expect(drop).toMatchObject({ mergedIntoJobId: null, hidden: false, hiddenReason: null, bestSourceId: f.dropLink.sourceId });
    expect(await linkIds(f.drop)).toEqual([f.dropLink.id]);
    expect(await linkIds(f.keep)).toEqual([f.keepLink.id]);

    const keep = await job(f.keep);
    expect(keep.bestSourceId).toBe(f.keepLink.sourceId);
    expect(keep.firstSeenAt.getTime()).toBe(before.keep.firstSeenAt.getTime());
    expect(keep.lastSeenAt.getTime()).toBe(before.keep.lastSeenAt.getTime());
    expect(keep.postedAt?.getTime()).toBe(before.keep.postedAt?.getTime());

    // Facts back where they came from, with the answers the merge switched off back on.
    const dropFacts = new Map((await factsOf(f.drop)).map((x) => [x.id, x.isActive]));
    expect(dropFacts).toEqual(
      new Map([
        [f.dropRemote, true],
        [f.dropSignal, true],
        [f.dropSkills, true],
      ]),
    );
    const keepFacts = new Map((await factsOf(f.keep)).map((x) => [x.id, x.isActive]));
    expect(keepFacts).toEqual(
      new Map([
        [f.keepRemote, true],
        [f.keepSignal, true],
      ]),
    );
    expect(keep.remoteClass).toBe('not_remote');
    expect(drop.remoteClass).toBe('worldwide');

    // Overrides and the application go back too.
    const dropOverrides = new Map((await t.db.select().from(jobOverrides).where(eq(jobOverrides.jobId, f.drop))).map((o) => [o.id, o.active]));
    expect(dropOverrides).toEqual(
      new Map([
        [f.dropOverride, true],
        [f.dropOnlyOverride, true],
      ]),
    );
    expect(drop.languageRequirement).toBe('local_required');
    expect(keep.experienceBand).toBeNull();
    const [app] = await t.db.select().from(applications).where(eq(applications.id, f.applicationId));
    expect(app.jobId).toBe(f.drop);

    // Stored as different jobs, with history and audit.
    expect(await pair(f.keep, f.drop)).toMatchObject({ status: 'split', decidedReason: 'Different teams' });
    expect(JSON.parse((await changes(f.keep, 'split'))[0].newValue ?? '{}')).toMatchObject({ jobId: f.drop, restored: true });
    expect((await changes(f.drop, 'split_from'))[0].newValue).toBe(String(f.keep));
    const [a] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.split'));
    expect(a).toMatchObject({ entityId: String(f.keep), reason: 'Different teams', ip: '10.0.0.2' });

    // The fix persists: re-checking either job never proposes the other again.
    expect(await findDuplicate(t.db, candidate({ companyId: f.c, jobIdToIgnore: f.drop }))).toEqual({ action: 'new' });
    expect(await findDuplicate(t.db, candidate({ companyId: f.c, jobIdToIgnore: f.keep }))).toEqual({ action: 'new' });
    expect(await recordPossibleDuplicates(t.db, f.drop, { jobIds: [f.keep], score: 0.99, reasons: ['x'] })).toEqual({ created: 0, updated: 0, decided: 1 });
  });

  it('keeps dates that changed after the merge', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const keep = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(5), lastSeenAt: daysAgo(3) });
    const drop = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(10), lastSeenAt: daysAgo(4) });
    await addLink(t.db, keep);
    const dl = await addLink(t.db, drop);
    await mergeJobs(t.db, keep, drop, 'same');
    const seenNow = new Date(Math.floor(Date.now() / 1000) * 1000);
    await t.db.update(jobs).set({ lastSeenAt: seenNow }).where(eq(jobs.id, keep));
    await splitJobs(t.db, keep, [dl.id], 'different');
    const k = await job(keep);
    expect(k.lastSeenAt.getTime()).toBe(seenNow.getTime());
    expect(k.firstSeenAt.getTime()).toBeGreaterThan(daysAgo(6).getTime());
  });

  it('splits links that were never merged into a new job for review', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const url = 'https://boards.greenhouse.io/acme/jobs/111';
    const j = await addJob(t.db, { companyId: c, url });
    const l1 = await addLink(t.db, j, { url, grade: 'A', firstSeenAt: daysAgo(4) });
    const l2 = await addLink(t.db, j, { url: 'https://boards.greenhouse.io/acme/jobs/222', grade: 'B', firstSeenAt: daysAgo(2) });
    const l3 = await addLink(t.db, j, { url: 'https://acme.recruitee.com/o/backend-engineer', grade: 'C', firstSeenAt: daysAgo(1) });
    await t.db.update(jobs).set({ bestSourceId: l1.sourceId }).where(eq(jobs.id, j));

    const res = await splitJobs(t.db, j, [l1.id, l3.id, l1.id], 'Hamburg team posting');
    expect(res).toMatchObject({ ok: true, jobId: j, restored: false });
    const newId = res.otherJobId!;
    const created = await job(newId);
    expect(created).toMatchObject({
      companyId: c,
      canonicalTitle: 'Backend Engineer',
      state: 'new',
      needsReview: true,
      mergedIntoJobId: null,
      applyUrl: url,
      bestSourceId: l1.sourceId,
    });
    expect(await linkIds(newId)).toEqual([l1.id, l3.id]);
    expect(await linkIds(j)).toEqual([l2.id]);

    // The original's apply link left with the split: it now uses its remaining link.
    const orig = await job(j);
    expect(orig.applyUrl).toBe('https://boards.greenhouse.io/acme/jobs/222');
    expect(orig.applyUrlHash).toBe(sha256Hex('https://boards.greenhouse.io/acme/jobs/222'));
    expect(orig.bestSourceId).toBe(l2.sourceId);

    expect(await pair(j, newId)).toMatchObject({ status: 'split' });
    expect((await changes(newId, 'split_from'))[0].newValue).toBe(String(j));
    expect(await findDuplicate(t.db, candidate({ companyId: c, url, jobIdToIgnore: newId }))).toEqual({ action: 'new' });
  });

  it('refuses bad splits', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const j = await addJob(t.db, { companyId: c });
    const other = await addJob(t.db, { companyId: c });
    const l1 = await addLink(t.db, j);
    const l2 = await addLink(t.db, j);
    const lo = await addLink(t.db, other);
    expect((await splitJobs(t.db, j, [], 'x')).message).toBe('Pick the links that belong to the other job.');
    expect((await splitJobs(t.db, j, [l1.id], '')).message).toBe('Give a reason for the split.');
    expect((await splitJobs(t.db, j, [l1.id, l2.id], 'x')).message).toBe('Leave at least one link on this job.');
    expect((await splitJobs(t.db, j, [lo.id], 'x')).message).toMatch(/not on this job/);
    expect((await splitJobs(t.db, 424_242, [l1.id], 'x')).message).toMatch(/does not exist/);
    await mergeJobs(t.db, other, j, 'same');
    expect((await splitJobs(t.db, j, [l1.id], 'x')).message).toMatch(/split that job instead/);
    expect(await t.db.select().from(auditLog).where(eq(auditLog.action, 'job.split'))).toHaveLength(0);
  });
});

describe('dismissDuplicate / confirmDuplicate', () => {
  it('dismiss marks an open pair as different jobs, once', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const a = await addJob(t.db, { companyId: c });
    const b = await addJob(t.db, { companyId: c });
    const id = await addPair(a, b);
    const r = await dismissDuplicate(t.db, id, null, { ip: '10.0.0.3' });
    expect(r).toMatchObject({ ok: true, jobId: a, otherJobId: b });
    expect(await pair(a, b)).toMatchObject({ status: 'dismissed', decidedReason: 'Not the same job' });
    const [audit] = await t.db.select().from(auditLog).where(eq(auditLog.action, 'duplicate.dismiss'));
    expect(audit).toMatchObject({ entityType: 'duplicate_candidate', entityId: String(id), ip: '10.0.0.3' });
    expect(await dismissDuplicate(t.db, id)).toMatchObject({ ok: true, noop: true });
    expect((await dismissDuplicate(t.db, 777_777)).ok).toBe(false);
    expect((await dismissDuplicate(t.db, -3)).ok).toBe(false);
    const merged = await addPair(a, await addJob(t.db, { companyId: c }), 'merged');
    expect((await dismissDuplicate(t.db, merged)).message).toBe('These jobs were merged; split them instead.');
  });

  it('confirm merges the older job by default, or the one I pick', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const newer = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(1) });
    const older = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(9) });
    const id = await addPair(newer, older);
    const r = await confirmDuplicate(t.db, id, 'same job');
    expect(r).toMatchObject({ ok: true, jobId: older });
    expect(await job(newer)).toMatchObject({ mergedIntoJobId: older });
    expect(await pair(newer, older)).toMatchObject({ status: 'merged' });
    expect(await confirmDuplicate(t.db, id, 'again')).toMatchObject({ ok: true, noop: true, jobId: older });

    const x = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(30) });
    const y = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(2) });
    const id2 = await addPair(x, y);
    expect((await confirmDuplicate(t.db, id2, 'same', { keepId: older })).message).toBe('The job to keep must be one of the pair.');
    expect((await confirmDuplicate(t.db, id2, '')).ok).toBe(false);
    expect(await confirmDuplicate(t.db, id2, 'same', { keepId: y })).toMatchObject({ ok: true, jobId: y });
    expect(await job(x)).toMatchObject({ mergedIntoJobId: y });
  });

  it('confirm follows sides that were merged elsewhere since', async () => {
    const c = await seedCompany(t.db, 'Acme');
    const a = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(3) });
    const b = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(8) });
    const d = await addJob(t.db, { companyId: c, firstSeenAt: daysAgo(1) });
    const id = await addPair(a, d);
    await mergeJobs(t.db, b, a, 'a is b');
    const r = await confirmDuplicate(t.db, id, 'd is a');
    expect(r).toMatchObject({ ok: true, jobId: b });
    expect(await job(d)).toMatchObject({ mergedIntoJobId: b });
    const [row] = await t.db.select().from(duplicateCandidates).where(eq(duplicateCandidates.id, id));
    expect(row.status).toBe('merged');
  });
});
