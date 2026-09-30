/**
 * Country visa rules knowledge base (spec §13.1).
 *
 * - Rules are versioned rows (visa_rule_versions). The rule in effect on a day is the one with the
 *   latest `effective_from` ≤ day (and `effective_to`, inclusive, not before the day); ties go to
 *   the higher version. Old versions are never edited, so "what was true on any date" is exact.
 * - A rule not verified in over 90 days — or never verified — is STALE and must show a warning on
 *   every job in that country (and makes the eligibility check "borderline" at best).
 * - checkOfficialPages() watches the official immigration pages. When the page text changes it
 *   marks the watch `changed` and raises "page changed, please review". It NEVER rewrites rules;
 *   a human records a new rule version with addRuleVersion().
 * - Every rule change (created / verified / page_changed) is logged in visa_rule_changes and in the
 *   audit log.
 */
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  officialPageWatches,
  visaRoutes,
  visaRuleChanges,
  visaRuleVersions,
  type OfficialPageWatchRow,
  type VisaRouteRow,
  type VisaRuleVersionRow,
} from '../../db/schema';
import { raiseAlert } from '../alerts';
import { audit, type AuditInput } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { normalizeTextForHash, sha256Hex } from '../hash';
import { safeFetch as defaultSafeFetch, type SafeFetchOptions, type SafeFetchResponse } from '../security/safe-fetch';
import { htmlToPlainText } from '../security/sanitize';
import { DAY_MS, utcDay } from '../time';

export const VISA_RULES_LOGIC_VERSION = 'visa-rules@2026-09-30.1';
/** Spec §13.1: a rule not verified for longer than this is stale. */
export const RULE_STALE_DAYS = 90;

type RuleDates = Pick<VisaRuleVersionRow, 'effectiveFrom' | 'effectiveTo' | 'version'>;
type RuleVerification = Pick<VisaRuleVersionRow, 'verificationStatus' | 'lastVerifiedAt' | 'nextReviewAt'>;

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

function toDay(at: Date | string): string {
  if (typeof at === 'string') {
    if (!DAY_RE.test(at)) throw new RangeError(`expected YYYY-MM-DD, got ${at}`);
    return at;
  }
  return utcDay(at);
}

/** The version in effect on `day` ('YYYY-MM-DD' or Date, UTC) among `versions` (null: none yet). */
export function ruleInEffect<T extends RuleDates>(versions: readonly T[], at: Date | string): T | null {
  const day = toDay(at);
  let best: T | null = null;
  for (const v of versions) {
    const from = v.effectiveFrom ?? '0000-01-01';
    if (from > day) continue;
    if (v.effectiveTo && v.effectiveTo < day) continue;
    if (!best) {
      best = v;
      continue;
    }
    const bestFrom = best.effectiveFrom ?? '0000-01-01';
    if (from > bestFrom || (from === bestFrom && v.version > best.version)) best = v;
  }
  return best;
}

export interface RuleFreshness {
  /** Never verified, or last verified more than RULE_STALE_DAYS ago. */
  stale: boolean;
  neverVerified: boolean;
  daysSinceVerified: number | null;
  /** next_review_at has passed (a softer reminder than `stale`). */
  reviewDue: boolean;
  /** Human warning shown on jobs (null when fresh). */
  warning: string | null;
}

export function ruleFreshness(rule: RuleVerification, now: Date): RuleFreshness {
  const verifiedAt = rule.verificationStatus === 'verified' ? rule.lastVerifiedAt : null;
  const reviewDue = rule.nextReviewAt !== null && rule.nextReviewAt.getTime() < now.getTime();
  if (!verifiedAt) {
    return { stale: true, neverVerified: true, daysSinceVerified: null, reviewDue, warning: 'Rule never verified against the official source.' };
  }
  const days = Math.floor((now.getTime() - verifiedAt.getTime()) / DAY_MS);
  const stale = days > RULE_STALE_DAYS;
  let warning: string | null = null;
  if (stale) warning = `Rule last verified ${utcDay(verifiedAt)} (${days} days ago) — re-check the official source.`;
  else if (reviewDue) warning = `Rule review was due ${utcDay(rule.nextReviewAt!)}.`;
  return { stale, neverVerified: false, daysSinceVerified: days, reviewDue, warning };
}

export function isRuleStale(rule: RuleVerification, now: Date): boolean {
  return ruleFreshness(rule, now).stale;
}

