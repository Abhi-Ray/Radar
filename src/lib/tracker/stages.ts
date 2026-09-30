/**
 * The application stage machine (spec §20). Pure and client-safe: the board, the stage picker and
 * the server-side check in `addApplicationEvent` all read the same rules.
 *
 *   Saved → Applied → Screening → Technical round(s) → Final round → Offer → Accepted
 *   Terminal: Rejected · Withdrawn · No response
 *
 * Rules:
 * - Forward along the pipeline, skipping stages is fine (a company may go straight to the final).
 * - "Technical" may repeat: technical → technical logs another round.
 * - Rejected / No response only after applying (there is nobody to reject an unsent application).
 *   Withdrawn works from any open stage (dropping a saved one included).
 * - No response is not final: a late reply moves it on to screening or later, or to rejected.
 * - Accepted, Rejected and Withdrawn are closed. Anything else — a backwards move, reopening a
 *   closed application — is a *correction*: allowed only with a reason, and logged as such.
 */
import { APPLICATION_STAGES } from '../../db/schema/_enums';

export type ApplicationStage = (typeof APPLICATION_STAGES)[number];

export const PIPELINE_STAGES = ['saved', 'applied', 'screening', 'technical', 'final', 'offer', 'accepted'] as const satisfies readonly ApplicationStage[];
export const TERMINAL_STAGES = ['rejected', 'withdrawn', 'no_response'] as const satisfies readonly ApplicationStage[];
/** Stages that count as "the company talked to me" (an interview of some kind or later). */
export const INTERVIEW_STAGES = ['screening', 'technical', 'final'] as const satisfies readonly ApplicationStage[];
export const OFFER_STAGES = ['offer', 'accepted'] as const satisfies readonly ApplicationStage[];
/** Reaching one of these after applying is a reply from the company (a rejection is a reply too). */
export const REPLY_STAGES = ['screening', 'technical', 'final', 'offer', 'accepted', 'rejected'] as const satisfies readonly ApplicationStage[];
/** Closed for good (only a correction reopens them). `no_response` is terminal but can still move. */
export const CLOSED_STAGES = ['accepted', 'rejected', 'withdrawn'] as const satisfies readonly ApplicationStage[];
/** Stages a manual application may start in (anything open). */
export const INITIAL_STAGES = ['saved', 'applied', 'screening', 'technical', 'final', 'offer'] as const satisfies readonly ApplicationStage[];
export type InitialStage = (typeof INITIAL_STAGES)[number];

/** Board column order: the pipeline, then the terminal lanes. */
export const BOARD_STAGES: readonly ApplicationStage[] = [...PIPELINE_STAGES, ...TERMINAL_STAGES];

export function isApplicationStage(v: unknown): v is ApplicationStage {
  return typeof v === 'string' && (APPLICATION_STAGES as readonly string[]).includes(v);
}

export function isInitialStage(v: unknown): v is InitialStage {
  return typeof v === 'string' && (INITIAL_STAGES as readonly string[]).includes(v);
}

const has = (list: readonly string[], s: string | null | undefined) => typeof s === 'string' && list.includes(s);

export const isTerminalStage = (s: ApplicationStage | null | undefined) => has(TERMINAL_STAGES, s);
export const isClosedStage = (s: ApplicationStage | null | undefined) => has(CLOSED_STAGES, s);
export const isInterviewStage = (s: ApplicationStage | null | undefined) => has(INTERVIEW_STAGES, s);
export const isOfferStage = (s: ApplicationStage | null | undefined) => has(OFFER_STAGES, s);
export const isReplyStage = (s: ApplicationStage | null | undefined) => has(REPLY_STAGES, s);

/** Position on the pipeline (0 = saved … 6 = accepted); terminal stages have none. */
export function pipelineIndex(s: ApplicationStage): number | null {
  const i = (PIPELINE_STAGES as readonly string[]).indexOf(s);
  return i === -1 ? null : i;
}

export interface StageMeta {
  label: string;
  /** Column / chip label (≤ 10 chars). */
  short: string;
  /** One line for the stage picker. */
  hint: string;
  tone: 'card' | 'acid' | 'cobalt' | 'lilac' | 'signal' | 'radar' | 'stamp' | 'concrete' | 'ink' | 'paper';
  icon: 'bookmark' | 'mail' | 'user' | 'bolt' | 'flag' | 'stamp' | 'check' | 'close' | 'arrow-left' | 'clock';
}

