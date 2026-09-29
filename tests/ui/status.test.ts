/** Status vocabulary: tone maps (AA pairing rules), status metadata, fit bands and guards. */
import { describe, expect, it } from 'vitest';
import { CONFIDENCES, ELIGIBILITY_RESULTS as DB_ELIGIBILITY, METHODS, VISA_STATUSES as DB_VISA } from '@/db/schema/_enums';
import { TRUST_ORDER } from '@/lib/contracts/provenance';
import {
  CONFIDENCE_LEVELS,
  CONFIDENCE_META,
  ELIGIBILITY_META,
  ELIGIBILITY_RESULTS,
  METHOD_META,
  METHOD_ORDER,
  TONES,
  TONE_BORDER,
  TONE_FILL,
  TONE_SOLID,
  TONE_STROKE,
  TONE_TEXT,
  TONE_TINT,
  VISA_META,
  VISA_STATUSES,
  clampScore,
  fitBand,
  isConfidenceLevel,
  isEligibilityResult,
  isMethodKind,
  isTone,
  isVisaStatus,
  toEligibility,
  toVisaStatus,
} from '@/components/ui/status';

describe('contract parity', () => {
  it('mirrors the DB/contract enums exactly (same values, same order)', () => {
    expect([...VISA_STATUSES]).toEqual([...DB_VISA]);
    expect([...ELIGIBILITY_RESULTS]).toEqual([...DB_ELIGIBILITY]);
    expect([...CONFIDENCE_LEVELS]).toEqual([...CONFIDENCES]);
    expect([...METHOD_ORDER].sort()).toEqual([...METHODS].sort());
    expect([...METHOD_ORDER]).toEqual([...TRUST_ORDER]);
  });
});

describe('tone maps', () => {
  const maps = { TONE_SOLID, TONE_TINT, TONE_TEXT, TONE_BORDER, TONE_FILL, TONE_STROKE };
  it('cover every tone', () => {
    for (const [name, map] of Object.entries(maps)) {
      for (const t of TONES) expect(map[t], `${name}.${t}`).toBeTruthy();
    }
  });
  it('only put white text on cobalt or stamp-deep, and ink or paper text everywhere else', () => {
    for (const t of TONES) {
      const cls = TONE_SOLID[t];
      if (cls.includes('text-white')) expect(['bg-cobalt text-white', 'bg-stamp-deep text-white']).toContain(cls);
      else expect(cls).toMatch(/text-(ink|paper)\b/);
    }
  });
  it('never use plain stamp red as a text background', () => {
    for (const t of TONES) expect(TONE_SOLID[t]).not.toMatch(/\bbg-stamp\b(?!-)/);
  });
  it('use deep hues for text on paper', () => {
    for (const t of ['acid', 'signal', 'radar', 'cobalt', 'stamp', 'lilac'] as const) {
      expect(TONE_TEXT[t]).toBe(`text-${t}-deep`);
    }
  });
});

describe('status metadata', () => {
  it('has a label, stamp word, tone and blurb for every visa status and eligibility result', () => {
    for (const s of VISA_STATUSES) {
      const m = VISA_META[s];
      expect(m.label && m.stamp && m.blurb).toBeTruthy();
      expect(isTone(m.tone)).toBe(true);
    }
    for (const r of ELIGIBILITY_RESULTS) {
      const m = ELIGIBILITY_META[r];
      expect(m.label && m.stamp && m.blurb).toBeTruthy();
      expect(isTone(m.tone)).toBe(true);
    }
  });
  it('keeps unknown / can\'t tell visually neutral', () => {
    expect(VISA_META.unknown.tone).toBe('concrete');
    expect(ELIGIBILITY_META.cant_tell.tone).toBe('concrete');
    expect(VISA_META.confirmed.tone).toBe('radar');
    expect(VISA_META.not_offered.tone).toBe('stamp');
  });
  it('describes every method and orders confidence blocks', () => {
    for (const m of METHOD_ORDER) expect(METHOD_META[m].label && METHOD_META[m].long && METHOD_META[m].description).toBeTruthy();
    expect(CONFIDENCE_META.high.blocks).toBe(3);
    expect(CONFIDENCE_META.medium.blocks).toBe(2);
    expect(CONFIDENCE_META.low.blocks).toBe(1);
  });
});

describe('fitBand / clampScore', () => {
  it('bands scores at 80 / 60 / 40', () => {
    expect(fitBand(100).band).toBe('strong');
    expect(fitBand(80).band).toBe('strong');
    expect(fitBand(79.6).band).toBe('strong');
    expect(fitBand(79).band).toBe('good');
    expect(fitBand(60).band).toBe('good');
    expect(fitBand(59).band).toBe('fair');
    expect(fitBand(40).band).toBe('fair');
    expect(fitBand(39).band).toBe('weak');
    expect(fitBand(0).band).toBe('weak');
  });
  it('clamps out-of-range scores and treats missing as unscored', () => {
    expect(fitBand(150).band).toBe('strong');
    expect(fitBand(-5).band).toBe('weak');
    expect(fitBand(null)).toEqual({ band: 'none', label: 'Unscored', tone: 'concrete' });
    expect(fitBand(undefined).band).toBe('none');
    expect(fitBand(Number.NaN).band).toBe('none');
    expect(clampScore(101)).toBe(100);
    expect(clampScore(-1)).toBe(0);
    expect(clampScore(71.4)).toBe(71);
  });
});

describe('guards', () => {
  it('accept only exact enum values', () => {
    expect(isVisaStatus('confirmed')).toBe(true);
    expect(isVisaStatus('Confirmed')).toBe(false);
    expect(isVisaStatus(1)).toBe(false);
    expect(isEligibilityResult('doesnt_meet')).toBe(true);
    expect(isMethodKind('ai')).toBe(true);
    expect(isMethodKind('guess')).toBe(false);
    expect(isConfidenceLevel('medium')).toBe(true);
    expect(isTone('stamp')).toBe(true);
    expect(isTone('red')).toBe(false);
  });
  it('coerce anything unrecognised to the honest default', () => {
    expect(toVisaStatus('likely')).toBe('likely');
    expect(toVisaStatus('yes!')).toBe('unknown');
    expect(toVisaStatus(null)).toBe('unknown');
    expect(toEligibility('meets')).toBe('meets');
    expect(toEligibility(undefined)).toBe('cant_tell');
  });
});
