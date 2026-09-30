import { describe, expect, it } from 'vitest';
import {
  bestTitle,
  compareLocations,
  dateScore,
  daysApart,
  DEDUP_WINDOW_DAYS,
  isSpecificJobLink,
  MERGE_MIN_SCORE,
  pct,
  scoreCrossCompany,
  scoreSameCompany,
  type PairSide,
} from '@/lib/dedup/score';
import { dedupTitle } from '@/lib/dedup/similarity';
import { bestLink, mergedJobFields, parseJobMergeRecord } from '@/lib/dedup/manual';

const DAY = 86_400_000;
const T0 = new Date('2026-09-01T00:00:00Z');
const at = (days: number) => new Date(T0.getTime() + days * DAY);

function side(title: string, opts: Partial<Omit<PairSide, 'titles'>> = {}): PairSide {
  return { titles: [dedupTitle(title)], countryIso2: 'DE', city: 'Berlin', start: T0, end: T0, ...opts };
}

describe('compareLocations', () => {
  it.each([
    [{ countryIso2: 'DE', city: 'Berlin' }, { countryIso2: 'DE', city: 'Berlin' }, 1, true],
    [{ countryIso2: 'DE', city: 'Munich' }, { countryIso2: 'DE', city: 'München' }, 1, true],
    [{ countryIso2: 'DE', city: null }, { countryIso2: 'DE', city: null }, 1, true],
    [{ countryIso2: null, city: null }, { countryIso2: null, city: null }, 1, true],
    [{ countryIso2: 'DE', city: 'Berlin' }, { countryIso2: 'DE', city: null }, 0.6, false],
    [{ countryIso2: 'DE', city: 'Berlin' }, { countryIso2: 'DE', city: 'Munich' }, 0, false],
    [{ countryIso2: 'DE', city: 'Berlin' }, { countryIso2: 'NL', city: 'Berlin' }, 0, false],
  ])('%j vs %j → %d', (a, b, score, same) => {
    const r = compareLocations(a, b);
    expect(r.score).toBe(score);
    expect(r.sameLocation).toBe(same);
    expect(r.reason).toBeTruthy();
  });
});

describe('daysApart / dateScore', () => {
  it.each([
    [{ start: at(0), end: at(10) }, { start: at(5), end: at(20) }, 0],
    [{ start: at(0), end: at(10) }, { start: at(15), end: at(20) }, 5],
    [{ start: at(30), end: at(40) }, { start: at(0), end: at(10) }, 20],
    [{ start: at(0), end: at(0) }, { start: at(0), end: at(0) }, 0],
    [{ start: at(10), end: at(0) }, { start: at(12), end: at(12) }, 2],
  ])('daysApart(%j, %j) = %i', (a, b, d) => {
    expect(daysApart(a, b)).toBe(d);
    expect(daysApart(b, a)).toBe(d);
  });

  it.each([
    [0, 1],
    [7, 1],
    [8, 0.987],
    [26, 0.75],
    [DEDUP_WINDOW_DAYS, 0.5],
    [DEDUP_WINDOW_DAYS + 1, 0],
    [365, 0],
  ])('dateScore(%i) = %d', (days, v) => {
    expect(dateScore(days)).toBeCloseTo(v, 3);
  });
});

describe('bestTitle / pct', () => {
  it('takes the best pair of variants', () => {
    const a = [dedupTitle('Softwareentwickler Backend'), dedupTitle('Backend Engineer')];
    const b = [dedupTitle('Backend Engineer (m/w/d)')];
    expect(bestTitle(a, b)).toEqual({ equal: true, similarity: 1 });
    expect(bestTitle([], b)).toEqual({ equal: false, similarity: 0 });
  });

  it('formats percentages', () => {
    expect(pct(0.874)).toBe('87%');
    expect(pct(1)).toBe('100%');
  });
});

