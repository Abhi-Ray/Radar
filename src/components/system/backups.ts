/**
 * Backup freshness (pure, client-safe). A nightly backup is expected; the last good one older than
 * 26 hours (a day plus slack for a late cron) is stale. Restore tests are tracked separately.
 */

export const BACKUP_STALE_HOURS = 26;
/** A restore test older than this should be repeated (RECOVERY.md: monthly). */
export const RESTORE_TEST_STALE_DAYS = 35;

export interface BackupRowLike {
  kind: "backup" | "restore_test";
  status: "running" | "ok" | "failed";
  startedAt: Date;
  finishedAt: Date | null;
  sizeBytes: number | null;
  sha256: string | null;
}

export type BackupVerdict = "ok" | "stale" | "failed" | "none";

export interface BackupState {
  verdict: BackupVerdict;
  /** Newest successful backup. */
  lastOk: BackupRowLike | null;
  /** Newest backup attempt of any status. */
  latest: BackupRowLike | null;
  ageHours: number | null;
  lastRestoreTest: BackupRowLike | null;
  restoreTestDue: boolean;
  message: string;
}

const HOUR = 3_600_000;

function at(r: BackupRowLike): number {
  return (r.finishedAt ?? r.startedAt).getTime();
}

export function backupState(rows: readonly BackupRowLike[], now: Date, staleHours = BACKUP_STALE_HOURS): BackupState {
  const backups = rows.filter((r) => r.kind === "backup").sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const tests = rows.filter((r) => r.kind === "restore_test" && r.status === "ok").sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
  const latest = backups[0] ?? null;
  const lastOk = backups.find((r) => r.status === "ok") ?? null;
  const lastRestoreTest = tests[0] ?? null;
  const restoreTestDue = !lastRestoreTest || now.getTime() - at(lastRestoreTest) > RESTORE_TEST_STALE_DAYS * 24 * HOUR;
  const ageHours = lastOk ? Math.max(0, (now.getTime() - at(lastOk)) / HOUR) : null;

  let verdict: BackupVerdict;
  let message: string;
  if (!latest) {
    verdict = "none";
    message = "No backup has run yet.";
  } else if (latest.status === "failed") {
    verdict = "failed";
    message = lastOk ? `The last backup failed; the last good one is ${Math.round(ageHours ?? 0)} h old.` : "The last backup failed and there is no good one.";
  } else if (!lastOk || (ageHours !== null && ageHours > staleHours)) {
    verdict = "stale";
    message = lastOk ? `The last good backup is ${Math.round(ageHours ?? 0)} h old (limit ${staleHours} h).` : "No backup has finished successfully yet.";
  } else {
    verdict = "ok";
    message = `Last good backup ${Math.round(ageHours ?? 0)} h ago.`;
  }
  return { verdict, lastOk, latest, ageHours, lastRestoreTest, restoreTestDue, message };
}

/** 1536 → "1.5 KB"; null → "—". */
export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${i === 0 ? v : v.toFixed(v >= 10 ? 0 : 1)} ${units[i]}`;
}
