/**
 * Provenance contract (spec §5): every displayed fact carries value, evidence, source, method,
 * confidence, checked-at and the logic version that produced it.
 * Pure types + tiny helpers; safe to import anywhere (client included).
 */
import { CONFIDENCES, METHODS } from '../../db/schema/_enums';

export type Method = (typeof METHODS)[number];
export type Confidence = (typeof CONFIDENCES)[number];

/** index 0 = highest trust. A lower level can never overwrite a higher one. */
export const TRUST_ORDER: readonly Method[] = ['manual', 'official', 'posting', 'rule', 'ai', 'estimate'];

export const CONFIDENCE_ORDER: readonly Confidence[] = ['high', 'medium', 'low'];

export interface Fact<T> {
  value: T;
  evidence: string | null;
  source: string;
  method: Method;
  confidence: Confidence;
  checkedAt: Date;
  logicVersion: string;
}

export const FACT_KEYS = [
  'visa_status',
  'visa_signal',
  'salary',
  'experience',
  'seniority',
  'remote',
  'language',
  'closing_date',
  'role',
  'skills',
  'eligibility',
  'suspicious',
  'ai_summary',
  'red_flags',
] as const;
export type FactKey = (typeof FACT_KEYS)[number];

export function isFactKey(v: unknown): v is FactKey {
  return typeof v === 'string' && (FACT_KEYS as readonly string[]).includes(v);
}

/** A fact as loaded from the DB (job_facts row, value still JSON-typed). */
export interface StoredFact<T = unknown> extends Fact<T> {
  id: number;
  key: FactKey;
  valueHash: string;
  isActive: boolean;
  createdAt: Date;
}

export interface ResolvedFact<T = unknown> {
  winner: StoredFact<T> | null;
  /**
   * True when another active, non-estimate candidate disagrees with the winner (compared on the
   * meaningful part of the value, see provenance/resolve.ts). A manual winner is a decision, so
   * it never reports a conflict (the disagreeing candidates are still listed in `conflictWith`).
   */
  conflict: boolean;
  /** All other active candidates, best first. */
  others: StoredFact<T>[];
  /** The subset of `others` whose value disagrees with the winner (estimates excluded). */
  conflictWith: StoredFact<T>[];
  /** True when the winner is a manual override. */
  overridden: boolean;
}

/** Keys that legitimately hold several simultaneous facts (never "conflicting"). */
export const MULTI_VALUED_FACT_KEYS: readonly FactKey[] = ['visa_signal', 'red_flags'];

/** 0 = most trusted. Unknown methods sort last. */
export function trustRank(method: Method | string): number {
  const i = TRUST_ORDER.indexOf(method as Method);
  return i === -1 ? TRUST_ORDER.length : i;
}

export function confidenceRank(c: Confidence | string): number {
  const i = CONFIDENCE_ORDER.indexOf(c as Confidence);
  return i === -1 ? CONFIDENCE_ORDER.length : i;
}

/** The lower of two confidences. */
export function minConfidence(a: Confidence, b: Confidence): Confidence {
  return confidenceRank(a) >= confidenceRank(b) ? a : b;
}

/** Downgrade confidence by `steps` levels (never below low). */
export function lowerConfidence(c: Confidence, steps = 1): Confidence {
  const i = Math.min(CONFIDENCE_ORDER.length - 1, confidenceRank(c) + steps);
  return CONFIDENCE_ORDER[i];
}
