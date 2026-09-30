/**
 * Known cities per country: the main tech/job hubs of every target country, plus the main
 * Indian and other non-target hubs so those postings are recognised and flagged.
 *
 * Row format: "Canonical|alias|alias@REGION"
 *  - Canonical is the English name used for display and dedup ("Munich", "The Hague").
 *  - Aliases are local and alternate spellings; umlaut spell-outs (Muenchen) and diacritic-free
 *    forms are added automatically by the index, so they need not be listed.
 *  - "@REGION" is the code from regions.ts (US/CA/AU states always; others where useful).
 *  - A leading "~" marks a secondary homonym (London, Ontario; Paris, Texas): it is chosen only
 *    when the string or a hint confirms its country/region.
 */

export interface CityInfo {
  name: string;
  country: string;
  region: string | null;
  aliases: readonly string[];
  /** Secondary homonym: needs its country or region confirmed. */
  secondary: boolean;
}

const DATA: Record<string, readonly string[]> = {
  // ── Tier 1 ──
  DE: [
    'Berlin@BE', 'Munich|München|Monaco di Baviera|Múnich|Munique|Monachium|Mnichov@BY', 'Hamburg|Hambourg|Amburgo|Hamburgo@HH',
    'Frankfurt|Frankfurt am Main|Frankfurt a.M.|Frankfurt/Main|Frankfurt Main|Francfort|Francoforte|Fráncfort|Frankfurt nad Menem@HE',
    'Cologne|Köln|Koeln|Colonia|Keulen|Kolonia|Kolín nad Rýnem@NW', 'Stuttgart|Stoccarda@BW', 'Düsseldorf|Dusseldorf@NW', 'Leipzig|Lipsia|Lipsk@SN',
    'Dresden|Dresde|Drezno@SN', 'Hanover|Hannover|Hanovre|Hannover@NI', 'Nuremberg|Nürnberg|Norimberga|Núremberg|Norymberga@BY', 'Bremen|Brême|Brema@HB',
    'Essen@NW', 'Dortmund@NW', 'Bonn@NW', 'Karlsruhe@BW', 'Mannheim@BW', 'Heidelberg@BW', 'Freiburg|Freiburg im Breisgau|Fribourg-en-Brisgau@BW',
    'Mainz|Mayence|Magonza@RP', 'Wiesbaden@HE', 'Darmstadt@HE', 'Aachen|Aix-la-Chapelle|Aquisgrana@NW', 'Münster|Munster Westfalen@NW', 'Bielefeld@NW',
    'Bochum@NW', 'Wuppertal@NW', 'Duisburg@NW', 'Gelsenkirchen@NW', 'Paderborn@NW', 'Gütersloh@NW', 'Augsburg@BY', 'Regensburg|Ratisbona@BY',
    'Ingolstadt@BY', 'Würzburg@BY', 'Erlangen@BY', 'Garching|Garching bei München@BY', 'Unterföhring@BY', 'Potsdam@BB', 'Kiel@SH', 'Lübeck@SH',
    'Rostock@MV', 'Magdeburg@ST', 'Halle|Halle (Saale)|Halle an der Saale@ST', 'Erfurt@TH', 'Jena@TH', 'Saarbrücken@SL', 'Kassel@HE',
    'Brunswick|Braunschweig@NI', 'Göttingen@NI', 'Osnabrück@NI', 'Oldenburg@NI', 'Wolfsburg@NI', 'Ulm@BW', 'Walldorf@BW', 'Chemnitz@SN',
    'Koblenz|Coblence@RP', 'Trier|Trèves@RP', 'Eschborn@HE', 'Offenbach|Offenbach am Main@HE', 'Böblingen@BW', 'Heilbronn@BW', 'Leverkusen@NW',
  ],
  NL: [
    'Amsterdam|Ámsterdam|Amsterdão@NH', 'Rotterdam|Róterdam|Roterdão@ZH', 'The Hague|Hague|Den Haag|\'s-Gravenhage|s-Gravenhage|La Haye|La Haya|L\'Aia|Haia|Haga|Haag@ZH',
    'Utrecht@UT', 'Eindhoven@NB', 'Groningen|Groninga@GR', 'Leiden|Leyde@ZH', 'Delft@ZH', 'Haarlem@NH', 'Amstelveen@NH', 'Hoofddorp@NH', 'Schiphol@NH',
    'Almere@FL', 'Arnhem@GE', 'Nijmegen@GE', 'Enschede@OV', 'Zwolle@OV', 'Maastricht|Maastrique@LI', '\'s-Hertogenbosch|Den Bosch|s-Hertogenbosch|Bois-le-Duc@NB',
    'Breda@NB', 'Tilburg@NB', 'Amersfoort@UT', 'Hilversum@NH', 'Apeldoorn@GE', 'Zaandam|Zaanstad@NH', 'Diemen@NH', 'Nieuwegein@UT', 'Wageningen@GE', 'Veldhoven@NB',
    'Zoetermeer@ZH', 'Dordrecht@ZH',
  ],
  IE: [
    'Dublin|Baile Átha Cliath|Dublín|Dublino|Dublim@D', 'Cork|Corcaigh@C', 'Galway|Gaillimh@G', 'Limerick|Luimneach@L', 'Waterford|Port Láirge@WD',
    'Kilkenny', 'Athlone', 'Sligo', 'Letterkenny', 'Drogheda', 'Dundalk', 'Maynooth@KE', 'Naas@KE', 'Leixlip@KE', 'Sandyford@D', 'Dún Laoghaire|Dun Laoghaire@D',
    'Swords@D', 'Tallaght@D', 'Blanchardstown@D', 'Shannon', 'Carlow', 'Wexford', 'Ennis', 'Tralee', 'Clonmel',
  ],
  FR: [
    'Paris|París|Parigi|Paryż|Paříž|Parijs@IDF', 'Lyon|Lyons|Lione|Lión@ARA', 'Marseille|Marseilles|Marsella|Marsiglia|Marselha@PAC', 'Toulouse|Tolosa@OCC',
    'Nice|Nizza|Niza@PAC', 'Nantes@PDL', 'Strasbourg|Straßburg|Strasburgo|Estrasburgo@GES', 'Montpellier@OCC', 'Bordeaux|Burdeos@NAQ', 'Lille|Rijsel@HDF',
    'Rennes@BRE', 'Reims@GES', 'Grenoble@ARA', 'Sophia Antipolis|Sophia-Antipolis|Valbonne@PAC', 'Aix-en-Provence@PAC', 'Nancy@GES', 'Metz@GES',
    'Rouen@NOR', 'Caen@NOR', 'Tours@CVL', 'Orléans|Orleans@CVL', 'Dijon@BFC', 'Clermont-Ferrand@ARA', 'Saint-Étienne|Saint-Etienne@ARA', 'Brest@BRE',
    'Angers@PDL', 'Le Mans@PDL', 'Annecy@ARA', 'Mulhouse@GES', 'Pau@NAQ', 'Poitiers@NAQ', 'Limoges@NAQ', 'Amiens@HDF', 'Villeurbanne@ARA',
    'La Défense|La Defense|Puteaux@IDF', 'Boulogne-Billancourt@IDF', 'Issy-les-Moulineaux@IDF', 'Neuilly-sur-Seine@IDF', 'Levallois-Perret@IDF', 'Saint-Denis@IDF',
    'Courbevoie@IDF', 'Nanterre@IDF', 'Massy@IDF', 'Saclay|Paris-Saclay@IDF', 'Vélizy-Villacoublay|Velizy@IDF', 'Guyancourt@IDF', 'Rueil-Malmaison@IDF',
  ],
  ES: [
    'Madrid@MD', 'Barcelona|Barcelone|Barcellona@CT', 'Valencia|València|Valence@VC', 'Seville|Sevilla|Séville|Siviglia@AN', 'Málaga|Malaga@AN', 'Bilbao|Bilbo@PV',
    'Zaragoza|Saragossa|Saragosse@AR', 'Alicante|Alacant@VC', 'Murcia@MC', 'Palma|Palma de Mallorca@IB', 'Las Palmas|Las Palmas de Gran Canaria@CN',
    'Santa Cruz de Tenerife|Tenerife@CN', 'Valladolid@CL', 'Vigo@GA', 'A Coruña|La Coruña|Coruña|Corunna@GA', 'Santiago de Compostela@GA', 'Granada@AN',
    'Córdoba|Cordoba|Cordova@AN', 'San Sebastián|Donostia|San Sebastian|Donostia-San Sebastián@PV', 'Vitoria-Gasteiz|Vitoria|Gasteiz@PV', 'Pamplona|Iruña@NC',
    'Santander@CB', 'Oviedo@AS', 'Gijón|Gijon@AS', 'Salamanca@CL', 'León|Leon@CL', 'Cádiz|Cadiz@AN', 'Castellón|Castellón de la Plana|Castelló@VC', 'Tarragona@CT',
    'Girona|Gerona@CT', 'Sant Cugat del Vallès|Sant Cugat@CT', 'Alcobendas@MD', 'Las Rozas@MD', 'Pozuelo de Alarcón@MD', 'Getafe@MD', 'Leganés@MD', 'Toledo@CM',
  ],
  PT: [
    'Lisbon|Lisboa|Lisbonne|Lissabon|Lisbona|Lizbona|Lisabon@LIS', 'Porto|Oporto@POR', 'Braga', 'Coimbra', 'Aveiro', 'Faro@ALG', 'Funchal@MAD', 'Guimarães|Guimaraes',
    'Leiria', 'Setúbal|Setubal', 'Évora|Evora', 'Viseu', 'Covilhã|Covilha', 'Matosinhos@POR', 'Vila Nova de Gaia|Gaia@POR', 'Maia@POR', 'Oeiras@LIS', 'Amadora@LIS',
    'Sintra@LIS', 'Cascais@LIS', 'Almada', 'Ponta Delgada@ACO', 'Viana do Castelo', 'Castelo Branco', 'Fundão|Fundao',
  ],
  BE: [
    'Brussels|Bruxelles|Brussel|Brüssel|Bruselas|Bruxelas|Bruksela|Brusel|Bryssel|Bruxelles-Capitale@BRU', 'Antwerp|Antwerpen|Anvers|Amberes|Anversa|Antuérpia|Antwerpia@VLG',
    'Ghent|Gent|Gand|Gante@VLG', 'Liège|Liege|Luik|Lieja|Lüttich@WAL', 'Leuven|Louvain|Löwen|Lovaina@VLG', 'Bruges|Brugge|Brujas|Brügge@VLG', 'Namur|Namen@WAL',
    'Charleroi@WAL', 'Mechelen|Malines@VLG', 'Hasselt@VLG', 'Kortrijk|Courtrai@VLG', 'Louvain-la-Neuve|Ottignies-Louvain-la-Neuve@WAL', 'Mons@WAL',
    'Wavre|Waver@WAL', 'Zaventem@VLG', 'Diegem@VLG', 'Machelen@VLG', 'Vilvoorde@VLG', 'Genk@VLG', 'Aalst|Alost@VLG', 'Ostend|Oostende|Ostende@VLG', 'Sint-Niklaas@VLG',
    'Roeselare@VLG', '~Waterloo@WAL', 'Nivelles@WAL', 'Tournai|Doornik@WAL',
  ],
  LU: [
    'Luxembourg City|Luxembourg-Ville|Luxemburg-Stadt|Stad Lëtzebuerg|Ville de Luxembourg|Luxembourg Ville|Luxemburgo Ciudad', 'Esch-sur-Alzette|Esch',
    'Differdange', 'Dudelange', 'Ettelbruck', 'Diekirch', 'Belval', 'Kirchberg', 'Bertrange', 'Strassen', 'Leudelange', 'Munsbach', 'Contern', 'Hesperange', 'Capellen',
  ],
  AT: [
    'Vienna|Wien|Vienne|Viena|Viena|Wiedeń|Vídeň|Bécs|Beč|Βιέννη@W', 'Graz@ST', 'Linz@OO', 'Salzburg|Salzbourg|Salisburgo@S', 'Innsbruck@T', 'Klagenfurt|Klagenfurt am Wörthersee@K',
    'Villach@K', 'Wels@OO', 'Sankt Pölten|St. Pölten|St Pölten|Sankt Poelten@NO', 'Dornbirn@V', 'Steyr@OO', 'Wiener Neustadt@NO', 'Leoben@ST', 'Hagenberg|Hagenberg im Mühlkreis@OO',
    'Bregenz@V', 'Krems|Krems an der Donau@NO', 'Eisenstadt@B', 'Feldkirch@V', 'Leonding@OO', 'Wiener Neudorf@NO', 'Schwechat@NO',
  ],
  IT: [
    'Milan|Milano|Mailand|Milán|Milão|Mediolan@LOM', 'Rome|Roma|Rom|Rzym|Řím@LAZ', 'Turin|Torino|Turín|Turim|Turyn@PIE', 'Naples|Napoli|Neapel|Nápoles|Neapol@CAM',
    'Bologna|Bolonia|Bolonha|Bologne@EMR', 'Florence|Firenze|Florenz|Florencia|Florença@TOS', 'Genoa|Genova|Genua|Gênes|Génova@LIG', 'Venice|Venezia|Venedig|Venise|Venecia|Veneza@VEN',
    'Padua|Padova|Padoue@VEN', 'Verona|Vérone@VEN', 'Trieste|Triest@FVG', 'Trento|Trient@TAA', 'Bolzano|Bozen@TAA', 'Bari@PUG', 'Palermo@SIC', 'Catania@SIC',
    'Cagliari@SAR', 'Pisa|Pise@TOS', 'Brescia@LOM', 'Bergamo@LOM', 'Modena@EMR', 'Parma|Parme@EMR', 'Reggio Emilia@EMR', 'Monza@LOM', 'Vicenza@VEN', 'Treviso@VEN',
    'Udine@FVG', 'Perugia@UMB', 'Ancona@MAR', 'Pescara@ABR', 'Lecce@PUG', 'Salerno@CAM', 'Messina@SIC', 'Varese@LOM', 'Pavia@LOM', 'Ivrea@PIE',
    'Rende|Cosenza@CAL', 'Sesto San Giovanni@LOM', 'Assago@LOM', 'Segrate@LOM',
  ],
  // ── Tier 2 ──
  DK: [
    'Copenhagen|København|Kobenhavn|Kopenhagen|Copenhague|Copenaghen|Kopenhaga|Kodaň|Köpenhamn|Kööpenhamina|Koppenhága@84', 'Aarhus|Århus@82', 'Odense@83', 'Aalborg|Ålborg@81',
    'Esbjerg@83', 'Kolding@83', 'Vejle@83', 'Horsens@82', 'Randers@82', 'Roskilde@85', 'Herning@82', 'Silkeborg@82', 'Lyngby|Kongens Lyngby@84', 'Ballerup@84', 'Hellerup@84',
    'Søborg|Soborg@84', 'Billund@83', 'Sønderborg|Sonderborg@83', 'Hillerød@84', 'Bagsværd@84', 'Frederiksberg@84',
  ],
  SE: [
    'Stockholm|Estocolmo|Stoccolma|Sztokholm|Tukholma@AB', 'Gothenburg|Göteborg|Goeteborg|Gotemburgo|Göteborg|Goteborg@O', 'Malmö|Malmo|Malmoe@M', 'Uppsala|Upsala',
    'Linköping|Linkoping', 'Västerås|Vasteras', 'Örebro|Orebro', 'Norrköping|Norrkoping', 'Helsingborg@M', 'Jönköping|Jonkoping', 'Lund@M', 'Umeå|Umea', 'Gävle|Gavle',
    'Borås|Boras@O', 'Södertälje|Sodertalje@AB', 'Eskilstuna', 'Karlstad', 'Växjö|Vaxjo', 'Halmstad', 'Sundsvall', 'Luleå|Lulea', 'Kista@AB', 'Solna@AB', 'Sundbyberg@AB',
    'Karlskrona', 'Trollhättan|Trollhattan@O', 'Kalmar', 'Skövde|Skovde@O',
  ],
  FI: [
    'Helsinki|Helsingfors|Helsinky|Helsinque@18', 'Espoo|Esbo@18', 'Tampere|Tammerfors@11', 'Vantaa|Vanda@18', 'Oulu|Uleåborg', 'Turku|Åbo@19', 'Jyväskylä|Jyvaskyla',
    'Lahti|Lahtis', 'Kuopio', 'Pori|Björneborg', 'Joensuu', 'Lappeenranta|Villmanstrand', 'Vaasa|Vasa', 'Kerava@18', 'Seinäjoki|Seinajoki', 'Hämeenlinna|Hameenlinna',
    'Rovaniemi', 'Salo@19', 'Kajaani', 'Kotka',
  ],
  NO: [
    'Oslo|Christiania@03', 'Bergen@46', 'Trondheim|Trondhjem@50', 'Stavanger', 'Drammen', 'Fredrikstad', 'Kristiansand', 'Sandnes', 'Tromsø|Tromso', 'Sarpsborg',
    'Bodø|Bodo', 'Sandvika@32', 'Lysaker@32', 'Fornebu@32', 'Asker@32', 'Lillestrøm|Lillestrom@32', 'Ålesund|Alesund', 'Haugesund', 'Tønsberg|Tonsberg', 
    'Hamar', 'Gjøvik|Gjovik', 'Kongsberg', 'Horten', 'Arendal', 'Porsgrunn', 'Skien', 'Molde', 'Halden', 'Larvik',
  ],
  EE: [
    'Tallinn|Tallin|Reval', 'Tartu|Dorpat', 'Narva', 'Pärnu|Parnu', 'Kohtla-Järve', 'Viljandi', 'Rakvere', 'Maardu', 'Kuressaare', 'Haapsalu', 'Jõhvi|Johvi', 'Paide',
    'Keila', 'Saue', 'Valga',
  ],
  LT: ['Vilnius|Wilno|Vilna|Wilna', 'Kaunas|Kowno', 'Klaipėda|Klaipeda|Memel', 'Šiauliai|Siauliai', 'Panevėžys|Panevezys', 'Alytus', 'Marijampolė', 'Mažeikiai', 'Jonava', 'Utena', 'Kėdainiai'],
  LV: ['Riga|Rīga|Ryga', 'Daugavpils|Dyneburg', 'Liepāja|Liepaja|Libau', 'Jelgava|Mitau', 'Jūrmala|Jurmala', 'Ventspils', 'Rēzekne|Rezekne', 'Valmiera', 'Ogre', 'Cēsis', 'Tukums'],
  CZ: [
    'Prague|Praha|Prag|Praga|Prága|Prag@10', 'Brno|Brünn@64', 'Ostrava|Ostrau@80', 'Plzeň|Plzen|Pilsen', 'Liberec|Reichenberg', 'Olomouc|Olmütz', 'České Budějovice|Budweis',
    'Hradec Králové|Hradec Kralove|Königgrätz', 'Pardubice', 'Ústí nad Labem|Usti nad Labem', 'Zlín|Zlin', 'Havířov', 'Kladno', 'Opava', 'Frýdek-Místek',
    'Jihlava', 'Karlovy Vary|Karlsbad', 'Mladá Boleslav|Mlada Boleslav', 'Kolín', 'Třinec',
  ],
  PL: [
    'Warsaw|Warszawa|Varsovie|Varsovia|Warschau|Varsavia|Varšava|Varsóvia|Varsó@MZ', 'Kraków|Krakow|Cracow|Krakau|Cracovie|Cracovia|Krakov|Cracóvia@MA',
    'Wrocław|Wroclaw|Breslau|Breslavia|Vratislav@DS', 'Gdańsk|Gdansk|Danzig|Dantzig@PM', 'Poznań|Poznan|Posen@WP', 'Łódź|Lodz|Lodsch@LD', 'Katowice|Kattowitz@SL',
    'Gdynia|Gdingen@PM', 'Sopot|Zoppot@PM', 'Tricity|Trójmiasto|Trojmiasto@PM', 'Szczecin|Stettin@ZP', 'Bydgoszcz|Bromberg@KP', 'Lublin@LU', 'Białystok|Bialystok@PD',
    'Rzeszów|Rzeszow@PK', 'Toruń|Torun|Thorn@KP', 'Kielce@SK', 'Gliwice|Gleiwitz@SL', 'Olsztyn|Allenstein@WN', 'Opole|Oppeln@OP', 'Bielsko-Biała|Bielsko-Biala@SL',
    'Częstochowa|Czestochowa@SL', 'Zielona Góra|Zielona Gora@LB', 'Radom@MZ', 'Sosnowiec@SL', 'Tychy@SL', 'Legnica@DS',
  ],
  SI: ['Ljubljana|Laibach|Lubiana|Liubliana|Lublaň|Lublana', 'Maribor|Marburg an der Drau', 'Celje|Cilli', 'Kranj|Krainburg', 'Koper|Capodistria', 'Velenje', 'Novo Mesto', 'Ptuj', 'Nova Gorica', 'Murska Sobota', 'Domžale', 'Kamnik'],
  MT: [
    'Valletta|Il-Belt Valletta|La Valette|La Valeta', 'Sliema|Tas-Sliema', 'St. Julian\'s|St Julians|Saint Julian\'s|San Ġiljan|San Giljan|St. Julians', 'Birkirkara',
    'Mosta', 'Qormi', 'Msida', 'Gżira|Gzira', 'Swieqi', 'San Ġwann|San Gwann', 'Mriehel', 'Ta\' Xbiex|Ta Xbiex', 'Floriana', 'Pietà|Pieta', 'Naxxar', 'Żebbuġ|Zebbug',
    'Marsa', 'Paola', 'Hamrun|Ħamrun', 'Attard', 'Balzan', '~Victoria|Rabat (Gozo)', 'Smart City Malta|SmartCity Malta',
  ],
  RO: [
    'Bucharest|București|Bucuresti|Bukarest|Bucarest|Bucareste|Bukareszt|Bukurešť|Bukarest@B', 'Cluj-Napoca|Cluj|Klausenburg|Kolozsvár@CJ', 'Iași|Iasi|Jassy@IS',
    'Timișoara|Timisoara|Temeswar|Temesvár@TM', 'Brașov|Brasov|Kronstadt', 'Constanța|Constanta', 'Craiova', 'Oradea|Nagyvárad', 'Sibiu|Hermannstadt', 'Târgu Mureș|Targu Mures',
    'Galați|Galati', 'Ploiești|Ploiesti', 'Pitești|Pitesti', 'Arad', 'Suceava', 'Bacău|Bacau', 'Baia Mare', 'Alba Iulia', 'Voluntari@B', 'Otopeni@B',
  ],
  HU: [
    'Budapest|Budapeszt|Budapešť|Budapeste@BU', 'Debrecen|Debreczin', 'Szeged', 'Miskolc', 'Pécs|Pecs|Fünfkirchen', 'Győr|Gyor|Raab', 'Nyíregyháza|Nyiregyhaza',
    'Kecskemét|Kecskemet', 'Székesfehérvár|Szekesfehervar', 'Szombathely', 'Veszprém|Veszprem', 'Eger', 'Sopron', 'Budaörs|Budaors@BU', 'Tatabánya', 'Zalaegerszeg',
  ],
  HR: ['Zagreb|Agram|Zagrzeb|Záhřeb', 'Split|Spalato', 'Rijeka|Fiume', 'Osijek|Esseg', 'Zadar|Zara', 'Pula|Pola', 'Varaždin|Varazdin', 'Dubrovnik|Ragusa', 'Slavonski Brod', 'Karlovac', 'Šibenik|Sibenik', 'Velika Gorica', 'Čakovec'],
  SK: ['Bratislava|Pressburg|Pozsony|Bratysława', 'Košice|Kosice|Kaschau|Kassa', 'Žilina|Zilina|Sillein', 'Banská Bystrica|Banska Bystrica', 'Nitra|Neutra', 'Prešov|Presov', 'Trnava|Tyrnau', 'Trenčín|Trencin', 'Poprad', 'Piešťany'],
  BG: ['Sofia|София|Sofija|Sofía|Sófia|Sofie|Sofiya', 'Plovdiv|Пловдив', 'Varna|Варна', 'Burgas|Бургас|Bourgas', 'Ruse|Русе|Rousse', 'Stara Zagora', 'Pleven', 'Veliko Tarnovo|Veliko Tărnovo', 'Blagoevgrad', 'Gabrovo', 'Shumen'],
  GR: [
    'Athens|Αθήνα|Athina|Athen|Athènes|Atenas|Atene|Ateny|Atény@I', 'Thessaloniki|Θεσσαλονίκη|Salonica|Salonika|Thessalonique|Tesalónica|Salonicco|Saloniki@B',
    'Patras|Πάτρα|Patra', 'Heraklion|Ηράκλειο|Iraklio|Iraklion', 'Larissa|Λάρισα|Larisa', 'Volos|Βόλος', 'Ioannina|Ιωάννινα', 'Chania|Χανιά', 'Piraeus|Πειραιάς|Pireas|Le Pirée@I',
    'Kalamata|Καλαμάτα', 'Marousi|Maroussi|Μαρούσι|Amarousio@I', 'Chalandri|Χαλάνδρι@I', 'Glyfada|Γλυφάδα@I', 'Kifisia|Κηφισιά|Kifissia@I', 'Xanthi|Ξάνθη', 'Rhodes|Ρόδος|Rodos',
  ],
  CY: ['Nicosia|Λευκωσία|Lefkosia|Lefkoşa|Nikosia|Nicosie', 'Limassol|Λεμεσός|Lemesos|Limasol', 'Larnaca|Λάρνακα|Larnaka', 'Paphos|Πάφος|Pafos', 'Famagusta|Αμμόχωστος|Ammochostos', 'Ayia Napa|Agia Napa', 'Paralimni', 'Strovolos', 'Germasogeia|Yermasoyia'],
  // ── Tier 3 ──
  GB: [
    'London|Londres|Londra|Londen|Londyn|Londýn|Lontoo|Λονδίνο|City of London|Greater London|Central London@ENG', 'Manchester@ENG', 'Birmingham@ENG', 'Edinburgh|Édimbourg|Edimburgo|Edynburg@SCT',
    'Glasgow@SCT', 'Leeds@ENG', 'Bristol@ENG', 'Cambridge@ENG', 'Oxford@ENG', 'Liverpool@ENG', 'Newcastle|Newcastle upon Tyne@ENG', 'Sheffield@ENG', 'Nottingham@ENG',
    'Leicester@ENG', 'Cardiff|Caerdydd@WLS', 'Belfast|Béal Feirste@NIR', 'Aberdeen@SCT', 'Dundee@SCT', 'Reading@ENG', 'Brighton|Brighton and Hove@ENG', 'Southampton@ENG',
    'Portsmouth@ENG', 'Milton Keynes@ENG', 'Coventry@ENG', 'York@ENG', 'Bath@ENG', 'Exeter@ENG', 'Norwich@ENG', 'Swansea@WLS', 'Guildford@ENG', 'Slough@ENG',
    'Basingstoke@ENG', 'Watford@ENG', 'Cheltenham@ENG', 'Gloucester@ENG', 'Plymouth@ENG', 'Bournemouth@ENG', 'Sunderland@ENG', 'Derby@ENG', 'Stoke-on-Trent@ENG',
    'Canary Wharf@ENG', 'Croydon@ENG', 'Stevenage@ENG', 'Farnborough@ENG', 'Bracknell@ENG', 'Crawley@ENG', 'Warrington@ENG', 'Livingston@SCT', 'Stirling@SCT', 'Inverness@SCT',
    'Hull|Kingston upon Hull@ENG', 'Middlesbrough@ENG', 'Chester@ENG', 'Ipswich@ENG', 'Luton@ENG', 'Maidenhead@ENG', 'Harrogate@ENG', 'Salford@ENG', 'Bradford@ENG', 'Wolverhampton@ENG',
  ],
  CH: [
    'Zurich|Zürich|Zuerich|Zurigo|Zúrich|Zurique|Zurych|Curych@ZH', 'Geneva|Genève|Geneve|Genf|Ginevra|Ginebra|Genebra|Genewa|Ženeva@GE', 'Basel|Bâle|Basilea|Bazylea|Basileia@BS',
    'Bern|Berne|Berna|Berno@BE', 'Lausanne|Losanna@VD', 'Lucerne|Luzern|Lucerna@LU', 'Zug|Zoug|Zugo@ZG', 'Lugano@TI', 'Winterthur@ZH', 'St. Gallen|Sankt Gallen|St Gallen|Saint-Gall@SG',
    '~Baden|Baden AG@AG', 'Aarau@AG', 'Schaffhausen|Schaffhouse', 'Fribourg|Freiburg im Üechtland@FR', 'Neuchâtel|Neuchatel|Neuenburg@NE', 'Sion|Sitten@VS', 'Chur|Coire@GR',
    'Biel/Bienne|Biel|Bienne@BE', 'Thun|Thoune@BE', 'Rapperswil|Rapperswil-Jona@SG', 'Schlieren@ZH', 'Dübendorf|Duebendorf@ZH', 'Wallisellen@ZH', 'Opfikon|Glattbrugg@ZH',
    'Kloten@ZH', 'Baar@ZG', 'Rotkreuz@ZG', 'Nyon@VD', 'Vevey@VD', 'Montreux@VD', 'Yverdon-les-Bains@VD', 'Bellinzona@TI', 'Locarno@TI', 'Olten@SO', 'Solothurn|Soleure@SO', 'Allschwil@BL', 'Pratteln@BL',
  ],
  CA: [
    'Toronto@ON', 'Montreal|Montréal@QC', 'Vancouver@BC', 'Ottawa@ON', 'Calgary@AB', 'Edmonton@AB', 'Waterloo@ON', 'Kitchener|Kitchener-Waterloo@ON', 'Quebec City|Québec|Ville de Québec@QC',
    'Winnipeg@MB', 'Halifax@NS', 'Victoria@BC', 'Mississauga@ON', 'Markham@ON', 'Burnaby@BC', '~Surrey@BC', '~Richmond@BC', 'Hamilton@ON', '~London@ON', 'Saskatoon@SK',
    'Regina@SK', 'Gatineau@QC', 'Laval@QC', 'Brampton@ON', 'Oakville@ON', 'Guelph@ON', 'Kingston@ON', 'Fredericton@NB', 'Moncton@NB', "St. John's|St Johns@NL",
    'Charlottetown@PE', 'Sherbrooke@QC', 'Kelowna@BC', 'Vaughan@ON', 'Richmond Hill@ON',
  ],
  US: [
    'New York|New York City|NYC|Manhattan|Brooklyn|Nueva York@NY', 'San Francisco|SF|San Francisco Bay Area|Bay Area|SF Bay Area@CA', 'Los Angeles|LA|L.A.@CA',
    'Seattle@WA', 'Boston@MA', 'Austin@TX', 'Chicago@IL', 'Washington|Washington D.C.|Washington DC|DC@DC', 'Denver@CO', 'Atlanta@GA', 'Dallas@TX',
    'Houston@TX', 'San Diego@CA', 'San Jose|San José@CA', 'Palo Alto@CA', 'Mountain View@CA', 'Menlo Park@CA', 'Sunnyvale@CA', 'Santa Clara@CA', 'Cupertino@CA',
    'Redwood City@CA', 'Oakland@CA', 'Berkeley@CA', 'San Mateo@CA', 'Irvine@CA', 'Santa Monica@CA', 'Sacramento@CA', 'Portland@OR', 'Phoenix@AZ', 'Scottsdale@AZ',
    'Salt Lake City@UT', 'Lehi@UT', 'Minneapolis@MN', 'Detroit@MI', 'Ann Arbor@MI', 'Pittsburgh@PA', 'Philadelphia@PA', 'Baltimore@MD', 'Raleigh@NC', 'Durham@NC',
    'Charlotte@NC', 'Nashville@TN', 'Miami@FL', 'Tampa@FL', 'Orlando@FL', 'Columbus@OH', 'Cleveland@OH', 'Cincinnati@OH', 'Indianapolis@IN', 'St. Louis|Saint Louis|St Louis@MO',
    'Kansas City@MO', 'Las Vegas@NV', 'Reston@VA', 'Arlington@VA', 'McLean|Mclean@VA', 'Herndon@VA', 'Richmond@VA', 'Jersey City@NJ', 'Hoboken@NJ', 'Newark@NJ',
    'Stamford@CT', 'Hartford@CT', '~Cambridge@MA', 'Somerville@MA', 'Bellevue@WA', 'Redmond@WA', 'Kirkland@WA', 'Boulder@CO', 'Madison@WI', 'Milwaukee@WI',
    'San Antonio@TX', 'Plano@TX', 'Irving@TX', 'Honolulu@HI', 'Albuquerque@NM', 'Omaha@NE', 'Boise@ID', 'Louisville@KY', 'Tempe@AZ', 'Chandler@AZ',
    'Wilmington@DE', 'Providence@RI', 'New Orleans@LA', 'Anchorage@AK', 'Des Moines@IA', '~Birmingham@AL', '~Paris@TX', '~Portland@ME',
  ],
  AU: [
    'Sydney|Sídney@NSW', 'Melbourne@VIC', 'Brisbane@QLD', 'Perth@WA', 'Adelaide@SA', 'Canberra@ACT', 'Hobart@TAS', 'Darwin@NT', 'Gold Coast@QLD', '~Newcastle|Newcastle NSW@NSW',
    'Wollongong@NSW', 'Geelong@VIC', 'Parramatta@NSW', 'North Sydney@NSW', 'Macquarie Park@NSW', 'Townsville@QLD', 'Cairns@QLD', 'Sunshine Coast@QLD', 'Launceston@TAS', 'Ballarat@VIC',
  ],
  NZ: ['Auckland|Tāmaki Makaurau', 'Wellington|Te Whanganui-a-Tara', 'Christchurch|Ōtautahi', '~Hamilton|Kirikiriroa', 'Dunedin|Ōtepoti', 'Tauranga', 'Palmerston North', 'Napier', 'Nelson', 'Queenstown', 'Lower Hutt'],
  SG: ['Singapore|Singapur|Singapour|Singapore City|新加坡'],
  JP: ['Tokyo|Tōkyō|東京|Tokio|Tokió|Tóquio', 'Osaka|Ōsaka|大阪', 'Kyoto|Kyōto|京都', 'Yokohama|横浜', 'Fukuoka|福岡', 'Nagoya|名古屋', 'Sapporo|札幌', 'Kobe|Kōbe|神戸', 'Sendai|仙台', 'Kawasaki|川崎', 'Tsukuba|つくば', 'Hiroshima|広島'],
  KR: ['Seoul|서울|Séoul|Seúl', 'Busan|Pusan|부산', 'Incheon|인천', 'Daegu|대구', 'Daejeon|대전', 'Pangyo|판교', 'Seongnam|성남', 'Suwon|수원', 'Gwangju|광주'],
  AE: ['Dubai|دبي|Dubaï|Dubái|Dubaj', 'Abu Dhabi|أبو ظبي|Abou Dabi|Abu Dabi|Abu Zabi', 'Sharjah|الشارقة', 'Ajman', 'Ras Al Khaimah|Ras al-Khaimah', 'Al Ain', 'Fujairah', 'Dubai Internet City', 'Dubai Silicon Oasis', 'DIFC'],
  IL: ['Tel Aviv|Tel Aviv-Yafo|Tel-Aviv|תל אביב|Tel Awiw', 'Jerusalem|ירושלים|Jérusalem|Jerusalén|Gerusalemme', 'Haifa|חיפה|Hajfa', 'Herzliya|Herzlia|הרצליה', 'Ramat Gan|רמת גן', 'Petah Tikva|Petach Tikva|Petah Tiqva', 'Beersheba|Be\'er Sheva|Beer Sheva', 'Netanya', 'Rehovot', 'Ra\'anana|Raanana', 'Yokneam|Yokneam Illit', 'Hod HaSharon'],
  HK: ['Hong Kong|Hongkong|香港|Hong Kong Island', 'Kowloon|九龍', 'Kwun Tong', 'Quarry Bay', 'Tsim Sha Tsui', 'Sha Tin|Shatin', 'Cyberport', 'Wan Chai', 'Causeway Bay'],
  IS: ['Reykjavík|Reykjavik|Reikiavik|Reykiavik|Rejkiavik', 'Kópavogur|Kopavogur', 'Hafnarfjörður|Hafnarfjordur', 'Akureyri', 'Garðabær|Gardabaer', 'Reykjanesbær'],
  // ── Tier 4 ──
  SA: ['Riyadh|الرياض|Riad|Ryad|Rijad|Er Riad', 'Jeddah|Jiddah|Jidda|جدة|Djeddah|Yeda', 'Dammam|الدمام', 'Khobar|Al Khobar|Al-Khobar|الخبر', 'Dhahran|الظهران', 'NEOM|Neom', 'Mecca|Makkah', 'Medina|Madinah', 'Jubail|Al Jubail', 'Thuwal|KAUST'],
  QA: ['Doha|الدوحة|Doa', 'Lusail|لوسيل', 'Al Rayyan|Ar-Rayyan|Al-Rayyan', 'Al Wakrah', 'Mesaieed', 'Ras Laffan'],
  TW: ['Taipei|臺北|台北|Taipéi|Taipé|Tajpej', 'New Taipei|新北', 'Hsinchu|新竹|Xinzhu', 'Taichung|臺中|台中', 'Tainan|臺南|台南', 'Kaohsiung|高雄', 'Taoyuan|桃園', 'Keelung'],
  MY: ['Kuala Lumpur|KL', 'Petaling Jaya|PJ', 'Cyberjaya', 'Penang|George Town|Pulau Pinang', 'Johor Bahru|JB', 'Putrajaya', 'Shah Alam', 'Ipoh', 'Kota Kinabalu', 'Kuching', 'Subang Jaya', 'Bayan Lepas', 'Malacca|Melaka'],
  BR: [
    'São Paulo|Sao Paulo|San Pablo', 'Rio de Janeiro', 'Belo Horizonte', 'Brasília|Brasilia', 'Curitiba', 'Porto Alegre', 'Recife', 'Florianópolis|Florianopolis|Floripa',
    'Campinas', 'Salvador', 'Fortaleza', 'Goiânia|Goiania', 'Manaus', 'Belém|Belem', 'São José dos Campos|Sao Jose dos Campos', 'Joinville', 'Ribeirão Preto|Ribeirao Preto', 'Uberlândia|Uberlandia',
    'Barueri', '~Vitória', 'Natal',
  ],
  MX: [
    'Mexico City|Ciudad de México|Ciudad de Mexico|CDMX|México D.F.|Mexico DF|Distrito Federal', 'Guadalajara', 'Monterrey', 'Querétaro|Queretaro|Santiago de Querétaro', 'Puebla',
    'Tijuana', '~León', 'Mérida|Merida', 'Aguascalientes', 'Chihuahua', 'San Luis Potosí|San Luis Potosi', 'Zapopan', 'Cancún|Cancun', 'Hermosillo', 'Saltillo',
    'Toluca', 'Morelia', 'Culiacán|Culiacan', 'Mexicali', 'Ciudad Juárez|Ciudad Juarez', 'San Pedro Garza García',
  ],
  // ── Not targets (recognised so they can be flagged) ──
  IN: [
    'Bengaluru|Bangalore|Bengalooru@KA', 'Mumbai|Bombay|Navi Mumbai@MH', 'Delhi|New Delhi|NCR|Delhi NCR|नई दिल्ली@DL', 'Hyderabad|Secunderabad@TG', 'Chennai|Madras@TN', 'Pune|Poona@MH',
    'Kolkata|Calcutta@WB', 'Gurugram|Gurgaon@HR', 'Noida|Greater Noida@UP', 'Ahmedabad|Amdavad@GJ', 'Kochi|Cochin@KL', 'Thiruvananthapuram|Trivandrum|Technopark@KL', 'Jaipur@RJ',
    'Chandigarh', 'Indore@MP', 'Coimbatore@TN', 'Mysuru|Mysore@KA', 'Nagpur@MH', 'Visakhapatnam|Vizag@AP', 'Bhubaneswar@OR', 'Lucknow@UP', 'Vadodara|Baroda@GJ',
    'Surat@GJ', 'Mohali', 'Mangaluru|Mangalore@KA', 'Vijayawada@AP', 'Madurai@TN', 'Bhopal@MP', 'Nashik@MH', 'Faridabad@HR', 'Ghaziabad@UP', 'Kanpur@UP', 'Patna', 'Guwahati', 'Dehradun',
    'Hubli|Hubballi@KA', 'Tiruchirappalli|Trichy@TN', 'Goa|Panaji', 'Thane@MH',
  ],
  PK: ['Karachi', 'Lahore', 'Islamabad', 'Rawalpindi', 'Faisalabad', 'Peshawar'],
  BD: ['Dhaka|Dacca', 'Chittagong|Chattogram'],
  LK: ['Colombo'],
  NP: ['Kathmandu'],
  PH: ['Manila|Metro Manila', 'Makati', 'Taguig|Bonifacio Global City|BGC', 'Quezon City', 'Cebu|Cebu City', 'Pasig', 'Davao'],
  ID: ['Jakarta', 'Bandung', 'Surabaya', 'Denpasar|Bali', 'Yogyakarta'],
  VN: ['Ho Chi Minh City|Saigon|HCMC|Thành phố Hồ Chí Minh', 'Hanoi|Hà Nội|Ha Noi', 'Da Nang|Đà Nẵng'],
  TH: ['Bangkok|กรุงเทพมหานคร', 'Chiang Mai'],
  CN: ['Shanghai|上海', 'Beijing|Peking|北京', 'Shenzhen|深圳', 'Guangzhou|广州', 'Hangzhou|杭州', 'Chengdu|成都', 'Suzhou|苏州', 'Nanjing|南京', 'Wuhan|武汉', "Xi'an|Xian|西安", 'Dalian|大连'],
  RU: ['Moscow|Moskau|Moscou|Moskva|Москва', 'Saint Petersburg|St. Petersburg|Sankt-Peterburg|Санкт-Петербург', 'Novosibirsk', 'Kazan', 'Yekaterinburg'],
  UA: ['Kyiv|Kiev|Київ|Kijów', 'Lviv|Lwów|Lemberg|Львів', 'Kharkiv|Kharkov|Charkiw', 'Odesa|Odessa', 'Dnipro|Dnepropetrovsk'],
  BY: ['Minsk|Мінск'],
  TR: ['Istanbul|İstanbul|Estambul|Stambuł', 'Ankara', 'Izmir|İzmir', 'Antalya', 'Bursa'],
  EG: ['Cairo|القاهرة|Le Caire|Kairo|El Cairo', 'Alexandria|الإسكندرية', 'Giza', 'New Cairo', 'Smart Village'],
  ZA: ['Johannesburg|Joburg|Jo\'burg', 'Cape Town|Kaapstad', 'Durban', 'Pretoria', 'Sandton', 'Stellenbosch'],
  NG: ['Lagos', 'Abuja'],
  KE: ['Nairobi', 'Mombasa'],
  MA: ['Casablanca', 'Rabat', 'Marrakesh|Marrakech', 'Tangier|Tanger'],
  TN: ['Tunis', 'Sfax', 'Sousse'],
  AR: ['Buenos Aires|CABA', '~Córdoba', 'Rosario', 'Mendoza', 'La Plata'],
  CL: ['Santiago|Santiago de Chile', 'Valparaíso|Valparaiso', 'Concepción'],
  CO: ['Bogotá|Bogota', 'Medellín|Medellin', 'Cali', 'Barranquilla'],
  PE: ['Lima'],
  UY: ['Montevideo'],
  CR: ['~San José'],
  RS: ['Belgrade|Beograd|Belgrad|Београд', 'Novi Sad', 'Niš|Nis'],
  BA: ['Sarajevo', 'Banja Luka'],
  MK: ['Skopje'],
  AL: ['Tirana|Tiranë'],
  ME: ['Podgorica'],
  MD: ['Chișinău|Chisinau|Kishinev'],
  GE: ['Tbilisi|Tiflis|თბილისი', 'Batumi'],
  AM: ['Yerevan|Erevan|Երևան'],
  AZ: ['Baku|Bakı'],
  KZ: ['Almaty|Alma-Ata', 'Astana|Nur-Sultan'],
  BH: ['Manama'],
  KW: ['Kuwait City'],
  OM: ['Muscat|Masqat'],
  JO: ['Amman'],
  LB: ['Beirut|Beyrouth'],
  LI: ['Vaduz', 'Schaan'],
  MC: ['Monte Carlo|Monte-Carlo'],
  AD: ['Andorra la Vella'],
};

function parseRow(country: string, row: string): CityInfo {
  let s = row;
  const secondary = s.startsWith('~');
  if (secondary) s = s.slice(1);
  let region: string | null = null;
  const at = s.lastIndexOf('@');
  if (at !== -1) {
    region = s.slice(at + 1);
    s = s.slice(0, at);
  }
  const [name, ...aliases] = s.split('|').map((x) => x.trim()).filter(Boolean);
  return { name, country, region, aliases: [...new Set(aliases.filter((a) => a !== name))], secondary };
}

export const CITIES: readonly CityInfo[] = Object.entries(DATA).flatMap(([country, rows]) => rows.map((r) => parseRow(country, r)));

/** Number of known cities per country (for coverage reporting and tests). */
export function cityCountByCountry(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of CITIES) out[c.country] = (out[c.country] ?? 0) + 1;
  return out;
}
