import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXPERIENCE_BAND,
  EXPERIENCE_LOGIC_VERSION,
  experienceBandFor,
  extractExperience,
  findExperienceMentions,
  TITLE_SENIORITY_YEARS,
  type ExperienceBandSettings,
} from '@/lib/normalize/experience';

type Row = [text: string, min: number | null, max: number | null];

/** Numeric requirement phrases per language: [text, minYears, maxYears]. */
const NUMERIC: Record<string, Row[]> = {
  en: [
    ['You have 3+ years of experience in cloud engineering.', 3, null],
    ['3 + years of professional experience', 3, null],
    ['At least 4 years of experience with AWS', 4, null],
    ['Minimum of 2 years of hands-on experience', 2, null],
    ['Min. 3 years experience in DevOps', 3, null],
    ['2-4 years of relevant experience', 2, 4],
    ['2 – 4 years of experience', 2, 4],
    ['2 to 4 years of experience with Terraform', 2, 4],
    ['between 3 and 5 years of experience', 3, 5],
    ['3–5 yrs of experience', 3, 5],
    ['experience: 2-3 yrs', 2, 3],
    ['5 years experience required', 5, null],
    ['More than 3 years of experience in Kubernetes', 3, null],
    ['Over 5 years of experience building APIs', 5, null],
    ['Two years of experience with Python', 2, null],
    ['one to three years of experience', 1, 3],
    ['three (3) years of experience', 3, null],
    ['A year of experience with React', 1, null],
    ['Up to 2 years of experience', 0, 2],
    ['Less than 2 years of experience is fine', 0, 2],
    ['3 years or more of experience in software development', 3, null],
    ["Minimum 2 years' experience in a DevSecOps role", 2, null],
    ['Minimum 2 years’ experience in a DevSecOps role', 2, null],
    ['2+ yrs exp in AppSec', 2, null],
    ['4+ YoE with Go', 4, null],
    ['18 months of experience with AWS', 1.5, null],
    ['6-12 months of experience in a similar role', 0.5, 1],
    ['1.5 years of experience in cloud', 1.5, null],
    ['2,5 years of experience in cloud', 2.5, null],
    ['Experience: 10+ years', 10, null],
    ['Experience: 3 years minimum', 3, null],
    ['2 or 3 years of experience in consulting', 2, 3],
  ],
  de: [
    ['Mindestens 3 Jahre Berufserfahrung in der Softwareentwicklung', 3, null],
    ['mind. 2 Jahre Erfahrung mit AWS', 2, null],
    ['min. 3 J. Erfahrung', 3, null],
    ['2–4 Jahre Erfahrung mit Kubernetes', 2, 4],
    ['Du hast 2 bis 4 Jahre Erfahrung im Bereich DevOps', 2, 4],
    ['zwischen 3 und 5 Jahren Berufserfahrung', 3, 5],
    ['Mehr als 5 Jahre Erfahrung als Cloud Engineer', 5, null],
    ['über 3 Jahre Praxis in der Administration', 3, null],
    ['3-jährige Berufserfahrung', 3, null],
    ['Eine dreijährige Berufserfahrung im Cloud-Umfeld', 3, null],
    ['Du bringst mindestens drei Jahre Erfahrung mit', 3, null],
    ['Mindestens zwei Jahre Erfahrung in der Entwicklung', 2, null],
    ['Erfahrung: 3+ Jahre', 3, null],
    ['Ein Jahr Erfahrung mit Terraform', 1, null],
    ['2 Jahre Berufserfahrung oder mehr', 2, null],
  ],
  fr: [
    ["Au moins 3 ans d'expérience en développement", 3, null],
    ["Vous avez 3 ans d'expérience minimum.", 3, null],
    ["5 à 7 ans d'expérience", 5, 7],
    ["De 2 à 4 ans d'expérience sur AWS", 2, 4],
    ["Plus de 3 ans d'expérience en tant que DevOps", 3, null],
    ["Une première expérience de 2 ans minimum", 2, null],
    ["Deux années d'expérience en cybersécurité", 2, null],
    ["Minimum 3 années d'expérience", 3, null],
    ["Expérience de 3 ans ou plus", 3, null],
  ],
  nl: [
    ['Minimaal 4 jaar werkervaring als DevOps engineer', 4, null],
    ['Ervaring: 3 tot 5 jaar', 3, 5],
    ['Je hebt minstens 2 jaar ervaring met Azure', 2, null],
    ['Meer dan 5 jaar ervaring in IT', 5, null],
    ['Ten minste drie jaar relevante werkervaring', 3, null],
    ['2-3 jaar ervaring', 2, 3],
    ['3 jaar ervaring of meer', 3, null],
  ],
  es: [
    ['De 3 a 5 años de experiencia en AWS', 3, 5],
    ['Al menos 2 años de experiencia', 2, null],
    ['Mínimo 3 años de experiencia en ciberseguridad', 3, null],
    ['Más de 4 años de experiencia como ingeniero', 4, null],
    ['Tienes 2 años de experiencia.', 2, null],
    ['Entre 2 y 4 años de experiencia', 2, 4],
    ['Tres años de experiencia en desarrollo', 3, null],
    ['Experiencia de 3 años o más', 3, null],
  ],
  it: [
    ['Almeno 2 anni di esperienza nel ruolo', 2, null],
    ['Esperienza di almeno 3 anni in ambito cloud', 3, null],
    ['Da 3 a 5 anni di esperienza', 3, 5],
    ['Più di 4 anni di esperienza come sviluppatore', 4, null],
    ['Minimo 2 anni di esperienza', 2, null],
    ['Tre anni di esperienza in ambito DevOps', 3, null],
  ],
  pt: [
    ['Pelo menos 3 anos de experiência', 3, null],
    ['Mínimo de 2 anos de experiência em cloud', 2, null],
    ['Mais de 5 anos de experiência', 5, null],
    ['De 2 a 4 anos de experiência com AWS', 2, 4],
    ['Dois anos de experiência em desenvolvimento', 2, null],
  ],
  pl: [
    ['Co najmniej 3 lata doświadczenia w obszarze IT', 3, null],
    ['Minimum 2 lata doświadczenia komercyjnego', 2, null],
    ['Min. 5 lat doświadczenia jako DevOps', 5, null],
    ['Od 2 do 4 lat doświadczenia', 2, 4],
    ['Powyżej 3 lat doświadczenia w chmurze', 3, null],
    ['3-letnie doświadczenie w programowaniu', 3, null],
    ['Posiadasz 2+ lata doświadczenia', 2, null],
  ],
  sv: [
    ['Minst 3 års erfarenhet av molnplattformar', 3, null],
    ['Du har 2-4 års erfarenhet av DevOps', 2, 4],
    ['Mer än 5 års erfarenhet', 5, null],
    ['Minst två års erfarenhet', 2, null],
    ['3 års erfarenhet eller mer', 3, null],
  ],
  da: [
    ['Mindst 3 års erfaring med cloud', 3, null],
    ['3 år erfaring med sikkerhed', 3, null],
    ['Du har 2-5 års erfaring', 2, 5],
    ['Mere end 4 års erfaring som udvikler', 4, null],
  ],
  no: [
    ['Minst 3 års erfaring fra tilsvarende stilling', 3, null],
    ['Mer enn 5 års erfaring', 5, null],
  ],
  fi: [
    ['Vähintään 3 vuotta kokemusta', 3, null],
    ['Yli 5 vuoden kokemus pilvipalveluista', 5, null],
  ],
};

