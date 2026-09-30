/**
 * Display helpers for /countries (pure, client-safe): marker and watch tones, the rule stamp,
 * the change-kind labels and the `?asof=` day.
 */
import type { Tone } from "@/components/ui/status";
import { isDay, type CountryRuleMarker, type RuleFreshness } from "./model";

export const MARKER_TONE: Record<CountryRuleMarker, Tone> = {
  verified: "radar",
  stale: "signal",
  unverified: "stamp",
  none: "concrete",
};

/**
 * Where a shown rule sits relative to today: the one in effect, one that has ended or been
 * replaced (seen through `?asof=`), or one that starts later.
 */
export type RulePhase = "current" | "past" | "upcoming";

/** The stamp on a rule receipt. A past or upcoming rule is not judged on freshness. */
export function ruleStamp(f: RuleFreshness, phase: RulePhase = "current"): { label: string; tone: Tone; dashed: boolean } {
  if (phase === "past") return { label: "Superseded", tone: "concrete", dashed: true };
  if (phase === "upcoming") return { label: "Announced", tone: "cobalt", dashed: true };
  if (f.state === "verified") return { label: f.reviewDue ? "Review due" : "Verified", tone: f.reviewDue ? "acid" : "radar", dashed: false };
  if (f.state === "stale") return { label: "Stale", tone: "signal", dashed: true };
  return { label: "Unverified", tone: "stamp", dashed: true };
}

export const WATCH_META: Record<string, { label: string; tone: Tone; blurb: string }> = {
  ok: { label: "No change", tone: "radar", blurb: "Same as when last reviewed." },
  changed: { label: "Changed", tone: "signal", blurb: "The page changed since it was last reviewed. Read it and add a rule version if the rule moved." },
  error: { label: "Could not load", tone: "stamp", blurb: "The last check failed. Open the page by hand." },
  unchecked: { label: "Not checked yet", tone: "concrete", blurb: "The watcher has not fetched it yet." },
};

export function watchMeta(status: string): { label: string; tone: Tone; blurb: string } {
  return WATCH_META[status] ?? { label: status, tone: "concrete", blurb: "" };
}

export const CHANGE_KIND_LABEL: Record<string, string> = {
  created: "New version",
  updated: "Updated",
  verified: "Verified",
  retired: "Retired",
  page_changed: "Official page changed",
};

export function changeKindLabel(kind: string): string {
  return CHANGE_KIND_LABEL[kind] ?? kind.replace(/_/g, " ");
}

/** `?asof=YYYY-MM-DD` → the day, or null when missing/invalid. */
export function parseAsOf(raw: string | string[] | undefined): string | null {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return typeof v === "string" && isDay(v.trim()) ? v.trim() : null;
}

/** "2026-01-01 → 2026-12-31", "from 2026-01-01", "until 2026-12-31", "always". */
export function effectiveSpan(from: string | null, to: string | null): string {
  if (from && to) return `${from} → ${to}`;
  if (from) return `from ${from}`;
  if (to) return `until ${to}`;
  return "no start date";
}

/** Days from `today` to `day` (both 'YYYY-MM-DD', UTC); negative when past. */
export function daysFromToday(today: string, day: string): number {
  return Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
