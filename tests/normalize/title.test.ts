import { describe, expect, it } from 'vitest';
import {
  TITLE_LOGIC_VERSION,
  detectSeniority,
  explainTitle,
  familyForRole,
  mapTitle,
  normalizeTitleKey,
} from '@/lib/normalize/title';
import { ROLE_KEYS, ROLES } from '@/data/titles/roles';
import { DEFAULT_TARGET_ROLES, titleOverridesSchema, type TitleOverrides } from '@/lib/contracts/settings';
import type { Confidence } from '@/lib/contracts/provenance';

type Case = [title: string, role: string | null, confidence?: Confidence];

function check(cases: Case[]) {
  it.each(cases)('%s → %s', (title, role, confidence) => {
    const r = mapTitle(title);
    expect(r.roleKey).toBe(role);
    expect(r.unknown).toBe(role === null);
    if (confidence) expect(r.confidence).toBe(confidence);
  });
}

describe('mapTitle — cloud security engineer (multilingual)', () => {
  check([
    ['Cloud Security Engineer', 'cloud_security_engineer', 'high'],
    ['cloud security engineer', 'cloud_security_engineer', 'high'],
    ['CLOUD SECURITY ENGINEER', 'cloud_security_engineer', 'high'],
    ['Cloud-Security-Engineer (m/w/d)', 'cloud_security_engineer', 'high'],
    ['Cloudsecurity engineer', 'cloud_security_engineer', 'high'],
    ['Cloud Infrastructure Security Engineer', 'cloud_security_engineer', 'high'],
    ['Cloud Native Security Engineer', 'cloud_security_engineer', 'high'],
    ['Cloud Security Posture Management Engineer', 'cloud_security_engineer', 'high'],
    ['AWS Security Engineer', 'cloud_security_engineer', 'high'],
    ['Azure Security Engineer', 'cloud_security_engineer', 'high'],
    ['GCP Security Engineer', 'cloud_security_engineer', 'high'],
    ['Cloud Security Architect', 'cloud_security_engineer', 'medium'],
    ['Cloud Security Consultant', 'cloud_security_engineer', 'medium'],
    ['Cloud Security Operations Engineer', 'cloud_security_engineer', 'medium'],
    ['Cloud Detection & Response Engineer', 'cloud_security_engineer', 'medium'],
    ['Kubernetes Security Engineer', 'cloud_security_engineer', 'medium'],
    ['Platform Security Engineer', 'cloud_security_engineer', 'medium'],
    ['Container Security Engineer', 'cloud_security_engineer', 'medium'],
    ['Head of Cloud Security', 'cloud_security_engineer', 'medium'],
    ['Cloud Security', 'cloud_security_engineer', 'low'],
    ['Engineer II, Cloud Security', 'cloud_security_engineer', 'medium'],
    ['Security Engineer (m/w/d) – Cloud Security', 'cloud_security_engineer', 'medium'],
    // German
    ['Cloud-Sicherheitsingenieur', 'cloud_security_engineer', 'high'],
    ['Ingenieur Cloud-Sicherheit', 'cloud_security_engineer', 'high'],
    ['Cloud Security Ingenieur', 'cloud_security_engineer', 'high'],
    // French
    ['Ingénieur sécurité cloud', 'cloud_security_engineer', 'high'],
    ['Ingénieure sécurité du cloud', 'cloud_security_engineer', 'high'],
    ['Ingénieur(e) sécurité cloud AWS', 'cloud_security_engineer', 'high'],
    // Spanish / Portuguese / Italian
    ['Ingeniero de Seguridad en la Nube', 'cloud_security_engineer', 'high'],
    ['Ingeniero/a de seguridad cloud', 'cloud_security_engineer', 'high'],
    ['Ingeniero de ciberseguridad cloud', 'cloud_security_engineer', 'high'],
    ['Engenheiro de Segurança Cloud', 'cloud_security_engineer', 'high'],
    ['Engenheiro(a) de Segurança em Nuvem', 'cloud_security_engineer', 'high'],
    ['Engenheiro de Segurança da Nuvem', 'cloud_security_engineer', 'high'],
    ['Ingegnere della sicurezza cloud', 'cloud_security_engineer', 'high'],
    ['Ingegnere Cloud Security', 'cloud_security_engineer', 'high'],
    ['Ingegnere sicurezza del cloud', 'cloud_security_engineer', 'high'],
    // Dutch
    ['Cloud beveiligingsingenieur', 'cloud_security_engineer', 'high'],
    ['Cloud Security Engineer (m/v/x)', 'cloud_security_engineer', 'high'],
    // Nordic / Finnish
    ['Molnsäkerhetsingenjör', 'cloud_security_engineer', 'high'],
    ['Cloud-sikkerhedsingeniør', 'cloud_security_engineer', 'high'],
    ['Cloud sikkerhedsingeniør', 'cloud_security_engineer', 'high'],
    ['Skysikkerhetsingeniør', 'cloud_security_engineer', 'high'],
    ['Cloud-sikkerhetsingeniør', 'cloud_security_engineer', 'high'],
    ['Pilvitietoturvainsinööri', 'cloud_security_engineer', 'high'],
    ['Pilvitietoturva-asiantuntija', 'cloud_security_engineer', 'high'],
    // Polish / Czech
    ['Inżynier bezpieczeństwa chmury', 'cloud_security_engineer', 'high'],
    ['Inżynier ds. bezpieczeństwa chmury', 'cloud_security_engineer', 'high'],
    ['Inżynier bezpieczeństwa cloud', 'cloud_security_engineer', 'high'],
    ['Cloud Security Inżynier', 'cloud_security_engineer', 'high'],
    ['Inženýr cloudové bezpečnosti', 'cloud_security_engineer', 'high'],
    ['Inženýr bezpečnosti cloudu', 'cloud_security_engineer', 'high'],
  ]);
});

