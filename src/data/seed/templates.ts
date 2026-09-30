/**
 * Seed data: the application kit (spec §22) — resume versions, cover letters, outreach messages,
 * the per-job tailoring checklist and one CV-conventions note per country.
 *
 * Everything here is a STARTER the owner makes their own:
 * - Resumes use `[placeholders]` for every fact (no invented names, employers, dates or numbers).
 *   They follow EU conventions: no photo, no date of birth, languages with CEFR levels, a
 *   work-authorisation line and degree-recognition hints.
 * - Cover letters, outreach and the checklist use `{{field}}` slots (the kit's fill-in format);
 *   `fields` declares a label and hint for every slot, in the order the slots first appear.
 * - CV conventions are generated from the country guides in `countries.ts`.
 *
 * The seed only inserts a starter once. After the owner edits, renames or deletes it, the seed
 * leaves it alone (see src/db/seed/index.ts).
 *
 * Written 2026-09-30 by the build assistant.
 */
import type { RESUME_TRACKS, TEMPLATE_KINDS } from '../../db/schema/_enums';
import { COUNTRY_GUIDES_AS_OF, SEED_COUNTRIES, type SeedCountry } from './countries';

export type SeedResumeTrack = Exclude<(typeof RESUME_TRACKS)[number], 'other'>;
export type SeedTemplateKind = (typeof TEMPLATE_KINDS)[number];

export interface SeedResumeVersion {
  track: SeedResumeTrack;
  name: string;
  fileNote: string;
  contentMd: string;
}

export interface SeedTemplateField {
  key: string;
  label: string;
  hint?: string;
}

export interface SeedTemplate {
  kind: SeedTemplateKind;
  name: string;
  /** Only when written for one market (always set for cv_convention). */
  countryIso2: string | null;
  bodyMd: string;
  /** Fill-in fields for the `{{slots}}` in the body (null when the body has none). */
  fields: SeedTemplateField[] | null;
}

// ---- fill-in fields --------------------------------------------------------------------------------

