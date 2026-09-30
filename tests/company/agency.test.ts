import { describe, expect, it } from 'vitest';
import { detectAgency, detectAgencyFromName, detectAgencyFromText, isKnownConsultancy, knownAgencyOf } from '@/lib/company/agency';
import { normalizeCompanyName } from '@/lib/company/normalize';

describe('knownAgencyOf', () => {
  it.each([
    ['Hays', 'hays'],
    ['Hays plc', 'hays'],
    ['Hays Technology Solutions GmbH', 'hays'],
    ['Randstad', 'randstad'],
    ['Randstad Deutschland GmbH & Co. KG', 'randstad deutschland'],
    ['Randstad Nederland B.V.', 'randstad'],
    ['Michael Page International', 'michael page'],
    ['Robert Half', 'robert half'],
    ['Robert Walters plc', 'robert walters'],
    ['Adecco Personaldienstleistungen GmbH', 'adecco personaldienstleistungen'],
    ['Computer Futures', 'computer futures'],
    ['Harvey Nash Group', 'harvey nash'],
    ['Badenoch & Clark', 'badenoch and clark'],
    ['Manpower GmbH & Co. KG', 'manpower'],
    ['Experis Europe', 'experis'],
    ['Reed', 'reed'],
    ['Hudson', 'hudson'],
    ['Amadeus FiRe AG', 'amadeus fire'],
    ['Academic Work Sweden AB', 'academic work'],
    ['Kelly Services', 'kelly services'],
    ['TEKsystems', 'teksystems'],
    ['Huxley Associates', 'huxley associates'],
    ['Page Personnel', 'page personnel'],
    ['Hays Berlin', 'hays'],
  ])('%s → %s', (name, agency) => {
    expect(knownAgencyOf(normalizeCompanyName(name))).toBe(agency);
  });

  it.each([
    'Hudson River Trading',
    'Reed Elsevier',
    'Reed Smith LLP',
    'Yacht Club Games',
    'Grafton Street Studios',
    'Randstad Robotics Biotech',
    'Recruit Holdings',
    'Recruitee',
    'Personio',
    'Page Mill Ventures',
    'Hayscore Analytics',
    'Acme',
    '',
  ])('%s is not a known agency', (name) => {
    expect(knownAgencyOf(normalizeCompanyName(name))).toBeNull();
  });
});

describe('isKnownConsultancy', () => {
  it.each(['Accenture', 'Capgemini Deutschland GmbH', 'EPAM Systems', 'Thoughtworks', 'Deloitte Consulting', 'Sii Poland', 'Netcompany A/S', 'Endava plc'])(
    '%s is a consultancy',
    (name) => {
      expect(isKnownConsultancy(normalizeCompanyName(name))).toBe(true);
    },
  );

  it.each(['Hays', 'Acme', 'Accenture Song Robotics Kitchen'])('%s is not', (name) => {
    expect(isKnownConsultancy(normalizeCompanyName(name))).toBe(false);
  });
});

