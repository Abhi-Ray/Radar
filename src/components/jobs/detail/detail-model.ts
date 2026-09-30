/**
 * Pure view-model helpers for the job detail page (unit-tested in tests/jobs/detail-model.test.ts).
 * Stored values are JSON, so every shape is checked before use; nothing here touches the DB.
 */
import { formatNumber, truncate } from "@/components/ui/format";
import type { ScoreComponent } from "@/lib/contracts/jobs";
import { FACT_KEYS, MULTI_VALUED_FACT_KEYS, type Confidence, type FactKey, type StoredFact } from "@/lib/contracts/provenance";
import type { OverrideLike } from "@/lib/provenance/resolve";
import { describeFactValue, factLabel } from "../fact-display";

type ResolvedLike = Partial<Record<FactKey, { winner: StoredFact | null; others: StoredFact[]; conflictWith: StoredFact[]; conflict: boolean; overridden: boolean }>>;

function isObj(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

// ---- visa ------------------------------------------------------------------------------------

export interface VisaDecisionView {
  status: string | null;
  reasons: string[];
  sides: { for: string[]; against: string[] } | null;
}

/** visa_status values are a bare status string or {status, reasons, sides}. */
export function visaDecisionOf(value: unknown): VisaDecisionView {
  if (typeof value === "string") return { status: value, reasons: [], sides: null };
  if (!isObj(value)) return { status: null, reasons: [], sides: null };
  const sides = isObj(value.sides) ? { for: strList(value.sides.for), against: strList(value.sides.against) } : null;
  return {
    status: str(value.status),
    reasons: strList(value.reasons),
    sides: sides && (sides.for.length || sides.against.length) ? sides : null,
  };
}

export type SignalTone = "radar" | "stamp" | "cobalt" | "signal" | "concrete";

export const VISA_SIGNAL_META: Record<string, { label: string; tone: SignalTone }> = {
  offered: { label: "Sponsorship offered", tone: "radar" },
  not_offered: { label: "No sponsorship", tone: "stamp" },
  relocation: { label: "Relocation support", tone: "cobalt" },
  right_to_work_required: { label: "Right to work required", tone: "signal" },
};

export interface VisaSignalView {
  signal: string;
  label: string;
  tone: SignalTone;
  quote: string | null;
  lang: string | null;
  ruleId: string | null;
}

export function visaSignalOf(value: unknown): VisaSignalView | null {
  if (!isObj(value)) return null;
  const signal = str(value.signal);
  if (!signal) return null;
  const meta = VISA_SIGNAL_META[signal] ?? { label: signal.replace(/_/g, " "), tone: "concrete" as const };
  return { signal, label: meta.label, tone: meta.tone, quote: str(value.quote), lang: str(value.lang), ruleId: str(value.ruleId) };
}

/** "12% above the threshold" / "4% below the threshold" / null. */
export function marginText(marginPct: number | null | undefined): string | null {
  if (typeof marginPct !== "number" || !Number.isFinite(marginPct)) return null;
  const rounded = Math.round(marginPct * 10) / 10;
  if (rounded === 0) return "Right at the threshold";
  return `${String(Math.abs(rounded))}% ${rounded > 0 ? "above" : "below"} the threshold`;
}

// ---- fit -------------------------------------------------------------------------------------

export interface FitBar {
  key: string;
  label: string;
  /** Share of the score this component can give, in points (weights are relative). */
  maxPoints: number;
  points: number;
  /** 0..1 — how much of its share the job earned. */
  fill: number;
  confidence: Confidence;
  reason: string;
}

function clamp01(n: number): number {
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

export function fitBars(components: readonly ScoreComponent[]): FitBar[] {
  const totalWeight = components.reduce((s, c) => s + (Number.isFinite(c.weight) && c.weight > 0 ? c.weight : 0), 0);
  return components.map((c) => ({
    key: c.key,
    label: c.label,
    maxPoints: totalWeight > 0 && c.weight > 0 ? Math.round((c.weight / totalWeight) * 1000) / 10 : 0,
    points: Math.round(c.contribution * 10) / 10,
    fill: clamp01(c.raw),
    confidence: c.confidence,
    reason: c.reason,
  }));
}

// ---- fact ledger -----------------------------------------------------------------------------

export type CandidateRole = "winner" | "agrees" | "disagrees" | "estimate";

export interface LedgerCandidate {
  fact: StoredFact;
  role: CandidateRole;
  /** 1-based position in trust order. */
  rank: number;
  text: string;
  manual: boolean;
}

export interface LedgerEntry {
  key: FactKey;
  label: string;
  winnerText: string;
  winner: StoredFact;
  candidates: LedgerCandidate[];
  conflict: boolean;
  overridden: boolean;
  multi: boolean;
  /** How many candidates disagree with the winner (estimates excluded). */
  disagreeing: number;
}

/** One entry per fact key with a winner, in contract order; candidates best-first (the resolver's order). */
export function ledgerEntries(resolved: ResolvedLike, opts: { skip?: readonly FactKey[] } = {}): LedgerEntry[] {
  const out: LedgerEntry[] = [];
  for (const key of FACT_KEYS) {
    if (opts.skip?.includes(key)) continue;
    const r = resolved[key];
    if (!r?.winner) continue;
    const multi = MULTI_VALUED_FACT_KEYS.includes(key);
    const against = new Set(r.conflictWith.map((f) => f.id));
    const all = [r.winner, ...r.others];
    const candidates = all.map((fact, i): LedgerCandidate => ({
      fact,
      rank: i + 1,
      role: i === 0 ? "winner" : against.has(fact.id) ? "disagrees" : fact.method === "estimate" ? "estimate" : "agrees",
      text: describeFactValue(key, fact.value),
      manual: fact.method === "manual",
    }));
    out.push({
      key,
      label: factLabel(key),
      winner: r.winner,
      winnerText: multi && all.length > 1 ? `${all.length} signals` : describeFactValue(key, r.winner.value),
      candidates,
      conflict: r.conflict,
      overridden: r.overridden,
      multi,
      disagreeing: against.size,
    });
  }
  return out;
}

// ---- history ---------------------------------------------------------------------------------

export interface HistoryItem {
  id: string;
  at: Date;
  kind: "change" | "override" | "override_removed" | "correction";
  title: string;
  body: string | null;
}

const MAX_HISTORY_TEXT = 140;

function changeText(v: string | null): string {
  if (v === null || v === "") return "empty";
  return truncate(v, 60);
}

/** An override's end is matched to its "remove" audit entry when they are this close in time. */
const CLEAR_MATCH_MS = 60_000;

/**
 * Job changes, overrides and corrections merged, newest first. An override that was removed
 * gets its own "removed" line (with the reason from the audit log); one that was replaced by a
 * newer override needs none — the newer one's line says it.
 */
export function historyItems(input: {
  changes: readonly { id: number; field: string; oldValue: string | null; newValue: string | null; changedAt: Date }[];
  overrides: readonly OverrideLike[];
  corrections: readonly { id: number; field: string; note: string | null; createdAt: Date; addedToGolden: boolean }[];
  overrideEnds?: readonly { overrideId: number; at: Date }[];
  overrideClears?: readonly { field: string; at: Date; reason: string | null }[];
}): HistoryItem[] {
  const items: HistoryItem[] = [];
  for (const c of input.changes) {
    items.push({
      id: `c${c.id}`,
      at: c.changedAt,
      kind: "change",
      title: `${factLabel(c.field)} changed`,
      body: `${changeText(c.oldValue)} → ${changeText(c.newValue)}`,
    });
  }
  const ends = new Map((input.overrideEnds ?? []).map((e) => [e.overrideId, e.at]));
  const clears = [...(input.overrideClears ?? [])];
  for (const o of input.overrides) {
    const endedAt = o.active ? undefined : ends.get(o.id);
    const legacy = !o.active && !endedAt;
    items.push({
      id: `o${o.id}`,
      at: o.createdAt,
      kind: legacy ? "override_removed" : "override",
      title: `${factLabel(o.field)} overridden${legacy ? " (no longer active)" : ""}`,
      body: truncate(`${describeFactValue(o.field, o.valueJson)}${o.reason ? ` — “${o.reason}”` : ""}`, MAX_HISTORY_TEXT),
    });
    if (!endedAt) continue;
    let best = -1;
    for (let i = 0; i < clears.length; i++) {
      const gap = Math.abs(clears[i].at.getTime() - endedAt.getTime());
      if (clears[i].field === o.field && gap <= CLEAR_MATCH_MS && (best < 0 || gap < Math.abs(clears[best].at.getTime() - endedAt.getTime()))) best = i;
    }
    if (best < 0) continue;
    const [clear] = clears.splice(best, 1);
    items.push({
      id: `x${o.id}`,
      at: endedAt,
      kind: "override_removed",
      title: `${factLabel(o.field)} override removed`,
      body: clear.reason ? truncate(`“${clear.reason}”`, MAX_HISTORY_TEXT) : null,
    });
  }
  for (const c of input.corrections) {
    items.push({
      id: `r${c.id}`,
      at: c.createdAt,
      kind: "correction",
      title: `${factLabel(c.field)} reported wrong${c.addedToGolden ? " · added to golden sample" : ""}`,
      body: c.note ? truncate(c.note, MAX_HISTORY_TEXT) : null,
    });
  }
  return items.sort((a, b) => b.at.getTime() - a.at.getTime() || b.id.localeCompare(a.id));
}

// ---- link health -----------------------------------------------------------------------------

export function linkCheckText(c: { ok: boolean; statusCode: number | null; error: string | null; durationMs: number | null }): string {
  const code = c.statusCode !== null ? `HTTP ${c.statusCode}` : "No response";
  const took = c.durationMs !== null ? ` · ${formatNumber(c.durationMs)} ms` : "";
  if (c.ok) return `${code}${took}`;
  return `${code}${c.error ? ` · ${truncate(c.error, 80)}` : ""}${took}`;
}

// ---- column overrides ------------------------------------------------------------------------

/**
 * Column fields (title/country/city/workplace_type) are written onto the job row by an override,
 * and removing the override does not restore the posting's value: that happens only when the
 * pipeline next rewrites the field. Returns the removed override the current value still comes
 * from, so the page does not claim "from the posting" for it.
 */
export function lingeringColumnOverride(overrides: readonly OverrideLike[], field: string, current: unknown): OverrideLike | null {
  const latest = overrides
    .filter((o) => o.field === field)
    .reduce<OverrideLike | null>((best, o) => (!best || o.createdAt.getTime() > best.createdAt.getTime() || (o.createdAt.getTime() === best.createdAt.getTime() && o.id > best.id) ? o : best), null);
  if (!latest || latest.active) return null;
  const norm = (v: unknown) => (typeof v === "string" ? v.trim() : v === null || v === undefined ? "" : null);
  const a = norm(latest.valueJson);
  const b = norm(current);
  return a !== null && b !== null && a !== "" && a === b ? latest : null;
}
