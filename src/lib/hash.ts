/** Deterministic hashing helpers (sha256 hex) with canonical JSON (sorted keys). */
import { createHash } from 'node:crypto';

export function sha256Hex(input: string | Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}

/** JSON with object keys sorted recursively; Dates as ISO strings; undefined dropped. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (value === null || value === undefined) return value ?? null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => (v === undefined ? null : sortValue(v)));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = sortValue(v);
    }
    return out;
  }
  return value;
}

export function hashJson(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

/** Normalise free text for hashing/comparison: lowercase, collapse whitespace, strip punctuation runs. */
export function normalizeTextForHash(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}