describe('detectAgencyFromName', () => {
  it.each([
    ['Hays AG', 'known_agency'],
    ['Randstad', 'known_agency'],
    ['Nordic Tech Recruitment Ltd', 'name_keyword'],
    ['Acme Recruiting GmbH', 'name_keyword'],
    ['Acme Staffing Inc.', 'name_keyword'],
    ['Acme Headhunters', 'name_keyword'],
    ['Müller Personalberatung GmbH', 'name_keyword'],
    ['Schmidt Personaldienstleistungen GmbH', 'name_keyword'],
    ['Weber Zeitarbeit GmbH', 'name_keyword'],
    ['Janssen Uitzendbureau B.V.', 'name_keyword'],
    ['Acme Executive Search', 'name_keyword'],
    ['Acme Staffing Solutions', 'name_keyword'],
    ['Cabinet de Recrutement Dupont', 'name_keyword'],
    ['Agencja Pracy Nowak sp. z o.o.', 'name_keyword'],
    ['Empresa de Trabajo Temporal Sol S.L.', 'name_keyword'],
    ['Müller Personalberatungsgesellschaft mbH', 'name_keyword'],
    ['Svensk Bemanning AB', 'name_keyword'],
    ['Acme Resourcing Ltd', 'name_keyword'],
    ['Acme Personnel Services', 'name_keyword'],
    ['Talent Rekrytering AB', 'name_keyword'],
  ])('%s → agency (%s)', (name, kind) => {
    const d = detectAgencyFromName(name);
    expect(d.isAgency).toBe(true);
    expect(d.strength).toBe('strong');
    expect(d.kind).toBe(kind);
    expect(d.ruleId).toMatch(/^agency\.(known|name)\./);
    expect(d.evidence).toContain(name.trim());
  });

  it.each([
    'Acme GmbH',
    'Hudson River Trading',
    'Reed Elsevier',
    'Recruit Holdings',
    'Personio GmbH',
    'Accenture',
    'Capgemini',
    'Interhyp AG',
    'Staffbase GmbH',
    'Recruitee B.V.',
    'Personal Finance Robotics',
    '',
  ])('%s → not an agency', (name) => {
    const d = detectAgencyFromName(name);
    expect(d.isAgency).toBe(false);
    expect(d.strength).toBe('none');
  });
});

