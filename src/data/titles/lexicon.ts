/**
 * Multilingual title vocabulary (EN, DE, FR, NL, ES, PT, IT, SV, DA, NO, FI, PL, CS).
 *
 * Every term maps to one concept. The title mapper tags the words of a title with concepts and
 * then decides the role from the combination and order of concepts, so "Cloud Security
 * Engineer", "Ingénieur sécurité cloud", "Cloud-Sicherheitsingenieur" and "Inżynier
 * bezpieczeństwa chmury" all end up as the same role without listing every permutation.
 *
 * Terms are written naturally (accents included) and folded at load time. Multi-word terms are
 * matched as phrases after dropping stop words ("seguridad de aplicaciones" → "seguridad
 * aplicaciones"). `compound: true` terms may also appear inside Germanic/Nordic/Finnish compounds
 * ("Informationssicherheitsbeauftragter", "säkerhetsingenjör", "tietoturva-asiantuntija").
 * `compoundOnly` terms are too ambiguous alone (Danish/Norwegian "sky" = cloud).
 */

export type Concept =
  /** Unambiguous IT-security words (cyber, infosec, tietoturva, …). */
  | 'SEC_CYBER'
  /** English "security": IT security in tech titles, but also guarding ("Security Officer"). */
  | 'SEC'
  /** Words meaning both safety and security (Sicherheit, sécurité, seguridad, veiligheid …). */
  | 'SEC_AMBIG'
  | 'TECH'
  | 'CLOUD'
  | 'CONTAINER'
  | 'DEVSECOPS'
  | 'DEVOPS'
  | 'SRE'
  | 'PLATFORM'
  | 'INFRA'
  | 'AUTOMATION'
  | 'PIPELINE'
  | 'APPSEC'
  | 'APPLICATION'
  | 'SOFTWARE'
  | 'PRODSEC'
  | 'PRODUCT'
  | 'GRC_STRONG'
  | 'GRC'
  | 'IAM'
  | 'NETWORK'
  | 'SOC'
  | 'OFFENSIVE'
  | 'DEFENSIVE'
  | 'VULN'
  | 'PRIVACY'
  | 'CRYPTO'
  | 'OT'
  | 'H_ENG'
  | 'H_SPEC'
  | 'H_ARCH'
  | 'H_CONSULT'
  | 'H_ANALYST'
  | 'H_DEV'
  | 'H_ADMIN'
  | 'H_MANAGER'
  | 'H_OFFICER'
  | 'H_AUDITOR'
  | 'H_TESTER'
  | 'H_RESEARCHER'
  | 'H_TECH'
  | 'H_LEAD'
  | 'H_OPERATOR'
  | 'H_SUPERVISOR'
  | 'FULLSTACK'
  | 'NEXTJS'
  | 'NODE'
  | 'FRONTEND'
  | 'BACKEND'
  | 'JS'
  /** Modifiers that make a head noun a recognised non-target role (data, mechanical, SAP …). */
  | 'NONTARGET'
  /** Guarding / physical security ("Security Guard", "Agent de sécurité", "Werkschutz"). */
  | 'NEG_GUARD'
  /** Occupational / functional safety, HSE, fire protection. */
  | 'NEG_SAFETY'
  /** Social security, securities (finance), food/energy security policy. */
  | 'NEG_SOCIAL'
  /** Sales-side roles anywhere in the title ("Sales Engineer – Cloud Security", "Pre-Sales"). */
  | 'NEG_SALES'
  /** A bare sales word; negative only in the main segment ("Sales – Cloud Security"). */
  | 'NEG_SALES_WORD'
  /** Non-engineering roles (product/project manager, recruiter, teacher, PhD). Main segment only. */
  | 'NEG_NONTECH'
  /** Words consumed and ignored (clearance levels: "SC Clearance", "Sicherheitsüberprüfung Ü2"). */
  | 'IGNORE';

export interface TermGroup {
  concept: Concept;
  /** ISO 639-1; 'en' words are also used inside other languages' titles. */
  lang: string;
  terms: readonly string[];
  compound?: boolean;
  compoundOnly?: boolean;
}

export const HEAD_CONCEPTS: readonly Concept[] = [
  'H_ENG', 'H_SPEC', 'H_ARCH', 'H_CONSULT', 'H_ANALYST', 'H_DEV', 'H_ADMIN', 'H_MANAGER', 'H_OFFICER', 'H_AUDITOR', 'H_TESTER',
  'H_RESEARCHER', 'H_TECH', 'H_LEAD', 'H_OPERATOR', 'H_SUPERVISOR',
];

