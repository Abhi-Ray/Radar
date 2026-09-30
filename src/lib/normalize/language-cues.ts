/**
 * Requirement wording around a language name, per class, in the posting languages RADAR sees.
 * Same syntax as `language-names.ts`: natural spelling (folded at build time), `*` = any letters,
 * a space matches whitespace or a hyphen, `(a|b)` and `?` work as in regular expressions.
 * Overlapping matches are resolved longest-first, so "not required" beats "required" and
 * "nicht zwingend erforderlich" beats "zwingend".
 */

export type CueClass =
  | 'not_required'
  | 'support'
  | 'preferred'
  | 'basic'
  | 'only'
  | 'working'
  | 'required'
  | 'required_weak';

/** A clear requirement: "fluent", "required", "verhandlungssicher", "C1". */
export const REQUIRED_CUES: readonly string[] = [
  // en
  'required', 'requirement', 'requirements', 'a must', 'is a must', 'must', 'must have', 'must-have', 'mandatory', 'essential', 'necessary',
  'needed', 'you need', 'you will need', 'you must speak', 'must speak', 'must be fluent', 'fluent*', 'fluency', 'native', 'native level',
  'mother tongue', 'first language', 'bilingual', 'proficien*', 'full professional', 'professional working', 'business fluent',
  'business level', 'business proficiency', 'written and spoken', 'spoken and written', 'written and verbal', 'verbal and written',
  'written and oral', 'oral and written', 'expected', 'prerequisite', 'not optional', 'you speak', 'able to speak', 'ability to speak',
  'excellent', 'very good', 'strong', 'advanced', 'high level', 'perfect', 'impeccable', 'outstanding', 'superb', 'speakers?',
  'speaking', 'professional level', 'professional proficiency', 'at a professional level', 'working level', 'upper intermediate',
  // de
  'erforderlich', 'vorausgesetzt', 'voraussetzung', 'zwingend*', 'unbedingt', 'unabdingbar', 'notwendig', 'nötig', 'benötigt',
  'erwartet', 'muss', 'musst', 'pflicht', 'fließend*', 'verhandlungssicher*', 'sehr gut*', 'ausgezeichnet*', 'hervorragend*',
  'exzellent*', 'perfekt*', 'muttersprach*', 'in wort und schrift', 'in schrift und wort', 'stilsicher*', 'sicher', 'sichere', 'sicheres', 'sicheren', 'sicherer', 'beherrsch*',
  'du sprichst', 'sie sprechen', 'sprichst', 'setzen voraus', 'setzen wir voraus', 'verfügst über', 'verfügen über', 'fundiert*',
  'auf muttersprachlichem niveau', 'c-niveau',
  // fr
  'requis*', 'exigé*', 'obligatoire*', 'indispensable*', 'nécessaire*', 'impératif*', 'maîtrise*', 'maîtriser', 'maîtrisez',
  'courant*', 'couramment', 'bilingue*', 'parfait*', 'excellent*', 'très bon*', 'langue maternelle', 'natif*', 'native',
  'à l\'écrit comme à l\'oral', 'écrit et oral', 'oral et écrit', 'écrit et parlé', 'lu écrit parlé', 'exigence*', 'vous parlez',
  'parlez', 'parles', 'vous maîtrisez', 'tu maîtrises', 'maîtrises',
  // es
  'imprescindible*', 'obligatorio*', 'requerido*', 'requisito*', 'necesario*', 'fluido*', 'fluidez', 'nativo*', 'dominio', 'dominas',
  'avanzado*', 'alto nivel', 'nivel alto', 'nivel avanzado', 'excelente*', 'bilingüe*', 'hablado y escrito', 'escrito y hablado',
  'muy buen*', 'hablas', 'se requiere', 'exigible', 'se exige',
  // it
  'richiest*', 'obbligatori*', 'indispensabil*', 'necessari*', 'fluente*', 'ottim*', 'eccellent*', 'madrelingua', 'padronanza',
  'parlato e scritto', 'scritto e parlato', 'conoscenza approfondita', 'livello avanzato', 'avanzat*', 'parli', 'è richiesta',
  // nl
  'vereist*', 'verplicht*', 'noodzakelijk*', 'noodzaak', 'vloeiend*', 'uitstekend*', 'zeer goed*', 'beheersing', 'beheers*',
  'spreek je', 'je spreekt', 'u spreekt', 'moedertaal', 'in woord en geschrift', 'in woord en schrift', 'een must', 'eis', 'perfect*',
  // sv
  'krav', 'krävs', 'ett krav', 'obligatorisk*', 'nödvändig*', 'flytande', 'mycket god*', 'utmärkt*', 'i tal och skrift',
  'i skrift och tal', 'behärsk*', 'modersmål*', 'du talar', 'talar', 'förutsätter', 'förutsättning',
  // da
  'påkrævet', 'et krav', 'nødvendig*', 'flydende', 'i skrift og tale', 'i tale og skrift', 'meget god*', 'du taler', 'taler',
  'modersmål', 'behersk*', 'forudsætning',
  // no
  'påkrevd', 'påkrevet', 'flytende', 'muntlig og skriftlig', 'skriftlig og muntlig', 'svært god*', 'du snakker', 'snakker',
  'morsmål*', 'forutsetning',
  // fi
  'vaatimus', 'edellytys', 'edellytetään', 'vaaditaan', 'vaadittava*', 'sujuva*', 'sujuvasti', 'erinomai*', 'välttämätön*',
  'äidinkieli*', 'kiitettävä*', 'puhut', 'hallitset', 'hallitsee',
  // pl
  'wymagan*', 'wymóg', 'wymagamy', 'obowiązkow*', 'konieczn*', 'niezbędn*', 'biegł*', 'bardzo dobr*', 'płynn*', 'zaawansowan*',
  'w mowie i piśmie', 'w piśmie i mowie', 'ojczyst*', 'posługujesz się', 'władasz', 'znasz',
  // cs / sk
  'podmínkou', 'podmienkou', 'nutn*', 'nutnost', 'vyžadován*', 'vyžadujeme', 'vyžaduje*', 'požadujeme', 'požadovan*', 'požiadav*',
  'plynul*', 'aktivní*', 'aktívn*', 'pokročil*', 'perfektní*', 'slovem i písmem', 'slovom aj písmom', 'velmi dobr*', 'veľmi dobr*',
  'výborn*', 'nevyhnutn*', 'potrebn*', 'rodilý mluvčí', 'rodený hovoriaci',
  // hu
  'elvárás*', 'feltétel*', 'szükséges', 'kötelező*', 'folyékony*', 'tárgyalóképes*', 'magas szint*', 'kiváló*', 'anyanyelv*',
  'szóban és írásban', 'írásban és szóban', 'felsőfok*',
  // ro
  'obligatori*', 'necesar*', 'cerinț*', 'fluent*', 'fluență', 'avansat*', 'excelent*', 'foarte bun*', 'nivel avansat', 'nativ*',
  'scris și vorbit', 'vorbit și scris',
  // pt
  'obrigatóri*', 'necessári*', 'imprescindível', 'imprescindíveis', 'fluente*', 'fluência', 'domínio', 'avançad*', 'exigid*',
  'falado e escrito', 'escrito e falado',
  // el
  'απαραίτητ*', 'άριστη γνώση', 'άριστ*', 'άψογ*', 'πολύ καλή', 'υποχρεωτικ*', 'απαιτείται', 'απαιτούνται', 'προαπαιτούμεν*', 'μητρική',
  // bg
  'задължител*', 'изисква*', 'свободно', 'свободно владеене', 'отлично', 'отлични', 'отлично владеене', 'много добро', 'владеете',
  // hr / sr / bs / sl
  'obavezn*', 'obvezn*', 'potrebn*', 'nužn*', 'uvjet', 'uslov', 'pogoj', 'tečno', 'tečn*', 'izvrsn*', 'odlič*', 'aktivno',
  'aktivno znanje', 'napredn*', 'zahtev*', 'zahtijev*', 'vrlo dobr*', 'zelo dobr*', 'materinsk*',
  // et
  'nõutav', 'kohustuslik*', 'sujuv*', 'väga hea*', 'heal tasemel', 'vabalt', 'emakeel*', 'eeldame', 'vajalik',
  // lv
  'obligāt*', 'nepieciešam*', 'prasīb*', 'teicam*', 'brīvi', 'dzimt*',
  // lt
  'privalom*', 'būtin*', 'reikalaujam*', 'reikalavim*', 'puik*', 'laisvai', 'labai ger*', 'gimt*',
  // tr
  'zorunlu', 'gerekli', 'şart', 'akıcı', 'ileri seviye*', 'ileri düzey*', 'iyi derecede', 'anadil*', 'çok iyi',
  // ru / uk
  'обязател*', 'требуется', 'требуются', 'требования', 'необходим*', 'свободн*', 'отличн*', 'уверенн*', 'родн*', 'обов\'язков*',
  'вільн*', 'необхідн*', 'вимагається', 'досконал*',
  // ja / zh / ko / ar / he
  '必須', '必要', 'ネイティブ', 'ビジネスレベル', '流暢', '堪能', '必须', '流利', '精通', '熟练', '熟練', '母语', '母語', '필수', '능통', '유창',
  '원어민', 'مطلوب', 'إجادة', 'اجادة', 'بطلاقة', 'ضروري', 'חובה', 'ברמה גבוהה', 'שפת אם',
];

