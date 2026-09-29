/**
 * Pure fact resolution by trust order (spec §5):
 *   manual → official → posting → rule → ai → estimate.
 * A lower level never overrides a higher one, whatever its confidence or age. Within one level:
 * higher confidence, then most recently checked, then newest row.
 *
 * Manual overrides (job_overrides) become synthetic 'manual' facts, so the same resolver handles
 * them and nothing can beat them. Conflicts compare the MEANING of values (e.g. the visa status,
 * not the reasons text), so re-worded evidence is not a conflict.
 */
import {
  confidenceRank,
  FACT_KEYS,
  MULTI_VALUED_FACT_KEYS,
  type Confidence,
  type FactKey,
  type ResolvedFact,
  type StoredFact,
  trustRank,
} from '../contracts/provenance';
import { canonicalJson, hashJson } from '../hash';

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
  'skills',
  'eligibility',
  'suspicious',
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

export function isFactOverrideField(field: string): field is FactKey {
  return (FACT_OVERRIDE_FIELDS as readonly string[]).includes(field);
}

export function isColumnOverrideField(field: string): field is ColumnOverrideField {
  return Object.prototype.hasOwnProperty.call(COLUMN_OVERRIDE_FIELDS, field);
}

export const MANUAL_OVERRIDE_SOURCE = 'manual override';
export const MANUAL_LOGIC_VERSION = 'manual';

export function overrideToFact(o: OverrideLike): StoredFact | null {
  if (!isFactOverrideField(o.field)) return null;
  return {
    // Negative ids keep synthetic facts distinguishable from job_facts rows.
    id: -o.id,
    key: o.field,
    value: o.valueJson,
    valueHash: hashJson(o.valueJson),
    evidence: o.reason,
    source: MANUAL_OVERRIDE_SOURCE,
    method: 'manual',
    confidence: 'high',
    checkedAt: o.createdAt,
    logicVersion: MANUAL_LOGIC_VERSION,
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

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function roundTo(n: unknown, step: number): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n / step) * step : null;
}

function sortedStrings(v: unknown): string[] | null {
  return Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.toLowerCase()))].sort() : null;
}

/**
 * The part of a fact value that carries its meaning, per key. Two facts conflict only when their
 * projections differ. Unknown shapes fall back to the whole value.
 */
export function factMeaning(key: FactKey, value: unknown): unknown {
  const o = obj(value);
  switch (key) {
    case 'visa_status':
      return o ? o.status : value;
    case 'remote':
      return o ? o.class : value;
    case 'language':
      return o ? o.requirement : value;
    case 'eligibility':
      return o ? o.result : value;
    case 'seniority':
      return o ? o.word : value;
    case 'role':
      return o ? [o.roleKey ?? null, o.roleFamily ?? null] : value;
    case 'experience':
      return o ? [o.minYears ?? null, o.maxYears ?? null] : value;
    case 'salary': {
      if (!o) return value;
      const eurMin = roundTo(o.annualEurMin, 500);
      const eurMax = roundTo(o.annualEurMax, 500);
      if (eurMin !== null || eurMax !== null) return ['eur', eurMin, eurMax];
      return ['raw', o.min ?? null, o.max ?? null, o.currency ?? null, o.period ?? null];
    }
    case 'closing_date': {
      const s = typeof value === 'string' ? value : o && typeof o.date === 'string' ? o.date : null;
      return s ? s.slice(0, 10) : value;
    }
    case 'skills':
      return o ? sortedStrings(o.found) ?? sortedStrings(o.matched) : sortedStrings(value) ?? value;
    default:
      return value;
  }
}

export function sameMeaning(key: FactKey, a: StoredFact, b: StoredFact): boolean {
  if (a.valueHash && a.valueHash === b.valueHash) return true;
  return canonicalJson(factMeaning(key, a.value)) === canonicalJson(factMeaning(key, b.value));
}

export function resolveFact<T = unknown>(candidates: StoredFact<T>[]): ResolvedFact<T> {
  const active = candidates
    .filter((c) => c.isActive)
    .sort(compareFacts as (a: StoredFact<T>, b: StoredFact<T>) => number);
  const winner = active[0] ?? null;
  const others = active.slice(1);
  if (!winner) return { winner: null, conflict: false, others: [], conflictWith: [], overridden: false };
  const multi = (MULTI_VALUED_FACT_KEYS as readonly string[]).includes(winner.key);
  const conflictWith = multi
    ? []
    : others.filter((o) => o.method !== 'estimate' && !sameMeaning(winner.key, winner as StoredFact, o as StoredFact));
  const overridden = winner.method === 'manual';
  return { winner, conflict: !overridden && conflictWith.length > 0, others, conflictWith, overridden };
}

export type ResolvedFacts = Partial<Record<FactKey, ResolvedFact>>;

export function resolveJobFacts(facts: StoredFact[], overrides: OverrideLike[]): ResolvedFacts {
  const byKey = new Map<FactKey, StoredFact[]>();
  const push = (f: StoredFact) => {
    const list = byKey.get(f.key) ?? [];
    list.push(f);
    byKey.set(f.key, list);
  };
  for (const f of facts) if (f.isActive) push(f);
  for (const o of overrides) {
    if (!o.active) continue;
    const f = overrideToFact(o);
    if (f) push(f);
  }
  const out: ResolvedFacts = {};
  for (const key of FACT_KEYS) {
    const list = byKey.get(key);
    if (list?.length) out[key] = resolveFact(list);
  }
  return out;
}

/** Active column overrides (latest per field) → { title, country, city, workplace_type }. */
export function columnOverrides(overrides: OverrideLike[]): Partial<Record<ColumnOverrideField, unknown>> {
  const out: Partial<Record<ColumnOverrideField, { at: number; id: number; value: unknown }>> = {};
  for (const o of overrides) {
    if (!o.active || !isColumnOverrideField(o.field)) continue;
    const cur = out[o.field];
    const at = o.createdAt.getTime();
    if (!cur || at > cur.at || (at === cur.at && o.id > cur.id)) out[o.field] = { at, id: o.id, value: o.valueJson };
  }
  const result: Partial<Record<ColumnOverrideField, unknown>> = {};
  for (const [k, v] of Object.entries(out)) if (v) result[k as ColumnOverrideField] = v.value;
  return result;
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
