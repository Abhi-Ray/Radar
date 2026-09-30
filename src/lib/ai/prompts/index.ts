/**
 * Task registry: prompt version, tool definition, per-item validator and batch sizing of every
 * canonical AI task. Changing a prompt means bumping its version (new cache keys, and the
 * golden-sample comparison of spec §15.8 before it goes live).
 */
import type { z } from 'zod';
import type { CanonicalAiTask } from '../tasks';
import { buildPrompt, maxTokensFor, type BuiltPrompt, type PromptJob } from './common';
import {
  EXTRACT_FACTS_BATCH,
  EXTRACT_FACTS_INSTRUCTIONS,
  EXTRACT_FACTS_PARAMETERS,
  EXTRACT_FACTS_PROMPT_VERSION,
  EXTRACT_FACTS_TOKENS_PER_JOB,
  EXTRACT_FACTS_TOOL,
  extractFactsItemSchema,
  type ExtractFactsItem,
} from './extract-facts';
import type { JsonSchema } from './schema';
import {
  SUMMARY_REDFLAGS_BATCH,
  SUMMARY_REDFLAGS_INSTRUCTIONS,
  SUMMARY_REDFLAGS_PARAMETERS,
  SUMMARY_REDFLAGS_PROMPT_VERSION,
  SUMMARY_REDFLAGS_TOKENS_PER_JOB,
  SUMMARY_REDFLAGS_TOOL,
  summaryRedflagsItemSchema,
  type SummaryRedflagsItem,
} from './summary-redflags';
import {
  SUSPICIOUS_CHECK_BATCH,
  SUSPICIOUS_CHECK_INSTRUCTIONS,
  SUSPICIOUS_CHECK_PARAMETERS,
  SUSPICIOUS_CHECK_PROMPT_VERSION,
  SUSPICIOUS_CHECK_TOKENS_PER_JOB,
  SUSPICIOUS_CHECK_TOOL,
  suspiciousCheckItemSchema,
  type SuspiciousCheckItem,
} from './suspicious-check';

export * from './common';
export * from './extract-facts';
export * from './summary-redflags';
export * from './suspicious-check';

export interface TaskItemMap {
  extract_facts: ExtractFactsItem;
  summary_redflags: SummaryRedflagsItem;
  suspicious_check: SuspiciousCheckItem;
}

export interface AiTaskSpec<K extends CanonicalAiTask = CanonicalAiTask> {
  task: K;
  promptVersion: string;
  toolName: string;
  toolDescription: string;
  parameters: JsonSchema;
  instructions: string;
  itemSchema: z.ZodType<TaskItemMap[K]>;
  tokensPerJob: number;
  batchSize: number;
}

export const TASK_SPECS: { [K in CanonicalAiTask]: AiTaskSpec<K> } = {
  extract_facts: {
    task: 'extract_facts',
    promptVersion: EXTRACT_FACTS_PROMPT_VERSION,
    toolName: EXTRACT_FACTS_TOOL,
    toolDescription: 'Report the facts stated in each job posting, each with an exact quote.',
    parameters: EXTRACT_FACTS_PARAMETERS,
    instructions: EXTRACT_FACTS_INSTRUCTIONS,
    itemSchema: extractFactsItemSchema as unknown as z.ZodType<ExtractFactsItem>,
    tokensPerJob: EXTRACT_FACTS_TOKENS_PER_JOB,
    batchSize: EXTRACT_FACTS_BATCH,
  },
  summary_redflags: {
    task: 'summary_redflags',
    promptVersion: SUMMARY_REDFLAGS_PROMPT_VERSION,
    toolName: SUMMARY_REDFLAGS_TOOL,
    toolDescription: 'Report a short summary and red flags for each job posting.',
    parameters: SUMMARY_REDFLAGS_PARAMETERS,
    instructions: SUMMARY_REDFLAGS_INSTRUCTIONS,
    itemSchema: summaryRedflagsItemSchema as unknown as z.ZodType<SummaryRedflagsItem>,
    tokensPerJob: SUMMARY_REDFLAGS_TOKENS_PER_JOB,
    batchSize: SUMMARY_REDFLAGS_BATCH,
  },
  suspicious_check: {
    task: 'suspicious_check',
    promptVersion: SUSPICIOUS_CHECK_PROMPT_VERSION,
    toolName: SUSPICIOUS_CHECK_TOOL,
    toolDescription: 'Report whether each job posting looks like a scam, with quoted reasons.',
    parameters: SUSPICIOUS_CHECK_PARAMETERS,
    instructions: SUSPICIOUS_CHECK_INSTRUCTIONS,
    itemSchema: suspiciousCheckItemSchema as unknown as z.ZodType<SuspiciousCheckItem>,
    tokensPerJob: SUSPICIOUS_CHECK_TOKENS_PER_JOB,
    batchSize: SUSPICIOUS_CHECK_BATCH,
  },
};

/** Prompt versions of every task (recorded on accuracy runs). */
export function promptVersions(): Record<string, string> {
  return Object.fromEntries(Object.values(TASK_SPECS).map((s) => [s.task, s.promptVersion]));
}

export function buildTaskPrompt(spec: AiTaskSpec, jobs: PromptJob[]): BuiltPrompt & { maxTokens: number } {
  // Reasoning (even when excluded from the answer) is billed against max_tokens: keep headroom.
  return { ...buildPrompt(spec.toolName, spec.instructions, jobs), maxTokens: maxTokensFor(spec.tokensPerJob, jobs.length, 1024) };
}
