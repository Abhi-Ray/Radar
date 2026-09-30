/**
 * Customary number of salary payments per year when a posting quotes a MONTHLY figure. A stated
 * count in the posting ("14 Gehälter", "13 mensilità", "14 pagas", "13. Monatslohn") always wins.
 *
 * Only countries where extra payments are required by law or near-universal collective agreements
 * are listed; everything else is 12. Where the practice varies (Spain's 12 vs 14 "pagas",
 * Switzerland's 13th month, Luxembourg) the default stays 12 so an annual figure is never
 * overstated; the posting's own statement is used when present. The label is shown next to the
 * converted amount.
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
};

export function installmentRule(countryIso2: string | null | undefined): InstallmentRule | null {
  if (!countryIso2) return null;
  return INSTALLMENTS_BY_COUNTRY[countryIso2.toUpperCase()] ?? null;
}
