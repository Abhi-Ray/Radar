import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "./cn";

export interface LinkTab {
  href: string;
  label: ReactNode;
  count?: number | null;
  active?: boolean;
}

export interface LinkTabsProps {
  tabs: LinkTab[];
  /** Accessible name for the tab row ("System sections"). */
  label: string;
  className?: string;
}

/** Shared visual for both tab variants. */
export function tabClasses(active: boolean): string {
  return cn(
    "relative inline-flex min-h-11 shrink-0 items-center gap-2 border-3 border-ink px-3 text-sm font-extrabold uppercase tracking-[0.05em] no-underline focus-visible:-outline-offset-[7px] md:px-4",
    active ? "bg-ink text-paper on-ink" : "bg-card text-ink shadow-xs hover:bg-acid-tint active:translate-x-px active:translate-y-px active:shadow-none",
  );
}

export function TabCount({ count, active }: { count?: number | null; active?: boolean }) {
  if (typeof count !== "number") return null;
  return (
    <span className={cn("min-w-5 px-1 text-center font-mono text-[0.6875rem] font-bold tabular", active ? "bg-acid text-ink" : "bg-paper-deep text-ink")}>
      {count}
    </span>
  );
}

/**
 * Server-rendered tabs where each tab is a URL (?tab=… or a sub-route). Works without JS,
 * is shareable, and survives reloads. The row scrolls horizontally on small screens.
 */
export function LinkTabs({ tabs, label, className }: LinkTabsProps) {
  return (
    <nav aria-label={label} className={cn("relative", className)}>
      <ul className="no-scrollbar m-0 flex list-none gap-1.5 overflow-x-auto border-b-3 border-ink px-0 pt-1 pr-1 pb-3">
        {tabs.map((t) => (
          <li key={t.href} className="flex">
            <Link href={t.href} scroll={false} aria-current={t.active ? "page" : undefined} className={tabClasses(Boolean(t.active))}>
              {t.label}
              <TabCount count={t.count} active={t.active} />
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
