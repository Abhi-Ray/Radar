/** Pure /kit URL state and the shared positive-id parser. */
import { describe, expect, it } from 'vitest';
import { kitHref, parseKitParams, parsePositiveId } from '../../src/components/kit/params';

describe('kit params', () => {
  it('parses positive ids only', () => {
    expect(parsePositiveId('42')).toBe(42);
    expect(parsePositiveId('0')).toBeNull();
    expect(parsePositiveId('007')).toBeNull();
    expect(parsePositiveId('-3')).toBeNull();
    expect(parsePositiveId('1e3')).toBeNull();
    expect(parsePositiveId('2147483648')).toBeNull();
    expect(parsePositiveId(null)).toBeNull();
  });

  it('picks the tab from the explicit tab or from the id that is set', () => {
    expect(parseKitParams({})).toEqual({ tab: 'resumes', resume: null, template: null, job: null });
    expect(parseKitParams({ template: '7' }).tab).toBe('templates');
    expect(parseKitParams({ resume: 'new' })).toMatchObject({ tab: 'resumes', resume: 'new' });
    expect(parseKitParams({ job: '12' })).toMatchObject({ tab: 'tailor', job: 12 });
    expect(parseKitParams({ tab: 'conventions', template: '7' }).tab).toBe('conventions');
    expect(parseKitParams({ tab: 'hack', resume: 'x' })).toEqual({ tab: 'resumes', resume: null, template: null, job: null });
    expect(parseKitParams({ tab: ['templates', 'resumes'] }).tab).toBe('templates');
  });

  it('builds links with only the keys that matter', () => {
    expect(kitHref({})).toBe('/kit');
    expect(kitHref({ tab: 'templates', template: 3 })).toBe('/kit?tab=templates&template=3');
    expect(kitHref({ tab: 'tailor', job: 9, resume: null })).toBe('/kit?tab=tailor&job=9');
    expect(kitHref({ resume: 'new' })).toBe('/kit?resume=new');
  });
});
