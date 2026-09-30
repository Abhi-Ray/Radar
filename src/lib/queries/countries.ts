/**
 * /countries list and /countries/[iso2] guide reads (server only). Rule selection and freshness
 * come from src/components/countries/model.ts (the same logic the visa engine uses).
 */
import 'server-only';
import { asc, desc, eq, inArray } from 'drizzle-orm';
import {
  countries,
  officialPageWatches,
  templates,
  visaRoutes,
  visaRuleChanges,
  visaRuleVersions,
  type CountryRow,
  type OfficialPageWatchRow,
  type TemplateRow,
  type VisaRouteRow,
  type VisaRuleChangeRow,
  type VisaRuleVersionRow,
} from '@/db/schema';
import {
  countryRuleMarker,
  goLiveCheck,
  parseBestSites,
  parseCvConventions,
  parseLanguages,
  parseSalaryRanges,
  ruleInEffect,
  upcomingVersions,
  utcDayOf,
  type BestSite,
  type CountryRuleMarker,
  type CvConventions,
  type SalaryRange,
} from '@/components/countries/model';
import { getDb, type DbOrTx } from '@/lib/db';

export interface CountryListItem {
  iso2: string;
  name: string;
  tier: number;
  region: string | null;
  currency: string | null;
  isLive: boolean;
  routes: number;
  marker: CountryRuleMarker;
  /** Official pages that changed (or failed to load) and wait for review. */
  pagesToReview: number;
  /** Next review date among the rules in effect. */
  nextReviewAt: Date | null;
}

export interface CountryTier {
  tier: number;
  countries: CountryListItem[];
}

function groupBy<T, K>(list: readonly T[], key: (t: T) => K): Map<K, T[]> {
  const m = new Map<K, T[]>();
  for (const item of list) m.set(key(item), [...(m.get(key(item)) ?? []), item]);
  return m;
}

export async function listCountries(opts: { db?: DbOrTx; now?: Date } = {}): Promise<CountryTier[]> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const today = utcDayOf(now);
  const [rows, routes, versions, watches] = await Promise.all([
    db.select().from(countries).orderBy(asc(countries.tier), asc(countries.name)),
    db.select({ id: visaRoutes.id, countryIso2: visaRoutes.countryIso2, isActive: visaRoutes.isActive }).from(visaRoutes),
    db
      .select({
        id: visaRuleVersions.id,
        routeId: visaRuleVersions.routeId,
        version: visaRuleVersions.version,
        effectiveFrom: visaRuleVersions.effectiveFrom,
        effectiveTo: visaRuleVersions.effectiveTo,
        verificationStatus: visaRuleVersions.verificationStatus,
        lastVerifiedAt: visaRuleVersions.lastVerifiedAt,
        nextReviewAt: visaRuleVersions.nextReviewAt,
      })
      .from(visaRuleVersions),
    db.select({ routeId: officialPageWatches.routeId, status: officialPageWatches.status }).from(officialPageWatches),
  ]);
  const routesByCountry = groupBy(routes, (r) => r.countryIso2);
  const versionsByRoute = groupBy(versions, (v) => v.routeId);
  const routeCountry = new Map(routes.map((r) => [r.id, r.countryIso2]));
  const review = new Map<string, number>();
  for (const w of watches) {
    if (w.status !== 'changed' && w.status !== 'error') continue;
    const iso = w.routeId !== null ? routeCountry.get(w.routeId) : undefined;
    if (iso) review.set(iso, (review.get(iso) ?? 0) + 1);
  }
  const items: CountryListItem[] = rows.map((c) => {
    const active = (routesByCountry.get(c.iso2) ?? []).filter((r) => r.isActive);
    const current = active.map((r) => ruleInEffect(versionsByRoute.get(r.id) ?? [], today)).filter((v): v is NonNullable<typeof v> => v !== null);
    const reviews = current.map((v) => v.nextReviewAt).filter((d): d is Date => d !== null);
    return {
      iso2: c.iso2,
      name: c.name,
      tier: c.tier,
      region: c.region,
      currency: c.currency,
      isLive: c.isLive,
      routes: active.length,
      marker: countryRuleMarker(current, now),
      pagesToReview: review.get(c.iso2) ?? 0,
      nextReviewAt: reviews.length ? new Date(Math.min(...reviews.map((d) => d.getTime()))) : null,
    };
  });
  return [...groupBy(items, (i) => i.tier).entries()].sort((a, b) => a[0] - b[0]).map(([tier, list]) => ({ tier, countries: list }));
}

