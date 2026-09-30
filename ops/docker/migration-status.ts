/**
 * Pure helpers for ops/docker/wait-for-migrations.ts: has the database caught up with the
 * migrations journal shipped in the image (drizzle/meta/_journal.json)?
 *
 * Drizzle's MySQL migrator records each applied migration in `__drizzle_migrations` with
 * `created_at` = the journal entry's `when` (ms), and applies every entry whose `when` is newer
 * than the newest recorded `created_at`. So the schema is current when the newest recorded
 * `created_at` has reached the newest journal `when` (and at least as many rows exist).
 */

export interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

export interface AppliedState {
  /** Rows in __drizzle_migrations (0 when the table does not exist yet). */
  count: number;
  /** MAX(created_at), or null when nothing was applied. */
  maxCreatedAt: number | null;
}

export interface MigrationStatus {
  satisfied: boolean;
  expected: number;
  applied: number;
  /** Tag of the newest journal entry (for log lines), null for an empty journal. */
  latestTag: string | null;
}

/** Validates a parsed `_journal.json`. Throws with a precise message on a malformed file. */
export function parseJournal(json: unknown): JournalEntry[] {
  if (!json || typeof json !== 'object' || !Array.isArray((json as { entries?: unknown }).entries)) {
    throw new Error('migrations journal: missing "entries" array');
  }
  const entries = (json as { entries: unknown[] }).entries.map((raw, i) => {
    const e = raw as Partial<JournalEntry> | null;
    if (!e || typeof e.when !== 'number' || !Number.isFinite(e.when) || typeof e.tag !== 'string' || e.tag === '') {
      throw new Error(`migrations journal: entry ${i} needs numeric "when" and non-empty "tag"`);
    }
    return { idx: typeof e.idx === 'number' ? e.idx : i, when: e.when, tag: e.tag };
  });
  return entries.sort((a, b) => a.when - b.when);
}

/** Compares the journal with what the database has recorded. */
export function migrationStatus(journal: readonly JournalEntry[], applied: AppliedState): MigrationStatus {
  // Newest by `when`, regardless of the order the caller passed.
  const latest = journal.reduce<JournalEntry | null>((best, e) => (best === null || e.when > best.when ? e : best), null);
  const base = { expected: journal.length, applied: applied.count, latestTag: latest?.tag ?? null };
  if (!latest) return { satisfied: true, ...base };
  const satisfied = applied.maxCreatedAt !== null && applied.maxCreatedAt >= latest.when && applied.count >= journal.length;
  return { satisfied, ...base };
}

/** Parses the positional/flag arguments of wait-for-migrations (`--timeout <seconds>`). */
export function parseWaitArgs(argv: readonly string[]): { timeoutSec: number } {
  let timeoutSec = 300;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--timeout') {
      const v = Number(argv[i + 1]);
      if (!Number.isInteger(v) || v < 1 || v > 86_400) throw new Error('--timeout needs whole seconds between 1 and 86400');
      timeoutSec = v;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { timeoutSec };
}