/** Softer requirement wording: "good", "knowledge of", "Languages:". Only counted close to the name. */
export const REQUIRED_WEAK_CUES: readonly string[] = [
  'good', 'good command', 'command of', 'working knowledge', 'knowledge of', 'knowledge', 'skills in', 'communication skills in',
  'solid', 'languages', 'language skills', 'language', 'understanding of', 'ability to communicate', 'communicate', 'competent',
  'working proficiency', 'intermediate', 'intermediate level',
  'gut', 'gute', 'guten', 'guter', 'gutes', 'gute kenntnisse', 'kenntnisse', 'kenntnisse in', 'sprachkenntnisse', 'sprachen', 'sprache', 'solide*', 'kommunikationsfähig*',
  'bon', 'bonne', 'bonnes', 'connaissance*', 'langues', 'niveau',
  'buen', 'buena', 'buenas', 'buenos', 'bueno', 'conocimiento*', 'idiomas', 'nivel',
  'buon', 'buona', 'buone', 'buono', 'buoni', 'conoscenza*', 'lingue', 'livello',
  'goed*', 'kennis', 'talen',
  'god', 'goda', 'kunskap*', 'språk',
  'gode', 'kendskab', 'kundskab*', 'sprog', 'kunnskap*',
  'hyvä*', 'kielitaito*', 'osaaminen', 'osaat',
  'dobr*', 'znajomość', 'języki', 'komunikatywn*',
  'znalost*', 'znalosť*', 'jazyky', 'komunikativ*',
  'jó', 'ismeret*', 'nyelvtudás', 'nyelvismeret*', 'középfok*',
  'bun', 'bună', 'bune', 'buni', 'cunoștinț*', 'cunoaștere*', 'limbi',
  'bom', 'boa', 'conhecimento*',
  'καλή', 'γνώση', 'γνώσεις', 'добро', 'добри', 'познания', 'владеене', 'poznavanje', 'znanje', 'jezik*',
  'hea', 'head', 'oskus*', 'keeleoskus*', 'labas', 'zināšanas', 'geros', 'gerai', 'žinios', 'mokėjimas',
  'iyi', 'bilgi*', 'хорош*', 'знание', 'владение', 'знання',
  '力', 'レベル', '能力', '良好', '능력', '가능',
];

