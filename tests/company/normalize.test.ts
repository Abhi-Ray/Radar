import { describe, expect, it } from 'vitest';
import {
  brandKey,
  compactKey,
  companyFullKey,
  companyNameKeys,
  companyTokens,
  coreCompanyTokens,
  hasLegalSuffix,
  isPlaceholderCompanyName,
  MAX_COMPANY_KEY,
  normalizeAtsSlug,
  normalizeCompanyName,
} from '@/lib/company/normalize';

describe('normalizeCompanyName: legal forms', () => {
  it.each([
    // DACH
    ['Acme GmbH', 'acme'],
    ['ACME GMBH', 'acme'],
    ['Acme G.m.b.H.', 'acme'],
    ['Acme gGmbH', 'acme'],
    ['Acme AG', 'acme'],
    ['Acme KGaA', 'acme'],
    ['Acme GmbH & Co. KG', 'acme'],
    ['Acme GmbH & Co KG', 'acme'],
    ['Acme GmbH + Co. KG', 'acme'],
    ['Acme SE & Co. KGaA', 'acme'],
    ['Acme AG & Co. KG', 'acme'],
    ['Acme UG (haftungsbeschränkt)', 'acme'],
    ['Acme UG (haftungsbeschraenkt)', 'acme'],
    ['Acme e.K.', 'acme'],
    ['Acme e.V.', 'acme'],
    ['Acme OHG', 'acme'],
    ['Acme GbR', 'acme'],
    ['Acme mbH', 'acme'],
    ['Acme GesmbH', 'acme'],
    ['Acme Sagl', 'acme'],
    ['Acme Aktiengesellschaft', 'acme'],
    ['Acme Gesellschaft mit beschränkter Haftung', 'acme'],
    ['Acme & Co. KG', 'acme'],
    ['Acme SE', 'acme'],
    ['Acme S.E.', 'acme'],
    // UK / US / IE / AU / Asia
    ['Acme Ltd', 'acme'],
    ['Acme Ltd.', 'acme'],
    ['Acme Limited', 'acme'],
    ['ACME LIMITED', 'acme'],
    ['Acme PLC', 'acme'],
    ['Acme plc', 'acme'],
    ['Acme LLP', 'acme'],
    ['Acme LLC', 'acme'],
    ['Acme L.L.C.', 'acme'],
    ['Acme Inc', 'acme'],
    ['Acme Inc.', 'acme'],
    ['Acme, Inc.', 'acme'],
    ['Acme Incorporated', 'acme'],
    ['Acme Corp', 'acme'],
    ['Acme Corp.', 'acme'],
    ['Acme Corporation', 'acme'],
    ['Acme Co.', 'acme'],
    ['Acme Company', 'acme'],
    ['The Acme Company', 'acme'],
    ['Acme Co., Ltd.', 'acme'],
    ['Acme Pty Ltd', 'acme'],
    ['Acme Pty. Ltd.', 'acme'],
    ['Acme Pte. Ltd.', 'acme'],
    ['Acme Pvt. Ltd.', 'acme'],
    ['Acme Private Limited', 'acme'],
    ['Acme Public Limited Company', 'acme'],
    ['Acme Limited Liability Company', 'acme'],
    ['Acme Sdn Bhd', 'acme'],
    ['Acme Sdn. Bhd.', 'acme'],
    ['Acme DAC', 'acme'],
    ['Acme Kabushiki Kaisha', 'acme'],
    ['Acme K.K.', 'acme'],
    ['Acme FZ-LLC', 'acme'],
    ['Acme FZE', 'acme'],
    ['Acme W.L.L.', 'acme'],
    // FR / BE / LU
    ['Acme SAS', 'acme'],
    ['Acme S.A.S.', 'acme'],
    ['Acme SASU', 'acme'],
    ['Acme SARL', 'acme'],
    ['Acme S.à r.l.', 'acme'],
    ['Acme S.a.r.l.', 'acme'],
    ['Acme Sàrl', 'acme'],
    ['Acme SA', 'acme'],
    ['Acme S.A.', 'acme'],
    ['Acme Société Anonyme', 'acme'],
    ['Acme SPRL', 'acme'],
    ['Acme SRL', 'acme'],
    ['Acme BVBA', 'acme'],
    ['Acme ASBL', 'acme'],
    ['Acme et Cie', 'acme'],
    // NL
    ['Acme B.V.', 'acme'],
    ['Acme BV', 'acme'],
    ['Acme bv', 'acme'],
    ['Acme N.V.', 'acme'],
    ['Acme NV', 'acme'],
    ['Acme V.O.F.', 'acme'],
    ['Acme Coöperatie U.A.', 'acme'],
    ['Acme Besloten Vennootschap', 'acme'],
    // ES / PT / IT / LatAm
    ['Acme S.L.', 'acme'],
    ['Acme SL', 'acme'],
    ['Acme S.L.U.', 'acme'],
    ['Acme S.A.U.', 'acme'],
    ['Acme Sociedad Anónima', 'acme'],
    ['Acme Sociedad Limitada', 'acme'],
    ['Acme Lda', 'acme'],
    ['Acme Ltda.', 'acme'],
    ['Acme S.p.A.', 'acme'],
    ['Acme SpA', 'acme'],
    ['Acme S.r.l.', 'acme'],
    ['Acme Srls', 'acme'],
    ['Acme Società per Azioni', 'acme'],
    ['Acme S.A. de C.V.', 'acme'],
    ['Acme SA de CV', 'acme'],
    // Nordics / Baltics
    ['Acme AB', 'acme'],
    ['Acme AB (publ)', 'acme'],
    ['Acme A/S', 'acme'],
    ['Acme AS', 'acme'],
    ['Acme ASA', 'acme'],
    ['Acme ApS', 'acme'],
    ['Acme Oy', 'acme'],
    ['Acme Oyj', 'acme'],
    ['Acme Oy Ab', 'acme'],
    ['Acme I/S', 'acme'],
    ['Acme K/S', 'acme'],
    ['Acme UAB', 'acme'],
    ['Acme SIA', 'acme'],
    ['Acme OÜ', 'acme'],
    ['Acme hf.', 'acme'],
    ['Acme ehf.', 'acme'],
    // CEE
    ['Acme sp. z o.o.', 'acme'],
    ['Acme Sp. z o.o.', 'acme'],
    ['Acme sp. z o. o.', 'acme'],
    ['Acme Sp.z o.o.', 'acme'],
    ['Acme Spółka z ograniczoną odpowiedzialnością', 'acme'],
    ['Acme sp.k.', 'acme'],
    ['Acme S.K.A.', 'acme'],
    ['Acme s.r.o.', 'acme'],
    ['Acme spol. s r.o.', 'acme'],
    ['Acme Kft.', 'acme'],
    ['Acme Zrt.', 'acme'],
    ['Acme d.o.o.', 'acme'],
    ['Acme EOOD', 'acme'],
    ['Acme a.s.', 'acme'],
  ])('%s → %s', (input, key) => {
    expect(normalizeCompanyName(input)).toBe(key);
  });
});

