/**
 * The AI queue end to end against a real MySQL with a mocked OpenRouter (spec §15): facts are
 * stored with AI provenance only when validated and quote-verified, the cache means the same
 * content is never sent twice, higher-trust facts win and the job is flagged, every attempt is
 * counted, and with AI off nothing is sent at all.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { aiCache, aiCalls, aiQueue, aiUsage, alerts, auditLog, jobs } from '../../src/db/schema';
import { aiExtract } from '../../src/lib/ai/extract';
import { OPENROUTER_CHAT_URL, OPENROUTER_KEY_URL } from '../../src/lib/ai/config';
import { EXTRACT_FACTS_PROMPT_VERSION, SUMMARY_REDFLAGS_PROMPT_VERSION } from '../../src/lib/ai/prompts';
import { enqueueAi, planAutoTasks, runAiQueue } from '../../src/lib/ai/queue';
import { aiSummarizeJob } from '../../src/lib/ai/run';
import type { AiFetch } from '../../src/lib/ai/transport';
import { resetEnvCacheForTests } from '../../src/lib/env';
import { addFact, getFacts, loadResolvedFacts } from '../../src/lib/provenance/store';
import { setSetting } from '../../src/lib/settings';
import { startTestDb, type TestDb } from '../helpers/db';
import { seedJob } from '../helpers/fixtures';

let t: TestDb;
const NOW = new Date('2026-09-30T10:00:00Z');
const MODEL = 'test/model:free';
const SOURCE = `openrouter:${MODEL}`;
const saved = { ...process.env };

const TEXT = `We are hiring a Cloud Security Engineer in Berlin.
We offer visa sponsorship for international candidates.
You bring at least 3 years of experience with AWS and Terraform.
The role is fully remote within the EU only.`;

function enableAiEnv(over: Record<string, string> = {}) {
  process.env.AI_ENABLED = 'true';
  process.env.OPENROUTER_API_KEY = 'test-key-not-real';
  process.env.OPENROUTER_MODEL = MODEL;
  delete process.env.AI_DAILY_LIMIT;
  Object.assign(process.env, over);
  resetEnvCacheForTests();
}

const goodExtract = (id: string) => ({
  id,
  visa_signals: [{ signal: 'offered', quote: 'We offer visa sponsorship for international candidates' }],
  experience: { min_years: 3, max_years: null, quote: 'at least 3 years of experience with AWS' },
  skills: [{ name: 'AWS', quote: 'experience with AWS and Terraform' }],
  language: null,
  remote: { class: 'region_limited', regions: ['EU'], quote: 'fully remote within the EU only' },
  salary: null,
});

interface MockCalls {
  chat: number;
  key: number;
  bodies: Record<string, unknown>[];
  /** Posting ids of each chat call, in order. */
  ids: string[][];
}

/** A fake OpenRouter: `answer(ids)` → the tool-call arguments; `failFirst` network errors first. */
function mockOpenRouter(answer: (ids: string[]) => unknown, opts: { failFirst?: number; status?: number } = {}) {
  const calls: MockCalls = { chat: 0, key: 0, bodies: [], ids: [] };
  let failures = opts.failFirst ?? 0;
  const fetch: AiFetch = async (url, init) => {
    if (url === OPENROUTER_KEY_URL) {
      calls.key++;
      return new Response(JSON.stringify({ data: { free_model_daily_requests: { used: 0, limit: 50, remaining: 50 } } }), { status: 200 });
    }
    expect(url).toBe(OPENROUTER_CHAT_URL);
    calls.chat++;
    const body = JSON.parse(String(init.body)) as { model: string; messages: { role: string; content: string }[]; tool_choice: { function: { name: string } } };
    calls.bodies.push(body);
    const user = body.messages.find((m) => m.role === 'user')!.content;
    const ids = [...new Set([...user.matchAll(/<<<POSTING id="(j\d+)">>>/g)].map((m) => m[1]))];
    calls.ids.push(ids);
    if (failures > 0) {
      failures--;
      throw new TypeError('fetch failed: ECONNRESET');
    }
    if (opts.status) return new Response(JSON.stringify({ error: { message: 'nope' } }), { status: opts.status });
    const args = answer(ids);
    return new Response(
      JSON.stringify({
        model: body.model,
        choices: [{ finish_reason: 'tool_calls', message: { tool_calls: [{ function: { name: body.tool_choice.function.name, arguments: JSON.stringify(args) } }] } }],
        usage: { prompt_tokens: 900, completion_tokens: 120 },
      }),
      { status: 200 },
    );
  };
  return { fetch, calls };
}