describe('mapTitle — word order decides cloud vs security qualifiers', () => {
  check([
    ['Security Engineer - Cloud', 'security_engineer_cloud', 'high'],
    ['Security Engineer (AWS)', 'security_engineer_cloud', 'high'],
    ['Security Engineer, Cloud Infrastructure', 'security_engineer_cloud', 'high'],
    ['Security Engineer - Cloud & Infrastructure', 'security_engineer_cloud', 'high'],
    ['Sicherheitsingenieur Cloud', 'security_engineer_cloud', 'high'],
    ['Säkerhetsingenjör moln', 'security_engineer_cloud', 'high'],
    ['Beveiligingsingenieur cloud', 'security_engineer_cloud', 'high'],
    ['Cloud Engineer (Security)', 'cloud_engineer_security', 'high'],
    ['Cloud Engineer - Security', 'cloud_engineer_security', 'high'],
    ['Cloud Engineer (Security Focus)', 'cloud_engineer_security', 'high'],
    ['Cloud Infrastructure Engineer – Security', 'cloud_engineer_security', 'high'],
    ['Cloud-Ingenieur (Schwerpunkt Security)', 'cloud_engineer_security', 'high'],
    ['Cloud-Ingenieur Sicherheit', 'cloud_engineer_security', 'high'],
  ]);
});

describe('mapTitle — DevSecOps', () => {
  check([
    ['DevSecOps Engineer', 'devsecops_engineer', 'high'],
    ['Junior DevSecOps Engineer', 'devsecops_engineer', 'high'],
    ['Mid-level DevSecOps Engineer', 'devsecops_engineer', 'high'],
    ['DevSecOps-Engineer (w/m/d)', 'devsecops_engineer', 'high'],
    ['Dev Sec Ops Engineer', 'devsecops_engineer', 'high'],
    ['DevSec Ops Engineer', 'devsecops_engineer', 'high'],
    ['DevSecOps Specialist', 'devsecops_engineer', 'high'],
    ['DevSecOps Architect', 'devsecops_engineer', 'high'],
    ['DevSecOps', 'devsecops_engineer', 'medium'],
    ['Alternance DevSecOps', 'devsecops_engineer', 'medium'],
    ['DevSecOps Ingenieur', 'devsecops_engineer', 'high'],
    ['Ingénieur DevSecOps H/F', 'devsecops_engineer', 'high'],
    ['Ingeniero DevSecOps', 'devsecops_engineer', 'high'],
    ['Engenheiro de DevSecOps', 'devsecops_engineer', 'high'],
    ['Engenheiro DevSecOps', 'devsecops_engineer', 'high'],
    ['Ingegnere DevSecOps', 'devsecops_engineer', 'high'],
    ['DevSecOps-insinööri', 'devsecops_engineer', 'high'],
    ['Inżynier DevSecOps', 'devsecops_engineer', 'high'],
    ['DevSecOps inženýr', 'devsecops_engineer', 'high'],
    ['Supply Chain Security Engineer', 'devsecops_engineer', 'high'],
    ['Security DevOps Engineer', 'devsecops_engineer', 'medium'],
    ['DevOps Security Engineer', 'devsecops_engineer', 'medium'],
    ['CI/CD Security Engineer', 'devsecops_engineer'],
  ]);
});

describe('mapTitle — application and product security', () => {
  check([
    ['Application Security Engineer', 'appsec_engineer', 'high'],
    ['Senior Application Security Engineer', 'appsec_engineer', 'high'],
    ['Application Security Engineer - Remote', 'appsec_engineer', 'high'],
    ['AppSec Engineer', 'appsec_engineer', 'high'],
    ['Lead AppSec Engineer', 'appsec_engineer', 'high'],
    ['Web Application Security Engineer', 'appsec_engineer', 'high'],
    ['Application Security Architect', 'appsec_engineer', 'high'],
    ['Application Security Analyst', 'appsec_engineer', 'medium'],
    ['Software Security Engineer', 'appsec_engineer', 'high'],
    ['Secure Software Engineer', 'appsec_engineer', 'high'],
    ['Security Software Engineer', 'appsec_engineer', 'medium'],
    ['Software Engineer, Security', 'appsec_engineer', 'medium'],
    ['Secure Code Reviewer', 'appsec_engineer', 'medium'],
    ['Staff Engineer - Application Security', 'appsec_engineer', 'medium'],
    ['Anwendungssicherheit Ingenieur', 'appsec_engineer', 'high'],
    ['Ingénieur Sécurité Applicative', 'appsec_engineer', 'high'],
    ['Ingénieur sécurité des applications', 'appsec_engineer', 'high'],
    ['Ingeniero de seguridad de aplicaciones', 'appsec_engineer', 'high'],
    ['Engenheiro de Segurança de Aplicações', 'appsec_engineer', 'high'],
    ['Ingegnere sicurezza applicativa', 'appsec_engineer', 'high'],
    ['Applicatiebeveiliging engineer', 'appsec_engineer', 'high'],
    ['Applikationssäkerhetsingenjör', 'appsec_engineer', 'high'],
    ['Applikationssikkerhed ingeniør', 'appsec_engineer', 'high'],
    ['Sovellustietoturva-asiantuntija', 'appsec_engineer', 'high'],
    ['Inżynier bezpieczeństwa aplikacji', 'appsec_engineer', 'high'],
    ['Specialista bezpečnosti aplikací', 'appsec_engineer', 'high'],
    ['Product Security Engineer', 'product_security_engineer', 'high'],
    ['Principal Product Security Engineer', 'product_security_engineer', 'high'],
    ['Product Security Architect', 'product_security_engineer', 'high'],
    ['Product Security Analyst', 'product_security_engineer', 'medium'],
    ['Senior Engineer, Product Security', 'product_security_engineer', 'medium'],
    ['Ingénieur sécurité produit', 'product_security_engineer', 'high'],
  ]);
});

