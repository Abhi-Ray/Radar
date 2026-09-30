'use server';
/**
 * /review mutations. Every action: requireSession → zod → the domain function (which writes its
 * own audit row in one transaction) → refresh.
 */
import { eq } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { done, fail, firstIssue, formObject, idSchema, optionalText, type ActionState } from '@/components/system/action-kit';
import { titleOverrideEntry } from '@/components/review/flags';
import { ROLES } from '@/data/titles/roles';
import { jobs, titleReviewQueue } from '@/db/schema';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/auth/request';
import { requireSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { confirmDuplicate, dismissDuplicate } from '@/lib/dedup/manual';
import { dismissSameSourcePairs, mergeExactTwins } from '@/lib/dedup/tidy';
import { log } from '@/lib/log';
import { ignoreUnrelatedTitles } from '@/lib/normalize/title-tidy';
import { getSetting, setSetting } from '@/lib/settings';

async function actor() {
  await requireSession();
  return { ip: clientIp(await headers()) };
}

function unexpected(what: string, err: unknown): ActionState {
  log.error(`review action: ${what} failed`, { err });
  return fail(`Could not ${what}. Nothing was changed — try again.`);
}

const mergeSchema = z.object({ candidateId: idSchema, keepId: idSchema, reason: optionalText(300, 'Reason') });

export async function mergeDuplicateAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = mergeSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const res = await confirmDuplicate(getDb(), parsed.data.candidateId, parsed.data.reason ?? 'Same job (confirmed in review)', { keepId: parsed.data.keepId, ip });
    refresh();
    return res.ok ? done(res.message) : fail(res.message);
  } catch (err) {
    return unexpected('merge these jobs', err);
  }
}

const dismissSchema = z.object({ candidateId: idSchema, reason: optionalText(300, 'Reason') });

export async function dismissDuplicateAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = dismissSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const res = await dismissDuplicate(getDb(), parsed.data.candidateId, parsed.data.reason, { ip });
    refresh();
    return res.ok ? done(res.message) : fail(res.message);
  } catch (err) {
    return unexpected('mark these jobs as different', err);
  }
}

const IGNORE = '__ignore';
const ROLE_KEYS = new Set<string>(ROLES.map((r) => r.key));
const titleSchema = z.object({
  queueId: idSchema,
  roleKey: z.string().trim().min(1, 'Pick a role, or “Not a role I track”.'),
  note: optionalText(300, 'Note'),
});

export async function mapTitleAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = titleSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { queueId, roleKey, note } = parsed.data;
  if (roleKey !== IGNORE && !ROLE_KEYS.has(roleKey)) return fail('That role does not exist.');
  const role = roleKey === IGNORE ? null : roleKey;
  try {
    const msg = await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(titleReviewQueue).where(eq(titleReviewQueue.id, queueId)).limit(1).for('update');
      if (!row) return 'That title is no longer in the queue.';
      if (row.status !== 'open') return 'That title was already decided.';
      const [profile, overrides] = await Promise.all([getSetting(tx, 'profile'), getSetting(tx, 'title_overrides')]);
      const entry = titleOverrideEntry(role, profile.targetRoles, note, new Date());
      await setSetting(tx, 'title_overrides', { ...overrides, [row.normalized]: entry } as never, { reason: `title review: “${row.titleRaw}”` });
      await tx.update(titleReviewQueue).set({ status: role ? 'mapped' : 'ignored', mappedRoleKey: role, decidedAt: new Date() }).where(eq(titleReviewQueue.id, queueId));
      await audit(tx, { action: role ? 'title.map' : 'title.ignore', entityType: 'title_review', entityId: queueId, after: { normalized: row.normalized, roleKey: role, family: entry.roleFamily }, reason: note, ip });
      return null;
    });
    if (msg) return fail(msg);
    refresh();
    return done(role ? 'Saved. This title now maps to that role for new and re-processed jobs.' : 'Saved. This title is ignored from now on.');
  } catch (err) {
    return unexpected('save this title', err);
  }
}

const flagSchema = z.object({ jobId: idSchema });

export async function clearReviewFlagAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = flagSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const changed = await getDb().transaction(async (tx) => {
      const [res] = await tx.update(jobs).set({ needsReview: false }).where(eq(jobs.id, parsed.data.jobId));
      if (res.affectedRows === 0) return false;
      await audit(tx, { action: 'job.review_cleared', entityType: 'job', entityId: parsed.data.jobId, before: { needsReview: true }, after: { needsReview: false }, ip });
      return true;
    });
    refresh();
    return changed ? done('Marked as checked.') : fail('That job no longer exists.');
  } catch (err) {
    return unexpected('mark this job as checked', err);
  }
}

// ---- bulk clean-up (the same work the nightly run does, on demand) -------------------------------

export async function keepBothAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  void formData;
  const { ip } = await actor();
  try {
    const { dismissed } = await dismissSameSourcePairs(getDb(), { ip });
    refresh();
    return dismissed > 0 ? done(`Kept both jobs for ${dismissed} pair${dismissed === 1 ? '' : 's'}.`) : fail('There is nothing to clear.');
  } catch (err) {
    return unexpected('clear these pairs', err);
  }
}

export async function mergeTwinsAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  void formData;
  const { ip } = await actor();
  try {
    const r = await mergeExactTwins(getDb(), { limit: 150, ip });
    refresh();
    if (r.merged === 0 && r.failed === 0) return fail('There are no exact twins to merge.');
    const left = r.remaining > 0 ? ` ${r.remaining} more — press the button again.` : '';
    const bad = r.failed > 0 ? ` ${r.failed} could not be merged and stay in the queue.` : '';
    return done(`Merged ${r.merged} exact twin${r.merged === 1 ? '' : 's'}.${bad}${left}`);
  } catch (err) {
    return unexpected('merge the twins', err);
  }
}

export async function ignoreUnrelatedTitlesAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  void formData;
  const { ip } = await actor();
  try {
    const { ignored } = await ignoreUnrelatedTitles(getDb(), { ip });
    refresh();
    return ignored > 0 ? done(`Marked ${ignored} title${ignored === 1 ? '' : 's'} as “not a role I track”.`) : fail('There is nothing to clear.');
  } catch (err) {
    return unexpected('clear these titles', err);
  }
}