const extractAnswer = (ids: string[]) => ({ results: ids.map(goodExtract) });

async function queueRow(jobId: number) {
  const [row] = await t.db.select().from(aiQueue).where(eq(aiQueue.jobId, jobId));
  return row;
}

async function aiFacts(jobId: number) {
  return (await getFacts(t.db, jobId)).filter((f) => f.method === 'ai');
}

beforeAll(async () => {
  t = await startTestDb();
}, 120_000);
afterAll(async () => {
  process.env = { ...saved };
  resetEnvCacheForTests();
  await t?.stop();
});
beforeEach(async () => {
  await t.truncateAll();
  enableAiEnv();
  await setSetting(t.db, 'ai', { enabled: true, dailyLimit: 20, reserveForManual: 2 });
});
afterEach(() => {
  process.env = { ...saved };
  resetEnvCacheForTests();
});

describe('runAiQueue', () => {
  it('stores verified facts with AI provenance, marks the row done and logs the call', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT, city: 'Berlin' });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const m = mockOpenRouter(extractAnswer);
    const res = await runAiQueue(t.db, { maxCalls: 3, now: NOW, fetch: m.fetch, plan: false });
    expect(res).toMatchObject({ processed: 1, callsUsed: 1, stoppedBy: 'done', failed: 0, cached: 0, rejected: 0 });
    expect(m.calls.chat).toBe(1);
    expect(m.calls.key).toBe(1); // the free budget sync

    const body = m.calls.bodies[0];
    expect(body).not.toHaveProperty('response_format');
    expect(body.model).toBe(MODEL);
    expect(JSON.stringify(body.messages)).toContain('We offer visa sponsorship for international candidates');

    const all = await aiFacts(jobId);
    // visa_status is the visa engine's decision derived from the AI signal (AI alone → at most likely).
    expect(all.find((f) => f.key === 'visa_status')?.value).toMatchObject({ status: 'likely' });
    const facts = all.filter((f) => f.key !== 'visa_status');
    expect(facts.map((f) => f.key).sort()).toEqual(['experience', 'remote', 'skills', 'visa_signal']);
    for (const f of facts) {
      expect(f.source).toBe(SOURCE);
      expect(f.logicVersion).toBe(EXTRACT_FACTS_PROMPT_VERSION);
      expect(f.confidence).not.toBe('high');
      expect(f.evidence).toBeTruthy();
    }
    expect(facts.find((f) => f.key === 'experience')!.value).toMatchObject({ minYears: 3, maxYears: null });

    expect((await queueRow(jobId)).status).toBe('done');
    const calls = await t.db.select().from(aiCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ task: 'extract_facts', model: MODEL, promptVersion: EXTRACT_FACTS_PROMPT_VERSION, status: 'ok', rejectedCount: 0, tokensIn: 900, tokensOut: 120 });
    expect(calls[0].jobIdsJson).toEqual([jobId]);
    const [usage] = await t.db.select().from(aiUsage);
    expect(usage.callsUsed).toBe(1);
  });

  it('AI alone never makes the visa status confirmed', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    await runAiQueue(t.db, { maxCalls: 1, now: NOW, fetch: mockOpenRouter(extractAnswer).fetch, plan: false });
    const resolved = await loadResolvedFacts(t.db, jobId);
    const status = (resolved.visa_status?.winner?.value as { status?: string } | undefined)?.status ?? null;
    expect(status).not.toBe('confirmed');
    expect(status).not.toBe('not_offered');
  });

  it('works top priority first, 4 postings per call, and stops at the run allowance', async () => {
    const ids: number[] = [];
    for (let i = 0; i < 6; i++) {
      const { jobId } = await seedJob(t.db, { descriptionText: `${TEXT}\nReference ${i}.` });
      ids.push(jobId);
      await enqueueAi(t.db, jobId, 'extract_facts', 10 + i * 10);
    }
    const m = mockOpenRouter(extractAnswer);
    const res = await runAiQueue(t.db, { maxCalls: 1, now: NOW, fetch: m.fetch, plan: false });
    expect(res).toMatchObject({ processed: 4, callsUsed: 1, stoppedBy: 'max_calls' });
    expect(m.calls.ids[0]).toEqual(['j1', 'j2', 'j3', 'j4']);
    // The four best (priorities 60, 50, 40, 30) are done; the two lowest wait for the next run.
    const status = await Promise.all(ids.map(async (id) => (await queueRow(id)).status));
    expect(status).toEqual(['queued', 'queued', 'done', 'done', 'done', 'done']);
    const res2 = await runAiQueue(t.db, { maxCalls: 5, now: NOW, fetch: m.fetch, plan: false });
    expect(res2).toMatchObject({ processed: 2, callsUsed: 1, stoppedBy: 'done' });
  });

  it('a cache hit avoids a call (same content, other job or re-queued job)', async () => {
    const a = await seedJob(t.db, { descriptionText: TEXT, companyName: 'Same Co', city: 'Berlin' });
    await enqueueAi(t.db, a.jobId, 'extract_facts', 80);
    const m = mockOpenRouter(extractAnswer);
    await runAiQueue(t.db, { maxCalls: 2, now: NOW, fetch: m.fetch, plan: false });
    expect(m.calls.chat).toBe(1);
    expect(await t.db.select().from(aiCache)).toHaveLength(1);

    const b = await seedJob(t.db, { descriptionText: TEXT, companyName: 'Same Co', city: 'Berlin' });
    await enqueueAi(t.db, b.jobId, 'extract_facts', 80);
    await enqueueAi(t.db, a.jobId, 'extract_facts', 80); // the first row is done → a new row
    const res = await runAiQueue(t.db, { maxCalls: 2, now: NOW, fetch: m.fetch, plan: false });
    expect(m.calls.chat).toBe(1);
    expect(res).toMatchObject({ processed: 2, cached: 2, callsUsed: 0, stoppedBy: 'done' });
    expect((await aiFacts(b.jobId)).map((f) => f.key).sort()).toEqual(['experience', 'remote', 'skills', 'visa_signal', 'visa_status']);
    expect((await t.db.select().from(aiUsage))[0].callsUsed).toBe(1);
  });

  it('two queued jobs with the same content are sent once', async () => {
    const a = await seedJob(t.db, { descriptionText: TEXT, companyName: 'Twin Co' });
    const b = await seedJob(t.db, { descriptionText: TEXT, companyName: 'Twin Co' });
    await enqueueAi(t.db, a.jobId, 'extract_facts', 80);
    await enqueueAi(t.db, b.jobId, 'extract_facts', 70);
    const m = mockOpenRouter(extractAnswer);
    const res = await runAiQueue(t.db, { maxCalls: 2, now: NOW, fetch: m.fetch, plan: false });
    expect(m.calls.ids).toEqual([['j1']]);
    expect(res.processed).toBe(2);
    expect(await aiFacts(b.jobId)).not.toHaveLength(0);
  });

  it('a higher-trust fact wins a conflict and the job is flagged needs_review', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await addFact(t.db, jobId, 'experience', {
      value: { minYears: 5, maxYears: null, band: 'core', securityStrict: false },
      evidence: '5+ years',
      source: 'rule:experience',
      method: 'rule',
      confidence: 'high',
      checkedAt: NOW,
      logicVersion: 'experience@test',
    });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const res = await runAiQueue(t.db, { maxCalls: 1, now: NOW, fetch: mockOpenRouter(extractAnswer).fetch, plan: false });
    expect(res.flagged).toBe(1);
    const [job] = await t.db.select({ needsReview: jobs.needsReview }).from(jobs).where(eq(jobs.id, jobId));
    expect(job.needsReview).toBe(true);
    const resolved = await loadResolvedFacts(t.db, jobId);
    expect(resolved.experience?.winner).toMatchObject({ method: 'rule', value: { minYears: 5 } });
    // The AI fact is kept as a (losing) candidate for the review screen.
    expect((await aiFacts(jobId)).some((f) => f.key === 'experience')).toBe(true);
    const audits = await t.db.select().from(auditLog).where(and(eq(auditLog.action, 'ai.conflict'), eq(auditLog.entityId, String(jobId))));
    expect(audits).toHaveLength(1);
  });

  it('hallucinated quotes are rejected and nothing is stored', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const lie = (ids: string[]) => ({
      results: ids.map((id) => ({ id, visa_signals: [{ signal: 'offered', quote: 'We sponsor H-1B and Blue Card visas' }], remote: { class: 'worldwide', regions: [], quote: 'Work from anywhere in the world' } })),
    });
    const res = await runAiQueue(t.db, { maxCalls: 1, now: NOW, fetch: mockOpenRouter(lie).fetch, plan: false });
    expect(res.rejected).toBe(2);
    expect(await aiFacts(jobId)).toEqual([]);
    const [call] = await t.db.select().from(aiCalls);
    expect(call).toMatchObject({ status: 'ok', rejectedCount: 2 });
  });

  it('an invalid answer is logged "invalid", stores nothing and alerts once', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const junk = (ids: string[]) => ({ results: ids.map((id) => ({ id, experience: 'lots', visa_signals: 'yes' })) });
    const res = await runAiQueue(t.db, { maxCalls: 1, now: NOW, fetch: mockOpenRouter(junk).fetch, plan: false });
    expect(res.processed).toBe(0);
    expect(await aiFacts(jobId)).toEqual([]);
    const [call] = await t.db.select().from(aiCalls);
    expect(call.status).toBe('invalid');
    const row = await queueRow(jobId);
    expect(row).toMatchObject({ status: 'queued', attempts: 1 });
    expect(await t.db.select().from(alerts).where(eq(alerts.kind, 'ai_invalid'))).toHaveLength(1);
    expect(await t.db.select().from(aiCache)).toEqual([]);
  });

  it('a network error is retried once and both attempts count against the budget', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const m = mockOpenRouter(extractAnswer, { failFirst: 1 });
    const res = await runAiQueue(t.db, { maxCalls: 3, now: NOW, fetch: m.fetch, plan: false });
    expect(m.calls.chat).toBe(2);
    expect(res).toMatchObject({ processed: 1, callsUsed: 2 });
    expect((await t.db.select().from(aiUsage))[0].callsUsed).toBe(2);
    expect((await t.db.select().from(aiCalls)).map((c) => c.status).sort()).toEqual(['error', 'ok']);
  });

  it('never more than one retry, and the retry respects the run allowance', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const m = mockOpenRouter(extractAnswer, { failFirst: 5 });
    const res = await runAiQueue(t.db, { maxCalls: 1, now: NOW, fetch: m.fetch, plan: false });
    expect(m.calls.chat).toBe(1);
    expect(res.callsUsed).toBe(1);
    expect(await queueRow(jobId)).toMatchObject({ status: 'queued', attempts: 1 });
    const m2 = mockOpenRouter(extractAnswer, { failFirst: 5 });
    await runAiQueue(t.db, { maxCalls: 10, now: NOW, fetch: m2.fetch, plan: false });
    // 2 attempts per call (1 retry), then the job's next attempt; the run stops after 2 failed calls.
    expect(m2.calls.chat).toBeLessThanOrEqual(4);
  });

  it('stops cleanly when the day budget runs out (scheduled work keeps the manual reserve)', async () => {
    await setSetting(t.db, 'ai', { enabled: true, dailyLimit: 3, reserveForManual: 2 });
    for (let i = 0; i < 8; i++) {
      const { jobId } = await seedJob(t.db, { descriptionText: `${TEXT}\nReference ${i}.` });
      await enqueueAi(t.db, jobId, 'extract_facts', 50);
    }
    const m = mockOpenRouter(extractAnswer);
    const res = await runAiQueue(t.db, { maxCalls: 10, now: NOW, fetch: m.fetch, plan: false });
    expect(res).toMatchObject({ processed: 4, callsUsed: 1, stoppedBy: 'budget' });
    expect(m.calls.chat).toBe(1);
    expect(await t.db.select().from(alerts).where(eq(alerts.kind, 'ai_budget'))).toHaveLength(1);
  });

  it('429 from OpenRouter stops the run and leaves the work queued', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const res = await runAiQueue(t.db, { maxCalls: 3, now: NOW, fetch: mockOpenRouter(extractAnswer, { status: 429 }).fetch, plan: false });
    expect(res.stoppedBy).toBe('budget');
    expect((await queueRow(jobId)).status).toBe('queued');
  });

  it('closed / hidden / empty postings are skipped without a call', async () => {
    const a = await seedJob(t.db, { descriptionText: TEXT });
    const b = await seedJob(t.db, { descriptionText: `${TEXT} B` });
    await t.db.update(jobs).set({ state: 'closed' }).where(eq(jobs.id, a.jobId));
    await t.db.update(jobs).set({ hidden: true }).where(eq(jobs.id, b.jobId));
    await enqueueAi(t.db, a.jobId, 'extract_facts', 80);
    await enqueueAi(t.db, b.jobId, 'extract_facts', 80);
    const m = mockOpenRouter(extractAnswer);
    const res = await runAiQueue(t.db, { maxCalls: 3, now: NOW, fetch: m.fetch, plan: false });
    expect(res).toMatchObject({ skipped: 2, callsUsed: 0 });
    expect(m.calls.chat).toBe(0);
  });
});

