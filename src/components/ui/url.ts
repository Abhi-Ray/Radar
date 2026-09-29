/**
 * URL-state helpers for link-based UI (filters, tabs, sorting, pagination).
 * Pure and client-safe. Works with the `searchParams` object Next passes to pages.
 */

export type SearchParamsInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined>
  | null
  | undefined;

export type ParamUpdate = string | number | boolean | readonly (string | number)[] | null | undefined;

function toSearchParams(input: SearchParamsInput): URLSearchParams {
  if (!input) return new URLSearchParams();
  if (input instanceof URLSearchParams) return new URLSearchParams(input);
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(input)) {
    if (v === undefined) continue;
    if (Array.isArray(v)) for (const item of v) sp.append(k, item);
    else sp.append(k, v);
  }
  return sp;
}

/**
 * Build `pathname?query` from current params plus updates.
 * - `null`/`undefined`/`""`/`false` removes the key
 * - arrays set repeated keys
 * - by default any change resets `page` (pass `keepPage: true` to keep it)
 */
export function hrefWith(
  pathname: string,
  current: SearchParamsInput,
  updates: Record<string, ParamUpdate> = {},
  opts: { keepPage?: boolean; pageParam?: string } = {},
): string {
  const sp = toSearchParams(current);
  const pageParam = opts.pageParam ?? "page";
  const touched = Object.keys(updates);
  if (!opts.keepPage && touched.length > 0 && !touched.includes(pageParam)) sp.delete(pageParam);
  for (const [k, v] of Object.entries(updates)) {
    sp.delete(k);
    if (v === null || v === undefined || v === false || v === "") continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(k, String(item));
    } else {
      sp.set(k, v === true ? "1" : String(v));
    }
  }
  sp.sort();
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

/** Toggle one value inside a multi-value param (e.g. ?country=DE&country=NL). */
export function hrefToggle(
  pathname: string,
  current: SearchParamsInput,
  key: string,
  value: string,
  opts: { pageParam?: string } = {},
): string {
  const sp = toSearchParams(current);
  const values = sp.getAll(key);
  const next = values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
  return hrefWith(pathname, sp, { [key]: next.length ? next : null }, opts);
}

/** Read one param as a string (first value). */
export function paramValue(current: SearchParamsInput, key: string): string | undefined {
  const sp = toSearchParams(current);
  return sp.get(key) ?? undefined;
}

/** Read one param as a list (repeated keys and comma-separated both supported). */
export function paramList(current: SearchParamsInput, key: string): string[] {
  const sp = toSearchParams(current);
  return sp
    .getAll(key)
    .flatMap((v) => v.split(","))
    .map((v) => v.trim())
    .filter(Boolean);
}

/** Positive integer page from params; anything invalid → 1. */
export function pageFromParams(current: SearchParamsInput, key = "page"): number {
  const raw = paramValue(current, key);
  const n = raw ? Number.parseInt(raw, 10) : 1;
  return Number.isFinite(n) && n >= 1 ? n : 1;
}

export type PageToken = number | "gap";

/**
 * Compact page list: always first & last, current ± siblings, "gap" where pages are skipped.
 * pageWindow(6, 20) → [1, "gap", 5, 6, 7, "gap", 20]
 */
export function pageWindow(current: number, total: number, siblings = 1): PageToken[] {
  const t = Math.max(1, Math.floor(total));
  const c = Math.min(t, Math.max(1, Math.floor(current)));
  const set = new Set<number>([1, t]);
  for (let p = c - siblings; p <= c + siblings; p++) if (p >= 1 && p <= t) set.add(p);
  const sorted = [...set].sort((a, b) => a - b);
  const out: PageToken[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const p = sorted[i];
    const prev = sorted[i - 1];
    if (prev !== undefined && p - prev === 2) out.push(prev + 1);
    else if (prev !== undefined && p - prev > 2) out.push("gap");
    out.push(p);
  }
  return out;
}

/** "41–60 of 1,204" style range for a page. */
export function pageRange(page: number, pageSize: number, total: number): { from: number; to: number } {
  if (total <= 0) return { from: 0, to: 0 };
  const from = (Math.max(1, page) - 1) * pageSize + 1;
  return { from: Math.min(from, total), to: Math.min(total, from + pageSize - 1) };
}
