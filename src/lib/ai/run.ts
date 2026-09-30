/**
 * Working the AI queue (spec §15): top fit score first, cached content never sent twice, jobs
 * batched 3–5 per call, every answer validated (zod) and every quote verified before a fact is
 * stored. Stops cleanly when the day's budget or the run's call allowance is used up; with
 * AI_ENABLED=false, no key or settings.ai.enabled=false nothing is sent at all.
 *
 * Besides the queued extract_facts work (queued by the pipeline), each run plans two extra tasks
 * within the same allowance: a short summary + red flags for top-fit jobs (score ≥ TOP_FIT_SCORE)
 * and a scam check for postings whose text trips a rule hint (WhatsApp contact, fees…).
 */
import { and, desc, eq, gte, inArray, isNull, notInArray } from 'drizzle-orm';
import { companies, jobFacts, jobs } from '../../db/schema';
import type { FxTable } from '../contracts/jobs';
import type { Profile } from '../contracts/settings';
import { raiseAlert } from '../alerts';
import type { DbOrTx } from '../db';
import { getFxTable } from '../fx/ecb';
import { log } from '../log';
import { getSetting } from '../settings';
import { utcDay } from '../time';
import { mapTaskItem, mappedToFacts, storeTaskFacts, type MapContext, type MappedAnswer, type StoreOutcome } from './apply';
import { budgetConfig, syncAiBudget } from './budget';
import { aiCacheKey, contentHashFor, getCachedAnswer, putCachedAnswer } from './cache';
import { callAi, logAiCall, type AiFetch, type ChatResult } from './client';
import {
  MAX_AUTO_SUMMARIES_PER_RUN,
  MAX_AUTO_SUSPICIOUS_PER_RUN,
  MAX_NETWORK_RETRIES,
  SUSPICIOUS_MIN_SCORE,
  TOP_FIT_SCORE,
  aiModel,
  aiSource,
} from './config';
import { buildTaskPrompt, jobCheckText, suspicionHints, TASK_SPECS, type AiTaskSpec, type PromptJob } from './prompts';
import { enqueueAi, jobsWithTask, listQueued, markAttemptFailed, markDone, markSkipped, skipReason, type QueuedWork } from './queue-store';
import { canonicalTask, type CanonicalAiTask } from './tasks';
import { parseBatchOutput } from './validate';

const rlog = log.child({ module: 'ai-queue' });

export interface AiQueueRunResult {
  processed: number;
  skipped: number;
  failed: number;
  callsUsed: number;
  stoppedBy: 'done' | 'budget' | 'disabled' | 'max_calls' | 'error';
}

export interface AiQueueRunDetail extends AiQueueRunResult {
  /** Jobs answered from the cache (no call). */
  cached: number;
  /** Summary / scam-check tasks planned by this run. */
  planned: number;
  /** Facts/quotes thrown away by validation or evidence checks. */
  rejected: number;
  /** Jobs flagged needs_review (conflict with a higher-trust fact, or suspicious). */
  flagged: number;
}

export interface RunAiQueueOptions {
  maxCalls: number;
  now?: Date;
  /** Injected transport (tests). */
  fetch?: AiFetch | null;
  /** Plan summary / scam-check tasks (default true). */
  plan?: boolean;
}

interface ApplyEnv {
  profile: Pick<Profile, 'experienceBand' | 'skills'>;
  fx: FxTable;
  model: string;
  source: string;
}

async function loadApplyEnv(db: DbOrTx): Promise<ApplyEnv> {
  const profile = await getSetting(db, 'profile');
  let fx: FxTable = { date: null, rates: {} };
  try {
    fx = await getFxTable(db);
  } catch (err) {
    rlog.warn('fx table unavailable (AI salaries in other currencies are dropped)', { error: err instanceof Error ? err.message : String(err) });
  }
  const model = aiModel();
  return { profile, fx, model, source: aiSource(model) };
}

function mapContext(env: ApplyEnv, spec: AiTaskSpec, job: { lang: string | null; text: string }, checkText: string, now: Date): MapContext {
  return { checkText, fullText: job.text, lang: job.lang, promptVersion: spec.promptVersion, source: env.source, now, profile: env.profile, fx: env.fx };
}

function promptJobOf(id: string, w: Pick<QueuedWork, 'title' | 'company' | 'location' | 'text'>): PromptJob {
  return { id, title: w.title, company: w.company, location: w.location, text: w.text };
}

