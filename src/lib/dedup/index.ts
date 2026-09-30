/**
 * Job de-duplication (spec §11.1): careful, not aggressive — a wrongly merged pair is worse than
 * a missed duplicate.
 *
 *  1. Same clean apply link (jobs.apply_url_hash) → merge, when the link names one posting and the
 *     titles agree. Careers pages / generic apply forms shared by many jobs are not evidence.
 *  2. Same company + same normalised title + same (fuzzy) city + seen within 45 days → merge only
 *     when the combined score is very high AND the description shingle Jaccard is ≥ 0.9; weaker
 *     matches come back as "possible" with a score and reasons.
 *  3. A different company with the same or a near-identical description (agency / aggregator
 *     repost) → "possible" only, never merged.
 *
 * Pairs I dismissed or split (duplicate_candidates status 'dismissed' / 'split') are never
 * proposed again for the job being re-checked (`jobIdToIgnore`).
 *
 * Every query is index-backed and bounded: apply_url_hash, company_id, description_hash and
 * (role_family, role_key), each with a LIMIT; descriptions are only loaded for the few best
 * title/location matches.
 */
import { and, desc, eq, gte, inArray, isNull, ne, or } from 'drizzle-orm';
import { duplicateCandidates, jobSources, jobs } from '../../db/schema';
import { DUPLICATE_STATUSES, ROLE_FAMILIES } from '../../db/schema/_enums';
import type { DedupCandidate, DedupResult } from '../contracts/jobs';
import { withTransaction, type DbOrTx } from '../db';
import { mapTitle } from '../normalize/title';
import {
  bestTitle,
  CROSS_COMPANY_MIN_DESCRIPTION,
  DEDUP_WINDOW_DAYS,
  isSpecificJobLink,
  POSSIBLE_MIN_SCORE,
  scoreCrossCompany,
  scoreSameCompany,
  TITLE_MIN_SIMILARITY,
  type DescriptionSignal,
  type PairScore,
  type PairSide,
} from './score';
import { compareDescriptions, dedupTitle, round3, shingles, type DedupTitle } from './similarity';

export const DEDUP_LOGIC_VERSION = 'dedup@2026-09-29.1';

/** `DedupCandidate` plus optional context that makes the decision safer. */
export interface DedupCandidateInput extends DedupCandidate {
  /** Source the posting came from: a job that already carries this source is a different posting of it. */
  sourceId?: number | null;
  /** Posting date from the source (default: now). */
  postedAt?: Date | null;
  /** mapTitle() role of the posting (computed from titleRaw when absent). */
  roleKey?: string | null;
  now?: Date;
}

/** Statuses that mean "these two are different jobs": never proposed or merged again. */
export const NEVER_MERGE_STATUSES = ['dismissed', 'split'] as const satisfies readonly (typeof DUPLICATE_STATUSES)[number][];

const MAX_LINK_MATCHES = 20;
const MAX_COMPANY_CANDIDATES = 300;
const MAX_CROSS_COMPANY_CANDIDATES = 30;
const MAX_DESCRIPTIONS_SAME_COMPANY = 5;
const MAX_DESCRIPTIONS_CROSS_COMPANY = 3;
const MAX_POSSIBLE_IDS = 5;
const MAX_MERGE_CHAIN = 10;
/** Two merge-grade matches closer than this are ambiguous → review instead of merge. */
const MERGE_TIE_MARGIN = 0.02;
/** A title must agree this much for a same-link merge. */
const LINK_TITLE_MIN = 0.5;
/** Cross-company checks need a real description (short boilerplate hashes collide). */
const CROSS_COMPANY_MIN_WORDS = 40;
const CROSS_COMPANY_TITLE_MIN = 0.8;
const DAY_MS = 86_400_000;

const lightColumns = {
  id: jobs.id,
  companyId: jobs.companyId,
  canonicalTitle: jobs.canonicalTitle,
  titleRaw: jobs.titleRaw,
  countryIso2: jobs.countryIso2,
  city: jobs.city,
  descriptionHash: jobs.descriptionHash,
  applyUrlClean: jobs.applyUrlClean,
  postedAt: jobs.postedAt,
  firstSeenAt: jobs.firstSeenAt,
  lastSeenAt: jobs.lastSeenAt,
  mergedIntoJobId: jobs.mergedIntoJobId,
};