describe('extractExperience — numeric phrases', () => {
  for (const [lang, rows] of Object.entries(NUMERIC)) {
    describe(lang, () => {
      it.each(rows)('%s', (text, min, max) => {
        const f = extractExperience(text, '');
        expect(f.value.minYears).toBe(min);
        expect(f.value.maxYears).toBe(max);
        expect(f.source).toBe('posting text');
        expect(f.method).toBe('rule');
        expect(f.evidence).toBeTruthy();
        expect(f.logicVersion).toBe(EXPERIENCE_LOGIC_VERSION);
      });
    });
  }
});

/** Vague phrases → low confidence, min 2 ("several") or 5 ("many/long"). */
const VAGUE: Row[] = [
  ['Mehrjährige Berufserfahrung in der Softwareentwicklung', 2, null],
  ['Mehrere Jahre Erfahrung im Cloud-Umfeld', 2, null],
  ['Langjährige Erfahrung in der IT', 5, null],
  ['Several years of experience in cloud', 2, null],
  ['Multiple years of experience with Kubernetes', 2, null],
  ['Many years of experience in software', 5, null],
  ["Plusieurs années d'expérience", 2, null],
  ['Varios años de experiencia', 2, null],
  ['Diversi anni di esperienza', 2, null],
  ['Vários anos de experiência', 2, null],
  ['Meerdere jaren ervaring', 2, null],
  ['Jarenlange ervaring in IT', 5, null],
  ['Flerårig erfarenhet av utveckling', 2, null],
  ['Kilkuletnie doświadczenie w IT', 2, null],
  ['Wieloletnie doświadczenie', 5, null],
];

