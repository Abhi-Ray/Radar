import { describe, expect, it } from 'vitest';
import { parsePersonioXml, personio } from '../../src/lib/connectors/personio';
import { FakeHttp, fakeSource, fetchCtx, fixtureText, raw } from './_helpers';

const gmbh = fixtureText('personio', 'personio-gmbh.xml');
const de = fixtureText('personio', 'personio-de.xml');

describe('personio connector', () => {
  it('parses the XML feed into positions (single position still an array)', () => {
    expect(parsePersonioXml(gmbh)).toHaveLength(3);
    const one = parsePersonioXml(de);
    expect(one).toHaveLength(1);
    expect(one[0]?.id).toBe('1834171');
    expect(parsePersonioXml('<?xml version="1.0"?><workzag-jobs></workzag-jobs>')).toEqual([]);
    expect(() => parsePersonioXml('<html><body>login</body></html>')).toThrow(/not a workzag-jobs feed/);
  });

  it('fetches the .de or .com tenant host with the language parameter', async () => {
    const http = new FakeHttp([{ match: /^https:\/\/personio-gmbh\.jobs\.personio\.com\/xml\?language=en$/, text: gmbh }]);
    const items = await personio.fetch(fetchCtx(fakeSource('personio', { slug: 'personio-gmbh', domain: 'com', language: 'en' }), http));
    expect(items).toHaveLength(3);
    expect(items[0]?.url).toBe('https://personio-gmbh.jobs.personio.com/job/1676226');
    expect(personio.sourceKeyFor(personio.configSchema.parse({ slug: 'personio-gmbh', domain: 'com' }))).toBe('personio:personio-gmbh.com');
  });

  it('treats a redirect to the marketing site as an unknown tenant', async () => {
    const http = new FakeHttp([{ match: /./, status: 307 }]);
    await expect(personio.fetch(fetchCtx(fakeSource('personio', { slug: 'celonis' }), http))).rejects.toThrow(/not found/);
  });

  it('parses sections and a remote office', () => {
    const src = fakeSource('personio', { slug: 'personio-gmbh', domain: 'com' }, { label: 'Personio' });
    const [p] = parsePersonioXml(gmbh);
    const job = personio.parse(raw('1676226', p), { source: src });
    expect(job.title).toBe('Initiativbewerbung (Festanstellung)');
    expect(job.workplaceHint).toBe('remote');
    expect(job.descriptionHtml).toContain('<h3>Ihre Aufgaben</h3>');
    expect(job.extra?.descriptionMissing).toBe(false);
    expect(job.applyUrl).toBe('https://personio-gmbh.jobs.personio.com/job/1676226');
  });

  it('keeps postings without published descriptions, flagged, built from structured facts', () => {
    const src = fakeSource('personio', { slug: 'personio' });
    const [p] = parsePersonioXml(de);
    const job = personio.parse(raw('1834171', p), { source: src });
    expect(job.title).toBe('Staff Software Engineer, Data Platform');
    expect(job.companyName).toBe('Personio SE & Co. KG');
    expect(job.locationRaw).toBe('Munich; Berlin');
    expect(job.extra?.descriptionMissing).toBe(true);
    expect(job.descriptionText).toContain('Years of experience: 7-10');
    expect(job.postedAt?.toISOString()).toBe('2024-11-13T14:10:41.000Z');
  });
});
