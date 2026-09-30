/**
 * Tracker statistics (spec §20): applied, rejected, interviews, offers, response rate and average
 * days to the first reply — overall and by country, source and role. Pure: the DB loader hands in
 * applications with their stage_change events.
 *
 * Small numbers mislead, so every line carries `conclusive` (n ≥ MIN_SAMPLE applications) and the
 * reply average its own `replyConclusive`; the UI prints "Too few to conclude" when either is false.
 *
 * Corrections: a stage_change with `meta.correction` replaces the stage it corrects (the mistaken
 * stage never counted), so fixing a mis-click does not leave a phantom offer in the numbers.
 */
import {
  INTERVIEW_STAGES,
  OFFER_STAGES,
  REPLY_STAGES,
  isApplicationStage,
  isTerminalStage,
  type ApplicationStage,
} from './stages';

export const MIN_SAMPLE = 5;
export const TOO_FEW_LABEL = 'Too few to conclude';

export interface StatEvent {
  kind: string;
  stageTo: string | null;
  occurredAt: Date;
  meta?: Record<string, unknown> | null;
}

export interface StatApplication {
  id: number;
  currentStage: ApplicationStage;
  appliedAt: Date | null;
  countryIso2: string | null;
  source: string | null;
  /** Canonical role key (job's role_key, or the title mapped for a manual application). */
  roleKey: string | null;
  events: StatEvent[];
}

export interface StatLine {
  key: string;
  label: string;
  applied: number;
  responded: number;
  interviews: number;
  offers: number;
  rejected: number;
  noResponse: number;
  /** Applied and still open (not terminal, not accepted). */
  active: number;
  /** responded / applied; null when nothing was applied. */
  responseRate: number | null;
  /** Mean whole-or-fractional days from applying to the first reply; null without replies. */
  avgDaysToFirstReply: number | null;
  /** Replies the average is based on. */
  replies: number;
  conclusive: boolean;
  replyConclusive: boolean;
}

export interface TrackerStats {
  /** Every application, saved ones included. */
  total: number;
  saved: number;
  overall: StatLine;
  byCountry: StatLine[];
  bySource: StatLine[];
  byRole: StatLine[];
  minSample: number;
}

interface PathStep {
  stage: ApplicationStage;
  at: Date;
}

/** The effective stage path from the stage_change events, corrections applied. */
export function effectivePath(events: readonly StatEvent[]): PathStep[] {
  const path: PathStep[] = [];
  const ordered = events
    .filter((e) => e.kind === 'stage_change' && isApplicationStage(e.stageTo))
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.occurredAt.getTime() - b.e.occurredAt.getTime() || a.i - b.i);
  for (const { e } of ordered) {
    const stage = e.stageTo as ApplicationStage;
    if (e.meta && e.meta.correction === true && path.length) path.pop();
    path.push({ stage, at: e.occurredAt });
  }
  return path;
}

interface AppFacts {
  applied: boolean;
  responded: boolean;
  firstReplyDays: number | null;
  interviewed: boolean;
  offered: boolean;
  rejected: boolean;
  noResponse: boolean;
  active: boolean;
}

const DAY = 86_400_000;

/** Per-application outcome flags (exported for tests). */
export function applicationFacts(app: StatApplication): AppFacts {
  const path = effectivePath(app.events);
  const reached = (list: readonly string[]) => list.includes(app.currentStage) || path.some((p) => list.includes(p.stage));
  const applied = app.appliedAt !== null && app.currentStage !== 'saved';
  const firstReply = applied ? path.find((p) => (REPLY_STAGES as readonly string[]).includes(p.stage)) : undefined;
  const responded = applied && (Boolean(firstReply) || (REPLY_STAGES as readonly string[]).includes(app.currentStage));
  let firstReplyDays: number | null = null;
  if (firstReply && app.appliedAt) {
    const d = (firstReply.at.getTime() - app.appliedAt.getTime()) / DAY;
    firstReplyDays = d >= 0 ? d : null;
  }
  return {
    applied,
    responded,
    firstReplyDays,
    interviewed: applied && reached([...INTERVIEW_STAGES, ...OFFER_STAGES]),
    offered: applied && reached(OFFER_STAGES),
    rejected: applied && app.currentStage === 'rejected',
    noResponse: applied && app.currentStage === 'no_response',
    active: applied && !isTerminalStage(app.currentStage) && app.currentStage !== 'accepted',
  };
}

function line(key: string, label: string, facts: readonly AppFacts[], minSample: number): StatLine {
  const applied = facts.filter((f) => f.applied);
  const days = applied.map((f) => f.firstReplyDays).filter((d): d is number => d !== null);
  const responded = applied.filter((f) => f.responded).length;
  return {
    key,
    label,
    applied: applied.length,
    responded,
    interviews: applied.filter((f) => f.interviewed).length,
    offers: applied.filter((f) => f.offered).length,
    rejected: applied.filter((f) => f.rejected).length,
    noResponse: applied.filter((f) => f.noResponse).length,
    active: applied.filter((f) => f.active).length,
    responseRate: applied.length ? responded / applied.length : null,
    avgDaysToFirstReply: days.length ? days.reduce((a, b) => a + b, 0) / days.length : null,
    replies: days.length,
    conclusive: applied.length >= minSample,
    replyConclusive: days.length >= minSample,
  };
}

export interface StatLabels {
  country?: (iso2: string) => string;
  role?: (roleKey: string) => string;
}

function groupBy(
  apps: readonly StatApplication[],
  facts: readonly AppFacts[],
  keyOf: (a: StatApplication) => { key: string; label: string },
  minSample: number,
): StatLine[] {
  const groups = new Map<string, { label: string; facts: AppFacts[] }>();
  apps.forEach((a, i) => {
    if (!facts[i].applied) return;
    const { key, label } = keyOf(a);
    const g = groups.get(key) ?? { label, facts: [] };
    g.facts.push(facts[i]);
    groups.set(key, g);
  });
  return [...groups.entries()]
    .map(([key, g]) => line(key, g.label, g.facts, minSample))
    .sort((a, b) => b.applied - a.applied || a.label.localeCompare(b.label));
}

export function sourceKey(source: string | null | undefined): { key: string; label: string } {
  const label = typeof source === 'string' ? source.trim() : '';
  return label ? { key: label.toLowerCase(), label } : { key: '∅', label: 'Not recorded' };
}

export function computeTrackerStats(apps: readonly StatApplication[], labels: StatLabels = {}, minSample = MIN_SAMPLE): TrackerStats {
  const facts = apps.map(applicationFacts);
  return {
    total: apps.length,
    saved: apps.filter((a) => a.currentStage === 'saved').length,
    overall: line('all', 'All applications', facts, minSample),
    byCountry: groupBy(
      apps,
      facts,
      (a) => (a.countryIso2 ? { key: a.countryIso2, label: labels.country?.(a.countryIso2) ?? a.countryIso2 } : { key: '∅', label: 'Country unknown' }),
      minSample,
    ),
    bySource: groupBy(apps, facts, (a) => sourceKey(a.source), minSample),
    byRole: groupBy(
      apps,
      facts,
      (a) => (a.roleKey ? { key: a.roleKey, label: labels.role?.(a.roleKey) ?? a.roleKey } : { key: '∅', label: 'Unmapped role' }),
      minSample,
    ),
    minSample,
  };
}
