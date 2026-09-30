/**
 * Recruitee public careers API: GET https://{slug}.recruitee.com/api/offers/ returns published
 * offers with description + requirements. The tenant host is built from config, so it goes
 * through safeFetch (PoliteHttp routes non-constant hosts there).
 * https://docs.recruitee.com/reference/offers
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem, SalaryHint } from '../contracts/jobs';
import { HttpStatusError } from '../http/polite';
import {
  asRecord,
  companyNameFor,
  description,
  hostLabelSchema,
  salaryPeriod,
  isRecord,
  joinLocation,
  num,
  optionalName,
  parseConfig,
  rawItem,
  reqStr,
  reqUrl,
  str,
  strArray,
  toDate,
} from './common';
import type { ConnectorModule } from './types';

export const RECRUITEE_VERSION = 'recruitee@2026-09-30.1';

export const recruiteeConfigSchema = z.object({
  slug: hostLabelSchema,
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type RecruiteeConfig = z.output<typeof recruiteeConfigSchema>;

function salaryHint(o: Record<string, unknown>): SalaryHint | null {
  const s = isRecord(o.salary) ? o.salary : null;
  if (!s) return null;
  const min = num(s.min);
  const max = num(s.max);
  if (min === null && max === null) return null;
  return { min: min ?? undefined, max: max ?? undefined, currency: str(s.currency) ?? undefined, period: salaryPeriod(s.period) };
}

export const recruitee: ConnectorModule<RecruiteeConfig> = {
  platformKey: 'recruitee',
  version: RECRUITEE_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: recruiteeConfigSchema,
  platform: {
    name: 'Recruitee',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://docs.recruitee.com/reference/offers',
    rateLimitPerMin: 20,
    dailyCap: 500,
    attribution: null,
    notes: 'Public careers-site offers API on the tenant sub-domain.',
  },
  sourceKeyFor: (c) => `recruitee:${c.slug}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(recruiteeConfigSchema, ctx.source);
    const url = `https://${cfg.slug}.recruitee.com/api/offers/`;
    let body: unknown;
    try {
      body = await ctx.http.getJson<unknown>(url);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) throw new SourceError(`recruitee company '${cfg.slug}' not found`, 404);
      throw err;
    }
    if (!isRecord(body) || !Array.isArray(body.offers)) throw new SourceError('recruitee: response has no offers array');
    const fetchedAt = new Date();
    return body.offers.filter(isRecord).map((o, i) => rawItem(str(o.id) ?? `index-${i}`, o, str(o.careers_url), fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(recruiteeConfigSchema, ctx.source);
    const o = asRecord(item.payload);
    const id = reqStr(o, 'id');
    const title = reqStr(o, 'title');
    if (str(o.status) && str(o.status) !== 'published') throw new ParseError(`offer status ${str(o.status)}`, 'status');
    const desc = description([str(o.description), str(o.requirements)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const locations = Array.isArray(o.locations) ? o.locations.filter(isRecord) : [];
    const locationRaw =
      locations.length > 1
        ? joinLocation(locations.map((l) => joinLocation([str(l.city), str(l.country)])), '; ')
        : (str(o.location) ?? joinLocation([str(o.city), str(o.country)]));
    const workplace = o.remote === true ? 'remote' : o.hybrid === true ? 'hybrid' : o.on_site === true ? 'onsite' : null;
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, str(o.company_name), ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw,
      countryHint: str(o.country_code) ?? str(o.country),
      cityHint: str(o.city),
      workplaceHint: workplace,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: reqUrl(o.careers_url ?? o.careers_apply_url, 'careers_url'),
      postedAt: toDate(o.published_at) ?? toDate(o.created_at),
      closingAt: toDate(o.close_at),
      salaryHint: salaryHint(o),
      employmentType: str(o.employment_type_code),
      extra: {
        department: str(o.department),
        tags: strArray(o.tags),
        experienceCode: str(o.experience_code),
        educationCode: str(o.education_code),
        applyUrl: str(o.careers_apply_url),
        updatedAt: str(o.updated_at),
      },
    };
  },
};
