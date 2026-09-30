/**
 * Structural validation of a model answer (spec §15.1 "Anything else is thrown away"): the
 * arguments must be {results: [...]}; each result must pass its task's zod schema and name a
 * posting id of this batch. Anything else is discarded and counted. Quote/evidence checks come
 * after this (apply.ts).
 */
import { z } from 'zod';

export interface BatchParse<T> {
  items: Map<string, T>;
  /** Results that failed the schema. */
  invalidItems: number;
  /** Results for ids that were not in the batch (ignored). */
  unknownIds: number;
  duplicates: number;
  /** Set when the whole answer is unusable. */
  error: string | null;
  /** First few schema problems (for logs; never contains posting text). */
  issues: string[];
}

const envelope = z.object({ results: z.array(z.unknown()) });

function asEnvelope(args: unknown): unknown {
  if (Array.isArray(args)) return { results: args };
  if (args && typeof args === 'object' && !('results' in (args as object)) && 'id' in (args as object)) return { results: [args] };
  return args;
}

export function parseBatchOutput<T extends { id: string }>(schema: z.ZodType<T>, args: unknown, ids: readonly string[]): BatchParse<T> {
  const out: BatchParse<T> = { items: new Map(), invalidItems: 0, unknownIds: 0, duplicates: 0, error: null, issues: [] };
  if (args === null || args === undefined) {
    out.error = 'no structured answer';
    return out;
  }
  const env = envelope.safeParse(asEnvelope(args));
  if (!env.success) {
    out.error = 'answer is not {results: [...]}';
    return out;
  }
  const allowed = new Set(ids);
  const max = Math.max(ids.length * 3, 10);
  for (const raw of env.data.results.slice(0, max)) {
    const r = schema.safeParse(raw);
    if (!r.success) {
      out.invalidItems++;
      if (out.issues.length < 5) {
        out.issues.push(r.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; '));
      }
      continue;
    }
    const id = r.data.id.trim();
    if (!allowed.has(id)) {
      out.unknownIds++;
      continue;
    }
    if (out.items.has(id)) {
      out.duplicates++;
      continue;
    }
    out.items.set(id, r.data);
  }
  if (env.data.results.length > max) out.invalidItems += env.data.results.length - max;
  if (!out.items.size) out.error = out.invalidItems ? 'every result failed validation' : 'no result for any posting of the batch';
  return out;
}
