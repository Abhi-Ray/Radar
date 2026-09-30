/**
 * Customary number of salary payments per year when a posting quotes a MONTHLY figure. A stated
 * count in the posting ("14 Gehälter", "13 mensilità", "14 pagas", "13. Monatslohn") always wins.
 *
 * Only countries where extra payments are required by law or near-universal collective agreements
 * are listed; everything else is 12. Where the practice varies (Spain's 12 vs 14 "pagas",
 * Switzerland's 13th month, Luxembourg) the default stays 12 so an annual figure is never
 * overstated, and the label says the real total may be higher; the posting's own statement is
 * used when present. The label is shown next to the converted amount.
 */

export interface InstallmentRule {
  /** Payments per year used to annualise a monthly figure. */
  count: number;
  label: string;
}

export const DEFAULT_INSTALLMENTS = 12;

export const INSTALLMENTS_BY_COUNTRY: Readonly<Record<string, InstallmentRule>> = {
  AT: { count: 14, label: '14 payments (13th and 14th month salary are customary in Austria)' },
  PT: { count: 14, label: '14 payments (holiday and Christmas subsidies are mandatory in Portugal)' },
  GR: { count: 14, label: '14 payments (Christmas, Easter and holiday bonuses are mandatory in Greece)' },
  IT: { count: 13, label: '13 payments (tredicesima is standard in Italy; some agreements pay 14)' },
  BE: { count: 13.92, label: '13.92 payments (13th month plus double holiday pay in Belgium)' },
  NL: { count: 12.96, label: '12.96 payments (8% holiday allowance is mandatory in the Netherlands)' },
  BR: { count: 13, label: '13 payments (the 13th salary is mandatory for CLT employees in Brazil)' },
  MX: { count: 12.5, label: '12.5 payments (the aguinaldo of at least 15 days pay is mandatory in Mexico)' },
};

/** Countries where extra payments are common but not universal: 12 is used and the label says so. */
export const INSTALLMENTS_VARY_BY_COUNTRY: Readonly<Record<string, string>> = {
  ES: '12 payments assumed (Spanish salaries are often paid in 14 pagas; the posting does not say, so the yearly total may be higher)',
  CH: '12 payments assumed (a 13th month salary is common in Switzerland; the posting does not say, so the yearly total may be higher)',
  LU: '12 payments assumed (a 13th month is paid under many Luxembourg agreements; the posting does not say, so the yearly total may be higher)',
};

/** Label used for the Netherlands when the quoted monthly amount already includes the holiday allowance. */
export const NL_HOLIDAY_INCLUDED_LABEL = '12 payments (the 8% holiday allowance is already included in the quoted monthly amount)';

export function installmentRule(countryIso2: string | null | undefined): InstallmentRule | null {
  if (!countryIso2) return null;
  return INSTALLMENTS_BY_COUNTRY[countryIso2.toUpperCase()] ?? null;
}

/** Uncertainty label for a monthly figure annualised at 12 where extra payments are common. */
export function installmentsVaryNote(countryIso2: string | null | undefined): string | null {
  if (!countryIso2) return null;
  return INSTALLMENTS_VARY_BY_COUNTRY[countryIso2.toUpperCase()] ?? null;
}