describe('mapTitle — cloud security analyst and GRC', () => {
  check([
    ['Cloud Security Analyst', 'cloud_security_analyst', 'high'],
    ['Analyst Cloud Security', 'cloud_security_analyst', 'high'],
    ['Cloud-Sicherheitsanalyst', 'cloud_security_analyst', 'high'],
    ['Analyste sécurité cloud', 'cloud_security_analyst', 'high'],
    ['Analista de seguridad en la nube', 'cloud_security_analyst', 'high'],
    ['Analista de Segurança Cloud', 'cloud_security_analyst', 'high'],
    ['Analista sicurezza cloud', 'cloud_security_analyst', 'high'],
    ['Cloud säkerhetsanalytiker', 'cloud_security_analyst', 'high'],
    ['Analityk bezpieczeństwa chmury', 'cloud_security_analyst', 'high'],
    ['Analytik cloudové bezpečnosti', 'cloud_security_analyst', 'high'],
    ['GRC Analyst', 'grc_cloud', 'medium'],
    ['GRC Analyst - Cloud', 'grc_cloud', 'high'],
    ['Cloud GRC Analyst', 'grc_cloud', 'high'],
    ['GRC Specialist', 'grc_cloud', 'medium'],
    ['GRC Consultant', 'grc_cloud', 'medium'],
    ['Consultant GRC', 'grc_cloud', 'medium'],
    ['Governance Risk and Compliance Specialist', 'grc_cloud', 'medium'],
    ['Governance, Risk & Compliance Analyst', 'grc_cloud', 'low'],
    ['IT Compliance Analyst', 'grc_cloud', 'medium'],
    ['IT Auditor', 'grc_cloud', 'medium'],
    ['ISO 27001 Auditor', 'grc_cloud', 'medium'],
    ['ISO/IEC 27001 Lead Auditor', 'grc_cloud', 'medium'],
    ['SOC 2 Compliance Manager', 'grc_cloud', 'medium'],
    ['Security Compliance Engineer', 'grc_cloud', 'medium'],
    ['Cloud Compliance Engineer', 'grc_cloud', 'medium'],
    ['Information Security Compliance Specialist', 'grc_cloud', 'medium'],
    ['Cloud Risk & Compliance Manager', 'grc_cloud', 'medium'],
    ['IT-Risikomanager', 'grc_cloud', 'low'],
    ['Information Security Officer', 'grc_cloud', 'medium'],
    ['Chief Information Security Officer', 'grc_cloud', 'medium'],
    ['CISO', 'grc_cloud', 'medium'],
    ['Informationssicherheitsbeauftragter', 'grc_cloud', 'medium'],
    ['ISMS Manager', 'grc_cloud', 'medium'],
    ["Responsable de la sécurité des systèmes d'information (RSSI)", 'grc_cloud', 'low'],
    ['Auditor de seguridad informática', 'grc_cloud', 'medium'],
  ]);
});

