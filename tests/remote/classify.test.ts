/**
 * Remote eligibility (spec §14): classes from the point of view of someone living in India
 * (UTC+5:30), with exact quotes, confidence and a reason for every decision.
 */
import { describe, expect, it } from 'vitest';
import type { RemoteClass } from '../../src/lib/contracts/jobs';
import type { Confidence } from '../../src/lib/contracts/provenance';
import { normalizeLocation } from '../../src/lib/normalize/location';
import {
  analyzeRemoteText,
  classifyRemote,
  DEFAULT_REMOTE_HOME,
  parseTimezoneConstraints,
  REMOTE_LOGIC_VERSION,
  REMOTE_SOURCE,
  resolvePlacePart,
} from '../../src/lib/remote/classify';

const NOW = new Date('2026-09-30T08:00:00Z');

function run(location: string, text: string, home = DEFAULT_REMOTE_HOME) {
  return classifyRemote(text, normalizeLocation(location), { now: NOW, home });
}

type Case = [location: string, text: string, cls: RemoteClass, regions?: string[], confidence?: Confidence];

function check(cases: Case[]) {
  for (const [location, text, cls, regions, confidence] of cases) {
    it(`${JSON.stringify(location)} + ${JSON.stringify(text.slice(0, 70))} → ${cls}`, () => {
      const f = run(location, text);
      expect(f.value.class, f.value.reason).toBe(cls);
      if (regions) expect(f.value.regions).toEqual(regions);
      if (confidence) expect(f.confidence).toBe(confidence);
      expect(f.value.reason.length).toBeGreaterThan(10);
      // Every quote is an exact substring of the posting text or the (cleaned) location scope.
      const scope = normalizeLocation(location).remoteScopeRaw ?? '';
      for (const q of f.value.quotes) expect(text.includes(q) || scope.includes(q), q).toBe(true);
      expect(f.evidence).toBe(f.value.quotes.length ? f.value.quotes.join(' … ') : null);
    });
  }
}

describe('brief phrases (spec §14)', () => {
  check([
    ['Remote', 'This is a fully remote role. You must be based in the EU.', 'region_limited', ['EU'], 'high'],
    ['Remote', 'Candidates must be based in Germany and have 3 years of experience.', 'region_limited', ['DE'], 'high'],
    ['Remote', 'We have a legal entity in the US, UK and Canada.', 'region_limited', ['US', 'GB', 'CA'], 'medium'],
    ['Remote', 'You must be authorized to work in the United States.', 'region_limited', ['US'], 'high'],
    ['Remote', 'Applicants must be authorised to work in the UK.', 'region_limited', ['GB'], 'high'],
    ['Remote', 'Senior Engineer - US only', 'region_limited', ['US'], 'high'],
    ['Remote', 'EU only. Fully remote.', 'region_limited', ['EU'], 'high'],
    ['Remote', 'You should be within CET ±2 hours.', 'timezone_limited', ['CET ±2h'], 'high'],
    ['Remote', 'Must have 4 hours of overlap with EST.', 'timezone_limited', ['ET overlap 4h'], 'high'],
    ['Remote (Germany)', 'Great team.', 'region_limited', ['DE'], 'high'],
    ['Remote', 'Work from anywhere in the world!', 'worldwide', ['WORLDWIDE'], 'high'],
    ['Remote', 'We are hiring in: \n- Germany\n- Spain\n- Portugal\n\nAbout us', 'region_limited', ['DE', 'ES', 'PT'], 'high'],
    ['Remote', 'We are hiring in: Germany, India, Poland', 'worldwide', ['DE', 'IN', 'PL'], 'high'],
    ['Remote', 'Hiring in: US, Canada, Mexico, Brazil, Argentina', 'region_limited', ['US', 'CA', 'MX', 'BR', 'AR'], 'high'],
    ['Remote', 'Eligible countries:\nIndia\nPhilippines\nVietnam', 'worldwide', ['IN', 'PH', 'VN'], 'high'],
    ['Remote', 'Open to candidates in India and Southeast Asia.', 'worldwide', ['IN', 'ASIA'], 'high'],
    ['Berlin, Germany', 'This position is on-site in our Berlin office.', 'not_remote', [], 'medium'],
  ]);
});

