import { describe, expect, it } from 'vitest';
import {
  SEED_SECTIONS,
  SeedUsageError,
  emptySections,
  formatSeedSummary,
  isNoop,
  parseSeedArgs,
  totalTally,
  type SeedSummary,
} from '../../src/db/seed/summary';
import { changedKeys, isPristine, seedRef } from '../../src/db/seed';

function summary(over: Partial<SeedSummary> = {}): SeedSummary {
  return { startedAt: '2026-09-30T08:00:00.000Z', durationMs: 1234, sections: emptySections(), settingsCreated: [], keptNotes: [], ...over };
}

describe('tallies', () => {
  it('sums every section', () => {
    const sections = emptySections();
    sections.countries.inserted = 3;
    sections.templates.kept = 2;
    sections.sources.unchanged = 5;
    sections.visaRules.updated = 1;
    expect(totalTally(sections)).toEqual({ inserted: 3, updated: 1, unchanged: 5, kept: 2 });
    expect(Object.keys(sections)).toEqual([...SEED_SECTIONS]);
  });

  it('is a no-op only when nothing was inserted, updated or created', () => {
    expect(isNoop(summary())).toBe(true);
    const kept = emptySections();
    kept.templates.kept = 4;
    expect(isNoop(summary({ sections: kept }))).toBe(true);
    const ins = emptySections();
    ins.companies.inserted = 1;
    expect(isNoop(summary({ sections: ins }))).toBe(false);
    expect(isNoop(summary({ settingsCreated: ['daily_budget_usd'] }))).toBe(false);
  });
});

describe('formatSeedSummary', () => {
  it('prints an aligned table, the kept notes and the verification reminder', () => {
    const sections = emptySections();
    sections.countries.inserted = 48;
    sections.templates.kept = 3;
    const text = formatSeedSummary(summary({ sections, keptNotes: ['template "x": edited by the owner'], settingsCreated: ['a', 'b'] }));
    expect(text).toMatch(/started 2026-09-30T08:00:00.000Z, took 1.2 s/);
    expect(text).toMatch(/^countries\s+48\s+0\s+0\s+0$/m);
    expect(text).toMatch(/^total\s+48\s+0\s+0\s+3$/m);
    expect(text).toContain('settings created: a, b');
    expect(text).toContain('  - template "x": edited by the owner');
    expect(text).toContain('  … and 2 more');
    expect(text).toContain('Reference data loaded.');
    expect(text).toMatch(/UNVERIFIED/);
  });

  it('says so when there was nothing to do', () => {
    const text = formatSeedSummary(summary());
    expect(text).toContain('settings created: none (all present)');
    expect(text).toContain('Nothing to do');
  });
});

describe('parseSeedArgs', () => {
  it('accepts --json and --help / -h', () => {
    expect(parseSeedArgs([])).toEqual({ json: false, help: false });
    expect(parseSeedArgs(['--json'])).toEqual({ json: true, help: false });
    expect(parseSeedArgs(['-h'])).toEqual({ json: false, help: true });
    expect(parseSeedArgs(['--help', '--json'])).toEqual({ json: true, help: true });
  });

  it('rejects anything else', () => {
    expect(() => parseSeedArgs(['--force'])).toThrow(SeedUsageError);
    expect(() => parseSeedArgs(['prod'])).toThrow(/unknown argument: prod/);
  });
});

describe('row helpers', () => {
  it('compares JSON values canonically and treats undefined as null', () => {
    const row = { a: { y: 1, x: [1, 2] }, b: 'same', c: null };
    expect(changedKeys(row, { a: { x: [1, 2], y: 1 }, b: 'same', c: undefined })).toEqual([]);
    expect(changedKeys(row, { a: { x: [2, 1], y: 1 }, b: 'other' })).toEqual(['a', 'b']);
  });

  it('pristine means updated_at equals created_at', () => {
    const d = new Date('2026-09-30T08:00:00.000Z');
    expect(isPristine({ createdAt: d, updatedAt: new Date(d) })).toBe(true);
    expect(isPristine({ createdAt: d, updatedAt: new Date(d.getTime() + 1) })).toBe(false);
  });

  it('builds stable seed refs', () => {
    expect(seedRef('template', ['cover_letter', null, 'Cover letter'])).toBe('template:cover_letter:-:Cover letter');
    expect(seedRef('visa_route', ['DE', 'eu_blue_card'])).toBe('visa_route:DE:eu_blue_card');
  });
});