describe('mapTitle — general security engineer (secondary)', () => {
  check([
    ['Security Engineer', 'security_engineer_cloud', 'medium'],
    ['Security Engineer II', 'security_engineer_cloud', 'medium'],
    ['Senior Security Engineer III', 'security_engineer_cloud', 'medium'],
    ['Staff Security Engineer', 'security_engineer_cloud', 'medium'],
    ['Sr Staff Security Engineer', 'security_engineer_cloud', 'medium'],
    ['Security Engineer (Senior)', 'security_engineer_cloud', 'medium'],
    ['Medior Security Engineer', 'security_engineer_cloud', 'medium'],
    ['Cyber Security Engineer', 'security_engineer_cloud', 'medium'],
    ['IT Security Engineer', 'security_engineer_cloud', 'medium'],
    ['IT Security Specialist', 'security_engineer_cloud', 'medium'],
    ['Information Security Engineer', 'security_engineer_cloud', 'medium'],
    ['Cybersecurity specialist', 'security_engineer_cloud', 'medium'],
    ['IAM Engineer', 'security_engineer_cloud', 'medium'],
    ['Identity and Access Management Specialist', 'security_engineer_cloud', 'medium'],
    ['Security Architect', 'security_engineer_cloud', 'low'],
    ['Cybersecurity Consultant', 'security_engineer_cloud', 'low'],
    ['Director of Security Engineering', 'security_engineer_cloud', 'low'],
    ['Sicherheitsingenieur (IT)', 'security_engineer_cloud', 'medium'],
    ['IT-Sicherheitsspezialist (m/w/d)', 'security_engineer_cloud', 'medium'],
    ['Berater*in Informationssicherheit', 'security_engineer_cloud', 'low'],
    ['Informationssicherheitsberater', 'security_engineer_cloud', 'low'],
    ['Ingénieur cybersécurité', 'security_engineer_cloud', 'medium'],
    ['Stagiaire Ingénieur Cybersécurité', 'security_engineer_cloud', 'medium'],
    ['Consultant cybersécurité', 'security_engineer_cloud', 'low'],
    ['Ingeniero de ciberseguridad', 'security_engineer_cloud', 'medium'],
    ['Engenheiro de cibersegurança', 'security_engineer_cloud', 'medium'],
    ['Ingegnere cybersecurity', 'security_engineer_cloud', 'medium'],
    ['Specialista cybersecurity', 'security_engineer_cloud', 'medium'],
    ['Informatiebeveiliging specialist', 'security_engineer_cloud', 'medium'],
    ['Cybersecurity-ingenjör', 'security_engineer_cloud', 'medium'],
    ['Informationssäkerhetsspecialist', 'security_engineer_cloud', 'medium'],
    ['IT-sikkerhedsingeniør', 'security_engineer_cloud', 'medium'],
    ['IT-sikkerhedsspecialist', 'security_engineer_cloud', 'medium'],
    ['Tietoturva-asiantuntija', 'security_engineer_cloud', 'medium'],
    ['Kyberturvallisuusasiantuntija', 'security_engineer_cloud', 'medium'],
    ['Inżynier cyberbezpieczeństwa', 'security_engineer_cloud', 'medium'],
    ['Specjalista ds. bezpieczeństwa IT', 'security_engineer_cloud', 'medium'],
    ['Specialista kybernetické bezpečnosti', 'security_engineer_cloud', 'medium'],
  ]);
});

describe('mapTitle — other security roles', () => {
  check([
    ['SOC Analyst', 'other_security', 'high'],
    ['Analyste SOC', 'other_security', 'high'],
    ['Analista SOC', 'other_security', 'high'],
    ['Security Operations Center Analyst L2', 'other_security', 'high'],
    ['Tier 1 SOC Analyst', 'other_security', 'high'],
    ['Level 3 SOC Analyst', 'other_security', 'high'],
    ['Penetration Tester', 'other_security', 'high'],
    ['Pentester', 'other_security', 'high'],
    ['Junior Pentester', 'other_security', 'high'],
    ['Ethical Hacker', 'other_security', 'high'],
    ['Threat Intelligence Analyst', 'other_security', 'high'],
    ['Incident Responder', 'other_security', 'high'],
    ['Detection Engineer', 'other_security', 'high'],
    ['Vulnerability Management Engineer', 'other_security', 'high'],
    ['Data Protection Officer', 'other_security', 'high'],
    ['Datenschutzbeauftragter (m/w/d)', 'other_security', 'high'],
    ['Security Analyst', 'other_security', 'medium'],
    ['Cyber Security Analyst', 'other_security', 'medium'],
    ['Analista de ciberseguridad', 'other_security', 'medium'],
    ['Network Security Engineer', 'other_security', 'medium'],
    ['OT Security Engineer', 'other_security', 'medium'],
    ['Cybersecurity Engineer - OT', 'other_security', 'low'],
    ['Werkstudent IT-Security (m/w/d)', 'other_security', 'low'],
    ['Praktikant Cybersecurity', 'other_security', 'low'],
  ]);
});

describe('mapTitle — false friends are never security targets', () => {
  check([
    ['Sales Engineer – Cloud Security', 'other', 'high'],
    ['Presales Engineer Security', 'other', 'high'],
    ['Solutions Engineer, Security', 'other', 'high'],
    ['Security Sales Specialist', 'other', 'high'],
    ['Account Executive - Cybersecurity', 'other', 'high'],
    ['Customer Success Manager - Cloud Security', 'other', 'high'],
    ['Technical Account Manager, Cloud Security', 'other', 'high'],
    ['Product Manager, Cloud Security', 'other', 'high'],
    ['Project Manager IT Security', 'other', 'high'],
    ['Cloud Security Program Manager', 'other', 'high'],
    ['Security Product Owner', 'other', 'high'],
    ['Security Recruiter', 'other', 'high'],
    ['Technical Recruiter - Security', 'other', 'high'],
    ['Lecturer in Cyber Security', 'other', 'high'],
    ['PhD position in cloud security', 'other', 'high'],
    ['Chef de projet sécurité', 'other', 'high'],
    ['Security Guard', 'other', 'high'],
    ['Security Guard (m/w/d)', 'other', 'high'],
    ['Airport Security Officer', 'other', 'high'],
    ['Physical Security Manager', 'other', 'high'],
    ['Social Security Specialist', 'other', 'high'],
    ['Social Security Claims Representative', 'other', 'high'],
    ['Payroll & Social Security Specialist', 'other', 'high'],
    ['Securities Analyst', 'other', 'high'],
    ['Software Engineer (Security Clearance)', 'other', 'high'],
    ['Security Officer', 'other', 'medium'],
    ['Wachmann', 'other', 'high'],
    ['Objektschutz', 'other', 'high'],
    ['Sicherheitsmitarbeiter (m/w/d)', 'other', 'high'],
    ['Fachkraft für Schutz und Sicherheit', 'other', 'high'],
    ['Arbeitssicherheit Fachkraft', 'other', 'high'],
    ['Sicherheitsfachkraft', 'other', 'high'],
    ['Brandschutzbeauftragter', 'other', 'high'],
    ['Produktsicherheit Ingenieur (IT)', 'other', 'high'],
    ['Agent de sécurité', 'other', 'high'],
    ['Vigile', 'other', 'high'],
    ['Agente de seguridad', 'other', 'high'],
    ['Vigilante de seguridad', 'other', 'high'],
    ['Beveiliger', 'other', 'high'],
    ['Health and Safety Manager', 'other', 'high'],
    ['HSE Engineer', 'other', 'high'],
    ['Food Safety Specialist', 'other', 'high'],
    ['Safety Engineer', 'other', 'high'],
    ['Functional Safety Engineer', 'other', 'high'],
    ['Fire Safety Engineer', 'other', 'high'],
  ]);
});

