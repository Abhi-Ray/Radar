/**
 * Reprocess from raw: re-derive jobs from the stored raw snapshots with the current parsers and
 * logic (parser fix, new title rules, new scoring weights) — no network.
 *
 * Pass 1 retries open dead letters that point at a stored snapshot (the newest one per item), so
 * a parser fix turns failures into jobs. Pass 2 re-runs every posting's current snapshot
 * (job_sources.raw_snapshot_id), skipping items pass 1 already handled.
 *
 * Forced mode (see RunContext.forced): nothing was fetched, so last-seen, missing counts and
 * reopening are left alone and no source_runs rows are written. Same snapshots + same logic →
 * same jobs, facts and scores (reproducible); the run row records every logic version.
 */
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, type SQL } from 'drizzle-orm';
import { deadLetters, jobSources, rawSnapshots, sourcePlatforms, sources, type SourcePlatformRow, type SourceRow } from '../../db/schema';
import { DEFAULT_ALERT_CHANNELS } from '../alerts';
import { getConnector } from '../connectors';
import type { RawItem } from '../contracts/jobs';
import type { Db } from '../db';
import { PIPELINE_LOCK } from './lock';
import type { RunRequester } from './queue';
import type { RunStatus } from './report';
import { beginRun, finishRun, loadRunSettings, type ActiveRun, type AnyConnector, type PipelineDeps } from './runtime';
import type { RunContext } from './stages/context';
import { errorText, withRetry } from './stages/dbutil';
import { recordDeadLetter, type DeadLetterStage } from './stages/deadletters';
import { runFollowups } from './stages/followups';
import { prepareJob } from './stages/normalise';
import { persistItem, type Grade } from './stages/persist';
import { snapshotPayload, type KnownItem } from './stages/snapshot';
import { atsSlugFor } from './stages/source';
import { validateNormalizedJob } from './quality';

export interface ReprocessResult {
  runId: number | null;
  reprocessed: number;
  failed: number;
  status: RunStatus;
  stats: Record<string, unknown>;
}

export interface ReprocessOptions {
  sourceIds?: number[];
  /** Only snapshots fetched at or after this time. */
  since?: Date;
  /** Execute this queued pipeline_runs row. */
  runId?: number;
  requestedBy?: RunRequester;
  signal?: AbortSignal;
  deps?: PipelineDeps;
}

export const REPROCESS_BATCH = 200;

interface SourceTally {
  reprocessed: number;
  failed: number;
  skipped: number;
}

interface Tally {
  reprocessed: number;
  failed: number;
  created: number;
  merged: number;
  updated: number;
  same: number;
  reopened: number;
  aiQueued: number;
  titleQueued: number;
  followupErrors: number;
  deadLettersRetried: number;
  deadLettersResolved: number;
  /** Items skipped in pass 2 because their newer snapshot still fails (kept as a dead letter). */
  skippedStillFailing: number;
  skippedNoConnector: number;
  bySource: Record<string, SourceTally>;
  failures: { sourceId: number; externalId: string; stage: string; error: string }[];
}

function emptyTally(): Tally {
  return {
    reprocessed: 0,
    failed: 0,
    created: 0,
    merged: 0,
    updated: 0,
    same: 0,
    reopened: 0,
    aiQueued: 0,
    titleQueued: 0,
    followupErrors: 0,
    deadLettersRetried: 0,
    deadLettersResolved: 0,
    skippedStillFailing: 0,
    skippedNoConnector: 0,
    bySource: {},
    failures: [],
  };
}

export function reprocessStatus(t: Pick<Tally, 'reprocessed' | 'failed'>, aborted: boolean): Exclude<RunStatus, 'queued' | 'running' | 'skipped'> {
  if (aborted) return 'failed';
  if (t.failed > 0 && t.reprocessed === 0) return 'failed';
  if (t.failed > 0) return 'partial';
  return 'ok';
}

const itemKey = (sourceId: number, externalId: string) => `${sourceId}\u0000${externalId}`;

interface Work {
  source: SourceRow;
  connector: AnyConnector;
  grade: Grade;
  atsSlug: string | null;
  snapshot: { id: number; payload: string; url: string | null; fetchedAt: Date };
  externalId: string;
  known: KnownItem | undefined;
  /** Pass 1: point job_sources at this (newer) snapshot on success. */
  adoptSnapshot: boolean;
}

class Reprocessor {
  readonly tally = emptyTally();
  private readonly sourceCache = new Map<number, SourceRow | null>();

