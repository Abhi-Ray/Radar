/**
 * Country guide model: rule selection by date, freshness (90-day stale), the country marker,
 * the go-live guard and the lenient readers for the country JSON columns.
 */
import { describe, expect, it } from 'vitest';
import {
  countryRuleMarker,
  goLiveCheck,
  isDay,
  parseBestSites,
  parseCvConventions,
  parseLanguages,
  parseOtherRules,
  parseSalaryRanges,
  ruleFreshness,
  ruleInEffect,
  upcomingVersions,
} from '../../src/components/countries/model';

const NOW = new Date('2026-09-30T12:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

describe('rule in effect', () => {
  const versions = [
    { version: 1, effectiveFrom: '2025-01-01', effectiveTo: '2025-12-31' },
    { version: 2, effectiveFrom: '2026-01-01', effectiveTo: null },
    { version: 3, effectiveFrom: '2026-01-01', effectiveTo: null },
    { version: 4, effectiveFrom: '2027-01-01', effectiveTo: null },
  ];

  it('picks the latest start on or before the day, ties to the higher version', () => {
    expect(ruleInEffect(versions, '2026-09-30')?.version).toBe(3);
    expect(ruleInEffect(versions, '2025-12-31')?.version).toBe(1);
    expect(ruleInEffect(versions, '2024-06-01')).toBeNull();
    expect(ruleInEffect(versions, '2027-01-01')?.version).toBe(4);
  });

  it('treats the end date as inclusive and lists announced versions', () => {
    const ended = [{ version: 1, effectiveFrom: '2025-01-01', effectiveTo: '2026-09-29' }];
    expect(ruleInEffect(ended, '2026-09-29')?.version).toBe(1);
    expect(ruleInEffect(ended, '2026-09-30')).toBeNull();
    expect(upcomingVersions(versions, '2026-09-30').map((v) => v.version)).toEqual([4]);
  });

  it('validates calendar days', () => {
    expect(isDay('2026-02-28')).toBe(true);
    expect(isDay('2026-02-30')).toBe(false);
    expect(isDay('2026-2-1')).toBe(false);
  });
});

describe('freshness and go-live', () => {
  const verified = (days: number) => ({ verificationStatus: 'verified', lastVerifiedAt: daysAgo(days), nextReviewAt: new Date(daysAgo(days).getTime() + 90 * 86_400_000) });
  const unverified = { verificationStatus: 'unverified', lastVerifiedAt: null, nextReviewAt: null };

  it('is stale after 90 days and when never verified', () => {
    expect(ruleFreshness(verified(10), NOW)).toMatchObject({ state: 'verified', stale: false, daysSinceVerified: 10, reviewDue: false, warning: null });
    expect(ruleFreshness(verified(90), NOW)).toMatchObject({ state: 'verified', stale: false });
    const old = ruleFreshness(verified(91), NOW);
    expect(old).toMatchObject({ state: 'stale', stale: true, reviewDue: true });
    expect(old.warning).toMatch(/91 days ago/);
    expect(ruleFreshness(unverified, NOW)).toMatchObject({ state: 'unverified', stale: true, neverVerified: true });
    // A verified timestamp on an unverified row does not count.
    expect(ruleFreshness({ ...verified(1), verificationStatus: 'unverified' }, NOW).state).toBe('unverified');
  });

  it('marks the country by its worst rule in effect', () => {
    expect(countryRuleMarker([], NOW)).toBe('none');
    expect(countryRuleMarker([verified(5), verified(100)], NOW)).toBe('stale');
    expect(countryRuleMarker([verified(5), unverified], NOW)).toBe('unverified');
    expect(countryRuleMarker([verified(5)], NOW)).toBe('verified');
  });

  it('only goes live with a verified, fresh rule and explains why not', () => {
    expect(goLiveCheck([verified(5), unverified], NOW)).toEqual({ ok: true });
    const none = goLiveCheck([], NOW);
    expect(none.ok).toBe(false);
    expect(!none.ok && none.reason).toMatch(/No visa rule/);
    const never = goLiveCheck([unverified], NOW);
    expect(!never.ok && never.reason).toMatch(/verified yet/);
    const stale = goLiveCheck([verified(120)], NOW);
    expect(!stale.ok && stale.reason).toMatch(/stale/);
  });
});

describe('country JSON readers', () => {
  it('reads salary ranges as estimates unless told otherwise', () => {
    const list = parseSalaryRanges(
      [
        { role: 'Cloud security engineer', min: 70000, max: 60000, currency: 'eur', source: 'Levels', sourceUrl: 'javascript:alert(1)' },
        { label: 'AppSec (senior)', median: '95000', basis: 'official', url: 'https://destatis.de/x', asOf: 2025 },
        { label: 'No numbers' },
      ],
      'EUR',
    );
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ label: 'Cloud security engineer', currency: 'EUR', min: 60000, max: 70000, basis: 'estimate', sourceHref: null });
    expect(list[1]).toMatchObject({ median: 95000, basis: 'official', sourceHref: 'https://destatis.de/x', asOf: '2025' });
    const keyed = parseSalaryRanges({ currency: 'CHF', junior_security: { low: 90000, high: 110000 } }, 'EUR');
    expect(keyed).toEqual([expect.objectContaining({ label: 'junior security', currency: 'CHF', min: 90000, max: 110000 })]);
    expect(parseSalaryRanges({ ranges: [{ label: 'x', max: 1 }] }, 'SEK')[0].currency).toBe('SEK');
    expect(parseSalaryRanges('nonsense')).toEqual([]);
  });

  it('reads best sites and keeps only safe links', () => {
    expect(parseBestSites(['https://www.stepstone.de/jobs', 'Xing', { name: 'Berlin Startup Jobs', url: 'https://berlinstartupjobs.com', note: 'Startups' }, { url: 'ftp://x' }])).toEqual([
      { name: 'stepstone.de', href: 'https://www.stepstone.de/jobs', note: null },
      { name: 'Xing', href: null, note: null },
      { name: 'Berlin Startup Jobs', href: 'https://berlinstartupjobs.com/', note: 'Startups' },
    ]);
  });

  it('reads CV conventions with known keys first', () => {
    const cv = parseCvConventions({ photo: false, length: 2, personalDetails: ['Date of birth optional', 'No marital status'], signature: 'Sign and date', notes: 'Tabular Lebenslauf is common.' });
    expect(cv.items).toEqual([
      { key: 'length', label: 'Length', value: '2 pages' },
      { key: 'photo', label: 'Photo', value: 'No' },
      { key: 'personal', label: 'Personal details', value: 'Date of birth optional, No marital status' },
      { key: 'signature', label: 'Signature', value: 'Sign and date' },
    ]);
    expect(cv.notes).toEqual(['Tabular Lebenslauf is common.']);
    expect(parseCvConventions(['One page', 2]).notes).toEqual(['One page', '2']);
    expect(parseCvConventions(null)).toEqual({ items: [], notes: [] });
  });

  it('reads other rules and languages', () => {
    expect(parseOtherRules({ minContractMonths: 6, shortageList: true })).toEqual([
      { label: 'Min Contract Months', value: '6' },
      { label: 'Shortage List', value: 'Yes' },
    ]);
    expect(parseOtherRules(['Job offer required'])).toEqual([{ label: 'Rule 1', value: 'Job offer required' }]);
    expect(parseLanguages(['German', '', 3])).toEqual(['German', '3']);
  });
});
