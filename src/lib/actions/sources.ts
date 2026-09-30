'use server';
/**
 * /sources mutations (spec §7, §8). Every action: requireSession → zod → write + audit in one
 * transaction → refresh. Runs are never executed in the web process: "run now" / "dry run" only
 * queue a pipeline_runs row for the worker (enqueueRun).
 */
import { and, eq, isNotNull, sql } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { countries, sourcePlatforms, sourceRuns, sources } from '@/db/schema';
import { TERMS_STATUSES } from '@/db/schema/_enums';
import {
  CHECKLIST_LABEL,
  CHECKLIST_META,
  SOURCE_CHECKLIST_KEYS,
  STATUS_MOVE_LABEL,
  moveTarget,
  normalizeChecklist,
  promotionGate,
  type StatusMove,
} from '@/components/sources/checklist';
import {
  dateInputSchema,
  done,
  fail,
  firstIssue,
  flagSchema,
  formObject,
  idSchema,
  optionalText,
  reasonSchema,
  type ActionState,
} from '@/components/system/action-kit';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/auth/request';
import { requireSession } from '@/lib/auth/session';
import { getConnector } from '@/lib/connectors';
import { getDb, type DbOrTx, type Tx } from '@/lib/db';
import { log } from '@/lib/log';
import { EnqueueRunError, enqueueRun } from '@/lib/pipeline/queue';
import { checkConfig, statusBeforeLastPause } from '@/lib/queries/sources';

class UserError extends Error {}

async function actor() {
  await requireSession();
  return { ip: clientIp(await headers()) };
}

function unexpected(what: string, err: unknown): ActionState {
  if (err instanceof UserError || err instanceof EnqueueRunError) return fail(err.message);
  log.error(`sources action: ${what} failed`, { err });
  return fail(`Could not ${what}. Nothing was changed — try again.`);
}

async function lockSource(tx: Tx, id: number) {
  const [row] = await tx.select().from(sources).where(eq(sources.id, id)).limit(1).for('update');
  if (!row) throw new UserError('That source no longer exists.');
  return row;
}

// ---- status moves ------------------------------------------------------------------------

const MOVES = ['start_trial', 'promote', 'pause', 'resume', 'disable', 'enable'] as const satisfies readonly StatusMove[];

const statusSchema = z.object({
  sourceId: idSchema,
  move: z.enum(MOVES, { error: 'Unknown status change.' }),
  reason: optionalText(500, 'Reason'),
});

export async function sourceStatusAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = statusSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { sourceId, move, reason } = parsed.data;
  let message = '';
  try {
    await getDb().transaction(async (tx) => {
      const row = await lockSource(tx, sourceId);
      if (move === 'promote') {
        const gate = promotionGate(row.status, row.checklistJson);
        if (!gate.ok) throw new UserError(gate.reason);
      }
      const prevStatus = move === 'resume' ? await statusBeforeLastPause(tx, sourceId) : undefined;
      const target = moveTarget(row.status, move, prevStatus);
      if (!target) throw new UserError(`“${STATUS_MOVE_LABEL[move]}” is not possible while the source is ${row.status}.`);
      await tx.update(sources).set({ status: target }).where(eq(sources.id, sourceId));
      await audit(tx, {
        action: 'source.status',
        entityType: 'source',
        entityId: sourceId,
        before: { status: row.status },
        after: { status: target, move },
        reason,
        ip,
      });
      message = `${row.label}: ${row.status} → ${target}.`;
    });
  } catch (err) {
    return unexpected('change the status', err);
  }
  refresh();
  return done(message);
}

// ---- breaker / baseline -----------------------------------------------------------------------

const resetSchema = z.object({ sourceId: idSchema, reason: optionalText(500, 'Reason') });

export async function resetBreakerAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = resetSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { sourceId, reason } = parsed.data;
  try {
    await getDb().transaction(async (tx) => {
      const row = await lockSource(tx, sourceId);
      if (row.consecutiveFailures === 0 && !row.circuitOpenUntil) throw new UserError('The breaker is already closed — nothing to reset.');
      await tx.update(sources).set({ consecutiveFailures: 0, circuitOpenUntil: null }).where(eq(sources.id, sourceId));
      await audit(tx, {
        action: 'source.breaker_reset',
        entityType: 'source',
        entityId: sourceId,
        before: { consecutiveFailures: row.consecutiveFailures, circuitOpenUntil: row.circuitOpenUntil },
        after: { consecutiveFailures: 0, circuitOpenUntil: null },
        reason,
        ip,
      });
    });
  } catch (err) {
    return unexpected('reset the circuit breaker', err);
  }
  refresh();
  return done('Circuit breaker reset. The next run will try this source again.');
}

