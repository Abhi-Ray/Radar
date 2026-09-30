/**
 * Pure scoring for job de-duplication (spec §11.1). A wrongly merged pair is worse than a missed
 * duplicate, so `mergeable` needs every strong signal at once; anything weaker is only a
 * "possible duplicate" for review.
 */
import { citySimilarity, compareTitles, round3, type DedupTitle } from './similarity';

/** Same-company matches must be seen within this many days of each other. */
export const DEDUP_WINDOW_DAYS = 45;
/** Minimum combined score for an automatic merge. */
export const MERGE_MIN_SCORE = 0.9;
/** Minimum description shingle Jaccard for an automatic merge. */
export const MERGE_MIN_DESCRIPTION = 0.9;
/** Minimum combined score to show a pair as a possible duplicate. */
export const POSSIBLE_MIN_SCORE = 0.7;
/** Minimum title similarity to consider a pair at all. */
export const TITLE_MIN_SIMILARITY = 0.6;
/** Cross-company pairs: minimum description similarity (Jaccard or containment). */
export const CROSS_COMPANY_MIN_DESCRIPTION = 0.8;

const WEIGHTS = { title: 0.35, location: 0.2, date: 0.1, description: 0.35 } as const;
const DAY_MS = 86_400_000;

export interface PairSide {
  titles: DedupTitle[];
  countryIso2: string | null;
  city: string | null;
  /** When the posting started (postedAt, else first seen). */
  start: Date;
  /** When the posting was last seen live (the candidate: its posting date or now). */
  end: Date;
}

export interface LocationComparison {
  /** 0–1; 1 = same city (or both city-less in the same country). */
  score: number;
  /** Strong enough for an automatic merge. */
  sameLocation: boolean;
  reason: string;
}

export function compareLocations(a: Pick<PairSide, 'countryIso2' | 'city'>, b: Pick<PairSide, 'countryIso2' | 'city'>): LocationComparison {
  if (a.countryIso2 && b.countryIso2 && a.countryIso2 !== b.countryIso2) {
    return { score: 0, sameLocation: false, reason: `different country (${a.countryIso2} / ${b.countryIso2})` };
  }
  const country = a.countryIso2 ?? b.countryIso2;
  const sim = citySimilarity(a.city, b.city, country);
  if (sim === null) {
    if (!a.city && !b.city && a.countryIso2 === b.countryIso2) {
      return { score: 1, sameLocation: true, reason: a.countryIso2 ? `same country, no city (${a.countryIso2})` : 'no location on either' };
    }
    // One side names a city the other lacks: a multi-location posting may be split per city.
    return { score: 0.6, sameLocation: false, reason: 'city unknown on one side' };
  }
  if (sim === 1) return { score: 1, sameLocation: true, reason: 'same city' };
  if (sim >= 0.9) return { score: sim, sameLocation: true, reason: `similar city (${a.city} / ${b.city})` };
  return { score: 0, sameLocation: false, reason: `different city (${a.city} / ${b.city})` };
}

/** Days between two activity intervals (0 when they overlap). */
export function daysApart(a: Pick<PairSide, 'start' | 'end'>, b: Pick<PairSide, 'start' | 'end'>): number {
  const aEnd = Math.max(a.start.getTime(), a.end.getTime());
  const bEnd = Math.max(b.start.getTime(), b.end.getTime());
  const gap = Math.max(a.start.getTime() - bEnd, b.start.getTime() - aEnd, 0);
  return Math.floor(gap / DAY_MS);
}

/** 1 within a week, falling to 0.5 at the window edge, 0 outside it. */
export function dateScore(days: number): number {
  if (days <= 7) return 1;
  if (days > DEDUP_WINDOW_DAYS) return 0;
  return round3(1 - (0.5 * (days - 7)) / (DEDUP_WINDOW_DAYS - 7));
}

export interface DescriptionSignal {
  /** Same descriptionHash. */
  identical: boolean;
  /** Shingle Jaccard, null when not computed. */
  jaccard: number | null;
  containment?: number | null;
  tooShort?: boolean;
}

export interface PairScore {
  score: number;
  titleEqual: boolean;
  titleSimilarity: number;
  location: LocationComparison;
  days: number;
  withinWindow: boolean;
  descriptionSimilarity: number | null;
  /** Every automatic-merge condition holds. */
  mergeable: boolean;
  reasons: string[];
}

/** Best title agreement over all title variants (raw and canonical) of both sides. */
export function bestTitle(a: DedupTitle[], b: DedupTitle[]): { equal: boolean; similarity: number } {
  let best = { equal: false, similarity: 0 };
  for (const x of a) {
    for (const y of b) {
      const c = compareTitles(x, y);
      if (c.equal) return c;
      if (c.similarity > best.similarity) best = c;
    }
  }
  return best;
}

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

