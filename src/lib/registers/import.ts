/**
 * Writes one register snapshot to `sponsor_register_entries`, atomically.
 *
 * - One transaction per register: readers see the old version until the new one is complete; any
 *   failure (download, format, a guard below) rolls back and the previous version stays in use.
 * - Stable ids: a row whose canonical raw content is unchanged keeps its id (only its
 *   `register_version` moves to the new download date), so company evidence links survive.
 *   New rows are inserted, rows no longer published are deleted.
 * - Guards: fewer rows than the register's `minEntries`, or fewer than half of the previous
 *   version (a truncated download), abort the import (the shrink guard can be forced).
 * - Unchanged shortcut: same file hashes, same parser logic and same company-name normaliser as the
 *   last successful import (and the rows are still there) → only the version date moves.
 * - Import state lives in the audit log (action `registers.import`, entity `sponsor_register`,
 *   id = register key), one row per attempt.
 * - Serialised per register with GET_LOCK (a concurrent run reports "skipped").
 */
import { and, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import { auditLog, sponsorRegisterEntries as sre } from '../../db/schema';
import { audit } from '../audit';
import { COMPANY_LOGIC_VERSION, normalizeCompanyName } from '../company/resolve';
import { withTransaction, type DbOrTx } from '../db';
import { hashJson } from '../hash';
import type { RegisterDef, RegisterKey } from './catalog';
import { clean } from './text';
import { RegisterError, type RegisterEntryInput, type RegisterFile, type RegisterSnapshot } from './types';

/** Bump when a parser or the row mapping changes (forces a full re-import of unchanged files). */
export const REGISTERS_LOGIC_VERSION = 'registers@2026-09-30.1';
export const IMPORT_ACTION = 'registers.import';
export const REGISTER_ENTITY = 'sponsor_register';
/** A new version with fewer than this share of the previous rows is treated as a broken download. */
export const SHRINK_GUARD = 0.5;
const BATCH = 1000;

const NORMALIZER_PROBE = [
  'Acme Holdings B.V.',
  'Müller & Söhne GmbH & Co. KG',
  'The Example Company Limited',
  'ÉTABLISSEMENTS DUPONT S.A.S.',
  'Nordisk A/S',
  'Globex Corporation, Inc.',
  'O’Brien (Ireland) Unlimited Company',
  '15243921 CANADA INC.',
];

/** Changes whenever the company-name normaliser changes (stored names must then be recomputed). */
export function normalizerFingerprint(): string {
  return hashJson([COMPANY_LOGIC_VERSION, NORMALIZER_PROBE.map((n) => normalizeCompanyName(n))]).slice(0, 16);
}

export type ImportStatus = 'imported' | 'unchanged' | 'failed';

/** What the audit log records per attempt (`after_json`). */
export interface RegisterImportState {
  status: ImportStatus;
  at: Date;
  version: string | null;
  publishedAt: string | null;
  files: RegisterFile[];
  rows: number;
  inserted: number;
  kept: number;
  removed: number;
  skippedRows: number;
  duplicates: number;
  logic: string;
  normalizer: string;
  error: string | null;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

function parseState(after: unknown, rowAt: Date): RegisterImportState | null {
  if (!after || typeof after !== 'object') return null;
  const o = after as Record<string, unknown>;
  if (o.status !== 'imported' && o.status !== 'unchanged' && o.status !== 'failed') return null;
  // The importer's own clock (`checkedAt`) wins over the row insert time, so an injected clock
  // (worker catch-up runs, tests) sees consistent intervals.
  const checked = typeof o.checkedAt === 'string' ? new Date(o.checkedAt) : null;
  const at = checked && Number.isFinite(checked.getTime()) ? checked : rowAt;
  const files = Array.isArray(o.files)
    ? o.files
        .filter((f): f is Record<string, unknown> => !!f && typeof f === 'object')
        .map((f) => ({ url: String(f.url ?? ''), bytes: num(f.bytes), sha256: String(f.sha256 ?? ''), ...(typeof f.label === 'string' ? { label: f.label } : {}) }))
    : [];
  return {
    status: o.status,
    at,
    version: str(o.version),
    publishedAt: str(o.publishedAt),
    files,
    rows: num(o.rows),
    inserted: num(o.inserted),
    kept: num(o.kept),
    removed: num(o.removed),
    skippedRows: num(o.skippedRows),
    duplicates: num(o.duplicates),
    logic: String(o.logic ?? ''),
    normalizer: String(o.normalizer ?? ''),
    error: str(o.error),
  };
}

export interface RegisterStates {
  /** Newest attempt of any status. */
  lastAttempt: RegisterImportState | null;
  /** Newest imported / unchanged attempt. */
  lastSuccess: RegisterImportState | null;
}

/** Latest import attempts of a register, from the audit log. */
export async function registerStates(db: DbOrTx, key: RegisterKey): Promise<RegisterStates> {
  const rows = await db
    .select({ after: auditLog.afterJson, at: auditLog.at })
    .from(auditLog)
    .where(and(eq(auditLog.action, IMPORT_ACTION), eq(auditLog.entityType, REGISTER_ENTITY), eq(auditLog.entityId, key)))
    .orderBy(desc(auditLog.id))
    .limit(60);
  let lastAttempt: RegisterImportState | null = null;
  let lastSuccess: RegisterImportState | null = null;
  for (const r of rows) {
    const s = parseState(r.after, r.at);
    if (!s) continue;
    lastAttempt ??= s;
    if (s.status !== 'failed') {
      lastSuccess = s;
      break;
    }
  }
  return { lastAttempt, lastSuccess };
}

function stateAfter(s: Omit<RegisterImportState, 'at'>, at: Date): Record<string, unknown> {
  return { ...s, checkedAt: at.toISOString() };
}

/** Records a failed attempt (outside any import transaction). */
export async function recordFailure(
  db: DbOrTx,
  def: RegisterDef,
  version: string,
  error: string,
  files: RegisterFile[] = [],
  publishedAt: string | null = null,
  now: Date = new Date(),
): Promise<void> {
  await audit(db, {
    action: IMPORT_ACTION,
    entityType: REGISTER_ENTITY,
    entityId: def.key,
    actor: 'worker',
    after: stateAfter({
      status: 'failed',
      version,
      publishedAt,
      files,
      rows: 0,
      inserted: 0,
      kept: 0,
      removed: 0,
      skippedRows: 0,
      duplicates: 0,
      logic: REGISTERS_LOGIC_VERSION,
      normalizer: normalizerFingerprint(),
      error: error.slice(0, 1000),
    }, now),
    reason: `${def.name}: import failed — the previous version stays in use`,
  });
}

interface PreparedEntry {
  orgName: string;
  normalizedName: string;
  town: string | null;
  route: string | null;
  rating: string | null;
  rawJson: RegisterEntryInput['raw'];
  entryHash: string;
}

/** Cleans one parsed entry; null when it has no usable organisation name. */
export function prepareEntry(e: RegisterEntryInput): PreparedEntry | null {
  const orgName = clean(e.orgName, 512);
  if (!orgName) return null;
  const normalizedName = normalizeCompanyName(orgName).slice(0, 191);
  if (!normalizedName) return null;
  return {
    orgName,
    normalizedName,
    town: clean(e.town, 128),
    route: clean(e.route, 191),
    rating: clean(e.rating, 64),
    rawJson: e.raw,
    entryHash: hashJson(e.raw),
  };
}

export interface ImportOutcome {
  status: 'imported' | 'unchanged' | 'busy';
  version: string;
  rows: number;
  inserted: number;
  kept: number;
  removed: number;
  skippedRows: number;
  duplicates: number;
}

export interface ImportOptions {
  /** Download date of the snapshot, 'YYYY-MM-DD' (= register_version). */
  version: string;
  now: Date;
  /** Bypass the shrink guard. */
  force?: boolean;
  /** Last imported/unchanged state (for the unchanged shortcut). */
  lastSuccess: RegisterImportState | null;
}

function sameFiles(a: RegisterFile[], b: RegisterFile[]): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const key = (fs: RegisterFile[]) => fs.map((f) => f.sha256).sort().join(',');
  return key(a) === key(b);
}

const lockName = (key: RegisterKey) => `radar_register_${key}`;

export async function importSnapshot(db: DbOrTx, def: RegisterDef, snapshot: RegisterSnapshot, opts: ImportOptions): Promise<ImportOutcome> {
  const { version, now } = opts;
  const normalizer = normalizerFingerprint();
  const zero = { rows: 0, inserted: 0, kept: 0, removed: 0, skippedRows: 0, duplicates: 0 };

  return withTransaction(db, async (tx) => {
    const lock = lockName(def.key);
    const [lockRows] = (await tx.execute(sql`SELECT GET_LOCK(${lock}, 0) AS got`)) as unknown as [{ got: number | string | null }[]];
    if (Number(lockRows[0]?.got) !== 1) return { status: 'busy', version, ...zero };
    try {
      const [{ n: existingRows }] = await tx.select({ n: count() }).from(sre).where(eq(sre.registerKey, def.key));

      const last = opts.lastSuccess;
      if (
        last &&
        sameFiles(last.files, snapshot.files) &&
        last.logic === REGISTERS_LOGIC_VERSION &&
        last.normalizer === normalizer &&
        existingRows === last.rows &&
        existingRows > 0
      ) {
        await tx
          .update(sre)
          .set({ registerVersion: version })
          .where(and(eq(sre.registerKey, def.key), ne(sre.registerVersion, version)));
        const outcome: ImportOutcome = { status: 'unchanged', version, ...zero, rows: existingRows, kept: existingRows };
        await audit(tx, {
          action: IMPORT_ACTION,
          entityType: REGISTER_ENTITY,
          entityId: def.key,
          actor: 'worker',
          after: stateAfter({ ...outcome, status: 'unchanged', publishedAt: snapshot.publishedAt, files: snapshot.files, logic: REGISTERS_LOGIC_VERSION, normalizer, error: null }, now),
          reason: `${def.name}: unchanged since ${last.version ?? 'the last import'}`,
        });
        return outcome;
      }

      // A second import on the same download date: park the current rows under a temporary
      // version so kept/new/removed are computed against them like any other version.
      const parked = `~${version}`;
      await tx
        .update(sre)
        .set({ registerVersion: parked })
        .where(and(eq(sre.registerKey, def.key), eq(sre.registerVersion, version)));
      const oldVersions = (await tx.selectDistinct({ v: sre.registerVersion }).from(sre).where(eq(sre.registerKey, def.key))).map((r) => r.v);

      const seen = new Set<string>();
      const stats = { ...zero };
      let batch: PreparedEntry[] = [];

      const flush = async () => {
        if (!batch.length) return;
        const byHash = new Map<string, { id: number; orgName: string; normalizedName: string; town: string | null; route: string | null; rating: string | null }>();
        if (oldVersions.length) {
          const existing = await tx
            .select({
              id: sre.id,
              entryHash: sre.entryHash,
              orgName: sre.orgName,
              normalizedName: sre.normalizedName,
              town: sre.town,
              route: sre.route,
              rating: sre.rating,
            })
            .from(sre)
            .where(
              and(
                eq(sre.registerKey, def.key),
                inArray(sre.registerVersion, oldVersions),
                inArray(
                  sre.entryHash,
                  batch.map((b) => b.entryHash),
                ),
              ),
            );
          for (const r of existing) if (!byHash.has(r.entryHash)) byHash.set(r.entryHash, r);
        }
        const bump: number[] = [];
        const changed: (PreparedEntry & { id: number })[] = [];
        const fresh: PreparedEntry[] = [];
        for (const p of batch) {
          const old = byHash.get(p.entryHash);
          if (!old) fresh.push(p);
          else if (old.orgName === p.orgName && old.normalizedName === p.normalizedName && old.town === p.town && old.route === p.route && old.rating === p.rating) bump.push(old.id);
          else changed.push({ ...p, id: old.id });
        }
        if (bump.length) await tx.update(sre).set({ registerVersion: version }).where(inArray(sre.id, bump));
        if (changed.length) {
          // Same raw row, different derived columns (new normaliser / mapping): refresh in place,
          // keeping the id.
          await tx
            .insert(sre)
            .values(
              changed.map((c) => ({
                id: c.id,
                registerKey: def.key,
                countryIso2: def.countryIso2,
                orgName: c.orgName,
                normalizedName: c.normalizedName,
                town: c.town,
                route: c.route,
                rating: c.rating,
                rawJson: c.rawJson,
                entryHash: c.entryHash,
                registerVersion: version,
                importedAt: now,
              })),
            )
            .onDuplicateKeyUpdate({
              set: {
                orgName: sql.raw('VALUES(`org_name`)'),
                normalizedName: sql.raw('VALUES(`normalized_name`)'),
                town: sql.raw('VALUES(`town`)'),
                route: sql.raw('VALUES(`route`)'),
                rating: sql.raw('VALUES(`rating`)'),
                registerVersion: sql.raw('VALUES(`register_version`)'),
              },
            });
        }
        if (fresh.length) {
          await tx.insert(sre).values(
            fresh.map((p) => ({
              registerKey: def.key,
              countryIso2: def.countryIso2,
              orgName: p.orgName,
              normalizedName: p.normalizedName,
              town: p.town,
              route: p.route,
              rating: p.rating,
              rawJson: p.rawJson,
              entryHash: p.entryHash,
              registerVersion: version,
              importedAt: now,
            })),
          );
        }
        stats.kept += bump.length + changed.length;
        stats.inserted += fresh.length;
        batch = [];
      };

      for await (const e of snapshot.entries) {
        const p = prepareEntry(e);
        if (!p) {
          stats.skippedRows++;
          continue;
        }
        if (seen.has(p.entryHash)) {
          stats.duplicates++;
          continue;
        }
        seen.add(p.entryHash);
        stats.rows++;
        batch.push(p);
        if (batch.length >= BATCH) await flush();
      }
      await flush();
      seen.clear();

      if (stats.rows < def.minEntries) {
        throw new RegisterError(`${def.name}: only ${stats.rows} entries parsed (expected at least ${def.minEntries}) — the file or its format looks broken`, 'too_few');
      }
      if (!opts.force && existingRows > 0 && stats.rows < existingRows * SHRINK_GUARD) {
        throw new RegisterError(
          `${def.name}: ${stats.rows} entries vs ${existingRows} in the current version (less than ${Math.round(SHRINK_GUARD * 100)}%) — looks like a truncated download; re-run with force to accept`,
          'shrunk',
        );
      }

      const [del] = await tx.delete(sre).where(and(eq(sre.registerKey, def.key), ne(sre.registerVersion, version)));
      stats.removed = Number((del as { affectedRows?: number }).affectedRows ?? 0);

      const outcome: ImportOutcome = { status: 'imported', version, ...stats };
      await audit(tx, {
        action: IMPORT_ACTION,
        entityType: REGISTER_ENTITY,
        entityId: def.key,
        actor: 'worker',
        after: stateAfter({ ...outcome, status: 'imported', publishedAt: snapshot.publishedAt, files: snapshot.files, logic: REGISTERS_LOGIC_VERSION, normalizer, error: null }, now),
        reason: `${def.name}: ${stats.rows} entries (${stats.inserted} new, ${stats.kept} kept, ${stats.removed} removed)`,
      });
      return outcome;
    } finally {
      await tx.execute(sql`SELECT RELEASE_LOCK(${lock})`);
    }
  });
}
