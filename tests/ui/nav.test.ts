/** Shell navigation model: active-section matching, mobile tabs vs the More sheet. */
import { describe, expect, it } from 'vitest';
import {
  MOBILE_TAB_HREFS,
  MOBILE_TABS,
  MORE_ITEMS,
  NAV_GROUPS,
  NAV_ITEMS,
  activeItem,
  isActivePath,
  isMoreActive,
} from '@/components/shell/nav';

describe('NAV_ITEMS', () => {
  it('has unique hrefs and section codes', () => {
    expect(new Set(NAV_ITEMS.map((i) => i.href)).size).toBe(NAV_ITEMS.length);
    expect(new Set(NAV_ITEMS.map((i) => i.code)).size).toBe(NAV_ITEMS.length);
  });
  it('covers every spec route', () => {
    expect(NAV_ITEMS.map((i) => i.href).sort()).toEqual(
      ['/', '/jobs', '/applications', '/companies', '/countries', '/kit', '/review', '/sources', '/accuracy', '/system', '/settings'].sort(),
    );
  });
  it('assigns every item to a declared group', () => {
    const groups = new Set(NAV_GROUPS.map((g) => g.key));
    for (const i of NAV_ITEMS) expect(groups.has(i.group)).toBe(true);
  });
});

describe('mobile tabs and More sheet', () => {
  it('resolves four bottom tabs in order', () => {
    expect(MOBILE_TABS).toHaveLength(4);
    expect(MOBILE_TABS.map((t) => t?.href)).toEqual([...MOBILE_TAB_HREFS]);
  });
  it('partitions the nav between tabs and the More sheet', () => {
    const all = [...MOBILE_TABS, ...MORE_ITEMS].map((i) => i.href).sort();
    expect(all).toEqual(NAV_ITEMS.map((i) => i.href).sort());
    for (const m of MORE_ITEMS) expect(MOBILE_TAB_HREFS).not.toContain(m.href);
  });
});

describe('isActivePath', () => {
  it('matches the desk only exactly', () => {
    expect(isActivePath('/', '/')).toBe(true);
    expect(isActivePath('/jobs', '/')).toBe(false);
    expect(isActivePath('/#top', '/')).toBe(true);
    expect(isActivePath('/?q=1', '/')).toBe(true);
  });
  it('matches a section and its sub-routes but not look-alikes', () => {
    expect(isActivePath('/jobs', '/jobs')).toBe(true);
    expect(isActivePath('/jobs/42', '/jobs')).toBe(true);
    expect(isActivePath('/jobs/', '/jobs')).toBe(true);
    expect(isActivePath('/jobs?country=DE', '/jobs')).toBe(true);
    expect(isActivePath('/jobsearch', '/jobs')).toBe(false);
    expect(isActivePath('/applications', '/jobs')).toBe(false);
  });
  it('is false without a pathname', () => {
    expect(isActivePath(null, '/')).toBe(false);
    expect(isActivePath(undefined, '/jobs')).toBe(false);
    expect(isActivePath('', '/')).toBe(false);
  });
});

describe('activeItem / isMoreActive', () => {
  it('finds the owning section', () => {
    expect(activeItem('/')?.label).toBe('Desk');
    expect(activeItem('/jobs/42')?.href).toBe('/jobs');
    expect(activeItem('/countries/DE')?.href).toBe('/countries');
    expect(activeItem('/settings/sessions')?.href).toBe('/settings');
    expect(activeItem('/styleguide')).toBeUndefined();
    expect(activeItem(null)).toBeUndefined();
  });
  it('lights More for sheet sections and the styleguide only', () => {
    expect(isMoreActive('/companies/5')).toBe(true);
    expect(isMoreActive('/system')).toBe(true);
    expect(isMoreActive('/styleguide')).toBe(true);
    expect(isMoreActive('/jobs')).toBe(false);
    expect(isMoreActive('/review')).toBe(false);
    expect(isMoreActive('/')).toBe(false);
  });
});