/** The cached, already schema-valid per-job answer (re-validated: the schema may be stricter now). */
async function cachedItem(db: DbOrTx, spec: AiTaskSpec, key: string, model: string): Promise<unknown | null> {
  const hit = await getCachedAnswer(db, key, model);
  if (!hit) return null;
  const r = spec.itemSchema.safeParse(hit.item);
  return r.success ? r.data : null;
}

// ---- planning ----------------------------------------------------------------------------------

const LIVE_STATES = ['new', 'active', 'updated', 'stale'] as const;

/** Queues summaries for top-fit jobs and scam checks for hinted postings. Returns rows created. */
export async function planAutoTasks(db: DbOrTx): Promise<number> {
  let planned = 0;
  const live = and(isNull(jobs.mergedIntoJobId), eq(jobs.hidden, false), inArray(jobs.state, [...LIVE_STATES]));

  const summarised = db.select({ id: jobFacts.jobId }).from(jobFacts).where(and(eq(jobFacts.factKey, 'ai_summary'), eq(jobFacts.isActive, true)));
  const top = await db
    .select({ id: jobs.id, score: jobs.score })
    .from(jobs)
    .where(and(live, gte(jobs.score, TOP_FIT_SCORE), notInArray(jobs.id, summarised)))
    .orderBy(desc(jobs.score), desc(jobs.id))
    .limit(MAX_AUTO_SUMMARIES_PER_RUN * 4);
  const hasSummaryTask = await jobsWithTask(db, 'summary_redflags', top.map((j) => j.id));
  for (const j of top.filter((t) => !hasSummaryTask.has(t.id)).slice(0, MAX_AUTO_SUMMARIES_PER_RUN)) {
    if ((await enqueueAi(db, j.id, 'summary_redflags', j.score ?? 0)).created) planned++;
  }

  const candidates = await db
    .select({ id: jobs.id, score: jobs.score, text: jobs.descriptionText })
    .from(jobs)
    .where(and(live, gte(jobs.score, SUSPICIOUS_MIN_SCORE)))
    .orderBy(desc(jobs.score), desc(jobs.id))
    .limit(200);
  const hasCheck = await jobsWithTask(db, 'suspicious_check', candidates.map((c) => c.id));
  let checks = 0;
  for (const c of candidates) {
    if (checks >= MAX_AUTO_SUSPICIOUS_PER_RUN) break;
    if (hasCheck.has(c.id) || !suspicionHints(c.text).length) continue;
    // Just under the fit score: a scam check never pushes a summary of the same job out.
    if ((await enqueueAi(db, c.id, 'suspicious_check', (c.score ?? 0) - 1)).created) {
      planned++;
      checks++;
    }
  }
  return planned;
}

// ---- the run -----------------------------------------------------------------------------------

interface BatchEntry {
  rows: QueuedWork[];
  job: PromptJob;
  checkText: string;
  contentHash: string;
  cacheKey: string;
}

async function applyItem(
  db: DbOrTx,
  env: ApplyEnv,
  spec: AiTaskSpec,
  entry: Pick<BatchEntry, 'rows' | 'checkText'>,
  item: unknown,
  now: Date,
): Promise<{ mapped: MappedAnswer; stores: StoreOutcome[] }> {
  const first = entry.rows[0];
  const ctx = mapContext(env, spec, first, entry.checkText, now);
  const mapped = mapTaskItem(spec.task, item, ctx);
  const stores: StoreOutcome[] = [];
  for (const row of entry.rows) stores.push(await storeTaskFacts(db, row.jobId, mapped, ctx));
  return { mapped, stores };
}

async function alertOnce(db: DbOrTx, kind: string, dedupeKey: string, title: string, body: string): Promise<void> {
  try {
    await raiseAlert(db, { kind, severity: 'warn', title, body, dedupeKey, entityType: 'ai', entityId: null });
  } catch (err) {
    rlog.warn('alert failed', { kind, error: err instanceof Error ? err.message : String(err) });
  }
}

