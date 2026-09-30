/**
 * One source inside one run: fetch → per item (raw snapshot → parse → validate → normalise →
 * persist → follow-ups) → listing analysis (seen / canaries / missing / source-closed) → daily
 * checks and alerts → circuit breaker → baseline → checklist → source_runs row.
 *
 * Isolation: nothing in here throws. A failing source is recorded ('failed', alert) and the run
 * carries on with the other sources; a failing item is a dead letter and the source carries on.
 */
import { and, count, desc, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { deadLetters, rawSnapshots, sourceRuns, sources, type SourcePlatformRow, type SourceRow } from '../../../db/schema';
import type { SourceBaseline, SourceChecklist } from '../../../db/schema/sources';
import { emailConfig } from '../../alerts/email';
import { telegramCredentials } from '../../alerts/telegram';
import { isSeenOnly, isSourceClosed, type PipelineFetchContext } from '../../connectors';
import type { RawItem } from '../../contracts/jobs';
import { hashJson } from '../../hash';
import { DailyCapError, type PoliteHttpPool } from '../../http/polite';
import { HOUR_MS, utcDay } from '../../time';
import {
  autoTickChecklist,
  BASELINE_RUNS,
  breakerAfterRun,
  computeBaseline,
  healthyForMissing,
  isCircuitOpen,
  readChecklist,
  type BaselineSample,
  type ChecklistEvidence,
  type SourceOutcome,
} from '../health';
import { evaluateSourceHealth, MAX_EXTERNAL_ID, MIN_ITEMS_FOR_PARSE_CHECK, parseFailTooHigh, PresenceCounter, validateNormalizedJob } from '../quality';
import { emptyCounts, type SourceCounts, type SourceReport } from '../report';
import type { AnyConnector } from '../runtime';
import { runAlert } from './alerting';
import type { RunContext } from './context';
import { errorText, withRetry } from './dbutil';
import { recordDeadLetter, type DeadLetterStage } from './deadletters';
import { runFollowups } from './followups';
import { applySourceClosed, canariesMissing, confirmSeen, countMissing } from './listing';
import { prepareJob } from './normalise';
import { persistItem, type Grade } from './persist';
import { loadSourceState, saveSnapshot, type KnownItem } from './snapshot';

export interface SourceRuntime {
  ctx: RunContext;
  pool: PoliteHttpPool;
  platforms: ReadonlyMap<string, SourcePlatformRow>;
  connectorFor: (platformKey: string) => AnyConnector | null;
  clock: () => Date;
}

/** Parsed items needed before "parser handles samples" is ticked automatically. */
export const CHECKLIST_MIN_PARSED = 10;

/** ATS board slug from a connector config (company identity hint for the resolver). */
export function atsSlugFor(config: unknown): string | null {
  if (!config || typeof config !== 'object') return null;
  const c = config as Record<string, unknown>;
  for (const k of ['board', 'company', 'org', 'slug', 'companyId']) {
    const v = c[k];
    if (typeof v === 'string' && v.trim()) return v.trim().toLowerCase().slice(0, 191);
  }
  return null;
}

function validDate(d: unknown): Date | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

interface HealthJson {
  healthy?: unknown;
  listed?: unknown;
  presence?: unknown;
  freshnessHours?: unknown;
}

function sampleFrom(flags: unknown): BaselineSample | null {
  if (!flags || typeof flags !== 'object') return null;
  const f = flags as HealthJson;
  if (f.healthy !== true || typeof f.listed !== 'number') return null;
  const presence =
    f.presence && typeof f.presence === 'object'
      ? Object.fromEntries(Object.entries(f.presence as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === 'number'))
      : null;
  return { volume: f.listed, presence, freshnessHours: typeof f.freshnessHours === 'number' ? f.freshnessHours : null };
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function newReport(source: SourceRow): SourceReport {
  return {
    sourceId: source.id,
    sourceKey: source.sourceKey,
    label: source.label,
    platformKey: source.platformKey,
    status: 'ok',
    reason: null,
    error: null,
    listing: null,
    completeListing: false,
    partialReason: null,
    healthy: false,
    healthReason: null,
    canariesMissing: false,
    massCloseBlocked: false,
    flags: {},
    counts: emptyCounts(),
    durationMs: 0,
    breaker: null,
    checklistTicked: [],
    filterReasons: {},
  };
}

/** externalId → content hash of the payload its open dead letter holds (repeat-failure detection). */
async function openFailureHashes(db: RunContext['db'], sourceId: number): Promise<Map<string, string>> {
  const rows = await db
    .select({ externalId: deadLetters.externalId, hash: rawSnapshots.contentHash })
    .from(deadLetters)
    .innerJoin(rawSnapshots, eq(rawSnapshots.id, deadLetters.rawSnapshotId))
    .where(and(eq(deadLetters.sourceId, sourceId), inArray(deadLetters.status, ['open', 'retried']), isNotNull(deadLetters.externalId)));
  const out = new Map<string, string>();
  for (const r of rows) if (r.externalId) out.set(r.externalId, r.hash);
  return out;
}

/**
 * Source status from the item counts.
 * - failed: ≥ 5 items attempted and none parsed — when ≥ 5 of them are new / changed payloads, or
 *   nothing of the listing is known-good (no unchanged postings), i.e. the parser is broken.
 * - partial: every new / changed payload failed (≥ 2), or their failure share ≥ parseFailPct.
 * Repeat failures (the same payload failed before and is still a dead letter) are left out of the
 * shares, so one permanently broken posting does not keep the source from counting absence
 * forever. Failing postings that are already jobs are still confirmed as listed (never closed).
 */
export function itemStatus(
  c: Pick<SourceCounts, 'attempted' | 'parsed' | 'unchanged' | 'failedParse' | 'failedValidate' | 'failedNormalize' | 'failedPersist' | 'repeatFailures'>,
  parseFailPct: number,
): { status: 'ok' | 'partial' | 'failed'; error: string | null } {
  const failures = c.failedParse + c.failedValidate + c.failedNormalize + c.failedPersist;
  const freshAttempted = Math.max(0, c.attempted - c.repeatFailures);
  const freshFailures = Math.max(0, failures - c.repeatFailures);
  if (c.attempted >= MIN_ITEMS_FOR_PARSE_CHECK && c.parsed === 0 && (freshAttempted >= MIN_ITEMS_FOR_PARSE_CHECK || c.unchanged === 0)) {
    return { status: 'failed', error: `every item failed to parse (${failures} of ${c.attempted})` };
  }
  if (freshAttempted >= 2 && freshFailures === freshAttempted) return { status: 'partial', error: `all ${freshAttempted} new or changed items failed (see dead letters)` };
  if (parseFailTooHigh(freshAttempted, freshFailures, parseFailPct)) return { status: 'partial', error: `${freshFailures} of ${freshAttempted} new or changed items failed (see dead letters)` };
  return { status: 'ok', error: null };
}

/** Report for a source the run never started (aborted first). Writes nothing. */
export function notStartedReport(source: SourceRow, reason: string): SourceReport {
  const r = newReport(source);
  r.status = 'skipped';
  r.reason = reason;
  return r;
}

interface Working {
  report: SourceReport;
  presence: PresenceCounter;
  /** Whether the breaker should count this run (aborts and cap skips do not). */
  breakerOutcome: SourceOutcome;
  sourceRunId: number | null;
  baseline: SourceBaseline | null;
  healthExtra: Record<string, unknown>;
}

/** Runs one source. Never throws. */
export async function processSource(rt: SourceRuntime, source: SourceRow): Promise<SourceReport> {
  const t0 = Date.now();
  const ctx = rt.ctx;
  const w: Working = {
    report: newReport(source),
    presence: new PresenceCounter(),
    breakerOutcome: 'skipped',
    sourceRunId: null,
    baseline: source.baselineJson ?? null,
    healthExtra: {},
  };
  const slog = ctx.log.child({ sourceId: source.id, source: source.sourceKey });
  const platform = rt.platforms.get(source.platformKey) ?? null;

  try {
    const connector = rt.connectorFor(source.platformKey);
    const skip = skipReason(rt, source, platform);
    if (skip) {
      w.report.status = 'skipped';
      w.report.reason = skip;
    } else if (!connector) {
      w.report.status = 'failed';
      w.report.error = `no connector for platform "${source.platformKey}"`;
      w.breakerOutcome = 'failed';
    } else {
      const parsedConfig = connector.configSchema.safeParse(source.configJson ?? {});
      if (!parsedConfig.success) {
        w.report.status = 'failed';
        w.report.error = `invalid source config: ${parsedConfig.error.issues.map((i) => `${i.path.join('.') || '(root)'} ${i.message}`).join('; ')}`.slice(0, 2000);
        w.breakerOutcome = 'failed';
      } else {
        if (!ctx.dryRun) {
          const [res] = await ctx.db.insert(sourceRuns).values({ runId: ctx.runId, sourceId: source.id, status: 'running', startedAt: rt.clock() });
          w.sourceRunId = Number(res.insertId);
        }
        await fetchAndProcess(rt, source, connector, parsedConfig.data, platform, w, slog);
      }
    }
  } catch (err) {
    const aborted = ctx.signal.aborted;
    const capped = err instanceof DailyCapError;
    w.report.status = capped ? 'skipped' : 'failed';
    w.report.reason = capped ? 'daily request cap reached' : w.report.reason;
    w.report.error = aborted ? `aborted: ${errorText(ctx.signal.reason ?? err, 500)}` : errorText(err);
    w.breakerOutcome = aborted || capped ? 'skipped' : 'failed';
    slog.warn('source run failed', { error: w.report.error });
  }

  try {
    await finishSource(rt, source, platform, w);
  } catch (err) {
    const msg = errorText(err, 500);
    slog.error('finishing the source run failed', { error: msg });
    w.report.error = w.report.error ? `${w.report.error}; finish: ${msg}` : `finish: ${msg}`;
    if (w.report.status === 'ok') w.report.status = 'partial';
  }
  w.report.durationMs = Date.now() - t0;
  if (w.sourceRunId !== null) {
    await ctx.db
      .update(sourceRuns)
      .set({ durationMs: w.report.durationMs })
      .where(eq(sourceRuns.id, w.sourceRunId))
      .catch(() => undefined);
  }
  return w.report;
}

function skipReason(rt: SourceRuntime, source: SourceRow, platform: SourcePlatformRow | null): string | null {
  const now = rt.ctx.now;
  if (isCircuitOpen(source, now)) return `circuit open until ${source.circuitOpenUntil?.toISOString()}`;
  if (platform?.termsStatus === 'forbidden') return `terms of platform "${platform.key}" forbid automated access`;
  if (platform && rt.pool.remaining(platform.key) <= 0) return 'daily request cap reached';
  return null;
}

async function fetchAndProcess(
  rt: SourceRuntime,
  source: SourceRow,
  connector: AnyConnector,
  config: unknown,
  platform: SourcePlatformRow | null,
  w: Working,
  slog: RunContext['log'],
): Promise<void> {
  const ctx = rt.ctx;
  const c = w.report.counts;
  const now = ctx.now;
  w.report.listing = connector.listing;

  const known = await loadSourceState(ctx.db, source.id);
  const failedBefore = await openFailureHashes(ctx.db, source.id);
  /** Repeat failures at parse / validate (for the parse-failure share). */
  let repeatParseFailures = 0;
  let partialReason: string | null = null;
  const fetchCtx: PipelineFetchContext = {
    source,
    http: rt.pool.forPlatform(source.platformKey, ctx.signal),
    signal: ctx.signal,
    log: (m: string) => slog.info(m),
    knownExternalIds: new Set(known.keys()),
    markListingPartial: (reason: string) => {
      partialReason ??= reason.slice(0, 500);
    },
  };
  const items: RawItem[] = await connector.fetch(fetchCtx);
  c.fetched = items.length;

  const grade: Grade = platform?.grade ?? connector.platform.grade;
  const atsSlug = connector.kind === 'ats' ? atsSlugFor(config) : null;
  const listedIds = new Set<string>();
  const closedIds: string[] = [];
  const toConfirm: KnownItem[] = [];
  /** Dry run: listed known items that would be re-processed (for the seen-set only). */
  const dryListed: KnownItem[] = [];
  const persistedJobIds = new Set<number>();

  const dead = async (stage: DeadLetterStage, externalId: string | null, error: string, payload: unknown, snapshotId: number | null, hash: string | null) => {
    c.deadLetters++;
    if (hash !== null && externalId !== null && failedBefore.get(externalId) === hash) {
      c.repeatFailures++;
      if (stage === 'parse' || stage === 'validate') repeatParseFailures++;
    }
    if (ctx.dryRun) return;
    try {
      await withRetry(() =>
        recordDeadLetter(ctx.db, { sourceId: source.id, runId: ctx.runId, rawSnapshotId: snapshotId, externalId, stage, error, payload, parserVersion: connector.version }),
      );
    } catch (err) {
      slog.error('recording a dead letter failed', { stage, error: errorText(err, 300) });
    }
  };

  for (const item of items) {
    if (ctx.signal.aborted) throw ctx.signal.reason instanceof Error ? ctx.signal.reason : new Error('run aborted');
    const externalId = typeof item.externalId === 'string' ? item.externalId.trim() : '';
    if (isSourceClosed(item)) {
      c.closedMarkers++;
      if (externalId) closedIds.push(externalId);
      continue;
    }
    if (!externalId || externalId.length > MAX_EXTERNAL_ID) {
      c.attempted++;
      c.failedValidate++;
      await dead('validate', externalId ? externalId.slice(0, 255) : null, externalId ? `external id longer than ${MAX_EXTERNAL_ID} chars` : 'external id is empty', item.payload, null, null);
      continue;
    }
    if (listedIds.has(externalId)) {
      c.duplicates++;
      continue;
    }
    listedIds.add(externalId);
    const k = known.get(externalId);

    if (isSeenOnly(item)) {
      c.seenOnly++;
      if (k) toConfirm.push(k);
      else c.deferred++;
      continue;
    }
    if (connector.prefilter) {
      const verdict = connector.prefilter(item, config);
      if (!verdict.keep) {
        c.filtered++;
        w.report.filterReasons[verdict.reason] = (w.report.filterReasons[verdict.reason] ?? 0) + 1;
        if (k) toConfirm.push(k);
        continue;
      }
    }

    const hash = hashJson(item.payload ?? null);
    if (k && k.snapshotHash === hash) {
      c.unchanged++;
      toConfirm.push(k);
      continue;
    }

    c.attempted++;
    const fetchedAt = validDate(item.fetchedAt) ?? now;
    let snapshotId: number | null = null;
    if (!ctx.dryRun) {
      const snap = await withRetry(() =>
        saveSnapshot(ctx.db, {
          sourceId: source.id,
          runId: ctx.runId,
          externalId,
          contentHash: hash,
          payload: item.payload ?? null,
          url: item.url ?? null,
          fetchedAt,
          parserVersion: connector.version,
        }),
      );
      snapshotId = snap.id;
      if (snap.created) c.snapshotsCreated++;
    }

    let parsed;
    try {
      parsed = connector.parse({ ...item, externalId }, { source });
    } catch (err) {
      c.failedParse++;
      if (k) toConfirm.push(k);
      await dead('parse', externalId, errorText(err), item.payload, snapshotId, hash);
      continue;
    }
    const v = validateNormalizedJob({ ...parsed, externalId }, now);
    if (!v.ok) {
      c.failedValidate++;
      if (k) toConfirm.push(k);
      await dead('validate', externalId, `${v.field}: ${v.error}`, item.payload, snapshotId, hash);
      continue;
    }
    c.parsed++;
    w.presence.add(v.job, fetchedAt);

    let prepared;
    try {
      prepared = prepareJob(v.job, source, {
        profile: ctx.settings.profile,
        titleOverrides: ctx.settings.titleOverrides,
        fx: ctx.fx,
        knownCountries: ctx.knownCountries,
        now,
      });
    } catch (err) {
      c.failedNormalize++;
      if (k) toConfirm.push(k);
      await dead('normalize', externalId, errorText(err), item.payload, snapshotId, hash);
      continue;
    }

    if (ctx.dryRun) {
      if (k) {
        c.updated++;
        dryListed.push(k);
      } else c.created++;
      continue;
    }

    let result;
    try {
      result = await persistItem(ctx, {
        source,
        grade,
        atsSlug,
        prepared,
        externalId,
        itemUrl: item.url ?? null,
        rawSnapshotId: snapshotId,
        known: k,
        seenAt: now,
      });
    } catch (err) {
      c.failedPersist++;
      if (k) toConfirm.push(k);
      slog.warn('persisting an item failed', { externalId, error: errorText(err, 500) });
      await dead('enrich', externalId, errorText(err), item.payload, snapshotId, hash);
      continue;
    }
    persistedJobIds.add(result.jobId);
    if (result.action === 'created') c.created++;
    else if (result.action === 'merged') c.merged++;
    else if (result.action === 'updated') c.updated++;
    else c.same++;
    if (result.reopened) c.reopened++;
    c.possibleDuplicates += result.possibleDuplicates;
    known.set(externalId, {
      jobSourceId: result.jobSourceId,
      jobId: result.jobId,
      rawSnapshotId: snapshotId,
      snapshotHash: hash,
      firstSeenAt: k?.firstSeenAt ?? now,
      lastSeenAt: now,
    });
    try {
      const f = await runFollowups(ctx.db, { result, titleRaw: prepared.titleRaw, lang: prepared.lang, now });
      if (f.aiQueued) c.aiQueued++;
      if (f.titleQueued) c.titleQueued++;
    } catch (err) {
      c.followupErrors++;
      slog.warn('follow-up (AI enqueue / title review) failed', { externalId, error: errorText(err, 300) });
    }
  }
  c.listed = listedIds.size;

  // ---- status of the fetch + items
  const r = w.report;
  const st = itemStatus(c, ctx.settings.alerts.parseFailPct);
  r.status = st.status;
  r.error = st.error;
  w.breakerOutcome = r.status;
  r.partialReason = partialReason;
  r.completeListing = connector.listing === 'full' && partialReason === null;

  // ---- listing analysis (a failure here leaves the stored items intact → 'partial')
  try {
    const confirmed = await confirmSeen(ctx, [...toConfirm, ...dryListed]);
    c.confirmed = toConfirm.length;
    c.reopened += confirmed.reopened;
    const seenJobIds = new Set<number>([...confirmed.jobIds, ...persistedJobIds]);

    if (r.completeListing && r.status === 'ok') {
      const canaries = await canariesMissing(ctx, source.id, listedIds);
      r.canariesMissing = canaries.missing;
      w.healthExtra.canaries = { checked: canaries.checked, missing: canaries.externalIds };
      if (canaries.missing) {
        await runAlert(
          ctx,
          {
            kind: 'canaries_missing',
            severity: 'warn',
            title: `${source.label}: all ${canaries.checked} long-lived postings vanished at once`,
            body:
              `Postings listed in the last healthy run (${canaries.externalIds.join(', ')}) are all absent. ` +
              'Absence is not counted this run (nothing closes). The source may have changed its ids or listing.',
            dedupeKey: `canaries:${source.id}`,
            entityType: 'source',
            entityId: source.id,
          },
          source.id,
        );
      }
    }
    const health = healthyForMissing({
      status: r.status,
      completeListing: r.completeListing,
      listed: c.listed,
      baseline: w.baseline,
      canariesMissing: r.canariesMissing,
    });
    r.healthy = health.healthy;
    r.healthReason = health.reason;
    if (health.healthy) {
      const m = await countMissing(ctx, { id: source.id, label: source.label }, listedIds, seenJobIds);
      c.missing = m.missing;
      c.missingIncremented = m.incremented;
      c.closedMissing = m.closed;
      r.massCloseBlocked = m.blocked;
      w.healthExtra.missing = { missing: m.missing, incremented: m.incremented, closed: m.closed, blocked: m.blocked, open: m.openBefore };
    }
    if (closedIds.length) {
      const sc = await applySourceClosed(ctx, known, closedIds);
      c.closedBySource = sc.closed;
      w.healthExtra.sourceClosed = sc;
    }
  } catch (err) {
    if (ctx.signal.aborted) throw err;
    r.status = r.status === 'failed' ? 'failed' : 'partial';
    r.error = `${r.error ? `${r.error}; ` : ''}listing analysis failed: ${errorText(err, 500)}`;
    r.healthy = false;
    slog.error('listing analysis failed', { error: errorText(err, 500) });
    w.breakerOutcome = r.status;
  }

  // ---- daily checks
  r.flags = evaluateSourceHealth({
    listed: c.listed,
    attempted: Math.max(0, c.attempted - c.repeatFailures),
    failedParse: Math.max(0, c.failedParse + c.failedValidate - repeatParseFailures),
    parsed: c.parsed,
    presence: w.presence.shares(),
    baseline: w.baseline,
    settings: ctx.settings.alerts,
    completeListing: r.completeListing && r.status !== 'failed',
  });
  await healthAlerts(ctx, source, r);
}

async function healthAlerts(ctx: RunContext, source: SourceRow, r: SourceReport): Promise<void> {
  const f = r.flags;
  const entity = { entityType: 'source', entityId: source.id } as const;
  if (f.volume_drop) {
    await runAlert(
      ctx,
      {
        kind: 'volume_drop',
        severity: 'warn',
        title: `${source.label}: only ${f.volume_drop.listed} postings listed (baseline minimum ${f.volume_drop.baselineMin})`,
        body: `The listing is more than ${f.volume_drop.thresholdPct}% below its normal range. Check the source before trusting absence.`,
        dedupeKey: `volume_drop:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }
  if (f.volume_spike) {
    await runAlert(
      ctx,
      {
        kind: 'volume_spike',
        severity: 'warn',
        title: `${source.label}: ${f.volume_spike.listed} postings listed (baseline maximum ${f.volume_spike.baselineMax})`,
        body: `The listing is more than ${f.volume_spike.thresholdPct}% above its normal range (feed change or duplicate listings?).`,
        dedupeKey: `volume_spike:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }
  if (f.parse_fail_pct !== undefined) {
    await runAlert(
      ctx,
      {
        kind: 'parse_failures',
        severity: 'warn',
        title: `${source.label}: ${pct(f.parse_fail_pct)} of processed items failed to parse`,
        body: `${r.counts.failedParse + r.counts.failedValidate} of ${r.counts.attempted} items went to the dead-letter store. The parser may need an update.`,
        dedupeKey: `parse_failures:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }
  if (f.schema_drift?.length) {
    await runAlert(
      ctx,
      {
        kind: 'schema_drift',
        severity: 'warn',
        title: `${source.label}: fields missing more often than usual (${f.schema_drift.map((d) => d.field).join(', ')})`,
        body: f.schema_drift.map((d) => `${d.field}: normally ${pct(d.baseline)}, now ${pct(d.current)}`).join('\n'),
        dedupeKey: `schema_drift:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }
}

async function finishSource(rt: SourceRuntime, source: SourceRow, platform: SourcePlatformRow | null, w: Working): Promise<void> {
  const ctx = rt.ctx;
  const r = w.report;
  const now = ctx.now;
  const entity = { entityType: 'source', entityId: source.id } as const;

  if (r.status === 'failed' && !ctx.signal.aborted) {
    await runAlert(
      ctx,
      {
        kind: 'source_failed',
        severity: 'warn',
        title: `${source.label}: source run failed`,
        body: r.error ?? 'unknown error',
        dedupeKey: `source_failed:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }

  // ---- circuit breaker
  const breaker = breakerAfterRun({ consecutiveFailures: source.consecutiveFailures, circuitOpenUntil: source.circuitOpenUntil }, w.breakerOutcome, now);
  r.breaker = {
    consecutiveFailures: breaker.consecutiveFailures,
    circuitOpenUntil: breaker.circuitOpenUntil ? breaker.circuitOpenUntil.toISOString() : null,
    opened: breaker.opened,
    recovered: breaker.recovered,
  };
  if (breaker.opened && breaker.openForMs !== null) {
    await runAlert(
      ctx,
      {
        kind: 'circuit_open',
        severity: 'critical',
        title: `${source.label}: paused for ${Math.round(breaker.openForMs / HOUR_MS)} h after ${breaker.consecutiveFailures} failed runs in a row`,
        body: `Last error: ${r.error ?? 'unknown'}\nThe source is skipped until ${breaker.circuitOpenUntil?.toISOString()}; each further failure doubles the pause.`,
        dedupeKey: `circuit:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }
  if (breaker.recovered) {
    await runAlert(
      ctx,
      {
        kind: 'source_recovered',
        severity: 'info',
        title: `${source.label}: working again after ${source.consecutiveFailures} failed runs`,
        dedupeKey: `recovered:${source.id}`,
        ...entity,
      },
      source.id,
    );
  }

  const presence = w.presence.shares();
  const freshnessHours = w.presence.freshnessHours();

  // ---- baseline from the last 14 healthy runs (this one included)
  let baseline = w.baseline;
  let baselineRuns = 0;
  if (r.healthy && !ctx.dryRun) {
    const rows = await ctx.db
      .select({ flags: sourceRuns.healthFlagsJson })
      .from(sourceRuns)
      .where(and(eq(sourceRuns.sourceId, source.id), eq(sourceRuns.status, 'ok'), ne(sourceRuns.runId, ctx.runId)))
      .orderBy(desc(sourceRuns.id))
      .limit(BASELINE_RUNS * 3);
    const samples: BaselineSample[] = [{ volume: r.counts.listed, presence, freshnessHours }];
    for (const row of rows) {
      const s = sampleFrom(row.flags);
      if (s) samples.push(s);
      if (samples.length >= BASELINE_RUNS) break;
    }
    baselineRuns = samples.length;
    const next = computeBaseline(samples);
    if (next) baseline = next;
  }

  // ---- checklist auto-tick
  let checklist: SourceChecklist | null = null;
  if (!ctx.dryRun && r.status !== 'skipped') {
    const current = readChecklist(source.checklistJson);
    const evidence: ChecklistEvidence = {};
    if (!current.terms_reviewed.done && platform?.termsStatus === 'allowed' && platform.termsReviewedAt) {
      evidence.terms_reviewed = `platform terms marked allowed (reviewed ${utcDay(platform.termsReviewedAt)})`;
    }
    if (!current.samples_saved.done) {
      const [row] = await ctx.db.select({ n: count() }).from(rawSnapshots).where(eq(rawSnapshots.sourceId, source.id));
      const n = Number(row?.n ?? 0);
      if (n > 0) evidence.samples_saved = `${n} raw snapshots stored`;
    }
    if (!current.parser_handles_samples.done && r.status === 'ok' && r.counts.parsed >= CHECKLIST_MIN_PARSED && r.flags.parse_fail_pct === undefined) {
      evidence.parser_handles_samples = `parsed ${r.counts.parsed} of ${r.counts.attempted} items without a parse-failure alert`;
    }
    if (!current.baseline_recorded.done && baseline) {
      evidence.baseline_recorded = `baseline ${baseline.volume_min}–${baseline.volume_max} postings from ${baselineRuns || 'earlier'} healthy runs`;
    }
    if (!current.rate_limit_set.done && platform && platform.rateLimitPerMin > 0 && platform.dailyCap > 0) {
      evidence.rate_limit_set = `${platform.rateLimitPerMin}/min, ${platform.dailyCap}/day`;
    }
    if (!current.alerts_configured.done) {
      const channels = [ctx.settings.alerts.telegram && telegramCredentials() ? 'Telegram' : null, ctx.settings.alerts.email && emailConfig() ? 'email' : null].filter(Boolean);
      if (channels.length) evidence.alerts_configured = `alerts pushed via ${channels.join(' + ')}`;
    }
    const tick = autoTickChecklist(source.checklistJson, evidence, now);
    if (tick.ticked.length) {
      checklist = tick.checklist;
      r.checklistTicked = tick.ticked;
    }
  }

  if (ctx.dryRun) return;

  // ---- sources row
  const ran = r.status === 'ok' || r.status === 'partial';
  await ctx.db
    .update(sources)
    .set({
      consecutiveFailures: breaker.consecutiveFailures,
      circuitOpenUntil: breaker.circuitOpenUntil,
      ...(r.status !== 'skipped' ? { lastRunAt: now } : {}),
      ...(ran ? { lastSuccessAt: now } : {}),
      ...(baseline !== w.baseline && baseline ? { baselineJson: baseline } : {}),
      ...(checklist ? { checklistJson: checklist } : {}),
    })
    .where(eq(sources.id, source.id));

  // ---- source_runs row (skipped sources get one too, so the UI shows why)
  const c = r.counts;
  const healthFlags = {
    healthy: r.healthy,
    healthReason: r.healthReason,
    listing: r.listing,
    complete: r.completeListing,
    partialReason: r.partialReason,
    listed: c.listed,
    presence,
    freshnessHours,
    ...r.flags,
    ...(r.canariesMissing ? { canaries_missing: true } : {}),
    ...(r.massCloseBlocked ? { mass_close_blocked: true } : {}),
    ...(r.reason ? { skipReason: r.reason } : {}),
    counts: Object.fromEntries(Object.entries(c).filter((e) => e[1] !== 0)),
    ...(Object.keys(r.filterReasons).length ? { filterReasons: r.filterReasons } : {}),
    ...w.healthExtra,
    ...(r.checklistTicked.length ? { checklistTicked: r.checklistTicked } : {}),
  };
  const values = {
    status: r.status,
    fetched: c.fetched,
    parsed: c.parsed,
    newCount: c.created,
    updatedCount: c.updated + c.merged + c.reopened,
    closedCount: c.closedMissing + c.closedBySource,
    failedParse: c.failedParse + c.failedValidate,
    error: r.error,
    healthFlagsJson: healthFlags,
    finishedAt: rt.clock(),
  };
  if (w.sourceRunId !== null) {
    await ctx.db.update(sourceRuns).set(values).where(eq(sourceRuns.id, w.sourceRunId));
  } else {
    const [res] = await ctx.db.insert(sourceRuns).values({ runId: ctx.runId, sourceId: source.id, startedAt: now, ...values });
    w.sourceRunId = Number(res.insertId);
  }
}
