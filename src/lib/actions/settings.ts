'use server';
/**
 * /settings mutation. requireSession → parse the section's form (components/settings/forms.ts) →
 * stale-form check on the row version → setSetting (validates again, bumps the version and writes
 * the audit row in one transaction) → refresh.
 */
import { refresh } from 'next/cache';
import {
  EDITABLE_SETTING_KEYS,
  changedKeys,
  parseAiForm,
  parseAlertsForm,
  parseProfileForm,
  parseRetentionForm,
  parseWeightsForm,
  type EditableSettingKey,
} from '@/components/settings/forms';
import { done, fail, versionSchema, type ActionState } from '@/components/system/action-kit';
import { requireSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { log } from '@/lib/log';
import { getSetting, getSettingRaw, setSetting } from '@/lib/settings';

export async function saveSettingsAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireSession();
  const section = formData.get('section');
  if (typeof section !== 'string' || !(EDITABLE_SETTING_KEYS as readonly string[]).includes(section)) return fail('Unknown settings section.');
  const version = versionSchema.safeParse(formData.get('version'));
  if (!version.success) return fail('Missing form version — reload the page.');
  const key = section as EditableSettingKey;
  const parsed =
    key === 'profile' ? parseProfileForm(formData)
    : key === 'score_weights' ? parseWeightsForm(formData)
    : key === 'alerts' ? parseAlertsForm(formData)
    : key === 'ai' ? parseAiForm(formData)
    : parseRetentionForm(formData);
  if (!parsed.ok) return fail(parsed.error);
  try {
    const db = getDb();
    const current = await getSettingRaw(db, key);
    if ((current?.version ?? 0) !== version.data) return fail('These settings changed somewhere else since you opened the page. Reload it and try again.');
    const before = await getSetting(db, key);
    await setSetting(db, key, parsed.value as never, { reason: 'edited on the Settings screen' });
    const changed = changedKeys(before, parsed.value);
    refresh();
    return done(changed.length ? `Saved. Changed: ${changed.join(', ')}.` : 'Saved — nothing was different.');
  } catch (err) {
    log.error('settings action: save failed', { err, section });
    return fail('Could not save. Nothing was changed — try again.');
  }
}