describe('location strings', () => {
  check([
    ['Anywhere', '', 'worldwide', ['WORLDWIDE'], 'high'],
    ['Remote — Worldwide', '', 'worldwide', ['WORLDWIDE'], 'high'],
    ['Remote, India', '', 'worldwide', ['IN'], 'high'],
    ['Remote - APAC', '', 'worldwide', ['APAC'], 'medium'],
    ['Remote (US or Canada)', '', 'region_limited', ['US', 'CA'], 'high'],
    ['Remote (EMEA)', '', 'region_limited', ['EMEA'], 'high'],
    ['Remote (CET)', '', 'timezone_limited', ['CET ±1h'], 'medium'],
    ['Remote (UTC±3)', '', 'timezone_limited', ['UTC ±3h'], 'high'],
    ['Hybrid - Munich', 'Great role.', 'not_remote', [], 'high'],
    ['Berlin, Germany', 'We offer great benefits.', 'not_remote', [], 'medium'],
    ['Munich', 'This role is fully remote within Germany.', 'region_limited', ['DE'], 'high'],
    ['Remote', 'Location: Remote (APAC)', 'worldwide', ['APAC'], 'medium'],
    ['Remote', 'Location: Remote, Europe', 'region_limited', ['EUROPE'], 'high'],
    ['Remote', 'US-Remote', 'region_limited', ['US'], 'high'],
  ]);
});

describe('regions and residency', () => {
  check([
    ['Remote', 'We are a remote-first company with employees in 25 countries. This role is open to candidates based in Europe.', 'region_limited', ['EUROPE']],
    ['Remote', 'The role is remote but you must reside in one of the following countries: Germany, Netherlands, Spain.', 'region_limited', ['DE', 'NL', 'ES']],
    ['Remote', 'Candidates from the EU/EEA only', 'region_limited', ['EU', 'EEA'], 'high'],
    ['Remote', 'Must reside in the US (excluding California)', 'region_limited', ['US'], 'high'],
    ['Remote', "You'll work remotely from Poland.", 'region_limited', ['PL']],
    ['Remote', 'Remote in the Americas.', 'region_limited', ['AMERICAS']],
    ['Remote', 'We welcome applicants from anywhere in Europe.', 'region_limited', ['EUROPE']],
    ['Remote', 'Work from anywhere within the EU.', 'region_limited', ['EU']],
    ['Remote', 'Remote (anywhere in LATAM)', 'region_limited', ['LATAM']],
    ['Remote', 'Must be based in Europe (CET ±2).', 'region_limited', ['EUROPE']],
    ['Remote', 'Remote within Europe. Some overlap with CET working hours is required.', 'region_limited', ['EUROPE']],
    ['Remote', 'Remote within the UK. You must hold the right to work in the UK.', 'region_limited', ['GB'], 'high'],
    ['Remote', 'EU-based only. We hire via Deel.', 'region_limited', ['EU']],
    ['Remote', 'Occasional travel to our on-site events. Must be based in the Netherlands.', 'region_limited', ['NL']],
    ['Remote', 'Must be based in one of our hiring countries.', 'unclear', [], 'medium'],
  ]);
});

describe('exclusions', () => {
  check([
    ['Remote', 'We cannot hire in India or China at this time.', 'region_limited', ['-IN', '-CN'], 'high'],
    ['Remote', 'Open to candidates anywhere except India.', 'region_limited', ['-IN']],
    ['Remote', 'This role is not open to candidates in India.', 'region_limited', ['-IN']],
    ['Remote', 'We are not able to hire in the following countries: India, Pakistan, Russia.', 'region_limited', ['-IN', '-PK', '-RU']],
    ['Remote', 'We are open to hiring anywhere except the US.', 'worldwide', ['WORLDWIDE', '-US']],
    // No entity, but a contractor workaround → not a hard exclusion.
    ['Remote', "We don't have an entity in India so we hire contractors there via Deel.", 'unclear'],
  ]);
});

describe('time zones', () => {
  check([
    ['Remote', 'Must overlap at least 3 hours with Pacific Time.', 'timezone_limited', ['PT overlap 3h'], 'high'],
    ['Remote', 'This role requires 5 hours of overlap with PST.', 'timezone_limited', ['PT overlap 5h'], 'high'],
    ['Remote', 'Must be available during US business hours (EST).', 'timezone_limited', ['ET overlap 8h'], 'medium'],
    ['Remote', 'Must be located within UTC-3 to UTC+3.', 'timezone_limited', ['UTC-3..UTC+3'], 'high'],
    ['Remote', 'Location: Remote; must be in GMT-5 to GMT+1', 'timezone_limited', ['UTC-5..UTC+1'], 'high'],
    ['Remote', 'Timezone: Americas', 'timezone_limited', ['Americas time zones'], 'medium'],
    ['Remote', 'You must be able to work in UK hours.', 'timezone_limited', ['UK time'], 'high'],
    ['Remote', 'Timezone: UTC+3 to UTC+8', 'worldwide', ['UTC+3..UTC+8'], 'medium'],
    ['Remote', 'Candidates in APAC time zones are welcome.', 'worldwide', ['APAC time zones'], 'low'],
    ['Remote', 'We hire globally, but must overlap 4 hours with CET.', 'worldwide', ['WORLDWIDE'], 'medium'],
    ['Remote', 'Core hours 10:00–14:00 CET.', 'unclear', ['CET overlap 4h'], 'medium'],
    // IST is ambiguous (India / Israel / Ireland) → low confidence.
    ['Remote', 'Must work IST hours.', 'worldwide', ['IST ±1h'], 'low'],
    ['Remote', 'You can work from any time zone; we are async.', 'worldwide', ['WORLDWIDE'], 'high'],
    // Descriptive, not a requirement.
    ['Remote', 'Our team works across European time zones.', 'unclear', [], 'low'],
    ['Remote', 'Our HQ is in Berlin (CET).', 'unclear', [], 'low'],
  ]);
});

