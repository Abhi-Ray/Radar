/**
 * JobTech JobSearch (Arbetsförmedlingen / Platsbanken open data, no key):
 *   GET https://jobsearch.api.jobtechdev.se/search?q=…&published-after=…&limit=100&offset=…
 * Every query is filtered by publication age → incremental. Ads flagged `removed` are passed on as
 * source-closed markers. https://jobsearch.api.jobtechdev.se/
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import {
  asRecord,
  capIfUpper,
  description,
  httpUrl,
  isRecord,
  joinLocation,
  parseConfig,
  prefilterFields,
  rawItem,
  reqStr,
  str,
  throwIfAborted,
  toDate,
  type Rec,
} from './common';
import { prefilterDecision } from './relevance';
import { markPartial, sourceClosedPayload, type ConnectorModule } from './types';

export const JOBTECH_SE_VERSION = 'jobtech_se@2026-09-30.1';

const BASE = 'https://jobsearch.api.jobtechdev.se/search';
/** The API refuses offset + limit beyond this. */
const MAX_OFFSET = 2000;

export const jobtechConfigSchema = z.object({
  /** Free-text queries (Swedish and English titles/skills). Results are merged by ad id. */
  queries: z.array(z.string().trim().min(2).max(100)).min(1).max(20).default(['IT-säkerhet', 'security engineer', 'cloud security', 'devsecops']),
  limit: z.number().int().min(10).max(100).default(100),
  maxPages: z.number().int().min(1).max(20).default(2),
  publishedAfterDays: z.number().int().min(1).max(60).default(14),
  /** Server-side filters (taxonomy concept ids / municipality codes), optional. */
  occupationField: z.string().trim().max(32).optional(),
  municipality: z.string().trim().max(8).optional(),
  ...prefilterFields(false),
});
export type JobtechConfig = z.output<typeof jobtechConfigSchema>;

function label(v: unknown): string | null {
  return isRecord(v) ? str(v.label) : null;
}

function publishedAfter(days: number, now: Date): string {
  // The API takes a zone-less local timestamp; an hour of slack either way does not matter here.
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 19);
}

export const jobtechSe: ConnectorModule<JobtechConfig> = {
  platformKey: 'jobtech_se',
  version: JOBTECH_SE_VERSION,
  kind: 'government',
  listing: 'incremental',
  configSchema: jobtechConfigSchema,
  platform: {
    name: 'JobTech JobSearch (Arbetsförmedlingen)',
    grade: 'A',
    accessMethod: 'api',
    termsUrl: 'https://jobtechdev.se/en/components/jobsearch',
    rateLimitPerMin: 30,
    dailyCap: 400,
    attribution: 'Source: Arbetsförmedlingen (Platsbanken)',
    notes: 'Swedish public employment service open data (CC0); query-based, published-after window.',
  },
  sourceKeyFor: (c) => `jobtech_se:${c.queries.map((q) => q.toLowerCase().replace(/\s+/g, '-')).join('+')}`.slice(0, 191),

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    const tags = [label(p.occupation), label(p.occupation_group)].filter((x): x is string => x !== null);
    return prefilterDecision(str(p.headline) ?? '', tags, { enabled: cfg.prefilter, keywords: cfg.keywords });
  },

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(jobtechConfigSchema, ctx.source);
    const since = publishedAfter(cfg.publishedAfterDays, new Date());
    const hits = new Map<string, Rec>();
    for (const q of cfg.queries) {
      for (let page = 0; page < cfg.maxPages; page++) {
        throwIfAborted(ctx.signal);
        const offset = page * cfg.limit;
        if (offset + cfg.limit > MAX_OFFSET) break;
        const qs = new URLSearchParams({ q, 'published-after': since, limit: String(cfg.limit), offset: String(offset) });
        if (cfg.occupationField) qs.set('occupation-field', cfg.occupationField);
        if (cfg.municipality) qs.set('municipality', cfg.municipality);
        const body = await ctx.http.getJson<unknown>(`${BASE}?${qs.toString()}`, { headers: { accept: 'application/json' } });
        if (!isRecord(body) || !Array.isArray(body.hits)) throw new SourceError('jobtech_se: response has no hits array');
        const pageHits = body.hits.filter(isRecord);
        for (const h of pageHits) {
          const id = str(h.id);
          if (id && !hits.has(id)) hits.set(id, h);
        }
        const total = isRecord(body.total) ? Number(body.total.value ?? 0) : Number(body.total ?? 0);
        if (pageHits.length < cfg.limit || offset + cfg.limit >= total) break;
        if (page === cfg.maxPages - 1) markPartial(ctx, `jobtech_se: '${q}' has ${total} hits, read ${offset + pageHits.length}`);
      }
    }
    const fetchedAt = new Date();
    return [...hits.entries()].map(([id, h]) =>
      h.removed === true ? rawItem(id, sourceClosedPayload(h), null, fetchedAt) : rawItem(id, h, str(h.webpage_url), fetchedAt),
    );
  },

  parse(item, ctx): NormalizedJob {
    const h = asRecord(item.payload);
    const id = reqStr(h, 'id');
    const title = reqStr(h, 'headline', 'headline');
    if (h.removed === true) throw new ParseError('ad removed', 'removed');
    const employer = isRecord(h.employer) ? h.employer : {};
    const company = str(employer.name) ?? str(employer.workplace);
    if (!company) throw new ParseError('missing employer.name', 'employer.name');
    const d = isRecord(h.description) ? h.description : {};
    const desc = description([str(d.text_formatted)], str(d.text));
    if (!desc.text) throw new ParseError('empty description', 'description');
    const addrs = Array.isArray(h.workplace_addresses) && h.workplace_addresses.length ? h.workplace_addresses.filter(isRecord) : [];
    const primary = isRecord(h.workplace_address) ? h.workplace_address : (addrs[0] ?? {});
    const places = (addrs.length ? addrs : [primary]).map((a) => joinLocation([capIfUpper(str(a.city) ?? str(a.municipality)), str(a.region), str(a.country)]));
    const app = isRecord(h.application_details) ? h.application_details : {};
    const applyUrl = httpUrl(app.url) ?? httpUrl(h.webpage_url);
    if (!applyUrl) throw new ParseError('missing webpage_url', 'webpage_url');
    const model = label(h.workplace_model)?.toLowerCase() ?? '';
    const workplace = /distans|remote/.test(model) ? 'remote' : /hybrid/.test(model) ? 'hybrid' : null;
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: company,
      companyDomain: null,
      locationRaw: joinLocation(places, '; '),
      countryHint: str(primary.country) ?? 'SE',
      cityHint: capIfUpper(str(primary.city) ?? str(primary.municipality)),
      workplaceHint: workplace,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl,
      postedAt: toDate(h.publication_date),
      closingAt: toDate(h.application_deadline),
      salaryHint: str(h.salary_description) ? { raw: str(h.salary_description) ?? undefined } : null,
      employmentType: label(h.employment_type) ?? label(h.working_hours_type),
      extra: {
        occupation: label(h.occupation),
        occupationGroup: label(h.occupation_group),
        occupationField: label(h.occupation_field),
        workingHours: label(h.working_hours_type),
        duration: label(h.duration),
        experienceRequired: h.experience_required === true,
        platsbankenUrl: str(h.webpage_url),
        applicationViaEmail: !httpUrl(app.url) && !!str(app.email),
        sourceType: str(h.source_type),
      },
    };
  },
};
