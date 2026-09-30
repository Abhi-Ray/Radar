/**
 * "Didn't run" detection (spec §18) and the external dead-man's switch.
 *
 * - checkHeartbeat (hourly, in the worker): critical alert when no successful daily run finished
 *   within settings.alerts.heartbeatHours. Catches a worker that is alive but not completing runs.
 * - pingHealthcheck (after each successful daily run): GET HEALTHCHECK_PING_URL (healthchecks.io
 *   style). Catches a dead worker/server, which no in-process check can.
 */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { pipelineRuns } from '../../db/schema';
import type { DbOrTx } from '../db';
import { log } from '../log';
import { getSetting } from '../settings';
import { HOUR_MS } from '../time';
import { optionalEnv, safeErrorText, type AlertChannel } from './channels';
import { raiseAlert } from './index';

export const HEARTBEAT_DEDUPE_KEY = 'heartbeat:pipeline';

export interface HeartbeatResult {
  status: 'ok' | 'alerted' | 'no_reference';
  lastSuccessAt: Date | null;
  hoursSince: number | null;
  thresholdHours: number;
  alertId?: number;
}

export async function lastSuccessfulDailyRun(db: DbOrTx): Promise<Date | null> {
  const [row] = await db
    .select({ finishedAt: pipelineRuns.finishedAt })
    .from(pipelineRuns)
    .where(
      and(
        eq(pipelineRuns.kind, 'daily'),
        eq(pipelineRuns.dryRun, false),
        inArray(pipelineRuns.status, ['ok', 'partial']),
        isNotNull(pipelineRuns.finishedAt),
      ),
    )
    .orderBy(desc(pipelineRuns.finishedAt))
    .limit(1);
  return row?.finishedAt ?? null;
}

export interface CheckHeartbeatOptions {
  now?: Date;
  /** Reference when no daily run ever succeeded (the worker's start time). */
  since?: Date | null;
  channels?: readonly AlertChannel[];
}

export async function checkHeartbeat(db: DbOrTx, opts: CheckHeartbeatOptions = {}): Promise<HeartbeatResult> {
  const now = opts.now ?? new Date();
  const { heartbeatHours } = await getSetting(db, 'alerts');
  const lastSuccessAt = await lastSuccessfulDailyRun(db);
  const reference = lastSuccessAt ?? opts.since ?? null;
  if (!reference) return { status: 'no_reference', lastSuccessAt: null, hoursSince: null, thresholdHours: heartbeatHours };
  const hoursSince = Math.max(0, (now.getTime() - reference.getTime()) / HOUR_MS);
  if (hoursSince < heartbeatHours) return { status: 'ok', lastSuccessAt, hoursSince, thresholdHours: heartbeatHours };
  const rounded = Math.floor(hoursSince);
  const { alertId } = await raiseAlert(
    db,
    {
      kind: 'heartbeat',
      severity: 'critical',
      title: lastSuccessAt
        ? `Pipeline has not completed a daily run for ${rounded} h`
        : `Pipeline has not completed any daily run since the worker started ${rounded} h ago`,
      body: [
        lastSuccessAt ? `Last successful daily run finished ${lastSuccessAt.toISOString()}.` : 'No successful daily run on record.',
        `Threshold: ${heartbeatHours} h (settings → alerts → heartbeatHours).`,
        'Check the worker logs and the latest pipeline run on the System page.',
      ].join('\n'),
      dedupeKey: HEARTBEAT_DEDUPE_KEY,
      entityType: 'pipeline',
    },
    { now, channels: opts.channels },
  );
  return { status: 'alerted', lastSuccessAt, hoursSince, thresholdHours: heartbeatHours, alertId };
}

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/** Pings HEALTHCHECK_PING_URL. Never throws; returns whether the ping was accepted. */
export async function pingHealthcheck(opts: { url?: string | null; fetchImpl?: FetchLike } = {}): Promise<boolean> {
  const url = opts.url === undefined ? optionalEnv('HEALTHCHECK_PING_URL') : opts.url;
  if (!url) return false;
  const doFetch: FetchLike = opts.fetchImpl ?? ((u, i) => fetch(u, i));
  try {
    const res = await doFetch(url, { method: 'GET', signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'RADAR-worker' } });
    await res.body?.cancel().catch(() => undefined);
    if (!res.ok) {
      log.warn('heartbeat: healthcheck ping rejected', { status: res.status });
      return false;
    }
    return true;
  } catch (err) {
    // The ping URL often embeds a secret UUID: log only the error.
    log.warn('heartbeat: healthcheck ping failed', { error: safeErrorText(err) });
    return false;
  }
}