describe('multilingual', () => {
  check([
    ['Remote', 'Wohnsitz in Deutschland erforderlich.', 'region_limited', ['DE'], 'high'],
    ['Remote', 'Du arbeitest 100% remote aus ganz Deutschland.', 'region_limited', ['DE'], 'high'],
    ['Remote', 'Remote aus Deutschland, Österreich oder der Schweiz.', 'region_limited', ['DE', 'AT', 'CH'], 'high'],
    ['Remote', 'Arbeitserlaubnis für die EU erforderlich.', 'region_limited', ['EU'], 'high'],
    ['Remote', 'Télétravail depuis la France uniquement.', 'region_limited', ['FR'], 'high'],
    ['Remote', '100% remoto desde España.', 'region_limited', ['ES'], 'high'],
    ['Munich', 'Homeoffice möglich, 2 Tage pro Woche im Büro.', 'not_remote', [], 'medium'],
  ]);
});

describe('false positives', () => {
  check([
    ['Remote', 'Remote - Senior Backend Engineer', 'unclear', [], 'low'],
    ['Remote', 'Senior Backend Engineer (Remote)', 'unclear', [], 'low'],
    ['Remote', 'Berlin is the only place where we meet in person once a year.', 'unclear', [], 'low'],
    ['Remote', 'Our customers are based in the US and Europe.', 'unclear', [], 'low'],
    ['Remote', 'You will work with clients in Germany.', 'unclear', [], 'low'],
    ['Remote', 'Our employees are based in 30 countries.', 'unclear', [], 'low'],
    ['Remote', 'If you are based in the UK, you will be employed by our UK entity.', 'unclear', [], 'low'],
    ['Remote', 'Right to work in the UK is a plus.', 'unclear', [], 'low'],
    ['Remote', 'We help you get the right to work in Germany.', 'unclear', [], 'low'],
    ['Remote', "You don't need to be based in Berlin, we are remote-first.", 'unclear', [], 'low'],
    ['', 'We run a hybrid cloud platform on AWS.', 'unclear', [], 'low'],
    ['', 'Remote-friendly company with offices in Berlin.', 'unclear', [], 'low'],
    ['', 'Occasional on-site visits to customers. Remote-friendly.', 'unclear', [], 'low'],
    ['', 'This is a remote role, you can work from anywhere.', 'worldwide', ['WORLDWIDE'], 'medium'],
  ]);
});

describe('workplace', () => {
  it('a hybrid posting is not remote, even with a "work from anywhere" perk', () => {
    const f = run('London', 'This role is based in London. Hybrid working: 2 days per week in the office.');
    expect(f.value.class).toBe('not_remote');
    expect(f.value.workplace).toBe('hybrid');
  });

  it('a remote location contradicted by a hybrid text → unclear, low', () => {
    const f = run('Remote', 'Work from anywhere for up to 4 weeks a year. Hybrid role, 3 days in the office.');
    expect(f.value.class).toBe('unclear');
    expect(f.confidence).toBe('low');
    expect(f.value.reason).toContain('hybrid');
    expect(f.evidence).toBe('Hybrid role, 3 days in the office.');
  });

  it('the "work from anywhere" perk alone is not a worldwide signal', () => {
    const a = analyzeRemoteText('Enjoy 4 weeks of work from anywhere per year.');
    expect(a.worldwide).toHaveLength(0);
  });

  it('empty text and empty location → unclear, low', () => {
    const f = run('', '');
    expect(f.value.class).toBe('unclear');
    expect(f.confidence).toBe('low');
    expect(f.evidence).toBeNull();
  });
});

