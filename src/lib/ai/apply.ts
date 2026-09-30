/**
 * From a schema-valid AI answer to stored facts (spec §5, §15).
 *
 * Mapping (pure, `map*`): every fact must carry a quote that is really in the text the job was
 * sent with (verify.ts), and the quote must support the value where that can be checked in code
 * (the years for experience, the amounts for salary, the skill name for a skill). Anything that
 * fails is dropped and counted as rejected — never stored. AI facts are method 'ai', source
 * 'openrouter:<model>', logic version = prompt version, confidence at most medium.
 *
 * Storing (`storeTaskFacts`): AI facts are candidates next to the rule/posting facts; the
 * resolver keeps the higher-trust one. When a higher-trust fact states something DIFFERENT from
 * the AI (not merely "unclear"), the job is flagged needs_review and the conflict is audited.
 * AI facts the model did not repeat this time are retracted, so a re-run never leaves stale ones.
 */
import { eq } from 'drizzle-orm';
import { jobs } from '../../db/schema';
import type { ExperienceValue, FxTable, LanguageValue, RemoteValue, SalaryValue, SkillsValue, VisaSignal } from '../contracts/jobs';
import type { Fact, FactKey, StoredFact } from '../contracts/provenance';
import { audit } from '../audit';
import { withTransaction, type DbOrTx } from '../db';
import { lookupRate } from '../fx/rates';
import { log } from '../log';
import { experienceBandFor, type ExperienceBandSettings } from '../normalize/experience';
import { annualize, statedInstallments } from '../normalize/salary';
import { addFact, getFacts, loadResolvedFacts, retractFacts, syncResolvedJobColumns } from '../provenance/store';
import { rescoreJob } from '../scoring/from-db';
import { evaluateJobVisa, parseVisaSignal, writeVisaSignals } from '../visa/persist';
import { AI_MAX_CONFIDENCE } from './config';
import { MAX_SUMMARY_CHARS, type ExtractFactsItem, type SummaryRedflagsItem, type SuspiciousCheckItem } from './prompts';
import type { CanonicalAiTask } from './tasks';
import { checkEvidence, displayQuote, looksLikeInjection, quoteMentionsAmount, quoteMentionsNumber, quoteMentionsTerm } from './verify';

const plog = log.child({ module: 'ai-apply' });

/** Annual EUR outside this range is not a salary (a typo, a budget, a phone number…). */
export const SALARY_PLAUSIBLE_EUR: readonly [number, number] = [3_000, 1_000_000];

export interface MapContext {
  /** The exact text the job was sent with (quotes must be substrings of it). */
  checkText: string;
  /** The full posting text (installment hints may sit outside the capped part). */
  fullText: string;
  /** Detected posting language (visa signal `lang`). */
  lang: string | null;
  promptVersion: string;
  /** 'openrouter:<model>'. */
  source: string;
  now: Date;
  /** Profile.experienceBand / Profile.skills (or the defaults). */
  profile: { experienceBand: ExperienceBandSettings; skills: readonly string[] };
  fx: FxTable;
}

export interface MappedFact {
  key: FactKey;
  fact: Fact<unknown>;
}

export interface MappedAnswer {
  task: CanonicalAiTask;
  /** Single-valued and red_flags facts (visa signals are separate). */
  facts: MappedFact[];
  /** extract_facts only: the verified visa signals (stored through the visa engine). */
  visaSignals: VisaSignal[];
  /** Keys this task owns (AI facts of these keys that are not in `facts` get retracted). */
  ownedKeys: FactKey[];
  /** Pieces thrown away (bad quote, unsupported value, implausible…). */
  rejected: number;
  /** Why (codes only — never posting text). */
  rejections: string[];
  /** suspicious_check said "suspicious" with at least one verified reason. */
  suspicious: boolean;
}

function emptyAnswer(task: CanonicalAiTask, ownedKeys: FactKey[]): MappedAnswer {
  return { task, facts: [], visaSignals: [], ownedKeys, rejected: 0, rejections: [], suspicious: false };
}

function reject(out: MappedAnswer, code: string): void {
  out.rejected++;
  if (out.rejections.length < 20) out.rejections.push(code);
}

/** Null when the quote is usable; otherwise the reason code. */
function quoteProblem(quote: unknown, ctx: MapContext): string | null {
  return checkEvidence(quote, ctx.checkText);
}