export const TERM_GROUPS: readonly TermGroup[] = [
  // ── Security words ──────────────────────────────────────────────────────────────────────
  { concept: 'SEC_CYBER', lang: 'en', compound: true, terms: ['cybersecurity', 'cyber', 'cybersec', 'infosec', 'itsec', 'information security', 'it security', 'cyber security', 'data security', 'cyber defense', 'cyber defence'] },
  { concept: 'SEC_CYBER', lang: 'de', compound: true, terms: ['Cybersicherheit', 'Informationssicherheit', 'IT-Sicherheit', 'ITSicherheit', 'Datensicherheit', 'Cyber-Sicherheit', 'Informationssicherheits'] },
  { concept: 'SEC_CYBER', lang: 'fr', compound: true, terms: ['cybersécurité', 'cyberdéfense', 'SSI', 'sécurité informatique', 'sécurité des systèmes d’information', 'sécurité SI'] },
  { concept: 'SEC_CYBER', lang: 'es', compound: true, terms: ['ciberseguridad', 'cibernética', 'seguridad informática', 'seguridad de la información', 'seguridad TI'] },
  { concept: 'SEC_CYBER', lang: 'pt', compound: true, terms: ['cibersegurança', 'segurança cibernética', 'segurança da informação', 'segurança de TI'] },
  { concept: 'SEC_CYBER', lang: 'it', compound: true, terms: ['cybersicurezza', 'sicurezza informatica', 'sicurezza delle informazioni', 'sicurezza IT'] },
  { concept: 'SEC_CYBER', lang: 'nl', compound: true, terms: ['cyberbeveiliging', 'informatiebeveiliging', 'IT-beveiliging', 'informatieveiligheid', 'cyberveiligheid', 'cybersecurity'] },
  { concept: 'SEC_CYBER', lang: 'sv', compound: true, terms: ['cybersäkerhet', 'informationssäkerhet', 'IT-säkerhet', 'itsäkerhet'] },
  { concept: 'SEC_CYBER', lang: 'da', compound: true, terms: ['cybersikkerhed', 'informationssikkerhed', 'IT-sikkerhed', 'itsikkerhed'] },
  { concept: 'SEC_CYBER', lang: 'no', compound: true, terms: ['cybersikkerhet', 'informasjonssikkerhet', 'IT-sikkerhet', 'itsikkerhet', 'datasikkerhet'] },
  { concept: 'SEC_CYBER', lang: 'fi', compound: true, terms: ['tietoturva', 'tietoturvallisuus', 'kyberturvallisuus', 'kyberturva', 'tietoturvan'] },
  { concept: 'SEC_CYBER', lang: 'pl', compound: true, terms: ['cyberbezpieczeństwo', 'cyberbezpieczeństwa', 'bezpieczeństwo IT', 'bezpieczeństwa IT', 'bezpieczeństwa informacji'] },
  { concept: 'SEC_CYBER', lang: 'cs', compound: true, terms: ['kyberbezpečnost', 'kyberbezpečnosti', 'bezpečnost IT', 'informační bezpečnost', 'bezpečnosti IT', 'kybernetická bezpečnost', 'kybernetické bezpečnosti', 'informační bezpečnosti'] },

  { concept: 'SEC', lang: 'en', compound: true, terms: ['security', 'secure', 'sec'] },

  { concept: 'SEC_AMBIG', lang: 'de', compound: true, terms: ['Sicherheit', 'Sicherheits'] },
  { concept: 'SEC_AMBIG', lang: 'fr', compound: true, terms: ['sécurité'] },
  { concept: 'SEC_AMBIG', lang: 'es', compound: true, terms: ['seguridad'] },
  { concept: 'SEC_AMBIG', lang: 'pt', compound: true, terms: ['segurança'] },
  { concept: 'SEC_AMBIG', lang: 'it', compound: true, terms: ['sicurezza'] },
  { concept: 'SEC_AMBIG', lang: 'nl', compound: true, terms: ['beveiliging', 'beveiligings'] },
  { concept: 'SEC_AMBIG', lang: 'sv', compound: true, terms: ['säkerhet', 'säkerhets'] },
  { concept: 'SEC_AMBIG', lang: 'da', compound: true, terms: ['sikkerhed', 'sikkerheds'] },
  { concept: 'SEC_AMBIG', lang: 'no', compound: true, terms: ['sikkerhet', 'sikkerhets'] },
  { concept: 'SEC_AMBIG', lang: 'fi', compound: true, terms: ['turvallisuus', 'turvallisuuden'] },
  { concept: 'SEC_AMBIG', lang: 'pl', compound: true, terms: ['bezpieczeństwo', 'bezpieczeństwa', 'bezpieczeństwem'] },
  { concept: 'SEC_AMBIG', lang: 'cs', compound: true, terms: ['bezpečnost', 'bezpečnosti', 'bezpečnostní'] },

  // ── Context words ───────────────────────────────────────────────────────────────────────
  { concept: 'TECH', lang: 'en', compound: true, terms: ['IT', 'ICT', 'information', 'informations', 'technology', 'technologies', 'tech', 'digital', 'systems', 'system', 'computer', 'data', 'endpoint', 'email'] },
  { concept: 'TECH', lang: 'de', compound: true, terms: ['Informationstechnik', 'Informationstechnologie', 'Informatik', 'Daten', 'Systeme', 'digitale', 'Rechenzentrum', 'EDV'] },
  { concept: 'TECH', lang: 'fr', compound: true, terms: ['informatique', 'informatiques', 'SI', 'systèmes', 'système', 'numérique', 'données', 'TIC'] },
  { concept: 'TECH', lang: 'es', compound: true, terms: ['informática', 'informático', 'información', 'TI', 'sistemas', 'datos', 'tecnología', 'tecnologías', 'TIC'] },
  { concept: 'TECH', lang: 'pt', compound: true, terms: ['informação', 'tecnologia', 'dados', 'sistemas'] },
  { concept: 'TECH', lang: 'it', compound: true, terms: ['informatica', 'informatico', 'informazioni', 'informazione', 'dati', 'sistemi', 'tecnologia'] },
  { concept: 'TECH', lang: 'nl', compound: true, terms: ['informatie', 'informatica', 'gegevens', 'systemen', 'ICT'] },
  { concept: 'TECH', lang: 'sv', compound: true, terms: ['information', 'system', 'data'] },
  { concept: 'TECH', lang: 'da', compound: true, terms: ['informations', 'systemer'] },
  { concept: 'TECH', lang: 'no', compound: true, terms: ['informasjon', 'informasjons', 'systemer'] },
  { concept: 'TECH', lang: 'fi', compound: true, terms: ['tietotekniikka', 'tietojärjestelmä', 'järjestelmä', 'järjestelmien', 'tieto'] },
  { concept: 'TECH', lang: 'pl', compound: true, terms: ['informatyka', 'informatyczne', 'informatycznych', 'informacji', 'systemów', 'systemy', 'danych'] },
  { concept: 'TECH', lang: 'cs', compound: true, terms: ['informační', 'informačních', 'systémů', 'dat'] },

  { concept: 'CLOUD', lang: 'en', compound: true, terms: ['cloud', 'clouds', 'AWS', 'Azure', 'GCP', 'multicloud', 'multi-cloud', 'hybrid cloud', 'IaaS', 'PaaS', 'OpenStack', 'Amazon Web Services', 'Google Cloud'] },
  { concept: 'CLOUD', lang: 'es', compound: true, terms: ['nube'] },
  { concept: 'CLOUD', lang: 'pt', compound: true, terms: ['nuvem'] },
  { concept: 'CLOUD', lang: 'sv', compound: true, terms: ['moln'] },
  { concept: 'CLOUD', lang: 'sv', terms: ['molnet', 'molntjänster'] },
  { concept: 'CLOUD', lang: 'da', compound: true, compoundOnly: true, terms: ['sky'] },
  { concept: 'CLOUD', lang: 'fi', compound: true, terms: ['pilvi', 'pilvipalvelu', 'pilvipalvelut', 'pilvipalvelujen'] },
  { concept: 'CLOUD', lang: 'pl', compound: true, terms: ['chmura', 'chmury', 'chmurze', 'chmurowy', 'chmurowe', 'chmurowych', 'chmurowej'] },
  { concept: 'CLOUD', lang: 'cs', compound: true, terms: ['cloudu', 'cloudové', 'cloudových', 'cloudová'] },

  { concept: 'CONTAINER', lang: 'en', compound: true, terms: ['Kubernetes', 'K8s', 'container', 'containers', 'Docker', 'EKS', 'AKS', 'GKE', 'OpenShift', 'serverless'] },
  { concept: 'DEVSECOPS', lang: 'en', compound: true, terms: ['DevSecOps', 'SecDevOps', 'DevSec', 'Dev Sec Ops', 'Sec Dev Ops'] },
  { concept: 'DEVOPS', lang: 'en', compound: true, terms: ['DevOps', 'Dev Ops'] },
  { concept: 'SRE', lang: 'en', terms: ['SRE', 'site reliability', 'reliability'] },
  { concept: 'PLATFORM', lang: 'en', compound: true, terms: ['platform', 'platforms'] },
  { concept: 'PLATFORM', lang: 'de', compound: true, terms: ['Plattform', 'Plattformen'] },
  { concept: 'PLATFORM', lang: 'fr', terms: ['plateforme', 'plateformes'] },
  { concept: 'PLATFORM', lang: 'es', terms: ['plataforma', 'plataformas'] },
  { concept: 'PLATFORM', lang: 'it', terms: ['piattaforma', 'piattaforme'] },
  { concept: 'PLATFORM', lang: 'pl', terms: ['platforma', 'platformy'] },
  { concept: 'INFRA', lang: 'en', compound: true, terms: ['infrastructure', 'infra'] },
  { concept: 'INFRA', lang: 'de', compound: true, terms: ['Infrastruktur'] },
  { concept: 'INFRA', lang: 'es', terms: ['infraestructura'] },
  { concept: 'INFRA', lang: 'pt', terms: ['infraestrutura'] },
  { concept: 'INFRA', lang: 'it', terms: ['infrastruttura', 'infrastrutture'] },
  { concept: 'INFRA', lang: 'nl', terms: ['infrastructuur'] },
  { concept: 'INFRA', lang: 'pl', terms: ['infrastruktura', 'infrastruktury'] },
  { concept: 'INFRA', lang: 'fi', terms: ['infrastruktuuri'] },
  { concept: 'AUTOMATION', lang: 'en', compound: true, terms: ['automation'] },
  { concept: 'AUTOMATION', lang: 'de', compound: true, terms: ['Automatisierung'] },
  { concept: 'AUTOMATION', lang: 'fr', terms: ['automatisation'] },
  { concept: 'AUTOMATION', lang: 'es', terms: ['automatización'] },
  { concept: 'AUTOMATION', lang: 'pt', terms: ['automação'] },
  { concept: 'AUTOMATION', lang: 'it', terms: ['automazione'] },
  { concept: 'AUTOMATION', lang: 'nl', terms: ['automatisering'] },
  { concept: 'PIPELINE', lang: 'en', terms: ['pipeline', 'pipelines', 'CI/CD', 'CICD', 'software supply chain'] },
  { concept: 'DEVSECOPS', lang: 'en', terms: ['supply chain security', 'software supply chain security', 'build security', 'pipeline security', 'CI/CD security'] },

  { concept: 'APPSEC', lang: 'en', terms: ['AppSec', 'application security', 'applications security', 'app security', 'software security', 'secure software', 'secure development', 'secure coding', 'secure code', 'web application security', 'web security', 'API security', 'mobile security', 'mobile application security', 'SSDLC', 'secure SDLC'] },
  { concept: 'APPSEC', lang: 'de', compound: true, terms: ['Anwendungssicherheit', 'Applikationssicherheit', 'Softwaresicherheit', 'Application-Security', 'Anwendungs-Sicherheit'] },
  { concept: 'APPSEC', lang: 'fr', terms: ['sécurité applicative', 'sécurité des applications', 'sécurité logicielle', 'sécurité du logiciel', 'sécurité des applications web'] },
  { concept: 'APPSEC', lang: 'es', terms: ['seguridad de aplicaciones', 'seguridad en aplicaciones', 'seguridad del software', 'seguridad de software', 'seguridad de aplicaciones web'] },
  { concept: 'APPSEC', lang: 'pt', terms: ['segurança de aplicações', 'segurança de aplicação', 'segurança de software', 'segurança de aplicativos'] },
  { concept: 'APPSEC', lang: 'it', terms: ['sicurezza applicativa', 'sicurezza delle applicazioni', 'sicurezza del software'] },
  { concept: 'APPSEC', lang: 'nl', compound: true, terms: ['applicatiebeveiliging', 'applicatie beveiliging', 'softwarebeveiliging'] },
  { concept: 'APPSEC', lang: 'sv', compound: true, terms: ['applikationssäkerhet', 'mjukvarusäkerhet'] },
  { concept: 'APPSEC', lang: 'da', compound: true, terms: ['applikationssikkerhed', 'softwaresikkerhed'] },
  { concept: 'APPSEC', lang: 'no', compound: true, terms: ['applikasjonssikkerhet', 'programvaresikkerhet'] },
  { concept: 'APPSEC', lang: 'fi', compound: true, terms: ['sovellusturvallisuus', 'sovellustietoturva', 'ohjelmistoturvallisuus'] },
  { concept: 'APPSEC', lang: 'pl', terms: ['bezpieczeństwo aplikacji', 'bezpieczeństwa aplikacji', 'bezpieczeństwa oprogramowania'] },
  { concept: 'APPSEC', lang: 'cs', terms: ['bezpečnost aplikací', 'bezpečnosti aplikací', 'bezpečnost softwaru'] },

  { concept: 'APPLICATION', lang: 'en', compound: true, terms: ['application', 'applications', 'app', 'apps', 'web', 'API', 'APIs', 'mobile'] },
  { concept: 'APPLICATION', lang: 'de', compound: true, terms: ['Anwendung', 'Anwendungen', 'Anwendungs', 'Applikation', 'Applikationen', 'Applikations'] },
  { concept: 'APPLICATION', lang: 'fr', terms: ['applicative', 'applicatif', 'applications'] },
  { concept: 'APPLICATION', lang: 'es', terms: ['aplicación', 'aplicaciones'] },
  { concept: 'APPLICATION', lang: 'pt', terms: ['aplicação', 'aplicações', 'aplicativos'] },
  { concept: 'APPLICATION', lang: 'it', terms: ['applicazione', 'applicazioni', 'applicativa', 'applicativo'] },
  { concept: 'APPLICATION', lang: 'nl', compound: true, terms: ['applicatie', 'applicaties'] },
  { concept: 'APPLICATION', lang: 'no', compound: true, terms: ['applikasjon', 'applikasjoner'] },
  { concept: 'APPLICATION', lang: 'fi', compound: true, terms: ['sovellus', 'sovellusten'] },
  { concept: 'APPLICATION', lang: 'pl', terms: ['aplikacji', 'aplikacja', 'aplikacje'] },
  { concept: 'APPLICATION', lang: 'cs', terms: ['aplikace', 'aplikací'] },
  { concept: 'SOFTWARE', lang: 'en', compound: true, terms: ['software', 'softwares'] },
  { concept: 'SOFTWARE', lang: 'fr', terms: ['logiciel', 'logiciels', 'logicielle'] },
  { concept: 'SOFTWARE', lang: 'fi', compound: true, terms: ['ohjelmisto', 'ohjelmistot'] },
  { concept: 'SOFTWARE', lang: 'pl', terms: ['oprogramowania', 'oprogramowanie'] },
  { concept: 'SOFTWARE', lang: 'sv', compound: true, terms: ['programvara', 'mjukvara'] },
  { concept: 'SOFTWARE', lang: 'no', compound: true, terms: ['programvare'] },
  { concept: 'SOFTWARE', lang: 'cs', terms: ['softwaru', 'softwarový'] },

  { concept: 'PRODSEC', lang: 'en', terms: ['product security', 'ProdSec', 'product cybersecurity', 'product cyber security', 'product security incident response'] },
  { concept: 'PRODSEC', lang: 'de', terms: ['Produkt Security', 'Produkt-Cybersecurity', 'Produkt Cyber Security', 'Produkt-IT-Sicherheit'] },
  { concept: 'PRODSEC', lang: 'fr', terms: ['sécurité produit', 'sécurité des produits'] },
  { concept: 'PRODSEC', lang: 'es', terms: ['seguridad de producto', 'seguridad de productos'] },
  { concept: 'PRODSEC', lang: 'pt', terms: ['segurança de produto', 'segurança de produtos'] },
  { concept: 'PRODSEC', lang: 'it', terms: ['sicurezza di prodotto', 'sicurezza del prodotto'] },
  { concept: 'PRODSEC', lang: 'nl', terms: ['productbeveiliging', 'product beveiliging'] },
  { concept: 'PRODUCT', lang: 'en', compound: true, terms: ['product', 'products'] },
  { concept: 'PRODUCT', lang: 'de', compound: true, terms: ['Produkt', 'Produkte'] },
  { concept: 'PRODUCT', lang: 'fr', terms: ['produit', 'produits'] },
  { concept: 'PRODUCT', lang: 'es', terms: ['producto', 'productos'] },

  { concept: 'GRC_STRONG', lang: 'en', terms: ['GRC', 'governance risk compliance', 'governance risk and compliance', 'security governance', 'security compliance', 'cloud compliance', 'IT compliance', 'IT audit', 'IT auditor', 'IT risk', 'cyber risk', 'security risk', 'technology risk', 'tech risk', 'information risk', 'ISMS', 'ISO 27001', 'ISO27001', 'information security officer', 'information security manager', 'CISO', 'SOC 2', 'SOC2', 'FedRAMP', 'NIS2', 'DORA', 'TISAX', 'PCI DSS', 'third party risk', 'TPRM', 'vendor risk'] },
  { concept: 'GRC_STRONG', lang: 'de', compound: true, terms: ['Informationssicherheitsbeauftragter', 'Informationssicherheitsbeauftragte', 'ISB', 'IT-Sicherheitsbeauftragter', 'IT-Sicherheitsbeauftragte', 'IT-Grundschutz', 'Grundschutz', 'BSI-Grundschutz', 'IT-Revision', 'IT-Revisor', 'IT-Prüfer', 'ISMS-Manager', 'ISMS-Beauftragter'] },
  { concept: 'GRC_STRONG', lang: 'fr', terms: ['RSSI', 'gouvernance risques conformité', 'conformité SSI', 'risques cyber', 'gouvernance SSI', 'GRC'] },
  { concept: 'GRC_STRONG', lang: 'es', terms: ['gobierno riesgo cumplimiento', 'cumplimiento normativo TI', 'riesgos tecnológicos', 'CISO'] },
  { concept: 'GRC_STRONG', lang: 'pt', terms: ['governança riscos conformidade', 'riscos cibernéticos'] },
  { concept: 'GRC_STRONG', lang: 'it', terms: ['governance rischi compliance', 'rischio informatico'] },
  { concept: 'GRC', lang: 'en', compound: true, terms: ['governance', 'compliance', 'risk', 'risks', 'audit', 'audits', 'auditing', 'assurance', 'regulatory', 'controls', 'NIST', 'HIPAA', 'PCI', 'CMMC'] },
  { concept: 'GRC', lang: 'de', compound: true, terms: ['Risiko', 'Risiken', 'Revision', 'Regulatorik', 'Konformität'] },
  { concept: 'GRC', lang: 'fr', terms: ['gouvernance', 'conformité', 'risque', 'risques'] },
  { concept: 'GRC', lang: 'es', terms: ['gobierno', 'cumplimiento', 'conformidad', 'riesgo', 'riesgos', 'auditoría'] },
  { concept: 'GRC', lang: 'pt', terms: ['governança', 'conformidade', 'risco', 'riscos', 'auditoria'] },
  { concept: 'GRC', lang: 'it', terms: ['conformità', 'rischio', 'rischi'] },
  { concept: 'GRC', lang: 'nl', compound: true, terms: ['naleving', 'risico', 'risico\'s', 'risicomanagement'] },
  { concept: 'GRC', lang: 'sv', compound: true, terms: ['risk', 'regelefterlevnad', 'efterlevnad'] },
  { concept: 'GRC', lang: 'da', compound: true, terms: ['risiko', 'overholdelse'] },
  { concept: 'GRC', lang: 'fi', compound: true, terms: ['riski', 'riskienhallinta', 'vaatimustenmukaisuus'] },
  { concept: 'GRC', lang: 'pl', terms: ['ryzyko', 'ryzyka', 'zgodności', 'zgodność', 'audytu', 'audyt'] },
  { concept: 'GRC', lang: 'cs', terms: ['riziko', 'rizik', 'shoda', 'auditu'] },

  { concept: 'IAM', lang: 'en', compound: true, terms: ['IAM', 'identity and access management', 'identity access management', 'identity & access management', 'access management', 'identity management', 'identity governance', 'identity security', 'identity engineer', 'identity architect', 'PAM', 'privileged access', 'IGA', 'CIAM', 'SSO'] },
  { concept: 'IAM', lang: 'de', compound: true, terms: ['Identitätsmanagement', 'Berechtigungsmanagement', 'Zugriffsmanagement'] },
  { concept: 'IAM', lang: 'fr', terms: ['gestion des identités', 'gestion des accès', 'identités et accès'] },
  { concept: 'IAM', lang: 'es', terms: ['gestión de identidades', 'identidades y accesos'] },

  { concept: 'NETWORK', lang: 'en', compound: true, terms: ['network', 'networks', 'networking', 'firewall', 'firewalls', 'perimeter'] },
  { concept: 'NETWORK', lang: 'de', compound: true, terms: ['Netzwerk', 'Netzwerke', 'Netzwerks', 'Netz'] },
  { concept: 'NETWORK', lang: 'fr', terms: ['réseau', 'réseaux'] },
  { concept: 'NETWORK', lang: 'es', terms: ['redes'] },
  { concept: 'NETWORK', lang: 'pt', terms: ['rede', 'redes'] },
  { concept: 'NETWORK', lang: 'it', terms: ['rete', 'reti'] },
  { concept: 'NETWORK', lang: 'nl', compound: true, terms: ['netwerk', 'netwerken'] },
  { concept: 'NETWORK', lang: 'sv', compound: true, terms: ['nätverk', 'nätverks'] },
  { concept: 'NETWORK', lang: 'da', compound: true, terms: ['netværk', 'netværks'] },
  { concept: 'NETWORK', lang: 'no', compound: true, terms: ['nettverk', 'nettverks'] },
  { concept: 'NETWORK', lang: 'fi', compound: true, terms: ['verkko', 'verkkojen'] },
  { concept: 'NETWORK', lang: 'pl', terms: ['sieci', 'sieciowy', 'sieciowe'] },
  { concept: 'NETWORK', lang: 'cs', terms: ['sítí', 'síťový'] },

  { concept: 'SOC', lang: 'en', terms: ['SOC', 'security operations center', 'security operations centre', 'security operations', 'SecOps', 'cyber defense center', 'cyber defence centre', 'CDC', 'SIEM', 'blue team', 'blue teamer', 'MDR', 'XDR', 'EDR'] },
  { concept: 'OFFENSIVE', lang: 'en', compound: true, terms: ['pentest', 'pentester', 'pentesting', 'penetration tester', 'penetration testing', 'penetration test', 'penetration', 'ethical hacker', 'ethical hacking', 'hacker', 'red team', 'red teamer', 'red teaming', 'offensive', 'bug bounty', 'exploit', 'exploitation', 'adversary emulation', 'purple team'] },
  { concept: 'OFFENSIVE', lang: 'de', compound: true, terms: ['Penetrationstester', 'Penetrationstests'] },
  { concept: 'OFFENSIVE', lang: 'fr', terms: ['pentesteur', 'auditeur technique', 'test d’intrusion', 'tests d’intrusion', 'testeur d’intrusion'] },
  { concept: 'OFFENSIVE', lang: 'es', terms: ['pentester', 'hacker ético', 'pruebas de penetración'] },
  { concept: 'OFFENSIVE', lang: 'pl', terms: ['pentester', 'testów penetracyjnych'] },
  { concept: 'DEFENSIVE', lang: 'en', compound: true, terms: ['incident response', 'incident responder', 'incident handler', 'security incident', 'security incidents', 'DFIR', 'forensic', 'forensics', 'threat intelligence', 'threat intel', 'threat hunter', 'threat hunting', 'threat detection', 'detection and response', 'detection engineer', 'detection engineering', 'malware', 'malware analyst', 'CSIRT', 'CERT', 'PSIRT', 'cyber threat'] },
  { concept: 'DEFENSIVE', lang: 'de', compound: true, terms: ['Forensik', 'Vorfallbehandlung', 'Bedrohungsanalyse'] },
  { concept: 'DEFENSIVE', lang: 'fr', terms: ['réponse aux incidents', 'gestion des incidents', 'CERT', 'menaces'] },
  { concept: 'DEFENSIVE', lang: 'es', terms: ['respuesta a incidentes', 'forense', 'amenazas'] },
  { concept: 'VULN', lang: 'en', compound: true, terms: ['vulnerability', 'vulnerabilities', 'vulnerability management', 'vuln'] },
  { concept: 'VULN', lang: 'de', compound: true, terms: ['Schwachstellen', 'Schwachstellenmanagement', 'Schwachstellenanalyse'] },
  { concept: 'VULN', lang: 'fr', terms: ['vulnérabilités', 'vulnérabilité'] },
  { concept: 'VULN', lang: 'es', terms: ['vulnerabilidades'] },
  { concept: 'PRIVACY', lang: 'en', terms: ['privacy', 'data protection', 'DPO', 'GDPR', 'data privacy'] },
  { concept: 'PRIVACY', lang: 'de', compound: true, terms: ['Datenschutz', 'Datenschutzbeauftragter', 'DSGVO'] },
  { concept: 'PRIVACY', lang: 'fr', terms: ['protection des données', 'RGPD', 'données personnelles'] },
  { concept: 'PRIVACY', lang: 'es', terms: ['protección de datos', 'privacidad'] },
  { concept: 'PRIVACY', lang: 'pt', terms: ['proteção de dados', 'privacidade', 'LGPD'] },
  { concept: 'PRIVACY', lang: 'it', terms: ['protezione dei dati'] },
  { concept: 'PRIVACY', lang: 'nl', terms: ['gegevensbescherming', 'AVG', 'FG'] },
  { concept: 'PRIVACY', lang: 'sv', compound: true, terms: ['dataskydd'] },
  { concept: 'PRIVACY', lang: 'da', compound: true, terms: ['databeskyttelse'] },
  { concept: 'PRIVACY', lang: 'fi', compound: true, terms: ['tietosuoja'] },
  { concept: 'PRIVACY', lang: 'pl', terms: ['ochrona danych', 'ochrony danych', 'RODO'] },
  { concept: 'CRYPTO', lang: 'en', terms: ['PKI', 'cryptography', 'cryptographer', 'cryptographic', 'HSM', 'key management'] },
  { concept: 'CRYPTO', lang: 'de', compound: true, terms: ['Kryptographie', 'Kryptografie'] },
  { concept: 'CRYPTO', lang: 'fr', terms: ['cryptographie'] },
  { concept: 'OT', lang: 'en', terms: ['OT', 'ICS', 'SCADA', 'industrial control', 'operational technology', 'industrial security', 'IIoT', 'ICS/OT'] },
  { concept: 'OT', lang: 'de', compound: true, terms: ['Industrial-Security', 'Industriesicherheit', 'Automotive-Security', 'Fahrzeugsicherheit'] },

  // ── Head nouns ──────────────────────────────────────────────────────────────────────────
  { concept: 'H_ENG', lang: 'en', compound: true, terms: ['engineer', 'engineers', 'engr', 'engineering'] },
  { concept: 'H_ENG', lang: 'de', compound: true, terms: ['Ingenieur', 'Ingenieurin', 'Ingenieure'] },
  { concept: 'H_ENG', lang: 'fr', terms: ['ingénieur', 'ingénieure'] },
  { concept: 'H_ENG', lang: 'es', compound: true, terms: ['ingeniero', 'ingeniera'] },
  { concept: 'H_ENG', lang: 'pt', compound: true, terms: ['engenheiro', 'engenheira'] },
  { concept: 'H_ENG', lang: 'it', compound: true, terms: ['ingegnere'] },
  { concept: 'H_ENG', lang: 'sv', compound: true, terms: ['ingenjör'] },
  { concept: 'H_ENG', lang: 'da', compound: true, terms: ['ingeniør'] },
  { concept: 'H_ENG', lang: 'fi', compound: true, terms: ['insinööri'] },
  { concept: 'H_ENG', lang: 'pl', compound: true, terms: ['inżynier', 'inżynierka'] },
  { concept: 'H_ENG', lang: 'cs', compound: true, terms: ['inženýr', 'inženýrka'] },
  { concept: 'H_SPEC', lang: 'en', compound: true, terms: ['specialist', 'specialists', 'expert', 'professional', 'SME', 'subject matter expert'] },
  { concept: 'H_SPEC', lang: 'de', compound: true, terms: ['Spezialist', 'Spezialistin', 'Experte', 'Expertin', 'Fachexperte', 'Fachspezialist'] },
  { concept: 'H_SPEC', lang: 'fr', terms: ['spécialiste', 'experte'] },
  { concept: 'H_SPEC', lang: 'es', terms: ['especialista', 'experto', 'experta'] },
  { concept: 'H_SPEC', lang: 'it', terms: ['specialista', 'esperto', 'esperta'] },
  { concept: 'H_SPEC', lang: 'nl', compound: true, terms: ['specialist', 'deskundige'] },
  { concept: 'H_SPEC', lang: 'sv', compound: true, terms: ['specialist', 'expert'] },
  { concept: 'H_SPEC', lang: 'fi', compound: true, terms: ['asiantuntija'] },
  { concept: 'H_SPEC', lang: 'pl', compound: true, terms: ['specjalista', 'specjalistka', 'ekspert', 'ekspertka'] },
  { concept: 'H_SPEC', lang: 'cs', compound: true, terms: ['specialistka', 'odborník'] },
  { concept: 'H_ARCH', lang: 'en', compound: true, terms: ['architect', 'architects'] },
  { concept: 'H_ARCH', lang: 'de', compound: true, terms: ['Architekt', 'Architektin'] },
  { concept: 'H_ARCH', lang: 'fr', terms: ['architecte'] },
  { concept: 'H_ARCH', lang: 'es', terms: ['arquitecto', 'arquitecta'] },
  { concept: 'H_ARCH', lang: 'pt', terms: ['arquiteto', 'arquiteta'] },
  { concept: 'H_ARCH', lang: 'it', terms: ['architetto'] },
  { concept: 'H_ARCH', lang: 'sv', compound: true, terms: ['arkitekt'] },
  { concept: 'H_ARCH', lang: 'fi', compound: true, terms: ['arkkitehti'] },
  { concept: 'H_ARCH', lang: 'pl', terms: ['architektka'] },
  { concept: 'H_CONSULT', lang: 'en', compound: true, terms: ['consultant', 'consultants', 'advisor', 'adviser', 'consulting'] },
  { concept: 'H_CONSULT', lang: 'de', compound: true, terms: ['Berater', 'Beraterin', 'Consultant'] },
  { concept: 'H_CONSULT', lang: 'fr', terms: ['consultante', 'conseiller', 'conseillère'] },
  { concept: 'H_CONSULT', lang: 'es', terms: ['consultor', 'consultora', 'asesor', 'asesora'] },
  { concept: 'H_CONSULT', lang: 'it', terms: ['consulente'] },
  { concept: 'H_CONSULT', lang: 'nl', compound: true, terms: ['adviseur', 'consultant'] },
  { concept: 'H_CONSULT', lang: 'sv', compound: true, terms: ['konsult', 'rådgivare'] },
  { concept: 'H_CONSULT', lang: 'da', compound: true, terms: ['konsulent', 'rådgiver'] },
  { concept: 'H_CONSULT', lang: 'fi', compound: true, terms: ['konsultti', 'neuvonantaja'] },
  { concept: 'H_CONSULT', lang: 'pl', terms: ['konsultant', 'konsultantka', 'doradca'] },
  { concept: 'H_CONSULT', lang: 'cs', terms: ['konzultant', 'konzultantka'] },
  { concept: 'H_ANALYST', lang: 'en', compound: true, terms: ['analyst', 'analysts'] },
  { concept: 'H_ANALYST', lang: 'de', compound: true, terms: ['Analytiker', 'Analytikerin', 'Analyst', 'Analystin'] },
  { concept: 'H_ANALYST', lang: 'fr', terms: ['analyste'] },
  { concept: 'H_ANALYST', lang: 'es', terms: ['analista'] },
  { concept: 'H_ANALYST', lang: 'nl', compound: true, terms: ['analist'] },
  { concept: 'H_ANALYST', lang: 'fi', compound: true, terms: ['analyytikko'] },
  { concept: 'H_ANALYST', lang: 'pl', terms: ['analityk', 'analityczka'] },
  { concept: 'H_ANALYST', lang: 'cs', terms: ['analytik', 'analytička'] },
  { concept: 'H_DEV', lang: 'en', compound: true, terms: ['developer', 'developers', 'dev', 'programmer', 'coder'] },
  { concept: 'H_DEV', lang: 'de', compound: true, terms: ['Entwickler', 'Entwicklerin', 'Programmierer', 'Programmiererin', 'Softwareentwickler', 'Softwareentwicklerin'] },
  { concept: 'H_DEV', lang: 'fr', terms: ['développeur', 'développeuse'] },
  { concept: 'H_DEV', lang: 'es', terms: ['desarrollador', 'desarrolladora', 'programador', 'programadora'] },
  { concept: 'H_DEV', lang: 'pt', terms: ['desenvolvedor', 'desenvolvedora'] },
  { concept: 'H_DEV', lang: 'it', terms: ['sviluppatore', 'sviluppatrice', 'programmatore', 'programmatrice'] },
  { concept: 'H_DEV', lang: 'nl', compound: true, terms: ['ontwikkelaar'] },
  { concept: 'H_DEV', lang: 'sv', compound: true, terms: ['utvecklare'] },
  { concept: 'H_DEV', lang: 'da', compound: true, terms: ['udvikler'] },
  { concept: 'H_DEV', lang: 'no', compound: true, terms: ['utvikler'] },
  { concept: 'H_DEV', lang: 'fi', compound: true, terms: ['kehittäjä', 'ohjelmoija'] },
  { concept: 'H_DEV', lang: 'pl', terms: ['programista', 'programistka', 'deweloper'] },
  { concept: 'H_DEV', lang: 'cs', terms: ['vývojář', 'vývojářka', 'programátor'] },
  { concept: 'H_ADMIN', lang: 'en', compound: true, terms: ['administrator', 'admin', 'sysadmin'] },
  { concept: 'H_ADMIN', lang: 'de', compound: true, terms: ['Administratorin', 'Systembetreuer'] },
  { concept: 'H_ADMIN', lang: 'fr', terms: ['administrateur', 'administratrice'] },
  { concept: 'H_ADMIN', lang: 'es', terms: ['administrador', 'administradora'] },
  { concept: 'H_ADMIN', lang: 'it', terms: ['amministratore'] },
  { concept: 'H_ADMIN', lang: 'nl', compound: true, terms: ['beheerder'] },
  { concept: 'H_ADMIN', lang: 'fi', compound: true, terms: ['ylläpitäjä'] },
  { concept: 'H_ADMIN', lang: 'cs', terms: ['správce'] },
  { concept: 'H_MANAGER', lang: 'en', compound: true, terms: ['manager', 'head of', 'director', 'owner'] },
  { concept: 'H_MANAGER', lang: 'de', compound: true, terms: ['Leiter', 'Leiterin', 'Leitung', 'Managerin', 'Direktor'] },
  { concept: 'H_MANAGER', lang: 'fr', terms: ['responsable', 'directeur', 'directrice', 'chef'] },
  { concept: 'H_MANAGER', lang: 'es', terms: ['jefe', 'jefa', 'gerente', 'gestor', 'gestora', 'directora', 'responsable'] },
  { concept: 'H_MANAGER', lang: 'pt', terms: ['gestor', 'diretor', 'diretora', 'gerente', 'coordenador'] },
  { concept: 'H_MANAGER', lang: 'it', terms: ['responsabile', 'direttore'] },
  { concept: 'H_MANAGER', lang: 'nl', terms: ['hoofd', 'teamleider'] },
  { concept: 'H_MANAGER', lang: 'sv', compound: true, terms: ['chef'] },
  { concept: 'H_MANAGER', lang: 'fi', compound: true, terms: ['päällikkö', 'johtaja'] },
  { concept: 'H_MANAGER', lang: 'pl', terms: ['kierownik', 'dyrektor'] },
  { concept: 'H_MANAGER', lang: 'cs', terms: ['vedoucí', 'ředitel'] },
  { concept: 'H_OFFICER', lang: 'en', compound: true, terms: ['officer', 'CSO'] },
  { concept: 'H_OFFICER', lang: 'de', compound: true, terms: ['Beauftragter', 'Beauftragte', 'Referent', 'Referentin', 'Koordinator'] },
  { concept: 'H_OFFICER', lang: 'fr', terms: ['chargé', 'chargée', 'officier'] },
  { concept: 'H_OFFICER', lang: 'es', terms: ['oficial'] },
  { concept: 'H_SPEC', lang: 'es', terms: ['técnico', 'técnica'] },
  { concept: 'H_OFFICER', lang: 'nl', terms: ['functionaris', 'officer'] },
  { concept: 'H_AUDITOR', lang: 'en', compound: true, terms: ['auditor', 'auditors', 'assessor'] },
  { concept: 'H_AUDITOR', lang: 'de', compound: true, terms: ['Auditorin', 'Prüfer', 'Prüferin', 'Revisor'] },
  { concept: 'H_AUDITOR', lang: 'fr', terms: ['auditeur', 'auditrice'] },
  { concept: 'H_AUDITOR', lang: 'es', terms: ['auditora'] },
  { concept: 'H_TESTER', lang: 'en', compound: true, terms: ['tester', 'testers'] },
  { concept: 'H_TESTER', lang: 'fr', terms: ['testeur', 'testeuse'] },
  { concept: 'H_RESEARCHER', lang: 'en', compound: true, terms: ['researcher', 'research', 'scientist'] },
  { concept: 'H_RESEARCHER', lang: 'de', compound: true, terms: ['Forscher', 'Forscherin'] },
  { concept: 'H_RESEARCHER', lang: 'fr', terms: ['chercheur', 'chercheuse'] },
  { concept: 'H_RESEARCHER', lang: 'es', terms: ['investigador', 'investigadora'] },
  { concept: 'H_RESEARCHER', lang: 'it', terms: ['ricercatore'] },
  { concept: 'H_TECH', lang: 'en', compound: true, terms: ['technician', 'technologist'] },
  { concept: 'H_TECH', lang: 'de', compound: true, terms: ['Techniker', 'Technikerin'] },
  { concept: 'H_TECH', lang: 'fr', terms: ['technicien', 'technicienne'] },
  { concept: 'H_SPEC', lang: 'it', terms: ['tecnico'] },
  { concept: 'H_TECH', lang: 'nl', compound: true, terms: ['technicus'] },
  { concept: 'H_TECH', lang: 'sv', compound: true, terms: ['tekniker'] },
  { concept: 'H_LEAD', lang: 'en', terms: ['lead', 'teamlead', 'team lead', 'tech lead', 'technical lead'] },
  { concept: 'H_OPERATOR', lang: 'en', compound: true, terms: ['operator', 'operations'] },
  { concept: 'H_SUPERVISOR', lang: 'en', compound: true, terms: ['supervisor', 'coordinator', 'agent', 'representative', 'worker', 'assistant', 'guard'] },
  { concept: 'H_SUPERVISOR', lang: 'de', compound: true, terms: ['Mitarbeiter', 'Mitarbeiterin', 'Kraft', 'Fachkraft', 'Sachbearbeiter', 'Sachbearbeiterin'] },

  // ── Fallback developer roles ────────────────────────────────────────────────────────────
  { concept: 'FULLSTACK', lang: 'en', compound: true, terms: ['fullstack', 'full stack', 'full-stack', 'MERN', 'MERN stack', 'MEAN stack', 'MEVN', 'PERN', 'T3 stack'] },
  { concept: 'NEXTJS', lang: 'en', terms: ['Next.js', 'NextJS', 'Next js'] },
  { concept: 'NODE', lang: 'en', terms: ['Node.js', 'NodeJS', 'Node', 'Node js', 'NestJS', 'Nest.js', 'Express.js', 'ExpressJS'] },
  { concept: 'FRONTEND', lang: 'en', compound: true, terms: ['frontend', 'front end', 'front-end', 'React', 'ReactJS', 'React.js', 'Vue', 'Vue.js', 'VueJS', 'Angular', 'Svelte', 'SvelteKit', 'UI engineer'] },
  { concept: 'BACKEND', lang: 'en', compound: true, terms: ['backend', 'back end', 'back-end'] },
  { concept: 'JS', lang: 'en', terms: ['JavaScript', 'TypeScript', 'JS', 'TS'] },

  // ── Recognised non-target domains ───────────────────────────────────────────────────────
  { concept: 'NONTARGET', lang: 'en', compound: true, terms: [
    'data science', 'machine learning', 'ML', 'AI', 'LLM', 'MLOps', 'BI', 'analytics', 'business intelligence', 'mobile developer', 'iOS', 'Android', 'Flutter',
    'QA', 'quality assurance', 'test automation', 'testing', 'embedded', 'firmware', 'hardware', 'electrical', 'electronics', 'mechanical', 'civil',
    'structural', 'chemical', 'process', 'manufacturing', 'production', 'quality', 'automotive', 'aerospace', 'RF', 'HVAC', 'facility', 'facilities',
    'construction', 'field service', 'service desk', 'helpdesk', 'help desk', 'desktop support', 'IT support', 'support', 'business', 'ERP', 'SAP', 'Salesforce',
    'CRM', 'Dynamics', 'ServiceNow', 'database', 'DBA', 'SQL', 'Java', 'Python', 'Golang', 'Go', 'PHP', 'Ruby', 'Rails', 'dotnet', 'csharp', 'cplusplus',
    'Rust', 'Scala', 'Kotlin', 'Swift', 'game', 'games', 'Unity', 'Unreal', 'graphics', 'video', 'audio', 'blockchain', 'Web3', 'Solidity', 'UX', 'UI', 'design',
    'designer', 'project', 'program', 'programme', 'scrum', 'agile', 'delivery', 'release', 'linux', 'windows', 'Microsoft 365', 'M365', 'Citrix', 'VMware',
    'storage', 'backup', 'datacenter', 'data center', 'telecom', 'telco', 'VoIP', 'observability', 'monitoring', 'performance', 'integration', 'middleware',
    'mainframe', 'COBOL', 'workplace', 'modern workplace', 'endpoint management', 'data engineer', 'data analyst', 'data scientist', 'analytics engineer',
    'solutions', 'solution', 'technical support', 'customer', 'sales', 'marketing', 'finance', 'financial', 'accounting', 'HR', 'legal', 'payroll', 'procurement',
    'logistics', 'supply chain', 'biomedical', 'clinical', 'medical', 'pharma', 'energy', 'power', 'grid', 'nuclear', 'railway', 'rail', 'maritime', 'mining',
  ] },
  { concept: 'NONTARGET', lang: 'de', compound: true, terms: [
    'Maschinenbau', 'Elektrotechnik', 'Elektronik', 'Mechatronik', 'Verfahrenstechnik', 'Produktion', 'Qualität', 'Qualitätssicherung', 'Bau', 'Konstruktion',
    'Fertigung', 'Vertrieb', 'Einkauf', 'Logistik', 'Buchhaltung', 'Personal', 'Kundenservice', 'Anlagen', 'Gebäude', 'Haustechnik', 'Versorgungstechnik',
  ] },
  { concept: 'NONTARGET', lang: 'fr', terms: ['mécanique', 'électrique', 'électronique', 'production', 'qualité', 'bâtiment', 'maintenance', 'génie civil', 'méthodes'] },
  { concept: 'NONTARGET', lang: 'es', terms: ['mecánico', 'eléctrico', 'electrónico', 'producción', 'calidad', 'mantenimiento', 'obra', 'construcción'] },
  { concept: 'NONTARGET', lang: 'it', terms: ['meccanico', 'elettrico', 'elettronico', 'produzione', 'qualità', 'manutenzione'] },
  { concept: 'NONTARGET', lang: 'nl', compound: true, terms: ['werktuigbouw', 'elektrotechniek', 'onderhoud', 'productie', 'kwaliteit'] },
];