  constructor(
    private readonly ctx: RunContext,
    private readonly platforms: ReadonlyMap<string, SourcePlatformRow>,
    private readonly connectorFor: (platformKey: string) => AnyConnector | null,
  ) {}

  private bump(sourceId: number, k: keyof SourceTally) {
    const s = (this.tally.bySource[String(sourceId)] ??= { reprocessed: 0, failed: 0, skipped: 0 });
    s[k]++;
  }

  async source(id: number): Promise<SourceRow | null> {
    if (!this.sourceCache.has(id)) {
      const [row] = await this.ctx.db.select().from(sources).where(eq(sources.id, id)).limit(1);
      this.sourceCache.set(id, row ?? null);
    }
    return this.sourceCache.get(id) ?? null;
  }

  work(source: SourceRow, externalId: string, snapshot: Work['snapshot'], known: KnownItem | undefined, adoptSnapshot: boolean): Work | null {
    const connector = this.connectorFor(source.platformKey);
    if (!connector) {
      this.tally.skippedNoConnector++;
      this.bump(source.id, 'skipped');
      return null;
    }
    const parsedConfig = connector.configSchema.safeParse(source.configJson ?? {});
    return {
      source,
      connector,
      grade: this.platforms.get(source.platformKey)?.grade ?? connector.platform.grade,
      atsSlug: connector.kind === 'ats' && parsedConfig.success ? atsSlugFor(parsedConfig.data) : null,
      snapshot,
      externalId,
      known,
      adoptSnapshot,
    };
  }

  private async fail(w: Work, stage: DeadLetterStage, error: string, payload: unknown): Promise<false> {
    this.tally.failed++;
    this.bump(w.source.id, 'failed');
    if (this.tally.failures.length < 50) this.tally.failures.push({ sourceId: w.source.id, externalId: w.externalId, stage, error: error.slice(0, 300) });
    try {
      await withRetry(() =>
        recordDeadLetter(this.ctx.db, {
          sourceId: w.source.id,
          runId: this.ctx.runId,
          rawSnapshotId: w.snapshot.id,
          externalId: w.externalId,
          stage,
          error,
          payload,
          parserVersion: w.connector.version,
        }),
      );
    } catch (err) {
      this.ctx.log.error('recording a dead letter failed', { stage, error: errorText(err, 300) });
    }
    return false;
  }

  /** Re-derives one item. true = stored. */
  async process(w: Work): Promise<boolean> {
    const ctx = this.ctx;
    let payload: unknown;
    try {
      payload = snapshotPayload(w.snapshot.payload);
    } catch (err) {
      return this.fail(w, 'parse', `stored snapshot is not valid JSON: ${errorText(err, 300)}`, w.snapshot.payload);
    }
    const item: RawItem = { externalId: w.externalId, payload, url: w.snapshot.url ?? undefined, fetchedAt: w.snapshot.fetchedAt };
    let parsed;
    try {
      parsed = w.connector.parse(item, { source: w.source });
    } catch (err) {
      return this.fail(w, 'parse', errorText(err), payload);
    }
    const v = validateNormalizedJob({ ...parsed, externalId: w.externalId }, ctx.now);
    if (!v.ok) return this.fail(w, 'validate', `${v.field}: ${v.error}`, payload);
    let prepared;
    try {
      prepared = prepareJob(v.job, w.source, {
        profile: ctx.settings.profile,
        titleOverrides: ctx.settings.titleOverrides,
        fx: ctx.fx,
        knownCountries: ctx.knownCountries,
        now: ctx.now,
      });
    } catch (err) {
      return this.fail(w, 'normalize', errorText(err), payload);
    }
    let result;
    try {
      result = await persistItem(ctx, {
        source: w.source,
        grade: w.grade,
        atsSlug: w.atsSlug,
        prepared,
        externalId: w.externalId,
        itemUrl: w.snapshot.url,
        rawSnapshotId: w.adoptSnapshot ? w.snapshot.id : null,
        known: w.known,
        seenAt: w.snapshot.fetchedAt,
      });
    } catch (err) {
      return this.fail(w, 'enrich', errorText(err), payload);
    }
    const t = this.tally;
    t.reprocessed++;
    this.bump(w.source.id, 'reprocessed');
    t[result.action]++;
    if (result.reopened) t.reopened++;
    try {
      const f = await runFollowups(ctx.db, { result, titleRaw: prepared.titleRaw, lang: prepared.lang, now: ctx.now });
      if (f.aiQueued) t.aiQueued++;
      if (f.titleQueued) t.titleQueued++;
    } catch (err) {
      t.followupErrors++;
      ctx.log.warn('follow-up failed during reprocess', { externalId: w.externalId, error: errorText(err, 300) });
    }
    return true;
  }
}

