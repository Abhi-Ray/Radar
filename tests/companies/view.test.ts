/** Pure /companies helpers: size labels, register summary line, match meta, URL filters. */
import { describe, expect, it } from 'vitest';
import { activeCompanyFilterCount, companiesHref, EMPTY_COMPANY_FILTERS, parseCompanyFilters, toggleValue } from '../../src/components/companies/filters';
import type { SponsorSummaryView } from '../../src/components/companies/model';
import { matchStatusMeta, registerSummaryLine, sizeLabel, SPONSOR_CLASS_META } from '../../src/components/companies/view';

function summary(registers: SponsorSummaryView['registers']): SponsorSummaryView {
  return { status: 'confirmed', sponsorCountries: ['GB'], historyCountries: [], possibleMatches: 0, registers, at: null, logicVersion: null };
}

const reg = (registerKey: string, registerVersion: string | null, countryIso2: string | null = 'GB') => ({
  registerKey,
  countryIso2,
  orgName: 'Acme Ltd',
  matchStatus: 'confirmed',
  matchType: 'exact',
  registerVersion,
});

describe('company view helpers', () => {
  it('labels size bands and passes free text through', () => {
    expect(sizeLabel('51-250')).toBe('51–250 people');
    expect(sizeLabel('1000+')).toBe('1000+ people');
    expect(sizeLabel(' 11 - 50 ')).toBe('11–50 people');
    expect(sizeLabel('Large enterprise')).toBe('Large enterprise');
    expect(sizeLabel(null)).toBeNull();
    expect(sizeLabel('   ')).toBeNull();
  });

  it('summarises the registers on one line', () => {
    expect(registerSummaryLine(null)).toBeNull();
    expect(registerSummaryLine(summary([]))).toBeNull();
    expect(registerSummaryLine(summary([reg('uk_home_office', '2026-09-01')]))).toBe('UK home office · GB · 2026-09-01');
    expect(registerSummaryLine(summary([reg('uk_home_office', null, null)]))).toBe('UK home office');
    expect(registerSummaryLine(summary([reg('uk_home_office', '2026-08-01'), reg('nl_ind', '2026-09-12', 'NL')]))).toBe('2 registers · newest 2026-09-12');
  });

  it('knows the match statuses and falls back for unknown ones', () => {
    expect(matchStatusMeta('possible').tone).toBe('acid');
    expect(matchStatusMeta('rejected').label).toBe('Rejected match');
    expect(matchStatusMeta('weird')).toEqual({ label: 'weird', tone: 'concrete', blurb: '' });
    expect(matchStatusMeta('').label).toBe('Unknown');
    expect(SPONSOR_CLASS_META.none.stamp).toBe('No evidence');
  });
});

describe('company filters', () => {
  it('parses and cleans the query string', () => {
    const f = parseCompanyFilters({ q: '  acme ', sponsor: ['confirmed', 'bogus', 'confirmed'], size: ['51-250', '<script>'], type: ['scaleup', 'nope'], country: ['de', 'NONE', 'xyz'], agency: 'no', sort: 'name', page: '3' });
    expect(f).toEqual({ q: 'acme', sponsor: ['confirmed'], size: ['51-250'], type: ['scaleup'], country: ['DE', 'none'], agency: 'no', sort: 'name', page: 3 });
    expect(activeCompanyFilterCount(f)).toBe(1 + 1 + 1 + 1 + 2 + 1);
  });

  it('defaults bad values and resets the page when a filter changes', () => {
    expect(parseCompanyFilters({ agency: 'maybe', sort: 'drop table', page: '-4' })).toEqual(EMPTY_COMPANY_FILTERS);
    const f = { ...EMPTY_COMPANY_FILTERS, sponsor: ['possible' as const], page: 4 };
    const href = companiesHref(f, { sponsor: toggleValue(f.sponsor, 'confirmed') });
    expect(href).toContain('sponsor=possible');
    expect(href).toContain('sponsor=confirmed');
    expect(href).not.toContain('page=');
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});
