import { describe, expect, it } from 'vitest';
import type { FxTable, SalaryPeriod } from '@/lib/contracts/jobs';
import {
  SALARY_LOGIC_VERSION,
  analyzeSalary,
  annualize,
  estimateSalary,
  findSalaryMentions,
  formatSalary,
  inferPeriod,
  normalizePeriodWord,
  parseLocaleNumber,
  parseSalary,
  statedInstallments,
  type SalaryFlag,
} from '@/lib/normalize/salary';
import { SALARY_ESTIMATES, estimateTrackFor } from '@/data/salary/estimates';
import { INSTALLMENTS_BY_COUNTRY, installmentRule } from '@/data/salary/installments';
import { CURRENCIES, AMBIGUOUS_SYMBOLS } from '@/data/salary/currencies';
import { COUNTRIES } from '@/data/places';

const NOW = new Date('2026-09-29T08:00:00Z');
const FX: FxTable = {
  date: '2026-09-28',
  rates: { USD: 1.17, GBP: 0.87, CHF: 0.94, SEK: 11, DKK: 7.46, NOK: 11.7, PLN: 4.27, CZK: 24.4, HUF: 390, RON: 5.08, JPY: 172, CAD: 1.62, AUD: 1.78, NZD: 1.95, SGD: 1.5, HKD: 9.1, INR: 103, BRL: 6.3, MXN: 21.5, ISK: 145, ILS: 4.3, KRW: 1620, MYR: 5, CNY: 8.3 },
};
const EUR_ONLY: FxTable = { date: null, rates: { EUR: 1 } };

const analyze = (text: string, country: string | null = 'DE', fx: FxTable = FX) => analyzeSalary({ text, countryIso2: country }, fx, { now: NOW });

describe('parseLocaleNumber', () => {
  const cases: [string, number | null][] = [
    ['45000', 45000],
    ['45.000', 45000],
    ['45,000', 45000],
    ['45 000', 45000],
    ["45'000", 45000],
    ['1.200.000', 1200000],
    ['1,200,000', 1200000],
    ['1 200 000', 1200000],
    ['45.000,50', 45000.5],
    ['45,000.50', 45000.5],
    ["120'000.00", 120000],
    ['3,5', 3.5],
    ['3.5', 3.5],
    ['85', 85],
    ['4.500', 4500],
    ['45.000.50', null],
    ['45,000,5', null],
    ['1.2345', null],
    ['', null],
    ['abc', null],
  ];
  it.each(cases)('%s → %s', (raw, expected) => {
    expect(parseLocaleNumber(raw)).toBe(expected);
  });
});

type Exp = {
  min: number | null;
  max: number | null;
  currency: string;
  period: SalaryPeriod;
  grossNet?: 'gross' | 'net' | 'unknown';
  installments?: number | null;
  eur?: [number | null, number | null];
  conf?: 'high' | 'medium' | 'low';
  flags?: SalaryFlag[];
  notFlags?: SalaryFlag[];
};

