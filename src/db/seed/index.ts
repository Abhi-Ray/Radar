/**
 * Reference-data seed (`npm run db:seed`, `radar-entrypoint seed`): countries and their guides,
 * visa routes with one UNVERIFIED rule version each, official page watches, source platforms,
 * trial sources, companies with aliases, kit starters (resumes, templates) and default settings.
 *
 * Idempotent: every row is found by its natural key and a repeat run changes nothing. Owner
 * decisions always win — the seed never overwrites:
 * - visa rules: a route's versions are only added to while every version is an unverified seed
 *   import; once the owner verified or added one, the seed stops touching that route's rules;
 * - platforms whose terms the owner reviewed (terms_reviewed_at set) or edited;
 * - sources whose status the owner changed (anything but 'trial') or whose notes they edited;
 * - resume versions and templates edited after creation (updated_at ≠ created_at), renamed or
 *   deleted (the seed remembers what it created through `seed.create` audit rows), or created by
 *   the owner under a starter's name;
 * - visa routes edited or deleted after the seed created them;
 * - existing settings rows, and each country's `is_live` flag.
 * Country guide columns (tier, notes, salary ranges, sites, CV conventions, language notes) are
 * seed-owned reference content with no owner edit path: they are refreshed when the data changes.
 *
 * When the seed refreshes a row it created and nobody edited, it writes created_at = updated_at =
 * now, so the row still reads as "untouched since the seed wrote it".
 *
 * Everything runs in one transaction under GET_LOCK('radar_seed') (held until after the commit):
 * a failed run leaves the database as it was, and two seeds never interleave.
 */
import { eq, sql } from 'drizzle-orm';
import {
  auditLog,
  companies,
  companyAliases,
  countries,
  officialPageWatches,
  resumeVersions,
  sourcePlatforms,
  sources,
  templates,
  visaRoutes,
  visaRuleVersions,
  type VisaRuleVersionRow,
} from '../schema';
import { SEED_COMPANIES, companyBoardSlug, companySource, type SeedCompany } from '../../data/seed/companies';
import { SEED_COUNTRIES } from '../../data/seed/countries';
import { SEED_PLATFORMS, SEED_SOURCES, type SeedSource } from '../../data/seed/sources';
import { SEED_RESUME_VERSIONS, SEED_TEMPLATES } from '../../data/seed/templates';
import { SEED_VISA_ROUTES, VISA_CHANGE_REASON, VISA_RESEARCH_DATE, type SeedVisaRoute, type SeedVisaRule } from '../../data/seed/visa';
import { audit } from '../../lib/audit';
import { isGenericDomain, normalizeDomain } from '../../lib/company/domain';
import { companyNameKeys, hasLegalSuffix, normalizeAtsSlug } from '../../lib/company/normalize';
import { getConnector } from '../../lib/connectors';
import { withTransaction, type Db, type Tx } from '../../lib/db';
import { canonicalJson, sha256Hex } from '../../lib/hash';
import { emptyChecklist } from '../../lib/pipeline/health';
import { ensureDefaultSettings } from '../../lib/settings';
import { addRuleVersion } from '../../lib/visa/rules';
import { MAX_KEPT_NOTES, emptySections, type SeedOutcome, type SeedSection, type SeedSummary } from './summary';

export * from './summary';

export const SEED_LOGIC_VERSION = 'seed@2026-09-30.1';
export const SEED_LOCK_NAME = 'radar_seed';
const SEED_LOCK_TIMEOUT_SEC = 30;
/** Audit action marking a row the seed created (its memory for renamed / deleted starters). */
export const SEED_CREATE_ACTION = 'seed.create';
/** Every seeded source's notes start with this; edited notes mean the owner took the row over. */
export const SEED_SOURCE_NOTES_PREFIX = 'Seeded ';
/** Reason of a rule version the seed adds when its research data changed before owner review. */
export const VISA_UPDATE_REASON = 'Research import update (seed data changed) — needs owner verification against the official page';
const MAX_COMPANY_DEPTH = 10;

export interface SeedOptions {
  /** Clock for created_at / next_review_at (tests). */
  now?: Date;
}

