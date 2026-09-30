/**
 * Review-queue housekeeping for pairs that never needed a human (docs/USER_GUIDE.md → Review).
 *
 * A "possible duplicate" whose two jobs are BOTH listed by the same source is a pair the source
 * itself keeps apart (its own two postings — usually the same role in several cities, or one
 * requisition per team). Almost all of the queue was this kind (8,159 of 8,190 after the first
 * crawl). Two cases:
 *
 *  - exact twins: same company, title, city and country AND an identical description → one job.
 *    They are merged with the ordinary `confirmDuplicate` (the older job is kept, the other's
 *    links move over, `splitJobs` undoes it), one audit row each.
 *  - every other same-source pair → "keep both" (`dismissed`, never proposed again), in one
 *    statement with ONE audit row that carries the count.
 *
 * Pairs from DIFFERENT sources are never touched: those are the real cross-source duplicates the
 * queue exists for. Merged jobs (either side) are skipped. Everything here is idempotent.
 */
import { sql } from 'drizzle-orm';
import { audit, type AuditInput } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { log } from '../log';
import { confirmDuplicate } from './manual';

/** Both jobs are listed by at least one common source. */
const SAME_SOURCE = sql`EXISTS (SELECT 1 FROM job_sources sa INNER JOIN job_sources sb ON sb.source_id = sa.source_id WHERE sa.job_id = d.job_a AND sb.job_id = d.job_b)`;

/** Same role posted twice: identical title, city, country and text at one company. */
const EXACT_TWIN = sql`(a.company_id = b.company_id AND a.canonical_title = b.canonical_title AND a.city <=> b.city AND a.country_iso2 <=> b.country_iso2 AND a.description_hash = b.description_hash)`;

const OPEN_LIVE_PAIRS = sql`d.status = 'open' AND a.merged_into_job_id IS NULL AND b.merged_into_job_id IS NULL`;

const FROM_PAIRS = sql`FROM duplicate_candidates d INNER JOIN jobs a ON a.id = d.job_a INNER JOIN jobs b ON b.id = d.job_b`;

export interface TidyOptions {
  actor?: AuditInput['actor'];
  ip?: string | null;
}

export interface TidyCounts {
  /** Same-source exact twins waiting to be merged. */
  twins: number;
  /** Other same-source pairs (to keep as two jobs). */
  keepBoth: number;
  /** Pairs from different sources: these need a human. */
  needHuman: number;
}

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
type Rows = { n?: unknown }[];
const rowsOf = (res: unknown): Rows => (Array.isArray(res) && Array.isArray(res[0]) ? (res[0] as Rows) : []);

export async function tidyCounts(db: DbOrTx): Promise<TidyCounts> {
  const res = await db.execute(sql`
    SELECT
      COALESCE(SUM(${SAME_SOURCE} AND ${EXACT_TWIN}), 0) AS twins,
      COALESCE(SUM(${SAME_SOURCE} AND NOT ${EXACT_TWIN}), 0) AS keep_both,
      COALESCE(SUM(NOT ${SAME_SOURCE}), 0) AS need_human
    ${FROM_PAIRS}
    WHERE ${OPEN_LIVE_PAIRS}`);
  const row = (rowsOf(res)[0] ?? {}) as Record<string, unknown>;
  return { twins: num(row.twins), keepBoth: num(row.keep_both), needHuman: num(row.need_human) };
}

/** "Keep both" for every open same-source pair that is not an exact twin. One statement, one audit row. */
export async function dismissSameSourcePairs(db: DbOrTx, opts: TidyOptions = {}): Promise<{ dismissed: number }> {
  const reason = 'Same source lists both as separate postings (bulk keep-both)';
  const dismissed = await withTransaction(db, async (tx) => {
    const res = await tx.execute(sql`
      UPDATE duplicate_candidates d
      INNER JOIN jobs a ON a.id = d.job_a
      INNER JOIN jobs b ON b.id = d.job_b
      SET d.status = 'dismissed', d.decided_at = UTC_TIMESTAMP(3), d.decided_reason = ${reason}
      WHERE ${OPEN_LIVE_PAIRS} AND ${SAME_SOURCE} AND NOT ${EXACT_TWIN}`);
    const header = (Array.isArray(res) ? res[0] : res) as { affectedRows?: number };
    const n = num(header?.affectedRows);
    if (n > 0) {
      await audit(tx, { action: 'duplicate.bulk_keep_both', entityType: 'duplicate_candidate', after: { dismissed: n }, reason, actor: opts.actor ?? 'admin', ip: opts.ip ?? null });
    }
    return n;
  });
  return { dismissed };
}

/** Merges up to `limit` exact twins (oldest job kept). Returns how many were merged and how many remain. */
export async function mergeExactTwins(db: DbOrTx, opts: TidyOptions & { limit?: number } = {}): Promise<{ merged: number; failed: number; remaining: number }> {
  const limit = Math.max(1, Math.min(500, Math.trunc(opts.limit ?? 200)));
  const res = await db.execute(sql`
    SELECT d.id AS id ${FROM_PAIRS}
    WHERE ${OPEN_LIVE_PAIRS} AND ${SAME_SOURCE} AND ${EXACT_TWIN}
    ORDER BY d.id
    LIMIT ${limit}`);
  const ids = rowsOf(res).map((r) => num((r as { id?: unknown }).id)).filter((n) => n > 0);
  let merged = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const r = await confirmDuplicate(db, id, 'Exact twin: same source, company, title, city and text', { actor: opts.actor ?? 'admin', ip: opts.ip ?? null });
      if (r.ok) merged++;
      else failed++;
    } catch (err) {
      failed++;
      log.warn('tidy: merging an exact twin failed', { candidateId: id, error: err instanceof Error ? err.message : String(err) });
    }
  }
  const after = await tidyCounts(db);
  return { merged, failed, remaining: after.twins };
}

/** Nightly: everything above, then a summary line. Never throws. */
export async function tidyDuplicateQueue(db: DbOrTx, opts: TidyOptions = {}): Promise<{ merged: number; dismissed: number; failed: number; needHuman: number }> {
  try {
    let merged = 0;
    let failed = 0;
    for (let round = 0; round < 10; round++) {
      const r = await mergeExactTwins(db, { ...opts, limit: 200 });
      merged += r.merged;
      failed += r.failed;
      if (r.remaining === 0 || r.merged === 0) break;
    }
    const { dismissed } = await dismissSameSourcePairs(db, opts);
    const { needHuman } = await tidyCounts(db);
    log.info('review queue tidied', { merged, dismissed, failed, needHuman });
    return { merged, dismissed, failed, needHuman };
  } catch (err) {
    log.warn('review queue tidy failed', { error: err instanceof Error ? err.message : String(err) });
    return { merged: 0, dismissed: 0, failed: 0, needHuman: 0 };
  }
}