describe('mapTitle — fallback developer roles', () => {
  check([
    ['Full Stack Developer', 'fullstack_developer', 'high'],
    ['Full-Stack Developer', 'fullstack_developer', 'high'],
    ['Fullstack Engineer', 'fullstack_developer', 'high'],
    ['Full Stack Web Developer', 'fullstack_developer', 'high'],
    ['Full Stack Developer (React/Node)', 'fullstack_developer', 'high'],
    ['Full-Stack Engineer (TypeScript/Next.js)', 'fullstack_developer', 'high'],
    ['Fullstack-Entwickler', 'fullstack_developer', 'high'],
    ['Fullstack-Entwickler (m/w/d) Node.js / React', 'fullstack_developer', 'high'],
    ['EntwicklerIn Fullstack', 'fullstack_developer', 'high'],
    ['Développeur Fullstack', 'fullstack_developer', 'high'],
    ['Développeur Full Stack H/F', 'fullstack_developer', 'high'],
    ['Ingénieur full stack', 'fullstack_developer', 'high'],
    ['Desarrollador Full Stack', 'fullstack_developer', 'high'],
    ['Desarrollador Fullstack', 'fullstack_developer', 'high'],
    ['Desenvolvedor Full Stack', 'fullstack_developer', 'high'],
    ['Sviluppatore Full Stack', 'fullstack_developer', 'high'],
    ['Ontwikkelaar full stack', 'fullstack_developer', 'high'],
    ['Fullstack ontwikkelaar', 'fullstack_developer', 'high'],
    ['Fullstackutvecklare', 'fullstack_developer', 'high'],
    ['Full stack-udvikler', 'fullstack_developer', 'high'],
    ['Fullstack-utvikler', 'fullstack_developer', 'high'],
    ['Full Stack -kehittäjä', 'fullstack_developer'],
    ['Programista Full Stack', 'fullstack_developer', 'high'],
    ['Programista Fullstack', 'fullstack_developer', 'high'],
    ['Vývojář Full Stack', 'fullstack_developer', 'high'],
    ['Full-stack vývojář', 'fullstack_developer', 'high'],
    ['Next.js Developer', 'nextjs_developer', 'high'],
    ['NextJS Engineer', 'nextjs_developer', 'high'],
    ['React / Next.js Developer', 'nextjs_developer', 'high'],
    ['Next.js Entwickler', 'nextjs_developer', 'high'],
    ['Développeur Next.js', 'nextjs_developer', 'high'],
    ['Next.js / React Frontend Engineer', 'nextjs_developer', 'medium'],
    ['Node.js Developer', 'node_developer', 'high'],
    ['NodeJS Engineer', 'node_developer', 'high'],
    ['Node Developer', 'node_developer', 'high'],
    ['Node.js Backend Developer', 'node_developer', 'high'],
    ['Node.js Backend Engineer', 'node_developer', 'high'],
    ['TypeScript Node.js Developer', 'node_developer', 'high'],
    ['Backend-Entwickler Node.js', 'node_developer', 'high'],
    ['Développeur Node.js', 'node_developer', 'high'],
    ['Desarrollador Node.js', 'node_developer', 'high'],
    ['Backend Engineer (Node.js)', 'node_developer', 'medium'],
  ]);
});

describe('mapTitle — recognised non-target roles', () => {
  check([
    ['Software Engineer', 'other', 'high'],
    ['DevOps Engineer', 'other', 'high'],
    ['Site Reliability Engineer', 'other', 'high'],
    ['Platform Engineer', 'other', 'high'],
    ['TypeScript Developer', 'other', 'high'],
    ['React Developer', 'other', 'high'],
    ['Frontend Developer', 'other', 'high'],
    ['Java Developer', 'other', 'high'],
    ['C# Developer', 'other', 'high'],
    ['C++ Developer', 'other', 'high'],
    ['.NET Developer', 'other', 'high'],
    ['Sr. .NET Developer', 'other', 'high'],
    ['Marketing Manager', 'other', 'high'],
    ['Azure Cloud Engineer', 'other', 'medium'],
    ['Ingénieur Cloud', 'other', 'medium'],
    ['Cloud Solutions Architect', 'other', 'medium'],
    ['Kubernetes Engineer', 'other', 'medium'],
    ['Firewall Engineer', 'other', 'medium'],
    ['Compliance Manager', 'other', 'medium'],
    ['Risk Analyst', 'other', 'medium'],
  ]);
});

