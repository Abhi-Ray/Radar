/**
 * From a validated AI answer to facts: every fact needs a verified quote that supports the value;
 * AI facts are method 'ai', source 'openrouter:<model>', confidence ≤ medium.
 */
import { describe, expect, it } from 'vitest';
import { disagrees, isDefinite, mapExtractFacts, mappedToFacts, mapSummaryRedflags, mapSuspicious, visaSignalConflict, type MapContext } from '../../src/lib/ai/apply';
import { EXTRACT_FACTS_PROMPT_VERSION, extractFactsItemSchema, jobCheckText, type ExtractFactsItem } from '../../src/lib/ai/prompts';
import { DEFAULT_EXPERIENCE_BAND } from '../../src/lib/normalize/experience';

const TEXT = `We are hiring a Cloud Security Engineer in Munich.
We offer visa sponsorship for candidates from outside the EU.
You bring at least 3 years of experience with AWS and Terraform.
Gehalt: 4.500 € brutto pro Monat, 14 Gehälter.
The role is fully remote within the EU only.
Fluent English is required; German is not needed.`;

const checkText = jobCheckText({ id: 'j1', title: 'Cloud Security Engineer', company: 'Acme', location: 'Munich', text: TEXT });
const NOW = new Date('2026-09-30T12:00:00Z');
const ctx: MapContext = {
  checkText,
  fullText: TEXT,
  lang: 'en',
  promptVersion: EXTRACT_FACTS_PROMPT_VERSION,
  source: 'openrouter:test/model',
  now: NOW,
  profile: { experienceBand: DEFAULT_EXPERIENCE_BAND, skills: ['AWS', 'Terraform', 'Kubernetes'] },
  fx: { date: '2026-09-29', rates: { USD: 1.1 } },
};

function item(over: Partial<ExtractFactsItem> = {}): ExtractFactsItem {
  return extractFactsItemSchema.parse({ id: 'j1', ...over });
}

describe('mapExtractFacts', () => {
  it('maps verified facts with provenance', () => {
    const m = mapExtractFacts(
      item({
        visa_signals: [{ signal: 'offered', quote: 'We offer visa sponsorship for candidates from outside the EU' }],
        experience: { min_years: 3, max_years: null, quote: 'at least 3 years of experience with AWS' },
        skills: [
          { name: 'AWS', quote: 'experience with AWS and Terraform' },
          { name: 'Terraform', quote: 'experience with AWS and Terraform' },
        ],
        language: { requirement: 'english_ok', languages: ['EN'], quote: 'Fluent English is required' },
        remote: { class: 'region_limited', regions: ['EU'], quote: 'fully remote within the EU only' },
        salary: { min: 4500, max: null, currency: 'EUR', period: 'month', quote: 'Gehalt: 4.500 € brutto pro Monat' },
      }),
      ctx,
    );
    expect(m.rejected).toBe(0);
    expect(m.visaSignals).toEqual([
      { signal: 'offered', quote: 'We offer visa sponsorship for candidates from outside the EU', lang: 'en', ruleId: `ai:${EXTRACT_FACTS_PROMPT_VERSION}`, confidence: 'medium' },
    ]);
    const byKey = Object.fromEntries(m.facts.map((f) => [f.key, f.fact]));
    expect(byKey.experience.value).toEqual({ minYears: 3, maxYears: null, band: 'core', securityStrict: false });
    expect(byKey.skills.value).toEqual({ matched: ['AWS', 'Terraform'], found: ['AWS', 'Terraform'] });
    expect(byKey.language.value).toEqual({ postingLang: 'en', requirement: 'english_ok', languages: ['en'] });
    expect(byKey.remote.value).toEqual({ class: 'region_limited', regions: ['EU'] });
    // 14 installments stated elsewhere in the posting: 4500 × 14.
    expect(byKey.salary.value).toMatchObject({ min: 4500, currency: 'EUR', period: 'month', installments: 14, annualEurMin: 63000, kind: 'stated' });
    for (const f of m.facts) {
      expect(f.fact.method).toBe('ai');
      expect(f.fact.source).toBe('openrouter:test/model');
      expect(f.fact.logicVersion).toBe(EXTRACT_FACTS_PROMPT_VERSION);
      expect(['medium', 'low']).toContain(f.fact.confidence);
      expect(f.fact.evidence).toBeTruthy();
    }
    expect(mappedToFacts(m, ctx).filter((f) => f.key === 'visa_signal')).toHaveLength(1);
  });

  it('drops facts whose quote is not in the posting (hallucination)', () => {
    const m = mapExtractFacts(
      item({
        visa_signals: [{ signal: 'offered', quote: 'We sponsor H-1B and Blue Card visas' }],
        remote: { class: 'worldwide', regions: [], quote: 'Work from anywhere in the world' },
      }),
      ctx,
    );
    expect(m.visaSignals).toEqual([]);
    expect(m.facts).toEqual([]);
    expect(m.rejected).toBe(2);
    expect(m.rejections).toEqual(['visa_signal:not_found', 'remote:not_found']);
  });

  it('drops values the quote does not support', () => {
    const m = mapExtractFacts(
      item({
        experience: { min_years: 5, max_years: null, quote: 'at least 3 years of experience with AWS' },
        skills: [{ name: 'Kubernetes', quote: 'experience with AWS and Terraform' }],
        salary: { min: 5500, max: null, currency: 'EUR', period: 'month', quote: 'Gehalt: 4.500 € brutto pro Monat' },
      }),
      ctx,
    );
    expect(m.facts).toEqual([]);
    expect(m.rejections).toEqual(['experience:years_not_in_quote', 'skill:name_not_in_quote', 'salary:amount_not_in_quote']);
  });

  it('drops implausible salaries and unknown currencies', () => {
    const text = `${TEXT}\nBudget: 12 EUR per year for coffee. Pay: 90000 XYZ per year.`;
    const c = { ...ctx, checkText: `${checkText}\nBudget: 12 EUR per year for coffee. Pay: 90000 XYZ per year.`, fullText: text };
    expect(mapExtractFacts(item({ salary: { min: 12, max: null, currency: 'EUR', period: 'year', quote: 'Budget: 12 EUR per year for coffee' } }), c).rejections).toEqual(['salary:implausible']);
    expect(mapExtractFacts(item({ salary: { min: 90000, max: null, currency: 'XYZ', period: 'year', quote: 'Pay: 90000 XYZ per year' } }), c).rejections).toEqual(['salary:no_fx_rate']);
  });

  it('"unclear" language / remote adds nothing', () => {
    const m = mapExtractFacts(item({ language: { requirement: 'unclear', languages: [], quote: 'Fluent English is required' }, remote: { class: 'unclear', regions: [], quote: 'fully remote within the EU only' } }), ctx);
    expect(m.facts).toEqual([]);
    expect(m.rejected).toBe(0);
  });
});

