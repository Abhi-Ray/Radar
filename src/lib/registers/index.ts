/**
 * Public sponsor / employer registers (spec §13.2): download, parse and store official registers
 * with their name and download date, so company evidence can be matched against them.
 *
 * `refreshRegisters(db)` is what the worker schedules (daily). It is idempotent and never throws:
 * - a register checked successfully less than `minIntervalHours` (20 h) ago is skipped;
 * - after a failure it is retried no sooner than `failureRetryHours` (2 h) later;
 * - each register is imported in its own transaction (see ./import.ts); a failure keeps the
 *   previous version, is written to the audit log and raises an alert
 *   (dedupe key `register:<key>:down`; critical when no usable version exists, warn otherwise).
 *
 * Downloads go through the SSRF-safe fetcher and must stay on the publisher's own hosts.
 */
import { count, eq } from 'drizzle-orm';
import { sponsorRegisterEntries as sre } from '../../db/schema';
import { raiseAlert } from '../alerts';
import type { DbOrTx } from '../db';
import { log } from '../log';
import { createSafeFetch, type AddressPolicy, type Resolver } from '../security/safe-fetch';
import { DAY_MS, HOUR_MS, utcDay } from '../time';
import { REGISTER_STALE_DAYS } from '../visa/decide';
import { isRegisterKey, REGISTER_KEYS, REGISTERS, type RegisterDef, type RegisterKey } from './catalog';
import { loadDk, loadNl } from './html-sources';
import { importSnapshot, recordFailure, registerStates, type RegisterImportState } from './import';
import { loadCa, loadIe } from './spreadsheet-sources';
import { RegisterError, type RegisterFetch, type RegisterFile, type RegisterSnapshot, type RegisterSourceContext } from './types';
import { loadUk } from './uk';

export { REGISTER_KEYS, REGISTERS, UNSUPPORTED_REGISTERS, isRegisterKey, registerDef } from './catalog';
export type { RegisterDef, RegisterKey, UnsupportedRegister } from './catalog';
export { REGISTERS_LOGIC_VERSION, registerStates } from './import';
export type { RegisterImportState } from './import';
export { RegisterError } from './types';
export type { RegisterEntryInput, RegisterFetch, RegisterFile, RegisterSnapshot } from './types';

export type RegisterLoader = (ctx: RegisterSourceContext) => Promise<RegisterSnapshot>;

export const REGISTER_LOADERS: Readonly<Record<RegisterKey, RegisterLoader>> = {
  uk_home_office: loadUk,
  nl_ind: loadNl,
  dk_siri: loadDk,
  ie_dete: loadIe,
  ca_lmia: loadCa,
};

export const DEFAULT_MIN_INTERVAL_HOURS = 20;
export const DEFAULT_FAILURE_RETRY_HOURS = 2;

export interface RefreshRegistersOptions {
  /** Injected fetcher (tests); default `createSafeFetch({ resolver, addressPolicy })`. */
  fetch?: RegisterFetch;
  resolver?: Resolver;
  addressPolicy?: AddressPolicy;
  now?: Date;
  /** Only these registers (default: all). */
  only?: readonly RegisterKey[];
  /** Ignore the interval checks and the shrink guard. */
  force?: boolean;
  minIntervalHours?: number;
  failureRetryHours?: number;
  /** Lower the per-register minimum entry count (a partial mirror, tests). */
  minEntries?: Partial<Record<RegisterKey, number>>;
}

export type RegisterRefreshStatus = 'imported' | 'unchanged' | 'skipped' | 'failed';

export interface RegisterRefreshResult {
  key: RegisterKey;
  name: string;
  status: RegisterRefreshStatus;
  /** register_version now in use ('YYYY-MM-DD' download date), null when none. */
  version: string | null;
  publishedAt: string | null;
  rows: number;
  inserted: number;
  kept: number;
  removed: number;
  skippedRows: number;
  duplicates: number;
  files: RegisterFile[];
  /** Why it was skipped / why it failed. */
  reason: string | null;
  durationMs: number;
}

function hoursAgo(now: Date, at: Date): number {
  return (now.getTime() - at.getTime()) / HOUR_MS;
}

function blank(def: RegisterDef, status: RegisterRefreshStatus, reason: string | null, last: RegisterImportState | null, started: number): RegisterRefreshResult {
  return {
    key: def.key,
    name: def.name,
    status,
    version: last?.version ?? null,
    publishedAt: last?.publishedAt ?? null,
    rows: last?.rows ?? 0,
    inserted: 0,
    kept: 0,
    removed: 0,
    skippedRows: 0,
    duplicates: 0,
    files: last?.files ?? [],
    reason,
    durationMs: Date.now() - started,
  };
}

