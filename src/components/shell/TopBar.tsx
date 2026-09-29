"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wordmark } from "@/components/ui/Wordmark";
import { activeItem } from "./nav";

/** Phone top bar: wordmark + the current section's code and name. Sticky, 56px. */
export function TopBar() {
  const pathname = usePathname();
  const item = activeItem(pathname);
  const section = pathname?.startsWith("/styleguide") ? { code: "UI", label: "Styleguide" } : item;
  return (
    <header
      data-shell
      className="sticky top-0 z-30 flex h-14 items-center justify-between gap-3 border-b-3 border-ink bg-paper px-3 pt-[env(safe-area-inset-top)] md:hidden"
    >
      <Link href="/" className="inline-flex min-h-11 items-center no-underline" aria-label="RADAR — Desk">
        <Wordmark size="sm" />
      </Link>
      {section ? (
        <p className="flex min-w-0 items-center gap-0 border-2 border-ink bg-card font-mono text-[0.6875rem] font-bold uppercase">
          <span className="bg-ink px-1.5 py-1 text-paper">{section.code}</span>
          <span className="truncate px-1.5 py-1">{section.label}</span>
        </p>
      ) : null}
    </header>
  );
}
