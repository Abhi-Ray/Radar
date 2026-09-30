import { describe, expect, it } from 'vitest';
import { workable } from '../../src/lib/connectors/workable';
import { FakeHttp, fakeSource, fetchCtx, fixtureJson, raw } from './_helpers';

const widget = fixtureJson<{ name: string; jobs: Record<string, unknown>[] }>('workable', 'widget-huggingface.json');
const src = fakeSource('workable', { slug: 'huggingface' });

describe('workable connector', () => {
  it('uses the v1 widget endpoint with details and keys by shortcode', async () => {
    const http = new FakeHttp([{ match: /^https:\/\/apply\.workable\.com\/api\/v1\/widget\/accounts\/huggingface\?details=true$/, body: widget }]);
    const items = await workable.fetch(fetchCtx(src, http));
    expect(items.map((i) => i.externalId)).toEqual(['F4C096B22E', '002470F128', '81B46579FE', '19A136F8E2']);
    expect(items[0]?.payload).toMatchObject({ accountName: 'Hugging Face' });
  });

  it('parses telecommuting jobs as remote and keeps the structured location', () => {
    const job = workable.parse(raw('F4C096B22E', { accountName: widget.name, job: widget.jobs[0] }), { source: src });
    expect(job.companyName).toBe('Hugging Face');
    expect(job.title).toBe('Low-level Senior Software Engineer, Xet Storage - EMEA Remote');
    expect(job.workplaceHint).toBe('remote');
    expect(job.locationRaw).toBe('Paris, Île-de-France, France (Remote)');
    expect(job.countryHint).toBe('FR');
    expect(job.applyUrl).toBe('https://apply.workable.com/j/F4C096B22E');
    expect(job.postedAt?.toISOString()).toBe('2026-07-30T00:00:00.000Z');
    expect(job.employmentType).toBe('Full-time');
    expect(job.descriptionText.length).toBeGreaterThan(200);
  });

  it('fails on unknown accounts and dead-letters empty descriptions', async () => {
    await expect(workable.fetch(fetchCtx(src, new FakeHttp([{ match: /./, status: 404 }])))).rejects.toThrow(/not found/);
    const empty = { accountName: 'x', job: { ...widget.jobs[0], description: '' } };
    expect(() => workable.parse(raw('x', empty), { source: src })).toThrow(/empty description/);
  });
});
