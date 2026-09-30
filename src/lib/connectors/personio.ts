/**
 * Personio public XML feed: GET https://{slug}.jobs.personio.{de|com}/xml lists every published
 * position (descriptions only when the tenant publishes them). The tenant host comes from config
 * → fetched through safeFetch.
 */
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { ParseError, SourceError } from '../contracts/connectors';
import type { NormalizedJob, RawItem } from '../contracts/jobs';
import { HttpStatusError } from '../http/polite';
import {
  asRecord,
  companyNameFor,
  description,
  hostLabelSchema,
  isRecord,
  joinLocation,
  optionalName,
  parseConfig,
  rawItem,
  reqStr,
  str,
  toDate,
} from './common';
import type { ConnectorModule } from './types';

export const PERSONIO_VERSION = 'personio@2026-09-30.1';

export const personioConfigSchema = z.object({
  slug: hostLabelSchema,
  domain: z.enum(['de', 'com']).default('de'),
  /** Feed language (?language=); default = the tenant default. */
  language: z.enum(['en', 'de', 'es', 'fr', 'it', 'nl', 'pt', 'sv', 'fi', 'da', 'no', 'pl', 'cs']).optional(),
  companyName: optionalName,
  companyDomain: z.string().trim().toLowerCase().max(191).optional(),
});
export type PersonioConfig = z.output<typeof personioConfigSchema>;

const ARRAY_PATHS = new Set([
  'workzag-jobs.position',
  'workzag-jobs.position.additionalOffices.office',
  'workzag-jobs.position.jobDescriptions.jobDescription',
]);

const xml = new XMLParser({
  ignoreAttributes: true,
  parseTagValue: false,
  trimValues: true,
  processEntities: true,
  isArray: (_name, jpath) => ARRAY_PATHS.has(String(jpath)),
});

/** Parses the feed into position objects (exported for tests). */
export function parsePersonioXml(text: string): Record<string, unknown>[] {
  let doc: unknown;
  try {
    doc = xml.parse(text);
  } catch (err) {
    throw new SourceError(`personio: invalid XML (${err instanceof Error ? err.message.slice(0, 120) : 'parse error'})`);
  }
  if (!isRecord(doc) || !('workzag-jobs' in doc)) throw new SourceError('personio: not a workzag-jobs feed');
  const root = doc['workzag-jobs'];
  if (!isRecord(root)) return []; // empty feed: <workzag-jobs></workzag-jobs>
  return Array.isArray(root.position) ? root.position.filter(isRecord) : [];
}

function host(cfg: PersonioConfig): string {
  return `${cfg.slug}.jobs.personio.${cfg.domain}`;
}

export const personio: ConnectorModule<PersonioConfig> = {
  platformKey: 'personio',
  version: PERSONIO_VERSION,
  kind: 'ats',
  listing: 'full',
  configSchema: personioConfigSchema,
  platform: {
    name: 'Personio',
    grade: 'A',
    accessMethod: 'xml',
    termsUrl: 'https://developer.personio.de/docs/retrieving-open-job-positions',
    rateLimitPerMin: 20,
    dailyCap: 500,
    attribution: null,
    notes: 'Public XML position feed on the tenant sub-domain (.de or .com).',
  },
  sourceKeyFor: (c) => `personio:${c.slug}${c.domain === 'com' ? '.com' : ''}`,

  async fetch(ctx): Promise<RawItem[]> {
    const cfg = parseConfig(personioConfigSchema, ctx.source);
    const url = `https://${host(cfg)}/xml${cfg.language ? `?language=${cfg.language}` : ''}`;
    let text: string;
    try {
      text = await ctx.http.getText(url, { headers: { accept: 'application/xml, text/xml' } });
    } catch (err) {
      if (err instanceof HttpStatusError && (err.status === 404 || err.status === 307 || err.status === 302)) {
        throw new SourceError(`personio tenant '${host(cfg)}' not found`, err.status);
      }
      throw err;
    }
    const fetchedAt = new Date();
    return parsePersonioXml(text).map((p, i) => {
      const id = str(p.id) ?? `index-${i}`;
      return rawItem(id, p, `https://${host(cfg)}/job/${encodeURIComponent(id)}`, fetchedAt);
    });
  },

  parse(item, ctx): NormalizedJob {
    const cfg = parseConfig(personioConfigSchema, ctx.source);
    const p = asRecord(item.payload);
    const id = reqStr(p, 'id');
    const title = reqStr(p, 'name', 'name');
    const jd = isRecord(p.jobDescriptions) && Array.isArray(p.jobDescriptions.jobDescription) ? p.jobDescriptions.jobDescription.filter(isRecord) : [];
    const sections = jd.filter((d) => str(d.value)).map((d) => `<h3>${str(d.name) ?? ''}</h3>${String(d.value)}`);
    let desc = description(sections);
    const descriptionMissing = !desc.text;
    if (descriptionMissing) {
      // Tenant publishes no descriptions: keep the posting with its structured facts (flagged).
      const facts: [string, unknown][] = [
        ['Department', p.department],
        ['Category', p.recruitingCategory],
        ['Employment type', p.employmentType],
        ['Seniority', p.seniority],
        ['Schedule', p.schedule],
        ['Years of experience', p.yearsOfExperience],
        ['Occupation', p.occupation],
      ];
      const lines = facts.filter(([, v]) => str(v)).map(([k, v]) => `<li>${k}: ${str(v)}</li>`);
      if (!lines.length) throw new ParseError('no description and no structured facts', 'jobDescriptions');
      desc = description([`<p>${title}</p><ul>${lines.join('')}</ul>`]);
    }
    const additional = isRecord(p.additionalOffices) && Array.isArray(p.additionalOffices.office) ? p.additionalOffices.office.map(str) : [];
    return {
      sourceId: ctx.source.id,
      externalId: id,
      title,
      companyName: companyNameFor(cfg.companyName, str(p.subcompany), ctx.source),
      companyDomain: cfg.companyDomain ?? null,
      locationRaw: joinLocation([str(p.office), ...additional], '; '),
      workplaceHint: /^remote$/i.test(str(p.office) ?? '') ? 'remote' : null,
      descriptionHtml: desc.html,
      descriptionText: desc.text,
      applyUrl: `https://${host(cfg)}/job/${encodeURIComponent(id)}`,
      postedAt: toDate(p.createdAt),
      closingAt: null,
      salaryHint: null,
      employmentType: str(p.employmentType),
      extra: {
        descriptionMissing,
        department: str(p.department),
        seniority: str(p.seniority),
        yearsOfExperience: str(p.yearsOfExperience),
        schedule: str(p.schedule),
        occupationCategory: str(p.occupationCategory),
      },
    };
  },
};
