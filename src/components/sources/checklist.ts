/**
 * Source registry helpers (pure, client-safe): the spec §7.4 "definition of done" checklist,
 * the trial → live gate, status transitions and the health verdict shown on /sources.
 * Mirrors CHECKLIST_KEYS / BREAKER_THRESHOLD from src/lib/pipeline/health.ts without importing it
 * (that module pulls in env-reading time helpers); tests keep the two in step.
 */
import type { SourceChecklist, SourceChecklistItem } from "@/db/schema/sources";
import type { Tone } from "@/components/ui/status";

export const SOURCE_CHECKLIST_KEYS = [
  "terms_reviewed",
  "samples_saved",
  "parser_handles_samples",
  "baseline_recorded",
  "rate_limit_set",
  "alerts_configured",
  "hand_checked_20",
] as const satisfies readonly (keyof SourceChecklist)[];
export type SourceChecklistKey = (typeof SOURCE_CHECKLIST_KEYS)[number];

/** Consecutive failed runs that open the circuit (health.ts BREAKER_THRESHOLD). */
export const SOURCE_BREAKER_THRESHOLD = 3;

export interface ChecklistMeta {
  key: SourceChecklistKey;
  /** Spec §7.4 wording. */
  label: string;
  /** "auto": the pipeline ticks it when its evidence shows up; "human": only you can tick it. */
  how: "auto" | "human";
  /** What counts as evidence. */
  evidence: string;
}

export const CHECKLIST_META: readonly ChecklistMeta[] = [
  {
    key: "terms_reviewed",
    label: "Terms of use reviewed and recorded, with a date",
    how: "auto",
    evidence: "The platform's terms are recorded as allowed with a review date (Platform registry below).",
  },
  {
    key: "samples_saved",
    label: "Sample raw responses saved as test samples",
    how: "auto",
    evidence: "Raw snapshots from this source exist.",
  },
  {
    key: "parser_handles_samples",
    label: "Parser handles the samples, including missing fields",
    how: "auto",
    evidence: "A clean run parsed 10+ postings without a parse-failure flag.",
  },
  {
    key: "baseline_recorded",
    label: "Normal volume and freshness baseline recorded",
    how: "auto",
    evidence: "A baseline built from 5+ healthy runs.",
  },
  {
    key: "rate_limit_set",
    label: "Request rate set and respected",
    how: "auto",
    evidence: "The platform has a per-minute rate limit and a daily cap.",
  },
  {
    key: "alerts_configured",
    label: "Alerts on: silent source, volume drop, parse failures",
    how: "auto",
    evidence: "An alert channel is switched on in Settings and configured on the server.",
  },
  {
    key: "hand_checked_20",
    label: "20 jobs checked by hand against the original site",
    how: "human",
    evidence: "Only you can tick this — open 20 of its jobs next to the original postings.",
  },
];

export const CHECKLIST_LABEL: Record<SourceChecklistKey, string> = Object.fromEntries(
  CHECKLIST_META.map((m) => [m.key, m.label]),
) as Record<SourceChecklistKey, string>;

function readItem(v: unknown): SourceChecklistItem {
  if (!v || typeof v !== "object") return { done: false, at: null, note: null };
  const o = v as Record<string, unknown>;
  return { done: o.done === true, at: typeof o.at === "string" ? o.at : null, note: typeof o.note === "string" ? o.note : null };
}

/** Tolerant read of sources.checklist_json (missing / malformed items → not done). */
export function normalizeChecklist(v: unknown): SourceChecklist {
  const src = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const out = {} as SourceChecklist;
  for (const k of SOURCE_CHECKLIST_KEYS) out[k] = readItem(src[k]);
  return out;
}

/** True when the note was written by the pipeline's auto-tick ("auto: …"). */
export function isAutoNote(note: string | null | undefined): boolean {
  return typeof note === "string" && note.startsWith("auto: ");
}

export function checklistProgress(v: unknown): { done: number; total: number; missing: SourceChecklistKey[] } {
  const c = normalizeChecklist(v);
  const missing = SOURCE_CHECKLIST_KEYS.filter((k) => !c[k].done);
  return { done: SOURCE_CHECKLIST_KEYS.length - missing.length, total: SOURCE_CHECKLIST_KEYS.length, missing };
}

export type SourceStatus = "draft" | "trial" | "live" | "paused" | "disabled";

export type PromotionGate = { ok: true } | { ok: false; reason: string; missing: SourceChecklistKey[] };

/** trial → live only with a complete checklist (spec §7.4); explains what is missing otherwise. */
export function promotionGate(status: string, checklist: unknown): PromotionGate {
  if (status !== "trial") return { ok: false, reason: `Only a trial source can go live (this one is ${status}).`, missing: [] };
  const { missing } = checklistProgress(checklist);
  if (missing.length === 0) return { ok: true };
  const list = missing.map((k) => CHECKLIST_LABEL[k]).join("; ");
  return {
    ok: false,
    reason: `The checklist is not complete — ${missing.length} of ${SOURCE_CHECKLIST_KEYS.length} still open: ${list}.`,
    missing,
  };
}

