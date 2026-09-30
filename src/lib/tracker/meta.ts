/**
 * `application_events.meta_json` shapes (brief §5: {interviewer, questions, went_well, next_steps}).
 * The column is free JSON, so readers go through these lenient parsers. Pure and client-safe.
 */

export const COMMENT_FIELDS = ['interviewer', 'questions', 'wentWell', 'nextSteps'] as const;
export type CommentField = (typeof COMMENT_FIELDS)[number];
export type CommentMeta = Partial<Record<CommentField, string>>;

export const COMMENT_FIELD_LABELS: Record<CommentField, string> = {
  interviewer: 'Interviewer',
  questions: 'Questions asked',
  wentWell: 'What went well',
  nextSteps: 'Next steps',
};

/** DB/JSON key for each field (snake_case, as the brief names them). */
export const COMMENT_FIELD_KEYS: Record<CommentField, string> = {
  interviewer: 'interviewer',
  questions: 'questions',
  wentWell: 'went_well',
  nextSteps: 'next_steps',
};

export const MAX_COMMENT_FIELD = 4000;

function obj(v: unknown): Record<string, unknown> | null {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Keeps the non-empty comment fields, trimmed and capped, under their snake_case keys. */
export function commentMetaToJson(meta: CommentMeta): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of COMMENT_FIELDS) {
    const v = str(meta[f]);
    if (v) out[COMMENT_FIELD_KEYS[f]] = v.slice(0, MAX_COMMENT_FIELD);
  }
  return out;
}

export function parseCommentMeta(v: unknown): CommentMeta {
  const o = obj(v);
  if (!o) return {};
  const out: CommentMeta = {};
  for (const f of COMMENT_FIELDS) {
    const val = str(o[COMMENT_FIELD_KEYS[f]]) ?? str(o[f]);
    if (val) out[f] = val;
  }
  return out;
}

export interface FieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

/** An edit event's `{before, after}` pairs (both objects keyed by field). */
export function parseEditMeta(v: unknown): FieldChange[] {
  const o = obj(v);
  if (!o) return [];
  const before = obj(o.before) ?? {};
  const after = obj(o.after) ?? {};
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])];
  return keys.map((field) => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
}

export function isCorrection(v: unknown): boolean {
  return obj(v)?.correction === true;
}

export function followUpOf(v: unknown): { at: Date | null; done: boolean } {
  const o = obj(v);
  const raw = str(o?.followUpAt);
  const at = raw ? new Date(raw) : null;
  return { at: at && !Number.isNaN(at.getTime()) ? at : null, done: o?.done === true };
}
