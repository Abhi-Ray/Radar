/**
 * Pure fact resolution by trust order (spec §5). Manual overrides are turned into synthetic
 * 'manual' facts so the same resolver handles them: nothing lower can ever beat them.
 */
import {
  confidenceRank,
  FACT_KEYS,
  type Confidence,
  type FactKey,
  type ResolvedFact,
  type StoredFact,
  trustRank,
} from '../contracts/provenance';
import { hashJson } from '../hash';

export interface OverrideLike {
  id: number;
  field: string;
  valueJson: unknown;
  reason: string;
  createdAt: Date;
  active: boolean;
}

/** Override fields that map onto a fact key (the rest are plain job columns). */
export const FACT_OVERRIDE_FIELDS: readonly FactKey[] = [
  'visa_status',
  'salary',
  'experience',
  'seniority',
  'remote',
  'language',
  'closing_date',
  'role',
  'eligibility',
];

/** Plain job-column overrides: field → jobs column. */
export const COLUMN_OVERRIDE_FIELDS = {
  title: 'canonicalTitle',
  country: 'countryIso2',
  city: 'city',
  workplace_type: 'workplaceType',
} as const;
export type ColumnOverrideField = keyof typeof COLUMN_OVERRIDE_FIELDS;

export const OVERRIDE_FIELDS: readonly string[] = [...FACT_OVERRIDE_FIELDS, ...Object.keys(COLUMN_OVERRIDE_FIELDS)];

export function overrideToFact(o: OverrideLike): StoredFact | null {
  if (!(FACT_OVERRIDE_FIELDS as readonly string[]).includes(o.field)) return null;
  return {
    id: -o.id,
    key: o.field as FactKey,
    value: o.valueJson,
    valueHash: hashJson(o.valueJson),
    evidence: o.reason,
    source: 'manual override',
    method: 'manual',
    confidence: 'high',
    checkedAt: o.createdAt,
    logicVersion: 'manual',
    isActive: o.active,
    createdAt: o.createdAt,
  };
}

/** Best first: trust order, then confidence, then most recently checked, then newest id. */
export function compareFacts(a: StoredFact, b: StoredFact): number {
  return (
    trustRank(a.method) - trustRank(b.method) ||
    confidenceRank(a.confidence) - confidenceRank(b.confidence) ||
    b.checkedAt.getTime() - a.checkedAt.getTime() ||
    b.id - a.id
  );
}

export function resolveFact<T = unknown>(candidates: StoredFact<T>[]): ResolvedFact<T> {
  const active = candidates.filter((c) => c.isActive).sort(compareFacts as (a: StoredFact<T>, b: StoredFact<T>) => number);
  const winner = active[0] ?? null;
  const others = active.slice(1);
  const conflict = Boolean(
    winner && others.some((o) => o.valueHash !== winner.valueHash && o.method !== winner.method && o.method !== 'estimate'),
  );
  return { winner, conflict, others, overridden: winner?.method === 'manual' };
}

export type ResolvedFacts = Partial<Record<FactKey, ResolvedFact>>;

export function resolveJobFacts(facts: StoredFact[], overrides: OverrideLike[]): ResolvedFacts {
  const byKey = new Map<FactKey, StoredFact[]>();
  for (const f of facts) {
    if (!f.isActive) continue;
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  }
  for (const o of overrides) {
    if (!o.active) continue;
    const f = overrideToFact(o);
    if (!f) continue;
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  }
  const out: ResolvedFacts = {};
  for (const key of FACT_KEYS) {
    const list = byKey.get(key);
    if (list?.length) out[key] = resolveFact(list);
  }
  return out;
}

/** Lowest confidence among the given resolved winners (null when none). */
export function lowestConfidence(resolved: ResolvedFacts, keys: readonly FactKey[]): Confidence | null {
  let worst: Confidence | null = null;
  for (const k of keys) {
    const w = resolved[k]?.winner;
    if (!w) continue;
    if (worst === null || confidenceRank(w.confidence) > confidenceRank(worst)) worst = w.confidence;
  }
  return worst;
}
