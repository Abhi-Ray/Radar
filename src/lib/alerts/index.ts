// STUB(PIPELINE): raiseAlert is minimal but real (stores the alert; an unacknowledged alert with
// the same dedupe key is bumped instead of duplicated). Channel senders (Telegram/SMTP) are not
// wired yet: nothing is sent. Keep the exported signature.
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { alerts } from '../../db/schema';
import type { ALERT_SEVERITIES } from '../../db/schema/_enums';
import { withTransaction, type DbOrTx } from '../db';
import { redactString } from '../log';

export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export interface RaiseAlertInput {
  kind: string;
  severity: AlertSeverity;
  title: string;
  body?: string | null;
  dedupeKey?: string | null;
  entityType?: string | null;
  entityId?: string | number | null;
}

export async function raiseAlert(db: DbOrTx, input: RaiseAlertInput): Promise<{ alertId: number; created: boolean }> {
  const kind = input.kind.trim().slice(0, 64) || 'general';
  const title = redactString(input.title.trim()).slice(0, 255) || kind;
  const body = input.body ? redactString(input.body).slice(0, 16_000) : null;
  const dedupeKey = input.dedupeKey?.trim().slice(0, 191) || null;
  const entityId = input.entityId === null || input.entityId === undefined ? null : String(input.entityId).slice(0, 128);
  return withTransaction(db, async (tx) => {
    if (dedupeKey) {
      const [open] = await tx
        .select({ id: alerts.id })
        .from(alerts)
        .where(and(eq(alerts.dedupeKey, dedupeKey), isNull(alerts.acknowledgedAt)))
        .orderBy(desc(alerts.id))
        .limit(1)
        .for('update');
      if (open) {
        await tx
          .update(alerts)
          .set({ occurrences: sql`${alerts.occurrences} + 1`, lastRaisedAt: new Date(), severity: input.severity, title, body })
          .where(eq(alerts.id, open.id));
        return { alertId: open.id, created: false };
      }
    }
    const [res] = await tx.insert(alerts).values({
      kind,
      severity: input.severity,
      title,
      body,
      dedupeKey,
      entityType: input.entityType?.slice(0, 64) ?? null,
      entityId,
    });
    return { alertId: Number(res.insertId), created: true };
  });
}
