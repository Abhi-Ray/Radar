/**
 * Pure FX helpers over an `FxTable` (1 EUR = rates[CUR] CUR, ECB convention).
 *
 * The ECB does not publish AED / SAR / QAR; they are pegged to the US dollar, so they are derived
 * from the ECB USD rate and the official peg. BGN (euro since 2026-01-01) and HRK (euro since
 * 2023-01-01) convert at their irrevocable euro conversion rates, which need no table at all.
 */
import type { FxTable } from '../contracts/jobs';

/** Official pegs: units of the currency per 1 USD. */
export const USD_PEGS: Readonly<Record<string, number>> = {
  AED: 3.6725,
  SAR: 3.75,
  QAR: 3.64,
};

/** Irrevocable euro conversion rates: units per 1 EUR. */
export const EUR_FIXED_RATES: Readonly<Record<string, number>> = {
  BGN: 1.95583,
  HRK: 7.5345,
};

export type RateSource = 'identity' | 'ecb' | 'usd_peg' | 'eur_fixed';

export interface RateLookup {
  /** Units of `currency` per 1 EUR. */
  rate: number;
  source: RateSource;
  /** Reference date of the rate; null for EUR itself and fixed conversion rates. */
  date: string | null;
}

const isRate = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0;

/** Rate for one currency, or null when it cannot be converted with this table. */
export function lookupRate(fx: FxTable | null | undefined, currency: string): RateLookup | null {
  const cur = currency.trim().toUpperCase();
  if (cur === 'EUR') return { rate: 1, source: 'identity', date: null };
  const fixed = EUR_FIXED_RATES[cur];
  if (fixed) return { rate: fixed, source: 'eur_fixed', date: null };
  const peg = USD_PEGS[cur];
  if (peg) {
    const usd = fx?.rates.USD;
    return isRate(usd) ? { rate: round6(usd * peg), source: 'usd_peg', date: fx?.date ?? null } : null;
  }
  const rate = fx?.rates[cur];
  return isRate(rate) ? { rate, source: 'ecb', date: fx?.date ?? null } : null;
}

/** ECB rates plus EUR itself, the fixed euro rates and the USD pegs (when USD is known). */
export function withDerivedRates(rates: Readonly<Record<string, number>>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(rates)) if (isRate(v)) out[k.toUpperCase()] = v;
  out.EUR = 1;
  for (const [k, v] of Object.entries(EUR_FIXED_RATES)) out[k] = v;
  if (isRate(out.USD)) for (const [k, v] of Object.entries(USD_PEGS)) out[k] = round6(out.USD * v);
  return out;
}

/** Amount in EUR, or null without a rate. */
export function toEur(amount: number, currency: string, fx: FxTable | null | undefined): number | null {
  const r = lookupRate(fx, currency);
  return r ? amount / r.rate : null;
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
