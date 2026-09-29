"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Icon, type IconName } from "@/components/ui/icons";
import { isActivePath, isMoreActive } from "./nav";

export interface NavLinkProps {
  href: string;
  label: string;
  icon: IconName;
  code?: string;
  /** Live count badge (server-rendered, streamed in). */
  badge?: ReactNode;
  variant: "rail" | "tab" | "sheet";
  /** Extra line in the sheet variant. */
  blurb?: string;
  /** Called after navigation click (closes the More sheet). */
  onNavigate?: () => void;
}

/** One navigation entry; knows whether it is the current section via usePathname(). */
export function NavLink({ href, label, icon, code, badge, variant, blurb, onNavigate }: NavLinkProps) {
  const pathname = usePathname();
  const active = isActivePath(pathname, href);

  if (variant === "tab") {
    return (
      <Link
        href={href}
        aria-current={active ? "page" : undefined}
        className={cn(
          "relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 border-r-3 border-ink px-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.06em] no-underline last:border-r-0",
          active ? "bg-acid text-ink" : "bg-card text-ink",
        )}
      >
        {active ? <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-ink" /> : null}
        <span className="relative">
          <Icon name={icon} size={22} />
          {badge ? <span className="absolute -top-2 left-[calc(100%-6px)]">{badge}</span> : null}
        </span>
        {label}
      </Link>
    );
  }

  if (variant === "sheet") {
    return (
      <Link
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={cn(
          "flex min-h-14 items-center gap-3 border-3 border-ink px-3 py-2 no-underline",
          active ? "bg-ink text-paper on-ink" : "bg-card text-ink shadow-xs active:translate-x-px active:translate-y-px active:shadow-none",
        )}
      >
        <span aria-hidden="true" className={cn("flex size-9 shrink-0 items-center justify-center border-2", active ? "border-paper bg-acid text-ink" : "border-ink bg-paper")}>
          <Icon name={icon} size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-extrabold uppercase leading-tight tracking-[0.04em]">{label}</span>
          {blurb ? <span className={cn("block text-xs", active ? "text-paper/80" : "text-muted")}>{blurb}</span> : null}
        </span>
        {badge}
        {code ? <span className="font-mono text-[0.625rem] font-bold opacity-60">{code}</span> : null}
      </Link>
    );
  }

  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "group relative flex min-h-11 items-center gap-3 border-3 px-2.5 py-1.5 font-extrabold uppercase tracking-[0.05em] no-underline",
        active
          ? "border-acid bg-acid text-ink shadow-[4px_4px_0_0_var(--color-paper)]"
          : "border-transparent text-paper hover:border-paper hover:bg-ink-soft",
      )}
    >
      {code ? (
        <span aria-hidden="true" className={cn("w-5 font-mono text-[0.625rem] font-bold tabular", active ? "text-ink" : "text-acid")}>
          {code}
        </span>
      ) : null}
      <Icon name={icon} size={20} />
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {badge}
    </Link>
  );
}

/** The fifth bottom tab: opens the More sheet; lit when the current page lives in it. */
export function MoreTabButton({ onClick, expanded }: { onClick: () => void; expanded: boolean }) {
  const pathname = usePathname();
  const active = isMoreActive(pathname);
  return (
    <button
      type="button"
      onClick={onClick}
      aria-haspopup="dialog"
      aria-expanded={expanded}
      className={cn(
        "relative flex min-h-16 flex-1 flex-col items-center justify-center gap-1 px-1 text-[0.6875rem] font-extrabold uppercase tracking-[0.06em]",
        active || expanded ? "bg-acid text-ink" : "bg-card text-ink",
      )}
    >
      {active ? <span aria-hidden="true" className="absolute inset-x-0 top-0 h-1 bg-ink" /> : null}
      <Icon name="more" size={22} />
      More
    </button>
  );
}
