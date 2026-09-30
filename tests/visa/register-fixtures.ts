/**
 * Test helpers for the register importers: the trimmed REAL register files under
 * ./fixtures/registers (downloaded from the publishers on 2026-09-30, cut to ≤ 50 rows each) and a
 * fake fetcher that serves them by URL. No network is used.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { CA_PACKAGE_API, ieStatisticsPage } from '../../src/lib/registers/spreadsheet-sources';
import { DK_SIRI_URL, NL_IND_URL } from '../../src/lib/registers/html-sources';
import type { RegisterFetch } from '../../src/lib/registers/types';
import { UK_CONTENT_API } from '../../src/lib/registers/uk';

const DIR = path.resolve(__dirname, 'fixtures/registers');

export function fixture(name: string): Buffer {
  return readFileSync(path.join(DIR, name));
}

export function fixtureText(name: string): string {
  return fixture(name).toString('utf8');
}

export const UK_CSV_URL =
  'https://assets.publishing.service.gov.uk/media/6abb7089fe72ed1e2b02f19e/SP_-_Worker_and_Temporary_Worker_Web_Register_-_2026-09-29.csv';
export const IE_2026_XLSX = 'https://enterprise.gov.ie/en/publications/publication-files/employment-permits-issued-to-companies-2026.xlsx';
export const IE_2025_XLSX = 'https://enterprise.gov.ie/en/publications/publication-files/permits-issued-to-companies-2025.xlsx';
export const CA_2026Q1_XLSX =
  'https://open.canada.ca/data/dataset/90fed587-1364-4f33-a9ee-208181dc0b97/resource/4ee7a4e0-ffc3-47af-94e7-30929d1eeb67/download/tfwp_2026q1_pos_en.xlsx';

/** The CKAN package reduced to the one quarter that has a fixture file. */
export function caPackageOneQuarter(): Buffer {
  const pkg = JSON.parse(fixtureText('ca-package.json')) as { result: { resources: { url: string }[] } };
  pkg.result.resources = pkg.result.resources.filter((r) => r.url === CA_2026Q1_XLSX);
  return Buffer.from(JSON.stringify(pkg));
}

export type Served = Buffer | string | { status: number; body?: Buffer | string; finalUrl?: string };

/** Every register's pages and files, as the publishers served them. */
export function realRegisterRoutes(): Record<string, Served> {
  return {
    [UK_CONTENT_API]: fixture('uk-content.json'),
    [UK_CSV_URL]: fixture('uk-register.csv'),
    [NL_IND_URL]: fixture('ind-work.html'),
    [DK_SIRI_URL]: fixture('siri-certified.html'),
    [ieStatisticsPage(2026)]: fixture('ie-statistics-2026.html'),
    [ieStatisticsPage(2025)]: fixture('ie-statistics-2025.html'),
    [IE_2026_XLSX]: fixture('ie-companies-2026.xlsx'),
    [IE_2025_XLSX]: fixture('ie-companies-2025.xlsx'),
    [CA_PACKAGE_API]: caPackageOneQuarter(),
    [CA_2026Q1_XLSX]: fixture('ca-lmia-2026q1.xlsx'),
  };
}

export interface FakeFetch extends RegisterFetch {
  calls: string[];
}

/** A RegisterFetch serving `routes`; unknown URLs answer 404. */
export function fakeFetch(routes: Record<string, Served>): FakeFetch {
  const calls: string[] = [];
  const serve: RegisterFetch = async (url) => {
    calls.push(url);
    const r = routes[url];
    const res = r === undefined ? { status: 404, body: 'not found' } : Buffer.isBuffer(r) || typeof r === 'string' ? { status: 200, body: r } : r;
    const body = Buffer.isBuffer(res.body) ? res.body : Buffer.from(res.body ?? '', 'utf8');
    return {
      status: res.status,
      ok: res.status >= 200 && res.status < 300,
      body,
      finalUrl: ('finalUrl' in res && res.finalUrl) || url,
      text: () => body.toString('utf8'),
    };
  };
  return Object.assign(serve, { calls });
}

// ------------------------------------------------------------------ tiny ZIP writer (tests only)

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Builds a ZIP archive (deflate by default, or stored) from name → content. */
export function makeZip(files: Record<string, string | Buffer>, method: 0 | 8 = 8): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = method === 8 ? deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, packed);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + packed.length;
  }
  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  const count = Object.keys(files).length;
  eocd.writeUInt16LE(count, 8);
  eocd.writeUInt16LE(count, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, eocd]);
}

/** A one-sheet XLSX whose sheet XML body (`<row>`s) and shared strings are given. */
export function makeXlsx(sheetRows: string, shared: string[] = [], opts: { method?: 0 | 8; modified?: string; sheetTarget?: string } = {}): Buffer {
  const target = opts.sheetTarget ?? 'worksheets/sheet1.xml';
  return makeZip(
    {
      '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      'xl/workbook.xml':
        '<?xml version="1.0" encoding="UTF-8"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
      'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="${target}"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
      'xl/sharedStrings.xml': `<?xml version="1.0" encoding="UTF-8"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">${shared.map((s) => (s.startsWith('<') ? `<si>${s}</si>` : `<si><t>${s}</t></si>`)).join('')}</sst>`,
      [target.startsWith('/') ? target.slice(1) : `xl/${target}`]: `<?xml version="1.0" encoding="UTF-8"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${sheetRows}</sheetData></worksheet>`,
      ...(opts.modified
        ? {
            'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dcterms:modified xsi:type="dcterms:W3CDTF">${opts.modified}</dcterms:modified></cp:coreProperties>`,
          }
        : {}),
    },
    opts.method ?? 8,
  );
}
