/**
 * Pure tracker logic: the stage machine, follow-up time zone maths, statistics (with the n < 5
 * caveat and corrections), CSV encoding and the event-meta parsers.
 */
import { describe, expect, it } from 'vitest';
import { csvCell, toCsv, CSV_BOM } from '../../src/lib/tracker/csv';
import {
  addLocalDays,
  localDayDiff,
  localDayOf,
  localTimeOf,
  localToUtc,
  parseFollowUp,
  reminderBucket,
} from '../../src/lib/tracker/follow-up';
import { commentMetaToJson, followUpOf, isCorrection, parseCommentMeta, parseEditMeta } from '../../src/lib/tracker/meta';
import { checkTransition, correctionStages, nextStages, stageLabel, transitionProblem } from '../../src/lib/tracker/stages';
import { MIN_SAMPLE, applicationFacts, computeTrackerStats, effectivePath, sourceKey, type StatApplication } from '../../src/lib/tracker/stats';
import { exportFilename } from '../../src/lib/tracker/export';

const IST = 'Asia/Kolkata';

describe('stage machine', () => {
  it('walks the pipeline forward, skipping is fine', () => {
    expect(transitionProblem('saved', 'applied')).toBeNull();
    expect(transitionProblem('applied', 'screening')).toBeNull();
    expect(transitionProblem('applied', 'final')).toBeNull();
    expect(transitionProblem('offer', 'accepted')).toBeNull();
    expect(transitionProblem('saved', 'technical')).toBeNull();
  });

  it('allows repeated technical rounds but no other no-op', () => {
    expect(transitionProblem('technical', 'technical')).toBeNull();
    expect(transitionProblem('screening', 'screening')).toMatch(/already/);
    expect(checkTransition('screening', 'screening', { correction: true })).toMatchObject({ ok: false, correctable: false });
  });

  it('terminal stages: rejected / no response need an application, withdrawn works anywhere', () => {
    expect(transitionProblem('saved', 'rejected')).toMatch(/applied first/);
    expect(transitionProblem('saved', 'no_response')).toMatch(/applied first/);
    expect(transitionProblem('saved', 'withdrawn')).toBeNull();
    expect(transitionProblem('technical', 'rejected')).toBeNull();
    expect(transitionProblem('applied', 'no_response')).toBeNull();
  });

  it('no response can move on with a late reply, but not back to applied', () => {
    expect(transitionProblem('no_response', 'screening')).toBeNull();
    expect(transitionProblem('no_response', 'offer')).toBeNull();
    expect(transitionProblem('no_response', 'rejected')).toBeNull();
    expect(transitionProblem('no_response', 'applied')).toMatch(/late reply/);
  });

  it('backwards moves and reopening closed ones are corrections', () => {
    expect(checkTransition('final', 'screening')).toMatchObject({ ok: false, correctable: true });
    expect(checkTransition('final', 'screening', { correction: true })).toEqual({ ok: true, correction: true });
    expect(checkTransition('rejected', 'technical')).toMatchObject({ ok: false, correctable: true });
    expect(checkTransition('accepted', 'offer', { correction: true })).toEqual({ ok: true, correction: true });
    expect(checkTransition('offer', 'accepted', { correction: true })).toEqual({ ok: true, correction: false });
  });

  it('new applications start in an open stage only', () => {
    expect(transitionProblem(null, 'saved')).toBeNull();
    expect(transitionProblem(null, 'offer')).toBeNull();
    expect(transitionProblem(null, 'accepted')).toMatch(/cannot start/);
    expect(checkTransition(null, 'rejected', { correction: true })).toMatchObject({ ok: false, correctable: false });
    expect(checkTransition('saved', 'hired' as never)).toMatchObject({ ok: false });
  });

  it('lists next moves in board order', () => {
    expect(nextStages('applied')).toEqual(['screening', 'technical', 'final', 'offer', 'accepted', 'rejected', 'withdrawn', 'no_response']);
    expect(nextStages('technical')).toEqual(['technical', 'final', 'offer', 'accepted', 'rejected', 'withdrawn', 'no_response']);
    expect(nextStages('rejected')).toEqual([]);
    expect(correctionStages('rejected')).not.toContain('rejected');
    expect(stageLabel('no_response')).toBe('No response');
    expect(stageLabel('nope')).toBe('Unknown stage');
  });
});

