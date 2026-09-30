import { describe, expect, it } from 'vitest';
import { EDITABLE_FIELDS, FIELD_SPECS, inputName, isEditableField } from '@/components/jobs/field-edit';
import { buildFieldValue, formDefaults, type FieldValueContext } from '@/components/jobs/field-values';
import { DEFAULT_EXPERIENCE_BAND } from '@/lib/normalize/experience';

const ctx: FieldValueContext = { fx: { date: '2026-09-29', rates: { GBP: 0.85, USD: 1.1 } }, experienceBand: DEFAULT_EXPERIENCE_BAND };
const job = { title: 'Cloud Security Engineer', countryIso2: 'DE', city: 'Berlin', workplaceType: 'hybrid', closingAt: null };

describe('field specs', () => {
  it('has a spec with at least one input for every editable field', () => {
    for (const field of EDITABLE_FIELDS) {
      expect(FIELD_SPECS[field].field).toBe(field);
      expect(FIELD_SPECS[field].inputs.length).toBeGreaterThan(0);
    }
    expect(isEditableField('salary')).toBe(true);
    expect(isEditableField('description')).toBe(false);
    expect(inputName('min')).toBe('v_min');
  });
});

describe('buildFieldValue', () => {
  it('builds a stated salary in annual EUR with the FX receipt', () => {
    const r = buildFieldValue('salary', { min: '4,000', max: '5000', currency: 'gbp', period: 'month', grossNet: 'gross', installments: '12' }, ctx);
    expect(r).toEqual({
      ok: true,
      value: {
        min: 4000,
        max: 5000,
        currency: 'GBP',
        period: 'month',
        grossNet: 'gross',
        installments: 12,
        annualEurMin: Math.round((4000 * 12) / 0.85),
        annualEurMax: Math.round((5000 * 12) / 0.85),
        fxRate: 0.85,
        fxDate: '2026-09-29',
        kind: 'stated',
      },
    });
  });

  it('keeps an unconvertible salary honest (no EUR, no rate)', () => {
    const r = buildFieldValue('salary', { min: '90000', currency: 'XYZ', period: 'year', grossNet: 'unknown' }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toMatchObject({ annualEurMin: null, fxRate: null, fxDate: null, installments: null });
  });

  it('rejects bad salaries', () => {
    expect(buildFieldValue('salary', { currency: 'EUR', period: 'year' }, ctx).ok).toBe(false);
    expect(buildFieldValue('salary', { min: '9', max: '1', currency: 'EUR', period: 'year' }, ctx).ok).toBe(false);
    expect(buildFieldValue('salary', { min: '1e5', currency: 'EUR', period: 'year' }, ctx).ok).toBe(false);
    expect(buildFieldValue('salary', { min: '1', currency: 'EURO', period: 'year' }, ctx).ok).toBe(false);
    expect(buildFieldValue('salary', { min: '1', currency: 'EUR', period: 'week' }, ctx).ok).toBe(false);
    expect(buildFieldValue('salary', { min: '1', currency: 'EUR', period: 'month', installments: '20' }, ctx).ok).toBe(false);
  });

  it('derives the experience band from the profile settings', () => {
    const r = buildFieldValue('experience', { minYears: '3', maxYears: '5', securityStrict: 'on' }, ctx);
    expect(r).toEqual({ ok: true, value: { minYears: 3, maxYears: 5, band: 'core', securityStrict: true } });
    const far = buildFieldValue('experience', { minYears: '10' }, ctx);
    expect(far.ok && (far.value as { band: string }).band).toBe('hide');
    expect(buildFieldValue('experience', { minYears: '5', maxYears: '2' }, ctx).ok).toBe(false);
    expect(buildFieldValue('experience', {}, ctx).ok).toBe(false);
  });

  it('validates enums and codes', () => {
    expect(buildFieldValue('visa_status', { status: 'confirmed' }, ctx)).toEqual({ ok: true, value: { status: 'confirmed', reasons: [] } });
    expect(buildFieldValue('visa_status', { status: 'maybe' }, ctx).ok).toBe(false);
    expect(buildFieldValue('remote', { class: 'region_limited', regions: 'EU, UK, EU' }, ctx)).toEqual({ ok: true, value: { class: 'region_limited', regions: ['EU', 'UK'] } });
    expect(buildFieldValue('language', { requirement: 'local_required', languages: 'DE, nl', postingLang: 'en' }, ctx)).toEqual({
      ok: true,
      value: { postingLang: 'en', requirement: 'local_required', languages: ['de', 'nl'] },
    });
    expect(buildFieldValue('language', { requirement: 'local_required', languages: 'German' }, ctx).ok).toBe(false);
    expect(buildFieldValue('seniority', { word: '' }, ctx)).toEqual({ ok: true, value: { word: null } });
    expect(buildFieldValue('seniority', { word: 'staff' }, ctx).ok).toBe(false);
  });

  it('checks real calendar dates', () => {
    expect(buildFieldValue('closing_date', { date: '2026-10-31' }, ctx)).toEqual({ ok: true, value: '2026-10-31' });
    expect(buildFieldValue('closing_date', { date: '2026-02-30' }, ctx).ok).toBe(false);
    expect(buildFieldValue('closing_date', { date: '31.10.2026' }, ctx).ok).toBe(false);
  });

  it('builds role, skills, eligibility and suspicious shapes', () => {
    expect(buildFieldValue('role', { roleKey: 'Cloud_Security_Engineer', roleFamily: 'primary', canonicalTitle: 'Cloud Security Engineer' }, ctx)).toEqual({
      ok: true,
      value: { roleKey: 'cloud_security_engineer', roleFamily: 'primary', canonicalTitle: 'Cloud Security Engineer' },
    });
    expect(buildFieldValue('skills', { found: 'AWS, IAM', matched: 'AWS' }, ctx)).toEqual({ ok: true, value: { found: ['AWS', 'IAM'], matched: ['AWS'] } });
    expect(buildFieldValue('skills', {}, ctx).ok).toBe(false);
    expect(buildFieldValue('eligibility', { result: 'meets', explain: 'Salary clears the Blue Card line.' }, ctx)).toEqual({
      ok: true,
      value: { result: 'meets', reason: 'Salary clears the Blue Card line.', marginPct: null, ruleVerifiedAt: null, rule: null },
    });
    expect(buildFieldValue('eligibility', { result: 'meets', explain: ' ' }, ctx).ok).toBe(false);
    expect(buildFieldValue('suspicious', { flag: 'yes' }, ctx)).toEqual({ ok: true, value: { suspicious: true, reasons: [] } });
  });

  it('builds plain column values', () => {
    expect(buildFieldValue('title', { title: '  Senior   Cloud Engineer ' }, ctx)).toEqual({ ok: true, value: 'Senior Cloud Engineer' });
    expect(buildFieldValue('title', { title: '' }, ctx).ok).toBe(false);
    expect(buildFieldValue('country', { country: 'nl' }, ctx)).toEqual({ ok: true, value: 'NL' });
    expect(buildFieldValue('country', { country: '' }, ctx)).toEqual({ ok: true, value: null });
    expect(buildFieldValue('country', { country: 'NLD' }, ctx).ok).toBe(false);
    expect(buildFieldValue('city', { city: '' }, ctx)).toEqual({ ok: true, value: null });
    expect(buildFieldValue('workplace_type', { workplace: 'remote' }, ctx)).toEqual({ ok: true, value: 'remote' });
    expect(buildFieldValue('workplace_type', { workplace: 'moon' }, ctx).ok).toBe(false);
  });
});

describe('formDefaults', () => {
  it('pre-fills from the winning value and only returns inputs the form has', () => {
    const salary = { min: 60000, max: 75000, currency: 'EUR', period: 'year', grossNet: 'gross', installments: null };
    expect(formDefaults('salary', salary, job)).toEqual({ min: '60000', max: '75000', currency: 'EUR', period: 'year', grossNet: 'gross', installments: '' });
    expect(formDefaults('remote', { class: 'worldwide', regions: ['EU'] }, job)).toEqual({ class: 'worldwide', regions: 'EU' });
    expect(formDefaults('closing_date', '2026-10-15', job)).toEqual({ date: '2026-10-15' });
    expect(formDefaults('country', null, job)).toEqual({ country: 'DE' });
    expect(formDefaults('role', null, job)).toEqual({ roleKey: '', roleFamily: 'other', canonicalTitle: 'Cloud Security Engineer' });
    expect(formDefaults('suspicious', true, job)).toEqual({ flag: 'yes' });
  });

  it('round-trips a built value back into the same inputs', () => {
    const raw = { requirement: 'local_required', languages: 'de, nl', postingLang: 'en' };
    const built = buildFieldValue('language', raw, ctx);
    expect(built.ok).toBe(true);
    if (built.ok) expect(formDefaults('language', built.value, job)).toEqual(raw);
  });
});
