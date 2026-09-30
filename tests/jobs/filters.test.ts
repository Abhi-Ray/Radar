import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTERS,
  SHOW_FLAGS,
  activeDefaultRules,
  activeFilterCount,
  activeRules,
  breakdownOf,
  canonicalJobsHref,
  canonicalJobsRedirect,
  clearFiltersHref,
  confidenceAtLeast,
  filtersToParams,
  jobsHref,
  parseJobFilters,
  passesRule,
  type JobFilterSubject,
  type JobFilters,
} from '@/components/jobs/filters';

const NOW = new Date('2026-09-30T10:00:00Z');

function job(over: Partial<JobFilterSubject> = {}): JobFilterSubject {
  return {
    title: 'Cloud Security Engineer',
    company: 'Nordlicht Cloud',
    countryIso2: 'DE',
    remoteClass: 'not_remote',
    roleFamily: 'primary',
    roleKey: 'cloud_security_engineer',
    companySize: '51-250',
    companyType: 'scaleup',
    isAgency: false,
    visaStatus: 'confirmed',
    salaryEurMin: 60000,
    salaryEurMax: 75000,
    salaryKind: 'stated',
    postedAt: new Date('2026-09-28T00:00:00Z'),
    firstSeenAt: new Date('2026-09-28T06:00:00Z'),
    platformKeys: ['greenhouse'],
    score: 82,
    factsConfidence: 'high',
    state: 'active',
    experienceBand: 'core',
    hidden: false,
    saved: false,
    applied: false,
    ...over,
  };
}

const f = (over: Partial<JobFilters> = {}): JobFilters => ({ ...EMPTY_FILTERS, ...over });

describe('parseJobFilters', () => {
  it('returns the empty model for no params', () => {
    expect(parseJobFilters({})).toEqual(EMPTY_FILTERS);
  });

  it('reads repeated and comma-separated lists, validates enums and upper-cases countries', () => {
    const p = parseJobFilters({
      country: ['de', 'NL,xx1', 'france'],
      remote: 'worldwide,bogus',
      visa: ['confirmed', 'likely'],
      state: 'closed',
      mine: 'saved,applied',
      show: 'all',
      ctype: 'agency',
      source: 'Greenhouse,lever',
      role: 'cloud_security_engineer,Bad Key!',
    });
    expect(p.country).toEqual(['DE', 'NL']);
    expect(p.remote).toEqual(['worldwide']);
    expect(p.visa).toEqual(['confirmed', 'likely']);
    expect(p.state).toEqual(['closed']);
    expect(p.mine).toEqual(['saved', 'applied']);
    expect(p.show).toEqual(['all']);
    expect(p.ctype).toEqual(['agency']);
    expect(p.source).toEqual(['greenhouse', 'lever']);
    expect(p.role).toEqual(['cloud_security_engineer']);
  });

  it('clamps numbers and ignores garbage', () => {
    const p = parseJobFilters({ salary: '45,000', fit: '250', posted: '0', page: '3', sort: 'SALARY', conf: 'Medium', stated: '1' });
    expect(p.salary).toBe(45000);
    expect(p.fit).toBe(100);
    expect(p.posted).toBeNull();
    expect(p.page).toBe(3);
    expect(p.sort).toBe('salary');
    expect(p.conf).toBe('medium');
    expect(p.stated).toBe(true);
    expect(parseJobFilters({ salary: '-5', fit: 'abc', sort: 'random' })).toMatchObject({ salary: null, fit: null, sort: 'fit' });
  });

  it('trims and caps the search text', () => {
    expect(parseJobFilters({ q: '   ' }).q).toBeNull();
    expect(parseJobFilters({ q: '  cloud   security ' }).q).toBe('cloud security');
    expect(parseJobFilters({ q: 'x'.repeat(300) }).q).toHaveLength(100);
  });

  it('round-trips through the URL', () => {
    const model = f({ country: ['DE', 'NL'], visa: ['confirmed'], salary: 50000, stated: true, sort: 'posted', show: ['remote'], page: 2 });
    const href = jobsHref(model, { page: 2 });
    const url = new URL(href, 'http://x');
    const back = parseJobFilters(Object.fromEntries([...url.searchParams.keys()].map((k) => [k, url.searchParams.getAll(k)])));
    expect(back).toEqual(model);
  });

  it('omits defaults from the params and resets the page on filter links', () => {
    const params = filtersToParams(f());
    expect(params.sort).toBeNull();
    expect(params.page).toBeNull();
    expect(jobsHref(f({ page: 4 }))).toBe('/jobs');
    expect(jobsHref(f(), { sort: 'salary' })).toBe('/jobs?sort=salary');
  });
});