/** Short label of a rule version, e.g. 'DE eu_blue_card v2'. */
export function describeRule(route: Pick<VisaRouteRow, 'countryIso2' | 'code'>, rule: Pick<VisaRuleVersionRow, 'version'>): string {
  return `${route.countryIso2} ${route.code} v${rule.version}`;
}

// ---- reads ---------------------------------------------------------------------------------

export async function getRuleVersions(db: DbOrTx, routeId: number): Promise<VisaRuleVersionRow[]> {
  return db.select().from(visaRuleVersions).where(eq(visaRuleVersions.routeId, routeId)).orderBy(asc(visaRuleVersions.version));
}

/** The rule of a route that was in effect on `at` (Date → its UTC day, or 'YYYY-MM-DD'). */
export async function ruleAsOf(db: DbOrTx, routeId: number, at: Date | string): Promise<VisaRuleVersionRow | null> {
  return ruleInEffect(await getRuleVersions(db, routeId), at);
}

/** The rule of a route in effect today. */
export async function currentRule(db: DbOrTx, routeId: number, now: Date = new Date()): Promise<VisaRuleVersionRow | null> {
  return ruleAsOf(db, routeId, now);
}

export interface CountryRule {
  route: VisaRouteRow;
  rule: VisaRuleVersionRow | null;
  freshness: RuleFreshness | null;
  label: string | null;
}

/** Every active route of a country with its current rule. */
export async function currentRulesForCountry(db: DbOrTx, countryIso2: string, now: Date = new Date()): Promise<CountryRule[]> {
  const iso = countryIso2.toUpperCase();
  const routes = await db
    .select()
    .from(visaRoutes)
    .where(and(eq(visaRoutes.countryIso2, iso), eq(visaRoutes.isActive, true)))
    .orderBy(asc(visaRoutes.id));
  if (!routes.length) return [];
  const versions = await db
    .select()
    .from(visaRuleVersions)
    .innerJoin(visaRoutes, eq(visaRuleVersions.routeId, visaRoutes.id))
    .where(and(eq(visaRoutes.countryIso2, iso), eq(visaRoutes.isActive, true)));
  return routes.map((route) => {
    const rule = ruleInEffect(
      versions.filter((v) => v.visa_rule_versions.routeId === route.id).map((v) => v.visa_rule_versions),
      now,
    );
    return { route, rule, freshness: rule ? ruleFreshness(rule, now) : null, label: rule ? describeRule(route, rule) : null };
  });
}

/**
 * Stale-rule warnings per country (ISO2 → warnings), for the "rule not verified" banner on every
 * job of that country. Countries whose current rules are all fresh are absent.
 */
export async function staleRuleWarnings(db: DbOrTx, now: Date = new Date()): Promise<Record<string, string[]>> {
  const rows = await db
    .select()
    .from(visaRuleVersions)
    .innerJoin(visaRoutes, eq(visaRuleVersions.routeId, visaRoutes.id))
    .where(eq(visaRoutes.isActive, true));
  const byRoute = new Map<number, { route: VisaRouteRow; versions: VisaRuleVersionRow[] }>();
  for (const r of rows) {
    const entry = byRoute.get(r.visa_routes.id) ?? { route: r.visa_routes, versions: [] };
    entry.versions.push(r.visa_rule_versions);
    byRoute.set(r.visa_routes.id, entry);
  }
  const out: Record<string, string[]> = {};
  for (const { route, versions } of byRoute.values()) {
    const rule = ruleInEffect(versions, now);
    if (!rule) continue;
    const f = ruleFreshness(rule, now);
    if (!f.stale) continue;
    (out[route.countryIso2] ??= []).push(`${route.name}: ${f.warning}`);
  }
  return out;
}

// ---- changes -------------------------------------------------------------------------------

export interface NewRuleVersionInput {
  routeId: number;
  effectiveFrom: string;
  effectiveTo?: string | null;
  salaryThresholdEur?: number | null;
  salaryThresholdLocal?: number | null;
  currency?: string | null;
  degreeRule?: string | null;
  experienceRule?: string | null;
  otherRulesJson?: unknown;
  ruleText?: string | null;
  officialSourceUrl?: string | null;
  /** Why the rule changed (required: every change is logged with a reason). */
  changeReason: string;
  /** Record as verified now (the admin checked the official source while entering it). */
  verified?: boolean;
  verifiedBy?: string | null;
}

export interface ActorOpts {
  actor?: AuditInput['actor'];
  now?: Date;
}

const REVIEW_INTERVAL_DAYS = RULE_STALE_DAYS;

