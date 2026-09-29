/**
 * Typed settings (JSON rows in `settings`). Zod schemas + defaults live here so both the server
 * (src/lib/settings.ts) and forms can share them. Client-safe (zod only).
 */
import { z } from 'zod';

const band = z.tuple([z.number().min(0).max(40), z.number().min(0).max(40)]);

export const profileSchema = z.object({
  name: z.string().max(120).default('Operator'),
  /** ISO2 of the passport(s) held. */
  passports: z.array(z.string().length(2)).default(['IN']),
  degree: z.string().max(120).default('B.Tech'),
  /** Level used by rules: 'bachelor' | 'master' | 'phd' | 'none'. */
  degreeLevel: z.enum(['none', 'bachelor', 'master', 'phd']).default('bachelor'),
  yearsTotal: z.number().min(0).max(50).default(4),
  yearsCloud: z.number().min(0).max(50).default(1.7),
  expectedSalaryEur: z.number().int().min(0).max(1_000_000).default(60_000),
  salaryFloorEur: z.number().int().min(0).max(1_000_000).default(45_000),
  targetRoles: z
    .object({
      primary: z.array(z.string()).default(['cloud_security_engineer', 'devsecops_engineer', 'application_security_engineer']),
      secondary: z
        .array(z.string())
        .default(['cloud_security_analyst', 'security_engineer', 'grc_cloud', 'cloud_engineer_security']),
      fallback: z.array(z.string()).default(['fullstack_developer', 'nextjs_developer', 'node_developer']),
    })
    .default({
      primary: ['cloud_security_engineer', 'devsecops_engineer', 'application_security_engineer'],
      secondary: ['cloud_security_analyst', 'security_engineer', 'grc_cloud', 'cloud_engineer_security'],
      fallback: ['fullstack_developer', 'nextjs_developer', 'node_developer'],
    }),
  experienceBand: z
    .object({ core: band.default([2, 4]), show: band.default([1, 5]), hideBelow: z.number().default(1), hideAbove: z.number().default(6) })
    .default({ core: [2, 4], show: [1, 5], hideBelow: 1, hideAbove: 6 }),
  targetCountries: z
    .array(z.string().length(2))
    .default(['DE', 'NL', 'IE', 'FR', 'ES', 'PT', 'BE', 'LU', 'AT', 'IT', 'XW']),
  companyTypes: z.array(z.enum(['startup', 'scaleup', 'midsize', 'mnc', 'agency', 'unknown'])).default([
    'startup',
    'scaleup',
    'midsize',
    'mnc',
    'unknown',
  ]),
  skills: z
    .array(z.string().max(40))
    .default([
      'aws',
      'azure',
      'gcp',
      'iam',
      'terraform',
      'kubernetes',
      'docker',
      'ci/cd',
      'sast',
      'dast',
      'siem',
      'gdpr',
      'iso 27001',
      'soc 2',
      'python',
      'node.js',
      'typescript',
      'next.js',
      'linux',
      'threat modeling',
    ]),
  /** Languages spoken (ISO 639-1) — English is assumed. */
  languages: z.array(z.string().min(2).max(3)).default(['en', 'hi']),
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

export const scoreWeightsSchema = z.object({
  role: z.number().min(0).max(100).default(22),
  experience: z.number().min(0).max(100).default(12),
  visa: z.number().min(0).max(100).default(20),
  salary: z.number().min(0).max(100).default(12),
  remote: z.number().min(0).max(100).default(8),
  language: z.number().min(0).max(100).default(8),
  freshness: z.number().min(0).max(100).default(6),
  skills: z.number().min(0).max(100).default(8),
  company: z.number().min(0).max(100).default(4),
});
export type ScoreWeights = z.output<typeof scoreWeightsSchema>;

export const alertSettingsSchema = z.object({
  telegram: z.boolean().default(true),
  email: z.boolean().default(true),
  /** Minimum severity that is pushed to channels (all are shown in the UI). */
  minSeverity: z.enum(['info', 'warn', 'critical']).default('warn'),
  /** Relative volume drop vs baseline that raises an alert (0.5 = 50%). */
  volumeDropPct: z.number().min(0.05).max(1).default(0.5),
  volumeSpikePct: z.number().min(0.1).max(20).default(3),
  parseFailPct: z.number().min(0).max(1).default(0.1),
  /** Absolute drop in a field's presence share that counts as schema drift. */
  fieldDriftPct: z.number().min(0.05).max(1).default(0.3),
  /** Hours without a successful pipeline run before the heartbeat alert. */
  heartbeatHours: z.number().min(1).max(168).default(30),
  digest: z.boolean().default(true),
  /** Local (APP_TZ) hour for the morning digest. */
  digestHour: z.number().int().min(0).max(23).default(8),
});
export type AlertSettings = z.output<typeof alertSettingsSchema>;

export const aiSettingsSchema = z.object({
  enabled: z.boolean().default(true),
  /** Can only be lowered below the env AI_DAILY_LIMIT, never raised above it. */
  dailyLimit: z.number().int().min(0).max(1000).default(50),
  /** Calls kept free for manual requests from the job page. */
  reserveForManual: z.number().int().min(0).max(50).default(5),
  /** Minimum fit score for a job to be queued automatically. */
  minScoreForQueue: z.number().int().min(0).max(100).default(55),
  batchSize: z.number().int().min(1).max(5).default(3),
});
export type AiSettings = z.output<typeof aiSettingsSchema>;

export const retentionSettingsSchema = z.object({
  rawDays: z.number().int().min(7).max(3650).default(90),
  auditDays: z.number().int().min(30).max(36500).default(730),
  loginAttemptDays: z.number().int().min(7).max(3650).default(90),
});
export type RetentionSettings = z.output<typeof retentionSettingsSchema>;

export const fxRatesSchema = z.object({
  /** ECB reference date 'YYYY-MM-DD'. */
  date: z.string(),
  base: z.literal('EUR').default('EUR'),
  /** 1 EUR = rates[CUR] units of CUR. */
  rates: z.record(z.string(), z.number().positive()),
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
  fx_rates: fxRatesSchema,
} as const;
export type SettingKey = keyof typeof SETTINGS_SCHEMAS;
export type SettingValue<K extends SettingKey> = z.output<(typeof SETTINGS_SCHEMAS)[K]>;

/** Defaults (fx_rates has none: it must come from the ECB). */
export function defaultSetting<K extends Exclude<SettingKey, 'fx_rates'>>(key: K): SettingValue<K> {
  return SETTINGS_SCHEMAS[key].parse({}) as SettingValue<K>;
}
