import { describe, expect, it } from 'vitest';
import { domainLabel, domainMatchesName, domainsCompatible, isGenericDomain, normalizeDomain, registrableDomain } from '@/lib/company/domain';
import { wouldCreateParentCycle } from '@/lib/company/family';
import { chunkIds, flattenIds } from '@/lib/company/manual';

describe('normalizeDomain', () => {
  it.each([
    ['https://careers.acme.co.uk/jobs?x=1', 'acme.co.uk'],
    ['https://www.acme.com/about', 'acme.com'],
    ['http://WWW.ACME.DE', 'acme.de'],
    ['www.acme.com', 'acme.com'],
    ['acme.com', 'acme.com'],
    ['acme.com.', 'acme.com'],
    ['jobs@acme.de', 'acme.de'],
    ['mailto:jobs@acme.fr', 'acme.fr'],
    ['https://jobs.eu.acme.com/', 'acme.com'],
    ['https://acme.com.au/careers', 'acme.com.au'],
    ['https://shop.acme.co.jp', 'acme.co.jp'],
    ['https://m.acme.io', 'acme.io'],
    ['https://www2.acme.org', 'acme.org'],
    ['https://acme-robotics.de:8443/x', 'acme-robotics.de'],
    ['https://münchen-bau.de', 'xn--mnchen-bau-9db.de'],
    ['https://careers.google.com', 'google.com'],
  ])('%s → %s', (input, domain) => {
    expect(normalizeDomain(input)).toBe(domain);
  });

  it.each([
    'https://boards.greenhouse.io/acme',
    'https://jobs.lever.co/acme',
    'https://acme.recruitee.com',
    'https://acme.jobs.personio.de',
    'https://www.linkedin.com/company/acme',
    'jobs@gmail.com',
    'someone@gmx.de',
    'https://docs.google.com/forms/d/abc',
    'https://forms.gle/abc',
    'https://acme.notion.site/Jobs',
    'https://acme.github.io',
    'https://apply.workable.com/acme',
    'https://acme.myworkdayjobs.com/en-US/careers',
    'https://192.168.1.1/careers',
    'localhost',
    'not a domain',
    '',
    'https://',
    'http://acme',
  ])('%s → null', (input) => {
    expect(normalizeDomain(input)).toBeNull();
  });

  it('handles null / undefined', () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain(undefined)).toBeNull();
  });
});

describe('registrableDomain / domainLabel / isGenericDomain', () => {
  it.each([
    ['careers.acme.co.uk', 'acme.co.uk'],
    ['acme.co.uk', 'acme.co.uk'],
    ['a.b.acme.com', 'acme.com'],
    ['acme.com', 'acme.com'],
    ['com', 'com'],
  ])('registrableDomain(%s) = %s', (host, reg) => {
    expect(registrableDomain(host)).toBe(reg);
  });

  it.each([
    ['acme.co.uk', 'acme'],
    ['acme-robotics.de', 'acme-robotics'],
    ['jobs.acme.com', 'acme'],
    ['acme.com.au', 'acme'],
  ])('domainLabel(%s) = %s', (domain, label) => {
    expect(domainLabel(domain)).toBe(label);
  });

  it.each([
    ['https://boards.greenhouse.io/acme', true],
    ['gmail.com', true],
    ['https://docs.google.com/x', true],
    ['acme.com', false],
    ['not a host', false],
  ])('isGenericDomain(%s) = %s', (input, generic) => {
    expect(isGenericDomain(input)).toBe(generic);
  });
});

describe('domainsCompatible / domainMatchesName', () => {
  it.each([
    ['acme.de', 'acme.de', true],
    ['acme.de', 'acme.co.uk', true],
    ['acme.de', null, true],
    [null, null, true],
    ['acme.de', 'other.de', false],
    ['acme.com', 'acme-robotics.com', false],
  ])('domainsCompatible(%s, %s) = %s', (a, b, ok) => {
    expect(domainsCompatible(a, b)).toBe(ok);
  });

  it.each([
    ['acme.com', 'acme', true],
    ['acmerobotics.com', 'acme robotics', true],
    ['acme-robotics.de', 'acme robotics', true],
    ['acmerobotics.io', 'acme', true],
    ['acme.com', 'acme robotics', true],
    ['abc.com', 'abcdef', false],
    ['other.com', 'acme', false],
    ['acme.com', '', false],
  ])('domainMatchesName(%s, %s) = %s', (domain, name, ok) => {
    expect(domainMatchesName(domain, name)).toBe(ok);
  });
});

describe('wouldCreateParentCycle', () => {
  const graph = new Map<number, number | null>([
    [1, null],
    [2, 1],
    [3, 2],
    [4, 3],
    [10, null],
  ]);

  it.each([
    [1, 1, true],
    [1, 4, true],
    [1, 2, true],
    [2, 3, true],
    [4, 1, false],
    [10, 4, false],
    [4, 10, false],
    [1, 10, false],
    [99, 1, false],
  ])('child %i under parent %i → cycle %s', (child, parent, cycle) => {
    expect(wouldCreateParentCycle(graph, child, parent)).toBe(cycle);
  });

  it('stops on existing bad data instead of looping', () => {
    const bad = new Map<number, number | null>([
      [1, 2],
      [2, 1],
    ]);
    expect(wouldCreateParentCycle(bad, 5, 1)).toBe(true);
  });
});

describe('chunkIds / flattenIds', () => {
  it('round-trips long id lists through 100-item chunks', () => {
    const ids = Array.from({ length: 345 }, (_, i) => i + 1);
    const chunks = chunkIds(ids);
    expect(chunks).toHaveLength(4);
    expect(chunks.every((c) => c.length <= 100)).toBe(true);
    expect(flattenIds(chunks)).toEqual(ids);
  });

  it('respects a custom chunk size and empty input', () => {
    expect(chunkIds([1, 2, 3], 2)).toEqual([[1, 2], [3]]);
    expect(chunkIds([])).toEqual([]);
  });

  it('flattenIds ignores junk', () => {
    expect(flattenIds([[1, 'x', 2], null, [3.5, -1, 4], 5])).toEqual([1, 2, 4, 5]);
    expect(flattenIds(null)).toEqual([]);
    expect(flattenIds('1,2')).toEqual([]);
    expect(flattenIds([1, [2, [3]], 2])).toEqual([1, 2, 3]);
    expect(flattenIds([[[[[[1]]]]]])).toEqual([]);
  });
});