describe('normalizeCompanyName: names that must keep their words', () => {
  it.each([
    // An ordinary word that is also a legal form stays when written as a word.
    ['Sa Pa Travel', 'sa pa travel'],
    ['Data As a Service', 'data as a service'],
    ['Made In Se', 'made in se'],
    ['Acme Consulting Group', 'acme consulting group'],
    ['Deutsche Bank', 'deutsche bank'],
    ['Bank of America', 'bank of america'],
    ['Company', 'company'],
    ['GmbH', 'gmbh'],
    ['The Company', 'company'],
    ['The', 'the'],
    ['Ltd', 'ltd'],
    ['AG', 'ag'],
    ['Co', 'co'],
    ['SAP', 'sap'],
    ['SAP SE', 'sap'],
    ['BMW AG', 'bmw'],
    ['ING', 'ing'],
    ['Airbus SE', 'airbus'],
    ['Nestlé S.A.', 'nestle'],
    ['Zalando SE', 'zalando'],
    ['Spotify AB', 'spotify'],
    ['Novo Nordisk A/S', 'novo nordisk'],
    ['Equinor ASA', 'equinor'],
    ['Nokia Oyj', 'nokia'],
    ['Allegro.eu', 'allegro eu'],
  ])('%s → %s', (input, key) => {
    expect(normalizeCompanyName(input)).toBe(key);
  });
});