/** Adds a new rule version (never edits an old one) and logs the change. */
export async function addRuleVersion(db: DbOrTx, input: NewRuleVersionInput, opts: ActorOpts = {}): Promise<{ id: number; version: number }> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? 'admin';
  if (!DAY_RE.test(input.effectiveFrom)) throw new RangeError('effectiveFrom must be YYYY-MM-DD');
  if (input.effectiveTo && (!DAY_RE.test(input.effectiveTo) || input.effectiveTo < input.effectiveFrom)) {
    throw new RangeError('effectiveTo must be YYYY-MM-DD and not before effectiveFrom');
  }
  const reason = input.changeReason.trim();
  if (!reason) throw new RangeError('changeReason is required');
  return withTransaction(db, async (tx) => {
    const [route] = await tx.select().from(visaRoutes).where(eq(visaRoutes.id, input.routeId)).limit(1).for('update');
    if (!route) throw new RangeError(`visa route ${input.routeId} not found`);
    const [last] = await tx
      .select({ version: visaRuleVersions.version })
      .from(visaRuleVersions)
      .where(eq(visaRuleVersions.routeId, input.routeId))
      .orderBy(desc(visaRuleVersions.version))
      .limit(1);
    const version = (last?.version ?? 0) + 1;
    const row = {
      routeId: input.routeId,
      version,
      effectiveFrom: input.effectiveFrom,
      effectiveTo: input.effectiveTo ?? null,
      salaryThresholdEur: input.salaryThresholdEur ?? null,
      salaryThresholdLocal: input.salaryThresholdLocal ?? null,
      currency: input.currency ? input.currency.toUpperCase().slice(0, 3) : null,
      degreeRule: input.degreeRule ?? null,
      experienceRule: input.experienceRule ?? null,
      otherRulesJson: input.otherRulesJson ?? null,
      ruleText: input.ruleText ?? null,
      officialSourceUrl: input.officialSourceUrl ?? route.officialUrl ?? null,
      verificationStatus: input.verified ? ('verified' as const) : ('unverified' as const),
      lastVerifiedAt: input.verified ? now : null,
      nextReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS),
      verifiedBy: input.verified ? (input.verifiedBy ?? actor) : null,
      changeReason: reason,
    };
    const [res] = await tx.insert(visaRuleVersions).values(row);
    const id = Number(res.insertId);
    await tx.insert(visaRuleChanges).values({
      routeId: input.routeId,
      ruleVersionId: id,
      changeKind: 'created',
      what: `${describeRule(route, { version })} added (effective ${input.effectiveFrom})`,
      why: reason,
      sourceUrl: row.officialSourceUrl,
      beforeJson: null,
      afterJson: { ...row, lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null, nextReviewAt: row.nextReviewAt.toISOString() },
      actor,
      changedAt: now,
    });
    await audit(tx, { action: 'visa_rule.create', entityType: 'visa_rule_version', entityId: id, after: row, reason, actor });
    return { id, version };
  });
}

/** Marks a rule version verified against the official source (only verification fields change). */
export async function markRuleVerified(
  db: DbOrTx,
  ruleVersionId: number,
  opts: ActorOpts & { verifiedBy?: string | null; note?: string | null } = {},
): Promise<boolean> {
  const now = opts.now ?? new Date();
  const actor = opts.actor ?? 'admin';
  return withTransaction(db, async (tx) => {
    const [rule] = await tx.select().from(visaRuleVersions).where(eq(visaRuleVersions.id, ruleVersionId)).limit(1).for('update');
    if (!rule) return false;
    const [route] = await tx.select().from(visaRoutes).where(eq(visaRoutes.id, rule.routeId)).limit(1);
    const before = { verificationStatus: rule.verificationStatus, lastVerifiedAt: rule.lastVerifiedAt, nextReviewAt: rule.nextReviewAt, verifiedBy: rule.verifiedBy };
    const after = {
      verificationStatus: 'verified' as const,
      lastVerifiedAt: now,
      nextReviewAt: new Date(now.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS),
      verifiedBy: (opts.verifiedBy ?? actor).slice(0, 64),
    };
    await tx.update(visaRuleVersions).set(after).where(eq(visaRuleVersions.id, ruleVersionId));
    await tx.insert(visaRuleChanges).values({
      routeId: rule.routeId,
      ruleVersionId,
      changeKind: 'verified',
      what: `${route ? describeRule(route, rule) : `rule ${ruleVersionId}`} verified`,
      why: opts.note ?? null,
      sourceUrl: rule.officialSourceUrl,
      beforeJson: { ...before, lastVerifiedAt: before.lastVerifiedAt?.toISOString() ?? null, nextReviewAt: before.nextReviewAt?.toISOString() ?? null },
      afterJson: { ...after, lastVerifiedAt: after.lastVerifiedAt.toISOString(), nextReviewAt: after.nextReviewAt.toISOString() },
      actor,
      changedAt: now,
    });
    await audit(tx, { action: 'visa_rule.verify', entityType: 'visa_rule_version', entityId: ruleVersionId, before, after, reason: opts.note ?? null, actor });
    return true;
  });
}

