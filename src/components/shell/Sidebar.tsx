import Link from "next/link";
import { Suspense } from "react";
import { Wordmark } from "@/components/ui/Wordmark";
import { NavCount } from "./NavCounts";
import { NavLink } from "./NavLink";
import { NAV_GROUPS, NAV_ITEMS } from "./nav";
import { UserMenu } from "./UserMenu";

/** Desktop left rail: ink slab, section codes, live counts, operator + sign-out at the foot. */
export function Sidebar({ email }: { email: string }) {
  return (
    <aside
      data-shell
      className="on-ink sticky top-0 hidden h-dvh flex-col overflow-y-auto border-r-3 border-ink bg-ink text-paper md:flex"
    >
      <div className="border-b-3 border-paper/20 px-4 pt-5 pb-4">
        <Link href="/" className="inline-block no-underline" aria-label="RADAR — Desk">
          <Wordmark size="md" onInk />
        </Link>
        <p className="micro mt-3 flex items-center gap-2 text-acid">
          <span aria-hidden="true" className="size-2 animate-blink bg-radar" />
          Field station · online
        </p>
      </div>

      <nav aria-label="Primary" className="flex-1 px-3 py-4">
        {NAV_GROUPS.map((group) => (
          <div key={group.key} className="mb-5 last:mb-0">
            <p className="micro mb-1.5 flex items-center gap-2 px-2.5 text-paper/60">
              <span aria-hidden="true" className="h-[3px] w-3 bg-paper/40" />
              {group.label}
            </p>
            <ul className="m-0 flex list-none flex-col gap-1 p-0">
              {NAV_ITEMS.filter((i) => i.group === group.key).map((item) => (
                <li key={item.href}>
                  <NavLink
                    variant="rail"
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    code={item.code}
                    badge={
                      item.count ? (
                        <Suspense fallback={null}>
                          <NavCount kind={item.count} />
                        </Suspense>
                      ) : undefined
                    }
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="border-t-3 border-paper/20 px-3 pt-3 pb-4">
        <UserMenu email={email} variant="rail" />
        <Link
          href="/styleguide"
          className="micro mt-3 block px-1 text-paper/60 underline decoration-dotted underline-offset-4 hover:text-acid"
        >
          UI kit · styleguide
        </Link>
      </div>
    </aside>
  );
}
