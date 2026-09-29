import type { ReactNode } from "react";
import { cn } from "./cn";
import { pickVariant } from "./geometry";
import { Icon, type IconName } from "./icons";
import { TONE_SOLID, type Tone } from "./status";

const TILTS = ["-rotate-3", "-rotate-2", "-rotate-1", "rotate-1", "rotate-2", "rotate-3"] as const;

export interface StickerProps {
  tone?: Tone;
  /** "auto" picks a stable tilt from the text; "none" keeps it straight. */
  tilt?: "auto" | "none" | "left" | "right";
  size?: "sm" | "md" | "lg";
  icon?: IconName;
  className?: string;
  children: ReactNode;
  /** Seed for the auto tilt when children aren't plain text. */
  seed?: string;
}

/**
 * Die-cut label slapped on things: NEW, GHOST RISK, STRETCH, AGENCY, SPECIMEN.
 * White cut-line around a colour block, ink outline, small hard shadow.
 */
export function Sticker({ tone = "acid", tilt = "auto", size = "md", icon, className, children, seed }: StickerProps) {
  const key = seed ?? (typeof children === "string" ? children : String(tone));
  const tiltClass =
    tilt === "none" ? "" : tilt === "left" ? "-rotate-3" : tilt === "right" ? "rotate-2" : TILTS[pickVariant(key, TILTS.length)];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 border-2 border-ink font-sans font-black uppercase leading-none tracking-[0.08em]",
        "shadow-[0_0_0_2px_var(--color-white),3px_3px_0_2px_var(--color-ink)]",
        size === "sm" && "px-1.5 py-1 text-[0.625rem]",
        size === "md" && "px-2 py-1.5 text-xs",
        size === "lg" && "px-3 py-2 text-sm",
        TONE_SOLID[tone],
        tiltClass,
        className,
      )}
    >
      {icon ? <Icon name={icon} size={size === "lg" ? 16 : 12} /> : null}
      {children}
    </span>
  );
}
