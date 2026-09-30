/**
 * Company page model: sponsor summary + my own note → the confirmed / possible / none class,
 * and register evidence read from the match rows (register name, download date, status).
 */
import { describe, expect, it } from 'vitest';
import {
  parseAgencyNote,
  parseRegisterEvidence,
  parseSponsorNote,
  parseSponsorSummary,
  registerKeyLabel,
  sizeBandOrder,
  sponsorClass,
} from '../../src/components/companies/model';

describe('sponsor class', () => {
  const summary = (status: string) => parseSponsorSummary({ status, sponsorCountries: ['GB'], registers: [{ registerKey: 'uk_home_office', orgName: 'Initech Ltd', matchStatus: 'confirmed', registerVersion: '2026-09-01' }] });

  it('parses the matcher summary leniently', () => {
    expect(summary('confirmed')).toMatchObject({ status: 'confirmed', sponsorCountries: ['GB'], possibleMatches: 0, registers: [{ registerKey: 'uk_home_office', orgName: 'Initech Ltd', countryIso2: null }] });
    expect(parseSponsorSummary({ status: 'maybe' })).toBeNull();
    expect(parseSponsorSummary(null)).toBeNull();
  });

  it('combines register evidence with my own note', () => {
    const yes = { sponsors: true, note: 'Recruiter confirmed' };
    const no = { sponsors: false, note: null };
    expect(sponsorClass(summary('confirmed'), null)).toBe('confirmed');
    expect(sponsorClass(summary('confirmed'), no)).toBe('possible');
    expect(sponsorClass(summary('likely'), null)).toBe('possible');
    expect(sponsorClass(summary('possible'), no)).toBe('none');
    expect(sponsorClass(summary('unknown'), yes)).toBe('confirmed');
    expect(sponsorClass(null, null)).toBe('none');
  });

  it('reads notes in both shapes and ignores other manual notes', () => {
    expect(parseSponsorNote({ field: 'sponsors', sponsors: true, note: ' yes ' })).toEqual({ sponsors: true, note: 'yes' });
    expect(parseSponsorNote({ offered: false, quote: 'We do not sponsor' })).toEqual({ sponsors: false, note: 'We do not sponsor' });
    expect(parseSponsorNote({ field: 'is_agency', isAgency: true })).toBeNull();
    expect(parseAgencyNote({ field: 'is_agency', isAgency: true })).toBe(true);
    expect(parseAgencyNote({ field: 'sponsors', sponsors: true })).toBeNull();
  });
});

describe('register evidence', () => {
  it('reads the match row and falls back to the source column', () => {
    const full = parseRegisterEvidence(
      { registerKey: 'uk_home_office', registerName: 'UK Register of Licensed Sponsors', countryIso2: 'GB', orgName: 'INITECH LTD', town: 'London', route: 'Skilled Worker', rating: 'A rating', registerVersion: '2026-09-01', evidenceKind: 'licensed_sponsor', basis: 'legal_name', countryAgrees: true, autoStatus: 'possible', manualStatus: 'confirmed', entryCount: 2 },
      'uk_home_office@2026-09-01',
    );
    expect(full).toMatchObject({ registerName: 'UK Register of Licensed Sponsors', registerVersion: '2026-09-01', evidenceKind: 'licensed_sponsor', manualStatus: 'confirmed', entryCount: 2 });
    expect(parseRegisterEvidence({}, 'nl_ind@2026-08-15')).toMatchObject({ registerKey: 'nl_ind', registerName: 'NL ind', registerVersion: '2026-08-15', evidenceKind: null });
    expect(parseRegisterEvidence({}, null)).toBeNull();
  });

  it('labels register keys and orders size bands', () => {
    expect(registerKeyLabel('uk_home_office')).toBe('UK home office');
    expect(['1000+', 'weird', '1-50', '251-1000'].sort((a, b) => sizeBandOrder(a) - sizeBandOrder(b))).toEqual(['1-50', '251-1000', '1000+', 'weird']);
  });
});
