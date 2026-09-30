import { describe, expect, it } from 'vitest';
import { verifyQuote } from '@/lib/ai/verify';
import { LANGUAGE_REQUIREMENTS } from '@/db/schema/_enums';
import {
  LANGUAGE_LOGIC_VERSION,
  MIN_LETTERS_FOR_DETECTION,
  detectLanguage,
  detectPostingLanguage,
  findLanguageMentions,
} from '@/lib/normalize/language';

const NOW = new Date('2026-09-29T08:00:00Z');

type Req = 'english_ok' | 'local_required' | 'unclear';

interface Case {
  text: string;
  country?: string | null;
  requirement: Req;
  confidence?: 'high' | 'medium' | 'low';
  /** Non-English languages expected in `required`. */
  required?: string[];
  preferred?: string[];
  notRequired?: string[];
  /** A fragment the evidence quote must contain (checked case-insensitively). */
  evidence?: string;
}

const EN_BODY =
  'We are looking for a backend engineer to join our platform team. You will design and build services in Go and TypeScript, run them on Kubernetes and mentor other engineers.';
const DE_BODY =
  'Wir suchen einen Backend-Entwickler (m/w/d) für unser Plattform-Team. Du entwickelst Services mit Go und TypeScript, betreibst sie auf Kubernetes und unterstützt andere Entwickler.';
const FR_BODY =
  "Nous recherchons un développeur backend pour rejoindre notre équipe plateforme. Vous concevez des services en Go et TypeScript et vous les déployez sur Kubernetes avec l'équipe.";
const NL_BODY =
  'Wij zijn op zoek naar een backend developer voor ons platformteam. Je bouwt services in Go en TypeScript, je draait ze op Kubernetes en je begeleidt andere developers.';
const ES_BODY =
  'Buscamos un desarrollador backend para unirse a nuestro equipo de plataforma. Diseñarás y construirás servicios en Go y TypeScript y los desplegarás en Kubernetes con el equipo.';
const SV_BODY =
  'Vi söker en backendutvecklare till vårt plattformsteam. Du kommer att bygga tjänster i Go och TypeScript, köra dem på Kubernetes och vara mentor för andra utvecklare i teamet.';
const PL_BODY =
  'Szukamy programisty backend do naszego zespołu platformowego. Będziesz projektować i budować usługi w Go oraz TypeScript, uruchamiać je na Kubernetes i wspierać innych programistów.';

