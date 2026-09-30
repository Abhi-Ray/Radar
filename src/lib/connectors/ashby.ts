/**
 * Ashby public job posting API: GET /posting-api/job-board/{org}?includeCompensation=true.
 * https://developers.ashbyhq.com/docs/public-job-posting-api
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
  joinLocation,
  num,
  optionalName,
  parseConfig,
  rawItem,
  reqStr,
  reqUrl,
  slugSchema,
  str,
  toDate,
  workplaceFrom,
} from './common';
import type { ConnectorModule } from './types';

export const ASHBY_VERSION = 'ashby@2026-09-30.1';

export const ashbyConfigSchema = z.object({
  /** Job board name as in jobs.ashbyhq.com/{org} (case as published). */
  org: slugSchema,
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type AshbyConfig = z.output<typeof ashbyConfigSchema>;

/** "1 YEAR" | "1 MONTH" | "1 HOUR" … → period word for the salary parser. */
function period(interval: string | null): string | undefined {
  const m = interval ? /^\s*1\s+([A-Z]+)/i.exec(interval) : null;
  return m ? m[1].toLowerCase() : undefined;
}

function salaryHint(j: Record<string, unknown>): SalaryHint | null {
  const comp = isRecord(j.compensation) ? j.compensation : null;
  if (!comp) return null;
  const comps = Array.isArray(comp.summaryComponents) ? comp.summaryComponents.filter(isRecord) : [];
  const salary = comps.find((c) => str(c.compensationType) === 'Salary');
  const raw = str(comp.scrapeableCompensationSalarySummary) ?? str(comp.compensationTierSummary) ?? undefined;
  if (!salary) return raw ? { raw } : null;
  const min = num(salary.minValue);
  const max = num(salary.maxValue);
  if (min === null && max === null) return raw ? { raw } : null;
  return { min: min ?? undefined, max: max ?? undefined, currency: str(salary.currencyCode) ?? undefined, period: period(str(salary.interval)), raw };
}

function postal(a: unknown): { country: string | null; city: string | null; region: string | null } {
  const pa = isRecord(a) && isRecord(a.postalAddress) ? a.postalAddress : {};
  return { country: str(pa.addressCountry), city: str(pa.addressLocality), region: str(pa.addressRegion) };
}

export const ashby: ConnectorModule<AshbyConfig> = {
  platformKey: 'ashby',
  version: ASHBY_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: ashbyConfigSchema,
  platform: {
    name: 'Ashby',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://developers.ashbyhq.com/docs/public-job-posting-api',
    rateLimitPerMin: 30,
    dailyCap: 1000,
    attribution: null,
    notes: 'Public job posting API with compensation.',
  },
  sourceKeyFor: (c) => `ashby:${c.org.toLowerCase()}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(ashbyConfigSchema, ctx.source);
    const url = `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(cfg.org)}?includeCompensation=true`;
    let body: unknown;
    try {
      body = await ctx.http.getJson<unknown>(url);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) throw new SourceError(`ashby job board '${cfg.org}' not found`, 404);
      throw err;
    }
    if (!isRecord(body) || !Array.isArray(body.jobs)) throw new SourceError('ashby: response has no jobs array');
    const fetchedAt = new Date();
    return body.jobs.map((j, i) => rawItem((isRecord(j) && str(j.id)) || `index-${i}`, j, isRecord(j) ? str(j.jobUrl) : null, fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(ashbyConfigSchema, ctx.source);
    const j = asRecord(item.payload);
    const id = reqStr(j, 'id');
    const title = reqStr(j, 'title');
    const desc = description([str(j.descriptionHtml)], str(j.descriptionPlain));
    if (!desc.text) throw new ParseError('empty description', 'descriptionHtml');
    const main = postal(j.address);
    const secondary = Array.isArray(j.secondaryLocations) ? j.secondaryLocations.filter(isRecord) : [];
    const locations = [str(j.location), ...secondary.map((s) => str(s.location))];
    let workplace = workplaceFrom(j.workplaceType);
    if (!workplace && j.isRemote === true) workplace = 'remote';
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, null, ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw: joinLocation(locations, '; '),
      countryHint: main.country,
      cityHint: main.city,
      workplaceHint: workplace,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: reqUrl(j.jobUrl ?? j.applyUrl, 'jobUrl'),
      postedAt: toDate(j.publishedAt),
      closingAt: null,
      salaryHint: salaryHint(j),
      employmentType: str(j.employmentType),
      extra: {
        department: str(j.department),
        team: str(j.team),
        isRemote: j.isRemote === true,
        isListed: j.isListed !== false,
        applyUrl: str(j.applyUrl),
        secondaryCountries: secondary.map((s) => postal(s.address).country).filter(Boolean),
      },
    };
  },
};
