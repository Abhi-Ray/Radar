/**
 * Remote OK public API: GET https://remoteok.com/api returns the latest ~100 jobs; element [0] is
 * the legal notice (skipped). Terms: link back (followed link) to the Remote OK URL and mention
 * Remote OK by name; no logo. Latest-N window → incremental.
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
  repairMojibake,
  reqStr,
  salaryFrom,
  str,
  strArray,
  toDate,
} from './common';
import { prefilterDecision } from './relevance';
import type { ConnectorModule } from './types';

export const REMOTEOK_VERSION = 'remoteok@2026-09-30.1';

const URL_API = 'https://remoteok.com/api';

export const remoteokConfigSchema = z.object({
  ...prefilterFields(true),
});
export type RemoteokConfig = z.output<typeof remoteokConfigSchema>;

/** Job elements of the API array (drops the legal notice and anything without an id). */
export function remoteokJobs(body: unknown): Record<string, unknown>[] {
  if (!Array.isArray(body)) throw new SourceError('remoteok: response is not an array');
  return body.filter(isRecord).filter((e) => !('legal' in e) && str(e.id) !== null);
}

export const remoteok: ConnectorModule<RemoteokConfig> = {
  platformKey: 'remoteok',
  version: REMOTEOK_VERSION,
  kind: 'aggregator',
  listing: 'incremental',
  configSchema: remoteokConfigSchema,
  platform: {
    name: 'Remote OK',
    grade: 'B',
    accessMethod: 'api',
    termsUrl: 'https://remoteok.com/api',
    rateLimitPerMin: 1,
    dailyCap: 4,
    attribution: 'Source: Remote OK (link back to the Remote OK job page)',
    notes: 'Public API (latest jobs); must link back to Remote OK and name it; no logo use.',
  },
  sourceKeyFor: () => 'remoteok:all',

  prefilter(item, cfg) {
    const p = isRecord(item.payload) ? item.payload : {};
    return prefilterDecision(repairMojibake(str(p.position) ?? ''), strArray(p.tags), { enabled: cfg.prefilter, keywords: cfg.keywords });
  },

  async fetch(ctx): Promise<RawItem[]> {
    parseConfig(remoteokConfigSchema, ctx.source);
    const body = await ctx.http.getJson<unknown>(URL_API);
    const fetchedAt = new Date();
    return remoteokJobs(body).map((j) => rawItem(String(str(j.id)), j, str(j.url), fetchedAt));
  },

  parse(item, ctx): NormalizedJob {
    const j = asRecord(item.payload);
    const id = reqStr(j, 'id');
    // The API serves UTF-8 decoded as Latin-1 for many postings; repaired field by field.
    const fix = (v: unknown) => {
      const t = str(v);
      return t === null ? null : repairMojibake(t);
    };
    const title = fix(j.position);
    if (!title) throw new ParseError('missing position', 'position');
    const company = fix(j.company);
    if (!company) throw new ParseError('missing company', 'company');
    const desc = description([fix(j.description)]);
    if (!desc.text) throw new ParseError('empty description', 'description');
    const where = fix(j.location);
    // Terms: the link back goes to the Remote OK page (its apply_url also points there).
    const url = httpUrl(j.url) ?? httpUrl(j.apply_url);
    if (!url) throw new ParseError('missing url', 'url');
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: company,
      companyDomain: null,
      locationRaw: where ? (/remote/i.test(where) ? where : `Remote (${where})`) : 'Remote',
      countryHint: null,
      cityHint: null,
      workplaceHint: 'remote',
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: url,
      postedAt: toDate(j.date) ?? toDate(j.epoch),
      closingAt: null,
      salaryHint: salaryFrom(j.salary_min, j.salary_max, 'USD', 'year'),
      employmentType: null,
      extra: { tags: strArray(j.tags), slug: str(j.slug), attribution: 'Remote OK', sourceUrl: url },
    };
  },
};