describe('normalizeCompanyName: spelling variants meet', () => {
  it.each([
    ['Procter & Gamble', 'procter and gamble'],
    ['Procter and Gamble', 'procter and gamble'],
    ['Procter &amp; Gamble'.replace('&amp;', '&'), 'procter and gamble'],
    ['Kuehne + Nagel', 'kuehne and nagel'],
    ['Kühne + Nagel', 'kuhne and nagel'],
    ['Johnson&Johnson', 'johnson and johnson'],
    ['Marks & Spencer plc', 'marks and spencer'],
    ['AT&T Inc.', 'at and t'],
    ['H&M Hennes & Mauritz AB', 'h and m hennes and mauritz'],
    ["McDonald's", 'mcdonalds'],
    ['McDonald’s Corporation', 'mcdonalds'],
    ["L'Oréal", 'loreal'],
    ["L'Oréal S.A.", 'loreal'],
    ['Société Générale', 'societe generale'],
    ['Crédit Agricole S.A.', 'credit agricole'],
    ['Müller GmbH', 'muller'],
    ['Straße & Söhne GmbH', 'strasse and sohne'],
    ['Øresund A/S', 'oresund'],
    ['Æon AB', 'aeon'],
    ['Škoda Auto a.s.', 'skoda auto'],
    ['Łódź Software sp. z o.o.', 'lodz software'],
    ['J.P. Morgan', 'jp morgan'],
    ['J. P. Morgan Chase & Co.', 'j p morgan chase'],
    ['  Acme   GmbH  ', 'acme'],
    ['ACME', 'acme'],
    ['Acme (Deutschland) GmbH', 'acme deutschland'],
    ['Acme [UK] Ltd', 'acme uk'],
    ['Acme, Ltd.', 'acme'],
    ['C++ Shop GmbH', 'c shop'],
  ])('%s → %s', (input, key) => {
    expect(normalizeCompanyName(input)).toBe(key);
  });

  it('variants of one employer share a key', () => {
    const variants = ['Acme', 'ACME GmbH', 'Acme Ltd.', 'Acme & Co. KG', 'The Acme Company', 'Acme, Inc.', 'acme b.v.', 'Acme S.à r.l.'];
    expect(new Set(variants.map(normalizeCompanyName))).toEqual(new Set(['acme']));
  });

  it('keys are capped at MAX_COMPANY_KEY characters on a word boundary', () => {
    const long = Array.from({ length: 80 }, (_, i) => `word${i}`).join(' ');
    const key = normalizeCompanyName(long);
    expect(key.length).toBeLessThanOrEqual(MAX_COMPANY_KEY);
    expect(key.endsWith(' ')).toBe(false);
    expect(long.startsWith(key)).toBe(true);
  });

  it('empty and junk input gives an empty key', () => {
    expect(normalizeCompanyName('')).toBe('');
    expect(normalizeCompanyName('   ')).toBe('');
    expect(normalizeCompanyName('---')).toBe('');
    expect(normalizeCompanyName(undefined as unknown as string)).toBe('');
  });
});

describe('companyNameKeys', () => {
  it.each([
    ['Kühne + Nagel', ['kuhne and nagel', 'kuehne and nagel']],
    ['Müller GmbH', ['muller', 'mueller']],
    ['Mueller GmbH', ['mueller']],
    ['Acme GmbH', ['acme']],
    ['Öztürk Ltd', ['ozturk', 'oeztuerk']],
    ['Zürich Versicherung', ['zurich versicherung', 'zuerich versicherung']],
    // Estonian OÜ: spelling the Ü out must not turn the legal form into a name word.
    ['Acme OÜ', ['acme']],
    ['Tööriist OÜ', ['tooriist', 'toeoeriist']],
  ])('%s → %j', (input, keys) => {
    expect(companyNameKeys(input)).toEqual(keys);
  });

  it('the spelled-out umlaut form meets the other spelling', () => {
    expect(companyNameKeys('Kühne + Nagel')).toContain(normalizeCompanyName('Kuehne + Nagel'));
    expect(companyNameKeys('Müller')).toContain(normalizeCompanyName('Mueller'));
  });
});

describe('companyFullKey / hasLegalSuffix', () => {
  it.each([
    ['Acme GmbH', 'acme gmbh', true],
    ['Acme Ltd.', 'acme ltd', true],
    ['Acme S.A.', 'acme sa', true],
    ['Acme B.V.', 'acme bv', true],
    ['Acme sp. z o.o.', 'acme sp z oo', true],
    ['Acme', 'acme', false],
    ['Acme Robotics', 'acme robotics', false],
    ['GmbH', 'gmbh', false],
    ['Sa Pa Travel', 'sa pa travel', false],
    ['Acme & Co', 'acme and co', true],
  ])('%s → %s (legal: %s)', (input, full, legal) => {
    expect(companyFullKey(input)).toBe(full);
    expect(hasLegalSuffix(input)).toBe(legal);
  });

  it('full keys tell legal entities of one brand apart', () => {
    expect(companyFullKey('Acme GmbH')).not.toBe(companyFullKey('Acme Ltd'));
    expect(normalizeCompanyName('Acme GmbH')).toBe(normalizeCompanyName('Acme Ltd'));
  });
});

