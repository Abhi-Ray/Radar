/**
 * Greenhouse job board API (public, documented): one GET returns every published job of a board
 * with its content. https://developers.greenhouse.io/job-board.html
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
  toDate,
} from './common';
import type { ConnectorModule } from './types';

export const GREENHOUSE_VERSION = 'greenhouse@2026-09-30.1';

export const greenhouseConfigSchema = z.object({
  board: slugSchema,
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type GreenhouseConfig = z.output<typeof greenhouseConfigSchema>;

function payHint(job: Record<string, unknown>): SalaryHint | null {
  const ranges = Array.isArray(job.pay_input_ranges) ? job.pay_input_ranges : [];
  const r = ranges.find(isRecord);
  if (!r) return null;
  const min = num(r.min_cents);
  const max = num(r.max_cents);
  if (min === null && max === null) return null;
  return {
    min: min !== null ? min / 100 : undefined,
    max: max !== null ? max / 100 : undefined,
    currency: str(r.currency_type) ?? undefined,
    period: 'year',
    raw: str(r.title) ?? undefined,
  };
}

export const greenhouse: ConnectorModule<GreenhouseConfig> = {
  platformKey: 'greenhouse',
  version: GREENHOUSE_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: greenhouseConfigSchema,
  platform: {
    name: 'Greenhouse',
    grade: 'A',
    accessMethod: 'ats_json',
    termsUrl: 'https://developers.greenhouse.io/job-board.html',
    rateLimitPerMin: 30,
    dailyCap: 1000,
    attribution: null,
    notes: 'Public job board API; one request per board per run.',
  },
  sourceKeyFor: (c) => `greenhouse:${c.board.toLowerCase()}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(greenhouseConfigSchema, ctx.source);
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(cfg.board)}/jobs?content=true`;
    let body: unknown;
    try {
      body = await ctx.http.getJson<unknown>(url);
    } catch (err) {
      if (err instanceof HttpStatusError && err.status === 404) throw new SourceError(`greenhouse board '${cfg.board}' not found`, 404);
      throw err;
    }
    if (!isRecord(body) || !Array.isArray(body.jobs)) throw new SourceError('greenhouse: response has no jobs array');
    const fetchedAt = new Date();
    return body.jobs.map((j, i) => {
      const id = isRecord(j) ? str(j.id) : null;
      return rawItem(id ?? `index-${i}`, j, isRecord(j) ? str(j.absolute_url) : null, fetchedAt);
    });
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(greenhouseConfigSchema, ctx.source);
    const j = asRecord(item.payload);
    const id = reqStr(j, 'id');
    const title = reqStr(j, 'title');
    const loc = isRecord(j.location) ? str(j.location.name) : null;
    const offices = Array.isArray(j.offices) ? j.offices.filter(isRecord).map((o) => str(o.name)).filter((x): x is string => !!x) : [];
    const desc = description([str(j.content)]);
    if (!desc.text) throw new ParseError('empty description', 'content');
    const departments = Array.isArray(j.departments) ? j.departments.filter(isRecord).map((d) => str(d.name)).filter(Boolean) : [];
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, str(j.company_name), ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw: loc ?? offices.join('; '),
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: reqUrl(j.absolute_url, 'absolute_url'),
      postedAt: toDate(j.first_published) ?? toDate(j.updated_at),
      closingAt: toDate(j.application_deadline),
      salaryHint: payHint(j),
      employmentType: null,
      extra: {
        updatedAt: str(j.updated_at),
        language: str(j.language),
        departments,
        offices,
        requisitionId: str(j.requisition_id),
      },
    };
  },
};
