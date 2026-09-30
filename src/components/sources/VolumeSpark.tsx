import { cn } from "@/components/ui/cn";
import { TONE_FILL, type Tone } from "@/components/ui/status";
import { volumeBars, volumeSummary, type VolumeBarKind, type VolumePoint } from "./spark";

const KIND_TONE: Record<VolumeBarKind, Tone> = { ok: "radar", low: "signal", high: "cobalt", failed: "stamp", empty: "concrete" };

/** Postings fetched per run, oldest → newest, over the shaded "normal" band. Server-safe SVG. */
export function VolumeSpark({
  points,
  baseline,
  width = 112,
  height = 30,
  className,
}: {
  points: readonly VolumePoint[];
  baseline?: { low: number | null; high: number | null } | null;
  width?: number;
  height?: number;
  className?: string;
}) {
  const g = volumeBars(points, width, height, baseline);
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={volumeSummary(points, baseline)} className={cn("block max-w-full", className)}>
      {g.band ? <rect x={0} y={g.band.y} width={width} height={g.band.height} className="fill-ink" fillOpacity={0.12} /> : null}
      {g.bars.map((b, i) => (
        <rect key={i} x={b.x} y={b.y} width={b.width} height={b.height} className={cn(TONE_FILL[KIND_TONE[b.kind]], "stroke-ink")} strokeWidth={b.width > 4 ? 1 : 0} />
      ))}
      <line x1={0} y1={height - 1} x2={width} y2={height - 1} className="stroke-ink" strokeWidth={2} />
      {g.bars.length === 0 ? (
        <text x={width / 2} y={height / 2} textAnchor="middle" dominantBaseline="central" className="fill-muted font-mono" fontSize={9}>
          no runs
        </text>
      ) : null}
    </svg>
  );
}
