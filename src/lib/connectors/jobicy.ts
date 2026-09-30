/**
 * Jobicy remote jobs API: GET https://jobicy.com/api/v2/remote-jobs?count=…&tag=…[&geo=…]
 * (latest N per tag, max 50). Terms: credit Jobicy with a direct link to the source and send
 * applications to the original job URL from the feed. Latest-N window → incremental.
 * https://jobicy.com/jobs-rss-feed
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
  salaryFrom,
  str,
  strArray,
  throwIfAborted,
  toDate,
} from './common';
import { prefilterDecision } from './relevance';
import type { ConnectorModule } from './types';

export const JOBICY_VERSION = 'jobicy@2026-09-30.1';

const BASE = 'https://jobicy.com/api/v2/remote-jobs';

export const jobicyConfigSchema = z.object({
  tags: z
    .array(
      z
        .string()
        .trim()
        .toLowerCase()
        .regex(/^[a-z0-9][a-z0-9 +#.-]{0,40}$/),
    )
    .min(1)
    .max(5)
    .default(['security', 'devops']),
  count: z.number().int().min(1).max(50).default(50),
  /** Region filter slug (e.g. 'europe', 'germany'); omitted = all. */
  geo: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z-]{2,40}$/)
    .optional(),
  ...prefilterFields(true),
});
export type JobicyConfig = z.output<typeof jobicyConfigSchema>;

export const jobicy: ConnectorModule<JobicyConfig> = {
  platformKey: 'jobicy',
  version: JOBICY_VERSION,
  kind: 'aggregator',
  listing: 'incremental',
  configSchema: jobicyConfigSchema,
  platform: {
    name: 'Jobicy',
    grade: 'B',
    accessMethod: 'api',
    termsUrl: 'https://jobicy.com/jobs-rss-feed',
    rateLimitPerMin: 2,
    dailyCap: 24,
    attribution: 'Source: Jobicy (link back to the Jobicy job page)',
    notes: 'Public remote jobs API; credit Jobicy with a direct link; apply via the original URL.',
  },
  sourceKeyFor: (c) => `jobicy:${[...c.tags].sort().join('+')}${c.geo ? `@${c.geo}` : ''}`,

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    return prefilterDecision(str(p.jobTitle) ?? '', strArray(p.jobIndustry), { enabled: cfg.prefilter, keywords: cfg.keywords });
  },

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(jobicyConfigSchema, ctx.source);
    const byId = new Map<string, Record<string, unknown>>();
    for (const tag of cfg.tags) {
      throwIfAborted(ctx.signal);
      const qs = new URLSearchParams({ count: String(cfg.count), tag });
      if (cfg.geo) qs.set('geo', cfg.geo);
      const body = await ctx.http.getJson<unknown>(`${BASE}?${qs.toString()}`);
      if (!isRecord(body)) throw new SourceError('jobicy: response is not an object');
      // No match → { success: false, jobCount: 0 } without a jobs array.
      const jobs = Array.isArray(body.jobs) ? body.jobs.filter(isRecord) : [];
      if (!jobs.length && body.success !== false && !('jobCount' in body)) throw new SourceError('jobicy: response has no jobs array');
      for (const j of jobs) {
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
    const title = reqStr(j, 'jobTitle', 'jobTitle');
    const desc = description([str(j.jobDescription)]);
    if (!desc.text) throw new ParseError('empty description', 'jobDescription');
    const geo = (str(j.jobGeo) ?? 'Anywhere').replace(/\s*,\s*/g, ', ');
    const url = reqUrl(j.url, 'url');
    const types = strArray(j.jobType);
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: reqStr(j, 'companyName', 'companyName'),
      companyDomain: null,
      locationRaw: /remote/i.test(geo) ? geo : `Remote (${geo})`,
      countryHint: null,
      cityHint: null,
      workplaceHint: 'remote',
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: url,
      postedAt: toDate(j.pubDate),
      closingAt: null,
      salaryHint: salaryFrom(j.salaryMin, j.salaryMax, j.salaryCurrency, j.salaryPeriod),
      employmentType: types.join(', ') || null,
      extra: {
        level: str(j.jobLevel),
        industry: strArray(j.jobIndustry),
        excerpt: str(j.jobExcerpt),
        attribution: 'Jobicy',
        sourceUrl: url,
      },
    };
  },
};
