/**
 * Title phrases that look like security/cloud roles but are not (spec §10: "unknown goes to review,
 * not to a guess" — and a false positive in the top 50 is worse than a miss).
 *
 * Matched in the same longest-phrase-first pass as the lexicon, so "security guard" consumes the
 * word "security" before it can count as IT security.
 */
import type { TermGroup } from './lexicon';

export const NEGATIVE_GROUPS: readonly TermGroup[] = [
  // ── Guarding, physical and aviation security ────────────────────────────────────────────
  { concept: 'NEG_GUARD', lang: 'en', terms: [
    'security guard', 'security guards', 'security staff', 'security agent', 'security patrol', 'patrol officer', 'physical security',
    'site security', 'event security', 'retail security', 'store security', 'security doorman', 'door supervisor', 'doorman', 'bouncer',
    'loss prevention', 'asset protection', 'store detective', 'cctv operator', 'cctv', 'control room operator', 'close protection',
    'bodyguard', 'executive protection', 'aviation security', 'airport security', 'security screener', 'screener', 'TSA officer',
    'security host', 'concierge', 'watchman', 'night watchman', 'gatehouse', 'receptionist security', 'corporate security officer',
    'security officer patrol', 'mobile patrol', 'security response officer', 'armed security', 'unarmed security', 'protective services',
    'security supervisor', 'security site supervisor', 'security escort', 'maritime security', 'port security', 'security dog handler',
    'alarm technician', 'alarm engineer', 'fire and security engineer', 'security systems technician', 'access control technician',
    'security installer', 'cctv engineer', 'intruder alarm',
  ] },
  { concept: 'NEG_GUARD', lang: 'de', compound: true, terms: [
    'Sicherheitsmitarbeiter', 'Sicherheitsmitarbeiterin', 'Sicherheitsdienst', 'Sicherheitsdienstes', 'Sicherheitskraft', 'Sicherheitskräfte',
    'Sicherheitsfachkraft', 'Wachmann', 'Wachdienst', 'Wachschutz', 'Objektschutz', 'Werkschutz', 'Personenschutz', 'Revierfahrer',
    'Luftsicherheit', 'Luftsicherheitsassistent', 'Fluggastkontrolle', 'Ladendetektiv', 'Doorman', 'Pförtner', 'Empfangsdienst',
    'Sicherheitsassistent', 'Sicherheitsleitstelle', 'Leitstellendisponent', 'Sicherheitsfachkraft Objektschutz', 'Schutz und Sicherheit',
    'Fachkraft für Schutz und Sicherheit', 'Servicekraft für Schutz und Sicherheit', 'Sicherheitstechnik', 'Sicherheitstechniker', 'Alarmanlagen',
    'Brandmeldetechnik', 'Einbruchmeldetechnik',
  ] },
  { concept: 'NEG_GUARD', lang: 'fr', terms: [
    'agent de sécurité', 'agente de sécurité', 'agent de sûreté', 'agent de securite', 'agent de surveillance', 'agent cynophile', 'agent SSIAP',
    'SSIAP', 'vigile', 'chef de poste', 'rondier', 'agent de prévention', 'sûreté aéroportuaire', 'agent d’accueil', 'opérateur vidéoprotection',
    'sûreté', 'agent de sécurité incendie',
  ] },
  { concept: 'NEG_GUARD', lang: 'es', terms: ['vigilante de seguridad', 'vigilante', 'guardia de seguridad', 'auxiliar de seguridad', 'escolta', 'controlador de accesos', 'agente de seguridad', 'vigilante de seguridad privada'] },
  { concept: 'NEG_GUARD', lang: 'pt', terms: ['vigilante', 'segurança patrimonial', 'vigia', 'porteiro', 'agente de segurança', 'segurança privada'] },
  { concept: 'NEG_GUARD', lang: 'it', terms: ['guardia giurata', 'addetto alla sicurezza', 'addetto sicurezza', 'vigilanza', 'portiere'] },
  { concept: 'NEG_GUARD', lang: 'nl', compound: true, terms: ['beveiliger', 'beveiligers', 'beveiligingsbeambte', 'beveiligingsmedewerker', 'objectbeveiliger', 'toezichthouder', 'mobiele surveillant', 'surveillant', 'portier', 'meldkamer'] },
  { concept: 'NEG_GUARD', lang: 'sv', compound: true, terms: ['väktare', 'ordningsvakt', 'skyddsvakt', 'säkerhetsvakt', 'vakt'] },
  { concept: 'NEG_GUARD', lang: 'da', compound: true, terms: ['vagt', 'vagtfunktionær', 'sikkerhedsvagt', 'dørmand'] },
  { concept: 'NEG_GUARD', lang: 'no', compound: true, terms: ['vekter', 'vektere', 'sikkerhetsvakt', 'ordensvakt'] },
  { concept: 'NEG_GUARD', lang: 'fi', compound: true, terms: ['vartija', 'järjestyksenvalvoja', 'turvatarkastaja'] },
  { concept: 'NEG_GUARD', lang: 'pl', terms: ['ochroniarz', 'pracownik ochrony', 'agent ochrony', 'ochrona fizyczna', 'kwalifikowany pracownik ochrony'] },
  { concept: 'NEG_GUARD', lang: 'cs', terms: ['strážný', 'strážná', 'ostraha', 'pracovník ostrahy', 'bezpečnostní pracovník', 'vrátný'] },

  // ── Health & safety, functional safety, fire protection ─────────────────────────────────
  { concept: 'NEG_SAFETY', lang: 'en', compound: true, terms: [
    'safety', 'health and safety', 'health & safety', 'HSE', 'EHS', 'HSSE', 'QHSE', 'HSEQ', 'SHEQ', 'occupational safety', 'fire safety',
    'fire protection', 'fire and safety', 'functional safety', 'process safety', 'product safety', 'food safety', 'patient safety', 'road safety',
    'nuclear safety', 'radiation protection', 'safety officer', 'safety engineer', 'safety manager', 'safety advisor', 'safety specialist',
    'site safety', 'construction safety', 'safety inspector', 'lifeguard', 'fire warden', 'firefighter', 'fire fighter', 'NEBOSH', 'IOSH',
  ] },
  { concept: 'NEG_SAFETY', lang: 'de', compound: true, terms: [
    'Arbeitssicherheit', 'Arbeitsschutz', 'Fachkraft für Arbeitssicherheit', 'SiFa', 'Sicherheitsfachkraft', 'Brandschutz', 'Brandschutzbeauftragter',
    'Funktionale Sicherheit', 'funktionale Sicherheit', 'Betriebssicherheit', 'Anlagensicherheit', 'Maschinensicherheit', 'Produktsicherheit',
    'Lebensmittelsicherheit', 'Verkehrssicherheit', 'Arzneimittelsicherheit', 'Strahlenschutz', 'Gebäudesicherheit', 'Versorgungssicherheit',
    'Prozesssicherheit', 'Gerätesicherheit', 'Explosionsschutz', 'Sicherheitsingenieur Arbeitssicherheit', 'Sicherheitsbeauftragter Arbeitsschutz',
    'Feuerwehr', 'Werkfeuerwehr', 'Rettungsschwimmer', 'Umweltschutz', 'Gesundheitsschutz', 'HSE-Manager',
  ] },
  { concept: 'NEG_SAFETY', lang: 'fr', terms: [
    'sécurité incendie', 'prévention des risques', 'préventeur', 'préventrice', 'hygiène sécurité environnement', 'hygiène et sécurité',
    'santé sécurité', 'santé et sécurité', 'sécurité au travail', 'sécurité du travail', 'sécurité fonctionnelle', 'sécurité alimentaire',
    'sûreté nucléaire', 'sécurité nucléaire', 'radioprotection', 'sécurité des patients', 'sécurité routière', 'sécurité des procédés', 'pompier',
    'animateur sécurité', 'coordinateur SPS', 'coordonnateur SPS', 'QSE', 'HSE', 'QHSE',
  ] },
  { concept: 'NEG_SAFETY', lang: 'es', terms: [
    'prevención de riesgos laborales', 'prevención de riesgos', 'PRL', 'seguridad y salud', 'seguridad y salud laboral', 'seguridad laboral',
    'seguridad industrial', 'seguridad e higiene', 'seguridad alimentaria', 'seguridad del paciente', 'seguridad vial', 'seguridad funcional',
    'técnico de prevención', 'bombero', 'socorrista', 'SSMA', 'SST',
  ] },
  { concept: 'NEG_SAFETY', lang: 'pt', terms: [
    'segurança do trabalho', 'técnico de segurança do trabalho', 'engenheiro de segurança do trabalho', 'saúde e segurança', 'segurança ocupacional',
    'segurança alimentar', 'segurança do paciente', 'segurança funcional', 'SSMA', 'SST', 'bombeiro',
  ] },
  { concept: 'NEG_SAFETY', lang: 'it', terms: [
    'sicurezza sul lavoro', 'sicurezza sui luoghi di lavoro', 'salute e sicurezza', 'RSPP', 'ASPP', 'sicurezza alimentare', 'sicurezza funzionale',
    'sicurezza del paziente', 'sicurezza stradale', 'prevenzione incendi', 'antincendio', 'vigili del fuoco', 'HSE',
  ] },
  { concept: 'NEG_SAFETY', lang: 'nl', compound: true, terms: [
    'arbeidsveiligheid', 'veiligheidskundige', 'veiligheid', 'veiligheids', 'VGM', 'KAM', 'VCA', 'brandveiligheid', 'brandweer', 'functionele veiligheid',
    'voedselveiligheid', 'patiëntveiligheid', 'procesveiligheid', 'arbo', 'arbocoördinator', 'preventiemedewerker',
  ] },
  { concept: 'NEG_SAFETY', lang: 'sv', compound: true, terms: ['arbetsmiljö', 'arbetsmiljöingenjör', 'arbetsmiljösamordnare', 'brandskydd', 'brandskyddsingenjör', 'funktionell säkerhet', 'livsmedelssäkerhet', 'skyddsombud', 'patientsäkerhet'] },
  { concept: 'NEG_SAFETY', lang: 'da', compound: true, terms: ['arbejdsmiljø', 'arbejdsmiljøkonsulent', 'brandsikkerhed', 'funktionel sikkerhed', 'fødevaresikkerhed', 'patientsikkerhed'] },
  { concept: 'NEG_SAFETY', lang: 'no', compound: true, terms: ['HMS', 'HMS-rådgiver', 'HMS-leder', 'helse miljø og sikkerhet', 'helse miljø sikkerhet', 'arbeidsmiljø', 'brannsikkerhet', 'funksjonell sikkerhet', 'mattrygghet', 'pasientsikkerhet'] },
  { concept: 'NEG_SAFETY', lang: 'fi', compound: true, terms: ['työturvallisuus', 'työsuojelu', 'työturvallisuusasiantuntija', 'paloturvallisuus', 'toiminnallinen turvallisuus', 'elintarviketurvallisuus', 'potilasturvallisuus', 'turvallisuuspäällikkö'] },
  { concept: 'NEG_SAFETY', lang: 'pl', terms: ['BHP', 'specjalista BHP', 'inspektor BHP', 'bezpieczeństwo i higiena pracy', 'bezpieczeństwa i higieny pracy', 'ochrona przeciwpożarowa', 'ppoż', 'bezpieczeństwo funkcjonalne', 'bezpieczeństwa funkcjonalnego', 'bezpieczeństwo żywności', 'strażak'] },
  { concept: 'NEG_SAFETY', lang: 'cs', terms: ['BOZP', 'bezpečnost práce', 'bezpečnosti práce', 'bezpečnost a ochrana zdraví při práci', 'požární ochrana', 'požární ochrany', 'funkční bezpečnost', 'funkční bezpečnosti', 'hasič'] },

  // ── Social security, finance "securities", policy ───────────────────────────────────────
  { concept: 'NEG_SOCIAL', lang: 'en', terms: [
    'social security', 'securities', 'securities services', 'securities operations', 'securities lending', 'securities finance', 'securitisation',
    'securitization', 'securitized', 'security lending', 'food security', 'energy security', 'water security', 'national security policy',
    'job security', 'income security', 'social insurance', 'homeland security policy', 'international security', 'security studies',
    'security policy analyst', 'defence policy', 'defense policy',
  ] },
  { concept: 'NEG_SOCIAL', lang: 'de', compound: true, terms: ['Sozialversicherung', 'Sozialversicherungsfachangestellte', 'Sozialversicherungsfachangestellter', 'soziale Sicherheit', 'Wertpapier', 'Wertpapiere', 'Wertpapierhandel', 'Wertpapierabwicklung', 'Ernährungssicherheit', 'Energiesicherheit', 'Sicherheitspolitik'] },
  { concept: 'NEG_SOCIAL', lang: 'fr', terms: ['sécurité sociale', 'sécu', 'titres', 'titrisation', 'sécurité alimentaire mondiale', 'sécurité énergétique', 'politique de sécurité et de défense'] },
  { concept: 'NEG_SOCIAL', lang: 'es', terms: ['seguridad social', 'valores', 'titulización', 'seguridad alimentaria mundial', 'seguridad energética'] },
  { concept: 'NEG_SOCIAL', lang: 'pt', terms: ['segurança social', 'previdência social', 'valores mobiliários', 'securitização'] },
  { concept: 'NEG_SOCIAL', lang: 'it', terms: ['previdenza sociale', 'sicurezza sociale', 'titoli', 'cartolarizzazione'] },
  { concept: 'NEG_SOCIAL', lang: 'nl', terms: ['sociale zekerheid', 'sociale verzekeringen', 'effecten', 'effectenbeheer'] },
  { concept: 'NEG_SOCIAL', lang: 'sv', compound: true, terms: ['socialförsäkring', 'värdepapper', 'livsmedelsförsörjning'] },
  { concept: 'NEG_SOCIAL', lang: 'da', compound: true, terms: ['social sikring', 'værdipapirer'] },
  { concept: 'NEG_SOCIAL', lang: 'no', compound: true, terms: ['trygd', 'verdipapir', 'verdipapirer'] },
  { concept: 'NEG_SOCIAL', lang: 'fi', compound: true, terms: ['sosiaaliturva', 'arvopaperi', 'arvopaperit'] },
  { concept: 'NEG_SOCIAL', lang: 'pl', terms: ['ubezpieczenia społeczne', 'ubezpieczeń społecznych', 'papiery wartościowe', 'papierów wartościowych'] },
  { concept: 'NEG_SOCIAL', lang: 'cs', terms: ['sociální zabezpečení', 'sociálního zabezpečení', 'cenné papíry', 'cenných papírů'] },

  // ── Sales-side roles ───────────────────────────────────────────────────────────────────
  { concept: 'NEG_SALES', lang: 'en', terms: [
    'sales engineer', 'sales engineering', 'sales engineers', 'presales', 'pre sales', 'pre-sales', 'presales engineer', 'sales manager', 'sales director',
    'sales executive', 'sales representative', 'sales rep', 'sales specialist', 'sales consultant', 'sales lead', 'sales architect', 'sales development',
    'sales development representative', 'inside sales', 'field sales', 'channel sales', 'enterprise sales', 'sales account', 'sales professional',
    'solutions engineer', 'solution engineer', 'solutions consultant', 'solution consultant', 'technical account manager', 'account manager',
    'account executive', 'account director', 'key account', 'key account manager', 'business development', 'business developer', 'BDR', 'SDR',
    'customer success', 'customer success manager', 'customer success engineer', 'partner manager', 'alliance manager', 'alliances manager',
    'channel manager', 'territory manager', 'regional sales', 'renewals', 'renewal manager', 'go to market', 'GTM', 'product marketing',
    'marketing manager', 'field marketing', 'demand generation', 'overlay specialist', 'sales overlay', 'value engineer', 'solutions specialist',
  ] },
  { concept: 'NEG_SALES', lang: 'de', compound: true, terms: [
    'Vertriebsingenieur', 'Vertriebsingenieurin', 'Vertriebsmitarbeiter', 'Vertriebsmitarbeiterin', 'Vertriebsleiter', 'Vertriebsbeauftragter',
    'Vertriebsspezialist', 'Vertriebsmanager', 'Außendienst', 'Aussendienst', 'Außendienstmitarbeiter', 'Innendienst', 'Innendienstmitarbeiter',
    'Kundenberater', 'Kundenbetreuer', 'Key Account Manager', 'Account Manager', 'Presales Consultant', 'Technischer Vertrieb', 'Vertriebsaußendienst',
  ] },
  { concept: 'NEG_SALES', lang: 'fr', terms: [
    'ingénieur commercial', 'ingénieure commerciale', 'ingénieur d’affaires', 'ingénieure d’affaires', 'ingénieur avant vente', 'avant vente',
    'avant-vente', 'technico commercial', 'technico-commercial', 'chargé d’affaires', 'chargée d’affaires', 'business developer', 'commercial terrain',
    'commercial sédentaire', 'responsable commercial', 'directeur commercial', 'attaché commercial',
  ] },
  { concept: 'NEG_SALES', lang: 'es', terms: ['preventa', 'pre venta', 'ejecutivo de cuentas', 'ejecutiva de cuentas', 'ejecutivo comercial', 'ejecutiva comercial', 'gerente de cuentas', 'representante de ventas', 'ingeniero de ventas', 'técnico comercial', 'director comercial', 'asesor comercial'] },
  { concept: 'NEG_SALES', lang: 'pt', terms: ['pré venda', 'pré-venda', 'pre venda', 'executivo de contas', 'executiva de contas', 'executivo de vendas', 'engenheiro de vendas', 'consultor comercial', 'gerente comercial'] },
  { concept: 'NEG_SALES', lang: 'it', terms: ['prevendita', 'pre vendita', 'account executive', 'venditore', 'commerciale', 'tecnico commerciale', 'agente di commercio', 'responsabile commerciale'] },
  { concept: 'NEG_SALES', lang: 'nl', compound: true, terms: ['accountmanager', 'verkoopadviseur', 'verkoopmedewerker', 'verkoper', 'binnendienst', 'buitendienst', 'commercieel medewerker'] },
  { concept: 'NEG_SALES', lang: 'sv', compound: true, terms: ['säljare', 'säljingenjör', 'försäljningschef', 'innesäljare', 'kundansvarig'] },
  { concept: 'NEG_SALES', lang: 'da', compound: true, terms: ['sælger', 'salgsingeniør', 'salgschef', 'salgskonsulent'] },
  { concept: 'NEG_SALES', lang: 'no', compound: true, terms: ['selger', 'salgsingeniør', 'salgssjef', 'salgskonsulent'] },
  { concept: 'NEG_SALES', lang: 'fi', compound: true, terms: ['myyjä', 'myyntiinsinööri', 'myyntipäällikkö', 'myyntiedustaja', 'asiakkuuspäällikkö'] },
  { concept: 'NEG_SALES', lang: 'pl', terms: ['handlowiec', 'przedstawiciel handlowy', 'specjalista ds sprzedaży', 'inżynier sprzedaży', 'opiekun klienta', 'key account manager'] },
  { concept: 'NEG_SALES', lang: 'cs', terms: ['obchodník', 'obchodní zástupce', 'obchodní manažer', 'prodejce'] },
  { concept: 'NEG_SALES_WORD', lang: 'en', terms: ['sales', 'commercial', 'selling'] },
  { concept: 'NEG_SALES_WORD', lang: 'de', compound: true, terms: ['Vertrieb', 'Verkauf', 'Verkäufer', 'Verkäuferin'] },
  { concept: 'NEG_SALES_WORD', lang: 'fr', terms: ['vente', 'ventes', 'vendeur', 'vendeuse'] },
  { concept: 'NEG_SALES_WORD', lang: 'es', terms: ['ventas', 'vendedor', 'vendedora', 'comercial'] },
  { concept: 'NEG_SALES_WORD', lang: 'pt', terms: ['vendas', 'vendedor', 'vendedora'] },
  { concept: 'NEG_SALES_WORD', lang: 'it', terms: ['vendite', 'vendita'] },
  { concept: 'NEG_SALES_WORD', lang: 'nl', terms: ['verkoop'] },
  { concept: 'NEG_SALES_WORD', lang: 'sv', compound: true, terms: ['försäljning'] },
  { concept: 'NEG_SALES_WORD', lang: 'da', compound: true, terms: ['salg'] },
  { concept: 'NEG_SALES_WORD', lang: 'fi', compound: true, terms: ['myynti'] },
  { concept: 'NEG_SALES_WORD', lang: 'pl', terms: ['sprzedaż', 'sprzedaży'] },
  { concept: 'NEG_SALES_WORD', lang: 'cs', terms: ['prodej', 'prodeje'] },

  // ── Non-engineering roles that often carry security words ───────────────────────────────
  { concept: 'NEG_NONTECH', lang: 'en', terms: [
    'product manager', 'product owner', 'project manager', 'project coordinator', 'project lead', 'program manager', 'programme manager',
    'delivery manager', 'scrum master', 'agile coach', 'recruiter', 'recruitment', 'recruitment consultant', 'talent acquisition', 'talent partner',
    'sourcer', 'headhunter', 'teacher', 'lecturer', 'professor', 'instructor', 'tutor', 'trainer', 'course', 'bootcamp', 'phd', 'phd student',
    'phd candidate', 'doctoral', 'doctoral candidate', 'postdoc', 'postdoctoral', 'post doc', 'thesis', 'master thesis', 'bachelor thesis',
    'journalist', 'editor', 'writer', 'content writer', 'copywriter', 'technical writer', 'paralegal', 'lawyer', 'attorney', 'counsel',
    'legal counsel', 'solicitor', 'insurance', 'underwriter', 'claims', 'broker', 'actuary', 'volunteer', 'ambassador', 'event manager',
    'office manager', 'executive assistant', 'personal assistant', 'administrative assistant', 'hr', 'people partner', 'buyer', 'procurement',
    'purchasing',
  ] },
  { concept: 'NEG_NONTECH', lang: 'de', compound: true, terms: [
    'Projektleiter', 'Projektleiterin', 'Projektmanager', 'Projektmanagerin', 'Produktmanager', 'Produktmanagerin', 'Produktverantwortlicher',
    'Personalberater', 'Personalberaterin', 'Personalberatung', 'Recruiter', 'Lehrer', 'Lehrerin', 'Dozent', 'Dozentin', 'Professor', 'Professur',
    'Doktorand', 'Doktorandin', 'Promotion', 'Masterarbeit', 'Bachelorarbeit', 'Abschlussarbeit', 'Wissenschaftlicher Mitarbeiter',
    'Wissenschaftliche Mitarbeiterin', 'Jurist', 'Juristin', 'Rechtsanwalt', 'Versicherung', 'Einkäufer', 'Einkauf', 'Schulung', 'Ausbilder',
  ] },
  { concept: 'NEG_NONTECH', lang: 'fr', terms: ['chef de projet', 'cheffe de projet', 'directeur de projet', 'product owner', 'chargé de recrutement', 'recruteur', 'recruteuse', 'enseignant', 'enseignante', 'formateur', 'formatrice', 'professeur', 'doctorant', 'doctorante', 'thèse', 'post doctorant', 'juriste', 'avocat', 'acheteur', 'acheteuse'] },
  { concept: 'NEG_NONTECH', lang: 'es', terms: ['jefe de proyecto', 'director de proyecto', 'gestor de proyectos', 'reclutador', 'reclutadora', 'profesor', 'profesora', 'docente', 'formador', 'formadora', 'doctorando', 'tesis', 'TFM', 'TFG', 'abogado', 'abogada', 'comprador'] },
  { concept: 'NEG_NONTECH', lang: 'pt', terms: ['gerente de projetos', 'gestor de projetos', 'recrutador', 'recrutadora', 'professor', 'professora', 'docente', 'formador', 'doutorando', 'advogado', 'advogada', 'comprador'] },
  { concept: 'NEG_NONTECH', lang: 'it', terms: ['project manager', 'capo progetto', 'responsabile di progetto', 'selezionatore', 'docente', 'insegnante', 'formatore', 'dottorando', 'dottorato', 'tesi', 'avvocato', 'buyer'] },
  { concept: 'NEG_NONTECH', lang: 'nl', compound: true, terms: ['projectleider', 'projectmanager', 'productmanager', 'recruiter', 'docent', 'leraar', 'promovendus', 'afstudeeropdracht', 'afstudeerstage', 'jurist', 'inkoper'] },
  { concept: 'NEG_NONTECH', lang: 'sv', compound: true, terms: ['projektledare', 'produktägare', 'rekryterare', 'lärare', 'doktorand', 'examensarbete', 'jurist', 'inköpare'] },
  { concept: 'NEG_NONTECH', lang: 'da', compound: true, terms: ['projektleder', 'produktejer', 'rekrutteringskonsulent', 'lærer', 'underviser', 'ph.d.-studerende', 'phd-studerende', 'jurist', 'indkøber'] },
  { concept: 'NEG_NONTECH', lang: 'no', compound: true, terms: ['prosjektleder', 'produkteier', 'rekrutterer', 'lærer', 'stipendiat', 'jurist', 'innkjøper'] },
  { concept: 'NEG_NONTECH', lang: 'fi', compound: true, terms: ['projektipäällikkö', 'tuoteomistaja', 'rekrytoija', 'opettaja', 'väitöskirjatutkija', 'opinnäytetyö', 'lakimies', 'ostaja'] },
  { concept: 'NEG_NONTECH', lang: 'pl', terms: ['kierownik projektu', 'rekruter', 'rekruterka', 'nauczyciel', 'wykładowca', 'doktorant', 'prawnik', 'kupiec'] },
  { concept: 'NEG_NONTECH', lang: 'cs', terms: ['projektový manažer', 'vedoucí projektu', 'náborář', 'učitel', 'lektor', 'doktorand', 'právník', 'nákupčí'] },

  // ── Clearance levels: the word "security" here says nothing about the role ─────────────
  { concept: 'IGNORE', lang: 'en', terms: [
    'security clearance', 'security cleared', 'clearance', 'clearance required', 'SC clearance', 'SC cleared', 'DV clearance', 'DV cleared',
    'eligible for SC', 'eligible for security clearance', 'active clearance', 'secret clearance', 'top secret', 'TS SCI', 'TS/SCI', 'NATO secret',
    'baseline clearance', 'NV1', 'NV2', 'AGSVA', 'public trust', 'polygraph', 'CI poly', 'full scope poly',
  ] },
  { concept: 'IGNORE', lang: 'de', compound: true, terms: ['Sicherheitsüberprüfung', 'Sicherheitsüberprüfungen', 'Sicherheitsfreigabe', 'Ü2', 'Ü3', 'SÜ2', 'SÜ3', 'VS-NfD', 'Geheimschutz'] },
  { concept: 'IGNORE', lang: 'fr', terms: ['habilitation', 'habilitable', 'habilité', 'habilitée', 'secret défense', 'confidentiel défense', 'habilitation secret'] },
  { concept: 'IGNORE', lang: 'nl', terms: ['VOG', 'screening', 'AIVD screening', 'A-screening', 'B-screening'] },
];