type LightRow = {
  id: number;
  companyId: number;
  canonicalTitle: string;
  titleRaw: string;
  countryIso2: string | null;
  city: string | null;
  descriptionHash: string;
  applyUrlClean: string;
  postedAt: Date | null;
  firstSeenAt: Date;
  lastSeenAt: Date;
  mergedIntoJobId: number | null;
};

interface Scored {
  jobId: number;
  score: PairScore;
}

function titlesOf(...titles: (string | null | undefined)[]): DedupTitle[] {
  const out: DedupTitle[] = [];
  for (const t of titles) {
    if (!t || !t.trim()) continue;
    const d = dedupTitle(t);
    if (d.base && !out.some((o) => o.base === d.base && o.seniority === d.seniority && o.level === d.level)) out.push(d);
  }
  return out;
}

function sideOf(row: LightRow): PairSide {
  return {
    titles: titlesOf(row.titleRaw, row.canonicalTitle),
    countryIso2: row.countryIso2,
    city: row.city,
    start: row.postedAt && row.postedAt < row.firstSeenAt ? row.postedAt : row.firstSeenAt,
    end: row.lastSeenAt,
  };
}

/** Job ids I marked as "not the same job" as `jobId` (dismissed or split pairs). */
export async function neverMergeIds(db: DbOrTx, jobId: number | null | undefined): Promise<Set<number>> {
  const out = new Set<number>();
  if (!jobId) return out;
  const rows = await db
    .select({ a: duplicateCandidates.jobA, b: duplicateCandidates.jobB })
    .from(duplicateCandidates)
    .where(
      and(
        or(eq(duplicateCandidates.jobA, jobId), eq(duplicateCandidates.jobB, jobId)),
        inArray(duplicateCandidates.status, [...NEVER_MERGE_STATUSES]),
      ),
    );
  for (const r of rows) out.add(r.a === jobId ? r.b : r.a);
  return out;
}

/** Follows merged_into_job_id to the surviving job (the job itself when not merged). */
export async function canonicalJobId(db: DbOrTx, jobId: number): Promise<number | null> {
  let current = jobId;
  const seen = new Set<number>();
  for (let i = 0; i <= MAX_MERGE_CHAIN; i++) {
    if (seen.has(current)) return null;
    seen.add(current);
    const [row] = await db.select({ next: jobs.mergedIntoJobId }).from(jobs).where(eq(jobs.id, current)).limit(1);
    if (!row) return null;
    if (row.next === null) return current;
    current = row.next;
  }
  return null;
}

async function jobsCarryingSource(db: DbOrTx, sourceId: number | null | undefined, jobIds: number[]): Promise<Set<number>> {
  if (!sourceId || !jobIds.length) return new Set();
  const rows = await db
    .selectDistinct({ jobId: jobSources.jobId })
    .from(jobSources)
    .where(and(eq(jobSources.sourceId, sourceId), inArray(jobSources.jobId, jobIds)));
  return new Set(rows.map((r) => r.jobId));
}

async function loadDescriptions(db: DbOrTx, ids: number[]): Promise<Map<number, string>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ id: jobs.id, text: jobs.descriptionText }).from(jobs).where(inArray(jobs.id, ids));
  return new Map(rows.map((r) => [r.id, r.text]));
}

function byScoreDesc(a: Scored, b: Scored): number {
  return b.score.score - a.score.score || a.jobId - b.jobId;
}

