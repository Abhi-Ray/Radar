/**
 * Append-only audit trail (settings, visa rules, overrides, merges, auth events, pipeline actions).
 * An audit failure is a real failure: callers run it inside their transaction so the change and its
 * audit row land together (or not at all). Values are passed through the log redactor first.
 */
import { auditLog } from '../db/schema';
import type { DbOrTx } from './db';
import { redact } from './log';

export interface AuditInput {
  action: string;
  entityType: string;
  entityId?: string | number | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  actor?: 'admin' | 'system' | 'worker' | 'anonymous' | 'cli';
  ip?: string | null;
}

const MAX_REASON = 4000;

function jsonOrNull(v: unknown): unknown {
  if (v === undefined) return null;
  // Secrets never land in the audit log either.
  return redact(v);
}

export async function audit(db: DbOrTx, input: AuditInput): Promise<void> {
  await db.insert(auditLog).values({
    actor: input.actor ?? 'admin',
    action: input.action.slice(0, 96),
    entityType: input.entityType.slice(0, 64),
    entityId: input.entityId === null || input.entityId === undefined ? null : String(input.entityId).slice(0, 128),
    beforeJson: jsonOrNull(input.before),
    afterJson: jsonOrNull(input.after),
    // TEXT holds 64 KiB; a reason is a human sentence, so cap it well below that.
    reason: input.reason == null ? null : input.reason.slice(0, MAX_REASON),
    ip: input.ip == null ? null : input.ip.slice(0, 64),
  });
}
