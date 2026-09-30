/**
 * Typed settings (JSON rows in `settings`). Zod schemas + defaults live here so both the server
 * (src/lib/settings.ts) and forms can share them. Client-safe (zod only).
 *
 * Every schema parses `{}` into a complete default value (nested objects use `.prefault({})`, so
 * inner defaults are applied). Percentages are whole numbers (60 = 60%).
 */
import { z } from 'zod';
import { COMPANY_TYPES, ROLE_FAMILIES, SENIORITY_WORDS } from '../../db/schema/_enums';

const years = z.number().min(0).max(40);
const band = z.tuple([years, years]).refine(([lo, hi]) => lo <= hi, 'band must be [low, high]');
const iso2 = z
  .string()
  .length(2)
  .transform((s) => s.toUpperCase());

/** Spec §4 tiers, in build order. 'XW' = remote / worldwide pseudo-country. */
export const TIER_1_COUNTRIES = ['DE', 'NL', 'IE', 'FR', 'ES', 'PT', 'BE', 'LU', 'AT', 'IT'] as const;
export const TIER_2_COUNTRIES = [
  'DK', 'SE', 'FI', 'NO', 'EE', 'LT', 'LV', 'CZ', 'PL', 'SI', 'MT', 'RO', 'HU', 'HR', 'SK', 'BG', 'GR', 'CY',
] as const;
export const TIER_3_COUNTRIES = ['GB', 'CH', 'CA', 'US', 'AU', 'NZ', 'SG', 'JP', 'KR', 'AE', 'IL', 'HK', 'IS'] as const;
export const TIER_4_COUNTRIES = ['SA', 'QA', 'TW', 'MY', 'BR', 'MX'] as const;
export const REMOTE_COUNTRY = 'XW';
export const DEFAULT_TARGET_COUNTRIES: readonly string[] = [
  ...TIER_1_COUNTRIES,
  ...TIER_2_COUNTRIES,
  ...TIER_3_COUNTRIES,
  ...TIER_4_COUNTRIES,
  REMOTE_COUNTRY,
];

/** Canonical role keys (spec §3). The title mapper (NORMALIZE) emits these keys. */
export const DEFAULT_TARGET_ROLES = {
  primary: ['cloud_security_engineer', 'devsecops_engineer', 'appsec_engineer', 'product_security_engineer'],
  secondary: ['cloud_security_analyst', 'security_engineer_cloud', 'grc_cloud', 'cloud_engineer_security'],
  fallback: ['fullstack_developer', 'nextjs_developer', 'node_developer'],
} as const;

export const DEFAULT_SKILLS: readonly string[] = [
  'AWS',
  'Azure',
  'GCP',
  'IAM',
  'Terraform',
  'Kubernetes',
  'Docker',
  'CI/CD',
  'SAST',
  'DAST',
  'SIEM',
  'GDPR',
  'ISO 27001',
  'SOC 2',
  'Python',
  'Node.js',
  'Next.js',
  'Linux',
];

const roleList = z.array(z.string().trim().min(1).max(64)).max(50);

export const profileSchema = z.object({
  /** ISO2 of the passport held (visa rules are evaluated for this nationality). */
  passport: iso2.default('IN'),
  degree: z.string().trim().max(120).default('B.Tech'),
  /** Level used by visa rules. B.Tech = bachelor. */
  degreeLevel: z.enum(['none', 'bachelor', 'master', 'phd']).default('bachelor'),
  yearsTotal: years.default(3),
  yearsCloud: years.default(1.2),
  expectedSalaryEur: z.number().int().min(0).max(1_000_000).default(55_000),
  salaryFloorEur: z.number().int().min(0).max(1_000_000).default(45_000),
  targetRoles: z
    .object({
      primary: roleList.default([...DEFAULT_TARGET_ROLES.primary]),
      secondary: roleList.default([...DEFAULT_TARGET_ROLES.secondary]),
      fallback: roleList.default([...DEFAULT_TARGET_ROLES.fallback]),
    })
    .prefault({}),
  experienceBand: z
    .object({
      core: band.default([2, 4]),
      show: band.default([1, 5]),
      /** Postings asking fewer than this many years are hidden (graduate/junior). */
      hideBelow: years.default(1),
      /** Postings asking this many years or more are hidden. */
      hideAbove: years.default(6),
    })
    .prefault({}),
  targetCountries: z.array(iso2).max(100).default([...DEFAULT_TARGET_COUNTRIES]),
  /** None excluded by default (spec §3). */
  companyTypes: z.array(z.enum(COMPANY_TYPES)).default([...COMPANY_TYPES]),
  skills: z.array(z.string().trim().min(1).max(40)).max(100).default([...DEFAULT_SKILLS]),
});
export type Profile = z.output<typeof profileSchema>;

export const SCORE_COMPONENT_KEYS = [
  'role',
  'experience',
  'visa',
  'salary',
  'remote',
  'language',
  'freshness',
  'skills',
  'company',
] as const;
export type ScoreComponentKey = (typeof SCORE_COMPONENT_KEYS)[number];

