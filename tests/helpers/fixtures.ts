/**
 * Minimal row factories for DB-backed tests (use with startTestDb()). Each helper inserts only the
 * required columns plus what you pass; ids come back for chaining.
 *
 *   const { jobId, companyId, sourceId } = await seedJob(t.db, { countryIso2: 'DE' });
 */
import { eq } from 'drizzle-orm';
import { companies, countries, jobs, sourcePlatforms, sources } from '../../src/db/schema';
import type { DbOrTx } from '../../src/lib/db';
import { sha256Hex } from '../../src/lib/hash';

let counter = 0;
const uniq = () => `${Date.now().toString(36)}${(counter++).toString(36)}`;

export async function seedCountry(db: DbOrTx, iso2 = 'DE', name = iso2, tier = 1): Promise<string> {
  const [existing] = await db.select({ iso2: countries.iso2 }).from(countries).where(eq(countries.iso2, iso2)).limit(1);
  if (!existing) await db.insert(countries).values({ iso2, name, tier, currency: 'EUR' });
  return iso2;
}

export async function seedSource(db: DbOrTx, opts: { platformKey?: string; sourceKey?: string; label?: string } = {}): Promise<number> {
  const platformKey = opts.platformKey ?? 'greenhouse';
  const [p] = await db.select({ key: sourcePlatforms.key }).from(sourcePlatforms).where(eq(sourcePlatforms.key, platformKey)).limit(1);
  if (!p) await db.insert(sourcePlatforms).values({ key: platformKey, name: platformKey, grade: 'A', accessMethod: 'ats_json' });
  const sourceKey = opts.sourceKey ?? `${platformKey}:test-${uniq()}`;
  const [res] = await db.insert(sources).values({ sourceKey, platformKey, configJson: {}, label: opts.label ?? sourceKey });
  return Number(res.insertId);
}

export async function seedCompany(db: DbOrTx, name = `Acme ${uniq()}`): Promise<number> {
  const [res] = await db.insert(companies).values({ name, normalizedName: name.toLowerCase().slice(0, 191) });
  return Number(res.insertId);
}

export interface SeedJobOptions {
  title?: string;
  companyName?: string;
  countryIso2?: string | null;
  city?: string | null;
  descriptionText?: string;
  descriptionHtmlSanitized?: string | null;
  applyUrl?: string;
  withSource?: boolean;
}

export async function seedJob(
  db: DbOrTx,
  opts: SeedJobOptions = {},
): Promise<{ jobId: number; companyId: number; sourceId: number | null }> {
  const countryIso2 = opts.countryIso2 === null ? null : await seedCountry(db, opts.countryIso2 ?? 'DE');
  const companyId = await seedCompany(db, opts.companyName);
  const sourceId = opts.withSource === false ? null : await seedSource(db);
  const title = opts.title ?? 'Cloud Security Engineer';
  const description = opts.descriptionText ?? 'We are hiring a cloud security engineer.';
  const applyUrl = opts.applyUrl ?? `https://boards.example.test/jobs/${uniq()}`;
  const [res] = await db.insert(jobs).values({
    companyId,
    canonicalTitle: title,
    titleRaw: title,
    countryIso2,
    city: opts.city ?? null,
    locationRaw: opts.city ?? '',
    descriptionText: description,
    descriptionHtmlSanitized: opts.descriptionHtmlSanitized ?? null,
    descriptionHash: sha256Hex(description),
    applyUrl,
    applyUrlClean: applyUrl,
    applyUrlHash: sha256Hex(applyUrl),
    bestSourceId: sourceId,
  });
  return { jobId: Number(res.insertId), companyId, sourceId };
}
