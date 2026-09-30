/**
 * summary_redflags: a 2–3 line summary plus red flags for my highest-fit jobs (spec §15). The
 * summary prose cannot be verified word by word, so it must cite 1–3 exact quotes it rests on
 * (at least one must verify); every red flag carries its own verified quote.
 */
import { z } from 'zod';
import { itemIdSchema, jsonObject, jsonQuote, list, quoteSchema, resultsParameters, type JsonSchema } from './schema';

export const SUMMARY_REDFLAGS_PROMPT_VERSION = 'summary_redflags@2026-09-30.1';
export const SUMMARY_REDFLAGS_TOOL = 'report_job_summaries';

export const MAX_SUMMARY_CHARS = 420;

export const summaryRedflagsItemSchema = z.object({
  id: itemIdSchema,
  summary: z.string().trim().min(20).max(900),
  summary_quotes: list(quoteSchema, 3),
  red_flags: list(z.object({ flag: z.string().trim().min(3).max(200), quote: quoteSchema }), 5),
});
export type SummaryRedflagsItem = z.output<typeof summaryRedflagsItemSchema>;

const item: JsonSchema = jsonObject(
  {
    id: { type: 'string', description: 'The posting id.' },
    summary: {
      type: 'string',
      description: '2-3 short factual sentences in English (max 400 characters): the job, the main requirements, anything notable. Only what the posting says.',
    },
    summary_quotes: { type: 'array', items: jsonQuote, description: '1-3 exact quotes the summary rests on.' },
    red_flags: {
      type: 'array',
      description: 'Concerns a candidate should know (max 5). Empty if none.',
      items: jsonObject({ flag: { type: 'string', description: 'Short English description.' }, quote: jsonQuote }, ['flag', 'quote']),
    },
  },
  ['id', 'summary', 'summary_quotes', 'red_flags'],
);

export const SUMMARY_REDFLAGS_PARAMETERS: JsonSchema = resultsParameters(item);

export const SUMMARY_REDFLAGS_INSTRUCTIONS = `Task: for each posting write
- summary: 2-3 short factual sentences in English (max 400 characters): what the job is, the main requirements, and anything notable about visa, remote work or pay. Only what the posting says.
- summary_quotes: 1-3 exact quotes from the posting that the summary rests on.
- red_flags: concerns a candidate should know, each with an exact quote: unrealistic requirements, unpaid or excessive hours, vague or missing employer, recruiter or agency posting, fees asked from candidates, contradictions (for example "remote" but on-site). Empty list if none.`;

export const SUMMARY_REDFLAGS_TOKENS_PER_JOB = 450;
export const SUMMARY_REDFLAGS_BATCH = 4;