function errorText(err: unknown): string {
  if (err instanceof RegisterError) return err.message;
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

async function alertFailure(db: DbOrTx, def: RegisterDef, error: string, lastSuccess: RegisterImportState | null, now: Date): Promise<void> {
  const versionAt = lastSuccess?.version ? Date.parse(`${lastSuccess.version}T00:00:00Z`) : NaN;
  const stale = !Number.isFinite(versionAt) || (now.getTime() - versionAt) / DAY_MS > REGISTER_STALE_DAYS;
  const kept = lastSuccess?.version
    ? `The previous version (${lastSuccess.version}, ${lastSuccess.rows} entries) stays in use${stale ? `, but it is older than ${REGISTER_STALE_DAYS} days` : ''}.`
    : 'No version of this register has been imported yet, so no company can be matched against it.';
  await raiseAlert(db, {
    kind: 'register_import',
    severity: stale ? 'critical' : 'warn',
    title: `Sponsor register import failed: ${def.name}`,
    body: `${error}\n\n${kept}\nSource: ${def.homepage}`,
    dedupeKey: `register:${def.key}:down`,
    entityType: 'sponsor_register',
    entityId: def.key,
  });
}

/** Refreshes one register. Never throws. */
export async function refreshRegister(db: DbOrTx, key: RegisterKey, opts: RefreshRegistersOptions = {}): Promise<RegisterRefreshResult> {
  const override = opts.minEntries?.[key];
  const def: RegisterDef = override === undefined ? REGISTERS[key] : { ...REGISTERS[key], minEntries: override };
  const started = Date.now();
  const now = opts.now ?? new Date();
  const version = utcDay(now);
  let lastSuccess: RegisterImportState | null = null;
  let snapshot: RegisterSnapshot | null = null;
  try {
    const states = await registerStates(db, key);
    lastSuccess = states.lastSuccess;
    if (!opts.force) {
      const minInterval = opts.minIntervalHours ?? DEFAULT_MIN_INTERVAL_HOURS;
      if (lastSuccess && hoursAgo(now, lastSuccess.at) < minInterval) {
        return blank(def, 'skipped', `checked ${hoursAgo(now, lastSuccess.at).toFixed(1)} h ago (interval ${minInterval} h)`, lastSuccess, started);
      }
      const retry = opts.failureRetryHours ?? DEFAULT_FAILURE_RETRY_HOURS;
      const la = states.lastAttempt;
      if (la?.status === 'failed' && hoursAgo(now, la.at) < retry) {
        return blank(def, 'skipped', `last attempt failed ${hoursAgo(now, la.at).toFixed(1)} h ago; retrying after ${retry} h`, lastSuccess, started);
      }
    }
    const fetch = opts.fetch ?? createSafeFetch({ resolver: opts.resolver, addressPolicy: opts.addressPolicy });
    snapshot = await REGISTER_LOADERS[key]({ fetch, now });
    const out = await importSnapshot(db, def, snapshot, { version, now, force: opts.force, lastSuccess });
    if (out.status === 'busy') return blank(def, 'skipped', 'another import of this register is running', lastSuccess, started);
    const result: RegisterRefreshResult = {
      key,
      name: def.name,
      status: out.status,
      version: out.version,
      publishedAt: snapshot.publishedAt,
      rows: out.rows,
      inserted: out.inserted,
      kept: out.kept,
      removed: out.removed,
      skippedRows: out.skippedRows,
      duplicates: out.duplicates,
      files: snapshot.files,
      reason: null,
      durationMs: Date.now() - started,
    };
    log.info('register refreshed', { registerKey: key, status: result.status, version: result.version, rows: result.rows, inserted: result.inserted, removed: result.removed, ms: result.durationMs });
    return result;
  } catch (err) {
    const error = errorText(err);
    log.warn('register refresh failed', { registerKey: key, error });
    try {
      await recordFailure(db, def, version, error, snapshot?.files ?? [], snapshot?.publishedAt ?? null, now);
      await alertFailure(db, def, error, lastSuccess, now);
    } catch (inner) {
      log.error('register failure could not be recorded', { registerKey: key, error: errorText(inner) });
    }
    return blank(def, 'failed', error, lastSuccess, started);
  }
}

/** Refreshes every register (sequentially, one download in memory at a time). Never throws. */
export async function refreshRegisters(db: DbOrTx, opts: RefreshRegistersOptions = {}): Promise<RegisterRefreshResult[]> {
  const keys = (opts.only ?? REGISTER_KEYS).filter(isRegisterKey);
  const out: RegisterRefreshResult[] = [];
  for (const key of keys) out.push(await refreshRegister(db, key, opts));
  return out;
}

export interface RegisterStatus {
  key: RegisterKey;
  name: string;
  countryIso2: string;
  evidenceKind: RegisterDef['evidenceKind'];
  homepage: string;
  /** Rows stored now. */
  entries: number;
  version: string | null;
  publishedAt: string | null;
  lastCheckedAt: Date | null;
  lastAttemptStatus: RegisterImportState['status'] | null;
  lastError: string | null;
  /** The stored version is older than REGISTER_STALE_DAYS (or missing). */
  stale: boolean;
}

/** One line per register for the UI / health checks. */
export async function getRegisterStatus(db: DbOrTx, now: Date = new Date()): Promise<RegisterStatus[]> {
  const out: RegisterStatus[] = [];
  for (const key of REGISTER_KEYS) {
    const def = REGISTERS[key];
    const [{ n }] = await db.select({ n: count() }).from(sre).where(eq(sre.registerKey, key));
    const [row] = await db.select({ v: sre.registerVersion }).from(sre).where(eq(sre.registerKey, key)).limit(1);
    const { lastAttempt, lastSuccess } = await registerStates(db, key);
    const version = row?.v ?? null;
    const t = version ? Date.parse(`${version}T00:00:00Z`) : NaN;
    out.push({
      key,
      name: def.name,
      countryIso2: def.countryIso2,
      evidenceKind: def.evidenceKind,
      homepage: def.homepage,
      entries: n,
      version,
      publishedAt: lastSuccess?.publishedAt ?? null,
      lastCheckedAt: lastSuccess?.at ?? null,
      lastAttemptStatus: lastAttempt?.status ?? null,
      lastError: lastAttempt?.status === 'failed' ? lastAttempt.error : null,
      stale: !Number.isFinite(t) || (now.getTime() - t) / DAY_MS > REGISTER_STALE_DAYS,
    });
  }
  return out;
}