describe('default view rules', () => {
  it('all five apply to the bare list', () => {
    expect(activeDefaultRules(f())).toEqual(['remote_limited', 'experience_band', 'target_roles', 'closed', 'hidden']);
  });

  it('"show all" lifts remote/experience/target-roles/closed but never the hidden rule', () => {
    expect(activeDefaultRules(f({ show: ['all'] }))).toEqual(['hidden']);
    expect(activeDefaultRules(f({ show: ['all', 'hidden'] }))).toEqual([]);
  });

  it('explicit remote or state filters replace the matching default rule', () => {
    expect(activeDefaultRules(f({ remote: ['region_limited'] }))).not.toContain('remote_limited');
    expect(activeDefaultRules(f({ state: ['closed'] }))).not.toContain('closed');
    expect(activeDefaultRules(f({ mine: ['hidden'] }))).not.toContain('hidden');
  });

  it('target_roles steps aside for a role / family filter, a search, a "my jobs" view or show=roles', () => {
    expect(activeDefaultRules(f())).toContain('target_roles');
    expect(activeDefaultRules(f({ family: ['other'] }))).not.toContain('target_roles');
    expect(activeDefaultRules(f({ role: ['devsecops_engineer'] }))).not.toContain('target_roles');
    expect(activeDefaultRules(f({ q: 'stripe' }))).not.toContain('target_roles');
    expect(activeDefaultRules(f({ mine: ['saved'] }))).not.toContain('target_roles');
    expect(activeDefaultRules(f({ show: ['roles'] }))).not.toContain('target_roles');
    // the other defaults are unaffected by show=roles
    expect(activeDefaultRules(f({ show: ['roles'] }))).toEqual(['remote_limited', 'experience_band', 'closed', 'hidden']);
  });

  it('target_roles hides only the "other" family — unless you saved it or applied to it', () => {
    const pass = (over: Partial<JobFilterSubject>) => passesRule('target_roles', f(), job(over), NOW);
    for (const roleFamily of ['primary', 'secondary', 'fallback'] as const) expect(pass({ roleFamily })).toBe(true);
    expect(pass({ roleFamily: 'other' })).toBe(false);
    expect(pass({ roleFamily: 'other', saved: true })).toBe(true);
    expect(pass({ roleFamily: 'other', applied: true })).toBe(true);
  });

  it('remote_limited keeps worldwide, unclear, not-remote and unknown; hides region/time-zone limited', () => {
    const pass = (remoteClass: JobFilterSubject['remoteClass']) => passesRule('remote_limited', f(), job({ remoteClass }), NOW);
    expect(pass('worldwide')).toBe(true);
    expect(pass('unclear')).toBe(true);
    expect(pass('not_remote')).toBe(true);
    expect(pass(null)).toBe(true);
    expect(pass('region_limited')).toBe(false);
    expect(pass('timezone_limited')).toBe(false);
  });

  it('experience_band hides only the hide band', () => {
    expect(passesRule('experience_band', f(), job({ experienceBand: 'hide' }), NOW)).toBe(false);
    for (const b of ['core', 'show', 'unknown', null] as const) {
      expect(passesRule('experience_band', f(), job({ experienceBand: b }), NOW)).toBe(true);
    }
  });
});

