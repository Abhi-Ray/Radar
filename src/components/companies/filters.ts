/**
 * /companies URL filters (spec §19.4): sponsor evidence, size, type, country, agency, name search.
 * Pure and client-safe; src/lib/queries/companies.ts turns them into SQL.
 */
import { COMPANY_TYPES } from "@/db/schema/_enums";
import { hrefWith, pageFromParams, paramList, paramValue, type ParamUpdate, type SearchParamsInput } from "@/components/ui/url";
import { SPONSOR_CLASSES, type SponsorClass } from "./model";

export const COMPANIES_PATH = "/companies";
export const COMPANIES_PAGE_SIZE = 30;

export type CompanyTypeKey = (typeof COMPANY_TYPES)[number];
export type CompanySort = "jobs" | "name" | "recent";
export const COMPANY_SORTS: readonly CompanySort[] = ["jobs", "name", "recent"];
export const COMPANY_SORT_LABEL: Record<CompanySort, string> = { jobs: "Most open jobs", name: "Name A–Z", recent: "Recently updated" };

export interface CompanyFilters {
  q: string | null;
  sponsor: SponsorClass[];
  /** Size bands as stored; "none" = size not known. */
  size: string[];
  type: CompanyTypeKey[];
  /** HQ country ISO2; "none" = not known. */
  country: string[];
  agency: "yes" | "no" | null;
  sort: CompanySort;
  page: number;
}

export const EMPTY_COMPANY_FILTERS: CompanyFilters = { q: null, sponsor: [], size: [], type: [], country: [], agency: null, sort: "jobs", page: 1 };

const SIZE_RE = /^[\w+ .-]{1,32}$/;

export function parseCompanyFilters(sp: SearchParamsInput): CompanyFilters {
  const q = paramValue(sp, "q")?.trim().slice(0, 100) || null;
  const sponsor = [...new Set(paramList(sp, "sponsor"))].filter((s): s is SponsorClass => (SPONSOR_CLASSES as readonly string[]).includes(s));
  const size = [...new Set(paramList(sp, "size").map((s) => s.trim()))].filter((s) => SIZE_RE.test(s)).slice(0, 12);
  const type = [...new Set(paramList(sp, "type"))].filter((t): t is CompanyTypeKey => (COMPANY_TYPES as readonly string[]).includes(t));
  const country = [...new Set(paramList(sp, "country").map((c) => c.trim().toUpperCase()))]
    .filter((c) => /^[A-Z]{2}$/.test(c) || c === "NONE")
    .map((c) => (c === "NONE" ? "none" : c))
    .slice(0, 30);
  const agencyRaw = paramValue(sp, "agency");
  const sortRaw = paramValue(sp, "sort");
  return {
    q,
    sponsor,
    size,
    type,
    country,
    agency: agencyRaw === "yes" || agencyRaw === "no" ? agencyRaw : null,
    sort: (COMPANY_SORTS as readonly string[]).includes(sortRaw ?? "") ? (sortRaw as CompanySort) : "jobs",
    page: pageFromParams(sp),
  };
}

export function companySearchParams(f: CompanyFilters): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  if (f.q) out.q = f.q;
  if (f.sponsor.length) out.sponsor = f.sponsor;
  if (f.size.length) out.size = f.size;
  if (f.type.length) out.type = f.type;
  if (f.country.length) out.country = f.country;
  if (f.agency) out.agency = f.agency;
  if (f.sort !== "jobs") out.sort = f.sort;
  if (f.page > 1) out.page = String(f.page);
  return out;
}

/** A link to the list with `updates` applied (changing a filter resets the page). */
export function companiesHref(f: CompanyFilters, updates: Record<string, ParamUpdate> = {}): string {
  return hrefWith(COMPANIES_PATH, companySearchParams(f), updates);
}

/** Toggle one value of a multi-value filter. */
export function toggleValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export function activeCompanyFilterCount(f: CompanyFilters): number {
  return (f.q ? 1 : 0) + f.sponsor.length + f.size.length + f.type.length + f.country.length + (f.agency ? 1 : 0);
}
