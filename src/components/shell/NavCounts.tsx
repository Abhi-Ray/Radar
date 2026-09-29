import "server-only";

import { and, count, eq, isNull } from "drizzle-orm";
import { cache } from "react";
import { Badge } from "@/components/ui/Badge";
import { alerts, deadLetters, duplicateCandidates, jobs, titleReviewQueue } from "@/db/schema";
import { getDb } from "@/lib/db";
import { log } from "@/lib/log";
import type { NavCountKind } from "./nav";

export interface NavCountsData {
  /** Open duplicate pairs + unmapped titles + open dead letters + jobs flagged needs_review. */
  review: number;
  /** Unacknowledged alerts. */
  alerts: number;
  /** Unacknowledged critical alerts (tints the badge red). */
  critical: number;
}

const ZERO: NavCountsData = { review: 0, alerts: 0, critical: 0 };

/**
 * Cheap COUNT(*) queries for the nav badges, de-duplicated per request with React cache().
 * Never throws: a broken/unreachable DB renders zero badges instead of taking the shell down.
 */
export const getNavCounts = cache(async (): Promise<NavCountsData> => {
  try {
    const db = getDb();
    const [dup, titles, dead, flagged, open, critical] = await Promise.all([
      db.select({ n: count() }).from(duplicateCandidates).where(eq(duplicateCandidates.status, "open")),
      db.select({ n: count() }).from(titleReviewQueue).where(eq(titleReviewQueue.status, "open")),
      db.select({ n: count() }).from(deadLetters).where(eq(deadLetters.status, "open")),
      db.select({ n: count() }).from(jobs).where(eq(jobs.needsReview, true)),
      db.select({ n: count() }).from(alerts).where(isNull(alerts.acknowledgedAt)),
      db
        .select({ n: count() })
        .from(alerts)
        .where(and(isNull(alerts.acknowledgedAt), eq(alerts.severity, "critical"))),
    ]);
    const n = (rows: { n: number }[]) => Number(rows[0]?.n ?? 0);
    return {
      review: n(dup) + n(titles) + n(dead) + n(flagged),
      alerts: n(open),
      critical: n(critical),
    };
  } catch (err) {
    log.warn("nav counts unavailable", { error: err instanceof Error ? err.message : String(err) });
    return ZERO;
  }
});

const SR: Record<NavCountKind, (n: number) => string> = {
  review: (n) => `${n} ${n === 1 ? "item needs" : "items need"} review`,
  alerts: (n) => `${n} open ${n === 1 ? "alert" : "alerts"}`,
};

/** Async badge; render inside <Suspense fallback={null}> so the shell never waits on the DB. */
export async function NavCount({ kind, variant = "rail" }: { kind: NavCountKind; variant?: "rail" | "tab" | "sheet" }) {
  const counts = await getNavCounts();
  const value = counts[kind];
  if (!value) return null;
  const tone = kind === "alerts" && counts.critical > 0 ? "stamp" : "signal";
  return (
    <Badge
      tone={tone}
      size={variant === "tab" ? "sm" : "md"}
      srLabel={SR[kind](value)}
      className={variant === "tab" ? "min-w-5 justify-center px-1" : undefined}
    >
      {value > 99 ? "99+" : value}
    </Badge>
  );
}