export async function runAiQueue(db: DbOrTx, opts: RunAiQueueOptions): Promise<AiQueueRunDetail> {
  const now = opts.now ?? new Date();
  const day = utcDay(now);
  const res: AiQueueRunDetail = { processed: 0, skipped: 0, failed: 0, callsUsed: 0, stoppedBy: 'done', cached: 0, planned: 0, rejected: 0, flagged: 0 };
  const cfg = await budgetConfig(db);
  if (!cfg.enabled) return { ...res, stoppedBy: 'disabled' };
  const maxCalls = Math.max(0, Math.floor(Number.isFinite(opts.maxCalls) ? opts.maxCalls : 0));
  if (maxCalls <= 0) return { ...res, stoppedBy: 'max_calls' };

  // OpenRouter's own counter first (free; best-effort).
  await syncAiBudget(db, { now, fetch: opts.fetch }).catch(() => undefined);
  if (opts.plan !== false) {
    try {
      res.planned = await planAutoTasks(db);
    } catch (err) {
      rlog.warn('planning AI tasks failed', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  const env = await loadApplyEnv(db);
  const tried = new Set<number>();
  let consecutiveErrors = 0;

  for (;;) {
    const rows = await listQueued(db, { exclude: tried, limit: 60 });
    if (!rows.length) break;

    // The best row decides the task of this batch; same-task rows join it in priority order.
    const task = canonicalTask(rows[0].task);
    if (!task) {
      tried.add(rows[0].queueId);
      await markSkipped(db, rows[0].queueId, `unknown AI task '${rows[0].task}'`, now);
      res.skipped++;
      continue;
    }
    const spec = TASK_SPECS[task] as AiTaskSpec;
    const batch = new Map<string, BatchEntry>();
    for (const row of rows) {
      if (canonicalTask(row.task) !== task) continue;
      const skip = skipReason(row);
      if (skip) {
        tried.add(row.queueId);
        await markSkipped(db, row.queueId, skip, now);
        res.skipped++;
        continue;
      }
      const probe = promptJobOf('j0', row);
      const contentHash = contentHashFor(jobCheckText(probe));
      const existing = batch.get(contentHash);
      if (existing) {
        existing.rows.push(row);
        tried.add(row.queueId);
        continue;
      }
      const cacheKey = aiCacheKey(contentHash, task, spec.promptVersion);
      const hit = await cachedItem(db, spec, cacheKey, env.model);
      if (hit) {
        tried.add(row.queueId);
        const { mapped, stores } = await applyItem(db, env, spec, { rows: [row], checkText: jobCheckText(probe) }, hit, now);
        await markDone(db, [row.queueId], now);
        res.cached++;
        res.processed++;
        res.rejected += mapped.rejected;
        res.flagged += stores.filter((s) => s.flagged).length;
        continue;
      }
      if (batch.size >= spec.batchSize) continue;
      const job = promptJobOf(`j${batch.size + 1}`, row);
      batch.set(contentHash, { rows: [row], job, checkText: jobCheckText(job), contentHash, cacheKey });
      tried.add(row.queueId);
    }
    if (!batch.size) continue;

    if (res.callsUsed >= maxCalls) {
      // The batch stays queued for the next run.
      res.stoppedBy = 'max_calls';
      break;
    }

    const entries = [...batch.values()];
    const prompt = buildTaskPrompt(spec, entries.map((e) => e.job));
    const jobIds = entries.flatMap((e) => e.rows.map((r) => r.jobId));
    const outcome = await callAi(db, {
      task,
      promptVersion: spec.promptVersion,
      jobIds,
      manual: false,
      now,
      fetch: opts.fetch,
      maxAttempts: Math.min(1 + MAX_NETWORK_RETRIES, maxCalls - res.callsUsed),
      request: {
        model: env.model,
        system: prompt.system,
        user: prompt.user,
        maxTokens: prompt.maxTokens,
        tool: { name: spec.toolName, description: spec.toolDescription, parameters: spec.parameters },
      },
    });
    res.callsUsed += outcome.attempts;

    if (!outcome.ok) {
      if (outcome.reason === 'budget' || outcome.reason === 'disabled' || outcome.reason === 'rate_limited') {
        res.stoppedBy = outcome.reason === 'disabled' ? 'disabled' : 'budget';
        break;
      }
      if (outcome.reason === 'auth') {
        await alertOnce(db, 'ai_auth', `ai_auth:${day}`, 'OpenRouter refused the API key', 'AI calls stopped for this run. Check OPENROUTER_API_KEY; RADAR keeps running on rules only.');
        res.stoppedBy = 'disabled';
        break;
      }
      for (const e of entries) for (const r of e.rows) if (await markAttemptFailed(db, r.queueId, outcome.message, now)) res.failed++;
      consecutiveErrors++;
      if (consecutiveErrors >= 2) {
        res.stoppedBy = 'error';
        break;
      }
      continue;
    }
    consecutiveErrors = 0;
    const done = await handleAnswer(db, env, spec, entries, outcome.result, now, day);
    res.processed += done.processed;
    res.failed += done.failed;
    res.rejected += done.rejected;
    res.flagged += done.flagged;
  }
  rlog.info('ai queue run', { ...res });
  return res;
}

async function handleAnswer(
  db: DbOrTx,
  env: ApplyEnv,
  spec: AiTaskSpec,
  entries: BatchEntry[],
  result: ChatResult,
  now: Date,
  day: string,
): Promise<{ processed: number; failed: number; rejected: number; flagged: number }> {
  const out = { processed: 0, failed: 0, rejected: 0, flagged: 0 };
  const ids = entries.map((e) => e.job.id);
  const parsed = parseBatchOutput(spec.itemSchema as AiTaskSpec['itemSchema'], result.args, ids);
  const logBase = {
    task: spec.task,
    model: result.model ?? env.model,
    promptVersion: spec.promptVersion,
    jobIds: entries.flatMap((e) => e.rows.map((r) => r.jobId)),
    latencyMs: result.latencyMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
  if (parsed.error) {
    const why = [result.parseError ?? parsed.error, ...parsed.issues].join('; ');
    await logAiCall(db, { ...logBase, status: 'invalid', rejectedCount: entries.length, error: why });
    for (const e of entries) for (const r of e.rows) if (await markAttemptFailed(db, r.queueId, `invalid AI answer: ${why}`, now)) out.failed++;
    out.rejected += entries.length;
    await alertOnce(
      db,
      'ai_invalid',
      `ai_invalid:${day}`,
      'An AI answer failed validation and was thrown away',
      `Task ${spec.task} (${spec.promptVersion}): ${why.slice(0, 300)}. Nothing from it was stored; the jobs are retried later.`,
    );
    return out;
  }
  let rejected = parsed.invalidItems + parsed.unknownIds + parsed.duplicates;
  for (const e of entries) {
    const item = parsed.items.get(e.job.id);
    if (!item) {
      rejected++;
      for (const r of e.rows) if (await markAttemptFailed(db, r.queueId, 'no valid result for this posting in the AI answer', now)) out.failed++;
      continue;
    }
    await putCachedAnswer(db, { key: e.cacheKey, contentHash: e.contentHash, task: spec.task, promptVersion: spec.promptVersion, model: env.model, item: { ...item, id: 'cached' } });
    const { mapped, stores } = await applyItem(db, env, spec, e, item, now);
    rejected += mapped.rejected;
    out.flagged += stores.filter((s) => s.flagged).length;
    await markDone(db, e.rows.map((r) => r.queueId), now);
    out.processed += e.rows.length;
  }
  out.rejected += rejected;
  await logAiCall(db, { ...logBase, status: 'ok', rejectedCount: rejected, error: result.via === 'content' ? 'answered in content (tool not called)' : null });
  return out;
}

// ---- one job (UI) ------------------------------------------------------------------------------

export interface SingleJobInput {
  jobId: number;
  task: string;
  /** Posting text (default: the job's stored description). */
  text?: string;
  manual?: boolean;
  /** Store the facts (aiSummarizeJob) or only return them (aiExtract). */
  store: boolean;
  now?: Date;
  fetch?: AiFetch | null;
}

export type SingleJobResult =
  | { ok: true; facts: ReturnType<typeof mappedToFacts>; cached: boolean; rejected: number; store: StoreOutcome | null }
  | { ok: false; reason: 'disabled' | 'budget' | 'invalid' | 'error'; message: string };

export async function runSingleJob(db: DbOrTx, input: SingleJobInput): Promise<SingleJobResult> {
  const now = input.now ?? new Date();
  const task: CanonicalAiTask | null = canonicalTask(input.task);
  if (!task) return { ok: false, reason: 'invalid', message: `Unknown AI task '${input.task}'.` };
  const cfg = await budgetConfig(db);
  if (!cfg.enabled) return { ok: false, reason: 'disabled', message: 'AI is switched off, so no call was made.' };
  const spec = TASK_SPECS[task] as AiTaskSpec;

  const [job] = await db
    .select({
      canonicalTitle: jobs.canonicalTitle,
      titleRaw: jobs.titleRaw,
      company: companies.name,
      location: jobs.locationRaw,
      text: jobs.descriptionText,
      lang: jobs.lang,
    })
    .from(jobs)
    .leftJoin(companies, eq(companies.id, jobs.companyId))
    .where(eq(jobs.id, input.jobId))
    .limit(1);
  if (!job) return { ok: false, reason: 'error', message: 'That job no longer exists.' };
  const text = (input.text ?? job.text).trim();
  if (!text) return { ok: false, reason: 'invalid', message: 'This posting has no text.' };

  const env = await loadApplyEnv(db);
  const work = { title: job.canonicalTitle || job.titleRaw, company: job.company ?? null, location: job.location, text };
  const promptJob = promptJobOf('j1', work);
  const checkText = jobCheckText(promptJob);
  const contentHash = contentHashFor(checkText);
  const cacheKey = aiCacheKey(contentHash, task, spec.promptVersion);
  const ctx = mapContext(env, spec, { lang: job.lang ?? null, text }, checkText, now);

  const finish = async (item: unknown, cached: boolean, extraRejected: number): Promise<SingleJobResult> => {
    const mapped = mapTaskItem(task, item, ctx);
    const store = input.store ? await storeTaskFacts(db, input.jobId, mapped, ctx) : null;
    return { ok: true, facts: mappedToFacts(mapped, ctx), cached, rejected: mapped.rejected + extraRejected, store };
  };

  const hit = await cachedItem(db, spec, cacheKey, env.model);
  if (hit) return finish(hit, true, 0);

  const prompt = buildTaskPrompt(spec, [promptJob]);
  const outcome = await callAi(db, {
    task,
    promptVersion: spec.promptVersion,
    jobIds: [input.jobId],
    manual: input.manual ?? true,
    now,
    fetch: input.fetch,
    request: {
      model: env.model,
      system: prompt.system,
      user: prompt.user,
      maxTokens: prompt.maxTokens,
      tool: { name: spec.toolName, description: spec.toolDescription, parameters: spec.parameters },
    },
  });
  if (!outcome.ok) {
    if (outcome.reason === 'budget' || outcome.reason === 'rate_limited') return { ok: false, reason: 'budget', message: outcome.reason === 'budget' ? outcome.message : 'OpenRouter says the free daily limit is reached. Try again after 00:00 UTC.' };
    if (outcome.reason === 'disabled' || outcome.reason === 'auth') return { ok: false, reason: 'disabled', message: outcome.reason === 'auth' ? 'OpenRouter refused the API key; no answer was stored.' : outcome.message };
    return { ok: false, reason: 'error', message: `The AI call failed: ${outcome.message}` };
  }
  const result = outcome.result;
  const parsed = parseBatchOutput(spec.itemSchema as AiTaskSpec['itemSchema'], result.args, ['j1']);
  const logBase = {
    task,
    model: result.model ?? env.model,
    promptVersion: spec.promptVersion,
    jobIds: [input.jobId],
    latencyMs: result.latencyMs,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
  };
  const item = parsed.items.get('j1');
  if (!item) {
    const why = [result.parseError ?? parsed.error ?? 'no result', ...parsed.issues].join('; ');
    await logAiCall(db, { ...logBase, status: 'invalid', rejectedCount: 1, error: why });
    return { ok: false, reason: 'invalid', message: 'The AI answer did not pass validation, so nothing was stored.' };
  }
  await putCachedAnswer(db, { key: cacheKey, contentHash, task, promptVersion: spec.promptVersion, model: env.model, item: { ...item, id: 'cached' } });
  const done = await finish(item, false, parsed.invalidItems + parsed.unknownIds + parsed.duplicates);
  await logAiCall(db, { ...logBase, status: 'ok', rejectedCount: done.ok ? done.rejected : 0, error: result.via === 'content' ? 'answered in content (tool not called)' : null });
  return done;
}

/** "Ask AI" for one job from the UI: summary + red flags, stored, using the manual reserve. */
export async function aiSummarizeJob(db: DbOrTx, jobId: number, opts: { now?: Date; fetch?: AiFetch | null } = {}): Promise<SingleJobResult> {
  return runSingleJob(db, { jobId, task: 'summary_redflags', manual: true, store: true, now: opts.now, fetch: opts.fetch });
}