describe('detectAgencyFromText', () => {
  it.each([
    ['We are recruiting on behalf of our client, a leading fintech in Berlin.', 'en.on_behalf_of_client'],
    ['On behalf of one of our clients we are looking for a DevOps engineer.', 'en.on_behalf_of_client'],
    ['Hiring for a client in the automotive space.', 'en.on_behalf_of_client'],
    ['Our client is a fast-growing SaaS scale-up.', 'en.our_client_is'],
    ['My client is looking for a senior backend engineer.', 'en.our_client_is'],
    ['Our client seeks a data engineer.', 'en.our_client_verb'],
    ['Acme is acting as an employment agency in relation to this vacancy.', 'en.agency_notice'],
    ["I'm currently working with a fantastic client in Munich who needs a Go developer.", 'en.first_person_recruiter'],
    ['This is a client of ours with offices in Amsterdam.', 'en.client_of_ours'],
    ['Im Auftrag unseres Kunden suchen wir ab sofort einen Java Entwickler (m/w/d).', 'de.im_auftrag'],
    ['Für unseren Kunden, ein Softwarehaus in Köln, suchen wir einen Entwickler.', 'de.im_auftrag'],
    ['Unser Mandant ist ein führendes Industrieunternehmen.', 'de.unser_mandant'],
    ['Unser Kunde sucht zum nächstmöglichen Zeitpunkt Verstärkung.', 'de.unser_mandant'],
    ['Die Stelle ist im Rahmen der Direktvermittlung zu besetzen.', 'de.direktvermittlung'],
    ['Notre client, acteur majeur de la finance, recherche un développeur.', 'fr.client_recherche'],
    ['Nous recrutons pour le compte de notre client un ingénieur DevOps.', 'fr.client_recherche'],
    ['Voor onze opdrachtgever in Utrecht zoeken wij een developer.', 'nl.opdrachtgever'],
    ['Onze klant is op zoek naar een data engineer.', 'nl.opdrachtgever'],
    ['Para importante cliente buscamos un desarrollador backend.', 'es.cliente_busca'],
    ['Nuestro cliente busca un ingeniero de datos.', 'es.cliente_busca'],
    ['Per importante azienda cliente ricerchiamo uno sviluppatore Java.', 'it.cliente_ricerca'],
    ['Il nostro cliente cerca un data analyst.', 'it.cliente_ricerca'],
    ['O nosso cliente procura um engenheiro de software.', 'pt.cliente_procura'],
    ['För vår kunds räkning söker vi en utvecklare.', 'sv.kunds_rakning'],
    ['På vegne af vores kunde søger vi en udvikler.', 'da.vores_kunde'],
    ['På vegne av vår kunde søker vi en utvikler.', 'no.var_kunde'],
    ['Dla naszego klienta poszukujemy programisty Java.', 'pl.nasz_klient'],
    ['Nasz klient poszukuje specjalisty ds. danych.', 'pl.nasz_klient'],
    ['Pro našeho klienta hledáme vývojáře.', 'cs.nas_klient'],
    ['Haemme asiakkaallemme ohjelmistokehittäjää.', 'fi.asiakkaamme'],
    ['Partnerünk számára keresünk fejlesztőt.', 'hu.partnerunk'],
  ])('%s → %s', (text, rule) => {
    const d = detectAgencyFromText(text);
    expect(d.isAgency).toBe(true);
    expect(d.strength).toBe('strong');
    expect(d.kind).toBe('description');
    expect(d.ruleId).toBe(`agency.text.${rule}`);
    expect(d.evidence).toBeTruthy();
  });

  it('quotes the posting verbatim (original accents and case)', () => {
    const text = 'Wir sind ein Team. Für unseren Kunden, ein Softwarehaus in Köln, suchen wir einen Entwickler. Bewirb dich!';
    const d = detectAgencyFromText(text);
    expect(d.isAgency).toBe(true);
    expect(text).toContain(d.evidence!.replace(/^…|…$/g, '').trim().slice(0, 20));
    expect(d.evidence).toContain('Für unseren Kunden');
  });

  it.each([
    ['We place our consultants with our client projects across Europe.'],
    ['You will work closely with our client success team.'],
    ['Bei unserem Kunden vor Ort arbeitest du im Projekt.'],
    ['Cabinet de recrutement spécialisé.'],
    ['Wir sind ein Personaldienstleister mit Herz.'],
  ])('weak wording is reported but not acted on: %s', (text) => {
    const d = detectAgencyFromText(text);
    expect(d.isAgency).toBe(false);
    expect(d.strength).toBe('weak');
    expect(d.ruleId).toMatch(/^agency\.text\./);
  });

  it.each([
    ['We build robots. Join our client platform team!'.replace('our client platform', 'the platform')],
    ['Acme is hiring a backend engineer to work on our clients-facing API.'],
    ['Wir suchen dich als Entwickler (m/w/d) für unser Team in Berlin.'],
    ['Nous recherchons un développeur pour notre équipe.'],
    ['Wij zoeken een developer voor ons team.'],
    [''],
    ['   '],
  ])('no agency wording: %j', (text) => {
    expect(detectAgencyFromText(text)).toMatchObject({ isAgency: false, strength: 'none' });
  });

  it('never flags a known consultancy by its posting text', () => {
    const text = 'Our client is a leading bank; you will be placed on-site at our client.';
    expect(detectAgencyFromText(text).isAgency).toBe(true);
    expect(detectAgencyFromText(text, 'accenture').isAgency).toBe(false);
    expect(detectAgencyFromText(text, 'capgemini deutschland').isAgency).toBe(false);
  });

  it('handles null / very long text', () => {
    expect(detectAgencyFromText(null).isAgency).toBe(false);
    expect(detectAgencyFromText(undefined).isAgency).toBe(false);
    const long = `${'Lorem ipsum dolor sit amet. '.repeat(2000)} Our client is a bank.`;
    expect(detectAgencyFromText(long).isAgency).toBe(false);
  });
});

describe('detectAgency', () => {
  it('prefers name evidence', () => {
    const d = detectAgency({ name: 'Hays', descriptionText: 'Our client is a bank.' });
    expect(d.kind).toBe('known_agency');
  });

  it('falls back to the posting text', () => {
    const d = detectAgency({ name: 'Nordwind Talent GmbH', descriptionText: 'Im Auftrag unseres Kunden suchen wir einen Entwickler.' });
    expect(d).toMatchObject({ isAgency: true, kind: 'description' });
  });

  it('consultancies stay employers', () => {
    const d = detectAgency({ name: 'Capgemini Deutschland GmbH', descriptionText: 'Our client is a leading insurer.' });
    expect(d.isAgency).toBe(false);
  });

  it('plain employers stay employers', () => {
    expect(detectAgency({ name: 'Acme Robotics GmbH', descriptionText: 'We build robots in Munich.' }).isAgency).toBe(false);
    expect(detectAgency({ name: 'Acme Robotics GmbH' }).isAgency).toBe(false);
  });
});
