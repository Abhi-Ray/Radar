/**
 * Enum value lists shared by the DB schema (mysqlEnum) and the TS contracts
 * (`src/lib/contracts/*` re-export these). Changing a list = a migration.
 */
export const METHODS = ['manual', 'official', 'posting', 'rule', 'ai', 'estimate'] as const;
export const CONFIDENCES = ['high', 'medium', 'low'] as const;
export const GRADES = ['A', 'B', 'C', 'D'] as const;

// auth / ops
export const ALERT_SEVERITIES = ['info', 'warn', 'critical'] as const;
export const BACKUP_KINDS = ['backup', 'restore_test'] as const;
export const BACKUP_STATUSES = ['running', 'ok', 'failed'] as const;
export const LOGIN_OUTCOMES = ['success', 'bad_credentials', 'locked', 'lockout', 'invalid'] as const;

// geo / visa
export const VERIFICATION_STATUSES = ['unverified', 'verified'] as const;
export const PAGE_WATCH_STATUSES = ['unchecked', 'ok', 'changed', 'error'] as const;

// sources
export const TERMS_STATUSES = ['allowed', 'restricted', 'unknown', 'forbidden'] as const;
export const SOURCE_STATUSES = ['draft', 'trial', 'live', 'paused', 'disabled'] as const;
export const SOURCE_RUN_STATUSES = ['running', 'ok', 'failed', 'partial', 'skipped'] as const;

// pipeline
export const RUN_KINDS = ['daily', 'manual', 'reprocess', 'dry_run', 'linkcheck'] as const;
export const RUN_STATUSES = ['queued', 'running', 'ok', 'partial', 'failed', 'skipped'] as const;
export const DEAD_LETTER_STAGES = ['parse', 'validate', 'normalize', 'enrich'] as const;
export const DEAD_LETTER_STATUSES = ['open', 'retried', 'resolved', 'ignored'] as const;

// companies
export const COMPANY_TYPES = ['startup', 'scaleup', 'midsize', 'mnc', 'agency', 'unknown'] as const;
export const ALIAS_KINDS = ['brand', 'legal', 'ats_slug', 'other'] as const;
export const EVIDENCE_KINDS = ['register_match', 'posting_history', 'manual_note', 'ai'] as const;
export const MATCH_STATUSES = ['confirmed', 'possible', 'rejected'] as const;

// jobs
export const ROLE_FAMILIES = ['primary', 'secondary', 'fallback', 'other'] as const;
export const WORKPLACE_TYPES = ['onsite', 'hybrid', 'remote'] as const;
export const JOB_STATES = ['new', 'active', 'updated', 'stale', 'closed', 'expired', 'suspicious'] as const;
export const LINK_STATUSES = ['ok', 'dead', 'unknown', 'redirected'] as const;
export const DUPLICATE_STATUSES = ['open', 'merged', 'split', 'dismissed'] as const;
export const TITLE_REVIEW_STATUSES = ['open', 'mapped', 'ignored'] as const;
export const VISA_STATUSES = ['confirmed', 'likely', 'unknown', 'not_offered', 'conflicting'] as const;
export const REMOTE_CLASSES = ['worldwide', 'region_limited', 'timezone_limited', 'unclear', 'not_remote'] as const;
export const LANGUAGE_REQUIREMENTS = ['english_ok', 'local_required', 'unclear'] as const;
export const EXPERIENCE_BANDS = ['core', 'show', 'hide', 'unknown'] as const;
export const ELIGIBILITY_RESULTS = ['meets', 'borderline', 'doesnt_meet', 'cant_tell'] as const;
export const SALARY_KINDS = ['stated', 'estimated'] as const;
export const SENIORITY_WORDS = ['junior', 'mid', 'senior', 'lead', 'principal'] as const;

// accuracy
export const GOLDEN_ORIGINS = ['manual', 'correction', 'spot_check'] as const;

// ai
export const AI_CALL_STATUSES = ['ok', 'invalid', 'error', 'budget'] as const;
export const AI_QUEUE_STATUSES = ['queued', 'done', 'skipped', 'failed'] as const;

// tracker
export const APPLICATION_STAGES = [
  'saved',
  'applied',
  'screening',
  'technical',
  'final',
  'offer',
  'accepted',
  'rejected',
  'withdrawn',
  'no_response',
] as const;
export const APPLICATION_EVENT_KINDS = ['stage_change', 'comment', 'follow_up_set', 'edit', 'snapshot'] as const;
export const RESUME_TRACKS = ['cloud_security', 'devsecops', 'fullstack', 'other'] as const;
export const TEMPLATE_KINDS = ['cover_letter', 'outreach', 'checklist', 'cv_convention'] as const;