/** Decides whether a new or re-checked posting is a job we already have. */
export async function findDuplicate(db: DbOrTx, candidate: DedupCandidate | DedupCandidateInput): Promise<DedupResult> {
  const input = candidate as DedupCandidateInput;
  const now = input.now ?? new Date();
  const ignore = input.jobIdToIgnore ?? null;
  const blocked = await neverMergeIds(db, ignore);
  if (ignore) blocked.add(ignore);

  const candStart = input.postedAt && input.postedAt < now ? input.postedAt : now;
  const cand: PairSide = {
    titles: titlesOf(input.titleRaw, input.canonicalTitle),
    countryIso2: input.countryIso2 ?? null,
    city: input.city ?? null,
    start: candStart,
    end: now,
  };
  const since = new Date(candStart.getTime() - DEDUP_WINDOW_DAYS * DAY_MS);
  const possible: Scored[] = [];
  let candShingles: Set<number> | null = null;
  const candidateShingles = () => (candShingles ??= shingles(input.descriptionText ?? ''));

  // ── 1. Same clean link ──
  const link = input.applyUrlHash ? await linkMatches(db, input.applyUrlHash, blocked) : { rows: [], cleanUrl: null };
  if (link.rows.length && link.cleanUrl && isSpecificJobLink(link.cleanUrl)) {
    const sameSource = await jobsCarryingSource(
      db,
      input.sourceId,
      link.rows.map((r) => r.id),
    );
    const eligible: Scored[] = [];
    for (const row of link.rows) {
      const title = bestTitle(cand.titles, sideOf(row).titles);
      const sameCompany = row.companyId === input.companyId;
      const reasons = ['same apply link', title.equal ? 'same title' : `similar title (${Math.round(title.similarity * 100)}%)`];
      reasons.push(sameCompany ? 'same company' : 'different company name');
      const confidence = round3((sameCompany ? 0.99 : 0.95) * (title.equal ? 1 : 0.98));
      const scored: Scored = { jobId: row.id, score: linkScore(confidence, reasons, title) };
      if (sameSource.has(row.id)) {
        scored.score.reasons.push('the same source lists it as another posting');
        scored.score.score = 0.75;
        possible.push(scored);
      } else if (title.similarity >= LINK_TITLE_MIN) eligible.push(scored);
      else {
        scored.score.score = 0.75;
        possible.push(scored);
      }
    }
    if (eligible.length === 1) {
      const [only] = eligible;
      return { action: 'merge', jobId: only.jobId, confidence: only.score.score, reasons: only.score.reasons };
    }
    // One specific link already on several jobs: they need a human, not a guess.
    for (const e of eligible) possible.push({ jobId: e.jobId, score: { ...e.score, score: 0.85, reasons: [...e.score.reasons, 'link shared by several jobs'] } });
  }

  // ── 2. Same company ──
  const sameCompany = await sameCompanyMatches(db, input, cand, since, blocked, candidateShingles);
  const mergeable = sameCompany.filter((s) => s.score.mergeable).sort(byScoreDesc);
  if (mergeable.length && !possible.some((p) => p.score.score >= 0.85)) {
    const [best, second] = mergeable;
    if (!second || best.score.score - second.score.score >= MERGE_TIE_MARGIN) {
      return { action: 'merge', jobId: best.jobId, confidence: best.score.score, reasons: best.score.reasons };
    }
  }
  for (const s of sameCompany) if (s.score.score >= POSSIBLE_MIN_SCORE || s.score.mergeable) possible.push(s);

  // ── 3. Different company, same text ──
  if (!possible.length) {
    const cross = await crossCompanyMatches(db, input, cand, since, blocked, candidateShingles);
    possible.push(...cross);
  }

  if (!possible.length) return { action: 'new' };
  const unique = new Map<number, Scored>();
  for (const p of possible.sort(byScoreDesc)) if (!unique.has(p.jobId)) unique.set(p.jobId, p);
  const ranked = [...unique.values()].slice(0, MAX_POSSIBLE_IDS);
  return { action: 'possible', jobIds: ranked.map((r) => r.jobId), score: ranked[0].score.score, reasons: ranked[0].score.reasons };
}

/** PairScore of a same-link match (location and dates are not what decides it). */
function linkScore(score: number, reasons: string[], title: { equal: boolean; similarity: number }): PairScore {
  return {
    score,
    titleEqual: title.equal,
    titleSimilarity: title.similarity,
    location: { score: 0, sameLocation: false, reason: '' },
    days: 0,
    withinWindow: true,
    descriptionSimilarity: null,
    mergeable: false,
    reasons,
  };
}

