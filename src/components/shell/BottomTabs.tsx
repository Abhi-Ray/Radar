import { Suspense } from "react";
import { MobileTabBar } from "./MoreSheet";
import { NavCount } from "./NavCounts";
import { UserMenu } from "./UserMenu";

/** Phone bottom tab bar (Desk · Jobs · Tracker · Review · More), fixed, safe-area aware. */
export function BottomTabs({ email }: { email: string }) {
  return (
    <nav
      data-shell
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t-3 border-ink bg-card pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_0_0_var(--color-ink)] md:hidden"
    >
      <MobileTabBar
        badges={{
          review: (
            <Suspense fallback={null}>
              <NavCount kind="review" variant="tab" />
            </Suspense>
          ),
        }}
        sheetBadges={{
          alerts: (
            <Suspense fallback={null}>
              <NavCount kind="alerts" variant="sheet" />
            </Suspense>
          ),
          review: (
            <Suspense fallback={null}>
              <NavCount kind="review" variant="sheet" />
            </Suspense>
          ),
        }}
        account={<UserMenu email={email} variant="sheet" />}
      />
    </nav>
  );
}
