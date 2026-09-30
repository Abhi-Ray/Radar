import 'server-only';
import { eq } from 'drizzle-orm';
import { jobs } from '@/db/schema';
import { goldenSampleCounts } from '@/lib/accuracy/golden';
import { accuracyLog, accuracyRunHistory, type AccuracyLog, type AccuracyRunSummary } from '@/lib/accuracy/log';
import { SPOT_CHECK_SIZE, checkedJobIds, isoWeekKey, pickRandomJobs, type SpotCheckJob } from '@/lib/accuracy/spot-check';
import type { SystemValues } from '@/components/accuracy/labels';
import { getDb, type DbOrTx } from '@/lib/db';

export interface AccuracyView {
  golden: { total: number; labelled: number; byOrigin: Record<string, number> };
  runs: AccuracyRunSummary[];
  log: AccuracyLog;
  weekKey: string;
  checkedThisWeek: number;
  batchSize: number;
  /** The jobs still to check this week (the same ones all week, minus those already done). */
  spot: SpotCheckJob[];
}

function numericSeed(key: string): number {
  let h = 7;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  return Math.abs(h) + 1;
}

export async function loadAccuracy(db: DbOrTx = getDb()): Promise<AccuracyView> {
  const now = new Date();
  const weekKey = isoWeekKey(now);
  const [golden, runs, log, checked] = await Promise.all([goldenSampleCounts(db), accuracyRunHistory(db, 8), accuracyLog(db, { now }), checkedJobIds(db, weekKey)]);
  const remaining = Math.max(0, SPOT_CHECK_SIZE - checked.length);
  const spot = remaining ? await pickRandomJobs(db, remaining, { now, seed: numericSeed(weekKey) }) : [];
  return { golden, runs, log, weekKey, checkedThisWeek: checked.length, batchSize: SPOT_CHECK_SIZE, spot };
}

/** What RADAR currently shows for one job, in label terms (server side, so a form cannot forge it). */
export async function loadSystemValues(jobId: number, db: DbOrTx = getDb()): Promise<SystemValues | null> {
  const [j] = await db
    .select({
      roleKey: jobs.roleKey,
      roleFamily: jobs.roleFamily,
      seniority: jobs.seniority,
      visaStatus: jobs.visaStatus,
      remoteClass: jobs.remoteClass,
      languageRequirement: jobs.languageRequirement,
      countryIso2: jobs.countryIso2,
      experienceMinYears: jobs.experienceMinYears,
      salaryKind: jobs.salaryKind,
    })
    .from(jobs)
    .where(eq(jobs.id, jobId))
    .limit(1);
  if (!j) return null;
  return {
    roleKey: j.roleKey,
    roleFamily: j.roleFamily,
    seniority: j.seniority,
    visaStatus: j.visaStatus,
    remoteClass: j.remoteClass,
    languageRequirement: j.languageRequirement,
    countryIso2: j.countryIso2,
    experienceMinYears: j.experienceMinYears,
    // Amounts are stored normalised to EUR, not as posted, so only "is a salary stated" is labelled.
    salary: j.salaryKind === null || j.salaryKind === 'estimated' ? null : { kind: j.salaryKind },
  };
}