describe('filter predicates', () => {
  it('search matches title or company, case-insensitive', () => {
    expect(passesRule('q', f({ q: 'NORDLICHT' }), job(), NOW)).toBe(true);
    expect(passesRule('q', f({ q: 'security eng' }), job(), NOW)).toBe(true);
    expect(passesRule('q', f({ q: 'pentest' }), job(), NOW)).toBe(false);
  });

  it('list filters are strict: an unknown value never matches', () => {
    expect(passesRule('country', f({ country: ['DE'] }), job({ countryIso2: null }), NOW)).toBe(false);
    expect(passesRule('role', f({ role: ['x'] }), job({ roleKey: null }), NOW)).toBe(false);
    expect(passesRule('size', f({ size: ['51-250'] }), job({ companySize: null }), NOW)).toBe(false);
  });

  it('unresolved visa counts as unknown', () => {
    expect(passesRule('visa', f({ visa: ['unknown'] }), job({ visaStatus: null }), NOW)).toBe(true);
    expect(passesRule('visa', f({ visa: ['confirmed'] }), job({ visaStatus: null }), NOW)).toBe(false);
  });

  it('agency type matches the agency flag too', () => {
    expect(passesRule('ctype', f({ ctype: ['agency'] }), job({ companyType: 'unknown', isAgency: true }), NOW)).toBe(true);
    expect(passesRule('ctype', f({ ctype: ['startup'] }), job({ companyType: 'unknown', isAgency: true }), NOW)).toBe(false);
  });

  it('salary floor uses the top of the range; stated-only excludes estimates', () => {
    expect(passesRule('salary', f({ salary: 70000 }), job(), NOW)).toBe(true);
    expect(passesRule('salary', f({ salary: 80000 }), job(), NOW)).toBe(false);
    expect(passesRule('salary', f({ salary: 50000 }), job({ salaryEurMax: null, salaryEurMin: 55000 }), NOW)).toBe(true);
    expect(passesRule('salary', f({ salary: 1 }), job({ salaryEurMax: null, salaryEurMin: null }), NOW)).toBe(false);
    expect(passesRule('stated', f({ stated: true }), job({ salaryKind: 'estimated' }), NOW)).toBe(false);
    expect(passesRule('stated', f({ stated: true }), job({ salaryKind: null }), NOW)).toBe(false);
  });

  it('posted window falls back to first seen', () => {
    expect(passesRule('posted', f({ posted: 3 }), job(), NOW)).toBe(true);
    expect(passesRule('posted', f({ posted: 1 }), job(), NOW)).toBe(false);
    expect(passesRule('posted', f({ posted: 1 }), job({ postedAt: null, firstSeenAt: new Date('2026-09-30T01:00:00Z') }), NOW)).toBe(true);
  });

  it('fit and confidence minimums', () => {
    expect(passesRule('fit', f({ fit: 80 }), job(), NOW)).toBe(true);
    expect(passesRule('fit', f({ fit: 80 }), job({ score: null }), NOW)).toBe(false);
    expect(confidenceAtLeast('medium')).toEqual(['high', 'medium']);
    expect(passesRule('conf', f({ conf: 'medium' }), job({ factsConfidence: 'low' }), NOW)).toBe(false);
    expect(passesRule('conf', f({ conf: 'low' }), job({ factsConfidence: 'low' }), NOW)).toBe(true);
    expect(passesRule('conf', f({ conf: 'low' }), job({ factsConfidence: null }), NOW)).toBe(false);
  });

  it('source matches any platform the job was seen on', () => {
    expect(passesRule('source', f({ source: ['lever'] }), job({ platformKeys: ['greenhouse', 'lever'] }), NOW)).toBe(true);
    expect(passesRule('source', f({ source: ['lever'] }), job({ platformKeys: [] }), NOW)).toBe(false);
  });

  it('mine is an OR of saved / applied / hidden', () => {
    expect(passesRule('mine', f({ mine: ['saved', 'applied'] }), job({ applied: true }), NOW)).toBe(true);
    expect(passesRule('mine', f({ mine: ['saved'] }), job({ applied: true }), NOW)).toBe(false);
    expect(passesRule('mine', f({ mine: ['hidden'] }), job({ hidden: true }), NOW)).toBe(true);
  });
});