type SeedTx = Tx;

class SeedRun {
  readonly sections = emptySections();
  readonly keptNotes: string[] = [];
  /** `seed.create` audit rows: seed ref → entity id. */
  memory = new Map<string, string>();

  constructor(readonly now: Date) {}

  count(section: SeedSection, outcome: SeedOutcome, keptWhy?: string): void {
    this.sections[section][outcome] += 1;
    if (outcome === 'kept' && keptWhy && this.keptNotes.length < MAX_KEPT_NOTES) this.keptNotes.push(keptWhy);
  }
}

/** Seeds (or refreshes) the reference data. Safe to run any number of times, also concurrently. */
export async function seedDatabase(db: Db, opts: SeedOptions = {}): Promise<SeedSummary> {
  const started = Date.now();
  // DATETIME(3) keeps milliseconds: a whole-ms clock round-trips exactly (created_at = updated_at).
  const now = new Date(Math.floor((opts.now ?? new Date()).getTime()));
  const run = new SeedRun(now);
  const settingsCreated = await withSeedLock(db, () =>
    withTransaction(db, async (tx) => {
      run.memory = await loadSeedMemory(tx);
      await seedCountries(tx, run);
      const routes = await seedVisaRoutes(tx, run);
      await seedVisaRules(tx, run, routes);
      await seedPageWatches(tx, run, routes);
      await seedPlatforms(tx, run);
      const sourceKeys = new Set<string>();
      await seedSources(
        tx,
        run,
        SEED_SOURCES.map((source) => ({ source, companyId: null })),
        sourceKeys,
      );
      const companyIds = await seedCompanies(tx, run);
      await seedSources(
        tx,
        run,
        SEED_COMPANIES.map((c, i) => ({ source: companySource(c), companyId: companyIds[i] })),
        sourceKeys,
      );
      await seedResumeVersions(tx, run);
      await seedTemplates(tx, run);
      const created = await ensureDefaultSettings(tx);
      await audit(tx, {
        action: 'seed.run',
        entityType: 'seed',
        entityId: SEED_LOGIC_VERSION,
        after: { sections: run.sections, settingsCreated: created },
        reason: 'reference data seed',
        actor: 'cli',
      });
      return created;
    }),
  );
  return {
    startedAt: now.toISOString(),
    durationMs: Date.now() - started,
    sections: run.sections,
    settingsCreated: [...settingsCreated],
    keptNotes: run.keptNotes,
  };
}

// ---- helpers -------------------------------------------------------------------------------------

/**
 * Runs `fn` while holding GET_LOCK('radar_seed') on a connection of its own (an otherwise empty
 * transaction pins it). `fn` commits on another pooled connection BEFORE the lock is released, so a
 * waiting run starts reading only after this run's rows are committed — releasing inside the data
 * transaction would let it read a snapshot without them and hit duplicate keys. Needs a pool with
 * at least two connections (the app, CLI and test pools have 5–10).
 */
async function withSeedLock<T>(db: Db, fn: () => Promise<T>): Promise<T> {
  return db.transaction(async (lockTx) => {
    const [rows] = (await lockTx.execute(sql`SELECT GET_LOCK(${SEED_LOCK_NAME}, ${SEED_LOCK_TIMEOUT_SEC}) AS got`)) as unknown as [
      { got: number | string | null }[],
    ];
    if (Number(rows[0]?.got) !== 1) throw new Error('another seed run holds the seed lock; try again when it has finished');
    try {
      return await fn();
    } finally {
      await lockTx.execute(sql`SELECT RELEASE_LOCK(${SEED_LOCK_NAME})`);
    }
  });
}

/** Keys of `values` whose (canonical JSON) value differs from `row`. */
export function changedKeys<T extends Record<string, unknown>>(row: Record<string, unknown>, values: T): (keyof T & string)[] {
  return Object.keys(values).filter((k) => canonicalJson(row[k] ?? null) !== canonicalJson(values[k] ?? null)) as (keyof T & string)[];
}