describe('mapTitle — unknown titles go to review, never to a guess', () => {
  check([
    ['Sicherheitsingenieur', null],
    ['Sikkerhedskonsulent', null],
    ['Bezpečnostní specialista', null],
    ['Auditeur sécurité', null],
    ['Head of Security', null],
    ['Security Champion', null],
    ['Principal Engineer', null],
    ['Engineer', null],
    ['Engineer I', null],
    ['Lead', null],
    ['LinkedIn Ads Specialist', null],
    ['Luchthavenbeveiliging', null],
    ['', null],
    ['   ', null],
    ['12345', null],
    ['!!!', null],
  ]);

  it('returns the unknown shape', () => {
    const r = mapTitle('Zauberer der Wolken');
    expect(r).toMatchObject({ roleKey: null, roleFamily: 'other', matched: null, confidence: 'low', unknown: true });
  });
});

describe('mapTitle — noise removal leaves the role unchanged', () => {
  const variants = [
    'Sr. Cloud Security Engineer II (m/w/d) - Remote',
    '(Senior) Cloud Security Engineer',
    'Cloud Security Engineer - Berlin, Germany',
    'Cloud Security Engineer (Remote, EU)',
    'Cloud Security Engineer - München',
    'Cloud Security Engineer | Amsterdam, NL',
    'Cloud Security Engineer (Paris) H/F CDI',
    'Cloud Security Engineer #LI-Remote',
    'Cloud Security Engineer (JR-12345)',
    'Cloud Security Engineer Req 123456',
    'Cloud Security Engineer, Hybrid',
    'Cloud Security Engineer (w/m/d) in Vollzeit',
    'Cloud Security Engineer (all genders)',
    'Cloud Security Engineer (gn)',
    'Cloud Security Engineer (f/m/x)',
    'Cloud Security Engineer (m/f/d) - 100% remote',
    'Cloud Security Engineer - Remote (Germany)',
    'Cloud Security Engineer (Remote - EMEA)',
    'Cloud Security Engineer - Zürich',
    'Cloud Security Engineer - New York, NY',
    'Cloud Security Engineer - Madrid - Híbrido',
    'Cloud Security Engineer (5+ years)',
    'Cloud Security Engineer 3-5 Jahre Erfahrung',
    'Cloud Security Engineer (min. 2 years experience)',
    'Hybrid Cloud Security Engineer',
    'Staff Cloud Security Engineer',
    'Senior/Lead Cloud Security Engineer',
  ];
  it.each(variants)('%s', (title) => {
    const r = mapTitle(title);
    expect(r.roleKey).toBe('cloud_security_engineer');
    expect(r.confidence).toBe('high');
  });

  it.each(variants.filter((t) => !t.startsWith('Hybrid')))('%s has the base key', (title) => {
    expect(normalizeTitleKey(title)).toBe('cloud security engineer');
  });
});

describe('normalizeTitleKey', () => {
  it.each([
    ['Cloud Security Engineer', 'cloud security engineer'],
    ['Hybrid Cloud Security Engineer', 'hybrid cloud security engineer'],
    ['Security Lead', 'security lead'],
    ['Lead Security Engineer', 'security engineer'],
    ['Tech Lead Cloud Security', 'tech lead cloud security'],
    ['Team Lead DevSecOps', 'lead devsecops'],
    ['CISO', 'ciso'],
    ['Cloud Security Engineer - ISO 27001', 'cloud security engineer iso27001'],
    ['ISO/IEC 27001 Lead Auditor', 'iso27001 auditor'],
    ['Ingénieur(e) sécurité cloud', 'ingenieur securite cloud'],
    ['Ingeniero/a de seguridad cloud', 'ingeniero seguridad cloud'],
    ['Inżynier ds. bezpieczeństwa chmury', 'inzynier bezpieczenstwa chmury'],
    ['C# Developer', 'csharp developer'],
    ['.NET Developer', 'dotnet developer'],
    ['Next.js Developer', 'next js developer'],
    ['Werkstudent (m/w/d) Cloud Security', 'cloud security'],
    ['12345', '12345'],
    ['', ''],
  ])('%s → %s', (title, key) => {
    expect(normalizeTitleKey(title)).toBe(key);
  });

  it('caps the key at 191 characters on a word boundary', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const key = normalizeTitleKey(long);
    expect(key.length).toBeLessThanOrEqual(191);
    expect(long.toLowerCase().startsWith(key)).toBe(true);
    expect(key.endsWith(' ')).toBe(false);
  });

  it('keeps the German gender-neutral forms equal to the masculine form', () => {
    const base = normalizeTitleKey('Entwickler Fullstack');
    for (const t of ['EntwicklerIn Fullstack', 'Entwickler*in Fullstack', 'Entwickler:in Fullstack', 'Entwickler/-in Fullstack', 'Entwickler(in) Fullstack']) {
      expect(normalizeTitleKey(t)).toBe(base);
    }
  });

  it('does not strip -In from words like LinkedIn', () => {
    expect(normalizeTitleKey('LinkedIn Ads Specialist')).toBe('linkedin ads specialist');
  });
});

