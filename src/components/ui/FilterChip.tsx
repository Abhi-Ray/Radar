import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export interface FilterChipProps {
  /** Link that toggles this filter (build it with hrefToggle / hrefWith). */
  href: string;
  active?: boolean;
  /** Count shown in the chip ("12"). */
  count?: number | null;
  /** Active chips show a × and read "Remove filter: …". */
  removable?: boolean;
  children: ReactNode;
  className?: string;
}

/** URL-driven filter chip. Works without JavaScript; state lives in the query string. */
export function FilterChip({ href, active, count, removable = true, children, className }: FilterChipProps) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 border-2 border-ink px-2.5 text-sm font-bold no-underline pointer-coarse:min-h-11",
        active ? "bg-ink text-paper shadow-none on-ink" : "bg-card text-ink shadow-xs hover:bg-acid-tint",
        "active:translate-x-px active:translate-y-px active:shadow-none",
        className,
      )}
    >
      {active && removable ? <span className="sr-only">Remove filter: </span> : active ? null : <span className="sr-only">Filter: </span>}
      <span className="truncate">{children}</span>
      {typeof count === "number" ? (
        <span className={cn("font-mono text-xs tabular", active ? "text-acid" : "text-muted")}>{count}</span>
      ) : null}
      {active && removable ? <Icon name="close" size={14} /> : null}
    </Link>
  );
}

/** Horizontal, wrap-on-desktop / scroll-on-mobile row of chips with a label. */
export function FilterChipRow({ label, children, className }: { label: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex min-w-0 items-center gap-2", className)}>
      <span className="micro shrink-0 text-muted">{label}</span>
      <div className="no-scrollbar -my-1 flex min-w-0 gap-2 overflow-x-auto py-1 pr-1 md:flex-wrap md:overflow-visible">{children}</div>
    </div>
  );
}
