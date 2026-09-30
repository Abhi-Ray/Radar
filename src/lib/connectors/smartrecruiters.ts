/**
 * SmartRecruiters public Posting API: paginated listing (no descriptions) + one detail request
 * per posting for the job ad. Detail requests are capped per run (`maxDetails`); new postings
 * get them first, the rest are passed on as seen-only items so they are not counted missing.
 * https://developers.smartrecruiters.com/docs/posting-api
 */
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import { DailyCapError, HttpStatusError } from '../http/polite';
import {
  asRecord,
  companyNameFor,
  description,
  isRecord,
  optionalName,
  parseConfig,
  rawItem,
  reqStr,
  str,
  throwIfAborted,
  toDate,
  httpUrl,
} from './common';
import { detailPriority, knownIds, markPartial, seenOnlyPayload, type ConnectorModule } from './types';

export const SMARTRECRUITERS_VERSION = 'smartrecruiters@2026-09-30.1';

export const smartrecruitersConfigSchema = z.object({
  /** Company identifier as in jobs.smartrecruiters.com/{companyId}. */
  companyId: z
    .string()
    .trim()
    .min(1)
    .max(100)
    .regex(/^[A-Za-z0-9_-]+$/),
  /** Optional server-side keyword filter (q=). */
  query: z.string().trim().min(1).max(100).optional(),
  /** Optional ISO country filter (lowercase in the API). */
  country: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/)
    .optional(),
  maxItems: z.number().int().min(1).max(1000).default(200),
  maxDetails: z.number().int().min(0).max(200).default(40),
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type SmartRecruitersConfig = z.output<typeof smartrecruitersConfigSchema>;

const PAGE = 100;
const BASE = 'https://api.smartrecruiters.com/v1/companies';

interface SrPayload {
  posting: Record<string, unknown>;
  detail: Record<string, unknown>;
}

export const smartrecruiters: ConnectorModule<SmartRecruitersConfig> = {
  platformKey: 'smartrecruiters',
  version: SMARTRECRUITERS_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: smartrecruitersConfigSchema,
  platform: {
    name: 'SmartRecruiters',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://developers.smartrecruiters.com/docs/posting-api',
    rateLimitPerMin: 30,
    dailyCap: 1500,
    attribution: null,
    notes: 'Listing has no descriptions; capped detail requests per run.',
  },
  sourceKeyFor: (c) => `smartrecruiters:${c.companyId.toLowerCase()}${c.query ? `:${c.query.toLowerCase().replace(/\s+/g, '-')}` : ''}${c.country ? `:${c.country}` : ''}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(smartrecruitersConfigSchema, ctx.source);
    const known = knownIds(ctx);
    const company = encodeURIComponent(cfg.companyId);
    const postings: Record<string, unknown>[] = [];
    let totalFound = 0;
    for (let offset = 0; postings.length < cfg.maxItems; offset += PAGE) {
      throwIfAborted(ctx.signal);
      const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
      if (cfg.query) qs.set('q', cfg.query);
      if (cfg.country) qs.set('country', cfg.country);
      let body: unknown;
      try {
        body = await ctx.http.getJson<unknown>(`${BASE}/${company}/postings?${qs.toString()}`);
      } catch (err) {
        if (err instanceof HttpStatusError && err.status === 404) throw new SourceError(`smartrecruiters company '${cfg.companyId}' not found`, 404);
        throw err;
      }
      if (!isRecord(body) || !Array.isArray(body.content)) throw new SourceError('smartrecruiters: response has no content array');
      const page = body.content.filter(isRecord);
      postings.push(...page);
      totalFound = typeof body.totalFound === 'number' ? body.totalFound : 0;
      if (page.length < PAGE || offset + PAGE >= totalFound) break;
    }
    if (totalFound > cfg.maxItems) markPartial(ctx, `smartrecruiters: ${totalFound} postings, maxItems ${cfg.maxItems}`);
    const list = postings.slice(0, cfg.maxItems);
    const ordered = detailPriority(list, (p) => str(p.id) ?? '', known);
    const fetchedAt = new Date();
    const items: RawItem[] = [];
    let details = 0;
    let detailErrors = 0;
    for (const posting of ordered) {
      const id = str(posting.id);
      if (!id) continue;
      if (details >= cfg.maxDetails) {
        items.push(rawItem(id, seenOnlyPayload(posting), null, fetchedAt));
        continue;
      }
      throwIfAborted(ctx.signal);
      try {
        const detail = await ctx.http.getJson<unknown>(`${BASE}/${company}/postings/${encodeURIComponent(id)}`);
        details++;
        if (!isRecord(detail)) throw new SourceError('smartrecruiters: detail is not an object');
        const payload: SrPayload = { posting, detail };
        items.push(rawItem(id, payload, str(detail.postingUrl), fetchedAt));
      } catch (err) {
        if (err instanceof DailyCapError || ctx.signal.aborted) throw err;
        details++;
        detailErrors++;
        ctx.log(`smartrecruiters: detail ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
        if (err instanceof HttpStatusError && err.status === 404) continue; // removed between listing and detail
        items.push(rawItem(id, seenOnlyPayload(posting), null, fetchedAt));
        if (detailErrors >= 5 && detailErrors > details / 2) throw new SourceError('smartrecruiters: most detail requests failing');
      }
    }
    return items;
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(smartrecruitersConfigSchema, ctx.source);
    const p = asRecord(item.payload);
    const posting = asRecord(p.posting, 'posting');
    const detail = asRecord(p.detail, 'detail');
    const id = reqStr(detail, 'id');
    const title = str(detail.name) ?? reqStr(posting, 'name', 'name');
    if (detail.active === false) throw new ParseError('posting inactive', 'active');
    const sections = isRecord(detail.jobAd) && isRecord(detail.jobAd.sections) ? detail.jobAd.sections : {};
    const order = ['jobDescription', 'qualifications', 'additionalInformation', 'companyDescription'];
    const html = order
      .map((k) => (isRecord(sections[k]) ? sections[k] : null))
      .filter((s): s is Record<string, unknown> => s !== null && !!str(s.text))
      .map((s) => `<h3>${str(s.title) ?? ''}</h3>${String(s.text)}`);
    const desc = description(html);
    if (!desc.text) throw new ParseError('empty job ad', 'jobAd');
    const loc = isRecord(detail.location) ? detail.location : isRecord(posting.location) ? posting.location : {};
    const workplace = loc.remote === true ? 'remote' : loc.hybrid === true ? 'hybrid' : null;
    const companyRec = isRecord(detail.company) ? detail.company : isRecord(posting.company) ? posting.company : {};
    const applyUrl =
      httpUrl(detail.postingUrl) ?? httpUrl(detail.applyUrl) ?? `https://jobs.smartrecruiters.com/${encodeURIComponent(cfg.companyId)}/${encodeURIComponent(id)}`;
    const typeOfEmployment = isRecord(detail.typeOfEmployment) ? str(detail.typeOfEmployment.label) : null;
    const language = isRecord(detail.language) ? str(detail.language.code) : null;
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, str(companyRec.name), ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw: (str(loc.fullLocation) ?? [str(loc.city), str(loc.region), str(loc.country)].filter(Boolean).join(', ')).replace(/,\s*,/g, ','),
      countryHint: str(loc.country)?.toUpperCase() ?? null,
      cityHint: str(loc.city),
      workplaceHint: workplace,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl,
      postedAt: toDate(detail.releasedDate) ?? toDate(posting.releasedDate),
      closingAt: null,
      salaryHint: null,
      employmentType: typeOfEmployment,
      extra: {
        refNumber: str(detail.refNumber),
        language,
        experienceLevel: isRecord(detail.experienceLevel) ? str(detail.experienceLevel.label) : null,
        function: isRecord(detail.function) ? str(detail.function.label) : null,
        industry: isRecord(detail.industry) ? str(detail.industry.label) : null,
      },
    };
  },
};
