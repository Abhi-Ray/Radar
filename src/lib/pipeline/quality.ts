/**
 * Quality gates (pure): what a parsed posting must carry before it may become a job, which fields
 * a source normally fills (for schema-drift detection), and the daily source checks (volume drop /
 * spike, parse-failure share, field drift). Unit-tested; the DB side lives in run.ts.
 */
import type { SourceBaseline } from '../../db/schema/sources';
import type { NormalizedJob } from '../contracts/jobs';
import type { AlertSettings } from '../contracts/settings';
import { DAY_MS, HOUR_MS } from '../time';
import { median } from './health';

export const QUALITY_LOGIC_VERSION = 'quality@2026-09-30.1';

export const MAX_TITLE_RAW = 512;
export const MAX_URL = 2048;
export const MAX_EXTERNAL_ID = 255;
export const MAX_COMPANY_NAME = 255;
export const MAX_LOCATION_RAW = 512;
/** Descriptions are stored in MEDIUMTEXT; anything longer than this is not a real posting. */
export const MAX_DESCRIPTION_CHARS = 200_000;
/** A posted date further in the future than this is a source bug (dropped, the job keeps first-seen). */
export const FUTURE_POSTED_TOLERANCE_MS = DAY_MS;

export type QualityField = 'externalId' | 'title' | 'companyName' | 'applyUrl' | 'description';

export type ValidationResult =
  | { ok: true; job: NormalizedJob; warnings: string[] }
  | { ok: false; field: QualityField; error: string };

function validDate(d: unknown): Date | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d : null;
}

function httpUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/**
 * Hard gates (a failure goes to the dead-letter store, stage 'validate') plus soft repairs that are
 * reported as warnings: posted date in the future → dropped, closing date before posted → dropped.
 */
export function validateNormalizedJob(input: NormalizedJob, now: Date): ValidationResult {
  const externalId = str(input.externalId).trim();
  if (!externalId) return { ok: false, field: 'externalId', error: 'external id is empty' };
  if (externalId.length > MAX_EXTERNAL_ID) return { ok: false, field: 'externalId', error: `external id longer than ${MAX_EXTERNAL_ID} chars` };
  const title = str(input.title).replace(/\s+/g, ' ').trim();
  if (!title) return { ok: false, field: 'title', error: 'title is empty' };
  const companyName = str(input.companyName).replace(/\s+/g, ' ').trim();
  if (!companyName) return { ok: false, field: 'companyName', error: 'company name is empty' };
  const applyUrl = str(input.applyUrl).trim();
  if (!applyUrl) return { ok: false, field: 'applyUrl', error: 'apply URL is empty' };
  if (applyUrl.length > MAX_URL) return { ok: false, field: 'applyUrl', error: `apply URL longer than ${MAX_URL} chars` };
  if (!httpUrl(applyUrl)) return { ok: false, field: 'applyUrl', error: 'apply URL is not an http(s) URL' };
  const text = str(input.descriptionText).trim();
  const html = str(input.descriptionHtml).trim();
  if (!text && !html) return { ok: false, field: 'description', error: 'description is empty' };

  const warnings: string[] = [];
  let postedAt = validDate(input.postedAt);
  if (input.postedAt && !postedAt) warnings.push('posted date invalid (dropped)');
  if (postedAt && postedAt.getTime() > now.getTime() + FUTURE_POSTED_TOLERANCE_MS) {
    warnings.push(`posted date ${postedAt.toISOString()} is in the future (dropped)`);
    postedAt = null;
  }
  let closingAt = validDate(input.closingAt ?? null);
  if (input.closingAt && !closingAt) warnings.push('closing date invalid (dropped)');
  if (closingAt && postedAt && closingAt.getTime() < postedAt.getTime()) {
    warnings.push('closing date before posted date (dropped)');
    closingAt = null;
  }

  return {
    ok: true,
    warnings,
    job: {
      ...input,
      externalId,
      title: title.slice(0, MAX_TITLE_RAW),
      companyName: companyName.slice(0, MAX_COMPANY_NAME),
      companyDomain: input.companyDomain ? str(input.companyDomain).trim().toLowerCase() || null : null,
      locationRaw: str(input.locationRaw).replace(/\s+/g, ' ').trim().slice(0, MAX_LOCATION_RAW),
      descriptionHtml: html ? html : null,
      descriptionText: text.slice(0, MAX_DESCRIPTION_CHARS),
      applyUrl,
      postedAt,
      closingAt,
    },
  };
}

// ---- field presence (schema drift) ------------------------------------------------------------

/** Fields a source "normally" fills; a sudden drop in their share = the source's format changed. */
export const PRESENCE_FIELDS = ['location', 'country', 'posted_at', 'closing_at', 'salary', 'description', 'workplace', 'employment_type', 'company_domain'] as const;
export type PresenceField = (typeof PRESENCE_FIELDS)[number];

/** A description shorter than this is a stub ("see link"), not a posting body. */
export const SUBSTANTIAL_DESCRIPTION_CHARS = 200;

