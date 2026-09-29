/** URL-state helpers behind link-driven filters, tabs, sorting and pagination. */
import { describe, expect, it } from 'vitest';
import {
  hrefToggle,
  hrefWith,
  pageFromParams,
  pageRange,
  pageWindow,
  paramList,
  paramValue,
  safeExternalHref,
} from '@/components/ui/url';

describe('hrefWith', () => {
  it('merges updates, sorts keys and resets the page on any change', () => {
    expect(hrefWith('/jobs', { country: ['DE', 'NL'], page: '3' }, { visa: 'confirmed' })).toBe(
      '/jobs?country=DE&country=NL&visa=confirmed',
    );
  });
  it('keeps the page when asked, or when the page itself is the update', () => {
    expect(hrefWith('/jobs', { page: '3', q: 'go' }, { sort: 'fit' }, { keepPage: true })).toBe('/jobs?page=3&q=go&sort=fit');
    expect(hrefWith('/jobs', { page: '3', q: 'go' }, { page: 4 })).toBe('/jobs?page=4&q=go');
  });
  it('honours a custom page param', () => {
    expect(hrefWith('/sources', { p: '2', page: '9' }, { q: 'x' }, { pageParam: 'p' })).toBe('/sources?page=9&q=x');
  });
  it('removes keys for null, undefined, empty string and false', () => {
    const cur = { a: '1', b: '2', c: '3', d: '4', e: '5' };
    expect(hrefWith('/x', cur, { a: null, b: undefined, c: '', d: false })).toBe('/x?e=5');
    expect(hrefWith('/x', { a: '1' }, { a: null })).toBe('/x');
  });
  it('serialises true as 1, numbers as strings and arrays as repeated keys', () => {
    expect(hrefWith('/x', {}, { remote: true, min: 48000, tag: ['a', 'b'] })).toBe('/x?min=48000&remote=1&tag=a&tag=b');
  });
  it('encodes values', () => {
    expect(hrefWith('/jobs', null, { q: 'a b&c' })).toBe('/jobs?q=a+b%26c');
  });
  it('returns the bare pathname when there is nothing to add', () => {
    expect(hrefWith('/jobs', undefined)).toBe('/jobs');
    expect(hrefWith('/jobs', { page: '2' })).toBe('/jobs?page=2');
  });
  it('does not mutate a URLSearchParams input', () => {
    const sp = new URLSearchParams('a=1&page=2');
    hrefWith('/x', sp, { a: '2' });
    expect(sp.toString()).toBe('a=1&page=2');
  });
  it('skips undefined entries of a Next searchParams object', () => {
    expect(hrefWith('/x', { a: undefined, b: '1' }, {}, {})).toBe('/x?b=1');
  });
});

describe('hrefToggle', () => {
  it('adds a value to a multi-value param', () => {
    expect(hrefToggle('/jobs', { country: 'DE' }, 'country', 'NL')).toBe('/jobs?country=DE&country=NL');
  });
  it('removes a present value and drops the key when empty', () => {
    expect(hrefToggle('/jobs', { country: ['DE', 'NL'] }, 'country', 'DE')).toBe('/jobs?country=NL');
    expect(hrefToggle('/jobs', { country: 'DE' }, 'country', 'DE')).toBe('/jobs');
  });
  it('resets the page', () => {
    expect(hrefToggle('/jobs', { page: '4', visa: 'likely' }, 'visa', 'confirmed')).toBe('/jobs?visa=likely&visa=confirmed');
  });
});

describe('paramValue / paramList', () => {
  it('reads the first value', () => {
    expect(paramValue({ tab: ['open', 'closed'] }, 'tab')).toBe('open');
    expect(paramValue(new URLSearchParams('tab=x'), 'tab')).toBe('x');
    expect(paramValue({}, 'tab')).toBeUndefined();
    expect(paramValue(null, 'tab')).toBeUndefined();
  });
  it('reads repeated and comma-separated values, trimmed, without empties', () => {
    expect(paramList({ country: ['DE,NL', ' IE ', ''] }, 'country')).toEqual(['DE', 'NL', 'IE']);
    expect(paramList({ country: 'DE,,NL,' }, 'country')).toEqual(['DE', 'NL']);
    expect(paramList(undefined, 'country')).toEqual([]);
  });
});

