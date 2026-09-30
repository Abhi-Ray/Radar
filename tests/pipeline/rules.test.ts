/** Pure pipeline rules: lifecycle decisions, absence guards, source status, run report, helpers. */
import { describe, expect, it } from 'vitest';
import { computeGhostRisk, isOpenState, isRelisting, isRepostOf, reopenDecision } from '../../src/lib/lifecycle';
import { sumHttpUsage } from '../../src/lib/pipeline/run';
import { queuedRunParams } from '../../src/lib/pipeline/queue';
import { buildRunReport, emptyCounts, formatRunSummary, runStatusFor, sumCounts, type SourceReport } from '../../src/lib/pipeline/report';
import { reprocessStatus } from '../../src/lib/pipeline/reprocess';
import { mapLimit } from '../../src/lib/pipeline/runtime';
import { chunks, errorText, isDuplicateEntry, isRetryableTxError, mysqlErrno } from '../../src/lib/pipeline/stages/dbutil';
import { massMissingGuard } from '../../src/lib/pipeline/stages/listing';
import { gradeRank, listingConfirmsLive } from '../../src/lib/pipeline/stages/persist';
import { atsSlugFor, itemStatus } from '../../src/lib/pipeline/stages/source';
import { logicVersions } from '../../src/lib/pipeline/versions';
import { DAY_MS } from '../../src/lib/time';

const now = new Date('2026-09-30T00:30:00.000Z');
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY_MS);

describe('lifecycle rules', () => {
  it('ghost risk: reposted 3 times, or open for more than 60 days (earliest of posted / first seen)', () => {
    expect(computeGhostRisk({ repostCount: 3, postedAt: null, firstSeenAt: now, now })).toEqual({ ghostRisk: true, reason: 'reposted 3 times' });
    expect(computeGhostRisk({ repostCount: 2, postedAt: null, firstSeenAt: daysAgo(60), now }).ghostRisk).toBe(false);
    expect(computeGhostRisk({ repostCount: 0, postedAt: null, firstSeenAt: daysAgo(61), now })).toEqual({ ghostRisk: true, reason: 'open for 61 days' });
    expect(computeGhostRisk({ repostCount: 0, postedAt: daysAgo(70), firstSeenAt: daysAgo(2), now }).ghostRisk).toBe(true);
    // A posted date after first-seen (a repost refresh) does not reset the age.
    expect(computeGhostRisk({ repostCount: 0, postedAt: daysAgo(1), firstSeenAt: daysAgo(65), now }).ghostRisk).toBe(true);
  });

  it('reposts: re-listed after the source dropped it, or a new id replacing a gone posting', () => {
    expect(isRelisting('closed', 'missing_from_source')).toBe(true);
    expect(isRelisting('closed', 'source_closed')).toBe(true);
    // A dead link coming back or a stale job seen again is not a repost; manual closes never reopen.
    expect(isRelisting('closed', 'link_dead')).toBe(false);
    expect(isRelisting('closed', 'manual')).toBe(false);
    expect(isRelisting('closed', null)).toBe(false);
    expect(isRelisting('stale', 'missing_from_source')).toBe(false);
    const p = { sameCompany: true, sameTitle: true, state: 'active', stillListed: false };
    expect(isRepostOf(p)).toBe(true);
    expect(isRepostOf({ ...p, state: 'closed', stillListed: null })).toBe(true);
    expect(isRepostOf({ ...p, state: 'expired', stillListed: true })).toBe(true);
    // Still listed (a second opening) or unknown (partial listing): not a repost.
    expect(isRepostOf({ ...p, stillListed: true })).toBe(false);
    expect(isRepostOf({ ...p, stillListed: null })).toBe(false);
    expect(isRepostOf({ ...p, sameTitle: false })).toBe(false);
    expect(isRepostOf({ ...p, sameCompany: false, state: 'closed' })).toBe(false);
  });

  it('only first-party / official (grade A) listings confirm a posting as live', () => {
    expect(listingConfirmsLive('A')).toBe(true);
    expect(listingConfirmsLive('B')).toBe(false);
    expect(listingConfirmsLive('C')).toBe(false);
  });

  it('reopen decisions', () => {
    const base = { linkStatus: 'ok', closingAt: null, now };
    expect(reopenDecision({ ...base, state: 'closed' })).toEqual({ reopen: true, reason: 'listed again by the source' });
    expect(reopenDecision({ ...base, state: 'closed', linkStatus: 'dead' }).reopen).toBe(false);
    expect(reopenDecision({ ...base, state: 'expired', closingAt: daysAgo(1) }).reopen).toBe(false);
    expect(reopenDecision({ ...base, state: 'expired', closingAt: new Date(now.getTime() + DAY_MS) })).toEqual({ reopen: true, reason: 'closing date moved into the future' });
    expect(reopenDecision({ ...base, state: 'expired' })).toEqual({ reopen: true, reason: 'closing date removed' });
    expect(reopenDecision({ ...base, state: 'stale' }).reopen).toBe(true);
    expect(reopenDecision({ ...base, state: 'active' }).reopen).toBe(false);
    expect(isOpenState('stale')).toBe(true);
    expect(isOpenState('closed')).toBe(false);
  });

  it('mass-missing guard: refuses when more than half of the open jobs (and > 5) vanished', () => {
    expect(massMissingGuard(5, 6)).toBe(false);
    expect(massMissingGuard(6, 10)).toBe(true);
    expect(massMissingGuard(6, 12)).toBe(false);
    expect(massMissingGuard(60, 100)).toBe(true);
  });
});

