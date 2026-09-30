import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrationStatus, parseJournal, parseWaitArgs } from '../../ops/docker/migration-status';

const REPO = path.resolve(__dirname, '../..');

describe('parseJournal', () => {
  it('reads the journal shipped in drizzle/ (what the image copies to /app/drizzle)', () => {
    const journal = parseJournal(JSON.parse(readFileSync(path.join(REPO, 'drizzle/meta/_journal.json'), 'utf8')));
    expect(journal.length).toBeGreaterThan(0);
    expect(journal[0]?.tag).toMatch(/^0000_/);
    for (const e of journal) expect(Number.isFinite(e.when)).toBe(true);
  });

  it('sorts by `when` and defaults idx to the position', () => {
    const j = parseJournal({ entries: [{ when: 20, tag: 'b' }, { idx: 0, when: 10, tag: 'a' }] });
    expect(j).toEqual([
      { idx: 0, when: 10, tag: 'a' },
      { idx: 0, when: 20, tag: 'b' },
    ]);
  });

  it('rejects malformed journals with a precise message', () => {
    expect(() => parseJournal(null)).toThrow(/missing "entries"/);
    expect(() => parseJournal({ entries: 'x' })).toThrow(/missing "entries"/);
    expect(() => parseJournal({ entries: [{ when: 'x', tag: 'a' }] })).toThrow(/entry 0/);
    expect(() => parseJournal({ entries: [{ when: 1, tag: 'a' }, { when: 2, tag: '' }] })).toThrow(/entry 1/);
    expect(() => parseJournal({ entries: [null] })).toThrow(/entry 0/);
    expect(() => parseJournal({ entries: [{ when: Number.POSITIVE_INFINITY, tag: 'a' }] })).toThrow(/entry 0/);
  });
});

describe('migrationStatus', () => {
  const journal = parseJournal({
    entries: [
      { idx: 0, when: 1_000, tag: '0000_init' },
      { idx: 1, when: 2_000, tag: '0001_more' },
    ],
  });

  it('is satisfied once the newest journal entry is recorded', () => {
    expect(migrationStatus(journal, { count: 2, maxCreatedAt: 2_000 })).toEqual({
      satisfied: true,
      expected: 2,
      applied: 2,
      latestTag: '0001_more',
    });
    // A newer database (rolled-back image) is also fine.
    expect(migrationStatus(journal, { count: 3, maxCreatedAt: 3_000 }).satisfied).toBe(true);
  });

  it('waits while migrations are missing or the table does not exist yet', () => {
    expect(migrationStatus(journal, { count: 0, maxCreatedAt: null }).satisfied).toBe(false);
    expect(migrationStatus(journal, { count: 1, maxCreatedAt: 1_000 }).satisfied).toBe(false);
    // Right timestamp but too few rows (a hand-edited table) is not trusted.
    expect(migrationStatus(journal, { count: 1, maxCreatedAt: 2_000 }).satisfied).toBe(false);
  });

  it('uses the newest entry even when the caller passes an unsorted journal', () => {
    const unsorted = [
      { idx: 1, when: 2_000, tag: '0001_more' },
      { idx: 0, when: 1_000, tag: '0000_init' },
    ];
    expect(migrationStatus(unsorted, { count: 2, maxCreatedAt: 1_000 }).satisfied).toBe(false);
    expect(migrationStatus(unsorted, { count: 2, maxCreatedAt: 2_000 }).latestTag).toBe('0001_more');
  });

  it('an empty journal needs nothing', () => {
    expect(migrationStatus([], { count: 0, maxCreatedAt: null })).toEqual({
      satisfied: true,
      expected: 0,
      applied: 0,
      latestTag: null,
    });
  });
});

describe('parseWaitArgs', () => {
  it('defaults to 300 s and accepts --timeout', () => {
    expect(parseWaitArgs([])).toEqual({ timeoutSec: 300 });
    expect(parseWaitArgs(['--timeout', '900'])).toEqual({ timeoutSec: 900 });
    expect(parseWaitArgs(['--timeout', '1'])).toEqual({ timeoutSec: 1 });
  });

  it('rejects bad values and unknown arguments', () => {
    for (const bad of [['--timeout'], ['--timeout', '0'], ['--timeout', '1.5'], ['--timeout', '86401'], ['--timeout', 'x']]) {
      expect(() => parseWaitArgs(bad), bad.join(' ')).toThrow(/whole seconds/);
    }
    expect(() => parseWaitArgs(['--wait'])).toThrow(/unknown argument: --wait/);
  });
});