/** Every slot a starter may use. Labels and hints are what the kit's fill-in form shows. */
export const TEMPLATE_FIELDS: Readonly<Record<string, SeedTemplateField>> = {
  my_name: { key: 'my_name', label: 'My name' },
  my_city: { key: 'my_city', label: 'My city', hint: 'Where I live now, e.g. "Pune, India".' },
  my_email: { key: 'my_email', label: 'My email' },
  my_phone: { key: 'my_phone', label: 'My phone', hint: 'With the country code.' },
  my_linkedin: { key: 'my_linkedin', label: 'My LinkedIn URL' },
  date: { key: 'date', label: 'Date', hint: 'Written the local way: "30 September 2026" (UK/IE), "30.09.2026" (DE).' },
  company: { key: 'company', label: 'Company' },
  company_address: { key: 'company_address', label: 'Company address', hint: 'Street, postcode and city from the posting or the imprint page.' },
  role: { key: 'role', label: 'Role', hint: 'The job title exactly as the posting writes it.' },
  job_ref: { key: 'job_ref', label: 'Job reference', hint: 'Reference number or the posting link.' },
  hiring_manager: { key: 'hiring_manager', label: 'Hiring manager', hint: 'A named person when you can find one; otherwise "Hiring team".' },
  salutation: {
    key: 'salutation',
    label: 'Anrede',
    hint: '"Sehr geehrte Frau Müller," / "Sehr geehrter Herr Müller," — or "Sehr geehrte Damen und Herren," when no name is known.',
  },
  recruiter_name: { key: 'recruiter_name', label: 'Recruiter name' },
  referrer_name: { key: 'referrer_name', label: 'Referrer name' },
  interviewer: { key: 'interviewer', label: 'Interviewer name(s)' },
  why_company: {
    key: 'why_company',
    label: 'Why this company',
    hint: 'One specific sentence: their product, stack, customers, security challenge or mission. Never "great culture".',
  },
  current_role: { key: 'current_role', label: 'Current role', hint: 'Title and employer, e.g. "Cloud Security Engineer at <employer>".' },
  current_employer: { key: 'current_employer', label: 'Current employer' },
  years_experience: { key: 'years_experience', label: 'Years of experience', hint: 'Relevant years, honestly counted.' },
  key_skills: {
    key: 'key_skills',
    label: 'Key skills to mirror',
    hint: '3–5 skills from the posting that I really have, in the posting’s spelling.',
  },
  achievement_1: { key: 'achievement_1', label: 'Achievement 1', hint: 'A result with a number, relevant to this posting.' },
  achievement_2: { key: 'achievement_2', label: 'Achievement 2', hint: 'A second result with a number.' },
  first_contribution: {
    key: 'first_contribution',
    label: 'First contribution',
    hint: 'One concrete thing I could help with in the first months, taken from the posting.',
  },
  visa_route: {
    key: 'visa_route',
    label: 'Visa / permit route',
    hint: 'The route from the Countries page, e.g. "an EU Blue Card", "a Critical Skills Employment Permit".',
  },
  visa_fit: {
    key: 'visa_fit',
    label: 'Why I qualify',
    hint: 'Only what I checked: degree (and recognition), salary vs the threshold, sponsor-register status.',
  },
  employer_steps: {
    key: 'employer_steps',
    label: 'What the employer has to do',
    hint: 'From the Countries page, e.g. "a signed contract and the Erklärung zum Beschäftigungsverhältnis" (DE Blue Card) or "being an IND recognised sponsor" (NL).',
  },
  degree_recognition: {
    key: 'degree_recognition',
    label: 'Anerkennung des Abschlusses',
    hint: 'e.g. "in der anabin-Datenbank als gleichwertig (H+) gelistet" or "durch eine ZAB-Zeugnisbewertung anerkannt".',
  },
  english_level: { key: 'english_level', label: 'English level', hint: 'CEFR level, e.g. "C1".' },
  german_level: { key: 'german_level', label: 'German level', hint: 'CEFR level, e.g. "A2 (Kurs läuft)".' },
  start_date: { key: 'start_date', label: 'Earliest start', hint: 'Notice period plus visa time, e.g. "from 1 March 2027".' },
  sign_off: {
    key: 'sign_off',
    label: 'Sign-off',
    hint: '"Yours sincerely" when writing to a named person, "Yours faithfully" after "Dear Sir or Madam".',
  },
  target_country: { key: 'target_country', label: 'Target country' },
  mutual: { key: 'mutual', label: 'How we know each other', hint: 'e.g. "We worked together at <employer>" or "We met at <event>".' },
  referral_blurb: {
    key: 'referral_blurb',
    label: 'Referral blurb',
    hint: 'Two sentences they can paste into the referral form: who I am and why I fit this role.',
  },
  applied_date: { key: 'applied_date', label: 'Date applied' },
  update_since: {
    key: 'update_since',
    label: 'News since applying',
    hint: 'Optional, e.g. a certification passed. Delete the sentence when there is nothing new.',
  },
  interview_topic: { key: 'interview_topic', label: 'Topic we discussed', hint: 'Something specific from the conversation.' },
  follow_up_point: {
    key: 'follow_up_point',
    label: 'Follow-up point',
    hint: 'A short, useful addition: a link to a relevant project or a clearer answer to one question.',
  },
  country: { key: 'country', label: 'Country' },
  posting_language: { key: 'posting_language', label: 'Posting language' },
};

const SLOT_RE = /\{\{\s*([A-Za-z][\w.-]{0,40})\s*\}\}/g;

