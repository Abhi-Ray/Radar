/** Pure SVG geometry behind the radar, gauges, sparklines, bars and block meters. */
import { describe, expect, it } from 'vitest';
import {
  angularDistance,
  annularSectorPath,
  barRects,
  blockFill,
  hashString,
  normalizeAngle,
  pickVariant,
  placeBlips,
  polarToCartesian,
  sectorIndex,
  sectorPath,
  sparkline,
} from '@/components/ui/geometry';

describe('hashString (FNV-1a 32)', () => {
  it('matches the reference vectors', () => {
    expect(hashString('')).toBe(0x811c9dc5);
    expect(hashString('a')).toBe(0xe40c292c);
    expect(hashString('foobar')).toBe(0xbf9cf968);
  });
  it('is deterministic and unsigned', () => {
    expect(hashString('Nordlicht Cloud GmbH')).toBe(hashString('Nordlicht Cloud GmbH'));
    expect(hashString('x')).toBeGreaterThanOrEqual(0);
  });
});

describe('angles', () => {
  it('normalises into [0, 360)', () => {
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(720)).toBe(0);
    expect(normalizeAngle(45)).toBe(45);
  });
  it('measures the short way round', () => {
    expect(angularDistance(350, 10)).toBe(20);
    expect(angularDistance(0, 180)).toBe(180);
    expect(angularDistance(-10, 10)).toBe(20);
  });
  it('maps 0° to north and runs clockwise', () => {
    expect(polarToCartesian(50, 50, 40, 0)).toEqual({ x: 50, y: 10 });
    expect(polarToCartesian(50, 50, 40, 90)).toEqual({ x: 90, y: 50 });
    expect(polarToCartesian(50, 50, 40, 180)).toEqual({ x: 50, y: 90 });
    expect(polarToCartesian(50, 50, 40, 270)).toEqual({ x: 10, y: 50 });
  });
  it('buckets angles into equal sectors', () => {
    expect(sectorIndex(0)).toBe(0);
    expect(sectorIndex(14.99)).toBe(0);
    expect(sectorIndex(15)).toBe(1);
    expect(sectorIndex(359)).toBe(23);
    expect(sectorIndex(360)).toBe(0);
    expect(sectorIndex(-15)).toBe(23);
    expect(sectorIndex(100, 4)).toBe(1);
  });
});

describe('sector paths', () => {
  it('draws a quarter wedge', () => {
    expect(sectorPath(50, 50, 40, 0, 90)).toBe('M50 50 L50 10 A40 40 0 0 1 90 50 Z');
  });
  it('sets the large-arc flag past 180° and never collapses a full circle', () => {
    expect(sectorPath(50, 50, 40, 0, 270)).toContain(' 0 1 1 ');
    const full = sectorPath(50, 50, 40, 0, 360);
    expect(full).not.toMatch(/L50 10 A40 40 0 1 1 50 10 Z/);
  });
  it('clamps a negative sweep to an empty wedge', () => {
    expect(sectorPath(50, 50, 40, 90, 0)).toBe('M50 50 L90 50 A40 40 0 0 1 90 50 Z');
  });
  it('draws a ring segment', () => {
    expect(annularSectorPath(50, 50, 40, 20, 0, 90)).toBe('M50 10 A40 40 0 0 1 90 50 L70 50 A20 20 0 0 0 50 30 Z');
  });
});

describe('sparkline', () => {
  it('maps values into the padded box (y grows downwards)', () => {
    const g = sparkline([0, 10], 100, 20, 0);
    expect(g.d).toBe('M0 20 L100 0');
    expect(g.min).toBe(0);
    expect(g.max).toBe(10);
    const p = sparkline([0, 10], 100, 20);
    expect(p.points.map(({ x, y }) => [x, y])).toEqual([
      [3, 17],
      [97, 3],
    ]);
  });
  it('breaks the line at gaps', () => {
    const g = sparkline([1, null, 3, Number.NaN, 5], 40, 10, 0);
    expect(g.d.match(/M/g)).toHaveLength(3);
    expect(g.points).toHaveLength(3);
  });
  it('centres flat series and single points', () => {
    const flat = sparkline([5, 5, 5], 100, 20, 2);
    expect(new Set(flat.points.map((p) => p.y))).toEqual(new Set([10]));
    const one = sparkline([7], 100, 20, 2);
    expect(one.points[0]).toMatchObject({ x: 50, y: 10 });
  });
  it('extends the domain with included values (baseline bands)', () => {
    const g = sparkline([10, 20], 100, 20, 0, [0, 40]);
    expect(g.min).toBe(0);
    expect(g.max).toBe(40);
    expect(g.yFor(40)).toBe(0);
    expect(g.yFor(0)).toBe(20);
  });
  it('handles an empty series', () => {
    const g = sparkline([], 100, 20);
    expect(g.d).toBe('');
    expect(g.points).toEqual([]);
  });
});