describe('companyTokens', () => {
  it('marks legal-form spellings as formal', () => {
    const t = companyTokens('Acme A/S');
    expect(t).toEqual([
      { text: 'acme', formal: false },
      { text: 'as', formal: true },
    ]);
    expect(companyTokens('Data as a service').map((x) => x.formal)).toEqual([false, false, false, false]);
    expect(companyTokens('Acme SpA')[1]).toEqual({ text: 'spa', formal: true });
    expect(companyTokens('Acme e.V.')[1]).toEqual({ text: 'ev', formal: true });
  });

  it('splits on brackets and punctuation', () => {
    expect(companyTokens('Acme (UK) Ltd').map((t) => t.text)).toEqual(['acme', 'uk', 'ltd']);
    expect(companyTokens('Acme | Careers').map((t) => t.text)).toEqual(['acme', 'careers']);
    expect(companyTokens('acme-robotics.io').map((t) => t.text)).toEqual(['acme', 'robotics', 'io']);
  });

  it('coreCompanyTokens drops a leading "the" and trailing forms, never everything', () => {
    expect(coreCompanyTokens('The Acme Company Ltd')).toEqual(['acme']);
    expect(coreCompanyTokens('Company Ltd')).toEqual(['company']);
    expect(coreCompanyTokens('Ltd')).toEqual(['ltd']);
    expect(coreCompanyTokens('The Ltd')).toEqual(['ltd']);
  });
});

describe('brandKey', () => {
  it.each([
    ['Acme Deutschland GmbH', 'acme'],
    ['Acme (UK) Ltd', 'acme'],
    ['Acme Europe B.V.', 'acme'],
    ['Acme EMEA Ltd', 'acme'],
    ['Acme DACH GmbH', 'acme'],
    ['Acme Nederland B.V.', 'acme'],
    ['Acme France SAS', 'acme'],
    ['Acme Polska sp. z o.o.', 'acme'],
    ['Acme Sverige AB', 'acme'],
    ['Acme Robotics Germany GmbH', 'acme robotics'],
    ['Acme International', 'acme'],
    ['Acme UK Europe', 'acme'],
  ])('%s → %s', (input, key) => {
    expect(brandKey(input)).toBe(key);
  });

  it.each([
    ['Acme GmbH'],
    ['Acme Robotics'],
    ['Air France'],
    ['Bank of America'],
    ['Banco de España'],
    ['Deutsche Bank'],
    ['Visit Sweden'],
    ['National Australia'],
    ['UK'],
    ['Germany'],
    ['Radio Sweden'],
    ['Ab Germany'],
  ])('%s → null (no qualifier, or too generic without it)', (input) => {
    expect(brandKey(input)).toBeNull();
  });
});

describe('compactKey / normalizeAtsSlug', () => {
  it.each([
    ['acme-corp', 'acmecorp'],
    ['Acme Corp', 'acmecorp'],
    ['Ácme_Robotics', 'acmerobotics'],
    ['', ''],
  ])('compactKey(%s) = %s', (input, key) => {
    expect(compactKey(input)).toBe(key);
  });

  it.each([
    ['acme-corp', 'greenhouse', 'greenhouse:acmecorp'],
    ['AcmeCorp', 'Greenhouse', 'greenhouse:acmecorp'],
    ['acme', 'lever', 'lever:acme'],
    ['acme', null, 'acme'],
    ['acme', undefined, 'acme'],
    ['a', 'lever', null],
    ['', 'lever', null],
    ['--', 'lever', null],
  ])('normalizeAtsSlug(%s, %s) = %s', (slug, platform, key) => {
    expect(normalizeAtsSlug(slug, platform)).toBe(key);
  });

  it('slug keys are length-limited', () => {
    const key = normalizeAtsSlug('x'.repeat(400), 'y'.repeat(100));
    expect(key).not.toBeNull();
    expect(key!.length).toBeLessThanOrEqual(30 + 1 + 150);
  });

  it('the same slug on two platforms gives two keys', () => {
    expect(normalizeAtsSlug('acme', 'lever')).not.toBe(normalizeAtsSlug('acme', 'greenhouse'));
  });
});

describe('isPlaceholderCompanyName', () => {
  it.each([
    'Confidential',
    'CONFIDENTIAL',
    'Confidential Company',
    'Company Confidential',
    'Anonymous',
    'Undisclosed',
    'Undisclosed Client',
    'Stealth Startup',
    'Stealth-mode startup',
    'Our Client',
    'Private Company',
    'Unknown',
    'N/A',
    'n.a.',
    'TBD',
    'Vertraulich',
    'Unser Kunde',
    'Unser Mandant',
    'Namhaftes Unternehmen',
    'Entreprise confidentielle',
    'Notre client',
    'Vertrouwelijk',
    'Empresa confidencial',
    'Azienda riservata',
    'Poufne',
    'Company',
    'Employer',
    'Recruiter',
    '',
    '   ',
    '???',
  ])('%j is a placeholder', (name) => {
    expect(isPlaceholderCompanyName(name)).toBe(true);
  });

  it.each(['Acme', 'Confidential Robotics GmbH', 'Stealth Labs Inc', 'Client Server Solutions', 'Hidden Brain Ltd', 'Private Bank Zurich AG', 'Unknown Worlds Entertainment'])(
    '%j is a real name',
    (name) => {
      expect(isPlaceholderCompanyName(name)).toBe(false);
    },
  );
});