async function linkMatches(db: DbOrTx, applyUrlHash: string, blocked: Set<number>): Promise<{ rows: LightRow[]; cleanUrl: string | null }> {
  const rows: LightRow[] = await db.select(lightColumns).from(jobs).where(eq(jobs.applyUrlHash, applyUrlHash)).limit(MAX_LINK_MATCHES);
  if (!rows.length) return { rows: [], cleanUrl: null };
  const cleanUrl = rows[0].applyUrlClean;
  const canonical = new Map<number, LightRow>();
  const toLoad = new Set<number>();
  for (const r of rows) {
    if (r.mergedIntoJobId === null) canonical.set(r.id, r);
    else {
      const id = await canonicalJobId(db, r.id);
      if (id !== null && !canonical.has(id)) toLoad.add(id);
    }
  }
  const missing = [...toLoad].filter((id) => !canonical.has(id));
  if (missing.length) {
    const loaded: LightRow[] = await db.select(lightColumns).from(jobs).where(inArray(jobs.id, missing));
    for (const r of loaded) canonical.set(r.id, r);
  }
  return { rows: [...canonical.values()].filter((r) => !blocked.has(r.id)), cleanUrl };
}

async function sameCompanyMatches(
  db: DbOrTx,
  input: DedupCandidateInput,
  cand: PairSide,
  since: Date,
  blocked: Set<number>,
  candidateShingles: () => Set<number>,
): Promise<Scored[]> {
  if (!input.companyId || !cand.titles.length) return [];
  const conditions = [eq(jobs.companyId, input.companyId), isNull(jobs.mergedIntoJobId), gte(jobs.lastSeenAt, since)];
  if (input.countryIso2) conditions.push(or(eq(jobs.countryIso2, input.countryIso2), isNull(jobs.countryIso2))!);
  const rows: LightRow[] = await db
    .select(lightColumns)
    .from(jobs)
    .where(and(...conditions))
    .orderBy(desc(jobs.lastSeenAt))
    .limit(MAX_COMPANY_CANDIDATES);

  const pre: { row: LightRow; side: PairSide; score: PairScore }[] = [];
  for (const row of rows) {
    if (blocked.has(row.id)) continue;
    const side = sideOf(row);
    if (bestTitle(cand.titles, side.titles).similarity < TITLE_MIN_SIMILARITY) continue;
    const identical = !!input.descriptionHash && row.descriptionHash === input.descriptionHash;
    pre.push({ row, side, score: scoreSameCompany(cand, side, identical ? { identical: true, jaccard: 1 } : null) });
  }
  if (!pre.length) return [];
  pre.sort((a, b) => b.score.score - a.score.score || b.row.lastSeenAt.getTime() - a.row.lastSeenAt.getTime());

  const toCompare = pre
    .filter((p) => p.row.descriptionHash !== input.descriptionHash)
    .slice(0, MAX_DESCRIPTIONS_SAME_COMPANY)
    .map((p) => p.row.id);
  const texts = await loadDescriptions(db, toCompare);
  const sameSource = await jobsCarryingSource(
    db,
    input.sourceId,
    pre.map((p) => p.row.id),
  );

  const out: Scored[] = [];
  for (const p of pre) {
    let score = p.score;
    const text = texts.get(p.row.id);
    if (text !== undefined) {
      const d = compareDescriptions(candidateShingles(), shingles(text));
      const signal: DescriptionSignal = { identical: false, jaccard: d.jaccard, containment: d.containment, tooShort: d.tooShort };
      score = scoreSameCompany(cand, p.side, signal);
    }
    if (sameSource.has(p.row.id)) {
      score = { ...score, mergeable: false, reasons: [...score.reasons, 'the same source lists it as another posting'] };
    }
    out.push({ jobId: p.row.id, score });
  }
  return out;
}

