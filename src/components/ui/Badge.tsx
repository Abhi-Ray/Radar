import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";
import { TONE_BORDER, TONE_SOLID, TONE_TEXT, TONE_TINT, type Tone } from "./status";

export interface BadgeProps {
  tone?: Tone;
  /** solid = full colour, tint = pale fill, outline = border only. */
  variant?: "solid" | "tint" | "outline";
  size?: "sm" | "md";
  icon?: IconName;
  /** Accessible expansion for short badges ("3" → "3 open review items"). */
  srLabel?: string;
  className?: string;
  children: ReactNode;
}

/** Small square chip: counts, states, tags. */
export function Badge({ tone = "ink", variant = "solid", size = "sm", icon, srLabel, className, children }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-chip border-2 font-mono font-bold uppercase tabular leading-none",
        size === "sm" ? "min-h-5 px-1.5 text-[0.6875rem]" : "min-h-7 px-2 text-xs",
        variant === "solid" && [TONE_SOLID[tone], "border-ink"],
        variant === "tint" && [TONE_TINT[tone], "border-ink"],
        variant === "outline" && ["bg-transparent", TONE_TEXT[tone], TONE_BORDER[tone]],
        className,
      )}
    >
      {icon ? <Icon name={icon} size={size === "sm" ? 12 : 14} /> : null}
      <span aria-hidden={srLabel ? true : undefined} className="truncate">
        {children}
      </span>
      {srLabel ? <span className="sr-only">{srLabel}</span> : null}
    </span>
  );
}