describe('scoreSameCompany', () => {
  it('everything strong → mergeable', () => {
    const s = scoreSameCompany(side('Backend Engineer'), side('Backend Engineer (m/w/d)', { start: at(-3), end: at(-1) }), { identical: true, jaccard: 1 });
    expect(s.mergeable).toBe(true);
    expect(s.score).toBeGreaterThanOrEqual(MERGE_MIN_SCORE);
    expect(s.reasons).toEqual(expect.arrayContaining(['same company', 'same title', 'same city', 'identical description']));
  });

  it('high shingle jaccard (≥ 0.9) merges; lower does not', () => {
    const a = side('Backend Engineer');
    const b = side('Backend Engineer');
    expect(scoreSameCompany(a, b, { identical: false, jaccard: 0.93 }).mergeable).toBe(true);
    const low = scoreSameCompany(a, b, { identical: false, jaccard: 0.85 });
    expect(low.mergeable).toBe(false);
    expect(low.score).toBeGreaterThanOrEqual(0.7);
  });

  it('no description comparison → never mergeable', () => {
    const s = scoreSameCompany(side('Backend Engineer'), side('Backend Engineer'), null);
    expect(s.mergeable).toBe(false);
    expect(s.descriptionSimilarity).toBeNull();
    expect(s.reasons).toContain('description not compared');
  });

  it('short texts only merge when identical', () => {
    const a = side('Backend Engineer');
    expect(scoreSameCompany(a, a, { identical: false, jaccard: 1, tooShort: true }).mergeable).toBe(false);
    expect(scoreSameCompany(a, a, { identical: true, jaccard: 1, tooShort: true }).mergeable).toBe(true);
  });

  it.each([
    ['different city', side('Backend Engineer', { city: 'Munich' })],
    ['city missing on one side', side('Backend Engineer', { city: null })],
    ['different country', side('Backend Engineer', { countryIso2: 'NL' })],
    ['different seniority', side('Senior Backend Engineer')],
    ['different level', side('Backend Engineer II')],
    ['outside the window', side('Backend Engineer', { start: at(-200), end: at(-100) })],
    ['different title', side('Frontend Engineer')],
  ])('%s → not mergeable', (_label, other) => {
    const s = scoreSameCompany(side('Backend Engineer'), other, { identical: true, jaccard: 1 });
    expect(s.mergeable).toBe(false);
  });

  it('scores are symmetric', () => {
    const a = side('Backend Engineer', { start: at(0), end: at(3) });
    const b = side('Backend Engineer (m/w/d)', { city: 'Berlin', start: at(20), end: at(25) });
    const d = { identical: false, jaccard: 0.8 };
    expect(scoreSameCompany(a, b, d).score).toBe(scoreSameCompany(b, a, d).score);
  });
});

describe('scoreCrossCompany', () => {
  it('is never mergeable, even with an identical text', () => {
    const s = scoreCrossCompany(side('Backend Engineer'), side('Backend Engineer'), { identical: true, jaccard: 1, containment: 1 });
    expect(s.mergeable).toBe(false);
    expect(s.score).toBeGreaterThanOrEqual(0.9);
    expect(s.reasons[0]).toBe('different company');
  });

  it('uses containment for reposts with an agency preamble', () => {
    const s = scoreCrossCompany(side('Backend Engineer'), side('Backend Engineer'), { identical: false, jaccard: 0.6, containment: 1 });
    expect(s.descriptionSimilarity).toBe(0.95);
    expect(s.reasons[s.reasons.length - 1]).toBe('description 95% similar');
  });
});