async function crossCompanyMatches(
  db: DbOrTx,
  input: DedupCandidateInput,
  cand: PairSide,
  since: Date,
  blocked: Set<number>,
  candidateShingles: () => Set<number>,
): Promise<Scored[]> {
  const words = (input.descriptionText ?? '').split(/\s+/).filter(Boolean).length;
  if (words < CROSS_COMPANY_MIN_WORDS || !cand.titles.length) return [];
  const base = [ne(jobs.companyId, input.companyId), isNull(jobs.mergedIntoJobId), gte(jobs.lastSeenAt, since)];

  const identicalRows: LightRow[] = input.descriptionHash
    ? await db
        .select(lightColumns)
        .from(jobs)
        .where(and(eq(jobs.descriptionHash, input.descriptionHash), ...base))
        .limit(MAX_CROSS_COMPANY_CANDIDATES)
    : [];

  const roleKey = input.roleKey === undefined ? mapTitle(input.titleRaw || input.canonicalTitle).roleKey : input.roleKey;
  const roleRows: LightRow[] =
    roleKey && input.countryIso2
      ? await db
          .select(lightColumns)
          .from(jobs)
          .where(and(inArray(jobs.roleFamily, [...ROLE_FAMILIES]), eq(jobs.roleKey, roleKey), eq(jobs.countryIso2, input.countryIso2), ...base))
          .orderBy(desc(jobs.lastSeenAt))
          .limit(MAX_CROSS_COMPANY_CANDIDATES)
      : [];

  const out: Scored[] = [];
  const seen = new Set<number>();
  for (const row of identicalRows) {
    if (blocked.has(row.id) || seen.has(row.id)) continue;
    const side = sideOf(row);
    if (bestTitle(cand.titles, side.titles).similarity < TITLE_MIN_SIMILARITY) continue;
    seen.add(row.id);
    const score = scoreCrossCompany(cand, side, { identical: true, jaccard: 1, containment: 1 });
    if (score.score >= POSSIBLE_MIN_SCORE) out.push({ jobId: row.id, score });
  }

  const near = roleRows
    .filter((r) => !blocked.has(r.id) && !seen.has(r.id))
    .map((row) => ({ row, side: sideOf(row) }))
    .map((x) => ({ ...x, title: bestTitle(cand.titles, x.side.titles) }))
    .filter((x) => x.title.similarity >= CROSS_COMPANY_TITLE_MIN)
    .sort((a, b) => b.title.similarity - a.title.similarity)
    .slice(0, MAX_DESCRIPTIONS_CROSS_COMPANY);
  const texts = await loadDescriptions(
    db,
    near.map((n) => n.row.id),
  );
  for (const n of near) {
    const text = texts.get(n.row.id);
    if (text === undefined) continue;
    const d = compareDescriptions(candidateShingles(), shingles(text));
    if (d.tooShort || Math.max(d.jaccard, 0.95 * d.containment) < CROSS_COMPANY_MIN_DESCRIPTION) continue;
    const score = scoreCrossCompany(cand, n.side, { identical: false, jaccard: d.jaccard, containment: d.containment });
    if (score.score >= POSSIBLE_MIN_SCORE) out.push({ jobId: n.row.id, score });
  }
  return out;
}

export interface RecordPossibleResult {
  created: number;
  updated: number;
  /** Pairs left alone because I already decided them. */
  decided: number;
}

/**
 * Stores a "possible duplicate" result as duplicate_candidates pairs (job_a < job_b) for review.
 * Open pairs get the new score and reasons; decided pairs (merged / dismissed / split) are never
 * reopened, so a re-run cannot undo my decision.
 */
export async function recordPossibleDuplicates(
  db: DbOrTx,
  jobId: number,
  result: { jobIds: number[]; score: number; reasons: string[] },
): Promise<RecordPossibleResult> {
  const out: RecordPossibleResult = { created: 0, updated: 0, decided: 0 };
  const others = [...new Set(result.jobIds)].filter((id) => Number.isInteger(id) && id > 0 && id !== jobId);
  if (!others.length) return out;
  const score = Math.max(0, Math.min(1, Number.isFinite(result.score) ? result.score : 0));
  const reasons = result.reasons.map((r) => String(r).slice(0, 200)).slice(0, 20);
  await withTransaction(db, async (tx) => {
    for (const other of others) {
      const jobA = Math.min(jobId, other);
      const jobB = Math.max(jobId, other);
      const [existing] = await tx
        .select({ id: duplicateCandidates.id, status: duplicateCandidates.status })
        .from(duplicateCandidates)
        .where(and(eq(duplicateCandidates.jobA, jobA), eq(duplicateCandidates.jobB, jobB)))
        .limit(1)
        .for('update');
      if (!existing) {
        await tx.insert(duplicateCandidates).values({ jobA, jobB, score, reasonsJson: reasons, status: 'open' });
        out.created++;
      } else if (existing.status === 'open') {
        await tx.update(duplicateCandidates).set({ score, reasonsJson: reasons }).where(eq(duplicateCandidates.id, existing.id));
        out.updated++;
      } else out.decided++;
    }
  });
  return out;
}
