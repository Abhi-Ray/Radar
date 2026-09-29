import { cn } from "./cn";
import { CONFIDENCE_META, isConfidenceLevel, type ConfidenceLevel } from "./status";

export interface ConfidenceMeterProps {
  level: ConfidenceLevel | string | null | undefined;
  /** Show the word next to the blocks. Default true. */
  showLabel?: boolean;
  size?: "sm" | "md";
  /** Colour for dark surfaces. */
  onInk?: boolean;
  className?: string;
}

/**
 * ■■■ high (solid) · ■■□ medium (hatched) · ▢□□ low (dashed + LOW CONF tag) · □□□ none.
 * Always paired with a word, never colour/shape alone.
 */
export function ConfidenceMeter({ level, showLabel = true, size = "md", onInk, className }: ConfidenceMeterProps) {
  const lvl = isConfidenceLevel(level) ? level : null;
  const filled = lvl ? CONFIDENCE_META[lvl].blocks : 0;
  const block = size === "sm" ? "size-2.5" : "size-3.5";
  const ink = onInk ? "border-paper" : "border-ink";
  const fill = onInk ? "bg-paper" : "bg-ink";
  const text = lvl ? `Confidence: ${CONFIDENCE_META[lvl].label}` : "Confidence: not rated";

  return (
    <span className={cn("inline-flex items-center gap-2 align-middle", className)}>
      <span role="img" aria-label={text} className="inline-flex items-center gap-[3px]">
        {[0, 1, 2].map((i) => {
          const on = i < filled;
          return (
            <span
              key={i}
              className={cn(
                block,
                "border-2",
                ink,
                on && lvl === "high" && fill,
                on && lvl === "medium" && ["hatch-dense", onInk ? "hatch-ink-paper" : "hatch-ink-ink"],
                on && lvl === "low" && "border-dashed hatch-soft hatch-ink-ink",
                !on && (lvl === "low" ? "border-dashed opacity-60" : "opacity-45"),
              )}
            />
          );
        })}
      </span>
      {showLabel ? (
        lvl === "low" ? (
          <LowConfTag />
        ) : (
          <span aria-hidden="true" className={cn("font-mono text-[0.6875rem] font-bold uppercase tracking-[0.12em]", onInk ? "text-paper" : "text-ink")}>
            {lvl ? CONFIDENCE_META[lvl].label : "Not rated"}
          </span>
        )
      ) : null}
    </span>
  );
}

/** The dashed "LOW CONF" flag used wherever a low-confidence value is displayed. */
export function LowConfTag({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex items-center border-2 border-dashed border-ink bg-card px-1 py-px font-mono text-[0.625rem] font-bold uppercase leading-none tracking-[0.12em] text-ink",
        className,
      )}
    >
      Low conf
    </span>
  );
}

/** Surface classes that encode confidence on any box: solid / hatched / dashed. */
export function confidenceSurface(level: ConfidenceLevel | string | null | undefined): string {
  if (level === "high") return "border-3 border-ink";
  if (level === "medium") return "border-3 border-ink hatch-soft";
  return "border-2 border-dashed border-ink";
}
