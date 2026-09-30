/**
 * Alert channel plumbing shared by the Telegram and email senders. Every alert is always stored
 * in-app (the `alerts` row); channels are optional pushes on top, opted in via settings.alerts and
 * enabled only when their env credentials exist.
 */
import type { ALERT_SEVERITIES } from '../../db/schema/_enums';
import { getEnvVar } from '../env';
import { redactString } from '../log';

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];
export type AlertChannelName = 'telegram' | 'email';

export const SEVERITY_RANK: Readonly<Record<AlertSeverity, number>> = { info: 0, warn: 1, critical: 2 };

export function severityAtLeast(severity: AlertSeverity, min: AlertSeverity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK[min];
}

export interface AlertMessage {
  alertId: number;
  kind: string;
  severity: AlertSeverity;
  title: string;
  body: string | null;
  occurrences: number;
  /** Deep link into the app (null when APP_URL is not configured). */
  url: string | null;
}

export interface AlertChannel {
  readonly name: AlertChannelName;
  /** Env credentials present (the settings toggle is checked separately). */
  isConfigured(): boolean;
  send(msg: AlertMessage, signal?: AbortSignal): Promise<void>;
}

/** One delivery attempt recorded in alerts.sent_channels_json. */
export interface AlertSendRecord {
  channel: AlertChannelName;
  at: string;
  ok: boolean;
  severity: AlertSeverity;
  error?: string;
}

/** Shape of alerts.sent_channels_json. */
export interface SentChannelsState {
  inApp: true;
  /** Last time at least one channel accepted the alert. */
  lastNotifiedAt: string | null;
  lastNotifiedSeverity: AlertSeverity | null;
  /** Most recent attempts, newest last (bounded). */
  sends: AlertSendRecord[];
}

export const MAX_SEND_RECORDS = 20;

export function emptySentState(): SentChannelsState {
  return { inApp: true, lastNotifiedAt: null, lastNotifiedSeverity: null, sends: [] };
}

/** Tolerant reader for stored sent_channels_json (older rows may be null or malformed). */
export function readSentState(v: unknown): SentChannelsState {
  const out = emptySentState();
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  const r = v as Record<string, unknown>;
  if (typeof r.lastNotifiedAt === 'string') out.lastNotifiedAt = r.lastNotifiedAt;
  if (r.lastNotifiedSeverity === 'info' || r.lastNotifiedSeverity === 'warn' || r.lastNotifiedSeverity === 'critical') {
    out.lastNotifiedSeverity = r.lastNotifiedSeverity;
  }
  if (Array.isArray(r.sends)) {
    out.sends = r.sends
      .filter((s): s is AlertSendRecord => !!s && typeof s === 'object' && typeof (s as AlertSendRecord).channel === 'string')
      .slice(-MAX_SEND_RECORDS);
  }
  return out;
}

/** Reads an optional env var; an invalid value counts as unset (never throws, never echoes it). */
export function optionalEnv<K extends 'TELEGRAM_BOT_TOKEN' | 'TELEGRAM_CHAT_ID' | 'SMTP_URL' | 'ALERT_EMAIL_TO' | 'HEALTHCHECK_PING_URL' | 'APP_URL'>(
  key: K,
): string | null {
  try {
    const v = getEnvVar(key);
    return typeof v === 'string' && v.trim() ? v : null;
  } catch {
    return null;
  }
}

/** App deep link for an alert: `${APP_URL}${path}` or null. */
export function appLink(path: string): string | null {
  const base = optionalEnv('APP_URL');
  return base ? `${base.replace(/\/+$/, '')}${path}` : null;
}

const SEVERITY_LABEL: Readonly<Record<AlertSeverity, string>> = { info: 'INFO', warn: 'WARNING', critical: 'CRITICAL' };

/** Plain-text rendering used by every channel (secrets redacted, bounded). */
export function formatAlertText(msg: AlertMessage, maxLen = 3800): string {
  const head = `RADAR ${SEVERITY_LABEL[msg.severity]}: ${msg.title}`;
  const parts = [head];
  if (msg.occurrences > 1) parts.push(`(seen ${msg.occurrences} times)`);
  if (msg.body) parts.push('', msg.body);
  if (msg.url) parts.push('', msg.url);
  const text = redactString(parts.join('\n'));
  return text.length > maxLen ? `${text.slice(0, maxLen - 1)}…` : text;
}

export function formatAlertSubject(msg: AlertMessage): string {
  return redactString(`[RADAR ${SEVERITY_LABEL[msg.severity]}] ${msg.title}`).slice(0, 200);
}

/** Error text safe to store: redacted and short. */
export function safeErrorText(err: unknown): string {
  const m = err instanceof Error ? err.message : String(err);
  return redactString(m).slice(0, 300);
}