/** Nice to have. */
export const PREFERRED_CUES: readonly string[] = [
  'plus', 'a plus', 'big plus', 'strong plus', 'bonus', 'advantage*', 'an advantage', 'nice to have', 'nice-to-have', 'desirable',
  'desired', 'preferred', 'preferabl*', 'beneficial', 'helpful', 'an asset', 'asset', 'welcome', 'appreciated', 'ideally',
  'would be great', 'great to have', 'good to have', 'is a benefit', 'optional', 'would be nice', 'would help', 'extra',
  'von vorteil', 'vorteil*', 'wünschenswert', 'ein plus', 'pluspunkt*', 'willkommen', 'gern gesehen', 'gerne gesehen', 'idealerweise',
  'wäre schön', 'wäre toll', 'wäre super', 'hilfreich', 'erwünscht',
  'un plus', 'un atout', 'atout*', 'apprécié*', 'souhaité*', 'souhaitable', 'serait un plus', 'idéalement', 'bienvenu*', 'est un plus',
  'avantage*', 'constitue un avantage',
  'valorable', 'se valorará', 'valorará', 'se valora', 'deseable', 'preferible', 'preferentemente', 'será un plus', 'es un plus',
  'ventaja*',
  'gradit*', 'preferibil*', 'titolo preferenziale', 'preferenziale', 'apprezzat*', 'costituisce un plus', 'vantaggio', 'è un plus',
  'een pré', 'is een pré', 'grote pré', 'pluspunt', 'meegenomen', 'mooi meegenomen', 'wenselijk', 'gewenst', 'bij voorkeur', 'voordeel',
  'strekt tot aanbeveling', 'aanbeveling',
  'meriterande', 'merit', 'ett plus', 'önskvärt', 'önskvärd*', 'fördel', 'en fördel', 'stort plus',
  'fordel', 'en fordel', 'et plus', 'ønskeligt', 'ønskelig*', 'et pluss', 'pluss',
  'eduksi', 'etu', 'etuna', 'plussaa', 'toivottava*',
  'mile widzian*', 'dodatkowym atutem', 'atut*', 'plusem', 'pożądan*', 'preferowan*', 'będzie atutem',
  'výhodou', 'vítán*', 'vítan*', 'výhoda', 'velkou výhodou', 'veľkou výhodou',
  'előny*', 'előnyt jelent', 'plusz',
  'avantaj*', 'constituie un avantaj', 'reprezintă un avantaj',
  'diferencial', 'desejáve*', 'valorizad*', 'um plus', 'preferencial', 'vantagem',
  'θα εκτιμηθεί', 'επιθυμητ*', 'πλεονέκτημα', 'предимство', 'prednost*', 'poželjn*', 'zaželen*', 'je prednost',
  'kasuks', 'eelis*', 'priekšrocīb*', 'privalumas', 'pranašumas',
  'tercih sebebi', 'tercih edilir', 'tercihen', 'artı',
  'преимуществ*', 'желательн*', 'будет плюсом', 'плюсом', 'плюс', 'перевага', 'бажано', 'бажан*', 'буде плюсом',
  '歓迎', '尚可', '優遇', '望ましい', '优先', '優先', '加分', '우대', '가산점', 'ميزة', 'يفضل', 'יתרון',
];

/** Basic level only ("basic German", "Grundkenntnisse", "A2"): not a working-level requirement. */
export const BASIC_CUES: readonly string[] = [
  'basic', 'basic knowledge', 'conversational', 'elementary', 'beginner', 'some knowledge',
  'grundkenntnisse', 'grundlegend*', 'erste kenntnisse', 'basiskenntnisse', 'notions', 'bases', 'connaissances de base',
  'niveau débutant', 'conocimientos básicos', 'nivel básico', 'básico', 'nociones', 'conoscenza di base', 'livello base',
  'nozioni', 'basiskennis', 'enige kennis', 'grundläggande', 'grundlæggende', 'grunnleggende', 'perustaso*', 'tyydyttävä',
  'podstawow*', 'základní*', 'základn*', 'alapfok*', 'alap szint*', 'de bază', 'începător', 'básic*', 'noções', 'βασικ*',
  'основн*', 'базов*', 'osnovn*', 'temel', 'начальн*', '日常会話', '基础', '基礎', '基本',
];

