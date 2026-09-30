/**
 * Visa rule knowledge base, pure part (spec §13.1): which version is in effect on a day, the
 * 90-day staleness rule, labels, and the page-content hash used by the official page watch.
 */
import { describe, expect, it } from 'vitest';
import {
  describeRule,
  isRuleStale,
  pageContentHash,
  pageContentText,
  RULE_STALE_DAYS,
  ruleFreshness,
  ruleInEffect,
} from '../../src/lib/visa/rules';

const NOW = new Date('2026-09-30T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

type V = { id: string; version: number; effectiveFrom: string | null; effectiveTo: string | null };
const v = (id: string, version: number, effectiveFrom: string | null, effectiveTo: string | null = null): V => ({ id, version, effectiveFrom, effectiveTo });

describe('ruleInEffect', () => {
  const versions: V[] = [
    v('retired', 1, '2020-01-01', '2023-12-31'),
    v('v2', 2, '2024-01-01'),
    v('v3', 3, '2026-06-01'),
    v('v4-same-day-correction', 4, '2026-06-01'),
    v('future', 5, '2027-01-01'),
  ];

  it('returns null before the first rule starts', () => {
    expect(ruleInEffect(versions, '2019-12-31')).toBeNull();
    expect(ruleInEffect([], '2026-09-30')).toBeNull();
  });

  it('respects effective_from and the inclusive effective_to', () => {
    expect(ruleInEffect(versions, '2020-01-01')?.id).toBe('retired');
    expect(ruleInEffect(versions, '2023-12-31')?.id).toBe('retired');
    expect(ruleInEffect(versions, '2024-01-01')?.id).toBe('v2');
    expect(ruleInEffect(versions, '2026-05-31')?.id).toBe('v2');
  });

  it('on the same effective day the higher version wins', () => {
    expect(ruleInEffect(versions, '2026-06-01')?.id).toBe('v4-same-day-correction');
    expect(ruleInEffect(versions, '2026-09-30')?.id).toBe('v4-same-day-correction');
  });

  it('a future version is not in effect until its day', () => {
    expect(ruleInEffect(versions, '2026-12-31')?.id).toBe('v4-same-day-correction');
    expect(ruleInEffect(versions, '2027-01-01')?.id).toBe('future');
  });

  it('a Date is read as its UTC day', () => {
    // 23:30 at UTC-2 on 31 May is already 1 June in UTC.
    expect(ruleInEffect(versions, new Date('2026-05-31T23:30:00-02:00'))?.id).toBe('v4-same-day-correction');
    expect(ruleInEffect(versions, new Date('2026-05-31T23:59:59Z'))?.id).toBe('v2');
  });

  it('a version without effective_from counts as always in effect (lowest priority)', () => {
    const list = [v('undated', 1, null), v('dated', 2, '2025-01-01')];
    expect(ruleInEffect(list, '2024-06-01')?.id).toBe('undated');
    expect(ruleInEffect(list, '2025-06-01')?.id).toBe('dated');
  });

  it('rejects a malformed day string', () => {
    expect(() => ruleInEffect(versions, '2026/09/30')).toThrow(RangeError);
    expect(() => ruleInEffect(versions, '30-09-2026')).toThrow(RangeError);
  });
});

describe('ruleFreshness / isRuleStale (90-day rule)', () => {
  const verified = (at: Date, nextReviewAt: Date | null = null) => ({ verificationStatus: 'verified' as const, lastVerifiedAt: at, nextReviewAt });

  it('the threshold is 90 days', () => {
    expect(RULE_STALE_DAYS).toBe(90);
  });

  it('verified exactly 90 days ago is still fresh', () => {
    const f = ruleFreshness(verified(daysAgo(90)), NOW);
    expect(f).toMatchObject({ stale: false, neverVerified: false, daysSinceVerified: 90, reviewDue: false, warning: null });
    expect(isRuleStale(verified(daysAgo(90)), NOW)).toBe(false);
  });

  it('verified 91 days ago is stale, with a dated warning', () => {
    const f = ruleFreshness(verified(daysAgo(91)), NOW);
    expect(f.stale).toBe(true);
    expect(f.daysSinceVerified).toBe(91);
    expect(f.warning).toContain('2026-07-01');
    expect(f.warning).toContain('91 days ago');
    expect(isRuleStale(verified(daysAgo(91)), NOW)).toBe(true);
  });

  it('never verified is stale', () => {
    const f = ruleFreshness({ verificationStatus: 'unverified', lastVerifiedAt: null, nextReviewAt: null }, NOW);
    expect(f).toMatchObject({ stale: true, neverVerified: true, daysSinceVerified: null });
    expect(f.warning).toMatch(/never verified/i);
  });

  it('an unverified row with a stray lastVerifiedAt still counts as never verified', () => {
    const f = ruleFreshness({ verificationStatus: 'unverified', lastVerifiedAt: daysAgo(1), nextReviewAt: null }, NOW);
    expect(f.stale).toBe(true);
    expect(f.neverVerified).toBe(true);
  });

  it('a passed next_review_at is a softer reminder, not stale', () => {
    const f = ruleFreshness(verified(daysAgo(10), daysAgo(2)), NOW);
    expect(f.stale).toBe(false);
    expect(f.reviewDue).toBe(true);
    expect(f.warning).toMatch(/review was due 2026-09-28/);
  });
});

describe('describeRule', () => {
  it('labels a rule version by country, route code and version', () => {
    expect(describeRule({ countryIso2: 'DE', code: 'eu_blue_card' }, { version: 2 })).toBe('DE eu_blue_card v2');
  });
});

describe('pageContentText / pageContentHash (official page watch)', () => {
  const page = (main: string, footer: string) =>
    `<!doctype html><html><head><title>Skilled Worker visa</title></head><body>` +
    `<header><a href="/">GOV.UK</a> Cookies on GOV.UK</header>` +
    `<main id="content"><h1>Skilled Worker visa</h1><p>${main}</p></main>` +
    `<footer>${footer}</footer></body></html>`;

  it('uses only the <main> element of an HTML page', () => {
    const text = pageContentText(page('You must be paid at least £41,700 per year.', 'Last updated 1 Sep'), 'text/html; charset=utf-8');
    expect(text).toContain('Skilled Worker visa');
    expect(text).toContain('£41,700');
    expect(text).not.toContain('Cookies');
    expect(text).not.toContain('Last updated');
  });

  it('falls back to <article>, then to the whole page', () => {
    expect(pageContentText('<html><body><nav>Menu</nav><article><p>Blue Card rules</p></article></body></html>', 'text/html')).toBe('Blue Card rules');
    expect(pageContentText('<html><body><p>Whole page</p></body></html>', null)).toBe('Whole page');
  });

  it('keeps plain text as it is', () => {
    expect(pageContentText('Salary threshold: 48,300 EUR', 'text/plain')).toBe('Salary threshold: 48,300 EUR');
  });

  it('the hash ignores header/footer churn and whitespace, but not a change in the rules', () => {
    const a = pageContentHash(page('You must be paid at least £41,700 per year.', 'Last updated 1 Sep'), 'text/html');
    const footerChanged = pageContentHash(page('You must be paid at least £41,700 per year.', 'Last updated 29 Sep'), 'text/html');
    const spacing = pageContentHash(page('You  must be paid at least   £41,700 per year.', 'x'), 'text/html');
    const ruleChanged = pageContentHash(page('You must be paid at least £45,000 per year.', 'Last updated 1 Sep'), 'text/html');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(footerChanged).toBe(a);
    expect(spacing).toBe(a);
    expect(ruleChanged).not.toBe(a);
  });
});
