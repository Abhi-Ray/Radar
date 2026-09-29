import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { TONE_SOLID, type Tone } from "./status";

export interface StatBlockProps {
  label: ReactNode;
  value: ReactNode;
  /** Unit or small suffix next to the number ("%", "/day"). */
  unit?: ReactNode;
  /** Line under the value ("+12 since yesterday"). */
  detail?: ReactNode;
  tone?: Tone;
  href?: string;
  /**
   * Honest small-sample flag: hatches the block and prints the caveat
   * (default "Too few to conclude"). Use when n is below the threshold.
   */
  caveat?: boolean | string;
  /** Extra visual under the number (Sparkline, ProgressBlocks). */
  children?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

/** Big number tile. Counts, rates, budgets. */
export function StatBlock({ label, value, unit, detail, tone = "card", href, caveat, children, size = "md", className }: StatBlockProps) {
  const caveatText = caveat ? (typeof caveat === "string" ? caveat : "Too few to conclude") : null;
  const num = size === "lg" ? "text-6xl md:text-7xl" : size === "sm" ? "text-3xl" : "text-5xl";
  const body = (
    <>
      {caveatText ? <span aria-hidden="true" className="hatch-soft pointer-events-none absolute inset-0" /> : null}
      <span className="micro relative block">{label}</span>
      <span className="relative mt-2 flex items-baseline gap-1">
        <span className={cn("headline tabular", num, caveatText && "opacity-60")}>{value}</span>
        {unit ? <span className="font-mono text-sm font-bold">{unit}</span> : null}
      </span>
      {caveatText ? (
        <span className="relative mt-2 inline-block border-2 border-dashed border-ink bg-card px-1.5 py-0.5 font-mono text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-ink">
          {caveatText}
        </span>
      ) : null}
      {detail ? <span className="relative mt-1.5 block font-mono text-xs opacity-85">{detail}</span> : null}
      {children ? <span className="relative mt-3 block">{children}</span> : null}
    </>
  );
  const classes = cn(
    "relative block min-w-0 border-3 border-ink p-4 shadow-md",
    TONE_SOLID[tone],
    tone === "ink" && "on-ink",
    caveatText && "border-dashed",
    href && "no-underline lift",
    className,
  );
  return href ? (
    <Link href={href} className={classes}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  );
}