// [text, country, expected]
const TEXT_CASES: [string, string | null, Exp][] = [
  // ── Formats: 45k, 45.000, 45,000, 45 000, 45'000 ──
  ['Salary: €45k - €55k per year', 'DE', { min: 45000, max: 55000, currency: 'EUR', period: 'year', eur: [45000, 55000], conf: 'high' }],
  ['Salary: 45.000 € - 55.000 € per year', 'DE', { min: 45000, max: 55000, currency: 'EUR', period: 'year' }],
  ['Salary: €45,000 - €55,000 per year', 'IE', { min: 45000, max: 55000, currency: 'EUR', period: 'year' }],
  ['Salaire : 45 000 € - 55 000 € brut annuel', 'FR', { min: 45000, max: 55000, currency: 'EUR', period: 'year', grossNet: 'gross', conf: 'high' }],
  ["Lohn: CHF 120'000 - 140'000 pro Jahr", 'CH', { min: 120000, max: 140000, currency: 'CHF', period: 'year', eur: [127660, 148936] }],
  ['Gehalt: 60.000 - 70.000 € brutto/Jahr', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year', grossNet: 'gross', conf: 'high' }],
  ['Gehalt: 60-70.000 € brutto im Jahr', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year', grossNet: 'gross' }],
  ['Salary range: 45 - 55k EUR', 'DE', { min: 45000, max: 55000, currency: 'EUR', period: 'year', flags: ['period_inferred'] }],
  ['Salary: 60k-70k EUR per annum', 'NL', { min: 60000, max: 70000, currency: 'EUR', period: 'year' }],
  ['Jahresgehalt ab 55 TEUR', 'DE', { min: 55000, max: null, currency: 'EUR', period: 'year', flags: ['open_min'] }],
  ['Zielgehalt 60-70 T€ p.a.', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year' }],
  ['45.000,- € brutto p.a.', 'DE', { min: 45000, max: 45000, currency: 'EUR', period: 'year', grossNet: 'gross', conf: 'medium' }],
  ['Salary: 4.500,00 EUR brutto', 'DE', { min: 4500, max: 4500, currency: 'EUR', period: 'month', installments: 12, eur: [54000, 54000], flags: ['period_inferred'] }],
  ['Salary: EUR45k', 'DE', { min: 45000, max: 45000, currency: 'EUR', period: 'year' }],
  ['Compensation: 55 000 EUR/year gross', 'LU', { min: 55000, max: 55000, currency: 'EUR', period: 'year', grossNet: 'gross' }],
  ['Salary: €60,000.00 per annum', 'IE', { min: 60000, max: 60000, currency: 'EUR', period: 'year' }],

  // ── Ranges ──
  ['between $90,000 and $110,000 per year', 'US', { min: 90000, max: 110000, currency: 'USD', period: 'year', eur: [76923, 94017] }],
  ['The salary for this role is between 55.000€ and 65.000€ gross per year depending on experience.', 'ES', { min: 55000, max: 65000, currency: 'EUR', period: 'year', grossNet: 'gross', conf: 'high' }],
  ['Das Gehalt liegt zwischen 60.000 und 75.000 € brutto jährlich', 'DE', { min: 60000, max: 75000, currency: 'EUR', period: 'year', grossNet: 'gross' }],
  ['Salaire entre 50 000 et 60 000 € par an', 'FR', { min: 50000, max: 60000, currency: 'EUR', period: 'year' }],
  ['Salary 50 000 to 60 000 EUR a year', 'FI', { min: 50000, max: 60000, currency: 'EUR', period: 'year' }],
  ['Gehalt 60.000 bis 70.000 EUR pro Jahr', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year' }],
  ['Salaris € 4.000 tot € 5.500 bruto per maand', 'NL', { min: 4000, max: 5500, currency: 'EUR', period: 'month', grossNet: 'gross' }],
  ['Salario de 35.000 a 45.000 € brutos anuales', 'ES', { min: 35000, max: 45000, currency: 'EUR', period: 'year', grossNet: 'gross' }],
  ['Salário: 2.500€ até 3.200€ por mês', 'PT', { min: 2500, max: 3200, currency: 'EUR', period: 'month' }],
  ['Wynagrodzenie: od 15 000 do 20 000 zł brutto miesięcznie', 'PL', { min: 15000, max: 20000, currency: 'PLN', period: 'month', grossNet: 'gross' }],
  ['Lön: 45 000 - 55 000 kr/mån', 'SE', { min: 45000, max: 55000, currency: 'SEK', period: 'month', conf: 'high' }],
  ['Salary: €4,000/month - €5,000/month', 'DE', { min: 4000, max: 5000, currency: 'EUR', period: 'month', notFlags: ['multiple_amounts'] }],
  ['Salary: 70.000 - 60.000 € per year', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year', flags: ['range_inverted'] }],
  ['Salary $60,000 - $180,000 depending on level', 'US', { min: 60000, max: 180000, currency: 'USD', period: 'year', flags: ['range_wide'] }],
  ['Salary: €45,000–€55,000', 'IE', { min: 45000, max: 55000, currency: 'EUR', period: 'year' }],
  ['Salary: €45,000 — €55,000', 'IE', { min: 45000, max: 55000, currency: 'EUR', period: 'year' }],

  // ── Open ranges ──
  ['up to £75k + bonus', 'GB', { min: null, max: 75000, currency: 'GBP', period: 'year', flags: ['open_max'] }],
  ['Salary up to €80,000 per year', 'IE', { min: null, max: 80000, currency: 'EUR', period: 'year', flags: ['open_max'] }],
  ['Gehalt bis zu 75.000 € brutto/Jahr', 'DE', { min: null, max: 75000, currency: 'EUR', period: 'year', flags: ['open_max'] }],
  ['ab 60.000 € brutto im Jahr', 'DE', { min: 60000, max: null, currency: 'EUR', period: 'year', flags: ['open_min'] }],
  ['Salary from €55,000 per year', 'IE', { min: 55000, max: null, currency: 'EUR', period: 'year', flags: ['open_min'] }],
  ['Rémunération à partir de 45 000 € brut annuel', 'FR', { min: 45000, max: null, currency: 'EUR', period: 'year', flags: ['open_min'] }],
  ['Salario desde 30.000 € brutos anuales', 'ES', { min: 30000, max: null, currency: 'EUR', period: 'year', flags: ['open_min'] }],
  ['RAL a partire da 35.000 €', 'IT', { min: 35000, max: null, currency: 'EUR', period: 'year', flags: ['open_min'] }],
  ['Salaris vanaf € 4.000 bruto per maand', 'NL', { min: 4000, max: null, currency: 'EUR', period: 'month', flags: ['open_min'] }],
  ['Wynagrodzenie do 25 000 zł brutto miesięcznie', 'PL', { min: null, max: 25000, currency: 'PLN', period: 'month', flags: ['open_max'] }],
  ['Das Mindestgehalt für diese Position beträgt € 3.500 brutto/Monat (14x), Bereitschaft zur Überzahlung.', 'AT', { min: 3500, max: null, currency: 'EUR', period: 'month', installments: 14, eur: [49000, null], flags: ['open_min', 'installments_stated'] }],

  // ── Periods incl. local words ──
  ['Gehalt: 5.500 € brutto monatlich', 'DE', { min: 5500, max: 5500, currency: 'EUR', period: 'month', installments: 12, eur: [66000, 66000] }],
  ['Salaire : 3 500 € brut mensuel', 'FR', { min: 3500, max: 3500, currency: 'EUR', period: 'month', installments: 12 }],
  ['Retribuzione: 1.800 - 2.200 € netti mensili', 'IT', { min: 1800, max: 2200, currency: 'EUR', period: 'month', grossNet: 'net', installments: 13, flags: ['net_amount', 'installments_customary'] }],
  ['Salário: 2.500€ - 3.200€ por mês', 'PT', { min: 2500, max: 3200, currency: 'EUR', period: 'month', installments: 14, eur: [35000, 44800], flags: ['installments_customary'] }],
  ['Salario: 2.800 € al mes', 'ES', { min: 2800, max: 2800, currency: 'EUR', period: 'month', installments: 12 }],
  ['Palkka: 4 500 - 5 500 € / kk', 'FI', { min: 4500, max: 5500, currency: 'EUR', period: 'month' }],
  ['Løn: 55.000 kr./md.', 'DK', { min: 55000, max: 55000, currency: 'DKK', period: 'month', eur: [88472, 88472] }],
  ['Lønn: 700 000 - 850 000 NOK per år', 'NO', { min: 700000, max: 850000, currency: 'NOK', period: 'year', eur: [59829, 72650] }],
  ['Salary: 50 000 kr per månad', 'SE', { min: 50000, max: 50000, currency: 'SEK', period: 'month' }],
  ['Mzda: 80 000 - 100 000 Kč měsíčně', 'CZ', { min: 80000, max: 100000, currency: 'CZK', period: 'month' }],
  ['Fizetés: bruttó 900 000 - 1 200 000 Ft / hó', 'HU', { min: 900000, max: 1200000, currency: 'HUF', period: 'month', grossNet: 'gross' }],
  ['We offer a salary of 3.000 - 3.800 EUR brutto/luna', 'RO', { min: 3000, max: 3800, currency: 'EUR', period: 'month', grossNet: 'gross' }],
  ['Day rate: €600/day', 'DE', { min: 600, max: 600, currency: 'EUR', period: 'day', eur: [132000, 132000] }],
  ['TJM : 550 € / jour', 'FR', { min: 550, max: 550, currency: 'EUR', period: 'day' }],
  ['£500 per day outside IR35', 'GB', { min: 500, max: 500, currency: 'GBP', period: 'day' }],
  ['Tagessatz: 700 € pro Tag', 'DE', { min: 700, max: 700, currency: 'EUR', period: 'day' }],
  ['€85 per hour', 'NL', { min: 85, max: 85, currency: 'EUR', period: 'hour', eur: [149600, 149600], conf: 'medium' }],
  ['Pay: $60 - $80 per hour', 'US', { min: 60, max: 80, currency: 'USD', period: 'hour' }],
  ['Stundensatz: 90 € die Stunde', 'DE', { min: 90, max: 90, currency: 'EUR', period: 'hour' }],
  ['Stawka: 150 - 180 zł/h netto (B2B)', 'PL', { min: 150, max: 180, currency: 'PLN', period: 'hour' }],
  ['Uurtarief: € 75 per uur', 'NL', { min: 75, max: 75, currency: 'EUR', period: 'hour' }],
  ['RAL 35.000 - 42.000 €', 'IT', { min: 35000, max: 42000, currency: 'EUR', period: 'year', grossNet: 'gross', conf: 'high' }],
  ['年収 600万円〜900万円', 'JP', { min: 6000000, max: 9000000, currency: 'JPY', period: 'year' }],
  ['Salary 12 LPA', 'IN', { min: 1200000, max: 1200000, currency: 'INR', period: 'year' }],

  // ── Gross / net / B2B ──
  ['Salary: €4,000 net per month', 'IE', { min: 4000, max: 4000, currency: 'EUR', period: 'month', grossNet: 'net', flags: ['net_amount'] }],
  ['Gehalt: 3.200 € netto im Monat', 'DE', { min: 3200, max: 3200, currency: 'EUR', period: 'month', grossNet: 'net' }],
  ['Salary: 12 000 - 15 000 RON net', 'RO', { min: 12000, max: 15000, currency: 'RON', period: 'month', grossNet: 'net' }],
  ['B2B: 18 000 - 24 000 PLN netto + VAT', 'PL', { min: 18000, max: 24000, currency: 'PLN', period: 'month', grossNet: 'unknown', flags: ['b2b_invoice'], notFlags: ['net_amount'] }],
  ['Wynagrodzenie: 15 000 - 20 000 zł brutto (UoP) lub 18 000 - 24 000 zł netto + VAT (B2B)', 'PL', { min: 15000, max: 20000, currency: 'PLN', period: 'month', grossNet: 'gross', notFlags: ['b2b_invoice', 'multiple_amounts'] }],
  ['UoP: 15 000 - 20 000 zł brutto, B2B: 18 000 - 24 000 zł netto + VAT', 'PL', { min: 15000, max: 20000, currency: 'PLN', period: 'month', grossNet: 'gross', notFlags: ['b2b_invoice'] }],
  ['Compensation: $150,000 - $180,000 USD. We use .NET and C#.', 'US', { min: 150000, max: 180000, currency: 'USD', period: 'year', grossNet: 'unknown' }],

  // ── Currencies ──
  ['Salary: $120k-$150k', 'CA', { min: 120000, max: 150000, currency: 'CAD', period: 'year' }],
  ['Salary: $120k-$150k', 'AU', { min: 120000, max: 150000, currency: 'AUD', period: 'year' }],
  ['Salary: $120k-$150k', 'US', { min: 120000, max: 150000, currency: 'USD', period: 'year', notFlags: ['currency_ambiguous'] }],
  ['Salary: $120k-$150k', 'DE', { min: 120000, max: 150000, currency: 'USD', period: 'year', flags: ['currency_ambiguous'] }],
  ['Salary: US$120,000', 'SG', { min: 120000, max: 120000, currency: 'USD', period: 'year' }],
  ['Salary: S$96,000 per annum', 'SG', { min: 96000, max: 96000, currency: 'SGD', period: 'year' }],
  ['Salary: NZ$110,000', 'NZ', { min: 110000, max: 110000, currency: 'NZD', period: 'year' }],
  ['Salary: £55,000 - £65,000', 'GB', { min: 55000, max: 65000, currency: 'GBP', period: 'year', eur: [63218, 74713] }],
  ['Salary: 55,000 GBP', 'GB', { min: 55000, max: 55000, currency: 'GBP', period: 'year' }],
  ['Lohn: 110.000 Franken im Jahr', 'CH', { min: 110000, max: 110000, currency: 'CHF', period: 'year' }],
  ['Lön: 50 000 SEK/mån', 'SE', { min: 50000, max: 50000, currency: 'SEK', period: 'month' }],
  ['Løn: 50.000 kr. om måneden', 'DK', { min: 50000, max: 50000, currency: 'DKK', period: 'month' }],
  ['Lønn: 60 000 kr per måned', 'NO', { min: 60000, max: 60000, currency: 'NOK', period: 'month' }],
  ['Mzda 90 000 CZK měsíčně', 'CZ', { min: 90000, max: 90000, currency: 'CZK', period: 'month' }],
  ['Salariu: 15.000 lei net pe lună', 'RO', { min: 15000, max: 15000, currency: 'RON', period: 'month', grossNet: 'net' }],
  ['Salary: AED 25,000 per month', 'AE', { min: 25000, max: 25000, currency: 'AED', period: 'month', flags: ['fx_peg'], eur: [69819, 69819] }],
  ['Salary: 25 000 SAR monthly', 'SA', { min: 25000, max: 25000, currency: 'SAR', period: 'month', flags: ['fx_peg'], eur: [68376, 68376] }],
  ['Salary: QAR 20,000 per month', 'QA', { min: 20000, max: 20000, currency: 'QAR', period: 'month', flags: ['fx_peg'] }],
  ['Salary: R$ 12.000 por mês', 'BR', { min: 12000, max: 12000, currency: 'BRL', period: 'month' }],
  ['Salary: RM 12,000 per month', 'MY', { min: 12000, max: 12000, currency: 'MYR', period: 'month' }],
  ['Salary NT$1,200,000 - 1,800,000', 'TW', { min: 1200000, max: 1800000, currency: 'TWD', period: 'year', eur: [null, null], flags: ['fx_missing'] }],
  ['Salary: 30.000 лв годишно', 'BG', { min: 30000, max: 30000, currency: 'BGN', period: 'year', eur: [15339, 15339] }],
  ['Gehalt 60.000 - 70.000 brutto', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year', conf: 'low', flags: ['currency_inferred'] }],
  ['Salary: 800 000 - 1 000 000 Ft havi bruttó', 'HU', { min: 800000, max: 1000000, currency: 'HUF', period: 'month' }],

  // ── Installments ──
  ['Gehalt: 5.500 € brutto monatlich, 13. Monatsgehalt', 'DE', { min: 5500, max: 5500, currency: 'EUR', period: 'month', installments: 13, eur: [71500, 71500], flags: ['installments_stated'] }],
  ['Jahresgehalt: 14 Gehälter à 3.800 € brutto/Monat', 'AT', { min: 3800, max: 3800, currency: 'EUR', period: 'month', installments: 14, eur: [53200, 53200] }],
  ['Retribuzione 2.500 € lordi mensili per 14 mensilità', 'IT', { min: 2500, max: 2500, currency: 'EUR', period: 'month', installments: 14, flags: ['installments_stated'] }],
  ['Salario: 2.500 € brutos al mes en 14 pagas', 'ES', { min: 2500, max: 2500, currency: 'EUR', period: 'month', installments: 14 }],
  ['Salario: 2.500 € brutos al mes', 'ES', { min: 2500, max: 2500, currency: 'EUR', period: 'month', installments: 12, notFlags: ['installments_customary'] }],
  ['Salaire : 4 000 € brut mensuel sur 13 mois', 'FR', { min: 4000, max: 4000, currency: 'EUR', period: 'month', installments: 13 }],
  ['Salaris € 4.000 - € 5.500 bruto per maand', 'NL', { min: 4000, max: 5500, currency: 'EUR', period: 'month', installments: 12.96, eur: [51840, 71280], flags: ['installments_customary'] }],
  ['Salaris € 4.000 - € 5.500 bruto per maand incl. vakantiegeld', 'NL', { min: 4000, max: 5500, currency: 'EUR', period: 'month', installments: 12, eur: [48000, 66000] }],
  ['Salaire : 3 800 € brut par mois', 'BE', { min: 3800, max: 3800, currency: 'EUR', period: 'month', installments: 13.92 }],
  ['Μισθός 2.000 € μικτά το μήνα / Salary €2,000 per month', 'GR', { min: 2000, max: 2000, currency: 'EUR', period: 'month', installments: 14 }],
  ['Monatsgehalt: 4.500 € brutto', 'AT', { min: 4500, max: 4500, currency: 'EUR', period: 'month', installments: 14, eur: [63000, 63000] }],
  ['Salary: 4.500 € x 14', 'AT', { min: 4500, max: 4500, currency: 'EUR', period: 'month', installments: 14 }],
  ['Salary: €60,000 per year, paid in 14 instalments', 'PT', { min: 60000, max: 60000, currency: 'EUR', period: 'year', installments: 14, eur: [60000, 60000] }],

  // ── Sanity corrections ──
  ['Salary €60,000 per month', 'DE', { min: 60000, max: 60000, currency: 'EUR', period: 'year', conf: 'low', flags: ['period_corrected'] }],
  ['Salary: €2,500 per year', 'DE', { min: 2500, max: 2500, currency: 'EUR', period: 'month', conf: 'low', flags: ['period_corrected'] }],
  ['Salary: €45,000 per hour', 'DE', { min: 45000, max: 45000, currency: 'EUR', period: 'year', flags: ['period_corrected'] }],

  // ── Several amounts ──
  ['Salary: €4,000 - €5,000 per month (€48,000 - €60,000 per year)', 'DE', { min: 48000, max: 60000, currency: 'EUR', period: 'year', notFlags: ['multiple_amounts'] }],
  ['OTE €90k (base €60k)', 'IE', { min: 60000, max: 60000, currency: 'EUR', period: 'year', notFlags: ['multiple_amounts'] }],
  ['Salary: €60,000 + €5,000 signing bonus', 'IE', { min: 60000, max: 60000, currency: 'EUR', period: 'year', notFlags: ['multiple_amounts'] }],
  ['Salary: €60,000 plus pension and health insurance', 'IE', { min: 60000, max: 60000, currency: 'EUR', period: 'year' }],
  ['We raised €50M in funding. Salary 60-70k EUR.', 'DE', { min: 60000, max: 70000, currency: 'EUR', period: 'year' }],
  ['Junior: €45,000 per year. Senior: €75,000 per year.', 'IE', { min: 45000, max: 45000, currency: 'EUR', period: 'year', conf: 'low', flags: ['multiple_amounts'] }],
  ['Base salary $150,000–$180,000 + equity', 'US', { min: 150000, max: 180000, currency: 'USD', period: 'year' }],
];

describe('parseSalary — stated amounts in text', () => {
  it.each(TEXT_CASES)('%s [%s]', (text, country, exp) => {
    const r = analyze(text, country);
    expect(r, text).not.toBeNull();
    const v = r!.fact.value;
    expect({ min: v.min, max: v.max, currency: v.currency, period: v.period }).toEqual({ min: exp.min, max: exp.max, currency: exp.currency, period: exp.period });
    expect(v.kind).toBe('stated');
    expect(r!.fact.method).toBe('rule');
    expect(r!.fact.source).toBe('posting text');
    expect(r!.fact.logicVersion).toBe(SALARY_LOGIC_VERSION);
    expect(r!.fact.evidence && text.includes(r!.fact.evidence.slice(0, 12))).toBe(true);
    if (exp.grossNet) expect(v.grossNet).toBe(exp.grossNet);
    if (exp.installments !== undefined) expect(v.installments).toBe(exp.installments);
    if (exp.eur) expect([v.annualEurMin, v.annualEurMax]).toEqual(exp.eur);
    if (exp.conf) expect(r!.fact.confidence).toBe(exp.conf);
    for (const f of exp.flags ?? []) expect(r!.flags, `${text} flags`).toContain(f);
    for (const f of exp.notFlags ?? []) expect(r!.flags, `${text} flags`).not.toContain(f);
  });
});

// Texts that contain numbers or money but no salary.
const NO_SALARY: [string, string | null][] = [
  ['Company founded in 2010 with 500 employees and €20M revenue.', 'DE'],
  ['We raised €50M in Series B funding last year.', 'DE'],
  ['30 days of vacation, €1,000 annual training budget', 'DE'],
  ['Learning budget of €1,500 per year', 'DE'],
  ['€500 home office budget and a €50 monthly gym allowance', 'DE'],
  ['Jobticket (Deutschlandticket) and €40 Essenszuschuss per month', 'DE'],
  ['Annual bonus of up to €10,000', 'IE'],
  ['€2,000 relocation package', 'NL'],
  ['Referral bonus: €3,000', 'DE'],
  ['We manage €2bn assets under management', 'LU'],
  ['Salary review in 2025', 'DE'],
  ['Salary: 45000', 'DE'],
  ['kr 50 000', null],
  ['3-5 years of experience with AWS, ISO 27001 and SOC 2', 'DE'],
  ['We have 12 000 customers in 40 countries', 'DE'],
  ['Office at Hauptstraße 120, 10115 Berlin', 'DE'],
  ['Call +49 30 123 456 78', 'DE'],
  ['We process 1,000,000 events per day', 'DE'],
  ['B2B SaaS for 2,000 clients', 'PL'],
  ['Deadline: 31.12.2026', 'DE'],
  ['Our ARR grew to $30M', 'US'],
  ['Kubernetes 1.29, Node 20, Next.js 14', 'DE'],
  ['30 Tage Urlaub, 40 Stunden pro Woche', 'DE'],
  ['€30 meal vouchers every day', 'BE'],
  ['Win a €5,000 prize at our hackathon', 'DE'],
  ['', 'DE'],
];

describe('parseSalary — no salary stated', () => {
  it.each(NO_SALARY)('%s', (text, country) => {
    expect(parseSalary({ text, countryIso2: country }, FX, { now: NOW })).toBeNull();
  });
});

describe('structured hints (connector data)', () => {
  it('uses the hint with method posting and high confidence', () => {
    const f = parseSalary({ hint: { min: 50000, max: 60000, currency: 'EUR', period: 'YEAR' }, text: '', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(f.value).toMatchObject({ min: 50000, max: 60000, currency: 'EUR', period: 'year', annualEurMin: 50000, annualEurMax: 60000, kind: 'stated' });
    expect(f.method).toBe('posting');
    expect(f.source).toBe('posting data');
    expect(f.confidence).toBe('high');
    expect(f.evidence).toBe('50,000–60,000 EUR per year');
  });

  const periods: [string, SalaryPeriod | 'week' | null][] = [
    ['YEAR', 'year'], ['yearly', 'year'], ['annual', 'year'], ['per_annum', 'year'], ['p.a.', 'year'], ['Jahr', 'year'],
    ['MONTH', 'month'], ['monthly', 'month'], ['per-month', 'month'], ['Monat', 'month'], ['mois', 'month'],
    ['week', 'week'], ['WEEKLY', 'week'], ['day', 'day'], ['DAILY', 'day'], ['hour', 'hour'], ['HOURLY', 'hour'], ['hr', 'hour'],
    ['', null], ['sometimes', null], [null as unknown as string, null],
  ];
  it.each(periods)('normalizePeriodWord(%s) = %s', (raw, expected) => {
    expect(normalizePeriodWord(raw)).toBe(expected);
  });

  it('converts weekly hints to a year', () => {
    const r = analyzeSalary({ hint: { min: 1000, max: 1200, currency: 'GBP', period: 'week' }, text: '', countryIso2: 'GB' }, FX, { now: NOW })!;
    expect(r.fact.value).toMatchObject({ min: 52000, max: 62400, period: 'year', currency: 'GBP' });
    expect(r.flags).toContain('period_from_week');
  });

  it('resolves hint currency symbols by country and infers the period', () => {
    const r = analyzeSalary({ hint: { min: 120000, max: 150000, currency: '$' }, text: '', countryIso2: 'CA' }, FX, { now: NOW })!;
    expect(r.fact.value.currency).toBe('CAD');
    expect(r.fact.value.period).toBe('year');
    expect(r.flags).toContain('period_inferred');
    expect(r.fact.confidence).toBe('medium');
  });

  it('falls back to the country currency when the hint has none', () => {
    const r = analyzeSalary({ hint: { min: 60000, max: 70000, period: 'year' }, text: '', countryIso2: 'NL' }, FX, { now: NOW })!;
    expect(r.fact.value.currency).toBe('EUR');
    expect(r.flags).toContain('currency_inferred');
  });

  it('parses the raw hint string when min/max are missing', () => {
    const f = parseSalary({ hint: { raw: '$120K - $150K a year' }, text: '', countryIso2: 'US' }, FX, { now: NOW })!;
    expect(f.value).toMatchObject({ min: 120000, max: 150000, currency: 'USD', period: 'year' });
    expect(f.method).toBe('posting');
    expect(f.evidence).toBe('$120K - $150K a year');
  });

  it('takes the currency and period from the raw string when the numbers are structured', () => {
    const f = parseSalary({ hint: { min: 4000, max: 5000, raw: '€4,000 - €5,000 per month' }, text: '', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(f.value).toMatchObject({ currency: 'EUR', period: 'month', annualEurMin: 48000, annualEurMax: 60000 });
  });

  it('flags a disagreement between the hint and the posting text', () => {
    const r = analyzeSalary({ hint: { min: 50000, max: 60000, currency: 'EUR', period: 'year' }, text: 'Salary: €80,000 - €90,000 per year', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(r.flags).toContain('hint_text_mismatch');
    expect(r.fact.confidence).toBe('medium');
    expect(r.fact.value.min).toBe(50000);
  });

  it('does not flag agreement', () => {
    const r = analyzeSalary({ hint: { min: 50000, max: 60000, currency: 'EUR', period: 'year' }, text: 'Salary: €50,000 - €60,000 per year', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(r.flags).not.toContain('hint_text_mismatch');
  });

  it('swaps an inverted hint range and ignores non-positive numbers', () => {
    const r = analyzeSalary({ hint: { min: 70000, max: 60000, currency: 'EUR', period: 'year' }, text: '', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(r.fact.value).toMatchObject({ min: 60000, max: 70000 });
    expect(r.flags).toContain('range_inverted');
    expect(parseSalary({ hint: { min: 0, max: -5, currency: 'EUR' }, text: '', countryIso2: 'DE' }, FX)).toBeNull();
  });

  it('treats an open hint (only max) as up-to', () => {
    const r = analyzeSalary({ hint: { max: 90000, currency: 'EUR', period: 'year' }, text: '', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(r.fact.value).toMatchObject({ min: null, max: 90000, annualEurMin: null, annualEurMax: 90000 });
    expect(r.flags).toContain('open_max');
  });

  it('applies stated installments from the posting text to monthly hints', () => {
    const r = analyzeSalary({ hint: { min: 3500, max: 3500, currency: 'EUR', period: 'month' }, text: 'Wir zahlen 14 Gehälter.', countryIso2: 'DE' }, FX, { now: NOW })!;
    expect(r.fact.value.installments).toBe(14);
    expect(r.fact.value.annualEurMin).toBe(49000);
    expect(r.installmentsLabel).toMatch(/14 payments/);
  });

  it('prefers the hint over the text', () => {
    const f = parseSalary({ hint: { min: 50000, max: 60000, currency: 'EUR', period: 'year' }, text: 'Salary €50k-€60k', countryIso2: 'DE' }, FX)!;
    expect(f.method).toBe('posting');
  });
});

describe('FX conversion', () => {
  it('stores the rate and its ECB date', () => {
    const v = parseSalary({ text: 'Salary: £55,000 per year', countryIso2: 'GB' }, FX)!.value;
    expect(v.fxRate).toBe(0.87);
    expect(v.fxDate).toBe('2026-09-28');
    expect(v.annualEurMin).toBe(Math.round(55000 / 0.87));
  });

  it('EUR needs no rate or date', () => {
    const v = parseSalary({ text: 'Salary: €55,000 per year', countryIso2: 'DE' }, EUR_ONLY)!.value;
    expect(v).toMatchObject({ fxRate: 1, fxDate: null, annualEurMin: 55000 });
  });

  it('leaves EUR values null when no rate exists', () => {
    const r = analyze('Salary: £55,000 per year', 'GB', EUR_ONLY)!;
    expect(r.fact.value).toMatchObject({ currency: 'GBP', min: 55000, annualEurMin: null, annualEurMax: null, fxRate: null, fxDate: null });
    expect(r.flags).toContain('fx_missing');
  });

  it('derives Gulf pegs from the USD rate', () => {
    const v = parseSalary({ text: 'Salary: AED 300,000 per year', countryIso2: 'AE' }, FX)!.value;
    expect(v.fxRate).toBeCloseTo(1.17 * 3.6725, 6);
    expect(v.fxDate).toBe('2026-09-28');
    expect(parseSalary({ text: 'Salary: AED 300,000 per year', countryIso2: 'AE' }, EUR_ONLY)!.value.annualEurMin).toBeNull();
  });

  it('converts BGN at the fixed euro rate', () => {
    const v = parseSalary({ text: 'Salary: 60 000 BGN per year', countryIso2: 'BG' }, EUR_ONLY)!.value;
    expect(v).toMatchObject({ fxRate: 1.95583, fxDate: null, annualEurMin: Math.round(60000 / 1.95583) });
  });
});

describe('helpers', () => {
  it('annualize', () => {
    expect(annualize(5000, 'month')).toBe(60000);
    expect(annualize(5000, 'month', 14)).toBe(70000);
    expect(annualize(600, 'day')).toBe(132000);
    expect(annualize(80, 'hour')).toBe(140800);
    expect(annualize(60000, 'year', 14)).toBe(60000);
  });

  it.each([
    [60000, 'year'], [12000, 'year'], [5000, 'month'], [800, 'month'], [500, 'day'], [60, 'hour'], [2, null], [5_000_000, null],
  ] as [number, SalaryPeriod | null][])('inferPeriod(%s) = %s', (eur, p) => {
    expect(inferPeriod(eur)).toBe(p);
  });

  it.each([
    ['Wir zahlen 14 Gehälter', 14],
    ['14 Monatsgehälter', 14],
    ['13 mensilità', 13],
    ['14 mensilità', 14],
    ['14 pagas', 14],
    ['Salary paid in 13 instalments', 13],
    ['3.500 € brutto (14x)', 14],
    ['€3,500 x 14', 14],
    ['14 x 3.500 €', 14],
    ['13th month salary', 13],
    ['13. Monatsgehalt', 13],
    ['tredicesima e quattordicesima', 14],
    ['treizième mois', 13],
    ['13e mois', 13],
    ['12 salaries a year', 12],
    ['16x faster builds', null],
    ['2x 12 GB RAM', null],
    ['We have 14 offices', null],
    ['', null],
  ] as [string, number | null][])('statedInstallments(%s) = %s', (text, n) => {
    expect(statedInstallments(text)).toBe(n);
  });

  it('formatSalary', () => {
    expect(formatSalary({ min: 45000, max: 55000, currency: 'EUR', period: 'year' })).toBe('45,000–55,000 EUR per year');
    expect(formatSalary({ min: 45000, max: null, currency: 'EUR', period: 'year' })).toBe('from 45,000 EUR per year');
    expect(formatSalary({ min: null, max: 45000, currency: 'EUR', period: 'month' })).toBe('up to 45,000 EUR per month');
    expect(formatSalary({ min: 600, max: 600, currency: 'GBP', period: 'day' })).toBe('600 GBP per day');
  });

  it('findSalaryMentions exposes context', () => {
    const ms = findSalaryMentions('Gehalt: 60.000 - 70.000 € brutto/Jahr', 'DE');
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ min: 60000, max: 70000, currency: 'EUR', period: 'year', grossNet: 'gross', keyword: true });
  });

  it('does not treat digits inside words as amounts', () => {
    const ms = findSalaryMentions('B2B contract, ISO27001, AWS S3', 'PL');
    expect(ms).toHaveLength(0);
  });

  it('handles non-breaking and thin spaces', () => {
    const f = parseSalary({ text: 'Salaire : 45 000 € brut annuel', countryIso2: 'FR' }, FX)!;
    expect(f.value).toMatchObject({ min: 45000, max: 45000, period: 'year' });
  });

  it('is fast on long postings', () => {
    const text = `${'We build secure cloud platforms with 3 teams and 25 engineers. '.repeat(900)}Salary: €60,000 - €70,000 per year.`;
    const t0 = performance.now();
    const f = parseSalary({ text, countryIso2: 'DE' }, FX);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(f?.value.min).toBe(60000);
  });
});

describe('estimateSalary', () => {
  it('returns an estimated, low-confidence range for security roles', () => {
    const f = estimateSalary('DE', 'cloud_security_engineer', FX, { now: NOW })!;
    expect(f.value).toMatchObject({ min: 58000, max: 75000, currency: 'EUR', period: 'year', grossNet: 'gross', kind: 'estimated', installments: null, annualEurMin: 58000 });
    expect(f.method).toBe('estimate');
    expect(f.confidence).toBe('low');
    expect(f.evidence).toContain('Germany');
    expect(f.evidence).toContain('security');
    expect(f.checkedAt).toEqual(NOW);
  });

  it('uses the development column for developer roles and the generic note otherwise', () => {
    expect(estimateSalary('DE', 'node_developer', FX)!.value.min).toBe(SALARY_ESTIMATES.DE.development[0]);
    const generic = estimateSalary('SE', 'other', FX)!;
    expect(generic.value.min).toBe(SALARY_ESTIMATES.SE.development[0]);
    expect(generic.evidence).toContain('no role-specific figure');
    expect(generic.value.annualEurMin).toBe(Math.round(SALARY_ESTIMATES.SE.development[0] / 11));
    expect(estimateSalary('SE', null, FX)).not.toBeNull();
  });

  it('returns null for countries without data', () => {
    expect(estimateSalary('ZZ', 'cloud_security_engineer', FX)).toBeNull();
    expect(estimateSalary(null, 'cloud_security_engineer', FX)).toBeNull();
  });

  it('accepts an override table', () => {
    const f = estimateSalary('DE', 'appsec_engineer', FX, { table: { DE: { currency: 'EUR', security: [1, 2], development: [3, 4] } } })!;
    expect(f.value.min).toBe(1);
  });

  it('leaves EUR values null without a rate', () => {
    expect(estimateSalary('GB', 'appsec_engineer', EUR_ONLY)!.value.annualEurMin).toBeNull();
  });

  it.each(Object.keys(SALARY_ESTIMATES))('%s estimate is sane', (iso) => {
    const row = SALARY_ESTIMATES[iso];
    const country = COUNTRIES.find((c) => c.iso2 === iso);
    expect(country, iso).toBeDefined();
    expect(row.currency).toBe(country!.currency);
    for (const [lo, hi] of [row.security, row.development]) {
      expect(lo).toBeGreaterThan(0);
      expect(hi).toBeGreaterThan(lo);
    }
    const f = estimateSalary(iso, 'cloud_security_engineer', FX);
    if (f?.value.annualEurMin != null) {
      expect(f.value.annualEurMin).toBeGreaterThan(8000);
      expect(f.value.annualEurMax!).toBeLessThan(250000);
    }
  });

  it('covers every target country', () => {
    for (const c of COUNTRIES.filter((x) => x.tier !== null)) expect(SALARY_ESTIMATES[c.iso2], c.iso2).toBeDefined();
  });

  it('maps role keys to tracks', () => {
    expect(estimateTrackFor('devsecops_engineer')).toBe('security');
    expect(estimateTrackFor('other_security')).toBe('security');
    expect(estimateTrackFor('nextjs_developer')).toBe('development');
    expect(estimateTrackFor('other')).toBeNull();
    expect(estimateTrackFor(null)).toBeNull();
  });
});

describe('salary data', () => {
  it('currency codes are unique ISO codes', () => {
    const codes = CURRENCIES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const c of codes) expect(c).toMatch(/^[A-Z]{3}$/);
  });

  it('every country currency is known to the parser', () => {
    const known = new Set(CURRENCIES.map((c) => c.code));
    for (const c of COUNTRIES.filter((x) => x.tier !== null)) expect(known.has(c.currency), `${c.iso2} ${c.currency}`).toBe(true);
  });

  it('ambiguous symbols resolve to known currencies', () => {
    const known = new Set(CURRENCIES.map((c) => c.code));
    for (const [sym, a] of Object.entries(AMBIGUOUS_SYMBOLS)) {
      for (const code of Object.values(a.byCountry)) expect(known.has(code), sym).toBe(true);
      if (a.fallback) expect(known.has(a.fallback), sym).toBe(true);
    }
  });

  it('installment rules are labelled and only above 12', () => {
    for (const [iso, r] of Object.entries(INSTALLMENTS_BY_COUNTRY)) {
      expect(r.count, iso).toBeGreaterThan(12);
      expect(r.label).toMatch(/payments/);
    }
    expect(installmentRule('at')?.count).toBe(14);
    expect(installmentRule('DE')).toBeNull();
    expect(installmentRule(null)).toBeNull();
  });
});
