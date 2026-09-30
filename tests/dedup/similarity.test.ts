import { describe, expect, it } from 'vitest';
import {
  citySimilarity,
  compareDescriptions,
  compareTitles,
  containment,
  dedupTitle,
  jaccard,
  jaroWinkler,
  round3,
  shingles,
  tokenSetRatio,
} from '@/lib/dedup/similarity';

describe('jaroWinkler', () => {
  it.each([
    ['martha', 'marhta', 0.961],
    ['dwayne', 'duane', 0.84],
    ['dixon', 'dicksonx', 0.813],
    ['abc', 'abc', 1],
    ['abc', 'xyz', 0],
    ['', 'abc', 0],
    ['', '', 1],
  ])('jaroWinkler(%s, %s) ≈ %d', (a, b, v) => {
    expect(round3(jaroWinkler(a, b))).toBeCloseTo(v, 2);
  });

  it('is symmetric and bounded', () => {
    const pairs = [
      ['engineer', 'engineers'],
      ['analyst', 'analist'],
      ['munich', 'muenchen'],
      ['a', 'b'],
    ];
    for (const [a, b] of pairs) {
      const x = jaroWinkler(a, b);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(jaroWinkler(b, a)).toBeCloseTo(x, 10);
    }
  });
});

describe('tokenSetRatio', () => {
  it.each([
    ['backend engineer', 'backend engineer', 1],
    ['backend engineer', 'engineer backend', 1],
    ['backend engineer', 'backend engineers', 1],
    ['data analyst', 'data analist', 1],
    ['backend engineer', 'frontend engineer', 0.5],
    ['backend engineer', 'sales manager', 0],
    ['', '', 1],
    ['', 'x', 0],
    ['a b c d', 'a b', 0.667],
  ])('tokenSetRatio(%s, %s) = %d', (a, b, v) => {
    expect(round3(tokenSetRatio(a, b))).toBeCloseTo(v, 3);
  });

  it('short words must match exactly', () => {
    expect(tokenSetRatio('qa lead', 'qa led')).toBeLessThan(1);
  });
});

describe('dedupTitle / compareTitles', () => {
  it('ignores gender markers and punctuation', () => {
    const a = dedupTitle('Backend Engineer (m/w/d)');
    const b = dedupTitle('Backend Engineer');
    expect(compareTitles(a, b)).toEqual({ equal: true, similarity: 1 });
    expect(compareTitles(dedupTitle('Data Analyst (H/F)'), dedupTitle('Data Analyst'))).toMatchObject({ equal: true });
    expect(compareTitles(dedupTitle('Software Engineer (f/m/x)'), dedupTitle('Software Engineer - m/f/d'))).toMatchObject({ equal: true });
  });

  it('different seniority lowers the score hard', () => {
    const c = compareTitles(dedupTitle('Senior Backend Engineer'), dedupTitle('Junior Backend Engineer'));
    expect(c.equal).toBe(false);
    expect(c.similarity).toBeLessThanOrEqual(0.6);
    const d = compareTitles(dedupTitle('Senior Backend Engineer'), dedupTitle('Backend Engineer'));
    expect(d.equal).toBe(false);
    expect(d.similarity).toBeLessThanOrEqual(0.85);
  });

  it('levels separate titles', () => {
    expect(dedupTitle('Software Engineer II').level).toBe('2');
    expect(dedupTitle('Software Engineer III').level).toBe('3');
    expect(dedupTitle('Software Engineer L4').level).toBe('4');
    expect(dedupTitle('Software Engineer Level 5').level).toBe('5');
    expect(dedupTitle('Software Engineer (m/w/d)').level).toBeNull();
    expect(dedupTitle('Software Engineer').level).toBeNull();
    const c = compareTitles(dedupTitle('Software Engineer II'), dedupTitle('Software Engineer III'));
    expect(c.equal).toBe(false);
    expect(c.similarity).toBeLessThanOrEqual(0.6);
  });

  it('single-letter levels only at the end of a title part, not the Polish "i" or Czech "v"', () => {
    expect(dedupTitle('Security Engineer I').level).toBe('1');
    expect(dedupTitle('Security Engineer V - Remote').level).toBe('5');
    expect(dedupTitle('Security Engineer I (m/w/d)').level).toBe('1');
    expect(dedupTitle('Security Engineer II Berlin').level).toBe('2');
    expect(dedupTitle('Inżynier ds. bezpieczeństwa i chmury').level).toBeNull();
    expect(dedupTitle('Bezpečnostní inženýr v Praze').level).toBeNull();
    const pl = compareTitles(dedupTitle('Inżynier ds. bezpieczeństwa i chmury'), dedupTitle('Inżynier ds. bezpieczeństwa chmury'));
    expect(pl.equal).toBe(true);
  });

  it('unrelated titles are far apart', () => {
    expect(compareTitles(dedupTitle('Backend Engineer'), dedupTitle('Sales Manager')).similarity).toBeLessThan(0.3);
  });

  it('empty titles never match', () => {
    expect(compareTitles(dedupTitle(''), dedupTitle('Backend Engineer'))).toEqual({ equal: false, similarity: 0 });
  });

  it('is cached and stable', () => {
    expect(dedupTitle('Platform Engineer')).toBe(dedupTitle('Platform Engineer'));
  });
});

