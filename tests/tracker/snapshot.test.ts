/** Pure: defensive reading of application_snapshots JSON. */
import { describe, expect, it } from 'vitest';
import { readSnapshot, readSnapshotSalary, snapshotLocation } from '../../src/components/tracker/snapshot';

describe('application snapshots', () => {
  it('reads a full snapshot and sorts facts, skipping empty ones', () => {
    const v = readSnapshot({
      jobId: 5,
      title: ' Cloud Security Engineer ',
      company: 'Initech',
      countryIso2: 'DE',
      city: 'Berlin',
      postedAt: '2026-09-01T00:00:00.000Z',
      closingAt: 'not a date',
      score: 71.5,
      descriptionText: '  We secure clouds.  ',
      facts: { visa: { value: 'confirmed', method: 'posting', confidence: 'high' }, remote: { value: null }, language: { value: 'English' } },
    });
    expect(v).toMatchObject({ manual: false, jobId: 5, title: 'Cloud Security Engineer', company: 'Initech', postedAt: '2026-09-01T00:00:00.000Z', closingAt: null, score: 71.5 });
    expect(v.descriptionText).toBe('We secure clouds.');
    expect(v.facts.map((f) => f.key)).toEqual(['language', 'visa']);
    expect(v.facts[1]).toEqual({ key: 'visa', value: 'confirmed', method: 'posting', confidence: 'high' });
    expect(snapshotLocation(v)).toBe('Berlin, DE');
  });

  it('survives junk and hand-made rows', () => {
    const v = readSnapshot('nope');
    expect(v).toMatchObject({ manual: false, jobId: null, title: null, score: null, descriptionText: '', facts: [] });
    expect(snapshotLocation(v)).toBeNull();
    const m = readSnapshot({ manual: true, jobId: -1, locationRaw: 'Remote (EU)', countryIso2: 'NL', score: 'high', facts: [1, 2] });
    expect(m).toMatchObject({ manual: true, jobId: null, score: null, facts: [] });
    expect(snapshotLocation(m)).toBe('Remote (EU)');
    expect(snapshotLocation(readSnapshot({ countryIso2: 'NL' }))).toBe('NL');
  });

  it('reads the salary slip and flags estimates', () => {
    expect(readSnapshotSalary(null)).toBeNull();
    expect(readSnapshotSalary({ value: {} })).toBeNull();
    expect(readSnapshotSalary({ value: { min: 60000, max: 70000, currency: 'EUR' }, method: 'posting', confidence: 'high' })).toEqual({
      value: { min: 60000, max: 70000, currency: 'EUR' },
      method: 'posting',
      confidence: 'high',
      estimated: false,
    });
    expect(readSnapshotSalary({ value: { kind: 'estimated', min: 50000 } })?.estimated).toBe(true);
    expect(readSnapshotSalary({ value: { min: 50000 }, method: 'estimated' })?.estimated).toBe(true);
  });
});
