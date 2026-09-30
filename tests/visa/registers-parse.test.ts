/**
 * Register parsers (spec §13.2) against trimmed REAL files from the publishers (2026-09-30):
 * UK Home Office CSV, IND and SIRI HTML tables, DETE and ESDC spreadsheets. Plus the small
 * text / ZIP / XLSX helpers they are built on. No network.
 */
import { describe, expect, it } from 'vitest';
import { REGISTER_KEYS, REGISTERS, UNSUPPORTED_REGISTERS, isRegisterKey } from '../../src/lib/registers/catalog';
import { DK_SIRI_URL, loadDk, loadNl, NL_IND_URL, parseIndHtml, parseSiriHtml } from '../../src/lib/registers/html-sources';
import {
  CA_PACKAGE_API,
  caStreamLabel,
  caTown,
  findIeCompaniesXlsx,
  ieStatisticsPage,
  loadCa,
  loadIe,
  parseCaRows,
  parseIeRows,
  pickCaResources,
} from '../../src/lib/registers/spreadsheet-sources';
import { assertHost, cellText, clean, decodeEntities, download, htmlTables, isoDay, parseDayFirstDate, parseEnglishDate } from '../../src/lib/registers/text';
import { RegisterError, type RegisterEntryInput } from '../../src/lib/registers/types';
import { loadUk, parseUkCsv, pickUkAttachment, UK_CONTENT_API, ukDateFromFilename, ukRating, ukTown } from '../../src/lib/registers/uk';
import { openXlsx, zipEntries, zipRead } from '../../src/lib/registers/xlsx';
import {
  CA_2026Q1_XLSX,
  caPackageOneQuarter,
  fakeFetch,
  fixture,
  fixtureText,
  IE_2025_XLSX,
  IE_2026_XLSX,
  makeXlsx,
  makeZip,
  realRegisterRoutes,
  UK_CSV_URL,
} from './register-fixtures';

const NOW = new Date('2026-09-30T06:00:00Z');

async function collect(it: AsyncIterable<RegisterEntryInput> | Iterable<RegisterEntryInput>): Promise<RegisterEntryInput[]> {
  const out: RegisterEntryInput[] = [];
  for await (const e of it) out.push(e);
  return out;
}

async function rejection(p: Promise<unknown>): Promise<RegisterError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(RegisterError);
  return err as RegisterError;
}

describe('catalog', () => {
  it('lists five importable registers with official https hosts and a sane minimum', () => {
    expect(REGISTER_KEYS).toEqual(['uk_home_office', 'nl_ind', 'dk_siri', 'ie_dete', 'ca_lmia']);
    for (const key of REGISTER_KEYS) {
      const def = REGISTERS[key];
      expect(def.key).toBe(key);
      expect(def.countryIso2).toMatch(/^[A-Z]{2}$/);
      expect(def.allowedHosts.length).toBeGreaterThan(0);
      expect(new URL(def.homepage).protocol).toBe('https:');
      expect(def.minEntries).toBeGreaterThan(0);
    }
    expect(REGISTERS.uk_home_office.evidenceKind).toBe('licensed_sponsor');
    expect(REGISTERS.ie_dete.evidenceKind).toBe('sponsorship_history');
    expect(REGISTERS.ca_lmia.evidenceKind).toBe('sponsorship_history');
  });

  it('documents the registers it does not import', () => {
    expect(UNSUPPORTED_REGISTERS.map((r) => r.countryIso2)).toEqual(expect.arrayContaining(['US', 'NZ', 'DE']));
    for (const r of UNSUPPORTED_REGISTERS) expect(r.reason.length).toBeGreaterThan(20);
    expect(isRegisterKey('uk_home_office')).toBe(true);
    expect(isRegisterKey('us_uscis')).toBe(false);
    expect(isRegisterKey(3)).toBe(false);
  });
});

