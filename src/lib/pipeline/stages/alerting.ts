/**
 * Alerts raised from inside a run. Never throws (an alert failure must not fail the run) and
 * records every attempt on the run context for the run report. A dry run stores nothing: the
 * alert is only listed in the would-change summary.
 */
import { raiseAlert, type RaiseAlertInput } from '../../alerts';
import type { RunContext } from './context';
import { errorText } from './dbutil';

export async function runAlert(ctx: RunContext, input: RaiseAlertInput, sourceId: number | null = null): Promise<number | null> {
  const record = { kind: input.kind, severity: input.severity, title: input.title, sourceId, alertId: null as number | null } as RunContext['alerts'][number];
  ctx.alerts.push(record);
  if (ctx.dryRun) return null;
  try {
    const res = await raiseAlert(ctx.db, input, { now: new Date(), channels: ctx.channels, linkPath: sourceId ? `/sources/${sourceId}` : '/system' });
    record.alertId = res.alertId;
    return res.alertId;
  } catch (err) {
    record.error = errorText(err, 300);
    ctx.log.error('raising alert failed', { kind: input.kind, error: record.error });
    return null;
  }
}