describe('follow-ups in APP_TZ', () => {
  const now = new Date('2026-09-30T06:00:00.000Z'); // 11:30 IST

  it('converts local day + time to UTC and back', () => {
    const at = localToUtc('2026-10-07', '10:00', IST)!;
    expect(at.toISOString()).toBe('2026-10-07T04:30:00.000Z');
    expect(localDayOf(at, IST)).toBe('2026-10-07');
    expect(localTimeOf(at, IST)).toBe('10:00');
    expect(localToUtc('2026-02-31', '10:00', IST)).toBeNull();
    expect(localToUtc('2026-10-07', '25:00', IST)).toBeNull();
    // Late evening UTC is already tomorrow in IST.
    expect(localDayOf(new Date('2026-09-30T20:00:00.000Z'), IST)).toBe('2026-10-01');
  });

  it('adds local calendar days and measures local day gaps', () => {
    expect(addLocalDays(now, 7, IST)).toBe('2026-10-07');
    expect(localDayDiff(new Date('2026-09-30T19:00:00.000Z'), now, IST)).toBe(1); // 00:30 IST on Oct 1
    expect(localDayDiff(new Date('2026-09-29T17:00:00.000Z'), now, IST)).toBe(-1); // 22:30 IST on Sep 29
  });

  it('buckets reminders: overdue, today, soon, later', () => {
    expect(reminderBucket(new Date('2026-09-29T04:30:00.000Z'), now, IST)).toBe('overdue');
    expect(reminderBucket(new Date('2026-09-30T04:30:00.000Z'), now, IST)).toBe('overdue'); // 10:00 IST today, already past
    expect(reminderBucket(new Date('2026-09-30T12:30:00.000Z'), now, IST)).toBe('today');
    expect(reminderBucket(new Date('2026-10-03T04:30:00.000Z'), now, IST)).toBe('soon');
    expect(reminderBucket(new Date('2026-10-10T04:30:00.000Z'), now, IST)).toBe('later');
  });

  it('validates the follow-up form', () => {
    expect(parseFollowUp('2026-10-07', '', now, IST)).toEqual({ ok: true, at: new Date('2026-10-07T04:30:00.000Z') });
    expect(parseFollowUp('2026-09-30', '09:00', now, IST)).toMatchObject({ ok: true });
    expect(parseFollowUp('2026-09-29', '09:00', now, IST)).toMatchObject({ ok: false, error: expect.stringMatching(/over/) });
    expect(parseFollowUp('07/10/2026', '09:00', now, IST)).toMatchObject({ ok: false });
    expect(parseFollowUp('2026-10-07', '9am', now, IST)).toMatchObject({ ok: false });
    expect(parseFollowUp('2028-10-07', '09:00', now, IST)).toMatchObject({ ok: false, error: expect.stringMatching(/within a year/) });
  });
});

function app(partial: Partial<StatApplication> & { id: number }): StatApplication {
  return { currentStage: 'applied', appliedAt: new Date('2026-09-01T00:00:00Z'), countryIso2: 'DE', source: 'Greenhouse', roleKey: 'cloud_security_engineer', events: [], ...partial };
}
const ev = (stageTo: string, day: string, meta?: Record<string, unknown>) => ({ kind: 'stage_change', stageTo, occurredAt: new Date(`${day}T00:00:00Z`), meta });