/** Scores a candidate against an existing job of the SAME company. */
export function scoreSameCompany(candidate: PairSide, existing: PairSide, description: DescriptionSignal | null): PairScore {
  const title = bestTitle(candidate.titles, existing.titles);
  const location = compareLocations(candidate, existing);
  const days = daysApart(candidate, existing);
  const withinWindow = days <= DEDUP_WINDOW_DAYS;
  const descSim = description ? (description.identical ? 1 : description.jaccard) : null;
  const score = round3(
    WEIGHTS.title * title.similarity + WEIGHTS.location * location.score + WEIGHTS.date * dateScore(days) + WEIGHTS.description * (descSim ?? 0),
  );
  const reasons = ['same company'];
  reasons.push(title.equal ? 'same title' : `similar title (${pct(title.similarity)})`);
  reasons.push(location.reason);
  reasons.push(days === 0 ? 'seen at the same time' : `${days} days apart`);
  if (description?.identical) reasons.push('identical description');
  else if (descSim !== null) reasons.push(`description ${pct(descSim)} similar${description?.tooShort ? ' (short text)' : ''}`);
  else reasons.push('description not compared');
  const mergeable =
    title.equal &&
    location.sameLocation &&
    withinWindow &&
    descSim !== null &&
    descSim >= MERGE_MIN_DESCRIPTION &&
    !(description?.tooShort && !description.identical) &&
    score >= MERGE_MIN_SCORE;
  return {
    score,
    titleEqual: title.equal,
    titleSimilarity: title.similarity,
    location,
    days,
    withinWindow,
    descriptionSimilarity: descSim,
    mergeable,
    reasons,
  };
}

/**
 * Scores a candidate against a job of a DIFFERENT company (agency or aggregator reposts). Never
 * mergeable: the company itself is in doubt.
 */
export function scoreCrossCompany(candidate: PairSide, existing: PairSide, description: DescriptionSignal): PairScore {
  const base = scoreSameCompany(candidate, existing, description);
  const descSim = description.identical ? 1 : Math.max(description.jaccard ?? 0, 0.95 * (description.containment ?? 0));
  const score = round3(
    WEIGHTS.title * base.titleSimilarity + WEIGHTS.location * base.location.score + WEIGHTS.date * dateScore(base.days) + WEIGHTS.description * descSim,
  );
  const reasons = ['different company', ...base.reasons.slice(1)];
  if (!description.identical) reasons[reasons.length - 1] = `description ${pct(descSim)} similar`;
  return { ...base, score, descriptionSimilarity: round3(descSim), mergeable: false, reasons };
}

// ── Links ────────────────────────────────────────────────────────────────────────────────────

/** Path words that name a careers page, not one posting. */
const GENERIC_SEGMENTS = new Set([
  'careers', 'career', 'jobs', 'job', 'apply', 'application', 'applications', 'join', 'join-us', 'joinus', 'work-with-us', 'jobs-at',
  'open-positions', 'open-roles', 'openings', 'job-openings', 'current-openings', 'vacancies', 'vacatures', 'karriere', 'stellen',
  'stellenangebote', 'offene-stellen', 'jobboerse', 'emplois', 'emploi', 'carrieres', 'carriere', 'recrutement', 'empleo', 'empleos',
  'trabaja-con-nosotros', 'lavora-con-noi', 'lavoro', 'praca', 'kariera', 'jobb', 'lediga-jobb', 'job-offers', 'all-jobs', 'our-jobs',
  'positions', 'roles', 'search', 'results', 'index', 'home', 'en', 'de', 'fr', 'nl', 'es', 'it', 'pl', 'sv', 'da', 'fi', 'pt', 'en-us',
  'en-gb', 'de-de', 'about', 'about-us', 'team', 'company', 'page', 'pages', 'site', 'sites', 'default', 'portal', 'external',
]);

const ID_PARAM_NAMES = new Set(['gh_jid', 'ashby_jid', 'jk', 'vjk', 'jobid', 'job_id', 'id', 'reqid', 'req_id', 'pid', 'currentjobid', 'job', 'posting', 'vacancy', 'ref_no', 'refno']);

function looksLikeId(value: string): boolean {
  const v = value.toLowerCase();
  if (/\d{4,}/.test(v)) return true;
  if (/^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/.test(v)) return true;
  if (/^[0-9a-z]{6,}$/.test(v) && /\d/.test(v) && /[a-z]/.test(v)) return true;
  return false;
}

function looksLikeSlug(segment: string, depth: number): boolean {
  const words = segment.toLowerCase().split(/[-_]+/).filter((w) => /[a-z]/.test(w));
  if (GENERIC_SEGMENTS.has(segment.toLowerCase())) return false;
  return words.length >= 3 || (words.length >= 2 && depth >= 2);
}

/**
 * True when a clean apply URL points at ONE posting (an id, UUID or title slug in the path, query
 * or hash route), false for careers pages and generic "apply" forms that many jobs share.
 */
export function isSpecificJobLink(cleanUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(cleanUrl);
  } catch {
    return false;
  }
  for (const [k, v] of u.searchParams) {
    if (v && (ID_PARAM_NAMES.has(k.toLowerCase()) || looksLikeId(v))) return true;
  }
  const segments = [...u.pathname.split('/'), ...u.hash.replace(/^#!?/, '').split(/[/?&=]/)]
    .map((s) => {
      try {
        return decodeURIComponent(s);
      } catch {
        return s;
      }
    })
    .filter(Boolean);
  return segments.some((s, i) => !GENERIC_SEGMENTS.has(s.toLowerCase()) && (looksLikeId(s) || looksLikeSlug(s, i + 1)));
}
