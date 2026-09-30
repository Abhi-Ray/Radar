/**
 * Raw snapshots (untouched source data) and the per-source "what do we already have" state.
 *
 * Idempotency: a snapshot is keyed by (source, external id, sha256 of the canonical payload).
 * An item whose payload hash equals the hash of the snapshot its job_sources row points to is
 * *unchanged*: the pipeline only confirms it as still listed (last_seen). Parser / logic changes
 * are applied to stored snapshots by reprocessFromRaw, not by re-fetching.
 */
import { and, eq } from 'drizzle-orm';
import { jobSources, rawSnapshots } from '../../../db/schema';
import type { DbOrTx } from '../../db';
import { isDuplicateEntry } from './dbutil';

export interface KnownItem {
  jobSourceId: number;
  jobId: number;
  rawSnapshotId: number | null;
  snapshotHash: string | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
}

/** externalId → what this source already carries. */
export async function loadSourceState(db: DbOrTx, sourceId: number): Promise<Map<string, KnownItem>> {
  const rows = await db
    .select({
      jobSourceId: jobSources.id,
      jobId: jobSources.jobId,
      externalId: jobSources.externalId,
      rawSnapshotId: jobSources.rawSnapshotId,
      snapshotHash: rawSnapshots.contentHash,
      firstSeenAt: jobSources.firstSeenAt,
      lastSeenAt: jobSources.lastSeenAt,
    })
    .from(jobSources)
    .leftJoin(rawSnapshots, eq(rawSnapshots.id, jobSources.rawSnapshotId))
    .where(eq(jobSources.sourceId, sourceId));
  const out = new Map<string, KnownItem>();
  for (const r of rows) {
    out.set(r.externalId, {
      jobSourceId: r.jobSourceId,
      jobId: r.jobId,
      rawSnapshotId: r.rawSnapshotId,
      snapshotHash: r.snapshotHash ?? null,
      firstSeenAt: r.firstSeenAt,
      lastSeenAt: r.lastSeenAt,
    });
  }
  return out;
}

export const MAX_SNAPSHOT_URL = 2048;

export interface SaveSnapshotInput {
  sourceId: number;
  runId: number | null;
  externalId: string;
  contentHash: string;
  payload: unknown;
  url?: string | null;
  fetchedAt: Date;
  parserVersion: string;
}

/**
 * Stores the payload once per (source, external id, content hash) and returns its id. A payload
 * seen before (e.g. a posting that changed and changed back) reuses the existing row.
 */
export async function saveSnapshot(db: DbOrTx, input: SaveSnapshotInput): Promise<{ id: number; created: boolean }> {
  const find = async () => {
    const [row] = await db
      .select({ id: rawSnapshots.id })
      .from(rawSnapshots)
      .where(
        and(
          eq(rawSnapshots.sourceId, input.sourceId),
          eq(rawSnapshots.externalId, input.externalId),
          eq(rawSnapshots.contentHash, input.contentHash),
        ),
      )
      .limit(1);
    return row?.id ?? null;
  };
  const existing = await find();
  if (existing !== null) return { id: existing, created: false };
  const url = input.url && input.url.length <= MAX_SNAPSHOT_URL ? input.url : null;
  try {
    const [res] = await db.insert(rawSnapshots).values({
      sourceId: input.sourceId,
      runId: input.runId,
      externalId: input.externalId,
      contentHash: input.contentHash,
      payload: JSON.stringify(input.payload ?? null),
      url,
      fetchedAt: input.fetchedAt,
      parserVersion: input.parserVersion.slice(0, 64),
    });
    return { id: Number(res.insertId), created: true };
  } catch (err) {
    if (!isDuplicateEntry(err)) throw err;
    const again = await find();
    if (again === null) throw err;
    return { id: again, created: false };
  }
}

/** Parses a stored snapshot payload back into the value the connector returned. */
export function snapshotPayload(text: string): unknown {
  return JSON.parse(text) as unknown;
}
