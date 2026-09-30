import { describe, expect, it } from 'vitest';
import { SourceError } from '../../src/lib/contracts/connectors';
import { repairMojibake } from '../../src/lib/connectors/common';
import { remoteok, remoteokJobs } from '../../src/lib/connectors/remoteok';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const body = fixtureJson<Record<string, unknown>[]>('remoteok', 'api.json');
const src = fakeSource('remoteok', {});
const cfg = remoteok.configSchema.parse({});

describe('remoteok connector', () => {
  it('skips the legal notice element', async () => {
    expect(remoteokJobs(body).map((j) => j.id)).toEqual(['1137417', '1137155', '1137062', '1137434']);
    const items = await remoteok.fetch(fetchCtx(src, new FakeHttp([{ match: /^https:\/\/remoteok\.com\/api$/, body }])));
    expect(items).toHaveLength(4);
    expect(() => remoteokJobs({ jobs: [] })).toThrow(SourceError);
  });

  it('parses: Remote OK page as the link back, USD salary, repaired encoding', () => {
    const jobs = remoteokJobs(body);
    const a = remoteok.parse(raw('x', jobs[1]), { source: src });
    expect(a.title).toBe('Oracle Fusion Cloud Lead — Logistics & Supply Chain Management');
    expect(a.salaryHint).toMatchObject({ min: 30, max: 36, currency: 'USD', period: 'year' });
    expect(a.descriptionText).not.toMatch(/Ã|â\u0080/);
    const b = remoteok.parse(raw('x', jobs[0]), { source: src });
    expect(b.salaryHint).toBeNull(); // 0/0 means not given
    expect(b.locationRaw).toBe('Remote');
    expect(b.applyUrl).toMatch(/^https:\/\/remoteOK\.com\/remote-jobs\//i);
    expect(b.postedAt?.toISOString()).toBe('2026-09-22T09:00:01.000Z');
    const c = remoteok.parse(raw('x', jobs[3]), { source: src });
    expect(c.locationRaw).toBe('Remote (SIHO - Columbus, IN)');
    expect(c.companyName).toBe('SIHO Insurance Services');
  });

  it('repairMojibake fixes Latin-1-decoded UTF-8 and leaves correct text alone', () => {
    expect(repairMojibake('MecÃ¡nico â\u0080\u0094 ok')).toBe('Mecánico — ok');
    expect(repairMojibake('Zürich — café naïve 東京')).toBe('Zürich — café naïve 東京');
    expect(repairMojibake('Ã')).toBe('Ã');
  });

  it('pre-filter uses title + tags', () => {
    const jobs = remoteokJobs(body);
    expect(remoteok.prefilter!(raw('x', jobs[0]), cfg).keep).toBe(true);
    expect(remoteok.prefilter!(raw('x', jobs[2]), cfg).keep).toBe(true);
    expect(remoteok.prefilter!(raw('x', jobs[3]), cfg).keep).toBe(false);
  });
});