function snapshotConds(opts: { sourceIds?: number[]; since?: Date }, sourceCol: typeof jobSources.sourceId | typeof deadLetters.sourceId): SQL[] {
  const conds: SQL[] = [];
  if (opts.sourceIds?.length) conds.push(inArray(sourceCol, opts.sourceIds));
  if (opts.since) conds.push(gte(rawSnapshots.fetchedAt, opts.since));
  return conds;
}

async function knownFor(db: Db, sourceId: number, externalId: string): Promise<KnownItem | undefined> {
  const [row] = await db
    .select({
      jobSourceId: jobSources.id,
      jobId: jobSources.jobId,
      rawSnapshotId: jobSources.rawSnapshotId,
      firstSeenAt: jobSources.firstSeenAt,
      lastSeenAt: jobSources.lastSeenAt,
      snapshotHash: rawSnapshots.contentHash,
    })
    .from(jobSources)
    .leftJoin(rawSnapshots, eq(rawSnapshots.id, jobSources.rawSnapshotId))
    .where(and(eq(jobSources.sourceId, sourceId), eq(jobSources.externalId, externalId)))
    .limit(1);
  return row ? { ...row, snapshotHash: row.snapshotHash ?? null } : undefined;
}

async function execute(db: Db, run: ActiveRun, opts: { sourceIds?: number[]; since?: Date; deps: PipelineDeps }): Promise<{ tally: Tally; fatal: string | null }> {
  const loaded = await loadRunSettings(db);
  const ctx: RunContext = {
    db,
    runId: run.runId,
    kind: 'reprocess',
    dryRun: false,
    forced: true,
    now: run.now,
    settings: loaded.settings,
    fx: loaded.fx,
    knownCountries: loaded.knownCountries,
    signal: run.signal,
    channels: opts.deps.channels ?? DEFAULT_ALERT_CHANNELS,
    log: run.log,
    missingIncremented: new Set(),
    alerts: [],
    ruleCache: new Map(),
  };
  const platforms = new Map((await db.select().from(sourcePlatforms)).map((p) => [p.key, p]));
  const rp = new Reprocessor(ctx, platforms, opts.deps.connectors ?? getConnector);
  const t = rp.tally;
  const handled = new Set<string>();
  const stillFailing = new Set<string>();

  // ---- pass 1: open dead letters with a stored snapshot (newest per item)
  const letters = await db
    .select({
      sourceId: deadLetters.sourceId,
      externalId: deadLetters.externalId,
      snapshotId: rawSnapshots.id,
    })
    .from(deadLetters)
    .innerJoin(rawSnapshots, eq(rawSnapshots.id, deadLetters.rawSnapshotId))
    .where(and(inArray(deadLetters.status, ['open', 'retried']), isNotNull(deadLetters.externalId), isNotNull(deadLetters.sourceId), ...snapshotConds(opts, deadLetters.sourceId)))
    .orderBy(desc(rawSnapshots.id));
  for (const l of letters) {
    if (run.signal.aborted) break;
    if (l.sourceId === null || l.externalId === null) continue;
    const key = itemKey(l.sourceId, l.externalId);
    if (handled.has(key)) continue;
    handled.add(key);
    const source = await rp.source(l.sourceId);
    if (!source) continue;
    const known = await knownFor(db, l.sourceId, l.externalId);
    // A dead letter older than the posting's current snapshot is covered by pass 2.
    if (known?.rawSnapshotId && known.rawSnapshotId >= l.snapshotId) {
      handled.delete(key);
      continue;
    }
    const [snap] = await db
      .select({ id: rawSnapshots.id, payload: rawSnapshots.payload, url: rawSnapshots.url, fetchedAt: rawSnapshots.fetchedAt })
      .from(rawSnapshots)
      .where(eq(rawSnapshots.id, l.snapshotId))
      .limit(1);
    if (!snap) continue;
    const w = rp.work(source, l.externalId, snap, known, true);
    if (!w) continue;
    t.deadLettersRetried++;
    if (await rp.process(w)) t.deadLettersResolved++;
    else stillFailing.add(key);
  }

  // ---- pass 2: every posting's current snapshot
  let lastId = 0;
  for (;;) {
    if (run.signal.aborted) break;
    const rows = await db
      .select({
        jobSourceId: jobSources.id,
        jobId: jobSources.jobId,
        sourceId: jobSources.sourceId,
        externalId: jobSources.externalId,
        firstSeenAt: jobSources.firstSeenAt,
        lastSeenAt: jobSources.lastSeenAt,
        snapshotId: rawSnapshots.id,
        contentHash: rawSnapshots.contentHash,
        payload: rawSnapshots.payload,
        url: rawSnapshots.url,
        fetchedAt: rawSnapshots.fetchedAt,
      })
      .from(jobSources)
      .innerJoin(rawSnapshots, eq(rawSnapshots.id, jobSources.rawSnapshotId))
      .where(and(gt(jobSources.id, lastId), ...snapshotConds(opts, jobSources.sourceId)))
      .orderBy(asc(jobSources.id))
      .limit(REPROCESS_BATCH);
    if (!rows.length) break;
    lastId = rows[rows.length - 1].jobSourceId;
    for (const r of rows) {
      if (run.signal.aborted) break;
      const key = itemKey(r.sourceId, r.externalId);
      if (stillFailing.has(key)) {
        t.skippedStillFailing++;
        continue;
      }
      if (handled.has(key)) continue;
      const source = await rp.source(r.sourceId);
      if (!source) continue;
      const known: KnownItem = {
        jobSourceId: r.jobSourceId,
        jobId: r.jobId,
        rawSnapshotId: r.snapshotId,
        snapshotHash: r.contentHash,
        firstSeenAt: r.firstSeenAt,
        lastSeenAt: r.lastSeenAt,
      };
      const w = rp.work(source, r.externalId, { id: r.snapshotId, payload: r.payload, url: r.url, fetchedAt: r.fetchedAt }, known, false);
      if (w) await rp.process(w);
    }
  }
  return { tally: t, fatal: null };
}

