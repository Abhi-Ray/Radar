/**
 * Typed settings store. Values are validated with the zod schemas in contracts/settings.ts; a
 * missing or invalid row falls back to defaults (and invalid rows are logged, never crash a page).
 * Writes bump `version` and are audited in the same transaction.
 */
import { eq, sql } from 'drizzle-orm';
import { settings } from '../db/schema';
import { audit } from './audit';
import {
  defaultSetting,
  SETTINGS_SCHEMAS,
  type SettingKey,
  type SettingValue,
} from './contracts/settings';
import type { DbOrTx } from './db';
import { log } from './log';

export type { SettingKey, SettingValue } from './contracts/settings';

export async function getSettingRaw(db: DbOrTx, key: string): Promise<{ value: unknown; version: number; updatedAt: Date } | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  const row = rows[0];
  return row ? { value: row.valueJson, version: row.version, updatedAt: row.updatedAt } : null;
}

/** fx_rates returns null when never fetched; every other key always returns a valid value. */
export async function getSetting<K extends Exclude<SettingKey, 'fx_rates'>>(db: DbOrTx, key: K): Promise<SettingValue<K>>;
export async function getSetting(db: DbOrTx, key: 'fx_rates'): Promise<SettingValue<'fx_rates'> | null>;
export async function getSetting(db: DbOrTx, key: SettingKey): Promise<unknown> {
  const raw = await getSettingRaw(db, key);
  const schema = SETTINGS_SCHEMAS[key];
  if (raw) {
    const parsed = schema.safeParse(raw.value);
    if (parsed.success) return parsed.data;
    log.warn('settings: stored value invalid, using defaults', { settingKey: key, issues: parsed.error.issues.length });
  }
  if (key === 'fx_rates') return null;
  return defaultSetting(key);
}

export interface SetSettingOptions {
  reason?: string | null;
  actor?: 'admin' | 'system' | 'worker' | 'cli';
  /** Skip the audit row (high-frequency system caches such as fx_rates). */
  skipAudit?: boolean;
}

export async function setSetting<K extends SettingKey>(
  db: DbOrTx,
  key: K,
  value: SettingValue<K>,
  opts: SetSettingOptions = {},
): Promise<SettingValue<K>> {
  const schema = SETTINGS_SCHEMAS[key];
  const parsed = schema.parse(value) as SettingValue<K>;
  const run = async (tx: DbOrTx) => {
    const before = await getSettingRaw(tx, key);
    await tx
      .insert(settings)
      .values({ key, valueJson: parsed, version: 1 })
      .onDuplicateKeyUpdate({ set: { valueJson: parsed, version: sql`${settings.version} + 1` } });
    if (!opts.skipAudit) {
      await audit(tx, {
        action: 'settings.update',
        entityType: 'settings',
        entityId: key,
        before: before?.value ?? null,
        after: parsed,
        reason: opts.reason ?? null,
        actor: opts.actor ?? 'admin',
      });
    }
  };
  await db.transaction(async (tx) => run(tx));
  return parsed;
}

/** Inserts defaults for missing keys only (seed). Never overwrites user edits. */
export async function ensureDefaultSettings(db: DbOrTx): Promise<string[]> {
  const created: string[] = [];
  for (const key of ['profile', 'score_weights', 'alerts', 'ai', 'retention'] as const) {
    const existing = await getSettingRaw(db, key);
    if (existing) continue;
    await db.insert(settings).values({ key, valueJson: defaultSetting(key), version: 1 });
    created.push(key);
  }
  return created;
}
