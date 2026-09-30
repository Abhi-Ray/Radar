/**
 * Names of languages as they appear in job postings, in the posting languages RADAR sees
 * (English, German, French, Dutch, Spanish, Italian, Portuguese, Nordic, Baltic, Central and
 * Eastern European languages, Greek, Turkish, Russian, CJK, Arabic, Hebrew).
 *
 * Form syntax (compiled by `language.ts`, matched against `fold()`ed text):
 * - written naturally; forms are folded at build time, so "Französisch" matches "franzosisch";
 * - a trailing `*` allows any letters after the stem ("Deutschkenntnisse", "angielskiego");
 * - a space matches any whitespace;
 * - a leading `^` requires a capital first letter in the original ("Polish", not "polish your CV");
 * - CJK / Hangul / Kana forms are matched without word boundaries.
 *
 * Nationality adjectives that double as language names ("German", "français") are fine here:
 * `language.ts` drops mentions followed by citizenship / company / market words, and a mention
 * only counts when a requirement cue is next to it.
 */

export const LANGUAGE_NAMES: Readonly<Record<string, readonly string[]>> = {
  en: [
    'english*', 'englisch*', 'anglais', 'anglaise', 'anglophon*', 'inglés', 'ingles', 'inglese', 'inglês', 'engels', 'engelstalig*',
    'engelsk*', 'englanti*', 'englannin*', 'englanniksi', 'angielsk*', 'anglojęzyczn*', 'angličtin*', 'anglick*', 'angol', 'angolul',
    'angol nyelv*', 'angoltudás*', 'engleză', 'engleza', 'limba engleză', 'limbii engleze', 'limbă engleză', 'αγγλικ*', 'английск*', 'англійськ*', 'engleski*',
    'engleskog', 'angleščin*', 'anglešk*', 'inglise keel*', 'inglise', 'angļu', 'anglų', 'ingilizce', 'enska', 'ensku',
    '英語', '英语', '英文', '영어', 'الإنجليزية', 'الانجليزية', 'الإنكليزية', 'אנגלית',
  ],
  de: [
    'deutsch', 'deutschkenntnis*', 'deutschsprach*', 'deutschniveau', 'deutsche sprache', 'deutschen sprache', 'deutscher sprache',
    'schweizerdeutsch*', 'german', 'allemand', 'alemán', 'alemao', 'alemão', 'tedesco', 'duits', 'duitstalig*', 'tysk', 'tyska', 'tyskan',
    'saksan kiel*', 'saksaa', 'saksaksi', 'niemieck*', 'němčin*', 'nemčin*', 'německ* jazyk*', 'nemeck* jazyk*', 'német', 'németül',
    'német nyelv*', 'limba germană', 'limbii germane', 'germană', 'γερμανικ*', 'немски', 'немецк*', 'німецьк*', 'njemačk*', 'nemšk*', 'nemščin*',
    'saksa keel*', 'vācu valod*', 'vācu', 'vokiečių kalb*', 'vokiečių', 'almanca', 'þýsku', 'þýska', 'ドイツ語', '德语', '德語', '독일어',
  ],
  fr: [
    'french', 'französisch*', 'francais', 'français', 'langue française', 'francés', 'francese', 'franse taal', 'frans', 'franstalig*',
    'franska', 'fransk', 'franskkundskab*', 'ranskan kiel*', 'ranskaa', 'francusk*', 'francouzštin*', 'francúzštin*', 'francia nyelv*',
    'franceză', 'limba franceză', 'limbii franceze', 'γαλλικ*', 'френски', 'французск*', 'французьк*', 'fransızca', 'francoščin*', 'prantsuse keel*',
    'franču valod*', 'prancūzų kalb*', 'francês', 'francofon*', 'francophone*', 'フランス語', '法语', '法語', '프랑스어',
  ],
  nl: [
    'dutch', 'nederlands', 'nederlandstalig*', 'nederlandse taal', 'niederländisch*', 'néerlandais', 'neerlandés', 'olandese',
    'hollandsk', 'nederländska', 'hollannin kiel*', 'niderlandzk*', 'nizozemštin*', 'holandčin*', 'holland nyelv*', 'olandeză',
    'flemish', 'flämisch*', 'flamand', 'vlaams', 'holandês', 'オランダ語', '荷兰语', '荷蘭語',
  ],
  es: [
    'spanish', 'spanisch*', 'espagnol', 'español', 'castellano', 'lengua española', 'idioma español', 'spagnolo', 'spaans', 'spanska',
    'spansk', 'espanjan kiel*', 'espanjaa', 'hiszpańsk*', 'španělštin*', 'španielčin*', 'spanyol', 'spanyolul', 'spanyol nyelv*',
    'spaniolă', 'limba spaniolă', 'limbii spaniole', 'ισπανικ*', 'испански', 'испанск*', 'іспанськ*', 'espanhol', 'ispanyolca', 'španjolsk*',
    'španščin*', 'スペイン語', '西班牙语', '西班牙語', '스페인어',
  ],
  it: [
    'italian', 'italienisch*', 'italien', 'italiano', 'lingua italiana', 'italiaans', 'italienska', 'italiensk', 'italian kiel*',
    'włosk*', 'italštin*', 'taliančin*', 'olasz', 'olaszul', 'olasz nyelv*', 'italiană', 'limba italiană', 'limbii italiene', 'ιταλικ*', 'италиански',
    'итальянск*', 'італійськ*', 'italyanca', 'talijansk*', 'italijanščin*', 'イタリア語', '意大利语', '意大利語',
  ],
  pt: [
    'portuguese', 'portugiesisch*', 'portugais', 'português', 'portugués', 'portoghese', 'portugees', 'portugisiska', 'portugisisk',
    'portugalin kiel*', 'portugalsk*', 'portugalštin*', 'portugál nyelv*', 'portugheză', 'πορτογαλικ*', 'португалски', 'португальск*',
    'portekizce', 'portugalščin*', 'ポルトガル語', '葡萄牙语', '葡萄牙語',
  ],
  pl: [
    '^Polish', 'polnisch*', 'polonais', 'polaco', 'polacco', '^Pools', 'polski', 'polskiego', 'polskim', 'język* polsk*', 'języka polskiego',
    'polština', 'polštin*', 'poľštin*', 'lengyel nyelv*', 'lengyelül', 'poloneză', 'polonês', 'lehçe', 'πολωνικ*', 'полски', 'польск*',
    'польськ*', 'ポーランド語', '波兰语',
  ],
  sv: [
    'swedish', 'schwedisch*', 'suédois', 'sueco', 'svedese', 'zweeds', 'svenska', 'svenskan', 'svensktalande', 'svenskkunskap*', 'svensk',
    'ruotsin kiel*', 'ruotsia', 'ruotsiksi', 'szwedzk*', 'švédštin*', 'svéd nyelv*', 'suedeză', 'σουηδικ*', 'шведск*', 'スウェーデン語',
  ],
  da: [
    'danish', 'dänisch*', 'danois', 'danés', 'danese', 'deens', 'danska', 'dansk', 'danskkundskab*', 'danskfærdighed*', 'dansktalende',
    'tanskan kiel*', 'tanskaa', 'duńsk*', 'dánštin*', 'dán nyelv*', 'daneză', 'δανικ*', 'датск*', 'デンマーク語',
  ],
  no: [
    'norwegian', 'norwegisch*', 'norvégien', 'noruego', 'norvegese', 'noors', 'norska', 'norsk', 'norskkunnskap*', 'norsktalende',
    'norjan kiel*', 'norjaa', 'norwesk*', 'norštin*', 'nórčin*', 'norvég nyelv*', 'norvegiană', 'bokmål', 'nynorsk', 'νορβηγικ*',
    'норвежск*', 'ノルウェー語',
  ],
  fi: [
    'finnish', 'finnisch*', 'finnois', 'finlandés', 'finlandese', 'fins', 'finska', 'finsk', 'suomen kiel*', 'suomea', 'suomeksi', 'suomi',
    'fińsk*', 'finštin*', 'fínčin*', 'finn nyelv*', 'finlandeză', 'φινλανδικ*', 'финск*', 'фінськ*', 'soome keel*', 'フィンランド語',
  ],
  cs: [
    'czech', 'tschechisch*', 'tchèque', 'checo', 'ceco', 'tsjechisch', 'tjeckiska', 'tjekkisk', 'tsjekkisk', 'tšekin kiel*', 'czesk*',
    'čeština', 'češtin*', 'česk* jazyk*', 'česky', 'češčin*', 'cseh nyelv*', 'cehă', 'τσεχικ*', 'чешск*', 'чеськ*', 'チェコ語',
  ],
  sk: [
    'slovak', 'slowakisch*', 'slovaque', 'eslovaco', 'slovacco', 'slowaaks', 'slovakiska', 'slovakisk', 'slovakin kiel*', 'słowack*',
    'slovenčin*', 'slovensk* jazyk*', 'slovenštin*', 'szlovák nyelv*', 'slovacă', 'словацк*',
  ],
  sl: [
    'slovenian', 'slovene', 'slowenisch*', 'slovène', 'esloveno', 'sloveno', 'sloveens', 'slovenščin*', 'slovenski jezik*',
    'słoweńsk*', 'slovinštin*', 'szlovén nyelv*', 'slovenă', 'словенск*',
  ],
  hr: [
    'croatian', 'kroatisch*', 'croate', 'croata', 'croato', 'kroatiska', 'kroatisk', 'kroatian kiel*', 'chorwack*', 'chorvatštin*',
    'horvát nyelv*', 'hrvatsk* jezik*', 'hrvatski', 'hrvatskog', 'hırvatça', 'хорватск*', 'serbo-croatian', 'bcms',
  ],
  sr: [
    'serbian', 'serbisch*', 'serbe', 'serbio', 'serbo', 'servisch', 'serbiska', 'serbisk', 'serbsk*', 'srbštin*', 'szerb nyelv*', 'sârbă',
    'srpsk* jezik*', 'srpski', 'srpskog', 'сербск*', 'српски', 'српског', 'sırpça',
  ],
  bs: ['bosnian', 'bosnisch*', 'bosniaque', 'bosnio', 'bosanski', 'bosanskog', 'bosanski jezik*'],
  hu: [
    'hungarian', 'ungarisch*', 'hongrois', 'húngaro', 'ungherese', 'hongaars', 'ungerska', 'ungarsk', 'unkarin kiel*', 'węgiersk*',
    'maďarštin*', 'magyar nyelv*', 'magyarul', 'magyar nyelvtudás*', 'maghiară', 'ουγγρικ*', 'унгарски', 'венгерск*', 'угорськ*',
    'macarca', 'madžarščin*', 'ハンガリー語',
  ],
  ro: [
    'romanian', 'rumänisch*', 'roumain', 'rumano', 'rumeno', 'roemeens', 'rumänska', 'rumænsk', 'rumensk', 'romanian kiel*', 'rumuńsk*',
    'rumunštin*', 'román nyelv*', 'limba română', 'limbii române', 'limba romana', 'românește', 'ρουμανικ*', 'румънски', 'румынск*', 'румунськ*', 'rumence', 'ルーマニア語',
  ],
  el: [
    'greek', 'griechisch*', 'grec', 'grecque', 'griego', 'greco', 'grieks', 'grekiska', 'græsk', 'gresk', 'kreikan kiel*', 'kreikkaa',
    'greck*', 'řečtin*', 'gréčtin*', 'görög nyelv*', 'greacă', 'ελληνικ*', 'гръцки', 'греческ*', 'грецьк*', 'yunanca', 'grčk*',
    'ギリシャ語', '希腊语',
  ],
  bg: [
    'bulgarian', 'bulgarisch*', 'bulgare', 'búlgaro', 'bulgaro', 'bulgaars', 'bulgariska', 'bulgarsk', 'bułgarsk*', 'bulharštin*',
    'bolgár nyelv*', 'bulgară', 'βουλγαρικ*', 'български', 'българск*', 'болгарск*', 'болгарськ*', 'bugarsk*', 'bulgarca',
  ],
  et: [
    'estonian', 'estnisch*', 'estonien', 'estonio', 'estone', 'estniska', 'estisk', 'viron kiel*', 'viroa', 'estońsk*',
    'estonštin*', 'észt nyelv*', 'estonă', 'eesti keel*', 'eesti keele', 'эстонск*', 'естонськ*',
  ],
  lv: [
    'latvian', 'lettisch*', 'letton', 'letón', 'lettone', 'lettiska', 'lettisk', 'latvian kiel*', 'łotewsk*', 'lotyštin*',
    'lett nyelv*', 'letonă', 'latviešu valod*', 'latviešu', 'латышск*', 'латиськ*',
  ],
  lt: [
    'lithuanian', 'litauisch*', 'lituanien', 'lituano', 'litouws', 'litauiska', 'litauisk', 'liettuan kiel*', 'litewsk*', 'litevštin*',
    'litván nyelv*', 'lituaniană', 'lietuvių kalb*', 'lietuvių', 'литовск*', 'литовськ*',
  ],
  is: [
    'icelandic', 'isländisch*', 'islandais', 'islandés', 'islandese', 'ijslands', 'isländska', 'islandsk', 'islannin kiel*', 'islandzk*',
    'islandštin*', 'izlandi nyelv*', 'islandeză', 'íslenska', 'íslensku', 'исландск*',
  ],
  mt: ['maltese', 'maltesisch*', 'maltais', 'maltés', 'malti', 'maltesiska', 'maltesisk'],
  ga: ['irish language', 'irish gaelic', 'gaeilge', 'irisch-gälisch*', 'gaélique irlandais'],
  cy: ['welsh', 'cymraeg', 'walisisch*', 'gallois'],
  lb: ['luxembourgish', 'luxemburgisch*', 'luxembourgeois', 'lëtzebuergesch', 'luxemburgs', 'luxemburgués'],
  ca: ['catalan', 'catalán', 'català', 'katalanisch*', 'catalano', 'catalaans', 'katalanska', 'catalana'],
  eu: ['basque', 'euskera', 'euskara', 'baskisch*', 'euskaraz'],
  gl: ['galician', 'galego', 'galicisch*'],
  rm: ['romansh', 'rätoromanisch*', 'romanche', 'rumantsch'],
  tr: [
    'turkish', 'türkisch*', 'turc', 'turque', 'turco', 'turkiska', 'tyrkisk', 'turkin kiel*', 'turecki*', 'turečtin*', 'török nyelv*',
    'turcă', 'τουρκικ*', 'турски', 'турецк*', 'турецьк*', 'türkçe', 'turski', 'turščin*', 'トルコ語', '土耳其语',
  ],
  ru: [
    'russian', 'russisch*', 'russe', 'ruso', 'russo', 'russisch', 'ryska', 'russisk', 'venäjän kiel*', 'venäjää', 'rosyjsk*', 'ruštin*',
    'orosz nyelv*', 'limba rusă', 'ρωσικ*', 'руски', 'русск*', 'русский язык', 'російськ*', 'rusça', 'ruski', 'ruskog', 'ruščin*',
    'ロシア語', '俄语', '俄語', '러시아어',
  ],
  uk: [
    'ukrainian', 'ukrainisch*', 'ukrainien', 'ucraniano', 'ucraino', 'oekraïens', 'ukrainska', 'ukrainsk', 'ukrainan kiel*', 'ukraińsk*',
    'ukrajinštin*', 'ukrán nyelv*', 'ucraineană', 'украински', 'украинск*', 'українськ*', 'ukraynaca', 'ukrajinsk*',
  ],
  be: ['belarusian', 'belarussisch*', 'biélorusse', 'белорусск*', 'беларуск*'],
  he: ['hebrew', 'hebräisch*', 'hébreu', 'hebreo', 'ebraico', 'hebreeuws', 'hebreiska', 'hebraisk', 'hebrajsk*', 'hebrejštin*', 'иврит*', 'עברית'],
  ar: [
    'arabic', 'arabisch*', 'arabe', 'árabe', 'arabo', 'arabiska', 'arabisk', 'arabian kiel*', 'arabsk*', 'arabštin*', 'arab nyelv*',
    'limba arabă', 'αραβικ*', 'арабски', 'арабск*', 'арабськ*', 'arapça', 'العربية', 'اللغة العربية', 'アラビア語', '阿拉伯语',
  ],
  zh: [
    'chinese', 'mandarin', 'cantonese', 'chinesisch*', 'chinois', 'chino', 'cinese', 'chinees', 'kinesiska', 'kinesisk', 'kiinan kiel*',
    'chińsk*', 'čínštin*', 'kínai nyelv*', 'chineză', 'κινεζικ*', 'китайск*', 'китайськ*', 'çince', 'mandarijn', 'mandarín', 'mandarino',
    'kantonesisch*', 'putonghua', '中文', '汉语', '漢語', '普通话', '普通話', '华语', '華語', '粤语', '粵語', '廣東話', '广东话', '国语', '國語',
    '中国語', '중국어',
  ],
  ja: [
    'japanese', 'japanisch*', 'japonais', 'japonés', 'giapponese', 'japans', 'japanska', 'japansk', 'japanin kiel*', 'japońsk*',
    'japonštin*', 'japán nyelv*', 'japoneză', 'ιαπωνικ*', 'японски', 'японск*', 'японськ*', 'japonca', 'japonês', '日本語', '日语', '日語', '일본어',
  ],
  ko: [
    'korean', 'koreanisch*', 'coréen', 'coreano', 'koreaans', 'koreanska', 'koreansk', 'korean kiel*', 'koreańsk*', 'korejštin*',
    'koreai nyelv*', 'coreeană', 'корейск*', 'корейськ*', 'korece', '한국어', '韓国語', '韩语', '韓語',
  ],
  hi: ['hindi', 'हिंदी', 'हिन्दी'],
  ur: ['urdu', 'اردو'],
  bn: ['bengali', 'bangla', 'বাংলা'],
  ta: ['tamil', 'தமிழ்'],
  ms: ['malay', 'bahasa melayu', 'bahasa malaysia'],
  id: ['indonesian', 'bahasa indonesia'],
  vi: ['vietnamese', 'tiếng việt'],
  th: ['^Thai', 'ภาษาไทย'],
  tl: ['tagalog', 'filipino'],
  fa: ['persian', 'farsi', 'فارسی'],
  af: ['afrikaans'],
  sq: ['albanian', 'albanisch*', 'shqip'],
  mk: ['macedonian', 'mazedonisch*', 'македонск*', 'македонски'],
  ka: ['georgian', 'georgisch*', 'ქართული'],
  hy: ['armenian', 'armenisch*', 'հայերեն'],
  az: ['azerbaijani', 'aserbaidschanisch*', 'azərbaycan dili'],
  kk: ['kazakh', 'kasachisch*', 'қазақ тілі', 'казахск*'],
  sw: ['swahili', 'kiswahili'],
};

