/** Small zod + JSON-schema helpers shared by the task prompts (kept in lock-step by tests). */
import { z } from 'zod';

/** A number, or a plain numeric string ("3", "60000") — nothing else. */
export function num(min: number, max: number) {
  return z
    .union([z.number(), z.string().trim().regex(/^\d{1,9}(?:\.\d{1,4})?$/).transform(Number)])
    .pipe(z.number().finite().min(min).max(max));
}

export const quoteSchema = z.string().min(1).max(2000);

/** Batch-local id echoed back by the model. */
export const itemIdSchema = z.string().trim().min(1).max(32);

/** Missing/null array → []. */
export function list<T extends z.ZodType>(item: T, max: number) {
  return z.preprocess((v) => (v === undefined || v === null ? [] : v), z.array(item).max(max));
}

/** Missing → null. */
export function nullableObject<T extends z.ZodType>(schema: T) {
  return z.preprocess((v) => (v === undefined ? null : v), schema.nullable());
}

export type JsonSchema = Record<string, unknown>;

export const jsonQuote: JsonSchema = {
  type: 'string',
  description: 'Exact copy of the posting text that states this (8-300 characters, original language).',
};

export function jsonNullableObject(properties: Record<string, JsonSchema>, required: string[], description?: string): JsonSchema {
  return { type: ['object', 'null'], ...(description ? { description } : {}), properties, required, additionalProperties: false };
}

export function jsonObject(properties: Record<string, JsonSchema>, required: string[], description?: string): JsonSchema {
  return { type: 'object', ...(description ? { description } : {}), properties, required, additionalProperties: false };
}

/** Tool parameters: {results: [item, …]} — one item per posting id. */
export function resultsParameters(item: JsonSchema): JsonSchema {
  return jsonObject({ results: { type: 'array', description: 'One entry per posting id, in any order.', items: item } }, ['results']);
}
