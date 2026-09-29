import type { ReactNode } from "react";
import { cn } from "./cn";

export interface EstimateTagProps {
  /** The estimated value, already formatted ("€52k–€64k"). Omit for a bare EST. flag. */
  children?: ReactNode;
  /** What the estimate is based on ("DE · DevSecOps · mid · 2026 table"). Shown as a tooltip + read out. */
  basis?: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Estimates must never look like stated facts: italic, hatched, dashed edge, EST. flag.
 * <EstimateTag basis="NL · Cloud security · mid">€58k–€72k</EstimateTag>
 */
export function EstimateTag({ children, basis, size = "md", className }: EstimateTagProps) {
  const sz = size === "sm" ? "text-xs" : size === "lg" ? "text-xl md:text-2xl" : "text-sm";
  const title = basis ? `Estimate — based on ${basis}` : "Estimate — not stated in the posting";
  const srText = basis ? ` (estimate based on ${basis})` : " (estimate, not stated)";
  if (!children) {
    // Bare flag: a dashed, italic chip (an ink block inside a dashed edge reads as a smudge at 1x).
    return (
      <span
        title={title}
        className={cn(
          "inline-flex items-center border-2 border-dashed border-ink bg-card px-1 py-px align-middle font-mono text-[0.625rem] font-bold italic uppercase leading-none tracking-[0.12em] text-ink",
          className,
        )}
      >
        <span aria-hidden="true">Est.</span>
        <span className="sr-only">{srText}</span>
      </span>
    );
  }
  return (
    <span title={title} className={cn("inline-flex max-w-full items-stretch border-2 border-dashed border-ink align-middle", className)}>
      <span
        aria-hidden="true"
        className="flex items-center bg-ink px-1 font-mono text-[0.625rem] font-bold not-italic uppercase leading-none tracking-[0.12em] text-paper"
      >
        Est.
      </span>
      <span className={cn("hatch-soft hatch-ink-ink flex items-center bg-card px-1.5 py-0.5 font-mono font-bold italic tabular text-ink", sz)}>
        {children}
      </span>
      <span className="sr-only">{srText}</span>
    </span>
  );
}
