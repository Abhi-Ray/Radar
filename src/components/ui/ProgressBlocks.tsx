import type { ReactNode } from "react";
import { cn } from "./cn";
import { blockFill } from "./geometry";
import { TONE_SOLID, type Tone } from "./status";

export interface ProgressBlocksProps {
  value: number;
  max: number;
  /** Number of cells. Default 10. */
  blocks?: number;
  /** Accessible name ("AI calls used today"). */
  label: string;
  tone?: Tone;
  /** Switch tone when value/max crosses these ratios (e.g. budgets: warn 0.8 → signal, 1 → stamp). */
  warnAt?: number;
  dangerAt?: number;
  /** Visible readout on the right ("37/50"). Default value/max; pass null to hide. */
  readout?: ReactNode | null;
  size?: "sm" | "md";
  className?: string;
}

/** Budget / quota bar made of blocks. The partial cell is hatched. */
export function ProgressBlocks({
  value,
  max,
  blocks = 10,
  label,
  tone = "radar",
  warnAt,
  dangerAt,
  readout,
  size = "md",
  className,
}: ProgressBlocksProps) {
  const ratio = max > 0 ? value / max : 0;
  const t: Tone = dangerAt !== undefined && ratio >= dangerAt ? "stamp" : warnAt !== undefined && ratio >= warnAt ? "signal" : tone;
  const cells = blockFill(value, max, blocks);
  const shown = readout === undefined ? `${value}/${max}` : readout;
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={Math.max(0, Math.min(value, max))}
        aria-valuetext={`${value} of ${max}`}
        className="flex min-w-0 flex-1 gap-[3px]"
      >
        {cells.map((c, i) => (
          <span
            key={i}
            className={cn(
              "min-w-1.5 flex-1 border-2 border-ink",
              size === "sm" ? "h-3" : "h-4",
              c === "full" && TONE_SOLID[t],
              c === "partial" && ["bg-card hatch-dense", t === "stamp" ? "hatch-ink-stamp-deep" : "hatch-ink-ink"],
              c === "empty" && "bg-card",
            )}
          />
        ))}
      </div>
      {shown !== null ? <span className="shrink-0 font-mono text-xs font-bold tabular">{shown}</span> : null}
    </div>
  );
}