describe('AI off', () => {
  it.each([
    ['AI_ENABLED=false', { AI_ENABLED: 'false' }],
    ['no key', { OPENROUTER_API_KEY: '' }],
  ])('%s → nothing is sent, the queue waits', async (_label, env) => {
    enableAiEnv(env);
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await enqueueAi(t.db, jobId, 'extract_facts', 80);
    const m = mockOpenRouter(extractAnswer);
    expect((await runAiQueue(t.db, { maxCalls: 5, now: NOW, fetch: m.fetch })).stoppedBy).toBe('disabled');
    expect(await aiSummarizeJob(t.db, jobId, { now: NOW, fetch: m.fetch })).toMatchObject({ ok: false, reason: 'disabled' });
    expect(await aiExtract(t.db, { jobId, task: 'extract_facts', text: TEXT, contentHash: 'x', now: NOW, fetch: m.fetch })).toMatchObject({ ok: false, reason: 'disabled' });
    expect(m.calls).toMatchObject({ chat: 0, key: 0 });
    expect((await queueRow(jobId)).status).toBe('queued');
    expect(await t.db.select().from(aiCalls)).toEqual([]);
  });

  it('settings.ai.enabled=false switches it off too', async () => {
    await setSetting(t.db, 'ai', { enabled: false, dailyLimit: 20, reserveForManual: 2 });
    const m = mockOpenRouter(extractAnswer);
    expect((await runAiQueue(t.db, { maxCalls: 5, now: NOW, fetch: m.fetch })).stoppedBy).toBe('disabled');
    expect(m.calls.chat).toBe(0);
  });
});

