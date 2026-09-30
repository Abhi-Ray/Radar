/**
 * Alerts (spec §18). Every alert is stored in-app; Telegram / email pushes are optional
 * (settings.alerts.telegram / .email + env credentials) and limited to settings.alerts.minSeverity.
 *
 * Dedupe: while an alert with the same dedupe key is unacknowledged it is bumped (occurrences,
 * last_raised_at, latest severity/title/body) instead of duplicated, and it is pushed to channels
 * at most once per 24 h — unless its severity escalates. After acknowledgement the next raise
 * starts a new row. Delivery attempts are recorded in sent_channels_json.
 */
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alerts } from '../../db/schema';
import { withTransaction, type DbOrTx } from '../db';
import { log, redactString } from '../log';
import { getSetting } from '../settings';
import { DAY_MS } from '../time';
import {
  appLink,
  MAX_SEND_RECORDS,
  readSentState,
  safeErrorText,
  SEVERITY_RANK,
  severityAtLeast,
  type AlertChannel,
  type AlertChannelName,
  type AlertMessage,
  type AlertSendRecord,
  type AlertSeverity,
  type SentChannelsState,
  emptySentState,
} from './channels';
import { emailChannel } from './email';
import { telegramChannel } from './telegram';

export type { AlertChannel, AlertChannelName, AlertMessage, AlertSeverity, SentChannelsState } from './channels';
export { severityAtLeast } from './channels';

/** Same key → no second push within this window (unless the severity escalates). */
export const ALERT_NOTIFY_WINDOW_MS = DAY_MS;

export const DEFAULT_ALERT_CHANNELS: readonly AlertChannel[] = [telegramChannel, emailChannel];

export interface RaiseAlertInput {
  kind: string;
  severity: AlertSeverity;
  title: string;
  body?: string | null;
  dedupeKey?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
}

export interface RaiseAlertOptions {
  now?: Date;
  /** Channel implementations (tests inject fakes). Default: Telegram + email. */
  channels?: readonly AlertChannel[];
  /** false = store only, never push. */
  notify?: boolean;
  /** Push even below settings.alerts.minSeverity (the digest has its own opt-in). */
  ignoreMinSeverity?: boolean;
  /** App path for the deep link in pushes. Default '/system'. */
  linkPath?: string;
}

export interface RaiseAlertResult {
  alertId: number;
  created: boolean;
  /** Channels that accepted the push during this call. */
  notified: AlertChannelName[];
}

interface StoredAlert {
  alertId: number;
  created: boolean;
  occurrences: number;
  sent: SentChannelsState;
}

function normalise(input: RaiseAlertInput) {
  const kind = input.kind.trim().slice(0, 64) || 'general';
  return {
    kind,
    title: redactString(input.title.trim()).slice(0, 255) || kind,
    body: input.body ? redactString(input.body).slice(0, 16_000) : null,
    dedupeKey: input.dedupeKey?.trim().slice(0, 191) || null,
    entityType: input.entityType?.trim().slice(0, 64) || null,
    entityId: input.entityId === null || input.entityId === undefined ? null : String(input.entityId).slice(0, 128),
  };
}

async function storeAlert(db: DbOrTx, input: RaiseAlertInput, now: Date): Promise<StoredAlert> {
  const a = normalise(input);
  return withTransaction(db, async (tx) => {
    if (a.dedupeKey) {
      const [open] = await tx
        .select({ id: alerts.id, occurrences: alerts.occurrences, sent: alerts.sentChannelsJson })
        .from(alerts)
        .where(and(eq(alerts.dedupeKey, a.dedupeKey), isNull(alerts.acknowledgedAt)))
        .orderBy(desc(alerts.id))
        .limit(1)
        .for('update');
      if (open) {
        await tx
          .update(alerts)
          .set({
            occurrences: sql`${alerts.occurrences} + 1`,
            lastRaisedAt: now,
            severity: input.severity,
            title: a.title,
            body: a.body,
            ...(a.entityType ? { entityType: a.entityType } : {}),
            ...(a.entityId ? { entityId: a.entityId } : {}),
          })
          .where(eq(alerts.id, open.id));
        return { alertId: open.id, created: false, occurrences: open.occurrences + 1, sent: readSentState(open.sent) };
      }
    }
    const sent = emptySentState();
    const [res] = await tx.insert(alerts).values({
      kind: a.kind,
      severity: input.severity,
      title: a.title,
      body: a.body,
      dedupeKey: a.dedupeKey,
      entityType: a.entityType,
      entityId: a.entityId,
      createdAt: now,
      lastRaisedAt: now,
      sentChannelsJson: sent,
    });
    return { alertId: Number(res.insertId), created: true, occurrences: 1, sent };
  });
}

