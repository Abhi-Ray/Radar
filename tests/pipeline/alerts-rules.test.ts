/** Pure alert helpers: push dedupe window, severity, message formatting, digest rendering. */
import { describe, expect, it } from 'vitest';
import { formatAlertSubject, formatAlertText, readSentState, safeErrorText, severityAtLeast, type AlertMessage, type SentChannelsState } from '../../src/lib/alerts/channels';
import { digestDedupeKey, endOfLocalDay, localHour, renderDigest, type DigestContent } from '../../src/lib/alerts/digest';
import { senderFor } from '../../src/lib/alerts/email';
import { ALERT_NOTIFY_WINDOW_MS, shouldPush } from '../../src/lib/alerts';
import { HOUR_MS } from '../../src/lib/time';

const now = new Date('2026-09-30T06:30:00.000Z');

describe('shouldPush (24 h dedupe)', () => {
  const sent = (at: Date | null, severity: 'info' | 'warn' | 'critical' | null = 'warn'): SentChannelsState => ({
    inApp: true,
    lastNotifiedAt: at ? at.toISOString() : null,
    lastNotifiedSeverity: severity,
    sends: [],
  });

  it('pushes new alerts and re-raises after 24 h, not within', () => {
    expect(shouldPush({ created: true, sent: sent(null, null) }, 'info', now)).toBe(true);
    expect(shouldPush({ created: false, sent: sent(new Date(now.getTime() - HOUR_MS)) }, 'warn', now)).toBe(false);
    expect(shouldPush({ created: false, sent: sent(new Date(now.getTime() - ALERT_NOTIFY_WINDOW_MS)) }, 'warn', now)).toBe(true);
    // Never pushed before (no channel configured then): push now.
    expect(shouldPush({ created: false, sent: sent(null, null) }, 'warn', now)).toBe(true);
  });

  it('an escalated severity is pushed within the window', () => {
    expect(shouldPush({ created: false, sent: sent(new Date(now.getTime() - HOUR_MS), 'warn') }, 'critical', now)).toBe(true);
    expect(shouldPush({ created: false, sent: sent(new Date(now.getTime() - HOUR_MS), 'critical') }, 'warn', now)).toBe(false);
  });

  it('severity order', () => {
    expect(severityAtLeast('critical', 'warn')).toBe(true);
    expect(severityAtLeast('info', 'warn')).toBe(false);
    expect(severityAtLeast('warn', 'warn')).toBe(true);
  });
});

describe('stored delivery state', () => {
  it('tolerates null / malformed JSON and bounds the history', () => {
    expect(readSentState(null)).toEqual({ inApp: true, lastNotifiedAt: null, lastNotifiedSeverity: null, sends: [] });
    expect(readSentState([1, 2]).sends).toEqual([]);
    const many = Array.from({ length: 50 }, (_, i) => ({ channel: 'telegram', at: String(i), ok: true, severity: 'warn' }));
    const s = readSentState({ lastNotifiedAt: 'x', lastNotifiedSeverity: 'bogus', sends: [...many, 7, null] });
    expect(s.lastNotifiedSeverity).toBeNull();
    expect(s.sends.length).toBe(20);
  });
});

describe('message formatting', () => {
  const msg: AlertMessage = { alertId: 1, kind: 'source_failed', severity: 'critical', title: 'Source failed', body: 'details', occurrences: 3, url: 'https://radar.example/system' };

  it('renders a bounded plain-text message and a subject', () => {
    const text = formatAlertText(msg);
    expect(text).toBe('RADAR CRITICAL: Source failed\n(seen 3 times)\n\ndetails\n\nhttps://radar.example/system');
    expect(formatAlertText({ ...msg, body: 'y'.repeat(10_000) }, 100).length).toBe(100);
    expect(formatAlertSubject(msg)).toBe('[RADAR CRITICAL] Source failed');
  });

  it('redacts secrets from texts and errors', () => {
    const secret = 'https://api.telegram.org/bot123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsawabcdef/sendMessage';
    expect(safeErrorText(new Error(`request to ${secret} failed`))).not.toContain('AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw');
    expect(safeErrorText('x'.repeat(1000)).length).toBeLessThanOrEqual(300);
  });

  it('uses the SMTP login as sender when it is an address', () => {
    expect(senderFor('smtps://alerts%40example.com:pw@smtp.example.com:465', 'me@example.com')).toBe('RADAR <alerts@example.com>');
    expect(senderFor('smtp://apikey:pw@smtp.example.com:587', 'me@example.com')).toBe('RADAR <me@example.com>');
    expect(senderFor('::bad::', 'me@example.com')).toBe('RADAR <me@example.com>');
  });
});

describe('digest', () => {
  it('day keys and local time helpers', () => {
    expect(digestDedupeKey('2026-09-30')).toBe('digest:2026-09-30');
    expect(localHour(now, 'Europe/Berlin')).toBe(8);
    expect(localHour(now, 'UTC')).toBe(6);
    expect(endOfLocalDay(now, 'Europe/Berlin').toISOString()).toBe('2026-09-30T22:00:00.000Z');
  });

  const content: DigestContent = {
    day: '2026-09-30',
    generatedAt: now,
    since: new Date('2026-09-29T06:00:00.000Z'),
    newJobs: 2,
    top: [
      { id: 7, title: 'Cloud Security Engineer', company: 'Acme', countryIso2: 'DE', city: 'Berlin', score: 88, visaStatus: 'sponsors', remoteClass: 'hybrid' },
      { id: 8, title: 'DevSecOps Engineer', company: 'Beta', countryIso2: null, city: null, score: null, visaStatus: null, remoteClass: 'not_remote' },
    ],
    runTotals: { runs: 2, newCount: 5, updatedCount: 3, closedCount: 1 },
    lastDailyRun: { status: 'ok', finishedAt: new Date('2026-09-30T00:41:00.000Z') },
    troubledSources: [{ id: 3, label: 'Lever acme', consecutiveFailures: 3, circuitOpenUntil: new Date(now.getTime() + HOUR_MS) }],
    followUps: [{ applicationId: 4, title: 'SRE', company: 'Gamma', dueAt: now, kind: 'follow_up' }],
    openAlerts: { critical: 1, warn: 2, info: 0 },
  };

  it('renders top matches, follow-ups, pipeline health and open alerts with deep links', () => {
    const text = renderDigest(content, 'UTC', 'https://radar.example');
    expect(text).toContain('2 new jobs since');
    expect(text).toContain('- 88 · Cloud Security Engineer — Acme (Berlin, DE) · visa sponsors, remote hybrid https://radar.example/jobs/7');
    expect(text).toContain('- – · DevSecOps Engineer — Beta (location unknown) https://radar.example/jobs/8');
    expect(text).toContain('Follow-ups due (1):');
    expect(text).toContain('- Last daily run: ok, finished 2026-09-30 00:41 UTC');
    expect(text).toContain('Source "Lever acme": 3 failed run(s), paused by circuit breaker');
    expect(text).toContain('Open alerts: 1 critical, 2 warning, 0 info.');
  });

  it('renders an empty day without links', () => {
    const text = renderDigest({ ...content, newJobs: 1, top: [], followUps: [], troubledSources: [], lastDailyRun: null, openAlerts: { critical: 0, warn: 0, info: 0 } }, 'UTC', null);
    expect(text).toContain('1 new job since');
    expect(text).toContain('- No daily run yet.');
    expect(text).not.toContain('Open alerts');
    expect(text).not.toContain('http');
  });
});
