/**
 * Arbeitnow job board API (free, public, Europe/Germany focused):
 *   GET https://www.arbeitnow.com/api/job-board-api?page=N  (newest first, 100 per page)
 * Broad feed → relevance pre-filter; capped pages → incremental. Terms ask for a link back.
 * https://www.arbeitnow.com/blog/job-board-api
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

export const ARBEITNOW_VERSION = 'arbeitnow@2026-09-30.1';

const BASE = 'https://www.arbeitnow.com/api/job-board-api';

export const arbeitnowConfigSchema = z.object({
  maxPages: z.number().int().min(1).max(10).default(3),
  ...prefilterFields(true),
});
export type ArbeitnowConfig = z.output<typeof arbeitnowConfigSchema>;

export const arbeitnow: ConnectorModule<ArbeitnowConfig> = {
  platformKey: 'arbeitnow',
  version: ARBEITNOW_VERSION,
  kind: 'aggregator',
  listing: 'incremental',
  configSchema: arbeitnowConfigSchema,
  platform: {
    name: 'Arbeitnow',
    grade: 'B',
    accessMethod: 'api',
    termsUrl: 'https://www.arbeitnow.com/blog/job-board-api',
    rateLimitPerMin: 10,
    dailyCap: 60,
    attribution: 'via Arbeitnow',
    notes: 'Free public job board API; newest first, hourly updates. Link back requested.',
  },
  sourceKeyFor: () => 'arbeitnow:all',

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    return prefilterDecision(str(p.title) ?? '', strArray(p.tags), { enabled: cfg.prefilter, keywords: cfg.keywords });
  },

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(arbeitnowConfigSchema, ctx.source);
    const bySlug = new Map<string, Record<string, unknown>>();
    for (let page = 1; page <= cfg.maxPages; page++) {
      throwIfAborted(ctx.signal);
      const body = await ctx.http.getJson<unknown>(`${BASE}?page=${page}`);
      if (!isRecord(body) || !Array.isArray(body.data)) throw new SourceError('arbeitnow: response has no data array');
      for (const j of body.data.filter(isRecord)) {
        const slug = str(j.slug);
        if (slug && !bySlug.has(slug)) bySlug.set(slug, j);
      }
      const links = isRecord(body.links) ? body.links : {};
      if (!str(links.next) || body.data.length === 0) break;
    }
    const fetchedAt = new Date();
    return [...bySlug.entries()].map(([slug, j]) => rawItem(slug, j, str(j.url), fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const j = asRecord(item.payload);
    const slug = reqStr(j, 'slug');
    const title = reqStr(j, 'title');
    const company = reqStr(j, 'company_name', 'company_name');
    const desc = description([str(j.description)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const location = str(j.location) ?? '';
    const remote = j.remote === true;
    const types = strArray(j.job_types);
    return {
      sourceId: ctx.source.id,
      externalId: slug,
      title,
      companyName: company,
      companyDomain: null,
      locationRaw: remote && !/remote/i.test(location) ? `${location}${location ? ' ' : ''}(Remote)` : location,
      // Arbeitnow is a German board; the location string decides, this only breaks ties.
      countryHint: null,
      cityHint: null,
      workplaceHint: remote ? 'remote' : null,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: reqUrl(j.url, 'url'),
      postedAt: toDate(j.created_at),
      closingAt: null,
      salaryHint: null,
      employmentType: types.join(', ') || null,
      extra: { tags: strArray(j.tags), jobTypes: types, attribution: 'Arbeitnow', sourceUrl: str(j.url) },
    };
  },
};