/** Never edited since it was written: updated_at equals created_at. */
export function isPristine(row: { createdAt: Date; updatedAt: Date }): boolean {
  return row.createdAt.getTime() === row.updatedAt.getTime();
}

export function seedRef(kind: 'resume_version' | 'template' | 'visa_route', parts: readonly (string | null)[]): string {
  return `${kind}:${parts.map((p) => p ?? '-').join(':')}`;
}

function insertId(res: unknown): number {
  const id = Number((res as { insertId?: unknown }).insertId);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('insert returned no id');
  return id;
}

async function loadSeedMemory(tx: SeedTx): Promise<Map<string, string>> {
  const rows = await tx
    .select({ entityId: auditLog.entityId, afterJson: auditLog.afterJson })
    .from(auditLog)
    .where(eq(auditLog.action, SEED_CREATE_ACTION));
  const out = new Map<string, string>();
  for (const r of rows) {
    const ref = r.afterJson && typeof r.afterJson === 'object' ? (r.afterJson as Record<string, unknown>).seed : null;
    if (typeof ref === 'string' && r.entityId) out.set(ref, r.entityId);
  }
  return out;
}

async function remember(tx: SeedTx, run: SeedRun, entityType: string, entityId: number, ref: string): Promise<void> {
  await audit(tx, { action: SEED_CREATE_ACTION, entityType, entityId, after: { seed: ref }, reason: 'created by the reference data seed', actor: 'cli' });
  run.memory.set(ref, String(entityId));
}

// ---- countries ---------------------------------------------------------------------------------

async function seedCountries(tx: SeedTx, run: SeedRun): Promise<void> {
  const rows = new Map((await tx.select().from(countries)).map((r) => [r.iso2, r]));
  for (const c of SEED_COUNTRIES) {
    const values = {
      name: c.name,
      tier: c.tier,
      region: c.region,
      currency: c.currency,
      languagesJson: [...c.languages],
      notes: c.notes,
      salaryRangesJson: c.salaryRanges,
      bestSitesJson: c.bestSites,
      cvConventionsJson: c.cvConventions,
      languageNotes: c.languageNotes,
    };
    const row = rows.get(c.iso2);
    if (!row) {
      await tx.insert(countries).values({ iso2: c.iso2, ...values, isLive: false, createdAt: run.now, updatedAt: run.now });
      run.count('countries', 'inserted');
      continue;
    }
    const changed = changedKeys(row, values);
    if (!changed.length) {
      run.count('countries', 'unchanged');
      continue;
    }
    // Guide columns only: is_live is the owner's decision and is never touched.
    await tx.update(countries).set(values).where(eq(countries.iso2, c.iso2));
    await audit(tx, { action: 'seed.country.refresh', entityType: 'country', entityId: c.iso2, after: { changed }, reason: 'country guide data changed', actor: 'cli' });
    run.count('countries', 'updated');
  }
}

// ---- visa routes, rules, page watches ----------------------------------------------------------

interface SeededRoute {
  seed: SeedVisaRoute;
  id: number;
  isActive: boolean;
}

async function seedVisaRoutes(tx: SeedTx, run: SeedRun): Promise<SeededRoute[]> {
  const rows = new Map((await tx.select().from(visaRoutes)).map((r) => [`${r.countryIso2}:${r.code}`, r]));
  const out: SeededRoute[] = [];
  for (const r of SEED_VISA_ROUTES) {
    const ref = seedRef('visa_route', [r.countryIso2, r.code]);
    const values = { name: r.name, officialUrl: r.officialUrl, isActive: r.isActive, notes: r.notes };
    const row = rows.get(`${r.countryIso2}:${r.code}`);
    if (!row) {
      if (run.memory.has(ref)) {
        run.count('visaRoutes', 'kept', `visa route ${r.countryIso2} ${r.code}: deleted by the owner, not re-created`);
        continue;
      }
      const [res] = await tx.insert(visaRoutes).values({ countryIso2: r.countryIso2, code: r.code, ...values, createdAt: run.now, updatedAt: run.now });
      const id = insertId(res);
      await remember(tx, run, 'visa_route', id, ref);
      run.count('visaRoutes', 'inserted');
      out.push({ seed: r, id, isActive: r.isActive });
      continue;
    }
    out.push({ seed: r, id: row.id, isActive: row.isActive });
    const changed = changedKeys(row, values);
    if (!changed.length) run.count('visaRoutes', 'unchanged');
    else if (run.memory.get(ref) !== String(row.id) || !isPristine(row)) {
      run.count('visaRoutes', 'kept', `visa route ${r.countryIso2} ${r.code}: changed by the owner`);
    } else {
      await tx
        .update(visaRoutes)
        .set({ ...values, createdAt: run.now, updatedAt: run.now })
        .where(eq(visaRoutes.id, row.id));
      out[out.length - 1].isActive = r.isActive;
      run.count('visaRoutes', 'updated');
    }
  }
  return out;
}