describe('one job from the UI', () => {
  const summaryAnswer = (ids: string[]) => ({
    results: ids.map((id) => ({
      id,
      summary: 'Cloud security role in Berlin, EU-remote, with visa sponsorship.',
      summary_quotes: ['We offer visa sponsorship for international candidates', 'fully remote within the EU only'],
      red_flags: [{ flag: 'Remote only within the EU', quote: 'fully remote within the EU only' }],
    })),
  });

  it('aiSummarizeJob stores a summary + red flags and may use the manual reserve', async () => {
    // Scheduled work already used everything but the reserve.
    await setSetting(t.db, 'ai', { enabled: true, dailyLimit: 2, reserveForManual: 2 });
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    const m = mockOpenRouter(summaryAnswer);
    const r = await aiSummarizeJob(t.db, jobId, { now: NOW, fetch: m.fetch });
    expect(r.ok).toBe(true);
    const facts = await aiFacts(jobId);
    expect(facts.find((f) => f.key === 'ai_summary')).toMatchObject({ source: SOURCE, logicVersion: SUMMARY_REDFLAGS_PROMPT_VERSION, value: { summary: 'Cloud security role in Berlin, EU-remote, with visa sponsorship.' } });
    expect(facts.filter((f) => f.key === 'red_flags')).toHaveLength(1);
    // Same content again → cache, no second call.
    const again = await aiSummarizeJob(t.db, jobId, { now: NOW, fetch: m.fetch });
    expect(again).toMatchObject({ ok: true, cached: true });
    expect(m.calls.chat).toBe(1);
  });

  it('a new answer replaces this source\'s old red flags', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    await aiSummarizeJob(t.db, jobId, { now: NOW, fetch: mockOpenRouter(summaryAnswer).fetch });
    // New posting text (e.g. edited) → a new answer without red flags.
    await t.db.update(jobs).set({ descriptionText: `${TEXT}\nUpdated.` }).where(eq(jobs.id, jobId));
    const noFlags = (ids: string[]) => ({ results: ids.map((id) => ({ ...summaryAnswer([id]).results[0], red_flags: [] })) });
    await aiSummarizeJob(t.db, jobId, { now: NOW, fetch: mockOpenRouter(noFlags).fetch });
    expect((await aiFacts(jobId)).filter((f) => f.key === 'red_flags')).toEqual([]);
  });

  it('aiExtract returns verified facts without storing them', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    const m = mockOpenRouter(extractAnswer);
    const r = await aiExtract(t.db, { jobId, task: 'extract_facts', text: TEXT, contentHash: 'ignored', now: NOW, fetch: m.fetch });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.facts.map((f) => f.key).sort()).toEqual(['experience', 'remote', 'skills', 'visa_signal']);
      expect(r.facts.every((f) => f.fact.method === 'ai' && f.fact.source === SOURCE)).toBe(true);
    }
    expect(await aiFacts(jobId)).toEqual([]);
    const cached = await aiExtract(t.db, { jobId, task: 'extract_facts', text: TEXT, contentHash: 'ignored', now: NOW, fetch: m.fetch });
    expect(cached).toMatchObject({ ok: true, cached: true });
    expect(m.calls.chat).toBe(1);
  });

  it('an invalid single-job answer stores nothing', async () => {
    const { jobId } = await seedJob(t.db, { descriptionText: TEXT });
    const r = await aiSummarizeJob(t.db, jobId, { now: NOW, fetch: mockOpenRouter(() => ({ answer: 'Sure! Here is a summary.' })).fetch });
    expect(r).toMatchObject({ ok: false, reason: 'invalid' });
    expect(await aiFacts(jobId)).toEqual([]);
    expect((await t.db.select().from(aiCalls))[0].status).toBe('invalid');
  });
});