function aiFact<T>(value: T, evidence: string | null, ctx: MapContext, confidence: Fact<T>['confidence'] = AI_MAX_CONFIDENCE): Fact<T> {
  return {
    value,
    evidence,
    source: ctx.source,
    method: 'ai',
    confidence: confidence === 'high' ? AI_MAX_CONFIDENCE : confidence,
    checkedAt: ctx.now,
    logicVersion: ctx.promptVersion,
  };
}

export const EXTRACT_FACT_KEYS: readonly FactKey[] = ['experience', 'skills', 'language', 'remote', 'salary'];

// ---- extract_facts -----------------------------------------------------------------------------

export function mapExtractFacts(item: ExtractFactsItem, ctx: MapContext): MappedAnswer {
  const out = emptyAnswer('extract_facts', [...EXTRACT_FACT_KEYS, 'visa_signal']);

  // Visa signals: the quote is the evidence the visa engine shows; AI alone never confirms.
  const seen = new Set<string>();
  for (const s of item.visa_signals) {
    const p = quoteProblem(s.quote, ctx);
    if (p) {
      reject(out, `visa_signal:${p}`);
      continue;
    }
    const quote = displayQuote(s.quote);
    const k = `${s.signal}|${quote.toLowerCase()}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.visaSignals.push({ signal: s.signal, quote, lang: (ctx.lang ?? 'und').slice(0, 8), ruleId: `ai:${ctx.promptVersion}`, confidence: AI_MAX_CONFIDENCE });
  }

  // Experience: the years must be in the quote.
  if (item.experience) {
    const e = item.experience;
    const min = Math.round(e.min_years * 2) / 2;
    const max = e.max_years === null ? null : Math.round(e.max_years * 2) / 2;
    const p = quoteProblem(e.quote, ctx);
    if (p) reject(out, `experience:${p}`);
    else if (max !== null && max < min) reject(out, 'experience:max_below_min');
    else if ((min > 0 && !quoteMentionsNumber(e.quote, min)) || (max !== null && max > 0 && !quoteMentionsNumber(e.quote, max))) {
      reject(out, 'experience:years_not_in_quote');
    } else {
      const value: ExperienceValue = {
        minYears: min,
        maxYears: max,
        band: experienceBandFor(min, max, ctx.profile.experienceBand),
        securityStrict: false,
      };
      out.facts.push({ key: 'experience', fact: aiFact(value, displayQuote(e.quote), ctx) });
    }
  }

  // Skills: each name must appear in its own quote.
  const found: string[] = [];
  const quotes: string[] = [];
  for (const s of item.skills) {
    const p = quoteProblem(s.quote, ctx);
    if (p) {
      reject(out, `skill:${p}`);
      continue;
    }
    if (!quoteMentionsTerm(s.quote, s.name)) {
      reject(out, 'skill:name_not_in_quote');
      continue;
    }
    if (found.some((f) => f.toLowerCase() === s.name.toLowerCase())) continue;
    found.push(s.name);
    quotes.push(displayQuote(s.quote, 120));
  }
  if (found.length) {
    const lower = new Set(found.map((f) => f.toLowerCase()));
    const value: SkillsValue = {
      matched: ctx.profile.skills.filter((s) => lower.has(s.toLowerCase())),
      found: [...found].sort((a, b) => a.localeCompare(b)),
    };
    out.facts.push({ key: 'skills', fact: aiFact(value, quotes.join(' | ').slice(0, 1000), ctx) });
  }

  // Language requirement ("unclear" adds nothing: not stored).
  if (item.language && item.language.requirement !== 'unclear') {
    const l = item.language;
    const p = quoteProblem(l.quote, ctx);
    if (p) reject(out, `language:${p}`);
    else {
      const value: LanguageValue = {
        postingLang: ctx.lang,
        requirement: l.requirement,
        languages: [...new Set(l.languages.map((x) => x.toLowerCase()))],
      };
      out.facts.push({ key: 'language', fact: aiFact(value, displayQuote(l.quote), ctx) });
    }
  }

  // Remote class ("unclear" is not stored either).
  if (item.remote && item.remote.class !== 'unclear') {
    const r = item.remote;
    const p = quoteProblem(r.quote, ctx);
    if (p) reject(out, `remote:${p}`);
    else {
      const value: RemoteValue = { class: r.class, regions: [...new Set(r.regions.map((x) => x.trim()).filter(Boolean))] };
      out.facts.push({ key: 'remote', fact: aiFact(value, displayQuote(r.quote), ctx) });
    }
  }

  // Salary: amounts must be in the quote, the currency must be convertible, the result plausible.
  if (item.salary) {
    const s = mapSalary(item.salary, ctx);
    if (typeof s === 'string') reject(out, `salary:${s}`);
    else out.facts.push({ key: 'salary', fact: aiFact(s, displayQuote(item.salary.quote), ctx) });
  }
  return out;
}

function mapSalary(s: NonNullable<ExtractFactsItem['salary']>, ctx: MapContext): SalaryValue | string {
  const p = quoteProblem(s.quote, ctx);
  if (p) return p;
  const min = s.min;
  const max = s.max !== null && s.max !== s.min ? s.max : null;
  if (max !== null && max < min) return 'max_below_min';
  if (!quoteMentionsAmount(s.quote, min) || (max !== null && !quoteMentionsAmount(s.quote, max))) return 'amount_not_in_quote';
  const rate = lookupRate(ctx.fx, s.currency);
  if (!rate) return 'no_fx_rate';
  const installments = s.period === 'month' ? statedInstallments(ctx.fullText) : null;
  const eur = (n: number) => Math.round(annualize(n, s.period, installments) / rate.rate);
  const annualEurMin = eur(min);
  const annualEurMax = max === null ? null : eur(max);
  const [lo, hi] = SALARY_PLAUSIBLE_EUR;
  if (annualEurMin < lo || annualEurMin > hi || (annualEurMax !== null && annualEurMax > hi)) return 'implausible';
  return {
    min,
    max,
    currency: s.currency,
    period: s.period,
    grossNet: 'unknown',
    installments,
    annualEurMin,
    annualEurMax,
    fxRate: s.currency === 'EUR' ? null : rate.rate,
    fxDate: s.currency === 'EUR' ? null : (rate.date ?? ctx.fx.date ?? null),
    kind: 'stated',
  };
}

// ---- summary_redflags --------------------------------------------------------------------------

export function clipSummary(s: string, max = MAX_SUMMARY_CHARS): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const stop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return stop > max * 0.5 ? cut.slice(0, stop + 1) : `${cut.slice(0, max - 1).trimEnd()}…`;
}

export function mapSummaryRedflags(item: SummaryRedflagsItem, ctx: MapContext): MappedAnswer {
  const out = emptyAnswer('summary_redflags', ['ai_summary', 'red_flags']);
  const verified: string[] = [];
  let bad = 0;
  for (const q of item.summary_quotes) {
    const p = quoteProblem(q, ctx);
    if (p) bad++;
    else verified.push(displayQuote(q, 200));
  }
  if (looksLikeInjection(item.summary)) reject(out, 'summary:injection');
  else if (!verified.length) reject(out, 'summary:no_verified_quote');
  else {
    // Some quotes failed: the summary is kept (it is supported) but trusted less.
    const confidence = bad ? 'low' : AI_MAX_CONFIDENCE;
    out.facts.push({ key: 'ai_summary', fact: aiFact({ summary: clipSummary(item.summary) }, verified.join(' | ').slice(0, 1000), ctx, confidence) });
  }
  if (bad) out.rejected += bad;

  const flags = new Set<string>();
  for (const f of item.red_flags) {
    const p = quoteProblem(f.quote, ctx);
    if (p) {
      reject(out, `red_flag:${p}`);
      continue;
    }
    if (looksLikeInjection(f.flag)) {
      reject(out, 'red_flag:injection');
      continue;
    }
    const flag = f.flag.replace(/\s+/g, ' ').trim().slice(0, 200);
    if (flags.has(flag.toLowerCase())) continue;
    flags.add(flag.toLowerCase());
    const quote = displayQuote(f.quote, 200);
    out.facts.push({ key: 'red_flags', fact: aiFact({ flag, quote }, quote, ctx) });
  }
  return out;
}

// ---- suspicious_check --------------------------------------------------------------------------

export function mapSuspicious(item: SuspiciousCheckItem, ctx: MapContext): MappedAnswer {
  const out = emptyAnswer('suspicious_check', ['suspicious']);
  if (!item.suspicious) return out;
  const reasons: string[] = [];
  const quotes: string[] = [];
  for (const r of item.reasons) {
    const p = quoteProblem(r.quote, ctx);
    if (p) {
      reject(out, `suspicious:${p}`);
      continue;
    }
    if (looksLikeInjection(r.reason)) {
      reject(out, 'suspicious:injection');
      continue;
    }
    reasons.push(r.reason.replace(/\s+/g, ' ').trim().slice(0, 200));
    quotes.push(displayQuote(r.quote, 200));
  }
  if (!reasons.length) {
    reject(out, 'suspicious:no_verified_reason');
    return out;
  }
  out.suspicious = true;
  // An AI suspicion is a prompt for a human, not a verdict: low confidence, needs_review.
  out.facts.push({ key: 'suspicious', fact: aiFact({ suspicious: true, reasons }, quotes.join(' | ').slice(0, 1000), ctx, 'low') });
  return out;
}

export function mapTaskItem(task: CanonicalAiTask, item: unknown, ctx: MapContext): MappedAnswer {
  switch (task) {
    case 'extract_facts':
      return mapExtractFacts(item as ExtractFactsItem, ctx);
    case 'summary_redflags':
      return mapSummaryRedflags(item as SummaryRedflagsItem, ctx);
    case 'suspicious_check':
      return mapSuspicious(item as SuspiciousCheckItem, ctx);
  }
}

/** The mapped answer as plain facts (visa signals as visa_signal facts) — for the UI path. */
export function mappedToFacts(m: MappedAnswer, ctx: Pick<MapContext, 'source' | 'now' | 'promptVersion'>): MappedFact[] {
  const signals: MappedFact[] = m.visaSignals.map((s) => ({
    key: 'visa_signal',
    fact: { value: s, evidence: s.quote, source: ctx.source, method: 'ai', confidence: s.confidence, checkedAt: ctx.now, logicVersion: ctx.promptVersion },
  }));
  return [...signals, ...m.facts];
}

// ---- conflicts ---------------------------------------------------------------------------------

/** Does this value say something definite (not "unclear"/empty)? */
export function isDefinite(key: FactKey, value: unknown): boolean {
  const o = value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  if (!o) return false;
  switch (key) {
    case 'experience':
      return typeof o.minYears === 'number';
    case 'remote':
      return typeof o.class === 'string' && o.class !== 'unclear';
    case 'language':
      return typeof o.requirement === 'string' && o.requirement !== 'unclear';
    case 'salary':
      return typeof o.min === 'number' || typeof o.annualEurMin === 'number';
    case 'skills':
      return Array.isArray(o.found) && o.found.length > 0;
    default:
      return true;
  }
}

function near(a: unknown, b: unknown, tolerance: number): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return a === b;
  return Math.abs(a - b) <= Math.max(1, Math.abs(b) * tolerance);
}

/** Do an AI value and a higher-trust value really disagree? (Skill lists never "conflict".) */
export function disagrees(key: FactKey, ai: unknown, other: unknown): boolean {
  if (!isDefinite(key, other) || !isDefinite(key, ai)) return false;
  const a = ai as Record<string, unknown>;
  const o = other as Record<string, unknown>;
  switch (key) {
    case 'experience':
      return !near(a.minYears, o.minYears, 0);
    case 'remote':
      return a.class !== o.class;
    case 'language':
      return a.requirement !== o.requirement;
    case 'salary':
      if (typeof a.annualEurMin === 'number' && typeof o.annualEurMin === 'number') return !near(a.annualEurMin, o.annualEurMin, 0.05);
      return !(near(a.min, o.min, 0.01) && String(a.currency) === String(o.currency));
    default:
      return false;
  }
}

const AGAINST_KINDS = new Set(['not_offered', 'right_to_work_required']);

/** AI visa signals that contradict what the posting rules found (offered vs refused). */
export function visaSignalConflict(ai: readonly VisaSignal[], posting: readonly VisaSignal[]): boolean {
  const aiFor = ai.some((s) => s.signal === 'offered');
  const aiAgainst = ai.some((s) => AGAINST_KINDS.has(s.signal));
  const postFor = posting.some((s) => s.signal === 'offered');
  const postAgainst = posting.some((s) => AGAINST_KINDS.has(s.signal) && s.confidence !== 'low');
  return (aiFor && postAgainst && !postFor) || (aiAgainst && postFor && !postAgainst);
}

// ---- storing -----------------------------------------------------------------------------------

export interface StoreOutcome {
  stored: number;
  retracted: number;
  /** Keys where a higher-trust fact disagrees with the AI (job flagged needs_review). */
  conflicts: string[];
  flagged: boolean;
}

/**
 * Stores one job's mapped answer, retracts this source's AI facts the answer no longer backs,
 * re-decides the visa status, flags real conflicts, re-syncs the job columns and re-scores.
 */
export async function storeTaskFacts(
  db: DbOrTx,
  jobId: number,
  mapped: MappedAnswer,
  ctx: Pick<MapContext, 'source' | 'now' | 'promptVersion'>,
): Promise<StoreOutcome> {
  const outcome = await withTransaction(db, async (tx) => {
    const res: StoreOutcome = { stored: 0, retracted: 0, conflicts: [], flagged: false };
    const byKey = new Map<FactKey, MappedFact[]>();
    for (const f of mapped.facts) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);

    if (mapped.task === 'extract_facts') {
      res.stored += await writeVisaSignals(tx, jobId, mapped.visaSignals, { method: 'ai', source: ctx.source, logicVersion: ctx.promptVersion, now: ctx.now });
    }
    for (const key of mapped.ownedKeys) {
      if (key === 'visa_signal') continue;
      const list = byKey.get(key) ?? [];
      // Multi-valued red flags: the new answer replaces the whole set of this source.
      if (key === 'red_flags' || !list.length) res.retracted += await retractFacts(tx, jobId, key, { source: ctx.source, method: 'ai' });
      for (const f of list) if ((await addFact(tx, jobId, f.key, f.fact)).created) res.stored++;
    }

    if (mapped.task === 'extract_facts') await evaluateJobVisa(tx, jobId, { now: ctx.now, sync: false });

    // Conflicts: a higher-trust winner that says something definite and different.
    const resolved = await loadResolvedFacts(tx, jobId);
    for (const f of mapped.facts) {
      if (f.key === 'red_flags' || f.key === 'ai_summary' || f.key === 'suspicious' || f.key === 'skills') continue;
      const winner = resolved[f.key]?.winner as StoredFact | null | undefined;
      if (!winner || winner.method === 'ai' || winner.method === 'estimate') continue;
      if (winner.method === 'manual') continue; // a human already decided
      if (disagrees(f.key, f.fact.value, winner.value)) res.conflicts.push(f.key);
    }
    if (mapped.task === 'extract_facts' && mapped.visaSignals.length) {
      const posting = (await getFacts(tx, jobId, { keys: ['visa_signal'] }))
        .filter((f) => f.method === 'posting')
        .map((f) => parseVisaSignal(f.value))
        .filter((s): s is VisaSignal => s !== null);
      if (visaSignalConflict(mapped.visaSignals, posting)) res.conflicts.push('visa_signal');
    }
    if (res.conflicts.length || mapped.suspicious) {
      const [row] = await tx.select({ needsReview: jobs.needsReview }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
      if (row && !row.needsReview) await tx.update(jobs).set({ needsReview: true }).where(eq(jobs.id, jobId));
      res.flagged = true;
      await audit(tx, {
        action: mapped.suspicious ? 'ai.suspicious' : 'ai.conflict',
        entityType: 'job',
        entityId: jobId,
        before: row ? { needsReview: row.needsReview } : null,
        after: { needsReview: true, conflicts: res.conflicts, suspicious: mapped.suspicious },
        reason: mapped.suspicious
          ? 'The AI check found signs of a scam posting (verified quotes); a person should look.'
          : `A higher-trust fact disagrees with the AI on: ${res.conflicts.join(', ')}. The higher-trust fact is kept.`,
        actor: 'worker',
      });
    }
    await syncResolvedJobColumns(tx, jobId);
    return res;
  });
  try {
    await rescoreJob(db, jobId, { now: ctx.now });
  } catch (err) {
    plog.warn('rescore after AI facts failed', { jobId, error: err instanceof Error ? err.message : String(err) });
  }
  return outcome;
}