describe('fact shape', () => {
  it('carries the logic version, source, method and home', () => {
    const f = run('Remote', 'You must be based in the EU.');
    expect(f.logicVersion).toBe(REMOTE_LOGIC_VERSION);
    expect(f.source).toBe(REMOTE_SOURCE);
    expect(f.method).toBe('rule');
    expect(f.checkedAt).toEqual(NOW);
    expect(f.value.home).toBe('IN');
    expect(f.value.workplace).toBe('remote');
    expect(f.evidence).toBe('You must be based in the EU.');
    expect(f.value.reason).toBe('Remote, limited to European Union; India (UTC+5:30) is not included.');
  });

  it('keeps the original characters in quotes (accents, curly quotes)', () => {
    const text = 'Wir suchen dich! Wohnsitz in Österreich erforderlich.';
    const f = run('Remote', text);
    expect(f.value.class).toBe('region_limited');
    expect(f.value.regions).toEqual(['AT']);
    expect(text).toContain(f.evidence!);
    expect(f.evidence).toContain('Österreich');
  });

  it('is deterministic', () => {
    const t = 'Remote within Europe. Must overlap 4 hours with CET. We cannot hire in Russia.';
    expect(run('Remote', t)).toEqual(run('Remote', t));
  });
});

describe('custom home', () => {
  const germany = { countryIso2: 'DE', utcOffset: 1 };

  it('an EU restriction is worldwide for someone in Germany', () => {
    const f = run('Remote', 'You must be based in the EU.', germany);
    expect(f.value.class).toBe('worldwide');
    expect(f.value.home).toBe('DE');
  });

  it('CET ±2 is workable from Germany', () => {
    expect(run('Remote', 'You should be within CET ±2 hours.', germany).value.class).toBe('worldwide');
  });

  it('APAC does not include Germany', () => {
    expect(run('Remote - APAC', '', germany).value.class).toBe('region_limited');
  });

  it('excluding India does not affect Germany', () => {
    expect(run('Remote', 'Open to candidates anywhere except India.', germany).value.class).toBe('worldwide');
  });
});

describe('parseTimezoneConstraints', () => {
  const IN = 5.5;

  it('± tolerance around a zone', () => {
    const [c] = parseTimezoneConstraints('You should be within CET ±2 hours.', IN);
    expect(c).toMatchObject({ lo: 1, hi: 1, pm: 2, overlap: null, satisfiable: false, confidence: 'high', window: true });
  });

  it('+/- written out', () => {
    const [c] = parseTimezoneConstraints('Must work in CET +/- 3 hours', IN);
    expect(c.pm).toBe(3);
    expect(c.satisfiable).toBe(false);
    const [wide] = parseTimezoneConstraints('Must work in CET +/- 5 hours', IN);
    expect(wide.satisfiable).toBe(true);
  });

  it('an offset range', () => {
    const [c] = parseTimezoneConstraints('Must be located within UTC-3 to UTC+3.', IN);
    expect(c).toMatchObject({ lo: -3, hi: 3, label: 'UTC-3..UTC+3', satisfiable: false });
    const [ok] = parseTimezoneConstraints('Timezone: UTC+3 to UTC+8', IN);
    expect(ok.satisfiable).toBe(true);
  });

  it('overlap hours', () => {
    const [c] = parseTimezoneConstraints('Must have 4 hours of overlap with EST.', IN);
    expect(c).toMatchObject({ overlap: 4, pm: 0, satisfiable: false });
    const [cet] = parseTimezoneConstraints('Must overlap 4 hours with CET.', IN);
    expect(cet.satisfiable).toBe(true);
  });

  it('IST is ambiguous → low confidence', () => {
    const [c] = parseTimezoneConstraints('Must work IST hours.', IN);
    expect(c.confidence).toBe('low');
  });

  it('a plain zone in a sentence without a cue or requirement is ignored', () => {
    expect(parseTimezoneConstraints('Our HQ is in Berlin (CET).', IN)).toEqual([]);
  });

  it('"any time zone" is not a constraint', () => {
    expect(parseTimezoneConstraints('You can work from any time zone.', IN)).toEqual([]);
  });

  it('a location string makes a plain zone a constraint', () => {
    const [c] = parseTimezoneConstraints('CET', IN, { fromLocation: true });
    expect(c).toMatchObject({ lo: 1, hi: 1, pm: 1, satisfiable: false });
  });
});

describe('resolvePlacePart', () => {
  it('resolves countries, macro regions and time zones', () => {
    expect(resolvePlacePart('Germany')).toMatchObject({ countries: ['DE'], tz: false });
    expect(resolvePlacePart('the EU')?.macros).toEqual(['EU']);
    expect(resolvePlacePart('CET')?.tz).toBe(true);
    expect(resolvePlacePart('anywhere in LATAM')?.macros).toEqual(['LATAM']);
    expect(resolvePlacePart('great benefits')).toBeNull();
  });
});
