'use server';
/**
 * /accuracy mutations: log one spot-checked job (and add it to the golden sample with the
 * corrected labels) and run the evaluation. Every action: requireSession → parse → domain call → refresh.
 */
import { refresh } from 'next/cache';
import { done, fail, idSchema, type ActionState } from '@/components/system/action-kit';
import { prefillLabels, parseSpotAnswers, spotLabels } from '@/components/accuracy/labels';
import { runAccuracyEval } from '@/lib/accuracy';
import { SpotCheckError, recordSpotCheck } from '@/lib/accuracy/spot-check';
import { requireSession } from '@/lib/auth/session';
import { getDb } from '@/lib/db';
import { log } from '@/lib/log';
import { loadSystemValues } from '@/lib/queries/accuracy';
import { getSetting } from '@/lib/settings';

export async function spotCheckAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  await requireSession();
  const id = idSchema.safeParse(formData.get('jobId'));
  if (!id.success) return fail('Missing job.');
  const answers = parseSpotAnswers(formData);
  if (!answers.ok) return fail(answers.error);
  try {
    const db = getDb();
    const sys = await loadSystemValues(id.data, db);
    if (!sys) return fail('That job no longer exists.');
    const profile = await getSetting(db, 'profile');
    const targets = new Set<string>([...profile.targetRoles.primary, ...profile.targetRoles.secondary, ...profile.targetRoles.fallback]);
    const labels = spotLabels(prefillLabels(sys), answers.answers, (k) => k !== null && targets.has(k));
    const res = await recordSpotCheck(db, {
      jobId: id.data,
      checks: answers.answers.map((a) => ({ field: a.field, wasCorrect: a.verdict === 'correct', errorType: a.errorType, note: a.note })),
      ...(Object.keys(labels).length ? { goldenLabels: labels } : {}),
    });
    refresh();
    return done(`Logged ${answers.answers.length} answer${answers.answers.length === 1 ? '' : 's'} for job #${id.data}: ${res.wrong} wrong.${res.goldenSampleId ? ' Added to the golden sample.' : ''}`);
  } catch (err) {
    if (err instanceof SpotCheckError) return fail(err.message);
    log.error('accuracy action: spot check failed', { err });
    return fail('Could not log the spot check. Nothing was changed — try again.');
  }
}

export async function runEvalAction(_prev: ActionState | undefined, formData: FormData): Promise<ActionState> {
  void formData;
  await requireSession();
  try {
    const r = await runAccuracyEval(getDb(), { trigger: 'ui' });
    refresh();
    if (r.sampleCount === 0) return fail(r.notes[0] ?? 'There are no labelled golden samples to evaluate yet.');
    return done(`Evaluated ${r.sampleCount} golden sample${r.sampleCount === 1 ? '' : 's'} in ${Math.round(r.durationMs)} ms${r.blocked ? ` — BLOCKED: ${r.blockedReasons[0] ?? 'results got worse'}` : ' — no regression.'}`);
  } catch (err) {
    log.error('accuracy action: evaluation failed', { err });
    return fail('The evaluation failed. Nothing was changed — try again.');
  }
}
