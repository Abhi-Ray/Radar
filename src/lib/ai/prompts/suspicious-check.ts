/**
 * suspicious_check: does a posting look like a scam or a fake? The verdict only counts when at
 * least one reason is backed by a verified quote; it never changes the job's state by itself — it
 * adds an AI 'suspicious' fact and sends the job to review.
 */
import { z } from 'zod';
import { itemIdSchema, jsonObject, jsonQuote, list, quoteSchema, resultsParameters, type JsonSchema } from './schema';

export const SUSPICIOUS_CHECK_PROMPT_VERSION = 'suspicious_check@2026-09-30.1';
export const SUSPICIOUS_CHECK_TOOL = 'report_suspicious_postings';

export const suspiciousCheckItemSchema = z.object({
  id: itemIdSchema,
  suspicious: z.boolean(),
  reasons: list(z.object({ reason: z.string().trim().min(3).max(200), quote: quoteSchema }), 5),
});
export type SuspiciousCheckItem = z.output<typeof suspiciousCheckItemSchema>;

const item: JsonSchema = jsonObject(
  {
    id: { type: 'string', description: 'The posting id.' },
    suspicious: { type: 'boolean', description: 'true only if at least one warning sign is quoted.' },
    reasons: {
      type: 'array',
      description: 'Warning signs (max 5), each with an exact quote. Empty when not suspicious.',
      items: jsonObject({ reason: { type: 'string', description: 'Short English description.' }, quote: jsonQuote }, ['reason', 'quote']),
    },
  },
  ['id', 'suspicious', 'reasons'],
);

export const SUSPICIOUS_CHECK_PARAMETERS: JsonSchema = resultsParameters(item);

export const SUSPICIOUS_CHECK_INSTRUCTIONS = `Task: decide for each posting whether it looks like a scam or a fake job posting.
Warning signs: asks candidates for money, fees, deposits or paid training; contact only via WhatsApp, Telegram or a personal e-mail address; asks for bank, card or ID details early; pay far too high for little work; no real company details; pressure to act immediately.
suspicious is true only if you quote at least one warning sign. A normal posting is not suspicious.`;

export const SUSPICIOUS_CHECK_TOKENS_PER_JOB = 220;
export const SUSPICIOUS_CHECK_BATCH = 5;

/** Cheap rule pre-filter: only postings with one of these hints are worth an AI scam check. */
export const SUSPICION_HINT_RES: readonly RegExp[] = [
  /\bwhats\s?app\b/i,
  /\btelegram\b/i,
  /\b[\w.+-]+@(?:gmail|yahoo|hotmail|outlook|proton(?:mail)?|gmx|web)\.(?:com|de|fr|nl|es|me)\b/i,
  /\b(?:registration|training|processing|application|placement|visa)\s+(?:fee|fees|deposit|charges?)\b/i,
  /\b(?:pay|paid|deposit|transfer)\b[^.\n]{0,40}\b(?:upfront|in advance|before (?:you )?start)/i,
  /\b(?:bank (?:account|details)|credit card|passport copy|ssn|social security number)\b/i,
  /\b(?:no experience (?:needed|required)|earn up to|weekly pay(?:out)?|work from home and earn|guaranteed income)\b/i,
  /\b(?:crypto(?:currency)?|bitcoin|usdt|forex)\b[^.\n]{0,40}\b(?:pay|salary|invest)/i,
  /\b(?:urgent(?:ly)? hiring|immediate start|limited slots|act now)\b/i,
  /\b(?:gebühr|kaution|vorkasse)\b/i,
  /\b(?:frais d['’]inscription|frais de formation)\b/i,
];

export function suspicionHints(text: string): string[] {
  const out: string[] = [];
  for (const re of SUSPICION_HINT_RES) {
    const m = re.exec(text);
    if (m) out.push(m[0]);
  }
  return out;
}