describe('planAutoTasks', () => {
  it('plans summaries for top-fit jobs and scam checks for hinted postings, once', async () => {
    const top = await seedJob(t.db, { descriptionText: TEXT });
    const hinted = await seedJob(t.db, { descriptionText: `${TEXT}\nContact us on WhatsApp and pay a registration fee.` });
    const low = await seedJob(t.db, { descriptionText: `${TEXT}\nWhatsApp only.` });
    await t.db.update(jobs).set({ score: 88 }).where(eq(jobs.id, top.jobId));
    await t.db.update(jobs).set({ score: 55 }).where(eq(jobs.id, hinted.jobId));
    await t.db.update(jobs).set({ score: 10 }).where(eq(jobs.id, low.jobId));
    expect(await planAutoTasks(t.db)).toBe(2);
    const rows = await t.db.select({ jobId: aiQueue.jobId, task: aiQueue.task, priority: aiQueue.priority }).from(aiQueue);
    expect(rows).toEqual(
      expect.arrayContaining([
        { jobId: top.jobId, task: 'summary_redflags', priority: 88 },
        { jobId: hinted.jobId, task: 'suspicious_check', priority: 54 },
      ]),
    );
    expect(rows).toHaveLength(2);
    expect(await planAutoTasks(t.db)).toBe(0);
  });
});
