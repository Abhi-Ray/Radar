/**
 * Posting-text visa signals (spec §13.3): multilingual phrases, negation, contrast clauses,
 * application-form questions and exact-substring quotes.
 */
import { describe, expect, it } from 'vitest';
import type { VisaSignalKind } from '../../src/lib/contracts/jobs';
import { VISA_PHRASE_RULES, VISA_SIGNAL_LANGS } from '../../src/data/visa/phrases';
import {
  compilePatternSource,
  detectVisaSignals,
  splitSentences,
  VISA_SIGNALS_LOGIC_VERSION,
  visaRuleStats,
} from '../../src/lib/visa/signals';

type Expect = VisaSignalKind[];

interface Case {
  text: string;
  expect: Expect;
  lang?: string;
  confidence?: 'high' | 'medium' | 'low';
}

const O: VisaSignalKind = 'offered';
const N: VisaSignalKind = 'not_offered';
const R: VisaSignalKind = 'relocation';
const W: VisaSignalKind = 'right_to_work_required';

const CASES: Case[] = [
  // ── English: offers ──
  { text: 'Visa sponsorship available.', expect: [O], lang: 'en', confidence: 'high' },
  { text: 'We sponsor visas for the right candidates.', expect: [O], lang: 'en', confidence: 'high' },
  { text: 'Benefits: Blue Card support, gym membership.', expect: [O], lang: 'en' },
  { text: 'We offer visa sponsorship and a relocation package.', expect: [O, R], lang: 'en' },
  { text: 'We are a licensed sponsor with the Home Office.', expect: [O], lang: 'en' },
  { text: 'Candidates who require visa sponsorship are welcome to apply.', expect: [O], lang: 'en' },
  { text: 'We will help you with the visa process.', expect: [O], lang: 'en' },
  { text: '• Visa and relocation support', expect: [O, R], lang: 'en' },
  { text: 'Skilled Worker visa sponsorship is available for this role.', expect: [O], lang: 'en', confidence: 'high' },
  { text: 'No relocation, but visa sponsorship is available.', expect: [O], lang: 'en' },
  { text: "While we can't offer relocation, we do sponsor visas.", expect: [O], lang: 'en' },
  { text: 'No agencies please; visa sponsorship available.', expect: [O], lang: 'en' },
  { text: 'We sponsor visas no matter where you are from.', expect: [O], lang: 'en' },
  { text: 'Visa sponsorship may be available for exceptional candidates.', expect: [O], lang: 'en', confidence: 'low' },
  { text: 'Visa-Sponsoring nach Absprache.', expect: [O], lang: 'de', confidence: 'low' },
  { text: 'Candidates who require sponsorship may still apply.', expect: [O], lang: 'en', confidence: 'high' },
  // ── English: refusals ──
  { text: 'No visa sponsorship.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'Unfortunately we are unable to sponsor at this time.', expect: [N], lang: 'en' },
  { text: 'We do not sponsor visas.', expect: [N], lang: 'en' },
  { text: 'Sponsorship is not available for this role.', expect: [N], lang: 'en' },
  { text: "We can't offer relocation or visa sponsorship.", expect: [N], lang: 'en' },
  { text: 'We don’t offer relocation, visa sponsorship or remote work.', expect: [N], lang: 'en' },
  { text: 'This position is not eligible for visa sponsorship.', expect: [N], lang: 'en' },
  { text: 'Candidates requiring visa sponsorship will not be considered.', expect: [N], lang: 'en' },
  { text: 'We are unable to consider candidates who require sponsorship.', expect: [N], lang: 'en' },
  { text: 'Neither relocation nor visa support is available.', expect: [N], lang: 'en' },
  { text: 'Relocation assistance is not provided.', expect: [], lang: 'en' },
  { text: 'Visa sponsorship: No', expect: [N], lang: 'en' },
  { text: 'Visa sponsorship: Yes', expect: [O], lang: 'en' },
  { text: 'Relocation: yes', expect: [R], lang: 'en' },
  { text: 'Relocation: no', expect: [], lang: 'en' },
  // ── English: right to work ──
  { text: 'Candidates must already have the right to work in the UK.', expect: [W], lang: 'en', confidence: 'high' },
  { text: 'EU citizens only.', expect: [W], lang: 'en' },
  { text: 'US citizens or green card holders only.', expect: [W], lang: 'en' },
  { text: 'You must be able to work in the UK without visa sponsorship.', expect: [W], lang: 'en' },
  { text: 'Applicants must be authorized to work in the U.S. for any employer.', expect: [W], lang: 'en' },
  { text: 'A valid work permit is required.', expect: [W], lang: 'en' },
  { text: 'Only applicants with the right to work in Ireland will be considered.', expect: [W], lang: 'en' },
  {
    text: 'If you do not have the right to work in the UK, unfortunately we cannot consider your application.',
    expect: [W],
    lang: 'en',
  },
  { text: 'No work permit required for EU nationals.', expect: [], lang: 'en' },
  { text: 'If you are eligible to work in the UK, apply now.', expect: [], lang: 'en' },
  // ── English: application forms and neutral mentions ──
  { text: 'Will you now or in the future require sponsorship?', expect: [W], confidence: 'low' },
  { text: 'Are you legally authorized to work in the United States?', expect: [W], confidence: 'low' },
  { text: 'Do you require visa sponsorship?', expect: [W], confidence: 'low' },
  { text: 'Do you need relocation support?', expect: [] },
  { text: 'If you require visa sponsorship, please mention it in your application.', expect: [] },
  { text: 'We are a fast-growing fintech with offices in London and Berlin.', expect: [] },
  { text: 'We help you move fast and learn quickly.', expect: [] },
  // ── German ──
  { text: 'Wir bieten Unterstützung beim Visum und beim Umzug.', expect: [O, R], lang: 'de' },
  { text: 'Leider kein Visa-Sponsoring.', expect: [N], lang: 'de', confidence: 'high' },
  { text: 'Ein Visa-Sponsoring ist leider nicht möglich.', expect: [N], lang: 'de' },
  { text: 'Arbeitserlaubnis erforderlich.', expect: [W], lang: 'de' },
  { text: 'Eine gültige Arbeitserlaubnis für Deutschland ist zwingend erforderlich.', expect: [W], lang: 'de' },
  { text: 'Nur EU-Bürger.', expect: [W], lang: 'de' },
  { text: 'Wir übernehmen dein Visum und zahlen eine Umzugspauschale.', expect: [O, R], lang: 'de' },
  { text: 'Benötigen Sie ein Visum oder eine Arbeitserlaubnis?', expect: [W], confidence: 'low' },
  { text: 'Blue-Card-Unterstützung inklusive.', expect: [O], lang: 'de' },
  { text: 'Wir sind nicht nur ein Arbeitgeber: Relocation-Paket inklusive.', expect: [R], lang: 'de' },
  // ── French ──
  { text: 'Pas de sponsoring de visa.', expect: [N], lang: 'fr' },
  { text: 'Nous ne pouvons pas sponsoriser de visa pour ce poste.', expect: [N], lang: 'fr' },
  { text: "Accompagnement dans les démarches de visa et aide au déménagement.", expect: [O, R], lang: 'fr' },
  { text: 'Autorisation de travail en France requise.', expect: [W], lang: 'fr' },
  { text: 'Avez-vous besoin d’un visa pour travailler en France ?', expect: [W], confidence: 'low' },
  // ── Dutch ──
  { text: 'Geen sponsoring mogelijk.', expect: [N], lang: 'nl' },
  { text: 'Wij zijn een erkend referent bij de IND.', expect: [O], lang: 'nl', confidence: 'high' },
  { text: 'Hulp bij je visumaanvraag en een verhuisvergoeding.', expect: [O, R], lang: 'nl' },
  { text: 'Een geldige werkvergunning is vereist.', expect: [W], lang: 'nl' },
  { text: 'Wij kunnen helaas geen visum sponsoren.', expect: [N], lang: 'nl' },
  // ── Spanish ──
  { text: 'No ofrecemos patrocinio de visado.', expect: [N], lang: 'es' },
  { text: 'Ofrecemos patrocinio de visado y paquete de reubicación.', expect: [O, R], lang: 'es' },
  { text: 'Permiso de trabajo en la UE imprescindible.', expect: [W], lang: 'es' },
  // ── Portuguese ──
  { text: 'Não oferecemos patrocínio de visto.', expect: [N], lang: 'pt' },
  { text: 'Apoio com o visto e pacote de relocalização.', expect: [O, R], lang: 'pt' },
  // ── Italian ──
  { text: 'Non offriamo la sponsorizzazione del visto.', expect: [N], lang: 'it' },
  { text: 'Supporto per il visto e pacchetto di relocation.', expect: [O, R], lang: 'it' },
  { text: 'Permesso di lavoro obbligatorio.', expect: [W], lang: 'it' },
  // ── Swedish / Danish / Norwegian ──
  { text: 'Vi erbjuder tyvärr inte visumsponsring.', expect: [N], lang: 'sv' },
  { text: 'Vi hjälper dig med visum och arbetstillstånd.', expect: [O], lang: 'sv' },
  { text: 'Vi tilbyder desværre ikke visumsponsorat.', expect: [N], lang: 'da' },
  { text: 'Vi tilbyr flyttehjelp og hjelp med arbeidstillatelse.', expect: [O, R], lang: 'no' },
  // ── Finnish / Polish / Czech ──
  { text: 'Emme valitettavasti tarjoa viisumisponsorointia.', expect: [N], lang: 'fi' },
  { text: 'Autamme työluvan hakemisessa ja tarjoamme muuttoapua.', expect: [O, R], lang: 'fi' },
  { text: 'Nie oferujemy sponsorowania wizy.', expect: [N], lang: 'pl' },
  { text: 'Oferujemy pomoc w uzyskaniu wizy oraz pakiet relokacyjny.', expect: [O, R], lang: 'pl' },
  { text: 'Nenabízíme sponzorování víz.', expect: [N], lang: 'cs' },
  { text: 'Pomůžeme vám s vízem a nabízíme relokační balíček.', expect: [O, R], lang: 'cs' },
  // ── Audit regressions: refusals written after the noun ("X is something we cannot offer") ──
  { text: 'Visa sponsorship is something we cannot offer.', expect: [N], lang: 'en' },
  { text: 'Visa sponsorship - we’re unable to offer this.', expect: [N], lang: 'en' },
  { text: 'Visa sponsorship: we do not offer it.', expect: [N], lang: 'en' },
  { text: 'Visa sponsorship (not available)', expect: [N], lang: 'en' },
  { text: 'Visa sponsorship is out of scope for this role.', expect: [N], lang: 'en' },
  { text: 'Visa sponsorship and relocation are not available for this position.', expect: [N], lang: 'en' },
  { text: 'Relocation package: not included. Visa sponsorship: not included.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'Ein Visa-Sponsoring können wir leider nicht anbieten.', expect: [N], lang: 'de' },
  { text: 'Visa-Sponsoring bieten wir nicht an.', expect: [N], lang: 'de' },
  // ── Audit regressions: English refusals that were missed ──
  { text: 'We are not currently sponsoring visas.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'We are not offering sponsorship.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'We do not currently provide sponsorship.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'We never sponsor visas.', expect: [N], lang: 'en', confidence: 'high' },
  { text: "Sponsorship isn't available.", expect: [N], lang: 'en', confidence: 'high' },
  { text: 'Sponsorship of visas is not possible for this role.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'This role is ineligible for sponsorship.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'This position does not qualify for visa sponsorship.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'We are not a licensed sponsor.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'We do not hold a sponsor licence.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'Please do not apply if you require sponsorship.', expect: [N], lang: 'en', confidence: 'high' },
  { text: 'No H-1B transfers.', expect: [N], lang: 'en' },
  // ── Audit regressions: right to work ──
  { text: 'Please only apply if you have the right to work in the UK.', expect: [W], lang: 'en', confidence: 'high' },
  { text: 'You will need the right to work in Germany.', expect: [W], lang: 'en', confidence: 'high' },
  { text: 'US citizenship is required.', expect: [W], lang: 'en', confidence: 'high' },
  { text: 'No citizenship required.', expect: [] },
  { text: 'Must hold a valid UK work visa.', expect: [W], lang: 'en', confidence: 'high' },
  // ── Audit regressions: need statements are not refusals ──
  { text: 'Visa sponsorship is not required for EU citizens.', expect: [] },
  { text: 'No visa sponsorship is required for EU citizens.', expect: [] },
  { text: 'Visa sponsorship is not needed if you are an EU citizen.', expect: [] },
  { text: 'Visa sponsorship will never be an issue.', expect: [O], lang: 'en', confidence: 'low' },
  // ── Audit regressions: job duties and product talk are not offers ──
  { text: 'You will manage visa sponsorship processes for our employees.', expect: [] },
  { text: 'Experience with immigration support is a plus.', expect: [] },
  { text: 'Responsibilities: coordinate visa sponsorship and relocation for new hires.', expect: [] },
  { text: 'Knowledge of work permit sponsorship rules in the UK.', expect: [] },
  { text: 'We are an HR tech company automating visa sponsorship for employers.', expect: [] },
  { text: 'Our product helps companies with immigration support.', expect: [] },
  { text: 'Du bist verantwortlich für die Visa-Unterstützung unserer Mitarbeitenden.', expect: [] },
  { text: 'Responsibilities:\n- Visa sponsorship for new hires\n- Payroll', expect: [] },
  // ── Audit regressions: bare mentions keep confidence only in a benefit context ──
  { text: 'Benefits: Visa sponsorship, 30 days holiday', expect: [O], lang: 'en', confidence: 'medium' },
  { text: 'Benefits:\n• Visa sponsorship\n• 30 days holiday', expect: [O], lang: 'en', confidence: 'medium' },
  { text: 'What we offer: relocation package, visa support', expect: [O, R], lang: 'en' },
  { text: 'We offer a great salary, visa sponsorship and a gym.', expect: [O], lang: 'en', confidence: 'medium' },
  { text: "You'll get visa sponsorship.", expect: [O], lang: 'en', confidence: 'medium' },
  { text: 'Visa-Unterstützung inklusive.', expect: [O], lang: 'de', confidence: 'medium' },
  { text: 'Wir bieten: Visa-Unterstützung, Umzugshilfe', expect: [O, R], lang: 'de' },
  { text: 'visa sponsorship', expect: [O], lang: 'en', confidence: 'low' },
  { text: '• Visa sponsorship', expect: [O], lang: 'en', confidence: 'low' },
  { text: 'This role offers visa sponsorship.', expect: [O], lang: 'en', confidence: 'high' },
  { text: 'Please note: this role does not include visa sponsorship.', expect: [N], lang: 'en' },
  { text: 'We welcome applicants who need visa sponsorship.', expect: [O], lang: 'en', confidence: 'high' },
];

function kinds(text: string): VisaSignalKind[] {
  return [...new Set(detectVisaSignals(text).map((s) => s.signal))].sort();
}

describe('detectVisaSignals: phrase table', () => {
  it('has a version and many cases', () => {
    expect(VISA_SIGNALS_LOGIC_VERSION).toMatch(/^visa-signals@\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(CASES.length).toBeGreaterThanOrEqual(60);
    const langs = new Set(CASES.map((c) => c.lang).filter(Boolean));
    expect(langs.size).toBeGreaterThanOrEqual(8);
  });

  it.each(CASES.map((c) => [c.text, c] as const))('%s', (_label, c) => {
    const signals = detectVisaSignals(c.text);
    expect(kinds(c.text)).toEqual([...c.expect].sort());
    for (const s of signals) {
      expect(c.text.includes(s.quote)).toBe(true);
      expect(s.quote.length).toBeGreaterThan(0);
      expect(s.ruleId).toBeTruthy();
      if (c.lang && c.expect.length) expect(s.lang).toBe(c.lang);
    }
    if (c.confidence) for (const s of signals) expect(s.confidence).toBe(c.confidence);
  });

  it('every rule compiles and ids are unique', () => {
    const ids = new Set<string>();
    for (const r of VISA_PHRASE_RULES) {
      expect(() => new RegExp(compilePatternSource(r.pattern), 'u')).not.toThrow();
      expect(ids.has(r.id)).toBe(false);
      ids.add(r.id);
    }
    const stats = visaRuleStats();
    for (const lang of VISA_SIGNAL_LANGS) expect(stats[lang]).toBeGreaterThan(0);
  });
});

describe('detectVisaSignals: behaviour', () => {
  it('application-form questions give at most a low-confidence right-to-work signal', () => {
    const texts = [
      'Will you now or in the future require sponsorship for employment visa status?',
      'Do you have the right to work in the UK?',
      'Looking for visa sponsorship?',
      'Heeft u een werkvergunning voor Nederland?',
      'Czy potrzebujesz wizy do pracy w Polsce?',
    ];
    for (const t of texts) {
      const s = detectVisaSignals(t);
      expect(s.length).toBeGreaterThan(0);
      for (const x of s) {
        expect(x.signal).toBe('right_to_work_required');
        expect(x.confidence).toBe('low');
      }
    }
  });

  it('quotes are exact substrings of the original text even with folding (ß, ø, curly quotes)', () => {
    const text = 'Straße 5, Köln.\n\n  •  Wir bieten Unterstützung beim Visum!  \nWe don’t offer relocation – sorry.';
    const s = detectVisaSignals(text);
    expect(s.map((x) => x.signal)).toContain('offered');
    for (const x of s) expect(text.includes(x.quote)).toBe(true);
    const offered = s.find((x) => x.signal === 'offered');
    expect(offered?.quote).toBe('Wir bieten Unterstützung beim Visum!');
  });

  it('long sentences are cut to a window around the hit, still an exact substring', () => {
    const filler = 'We build distributed systems for logistics customers across many markets and teams '.repeat(6);
    const text = `${filler}and visa sponsorship is available for this role ${filler}`;
    const [s] = detectVisaSignals(text);
    expect(s.signal).toBe('offered');
    expect(s.quote.length).toBeLessThanOrEqual(260);
    expect(text.includes(s.quote)).toBe(true);
    expect(s.quote).toContain('visa sponsorship is available');
  });

  it('mixed postings keep both sides, ordered by position', () => {
    const text = 'Relocation package included.\nUnfortunately we cannot sponsor visas.\nWe are a licensed sponsor.';
    const s = detectVisaSignals(text);
    expect(s.map((x) => x.signal)).toEqual(['relocation', 'not_offered', 'offered']);
  });

  it('deduplicates identical signal and quote', () => {
    const text = 'Visa sponsorship available. Visa sponsorship available.';
    const s = detectVisaSignals(text);
    expect(s).toHaveLength(1);
  });

  it('empty and whitespace input give no signals', () => {
    expect(detectVisaSignals('')).toEqual([]);
    expect(detectVisaSignals('   \n  ')).toEqual([]);
  });

  it('does not split sentences at abbreviations like U.S. or e.g.', () => {
    const folded = 'must be authorized to work in the u.s. without sponsorship. we offer e.g. gym.';
    const spans = splitSentences(folded).map((s) => folded.slice(s.start, s.end).trim());
    expect(spans[0]).toBe('must be authorized to work in the u.s. without sponsorship.');
  });

  it('"without" turns an offer mention into a right-to-work requirement, not a refusal', () => {
    const s = detectVisaSignals('This role is open to people who can work without visa sponsorship.');
    expect(s.map((x) => x.signal)).toEqual(['right_to_work_required']);
  });

  it('a bare mention is never a firm offer outside a benefit context', () => {
    const texts = [
      'visa sponsorship',
      'Visa sponsorship is something we are proud to offer.',
      'About us: we care about visa sponsorship.',
    ];
    for (const t of texts) {
      for (const s of detectVisaSignals(t)) {
        if (s.signal === 'offered') {
          expect(s.confidence).toBe('low');
          expect(s.ruleId).toMatch(/#mention$/);
        }
      }
    }
  });

  it('a section heading carries over to its short list items only', () => {
    const text = [
      'Benefits:',
      '- Visa sponsorship',
      'About the company:',
      '- Visa sponsorship',
    ].join('\n');
    const s = detectVisaSignals(text);
    // Same quote twice: dedup keeps the highest confidence (the benefit item).
    expect(s).toHaveLength(1);
    expect(s[0].confidence).toBe('medium');
    const later = detectVisaSignals('About the company:\n- Visa sponsorship');
    expect(later[0].confidence).toBe('low');
  });

  it('the German Visa-Unterstützung rule does not fire on English "visa support"', () => {
    const s = detectVisaSignals('What we offer: relocation package, visa support');
    expect(s.find((x) => x.signal === 'offered')?.ruleId).toBe('en.offer.bare_visa_support');
  });

  it('"non-EU" is not a negation', () => {
    const s = detectVisaSignals('Non-EU applicants: visa sponsorship available.');
    expect(s.map((x) => x.signal)).toEqual(['offered']);
  });
});