/** English display names for the ISO 639-1 codes above. */
export const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  en: 'English', de: 'German', fr: 'French', nl: 'Dutch', es: 'Spanish', it: 'Italian', pt: 'Portuguese', pl: 'Polish', sv: 'Swedish',
  da: 'Danish', no: 'Norwegian', fi: 'Finnish', cs: 'Czech', sk: 'Slovak', sl: 'Slovenian', hr: 'Croatian', sr: 'Serbian', bs: 'Bosnian',
  hu: 'Hungarian', ro: 'Romanian', el: 'Greek', bg: 'Bulgarian', et: 'Estonian', lv: 'Latvian', lt: 'Lithuanian', is: 'Icelandic',
  mt: 'Maltese', ga: 'Irish', cy: 'Welsh', lb: 'Luxembourgish', ca: 'Catalan', eu: 'Basque', gl: 'Galician', rm: 'Romansh', tr: 'Turkish',
  ru: 'Russian', uk: 'Ukrainian', be: 'Belarusian', he: 'Hebrew', ar: 'Arabic', zh: 'Chinese', ja: 'Japanese', ko: 'Korean', hi: 'Hindi',
  ur: 'Urdu', bn: 'Bengali', ta: 'Tamil', ms: 'Malay', id: 'Indonesian', vi: 'Vietnamese', th: 'Thai', tl: 'Filipino', fa: 'Persian',
  af: 'Afrikaans', sq: 'Albanian', mk: 'Macedonian', ka: 'Georgian', hy: 'Armenian', az: 'Azerbaijani', kk: 'Kazakh', sw: 'Swahili',
};