/** Complete job titles that are recognised as non-target roles (kept out of the review queue). */
export const OTHER_ROLE_PHRASES: readonly string[] = [
  'software engineer', 'software developer', 'software entwickler', 'softwareentwickler', 'développeur logiciel', 'ingénieur logiciel', 'desarrollador de software',
  'ingeniero de software', 'engenheiro de software', 'sviluppatore software', 'software ontwikkelaar', 'systemutvecklare', 'programista', 'web developer',
  'webentwickler', 'frontend developer', 'frontend engineer', 'backend developer', 'backend engineer', 'mobile developer', 'ios developer', 'android developer',
  'data engineer', 'data scientist', 'data analyst', 'machine learning engineer', 'ml engineer', 'ai engineer', 'research scientist', 'qa engineer',
  'test engineer', 'qa analyst', 'sdet', 'devops engineer', 'site reliability engineer', 'sre', 'platform engineer', 'cloud engineer', 'cloud architect',
  'cloud consultant', 'cloud developer', 'cloud administrator', 'solutions architect', 'solution architect', 'enterprise architect', 'network engineer',
  'network administrator', 'system administrator', 'systems administrator', 'systems engineer', 'system engineer', 'systemadministrator', 'it administrator',
  'it support', 'support engineer', 'technical support', 'helpdesk', 'service desk', 'desktop support', 'product manager', 'product owner', 'project manager',
  'program manager', 'programme manager', 'delivery manager', 'engineering manager', 'scrum master', 'agile coach', 'business analyst', 'it consultant',
  'sap consultant', 'erp consultant', 'salesforce developer', 'database administrator', 'dba', 'ux designer', 'ui designer', 'product designer',
  'graphic designer', 'technical writer', 'developer advocate', 'devrel', 'recruiter', 'talent acquisition', 'sourcer', 'account executive', 'account manager',
  'customer success manager', 'office manager', 'executive assistant', 'assistant', 'receptionist', 'accountant', 'bookkeeper', 'buchhalter', 'controller',
  'financial analyst', 'lawyer', 'attorney', 'paralegal', 'legal counsel', 'nurse', 'driver', 'warehouse', 'cashier', 'teacher', 'lecturer', 'professor',
  'copywriter', 'content writer', 'editor', 'journalist', 'marketing manager', 'social media manager', 'community manager', 'customer service',
  'call center', 'kundenservice', 'buyer', 'einkäufer', 'procurement', 'logistics', 'electrician', 'elektriker', 'mechanic', 'mechaniker', 'hr manager',
  'hr business partner', 'mechanical engineer', 'electrical engineer', 'civil engineer', 'process engineer', 'chemical engineer', 'quality engineer',
  'manufacturing engineer', 'field engineer', 'field service engineer', 'service technician', 'servicetechniker', 'maschinenbauingenieur',
  'elektroingenieur', 'bauingenieur', 'ingénieur mécanique', 'ingénieur électrique', 'ingénieur qualité', 'ingeniero mecánico', 'ingeniero industrial',
  'ingegnere meccanico', 'werktuigbouwkundig ingenieur', 'architect bouw', 'java developer', 'python developer', 'php developer', 'dotnet developer',
  'cplusplus developer', 'csharp developer', 'golang developer', 'go developer', 'ruby developer', 'react developer', 'angular developer', 'vue developer', 'javascript developer',
  'typescript developer', 'wordpress developer', 'shopify developer', 'game developer', 'unity developer', 'blockchain developer', 'solidity developer',
];