/**
 * Forgets the volume / freshness baseline: clears baseline_json, retires the recorded volume of
 * earlier runs (health_flags_json.listed moves to baselineReset.listed, so the pipeline's baseline
 * builder skips them while the run history still shows the number) and reopens the checklist item.
 */
export async function resetBaselineAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = z.object({ sourceId: idSchema, reason: reasonSchema }).safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { sourceId, reason } = parsed.data;
  let retired = 0;
  try {
    await getDb().transaction(async (tx) => {
      const row = await lockSource(tx, sourceId);
      const at = new Date().toISOString();
      const [res] = await tx
        .update(sourceRuns)
        .set({
          healthFlagsJson: sql`json_remove(json_set(${sourceRuns.healthFlagsJson}, '$.baselineReset', json_object('at', ${at}, 'listed', json_extract(${sourceRuns.healthFlagsJson}, '$.listed'))), '$.listed')`,
        })
        .where(and(eq(sourceRuns.sourceId, sourceId), isNotNull(sql`json_extract(${sourceRuns.healthFlagsJson}, '$.listed')`)));
      retired = Number((res as { affectedRows?: number }).affectedRows ?? 0);
      const checklist = normalizeChecklist(row.checklistJson);
      checklist.baseline_recorded = { done: false, at, note: `baseline reset: ${reason}`.slice(0, 500) };
      await tx.update(sources).set({ baselineJson: null, checklistJson: checklist }).where(eq(sources.id, sourceId));
      await audit(tx, {
        action: 'source.baseline_reset',
        entityType: 'source',
        entityId: sourceId,
        before: { baseline: row.baselineJson ?? null },
        after: { baseline: null, retiredRuns: retired },
        reason,
        ip,
      });
    });
  } catch (err) {
    return unexpected('reset the baseline', err);
  }
  refresh();
  return done(`Baseline cleared (${retired} earlier run${retired === 1 ? '' : 's'} retired). The next healthy runs build a new one.`);
}

// ---- run now / dry run ------------------------------------------------------------------------

const runSchema = z.object({ sourceId: idSchema, dryRun: flagSchema });

export async function runSourceAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = runSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { sourceId, dryRun } = parsed.data;
  let result: { runId: number; created: boolean } | null = null;
  try {
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select({ id: sources.id, status: sources.status, label: sources.label }).from(sources).where(eq(sources.id, sourceId)).limit(1);
      if (!row) throw new UserError('That source no longer exists.');
      if (row.status === 'disabled') throw new UserError('A disabled source never runs — re-enable it first.');
      result = await enqueueRun(tx, { kind: dryRun ? 'dry_run' : 'manual', dryRun, sourceIds: [sourceId], requestedBy: 'ui' });
      await audit(tx, {
        action: dryRun ? 'source.dry_run_queued' : 'source.run_queued',
        entityType: 'source',
        entityId: sourceId,
        after: { runId: result.runId, created: result.created, dryRun },
        ip,
      });
    });
  } catch (err) {
    return unexpected(dryRun ? 'queue the dry run' : 'queue the run', err);
  }
  refresh();
  const r = result as { runId: number; created: boolean } | null;
  if (!r) return fail('Could not queue the run.');
  return done(
    r.created
      ? `${dryRun ? 'Dry run' : 'Run'} #${r.runId} queued — the worker picks it up within a minute.`
      : `An identical ${dryRun ? 'dry run' : 'run'} (#${r.runId}) is already queued.`,
  );
}

// ---- checklist -----------------------------------------------------------------------------------

const checklistSchema = z.object({
  sourceId: idSchema,
  item: z.enum(SOURCE_CHECKLIST_KEYS, { error: 'Unknown checklist item.' }),
  done: flagSchema,
  date: z.string().trim().optional(),
  note: optionalText(500, 'Note'),
});