// ---- official page watch -------------------------------------------------------------------

export type FetchLike = (url: string, opts?: SafeFetchOptions) => Promise<SafeFetchResponse>;

export interface CheckPagesOptions {
  /** SSRF-safe fetch (tests inject createSafeFetch({resolver, addressPolicy})). */
  fetch?: FetchLike;
  now?: Date;
  /** Create missing watches for route/rule official URLs first (default true). */
  ensureWatches?: boolean;
  timeoutMs?: number;
}

export interface PageCheckOutcome {
  watchId: number;
  url: string;
  outcome: 'baseline' | 'unchanged' | 'changed' | 'error';
  error?: string;
}

export interface CheckPagesResult {
  checked: number;
  baseline: number;
  unchanged: number;
  changed: number;
  errors: number;
  pages: PageCheckOutcome[];
}

/**
 * Text that represents the page content for change detection: the <main> element when there is
 * one (headers, cookie banners and footers change for unrelated reasons), else the whole page.
 */
export function pageContentText(body: string, contentType: string | null): string {
  const isHtml = /html|xml/i.test(contentType ?? '') || /^\s*</.test(body);
  if (!isHtml) return body;
  const main = /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(body);
  const article = main ? null : /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(body);
  return htmlToPlainText(main ? main[1] : article ? article[1] : body);
}

