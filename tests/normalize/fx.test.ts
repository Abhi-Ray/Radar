import { describe, expect, it } from 'vitest';
import { FxParseError, fxReferenceAgeDays, fxTableFromSetting, isFxStale, parseEcbXml } from '@/lib/fx/ecb';
import { EUR_FIXED_RATES, USD_PEGS, lookupRate, toEur, withDerivedRates } from '@/lib/fx/rates';

export const ECB_SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<gesmes:Envelope xmlns:gesmes="http://www.gesmes.org/xml/2002-08-01" xmlns="http://www.ecb.int/vocabulary/2002-08-01/eurofxref">
  <gesmes:subject>Reference rates</gesmes:subject>
  <gesmes:Sender>
    <gesmes:name>European Central Bank</gesmes:name>
  </gesmes:Sender>
  <Cube>
    <Cube time='2026-09-28'>
      <Cube currency='USD' rate='1.1702'/>
      <Cube currency='JPY' rate='172.35'/>
      <Cube currency='CZK' rate='24.412'/>
      <Cube currency='DKK' rate='7.4631'/>
      <Cube currency='GBP' rate='0.86945'/>
      <Cube currency='HUF' rate='390.15'/>
      <Cube currency='PLN' rate='4.2710'/>
      <Cube currency='RON' rate='5.0812'/>
      <Cube currency='SEK' rate='11.0215'/>
      <Cube currency='CHF' rate='0.9387'/>
      <Cube currency='ISK' rate='145.10'/>
      <Cube currency='NOK' rate='11.7040'/>
      <Cube currency='AUD' rate='1.7811'/>
      <Cube currency='CAD' rate='1.6205'/>
      <Cube currency='SGD' rate='1.5012'/>
    </Cube>
  </Cube>
</gesmes:Envelope>`;

describe('parseEcbXml', () => {
  it('parses the daily file', () => {
    const r = parseEcbXml(ECB_SAMPLE);
    expect(r.date).toBe('2026-09-28');
    expect(r.rates.USD).toBe(1.1702);
    expect(r.rates.GBP).toBe(0.86945);
    expect(Object.keys(r.rates)).toHaveLength(15);
    expect(r.rates.EUR).toBeUndefined();
  });

  it('takes the latest day from multi-day files', () => {
    const xml = `<Envelope><Cube>
      <Cube time="2026-09-25"><Cube currency="USD" rate="1.10"/><Cube currency="GBP" rate="0.8"/><Cube currency="CHF" rate="0.9"/><Cube currency="SEK" rate="11"/><Cube currency="PLN" rate="4.3"/></Cube>
      <Cube time="2026-09-28"><Cube currency="USD" rate="1.20"/><Cube currency="GBP" rate="0.9"/><Cube currency="CHF" rate="0.95"/><Cube currency="SEK" rate="11.1"/><Cube currency="PLN" rate="4.2"/></Cube>
    </Cube></Envelope>`;
    const r = parseEcbXml(xml);
    expect(r.date).toBe('2026-09-28');
    expect(r.rates.USD).toBe(1.2);
  });

  it('skips malformed entries', () => {
    const xml = ECB_SAMPLE.replace("<Cube currency='JPY' rate='172.35'/>", "<Cube currency='JPY' rate='abc'/><Cube currency='XX' rate='2'/><Cube currency='ZAR' rate='-1'/><Cube currency='EUR' rate='1'/>");
    const r = parseEcbXml(xml);
    expect(r.rates.JPY).toBeUndefined();
    expect(r.rates.XX).toBeUndefined();
    expect(r.rates.ZAR).toBeUndefined();
    expect(r.rates.EUR).toBeUndefined();
  });

  const bad: [string, string][] = [
    ['empty', ''],
    ['not xml', 'hello world'],
    ['html error page', '<html><body><h1>503 Service Unavailable</h1></body></html>'],
    ['no date', "<Envelope><Cube><Cube><Cube currency='USD' rate='1.1'/></Cube></Cube></Envelope>"],
    ['invalid date', ECB_SAMPLE.replace('2026-09-28', '2026-13-45')],
    ['too few rates', "<Envelope><Cube><Cube time='2026-09-28'><Cube currency='USD' rate='1.1'/><Cube currency='GBP' rate='0.8'/></Cube></Cube></Envelope>"],
    ['no USD', ECB_SAMPLE.replace("<Cube currency='USD' rate='1.1702'/>", '')],
  ];
  it.each(bad)('rejects %s', (_name, xml) => {
    expect(() => parseEcbXml(xml)).toThrow(FxParseError);
  });

  it('does not expand entities', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "aaaaaaaaaa">]>${ECB_SAMPLE.replace(/^<\?xml[^>]*>/, '')}`;
    expect(parseEcbXml(xml).rates.USD).toBe(1.1702);
  });
});