describe('pageFromParams', () => {
  it('parses positive integers', () => {
    expect(pageFromParams({ page: '3' })).toBe(3);
    expect(pageFromParams({ page: '2.7' })).toBe(2);
    expect(pageFromParams({ p: '5' }, 'p')).toBe(5);
  });
  it('falls back to 1 for anything invalid', () => {
    expect(pageFromParams({})).toBe(1);
    expect(pageFromParams({ page: '0' })).toBe(1);
    expect(pageFromParams({ page: '-2' })).toBe(1);
    expect(pageFromParams({ page: 'abc' })).toBe(1);
    expect(pageFromParams({ page: '' })).toBe(1);
  });
});

describe('pageWindow', () => {
  it('shows first, last and current ± siblings with gaps', () => {
    expect(pageWindow(6, 20)).toEqual([1, 'gap', 5, 6, 7, 'gap', 20]);
    expect(pageWindow(1, 5)).toEqual([1, 2, 'gap', 5]);
    expect(pageWindow(6, 20, 2)).toEqual([1, 'gap', 4, 5, 6, 7, 8, 'gap', 20]);
  });
  it('fills a single skipped page instead of printing a gap', () => {
    expect(pageWindow(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(pageWindow(3, 5)).toEqual([1, 2, 3, 4, 5]);
  });
  it('clamps the current page and degenerate totals', () => {
    expect(pageWindow(99, 10)).toEqual([1, 'gap', 9, 10]);
    expect(pageWindow(0, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 0)).toEqual([1]);
    expect(pageWindow(1, 1)).toEqual([1]);
  });
});

describe('pageRange', () => {
  it('computes the visible slice', () => {
    expect(pageRange(3, 20, 1204)).toEqual({ from: 41, to: 60 });
    expect(pageRange(61, 20, 1204)).toEqual({ from: 1201, to: 1204 });
    expect(pageRange(1, 20, 5)).toEqual({ from: 1, to: 5 });
  });
  it('handles empty and out-of-range pages', () => {
    expect(pageRange(1, 20, 0)).toEqual({ from: 0, to: 0 });
    expect(pageRange(100, 20, 50)).toEqual({ from: 50, to: 50 });
    expect(pageRange(0, 20, 50)).toEqual({ from: 1, to: 20 });
  });
});

describe('safeExternalHref', () => {
  it('keeps absolute http(s) URLs, normalised', () => {
    expect(safeExternalHref('https://careers.example.com/jobs/42?src=radar')).toBe('https://careers.example.com/jobs/42?src=radar');
    expect(safeExternalHref('  http://Example.COM  ')).toBe('http://example.com/');
  });
  it('rejects script and other non-web schemes, including obfuscated ones', () => {
    for (const bad of [
      'javascript:alert(1)',
      'JaVaScRiPt:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)', // tab inside the scheme (browsers strip it)
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
      'mailto:hr@example.com',
      'ftp://example.com/a',
    ]) {
      expect(safeExternalHref(bad), bad).toBeNull();
    }
  });
  it('rejects relative, protocol-relative, credentialed and empty input', () => {
    expect(safeExternalHref('/jobs/1')).toBeNull();
    expect(safeExternalHref('//evil.example.com')).toBeNull();
    expect(safeExternalHref('https://user:pass@example.com/')).toBeNull();
    expect(safeExternalHref('not a url')).toBeNull();
    expect(safeExternalHref('')).toBeNull();
    expect(safeExternalHref(null)).toBeNull();
    expect(safeExternalHref(undefined)).toBeNull();
  });
});
