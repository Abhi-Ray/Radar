import type { ReactNode } from "react";
import { cn } from "./cn";

export interface SectionHeaderProps {
  title: ReactNode;
  /** Micro label above the title ("03 — Tracker"). */
  kicker?: ReactNode;
  /** One-line explanation under the title. */
  description?: ReactNode;
  /** Buttons / AsOf chip, right-aligned on desktop, wrapped below on mobile. */
  actions?: ReactNode;
  /** h1 = page title (mega), h2 = section, h3 = sub-section. */
  as?: "h1" | "h2" | "h3";
  /** Index block on the left ("04"). */
  index?: string;
  /** Thick rule under the header. Default true for h1. */
  rule?: boolean;
  id?: string;
  className?: string;
}

const TITLE: Record<NonNullable<SectionHeaderProps["as"]>, string> = {
  h1: "text-mega wide",
  h2: "text-3xl md:text-4xl wide",
  h3: "text-xl md:text-2xl",
};

/** Display heading + kicker + actions slot. Headings are huge on purpose. */
export function SectionHeader({ title, kicker, description, actions, as: H = "h2", index, rule, id, className }: SectionHeaderProps) {
  const showRule = rule ?? H === "h1";
  return (
    <header className={cn("flex flex-col gap-4 md:flex-row md:items-end md:justify-between", showRule && "border-b-3 border-ink pb-4", className)}>
      <div className="flex min-w-0 items-start gap-3 md:gap-4">
        {index ? (
          <span
            aria-hidden="true"
            className={cn(
              "headline shrink-0 bg-ink px-2 py-1 font-mono text-paper tabular",
              H === "h1" ? "text-2xl md:text-3xl" : "text-base md:text-lg",
            )}
          >
            {index}
          </span>
        ) : null}
        <div className="min-w-0">
          {kicker ? <p className="micro mb-2 text-muted">{kicker}</p> : null}
          <H id={id} className={cn("headline uppercase [overflow-wrap:anywhere]", TITLE[H])}>
            {title}
          </H>
          {description ? <p className="mt-2 max-w-prose text-sm text-ink-soft md:text-base">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">{actions}</div> : null}
    </header>
  );
}
