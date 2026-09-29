import { cn } from "./cn";
import { annularSectorPath } from "./geometry";
import { TONE_FILL, TONE_SOLID, clampScore, fitBand } from "./status";

export interface FitGaugeProps {
  score: number | null | undefined;
  /** dial = chunky half-dial with 10 segments; block = big numeral + 10 blocks; inline = compact chip. */
  variant?: "dial" | "block" | "inline";
  size?: "sm" | "md" | "lg";
  /** Visible caption under the number. Default: the band label ("Strong fit"). */
  caption?: string;
  className?: string;
}

const SEGMENTS = 10;
const START = -120;
const END = 120;

/** Chunky 0–100 fit score. Unscored is shown as "—", never as 0. */
export function FitGauge({ score, variant = "dial", size = "md", caption, className }: FitGaugeProps) {
  const band = fitBand(score);
  const value = band.band === "none" ? null : clampScore(score as number);
  const lit = value === null ? 0 : Math.round((value / 100) * SEGMENTS);
  const label = caption ?? band.label;
  const meter = {
    role: "meter" as const,
    "aria-valuemin": 0,
    "aria-valuemax": 100,
    "aria-valuenow": value ?? undefined,
    "aria-valuetext": value === null ? "Not scored yet" : `${value} out of 100, ${band.label}`,
    "aria-label": "Fit score",
  };

  if (variant === "inline") {
    return (
      <span
        {...meter}
        className={cn(
          "inline-flex min-h-7 items-stretch border-2 border-ink font-mono text-xs font-bold tabular leading-none",
          value === null && "border-dashed",
          className,
        )}
      >
        <span className="flex items-center bg-ink px-1.5 text-[0.625rem] uppercase tracking-[0.1em] text-paper">Fit</span>
        <span className={cn("flex min-w-9 items-center justify-center px-1.5 text-sm", TONE_SOLID[band.tone])}>
          {value ?? "—"}
        </span>
      </span>
    );
  }

  if (variant === "block") {
    const num = size === "lg" ? "text-7xl md:text-8xl" : size === "sm" ? "text-4xl" : "text-6xl";
    return (
      <div {...meter} className={cn("inline-flex flex-col gap-2", className)}>
        <div className="flex items-end gap-2">
          <span className={cn("headline tabular", num)}>{value ?? "—"}</span>
          <span className="mb-1 font-mono text-xs font-bold text-muted">/100</span>
        </div>
        <div aria-hidden="true" className="flex gap-[3px]">
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span
              key={i}
              className={cn(
                "h-3 flex-1 border-2 border-ink",
                size === "sm" ? "min-w-2" : "min-w-3",
                i < lit ? TONE_SOLID[band.tone] : "bg-card",
                value === null && "border-dashed",
              )}
            />
          ))}
        </div>
        <span className="micro">{label}</span>
      </div>
    );
  }

  const px = size === "lg" ? "w-48" : size === "sm" ? "w-24" : "w-36";
  const numSize = size === "lg" ? "text-6xl" : size === "sm" ? "text-2xl" : "text-4xl";
  const step = (END - START) / SEGMENTS;

  return (
    <div {...meter} className={cn("relative inline-flex flex-col items-center", px, className)}>
      <svg viewBox="0 0 100 78" className="w-full overflow-visible" aria-hidden="true">
        {Array.from({ length: SEGMENTS }, (_, i) => {
          const a0 = START + i * step + 1.6;
          const a1 = START + (i + 1) * step - 1.6;
          return (
            <path
              key={i}
              d={annularSectorPath(50, 52, 47, 34, a0, a1)}
              className={cn("stroke-ink", i < lit ? TONE_FILL[band.tone] : "fill-card")}
              strokeWidth={2.5}
              strokeLinejoin="miter"
              strokeDasharray={value === null ? "3 2" : undefined}
            />
          );
        })}
      </svg>
      <div className="absolute inset-x-0 top-[34%] flex flex-col items-center">
        <span className={cn("headline tabular leading-none", numSize)}>{value ?? "—"}</span>
        {size !== "sm" ? <span className="micro mt-1">{label}</span> : null}
      </div>
    </div>
  );
}
