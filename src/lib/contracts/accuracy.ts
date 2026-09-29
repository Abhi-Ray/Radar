/**
 * Golden-sample label shape (golden_samples.labels_json). An absent key = not labelled for that
 * field (excluded from that field's precision/recall). Client-safe.
 */
import { z } from 'zod';
import {
  LANGUAGE_REQUIREMENTS,
  REMOTE_CLASSES,
  SENIORITY_WORDS,
  VISA_STATUSES,
} from '../../db/schema/_enums';

export const goldenLabelsSchema = z
  .object({
    /** Is this job relevant for the profile (role match)? */
    role_match: z.boolean().optional(),
    /** Expected canonical role key (optional, finer than role_match). */
    role_key: z.string().nullable().optional(),
    seniority: z.enum(SENIORITY_WORDS).nullable().optional(),
    visa_status: z.enum(VISA_STATUSES).optional(),
    remote_class: z.enum(REMOTE_CLASSES).optional(),
    salary: z
      .object({
        stated: z.boolean(),
        currency: z.string().length(3).nullable().optional(),
        period: z.enum(['hour', 'day', 'month', 'year']).nullable().optional(),
        min: z.number().nullable().optional(),
        max: z.number().nullable().optional(),
      })
      .optional(),
    language: z.enum(LANGUAGE_REQUIREMENTS).optional(),
    country_iso2: z.string().length(2).nullable().optional(),
    experience_min_years: z.number().nullable().optional(),
  })
  .strict();
export type GoldenLabels = z.output<typeof goldenLabelsSchema>;

export const GOLDEN_FIELDS = [
  'role_match',
  'role_key',
  'seniority',
  'visa_status',
  'remote_class',
  'salary',
  'language',
  'country_iso2',
  'experience_min_years',
] as const;
export type GoldenField = (typeof GOLDEN_FIELDS)[number];

export interface GoldenSnapshot {
  title: string;
  company: string;
  locationRaw: string;
  countryHint?: string | null;
  descriptionText: string;
  applyUrl?: string | null;
  sourceKey?: string | null;
  salaryHint?: { min?: number; max?: number; currency?: string; period?: string; raw?: string } | null;
  workplaceHint?: 'onsite' | 'hybrid' | 'remote' | null;
}

export interface FieldMetrics {
  /** Items where both label and prediction exist. */
  support: number;
  correct: number;
  accuracy: number | null;
  /** For categorical fields: macro precision/recall over classes present. */
  precision: number | null;
  recall: number | null;
  /** Special: wrong "confirmed" visa predictions (the worst error, spec §2). */
  falseConfirmed?: number;
}

export interface AccuracyResults {
  fields: Partial<Record<GoldenField, FieldMetrics>>;
  bySource: Record<string, Partial<Record<GoldenField, FieldMetrics>>>;
}
