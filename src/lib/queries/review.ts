import 'server-only';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/mysql-core';
import { companies, deadLetters, duplicateCandidates, jobs, sources, titleReviewQueue } from '@/db/schema';
import { getDb, type DbOrTx } from '@/lib/db';
import { tidyCounts, type TidyCounts } from '@/lib/dedup/tidy';
import { countUnrelatedTitles } from '@/lib/normalize/title-tidy';

export const REVIEW_PAGE_SIZE = 20;

export interface ReviewCounts {
  duplicates: number;
  titles: number;
  jobs: number;
  failed: number;
}

export async function reviewCounts(db: DbOrTx = getDb()): Promise<ReviewCounts> {
  const [[d], [t], [j], [f]] = await Promise.all([
    db.select({ n: count() }).from(duplicateCandidates).where(eq(duplicateCandidates.status, 'open')),
    db.select({ n: count() }).from(titleReviewQueue).where(eq(titleReviewQueue.status, 'open')),
    db.select({ n: count() }).from(jobs).where(and(eq(jobs.needsReview, true), isNull(jobs.mergedIntoJobId), eq(jobs.hidden, false))),
    db.select({ n: count() }).from(deadLetters).where(eq(deadLetters.status, 'open')),
  ]);
  return { duplicates: d?.n ?? 0, titles: t?.n ?? 0, jobs: j?.n ?? 0, failed: f?.n ?? 0 };
}

export interface PairSide {
  id: number;
  title: string;
  company: string;
  city: string | null;
  countryIso2: string | null;
  locationRaw: string;
  firstSeenAt: Date;
  state: string;
  source: string | null;
}

export interface PairRow {
  id: number;
  score: number;
  reasons: unknown;
  a: PairSide;
  b: PairSide;
}

export async function listPairs(page: number, db: DbOrTx = getDb()): Promise<{ rows: PairRow[]; total: number }> {
  const ja = alias(jobs, 'ja');
  const jb = alias(jobs, 'jb');
  const ca = alias(companies, 'ca');
  const cb = alias(companies, 'cb');
  const sa = alias(sources, 'sa');
  const sb = alias(sources, 'sb');
  const where = and(eq(duplicateCandidates.status, 'open'), isNull(ja.mergedIntoJobId), isNull(jb.mergedIntoJobId));
  const base = db
    .select({
      id: duplicateCandidates.id,
      score: duplicateCandidates.score,
      reasons: duplicateCandidates.reasonsJson,
      aId: ja.id, aTitle: ja.canonicalTitle, aCompany: ca.name, aCity: ja.city, aCountry: ja.countryIso2, aLoc: ja.locationRaw, aSeen: ja.firstSeenAt, aState: ja.state, aSource: sa.label,
      bId: jb.id, bTitle: jb.canonicalTitle, bCompany: cb.name, bCity: jb.city, bCountry: jb.countryIso2, bLoc: jb.locationRaw, bSeen: jb.firstSeenAt, bState: jb.state, bSource: sb.label,
    })
    .from(duplicateCandidates)
    .innerJoin(ja, eq(ja.id, duplicateCandidates.jobA))
    .innerJoin(jb, eq(jb.id, duplicateCandidates.jobB))
    .innerJoin(ca, eq(ca.id, ja.companyId))
    .innerJoin(cb, eq(cb.id, jb.companyId))
    .leftJoin(sa, eq(sa.id, ja.bestSourceId))
    .leftJoin(sb, eq(sb.id, jb.bestSourceId))
    .where(where)
    .orderBy(desc(duplicateCandidates.score), duplicateCandidates.id)
    .limit(REVIEW_PAGE_SIZE)
    .offset((page - 1) * REVIEW_PAGE_SIZE);
  const totalQ = db
    .select({ n: count() })
    .from(duplicateCandidates)
    .innerJoin(ja, eq(ja.id, duplicateCandidates.jobA))
    .innerJoin(jb, eq(jb.id, duplicateCandidates.jobB))
    .where(where);
  const [rows, [total]] = await Promise.all([base, totalQ]);
  return {
    total: total?.n ?? 0,
    rows: rows.map((r) => ({
      id: r.id,
      score: r.score,
      reasons: r.reasons,
      a: { id: r.aId, title: r.aTitle, company: r.aCompany, city: r.aCity, countryIso2: r.aCountry, locationRaw: r.aLoc, firstSeenAt: r.aSeen, state: r.aState, source: r.aSource },
      b: { id: r.bId, title: r.bTitle, company: r.bCompany, city: r.bCity, countryIso2: r.bCountry, locationRaw: r.bLoc, firstSeenAt: r.bSeen, state: r.bState, source: r.bSource },
    })),
  };
}