export async function checklistItemAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = checklistSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { sourceId, item, done: isDone, note } = parsed.data;
  const meta = CHECKLIST_META.find((m) => m.key === item)!;
  let at: string | null = null;
  if (isDone) {
    const d = dateInputSchema.safeParse(parsed.data.date ?? '');
    if (!d.success) return fail(`Date: ${firstIssue(d.error)}`);
    if (d.data.getTime() > Date.now() + 36 * 3_600_000) return fail('Date: the check cannot be in the future.');
    at = d.data.toISOString();
    if (!note) return fail(meta.how === 'human' ? 'Note: say what you checked (e.g. “20 jobs vs. the board, 1 salary wrong”).' : 'Note: this item is normally ticked by the pipeline — say why you are ticking it by hand.');
  } else if (!note) {
    return fail('Note: say why this item is no longer done.');
  }
  try {
    await getDb().transaction(async (tx) => {
      const row = await lockSource(tx, sourceId);
      const checklist = normalizeChecklist(row.checklistJson);
      const before = checklist[item];
      checklist[item] = { done: isDone, at: isDone ? at : new Date().toISOString(), note };
      await tx.update(sources).set({ checklistJson: checklist }).where(eq(sources.id, sourceId));
      await audit(tx, {
        action: 'source.checklist',
        entityType: 'source',
        entityId: sourceId,
        before: { item, ...before },
        after: { item, ...checklist[item] },
        reason: note,
        ip,
      });
    });
  } catch (err) {
    return unexpected('update the checklist', err);
  }
  refresh();
  return done(`${isDone ? 'Ticked' : 'Reopened'}: ${CHECKLIST_LABEL[item]}.`);
}

// ---- config / label ----------------------------------------------------------------------------

function parseConfigText(text: string): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return { ok: false, error: 'Config: not valid JSON.' };
  }
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { ok: false, error: 'Config: must be a JSON object ({ … }).' };
  return { ok: true, value: v as Record<string, unknown> };
}

const countrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || /^[A-Z]{2}$/.test(v), 'Country: a two-letter code (DE) or empty.');

const configSchema = z.object({
  sourceId: idSchema,
  label: z.string().trim().min(2, 'Label: at least 2 characters.').max(191, 'Label: at most 191 characters.'),
  countryIso2: countrySchema,
  config: z.string().max(20_000, 'Config: too long.'),
  notes: optionalText(4000, 'Notes'),
});

async function countryExists(tx: DbOrTx, iso2: string | null): Promise<boolean> {
  if (iso2 === null) return true;
  const [row] = await tx.select({ iso2: countries.iso2 }).from(countries).where(eq(countries.iso2, iso2)).limit(1);
  return Boolean(row);
}

export async function sourceConfigAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = configSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { sourceId, label, countryIso2, notes } = parsed.data;
  const cfg = parseConfigText(parsed.data.config);
  if (!cfg.ok) return fail(cfg.error);
  try {
    await getDb().transaction(async (tx) => {
      const row = await lockSource(tx, sourceId);
      const check = checkConfig(row.platformKey, cfg.value, row.sourceKey);
      if (!check.valid) throw new UserError(`Config: ${check.issues.join(' ')}`);
      if (!(await countryExists(tx, countryIso2))) throw new UserError(`Country: ${countryIso2} is not in the country list.`);
      const next = { label, countryIso2, configJson: cfg.value, notes };
      await tx.update(sources).set(next).where(eq(sources.id, sourceId));
      await audit(tx, {
        action: 'source.config',
        entityType: 'source',
        entityId: sourceId,
        before: { label: row.label, countryIso2: row.countryIso2, config: row.configJson, notes: row.notes },
        after: { label, countryIso2, config: cfg.value, notes },
        ip,
      });
    });
  } catch (err) {
    return unexpected('save the config', err);
  }
  refresh();
  return done('Source settings saved. They apply from the next run.');
}

// ---- add source ---------------------------------------------------------------------------------

const createSchema = z.object({
  platformKey: z.string().trim().min(1, 'Pick a connector.').max(64),
  label: z.string().trim().min(2, 'Label: at least 2 characters.').max(191, 'Label: at most 191 characters.'),
  countryIso2: countrySchema,
  config: z.string().max(20_000, 'Config: too long.'),
});

