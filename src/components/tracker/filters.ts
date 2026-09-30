/**
 * /applications view model: filters in the URL, the board lanes and the mobile lane choice.
 * Pure and client-safe (the SQL in src/lib/queries/applications.ts applies the same filters).
 */
import { BOARD_STAGES, PIPELINE_STAGES, TERMINAL_STAGES, isApplicationStage, type ApplicationStage } from "@/lib/tracker/stages";
import { hrefWith, paramList, paramValue, type ParamUpdate, type SearchParamsInput } from "@/components/ui/url";

export const APPLICATIONS_PATH = "/applications";

export interface TrackerFilters {
  q: string | null;
  /** ISO2 codes (upper case); "none" = no country recorded. */
  country: string[];
  /** Source keys (lower-cased source text); "none" = not recorded. */
  source: string[];
  /** Only applications with a follow-up due today or overdue. */
  due: boolean;
  /** Hide the closed lanes (rejected, withdrawn, accepted) and no-response. */
  open: boolean;
  /** Mobile: the stage tab shown (desktop shows every lane). */
  lane: ApplicationStage | null;
}

export const EMPTY_TRACKER_FILTERS: TrackerFilters = { q: null, country: [], source: [], due: false, open: false, lane: null };

const MAX_Q = 100;
const ISO2 = /^[A-Z]{2}$/;

function flag(v: string | undefined): boolean {
  return v === "1" || v === "true" || v === "on";
}

export function parseTrackerFilters(sp: SearchParamsInput): TrackerFilters {
  const q = paramValue(sp, "q")?.trim().slice(0, MAX_Q) || null;
  const country = [...new Set(paramList(sp, "country").map((c) => c.toUpperCase()).filter((c) => ISO2.test(c) || c === "NONE"))]
    .map((c) => (c === "NONE" ? "none" : c))
    .slice(0, 30);
  const source = [...new Set(paramList(sp, "source").map((s) => s.toLowerCase().trim().slice(0, 191)).filter(Boolean))].slice(0, 30);
  const laneRaw = paramValue(sp, "lane");
  return {
    q,
    country,
    source,
    due: flag(paramValue(sp, "due")),
    open: flag(paramValue(sp, "open")),
    lane: isApplicationStage(laneRaw) ? laneRaw : null,
  };
}

export function trackerParams(f: TrackerFilters): Record<string, ParamUpdate> {
  return {
    q: f.q,
    country: f.country.length ? f.country : null,
    source: f.source.length ? f.source : null,
    due: f.due ? "1" : null,
    open: f.open ? "1" : null,
    lane: f.lane,
  };
}

/** Plain search params (for Pagination-style helpers and export links). */
export function trackerSearchParams(f: TrackerFilters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(trackerParams(f))) {
    if (v === null || v === undefined || v === false || v === "") continue;
    out[k] = Array.isArray(v) ? v.map(String) : String(v);
  }
  return out;
}

export function trackerHref(f: TrackerFilters, updates: Partial<Record<keyof TrackerFilters, ParamUpdate>> = {}): string {
  return hrefWith(APPLICATIONS_PATH, trackerSearchParams(f), updates as Record<string, ParamUpdate>);
}

export function activeTrackerFilterCount(f: TrackerFilters): number {
  return (f.q ? 1 : 0) + f.country.length + f.source.length + (f.due ? 1 : 0) + (f.open ? 1 : 0);
}

/** The lanes of the board for this view (open-only drops the terminal lanes and "accepted"). */
export function boardLanes(f: Pick<TrackerFilters, "open">): ApplicationStage[] {
  return f.open ? PIPELINE_STAGES.filter((s) => s !== "accepted") : [...BOARD_STAGES];
}

export function isTerminalLane(s: ApplicationStage): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(s);
}

/**
 * Mobile tab to show: the requested lane if it is on the board, else the first open lane with
 * cards (the work in progress), else the first lane with cards, else "applied".
 */
export function pickLane(requested: ApplicationStage | null, lanes: readonly ApplicationStage[], counts: Partial<Record<ApplicationStage, number>>): ApplicationStage {
  if (requested && lanes.includes(requested)) return requested;
  const inProgress: ApplicationStage[] = ["applied", "screening", "technical", "final", "offer"];
  const firstOpen = inProgress.find((s) => lanes.includes(s) && (counts[s] ?? 0) > 0);
  if (firstOpen) return firstOpen;
  const any = lanes.find((s) => (counts[s] ?? 0) > 0);
  return any ?? (lanes.includes("applied") ? "applied" : lanes[0]);
}

/** Days between two instants, floored (for "applied 12 days ago" style ages). */
export function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 86_400_000));
}