describe('source item status', () => {
  const c = { attempted: 0, parsed: 0, unchanged: 0, failedParse: 0, failedValidate: 0, failedNormalize: 0, failedPersist: 0, repeatFailures: 0 };

  it('fails when every attempted item failed (parser broken)', () => {
    expect(itemStatus({ ...c, attempted: 5, failedParse: 5 }, 20).status).toBe('failed');
    // Known-good postings in the listing and only repeat failures: not a broken parser.
    expect(itemStatus({ ...c, attempted: 5, failedParse: 5, repeatFailures: 5, unchanged: 30 }, 20).status).toBe('ok');
  });

  it('partial when all fresh items failed or the failure share is too high', () => {
    expect(itemStatus({ ...c, attempted: 2, failedPersist: 2, unchanged: 10 }, 20).status).toBe('partial');
    expect(itemStatus({ ...c, attempted: 10, parsed: 8, failedValidate: 2 }, 20).status).toBe('partial');
    expect(itemStatus({ ...c, attempted: 10, parsed: 9, failedValidate: 1 }, 20)).toEqual({ status: 'ok', error: null });
    expect(itemStatus({ ...c, attempted: 1, failedParse: 1 }, 20).status).toBe('ok');
  });

  it('extracts the ATS board slug from a source config', () => {
    expect(atsSlugFor({ board: 'GitLab' })).toBe('gitlab');
    expect(atsSlugFor({ nothing: true })).toBeNull();
    expect(atsSlugFor(null)).toBeNull();
  });
});

function report(status: SourceReport['status'], over: Partial<SourceReport['counts']> = {}): SourceReport {
  return {
    sourceId: 1,
    sourceKey: 'greenhouse:acme',
    label: 'Acme',
    platformKey: 'greenhouse',
    status,
    reason: null,
    error: null,
    listing: 'full',
    completeListing: true,
    partialReason: null,
    healthy: status === 'ok',
    healthReason: null,
    canariesMissing: false,
    massCloseBlocked: status === 'partial',
    flags: status === 'partial' ? { parse_fail_pct: 0.5 } : {},
    counts: { ...emptyCounts(), ...over },
    durationMs: 10,
    breaker: null,
    checklistTicked: [],
    filterReasons: {},
  };
}