const weight = z.number().min(0).max(100);

/** Relative weights (defaults sum to 100; the scorer normalises by the sum). */
export const scoreWeightsSchema = z.object({
  role: weight.default(22),
  experience: weight.default(12),
  visa: weight.default(20),
  salary: weight.default(10),
  remote: weight.default(8),
  language: weight.default(8),
  freshness: weight.default(7),
  skills: weight.default(8),
  company: weight.default(5),
});
export type ScoreWeights = z.output<typeof scoreWeightsSchema>;

const pct = z.number().min(0).max(100);

export const alertSettingsSchema = z.object({
  /** Channels are opt-in; they additionally need their env credentials. */
  telegram: z.boolean().default(false),
  email: z.boolean().default(false),
  /** Minimum severity pushed to channels (all alerts are always shown in the UI). */
  minSeverity: z.enum(['info', 'warn', 'critical']).default('warn'),
  /** Volume drop vs the source baseline that raises an alert, in %. */
  volumeDropPct: pct.default(60),
  /** Volume above baseline max that raises an alert, in % over max. */
  volumeSpikePct: z.number().min(0).max(10_000).default(300),
  /** Share of fetched items failing to parse that raises an alert, in %. */
  parseFailPct: pct.default(20),
  /** Drop in a field's presence share (percentage points) that counts as schema drift. */
  fieldDriftPct: pct.default(30),
  /** Hours without a successful pipeline run before the heartbeat alert. */
  heartbeatHours: z.number().int().min(1).max(168).default(30),
  digest: z.boolean().default(true),
  /** Local (APP_TZ) hour of the morning digest. */
  digestHour: z.number().int().min(0).max(23).default(8),
});
export type AlertSettings = z.output<typeof alertSettingsSchema>;

export const aiSettingsSchema = z.object({
  /** Only effective when the env also enables AI (AI_ENABLED + OPENROUTER_API_KEY). */
  enabled: z.boolean().default(true),
  /** Can only lower the env AI_DAILY_LIMIT, never raise it. */
  dailyLimit: z.number().int().min(0).max(1000).default(50),
  /** Calls kept free for manual requests from the job page. */
  reserveForManual: z.number().int().min(0).max(100).default(5),
});
export type AiSettings = z.output<typeof aiSettingsSchema>;

export const retentionSettingsSchema = z.object({
  /** Raw snapshots older than this are pruned (unless `retained`). */
  rawDays: z.number().int().min(7).max(3650).default(90),
});
export type RetentionSettings = z.output<typeof retentionSettingsSchema>;

/**
 * Manual title → role decisions from the title review queue, keyed by the normalised title
 * (the `normalized` column of title_review_queue). Consulted before the built-in dictionary.
 */
export const titleOverrideSchema = z.object({
  roleKey: z.string().trim().min(1).max(64).nullable(),
  roleFamily: z.enum(ROLE_FAMILIES),
  seniorityWord: z.enum(SENIORITY_WORDS).nullable().default(null),
  note: z.string().max(500).nullable().default(null),
  decidedAt: z.string().nullable().default(null),
});
export type TitleOverride = z.output<typeof titleOverrideSchema>;
export const titleOverridesSchema = z.record(z.string().min(1).max(512), titleOverrideSchema).default({});
export type TitleOverrides = z.output<typeof titleOverridesSchema>;

export const fxRatesSchema = z.object({
  /** ECB reference date 'YYYY-MM-DD'. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  base: z.literal('EUR').default('EUR'),
  /** 1 EUR = rates[CUR] units of CUR. */
  rates: z.record(z.string(), z.number().positive()),
  /** ISO timestamp of the fetch. */
  fetchedAt: z.string(),
  source: z.string().default('ECB euro foreign exchange reference rates'),
});
export type FxRatesSetting = z.output<typeof fxRatesSchema>;

export const SETTINGS_SCHEMAS = {
  profile: profileSchema,
  score_weights: scoreWeightsSchema,
  alerts: alertSettingsSchema,
  ai: aiSettingsSchema,
  retention: retentionSettingsSchema,
  title_overrides: titleOverridesSchema,
  fx_rates: fxRatesSchema,
} as const;
export type SettingKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS_SCHEMAS)[K]>;
/** Keys that have a default (fx_rates must come from the ECB). */
export type DefaultedSettingKey = Exclude<SettingKey, 'fx_rates'>;
export const DEFAULTED_SETTING_KEYS: readonly DefaultedSettingKey[] = [
  'profile',
  'score_weights',
  'alerts',
  'ai',
  'retention',
  'title_overrides',
];

export function isSettingKey(v: unknown): v is SettingKey {
  return typeof v === 'string' && Object.prototype.hasOwnProperty.call(SETTINGS_SCHEMAS, v);
}

/** A fresh default value (new object each call, safe to mutate). */
export function defaultSetting<K extends DefaultedSettingKey>(key: K): SettingValue<K> {
  return SETTINGS_SCHEMAS[key].parse({}) as SettingValue<K>;
}
