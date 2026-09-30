import type { IconName } from "@/components/ui/icons";

export type NavCountKind = "review" | "alerts";

export interface NavItem {
  href: string;
  label: string;
  /** Two-digit section code printed on the rail, field-manual style. */
  code: string;
  icon: IconName;
  group: "hunt" | "intel" | "ops";
  /** Which live count badge to show. */
  count?: NavCountKind;
  /** One-liner shown in the More sheet. */
  blurb: string;
}

export const NAV_ITEMS: readonly NavItem[] = [
  { href: "/", label: "Desk", code: "00", icon: "desk", group: "hunt", blurb: "Today's control desk" },
  { href: "/jobs", label: "Jobs", code: "01", icon: "jobs", group: "hunt", blurb: "Every blip, filtered" },
  { href: "/applications", label: "Tracker", code: "02", icon: "tracker", group: "hunt", blurb: "Applications & follow-ups" },
  { href: "/companies", label: "Companies", code: "03", icon: "companies", group: "intel", blurb: "Sponsors, history, notes" },
  { href: "/countries", label: "Countries", code: "04", icon: "countries", group: "intel", blurb: "Visa routes & thresholds" },
  { href: "/kit", label: "Kit", code: "05", icon: "kit", group: "intel", blurb: "CVs, letters, templates" },
  { href: "/review", label: "Review", code: "06", icon: "review", group: "ops", count: "review", blurb: "Duplicates, titles, errors" },
  { href: "/sources", label: "Sources", code: "07", icon: "sources", group: "ops", blurb: "Feeds & connectors" },
  { href: "/accuracy", label: "Accuracy", code: "08", icon: "accuracy", group: "ops", blurb: "Golden sample & spot-checks" },
  { href: "/system", label: "System", code: "09", icon: "system", group: "ops", count: "alerts", blurb: "Runs, alerts, backups, AI" },
  { href: "/settings", label: "Settings", code: "10", icon: "settings", group: "ops", blurb: "Profile, scoring, alerts, AI" },
];

export const NAV_GROUPS: readonly { key: NavItem["group"]; label: string }[] = [
  { key: "hunt", label: "Hunt" },
  { key: "intel", label: "Intel" },
  { key: "ops", label: "Ops" },
];

/** Bottom tab bar on phones (the fifth slot is "More"). */
export const MOBILE_TAB_HREFS: readonly string[] = ["/", "/jobs", "/applications", "/review"];

export const MOBILE_TABS: readonly NavItem[] = MOBILE_TAB_HREFS.map((h) => NAV_ITEMS.find((i) => i.href === h)!);

/** Everything that isn't a bottom tab lives in the More sheet. */
export const MORE_ITEMS: readonly NavItem[] = NAV_ITEMS.filter((i) => !MOBILE_TAB_HREFS.includes(i.href));

/**
 * Is `href` the active section for `pathname`? "/" only matches exactly; other sections match
 * themselves and their sub-routes ("/jobs/42"), but not look-alikes ("/jobsearch").
 */
export function isActivePath(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  const path = pathname.split(/[?#]/)[0].replace(/\/+$/, "") || "/";
  if (href === "/") return path === "/";
  return path === href || path.startsWith(`${href}/`);
}

/** The nav item that owns a pathname (for the mobile top bar title). */
export function activeItem(pathname: string | null | undefined): NavItem | undefined {
  return NAV_ITEMS.find((i) => i.href !== "/" && isActivePath(pathname, i.href)) ?? (isActivePath(pathname, "/") ? NAV_ITEMS[0] : undefined);
}

/** True when the pathname belongs to a More-sheet section (so the More tab lights up). */
export function isMoreActive(pathname: string | null | undefined): boolean {
  return MORE_ITEMS.some((i) => isActivePath(pathname, i.href)) || isActivePath(pathname, "/styleguide");
}