describe('rule list and breakdown', () => {
  it('lists default rules first, then filters, each with a reveal link', () => {
    const rules = activeRules(f({ country: ['DE'], fit: 70 }));
    expect(rules.map((r) => r.id)).toEqual(['remote_limited', 'experience_band', 'target_roles', 'closed', 'hidden', 'country', 'fit']);
    const remote = rules[0];
    expect(remote.revealHref).toBe('/jobs?country=DE&fit=70&show=remote');
    const country = rules.find((r) => r.id === 'country');
    expect(country?.label).toBe('Country: DE');
    expect(country?.revealHref).toBe('/jobs?fit=70');
    expect(activeFilterCount(f({ country: ['DE'], fit: 70 }))).toBe(2);
  });

  it('clear-filters keeps sort and show', () => {
    expect(clearFiltersHref(f({ country: ['DE'], sort: 'salary', show: ['all'] }))).toBe('/jobs?show=all&sort=salary');
  });

  it('counts single-rule hides per rule and multi-rule hides separately', () => {
    const jobs = [
      job(),
      job({ remoteClass: 'region_limited' }),
      job({ remoteClass: 'region_limited' }),
      job({ experienceBand: 'hide' }),
      job({ hidden: true }),
      job({ state: 'expired', hidden: true }),
      job({ countryIso2: 'NL' }),
      job({ roleFamily: 'other' }),
    ];
    const b = breakdownOf(f({ country: ['DE'] }), jobs, NOW);
    expect(b.total).toBe(8);
    expect(b.shown).toBe(1);
    expect(b.hidden).toBe(7);
    const by = Object.fromEntries(b.byRule.map((r) => [r.rule.id, r.count]));
    expect(by).toEqual({ remote_limited: 2, experience_band: 1, target_roles: 1, closed: 0, hidden: 1, country: 1 });
    expect(b.multi).toBe(1);
  });
});

describe('canonical /jobs URLs', () => {
  it('redirects a submitted form with blanks and defaults to the short URL', () => {
    const submitted = { q: '', sort: 'fit', visa: 'likely', salary: '', fit: '', conf: '', posted: '' };
    expect(canonicalJobsRedirect(submitted)).toBe('/jobs?visa=likely');
    expect(canonicalJobsRedirect(new URLSearchParams('q=+cloud++sec+&country=nl&country=NL&visa=bogus'))).toBe('/jobs?country=NL&q=cloud+sec');
  });

  it('leaves canonical URLs alone, whatever the key order', () => {
    expect(canonicalJobsRedirect({})).toBeNull();
    expect(canonicalJobsRedirect({ visa: 'likely' })).toBeNull();
    expect(canonicalJobsRedirect(new URLSearchParams('visa=confirmed&country=DE&country=NL&page=2'))).toBeNull();
    expect(canonicalJobsRedirect({ sort: 'salary', show: ['all'] })).toBeNull();
  });

  it('is idempotent: the target of a redirect never redirects again', () => {
    const messy = [
      { q: '  AWS ', sort: 'FIT', page: '0', mine: ['saved', 'saved', 'nope'] },
      { country: ['se', 'DE', 'xx1'], salary: '65.000', stated: 'on', show: 'hidden' },
      new URLSearchParams('page=3&sort=newest&remote=worldwide&remote=Worldwide&conf=HIGH'),
    ];
    for (const sp of messy) {
      const target = canonicalJobsRedirect(sp) ?? canonicalJobsHref(parseJobFilters(sp));
      expect(canonicalJobsRedirect(new URLSearchParams(target.split('?')[1] ?? ''))).toBeNull();
    }
  });
});

describe('the filter form', () => {
  it('has a "Default view" checkbox for every show flag, so applying it never re-hides a revealed group', () => {
    const src = readFileSync(new URL('../../src/components/jobs/FilterForm.tsx', import.meta.url), 'utf8');
    for (const flag of SHOW_FLAGS) expect(src, `checkbox for show=${flag}`).toContain(`name="show" value="${flag}"`);
  });
});