export interface TitleRow {
  id: number;
  titleRaw: string;
  normalized: string;
  count: number;
  lang: string | null;
  lastSeen: Date;
  sample: { jobId: number; title: string; company: string } | null;
}

export async function listTitles(page: number, db: DbOrTx = getDb()): Promise<{ rows: TitleRow[]; total: number }> {
  const [rows, [total]] = await Promise.all([
    db
      .select({ id: titleReviewQueue.id, titleRaw: titleReviewQueue.titleRaw, normalized: titleReviewQueue.normalized, count: titleReviewQueue.count, lang: titleReviewQueue.lang, lastSeen: titleReviewQueue.lastSeen, jobId: jobs.id, jobTitle: jobs.canonicalTitle, company: companies.name })
      .from(titleReviewQueue)
      .leftJoin(jobs, eq(jobs.id, titleReviewQueue.sampleJobId))
      .leftJoin(companies, eq(companies.id, jobs.companyId))
      .where(eq(titleReviewQueue.status, 'open'))
      .orderBy(desc(titleReviewQueue.count), titleReviewQueue.id)
      .limit(REVIEW_PAGE_SIZE)
      .offset((page - 1) * REVIEW_PAGE_SIZE),
    db.select({ n: count() }).from(titleReviewQueue).where(eq(titleReviewQueue.status, 'open')),
  ]);
  return {
    total: total?.n ?? 0,
    rows: rows.map((r) => ({ id: r.id, titleRaw: r.titleRaw, normalized: r.normalized, count: r.count, lang: r.lang, lastSeen: r.lastSeen, sample: r.jobId && r.jobTitle && r.company ? { jobId: r.jobId, title: r.jobTitle, company: r.company } : null })),
  };
}

export interface FlaggedJob {
  id: number;
  title: string;
  company: string;
  countryIso2: string | null;
  score: number | null;
  state: string;
  ghostRisk: boolean;
  linkStatus: string;
  factsConfidence: string | null;
  visaStatus: string | null;
  repostCount: number;
  missingRunCount: number;
  lastSeenAt: Date;
}

export async function listFlaggedJobs(page: number, db: DbOrTx = getDb()): Promise<{ rows: FlaggedJob[]; total: number }> {
  const where = and(eq(jobs.needsReview, true), isNull(jobs.mergedIntoJobId), eq(jobs.hidden, false));
  const [rows, [total]] = await Promise.all([
    db
      .select({ id: jobs.id, title: jobs.canonicalTitle, company: companies.name, countryIso2: jobs.countryIso2, score: jobs.score, state: jobs.state, ghostRisk: jobs.ghostRisk, linkStatus: jobs.linkStatus, factsConfidence: jobs.factsConfidence, visaStatus: jobs.visaStatus, repostCount: jobs.repostCount, missingRunCount: jobs.missingRunCount, lastSeenAt: jobs.lastSeenAt })
      .from(jobs)
      .innerJoin(companies, eq(companies.id, jobs.companyId))
      .where(where)
      .orderBy(desc(jobs.score), jobs.id)
      .limit(REVIEW_PAGE_SIZE)
      .offset((page - 1) * REVIEW_PAGE_SIZE),
    db.select({ n: count() }).from(jobs).where(where),
  ]);
  return { rows: rows as FlaggedJob[], total: total?.n ?? 0 };
}

export interface ReviewTidy {
  pairs: TidyCounts;
  titles: { unrelated: number; total: number };
}

/** What the "clear the noise" buttons would do right now. */
export async function reviewTidy(db: DbOrTx = getDb()): Promise<ReviewTidy> {
  const [pairs, titles] = await Promise.all([tidyCounts(db), countUnrelatedTitles(db)]);
  return { pairs, titles };
}