function ruleValues(rule: SeedVisaRule) {
  return {
    effectiveFrom: rule.effectiveFrom,
    effectiveTo: null,
    salaryThresholdEur: rule.salaryThresholdEur,
    salaryThresholdLocal: rule.salaryThresholdLocal,
    currency: rule.currency,
    degreeRule: rule.degreeRule,
    experienceRule: rule.experienceRule,
    otherRulesJson: rule.otherRulesJson,
    ruleText: rule.ruleText,
    officialSourceUrl: rule.officialSourceUrl,
  };
}

/** A version the seed wrote and nobody verified. */
export function isSeedImportVersion(v: Pick<VisaRuleVersionRow, 'verificationStatus' | 'lastVerifiedAt' | 'verifiedBy' | 'changeReason'>): boolean {
  return (
    v.verificationStatus === 'unverified' &&
    v.lastVerifiedAt === null &&
    v.verifiedBy === null &&
    (v.changeReason === VISA_CHANGE_REASON || v.changeReason === VISA_UPDATE_REASON)
  );
}

async function seedVisaRules(tx: SeedTx, run: SeedRun, routes: readonly SeededRoute[]): Promise<void> {
  const all = await tx.select().from(visaRuleVersions);
  const byRoute = new Map<number, VisaRuleVersionRow[]>();
  for (const v of all) byRoute.set(v.routeId, [...(byRoute.get(v.routeId) ?? []), v]);
  for (const r of routes) {
    const list = byRoute.get(r.id) ?? [];
    const values = ruleValues(r.seed.rule);
    if (!list.length) {
      await addRuleVersion(tx, { routeId: r.id, ...values, changeReason: VISA_CHANGE_REASON, verified: false }, { actor: 'cli', now: run.now });
      run.count('visaRules', 'inserted');
      continue;
    }
    if (!list.every(isSeedImportVersion)) {
      run.count('visaRules', 'kept', `visa rules ${r.seed.countryIso2} ${r.seed.code}: verified or edited by the owner`);
      continue;
    }
    const latest = list.reduce((a, b) => (b.version > a.version ? b : a));
    if (!changedKeys(latest, values).length) {
      run.count('visaRules', 'unchanged');
      continue;
    }
    // Rules are never edited in place: the corrected research becomes a new (still unverified) version.
    await addRuleVersion(tx, { routeId: r.id, ...values, changeReason: VISA_UPDATE_REASON, verified: false }, { actor: 'cli', now: run.now });
    run.count('visaRules', 'updated');
  }
}