describe('run report', () => {
  it('overall status', () => {
    const opts = { aborted: false, sweepFailed: false };
    expect(runStatusFor([], opts)).toBe('ok');
    expect(runStatusFor([], { ...opts, sweepFailed: true })).toBe('partial');
    expect(runStatusFor([report('ok'), report('ok')], opts)).toBe('ok');
    expect(runStatusFor([report('ok'), report('failed')], opts)).toBe('partial');
    expect(runStatusFor([report('failed'), report('skipped')], opts)).toBe('failed');
    expect(runStatusFor([report('skipped')], opts)).toBe('partial');
    expect(runStatusFor([report('ok')], { ...opts, aborted: true })).toBe('failed');
  });

  it('sums counts, keeps only non-zero counters and adds a would-change summary for dry runs', () => {
    const sources = [report('ok', { listed: 10, created: 2, confirmed: 8, closedMissing: 1 }), report('partial', { listed: 5, updated: 1, deadLetters: 3, closedBySource: 2 })];
    expect(sumCounts(sources.map((s) => s.counts))).toMatchObject({ listed: 15, created: 2, updated: 1 });
    const r = buildRunReport({
      kind: 'manual',
      dryRun: true,
      startedAt: now,
      finishedAt: new Date(now.getTime() + 1500),
      sources,
      sweep: null,
      sweepError: null,
      alerts: [{ kind: 'source_failed', severity: 'warn', title: 'x', alertId: null, sourceId: 1 }],
      http: {},
      aborted: null,
    });
    expect(r.status).toBe('partial');
    expect(r.durationMs).toBe(1500);
    expect(r.totals).toMatchObject({ sources: 2, ok: 1, partial: 1, listed: 15 });
    expect(r.sources[0].counts).toEqual({ listed: 10, created: 2, confirmed: 8, closedMissing: 1 });
    expect(r.sources[1].flags).toEqual(['parse_fail_pct', 'mass_close_blocked']);
    expect(r.wouldChange).toMatchObject({ newPostings: 2, changedPostings: 1, confirmed: 8, closed: 3, deadLetters: 3, alerts: [{ kind: 'source_failed', severity: 'warn', title: 'x' }] });
    const line = formatRunSummary(r);
    expect(line).toContain('dry run partial in 1.5s');
    expect(line).toContain('would create 2');
    const real = buildRunReport({ kind: 'daily', dryRun: false, startedAt: now, finishedAt: now, sources, sweep: null, sweepError: null, alerts: [], http: {}, aborted: null });
    expect(real.wouldChange).toBeUndefined();
    expect(formatRunSummary(real)).toContain('created 2');
  });

  it('reprocess status', () => {
    expect(reprocessStatus({ reprocessed: 3, failed: 0 }, false)).toBe('ok');
    expect(reprocessStatus({ reprocessed: 3, failed: 1 }, false)).toBe('partial');
    expect(reprocessStatus({ reprocessed: 0, failed: 1 }, false)).toBe('failed');
    expect(reprocessStatus({ reprocessed: 3, failed: 0 }, true)).toBe('failed');
  });
});

describe('helpers', () => {
  it('sums today’s HTTP usage per platform from stored run stats', () => {
    expect(
      sumHttpUsage([
        { http: { greenhouse: { requests: 3 }, lever: { requests: 2.9 } } },
        { http: { greenhouse: { requests: 4 }, lever: { requests: -1 }, bad: null } },
        null,
        'x',
        { nothing: true },
      ]),
    ).toEqual({ greenhouse: 7, lever: 2 });
  });

  it('reads queued run params defensively', () => {
    expect(queuedRunParams(null)).toBeNull();
    expect(queuedRunParams({})).toBeNull();
    expect(queuedRunParams({ params: {} })).toEqual({});
    expect(queuedRunParams({ params: { sourceIds: [1, 2] } })).toEqual({ sourceIds: [1, 2] });
    expect(queuedRunParams({ params: { sourceIds: [1, -2] } })).toBeNull();
  });

  it('classifies MySQL errors through drizzle cause chains', () => {
    const deadlock = Object.assign(new Error('Deadlock'), { errno: 1213 });
    expect(mysqlErrno(new Error('wrapped', { cause: deadlock }))).toBe(1213);
    expect(isRetryableTxError(new Error('wrapped', { cause: deadlock }))).toBe(true);
    expect(isRetryableTxError(Object.assign(new Error('savepoint'), { errno: 1305 }))).toBe(true);
    expect(isRetryableTxError(Object.assign(new Error('dup'), { errno: 1062 }))).toBe(false);
    expect(isDuplicateEntry(Object.assign(new Error('dup'), { errno: 1062 }))).toBe(true);
    expect(mysqlErrno('nope')).toBeNull();
  });

  it('chunks, error text and grade ranks', () => {
    expect(chunks([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunks([], 3)).toEqual([]);
    expect(errorText(new Error('x'.repeat(50)), 10).length).toBeLessThanOrEqual(10);
    expect(gradeRank('A')).toBeLessThan(gradeRank('C'));
    expect(gradeRank(null)).toBe(99);
  });

  it('mapLimit keeps order and bounds concurrency', async () => {
    let active = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 4, 2, 3], 2, async (n) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, n));
      active--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 40, 20, 30]);
    expect(peak).toBe(2);
    expect(await mapLimit([], 3, async () => 1)).toEqual([]);
  });

  it('records every logic version of a run', () => {
    const v = logicVersions();
    for (const key of ['pipeline', 'lifecycle', 'linkcheck', 'quality', 'health', 'source_data', 'skills', 'dedup', 'score', 'polite_http', 'relevance']) {
      expect(Object.keys(v)).toContain(key);
    }
    // Every connector parser version is recorded too.
    for (const key of ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'bundesagentur', 'jobtech_se', 'nav_no', 'arbeitnow', 'remotive', 'remoteok', 'himalayas', 'jobicy']) {
      expect(v[`connector:${key}`]).toMatch(new RegExp(`^${key}@`));
    }
    for (const value of Object.values(v)) expect(typeof value).toBe('string');
  });
});
