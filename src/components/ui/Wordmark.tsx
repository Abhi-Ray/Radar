import { cn } from "./cn";

export interface WordmarkProps {
  /** "fit" scales with the nearest `@container` (falls back to the viewport width). */
  size?: "sm" | "md" | "lg" | "xl" | "fit";
  /** Light text for ink surfaces. */
  onInk?: boolean;
  /** Show the "Field Station" tag. */
  tagline?: boolean;
  className?: string;
}

const TEXT = {
  sm: "text-xl",
  md: "text-3xl",
  lg: "text-5xl md:text-6xl",
  xl: "text-giga",
  // The logotype is ~4.9em wide; 19cqi keeps it inside its container at any width.
  fit: "text-[clamp(2.75rem,19cqi,11rem)]",
} as const;

/** RADAR logotype: expanded Archivo Black with the "D" sitting in an acid block like a target lock. */
export function Wordmark({ size = "md", onInk, tagline, className }: WordmarkProps) {
  return (
    <span className={cn("inline-flex flex-col", className)}>
      <span className={cn("headline wider flex items-baseline uppercase leading-[0.8]", TEXT[size], onInk ? "text-paper" : "text-ink")} aria-label="RADAR" role="img">
        <span aria-hidden="true">RA</span>
        <span aria-hidden="true" className="mx-[0.04em] bg-acid px-[0.06em] text-ink ring-3 ring-ink">
          D
        </span>
        <span aria-hidden="true">AR</span>
      </span>
      {tagline ? (
        <span className={cn("micro mt-2", onInk ? "text-acid" : "text-muted")}>Field Station · Job Radar</span>
      ) : null}
    </span>
  );
}
