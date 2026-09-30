/**
 * Geometry for the blocky "volume vs baseline" sparkline on /sources (pure, client-safe).
 * One bar per source run (oldest → newest); the baseline band (volume_min … volume_max) is drawn
 * behind the bars. Bars outside the band and failed runs get their own kind so they stand out.
 */

export interface VolumePoint {
  /** Postings fetched in that run (null = run did not report a count). */
  value: number | null;
  failed?: boolean;
}

export type VolumeBarKind = "ok" | "low" | "high" | "failed" | "empty";

export interface VolumeBar {
  x: number;
  y: number;
  width: number;
  height: number;
  kind: VolumeBarKind;
  value: number | null;
}

export interface VolumeSparkGeometry {
  bars: VolumeBar[];
  /** Baseline band rectangle (null without a baseline). */
  band: { y: number; height: number } | null;
  max: number;
}

const r = (n: number) => Math.round(n * 100) / 100;

export function volumeBars(
  points: readonly VolumePoint[],
  width: number,
  height: number,
  baseline?: { low: number | null; high: number | null } | null,
  gap = 2,
): VolumeSparkGeometry {
  const values = points.map((p) => (p.value !== null && Number.isFinite(p.value) ? Math.max(0, p.value) : null));
  const low = baseline && baseline.low !== null && Number.isFinite(baseline.low) ? Math.max(0, baseline.low) : null;
  const high = baseline && baseline.high !== null && Number.isFinite(baseline.high) ? Math.max(0, baseline.high) : null;
  const max = Math.max(1, ...values.map((v) => v ?? 0), high ?? 0, low ?? 0);
  const n = points.length;
  const usable = height - 2; // leave room for the 2px floor line
  const yFor = (v: number) => r(usable - (v / max) * usable);
  const band = low !== null && high !== null && high >= low ? { y: yFor(high), height: r(Math.max(1, yFor(low) - yFor(high))) } : null;
  if (n === 0) return { bars: [], band, max };
  const slot = width / n;
  const barWidth = Math.max(1, slot - gap);
  const bars = points.map((p, i): VolumeBar => {
    const v = values[i];
    const x = r(i * slot + (slot - barWidth) / 2);
    if (v === null) return { x, y: usable - 1.5, width: r(barWidth), height: 1.5, kind: p.failed ? "failed" : "empty", value: null };
    const h = Math.max(v > 0 ? 2 : 1.5, r((v / max) * usable));
    let kind: VolumeBarKind = "ok";
    if (p.failed) kind = "failed";
    else if (low !== null && v < low) kind = "low";
    else if (high !== null && v > high) kind = "high";
    return { x, y: r(usable - h), width: r(barWidth), height: h, kind, value: v };
  });
  return { bars, band, max };
}

/** Screen-reader summary: "Fetched per run, last 8 runs: 40 → 52; normal range 38–60; 1 failed." */
export function volumeSummary(points: readonly VolumePoint[], baseline?: { low: number | null; high: number | null } | null): string {
  if (points.length === 0) return "No runs yet.";
  const vals = points.map((p) => p.value).filter((v): v is number => v !== null);
  const failed = points.filter((p) => p.failed).length;
  const parts = [`Fetched per run, last ${points.length} run${points.length === 1 ? "" : "s"}`];
  if (vals.length) parts[0] += `: ${vals[0]} → ${vals[vals.length - 1]}`;
  if (baseline && baseline.low !== null && baseline.high !== null) parts.push(`normal range ${baseline.low}–${baseline.high}`);
  if (failed) parts.push(`${failed} failed`);
  return `${parts.join("; ")}.`;
}