// ---- guide -----------------------------------------------------------------------------------

export interface RouteGuide {
  route: VisaRouteRow;
  /** Every version, newest version first. */
  versions: VisaRuleVersionRow[];
  /** In effect today. */
  current: VisaRuleVersionRow | null;
  /** In effect on the as-of day (equals `current` without an as-of day). */
  asOf: VisaRuleVersionRow | null;
  upcoming: VisaRuleVersionRow[];
  watches: OfficialPageWatchRow[];
}

export interface CountryGuide {
  country: CountryRow;
  routes: RouteGuide[];
  changes: Array<VisaRuleChangeRow & { routeName: string | null }>;
  watches: OfficialPageWatchRow[];
  salaries: SalaryRange[];
  sites: BestSite[];
  conventions: CvConventions;
  conventionTemplates: TemplateRow[];
  languages: string[];
  marker: CountryRuleMarker;
  goLive: { ok: true } | { ok: false; reason: string };
  today: string;
  asOfDay: string | null;
}

export async function loadCountryGuide(iso2: string, opts: { db?: DbOrTx; now?: Date; asOf?: string | null } = {}): Promise<CountryGuide | null> {
  const db = opts.db ?? getDb();
  const now = opts.now ?? new Date();
  const today = utcDayOf(now);
  const [country] = await db.select().from(countries).where(eq(countries.iso2, iso2)).limit(1);
  if (!country) return null;
  const routes = await db.select().from(visaRoutes).where(eq(visaRoutes.countryIso2, iso2)).orderBy(desc(visaRoutes.isActive), asc(visaRoutes.name));
  const routeIds = routes.map((r) => r.id);
  const [versions, changes, watches, conventionTemplates] = await Promise.all([
    routeIds.length ? db.select().from(visaRuleVersions).where(inArray(visaRuleVersions.routeId, routeIds)).orderBy(desc(visaRuleVersions.version)) : Promise.resolve([] as VisaRuleVersionRow[]),
    routeIds.length
      ? db
          .select()
          .from(visaRuleChanges)
          .where(inArray(visaRuleChanges.routeId, routeIds))
          .orderBy(desc(visaRuleChanges.changedAt), desc(visaRuleChanges.id))
          .limit(200)
      : Promise.resolve([] as VisaRuleChangeRow[]),
    routeIds.length ? db.select().from(officialPageWatches).where(inArray(officialPageWatches.routeId, routeIds)).orderBy(asc(officialPageWatches.url)) : Promise.resolve([] as OfficialPageWatchRow[]),
    db.select().from(templates).where(eq(templates.countryIso2, iso2)).orderBy(asc(templates.name)),
  ]);
  const asOfDay = opts.asOf && opts.asOf !== today ? opts.asOf : null;
  const byRoute = groupBy(versions, (v) => v.routeId);
  const watchesByRoute = groupBy(watches, (w) => w.routeId);
  const guides: RouteGuide[] = routes.map((route) => {
    const list = byRoute.get(route.id) ?? [];
    const current = ruleInEffect(list, today);
    return {
      route,
      versions: list,
      current,
      asOf: asOfDay ? ruleInEffect(list, asOfDay) : current,
      upcoming: upcomingVersions(list, today),
      watches: watchesByRoute.get(route.id) ?? [],
    };
  });
  const currentActive = guides.filter((g) => g.route.isActive).map((g) => g.current).filter((v): v is VisaRuleVersionRow => v !== null);
  const routeName = new Map(routes.map((r) => [r.id, r.name]));
  return {
    country,
    routes: guides,
    changes: changes.map((c) => ({ ...c, routeName: routeName.get(c.routeId) ?? null })),
    watches,
    salaries: parseSalaryRanges(country.salaryRangesJson, country.currency),
    sites: parseBestSites(country.bestSitesJson),
    conventions: parseCvConventions(country.cvConventionsJson),
    conventionTemplates: conventionTemplates.filter((t) => t.kind === 'cv_convention'),
    languages: parseLanguages(country.languagesJson),
    marker: countryRuleMarker(currentActive, now),
    goLive: goLiveCheck(currentActive, now),
    today,
    asOfDay,
  };
}
