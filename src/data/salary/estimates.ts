/**
 * Country salary estimates used when a posting states no salary (spec §10: "Estimated (country
 * average)"). Values are indicative annual GROSS ranges in local currency for an engineer with
 * roughly 2–5 years of experience (the user's band), as [lower, upper] ≈ 25th–75th percentile.
 *
 * They were compiled for RADAR from public salary surveys and job-board aggregates available up
 * to mid-2026 and rounded; they are deliberately coarse and are always shown as "Estimated", never
 * mixed with stated pay, and weigh less in scoring (spec §14). Refresh them together with the
 * country guides; `ESTIMATES_AS_OF` records when they were last reviewed.
 */

export const ESTIMATES_AS_OF = '2026-09-29';
export const ESTIMATES_SOURCE = 'RADAR indicative salary table (public surveys, rounded)';

/** 'security' = cloud/application/product security, DevSecOps, GRC; 'development' = full-stack / Node / Next.js. */
export type EstimateTrack = 'security' | 'development';

export interface CountrySalaryEstimate {
  currency: string;
  security: readonly [number, number];
  development: readonly [number, number];
}

export const SALARY_ESTIMATES: Readonly<Record<string, CountrySalaryEstimate>> = {
  // Tier 1 / 2 (EU and EEA)
  DE: { currency: 'EUR', security: [58000, 75000], development: [50000, 65000] },
  NL: { currency: 'EUR', security: [52000, 70000], development: [45000, 62000] },
  IE: { currency: 'EUR', security: [60000, 80000], development: [50000, 70000] },
  FR: { currency: 'EUR', security: [45000, 60000], development: [40000, 52000] },
  ES: { currency: 'EUR', security: [35000, 48000], development: [30000, 42000] },
  PT: { currency: 'EUR', security: [28000, 40000], development: [24000, 35000] },
  BE: { currency: 'EUR', security: [48000, 65000], development: [42000, 56000] },
  LU: { currency: 'EUR', security: [60000, 80000], development: [52000, 68000] },
  AT: { currency: 'EUR', security: [52000, 68000], development: [45000, 58000] },
  IT: { currency: 'EUR', security: [35000, 48000], development: [30000, 42000] },
  DK: { currency: 'DKK', security: [550000, 720000], development: [480000, 620000] },
  SE: { currency: 'SEK', security: [550000, 720000], development: [480000, 620000] },
  FI: { currency: 'EUR', security: [50000, 65000], development: [44000, 58000] },
  NO: { currency: 'NOK', security: [650000, 850000], development: [600000, 780000] },
  EE: { currency: 'EUR', security: [36000, 50000], development: [30000, 44000] },
  LT: { currency: 'EUR', security: [30000, 45000], development: [26000, 40000] },
  LV: { currency: 'EUR', security: [28000, 42000], development: [24000, 36000] },
  CZ: { currency: 'CZK', security: [900000, 1300000], development: [750000, 1100000] },
  PL: { currency: 'PLN', security: [180000, 260000], development: [150000, 220000] },
  SI: { currency: 'EUR', security: [35000, 48000], development: [30000, 42000] },
  MT: { currency: 'EUR', security: [38000, 52000], development: [32000, 45000] },
  RO: { currency: 'RON', security: [150000, 230000], development: [120000, 190000] },
  HU: { currency: 'HUF', security: [14000000, 21000000], development: [11000000, 17000000] },
  HR: { currency: 'EUR', security: [28000, 40000], development: [24000, 35000] },
  SK: { currency: 'EUR', security: [30000, 42000], development: [26000, 38000] },
  BG: { currency: 'EUR', security: [26000, 40000], development: [22000, 34000] },
  GR: { currency: 'EUR', security: [26000, 38000], development: [22000, 32000] },
  CY: { currency: 'EUR', security: [35000, 50000], development: [30000, 42000] },
  // Tier 3
  GB: { currency: 'GBP', security: [55000, 75000], development: [45000, 62000] },
  CH: { currency: 'CHF', security: [105000, 135000], development: [95000, 120000] },
  CA: { currency: 'CAD', security: [95000, 125000], development: [80000, 105000] },
  US: { currency: 'USD', security: [130000, 170000], development: [110000, 145000] },
  AU: { currency: 'AUD', security: [120000, 155000], development: [100000, 130000] },
  NZ: { currency: 'NZD', security: [100000, 135000], development: [85000, 115000] },
  SG: { currency: 'SGD', security: [85000, 120000], development: [70000, 100000] },
  JP: { currency: 'JPY', security: [7000000, 10000000], development: [5500000, 8000000] },
  KR: { currency: 'KRW', security: [55000000, 80000000], development: [45000000, 65000000] },
  AE: { currency: 'AED', security: [240000, 360000], development: [180000, 280000] },
  IL: { currency: 'ILS', security: [360000, 480000], development: [300000, 420000] },
  HK: { currency: 'HKD', security: [480000, 700000], development: [400000, 580000] },
  IS: { currency: 'ISK', security: [11000000, 15000000], development: [9500000, 13000000] },
  // Tier 4
  SA: { currency: 'SAR', security: [240000, 360000], development: [180000, 280000] },
  QA: { currency: 'QAR', security: [240000, 360000], development: [180000, 270000] },
  TW: { currency: 'TWD', security: [1200000, 1800000], development: [1000000, 1500000] },
  MY: { currency: 'MYR', security: [100000, 150000], development: [80000, 120000] },
  BR: { currency: 'BRL', security: [150000, 240000], development: [110000, 180000] },
  MX: { currency: 'MXN', security: [600000, 950000], development: [450000, 750000] },
};

const SECURITY_ROLES: ReadonlySet<string> = new Set([
  'cloud_security_engineer',
  'devsecops_engineer',
  'appsec_engineer',
  'product_security_engineer',
  'cloud_security_analyst',
  'security_engineer_cloud',
  'grc_cloud',
  'cloud_engineer_security',
  'other_security',
]);
const DEVELOPMENT_ROLES: ReadonlySet<string> = new Set(['fullstack_developer', 'nextjs_developer', 'node_developer']);

/** Which estimate column a role uses; null = no role-specific estimate (generic tech figure). */
export function estimateTrackFor(roleKey: string | null | undefined): EstimateTrack | null {
  if (!roleKey) return null;
  if (SECURITY_ROLES.has(roleKey)) return 'security';
  if (DEVELOPMENT_ROLES.has(roleKey)) return 'development';
  return null;
}
