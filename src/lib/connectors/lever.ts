/**
 * Lever postings API (public): GET /v0/postings/{company}?mode=json returns every published
 * posting. EU-hosted accounts live on api.eu.lever.co. https://github.com/lever/postings-api
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem, SalaryHint } from '../contracts/jobs';
import { HttpStatusError } from '../http/polite';
import {
  asRecord,
  companyNameFor,
  description,
  isRecord,
  num,
  optionalName,
  parseConfig,
  rawItem,
  reqStr,
  reqUrl,
  slugSchema,
  str,
  strArray,
  toDate,
  workplaceFrom,
} from './common';
import type { ConnectorModule } from './types';

export const LEVER_VERSION = 'lever@2026-09-30.1';

export const leverConfigSchema = z.object({
  company: slugSchema,
  region: z.enum(['global', 'eu']).default('global'),
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type LeverConfig = z.output<typeof leverConfigSchema>;

const INTERVALS: Record<string, string> = {
  'per-year-salary': 'year',
  'per-month-salary': 'month',
  'per-week-salary': 'week',
  'per-day-wage': 'day',
  'per-hour-wage': 'hour',
  'one-time': 'one_time',
};

function salaryHint(p: Record<string, unknown>): SalaryHint | null {
  const r = isRecord(p.salaryRange) ? p.salaryRange : null;
  if (!r) return null;
  const min = num(r.min);
  const max = num(r.max);
  if (min === null && max === null) return null;
  const interval = str(r.interval);
  return {
    min: min ?? undefined,
    max: max ?? undefined,
    currency: str(r.currency) ?? undefined,
    period: interval ? (INTERVALS[interval] ?? interval) : undefined,
    raw: str(p.salaryDescriptionPlain) ?? undefined,
  };
}

export const lever: ConnectorModule<LeverConfig> = {
  platformKey: 'lever',
  version: LEVER_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: leverConfigSchema,
  platform: {
    name: 'Lever',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://github.com/lever/postings-api',
    rateLimitPerMin: 30,
    dailyCap: 1000,
    attribution: null,
    notes: 'Public postings API; api.eu.lever.co for EU-hosted accounts.',
  },
  sourceKeyFor: (c) => `lever:${c.region === 'eu' ? 'eu:' : ''}${c.company.toLowerCase()}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(leverConfigSchema, ctx.source);
    const host = cfg.region === 'eu' ? 'api.eu.lever.co' : 'api.lever.co';
    const url = `https://${host}/v0/postings/${encodeURIComponent(cfg.company)}?mode=json`;
    let body: unknown;
    try {
      body = await ctx.http.getJson<unknown>(url);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) throw new SourceError(`lever company '${cfg.company}' not found on ${host}`, 404);
      throw err;
    }
    if (!Array.isArray(body)) throw new SourceError('lever: response is not an array');
    const fetchedAt = new Date();
    return body.map((p, i) => rawItem((isRecord(p) && str(p.id)) || `index-${i}`, p, isRecord(p) ? str(p.hostedUrl) : null, fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(leverConfigSchema, ctx.source);
    const p = asRecord(item.payload);
    const id = reqStr(p, 'id');
    const title = reqStr(p, 'text', 'text');
    const cat = isRecord(p.categories) ? p.categories : {};
    const allLocations = strArray(cat.allLocations);
    const location = str(cat.location) ?? allLocations.join('; ');
    const lists = Array.isArray(p.lists) ? p.lists.filter(isRecord) : [];
    const listHtml = lists.map((l) => `<h3>${str(l.text) ?? ''}</h3><ul>${typeof l.content === 'string' ? l.content : ''}</ul>`);
    const desc = description([str(p.description) ?? str(p.descriptionBody), ...listHtml, str(p.additional)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const workplace = workplaceFrom(p.workplaceType);
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, null, ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw: allLocations.length > 1 ? allLocations.join('; ') : location,
      countryHint: str(p.country),
      workplaceHint: workplace,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: reqUrl(p.hostedUrl ?? p.applyUrl, 'hostedUrl'),
      postedAt: toDate(p.createdAt),
      closingAt: null,
      salaryHint: salaryHint(p),
      employmentType: str(cat.commitment),
      extra: { team: str(cat.team), department: str(cat.department), applyUrl: str(p.applyUrl), allLocations },
    };
  },
};
