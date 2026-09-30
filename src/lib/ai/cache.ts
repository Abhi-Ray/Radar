/**
 * Content-addressed AI cache (spec §15 "Cache by content, so the same text is never sent twice").
 * Key = sha256(content_hash | task | prompt_version); content_hash = sha256 of the exact
 * normalised text the job was checked against. A cached entry from another model is a miss (the
 * new answer then replaces it). What is cached is the schema-validated per-job answer; evidence
 * checks run again on every use.
 */
import { eq } from 'drizzle-orm';
import { aiCache } from '../../db/schema';
import type { DbOrTx } from '../db';
import { normalizeTextForHash, sha256Hex } from '../hash';

export function contentHashFor(text: string): string {
  return sha256Hex(normalizeTextForHash(text));
}

export function aiCacheKey(contentHash: string, task: string, promptVersion: string): string {
  return sha256Hex(`${contentHash}|${task}|${promptVersion}`);
}

export interface CachedAnswer {
  item: unknown;
  model: string | null;
  createdAt: Date;
}

export async function getCachedAnswer(db: DbOrTx, key: string, model: string): Promise<CachedAnswer | null> {
  const [row] = await db
    .select({ model: aiCache.model, responseJson: aiCache.responseJson, createdAt: aiCache.createdAt })
    .from(aiCache)
    .where(eq(aiCache.cacheKey, key))
    .limit(1);
  if (!row || (row.model ?? null) !== model) return null;
  return { item: row.responseJson, model: row.model, createdAt: row.createdAt };
}

export async function putCachedAnswer(
  db: DbOrTx,
  entry: { key: string; contentHash: string; task: string; promptVersion: string; model: string; item: unknown },
): Promise<void> {
  const value = JSON.parse(JSON.stringify(entry.item ?? null)) as unknown;
  await db
    .insert(aiCache)
    .values({
      cacheKey: entry.key,
      contentHash: entry.contentHash,
      task: entry.task.slice(0, 64),
      promptVersion: entry.promptVersion.slice(0, 64),
      model: entry.model.slice(0, 128),
      responseJson: value,
    })
    .onDuplicateKeyUpdate({ set: { model: entry.model.slice(0, 128), responseJson: value } });
}