describe('detectSeniority', () => {
  it.each([
    ['Junior Cloud Security Engineer', 'junior', false],
    ['Jr. Security Engineer', 'junior', false],
    ['Associate Security Consultant', 'junior', false],
    ['Werkstudent Cloud Security', 'junior', true],
    ['Praktikant Cybersecurity', 'junior', true],
    ['Stage - Ingénieur sécurité cloud', 'junior', true],
    ['Alternance DevSecOps', 'junior', true],
    ['Graduate Security Engineer', 'junior', true],
    ['Security Intern', 'junior', true],
    ['Becario ciberseguridad', 'junior', true],
    ['Stagista sicurezza informatica', 'junior', true],
    ['Stażysta ds. bezpieczeństwa', 'junior', true],
    ['Engineer I', 'junior', false],
    ['Tier 1 SOC Analyst', 'junior', false],
    ['Security Engineer II', 'mid', false],
    ['Security Engineer 2', 'mid', false],
    ['Mid-level DevSecOps Engineer', 'mid', false],
    ['Medior Security Engineer', 'mid', false],
    ['Ingénieur sécurité confirmé', 'mid', false],
    ['Desarrollador Semi Senior', 'mid', false],
    ['Security Operations Center Analyst L2', 'mid', false],
    ['Senior Security Engineer', 'senior', false],
    ['Sr. Cloud Security Engineer', 'senior', false],
    ['Security Engineer (Senior)', 'senior', false],
    ['Security Engineer III', 'senior', false],
    ['Level 3 SOC Analyst', 'senior', false],
    ['Starszy inżynier bezpieczeństwa', 'senior', false],
    ['Staff Security Engineer', 'lead', false],
    ['Sr Staff Security Engineer', 'lead', false],
    ['Lead AppSec Engineer', 'lead', false],
    ['Security Engineer IV', 'lead', false],
    ['Teamleiter IT-Sicherheit', 'lead', false],
    ['Principal Security Engineer', 'principal', false],
    ['Senior Principal Security Engineer', 'principal', false],
    ['Head of Cloud Security', 'principal', false],
    ['Director of Security Engineering', 'principal', false],
    ['CISO', 'principal', false],
    ['Security Engineer V', 'principal', false],
    ['Cloud Security Engineer', null, false],
    ['Security Engineer, Tier 2 Support', 'mid', false],
  ] as const)('%s → %s', (title, word, entry) => {
    const s = detectSeniority(title);
    expect(s.word).toBe(word);
    expect(s.entry).toBe(entry);
    if (word) expect(s.matched).toBeTruthy();
  });

  it('ignores level numerals that are not attached to a role word', () => {
    expect(detectSeniority('Cloud Security Engineer - Building 2').word).toBeNull();
    expect(detectSeniority('Security Engineer, Team 2 Berlin').word).toBeNull();
    expect(detectSeniority('I Love Security').word).toBeNull();
  });

  it('is reported by mapTitle', () => {
    expect(mapTitle('Sr. Cloud Security Engineer II (m/w/d) - Remote').seniorityWord).toBe('senior');
    expect(mapTitle('Senior/Lead Cloud Security Engineer').seniorityWord).toBe('lead');
  });
});

describe('mapTitle — language, matched text and family', () => {
  it.each([
    ['Cloud Security Engineer', 'en'],
    ['Cloud-Sicherheitsingenieur', 'de'],
    ['Ingénieur sécurité cloud', 'fr'],
    ['Ingénieur Cloud', 'fr'],
    ['Ingeniero de Seguridad en la Nube', 'es'],
    ['Engenheiro de Segurança Cloud', 'pt'],
    ['Analista de Segurança Cloud', 'pt'],
    ['Analista sicurezza cloud', 'it'],
    ['Cloud beveiligingsingenieur', 'nl'],
    ['Molnsäkerhetsingenjör', 'sv'],
    ['Cloud-sikkerhedsingeniør', 'da'],
    ['Pilvitietoturvainsinööri', 'fi'],
    ['Inżynier bezpieczeństwa chmury', 'pl'],
    ['Inženýr cloudové bezpečnosti', 'cs'],
    ['Specialista bezpečnosti aplikací', 'cs'],
  ])('%s → %s', (title, lang) => {
    expect(mapTitle(title).lang).toBe(lang);
  });

  it('has no language when nothing was recognised', () => {
    expect(mapTitle('12345').lang).toBeNull();
  });

  it('reports the words that decided', () => {
    expect(mapTitle('Sr. Cloud Security Engineer II (m/w/d) - Remote').matched).toBe('Cloud Security Engineer');
    expect(mapTitle('Sales Engineer – Cloud Security').matched).toBe('Sales Engineer');
    expect(mapTitle('Software Engineer (Security Clearance)').matched).toBe('Software Engineer');
    expect(mapTitle('Sicherheitsingenieur').matched).toBeNull();
  });

  it('assigns families from DEFAULT_TARGET_ROLES', () => {
    expect(mapTitle('Cloud Security Engineer').roleFamily).toBe('primary');
    expect(mapTitle('Cloud Security Analyst').roleFamily).toBe('secondary');
    expect(mapTitle('Next.js Developer').roleFamily).toBe('fallback');
    expect(mapTitle('SOC Analyst').roleFamily).toBe('other');
    expect(mapTitle('Security Guard').roleFamily).toBe('other');
  });

  it('honours custom target role lists', () => {
    const lists = { primary: ['node_developer'], secondary: ['cloud_security_engineer'], fallback: [] };
    expect(mapTitle('Node.js Developer', null, lists).roleFamily).toBe('primary');
    expect(mapTitle('Cloud Security Engineer', null, lists).roleFamily).toBe('secondary');
    expect(mapTitle('DevSecOps Engineer', null, lists).roleFamily).toBe('other');
  });

  it('familyForRole matches the role catalogue defaults', () => {
    for (const role of ROLES) expect(familyForRole(role.key)).toBe(role.defaultFamily);
    expect(familyForRole(null)).toBe('other');
    expect(familyForRole('unknown_role')).toBe('other');
    const all = [...DEFAULT_TARGET_ROLES.primary, ...DEFAULT_TARGET_ROLES.secondary, ...DEFAULT_TARGET_ROLES.fallback];
    for (const key of all) expect(ROLE_KEYS).toContain(key);
  });
});