describe('extractExperience — vague phrases', () => {
  it.each(VAGUE)('%s', (text, min, max) => {
    const f = extractExperience(text, '');
    expect(f.value.minYears).toBe(min);
    expect(f.value.maxYears).toBe(max);
    expect(f.confidence).toBe('low');
  });

  it('ignores vague years without an experience word', () => {
    expect(extractExperience('We have grown for several years.', '').value.minYears).toBeNull();
  });

  it('prefers title seniority over a vague phrase', () => {
    const f = extractExperience('Mehrjährige Erfahrung in DevOps', 'Senior DevOps Engineer');
    expect(f.source).toBe('posting title');
    expect(f.value.minYears).toBe(5);
  });

  it('prefers a numeric amount over a vague phrase', () => {
    const f = extractExperience('Mehrjährige Erfahrung, davon mindestens 3 Jahre mit AWS', '');
    expect(f.value.minYears).toBe(3);
    expect(f.confidence).toBe('high');
  });
});

/** Year amounts that are not about the candidate. */
const EXCLUDED: string[] = [
  'Founded 20 years ago, we are a leading provider.',
  'We are a team of 50 people with 10 years of history.',
  'For over 15 years we have been helping customers.',
  'Wir sind seit über 25 Jahren am Markt.',
  'Nous existons depuis 10 ans.',
  'Hace 5 años que crecemos.',
  'After 2 years you get a sabbatical.',
  'Nach 3 Jahren Betriebszugehörigkeit gibt es einen Bonus.',
  '12-month contract with possible extension.',
  'Initial 2 year contract.',
  'This is a 2 years fixed-term contract.',
  'Bachelor degree (3 years) or equivalent.',
  'A 3 year apprenticeship programme.',
  'Our 2 years graduate programme starts in September.',
  'You must be over 18 years of age.',
  'Applicants must be 18 years or older.',
  'You will join a team with 40 years of combined experience.',
  'The company has 30 years of experience in consulting.',
  'We have 20 years of experience in security.',
  'Our team has been in business for 12 years.',
  'Celebrating 25 years of innovation!',
  '5 years warranty on all products.',
  'Within 2 years you will lead the team.',
  'In the next 3 years we will double our headcount.',
  'Over the last 5 years we grew 10x.',
  'Das Unternehmen wurde vor 30 Jahren gegründet.',
  'Il y a 20 ans, nous avons créé la société.',
  'Every 2 years we offer a new laptop.',
  'Alle 2 Jahre ein neues Notebook.',
  'The project runs for 3 years.',
  'A 2-year program with rotations.',
  'Seit 2005 mit 300 Mitarbeitenden.',
  'Our clients have trusted us for 10 years.',
  '6 months probation period.',
  'Over 10 years in the market.',
  'Welcome to our 3 years anniversary.',
  'Mandate duration: 2 years.',
  'Studium der Informatik (3 Jahre)',
];

