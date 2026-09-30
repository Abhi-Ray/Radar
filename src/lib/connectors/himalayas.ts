/**
 * Himalayas remote jobs API: GET https://himalayas.app/jobs/api?limit=20[&cursor=…] (newest first;
 * cursor pagination is the documented way to page). Broad feed → relevance pre-filter; capped
 * pages → incremental. https://himalayas.app/api
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import {
  asRecord,
  description,
  httpUrl,
  isRecord,
  parseConfig,
  prefilterFields,
  rawItem,
  salaryFrom,
  str,
  strArray,
  throwIfAborted,
  toDate,
} from './common';
import { prefilterDecision } from './relevance';
import type { ConnectorModule } from './types';

export const HIMALAYAS_VERSION = 'himalayas@2026-09-30.1';

const BASE = 'https://himalayas.app/jobs/api';
const PAGE = 20;

export const himalayasConfigSchema = z.object({
  maxPages: z.number().int().min(1).max(50).default(10),
  ...prefilterFields(true),
});
export type HimalayasConfig = z.output<typeof himalayasConfigSchema>;

/** Stable id: the job URL (guid) path; Himalayas exposes no numeric id. */
export function himalayasId(job: Record<string, unknown>): string | null {
  const guid = str(job.guid) ?? str(job.applicationLink);
  if (!guid) return null;
  try {
    return new URL(guid).pathname.replace(/\/+$/, '') || null;
  } catch {
    return null;
  }
}

function categoryWords(job: Record<string, unknown>): string[] {
  return [...strArray(job.categories), ...strArray(job.parentCategories)].map((c) => c.replace(/-/g, ' '));
}

export const himalayas: ConnectorModule<HimalayasConfig> = {
  platformKey: 'himalayas',
  version: HIMALAYAS_VERSION,
  kind: 'aggregator',
  listing: 'incremental',
  configSchema: himalayasConfigSchema,
  platform: {
    name: 'Himalayas',
    grade: 'B',
    accessMethod: 'api',
    termsUrl: 'https://himalayas.app/api',
    rateLimitPerMin: 10,
    dailyCap: 120,
    attribution: 'via Himalayas',
    notes: 'Public remote jobs API with cursor pagination; link back to the Himalayas job page.',
  },
  sourceKeyFor: () => 'himalayas:all',

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    return prefilterDecision(str(p.title) ?? '', categoryWords(p), { enabled: cfg.prefilter, keywords: cfg.keywords });
  },

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(himalayasConfigSchema, ctx.source);
    const byId = new Map<string, Record<string, unknown>>();
    let cursor: string | null = null;
    for (let page = 0; page < cfg.maxPages; page++) {
      throwIfAborted(ctx.signal);
      const qs = new URLSearchParams({ limit: String(PAGE) });
      if (cursor) qs.set('cursor', cursor);
      const body = await ctx.http.getJson<unknown>(`${BASE}?${qs.toString()}`);
      if (!isRecord(body) || !Array.isArray(body.jobs)) throw new SourceError('himalayas: response has no jobs array');
      for (const j of body.jobs.filter(isRecord)) {
        const id = himalayasId(j);
        if (id && !byId.has(id)) byId.set(id, j);
      }
      const next = str(body.nextCursor);
      if (!next || next === cursor || body.jobs.length === 0) break;
      cursor = next;
    }
    const fetchedAt = new Date();
    return [...byId.entries()].map(([id, j]) => rawItem(id, j, str(j.applicationLink) ?? str(j.guid), fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const j = asRecord(item.payload);
    const id = himalayasId(j);
    if (!id) throw new ParseError('missing guid', 'guid');
    const title = str(j.title);
    if (!title) throw new ParseError('missing title', 'title');
    const company = str(j.companyName);
    if (!company) throw new ParseError('missing companyName', 'companyName');
    const desc = description([str(j.description)], null);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const restrictions = strArray(j.locationRestrictions);
    const url = httpUrl(j.applicationLink) ?? httpUrl(j.guid);
    if (!url) throw new ParseError('missing applicationLink', 'applicationLink');
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: company,
      companyDomain: null,
      locationRaw: restrictions.length ? `Remote (${restrictions.join(', ')})` : 'Remote (Worldwide)',
      countryHint: restrictions.length === 1 ? restrictions[0] : null,
      cityHint: null,
      workplaceHint: 'remote',
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: url,
      postedAt: toDate(j.pubDate),
      closingAt: toDate(j.expiryDate),
      salaryHint: salaryFrom(j.minSalary, j.maxSalary, j.currency, j.salaryPeriod),
      employmentType: str(j.employmentType),
      extra: {
        seniority: strArray(j.seniority),
        categories: strArray(j.categories),
        timezoneRestrictions: Array.isArray(j.timezoneRestrictions) ? j.timezoneRestrictions.filter((x) => typeof x === 'number') : [],
        locationRestrictions: restrictions,
        attribution: 'Himalayas',
        sourceUrl: url,
      },
    };
  },
};
