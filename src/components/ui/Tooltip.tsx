"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export interface TooltipProps {
  content: ReactNode;
  /** A single focusable element (button, link) — it must be the first element inside. */
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
}

/**
 * Hover/focus tooltip. The text is always in the DOM and wired to the trigger via
 * aria-describedby, so screen readers get it without hovering. Esc hides it (WCAG 1.4.13).
 *
 * The describedby link is added to the trigger's DOM node after mount rather than with
 * cloneElement: triggers written in Server Components can reach this component as lazy
 * elements during SSR (not cloneable) but as plain elements on the client, and cloning only
 * one side causes a hydration mismatch. Any aria-describedby the trigger already has is kept.
 */
export function Tooltip({ content, children, side = "top", className }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const trigger = wrapRef.current?.firstElementChild;
    if (!trigger || trigger.id === id) return;
    const tokens = (el: Element) => (el.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
    const current = tokens(trigger);
    if (!current.includes(id)) trigger.setAttribute("aria-describedby", [...current, id].join(" "));
    return () => {
      const rest = tokens(trigger).filter((t) => t !== id);
      if (rest.length) trigger.setAttribute("aria-describedby", rest.join(" "));
      else trigger.removeAttribute("aria-describedby");
    };
  }, [id]);

  return (
    <span
      ref={wrapRef}
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
      {children}
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
