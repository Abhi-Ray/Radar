/**
 * /review helpers (pure, client-safe): the quality flags shown on a needs-review job, the
 * "AI disagrees with the rules" detection over resolved facts, the title-override entry written
 * when a queued title is mapped, and the tab list.
 */
import type { Tone } from "@/components/ui/status";

export const REVIEW_TABS = ["duplicates", "titles", "companies", "dead-letters", "jobs"] as const;
export type ReviewTab = (typeof REVIEW_TABS)[number];

export const REVIEW_TAB_LABEL: Record<ReviewTab, string> = {
  duplicates: "Possible duplicates",
  titles: "Unknown titles",
  companies: "Weak company matches",
  "dead-letters": "Parse failures",
  jobs: "Needs review",
};

export function parseReviewTab(v: unknown): ReviewTab {
  const s = Array.isArray(v) ? v[0] : v;
  return typeof s === "string" && (REVIEW_TABS as readonly string[]).includes(s) ? (s as ReviewTab) : "duplicates";
}

export interface QualityInput {
  state: string;
  ghostRisk: boolean;
  linkStatus: string;
  factsConfidence: string | null;
  visaStatus: string | null;
  repostCount: number;
  missingRunCount: number;
}

export interface QualityFlag {
  key: string;
  label: string;
  tone: Tone;
}

/** Why a job looks doubtful, most serious first. */
export function qualityFlags(j: QualityInput): QualityFlag[] {
  const out: QualityFlag[] = [];
  if (j.state === "suspicious") out.push({ key: "suspicious", label: "Suspicious posting", tone: "stamp" });
  if (j.visaStatus === "conflicting") out.push({ key: "visa_conflict", label: "Visa signals conflict", tone: "stamp" });
  if (j.linkStatus === "dead") out.push({ key: "dead_link", label: "Apply link dead", tone: "stamp" });
  if (j.ghostRisk) out.push({ key: "ghost", label: "Ghost-job risk", tone: "signal" });
  if (j.repostCount >= 2) out.push({ key: "reposted", label: `Reposted ${j.repostCount}×`, tone: "signal" });
  if (j.missingRunCount > 0 && j.state !== "closed" && j.state !== "expired") out.push({ key: "missing", label: `Missing from ${j.missingRunCount} run${j.missingRunCount === 1 ? "" : "s"}`, tone: "signal" });
  if (j.factsConfidence === "low") out.push({ key: "low_conf", label: "Low-confidence facts", tone: "concrete" });
  return out;
}

/** The part of a resolved fact the conflict check needs. */
export interface CandidateLike {
  method: string;
  value: unknown;
  source: string;
  confidence: string;
}

export interface ResolvedLike {
  winner: CandidateLike | null;
  conflictWith: CandidateLike[];
  overridden: boolean;
}

export interface AiConflict {
  factKey: string;
  ai: CandidateLike;
  other: CandidateLike;
  /** Which side currently wins (what the app shows). */
  winner: "ai" | "other";
}

/**
 * Facts where an AI reading disagrees with a rule / posting / official reading. A manual override
 * settles the question, so overridden facts are skipped.
 */
export function aiConflicts(resolved: Partial<Record<string, ResolvedLike | undefined>>): AiConflict[] {
  const out: AiConflict[] = [];
  for (const [factKey, r] of Object.entries(resolved)) {
    if (!r || !r.winner || r.overridden) continue;
    if (r.winner.method === "ai") {
      const other = r.conflictWith.find((c) => c.method !== "ai" && c.method !== "estimate");
      if (other) out.push({ factKey, ai: r.winner, other, winner: "ai" });
    } else if (r.winner.method !== "estimate") {
      const ai = r.conflictWith.find((c) => c.method === "ai");
      if (ai) out.push({ factKey, ai, other: r.winner, winner: "other" });
    }
  }
  return out.sort((a, b) => a.factKey.localeCompare(b.factKey));
}

export interface TitleOverrideEntry {
  roleKey: string | null;
  roleFamily: "primary" | "secondary" | "fallback" | "other";
  seniorityWord: null;
  note: string | null;
  decidedAt: string;
}

/**
 * The title_overrides entry for a review decision. `roleKey` null = "ignore" (not a role we
 * track: family 'other'). The family is taken from the current target-role lists.
 */
export function titleOverrideEntry(
  roleKey: string | null,
  targetRoles: { primary: readonly string[]; secondary: readonly string[]; fallback: readonly string[] },
  note: string | null,
  now: Date,
): TitleOverrideEntry {
  let roleFamily: TitleOverrideEntry["roleFamily"] = "other";
  if (roleKey) {
    if (targetRoles.primary.includes(roleKey)) roleFamily = "primary";
    else if (targetRoles.secondary.includes(roleKey)) roleFamily = "secondary";
    else if (targetRoles.fallback.includes(roleKey)) roleFamily = "fallback";
  }
  return { roleKey, roleFamily, seniorityWord: null, note, decidedAt: now.toISOString() };
}

/** Pair score (0..1) as a percentage label. */
export function pairScoreText(score: number | string | null | undefined): string {
  const n = typeof score === "string" ? Number(score) : score;
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${Math.round((n <= 1 ? n * 100 : n) as number)}%`;
}

/** Reasons from duplicate_candidates.reasons_json, tolerant of the stored shapes. */
export function pairReasons(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : x && typeof x === "object" && "reason" in x ? String((x as { reason: unknown }).reason) : JSON.stringify(x))).slice(0, 12);
  if (v && typeof v === "object") {
    return Object.entries(v as Record<string, unknown>)
      .slice(0, 12)
      .map(([k, val]) => (typeof val === "boolean" ? (val ? k.replaceAll("_", " ") : `not ${k.replaceAll("_", " ")}`) : `${k.replaceAll("_", " ")}: ${typeof val === "number" ? Math.round(val * 100) / 100 : String(val)}`));
  }
  return [];
}
