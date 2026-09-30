/**
 * Workable public jobs widget API (GET, no key): /api/v1/widget/accounts/{slug}?details=true
 * returns the account name and every published job with its HTML description. (The older
 * www.workable.com/api/accounts/{slug} now redirects to Cloudflare; the v3 endpoint is POST-only
 * and has no descriptions.)
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import { HttpStatusError } from '../http/polite';
import {
  asRecord,
  companyNameFor,
  description,
  isRecord,
  joinLocation,
  optionalName,
  parseConfig,
  rawItem,
  reqStr,
  reqUrl,
  slugSchema,
  str,
  toDate,
} from './common';
import type { ConnectorModule } from './types';

export const WORKABLE_VERSION = 'workable@2026-09-30.1';

export const workableConfigSchema = z.object({
  slug: slugSchema,
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type WorkableConfig = z.output<typeof workableConfigSchema>;

export const workable: ConnectorModule<WorkableConfig> = {
  platformKey: 'workable',
  version: WORKABLE_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: workableConfigSchema,
  platform: {
    name: 'Workable',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://workable.readme.io/docs/jobs-widget',
    rateLimitPerMin: 20,
    dailyCap: 500,
    attribution: null,
    notes: 'Public jobs widget endpoint (details=true includes descriptions).',
  },
  sourceKeyFor: (c) => `workable:${c.slug.toLowerCase()}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(workableConfigSchema, ctx.source);
    const url = `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(cfg.slug)}?details=true`;
    let body: unknown;
    try {
      body = await ctx.http.getJson<unknown>(url);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) throw new SourceError(`workable account '${cfg.slug}' not found`, 404);
      throw err;
    }
    if (!isRecord(body) || !Array.isArray(body.jobs)) throw new SourceError('workable: response has no jobs array');
    const accountName = str(body.name);
    const fetchedAt = new Date();
    return body.jobs.filter(isRecord).map((job, i) => rawItem(str(job.shortcode) ?? `index-${i}`, { accountName, job }, str(job.url), fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(workableConfigSchema, ctx.source);
    const p = asRecord(item.payload);
    const job = asRecord(p.job, 'job');
    const id = reqStr(job, 'shortcode');
    const title = reqStr(job, 'title');
    const desc = description([str(job.description)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const locations = Array.isArray(job.locations) ? job.locations.filter(isRecord) : [];
    const locStrings = locations.map((l) => joinLocation([str(l.city), str(l.region), str(l.country)]));
    const primary = joinLocation([str(job.city), str(job.state), str(job.country)]);
    const locationRaw = locStrings.length ? joinLocation(locStrings, '; ') : primary;
    const remote = job.telecommuting === true;
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, str(p.accountName), ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw: remote && !/remote/i.test(locationRaw) ? `${locationRaw}${locationRaw ? ' ' : ''}(Remote)` : locationRaw,
      countryHint: str(locations[0]?.countryCode) ?? str(job.country),
      cityHint: str(job.city),
      workplaceHint: remote ? 'remote' : null,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: reqUrl(job.url ?? job.shortlink, 'url'),
      postedAt: toDate(job.published_on) ?? toDate(job.created_at),
      closingAt: null,
      salaryHint: null,
      employmentType: str(job.employment_type),
      extra: {
        department: str(job.department),
        experience: str(job.experience),
        education: str(job.education),
        function: str(job.function),
        applicationUrl: str(job.application_url),
      },
    };
  },
};