describe('text helpers', () => {
  it('decodes named, decimal and hex entities; leaves unknown names', () => {
    expect(decodeEntities('R&amp;D B.V. &quot;Aa&quot; &#246;&#x00E9; &Oslash;rsted &nbsp;&bogus;')).toBe('R&D B.V. "Aa" öé Ørsted \u00a0&bogus;');
    expect(decodeEntities('&#0; &#xD800;')).toBe('� �');
    expect(decodeEntities('plain')).toBe('plain');
  });

  it('turns cell HTML into one clean line', () => {
    expect(cellText('<p>Novo&nbsp;Nordisk <br/>A/S</p>\n ')).toBe('Novo Nordisk A/S');
    expect(cellText('<span>Zero​Width</span>')).toBe('ZeroWidth');
  });

  it('extracts every table with th and td cells', () => {
    const t = htmlTables('<table><tr><th>A</th><td>1</td></tr><tr></tr></table><p>x</p><TABLE class="y"><TR><TD>b &amp; c</TD></TR></TABLE>');
    expect(t).toEqual([[['A', '1']], [['b & c']]]);
  });

  it('parses the dates the publishers print', () => {
    expect(parseEnglishDate('The overview was last updated on 3 September 2026.')).toBe('2026-09-03');
    expect(parseEnglishDate('on 2nd Sept. 2026')).toBe('2026-09-02');
    expect(parseEnglishDate('September 3, 2026')).toBe('2026-09-03');
    expect(parseEnglishDate('31 February 2026')).toBeNull();
    expect(parseEnglishDate('3 Smarch 2026')).toBeNull();
    expect(parseDayFirstDate('Last updated 29-09-2026')).toBe('2026-09-29');
    expect(parseDayFirstDate('1.2.2026')).toBe('2026-02-01');
    expect(parseDayFirstDate('13/13/2026')).toBeNull();
    expect(isoDay('2026-09-29T09:11:22+01:00')).toBe('2026-09-29');
    expect(isoDay('2026-13-01')).toBeNull();
    expect(isoDay(20260929)).toBeNull();
  });

  it('cleans values (blank, dash and n/a are null; long values cut)', () => {
    expect(clean('  a   b ', 10)).toBe('a b');
    expect(clean('-', 10)).toBeNull();
    expect(clean('N/A', 10)).toBeNull();
    expect(clean('na', 10)).toBeNull();
    expect(clean('', 10)).toBeNull();
    expect(clean(null, 10)).toBeNull();
    expect(clean(42, 10)).toBe('42');
    expect(clean('abcdef', 3)).toBe('abc');
  });

  it('accepts only https URLs on the listed hosts', () => {
    expect(assertHost('https://ind.nl/en/x', ['ind.nl']).hostname).toBe('ind.nl');
    expect(() => assertHost('http://ind.nl/en/x', ['ind.nl'])).toThrow(RegisterError);
    expect(() => assertHost('https://ind.nl.evil.example/x', ['ind.nl'])).toThrow(/official host/);
    expect(() => assertHost('not a url', ['ind.nl'])).toThrow(/invalid register URL/);
  });

  it('download: fingerprints the body, rejects non-2xx and off-host redirects', async () => {
    const f = fakeFetch({
      'https://ind.nl/a': 'hello',
      'https://ind.nl/gone': { status: 503, body: 'down' },
      'https://ind.nl/moved': { status: 200, body: 'x', finalUrl: 'https://mirror.example/x' },
    });
    const ok = await download(f, 'https://ind.nl/a', ['ind.nl'], { maxBytes: 100, timeoutMs: 1000, label: 'l' });
    expect(ok.text()).toBe('hello');
    expect(ok.file).toEqual({ url: 'https://ind.nl/a', bytes: 5, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824', label: 'l' });
    const http = await rejection(download(f, 'https://ind.nl/gone', ['ind.nl'], { maxBytes: 100, timeoutMs: 1000 }));
    expect([http.code, http.status]).toEqual(['http', 503]);
    const moved = await rejection(download(f, 'https://ind.nl/moved', ['ind.nl'], { maxBytes: 100, timeoutMs: 1000 }));
    expect(moved.code).toBe('host');
    const off = await rejection(download(f, 'https://example.com/a', ['ind.nl'], { maxBytes: 100, timeoutMs: 1000 }));
    expect(off.code).toBe('host');
    expect(f.calls).not.toContain('https://example.com/a');
  });
});

describe('ZIP / XLSX reader', () => {
  it('reads stored and deflated entries', () => {
    for (const method of [0, 8] as const) {
      const zip = makeZip({ 'a.txt': 'alpha', 'dir/b.txt': 'ünïcode' }, method);
      const entries = zipEntries(zip);
      expect([...entries.keys()]).toEqual(['a.txt', 'dir/b.txt']);
      expect(zipRead(zip, entries.get('dir/b.txt')!).toString('utf8')).toBe('ünïcode');
    }
  });

  it('refuses what is not a readable ZIP', () => {
    expect(() => zipEntries(Buffer.from('short'))).toThrow(/too small/);
    expect(() => zipEntries(Buffer.alloc(100))).toThrow(/not a ZIP/);
    const zip = makeZip({ 'a.txt': 'alpha' });
    expect(() => zipEntries(zip.subarray(10))).toThrow(RegisterError);
    const enc = zipEntries(zip).get('a.txt')!;
    expect(() => zipRead(zip, { ...enc, flags: 1 })).toThrow(/encrypted/);
    expect(() => zipRead(zip, { ...enc, method: 12 })).toThrow(/compression method 12/);
    expect(() => zipRead(zip, { ...enc, size: 300 * 1024 * 1024 })).toThrow(/too large/);
    expect(() => openXlsx(makeZip({ 'hello.txt': 'x' }))).toThrow(/workbook\.xml missing/);
  });

  it('reads shared/inline strings, numbers, booleans, sparse cells and OOXML escapes', () => {
    const wb = openXlsx(
      makeXlsx(
        '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c><c r="D1"><v>12.5</v></c></row>' +
          '<row r="2"><c r="B2" t="inlineStr"><is><t>inline &amp; co</t></is></c><c r="C2" t="b"><v>1</v></c><c r="D2" t="str"><v>A_x000D_B</v></c><c r="E2"/></row>' +
          '<row r="3"/>',
        ['Name', '<r><t>Rich</t></r><r><t xml:space="preserve"> text</t></r><rPh><t>ふりがな</t></rPh>'],
        { modified: '2026-09-02T10:11:12Z', sheetTarget: '/xl/worksheets/data.xml' },
      ),
    );
    expect(wb.sheetName).toBe('Data');
    expect(wb.modifiedDay).toBe('2026-09-02');
    expect([...wb.rows()]).toEqual([['Name', null, 'Rich text', 12.5], [null, 'inline & co', 'TRUE', 'A\rB'], []]);
    // rows() can be iterated again (the importer reads each sheet once, tests twice).
    expect([...wb.rows()].length).toBe(3);
  });

  it('opens the real DETE and ESDC workbooks', () => {
    const ie = openXlsx(fixture('ie-companies-2026.xlsx'));
    expect(ie.sheetName).toBe('Export');
    expect(ie.modifiedDay).toBe('2026-09-02');
    const first = ie.rows().next().value;
    expect(first?.slice(0, 2)).toEqual(['Employer Name', 'Permits Issued Jan']);
    const ca = openXlsx(fixture('ca-lmia-2026q1.xlsx'));
    expect(ca.modifiedDay).toBe('2026-07-21');
    const rows = [...ca.rows()];
    expect(String(rows[0][0])).toMatch(/^Employers Who Were Issued a Positive Labour Market Impact Assessment/);
    expect(rows[1]).toEqual(['Province/Territory', 'Program Stream', 'Employer', 'Address', 'Occupation', 'Incorporate Status', 'Approved LMIAs', 'Approved Positions']);
  });
});

describe('UK Home Office register', () => {
  it('picks the worker CSV attachment from the content API document', () => {
    const doc = JSON.parse(fixtureText('uk-content.json'));
    expect(pickUkAttachment(doc)).toEqual({ url: UK_CSV_URL, filename: 'SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-29.csv' });
    const two = {
      details: {
        attachments: [
          { url: 'https://assets.publishing.service.gov.uk/media/x/guidance.pdf', content_type: 'application/pdf', title: 'Guidance' },
          { url: 'https://assets.publishing.service.gov.uk/media/y/other.csv', title: 'Other list' },
          { url: 'https://assets.publishing.service.gov.uk/media/z/w.csv', title: 'Register of Worker licensed sponsors' },
        ],
      },
    };
    expect(pickUkAttachment(two).url).toMatch(/\/z\/w\.csv$/);
    expect(() => pickUkAttachment({ details: { attachments: [] } })).toThrow(/no CSV attachment/);
    expect(() => pickUkAttachment(null)).toThrow(RegisterError);
  });

  it('reads the date from the file name and the rating from "Type & Rating"', () => {
    expect(ukDateFromFilename('SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-29.csv')).toBe('2026-09-29');
    expect(ukDateFromFilename('register.csv')).toBeNull();
    expect(ukDateFromFilename(null)).toBeNull();
    expect(ukRating('Worker (A rating)')).toBe('A rating');
    expect(ukRating('Temporary Worker (A rating)')).toBe('A rating');
    expect(ukRating('Worker (B rating)')).toBe('B rating');
    expect(ukRating('Worker (A (SME+))')).toBe('A rating (SME+)');
    expect(ukRating('Worker (A (Premium))')).toBe('A rating (Premium)');
    expect(ukRating('Worker (UK Expansion Worker: Provisional )')).toBe('Provisional');
    expect(ukRating('Worker')).toBeNull();
    expect(ukRating(null)).toBeNull();
    expect(ukTown('HAMILTON,')).toBe('HAMILTON');
    expect(ukTown('Leicester, Leicestershire')).toBe('Leicester, Leicestershire');
    expect(ukTown(null)).toBeNull();
  });

  it('streams the real CSV: every row, trimmed, with ratings and routes', async () => {
    const entries = await collect(parseUkCsv(fixture('uk-register.csv')));
    expect(entries).toHaveLength(43);
    const monzo = entries.filter((e) => e.orgName === 'Monzo Bank Ltd');
    expect(monzo.map((e) => e.route)).toEqual(['Skilled Worker', 'Global Business Mobility: Senior or Specialist Worker', 'Skilled Worker']);
    // Two published rows differ only by a trailing space in the town: same canonical raw row.
    expect(monzo[0].raw).toEqual(monzo[2].raw);
    expect(entries[0]).toEqual({
      orgName: 'AaruvikA Limited',
      town: 'Edinburgh',
      route: 'Skilled Worker',
      rating: 'A rating',
      raw: { organisation: 'AaruvikA Limited', town: 'Edinburgh', county: null, typeAndRating: 'Worker (A rating)', route: 'Skilled Worker' },
    });
    const byName = (n: string) => entries.find((e) => e.orgName === n)!;
    expect(byName('Asian African Foods Ltd').town).toBe('London');
    expect(byName('Akaal Transport Ltd')).toMatchObject({ town: 'Leicester, Leicestershire', rating: 'B rating' });
    expect(byName('3DCP ACADEMY LIMITED')).toMatchObject({ rating: 'Provisional', route: 'Global Business Mobility: UK Expansion Worker' });
    expect(byName('English National Ballet').rating).toBe('A rating (SME+)');
    expect(byName('Google (UK) Limited').rating).toBe('A rating (Premium)');
    expect(byName('MARGARET ROAD STORES LTD').town).toBe('HAMILTON');
    expect(byName('BOLTWHIZ LIMITED').raw.county).toBe('Scotland');
    expect(entries.filter((e) => e.rating === 'A rating').length).toBe(37);
  });

  it('rejects a CSV without the register columns, and an empty one', async () => {
    await expect(collect(parseUkCsv('Name,Town\nAcme,London\n'))).rejects.toThrow(/missing column\(s\) Organisation Name/);
    await expect(collect(parseUkCsv(''))).rejects.toThrow(/empty/);
  });

  it('loadUk: content API → CSV, published date from the file name', async () => {
    const f = fakeFetch(realRegisterRoutes());
    const snap = await loadUk({ fetch: f, now: NOW });
    expect(f.calls).toEqual([UK_CONTENT_API, UK_CSV_URL]);
    expect(snap.publishedAt).toBe('2026-09-29');
    expect(snap.files).toHaveLength(1);
    expect(snap.files[0]).toMatchObject({ url: UK_CSV_URL, bytes: fixture('uk-register.csv').length });
    expect((await collect(snap.entries)).length).toBe(43);
  });

  it('loadUk: a CSV link off the gov.uk hosts is refused before downloading', async () => {
    const doc = JSON.parse(fixtureText('uk-content.json'));
    doc.details.attachments[0].url = 'https://evil.example/register.csv';
    const f = fakeFetch({ [UK_CONTENT_API]: JSON.stringify(doc) });
    const err = await rejection(loadUk({ fetch: f, now: NOW }));
    expect(err.code).toBe('host');
    expect(f.calls).toEqual([UK_CONTENT_API]);
    const bad = await rejection(loadUk({ fetch: fakeFetch({ [UK_CONTENT_API]: '<html>' }), now: NOW }));
    expect(bad.message).toMatch(/invalid JSON/);
  });
});

describe('NL IND and DK SIRI registers', () => {
  it('parses the IND table (quotes, entities, KVK numbers) and its date', () => {
    const { publishedAt, entries } = parseIndHtml(fixtureText('ind-work.html'));
    expect(publishedAt).toBe('2026-09-03');
    expect(entries).toHaveLength(27);
    expect(entries[0]).toEqual({
      orgName: '"Aa-Dee" Machinefabriek en Staalbouw Nederland B.V.',
      town: null,
      route: 'Work and highly skilled migrant',
      rating: null,
      raw: { organisation: '"Aa-Dee" Machinefabriek en Staalbouw Nederland B.V.', kvk: '16051874' },
    });
    const names = entries.map((e) => e.orgName);
    expect(names).toEqual(expect.arrayContaining(['Adyen N.V.', 'ASML Netherlands B.V.', 'Backbase R&D B.V.', 'bunq B.V.', 'uberall B.V.']));
    expect(entries.find((e) => e.orgName === 'GitHub B.V.')?.raw.kvk).toBe('61237523');
  });

  it('parses the SIRI table (header row inside tbody, Danish letters) and its date', () => {
    const { publishedAt, entries } = parseSiriHtml(fixtureText('siri-certified.html'));
    expect(publishedAt).toBe('2026-09-29');
    expect(entries).toHaveLength(25);
    expect(entries[0].raw).toEqual({ organisation: '&TRADITION A/S', cvr: '18169304' });
    expect(entries.map((e) => e.orgName)).toEqual(expect.arrayContaining(['Novo Nordisk A/S', 'Ørsted Wind Power A/S', 'Maersk Logistics & Services Denmark A/S']));
    expect(entries.every((e) => e.route === 'Fast-track scheme')).toBe(true);
  });

  it('fails loudly when the table is gone (page redesign)', () => {
    expect(() => parseIndHtml('<html><table><tr><td>a</td><td>b</td></tr></table></html>')).toThrow(/IND register: the register table was not found/);
    expect(() => parseSiriHtml('<p>Last updated 29-09-2026</p>')).toThrow(/SIRI certified companies/);
  });

  it('fingerprints the extracted rows, not the page bytes', async () => {
    const html = fixtureText('ind-work.html');
    const a = await loadNl({ fetch: fakeFetch({ [NL_IND_URL]: html }), now: NOW });
    const b = await loadNl({ fetch: fakeFetch({ [NL_IND_URL]: html.replace('<title>', '<meta name="csrf" content="abc123"><title>') }), now: NOW });
    expect(a.files[0].sha256).toBe(b.files[0].sha256);
    expect(a.files[0].bytes).not.toBe(b.files[0].bytes);
    const c = await loadNl({ fetch: fakeFetch({ [NL_IND_URL]: html.replace('Mollie B.V.', 'Mollie Payments B.V.') }), now: NOW });
    expect(c.files[0].sha256).not.toBe(a.files[0].sha256);
    const dk = await loadDk({ fetch: fakeFetch({ [DK_SIRI_URL]: fixture('siri-certified.html') }), now: NOW });
    expect(dk.publishedAt).toBe('2026-09-29');
    expect((await collect(dk.entries)).length).toBe(25);
  });
});

describe('IE DETE employment permits', () => {
  it('finds the "issued to companies" workbook on the statistics page', () => {
    expect(findIeCompaniesXlsx(fixtureText('ie-statistics-2026.html'), ieStatisticsPage(2026))).toBe(IE_2026_XLSX);
    expect(findIeCompaniesXlsx(fixtureText('ie-statistics-2025.html'), ieStatisticsPage(2025))).toBe(IE_2025_XLSX);
    expect(findIeCompaniesXlsx('<a href="/x/by-county-2026.xlsx">', ieStatisticsPage(2026))).toBeNull();
  });

  it('parses the 2026 layout (Employer Name … Grand Total) and skips the Total row', () => {
    const entries = [...parseIeRows(openXlsx(fixture('ie-companies-2026.xlsx')).rows(), 2026)];
    expect(entries).toHaveLength(27);
    expect(entries.some((e) => /total/i.test(e.orgName))).toBe(false);
    expect(entries.find((e) => e.orgName === 'Google Ireland Limited')).toEqual({
      orgName: 'Google Ireland Limited',
      town: null,
      route: 'Employment permits 2026 (Jan–Aug)',
      rating: '239 permits',
      raw: { year: 2026, employer: 'Google Ireland Limited', total: 239 },
    });
    expect(entries.find((e) => e.orgName === 'Stripe Payments Europe Limited')?.rating).toBe('1 permit');
  });

  it('parses the 2025 layout (blank corner, month names, Grand Total first)', () => {
    const entries = [...parseIeRows(openXlsx(fixture('ie-companies-2025.xlsx')).rows(), 2025)];
    expect(entries).toHaveLength(22);
    expect(entries[0]).toMatchObject({ orgName: 'IQVIA RDS IRELAND LTD', route: 'Employment permits 2025 (Jan–Dec)', rating: '2 permits' });
    expect(entries.find((e) => e.orgName === 'MasterCard Ireland Limited')?.rating).toBe('89 permits');
  });

  it('rejects a sheet without the header', () => {
    expect(() => [...parseIeRows([['Company', 'Count'], ['Acme', 1]], 2026)]).toThrow(/header row/);
  });

  it('loadIe: this year and last year; falls back to the two previous years in January', async () => {
    const f = fakeFetch(realRegisterRoutes());
    const snap = await loadIe({ fetch: f, now: NOW });
    expect(snap.publishedAt).toBe('2026-09-02');
    expect(snap.files.map((x) => [x.url, x.label])).toEqual([
      [IE_2026_XLSX, '2026'],
      [IE_2025_XLSX, '2025'],
    ]);
    const entries = await collect(snap.entries);
    expect(entries).toHaveLength(49);
    expect(new Set(entries.map((e) => e.raw.year))).toEqual(new Set([2026, 2025]));

    // 2027-01-05: the 2027 page does not exist yet → 2026 + 2025.
    const jan = fakeFetch(realRegisterRoutes());
    const early = await loadIe({ fetch: jan, now: new Date('2027-01-05T06:00:00Z') });
    expect(jan.calls[0]).toBe(ieStatisticsPage(2027));
    expect(early.files.map((x) => x.label)).toEqual(['2026', '2025']);

    // Any other failure (server error) is not mistaken for "not published yet".
    const routes = realRegisterRoutes();
    routes[ieStatisticsPage(2026)] = { status: 500, body: 'oops' };
    const err = await rejection(loadIe({ fetch: fakeFetch(routes), now: NOW }));
    expect(err.status).toBe(500);
  });
});

describe('CA ESDC positive LMIA employers', () => {
  it('picks the latest four English quarters, XLSX over CSV', () => {
    const pkg = JSON.parse(fixtureText('ca-package.json'));
    const picked = pickCaResources(pkg);
    expect(picked.map((r) => r.quarter)).toEqual(['2026Q1', '2025Q4', '2025Q3', '2025Q2']);
    expect(picked.every((r) => r.format === 'xlsx' && /_en\.xlsx$/.test(r.url))).toBe(true);
    expect(picked[0]).toEqual({ quarter: '2026Q1', url: CA_2026Q1_XLSX, format: 'xlsx', modifiedDay: '2026-07-21' });
    const csvOnly = { result: { resources: [{ name: '2026Q2 Positive LMIA', url: 'https://open.canada.ca/x/tfwp_2026q2_pos_en.csv', language: ['en'], created: '2026-10-01T00:00:00' }] } };
    expect(pickCaResources(csvOnly)).toEqual([{ quarter: '2026Q2', url: 'https://open.canada.ca/x/tfwp_2026q2_pos_en.csv', format: 'csv', modifiedDay: '2026-10-01' }]);
    expect(pickCaResources(null)).toEqual([]);
  });

  it('town and stream labels', () => {
    expect(caTown('St. John’s, NL A1B 1W3')).toBe('St. John’s');
    expect(caTown(null)).toBeNull();
    expect(caStreamLabel('High Wage')).toBe('High Wage stream');
    expect(caStreamLabel('Global Talent Stream')).toBe('Global Talent Stream');
    expect(caStreamLabel(null)).toBe('LMIA');
  });

  it('parses the real quarterly sheet: title row, header, data, notes', () => {
    const entries = [...parseCaRows(openXlsx(fixture('ca-lmia-2026q1.xlsx')).rows(), '2026Q1')];
    expect(entries).toHaveLength(34);
    expect(entries.some((e) => /^\d\. /.test(e.orgName) || e.orgName === 'Notes:')).toBe(false);
    expect(entries.find((e) => e.orgName === 'Shopify Inc.')).toEqual({
      orgName: 'Shopify Inc.',
      town: 'Ottawa',
      route: 'High Wage stream, 2026 Q1',
      rating: '1 position',
      raw: {
        quarter: '2026Q1',
        province: 'Ontario',
        stream: 'High Wage',
        employer: 'Shopify Inc.',
        address: 'Ottawa, ON K2P 2L8',
        occupation: '20012-Computer and information systems managers',
        status: 'Unknown',
        lmias: 1,
        positions: 1,
      },
    });
    const ea = entries.filter((e) => e.orgName === 'Electronic Arts (Canada), Inc.');
    expect(ea).toHaveLength(5);
    expect(ea[1]).toMatchObject({ town: 'Burnaby', route: 'Global Talent Stream, 2026 Q1', rating: '5 positions' });
  });

  it('parses the CSV edition too, and rejects a sheet without the header', () => {
    const csvRows = [
      ['Province/Territory', 'Program Stream', 'Employer', 'Address', 'Occupation', 'Incorporate Status', 'Approved LMIAs', 'Approved Positions'],
      ['Ontario', 'High Wage', 'Cohere Inc.', 'Toronto, ON M5T  1X', '21220-Cybersecurity specialists', 'Corporation', '1', '1'],
    ];
    expect([...parseCaRows(csvRows, '2026Q1')][0]).toMatchObject({ orgName: 'Cohere Inc.', town: 'Toronto', rating: '1 position', raw: { lmias: 1, status: 'Corporation' } });
    expect(() => [...parseCaRows([['Employer'], ['Acme']], '2026Q1')]).toThrow(/header row/);
  });

  it('loadCa: package API → quarterly files; CSV fallback decodes Latin-1', async () => {
    const f = fakeFetch(realRegisterRoutes());
    const snap = await loadCa({ fetch: f, now: NOW });
    expect(f.calls).toEqual([CA_PACKAGE_API, CA_2026Q1_XLSX]);
    expect(snap.publishedAt).toBe('2026-07-21');
    expect((await collect(snap.entries)).length).toBe(34);

    const csvUrl = 'https://open.canada.ca/data/dataset/x/resource/y/download/tfwp_2026q2_pos_en.csv';
    const pkg = { result: { resources: [{ name: '2026Q2', url: csvUrl, language: ['en'], last_modified: '2026-10-20T00:00:00' }] } };
    const latin1 = Buffer.from('Province/Territory,Program Stream,Employer,Address,Occupation,Incorporate Status,Approved LMIAs,Approved Positions\nQuebec,High Wage,Société Générale Inc.,"Montréal, QC H3B 1A1",21231-Software engineers,Unknown,1,2\n', 'latin1');
    const csv = await loadCa({ fetch: fakeFetch({ [CA_PACKAGE_API]: JSON.stringify(pkg), [csvUrl]: latin1 }), now: NOW });
    expect(await collect(csv.entries)).toEqual([
      expect.objectContaining({ orgName: 'Société Générale Inc.', town: 'Montréal', route: 'High Wage stream, 2026 Q2', rating: '2 positions' }),
    ]);

    const none = await rejection(loadCa({ fetch: fakeFetch({ [CA_PACKAGE_API]: JSON.stringify({ result: { resources: [] } }) }), now: NOW }));
    expect(none.message).toMatch(/no quarterly English LMIA files/);
    expect(caPackageOneQuarter().length).toBeGreaterThan(100);
  });
});
