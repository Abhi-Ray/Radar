/**
 * Client-safe formatting helpers (no Node APIs, no env access).
 * All display times are shown in the app time zone (Asia/Kolkata) unless a tz is passed.
 * Output is assembled from numeric Intl parts so it is identical across ICU versions
 * (e.g. never "Sept" vs "Sep").
 */

export const APP_TZ = "Asia/Kolkata";
export const DASH = "—";

export type DateInput = Date | string | number | null | undefined;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const TZ_ABBREV: Record<string, string> = {
  "Asia/Kolkata": "IST",
  "Asia/Calcutta": "IST",
  UTC: "UTC",
  "Etc/UTC": "UTC",
};

/** Parse anything date-like; invalid or empty input returns null. */
export function toDate(input: DateInput): Date | null {
  if (input === null || input === undefined || input === "") return null;
  const d = input instanceof Date ? new Date(input.getTime()) : new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const partsFormatters = new Map<string, Intl.DateTimeFormat>();

function zonedParts(date: Date, tz: string): ZonedParts {
  let fmt = partsFormatters.get(tz);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
      hourCycle: "h23",
    });
    partsFormatters.set(tz, fmt);
  }
  const out: Record<string, number> = {};
  for (const p of fmt.formatToParts(date)) {
    if (p.type !== "literal") out[p.type] = Number(p.value);
  }
  return {
    year: out.year ?? 0,
    month: out.month ?? 1,
    day: out.day ?? 1,
    hour: (out.hour ?? 0) % 24,
    minute: out.minute ?? 0,
    second: out.second ?? 0,
  };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Short zone label: IST / UTC, else whatever Intl offers (e.g. GMT+2). */
export function tzLabel(tz: string = APP_TZ): string {
  if (TZ_ABBREV[tz]) return TZ_ABBREV[tz];
  try {
    const part = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? tz;
  } catch {
    return tz;
  }
}

export interface DateFormatOptions {
  tz?: string;
  /** Omit the year when false. Default true. */
  year?: boolean;
  /** Fallback for null/invalid input. Default "—". */
  fallback?: string;
}

/** "29 Sep 2026" */
export function formatDate(input: DateInput, opts: DateFormatOptions = {}): string {
  const d = toDate(input);
  if (!d) return opts.fallback ?? DASH;
  const p = zonedParts(d, opts.tz ?? APP_TZ);
  const base = `${p.day} ${MONTHS[p.month - 1]}`;
  return opts.year === false ? base : `${base} ${p.year}`;
}

/** "14:02" (24h) */
export function formatTime(input: DateInput, opts: { tz?: string; seconds?: boolean; fallback?: string } = {}): string {
  const d = toDate(input);
  if (!d) return opts.fallback ?? DASH;
  const p = zonedParts(d, opts.tz ?? APP_TZ);
  const hm = `${pad2(p.hour)}:${pad2(p.minute)}`;
  return opts.seconds ? `${hm}:${pad2(p.second)}` : hm;
}

/** "29 Sep 2026, 14:02 IST" */
export function formatDateTime(
  input: DateInput,
  opts: DateFormatOptions & { zone?: boolean; seconds?: boolean } = {},
): string {
  const d = toDate(input);
  if (!d) return opts.fallback ?? DASH;
  const tz = opts.tz ?? APP_TZ;
  const s = `${formatDate(d, opts)}, ${formatTime(d, { tz, seconds: opts.seconds })}`;
  return opts.zone === false ? s : `${s} ${tzLabel(tz)}`;
}

/** Calendar date in the zone: "2026-09-29". */
export function formatIsoDate(input: DateInput, tz: string = APP_TZ): string {
  const d = toDate(input);
  if (!d) return DASH;
  const p = zonedParts(d, tz);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Terse relative time: "just now", "5m ago", "3h ago", "2d ago", "3w ago", "5mo ago", "2y ago",
 * and the future forms "in 5m" … "in 2y".
 */
export function formatRelative(input: DateInput, now: DateInput = new Date(), fallback = "never"): string {
  const d = toDate(input);
  const n = toDate(now) ?? new Date();
  if (!d) return fallback;
  const diff = n.getTime() - d.getTime();
  const abs = Math.abs(diff);
  if (abs < 45_000) return "just now";
  let v: string;
  if (abs < HOUR) v = `${Math.max(1, Math.round(abs / MINUTE))}m`;
  else if (abs < DAY) v = `${Math.round(abs / HOUR)}h`;
  else if (abs < 7 * DAY) v = `${Math.round(abs / DAY)}d`;
  else if (abs < 35 * DAY) v = `${Math.round(abs / (7 * DAY))}w`;
  else if (abs < 365 * DAY) v = `${Math.max(1, Math.round(abs / (30.44 * DAY)))}mo`;
  else v = `${Math.round(abs / (365.25 * DAY))}y`;
  // Avoid "24h ago" / "7d ago" style rounding overflow.
  v = v.replace(/^24h$/, "1d").replace(/^7d$/, "1w").replace(/^5w$/, "1mo").replace(/^12mo$/, "1y");
  return diff >= 0 ? `${v} ago` : `in ${v}`;
}

/** Whole calendar days from `now` to `input` in the zone (negative = past). */
export function daysUntil(input: DateInput, now: DateInput = new Date(), tz: string = APP_TZ): number | null {
  const d = toDate(input);
  const n = toDate(now);
  if (!d || !n) return null;
  const a = zonedParts(d, tz);
  const b = zonedParts(n, tz);
  const ua = Date.UTC(a.year, a.month - 1, a.day);
  const ub = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((ua - ub) / DAY);
}

/** True when `input` is older than maxAgeHours (or missing). */
export function isStale(input: DateInput, maxAgeHours: number, now: DateInput = new Date()): boolean {
  const d = toDate(input);
  const n = toDate(now) ?? new Date();
  if (!d) return true;
  return n.getTime() - d.getTime() > maxAgeHours * HOUR;
}

/** "850ms", "4.2s", "3m 04s", "2h 10m" */
export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return DASH;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  const totalS = Math.round(s);
  const m = Math.floor(totalS / 60);
  if (m < 60) return `${m}m ${pad2(totalS % 60)}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${pad2(m % 60)}m`;
}

