/**
 * Apply-link checker: HEAD (then GET) each open job's apply link about once a day, politely
 * (1 request per host per second, a few hosts in parallel, SSRF-safe fetch).
 *
 * - 2xx → link ok: last confirmed live; a job closed for a dead link reopens.
 * - 404 / 410, or a redirect to the board / home page / an `error=true` page → a conclusive
 *   failure. Two conclusive failures in a row (inconclusive checks in between are ignored, an ok
 *   check resets) → link dead → the job closes ('link_dead').
 * - Everything else (timeouts, 403, 429, 5xx, DNS, TLS) is inconclusive: recorded, nothing changes.
 *
 * Closed jobs with a dead link that a source listed again after the last check are re-checked
 * too (they reopen when the link works again). Runs under its own lock ('linkcheck'), so it never
 * blocks the pipeline; every probe is kept in link_checks and the run in pipeline_runs.
 */
import { and, asc, desc, eq, exists, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { jobChanges, jobs, jobSources, linkChecks } from '../../db/schema';
import type { LINK_STATUSES } from '../../db/schema/_enums';
import type { Db, DbOrTx } from '../db';
import { closeJob, OPEN_STATES, reopenJob } from '../lifecycle';
import type { Logger } from '../log';
import { LINKCHECK_LOCK } from '../pipeline/lock';
import type { RunRequester } from '../pipeline/queue';
import type { RunStatus } from '../pipeline/report';
import { beginRun, finishRun, mapLimit, type ActiveRun } from '../pipeline/runtime';
import { errorText, withTxRetry } from '../pipeline/stages/dbutil';
import { abortableSleep } from '../http/polite';
import { safeFetch as defaultSafeFetch, SafeFetchError, type SafeFetchOptions, type SafeFetchResponse } from '../security/safe-fetch';
import { HOUR_MS } from '../time';

export type LinkStatus = (typeof LINK_STATUSES)[number];

export const LINKCHECK_BATCH = 150;
export const RECHECK_AFTER_MS = 20 * HOUR_MS;
/** Conclusive failures in a row before a link counts as dead. */
export const DEAD_AFTER_FAILURES = 2;
export const HOST_DELAY_MS = 1000;
export const LINKCHECK_TIMEOUT_MS = 15_000;
export const LINKCHECK_MAX_BYTES = 5 * 1024 * 1024;
export const LINKCHECK_CONCURRENCY = 4;
/** Share of the batch reserved for re-checking dead-closed jobs listed again. */
export const RECHECK_DEAD_SHARE = 0.2;
/** Error prefix of a conclusive "posting gone" redirect in link_checks.error. */
export const GONE_PREFIX = 'gone:';

type SafeFetchLike = (url: string, options?: SafeFetchOptions) => Promise<SafeFetchResponse>;

export interface LinkCheckDeps {
  fetch?: SafeFetchLike;
  now?: () => Date;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  hostDelayMs?: number;
  timeoutMs?: number;
  concurrency?: number;
  logger?: Logger;
  heartbeatMs?: number;
}

export interface LinkCheckOptions {
  batch?: number;
  signal?: AbortSignal;
  requestedBy?: RunRequester;
  /** Execute this queued pipeline_runs row. */
  runId?: number;
  deps?: LinkCheckDeps;
}

export interface LinkCheckResult {
  runId: number | null;
  status: RunStatus;
  stats: Record<string, unknown>;
}

// ---- pure classification ------------------------------------------------------------------------

export interface ProbeResult {
  /** Final HTTP status (null when no response). */
  status: number | null;
  finalUrl: string | null;
  /** SafeFetchError code or 'error' (null when a response arrived). */
  errorCode: string | null;
}

export interface ProbeVerdict {
  linkStatus: LinkStatus;
  ok: boolean;
  /** Conclusive result: counts toward (or resets) the dead-link streak. */
  conclusive: boolean;
  reason: string | null;
}

const LISTING_SEGMENTS = new Set(['jobs', 'careers', 'career', 'positions', 'openings', 'vacancies', 'job-openings', 'stellenangebote', 'jobb', 'stillinger', 'karriere', 'search']);

function trimPath(p: string): string {
  const t = p.replace(/\/+$/, '');
  return t === '' ? '/' : t;
}

/**
 * Whether a redirect from `from` to `to` means the posting is gone: to the site root, to an
 * ancestor path on the same host (the job board), to a listing page, or to an `error=true` page.
 */
export function goneRedirect(from: string, to: string): string | null {
  let a: URL;
  let b: URL;
  try {
    a = new URL(from);
    b = new URL(to);
  } catch {
    return null;
  }
  const pa = trimPath(a.pathname).toLowerCase();
  const pb = trimPath(b.pathname).toLowerCase();
  if (a.host === b.host && pa === pb) return null;
  if (/(^|&)error=true(&|$)/i.test(b.search.slice(1))) return `${GONE_PREFIX} redirected to an error page (${b.host}${pb})`;
  if (pb === '/' && pa !== '/') return `${GONE_PREFIX} redirected to the home page (${b.host})`;
  if (a.host === b.host && pb !== '/' && pa.startsWith(`${pb}/`)) return `${GONE_PREFIX} redirected to the parent page ${pb}`;
  const last = pb.split('/').filter(Boolean).pop() ?? '';
  if (LISTING_SEGMENTS.has(last) && !pa.endsWith(`/${last}`)) return `${GONE_PREFIX} redirected to the listing ${b.host}${pb}`;
  return null;
}

export function classifyProbe(url: string, probe: ProbeResult): ProbeVerdict {
  if (probe.errorCode || probe.status === null) {
    return { linkStatus: 'unknown', ok: false, conclusive: false, reason: probe.errorCode ?? 'no response' };
  }
  const s = probe.status;
  if (s >= 200 && s < 300) {
    const gone = probe.finalUrl ? goneRedirect(url, probe.finalUrl) : null;
    if (gone) return { linkStatus: 'redirected', ok: false, conclusive: true, reason: gone };
    return { linkStatus: 'ok', ok: true, conclusive: true, reason: null };
  }
  if (s === 404 || s === 410) return { linkStatus: 'dead', ok: false, conclusive: true, reason: `HTTP ${s}` };
  return { linkStatus: 'unknown', ok: false, conclusive: false, reason: `HTTP ${s}` };
}

export interface StoredCheck {
  ok: boolean;
  statusCode: number | null;
  error: string | null;
}

/** A stored link_checks row that was a conclusive failure. */
export function isConclusiveFailure(c: StoredCheck): boolean {
  if (c.ok) return false;
  return c.statusCode === 404 || c.statusCode === 410 || (c.error ?? '').startsWith(GONE_PREFIX);
}

/** Conclusive failures in a row, newest first; inconclusive checks are skipped, an ok check stops. */
export function failureStreak(checksNewestFirst: readonly StoredCheck[]): number {
  let n = 0;
  for (const c of checksNewestFirst) {
    if (c.ok) break;
    if (isConclusiveFailure(c)) n++;
  }
  return n;
}

/** Per-host pacing: reserves the next slot per host synchronously (safe with parallel workers). */
export class HostPacer {
  private readonly next = new Map<string, number>();
  constructor(
    private readonly delayMs: number,
    private readonly now: () => number,
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>,
  ) {}

  async wait(host: string, signal?: AbortSignal): Promise<void> {
    const t = this.now();
    const slot = Math.max(t, this.next.get(host) ?? 0);
    this.next.set(host, slot + this.delayMs);
    if (slot > t) await this.sleep(slot - t, signal);
  }
}

// ---- probing ----------------------------------------------------------------------------------

interface ProbeOutcome extends ProbeResult {
  error: string | null;
  durationMs: number;
}

const NO_RETRY_CODES = new Set(['invalid_url', 'blocked_scheme', 'blocked_credentials', 'blocked_host', 'blocked_ip', 'aborted']);

async function probeUrl(fetchFn: SafeFetchLike, url: string, opts: { timeoutMs: number; signal: AbortSignal }): Promise<ProbeOutcome> {
  const t0 = Date.now();
  const attempt = async (method: 'HEAD' | 'GET'): Promise<ProbeOutcome> => {
    try {
      const res = await fetchFn(url, {
        method,
        timeoutMs: opts.timeoutMs,
        maxRedirects: 5,
        maxBytes: LINKCHECK_MAX_BYTES,
        signal: opts.signal,
        headers: { accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
      });
      return { status: res.status, finalUrl: res.finalUrl, errorCode: null, error: null, durationMs: Date.now() - t0 };
    } catch (err) {
      const code = err instanceof SafeFetchError ? err.code : 'error';
      return { status: null, finalUrl: null, errorCode: code, error: errorText(err, 500), durationMs: Date.now() - t0 };
    }
  };
  const head = await attempt('HEAD');
  if (head.status !== null && head.status >= 200 && head.status < 300) return head;
  if (head.errorCode && NO_RETRY_CODES.has(head.errorCode)) return head;
  if (opts.signal.aborted) return head;
  // Many servers answer HEAD with 403/404/405 while GET works: GET decides.
  return attempt('GET');
}

// ---- candidates ---------------------------------------------------------------------------------

interface Candidate {
  id: number;
  applyUrl: string;
  state: string;
  linkStatus: LinkStatus;
}

async function candidates(db: Db, now: Date, batch: number): Promise<{ list: Candidate[]; recheckDead: number }> {
  const deadQuota = Math.max(1, Math.floor(batch * RECHECK_DEAD_SHARE));
  // Closed with a dead link, but a source listed it after the last check.
  const dead = await db
    .select({ id: jobs.id, applyUrl: jobs.applyUrl, state: jobs.state, linkStatus: jobs.linkStatus })
    .from(jobs)
    .where(
      and(
        eq(jobs.state, 'closed'),
        eq(jobs.linkStatus, 'dead'),
        isNull(jobs.mergedIntoJobId),
        exists(
          db
            .select({ one: sql`1` })
            .from(jobSources)
            .where(and(eq(jobSources.jobId, jobs.id), or(isNull(jobs.linkCheckedAt), gt(jobSources.lastSeenAt, jobs.linkCheckedAt)))),
        ),
      ),
    )
    .orderBy(asc(jobs.linkCheckedAt))
    .limit(deadQuota);
  const due = new Date(now.getTime() - RECHECK_AFTER_MS);
  const open = await db
    .select({ id: jobs.id, applyUrl: jobs.applyUrl, state: jobs.state, linkStatus: jobs.linkStatus })
    .from(jobs)
    .where(and(inArray(jobs.state, [...OPEN_STATES]), isNull(jobs.mergedIntoJobId), or(isNull(jobs.linkCheckedAt), lt(jobs.linkCheckedAt, due))))
    .orderBy(sql`${jobs.linkCheckedAt} IS NULL DESC`, desc(jobs.saved), asc(jobs.linkCheckedAt), asc(jobs.id))
    .limit(Math.max(0, batch - dead.length));
  return { list: [...dead, ...open], recheckDead: dead.length };
}

async function lastCloseReason(db: DbOrTx, jobId: number): Promise<string | null> {
  const [row] = await db
    .select({ v: jobChanges.newValue })
    .from(jobChanges)
    .where(and(eq(jobChanges.jobId, jobId), eq(jobChanges.field, 'close_reason')))
    .orderBy(desc(jobChanges.changedAt), desc(jobChanges.id))
    .limit(1);
  return row?.v ?? null;
}

// ---- run ----------------------------------------------------------------------------------------

interface LinkTally {
  candidates: number;
  recheckDead: number;
  probes: number;
  ok: number;
  failedOnce: number;
  dead: number;
  redirected: number;
  inconclusive: number;
  closed: number;
  reopened: number;
  writeErrors: number;
  byReason: Record<string, number>;
}

async function applyResult(db: Db, run: ActiveRun, job: Candidate, probe: ProbeOutcome, verdict: ProbeVerdict, now: Date, t: LinkTally): Promise<void> {
  await withTxRetry(db, async (tx) => {
    const previous = await tx
      .select({ ok: linkChecks.ok, statusCode: linkChecks.statusCode, error: linkChecks.error })
      .from(linkChecks)
      .where(eq(linkChecks.jobId, job.id))
      .orderBy(desc(linkChecks.checkedAt), desc(linkChecks.id))
      .limit(10);
    await tx.insert(linkChecks).values({
      jobId: job.id,
      url: job.applyUrl.slice(0, 2048),
      statusCode: probe.status,
      finalUrl: probe.finalUrl ? probe.finalUrl.slice(0, 2048) : null,
      ok: verdict.ok,
      durationMs: probe.durationMs,
      checkedAt: now,
      error: verdict.ok ? null : (verdict.reason?.startsWith(GONE_PREFIX) ? verdict.reason : (probe.error ?? verdict.reason))?.slice(0, 2000) ?? null,
    });
    if (verdict.ok) {
      await tx.update(jobs).set({ linkStatus: 'ok', linkCheckedAt: now, lastConfirmedLiveAt: now }).where(eq(jobs.id, job.id));
      if (job.state === 'closed' && (await lastCloseReason(tx, job.id)) === 'link_dead') {
        if (await reopenJob(tx, job.id, 'apply link works again', { now, runId: run.runId })) t.reopened++;
      }
      return;
    }
    if (!verdict.conclusive) {
      await tx.update(jobs).set({ linkCheckedAt: now }).where(eq(jobs.id, job.id));
      return;
    }
    const streak = failureStreak(previous) + 1;
    if (streak >= DEAD_AFTER_FAILURES) {
      t.dead++;
      await tx.update(jobs).set({ linkStatus: 'dead', linkCheckedAt: now }).where(eq(jobs.id, job.id));
      if (job.state !== 'closed' && (await closeJob(tx, job.id, 'link_dead', { now, runId: run.runId }))) t.closed++;
    } else {
      t.failedOnce++;
      await tx
        .update(jobs)
        .set({ linkStatus: verdict.linkStatus === 'redirected' ? 'redirected' : 'unknown', linkCheckedAt: now })
        .where(eq(jobs.id, job.id));
    }
  });
}

export function linkCheckStatus(t: Pick<LinkTally, 'probes' | 'inconclusive' | 'writeErrors'>, aborted: boolean): Exclude<RunStatus, 'queued' | 'running' | 'skipped'> {
  if (aborted) return 'failed';
  if (t.writeErrors > 0 && t.writeErrors >= t.probes) return 'failed';
  if (t.writeErrors > 0) return 'partial';
  // Nothing conclusive at all over a real batch: the network (or our egress) is the problem.
  if (t.probes >= 5 && t.inconclusive === t.probes) return 'partial';
  return 'ok';
}

/** Checks one batch of apply links. Never throws once the run row exists. */
export async function runLinkCheck(db: Db, opts: LinkCheckOptions = {}): Promise<LinkCheckResult> {
  const deps = opts.deps ?? {};
  const clock = deps.now ?? (() => new Date());
  const batch = Math.max(1, Math.min(2000, Math.floor(opts.batch ?? LINKCHECK_BATCH)));
  const begun = await beginRun(db, {
    kind: 'linkcheck',
    dryRun: false,
    requestedBy: opts.requestedBy ?? 'system',
    queuedRunId: opts.runId,
    lockName: LINKCHECK_LOCK,
    waitMs: 0,
    signal: opts.signal,
    deps: { now: deps.now, logger: deps.logger, heartbeatMs: deps.heartbeatMs },
    params: { batch },
  });
  if (!begun.started) return begun.outcome;
  const run = begun.run;
  const t: LinkTally = { candidates: 0, recheckDead: 0, probes: 0, ok: 0, failedOnce: 0, dead: 0, redirected: 0, inconclusive: 0, closed: 0, reopened: 0, writeErrors: 0, byReason: {} };
  let fatal: string | null = null;
  try {
    const storedBatch = typeof run.params.batch === 'number' && run.params.batch > 0 ? Math.min(2000, Math.floor(run.params.batch)) : batch;
    const fetchFn = deps.fetch ?? defaultSafeFetch;
    const pacer = new HostPacer(deps.hostDelayMs ?? HOST_DELAY_MS, () => clock().getTime(), deps.sleep ?? abortableSleep);
    const { list, recheckDead } = await candidates(db, run.now, storedBatch);
    t.candidates = list.length;
    t.recheckDead = recheckDead;
    await mapLimit(list, deps.concurrency ?? LINKCHECK_CONCURRENCY, async (job) => {
      if (run.signal.aborted) return;
      let host = 'invalid';
      try {
        host = new URL(job.applyUrl).host.toLowerCase();
      } catch {
        // invalid URL: probe fails fast with invalid_url
      }
      try {
        await pacer.wait(host, run.signal);
      } catch {
        return; // aborted
      }
      const probe = await probeUrl(fetchFn, job.applyUrl, { timeoutMs: deps.timeoutMs ?? LINKCHECK_TIMEOUT_MS, signal: run.signal });
      if (run.signal.aborted && probe.errorCode) return;
      const verdict = classifyProbe(job.applyUrl, probe);
      t.probes++;
      if (verdict.ok) t.ok++;
      else if (!verdict.conclusive) t.inconclusive++;
      if (verdict.linkStatus === 'redirected') t.redirected++;
      if (verdict.reason) {
        const key = verdict.reason.startsWith(GONE_PREFIX) ? 'gone_redirect' : verdict.reason;
        t.byReason[key] = (t.byReason[key] ?? 0) + 1;
      }
      try {
        await applyResult(db, run, job, probe, verdict, clock(), t);
      } catch (err) {
        t.writeErrors++;
        run.log.error('storing a link check failed', { jobId: job.id, error: errorText(err, 300) });
      }
    });
  } catch (err) {
    fatal = errorText(err, 2000);
    run.log.error('link check failed', { error: fatal });
  }
  try {
    const aborted = run.signal.aborted ? errorText(run.signal.reason ?? 'aborted', 500) : null;
    const status = fatal ? 'failed' : linkCheckStatus(t, !!aborted);
    const finishedAt = clock();
    const stats: Record<string, unknown> = {
      params: run.params,
      kind: 'linkcheck',
      status,
      startedAt: run.now.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - run.now.getTime()),
      ...t,
      aborted,
    };
    const error = fatal ?? aborted ?? (status === 'partial' ? (t.writeErrors ? `${t.writeErrors} results could not be stored` : 'no link could be checked conclusively') : null);
    try {
      await finishRun(db, run.runId, { status, stats, error, finishedAt });
    } catch (err) {
      run.log.error('storing the link check result failed', { error: errorText(err, 500) });
    }
    run.log.info('link check finished', { status, probes: t.probes, ok: t.ok, dead: t.dead, closed: t.closed, reopened: t.reopened, inconclusive: t.inconclusive });
    return { runId: run.runId, status, stats };
  } finally {
    await run.end();
  }
}