export type StatusMove = "start_trial" | "promote" | "pause" | "resume" | "disable" | "enable";

export const STATUS_MOVE_LABEL: Record<StatusMove, string> = {
  start_trial: "Start trial",
  promote: "Promote to live",
  pause: "Pause",
  resume: "Resume",
  disable: "Disable",
  enable: "Re-enable as draft",
};

/** Status moves allowed from a status (promote is listed for trial; the checklist gate is separate). */
export function allowedMoves(status: string): StatusMove[] {
  switch (status) {
    case "draft":
      return ["start_trial", "disable"];
    case "trial":
      return ["promote", "pause", "disable"];
    case "live":
      return ["pause", "disable"];
    case "paused":
      return ["resume", "disable"];
    case "disabled":
      return ["enable"];
    default:
      return [];
  }
}

/** Where "resume" goes: the status before the pause (live or trial), never straight past the gate. */
export function resumeTarget(statusBeforePause: unknown): "trial" | "live" {
  return statusBeforePause === "live" ? "live" : "trial";
}

/** The status a move leads to (`resume` needs the pre-pause status). Null = move not allowed. */
export function moveTarget(status: string, move: StatusMove, statusBeforePause?: unknown): SourceStatus | null {
  if (!allowedMoves(status).includes(move)) return null;
  switch (move) {
    case "start_trial":
      return "trial";
    case "promote":
      return "live";
    case "pause":
      return "paused";
    case "resume":
      return resumeTarget(statusBeforePause);
    case "disable":
      return "disabled";
    case "enable":
      return "draft";
  }
}

export type CircuitState = "closed" | "tripping" | "open";

export function circuitState(s: { consecutiveFailures: number; circuitOpenUntil: Date | string | null }, now: Date): CircuitState {
  const until = s.circuitOpenUntil ? new Date(s.circuitOpenUntil) : null;
  if (until && until.getTime() > now.getTime()) return "open";
  return s.consecutiveFailures > 0 ? "tripping" : "closed";
}

export interface SourceHealthVerdict {
  tone: Tone;
  label: string;
  detail: string;
}

/**
 * One verdict per source for the health table. Same rule as the Desk health strip: a running
 * source (trial / live) is a warning when it has failures or an open circuit.
 */
export function sourceHealth(
  s: { status: string; consecutiveFailures: number; circuitOpenUntil: Date | string | null; lastRunAt: Date | string | null },
  now: Date,
  threshold = SOURCE_BREAKER_THRESHOLD,
): SourceHealthVerdict {
  if (s.status === "disabled") return { tone: "concrete", label: "DISABLED", detail: "Never runs." };
  if (s.status === "paused") return { tone: "concrete", label: "PAUSED", detail: "Skipped by the daily run until resumed." };
  if (s.status === "draft") return { tone: "card", label: "DRAFT", detail: "Not in the daily run yet — start a trial." };
  const circuit = circuitState(s, now);
  if (circuit === "open") return { tone: "stamp", label: "CIRCUIT OPEN", detail: `Paused by the breaker after ${s.consecutiveFailures} failed runs.` };
  if (circuit === "tripping") {
    return { tone: "signal", label: "FAILING", detail: `${s.consecutiveFailures} failed run${s.consecutiveFailures === 1 ? "" : "s"} in a row (breaker at ${threshold}).` };
  }
  if (!s.lastRunAt) return { tone: "cobalt", label: "NOT RUN", detail: "Waiting for its first run." };
  return { tone: "radar", label: "OK", detail: "Last run succeeded." };
}

export const SOURCE_STATUS_TONE: Record<SourceStatus, Tone> = {
  draft: "card",
  trial: "signal",
  live: "radar",
  paused: "concrete",
  disabled: "concrete",
};

export const TERMS_TONE: Record<string, Tone> = { allowed: "radar", restricted: "signal", unknown: "card", forbidden: "stamp" };

/** Share of attempted postings that failed to parse over the given runs (null when nothing was parsed). */
export function parseFailureRate(runs: readonly { parsed: number; failedParse: number }[]): number | null {
  let parsed = 0;
  let failed = 0;
  for (const r of runs) {
    parsed += Math.max(0, r.parsed);
    failed += Math.max(0, r.failedParse);
  }
  const total = parsed + failed;
  return total === 0 ? null : failed / total;
}

/** Days since the platform terms were reviewed, and whether a re-review is due (default: yearly). */
export function termsReviewDue(reviewedAt: Date | string | null, now: Date, maxAgeDays = 365): { ageDays: number | null; due: boolean } {
  if (!reviewedAt) return { ageDays: null, due: true };
  const age = Math.floor((now.getTime() - new Date(reviewedAt).getTime()) / 86_400_000);
  return { ageDays: age, due: age > maxAgeDays };
}