/** The language is explicitly not needed. */
export const NOT_REQUIRED_CUES: readonly string[] = [
  'not required', 'not a requirement', 'not necessary', 'not needed', 'not essential', 'not mandatory', 'not a must', 'no need',
  'don\'t need', 'do not need', 'doesn\'t need', 'does not need', 'don\'t have to', 'do not have to', 'isn\'t required',
  'is not required', 'aren\'t required', 'are not required', 'not expected', 'not a prerequisite', 'no prior', 'regardless of',
  'not compulsory', 'not obligatory', 'irrespective of', 'no knowledge of', 'need not', 'not necessarily', 'no problem', 'not a problem',
  'no requirement', 'not needed at all',
  'nicht erforderlich', 'nicht notwendig', 'nicht nötig', 'nicht zwingend', 'nicht zwingend erforderlich', 'nicht zwingend notwendig',
  'keine voraussetzung', 'kein muss', 'nicht vorausgesetzt', 'nicht benötigt', 'nicht verpflichtend', 'nicht notwendigerweise',
  'brauchst du nicht', 'musst du nicht', 'nicht unbedingt', 'kein problem', 'keine pflicht', 'nicht nötig',
  'pas obligatoire', 'pas requis', 'pas nécessaire', 'pas exigé', 'pas indispensable', 'n\'est pas requis*', 'n\'est pas obligatoire',
  'n\'est pas nécessaire', 'n\'est pas exigé*', 'n\'est pas indispensable', 'pas besoin', 'non requis*', 'non obligatoire',
  'non exigé*', 'non nécessaire', 'pas un prérequis', 'pas une obligation', 'pas de problème', 'pas un problème',
  'no es necesario', 'no es imprescindible', 'no es obligatorio', 'no es un requisito', 'no es requisito', 'no se requiere',
  'no requerido', 'no necesario', 'no imprescindible', 'no obligatorio', 'sin necesidad', 'no hace falta', 'no hay problema',
  'non richiest*', 'non è richiest*', 'non necessari*', 'non è necessari*', 'non obbligatori*', 'non è obbligatori*',
  'non indispensabil*', 'non è indispensabil*', 'non è un requisito', 'non serve',
  'niet vereist', 'niet nodig', 'niet noodzakelijk', 'niet verplicht', 'geen vereiste', 'geen must', 'geen eis', 'hoeft niet',
  'hoef je niet', 'hoeft u niet', 'geen probleem', 'geen voorwaarde',
  'inget krav', 'inte ett krav', 'inte nödvändig*', 'inte krav', 'krävs inte', 'behöver inte', 'behöver du inte', 'ej krav',
  'inget måste', 'inga krav', 'inget problem',
  'ikke et krav', 'ikke nødvendig*', 'ikke påkrævet', 'intet krav', 'behøver ikke', 'behøver du ikke', 'kræves ikke',
  'ikke noget krav', 'ikke påkrevd', 'ingen krav', 'trenger ikke', 'trenger du ikke', 'kreves ikke', 'ikke noe krav',
  'ei vaadita', 'ei edellytetä', 'ei ole vaatimus', 'ei ole välttämätön*', 'ei tarvitse', 'ei ole edellytys', 'ei välttämätön',
  'nie jest wymagan*', 'nie wymagamy', 'niewymagan*', 'nie jest konieczn*', 'nie jest niezbędn*', 'nie jest obowiązkow*',
  'bez znajomości', 'nie musisz',
  'není podmínkou', 'není nutn*', 'není vyžadován*', 'nie je podmienkou', 'nie je nutn*', 'nie je potrebn*', 'nie je vyžadovan*',
  'nevyžadujeme', 'bez znalosti', 'nemusíš', 'nemusíte',
  'nem feltétel', 'nem elvárás', 'nem szükséges', 'nem kötelező', 'nélkül', 'nem követelmény',
  'nu este obligatori*', 'nu este necesar*', 'nu este o cerință', 'nu e necesar*', 'nu e obligatori*', 'nu este cerut*',
  'não é obrigatóri*', 'não é necessári*', 'não é exigid*', 'não é imprescindível', 'não obrigatóri*', 'não necessári*',
  'sem necessidade', 'não é requisito',
  'δεν απαιτείται', 'δεν είναι απαραίτητ*', 'не е задължител*', 'не се изисква', 'не е необходим*',
  'nije uvjet', 'nije potrebn*', 'nije obavezn*', 'nije nužn*', 'nije uslov', 'ni pogoj', 'ni potrebn*', 'ni obvezn*',
  'ei ole nõutav', 'ei ole kohustuslik', 'pole nõutav', 'pole kohustuslik', 'ei ole vajalik', 'nav obligāt*', 'nav nepieciešam*',
  'nėra privalom*', 'nebūtin*', 'nėra būtin*', 'nereikalaujama',
  'gerekli değil', 'zorunlu değil', 'şart değil', 'aranmamaktadır', 'gerekmez', 'gerekmemektedir',
  'не обязател*', 'не требуется', 'не нужн*', 'не обов\'язков*', 'не потрібн*', 'не вимагається',
  '不問', '不要', '必須ではありません', '不要求', '不需要', '无需', '無需', '不限', '무관', '불필요',
];

/** Words directly before a language name that negate it ("no German", "ohne Deutschkenntnisse"). */
export const PRE_NEGATION_WORDS: readonly string[] = [
  'no', 'not', 'kein', 'keine', 'keinen', 'keinerlei', 'without', 'ohne', 'sans', 'sin', 'senza', 'zonder', 'geen', 'ingen',
  'inga', 'utan', 'uden', 'uten', 'ilman', 'bez', 'fără', 'sem', 'χωρίς', 'без', 'brez', 'ilma', 'pas de', 'pas d\'',
  'no need for', 'no need to speak', 'no need to know',
];

/** "English only", "nur Englisch", "English is enough". */
export const ONLY_CUES: readonly string[] = [
  'only', 'solely', 'exclusively', 'is enough', 'is sufficient', 'is all you need', 'all you need is', 'suffices',
  'nur', 'ausschließlich', 'reicht', 'reicht aus', 'genügt', 'uniquement', 'seulement', 'suffit', 'solo', 'solamente',
  'únicamente', 'es suficiente', 'basta', 'soltanto', 'alleen', 'volstaat', 'bara', 'endast', 'räcker', 'kun', 'er nok',
  'bare', 'riittää', 'vain', 'tylko', 'wystarczy', 'pouze', 'stačí', 'len', 'csak', 'elég', 'doar', 'apenas', 'somente',
  'только', 'лише', 'само', 'samo',
];