describe('isSpecificJobLink', () => {
  it.each([
    'https://boards.greenhouse.io/acme/jobs/4567890',
    'https://jobs.lever.co/acme/2f7c1a8e-4b1d-4c2e-9f0a-1b2c3d4e5f60',
    'https://acme.com/careers?gh_jid=12345',
    'https://acme.com/careers/senior-backend-engineer-berlin',
    'https://acme.com/jobs/backend-engineer',
    'https://acme.com/apply?jobId=abc',
    'https://acme.com/#!/job/88231',
    'https://www.stepstone.de/stellenangebote--Backend-Engineer-Berlin-Acme--1234567-inline.html',
    'https://acme.recruitee.com/o/backend-engineer-2',
    'https://acme.com/careers/r2d2x9',
  ])('%s names one posting', (url) => {
    expect(isSpecificJobLink(url)).toBe(true);
  });

  it.each([
    'https://acme.com/careers',
    'https://acme.com/careers/',
    'https://acme.com/jobs',
    'https://acme.com/en/careers/open-positions',
    'https://acme.com/karriere/stellenangebote',
    'https://acme.com/apply',
    'https://acme.com/',
    'https://acme.com/join-us',
    'not a url',
  ])('%s is a generic page', (url) => {
    expect(isSpecificJobLink(url)).toBe(false);
  });
});

describe('manual merge helpers (pure)', () => {
  it('mergedJobFields combines dates and flags', () => {
    const keep = {
      firstSeenAt: at(5),
      lastSeenAt: at(10),
      lastConfirmedLiveAt: null,
      postedAt: at(4),
      closingAt: null,
      saved: false,
    };
    const drop = {
      firstSeenAt: at(1),
      lastSeenAt: at(20),
      lastConfirmedLiveAt: at(19),
      postedAt: at(0),
      closingAt: at(60),
      saved: true,
    };
    expect(mergedJobFields(keep, drop)).toEqual({
      firstSeenAt: at(1),
      lastSeenAt: at(20),
      lastConfirmedLiveAt: at(19),
      postedAt: at(0),
      closingAt: at(60),
      saved: true,
    });
    expect(mergedJobFields({ ...keep, closingAt: at(30) }, drop).closingAt).toEqual(at(30));
    expect(mergedJobFields(keep, { ...drop, postedAt: null }).postedAt).toEqual(at(4));
  });

  it('bestLink prefers the grade, then the first seen, then the oldest row', () => {
    const links = [
      { id: 3, grade: 'B' as const, firstSeenAt: at(0) },
      { id: 2, grade: 'A' as const, firstSeenAt: at(5) },
      { id: 1, grade: 'A' as const, firstSeenAt: at(5) },
      { id: 4, grade: 'A' as const, firstSeenAt: at(6) },
      { id: 5, grade: 'D' as const, firstSeenAt: at(-10) },
    ];
    expect(bestLink(links)?.id).toBe(1);
    expect(bestLink([links[0], links[4]])?.id).toBe(3);
    expect(bestLink([])).toBeNull();
  });

  it('parseJobMergeRecord reads records and rejects junk', () => {
    const rec = parseJobMergeRecord(
      JSON.stringify({
        v: 1,
        dropId: 7,
        jobSourceIds: [1, 2, 'x', 2],
        factIds: [3],
        keepBefore: { firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: 5 },
        dropBefore: { hidden: true, hiddenReason: 'spam' },
      }),
    );
    expect(rec).toMatchObject({
      v: 1,
      dropId: 7,
      jobSourceIds: [1, 2],
      factIds: [3],
      deactivatedFactIds: [],
      applicationIds: [],
      keepBefore: { firstSeenAt: '2026-09-01T00:00:00.000Z', lastSeenAt: null, postedAt: null },
      dropBefore: { hidden: true, hiddenReason: 'spam' },
    });
    expect(parseJobMergeRecord(null)).toBeNull();
    expect(parseJobMergeRecord('')).toBeNull();
    expect(parseJobMergeRecord('{')).toBeNull();
    expect(parseJobMergeRecord('[1,2]')).toBeNull();
    expect(parseJobMergeRecord('{"dropId":-1}')).toBeNull();
    expect(parseJobMergeRecord('{"dropId":3}')).toMatchObject({ dropId: 3, v: 0, dropBefore: { hidden: false, hiddenReason: null } });
  });
});