const CASES: [string, Case][] = [
  // ---- English OK: explicit statements
  ['working language statement', { text: `${EN_BODY} Our working language is English.`, country: 'DE', requirement: 'english_ok', confidence: 'high', evidence: 'working language is English' }],
  ['working language, German phrasing', { text: `${DE_BODY} Unsere Arbeitssprache ist Englisch.`, country: 'DE', requirement: 'english_ok', confidence: 'high', evidence: 'Arbeitssprache ist Englisch' }],
  ['English als Arbeitssprache', { text: `${DE_BODY} Englisch als Arbeitssprache im gesamten Team.`, country: 'DE', requirement: 'english_ok', confidence: 'high' }],
  ['no German required', { text: `${EN_BODY} No German required.`, country: 'DE', requirement: 'english_ok', confidence: 'high', notRequired: ['de'], evidence: 'No German required' }],
  ['German is not required', { text: `${EN_BODY} German is not required.`, country: 'DE', requirement: 'english_ok', confidence: 'high', notRequired: ['de'] }],
  ['German not a must', { text: `${EN_BODY} German is not a must.`, country: 'DE', requirement: 'english_ok', notRequired: ['de'] }],
  ['no need to speak Dutch', { text: `${EN_BODY} There is no need to speak Dutch.`, country: 'NL', requirement: 'english_ok', confidence: 'high', notRequired: ['nl'] }],
  ['you do not need to speak Swedish', { text: `${EN_BODY} You do not need to speak Swedish.`, country: 'SE', requirement: 'english_ok', notRequired: ['sv'] }],
  ['Deutschkenntnisse nicht erforderlich', { text: `${DE_BODY} Deutschkenntnisse sind nicht erforderlich.`, country: 'DE', requirement: 'english_ok', notRequired: ['de'], evidence: 'Deutschkenntnisse sind nicht erforderlich' }],
  ['keine Deutschkenntnisse', { text: `${DE_BODY} Keine Deutschkenntnisse notwendig.`, country: 'DE', requirement: 'english_ok', notRequired: ['de'] }],
  ['Deutsch nicht zwingend erforderlich', { text: `${DE_BODY} Deutsch ist nicht zwingend erforderlich.`, country: 'DE', requirement: 'english_ok', notRequired: ['de'] }],
  ['ohne Deutsch', { text: `${EN_BODY} Also for candidates without German.`, country: 'DE', requirement: 'english_ok', notRequired: ['de'] }],
  ['French not required (fr)', { text: `${FR_BODY} Le français n'est pas obligatoire.`, country: 'FR', requirement: 'english_ok', notRequired: ['fr'] }],
  ['pas besoin de parler français', { text: `${FR_BODY} Pas besoin de parler français.`, country: 'FR', requirement: 'english_ok', notRequired: ['fr'] }],
  ['Dutch niet vereist', { text: `${NL_BODY} Nederlands is niet vereist.`, country: 'NL', requirement: 'english_ok', notRequired: ['nl'] }],
  ['Spanish no es necesario', { text: `${ES_BODY} El español no es necesario.`, country: 'ES', requirement: 'english_ok', notRequired: ['es'] }],
  ['Swedish inget krav', { text: `${SV_BODY} Svenska är inget krav.`, country: 'SE', requirement: 'english_ok', notRequired: ['sv'] }],
  ['Danish ikke et krav', { text: 'Vi søger en udvikler til vores team i København. Dansk er ikke et krav, da vi arbejder på engelsk.', country: 'DK', requirement: 'english_ok', notRequired: ['da'] }],
  ['Polish nie jest wymagany', { text: `${PL_BODY} Język polski nie jest wymagany.`, country: 'PL', requirement: 'english_ok', notRequired: ['pl'] }],
  ['Finnish ei vaadita', { text: 'Etsimme ohjelmistokehittäjää tiimiimme Helsinkiin. Suomen kieltä ei vaadita.', country: 'FI', requirement: 'english_ok', notRequired: ['fi'] }],
  ['English-speaking team', { text: `${EN_BODY} You will join an English-speaking team in Munich.`, country: 'DE', requirement: 'english_ok', confidence: 'high' }],
  ['English only', { text: `${EN_BODY} English only, all communication happens in Slack.`, country: 'NL', requirement: 'english_ok', confidence: 'high' }],
  ['English is enough', { text: `${EN_BODY} English is enough to get started.`, country: 'DE', requirement: 'english_ok', confidence: 'high' }],
  ['we work in English', { text: `${EN_BODY} We work in English every day.`, country: 'DE', requirement: 'english_ok', confidence: 'high' }],
  ['wir arbeiten auf Englisch', { text: `${DE_BODY} Im Team arbeiten wir auf Englisch.`, country: 'DE', requirement: 'english_ok', confidence: 'high' }],
  ['nous travaillons en anglais', { text: `${FR_BODY} Nous travaillons en anglais au quotidien.`, country: 'FR', requirement: 'english_ok', confidence: 'high' }],
  ['werktaal is Engels', { text: `${NL_BODY} Onze voertaal is Engels.`, country: 'NL', requirement: 'english_ok', confidence: 'high' }],
  ['Swedish arbetsspråk engelska', { text: `${SV_BODY} Vårt arbetsspråk är engelska.`, country: 'SE', requirement: 'english_ok', confidence: 'high' }],
  ['Polish językiem roboczym angielski', { text: `${PL_BODY} Angielski jest językiem roboczym w zespole.`, country: 'PL', requirement: 'english_ok', confidence: 'high' }],
  ['English-speaking environment', { text: `${EN_BODY} We are an international, English-speaking environment.`, country: 'AT', requirement: 'english_ok', confidence: 'high' }],
  ['englischsprachiges Team', { text: `${DE_BODY} Du arbeitest in einem englischsprachigen Team.`, country: 'DE', requirement: 'english_ok', confidence: 'high' }],
  ['Engelstalige omgeving', { text: `${NL_BODY} Je werkt in een Engelstalige omgeving.`, country: 'NL', requirement: 'english_ok', confidence: 'high' }],

  // ---- English OK: English asked for, local language optional
  ['fluent English, German a plus', { text: `${EN_BODY} Fluent English is required. German is a plus.`, country: 'DE', requirement: 'english_ok', confidence: 'medium', preferred: ['de'] }],
  ['English required, Dutch nice to have', { text: `${EN_BODY} Excellent English; Dutch is nice to have.`, country: 'NL', requirement: 'english_ok', preferred: ['nl'] }],
  ['Englisch sehr gut, Deutsch von Vorteil', { text: `${DE_BODY} Sehr gute Englischkenntnisse, Deutschkenntnisse sind von Vorteil.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['Deutsch wünschenswert', { text: `${DE_BODY} Fließendes Englisch; Deutsch wünschenswert.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['French un plus', { text: `${FR_BODY} Anglais courant exigé, le français est un plus.`, country: 'FR', requirement: 'english_ok', preferred: ['fr'] }],
  ['Dutch een pré', { text: `${NL_BODY} Vloeiend Engels, Nederlands is een pré.`, country: 'NL', requirement: 'english_ok', preferred: ['nl'] }],
  ['Spanish se valorará', { text: `${ES_BODY} Inglés fluido. Se valorará el español.`, country: 'ES', requirement: 'english_ok', preferred: ['es'] }],
  ['Italian titolo preferenziale', { text: 'Cerchiamo uno sviluppatore backend per il nostro team di Milano. Inglese fluente; la conoscenza dell\'italiano costituisce titolo preferenziale.', country: 'IT', requirement: 'english_ok', preferred: ['it'] }],
  ['Swedish meriterande', { text: `${SV_BODY} Flytande engelska krävs, svenska är meriterande.`, country: 'SE', requirement: 'english_ok', preferred: ['sv'] }],
  ['Polish mile widziany', { text: `${PL_BODY} Biegły angielski, polski mile widziany.`, country: 'PL', requirement: 'english_ok', preferred: ['pl'] }],
  ['basic German', { text: `${EN_BODY} Fluent English and basic German.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['German A2', { text: `${EN_BODY} Fluent English. German at A2 level is enough.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['Grundkenntnisse Deutsch', { text: `${DE_BODY} Sehr gutes Englisch, Grundkenntnisse in Deutsch.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['nice to have section', { text: `${EN_BODY}\nRequirements:\n- Fluent English\n- 5 years of Go\nNice to have:\n- German\n- Terraform`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['English or German', { text: `${EN_BODY} You speak English or German at a professional level.`, country: 'DE', requirement: 'english_ok', confidence: 'medium' }],
  ['Englisch oder Deutsch', { text: `${DE_BODY} Du sprichst fließend Englisch oder Deutsch.`, country: 'DE', requirement: 'english_ok' }],
  ['fluent English and German is a plus', { text: `${EN_BODY} Fluent English and German is a plus.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['English required in Ireland', { text: `${EN_BODY} Excellent written and spoken English.`, country: 'IE', requirement: 'english_ok', confidence: 'high' }],
  ['English required in Germany', { text: `${EN_BODY} Excellent written and spoken English.`, country: 'DE', requirement: 'english_ok', confidence: 'medium' }],
  ['German courses offered', { text: `${EN_BODY} We offer free German language courses.`, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['Deutschkurs benefit (English posting)', { text: `${EN_BODY} Benefits: company pension, Deutschkurs, gym.`, country: 'DE', requirement: 'english_ok' }],

  // ---- Local language required
  ['fluent German required', { text: `${EN_BODY} Fluent German is required.`, country: 'DE', requirement: 'local_required', confidence: 'high', required: ['de'], evidence: 'Fluent German' }],
  ['fluent German and English', { text: `${EN_BODY} You speak fluent German and English.`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['German C1', { text: `${EN_BODY} German (C1) and English (B2).`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['Deutsch C1 und Englisch B2', { text: `${DE_BODY} Deutsch C1 und Englisch B2 erforderlich.`, country: 'DE', requirement: 'local_required', required: ['de'], evidence: 'Deutsch C1' }],
  ['fließende Deutsch- und Englischkenntnisse', { text: `${DE_BODY} Fließende Deutsch- und Englischkenntnisse in Wort und Schrift.`, country: 'DE', requirement: 'local_required', confidence: 'high', required: ['de'], evidence: 'Fließende Deutsch- und Englischkenntnisse' }],
  ['verhandlungssicheres Deutsch', { text: `${DE_BODY} Verhandlungssicheres Deutsch und gutes Englisch.`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['sehr gute Deutschkenntnisse', { text: `${DE_BODY} Sehr gute Deutschkenntnisse.`, country: 'AT', requirement: 'local_required', required: ['de'] }],
  ['gute Deutschkenntnisse (weak)', { text: `${DE_BODY} Gute Deutschkenntnisse.`, country: 'DE', requirement: 'local_required', confidence: 'medium', required: ['de'] }],
  ['Deutsch als Muttersprache', { text: `${DE_BODY} Deutsch auf muttersprachlichem Niveau.`, country: 'CH', requirement: 'local_required', required: ['de'] }],
  ['German speaking role', { text: `${EN_BODY} This is a German-speaking customer role.`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['German-speaking team', { text: `${EN_BODY} You will work in a German-speaking team.`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['deutschsprachiges Umfeld', { text: `${DE_BODY} Du arbeitest in einem deutschsprachigen Umfeld.`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['Dutch vloeiend', { text: `${NL_BODY} Je spreekt vloeiend Nederlands en Engels.`, country: 'NL', requirement: 'local_required', required: ['nl'] }],
  ['Nederlands in woord en geschrift', { text: `${NL_BODY} Uitstekende beheersing van het Nederlands in woord en geschrift.`, country: 'NL', requirement: 'local_required', required: ['nl'] }],
  ['maîtrise du français', { text: `${FR_BODY} Maîtrise du français et de l'anglais exigée.`, country: 'FR', requirement: 'local_required', required: ['fr'] }],
  ['français courant', { text: `${FR_BODY} Français courant indispensable.`, country: 'BE', requirement: 'local_required', required: ['fr'] }],
  ['bilingue français anglais', { text: `${FR_BODY} Vous êtes bilingue français / anglais.`, country: 'FR', requirement: 'local_required', required: ['fr'] }],
  ['español nativo', { text: `${ES_BODY} Español nativo e inglés avanzado.`, country: 'ES', requirement: 'local_required', required: ['es'] }],
  ['imprescindible español', { text: `${ES_BODY} Imprescindible español e inglés fluido.`, country: 'ES', requirement: 'local_required', required: ['es'] }],
  ['italiano madrelingua', { text: 'Cerchiamo uno sviluppatore per il nostro team di Milano. Italiano madrelingua e ottima conoscenza dell\'inglese.', country: 'IT', requirement: 'local_required', required: ['it'] }],
  ['português fluente', { text: 'Procuramos um desenvolvedor backend para a nossa equipa em Lisboa. Português fluente e inglês avançado.', country: 'PT', requirement: 'local_required', required: ['pt'] }],
  ['flytande svenska', { text: `${SV_BODY} Du talar flytande svenska och engelska.`, country: 'SE', requirement: 'local_required', required: ['sv'] }],
  ['svenska i tal och skrift', { text: `${SV_BODY} Mycket goda kunskaper i svenska i tal och skrift.`, country: 'SE', requirement: 'local_required', required: ['sv'] }],
  ['flydende dansk', { text: 'Vi søger en udvikler til vores team i Aarhus. Du taler og skriver flydende dansk og engelsk.', country: 'DK', requirement: 'local_required', required: ['da'] }],
  ['flytende norsk', { text: 'Vi søker en utvikler til vårt team i Oslo. Du snakker flytende norsk, muntlig og skriftlig.', country: 'NO', requirement: 'local_required', required: ['no'] }],
  ['sujuva suomen kieli', { text: 'Etsimme ohjelmistokehittäjää tiimiimme Helsinkiin. Edellytämme sujuvaa suomen kielen taitoa.', country: 'FI', requirement: 'local_required', required: ['fi'] }],
  ['biegła znajomość polskiego', { text: `${PL_BODY} Biegła znajomość języka polskiego i angielskiego.`, country: 'PL', requirement: 'local_required', required: ['pl'] }],
  ['čeština podmínkou', { text: 'Hledáme vývojáře do našeho týmu v Praze. Aktivní znalost češtiny je podmínkou.', country: 'CZ', requirement: 'local_required', required: ['cs'] }],
  ['magyar nyelvtudás', { text: 'Backend fejlesztőt keresünk budapesti csapatunkba. Folyékony magyar nyelvtudás szükséges.', country: 'HU', requirement: 'local_required', required: ['hu'] }],
  ['limba română', { text: 'Căutăm un dezvoltator backend pentru echipa noastră din București. Cunoașterea limbii române la nivel avansat este obligatorie.', country: 'RO', requirement: 'local_required', required: ['ro'] }],
  ['ελληνικά', { text: 'Αναζητούμε προγραμματιστή για την ομάδα μας στην Αθήνα. Άριστη γνώση ελληνικών και αγγλικών.', country: 'GR', requirement: 'local_required', required: ['el'] }],
  ['türkçe', { text: 'İstanbul ofisimiz için backend geliştirici arıyoruz. Akıcı Türkçe ve iyi derecede İngilizce bilgisi gereklidir.', country: 'TR', requirement: 'local_required', required: ['tr'] }],
  ['日本語 ネイティブ', { text: '東京オフィスでバックエンドエンジニアを募集しています。日本語ネイティブレベル必須、英語はビジネスレベル歓迎。', country: 'JP', requirement: 'local_required', required: ['ja'] }],
  ['中文 流利', { text: '我们正在招聘上海团队的后端工程师。要求中文流利，英语良好。', country: 'CN', requirement: 'local_required', required: ['zh'] }],
  ['Mandarin fluent (English posting)', { text: `${EN_BODY} Fluent Mandarin is required for this role.`, country: 'SG', requirement: 'local_required', required: ['zh'] }],
  ['requirements section, bare language', { text: `${EN_BODY}\nRequirements:\n- German\n- 5 years of Go`, country: 'DE', requirement: 'local_required', confidence: 'medium', required: ['de'] }],
  ['Dein Profil section', { text: `${DE_BODY}\nDein Profil\n- Abgeschlossenes Studium\n- Deutsch und Englisch\nWir bieten\n- Deutschkurs`, country: 'DE', requirement: 'local_required', required: ['de'] }],
  ['required + English working (conflict lowers)', { text: `${EN_BODY} Our working language is English, but fluent German is required for customer calls.`, country: 'DE', requirement: 'local_required', confidence: 'medium', required: ['de'] }],
  ['required German, Spanish plus', { text: `${EN_BODY} Fluent German required, Spanish is a plus.`, country: 'DE', requirement: 'local_required', required: ['de'], preferred: ['es'] }],
  ['German speakers', { text: `${EN_BODY} We are looking for native German speakers.`, country: 'DE', requirement: 'local_required', required: ['de'] }],

  ['Languages line with levels', { text: `${EN_BODY}\nLanguages: English (fluent), German (basic)`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['Sprachen line with levels', { text: 'Wir suchen Entwickler (m/w/d) für unser Team in Wien. Sprachen: Deutsch (fließend), Englisch (gut). Wir bieten ein tolles Team.', country: 'AT', requirement: 'local_required', required: ['de'] }],
  ['knowledge of German an advantage', { text: `${EN_BODY} Knowledge of German would be an advantage.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['ideally also German', { text: `${EN_BODY} You are fluent in English and ideally also in German.`, country: 'DE', requirement: 'english_ok', preferred: ['de'] }],
  ['must be fluent in English and German', { text: `${EN_BODY} You must be fluent in English and German.`, country: 'CH', requirement: 'local_required', required: ['de'] }],
  ['both English and Dutch essential', { text: `${EN_BODY} Fluency in both English and Dutch is essential.`, country: 'NL', requirement: 'local_required', required: ['nl'] }],
  ['English a must, Dutch is not', { text: `${EN_BODY} English is a must, Dutch is not.`, country: 'NL', requirement: 'english_ok', notRequired: ['nl'] }],
  ['one of the Nordic languages', { text: `${EN_BODY} Our clients are in the Nordics, so Swedish, Norwegian or Danish is required.`, country: 'SE', requirement: 'local_required', required: ['sv', 'no', 'da'] }],
  ["don't need German but English a must", { text: `${EN_BODY} You don't need to speak German, but fluent English is a must.`, country: 'DE', requirement: 'english_ok', confidence: 'high', notRequired: ['de'] }],
  ['benefits section German lessons', { text: `${EN_BODY}\nRequirements:\n- 5 years Go\nBenefits:\n- German lessons`, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['Danish working language + not needed', { text: 'Vi søger en udvikler. Engelsk er vores arbejdssprog, så du behøver ikke at tale dansk.', country: 'DK', requirement: 'english_ok', confidence: 'high', notRequired: ['da'] }],
  ['offices are not requirements', { text: `${EN_BODY} You will work with our French and German offices.`, country: 'GB', requirement: 'english_ok', confidence: 'high' }],
  ['localisation targets are not requirements', { text: `${EN_BODY} Localization of our app into French, German and Spanish.`, country: 'GB', requirement: 'english_ok', confidence: 'high' }],

  // ---- Unclear
  ['German posting, no statement', { text: `${DE_BODY} Bewirb dich jetzt!`, country: 'DE', requirement: 'unclear', confidence: 'low' }],
  ['French posting, no statement', { text: FR_BODY, country: 'FR', requirement: 'unclear', confidence: 'low' }],
  ['German posting asks only English', { text: `${DE_BODY} Sehr gute Englischkenntnisse.`, country: 'DE', requirement: 'unclear', confidence: 'low' }],
  ['Polish posting asks English B2', { text: `${PL_BODY} Znajomość języka angielskiego na poziomie B2.`, country: 'PL', requirement: 'unclear', confidence: 'low' }],
  ['empty', { text: '', requirement: 'unclear', confidence: 'low' }],
  ['too short', { text: 'Backend engineer', requirement: 'unclear', confidence: 'low' }],
  ['required and waived', { text: `${EN_BODY} Fluent German is required. German is not required for the first year.`, country: 'DE', requirement: 'unclear', confidence: 'low' }],

  // ---- Implicit English
  ['English posting in Ireland', { text: EN_BODY, country: 'IE', requirement: 'english_ok', confidence: 'high' }],
  ['English posting in the UK', { text: EN_BODY, country: 'GB', requirement: 'english_ok', confidence: 'high' }],
  ['English posting, no country', { text: EN_BODY, country: null, requirement: 'english_ok', confidence: 'medium' }],
  ['English posting in Germany', { text: EN_BODY, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['English posting in the UAE', { text: EN_BODY, country: 'AE', requirement: 'english_ok', confidence: 'medium' }],

  // ---- Not a language
  ['German citizenship', { text: `${EN_BODY} Applicants must hold German citizenship. Fluent English.`, country: 'DE', requirement: 'english_ok' }],
  ['German company', { text: `${EN_BODY} We are a German company with a strong engineering culture.`, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['Deutsche Bank', { text: `${EN_BODY} Deutsche Bank is an equal opportunity employer.`, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['German-speaking countries', { text: `${EN_BODY} You will cover customers in German-speaking countries. English is our working language.`, country: 'DE', requirement: 'english_ok' }],
  ['polish your skills', { text: `${EN_BODY} You will polish your skills with a fluent team.`, country: 'IE', requirement: 'english_ok', confidence: 'high' }],
  ['CV in English or German', { text: `${EN_BODY} Please send your CV in English or German.`, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['Bewerbung auf Deutsch', { text: `${EN_BODY} Please send your application in German.`, country: 'DE', requirement: 'english_ok', confidence: 'low' }],
  ['French market', { text: `${EN_BODY} You will expand into the French market.`, country: 'GB', requirement: 'english_ok', confidence: 'high' }],
  ['Sicherheit near a name', { text: `${DE_BODY} Sicherheit ist uns wichtig, deshalb arbeiten wir mit deutschen Rechenzentren.`, country: 'DE', requirement: 'unclear' }],
];

describe('detectLanguage — requirement table', () => {
  it.each(CASES)('%s', (_name, c) => {
    const f = detectLanguage(c.text, { countryIso2: c.country ?? null, now: NOW });
    expect(LANGUAGE_REQUIREMENTS).toContain(f.value.requirement);
    expect({ req: f.value.requirement, note: f.value.note }).toMatchObject({ req: c.requirement });
    if (c.confidence) expect({ conf: f.confidence, note: f.value.note }).toMatchObject({ conf: c.confidence });
    if (c.required) expect(f.value.required).toEqual(c.required);
    if (c.preferred) expect(f.value.preferred).toEqual(c.preferred);
    if (c.notRequired) expect(f.value.notRequired).toEqual(c.notRequired);
    if (c.evidence) expect(f.evidence?.toLowerCase()).toContain(c.evidence.toLowerCase());
    if (f.evidence !== null) expect(verifyQuote(f.evidence, c.text)).toBe(true);
    if (f.value.requirement === 'local_required') expect(f.evidence).not.toBeNull();
    expect(f.source).toBe('posting text');
    expect(f.method).toBe('rule');
    expect(f.logicVersion).toBe(LANGUAGE_LOGIC_VERSION);
    expect(f.checkedAt).toEqual(NOW);
  });
});

describe('detectLanguage — value shape', () => {
  it('lists required languages first, then English, then preferred', () => {
    const f = detectLanguage(`${EN_BODY} Fluent German and English required, French is a plus.`, { countryIso2: 'DE', now: NOW });
    expect(f.value.languages).toEqual(['de', 'en', 'fr']);
    expect(f.value.required).toEqual(['de']);
    expect(f.value.preferred).toEqual(['fr']);
    expect(f.value.basis).toBe('statement');
  });

  it('marks the basis of implicit decisions', () => {
    expect(detectLanguage(EN_BODY, { countryIso2: 'IE', now: NOW }).value.basis).toBe('posting_language');
    expect(detectLanguage('', { now: NOW }).value.basis).toBe('none');
    expect(detectLanguage(EN_BODY, { now: NOW }).value.postingLang).toBe('en');
  });

  it('reports the English working language flag', () => {
    const f = detectLanguage(`${EN_BODY} English is our company language.`, { countryIso2: 'DE', now: NOW });
    expect(f.value.englishWorking).toBe(true);
    expect(f.value.languages).toEqual(['en']);
  });

  it('is deterministic and does not throw on odd input', () => {
    const odd = ['\u0000\u0001', '🙂🙂🙂', 'a'.repeat(100_000), 'English '.repeat(5_000), '<p>Fluent <b>German</b></p>'];
    for (const t of odd) {
      const a = detectLanguage(t, { now: NOW });
      const b = detectLanguage(t, { now: NOW });
      expect(a).toEqual(b);
      if (a.evidence) expect(verifyQuote(a.evidence, t) || a.evidence.length < 8).toBe(true);
    }
  });

  it('accepts null-ish text defensively', () => {
    expect(detectLanguage(undefined as unknown as string, { now: NOW }).value.requirement).toBe('unclear');
  });
});

describe('findLanguageMentions', () => {
  it('splits "fluent English and German is a plus"', () => {
    const m = findLanguageMentions('Fluent English and German is a plus.');
    expect(m.map((x) => [x.lang, x.cls])).toEqual([
      ['en', 'required'],
      ['de', 'preferred'],
    ]);
  });

  it('groups hyphenated German compounds', () => {
    const m = findLanguageMentions('Sehr gute Deutsch- und Englischkenntnisse');
    expect(m.map((x) => [x.lang, x.cls])).toEqual([
      ['de', 'required'],
      ['en', 'required'],
    ]);
  });

  it('marks alternatives', () => {
    const m = findLanguageMentions('Fluent English or German.');
    expect(m[0].alternatives).toEqual(['de']);
    expect(m[1].alternatives).toEqual(['en']);
    expect(findLanguageMentions('Fluent English and/or German.')[0].alternatives).toEqual([]);
  });

  it('reads CEFR levels', () => {
    const levels: [string, string][] = [
      ['German C2', 'required'],
      ['German C1', 'required'],
      ['German B2+', 'required'],
      ['German level B2', 'required'],
      ['Deutsch Niveau B1', 'required_weak'],
      ['German B1/B2', 'required_weak'],
      ['German A2', 'basic'],
      ['German (A1)', 'basic'],
    ];
    for (const [t, cls] of levels) expect([t, findLanguageMentions(t)[0]?.cls]).toEqual([t, cls]);
  });

  it('respects capitalised-only names', () => {
    expect(findLanguageMentions('you will polish the product, fluent in design')).toEqual([]);
    expect(findLanguageMentions('Fluent Polish is required')[0]?.lang).toBe('pl');
    expect(findLanguageMentions('fluent thai food lover')).toEqual([]);
  });

  it('ignores nationality and company uses', () => {
    for (const t of [
      'German citizenship required',
      'French nationals only',
      'Dutch company',
      'Swiss-German market',
      'Italian passport holders',
      'im deutschsprachigen Raum',
      'deutsche Staatsangehörigkeit erforderlich',
      'the German version below',
    ]) {
      expect([t, findLanguageMentions(t).map((m) => m.lang)]).toEqual([t, []]);
    }
  });

  it('quotes verbatim', () => {
    const text = 'Profil:\n  • Fließendes   Deutsch (C1)\n  • Englisch von Vorteil';
    for (const m of findLanguageMentions(text)) expect(verifyQuote(m.quote, text)).toBe(true);
  });

  const NAME_CASES: [string, string][] = [
    ['English', 'en'], ['Englisch', 'en'], ['anglais', 'en'], ['inglés', 'en'], ['inglese', 'en'], ['Engels', 'en'], ['engelska', 'en'],
    ['angielski', 'en'], ['angličtina', 'en'], ['angol', 'en'], ['engleză', 'en'], ['английский', 'en'], ['英語', 'en'], ['영어', 'en'],
    ['Deutsch', 'de'], ['German', 'de'], ['allemand', 'de'], ['alemán', 'de'], ['tedesco', 'de'], ['Duits', 'de'], ['tyska', 'de'],
    ['niemiecki', 'de'], ['němčina', 'de'], ['német', 'de'], ['немецкий', 'de'], ['ドイツ語', 'de'],
    ['French', 'fr'], ['Französisch', 'fr'], ['français', 'fr'], ['Frans', 'fr'], ['francuski', 'fr'],
    ['Dutch', 'nl'], ['Niederländisch', 'nl'], ['Nederlands', 'nl'], ['néerlandais', 'nl'], ['Flemish', 'nl'],
    ['Spanish', 'es'], ['español', 'es'], ['castellano', 'es'], ['Spanisch', 'es'], ['hiszpański', 'es'],
    ['Italian', 'it'], ['italiano', 'it'], ['Italienisch', 'it'], ['Portuguese', 'pt'], ['português', 'pt'],
    ['Polish', 'pl'], ['polski', 'pl'], ['Polnisch', 'pl'], ['Swedish', 'sv'], ['svenska', 'sv'], ['Danish', 'da'], ['dansk', 'da'],
    ['Norwegian', 'no'], ['norsk', 'no'], ['bokmål', 'no'], ['Finnish', 'fi'], ['suomen kieli', 'fi'], ['Czech', 'cs'], ['čeština', 'cs'],
    ['Slovak', 'sk'], ['slovenčina', 'sk'], ['Hungarian', 'hu'], ['magyarul', 'hu'], ['Romanian', 'ro'], ['limba română', 'ro'],
    ['Greek', 'el'], ['ελληνικά', 'el'], ['Bulgarian', 'bg'], ['български', 'bg'], ['Croatian', 'hr'], ['hrvatski', 'hr'],
    ['Serbian', 'sr'], ['srpski', 'sr'], ['Slovenian', 'sl'], ['slovenščina', 'sl'], ['Estonian', 'et'], ['eesti keel', 'et'],
    ['Latvian', 'lv'], ['latviešu valoda', 'lv'], ['Lithuanian', 'lt'], ['lietuvių kalba', 'lt'], ['Turkish', 'tr'], ['Türkçe', 'tr'],
    ['Russian', 'ru'], ['русский язык', 'ru'], ['Ukrainian', 'uk'], ['українська', 'uk'], ['Hebrew', 'he'], ['עברית', 'he'],
    ['Arabic', 'ar'], ['العربية', 'ar'], ['Mandarin', 'zh'], ['中文', 'zh'], ['Japanese', 'ja'], ['日本語', 'ja'], ['Korean', 'ko'],
    ['한국어', 'ko'], ['Hindi', 'hi'], ['Icelandic', 'is'], ['Maltese', 'mt'], ['Catalan', 'ca'], ['català', 'ca'], ['Luxembourgish', 'lb'],
    ['Welsh', 'cy'], ['Irish language', 'ga'], ['Basque', 'eu'], ['Vietnamese', 'vi'], ['Thai', 'th'], ['Persian', 'fa'],
  ];
  it.each(NAME_CASES)('recognises "%s" as %s', (name, code) => {
    expect(findLanguageMentions(`Fluent ${name} required`).map((m) => m.lang)).toContain(code);
  });
});

describe('detectPostingLanguage', () => {
  const SAMPLES: [string, string, string][] = [
    ['en', EN_BODY, 'franc'],
    ['de', DE_BODY, 'franc'],
    ['fr', FR_BODY, 'franc'],
    ['nl', NL_BODY, 'franc'],
    ['es', ES_BODY, 'franc'],
    ['sv', SV_BODY, 'franc'],
    ['pl', PL_BODY, 'franc'],
    ['it', 'Cerchiamo uno sviluppatore backend per il nostro team di Milano. Progetterai e costruirai servizi in Go e TypeScript e li distribuirai su Kubernetes insieme al team.', 'franc'],
    ['pt', 'Procuramos um desenvolvedor backend para a nossa equipa em Lisboa. Vais desenhar e construir serviços em Go e TypeScript e colocá-los em produção no Kubernetes.', 'franc'],
    ['da', 'Vi søger en erfaren udvikler til vores team i København. Du har erfaring med Java og cloudtjenester, og du er interesseret i nye teknologier og kan lide at arbejde i et team.', 'stopwords'],
    ['no', 'Vi søker en erfaren utvikler til vårt team i Oslo. Du har erfaring med Java og skytjenester, og du er interessert i nye teknologier og liker å jobbe i team.', 'stopwords'],
    ['fi', 'Etsimme kokenutta ohjelmistokehittäjää tiimiimme Helsinkiin. Sinulla on kokemusta Javasta ja olet kiinnostunut pilvipalveluista ja uusista teknologioista.', 'stopwords'],
    ['et', 'Otsime kogemustega tarkvaraarendajat meie meeskonda Tallinnas. Sul on kogemus Java ja pilveteenustega ning sa oled huvitatud uutest tehnoloogiatest.', 'stopwords'],
    ['lv', 'Meklējam pieredzējušu programmatūras izstrādātāju mūsu komandai Rīgā. Tev ir pieredze ar Java un mākoņpakalpojumiem, un tu esi ieinteresēts jaunās tehnoloģijās.', 'stopwords'],
    ['lt', 'Ieškome patyrusio programinės įrangos kūrėjo į mūsų komandą Vilniuje. Turite patirties su Java ir debesų paslaugomis ir domitės naujomis technologijomis.', 'stopwords'],
    ['cs', 'Hledáme zkušeného vývojáře softwaru do našeho týmu v Praze. Máte zkušenosti s Javou a cloudovými službami a zajímáte se o nové technologie.', 'franc'],
    ['sk', 'Hľadáme skúseného vývojára softvéru do nášho tímu v Bratislave. Máte skúsenosti s Javou a cloudovými službami a zaujímate sa o nové technológie.', 'stopwords'],
    ['sl', 'Iščemo izkušenega razvijalca programske opreme za našo ekipo v Ljubljani. Imate izkušnje z Javo in storitvami v oblaku ter vas zanimajo nove tehnologije.', 'stopwords'],
    ['hu', 'Tapasztalt szoftverfejlesztőt keresünk budapesti csapatunkba. Van tapasztalatod Java és felhőszolgáltatások terén, és érdekelnek az új technológiák.', 'franc'],
    ['ro', 'Căutăm un dezvoltator software cu experiență pentru echipa noastră din București. Ai experiență cu Java și servicii cloud și ești interesat de tehnologii noi.', 'franc'],
    ['ca', 'Busquem un desenvolupador amb experiència en Java per al nostre equip a Barcelona. Oferim treball remot i un bon ambient de feina amb molts projectes nous.', 'stopwords'],
    ['tr', 'İstanbul ofisimiz için deneyimli bir yazılım geliştirici arıyoruz. Java ve bulut hizmetleri konusunda deneyimlisin ve yeni teknolojilere ilgi duyuyorsun.', 'franc'],
    ['ru', 'Ищем опытного разработчика в нашу команду в Москве. У вас есть опыт работы с Java и облачными сервисами, и вам интересны новые технологии.', 'franc'],
    ['uk', 'Шукаємо досвідченого розробника до нашої команди у Києві. Ви маєте досвід роботи з Java та хмарними сервісами і цікавитеся новими технологіями.', 'franc'],
    ['bg', 'Търсим опитен софтуерен разработчик за нашия екип в София. Имате опит с Java и облачни услуги и се интересувате от нови технологии.', 'franc'],
    ['el', 'Αναζητούμε έμπειρο προγραμματιστή για την ομάδα μας στην Αθήνα. Έχετε εμπειρία με Java και υπηρεσίες cloud.', 'script'],
    ['he', 'אנחנו מחפשים מפתח תוכנה מנוסה לצוות שלנו בתל אביב. יש לך ניסיון עם ג׳אווה ושירותי ענן.', 'script'],
    ['ar', 'نبحث عن مطور برمجيات ذي خبرة للانضمام إلى فريقنا في دبي. لديك خبرة في جافا والخدمات السحابية وتهتم بالتقنيات الجديدة.', 'franc'],
    ['ja', '私たちは東京のチームでソフトウェアエンジニアを募集しています。Javaの経験がある方歓迎。', 'script'],
    ['zh', '我们正在招聘一名高级软件工程师，负责后端服务开发。要求熟悉Java和云服务。', 'script'],
    ['ko', '저희는 서울에서 소프트웨어 엔지니어를 채용하고 있습니다. 자바 경험이 필요합니다.', 'script'],
  ];
  it.each(SAMPLES)('%s', (lang, text, method) => {
    const r = detectPostingLanguage(text);
    expect({ lang: r.lang, method: r.method }).toEqual({ lang, method });
  });

  it('ignores URLs, e-mails and code tokens', () => {
    const t = `${DE_BODY} https://example.com/careers/backend-engineer-english-team jobs@example.com src/main/java/App.java`;
    expect(detectPostingLanguage(t).lang).toBe('de');
  });

  it('does not guess on short text', () => {
    expect(detectPostingLanguage('Senior Java Developer').lang).toBeNull();
    expect(detectPostingLanguage('x'.repeat(MIN_LETTERS_FOR_DETECTION - 1)).method).toBe('none');
    expect(detectPostingLanguage('').lang).toBeNull();
    expect(detectPostingLanguage('12345 67890 !!!').lang).toBeNull();
  });

  it('English tech words do not outvote Japanese', () => {
    expect(detectPostingLanguage('Java、Kotlin、Spring Boot、AWS、Docker、Kubernetesの経験がある方を募集しています。').lang).toBe('ja');
  });

  it('lowers confidence on short samples', () => {
    const short = detectPostingLanguage('We are hiring a backend engineer for our team in Dublin.');
    expect(short.lang).toBe('en');
    expect(short.confidence).not.toBe('high');
  });
});