/** "is our working language", "Arbeitssprache", "English-speaking team". */
export const WORKING_CUES: readonly string[] = [
  'working language', 'work language', 'company language', 'corporate language', 'official language', 'business language',
  'team language', 'office language', 'language of work', 'internal language', 'main language', 'primary language',
  'common language', 'everyday language', 'day-to-day language', 'language of the (team|company|office)',
  'speaking (team|teams|environment|company|workplace|office|culture|organi(s|z)ation|colleagues|workforce|setting)',
  'arbeitssprache', 'unternehmenssprache', 'konzernsprache', 'firmensprache', 'teamsprache', 'geschäftssprache', 'bürosprache',
  'als arbeitssprache', 'langue de travail', 'langue de l\'entreprise', 'langue officielle', 'langue de travail est',
  'comme langue de travail', 'idioma de trabajo', 'idioma corporativo', 'idioma oficial', 'como idioma de trabajo',
  'lingua di lavoro', 'lingua aziendale', 'come lingua di lavoro', 'lingua ufficiale', 'werktaal', 'voertaal', 'bedrijfstaal',
  'als voertaal', 'arbetsspråk', 'koncernspråk', 'som arbetsspråk', 'arbejdssprog', 'koncernsprog', 'arbeidsspråk',
  'konsernspråk', 'työkieli', 'työkielenä', 'yrityksen kieli', 'język roboczy', 'językiem roboczym', 'pracovní jazyk',
  'pracovný jazyk', 'munkanyelv', 'limba de lucru', 'limbă de lucru', 'idioma de trabalho', 'língua de trabalho',
  'γλώσσα εργασίας', 'работен език', 'radni jezik', 'delovni jezik', 'töökeel', 'darba valoda', 'darbo kalba', 'çalışma dili',
  'рабочий язык', 'робоча мова', '社内公用語', '公用語', '工作语言', '工作語言', '업무 언어', '사내 공용어',
];

/** Verbs of working/communicating that end right before "in English" / "auf Englisch" / "en anglais". */
export const WORKING_PRE_RE_SOURCES: readonly string[] = [
  String.raw`(?:work|works|working|communicat\p{L}*|operat\p{L}*|conducted|collaborat\p{L}*|held|run|runs|done|speak|speaks|everything is|all is)(?:\s+\p{L}+){0,3}\s+in\s*$`,
  String.raw`(?:arbeit\p{L}*|kommuni\p{L}*|sprechen|spricht|gesprochen|findet|läuft|laeuft|lauft)(?:\s+\p{L}+){0,3}\s+(?:auf|in)\s*$`,
  String.raw`(?:travaill\p{L}*|communiqu\p{L}*|parl\p{L}*|echang\p{L}*|deroul\p{L}*)(?:\s+\p{L}+){0,3}\s+en\s*$`,
  String.raw`(?:trabaj\p{L}*|comunica\p{L}*|habla\p{L}*|trabalh\p{L}*|fala\p{L}*)(?:\s+\p{L}+){0,3}\s+(?:en|em)(?:\s+(?:el|o))?\s*$`,
  String.raw`(?:lavor\p{L}*|comunic\p{L}*|parl\p{L}*)(?:\s+\p{L}+){0,3}\s+in\s*$`,
  String.raw`(?:werk\p{L}*|communic\p{L}*|spreken|spreekt)(?:\s+\p{L}+){0,3}\s+in\s+het\s*$`,
  String.raw`(?:arbeta\p{L}*|arbejd\p{L}*|arbeid\p{L}*|jobb\p{L}*|kommuni\p{L}*|pratar|talar|snakker)(?:\s+\p{L}+){0,3}\s+pa\s*$`,
  String.raw`(?:pracuj\p{L}*|komuniku\p{L}*)(?:\s+\p{L}+){0,3}\s+(?:w|po)(?:\s+jezyku)?\s*$`,
];

/** Language courses / learning: the employer helps, so the language is not a hard barrier. */
export const SUPPORT_CUES: readonly string[] = [
  'course*', 'classes', 'lessons', 'tuition', 'learn*', 'willing to learn', 'willingness to learn', 'language training',
  'kurs*', 'sprachkurs*', 'unterricht', 'lernen', 'lernbereitschaft', 'cours', 'apprendre', 'curso*', 'clases', 'aprender',
  'corsi', 'corso', 'imparare', 'cursus', 'cursussen', 'lessen', 'leren', 'lektioner', 'undervisning', 'lära dig', 'lære',
  'kurssi*', 'oppia', 'kursy', 'kursów', 'nauczyć się', 'kurz*', 'naučit se', 'tanfolyam*', 'tanulni', 'cursuri', 'lecții',
  'aulas', 'μαθήματα', 'курс*', 'tečaj*', 'keelekursus*', 'kursi', 'kursai', 'dersleri', 'レッスン', '課程', '课程', '수업', '강좌',
];