/** Whether a (re-)raised alert should be pushed again (pure; exported for tests). */
export function shouldPush(
  stored: { created: boolean; sent: SentChannelsState },
  severity: AlertSeverity,
  now: Date,
  windowMs = ALERT_NOTIFY_WINDOW_MS,
): boolean {
  if (stored.created) return true;
  const last = stored.sent.lastNotifiedAt ? Date.parse(stored.sent.lastNotifiedAt) : NaN;
  if (!Number.isFinite(last) || now.getTime() - last >= windowMs) return true;
  const prev = stored.sent.lastNotifiedSeverity;
  return prev !== null && SEVERITY_RANK[severity] > SEVERITY_RANK[prev];
}

/**
 * Stores (or bumps) an alert and pushes it to the configured channels. The result keeps the
 * foundation contract `{ alertId, created }`; use `raiseAlertAndNotify` to learn which channels
 * accepted the push.
 */
export async function raiseAlert(db: DbOrTx, input: RaiseAlertInput, opts: RaiseAlertOptions = {}): Promise<{ alertId: number; created: boolean }> {
  const { alertId, created } = await raiseAlertAndNotify(db, input, opts);
  return { alertId, created };
}

/** `raiseAlert` plus the list of channels that accepted the push during this call. */
export async function raiseAlertAndNotify(db: DbOrTx, input: RaiseAlertInput, opts: RaiseAlertOptions = {}): Promise<RaiseAlertResult> {
  const now = opts.now ?? new Date();
  const stored = await storeAlert(db, input, now);
  const result: RaiseAlertResult = { alertId: stored.alertId, created: stored.created, notified: [] };
  if (opts.notify === false) return result;

  const settings = await getSetting(db, 'alerts');
  if (!opts.ignoreMinSeverity && !severityAtLeast(input.severity, settings.minSeverity)) return result;
  if (!shouldPush(stored, input.severity, now)) return result;
  const channels = (opts.channels ?? DEFAULT_ALERT_CHANNELS).filter((c) => settings[c.name] && c.isConfigured());
  if (channels.length === 0) return result;

  const a = normalise(input);
  const msg: AlertMessage = {
    alertId: stored.alertId,
    kind: a.kind,
    severity: input.severity,
    title: a.title,
    body: a.body,
    occurrences: stored.occurrences,
    url: appLink(opts.linkPath ?? '/system'),
  };
  const records: AlertSendRecord[] = [];
  for (const channel of channels) {
    const at = new Date().toISOString();
    try {
      await channel.send(msg);
      records.push({ channel: channel.name, at, ok: true, severity: input.severity });
      result.notified.push(channel.name);
    } catch (err) {
      const error = safeErrorText(err);
      records.push({ channel: channel.name, at, ok: false, severity: input.severity, error });
      log.warn('alerts: channel send failed', { channel: channel.name, alertId: stored.alertId, error });
    }
  }
  const next: SentChannelsState = {
    inApp: true,
    lastNotifiedAt: result.notified.length > 0 ? now.toISOString() : stored.sent.lastNotifiedAt,
    lastNotifiedSeverity: result.notified.length > 0 ? input.severity : stored.sent.lastNotifiedSeverity,
    sends: [...stored.sent.sends, ...records].slice(-MAX_SEND_RECORDS),
  };
  await db.update(alerts).set({ sentChannelsJson: next }).where(eq(alerts.id, stored.alertId));
  return result;
}
