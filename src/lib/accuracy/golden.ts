/**
 * Golden samples: loading them from the DB (golden_samples) or a JSON file
 * (tests/golden/samples.json), and importing a file into the DB (spec §17.1).
 *
 * File format: `[{ "id": "de-cloudsec-1", "snapshot": {GoldenSnapshot}, "labels": {GoldenLabels},
 * "notes"?: "..." }]` — labels are written from the posting text, never from RADAR's output.
 */
import { and, asc, eq, like } from 'drizzle-orm';
import { z } from 'zod';
import { goldenSamples } from '../../db/schema';
import { goldenLabelsSchema, type GoldenLabels, type GoldenSnapshot } from '../contracts/accuracy';
import type { DbOrTx } from '../db';
import { hashJson } from '../hash';
import { readSnapshot } from './predict';

export interface LoadedSample {
  /** Sample identity + content hash: runs are compared on equal keys only. */
  key: string;
  id: string;
  sourceKey: string | null;
  snapshot: GoldenSnapshot;
  labels: GoldenLabels;
}

export interface SkippedSample {
  id: string;
  reason: string;
}

export interface LoadResult {
  samples: LoadedSample[];
  skipped: SkippedSample[];
}

export function sampleKey(id: string, snapshot: GoldenSnapshot, labels: GoldenLabels): string {
  return `${id}:${hashJson({ snapshot, labels }).slice(0, 16)}`;
}

function labelledFieldCount(labels: GoldenLabels): number {
  return Object.values(labels).filter((v) => v !== undefined).length;
}

/** Validates one raw sample; the reason when it cannot be scored. */
function toSample(id: string, rawSnapshot: unknown, rawLabels: unknown, sourceKey: string | null): LoadedSample | SkippedSample {
  const snapshot = readSnapshot(rawSnapshot);
  if (!snapshot) return { id, reason: 'snapshot has no title or description text' };
  const parsed = goldenLabelsSchema.safeParse(rawLabels ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { id, reason: `invalid labels (${issue?.path.join('.') || 'labels'}: ${issue?.message ?? 'invalid'})` };
  }
  if (!labelledFieldCount(parsed.data)) return { id, reason: 'no field labelled yet' };
  const src = sourceKey ?? snapshot.sourceKey ?? null;
  return { key: sampleKey(id, snapshot, parsed.data), id, sourceKey: src, snapshot, labels: parsed.data };
}

function isLoaded(s: LoadedSample | SkippedSample): s is LoadedSample {
  return 'key' in s;
}

/** Every golden sample stored in the DB (unlabelled / unusable ones are listed as skipped). */
export async function loadDbGoldenSamples(db: DbOrTx): Promise<LoadResult> {
  const rows = await db
    .select({ id: goldenSamples.id, snapshotJson: goldenSamples.snapshotJson, labelsJson: goldenSamples.labelsJson, sourceKey: goldenSamples.sourceKey })
    .from(goldenSamples)
    .orderBy(asc(goldenSamples.id));
  const out: LoadResult = { samples: [], skipped: [] };
  for (const r of rows) {
    const s = toSample(`db:${r.id}`, r.snapshotJson, r.labelsJson, r.sourceKey);
    if (isLoaded(s)) out.samples.push(s);
    else out.skipped.push(s);
  }
  return out;
}

const fileEntrySchema = z.object({
  id: z.string().trim().min(1).max(120),
  snapshot: z.record(z.string(), z.unknown()),
  labels: z.record(z.string(), z.unknown()),
  notes: z.string().optional(),
});
export type GoldenFileEntry = z.output<typeof fileEntrySchema>;

export class GoldenFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GoldenFileError';
  }
}

/** Parses the golden file content (already JSON-parsed). Throws GoldenFileError on a bad shape. */
export function parseGoldenFile(json: unknown): { entries: GoldenFileEntry[]; load: LoadResult } {
  const list = Array.isArray(json) ? json : json && typeof json === 'object' ? (json as Record<string, unknown>).samples : null;
  if (!Array.isArray(list)) throw new GoldenFileError('golden file must be an array of samples (or {"samples": [...]})');
  const entries: GoldenFileEntry[] = [];
  const seen = new Set<string>();
  list.forEach((raw, i) => {
    const e = fileEntrySchema.safeParse(raw);
    if (!e.success) throw new GoldenFileError(`sample #${i + 1}: ${e.error.issues[0]?.path.join('.')} ${e.error.issues[0]?.message}`);
    if (seen.has(e.data.id)) throw new GoldenFileError(`duplicate sample id "${e.data.id}"`);
    seen.add(e.data.id);
    entries.push(e.data);
  });
  const load: LoadResult = { samples: [], skipped: [] };
  for (const e of entries) {
    const s = toSample(`file:${e.id}`, e.snapshot, e.labels, null);
    if (isLoaded(s)) load.samples.push(s);
    else load.skipped.push(s);
  }
  return { entries, load };
}

const FILE_NOTE_PREFIX = 'golden-file:';

/**
 * Imports file samples into golden_samples (origin 'manual'). Idempotent: a sample whose file id
 * was imported before is skipped (its notes carry `golden-file:<id>`).
 */
export async function importGoldenSamples(db: DbOrTx, entries: readonly GoldenFileEntry[]): Promise<{ inserted: number; skipped: number }> {
  if (!entries.length) return { inserted: 0, skipped: 0 };
  const existing = await db
    .select({ notes: goldenSamples.notes })
    .from(goldenSamples)
    .where(and(eq(goldenSamples.origin, 'manual'), like(goldenSamples.notes, `${FILE_NOTE_PREFIX}%`)));
  const have = new Set(existing.map((r) => (r.notes ?? '').split(/\s/)[0].slice(FILE_NOTE_PREFIX.length)));
  let inserted = 0;
  let skipped = 0;
  for (const e of entries) {
    if (have.has(e.id)) {
      skipped++;
      continue;
    }
    const snapshot = readSnapshot(e.snapshot);
    const labels = goldenLabelsSchema.safeParse(e.labels);
    if (!snapshot || !labels.success) {
      skipped++;
      continue;
    }
    await db.insert(goldenSamples).values({
      jobId: null,
      snapshotJson: snapshot as unknown as Record<string, unknown>,
      labelsJson: labels.data as Record<string, unknown>,
      sourceKey: snapshot.sourceKey ?? null,
      countryIso2: labels.data.country_iso2 ?? snapshot.countryHint ?? null,
      origin: 'manual',
      notes: [`${FILE_NOTE_PREFIX}${e.id}`, e.notes].filter(Boolean).join(' ').slice(0, 4000),
    });
    have.add(e.id);
    inserted++;
  }
  return { inserted, skipped };
}

/** Golden-sample counts per origin (dashboard "N of 100 labelled"). */
export async function goldenSampleCounts(db: DbOrTx): Promise<{ total: number; labelled: number; byOrigin: Record<string, number> }> {
  const rows = await db.select({ origin: goldenSamples.origin, labelsJson: goldenSamples.labelsJson }).from(goldenSamples);
  const byOrigin: Record<string, number> = {};
  let labelled = 0;
  for (const r of rows) {
    byOrigin[r.origin] = (byOrigin[r.origin] ?? 0) + 1;
    const p = goldenLabelsSchema.safeParse(r.labelsJson ?? {});
    if (p.success && labelledFieldCount(p.data)) labelled++;
  }
  return { total: rows.length, labelled, byOrigin };
}