describe('citySimilarity', () => {
  it.each([
    ['Munich', 'München', 'DE', 1],
    ['Munich', 'munich', 'DE', 1],
    ['Cologne', 'Köln', 'DE', 1],
    ['Frankfurt', 'Frankfurt am Main', 'DE', 1],
    ['Berlin', 'Munich', 'DE', 0],
    ['Berlin', null, 'DE', null],
    [null, null, 'DE', null],
    ['', 'Berlin', 'DE', null],
  ])('citySimilarity(%s, %s) = %s', (a, b, c, v) => {
    const s = citySimilarity(a, b, c);
    if (v === null) expect(s).toBeNull();
    else expect(s).toBeGreaterThanOrEqual(v === 1 ? 0.95 : 0);
    if (v === 0) expect(s).toBe(0);
  });

  it('close spellings of an unknown place score high', () => {
    expect(citySimilarity('Unterschleissheim', 'Unterschleißheim', 'DE')).toBe(1);
    expect(citySimilarity('Obertshausenn', 'Obertshausen', 'DE')).toBeGreaterThanOrEqual(0.9);
  });
});

describe('shingles / jaccard / containment / compareDescriptions', () => {
  const base =
    'We are looking for a backend engineer to build our payments platform. You will design APIs, own services end to end and work with product and design every day.';

  it('identical texts: jaccard 1', () => {
    expect(compareDescriptions(base, base)).toEqual({ jaccard: 1, containment: 1, tooShort: false });
  });

  it('case and punctuation do not matter', () => {
    const r = compareDescriptions(base, base.toUpperCase().replace(/\./g, '!'));
    expect(r.jaccard).toBe(1);
  });

  it('a preamble lowers jaccard but not containment', () => {
    const longer = `About us: Acme is a fintech from Berlin with 200 people and offices in three countries. ${base}`;
    const r = compareDescriptions(base, longer);
    expect(r.containment).toBe(1);
    expect(r.jaccard).toBeLessThan(0.8);
  });

  it('unrelated texts score 0', () => {
    const other = 'Sales manager wanted for our Hamburg office to grow enterprise accounts across the DACH region every quarter.';
    expect(compareDescriptions(base, other).jaccard).toBe(0);
  });

  it('short texts are flagged', () => {
    expect(compareDescriptions('Backend engineer', 'Backend engineer').tooShort).toBe(true);
    expect(shingles('one two').size).toBe(1);
    expect(shingles('').size).toBe(0);
  });

  it('empty sets are not evidence', () => {
    expect(jaccard(new Set(), new Set())).toBe(0);
    expect(containment(new Set([1]), new Set())).toBe(0);
    expect(jaccard(new Set([1, 2]), new Set([2, 3]))).toBeCloseTo(1 / 3, 5);
    expect(containment(new Set([1, 2]), new Set([1, 2, 3]))).toBe(1);
  });

  it('accepts precomputed shingle sets', () => {
    const s = shingles(base);
    expect(compareDescriptions(s, base).jaccard).toBe(1);
  });
});
