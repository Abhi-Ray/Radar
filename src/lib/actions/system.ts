'use server';
/**
 * /system mutations: queue a pipeline run for the worker (never executed in the web process) and
 * acknowledge alerts. Every action: requireSession → zod → write + audit in one transaction → refresh.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { refresh } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';
import { done, fail, firstIssue, formObject, idSchema, type ActionState } from '@/components/system/action-kit';
import { alerts } from '@/db/schema';
import { audit } from '@/lib/audit';
import { clientIp } from '@/lib/auth/request';
import { requireSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { log } from '@/lib/log';
import { EnqueueRunError, enqueueRun } from '@/lib/pipeline/queue';

async function actor() {
  await requireSession();
  return { ip: clientIp(await headers()) };
}

const runSchema = z.object({ mode: z.enum(['manual', 'dry_run'], { error: 'Unknown run type.' }) });

export async function runPipelineAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = runSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  const dryRun = parsed.data.mode === 'dry_run';
  try {
    const r = await getDb().transaction(async (tx) => {
      const res = await enqueueRun(tx, { kind: parsed.data.mode, dryRun, requestedBy: 'ui' });
      await audit(tx, { action: dryRun ? 'pipeline.dry_run_queued' : 'pipeline.run_queued', entityType: 'pipeline_run', entityId: res.runId, after: { created: res.created, dryRun }, ip });
      return res;
    });
    refresh();
    return done(r.created ? `${dryRun ? 'Dry run' : 'Run'} #${r.runId} queued — the worker picks it up within a minute.` : `An identical ${dryRun ? 'dry run' : 'run'} (#${r.runId}) is already queued.`);
  } catch (err) {
    if (err instanceof EnqueueRunError) return fail(err.message);
    log.error('system action: queue run failed', { err });
    return fail('Could not queue the run. Nothing was changed — try again.');
  }
}

const ackSchema = z.object({ alertId: idSchema });

export async function ackAlertAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  const { ip } = await actor();
  const parsed = ackSchema.safeParse(formObject(formData));
  if (!parsed.success) return fail(firstIssue(parsed.error));
  try {
    const changed = await getDb().transaction(async (tx) => {
      const [res] = await tx.update(alerts).set({ acknowledgedAt: new Date() }).where(and(eq(alerts.id, parsed.data.alertId), isNull(alerts.acknowledgedAt)));
      if (res.affectedRows === 0) return false;
      await audit(tx, { action: 'alert.acknowledge', entityType: 'alert', entityId: parsed.data.alertId, ip });
      return true;
    });
    refresh();
    return changed ? done('Alert acknowledged.') : fail('That alert was already acknowledged.');
  } catch (err) {
    log.error('system action: acknowledge failed', { err });
    return fail('Could not acknowledge the alert. Nothing was changed — try again.');
  }
}

export async function ackAllAlertsAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  void formData;
  const { ip } = await actor();
  try {
    const n = await getDb().transaction(async (tx) => {
      const [res] = await tx.update(alerts).set({ acknowledgedAt: new Date() }).where(isNull(alerts.acknowledgedAt));
      if (res.affectedRows > 0) await audit(tx, { action: 'alert.acknowledge_all', entityType: 'alert', after: { count: res.affectedRows }, ip });
      return res.affectedRows;
    });
    refresh();
    return n > 0 ? done(`${n} alert${n === 1 ? '' : 's'} acknowledged.`) : fail('There is nothing to acknowledge.');
  } catch (err) {
    log.error('system action: acknowledge all failed', { err });
    return fail('Could not acknowledge the alerts. Nothing was changed — try again.');
  }
}