export function fieldPresence(job: NormalizedJob): Record<PresenceField, boolean> {
  const hint = job.salaryHint;
  const text = str(job.descriptionText).trim() || str(job.descriptionHtml).replace(/<[^>]*>/g, ' ').trim();
  return {
    location: !!str(job.locationRaw).trim(),
    country: !!job.countryHint,
    posted_at: !!validDate(job.postedAt),
    closing_at: !!validDate(job.closingAt ?? null),
    salary: !!hint && (typeof hint.min === 'number' || typeof hint.max === 'number' || !!str(hint.raw).trim()),
    description: text.length >= SUBSTANTIAL_DESCRIPTION_CHARS,
    workplace: !!job.workplaceHint,
    employment_type: !!str(job.employmentType).trim(),
    company_domain: !!str(job.companyDomain).trim(),
  };
}

/** Accumulates presence counts over the parsed items of one source run. */
export class PresenceCounter {
  private readonly counts = new Map<PresenceField, number>();
  private n = 0;
  private readonly ages: number[] = [];

  add(job: NormalizedJob, fetchedAt: Date): void {
    this.n++;
    const p = fieldPresence(job);
    for (const f of PRESENCE_FIELDS) if (p[f]) this.counts.set(f, (this.counts.get(f) ?? 0) + 1);
    const posted = validDate(job.postedAt);
    if (posted && posted.getTime() <= fetchedAt.getTime()) this.ages.push((fetchedAt.getTime() - posted.getTime()) / HOUR_MS);
  }

  get total(): number {
    return this.n;
  }

  /** field → share 0..1 (3 decimals); null when nothing was parsed. */
  shares(): Record<string, number> | null {
    if (this.n === 0) return null;
    const out: Record<string, number> = {};
    for (const f of PRESENCE_FIELDS) out[f] = Math.round(((this.counts.get(f) ?? 0) / this.n) * 1000) / 1000;
    return out;
  }

  /** Median posting age in hours (baseline "freshness"); null without dated postings. */
  freshnessHours(): number | null {
    const m = median(this.ages);
    return m === null ? null : Math.round(m * 10) / 10;
  }
}

// ---- daily source checks ---------------------------------------------------------------------

/** Minimum attempted items before the parse-failure share is judged. */
export const MIN_ITEMS_FOR_PARSE_CHECK = 5;
/** Minimum parsed items before field drift is judged. */
export const MIN_ITEMS_FOR_DRIFT_CHECK = 10;

export interface SchemaDrift {
  field: string;
  baseline: number;
  current: number;
}

export interface SourceHealthFlags {
  volume_drop?: { listed: number; baselineMin: number; thresholdPct: number };
  volume_spike?: { listed: number; baselineMax: number; thresholdPct: number };
  /** Share 0..1 of attempted items that failed parse/validate. */
  parse_fail_pct?: number;
  schema_drift?: SchemaDrift[];
}

export interface SourceHealthInput {
  /** Items the listing returned (markers excluded). */
  listed: number;
  /** Items that went through parse (not filtered, not seen-only, not unchanged). */
  attempted: number;
  /** Items that failed parse or validation. */
  failedParse: number;
  parsed: number;
  presence: Record<string, number> | null;
  baseline: SourceBaseline | null;
  settings: Pick<AlertSettings, 'volumeDropPct' | 'volumeSpikePct' | 'parseFailPct' | 'fieldDriftPct'>;
  /** Only complete full listings are compared with the volume baseline. */
  completeListing: boolean;
}

/** The daily checks of one source run. Empty object = nothing unusual. */
export function evaluateSourceHealth(input: SourceHealthInput): SourceHealthFlags {
  const flags: SourceHealthFlags = {};
  const b = input.baseline;
  if (b && input.completeListing) {
    if (b.volume_min !== null && b.volume_min > 0) {
      const limit = b.volume_min * (1 - input.settings.volumeDropPct / 100);
      if (input.listed < limit) flags.volume_drop = { listed: input.listed, baselineMin: b.volume_min, thresholdPct: input.settings.volumeDropPct };
    }
    if (b.volume_max !== null && b.volume_max > 0) {
      const limit = b.volume_max * (1 + input.settings.volumeSpikePct / 100);
      if (input.listed > limit) flags.volume_spike = { listed: input.listed, baselineMax: b.volume_max, thresholdPct: input.settings.volumeSpikePct };
    }
  }
  if (input.attempted >= MIN_ITEMS_FOR_PARSE_CHECK) {
    const share = input.failedParse / input.attempted;
    if (share * 100 >= input.settings.parseFailPct) flags.parse_fail_pct = Math.round(share * 1000) / 1000;
  }
  if (b && input.presence && input.parsed >= MIN_ITEMS_FOR_DRIFT_CHECK) {
    const drift: SchemaDrift[] = [];
    for (const [field, base] of Object.entries(b.field_presence ?? {})) {
      const current = input.presence[field];
      if (typeof current !== 'number' || typeof base !== 'number') continue;
      if ((base - current) * 100 > input.settings.fieldDriftPct) drift.push({ field, baseline: base, current });
    }
    if (drift.length) flags.schema_drift = drift;
  }
  return flags;
}

/** Share of failures that makes a run 'partial' (settings.alerts.parseFailPct). */
export function parseFailTooHigh(attempted: number, failed: number, parseFailPct: number): boolean {
  return attempted >= MIN_ITEMS_FOR_PARSE_CHECK && (failed / attempted) * 100 >= parseFailPct;
}