describe('extractExperience — non-requirement year amounts are ignored', () => {
  it.each(EXCLUDED)('%s', (text) => {
    const f = extractExperience(text, '');
    expect(f.value.minYears).toBeNull();
    expect(f.value.band).toBe('unknown');
  });

  it('keeps the requirement next to a company-history sentence', () => {
    const f = extractExperience('Founded 20 years ago, we are growing. You bring 2 years of experience.', '');
    expect(f.value.minYears).toBe(2);
    expect(f.evidence).toBe('You bring 2 years of experience.');
  });

  it('keeps the requirement next to a contract length', () => {
    expect(extractExperience('6-month contract, 2 years experience with Azure', '').value.minYears).toBe(2);
    expect(extractExperience('12-month contract. 5 years experience required.', '').value.minYears).toBe(5);
  });

  it('keeps the requirement next to a degree length', () => {
    expect(extractExperience('Bachelor degree (3 years) or equivalent. 2+ years experience with Terraform', '').value.minYears).toBe(2);
  });

  it('skips company sections but reads the requirement section', () => {
    const text = 'About us:\nWe have 20 years of experience in consulting.\nRequirements:\n- 3 years of experience in cloud';
    expect(extractExperience(text, '').value.minYears).toBe(3);
  });

  it('skips benefits sections', () => {
    const text = 'What we offer:\n- 30 days vacation\n- after 5 years a sabbatical\n- 2 years of paid training';
    expect(extractExperience(text, '').value.minYears).toBeNull();
  });

  it('does not treat a bullet word as a section header', () => {
    const text = 'What we offer:\n- Bonus\n- 3 years of guaranteed employment';
    expect(extractExperience(text, '').value.minYears).toBeNull();
  });
});

describe('extractExperience — requirement cues without an experience word', () => {
  it.each<Row>([
    ['Requirements:\n- 3+ years in software development', 3, null],
    ['3+ years as a cloud engineer', 3, null],
    ['At least 2 years working with Kubernetes', 2, null],
    ['Anforderungen:\n- 3 Jahre im Bereich DevOps', 3, null],
  ])('%s', (text, min, max) => {
    const f = extractExperience(text, '');
    expect(f.value.minYears).toBe(min);
    expect(f.value.maxYears).toBe(max);
    expect(f.confidence).toBe('medium');
  });

  it('ignores a bare amount without any cue', () => {
    expect(extractExperience('The platform processes data from 3 years.', '').value.minYears).toBeNull();
  });
});

