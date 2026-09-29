"use client";

import { cloneElement, isValidElement, useId, useState, type ReactElement, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link). */
  children: ReactElement<{ "aria-describedby"?: string }>;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * Hover/focus tooltip. The text is always in the DOM and wired via aria-describedby, so screen
 * readers get it without hovering. Esc hides it (WCAG 1.4.13).
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const trigger = isValidElement(children)
    ? cloneElement(children, {
        "aria-describedby": [children.props["aria-describedby"], id].filter(Boolean).join(" "),
      })
    : children;

  return (
    <span
      className={cn("relative inline-flex", className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
      onClick={() => setOpen(true)}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      {trigger}
      <span
        role="tooltip"
        id={id}
        className={cn(
          "pointer-events-none absolute left-1/2 z-40 w-max max-w-[16rem] -translate-x-1/2 border-2 border-ink bg-ink px-2 py-1.5 text-left font-mono text-xs leading-snug text-paper shadow-sm",
          side === "top" ? "bottom-[calc(100%+8px)]" : "top-[calc(100%+8px)]",
          open ? "block animate-pop" : "hidden",
        )}
      >
        {content}
      </span>
    </span>
  );
}

/** Small ⓘ button with a tooltip — for method/threshold explanations next to labels. Tap opens it on touch. */
export function InfoTip({ content, label = "What does this mean?", side = "top" }: { content: ReactNode; label?: string; side?: "top" | "bottom" }) {
  return (
    <Tooltip content={content} side={side}>
      <button
        type="button"
        aria-label={label}
        className="inline-flex size-6 items-center justify-center border-2 border-ink bg-card align-middle hover:bg-acid pointer-coarse:size-8"
      >
        <Icon name="info" size={14} />
      </button>
    </Tooltip>
  );
}