describe('summary / red flags / suspicious', () => {
  it('a summary needs at least one verified quote', () => {
    const ok = mapSummaryRedflags({ id: 'j1', summary: 'Remote EU cloud security role with visa sponsorship.', summary_quotes: ['We offer visa sponsorship'], red_flags: [] }, ctx);
    expect(ok.facts).toHaveLength(1);
    expect(ok.facts[0]).toMatchObject({ key: 'ai_summary', fact: { value: { summary: 'Remote EU cloud security role with visa sponsorship.' }, confidence: 'medium' } });
    const bad = mapSummaryRedflags({ id: 'j1', summary: 'Great job at Google with free lunch every day.', summary_quotes: ['Google offers free lunch'], red_flags: [] }, ctx);
    expect(bad.facts).toEqual([]);
    expect(bad.rejections).toContain('summary:no_verified_quote');
  });

  it('red flags keep their quote; unverified ones are dropped', () => {
    const m = mapSummaryRedflags(
      {
        id: 'j1',
        summary: 'Cloud security role in Munich with AWS focus.',
        summary_quotes: ['Cloud Security Engineer in Munich'],
        red_flags: [
          { flag: 'Remote only inside the EU', quote: 'fully remote within the EU only' },
          { flag: 'Unpaid trial week', quote: 'You will complete an unpaid trial week' },
        ],
      },
      ctx,
    );
    const flags = m.facts.filter((f) => f.key === 'red_flags');
    expect(flags).toHaveLength(1);
    expect(flags[0].fact.value).toEqual({ flag: 'Remote only inside the EU', quote: 'fully remote within the EU only' });
    expect(m.rejections).toContain('red_flag:not_found');
  });

  it('suspicious only with a verified reason, and then at low confidence', () => {
    const c = { ...ctx, checkText: `${checkText}\nContact us on WhatsApp and pay a 50 EUR registration fee.` };
    const yes = mapSuspicious({ id: 'j1', suspicious: true, reasons: [{ reason: 'Asks for a fee', quote: 'pay a 50 EUR registration fee' }] }, c);
    expect(yes.suspicious).toBe(true);
    expect(yes.facts[0]).toMatchObject({ key: 'suspicious', fact: { value: { suspicious: true, reasons: ['Asks for a fee'] }, confidence: 'low' } });
    const noQuote = mapSuspicious({ id: 'j1', suspicious: true, reasons: [{ reason: 'Feels fake', quote: 'this is a scam' }] }, c);
    expect(noQuote.suspicious).toBe(false);
    expect(noQuote.facts).toEqual([]);
    expect(mapSuspicious({ id: 'j1', suspicious: false, reasons: [] }, c).facts).toEqual([]);
  });
});

describe('conflict rules', () => {
  it('"unclear"/empty never conflicts; definite different values do', () => {
    expect(isDefinite('remote', { class: 'unclear', regions: [] })).toBe(false);
    expect(disagrees('remote', { class: 'worldwide' }, { class: 'unclear' })).toBe(false);
    expect(disagrees('remote', { class: 'worldwide' }, { class: 'region_limited' })).toBe(true);
    expect(disagrees('experience', { minYears: 3 }, { minYears: null })).toBe(false);
    expect(disagrees('experience', { minYears: 3, maxYears: 5 }, { minYears: 3, maxYears: null })).toBe(false);
    expect(disagrees('experience', { minYears: 3 }, { minYears: 5 })).toBe(true);
    expect(disagrees('salary', { min: 60000, annualEurMin: 60000 }, { min: 61000, annualEurMin: 61000 })).toBe(false);
    expect(disagrees('salary', { min: 60000, annualEurMin: 60000 }, { min: 80000, annualEurMin: 80000 })).toBe(true);
    expect(disagrees('skills', { found: ['AWS'] }, { found: ['GCP'] })).toBe(false);
  });

  it('visa: AI "offered" against a posting refusal is a conflict', () => {
    const s = (signal: 'offered' | 'not_offered' | 'relocation' | 'right_to_work_required', confidence: 'high' | 'medium' | 'low' = 'high') => ({ signal, quote: 'q', lang: 'en', ruleId: 'r', confidence });
    expect(visaSignalConflict([s('offered')], [s('not_offered')])).toBe(true);
    expect(visaSignalConflict([s('not_offered')], [s('offered')])).toBe(true);
    expect(visaSignalConflict([s('offered')], [s('offered')])).toBe(false);
    expect(visaSignalConflict([s('offered')], [])).toBe(false);
    // The posting already says both: the visa engine reports "conflicting" itself.
    expect(visaSignalConflict([s('offered')], [s('offered'), s('not_offered')])).toBe(false);
  });
});