describe('extractExperience — aggregation', () => {
  it('uses the highest required minimum', () => {
    const text = 'Requirements:\n- 3+ years of software development experience\n- 5+ years of experience with Linux';
    expect(extractExperience(text, '').value.minYears).toBe(5);
  });

  it('treats an "or" amount as an alternative, not a higher bar', () => {
    const f = extractExperience("Bachelor's degree and 3+ years of experience, or 5+ years without a degree.", '');
    expect(f.value.minYears).toBe(3);
  });

  it('keeps "of which" amounts as part of the requirement', () => {
    const f = extractExperience('5+ years of experience in IT, of which 2 years in information security', '');
    expect(f.value.minYears).toBe(5);
    expect(f.value.securityStrict).toBe(true);
  });

  it('uses nice-to-have amounts only when nothing is required, one step lower', () => {
    const f = extractExperience('Nice to have: 5 years of experience with Kubernetes', '');
    expect(f.value.minYears).toBe(5);
    expect(f.confidence).toBe('medium');
  });

  it('keeps the required amount when a higher one is only preferred', () => {
    const f = extractExperience('2-3 Jahre Erfahrung, idealerweise 5 Jahre', '');
    expect(f.value).toMatchObject({ minYears: 2, maxYears: 3 });
    expect(f.confidence).toBe('high');
  });

  it('reads a preferred-section amount as preferred', () => {
    const text = 'Requirements:\n- 2 years of experience with AWS\nNice to have:\n- 6 years of experience in security';
    const f = extractExperience(text, '');
    expect(f.value.minYears).toBe(2);
    expect(f.value.securityStrict).toBe(false);
  });

  it.each([
    ['3 years of experience with Go is a plus', 3],
    ['Ideally 4 years of experience', 4],
    ['Idealmente 3 anni di esperienza', 3],
    ['Mindestens 3 Jahre Erfahrung wünschenswert', 3],
    ["2 ans d'expérience serait un plus", 2],
    ['3 años de experiencia valorable', 3],
    ['2 jaar ervaring is een plus', 2],
    ['3 års erfarenhet är meriterande', 3],
    ['2 lata doświadczenia mile widziane', 2],
  ])('preferred: %s', (text, min) => {
    const f = extractExperience(text, '');
    expect(f.value.minYears).toBe(min);
    expect(f.confidence).toBe('medium');
  });

  it('"ideal candidate" is a requirement, not a preference', () => {
    expect(extractExperience('The ideal candidate has 3-5 years of experience in DevOps.', '').confidence).toBe('high');
  });

  it('a trailing "ideally with …" does not make the amount optional', () => {
    const f = extractExperience('3+ years of experience as a software engineer, ideally with security exposure', '');
    expect(f.confidence).toBe('high');
    expect(f.value.securityStrict).toBe(false);
  });

  it('lowers confidence when required amounts conflict', () => {
    const f = extractExperience('Requirements:\n- 1-2 years of experience with Linux\n- 5+ years of experience with Java', '');
    expect(f.value.minYears).toBe(5);
    expect(f.confidence).toBe('medium');
  });

  it('"no experience required" → 0 years', () => {
    for (const text of [
      'No experience required! We will train you.',
      'No prior experience needed.',
      'Keine Berufserfahrung erforderlich',
      'Sans expérience',
      'Sin experiencia previa',
      'Geen ervaring vereist',
      'Ingen tidigare erfarenhet krävs',
      'Bez doświadczenia',
    ]) {
      const f = extractExperience(text, '');
      expect(f.value, text).toMatchObject({ minYears: 0, maxYears: 0, band: 'hide' });
      expect(f.confidence, text).toBe('medium');
    }
  });

  it('quotes the requirement sentence as evidence', () => {
    const text = 'We build cloud products. You have at least 3 years of experience with AWS. We offer great benefits.';
    expect(extractExperience(text, '').evidence).toBe('You have at least 3 years of experience with AWS.');
  });
});

describe('extractExperience — security-strict', () => {
  it.each([
    ['You have 3+ years of experience in cloud security.', true],
    ['Mindestens 3 Jahre Berufserfahrung in der IT-Sicherheit', true],
    ["Au moins 3 ans d'expérience en sécurité cloud", true],
    ['Mínimo 3 años de experiencia en ciberseguridad', true],
    ['Almeno 3 anni di esperienza nella sicurezza informatica', true],
    ['Pelo menos 3 anos de experiência em segurança da informação', true],
    ['Minimaal 3 jaar ervaring binnen informatiebeveiliging', true],
    ['Co najmniej 3 lata doświadczenia w obszarze bezpieczeństwa', true],
    ['Minst 3 års erfarenhet av informationssäkerhet', true],
    ['Minimum 2 years experience in a DevSecOps role', true],
    ['2+ yrs exp in AppSec', true],
    ['3+ years in penetration testing', true],
    ['IT security experience: 3+ years', true],
    ['Several years of experience in security', true],
    ['Requirements:\n- 3+ years in software development\n- 2 years in information security', true],
    ['3 years of experience with AWS', false],
    ['Erfahrung in der Arbeitssicherheit: 3 Jahre', false],
    ['Security clearance required. 4 years of experience with Java.', false],
    ['3+ years of software engineering experience, with familiarity with security tools', false],
    ['3 years of experience with Java; security knowledge is a plus', false],
    ['Our security team is looking for an engineer with 3+ years of AWS experience', false],
  ])('%s → %s', (text, strict) => {
    expect(extractExperience(text, '').value.securityStrict).toBe(strict);
  });
});