describe('tracker stats', () => {
  it('derives outcome flags from the effective path', () => {
    const a = app({ id: 1, currentStage: 'rejected', events: [ev('applied', '2026-09-01'), ev('technical', '2026-09-05'), ev('rejected', '2026-09-10')] });
    expect(applicationFacts(a)).toMatchObject({ applied: true, responded: true, interviewed: true, offered: false, rejected: true, active: false, firstReplyDays: 4 });
    const saved = app({ id: 2, currentStage: 'saved', appliedAt: null, events: [ev('saved', '2026-09-01')] });
    expect(applicationFacts(saved).applied).toBe(false);
  });

  it('a correction replaces the stage it corrects', () => {
    const events = [ev('applied', '2026-09-01'), ev('offer', '2026-09-02'), ev('screening', '2026-09-03', { correction: true })];
    expect(effectivePath(events).map((p) => p.stage)).toEqual(['applied', 'screening']);
    expect(applicationFacts(app({ id: 3, currentStage: 'screening', events })).offered).toBe(false);
  });

  it('computes rates and flags groups under the minimum sample', () => {
    const apps: StatApplication[] = [
      // 5 in DE via Greenhouse: 2 replies (screening after 2d, rejection after 6d), 1 offer.
      app({ id: 1, currentStage: 'screening', events: [ev('applied', '2026-09-01'), ev('screening', '2026-09-03')] }),
      app({ id: 2, currentStage: 'rejected', events: [ev('applied', '2026-09-01'), ev('rejected', '2026-09-07')] }),
      app({ id: 3, currentStage: 'offer', events: [ev('applied', '2026-09-01'), ev('final', '2026-09-11'), ev('offer', '2026-09-15')] }),
      app({ id: 4, currentStage: 'no_response', events: [ev('applied', '2026-09-01'), ev('no_response', '2026-09-30')] }),
      app({ id: 5, currentStage: 'applied', events: [ev('applied', '2026-09-01')] }),
      // 1 in NL via LinkedIn, manual role unknown.
      app({ id: 6, countryIso2: 'NL', source: ' LinkedIn ', roleKey: null, events: [ev('applied', '2026-09-01')] }),
      app({ id: 7, currentStage: 'saved', appliedAt: null, events: [ev('saved', '2026-09-01')] }),
    ];
    const s = computeTrackerStats(apps, { country: (c) => ({ DE: 'Germany', NL: 'Netherlands' })[c] ?? c });
    expect(s.total).toBe(7);
    expect(s.saved).toBe(1);
    expect(s.overall).toMatchObject({ applied: 6, responded: 3, interviews: 2, offers: 1, rejected: 1, noResponse: 1, active: 4, replies: 3, conclusive: true, replyConclusive: false });
    expect(s.overall.responseRate).toBeCloseTo(0.5);
    expect(s.overall.avgDaysToFirstReply).toBeCloseTo((2 + 6 + 10) / 3);
    expect(s.byCountry.map((g) => [g.label, g.applied, g.conclusive])).toEqual([
      ['Germany', 5, true],
      ['Netherlands', 1, false],
    ]);
    expect(s.bySource.map((g) => g.label)).toEqual(['Greenhouse', 'LinkedIn']);
    expect(s.byRole.find((g) => g.key === '∅')).toMatchObject({ label: 'Unmapped role', applied: 1, conclusive: false });
    expect(s.minSample).toBe(MIN_SAMPLE);
  });

  it('has no rates without applications', () => {
    const s = computeTrackerStats([]);
    expect(s.overall).toMatchObject({ applied: 0, responseRate: null, avgDaysToFirstReply: null, conclusive: false });
    expect(s.byCountry).toEqual([]);
  });

  it('groups sources case-insensitively and names the missing one', () => {
    expect(sourceKey('Greenhouse')).toEqual({ key: 'greenhouse', label: 'Greenhouse' });
    expect(sourceKey(' greenhouse ').key).toBe('greenhouse');
    expect(sourceKey(null)).toEqual({ key: '∅', label: 'Not recorded' });
  });
});

describe('csv', () => {
  it('quotes, doubles quotes and neutralises formulas', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+49 30 123')).toBe("'+49 30 123");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(Number.NaN)).toBe('');
    expect(csvCell(null)).toBe('');
    expect(csvCell(true)).toBe('true');
    expect(csvCell(new Date('2026-09-30T00:00:00Z'))).toBe('2026-09-30T00:00:00.000Z');
  });

  it('writes a header, CRLF lines and a BOM', () => {
    const out = toCsv([{ a: 1, b: 'x' }], [
      { header: 'a', value: (r) => r.a },
      { header: 'b', value: (r) => r.b },
    ]);
    expect(out).toBe(`${CSV_BOM}a,b\r\n1,x\r\n`);
    expect(toCsv([], [{ header: 'a', value: () => 1 }], { bom: false })).toBe('a\r\n');
  });

  it('names export files by local day', () => {
    expect(exportFilename('json', 'applications', '2026-09-30')).toBe('radar-applications-2026-09-30.json');
    expect(exportFilename('csv', 'events', '2026-09-30')).toBe('radar-applications-events-2026-09-30.csv');
    expect(exportFilename('csv', 'applications', 'bad')).toBe('radar-applications-export.csv');
  });
});

describe('event meta', () => {
  it('round-trips interview fields under snake_case keys', () => {
    const json = commentMetaToJson({ interviewer: '  Sam (EM) ', questions: 'IAM design', wentWell: '', nextSteps: 'Take-home' });
    expect(json).toEqual({ interviewer: 'Sam (EM)', questions: 'IAM design', next_steps: 'Take-home' });
    expect(parseCommentMeta(json)).toEqual({ interviewer: 'Sam (EM)', questions: 'IAM design', nextSteps: 'Take-home' });
    expect(parseCommentMeta('nope')).toEqual({});
  });

  it('reads edit before/after, corrections and follow-ups', () => {
    expect(parseEditMeta({ before: { title: 'A' }, after: { title: 'B', source: 'x' } })).toEqual([
      { field: 'title', before: 'A', after: 'B' },
      { field: 'source', before: null, after: 'x' },
    ]);
    expect(isCorrection({ correction: true })).toBe(true);
    expect(isCorrection({ correction: 'yes' })).toBe(false);
    expect(followUpOf({ followUpAt: '2026-10-07T04:30:00.000Z' }).at?.toISOString()).toBe('2026-10-07T04:30:00.000Z');
    expect(followUpOf({ followUpAt: null, done: true })).toEqual({ at: null, done: true });
  });
});