/** A nationality / country adjective, not a language: "German citizenship", "French company". */
export const NOT_LANGUAGE_AFTER: readonly string[] = [
  'citizen*', 'nationality', 'nationals?', 'passport*', 'resident*', 'work permit', 'company', 'companies', 'market*', 'office*',
  'subsidiary', 'entity', 'raum', 'region*', 'länder*', 'gebiet', 'based', 'headquartered', 'owned', 'speaking countries', 'speaking countr*', 'law', 'legislation', 'tax*', 'bank*', 'government', 'version', 'below', 'translation', 'follows',
  'staatsangehörig*', 'staatsbürger*', 'reisepass', 'aufenthalt*', 'arbeitserlaubnis', 'firma', 'unternehmen', 'markt',
  'übersetzung', 'fassung', 'nationalité', 'citoyen*', 'passeport', 'entreprise', 'marché', 'nacionalidad', 'ciudadan*',
  'pasaporte', 'empresa', 'mercado', 'cittadinanza', 'cittadin*', 'passaporto', 'azienda', 'mercato', 'nationaliteit',
  'staatsburger*', 'paspoort', 'bedrijf', 'medborgarskap', 'medborgare', 'företag', 'marknad', 'statsborger*', 'virksomhed',
  'selskap', 'marked', 'obywatelstw*', 'obywatel*', 'paszport', 'rynek', 'rynku', 'občanství', 'občan*', 'állampolgár*',
  'cetățenie', 'cetățean*', 'companie', 'versione', 'versión', 'versie', 'wersja',
];

/** Section headings (a line on its own, optional trailing colon). */
export const REQUIRED_HEADINGS: readonly string[] = [
  'requirements', 'job requirements', 'key requirements', 'minimum requirements', 'minimum qualifications', 'basic qualifications',
  'required qualifications', 'required skills', 'qualifications', 'must have', 'must haves', 'must-haves', 'what you bring',
  'what you\'ll bring', 'what you will bring', 'what we\'re looking for', 'what we are looking for', 'what we expect', 'who you are',
  'languages', 'language skills', 'language requirements', 'sprachen', 'sprachkenntnisse', 'langues', 'compétences linguistiques',
  'idiomas', 'lingue', 'conoscenze linguistiche', 'talen', 'talenkennis', 'språk', 'språkkunskaper', 'sprog', 'sprogkundskaber',
  'kielitaito', 'języki', 'znajomość języków', 'jazyky', 'jazykové znalosti', 'nyelvtudás', 'limbi străine', 'línguas', 'γλώσσες',
  'езици', 'jezici', 'jeziki', 'keeleoskus', 'valodas', 'kalbos', 'diller', 'языки', 'мови', '語学', '语言要求', '어학',
  'about you', 'your profile', 'the ideal candidate', 'skills and experience', 'your skills', 'profile', 'you have', 'you bring',
  'profil', 'dein profil', 'ihr profil', 'was du mitbringst', 'was sie mitbringen', 'das bringst du mit', 'das bringen sie mit',
  'anforderungen', 'voraussetzungen', 'qualifikationen', 'deine qualifikationen', 'ihre qualifikationen', 'was wir erwarten',
  'profil recherché', 'votre profil', 'ton profil', 'compétences requises', 'prérequis', 'requisitos', 'requisitos mínimos', 'perfil',
  'qué buscamos', 'que buscamos', 'requisiti', 'requisiti richiesti', 'profilo', 'il tuo profilo', 'cosa cerchiamo', 'eisen',
  'functie-eisen', 'functieeisen', 'wat vragen wij', 'wat wij vragen', 'wat breng je mee', 'jouw profiel', 'profiel', 'krav',
  'kvalifikationer', 'vem är du', 'vi söker dig som', 'din profil', 'dine kvalifikationer', 'hvem er du', 'vaatimukset',
  'odotamme sinulta', 'edellytämme', 'wymagania', 'nasze wymagania', 'oczekiwania', 'czego oczekujemy', 'požadavky',
  'co očekáváme', 'požiadavky', 'elvárások', 'elvárásaink', 'cerințe', 'ce așteptăm', 'o que procuramos', 'απαιτήσεις', 'προσόντα',
  'изисквания', 'zahtjevi', 'uvjeti', 'pogoji', 'zahteve', 'nõuded', 'prasības', 'reikalavimai', 'aranan nitelikler',
  'gereksinimler', 'требования', 'вимоги', '応募資格', '必須条件', '必須スキル', '任职要求', '岗位要求', '자격요건', '자격 요건', '필수 자격',
];

export const PREFERRED_HEADINGS: readonly string[] = [
  'nice to have', 'nice-to-have', 'nice to haves', 'nice-to-haves', 'bonus points', 'bonus', 'bonus if you have', 'plus', 'pluses',
  'it\'s a plus if', 'it is a plus if', 'it would be great if', 'would be a plus', 'what would make you stand out', 'preferred qualifications',
  'preferred skills', 'desirable', 'desired', 'good to have', 'extra points', 'wünschenswert', 'von vorteil', 'idealerweise',
  'das wäre toll', 'pluspunkte', 'atouts', 'les plus', 'un plus', 'serait un plus', 'ce serait un plus', 'souhaité', 'deseable',
  'se valorará', 'valorable', 'será un plus', 'gradito', 'costituisce titolo preferenziale', 'titoli preferenziali', 'pre',
  'pluspunten', 'meriterande', 'meriterende', 'det er et plus', 'fordel', 'eduksi', 'katsomme eduksi', 'mile widziane',
  'dodatkowe atuty', 'výhodou', 'výhodou je', 'vítané', 'előny', 'előnyt jelent', 'avantaj', 'constituie un avantaj',
  'diferencial', 'diferenciais', 'πλεονέκτημα', 'предимство', 'prednost', 'poželjno', 'kasuks tuleb', 'priekšrocības',
  'privalumai', 'tercih sebebi', 'будет плюсом', 'преимуществом будет', '歓迎スキル', '歓迎条件', '尚可', '加分项', '优先', '우대사항',
  '우대 사항',
];