describe('extractExperience — title fallback', () => {
  it.each([
    ['Junior Cloud Engineer', 0, 2, 'show'],
    ['Werkstudent IT-Security', 0, 1, 'hide'],
    ['Cloud Security Intern', 0, 1, 'hide'],
    ['Mid-level Engineer', 2, 4, 'core'],
    ['Senior DevSecOps Engineer', 5, null, 'show'],
    ['Lead Security Engineer', 6, null, 'hide'],
    ['Principal Cloud Architect', 8, null, 'hide'],
    ['Sr. AppSec Engineer (m/w/d)', 5, null, 'show'],
  ] as const)('%s', (title, min, max, band) => {
    const f = extractExperience('We are a great company.', title);
    expect(f.value).toMatchObject({ minYears: min, maxYears: max, band });
    expect(f.confidence).toBe('low');
    expect(f.source).toBe('posting title');
    expect(f.evidence).toBe(title);
  });

  it('matches the documented table', () => {
    expect(TITLE_SENIORITY_YEARS.senior).toEqual({ min: 5, max: null });
    expect(TITLE_SENIORITY_YEARS.entry).toEqual({ min: 0, max: 1 });
  });

  it('reads an experience note in the title at medium confidence', () => {
    const f = extractExperience('', 'Cloud Security Engineer (3-5 years)');
    expect(f.value).toMatchObject({ minYears: 3, maxYears: 5, band: 'core', securityStrict: true });
    expect(f.confidence).toBe('medium');
    expect(f.source).toBe('posting title');
  });

  it('text wins over the title', () => {
    const f = extractExperience('At least 2 years of experience with AWS', 'Senior Cloud Engineer');
    expect(f.value.minYears).toBe(2);
    expect(f.source).toBe('posting text');
  });

  it('returns unknown when nothing is found', () => {
    const f = extractExperience('We are a great company.', 'Cloud Security Engineer');
    expect(f.value).toEqual({ minYears: null, maxYears: null, band: 'unknown', securityStrict: false });
    expect(f.evidence).toBeNull();
    expect(f.confidence).toBe('low');
  });

  it('tolerates empty and non-string input', () => {
    expect(extractExperience('', '').value.band).toBe('unknown');
    expect(extractExperience(undefined as unknown as string, null as unknown as string).value.band).toBe('unknown');
  });
});

describe('experienceBandFor', () => {
  it.each<[number | null, number | null, string]>([
    [null, null, 'unknown'],
    [0, 0, 'hide'],
    [0, 1, 'hide'],
    [0.5, null, 'hide'],
    [0, 2, 'show'],
    [1, null, 'show'],
    [1, 3, 'show'],
    [1.5, null, 'show'],
    [2, null, 'core'],
    [2, 4, 'core'],
    [3, 5, 'core'],
    [4, null, 'core'],
    [4.5, null, 'show'],
    [5, null, 'show'],
    [5, 7, 'show'],
    [5.5, null, 'show'],
    [6, null, 'hide'],
    [8, 10, 'hide'],
    [10, null, 'hide'],
  ])('%s–%s → %s', (min, max, band) => {
    expect(experienceBandFor(min, max)).toBe(band);
  });

  it('uses the settings band', () => {
    const custom: ExperienceBandSettings = { core: [3, 6], show: [2, 8], hideBelow: 2, hideAbove: 9 };
    expect(experienceBandFor(6, null, custom)).toBe('core');
    expect(experienceBandFor(7, null, custom)).toBe('show');
    expect(experienceBandFor(9, null, custom)).toBe('hide');
    expect(experienceBandFor(1, 2, custom)).toBe('hide');
    expect(experienceBandFor(1, 3, custom)).toBe('show');
    expect(extractExperience('At least 6 years of experience', '', custom).value.band).toBe('core');
    expect(extractExperience('At least 6 years of experience', '').value.band).toBe('hide');
  });

  it('default band matches the settings default', () => {
    expect(DEFAULT_EXPERIENCE_BAND).toEqual({ core: [2, 4], show: [1, 5], hideBelow: 1, hideAbove: 6 });
  });
});

