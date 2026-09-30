import 'server-only';
import { asc } from 'drizzle-orm';
import { countries } from '@/db/schema';
import { EDITABLE_SETTING_KEYS, type EditableSettingKey } from '@/components/settings/forms';
import type { AiSettings, AlertSettings, Profile, RetentionSettings, ScoreWeights } from '@/lib/contracts/settings';
import { getDb, type DbOrTx } from '@/lib/db';
import { getEnvVar } from '@/lib/env';
import { getSetting, getSettingRaw } from '@/lib/settings';

export interface SettingsView {
  profile: Profile;
  score_weights: ScoreWeights;
  alerts: AlertSettings;
  ai: AiSettings;
  retention: RetentionSettings;
  /** Form version stamps (0 = the row does not exist yet) for the stale-form check. */
  versions: Record<EditableSettingKey, number>;
  updatedAt: Record<EditableSettingKey, Date | null>;
  countryNames: Record<string, string>;
  /** What the server environment provides (booleans only — never the secrets). */
  env: { aiReady: boolean; aiModel: string; aiEnvLimit: number; telegram: boolean; email: boolean };
}

export async function loadSettings(db: DbOrTx = getDb()): Promise<SettingsView> {
  const [values, raws, countryRows] = await Promise.all([
    Promise.all(EDITABLE_SETTING_KEYS.map((k) => getSetting(db, k))),
    Promise.all(EDITABLE_SETTING_KEYS.map((k) => getSettingRaw(db, k))),
    db.select({ iso2: countries.iso2, name: countries.name }).from(countries).orderBy(asc(countries.name)),
  ]);
  const v = Object.fromEntries(EDITABLE_SETTING_KEYS.map((k, i) => [k, values[i]])) as unknown as Pick<SettingsView, EditableSettingKey>;
  return {
    ...v,
    versions: Object.fromEntries(EDITABLE_SETTING_KEYS.map((k, i) => [k, raws[i]?.version ?? 0])) as Record<EditableSettingKey, number>,
    updatedAt: Object.fromEntries(EDITABLE_SETTING_KEYS.map((k, i) => [k, raws[i]?.updatedAt ?? null])) as Record<EditableSettingKey, Date | null>,
    countryNames: Object.fromEntries(countryRows.map((c) => [c.iso2, c.name])),
    env: {
      aiReady: Boolean(getEnvVar('AI_ENABLED') && getEnvVar('OPENROUTER_API_KEY')),
      aiModel: getEnvVar('OPENROUTER_MODEL'),
      aiEnvLimit: getEnvVar('AI_DAILY_LIMIT'),
      telegram: Boolean(getEnvVar('TELEGRAM_BOT_TOKEN') && getEnvVar('TELEGRAM_CHAT_ID')),
      email: Boolean(getEnvVar('SMTP_URL') && getEnvVar('ALERT_EMAIL_TO')),
    },
  };
}