describe('barRects', () => {
  it('spaces bars evenly from a zero baseline', () => {
    const r = barRects([0, 5, 10], 32, 10, 1);
    expect(r.map((b) => b.x)).toEqual([0, 11, 22]);
    expect(r.map((b) => b.width)).toEqual([10, 10, 10]);
    expect(r.map((b) => b.height)).toEqual([0, 5, 10]);
    expect(r.map((b) => b.y)).toEqual([10, 5, 0]);
  });
  it('keeps tiny non-zero values visible and zeroes invalid ones', () => {
    const r = barRects([1, 1000, -4, Number.NaN], 40, 10, 0);
    expect(r[0].height).toBe(1.5);
    expect(r[2]).toMatchObject({ height: 0, value: 0 });
    expect(r[3]).toMatchObject({ height: 0, value: 0 });
  });
  it('caps at an explicit max', () => {
    expect(barRects([50], 10, 10, 0, 40)[0].height).toBe(10);
    expect(barRects([20], 10, 10, 0, 40)[0].height).toBe(5);
  });
  it('returns nothing for no values and flat zero for all-zero input', () => {
    expect(barRects([], 10, 10)).toEqual([]);
    expect(barRects([0, 0], 10, 10).every((b) => b.height === 0)).toBe(true);
  });
});

describe('blockFill', () => {
  it('fills whole blocks then one partial', () => {
    expect(blockFill(5, 10, 10)).toEqual([...Array(5).fill('full'), ...Array(5).fill('empty')]);
    expect(blockFill(3.5, 10, 10)).toEqual(['full', 'full', 'full', 'partial', ...Array(6).fill('empty')]);
    expect(blockFill(37, 50, 10).filter((b) => b === 'full')).toHaveLength(7);
    expect(blockFill(37, 50, 10)[7]).toBe('partial');
  });
  it('clamps to the range', () => {
    expect(blockFill(80, 50, 5)).toEqual(Array(5).fill('full'));
    expect(blockFill(-3, 50, 5)).toEqual(Array(5).fill('empty'));
  });
  it('is all empty for unusable input and has at least one block', () => {
    expect(blockFill(5, 0, 4)).toEqual(Array(4).fill('empty'));
    expect(blockFill(Number.NaN, 10, 3)).toEqual(Array(3).fill('empty'));
    expect(blockFill(1, 1, 0)).toEqual(['full']);
  });
});

describe('placeBlips', () => {
  it('maps score to range: high scores sit near the centre, unscored on the rim', () => {
    const [a, b, c, d] = placeBlips([
      { id: 1, score: 100 },
      { id: 2, score: 0 },
      { id: 3, score: null },
      { id: 4, score: 50 },
    ]);
    expect(a.distance).toBe(0.12);
    expect(b.distance).toBe(0.95);
    expect(c.distance).toBe(0.95);
    expect(d.distance).toBe(0.535);
  });
  it('is deterministic and keeps angles in range', () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: i + 1, key: `company-${i % 7}`, score: (i * 13) % 100 }));
    const first = placeBlips(items);
    expect(placeBlips(items)).toEqual(first);
    for (const p of first) {
      expect(p.angle).toBeGreaterThanOrEqual(0);
      expect(p.angle).toBeLessThan(360);
      expect(p.distance).toBeGreaterThanOrEqual(0.12);
      expect(p.distance).toBeLessThanOrEqual(0.95);
    }
  });
  it('nudges look-alike blips apart', () => {
    const placed = placeBlips(Array.from({ length: 5 }, (_, i) => ({ id: `job-${i}`, key: 'same-company', score: 70 })));
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        expect(angularDistance(placed[i].angle, placed[j].angle)).toBeGreaterThanOrEqual(9);
      }
    }
  });
});

describe('pickVariant', () => {
  it('picks deterministically within range', () => {
    expect(pickVariant('seed', 1)).toBe(0);
    expect(pickVariant('seed', 0)).toBe(0);
    const v = pickVariant('Nordlicht', 5);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(5);
    expect(pickVariant('Nordlicht', 5)).toBe(v);
  });
});