/** Slot keys in the order they first appear. */
export function templateSlots(body: string): string[] {
  const out: string[] = [];
  for (const m of body.matchAll(SLOT_RE)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** The field list for a body: every slot, in order of appearance, from TEMPLATE_FIELDS. */
export function fieldsFor(body: string): SeedTemplateField[] | null {
  const keys = templateSlots(body);
  if (!keys.length) return null;
  return keys.map((k) => {
    const f = TEMPLATE_FIELDS[k];
    if (!f) throw new Error(`template slot {{${k}}} has no field definition`);
    return f;
  });
}

function template(kind: SeedTemplateKind, name: string, countryIso2: string | null, lines: readonly string[]): SeedTemplate {
  const bodyMd = lines.join('\n');
  return { kind, name, countryIso2, bodyMd, fields: fieldsFor(bodyMd) };
}

// ---- resume versions -------------------------------------------------------------------------------

const RESUME_NOTE =
  'Starter seeded 2026-09-30 (EU style: no photo, no date of birth). Replace every [placeholder], keep only skills you have really used, delete lines that do not apply, then export to PDF as Firstname_Lastname_CV.pdf.';

const RESUME_TAIL = [
  '## Certifications',
  '- [Certification name] — [issuer], [YYYY] [or "in progress, exam planned for Mon YYYY"]',
  '- [Certification name] — [issuer], [YYYY]',
  '',
  '## Education',
  '**[Degree and subject]** — [University], [City, Country] · [YYYY – YYYY]',
  '[Recognition, when the target country asks for it: e.g. "anabin: institution H+, degree equivalent" (Germany) · "Nuffic/IDW credential evaluation" (Netherlands) · delete otherwise]',
  '',
  '## Languages',
  '- English — [CEFR level, e.g. C1]',
  '- [Local language of the target country] — [CEFR level, e.g. A2, course in progress]',
  '- [Native language] — native',
];

export const SEED_RESUME_VERSIONS: readonly SeedResumeVersion[] = [
  {
    track: 'cloud_security',
    name: 'Cloud Security Engineer — EU CV (starter)',
    fileNote: RESUME_NOTE,
    contentMd: [
      '# [Full name]',
      '**Cloud Security Engineer** · [City, Country] · [email] · [phone with country code] · [linkedin.com/in/…] · [github.com/…]',
      'Work authorisation: [e.g. "Non-EU citizen — eligible for the EU Blue Card; can relocate from Mon YYYY"]',
      '',
      '## Profile',
      'Cloud security engineer with [N] years in IT, [N] of them securing [AWS / Azure / GCP] workloads for [industry or type of client]. [Strongest result with a number — e.g. "Brought critical cloud misconfigurations from [x] to [y] across [N] accounts"]. Looking for a cloud security role in [country or "the EU"].',
      '',
      '## Key skills',
      '- **Cloud:** [AWS — IAM, Organizations/SCPs, KMS, CloudTrail, Config, GuardDuty, Security Hub] · [Azure — Entra ID, Defender for Cloud, Azure Policy] · [GCP — IAM, Security Command Center]',
      '- **Security:** [identity and access management, least privilege, CSPM, vulnerability management, logging and detection, incident response, threat modelling]',
      '- **Infrastructure as code and automation:** [Terraform, CloudFormation, Python, Bash]',
      '- **Containers and pipelines:** [Docker, Kubernetes, GitHub Actions / GitLab CI, image and IaC scanning]',
      '- **Frameworks:** [CIS Benchmarks, ISO 27001, SOC 2, NIST CSF, GDPR]',
      '',
      '## Experience',
      '### [Job title] — [Employer], [City, Country]',
      '*[Mon YYYY] – present · [project or client, e.g. "cloud landing zone for a European insurer"]*',
      '- [Designed / hardened] [IAM, network or account guardrails] for [N accounts / subscriptions] on [platform], [result — e.g. "no public buckets since [date]"]',
      '- [Built] [detection or alerting — e.g. GuardDuty + Security Hub findings routed to [tool]] that [caught / cut] [what], [metric]',
      '- [Automated] [a manual security task] with [Python / Terraform / Lambda], saving [N hours a week] or cutting [time to fix] from [x] to [y]',
      '- [Prepared / supported] [audit evidence — e.g. ISO 27001 or SOC 2 controls] for [scope], [outcome]',
      '- [Worked with] [development / platform teams] to [fix or prevent] [class of issue], [result]',
      '',
      '### [Previous job title] — [Employer], [City, Country]',
      '*[Mon YYYY] – [Mon YYYY]*',
      '- [Responsibility that shows transferable skills — Linux, networking, scripting, support], [result with a number]',
      '- [Result with a number]',
      '',
      '## Projects',
      '- **[Project name]** — [what it does and the stack, e.g. "multi-account AWS security baseline in Terraform"] · [link]',
      '',
      ...RESUME_TAIL,
    ].join('\n'),
  },
  {
    track: 'devsecops',
    name: 'DevSecOps Engineer — EU CV (starter)',
    fileNote: RESUME_NOTE,
    contentMd: [
      '# [Full name]',
      '**DevSecOps Engineer** · [City, Country] · [email] · [phone with country code] · [linkedin.com/in/…] · [github.com/…]',
      'Work authorisation: [e.g. "Non-EU citizen — eligible for the EU Blue Card; can relocate from Mon YYYY"]',
      '',
      '## Profile',
      'DevSecOps engineer with [N] years building and securing delivery pipelines and cloud platforms on [AWS / Azure / GCP]. [Strongest result with a number — e.g. "Added security gates to [N] pipelines without slowing releases"]. Looking for a DevSecOps or application security role in [country or "the EU"].',
      '',
      '## Key skills',
      '- **Pipelines:** [GitHub Actions, GitLab CI, Jenkins, Argo CD] · [branch protection, signed commits, environment approvals]',
      '- **Application security testing:** [SAST — Semgrep / CodeQL · SCA — Dependabot / Snyk · DAST — OWASP ZAP · secret scanning]',
      '- **Supply chain:** [SBOM (CycloneDX / SPDX), image signing (Sigstore / cosign), dependency pinning]',
      '- **Containers and Kubernetes:** [Docker, Kubernetes, Helm, admission policies (OPA Gatekeeper / Kyverno), Trivy]',
      '- **Cloud and IaC:** [AWS / Azure / GCP] · [Terraform, Checkov / tfsec] · [HashiCorp Vault or a cloud secrets manager]',
      '- **Languages:** [Python, Bash, Go, TypeScript]',
      '',
      '## Experience',
      '### [Job title] — [Employer], [City, Country]',
      '*[Mon YYYY] – present · [project or client]*',
      '- [Introduced] [SAST / SCA / secret scanning] into [N] repositories, [result — e.g. "[N] critical findings fixed before release"]',
      '- [Built] [a reusable pipeline template / policy as code] used by [N teams], [result]',
      '- [Moved] [secrets] from [where] to [Vault / Secrets Manager], [result]',
      '- [Hardened] [Kubernetes clusters / container images] with [tool], [metric — e.g. "image CVEs down [x]%"]',
      '- [Ran] [threat modelling / security reviews] for [N features or services], [outcome]',
      '',
      '### [Previous job title] — [Employer], [City, Country]',
      '*[Mon YYYY] – [Mon YYYY]*',
      '- [Responsibility that shows transferable skills — CI/CD, release engineering, development], [result with a number]',
      '- [Result with a number]',
      '',
      '## Projects',
      '- **[Project name]** — [what it does and the stack, e.g. "GitHub Actions workflow that fails builds on critical CVEs and unsigned images"] · [link]',
      '',
      ...RESUME_TAIL,
    ].join('\n'),
  },
  {
    track: 'fullstack',
    name: 'Full-stack Developer (Node.js / Next.js) — EU CV (starter)',
    fileNote: RESUME_NOTE,
    contentMd: [
      '# [Full name]',
      '**Full-stack Developer — TypeScript, Node.js, Next.js** · [City, Country] · [email] · [phone with country code] · [linkedin.com/in/…] · [github.com/…]',
      'Work authorisation: [e.g. "Non-EU citizen — eligible for the EU Blue Card; can relocate from Mon YYYY"]',
      '',
      '## Profile',
      'Full-stack developer with [N] years building [type of product] with TypeScript, Node.js and Next.js, deployed on [AWS / Azure / GCP / Vercel]. Security-minded: [one line — e.g. "I apply the OWASP Top 10 in code reviews and pipelines"]. [Strongest result with a number]. Looking for a full-stack role in [country or "the EU"].',
      '',
      '## Key skills',
      '- **Front end:** [React, Next.js (App Router), TypeScript, Tailwind CSS, accessibility]',
      '- **Back end:** [Node.js, REST / GraphQL APIs, authentication (OAuth 2.0 / OIDC), background jobs]',
      '- **Data:** [MySQL / PostgreSQL, an ORM such as Drizzle / Prisma, Redis]',
      '- **Quality and delivery:** [Vitest / Jest, Playwright, CI/CD with GitHub Actions, Docker]',
      '- **Cloud and security:** [AWS / Azure / GCP basics, secrets handling, dependency scanning, OWASP Top 10]',
      '',
      '## Experience',
      '### [Job title] — [Employer], [City, Country]',
      '*[Mon YYYY] – present · [product or client]*',
      '- [Built / shipped] [feature or product] with [stack] for [users], [result — e.g. "[N] active users", "conversion up [x]%"]',
      '- [Improved] [performance / reliability] of [page or service], [metric — e.g. "p95 load time from [x] s to [y] s"]',
      '- [Designed] [API or data model] for [purpose], [result]',
      '- [Added] [tests / CI checks / security fixes], [result — e.g. "coverage from [x]% to [y]%"]',
      '',
      '### [Previous job title] — [Employer], [City, Country]',
      '*[Mon YYYY] – [Mon YYYY]*',
      '- [Responsibility], [result with a number]',
      '- [Result with a number]',
      '',
      '## Projects',
      '- **[Project name]** — [what it does, the stack and a link to the live app or repository]',
      '',
      ...RESUME_TAIL,
    ].join('\n'),
  },
];

// ---- cover letters -----------------------------------------------------------------------------------

const COVER_LETTERS: readonly SeedTemplate[] = [
  template('cover_letter', 'Cover letter — general EU (English)', null, [
    '{{my_name}}',
    '{{my_city}} · {{my_email}} · {{my_phone}} · {{my_linkedin}}',
    '',
    '{{date}}',
    '',
    '**{{company}}** — application for {{role}} ({{job_ref}})',
    '',
    'Dear {{hiring_manager}},',
    '',
    'I am applying for the {{role}} position at {{company}}. {{why_company}}',
    '',
    'In my current role as {{current_role}}, I {{achievement_1}}. Before that, I {{achievement_2}}. Over {{years_experience}} years I have worked hands-on with {{key_skills}}, which your posting names as core to this role.',
    '',
    'In the first months I could help with {{first_contribution}}.',
    '',
    'Work authorisation: I am a non-EU citizen and would come on {{visa_route}}. I meet its requirements ({{visa_fit}}) and will handle the paperwork on my side. I can relocate and start {{start_date}}.',
    '',
    'I would welcome a conversation about the role. Thank you for your time.',
    '',
    'Kind regards,',
    '{{my_name}}',
  ]),
  template('cover_letter', 'Anschreiben — Deutschland (formell)', 'DE', [
    '{{my_name}}',
    '{{my_city}}',
    '{{my_email}} · {{my_phone}}',
    '',
    '{{company}}',
    'z. Hd. {{hiring_manager}}',
    '{{company_address}}',
    '',
    '{{my_city}}, {{date}}',
    '',
    '**Bewerbung als {{role}} — Kennziffer {{job_ref}}**',
    '',
    '{{salutation}}',
    '',
    'mit großem Interesse habe ich Ihre Ausschreibung für die Position {{role}} gelesen. {{why_company}}',
    '',
    'Derzeit arbeite ich als {{current_role}}. Dort {{achievement_1}}. Zuvor {{achievement_2}}. In {{years_experience}} Jahren Berufserfahrung habe ich intensiv mit {{key_skills}} gearbeitet — genau den Schwerpunkten, die Sie in der Ausschreibung nennen.',
    '',
    'In den ersten Monaten könnte ich Sie insbesondere bei {{first_contribution}} unterstützen.',
    '',
    'Zum Aufenthaltstitel: Als Nicht-EU-Bürger würde ich mit {{visa_route}} nach Deutschland kommen. Die Voraussetzungen erfülle ich ({{visa_fit}}); mein Hochschulabschluss ist {{degree_recognition}}. Den Antrag bereite ich selbst vor; von Ihrer Seite werden in der Regel {{employer_steps}} benötigt.',
    '',
    'Sprachkenntnisse: Englisch {{english_level}}, Deutsch {{german_level}}. Ich kann die Stelle {{start_date}} antreten.',
    '',
    'Über eine Einladung zu einem persönlichen Gespräch freue ich mich sehr.',
    '',
    'Mit freundlichen Grüßen',
    '',
    '{{my_name}}',
    '',
    'Anlagen: Lebenslauf, Arbeitszeugnisse, Hochschulzeugnis mit Nachweis der Anerkennung',
  ]),
  template('cover_letter', 'Cover letter — Netherlands & Nordics (concise)', null, [
    'Hi {{hiring_manager}},',
    '',
    "I'm applying for {{role}} at {{company}}. {{why_company}}",
    '',
    'Why I fit, in three points:',
    '- {{achievement_1}}',
    '- {{achievement_2}}',
    '- Hands-on with {{key_skills}}, the core of this role.',
    '',
    "Practicalities: I would relocate from {{my_city}} on {{visa_route}} and meet its requirements ({{visa_fit}}). On your side that usually means {{employer_steps}}. I can start {{start_date}}.",
    '',
    "Happy to talk whenever it suits you.",
    '',
    'Best regards,',
    '{{my_name}}',
    '{{my_email}} · {{my_linkedin}}',
  ]),
  template('cover_letter', 'Cover letter — United Kingdom', 'GB', [
    '{{my_name}}',
    '{{my_city}} · {{my_email}} · {{my_phone}}',
    '',
    '{{date}}',
    '',
    'Dear {{hiring_manager}},',
    '',
    '**Re: {{role}} — {{job_ref}}**',
    '',
    'I am writing to apply for the {{role}} role at {{company}}. {{why_company}}',
    '',
    'As {{current_role}}, I {{achievement_1}}. I also {{achievement_2}}. Across {{years_experience}} years I have used {{key_skills}} day to day, which matches the core of your job description.',
    '',
    'If I joined, an early focus would be {{first_contribution}}.',
    '',
    'Right to work: I would need sponsorship under {{visa_route}}. {{visa_fit}}. I can start {{start_date}}.',
    '',
    'Thank you for considering my application. I would be glad to discuss it at interview.',
    '',
    '{{sign_off}},',
    '{{my_name}}',
  ]),
  template('cover_letter', 'Cover letter — Ireland', 'IE', [
    '{{my_name}}',
    '{{my_city}} · {{my_email}} · {{my_phone}} · {{my_linkedin}}',
    '',
    '{{date}}',
    '',
    'Dear {{hiring_manager}},',
    '',
    '**{{role}} — {{job_ref}}**',
    '',
    'I would like to apply for the {{role}} position at {{company}}. {{why_company}}',
    '',
    'In my current role as {{current_role}}, I {{achievement_1}}. Previously, I {{achievement_2}}. My {{years_experience}} years of experience centre on {{key_skills}}, the skills your posting puts first.',
    '',
    'Early on I could help the team with {{first_contribution}}.',
    '',
    'Employment permit: I would need {{visa_route}}. {{visa_fit}}. Once there is a job offer, the application can be made online by either the employer or me, and I am happy to prepare it. I can start {{start_date}}.',
    '',
    'Thank you for your time. I would welcome the chance to talk.',
    '',
    'Kind regards,',
    '{{my_name}}',
  ]),
];

// ---- outreach ------------------------------------------------------------------------------------------

const OUTREACH: readonly SeedTemplate[] = [
  template('outreach', 'Outreach — recruiter cold message', null, [
    'Hi {{recruiter_name}},',
    '',
    "I'm {{current_role}} with {{years_experience}} years in {{key_skills}}. I saw that {{company}} is hiring a {{role}} ({{job_ref}}) and I think my background fits: {{achievement_1}}.",
    '',
    "I'm based in {{my_city}} and would relocate on {{visa_route}} — I meet its requirements ({{visa_fit}}).",
    '',
    'Would you be open to a 15-minute call, or would you prefer that I apply directly?',
    '',
    'Thanks,',
    '{{my_name}}',
    '{{my_linkedin}}',
  ]),
  template('outreach', 'Outreach — hiring manager', null, [
    'Hi {{hiring_manager}},',
    '',
    "I've applied for {{role}} on your team and wanted to reach out directly. {{why_company}}",
    '',
    'One thing I could help with early on is {{first_contribution}}. I did something similar at {{current_employer}}, where I {{achievement_1}}.',
    '',
    "If it's useful, I'm happy to walk you through it in a short call. Thanks for reading.",
    '',
    '{{my_name}}',
    '{{my_linkedin}}',
  ]),
  template('outreach', 'Outreach — referral ask', null, [
    'Hi {{referrer_name}},',
    '',
    "{{mutual}} — I hope you're well. I'm applying for {{role}} at {{company}} ({{job_ref}}), and it's a strong match for what I do: {{achievement_1}}.",
    '',
    'Would you be comfortable referring me? My CV is attached, and here are two sentences you can paste into the referral form:',
    '',
    '> {{referral_blurb}}',
    '',
    "No pressure at all if you don't know the team well — a pointer to the right person would help just as much.",
    '',
    'Thank you!',
    '{{my_name}}',
  ]),
  template('outreach', 'Outreach — follow-up after applying', null, [
    '**Subject:** {{role}} application — {{my_name}}',
    '',
    'Hi {{hiring_manager}},',
    '',
    "I applied for {{role}} on {{applied_date}} and wanted to ask whether there is an update on the timeline. I'm still very interested: {{why_company}}",
    '',
    'Since applying, {{update_since}}.',
    '',
    "I'm happy to share anything else that helps. Thank you for your time.",
    '',
    'Best regards,',
    '{{my_name}}',
  ]),
  template('outreach', 'Outreach — thank-you after interview', null, [
    '**Subject:** Thank you — {{role}} interview',
    '',
    'Hi {{interviewer}},',
    '',
    'Thank you for the conversation today about the {{role}} role. I enjoyed discussing {{interview_topic}}, and it made me even more interested in the work at {{company}}.',
    '',
    '{{follow_up_point}}',
    '',
    "I'm looking forward to the next steps. Please let me know if you need anything else from me.",
    '',
    'Best regards,',
    '{{my_name}}',
  ]),
  template('outreach', 'Outreach — do you sponsor visas?', null, [
    'Hi {{recruiter_name}},',
    '',
    "I'm interested in the {{role}} role at {{company}} ({{job_ref}}). Before I apply, a quick question: does this position offer visa sponsorship and relocation support for a candidate based in {{my_city}}?",
    '',
    "For context, I would qualify for {{visa_route}} ({{visa_fit}}), so the employer's part is usually {{employer_steps}}.",
    '',
    'If sponsorship is not possible for this role, could you tell me whether other teams at {{company}} sponsor?',
    '',
    'Thank you,',
    '{{my_name}}',
  ]),
];

// ---- tailoring checklist --------------------------------------------------------------------------------

const CHECKLISTS: readonly SeedTemplate[] = [
  template('checklist', 'Tailoring checklist — per job', null, [
    '# Tailoring checklist — {{role}} at {{company}}',
    '',
    '## 1. Read the posting',
    '- [ ] Saved the job in RADAR, so the tracker keeps a snapshot if the posting disappears',
    '- [ ] The posting is written in {{posting_language}}: apply in that language unless it says otherwise',
    '- [ ] Compared the years asked with mine; a role counting only security years is a stretch',
    '',
    '## 2. Key skills to mirror',
    'Skills from the posting that I really have: {{key_skills}}',
    '- [ ] Each one appears in my CV in the posting’s exact spelling ("Kubernetes", not only "k8s")',
    '- [ ] The top three are in the profile summary and in the bullets of my latest role',
    '- [ ] Skills I do not have are left out — never add them',
    '- [ ] Picked the resume version for the track: cloud security, DevSecOps or full-stack',
    '',
    '## 3. Why this company (one line)',
    '{{why_company}}',
    '- [ ] It is specific (product, stack, customers, security challenge, mission), not "great culture"',
    '- [ ] It opens the cover letter and the outreach message',
    '',
    '## 4. Country and visa',
    '- [ ] The CV follows the conventions for {{country}} (Kit → CV conventions): length, photo, personal details, language',
    '- [ ] The salary meets the {{visa_route}} threshold on the Countries page (a rule marked unverified must be checked on the official page first)',
    '- [ ] The employer can sponsor: listed on the national register where one exists, or the posting says so',
    '',
    '## 5. Send',
    '- [ ] Files named Firstname_Lastname_CV_Company.pdf and Firstname_Lastname_Cover_Letter_Company.pdf',
    '- [ ] Every fill-in field is filled and no [placeholder] is left in the CV',
    '- [ ] Application recorded in RADAR with the resume version used, and a follow-up reminder set for 7–10 days',
  ]),
];

// ---- CV conventions (one per country) -------------------------------------------------------------------

function sentence(s: string): string {
  const t = s.trim();
  return /[.!?)"]$/.test(t) ? t : `${t}.`;
}

/** The kit's per-country CV note, built from the country guide. */
export function cvConventionTemplate(c: Pick<SeedCountry, 'iso2' | 'name' | 'cvConventions' | 'languageNotes'>): SeedTemplate {
  const cv = c.cvConventions;
  const lines = [
    `# CV conventions — ${c.name}`,
    '',
    `*Guide compiled ${COUNTRY_GUIDES_AS_OF} by the build assistant from general hiring practice — the posting's own instructions always win.*`,
    '',
    `- **Length:** ${sentence(cv.length)}`,
    `- **Photo:** ${sentence(cv.photo)}`,
    `- **Personal details:** ${sentence(cv.personalDetails)}`,
    `- **Language:** ${sentence(cv.language)}`,
    `- **Format:** ${sentence(cv.format)}`,
  ];
  if (cv.coverLetter) lines.push(`- **Cover letter:** ${sentence(cv.coverLetter)}`);
  if (cv.references) lines.push(`- **References:** ${sentence(cv.references)}`);
  if (cv.notes?.length) lines.push('', '## Also note', ...cv.notes.map((n) => `- ${sentence(n)}`));
  lines.push(
    '',
    '## Working language',
    sentence(c.languageNotes),
    '',
    `## Before sending a CV for ${c.name}`,
    `- [ ] Length: ${cv.length}`,
    `- [ ] Photo: ${cv.photo}`,
    '- [ ] Personal details as above, and nothing more',
    '- [ ] CV and letter in the language of the posting',
    '- [ ] The work-authorisation line names the route shown on the Countries page',
  );
  return { kind: 'cv_convention', name: `CV conventions — ${c.name}`, countryIso2: c.iso2, bodyMd: lines.join('\n'), fields: null };
}

export const SEED_TEMPLATES: readonly SeedTemplate[] = [
  ...COVER_LETTERS,
  ...OUTREACH,
  ...CHECKLISTS,
  ...SEED_COUNTRIES.map(cvConventionTemplate),
];