/** Official pages to watch, first route wins for a URL shared by several routes. */
export function seedWatchUrls(routes: readonly { seed: SeedVisaRoute; id: number; isActive: boolean }[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const r of routes) {
    if (!r.isActive) continue;
    for (const raw of [r.seed.officialUrl, r.seed.rule.officialSourceUrl, ...(r.seed.watchUrls ?? [])]) {
      const url = raw.trim();
      if (!/^https?:\/\//i.test(url) || out.has(url)) continue;
      out.set(url, r.id);
    }
  }
  return out;
}

async function seedPageWatches(tx: SeedTx, run: SeedRun, routes: readonly SeededRoute[]): Promise<void> {
  const existing = new Set((await tx.select({ urlHash: officialPageWatches.urlHash }).from(officialPageWatches)).map((w) => w.urlHash));
  for (const [url, routeId] of seedWatchUrls(routes)) {
    const urlHash = sha256Hex(url);
    if (existing.has(urlHash)) {
      run.count('pageWatches', 'unchanged');
      continue;
    }
    // Same shape as ensureOfficialPageWatches (src/lib/visa/rules.ts); a concurrent insert is left as it is.
    await tx
      .insert(officialPageWatches)
      .values({ url: url.slice(0, 2048), urlHash, routeId, createdAt: run.now })
      .onDuplicateKeyUpdate({ set: { urlHash: sql`${officialPageWatches.urlHash}` } });
    existing.add(urlHash);
    run.count('pageWatches', 'inserted');
  }
}

// ---- platforms and sources -----------------------------------------------------------------------

async function seedPlatforms(tx: SeedTx, run: SeedRun): Promise<void> {
  const rows = new Map((await tx.select().from(sourcePlatforms)).map((r) => [r.key, r]));
  for (const p of SEED_PLATFORMS) {
    const values = {
      name: p.name,
      grade: p.grade,
      accessMethod: p.accessMethod,
      termsUrl: p.termsUrl,
      termsStatus: p.termsStatus,
      termsNotes: p.termsNotes,
      rateLimitPerMin: p.rateLimitPerMin,
      dailyCap: p.dailyCap,
    };
    const row = rows.get(p.key);
    if (!row) {
      // terms_reviewed_at stays NULL: the build assistant's reading is not the owner's review.
      await tx.insert(sourcePlatforms).values({ key: p.key, ...values, termsReviewedAt: null, createdAt: run.now, updatedAt: run.now });
      run.count('platforms', 'inserted');
      continue;
    }
    const changed = changedKeys(row, values);
    if (!changed.length) run.count('platforms', 'unchanged');
    else if (row.termsReviewedAt !== null) run.count('platforms', 'kept', `platform ${p.key}: terms reviewed by the owner`);
    else if (!isPristine(row)) run.count('platforms', 'kept', `platform ${p.key}: edited by the owner`);
    else {
      await tx
        .update(sourcePlatforms)
        .set({ ...values, createdAt: run.now, updatedAt: run.now })
        .where(eq(sourcePlatforms.key, p.key));
      run.count('platforms', 'updated');
    }
  }
}

export interface ResolvedSeedSource {
  sourceKey: string;
  platformKey: string;
  config: Record<string, unknown>;
}

/** Validates a seed source against its connector and returns its natural key. Throws when invalid. */
export function resolveSeedSource(s: Pick<SeedSource, 'platformKey' | 'config' | 'label'>): ResolvedSeedSource {
  const platform = SEED_PLATFORMS.find((p) => p.key === s.platformKey);
  if (platform?.termsStatus === 'forbidden') throw new Error(`seed source "${s.label}" uses forbidden platform ${s.platformKey}`);
  const connector = getConnector(s.platformKey);
  if (!connector) throw new Error(`seed source "${s.label}": no connector for platform ${s.platformKey}`);
  const parsed = connector.configSchema.safeParse(s.config);
  if (!parsed.success) {
    throw new Error(`seed source "${s.label}": invalid config (${parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')})`);
  }
  const sourceKey = connector.sourceKeyFor(parsed.data);
  if (!sourceKey || sourceKey.length > 191) throw new Error(`seed source "${s.label}": bad source key`);
  return { sourceKey, platformKey: s.platformKey, config: s.config };
}

async function seedSources(
  tx: SeedTx,
  run: SeedRun,
  items: readonly { source: SeedSource; companyId: number | null }[],
  seen: Set<string>,
): Promise<void> {
  const rows = new Map((await tx.select().from(sources)).map((r) => [r.sourceKey, r]));
  for (const { source: s, companyId } of items) {
    const { sourceKey } = resolveSeedSource(s);
    if (seen.has(sourceKey)) throw new Error(`seed data lists source ${sourceKey} twice`);
    seen.add(sourceKey);
    const values = {
      platformKey: s.platformKey,
      configJson: s.config,
      label: s.label.slice(0, 191),
      countryIso2: s.countryIso2,
      notes: s.notes,
    };
    const row = rows.get(sourceKey);
    if (!row) {
      await tx.insert(sources).values({
        sourceKey,
        ...values,
        companyId,
        status: 'trial',
        checklistJson: emptyChecklist(),
        createdAt: run.now,
        updatedAt: run.now,
      });
      run.count('sources', 'inserted');
      continue;
    }
    if (row.status !== 'trial') {
      run.count('sources', 'kept', `source ${sourceKey}: status "${row.status}" set by the owner`);
      continue;
    }
    if (!(row.notes ?? '').startsWith(SEED_SOURCE_NOTES_PREFIX)) {
      run.count('sources', 'kept', `source ${sourceKey}: notes edited by the owner`);
      continue;
    }
    const patch: Partial<typeof values> & { companyId?: number } = {};
    for (const k of changedKeys(row, values)) Object.assign(patch, { [k]: values[k] });
    if (row.companyId === null && companyId !== null) patch.companyId = companyId;
    if (!Object.keys(patch).length) {
      run.count('sources', 'unchanged');
      continue;
    }
    await tx.update(sources).set(patch).where(eq(sources.id, row.id));
    run.count('sources', 'updated');
  }
}

// ---- companies ---------------------------------------------------------------------------------------

interface CompanyIndex {
  byId: Map<number, { id: number; domain: string | null; hqCountry: string | null; type: string; isAgency: boolean; mergedIntoId: number | null }>;
  byName: Map<string, number>;
  byDomain: Map<string, number>;
  bySlug: Map<string, number>;
  byAlias: Map<string, number>;
  aliases: Set<string>;
}

async function loadCompanyIndex(tx: SeedTx): Promise<CompanyIndex> {
  const rows = await tx
    .select({
      id: companies.id,
      normalizedName: companies.normalizedName,
      domain: companies.domain,
      hqCountry: companies.hqCountry,
      type: companies.type,
      isAgency: companies.isAgency,
      mergedIntoId: companies.mergedIntoId,
    })
    .from(companies)
    .orderBy(companies.id);
  const idx: CompanyIndex = { byId: new Map(), byName: new Map(), byDomain: new Map(), bySlug: new Map(), byAlias: new Map(), aliases: new Set() };
  for (const r of rows) {
    idx.byId.set(r.id, r);
    if (r.mergedIntoId !== null) continue;
    if (!idx.byName.has(r.normalizedName)) idx.byName.set(r.normalizedName, r.id);
    if (r.domain && !idx.byDomain.has(r.domain)) idx.byDomain.set(r.domain, r.id);
  }
  const aliasRows = await tx
    .select({ companyId: companyAliases.companyId, normalizedAlias: companyAliases.normalizedAlias, kind: companyAliases.kind })
    .from(companyAliases)
    .orderBy(companyAliases.id);
  for (const a of aliasRows) {
    idx.aliases.add(aliasKey(a.companyId, a.normalizedAlias, a.kind));
    const map = a.kind === 'ats_slug' ? idx.bySlug : idx.byAlias;
    if (!map.has(a.normalizedAlias)) map.set(a.normalizedAlias, a.companyId);
  }
  return idx;
}

function aliasKey(companyId: number, normalizedAlias: string, kind: string): string {
  return `${companyId}|${kind}|${normalizedAlias}`;
}

/** Follows merged_into_id to the surviving record. */
function canonical(idx: CompanyIndex, id: number): number {
  let cur = id;
  for (let i = 0; i < MAX_COMPANY_DEPTH; i++) {
    const next = idx.byId.get(cur)?.mergedIntoId ?? null;
    if (next === null || next === cur) return cur;
    cur = next;
  }
  return cur;
}

export interface SeedCompanyKeys {
  slugKey: string | null;
  nameKeys: string[];
  domain: string | null;
  aliases: { alias: string; normalizedAlias: string; kind: 'brand' | 'legal' | 'ats_slug' }[];
}

/** Lookup keys and aliases of a seed company, in the forms the company resolver stores. */
export function seedCompanyKeys(c: SeedCompany): SeedCompanyKeys {
  const slugKey = normalizeAtsSlug(companyBoardSlug(c), c.platform);
  const nameKeys = companyNameKeys(c.name).filter(Boolean);
  const aliases: SeedCompanyKeys['aliases'] = [];
  const add = (alias: string, normalizedAlias: string, kind: 'brand' | 'legal' | 'ats_slug') => {
    const n = normalizedAlias.slice(0, 191);
    if (n && !aliases.some((a) => a.normalizedAlias === n && a.kind === kind)) aliases.push({ alias: alias.slice(0, 255), normalizedAlias: n, kind });
  };
  for (const k of nameKeys) add(c.name, k, hasLegalSuffix(c.name) ? 'legal' : 'brand');
  for (const a of c.aliases) for (const k of companyNameKeys(a.alias)) add(a.alias, k, a.kind);
  if (slugKey) add(slugKey, slugKey, 'ats_slug');
  const domain = normalizeDomain(c.domain);
  return { slugKey, nameKeys, domain: domain && !isGenericDomain(domain) ? domain : null, aliases };
}

function companyNote(c: SeedCompany): string {
  return `Seeded ${VISA_RESEARCH_DATE}: public ${c.platform} career board "${companyBoardSlug(c)}" answered with ${c.check.jobs} open postings when the build assistant checked it. HQ country and company type are the assistant's best knowledge, not verified.`;
}

/** Finds or creates each seed company (plus its aliases); returns the company ids in seed order. */
async function seedCompanies(tx: SeedTx, run: SeedRun): Promise<number[]> {
  const idx = await loadCompanyIndex(tx);
  const ids: number[] = [];
  for (const c of SEED_COMPANIES) {
    const keys = seedCompanyKeys(c);
    let found: number | undefined = keys.slugKey ? idx.bySlug.get(keys.slugKey) : undefined;
    for (const k of keys.nameKeys) found ??= idx.byName.get(k) ?? idx.byAlias.get(k);
    if (found === undefined && keys.domain) found = idx.byDomain.get(keys.domain);
    let id: number;
    if (found === undefined) {
      const [res] = await tx.insert(companies).values({
        name: c.name.slice(0, 255),
        normalizedName: (keys.nameKeys[0] ?? c.name.toLowerCase()).slice(0, 191),
        domain: keys.domain,
        hqCountry: c.hqCountry,
        type: c.type,
        isAgency: c.type === 'agency',
        notes: companyNote(c),
        createdAt: run.now,
        updatedAt: run.now,
      });
      id = insertId(res);
      idx.byId.set(id, { id, domain: keys.domain, hqCountry: c.hqCountry, type: c.type, isAgency: c.type === 'agency', mergedIntoId: null });
      for (const k of keys.nameKeys) if (!idx.byName.has(k)) idx.byName.set(k, id);
      if (keys.domain && !idx.byDomain.has(keys.domain)) idx.byDomain.set(keys.domain, id);
      run.count('companies', 'inserted');
    } else {
      id = canonical(idx, found);
      const row = idx.byId.get(id);
      // Only fills gaps (a company first seen by the pipeline); never overwrites a known value.
      const patch: { domain?: string; hqCountry?: string; type?: SeedCompany['type'] } = {};
      if (row && !row.domain && keys.domain) {
        const taken = idx.byDomain.get(keys.domain);
        if (taken === undefined || taken === id) patch.domain = keys.domain;
      }
      if (row && !row.hqCountry && c.hqCountry) patch.hqCountry = c.hqCountry;
      if (row && row.type === 'unknown' && !row.isAgency && c.type !== 'unknown' && c.type !== 'agency') patch.type = c.type;
      if (row && Object.keys(patch).length) {
        await tx.update(companies).set(patch).where(eq(companies.id, id));
        Object.assign(row, patch);
        if (patch.domain) idx.byDomain.set(patch.domain, id);
        run.count('companies', 'updated');
      } else run.count('companies', 'unchanged');
    }
    ids.push(id);
    for (const a of keys.aliases) {
      const k = aliasKey(id, a.normalizedAlias, a.kind);
      if (idx.aliases.has(k)) {
        run.count('companyAliases', 'unchanged');
        continue;
      }
      // Same upsert as the company resolver: the unique (company, alias, kind) row is never duplicated.
      await tx
        .insert(companyAliases)
        .values({ companyId: id, alias: a.alias, normalizedAlias: a.normalizedAlias, kind: a.kind, countryIso2: null })
        .onDuplicateKeyUpdate({ set: { alias: sql`${companyAliases.alias}` } });
      idx.aliases.add(k);
      const map = a.kind === 'ats_slug' ? idx.bySlug : idx.byAlias;
      if (!map.has(a.normalizedAlias)) map.set(a.normalizedAlias, id);
      run.count('companyAliases', 'inserted');
    }
  }
  return ids;
}

// ---- application kit -------------------------------------------------------------------------------

async function seedResumeVersions(tx: SeedTx, run: SeedRun): Promise<void> {
  const rows = await tx.select().from(resumeVersions).orderBy(resumeVersions.id);
  for (const r of SEED_RESUME_VERSIONS) {
    const ref = seedRef('resume_version', [r.track, r.name]);
    const row = rows.find((x) => x.track === r.track && x.name === r.name);
    const values = { contentMd: r.contentMd, fileNote: r.fileNote };
    if (!row) {
      if (run.memory.has(ref)) {
        run.count('resumeVersions', 'kept', `resume "${r.name}": renamed or deleted by the owner, not re-created`);
        continue;
      }
      const [res] = await tx.insert(resumeVersions).values({ name: r.name, track: r.track, ...values, createdAt: run.now, updatedAt: run.now });
      await remember(tx, run, 'resume_version', insertId(res), ref);
      run.count('resumeVersions', 'inserted');
      continue;
    }
    await refreshStarter(run, 'resumeVersions', ref, row, values, `resume "${r.name}"`, (set) =>
      tx.update(resumeVersions).set(set).where(eq(resumeVersions.id, row.id)),
    );
  }
}

async function seedTemplates(tx: SeedTx, run: SeedRun): Promise<void> {
  const rows = await tx.select().from(templates).orderBy(templates.id);
  for (const t of SEED_TEMPLATES) {
    const ref = seedRef('template', [t.kind, t.countryIso2, t.name]);
    const row = rows.find((x) => x.kind === t.kind && x.name === t.name && (x.countryIso2 ?? null) === t.countryIso2);
    const values = { bodyMd: t.bodyMd, fieldsJson: t.fields as unknown[] | null };
    if (!row) {
      if (run.memory.has(ref)) {
        run.count('templates', 'kept', `template "${t.name}": renamed or deleted by the owner, not re-created`);
        continue;
      }
      const [res] = await tx.insert(templates).values({ kind: t.kind, name: t.name, countryIso2: t.countryIso2, ...values, createdAt: run.now, updatedAt: run.now });
      await remember(tx, run, 'template', insertId(res), ref);
      run.count('templates', 'inserted');
      continue;
    }
    await refreshStarter(run, 'templates', ref, row, values, `template "${t.name}"`, (set) =>
      tx.update(templates).set(set).where(eq(templates.id, row.id)),
    );
  }
}

/** Existing starter row: refreshed only when the seed created it and nobody edited it since. */
async function refreshStarter<V extends Record<string, unknown>>(
  run: SeedRun,
  section: 'resumeVersions' | 'templates',
  ref: string,
  row: { id: number; createdAt: Date; updatedAt: Date } & Record<string, unknown>,
  values: V,
  what: string,
  update: (set: V & { createdAt: Date; updatedAt: Date }) => Promise<unknown>,
): Promise<void> {
  if (!changedKeys(row, values).length) {
    run.count(section, 'unchanged');
    return;
  }
  if (run.memory.get(ref) !== String(row.id)) {
    run.count(section, 'kept', `${what}: the owner's own row under a starter's name`);
    return;
  }
  if (!isPristine(row)) {
    run.count(section, 'kept', `${what}: edited by the owner`);
    return;
  }
  await update({ ...values, createdAt: run.now, updatedAt: run.now });
  run.count(section, 'updated');
}