export const STAGE_META: Record<ApplicationStage, StageMeta> = {
  saved: { label: 'Saved', short: 'Saved', hint: 'On the shortlist, not sent yet.', tone: 'paper', icon: 'bookmark' },
  applied: { label: 'Applied', short: 'Applied', hint: 'Application sent.', tone: 'acid', icon: 'mail' },
  screening: { label: 'Screening', short: 'Screening', hint: 'Recruiter or HR call.', tone: 'cobalt', icon: 'user' },
  technical: { label: 'Technical round', short: 'Technical', hint: 'Technical interview or take-home; repeat for each round.', tone: 'lilac', icon: 'bolt' },
  final: { label: 'Final round', short: 'Final', hint: 'Final / onsite / hiring-manager round.', tone: 'signal', icon: 'flag' },
  offer: { label: 'Offer', short: 'Offer', hint: 'An offer is on the table.', tone: 'radar', icon: 'stamp' },
  accepted: { label: 'Accepted', short: 'Accepted', hint: 'Offer accepted.', tone: 'radar', icon: 'check' },
  rejected: { label: 'Rejected', short: 'Rejected', hint: 'The company said no.', tone: 'stamp', icon: 'close' },
  withdrawn: { label: 'Withdrawn', short: 'Withdrawn', hint: 'I pulled out.', tone: 'concrete', icon: 'arrow-left' },
  no_response: { label: 'No response', short: 'No reply', hint: 'Heard nothing back.', tone: 'concrete', icon: 'clock' },
};

export function stageLabel(s: string | null | undefined): string {
  return isApplicationStage(s) ? STAGE_META[s].label : 'Unknown stage';
}

export type TransitionVerdict =
  | { ok: true; correction: boolean }
  | { ok: false; reason: string; /** A correction (with a reason) would allow it. */ correctable: boolean };

/**
 * Whether `from → to` is a normal move. `from` null means "a new application" (saved / applied /
 * any open stage for a manual one). Corrections are checked by `checkTransition`.
 */
export function transitionProblem(from: ApplicationStage | null, to: ApplicationStage): string | null {
  if (!isApplicationStage(to)) return `Unknown stage: ${String(to)}.`;
  if (from === null) return isInitialStage(to) ? null : `A new application cannot start as “${STAGE_META[to].label}”.`;
  if (from === to) return to === 'technical' ? null : `It is already at “${STAGE_META[to].label}”.`;
  if (isClosedStage(from)) return `“${STAGE_META[from].label}” is closed — reopening it is a correction.`;
  if (from === 'no_response') {
    if (to === 'rejected' || to === 'withdrawn') return null;
    const i = pipelineIndex(to);
    return i !== null && i >= (pipelineIndex('screening') as number) ? null : `A late reply moves “No response” to screening or later.`;
  }
  const fromIdx = pipelineIndex(from) as number;
  if (to === 'withdrawn') return null;
  if (to === 'rejected' || to === 'no_response') {
    return fromIdx >= (pipelineIndex('applied') as number) ? null : `Mark it applied first — nobody can reject an application that was never sent.`;
  }
  const toIdx = pipelineIndex(to) as number;
  if (toIdx < fromIdx) return `Moving back from “${STAGE_META[from].label}” to “${STAGE_META[to].label}” is a correction.`;
  return null;
}

export function checkTransition(from: ApplicationStage | null, to: ApplicationStage, opts: { correction?: boolean } = {}): TransitionVerdict {
  if (!isApplicationStage(to)) return { ok: false, reason: `Unknown stage: ${String(to)}.`, correctable: false };
  const problem = transitionProblem(from, to);
  if (!problem) return { ok: true, correction: false };
  // A correction can fix anything except a no-op or a brand-new application's first stage.
  const correctable = from !== null && from !== to;
  if (opts.correction && correctable) return { ok: true, correction: true };
  return { ok: false, reason: problem, correctable };
}

/** The normal next moves from `from` (for the stage picker), in board order. */
export function nextStages(from: ApplicationStage): ApplicationStage[] {
  return BOARD_STAGES.filter((to) => transitionProblem(from, to) === null);
}

/** Every stage a correction could move `from` to (all but itself). */
export function correctionStages(from: ApplicationStage): ApplicationStage[] {
  return BOARD_STAGES.filter((to) => to !== from);
}
