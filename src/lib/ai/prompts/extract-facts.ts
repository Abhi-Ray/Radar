/**
 * extract_facts: the facts rules are often unsure about in long or messy postings (spec §15):
 * visa signals, required years, skills, language requirement, remote limits, salary in the text.
 * Every fact carries an exact quote; code verifies each one before anything is stored.
 */
import { z } from 'zod';
import { LANGUAGE_REQUIREMENTS, REMOTE_CLASSES } from '../../../db/schema/_enums';
import {
  itemIdSchema,
  jsonNullableObject,
  jsonObject,
  jsonQuote,
  list,
  nullableObject,
  num,
  quoteSchema,
  resultsParameters,
  type JsonSchema,
} from './schema';

export const EXTRACT_FACTS_PROMPT_VERSION = 'extract_facts@2026-09-30.1';
export const EXTRACT_FACTS_TOOL = 'report_job_facts';

export const AI_VISA_SIGNALS = ['offered', 'not_offered', 'relocation', 'right_to_work_required'] as const;
export const AI_SALARY_PERIODS = ['hour', 'day', 'month', 'year'] as const;

export const extractFactsItemSchema = z.object({
  id: itemIdSchema,
  visa_signals: list(z.object({ signal: z.enum(AI_VISA_SIGNALS), quote: quoteSchema }), 6),
  experience: nullableObject(
    z.object({
      min_years: num(0, 40),
      max_years: z.preprocess((v) => (v === undefined ? null : v), num(0, 40).nullable()),
      quote: quoteSchema,
    }),
  ),
  skills: list(z.object({ name: z.string().trim().min(1).max(40), quote: quoteSchema }), 25),
  language: nullableObject(
    z.object({
      requirement: z.enum(LANGUAGE_REQUIREMENTS),
      languages: list(z.string().trim().regex(/^[A-Za-z]{2}$/), 6),
      quote: quoteSchema,
    }),
  ),
  remote: nullableObject(
    z.object({
      class: z.enum(REMOTE_CLASSES),
      regions: list(z.string().trim().min(1).max(48), 10),
      quote: quoteSchema,
    }),
  ),
  salary: nullableObject(
    z.object({
      min: num(1, 100_000_000),
      max: z.preprocess((v) => (v === undefined ? null : v), num(1, 100_000_000).nullable()),
      currency: z.string().trim().regex(/^[A-Za-z]{3}$/).transform((c) => c.toUpperCase()),
      period: z.enum(AI_SALARY_PERIODS),
      quote: quoteSchema,
    }),
  ),
});
export type ExtractFactsItem = z.output<typeof extractFactsItemSchema>;

const item: JsonSchema = jsonObject(
  {
    id: { type: 'string', description: 'The posting id.' },
    visa_signals: {
      type: 'array',
      description: 'Statements about visa / work-permit sponsorship. Empty if the posting says nothing.',
      items: jsonObject(
        {
          signal: {
            type: 'string',
            enum: [...AI_VISA_SIGNALS],
            description:
              'offered = the employer sponsors or supports a visa/work permit; not_offered = no sponsorship / cannot sponsor; relocation = relocation support without mentioning visas; right_to_work_required = candidates must already be allowed to work there.',
          },
          quote: jsonQuote,
        },
        ['signal', 'quote'],
      ),
    },
    experience: jsonNullableObject(
      {
        min_years: { type: 'number', description: 'Minimum years of professional experience required.' },
        max_years: { type: ['number', 'null'] },
        quote: jsonQuote,
      },
      ['min_years', 'max_years', 'quote'],
      'null unless a number of years is stated.',
    ),
    skills: {
      type: 'array',
      description: 'Technologies, tools, clouds, frameworks and standards named in the posting (as written). Max 20.',
      items: jsonObject({ name: { type: 'string' }, quote: jsonQuote }, ['name', 'quote']),
    },
    language: jsonNullableObject(
      {
        requirement: {
          type: 'string',
          enum: [...LANGUAGE_REQUIREMENTS],
          description:
            'local_required = a language other than English is required; english_ok = English is enough (working language English, other languages only a plus); unclear = the posting is ambiguous.',
        },
        languages: { type: 'array', items: { type: 'string', description: 'ISO 639-1 code, e.g. "de".' } },
        quote: jsonQuote,
      },
      ['requirement', 'languages', 'quote'],
      'Spoken-language requirement; null if the posting says nothing about languages.',
    ),
    remote: jsonNullableObject(
      {
        class: {
          type: 'string',
          enum: [...REMOTE_CLASSES],
          description:
            'worldwide = remote from anywhere or explicitly open to India/Asia/APAC; region_limited = remote only from named countries/regions; timezone_limited = remote but tied to specific time zones/working hours; not_remote = on-site or hybrid; unclear = remote without enough detail.',
        },
        regions: { type: 'array', items: { type: 'string' }, description: 'Countries/regions/time zones named.' },
        quote: jsonQuote,
      },
      ['class', 'regions', 'quote'],
      'Where the work can be done from; null if the posting says nothing.',
    ),
    salary: jsonNullableObject(
      {
        min: { type: 'number', description: 'Lowest amount exactly as written (60k = 60000).' },
        max: { type: ['number', 'null'] },
        currency: { type: 'string', description: 'ISO 4217 code, e.g. EUR.' },
        period: { type: 'string', enum: [...AI_SALARY_PERIODS] },
        quote: jsonQuote,
      },
      ['min', 'max', 'currency', 'period', 'quote'],
      'Pay stated in the text; null if no pay is stated.',
    ),
  },
  ['id', 'visa_signals', 'experience', 'skills', 'language', 'remote', 'salary'],
);

export const EXTRACT_FACTS_PARAMETERS: JsonSchema = resultsParameters(item);

export const EXTRACT_FACTS_INSTRUCTIONS = `Task: for each posting, report the facts below. Each fact needs an exact quote from that posting.
- visa_signals: what the posting says about visa or work-permit sponsorship, relocation, or needing an existing right to work.
- experience: the minimum years of professional experience required (null if no number of years is stated).
- skills: technologies, tools, clouds, frameworks and standards named (at most 20).
- language: the spoken-language requirement (null if nothing is said about languages).
- remote: where the job can be done from (null if nothing is said).
- salary: pay stated in the posting text (null if none).`;

export const EXTRACT_FACTS_TOKENS_PER_JOB = 700;
export const EXTRACT_FACTS_BATCH = 4;
