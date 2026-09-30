/**
 * Seed bookkeeping (pure): per-section tallies, the printed summary and the CLI arguments.
 * Kept apart from the DB code so it is unit-tested without a database.
 */

export const SEED_SECTIONS = [
  'countries',
  'visaRoutes',
  'visaRules',
  'pageWatches',
  'platforms',
  'companies',
  'companyAliases',
  'sources',
  'resumeVersions',
  'templates',
] as const;
export type SeedSection = (typeof SEED_SECTIONS)[number];

/**
 * - inserted: new rows.
 * - updated: seed-owned rows refreshed because the seed data changed.
 * - unchanged: rows already as the seed has them.
 * - kept: rows the owner changed (edited, verified, renamed, deleted, status changed) — left alone.
 */
export interface SeedTally {
  inserted: number;
  updated: number;
  unchanged: number;
  kept: number;
}

export type SeedOutcome = keyof SeedTally;

export interface SeedSummary {
  startedAt: string;
  durationMs: number;
  sections: Record<SeedSection, SeedTally>;
  /** Settings rows created with their defaults (existing rows are never touched). */
  settingsCreated: string[];
  /** Why rows were kept, one line each (capped). */
  keptNotes: string[];
}

export const MAX_KEPT_NOTES = 200;

export function emptyTally(): SeedTally {
  return { inserted: 0, updated: 0, unchanged: 0, kept: 0 };
}

export function emptySections(): Record<SeedSection, SeedTally> {
  return Object.fromEntries(SEED_SECTIONS.map((s) => [s, emptyTally()])) as Record<SeedSection, SeedTally>;
}

export function totalTally(sections: Record<SeedSection, SeedTally>): SeedTally {
  const t = emptyTally();
  for (const s of SEED_SECTIONS) {
    t.inserted += sections[s].inserted;
    t.updated += sections[s].updated;
    t.unchanged += sections[s].unchanged;
    t.kept += sections[s].kept;
  }
  return t;
}

/** True when a run changed nothing (a repeat run on an up-to-date database). */
export function isNoop(summary: Pick<SeedSummary, 'sections' | 'settingsCreated'>): boolean {
  const t = totalTally(summary.sections);
  return t.inserted === 0 && t.updated === 0 && summary.settingsCreated.length === 0;
}

const LABELS: Record<SeedSection, string> = {
  countries: 'countries',
  visaRoutes: 'visa routes',
  visaRules: 'visa rule versions',
  pageWatches: 'official page watches',
  platforms: 'source platforms',
  companies: 'companies',
  companyAliases: 'company aliases',
  sources: 'sources',
  resumeVersions: 'resume versions',
  templates: 'templates',
};

/** Plain-text summary table for the CLI. */
export function formatSeedSummary(summary: SeedSummary): string {
  const header = ['section', 'inserted', 'updated', 'unchanged', 'kept'];
  const rows = SEED_SECTIONS.map((s) => {
    const t = summary.sections[s];
    return [LABELS[s], String(t.inserted), String(t.updated), String(t.unchanged), String(t.kept)];
  });
  const total = totalTally(summary.sections);
  rows.push(['total', String(total.inserted), String(total.updated), String(total.unchanged), String(total.kept)]);
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => (i === 0 ? c.padEnd(widths[i]) : c.padStart(widths[i]))).join('  ');
  const out = [
    `RADAR seed — started ${summary.startedAt}, took ${(summary.durationMs / 1000).toFixed(1)} s`,
    '',
    line(header),
    line(widths.map((w) => '-'.repeat(w))),
    ...rows.slice(0, -1).map(line),
    line(widths.map((w) => '-'.repeat(w))),
    line(rows[rows.length - 1]),
    '',
    `settings created: ${summary.settingsCreated.length ? summary.settingsCreated.join(', ') : 'none (all present)'}`,
  ];
  if (summary.keptNotes.length) {
    out.push('', 'kept (owner changes are never overwritten):', ...summary.keptNotes.map((n) => `  - ${n}`));
    if (total.kept > summary.keptNotes.length) out.push(`  … and ${total.kept - summary.keptNotes.length} more`);
  }
  out.push(
    '',
    isNoop(summary) ? 'Nothing to do: the reference data is up to date.' : 'Reference data loaded.',
    'Visa rules are seeded UNVERIFIED and platform terms are NOT owner-reviewed: confirm both before a country goes live.',
  );
  return out.join('\n');
}

export interface SeedCliArgs {
  json: boolean;
  help: boolean;
}

export const SEED_USAGE = `Usage: npm run db:seed [-- --json]

Loads RADAR's reference data (countries and guides, visa routes and unverified rules, official
page watches, source platforms, trial sources, companies, kit templates, default settings).
Idempotent: safe to run again; rows the owner changed are never overwritten.

  --json   print the summary as JSON instead of a table
  --help   this text

Env: DATABASE_URL (required).`;

export class SeedUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedUsageError';
  }
}

export function parseSeedArgs(argv: readonly string[]): SeedCliArgs {
  const out: SeedCliArgs = { json: false, help: false };
  for (const a of argv) {
    if (a === '--json') out.json = true;
    else if (a === '--help' || a === '-h') out.help = true;
    else throw new SeedUsageError(`unknown argument: ${a}`);
  }
  return out;
}