describe('staleness and age', () => {
  const now = new Date('2026-09-29T12:00:00Z');
  it.each([
    [null, true],
    [{ fetchedAt: '2026-09-29T06:00:00.000Z' }, false],
    [{ fetchedAt: '2026-09-29T01:00:00.000Z' }, false],
    [{ fetchedAt: '2026-09-28T23:00:00.000Z' }, true],
    [{ fetchedAt: '2026-09-28T20:00:00.000Z' }, true],
    [{ fetchedAt: 'garbage' }, true],
  ] as [{ fetchedAt: string } | null, boolean][])('isFxStale(%j) = %s', (s, stale) => {
    expect(isFxStale(s, now)).toBe(stale);
  });

  it('honours a custom refresh window', () => {
    expect(isFxStale({ fetchedAt: '2026-09-29T11:00:00.000Z' }, now, 0.5)).toBe(true);
  });

  it('reference age in days', () => {
    expect(fxReferenceAgeDays('2026-09-28', now)).toBe(1);
    expect(fxReferenceAgeDays('2026-09-20', now)).toBe(9);
    expect(fxReferenceAgeDays(null, now)).toBeNull();
    expect(fxReferenceAgeDays('bad', now)).toBeNull();
  });
});

describe('rates helpers', () => {
  const fx = { date: '2026-09-28', rates: { USD: 1.2, GBP: 0.85 } };

  it('EUR is the identity', () => {
    expect(lookupRate(fx, 'EUR')).toEqual({ rate: 1, source: 'identity', date: null });
    expect(lookupRate(null, 'eur')).toEqual({ rate: 1, source: 'identity', date: null });
  });

  it('ECB rates carry the reference date', () => {
    expect(lookupRate(fx, 'GBP')).toEqual({ rate: 0.85, source: 'ecb', date: '2026-09-28' });
    expect(lookupRate(fx, 'gbp')?.rate).toBe(0.85);
  });

  it.each(Object.entries(USD_PEGS))('%s is derived from USD', (code, peg) => {
    expect(lookupRate(fx, code)).toEqual({ rate: Math.round(1.2 * peg * 1e6) / 1e6, source: 'usd_peg', date: '2026-09-28' });
    expect(lookupRate({ date: null, rates: {} }, code)).toBeNull();
  });

  it.each(Object.entries(EUR_FIXED_RATES))('%s uses the fixed euro rate', (code, rate) => {
    expect(lookupRate(null, code)).toEqual({ rate, source: 'eur_fixed', date: null });
  });

  it('unknown or invalid rates are null', () => {
    expect(lookupRate(fx, 'TWD')).toBeNull();
    expect(lookupRate({ date: 'x', rates: { SEK: 0 } }, 'SEK')).toBeNull();
    expect(lookupRate({ date: 'x', rates: { SEK: Number.NaN } }, 'SEK')).toBeNull();
  });

  it('toEur', () => {
    expect(toEur(120, 'USD', fx)).toBeCloseTo(100, 6);
    expect(toEur(100, 'EUR', null)).toBe(100);
    expect(toEur(100, 'TWD', fx)).toBeNull();
  });

  it('withDerivedRates adds EUR, fixed rates and pegs', () => {
    const r = withDerivedRates({ usd: 1.2, GBP: 0.85, BAD: -1 });
    expect(r).toMatchObject({ EUR: 1, USD: 1.2, GBP: 0.85, BGN: 1.95583, HRK: 7.5345 });
    expect(r.AED).toBeCloseTo(1.2 * 3.6725, 6);
    expect(r.BAD).toBeUndefined();
    expect(withDerivedRates({}).AED).toBeUndefined();
  });

  it('fxTableFromSetting', () => {
    expect(fxTableFromSetting(null)).toEqual({ date: null, rates: { EUR: 1, BGN: 1.95583, HRK: 7.5345 } });
    const t = fxTableFromSetting({ date: '2026-09-28', rates: { USD: 1.2 } });
    expect(t.date).toBe('2026-09-28');
    expect(t.rates.SAR).toBeCloseTo(4.5, 6);
  });
});
