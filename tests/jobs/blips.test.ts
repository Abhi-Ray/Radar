import { describe, expect, it } from 'vitest';
import {
  GOLDEN_TARGET,
  REGION_SECTORS,
  SECTOR_SPAN,
  distanceForScore,
  groupBySector,
  onboardingItems,
  placeJobBlips,
  sectorFor,
  type BlipJob,
} from '@/components/dashboard/blips';
import { angularDistance } from '@/components/ui/geometry';

const NEW_SINCE = new Date('2026-09-29T18:30:00Z');
const hrefFor = (id: number) => `/jobs/${id}`;

function blipJob(id: number, over: Partial<BlipJob> = {}): BlipJob {
  return {
    id,
    title: `Job ${id}`,
    company: 'Acme',
    countryIso2: 'DE',
    score: 70,
    visaStatus: 'confirmed',
    firstSeenAt: new Date('2026-09-20T00:00:00Z'),
    ...over,
  };
}

describe('region sectors', () => {
  it('maps countries to fixed sectors and unknowns to Unplaced', () => {
    expect(REGION_SECTORS[sectorFor('de')].key).toBe('dach');
    expect(REGION_SECTORS[sectorFor('GB')].key).toBe('ukie');
    expect(REGION_SECTORS[sectorFor('XW')].key).toBe('remote');
    expect(REGION_SECTORS[sectorFor(null)].key).toBe('unplaced');
    expect(REGION_SECTORS[sectorFor('ZZ')].key).toBe('unplaced');
    expect(SECTOR_SPAN * REGION_SECTORS.length).toBe(360);
  });

  it('never lists a country in two sectors', () => {
    const all = REGION_SECTORS.flatMap((s) => s.countries);
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('distanceForScore', () => {
  it('puts strong fits near the hub and unscored on the rim', () => {
    expect(distanceForScore(100)).toBe(0.12);
    expect(distanceForScore(0)).toBe(0.95);
    expect(distanceForScore(null)).toBe(0.95);
    expect(distanceForScore(150)).toBe(0.12);
    expect(distanceForScore(80)).toBeLessThan(distanceForScore(40));
  });
});

describe('placeJobBlips', () => {
  it('keeps every blip inside its region sector, deterministic and linked', () => {
    const jobs = [blipJob(1), blipJob(2, { countryIso2: 'SG' }), blipJob(3, { countryIso2: null, score: null })];
    const a = placeJobBlips(jobs, { newSince: NEW_SINCE, hrefFor });
    const b = placeJobBlips(jobs, { newSince: NEW_SINCE, hrefFor });
    expect(a).toEqual(b);
    for (const blip of a) {
      const lo = blip.sector * SECTOR_SPAN;
      expect(blip.angle).toBeGreaterThanOrEqual(lo);
      expect(blip.angle).toBeLessThan(lo + SECTOR_SPAN);
      expect(blip.href).toBe(`/jobs/${blip.id}`);
    }
    expect(a[2].distance).toBe(0.95);
    expect(a[2].label).toContain('unscored');
  });

  it('nudges overlapping blips apart', () => {
    const jobs = Array.from({ length: 6 }, (_, i) => blipJob(i + 1, { score: 75 }));
    const placed = placeJobBlips(jobs, { newSince: NEW_SINCE, hrefFor });
    for (let i = 0; i < placed.length; i++) {
      for (let j = i + 1; j < placed.length; j++) {
        const same = Math.abs(placed[i].distance - placed[j].distance) < 0.07 && angularDistance(placed[i].angle, placed[j].angle) < 8;
        expect(same).toBe(false);
      }
    }
  });

  it('colours by visa status and pings jobs first seen today', () => {
    const [fresh, old, unknown] = placeJobBlips(
      [blipJob(1, { firstSeenAt: new Date('2026-09-30T01:00:00Z'), visaStatus: 'not_offered' }), blipJob(2), blipJob(3, { visaStatus: null })],
      { newSince: NEW_SINCE, hrefFor },
    );
    expect(fresh.ping).toBe(true);
    expect(fresh.tone).toBe('stamp');
    expect(fresh.label).toContain('new today');
    expect(old.ping).toBe(false);
    expect(old.tone).toBe('radar');
    expect(unknown.visaLabel).toBe('Unknown');
    expect(unknown.tone).toBe('concrete');
  });

  it('groups for the list alternative in scope order, best fit first', () => {
    const placed = placeJobBlips(
      [blipJob(1, { score: 50 }), blipJob(2, { countryIso2: 'GB' }), blipJob(3, { score: 90 }), blipJob(4, { score: null })],
      { newSince: NEW_SINCE, hrefFor },
    );
    const groups = groupBySector(placed);
    expect(groups.map((g) => g.sector.key)).toEqual(['dach', 'ukie']);
    expect(groups[0].blips.map((b) => b.id)).toEqual([3, 1, 4]);
  });
});

describe('onboardingItems', () => {
  it('reports each calibration step honestly', () => {
    const items = onboardingItems({ settingsWritten: false, goldenSamples: 12, targetCountries: 5, verifiedTargetCountries: 2, liveSources: 0 });
    expect(items.map((i) => [i.key, i.done])).toEqual([
      ['settings', false],
      ['golden', false],
      ['countries', false],
      ['sources', false],
    ]);
    expect(items[1].detail).toContain(`12 of ${GOLDEN_TARGET}`);
    expect(items[2].detail).toContain('2 of 5');
  });

  it('is all done when calibrated', () => {
    const items = onboardingItems({ settingsWritten: true, goldenSamples: 31, targetCountries: 3, verifiedTargetCountries: 3, liveSources: 4 });
    expect(items.every((i) => i.done)).toBe(true);
  });

  it('does not say nothing feeds the scope while sources are on trial', () => {
    const base = { settingsWritten: true, goldenSamples: 0, targetCountries: 1, verifiedTargetCountries: 0, liveSources: 0 };
    const trial = onboardingItems({ ...base, trialSources: 207 }).find((i) => i.key === 'sources');
    expect(trial?.done).toBe(false);
    expect(trial?.detail).toContain('207 on trial already feed the scope');
    expect(onboardingItems({ ...base, trialSources: 0 }).find((i) => i.key === 'sources')?.detail).toBe('Nothing is feeding the scope yet.');
    expect(onboardingItems({ ...base, liveSources: 2, trialSources: 5 }).find((i) => i.key === 'sources')?.detail).toBe('2 live.');
  });

  it('does not count zero target countries as verified', () => {
    const items = onboardingItems({ settingsWritten: true, goldenSamples: 30, targetCountries: 0, verifiedTargetCountries: 0, liveSources: 1 });
    expect(items.find((i) => i.key === 'countries')?.done).toBe(false);
  });
});