/** Adds a source as a draft (never straight into the daily run). Registers the platform if needed. */
export async function createSourceAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = createSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { platformKey, label, countryIso2 } = parsed.data;
  const connector = getConnector(platformKey);
  if (!connector) return fail('Pick a connector from the list.');
  const cfg = parseConfigText(parsed.data.config.trim() || '{}');
  if (!cfg.ok) return fail(cfg.error);
  const check = checkConfig(platformKey, cfg.value, null);
  if (!check.valid || !check.derivedKey) return fail(`Config: ${check.issues.join(' ') || 'not valid for this connector.'}`);
  const sourceKey = check.derivedKey;
  let newId = 0;
  try {
    await getDb().transaction(async (tx) => {
      const [dupe] = await tx.select({ id: sources.id }).from(sources).where(eq(sources.sourceKey, sourceKey)).limit(1);
      if (dupe) throw new UserError(`A source for “${sourceKey}” already exists (#${dupe.id}).`);
      if (!(await countryExists(tx, countryIso2))) throw new UserError(`Country: ${countryIso2} is not in the country list.`);
      const [platform] = await tx.select({ key: sourcePlatforms.key }).from(sourcePlatforms).where(eq(sourcePlatforms.key, platformKey)).limit(1);
      if (!platform) {
        const p = connector.platform;
        await tx.insert(sourcePlatforms).values({
          key: platformKey,
          name: p.name,
          grade: p.grade,
          accessMethod: p.accessMethod,
          termsUrl: p.termsUrl,
          termsStatus: 'unknown',
          rateLimitPerMin: p.rateLimitPerMin,
          dailyCap: p.dailyCap,
        });
        await audit(tx, { action: 'platform.create', entityType: 'source_platform', entityId: platformKey, after: { name: p.name, grade: p.grade, termsStatus: 'unknown' }, ip });
      }
      const [res] = await tx.insert(sources).values({
        sourceKey,
        platformKey,
        configJson: cfg.value,
        label,
        countryIso2,
        status: 'draft',
        checklistJson: normalizeChecklist(null),
      });
      newId = Number(res.insertId);
      await audit(tx, {
        action: 'source.create',
        entityType: 'source',
        entityId: newId,
        after: { sourceKey, platformKey, label, countryIso2, config: cfg.value, status: 'draft' },
        ip,
      });
    });
  } catch (err) {
    return unexpected('add the source', err);
  }
  refresh();
  return done(`Added “${label}” as a draft (#${newId}). Dry-run it, then start a trial.`);
}

// ---- platform terms ------------------------------------------------------------------------------

const termsSchema = z.object({
  platformKey: z.string().trim().min(1).max(64),
  termsStatus: z.enum(TERMS_STATUSES, { error: 'Pick a terms status.' }),
  reviewedAt: dateInputSchema,
  termsUrl: z
    .string()
    .trim()
    .max(2048)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || /^https:\/\/[^\s]+$/i.test(v), 'Terms URL: must start with https://'),
  termsNotes: optionalText(4000, 'Notes'),
});

export async function platformTermsAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = termsSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const { platformKey, termsStatus, reviewedAt, termsUrl, termsNotes } = parsed.data;
  if (reviewedAt.getTime() > Date.now() + 36 * 3_600_000) return fail('Review date: cannot be in the future.');
  let pausedLive = 0;
  try {
    await getDb().transaction(async (tx) => {
      const [row] = await tx.select().from(sourcePlatforms).where(eq(sourcePlatforms.key, platformKey)).limit(1).for('update');
      const before = row ? { termsStatus: row.termsStatus, termsReviewedAt: row.termsReviewedAt, termsUrl: row.termsUrl, termsNotes: row.termsNotes } : null;
      if (row) {
        await tx.update(sourcePlatforms).set({ termsStatus, termsReviewedAt: reviewedAt, termsUrl, termsNotes }).where(eq(sourcePlatforms.key, platformKey));
      } else {
        const connector = getConnector(platformKey);
        if (!connector) throw new UserError('Unknown platform.');
        const p = connector.platform;
        await tx.insert(sourcePlatforms).values({
          key: platformKey,
          name: p.name,
          grade: p.grade,
          accessMethod: p.accessMethod,
          termsUrl: termsUrl ?? p.termsUrl,
          termsStatus,
          termsReviewedAt: reviewedAt,
          termsNotes,
          rateLimitPerMin: p.rateLimitPerMin,
          dailyCap: p.dailyCap,
        });
      }
      // Forbidden terms stop every running source of the platform (spec §7.3: respect each site's rules).
      if (termsStatus === 'forbidden') {
        const running = await tx
          .select({ id: sources.id, status: sources.status })
          .from(sources)
          .where(and(eq(sources.platformKey, platformKey), sql`${sources.status} in ('trial','live')`));
        for (const s of running) {
          await tx.update(sources).set({ status: 'paused' }).where(eq(sources.id, s.id));
          await audit(tx, { action: 'source.status', entityType: 'source', entityId: s.id, before: { status: s.status }, after: { status: 'paused', move: 'pause' }, reason: 'platform terms marked forbidden', ip });
        }
        pausedLive = running.length;
      }
      await audit(tx, {
        action: 'platform.terms',
        entityType: 'source_platform',
        entityId: platformKey,
        before,
        after: { termsStatus, termsReviewedAt: reviewedAt, termsUrl, termsNotes },
        reason: termsNotes,
        ip,
      });
    });
  } catch (err) {
    return unexpected('save the terms review', err);
  }
  refresh();
  return done(`Terms recorded as ${termsStatus}.${pausedLive ? ` Paused ${pausedLive} running source${pausedLive === 1 ? '' : 's'}.` : ''}`);
}