describe('findExperienceMentions', () => {
  it('lists each mention with its flags', () => {
    const text = 'Requirements:\n- 3+ years of experience with AWS\n- 2 years in information security\nNice to have:\n- 5 years of Go experience';
    const ms = findExperienceMentions(text);
    expect(ms.map((m) => [m.minYears, m.preferred, m.security])).toEqual([
      [3, false, false],
      [2, false, true],
      [5, true, false],
    ]);
    for (const m of ms) expect(text.slice(m.start, m.end)).toMatch(/\d/);
  });

  it('title mode accepts bare amounts', () => {
    expect(findExperienceMentions('Engineer (3-5 years)')).toHaveLength(0);
    expect(findExperienceMentions('Engineer (3-5 years)', { assumeRequirement: true })).toHaveLength(1);
  });
});

describe('extractExperience — realistic postings', () => {
  it('German posting with benefits and company history', () => {
    const text = [
      'Über uns',
      'Seit über 20 Jahren entwickeln wir Software für den Mittelstand. Unser Team besteht aus 120 Kolleg:innen.',
      'Deine Aufgaben',
      '- Aufbau und Betrieb unserer AWS-Landschaft',
      '- Umsetzung von Security-Maßnahmen in der CI/CD-Pipeline',
      'Dein Profil',
      '- Abgeschlossenes Studium der Informatik oder vergleichbare Ausbildung',
      '- Mindestens 3 Jahre Berufserfahrung im Cloud-Umfeld',
      '- Erfahrung mit Terraform ist von Vorteil',
      'Wir bieten',
      '- 30 Tage Urlaub, nach 5 Jahren ein Sabbatical',
    ].join('\n');
    const f = extractExperience(text, 'Cloud Engineer (m/w/d)');
    expect(f.value).toEqual({ minYears: 3, maxYears: null, band: 'core', securityStrict: false });
    expect(f.confidence).toBe('high');
    expect(f.evidence).toContain('Mindestens 3 Jahre Berufserfahrung');
  });

  it('English posting with a security-specific requirement', () => {
    const text = [
      'About the role',
      'We are a fintech founded 8 years ago.',
      'What you will bring:',
      '• 4+ years of experience as a software or platform engineer',
      '• At least 2 years of hands-on experience in application security',
      '• Experience with SAST/DAST tools is a plus',
    ].join('\n');
    const f = extractExperience(text, 'Application Security Engineer');
    expect(f.value).toMatchObject({ minYears: 4, band: 'core', securityStrict: true });
  });

  it('French posting', () => {
    const text = "Profil recherché :\nDiplômé d'une école d'ingénieur (Bac+5), vous justifiez d'au moins 3 ans d'expérience sur un poste similaire.";
    expect(extractExperience(text, 'Ingénieur DevOps (H/F)').value.minYears).toBe(3);
  });

  it('long text stays fast', () => {
    const chunk = 'We build secure cloud platforms for customers across Europe and beyond. ';
    const text = chunk.repeat(700) + 'You have 3+ years of experience with AWS.';
    const t0 = performance.now();
    const f = extractExperience(text, '');
    expect(performance.now() - t0).toBeLessThan(500);
    expect(f.value.minYears).toBe(3);
  });
});