describe('mapTitle — manual overrides (settings title_overrides)', () => {
  const overrides: TitleOverrides = titleOverridesSchema.parse({
    sicherheitsingenieur: { roleKey: 'security_engineer_cloud', roleFamily: 'secondary', note: 'reviewed' },
    'security champion': { roleKey: 'appsec_engineer', roleFamily: 'primary', seniorityWord: 'mid' },
    'security engineer': { roleKey: 'other', roleFamily: 'other' },
  });

  it('applies an override by normalized key, ignoring noise', () => {
    for (const t of ['Sicherheitsingenieur', 'Sicherheitsingenieur (m/w/d) - Berlin', 'Senior Sicherheitsingenieur']) {
      const r = mapTitle(t, overrides);
      expect(r).toMatchObject({ roleKey: 'security_engineer_cloud', roleFamily: 'secondary', matched: 'manual override', confidence: 'high', unknown: false });
    }
  });

  it('keeps detected seniority unless the override sets one', () => {
    expect(mapTitle('Senior Sicherheitsingenieur', overrides).seniorityWord).toBe('senior');
    expect(mapTitle('Senior Security Champion', overrides).seniorityWord).toBe('mid');
  });

  it('beats the dictionary', () => {
    expect(mapTitle('Security Engineer', overrides).roleKey).toBe('other');
    expect(mapTitle('Security Engineer').roleKey).toBe('security_engineer_cloud');
  });

  it('can mark a title as reviewed-but-unmapped with a null role', () => {
    const o = titleOverridesSchema.parse({ 'zauberer wolken': { roleKey: null, roleFamily: 'other' } });
    const r = mapTitle('Zauberer der Wolken', o);
    expect(r.roleKey).toBeNull();
    expect(r.unknown).toBe(false);
    expect(r.matched).toBe('manual override');
  });

  it('is pure: the same input gives the same output and the overrides object is untouched', () => {
    const before = JSON.stringify(overrides);
    expect(mapTitle('Sicherheitsingenieur', overrides)).toEqual(mapTitle('Sicherheitsingenieur', overrides));
    expect(JSON.stringify(overrides)).toBe(before);
    expect(mapTitle('Sicherheitsingenieur', {}).unknown).toBe(true);
    expect(mapTitle('Sicherheitsingenieur', null).unknown).toBe(true);
  });
});

describe('mapTitle — robustness', () => {
  it('handles hostile and huge inputs quickly', () => {
    const inputs = [
      'a'.repeat(20000),
      'Security '.repeat(3000),
      '(m/w/d)'.repeat(500),
      'Sicherheitssicherheitssicherheitssicherheitssicherheitsingenieur',
      '\u0000‮ Cloud Security Engineer ​',
      '🔒 Cloud Security Engineer 🚀',
      'クラウドセキュリティエンジニア',
      'Инженер по облачной безопасности',
    ];
    const start = Date.now();
    for (const t of inputs) {
      const r = mapTitle(t);
      expect(typeof r.unknown).toBe('boolean');
      expect(normalizeTitleKey(t).length).toBeLessThanOrEqual(191);
    }
    expect(mapTitle('🔒 Cloud Security Engineer 🚀').roleKey).toBe('cloud_security_engineer');
    expect(mapTitle('\u0000‮ Cloud Security Engineer ​').roleKey).toBe('cloud_security_engineer');
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('maps a thousand titles in well under a second each batch', () => {
    const titles = Array.from({ length: 1000 }, (_, i) => `Senior Cloud Security Engineer ${i % 2 ? '(m/w/d)' : '- Remote'} Team ${i}`);
    const start = Date.now();
    for (const t of titles) mapTitle(t);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('explains how a title was read', () => {
    const e = explainTitle('Security Engineer - Cloud');
    expect(e.key).toBe('security engineer cloud');
    expect(e.head).toBe('Engineer');
    expect(e.mainSegment).toBe(0);
    expect(e.tags.map((t) => t.concept)).toEqual(['SEC', 'H_ENG', 'CLOUD']);
  });

  it('has a dated logic version', () => {
    expect(TITLE_LOGIC_VERSION).toMatch(/^title@\d{4}-\d{2}-\d{2}\.\d+$/);
  });
});
