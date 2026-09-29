"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import { Drawer } from "@/components/ui/Drawer";
import { NavLink, MoreTabButton } from "./NavLink";
import { MOBILE_TABS, MORE_ITEMS, type NavCountKind } from "./nav";

export interface MobileTabBarProps {
  /** Server-streamed count badges, keyed by kind. */
  badges: Partial<Record<NavCountKind, ReactNode>>;
  /** Sheet badges (larger), keyed by kind. */
  sheetBadges: Partial<Record<NavCountKind, ReactNode>>;
  /** Operator block + sign-out form, rendered at the foot of the sheet. */
  account: ReactNode;
}

/** Four tabs + "More" which opens a bottom sheet with the remaining sections. */
export function MobileTabBar({ badges, sheetBadges, account }: MobileTabBarProps) {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  return (
    <>
      <ul className="m-0 flex list-none p-0">
        {MOBILE_TABS.map((item) => (
          <li key={item.href} className="flex flex-1 border-r-3 border-ink">
            <NavLink variant="tab" href={item.href} label={item.label} icon={item.icon} badge={item.count ? badges[item.count] : undefined} />
          </li>
        ))}
        <li className="flex flex-1">
          <MoreTabButton onClick={() => setOpen(true)} expanded={open} />
        </li>
      </ul>

      <Drawer open={open} onClose={close} title="More sections" kicker="Field station" closeOnSubmit={false}>
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 min-[420px]:grid-cols-2">
          {MORE_ITEMS.map((item) => (
            <li key={item.href}>
              <NavLink
                variant="sheet"
                href={item.href}
                label={item.label}
                icon={item.icon}
                code={item.code}
                blurb={item.blurb}
                badge={item.count ? sheetBadges[item.count] : undefined}
                onNavigate={close}
              />
            </li>
          ))}
        </ul>
        <div className="mt-5 border-t-3 border-dashed border-ink pt-4">{account}</div>
        <Link href="/styleguide" onClick={close} className="micro mt-4 inline-block text-muted underline decoration-dotted underline-offset-4">
          UI kit · styleguide
        </Link>
      </Drawer>
    </>
  );
}