/** Re-derives jobs from stored raw snapshots (see the module comment). Never throws once the run row exists. */
export async function reprocessFromRaw(db: Db, opts: ReprocessOptions = {}): Promise<ReprocessResult> {
  const deps = opts.deps ?? {};
  const clock = deps.now ?? (() => new Date());
  const sourceIds = opts.sourceIds?.filter((n) => Number.isSafeInteger(n) && n > 0);
  const since = opts.since && !Number.isNaN(opts.since.getTime()) ? opts.since : undefined;
  const begun = await beginRun(db, {
    kind: 'reprocess',
    dryRun: false,
    requestedBy: opts.requestedBy ?? 'system',
    queuedRunId: opts.runId,
    lockName: PIPELINE_LOCK,
    waitMs: deps.lockWaitMs ?? 0,
    signal: opts.signal,
    deps,
    params: { ...(sourceIds?.length ? { sourceIds } : {}), ...(since ? { since: since.toISOString() } : {}) },
  });
  if (!begun.started) return { runId: begun.outcome.runId, reprocessed: 0, failed: 0, status: begun.outcome.status, stats: begun.outcome.stats };
  const run = begun.run;
  try {
    // A queued reprocess carries its params in the row.
    const p = run.params as { sourceIds?: unknown; since?: unknown };
    const ids = Array.isArray(p.sourceIds) ? p.sourceIds.filter((n): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n > 0) : undefined;
    const sinceParam = typeof p.since === 'string' && !Number.isNaN(Date.parse(p.since)) ? new Date(p.since) : since;
    let tally = emptyTally();
    let fatal: string | null = null;
    try {
      ({ tally, fatal } = await execute(db, run, { sourceIds: ids?.length ? ids : undefined, since: sinceParam, deps }));
    } catch (err) {
      fatal = errorText(err, 2000);
      run.log.error('reprocess failed', { error: fatal });
    }
    const aborted = run.signal.aborted ? errorText(run.signal.reason ?? 'aborted', 500) : null;
    const status = fatal ? 'failed' : reprocessStatus(tally, !!aborted);
    const finishedAt = clock();
    const stats: Record<string, unknown> = {
      params: run.params,
      kind: 'reprocess',
      status,
      startedAt: run.now.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: Math.max(0, finishedAt.getTime() - run.now.getTime()),
      ...tally,
      aborted,
    };
    const error = fatal ?? aborted ?? (tally.failed ? `${tally.failed} items failed (see dead letters)` : null);
    try {
      await finishRun(db, run.runId, { status, stats, error, finishedAt });
    } catch (err) {
      run.log.error('storing the reprocess result failed', { error: errorText(err, 500) });
    }
    run.log.info('reprocess finished', { status, reprocessed: tally.reprocessed, failed: tally.failed, deadLettersResolved: tally.deadLettersResolved });
    return { runId: run.runId, reprocessed: tally.reprocessed, failed: tally.failed, status, stats };
  } finally {
    await run.end();
  }
}