const numberFmt = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

/** "1,204" */
export function formatNumber(n: number | null | undefined, opts: { decimals?: number; fallback?: string } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return opts.fallback ?? DASH;
  if (opts.decimals) {
    return new Intl.NumberFormat("en-GB", {
      minimumFractionDigits: opts.decimals,
      maximumFractionDigits: opts.decimals,
    }).format(n);
  }
  return numberFmt.format(n);
}

function trimDecimal(n: number, decimals: number): string {
  return n.toFixed(decimals).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/** "950", "9.5k", "48k", "1.25M", "2.4B" */
export function formatCompact(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  // Tiers are chosen on the ROUNDED value so 999,500 prints "1M" (not "1000k") and 999.6 prints "1k".
  if (a >= 1e9 || Math.round(a / 1e6) >= 1000) return `${sign}${trimDecimal(a / 1e9, a >= 1e10 ? 1 : 2)}B`;
  if (a >= 1e6 || Math.round(a / 1e3) >= 1000) return `${sign}${trimDecimal(a / 1e6, a >= 1e7 ? 1 : 2)}M`;
  if (a >= 1e3 || Math.round(a) >= 1000) return `${sign}${a >= 1e4 ? Math.round(a / 1e3) : trimDecimal(a / 1e3, 1)}k`;
  return `${sign}${Math.round(a)}`;
}

/** "92%" from a 0..1 ratio. */
export function formatPercent(ratio: number | null | undefined, decimals = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return DASH;
  return `${(ratio * 100).toFixed(decimals)}%`;
}

const symbolCache = new Map<string, string>();

/** Currency symbol as en-GB renders it: EUR → €, GBP → £, USD → US$, CHF → CHF. */
export function currencySymbol(currency: string): string {
  const code = currency.toUpperCase();
  const hit = symbolCache.get(code);
  if (hit) return hit;
  let sym = code;
  try {
    sym =
      new Intl.NumberFormat("en-GB", { style: "currency", currency: code })
        .formatToParts(0)
        .find((p) => p.type === "currency")?.value ?? code;
  } catch {
    sym = code;
  }
  symbolCache.set(code, sym);
  return sym;
}

function joinSymbol(sym: string, value: string): string {
  // Alphabetic symbols (CHF, SEK) read better with a space.
  return /^[A-Za-z]+$/.test(sym) ? `${sym} ${value}` : `${sym}${value}`;
}

export interface MoneyOptions {
  compact?: boolean;
  fallback?: string;
}

/** "€48,000" / "€48k" / "£52,500" / "CHF 110k". Unknown currency codes fall back to "123 XYZ". */
export function formatMoney(amount: number | null | undefined, currency = "EUR", opts: MoneyOptions = {}): string {
  if (amount === null || amount === undefined || !Number.isFinite(amount)) return opts.fallback ?? DASH;
  const code = currency.toUpperCase();
  const valid = /^[A-Z]{3}$/.test(code);
  if (!valid) return `${opts.compact ? formatCompact(amount) : formatNumber(amount)} ${currency}`.trim();
  const sym = currencySymbol(code);
  const neg = amount < 0;
  const body = opts.compact ? formatCompact(Math.abs(amount)) : formatNumber(Math.abs(amount));
  return `${neg ? "-" : ""}${joinSymbol(sym, body)}`;
}

/** EUR shorthand. */
export function formatEur(amount: number | null | undefined, opts: MoneyOptions = {}): string {
  return formatMoney(amount, "EUR", opts);
}

/** "€48k–€60k", "€48k+", "up to €60k", "€55k" (min === max), "—" (neither). */
export function formatMoneyRange(
  min: number | null | undefined,
  max: number | null | undefined,
  currency = "EUR",
  opts: MoneyOptions = { compact: true },
): string {
  const hasMin = typeof min === "number" && Number.isFinite(min);
  const hasMax = typeof max === "number" && Number.isFinite(max);
  if (hasMin && hasMax) {
    if (min === max) return formatMoney(min, currency, opts);
    const [lo, hi] = (min as number) <= (max as number) ? [min, max] : [max, min];
    return `${formatMoney(lo, currency, opts)}–${formatMoney(hi, currency, opts)}`;
  }
  if (hasMin) return `${formatMoney(min, currency, opts)}+`;
  if (hasMax) return `up to ${formatMoney(max, currency, opts)}`;
  return opts.fallback ?? DASH;
}

export function formatEurRange(
  min: number | null | undefined,
  max: number | null | undefined,
  opts: MoneyOptions = { compact: true },
): string {
  return formatMoneyRange(min, max, "EUR", opts);
}

/** "1 job" / "3 jobs" — pass the plural when it is irregular. */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(n)} ${n === 1 ? singular : pluralForm}`;
}

/** Truncate with an ellipsis at a word boundary when possible. */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, Math.max(0, max - 1));
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`;
}