/** Headings that end a requirements / nice-to-have section. */
export const OTHER_HEADINGS: readonly string[] = [
  'benefits', 'what we offer', 'we offer', 'perks', 'our offer', 'why join us', 'about us', 'about the company', 'about the role',
  'responsibilities', 'your responsibilities', 'your tasks', 'the role', 'what you\'ll do', 'what you will do', 'tasks',
  'wir bieten', 'was wir bieten', 'unser angebot', 'deine aufgaben', 'ihre aufgaben', 'aufgaben', 'über uns', 'nous offrons',
  'ce que nous offrons', 'vos missions', 'missions', 'avantages', 'ofrecemos', 'qué ofrecemos', 'funciones', 'responsabilidades',
  'offriamo', 'cosa offriamo', 'responsabilità', 'mansioni', 'wij bieden', 'wat bieden wij', 'wat wij bieden', 'taken',
  'verantwoordelijkheden', 'vi erbjuder', 'arbetsuppgifter', 'vi tilbyder', 'arbejdsopgaver', 'vi tilbyr', 'arbeidsoppgaver',
  'tarjoamme', 'tehtävät', 'oferujemy', 'obowiązki', 'zakres obowiązków', 'nabízíme', 'náplň práce', 'ponúkame', 'ajánlatunk',
  'feladatok', 'oferim', 'responsabilități', 'oferecemos', 'προσφέρουμε', 'предлагаме', 'nudimo', 'pakume', 'piedāvājam',
  'siūlome', 'мы предлагаем', 'обязанности', '業務内容', '待遇', '福利', '岗位职责', '주요 업무', '복리후생',
];

/**
 * Frequent function words per language (lowercase, with diacritics). Used to separate languages
 * franc-min does not know or confuses (Danish / Norwegian / Swedish, Czech / Slovak, Finnish,
 * Estonian, Latvian, Lithuanian, Slovenian, Icelandic, Maltese, Catalan).
 */
