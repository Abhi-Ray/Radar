import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { TONE_SOLID, type Tone } from "./status";

export interface EmptyStateProps {
  title: ReactNode;
  children?: ReactNode;
  icon?: IconName;
  /** Big stencilled code in the corner ("NO SIGNAL", "0 BLIPS", "404"). */
  code?: string;
  tone?: Tone;
  /** Buttons / links. */
  actions?: ReactNode;
  /** Small mono line at the bottom ("Filters: visa=confirmed · 12 hidden"). */
  note?: ReactNode;
  /** Heading level. Default h2. */
  as?: "h2" | "h3";
  size?: "sm" | "md" | "lg";
  className?: string;
}

/**
 * Empty isn't an error: say what's missing, why, and what to do next — in the field-manual voice.
 * <EmptyState icon="radar" code="0 BLIPS" title="Nothing on the scope" actions={<Button …/>}>…</EmptyState>
 */
export function EmptyState({
  title,
  children,
  icon = "radar",
  code,
  tone = "acid",
  actions,
  note,
  as: H = "h2",
  size = "md",
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "relative overflow-hidden border-3 border-dashed border-ink bg-card",
        size === "sm" ? "p-4" : size === "lg" ? "p-6 md:p-10" : "p-5 md:p-7",
        className,
      )}
    >
      <div aria-hidden="true" className="hatch-soft pointer-events-none absolute inset-0" />
      {code ? (
        <span
          aria-hidden="true"
          className="headline wider pointer-events-none absolute -right-2 -bottom-3 select-none whitespace-nowrap text-[clamp(3rem,10vw,6.5rem)] uppercase leading-none text-ink/[0.07]"
        >
          {code}
        </span>
      ) : null}
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-start">
        <span
          aria-hidden="true"
          className={cn(
            "flex shrink-0 items-center justify-center border-3 border-ink shadow-sm",
            size === "sm" ? "size-12" : "size-16",
            TONE_SOLID[tone],
          )}
        >
          <Icon name={icon} size={size === "sm" ? 24 : 32} />
        </span>
        <div className="min-w-0 flex-1">
          <H className={cn("headline wide uppercase", size === "sm" ? "text-lg" : size === "lg" ? "text-3xl md:text-4xl" : "text-2xl")}>
            {title}
          </H>
          {children ? <div className="mt-2 max-w-prose text-sm leading-relaxed text-ink-soft md:text-base">{children}</div> : null}
          {actions ? <div className="mt-4 flex flex-wrap gap-3">{actions}</div> : null}
          {note ? (
            <p className="mt-4 font-mono text-xs text-muted">
              {/* Solid backing so the note stays AA over the hatch and the stencilled code. */}
              <span className="bg-card box-decoration-clone px-1 py-0.5">{note}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
