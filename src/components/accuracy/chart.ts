/**
 * Geometry for the accuracy trend chart (pure, client-safe): one stepped-corner polyline per
 * field over the accuracy runs, y = correct rate 0–100 %. Missing values break the line instead
 * of being drawn as zero.
 */

export interface TrendSeries {
  key: string;
  label: string;
  /** One value per run (oldest → newest), ratio 0..1 or null when the run did not measure it. */
  values: readonly (number | null)[];
}

export interface ChartPoint {
  x: number;
  y: number;
  value: number;
  index: number;
}

export interface TrendPath {
  key: string;
  label: string;
  d: string;
  points: ChartPoint[];
}

export interface TrendGeometry {
  width: number;
  height: number;
  plot: { left: number; top: number; right: number; bottom: number };
  paths: TrendPath[];
  /** Horizontal gridlines (0 %, 25 %, …). */
  grid: { y: number; label: string }[];
  /** X position of each run index. */
  xs: number[];
}

const r = (n: number) => Math.round(n * 100) / 100;

export function trendChart(
  series: readonly TrendSeries[],
  runCount: number,
  width: number,
  height: number,
  pad = { left: 34, right: 10, top: 10, bottom: 18 },
): TrendGeometry {
  const plot = { left: pad.left, top: pad.top, right: width - pad.right, bottom: height - pad.bottom };
  const w = Math.max(1, plot.right - plot.left);
  const h = Math.max(1, plot.bottom - plot.top);
  const xs = Array.from({ length: runCount }, (_, i) => r(runCount <= 1 ? plot.left + w / 2 : plot.left + (i / (runCount - 1)) * w));
  const yFor = (v: number) => r(plot.bottom - Math.max(0, Math.min(1, v)) * h);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => ({ y: yFor(v), label: `${Math.round(v * 100)}%` }));
  const paths = series.map((s): TrendPath => {
    const points: ChartPoint[] = [];
    let d = "";
    let pen = false;
    for (let i = 0; i < runCount; i++) {
      const v = s.values[i];
      if (v === null || v === undefined || !Number.isFinite(v)) {
        pen = false;
        continue;
      }
      const p = { x: xs[i] ?? plot.left, y: yFor(v), value: v, index: i };
      points.push(p);
      d += `${pen ? "L" : "M"}${p.x} ${p.y} `;
      pen = true;
    }
    return { key: s.key, label: s.label, d: d.trim(), points };
  });
  return { width, height, plot, paths, grid, xs };
}

/** "Role key 92% → 95%" style summary for screen readers. */
export function trendSummary(series: readonly TrendSeries[]): string {
  const parts: string[] = [];
  for (const s of series) {
    const vals = s.values.filter((v): v is number => v !== null && Number.isFinite(v));
    if (vals.length === 0) continue;
    const first = Math.round(vals[0]! * 100);
    const last = Math.round(vals[vals.length - 1]! * 100);
    parts.push(vals.length === 1 ? `${s.label} ${last}%` : `${s.label} ${first}% → ${last}%`);
  }
  return parts.length ? `Correct rate per field over the runs: ${parts.join("; ")}.` : "No accuracy runs with measured fields yet.";
}
