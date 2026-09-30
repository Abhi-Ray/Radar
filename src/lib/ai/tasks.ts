/**
 * AI task names. Three canonical tasks (each with its own prompt + version); the older names from
 * the contract stay accepted as aliases so callers never break:
 *   'summary' / 'red_flags'  → summary_redflags
 *   'visa_signals'           → extract_facts (visa signals are part of the fact extraction)
 */
export const CANONICAL_AI_TASKS = ['extract_facts', 'summary_redflags', 'suspicious_check'] as const;
export type CanonicalAiTask = (typeof CANONICAL_AI_TASKS)[number];

export const AI_TASK_ALIASES: Readonly<Record<string, CanonicalAiTask>> = {
  summary: 'summary_redflags',
  red_flags: 'summary_redflags',
  redflags: 'summary_redflags',
  visa_signals: 'extract_facts',
  facts: 'extract_facts',
  suspicious: 'suspicious_check',
};

export const AI_TASKS = ['extract_facts', 'summary', 'red_flags', 'visa_signals', 'summary_redflags', 'suspicious_check'] as const;
export type AiTask = (typeof AI_TASKS)[number] | (string & {});

/** Canonical task for a name, or null when the name is unknown. */
export function canonicalTask(task: string): CanonicalAiTask | null {
  const t = String(task ?? '').trim().toLowerCase();
  if ((CANONICAL_AI_TASKS as readonly string[]).includes(t)) return t as CanonicalAiTask;
  return AI_TASK_ALIASES[t] ?? null;
}