export const STOPWORDS: Readonly<Record<string, readonly string[]>> = {
  en: ['the', 'and', 'of', 'to', 'in', 'you', 'with', 'for', 'our', 'we', 'is', 'are', 'will', 'your', 'on', 'as', 'be', 'an', 'this', 'that', 'have', 'from', 'or', 'at', 'experience'],
  de: ['und', 'der', 'die', 'das', 'mit', 'für', 'wir', 'sie', 'du', 'ist', 'ein', 'eine', 'in', 'zu', 'von', 'auf', 'bei', 'dich', 'dein', 'deine', 'unser', 'unsere', 'oder', 'sowie', 'nicht'],
  fr: ['et', 'le', 'la', 'les', 'des', 'de', 'du', 'un', 'une', 'pour', 'vous', 'nous', 'avec', 'dans', 'est', 'sur', 'votre', 'notre', 'au', 'aux', 'en', 'que', 'qui', 'par', 'ou'],
  nl: ['en', 'de', 'het', 'van', 'een', 'je', 'jij', 'wij', 'we', 'met', 'voor', 'op', 'is', 'zijn', 'jouw', 'onze', 'ons', 'bij', 'naar', 'die', 'dat', 'ook', 'als', 'niet', 'of'],
  es: ['y', 'de', 'la', 'el', 'los', 'las', 'en', 'con', 'para', 'por', 'un', 'una', 'que', 'es', 'del', 'al', 'tu', 'nuestro', 'nuestra', 'como', 'se', 'o', 'más', 'su', 'lo'],
  it: ['e', 'di', 'il', 'la', 'le', 'per', 'con', 'un', 'una', 'che', 'del', 'della', 'dei', 'in', 'è', 'nel', 'nella', 'al', 'alla', 'sono', 'nostro', 'nostra', 'o', 'si', 'gli'],
  pt: ['e', 'de', 'o', 'a', 'os', 'as', 'em', 'com', 'para', 'por', 'um', 'uma', 'que', 'é', 'do', 'da', 'dos', 'das', 'no', 'na', 'nosso', 'nossa', 'você', 'ou', 'são'],
  pl: ['i', 'w', 'z', 'na', 'do', 'oraz', 'się', 'jest', 'dla', 'że', 'lub', 'nie', 'od', 'po', 'jako', 'przez', 'twoje', 'nasz', 'nasze', 'będzie', 'co', 'to', 'o', 'ze', 'są'],
  sv: ['och', 'att', 'är', 'för', 'med', 'som', 'på', 'av', 'en', 'ett', 'vi', 'du', 'inte', 'har', 'till', 'från', 'också', 'ska', 'kommer', 'våra', 'vår', 'dig', 'eller', 'där', 'erfarenhet', 'söker', 'arbete', 'mycket', 'hos', 'om'],
  da: ['og', 'at', 'er', 'for', 'med', 'som', 'på', 'af', 'en', 'et', 'vi', 'du', 'ikke', 'har', 'til', 'fra', 'også', 'skal', 'vil', 'vores', 'dig', 'eller', 'hvor', 'erfaring', 'søger', 'arbejde', 'meget', 'hos', 'hvis', 'jeres', 'være', 'blive', 'nogle', 'efter', 'gerne'],
  no: ['og', 'å', 'er', 'for', 'med', 'som', 'på', 'av', 'en', 'et', 'vi', 'du', 'ikke', 'har', 'til', 'fra', 'også', 'skal', 'vil', 'våre', 'vår', 'deg', 'eller', 'hvor', 'erfaring', 'søker', 'arbeid', 'mye', 'hos', 'hvis', 'være', 'bli', 'noen', 'etter', 'gjennom', 'jobbe', 'ønsker'],
  fi: ['ja', 'on', 'että', 'ei', 'tai', 'kanssa', 'myös', 'sekä', 'olet', 'olemme', 'meillä', 'sinulla', 'joka', 'jotka', 'mutta', 'kun', 'niin', 'voi', 'työ', 'kokemusta', 'meidän', 'sinun', 'haemme', 'etsimme', 'tarjoamme', 'olla', 'ovat', 'jossa', 'tiimissä', 'osaamista'],
  et: ['ja', 'on', 'et', 'ei', 'see', 'või', 'koos', 'ka', 'oled', 'oleme', 'meil', 'sinu', 'kes', 'mis', 'aga', 'kui', 'nii', 'töö', 'kogemus', 'meie', 'otsime', 'pakume', 'oma', 'ning', 'samuti', 'kasuks', 'vähemalt', 'üle', 'sind', 'tööd'],
  lv: ['un', 'ir', 'ar', 'par', 'uz', 'no', 'kas', 'vai', 'lai', 'bet', 'kā', 'arī', 'jūs', 'mēs', 'mūsu', 'jūsu', 'darba', 'pieredze', 'zināšanas', 'piedāvājam', 'esam', 'būt', 'pie', 'pēc', 'līdz', 'darbs', 'tiks', 'jums', 'savu', 'kuru'],
  lt: ['ir', 'yra', 'su', 'apie', 'į', 'iš', 'kad', 'ar', 'bet', 'kaip', 'taip', 'jūs', 'mes', 'mūsų', 'jūsų', 'darbo', 'patirtis', 'žinios', 'siūlome', 'esame', 'būti', 'bus', 'nuo', 'po', 'iki', 'darbas', 'arba', 'jei', 'dėl', 'jums'],
  cs: ['a', 'je', 'na', 'v', 'se', 'že', 'pro', 'nebo', 'jako', 'jsme', 'jste', 'jsou', 'může', 'bude', 'při', 'od', 'do', 'z', 'k', 'který', 'která', 'které', 'zkušenosti', 'nabízíme', 'hledáme', 'vám', 'nás', 'také', 'práci', 'jejich'],
  sk: ['a', 'je', 'na', 'v', 'sa', 'že', 'pre', 'alebo', 'ako', 'sme', 'ste', 'sú', 'môže', 'bude', 'pri', 'od', 'do', 'z', 'k', 'ktorý', 'ktorá', 'ktoré', 'skúsenosti', 'ponúkame', 'hľadáme', 'vám', 'nás', 'tiež', 'prácu', 'aj'],
  sl: ['in', 'je', 'na', 'v', 'z', 'da', 'za', 'ali', 'kot', 'tudi', 'smo', 'ste', 'so', 'lahko', 'bo', 'pri', 'od', 'do', 'iz', 'ki', 'dela', 'izkušnje', 'nudimo', 'iščemo', 'vam', 'nas', 'znanje', 'naše', 'delo', 'vaše'],
  hr: ['i', 'je', 'na', 'u', 's', 'sa', 'da', 'za', 'ili', 'kao', 'također', 'smo', 'ste', 'su', 'može', 'će', 'pri', 'od', 'do', 'iz', 'koji', 'koja', 'koje', 'posla', 'iskustvo', 'nudimo', 'tražimo', 'vam', 'nas', 'rad'],
  hu: ['és', 'a', 'az', 'hogy', 'nem', 'egy', 'van', 'vagy', 'is', 'de', 'mint', 'meg', 'már', 'csak', 'fel', 'számára', 'munka', 'tapasztalat', 'kínálunk', 'keresünk', 'vagyunk', 'lesz', 'illetve', 'valamint', 'által'],
  ro: ['și', 'de', 'la', 'în', 'cu', 'pentru', 'un', 'o', 'care', 'este', 'din', 'pe', 'să', 'sau', 'mai', 'ai', 'al', 'ale', 'nostru', 'noastră', 'vei', 'echipa', 'experiență', 'oferim', 'căutăm'],
  is: ['og', 'að', 'er', 'í', 'á', 'það', 'sem', 'við', 'til', 'með', 'ekki', 'fyrir', 'um', 'eru', 'þú', 'vera', 'hafa', 'starf', 'reynsla', 'leitum', 'bjóðum', 'okkar', 'eða', 'mjög', 'hjá', 'þér', 'þekking', 'starfið', 'góð', 'hæfni'],
  mt: ['u', 'ta', 'li', 'huwa', 'hija', 'għal', 'ma', 'fil', 'tal', 'minn', 'jew', 'fuq', 'biex', 'dan', 'din', 'aħna', 'tagħna', 'esperjenza', 'xogħol', 'mill', 'lill', 'kull', 'jkun', 'għandu', 'tiegħek'],
  ca: ['i', 'de', 'la', 'el', 'els', 'les', 'amb', 'per', 'una', 'que', 'és', 'són', 'som', 'del', 'al', 'treball', 'experiència', 'oferim', 'busquem', 'també', 'nostre', 'nostra', 'com', 'més', 'dels'],
  tr: ['ve', 'bir', 'bu', 'ile', 'için', 'olarak', 'da', 'de', 'en', 'olan', 'veya', 'gibi', 'daha', 'çok', 'deneyim', 'sahip', 'ekibimize', 'arıyoruz', 'sunuyoruz', 'iyi', 'bilgi', 'konusunda', 'yıl', 'olmak', 'ekip'],
};
