/**
 * Remotive public API: GET https://remotive.com/api/remote-jobs?category=… returns every listed
 * job of a category (delayed 24 h). Terms: link back to the Remotive URL and name Remotive as the
 * source; at most ~4 requests a day. One request per category per run, daily cap enforced by
 * PoliteHttp. A category response is complete → 'full' listing.
 * https://remotive.com/api-documentation
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import {
  asRecord,
  description,
  isRecord,
  parseConfig,
  prefilterFields,
  rawItem,
  reqStr,
  reqUrl,
  str,
  strArray,
  throwIfAborted,
  toDate,
} from './common';
import { prefilterDecision } from './relevance';
import type { ConnectorModule } from './types';

export const REMOTIVE_VERSION = 'remotive@2026-09-30.1';

const BASE = 'https://remotive.com/api/remote-jobs';
const CATEGORIES = ['software-dev', 'devops', 'data', 'qa', 'product', 'customer-support', 'design', 'marketing', 'sales', 'all-others'] as const;

export const remotiveConfigSchema = z.object({
  categories: z.array(z.enum(CATEGORIES)).min(1).max(2).default(['software-dev', 'devops']),
  ...prefilterFields(true),
});
export type RemotiveConfig = z.output<typeof remotiveConfigSchema>;

const JOB_TYPES: Record<string, string> = { full_time: 'Full-time', part_time: 'Part-time', contract: 'Contract', freelance: 'Freelance', internship: 'Internship' };

export const remotive: ConnectorModule<RemotiveConfig> = {
  platformKey: 'remotive',
  version: REMOTIVE_VERSION,
  kind: 'aggregator',
  listing: 'full',
  configSchema: remotiveConfigSchema,
  platform: {
    name: 'Remotive',
    grade: 'B',
    accessMethod: 'api',
    termsUrl: 'https://remotive.com/api-documentation',
    rateLimitPerMin: 2,
    dailyCap: 4,
    attribution: 'Source: Remotive (link back to the Remotive job page)',
    notes: 'Public API, max ~4 requests/day, jobs delayed 24 h; must link back and credit Remotive.',
  },
  sourceKeyFor: (c) => `remotive:${[...c.categories].sort().join('+')}`,

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    return prefilterDecision(str(p.title) ?? '', [...strArray(p.tags), str(p.category) ?? ''], { enabled: cfg.prefilter, keywords: cfg.keywords });
  },

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(remotiveConfigSchema, ctx.source);
    const byId = new Map<string, Record<string, unknown>>();
    for (const category of cfg.categories) {
      throwIfAborted(ctx.signal);
      const body = await ctx.http.getJson<unknown>(`${BASE}?category=${encodeURIComponent(category)}`);
      if (!isRecord(body) || !Array.isArray(body.jobs)) throw new SourceError('remotive: response has no jobs array');
      for (const j of body.jobs.filter(isRecord)) {
        const id = str(j.id);
        if (id && !byId.has(id)) byId.set(id, j);
      }
    }
    const fetchedAt = new Date();
    return [...byId.entries()].map(([id, j]) => rawItem(id, j, str(j.url), fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const j = asRecord(item.payload);
    const id = reqStr(j, 'id');
    const title = reqStr(j, 'title');
    const desc = description([str(j.description)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const where = str(j.candidate_required_location) ?? 'Worldwide';
    const url = reqUrl(j.url, 'url');
    const salary = str(j.salary);
    const jobType = str(j.job_type);
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: reqStr(j, 'company_name', 'company_name'),
      companyDomain: null,
      locationRaw: /remote/i.test(where) ? where : `Remote (${where})`,
      countryHint: null,
      cityHint: null,
      workplaceHint: 'remote',
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      // Terms: applications go through the Remotive job page.
      applyUrl: url,
      postedAt: toDate(j.publication_date),
      closingAt: null,
      salaryHint: salary ? { raw: salary } : null,
      employmentType: jobType ? (JOB_TYPES[jobType] ?? jobType) : null,
      extra: { category: str(j.category), tags: strArray(j.tags), attribution: 'Remotive', sourceUrl: url },
    };
  },
};
