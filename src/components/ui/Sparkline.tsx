import { cn } from "./cn";
import { barRects, sparkline } from "./geometry";
import { TONE_FILL, TONE_STROKE, type Tone } from "./status";

export interface SparklineProps {
  values: readonly (number | null | undefined)[];
  /** Accessible summary ("Jobs per run, last 14 runs: 212 → 248"). */
  label: string;
  width?: number;
  height?: number;
  tone?: Tone;
  /** Hatched "normal range" band (e.g. ±30% of the 7-day median). */
  band?: { low: number; high: number };
  /** Mark the last point with a square. Default true. */
  markLast?: boolean;
  className?: string;
}

/** Hand-drawn sparkline: square joins, a hatched normal band, last point stamped. */
export function Sparkline({ values, label, width = 120, height = 32, tone = "ink", band, markLast = true, className }: SparklineProps) {
  const include = band ? [band.low, band.high] : [];
  const g = sparkline(values, width, height, 3, include);
  const last = g.points[g.points.length - 1];
  const patternId = `spark-band-${width}-${height}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className={cn("block max-w-full overflow-visible", className)}>
      {band ? (
        <>
          <defs>
            <pattern id={patternId} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="1.5" height="5" className="fill-ink" fillOpacity={0.22} />
            </pattern>
          </defs>
          <rect
            x={0}
            y={g.yFor(band.high)}
            width={width}
            height={Math.max(1, g.yFor(band.low) - g.yFor(band.high))}
            fill={`url(#${patternId})`}
            className="stroke-ink"
            strokeOpacity={0.35}
            strokeDasharray="2 2"
            strokeWidth={1}
          />
        </>
      ) : null}
      {g.d ? <path d={g.d} fill="none" className={TONE_STROKE[tone === "ink" ? "ink" : tone]} strokeWidth={2.25} strokeLinejoin="miter" strokeLinecap="square" /> : null}
      {markLast && last ? <rect x={last.x - 3} y={last.y - 3} width={6} height={6} className={cn(TONE_FILL[tone === "ink" ? "acid" : tone], "stroke-ink")} strokeWidth={1.5} /> : null}
      {!g.d ? (
        <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="central" className="fill-muted font-mono" fontSize={9}>
          no data
        </text>
      ) : null}
    </svg>
  );
}

export interface MiniBarsProps {
  values: readonly number[];
  label: string;
  width?: number;
  height?: number;
  tone?: Tone;
  /** Highlight the last bar (today). Default true. */
  highlightLast?: boolean;
  /** Draw a dashed limit line (e.g. daily AI budget). */
  limit?: number;
  className?: string;
}

/** Tiny bar chart (per-day counts). Bars have ink outlines; zero days show a baseline tick. */
export function MiniBars({ values, label, width = 120, height = 32, tone = "radar", highlightLast = true, limit, className }: MiniBarsProps) {
  const maxValue = limit !== undefined ? Math.max(limit, ...values.filter(Number.isFinite)) : undefined;
  const bars = barRects(values, width, height - 2, 2, maxValue);
  const limitY = limit !== undefined && maxValue ? (height - 2) - (limit / maxValue) * (height - 2) : null;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className={cn("block max-w-full", className)}>
      {bars.map((b, i) => {
        const isLast = highlightLast && i === bars.length - 1;
        return b.height > 0 ? (
          <rect
            key={i}
            x={b.x}
            y={b.y}
            width={b.width}
            height={b.height}
            className={cn(isLast ? "fill-acid" : TONE_FILL[tone], "stroke-ink")}
            strokeWidth={b.width > 4 ? 1.25 : 0}
          />
        ) : (
          <rect key={i} x={b.x} y={height - 3} width={b.width} height={1.5} className="fill-ink" fillOpacity={0.35} />
        );
      })}
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} className="stroke-ink" strokeWidth={2} />
      {limitY !== null ? (
        <line x1={0} y1={limitY} x2={width} y2={limitY} className="stroke-stamp-deep" strokeWidth={1.5} strokeDasharray="3 2" />
      ) : null}
    </svg>
  );
}
