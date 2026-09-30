/** Pure quality gates and daily source checks. */
import { describe, expect, it } from 'vitest';
import type { NormalizedJob } from '../../src/lib/contracts/jobs';
import {
  evaluateSourceHealth,
  fieldPresence,
  MAX_URL,
  parseFailTooHigh,
  PresenceCounter,
  SUBSTANTIAL_DESCRIPTION_CHARS,
  validateNormalizedJob,
  type SourceHealthInput,
} from '../../src/lib/pipeline/quality';
import { DAY_MS, HOUR_MS } from '../../src/lib/time';

const now = new Date('2026-09-30T00:30:00.000Z');

function job(over: Partial<NormalizedJob> = {}): NormalizedJob {
  return {
    sourceId: 1,
    externalId: ' 123 ',
    title: '  Cloud   Security Engineer ',
    companyName: ' Acme  GmbH ',
    companyDomain: ' Acme.COM ',
    locationRaw: ' Berlin,   Germany ',
    countryHint: 'DE',
    descriptionHtml: '<p>Hello</p>',
    descriptionText: 'Hello',
    applyUrl: 'https://jobs.example.com/123',
    postedAt: new Date('2026-09-28T00:00:00.000Z'),
    ...over,
  };
}

describe('validateNormalizedJob', () => {
  it('trims and normalises whitespace, lower-cases the domain', () => {
    const r = validateNormalizedJob(job(), now);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.job).toMatchObject({ externalId: '123', title: 'Cloud Security Engineer', companyName: 'Acme GmbH', companyDomain: 'acme.com', locationRaw: 'Berlin, Germany' });
    expect(r.warnings).toEqual([]);
  });

  it.each([
    [{ externalId: '  ' }, 'externalId'],
    [{ externalId: 'x'.repeat(256) }, 'externalId'],
    [{ title: '' }, 'title'],
    [{ companyName: '   ' }, 'companyName'],
    [{ applyUrl: '' }, 'applyUrl'],
    [{ applyUrl: 'javascript:alert(1)' }, 'applyUrl'],
    [{ applyUrl: 'https://user:pw@example.com/x' }, 'applyUrl'],
    [{ applyUrl: `https://example.com/${'a'.repeat(MAX_URL)}` }, 'applyUrl'],
    [{ descriptionText: ' ', descriptionHtml: null }, 'description'],
  ] as [Partial<NormalizedJob>, string][])('rejects %o on %s', (over, field) => {
    const r = validateNormalizedJob(job(over), now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe(field);
  });

  it('accepts an HTML-only description', () => {
    expect(validateNormalizedJob(job({ descriptionText: '', descriptionHtml: '<p>Body</p>' }), now).ok).toBe(true);
  });

  it('drops a future posted date and a closing date before the posted date (warnings)', () => {
    const future = validateNormalizedJob(job({ postedAt: new Date(now.getTime() + 2 * DAY_MS) }), now);
    expect(future.ok && future.job.postedAt).toBeNull();
    expect(future.ok && future.warnings[0]).toContain('in the future');
    const nearFuture = validateNormalizedJob(job({ postedAt: new Date(now.getTime() + HOUR_MS) }), now);
    expect(nearFuture.ok && nearFuture.job.postedAt).toBeInstanceOf(Date);
    const closing = validateNormalizedJob(job({ closingAt: new Date('2026-09-01T00:00:00.000Z') }), now);
    expect(closing.ok && closing.job.closingAt).toBeNull();
    expect(closing.ok && closing.warnings).toEqual(['closing date before posted date (dropped)']);
    const invalid = validateNormalizedJob(job({ postedAt: new Date('nope') }), now);
    expect(invalid.ok && invalid.warnings).toEqual(['posted date invalid (dropped)']);
  });
});

describe('field presence', () => {
  it('detects the normally-filled fields', () => {
    const p = fieldPresence(job({ descriptionText: 'x'.repeat(SUBSTANTIAL_DESCRIPTION_CHARS), salaryHint: { min: 1, currency: 'EUR', period: 'year' }, workplaceHint: 'remote' }));
    expect(p).toMatchObject({ location: true, country: true, posted_at: true, closing_at: false, salary: true, description: true, workplace: true, employment_type: false, company_domain: true });
    expect(fieldPresence(job({ descriptionText: 'short' })).description).toBe(false);
  });

  it('PresenceCounter reports shares and median freshness', () => {
    const c = new PresenceCounter();
    expect(c.shares()).toBeNull();
    expect(c.freshnessHours()).toBeNull();
    c.add(job({ postedAt: new Date(now.getTime() - 10 * HOUR_MS) }), now);
    c.add(job({ postedAt: new Date(now.getTime() - 30 * HOUR_MS), countryHint: null }), now);
    c.add(job({ postedAt: null, countryHint: null }), now);
    expect(c.total).toBe(3);
    expect(c.shares()).toMatchObject({ country: 0.333, location: 1, posted_at: 0.667 });
    expect(c.freshnessHours()).toBe(20);
  });
});

describe('daily source checks', () => {
  const settings = { volumeDropPct: 60, volumeSpikePct: 300, parseFailPct: 20, fieldDriftPct: 30 };
  const baseline = { volume_min: 100, volume_max: 120, freshness_hours: 12, field_presence: { salary: 0.8, location: 1 } };
  const input = (over: Partial<SourceHealthInput> = {}): SourceHealthInput => ({
    listed: 110,
    attempted: 10,
    failedParse: 0,
    parsed: 10,
    presence: { salary: 0.8, location: 1 },
    baseline,
    settings,
    completeListing: true,
    ...over,
  });

  it('nothing unusual → no flags', () => {
    expect(evaluateSourceHealth(input())).toEqual({});
  });

  it('volume drop and spike only for complete listings with a baseline', () => {
    expect(evaluateSourceHealth(input({ listed: 39 })).volume_drop).toEqual({ listed: 39, baselineMin: 100, thresholdPct: 60 });
    expect(evaluateSourceHealth(input({ listed: 40 })).volume_drop).toBeUndefined();
    expect(evaluateSourceHealth(input({ listed: 481 })).volume_spike).toMatchObject({ listed: 481 });
    expect(evaluateSourceHealth(input({ listed: 1, completeListing: false }))).toEqual({});
    expect(evaluateSourceHealth(input({ listed: 1, baseline: null }))).toEqual({});
  });

  it('parse-failure share needs at least 5 attempted items', () => {
    expect(evaluateSourceHealth(input({ attempted: 10, failedParse: 2 })).parse_fail_pct).toBe(0.2);
    expect(evaluateSourceHealth(input({ attempted: 10, failedParse: 1 })).parse_fail_pct).toBeUndefined();
    expect(evaluateSourceHealth(input({ attempted: 4, failedParse: 4 })).parse_fail_pct).toBeUndefined();
    expect(parseFailTooHigh(10, 2, 20)).toBe(true);
    expect(parseFailTooHigh(4, 4, 20)).toBe(false);
  });

  it('schema drift: a field share falling by more than fieldDriftPct points', () => {
    const f = evaluateSourceHealth(input({ presence: { salary: 0.4, location: 0.95 } }));
    expect(f.schema_drift).toEqual([{ field: 'salary', baseline: 0.8, current: 0.4 }]);
    expect(evaluateSourceHealth(input({ presence: { salary: 0 }, parsed: 9 })).schema_drift).toBeUndefined();
  });
});