export function pageContentHash(body: string, contentType: string | null): string {
  return sha256Hex(normalizeTextForHash(pageContentText(body, contentType)));
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

/** Inserts watches for every active route's official URL and every current rule's source URL. */
export async function ensureOfficialPageWatches(db: DbOrTx, now: Date = new Date()): Promise<number> {
  const routes = await db.select().from(visaRoutes).where(eq(visaRoutes.isActive, true));
  const wanted = new Map<string, number>();
  for (const r of routes) if (r.officialUrl) wanted.set(r.officialUrl.trim(), r.id);
  const versions = await db
    .select()
    .from(visaRuleVersions)
    .innerJoin(visaRoutes, eq(visaRuleVersions.routeId, visaRoutes.id))
    .where(eq(visaRoutes.isActive, true));
  const byRoute = new Map<number, VisaRuleVersionRow[]>();
  for (const v of versions) byRoute.set(v.visa_routes.id, [...(byRoute.get(v.visa_routes.id) ?? []), v.visa_rule_versions]);
  for (const [routeId, list] of byRoute) {
    const rule = ruleInEffect(list, now);
    if (rule?.officialSourceUrl) wanted.set(rule.officialSourceUrl.trim(), routeId);
  }
  let added = 0;
  for (const [url, routeId] of wanted) {
    if (!/^https?:\/\//i.test(url)) continue;
    const [res] = await db
      .insert(officialPageWatches)
      .values({ url: url.slice(0, 2048), urlHash: sha256Hex(url), routeId })
      .onDuplicateKeyUpdate({ set: { urlHash: sql`${officialPageWatches.urlHash}` } });
    // MySQL reports 1 affected row for an insert, 0 for an untouched duplicate.
    if (res.affectedRows === 1) added++;
  }
  return added;
}

async function checkOne(db: DbOrTx, w: OfficialPageWatchRow, fetchFn: FetchLike, now: Date, timeoutMs: number): Promise<PageCheckOutcome> {
  let hash: string;
  try {
    const res = await fetchFn(w.url, { timeoutMs, maxBytes: 5 * 1024 * 1024, headers: { accept: 'text/html,application/xhtml+xml,text/plain;q=0.8,*/*;q=0.5' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = res.text();
    if (!text.trim()) throw new Error('empty page');
    hash = pageContentHash(text, res.headers.get('content-type'));
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    await db
      .update(officialPageWatches)
      // A pending "changed" stays visible until reviewed; the error is still recorded.
      .set({ lastCheckedAt: now, lastError: message, status: w.status === 'changed' ? 'changed' : 'error' })
      .where(eq(officialPageWatches.id, w.id));
    await raiseAlert(db, {
      kind: 'visa_page_error',
      severity: 'warn',
      title: `Official visa page could not be checked (${hostOf(w.url)})`,
      body: `${w.url}\n${message}`,
      dedupeKey: `page-watch:${w.id}:error`,
      entityType: 'official_page_watch',
      entityId: w.id,
    });
    return { watchId: w.id, url: w.url, outcome: 'error', error: message };
  }

  if (w.lastHash === null) {
    await db
      .update(officialPageWatches)
      .set({ lastHash: hash, lastCheckedAt: now, lastError: null, status: 'ok' })
      .where(eq(officialPageWatches.id, w.id));
    return { watchId: w.id, url: w.url, outcome: 'baseline' };
  }
  if (w.lastHash === hash) {
    await db
      .update(officialPageWatches)
      .set({ lastCheckedAt: now, lastError: null, status: w.status === 'changed' ? 'changed' : 'ok' })
      .where(eq(officialPageWatches.id, w.id));
    return { watchId: w.id, url: w.url, outcome: 'unchanged' };
  }

  await withTransaction(db, async (tx) => {
    await tx
      .update(officialPageWatches)
      .set({ lastHash: hash, lastCheckedAt: now, changedAt: now, lastError: null, status: 'changed' })
      .where(eq(officialPageWatches.id, w.id));
    if (w.routeId !== null) {
      await tx.insert(visaRuleChanges).values({
        routeId: w.routeId,
        ruleVersionId: null,
        changeKind: 'page_changed',
        what: `Official page changed: ${w.url}`,
        why: 'Detected by the page watch — rules were NOT changed; please review.',
        sourceUrl: w.url,
        beforeJson: { hash: w.lastHash },
        afterJson: { hash },
        actor: 'worker',
        changedAt: now,
      });
    }
    await raiseAlert(tx, {
      kind: 'visa_page_changed',
      severity: 'warn',
      title: `Official visa page changed, please review (${hostOf(w.url)})`,
      body: `${w.url}\nThe page content changed on ${utcDay(now)}. Rules were not changed automatically — check the page and record a new rule version if needed.`,
      dedupeKey: `page-watch:${w.id}:changed`,
      entityType: 'official_page_watch',
      entityId: w.id,
    });
  });
  return { watchId: w.id, url: w.url, outcome: 'changed' };
}

/**
 * Checks every watched official page (sequentially, SSRF-safe). Never throws for a page error:
 * the watch goes to `error` and an alert is raised. Never modifies rule versions.
 */
export async function checkOfficialPages(db: DbOrTx, opts: CheckPagesOptions = {}): Promise<CheckPagesResult> {
  const now = opts.now ?? new Date();
  const fetchFn = opts.fetch ?? defaultSafeFetch;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  if (opts.ensureWatches !== false) await ensureOfficialPageWatches(db, now);
  const watches = await db.select().from(officialPageWatches).orderBy(asc(officialPageWatches.id));
  const result: CheckPagesResult = { checked: 0, baseline: 0, unchanged: 0, changed: 0, errors: 0, pages: [] };
  for (const w of watches) {
    const out = await checkOne(db, w, fetchFn, now, timeoutMs);
    result.checked++;
    if (out.outcome === 'baseline') result.baseline++;
    else if (out.outcome === 'unchanged') result.unchanged++;
    else if (out.outcome === 'changed') result.changed++;
    else result.errors++;
    result.pages.push(out);
  }
  return result;
}

/** After I reviewed a changed page: back to `ok` (the stored hash is already the new one). */
export async function markPageReviewed(db: DbOrTx, watchId: number, opts: ActorOpts & { note?: string | null } = {}): Promise<boolean> {
  const actor = opts.actor ?? 'admin';
  return withTransaction(db, async (tx) => {
    const [w] = await tx.select().from(officialPageWatches).where(eq(officialPageWatches.id, watchId)).limit(1).for('update');
    if (!w) return false;
    await tx.update(officialPageWatches).set({ status: 'ok' }).where(eq(officialPageWatches.id, watchId));
    await audit(tx, {
      action: 'visa_page.reviewed',
      entityType: 'official_page_watch',
      entityId: watchId,
      before: { status: w.status },
      after: { status: 'ok' },
      reason: opts.note ?? null,
      actor,
    });
    return true;
  });
}
