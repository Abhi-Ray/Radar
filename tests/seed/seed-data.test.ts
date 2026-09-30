/**
 * The seed data itself (pure): every row is well-formed, consistent and honest about what was
 * (not) verified.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { RESUME_TRACKS, TEMPLATE_KINDS } from '../../src/db/schema/_enums';
import { SEED_COMPANIES, companyBoardSlug, companySource } from '../../src/data/seed/companies';
import { SEED_COUNTRIES, SEED_COUNTRY_CODES } from '../../src/data/seed/countries';
import { FORBIDDEN_PLATFORM_KEYS, SEED_PLATFORMS, SEED_SOURCES, TERMS_REVIEW_PREFIX } from '../../src/data/seed/sources';
import { SEED_RESUME_VERSIONS, SEED_TEMPLATES, TEMPLATE_FIELDS, fieldsFor, templateSlots } from '../../src/data/seed/templates';
import { SEED_VISA_ROUTES, VISA_CHANGE_REASON } from '../../src/data/seed/visa';
import { SEED_SOURCE_NOTES_PREFIX, resolveSeedSource, seedCompanyKeys, seedWatchUrls } from '../../src/db/seed';
import { CONNECTORS } from '../../src/lib/connectors';
import { REMOTE_COUNTRY } from '../../src/lib/contracts/settings';

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const allSources = [...SEED_SOURCES, ...SEED_COMPANIES.map(companySource)];

describe('countries', () => {
  it('has unique ISO codes, covers tiers 1–4 and the remote pseudo-country', () => {
    expect(new Set(SEED_COUNTRY_CODES).size).toBe(SEED_COUNTRIES.length);
    expect(SEED_COUNTRY_CODES).toContain(REMOTE_COUNTRY);
    for (const tier of [1, 2, 3, 4]) expect(SEED_COUNTRIES.some((c) => c.tier === tier)).toBe(true);
    for (const c of SEED_COUNTRIES) {
      expect(c.iso2).toMatch(/^[A-Z]{2}$/);
      expect([0, 1, 2, 3, 4]).toContain(c.tier);
      expect(c.isLive).toBe(false);
      expect(c.cvConventions.length.length).toBeGreaterThan(0);
      expect(c.languageNotes.length).toBeGreaterThan(0);
    }
  });

  it('contains every spec §4 tier-1 target', () => {
    for (const iso2 of ['DE', 'NL', 'IE', 'FR', 'ES', 'PT', 'BE', 'LU', 'AT', 'IT']) expect(SEED_COUNTRY_CODES).toContain(iso2);
  });
});

describe('visa routes', () => {
  it('reference seeded countries, are unique per country, and carry one unverified research rule', () => {
    const keys = SEED_VISA_ROUTES.map((r) => `${r.countryIso2}:${r.code}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of SEED_VISA_ROUTES) {
      expect(SEED_COUNTRY_CODES).toContain(r.countryIso2);
      expect(r.officialUrl).toMatch(/^https:\/\//);
      expect(r.rule.effectiveFrom).toMatch(DAY_RE);
      expect(r.rule.officialSourceUrl).toMatch(/^https:\/\//);
      if (r.rule.salaryThresholdEur !== null) expect(Number.isInteger(r.rule.salaryThresholdEur)).toBe(true);
      if (r.rule.currency !== null) expect(r.rule.currency).toMatch(/^[A-Z]{3}$/);
    }
    expect(VISA_CHANGE_REASON).toMatch(/needs owner verification/);
  });

  it("watches every active route's official pages (a page shared by routes is watched once)", () => {
    const urls = seedWatchUrls(SEED_VISA_ROUTES.map((seed, i) => ({ seed, id: i + 1, isActive: seed.isActive })));
    for (const r of SEED_VISA_ROUTES.filter((x) => x.isActive)) {
      for (const u of [r.officialUrl, r.rule.officialSourceUrl, ...(r.watchUrls ?? [])]) expect(urls.has(u), u).toBe(true);
    }
  });
});

describe('platforms and sources', () => {
  it('records the build assistant reading, never an owner review', () => {
    expect(new Set(SEED_PLATFORMS.map((p) => p.key)).size).toBe(SEED_PLATFORMS.length);
    for (const p of SEED_PLATFORMS) {
      expect(p.termsNotes.startsWith(TERMS_REVIEW_PREFIX)).toBe(true);
      expect(['A', 'B', 'C', 'D']).toContain(p.grade);
      if (p.hasConnector) expect(CONNECTORS[p.key], p.key).toBeDefined();
    }
    expect(FORBIDDEN_PLATFORM_KEYS).toEqual(expect.arrayContaining(['linkedin', 'indeed', 'glassdoor']));
  });

  it('every source parses against its connector, has a unique key and avoids forbidden platforms', () => {
    const keys = allSources.map((s) => resolveSeedSource(s).sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const s of allSources) {
      expect(FORBIDDEN_PLATFORM_KEYS).not.toContain(s.platformKey);
      expect(SEED_PLATFORMS.some((p) => p.key === s.platformKey)).toBe(true);
      expect(s.notes.startsWith(SEED_SOURCE_NOTES_PREFIX)).toBe(true);
      if (s.countryIso2 !== null) expect(SEED_COUNTRY_CODES).toContain(s.countryIso2);
    }
  });

  it('rejects a source on a forbidden platform or with a bad config', () => {
    expect(() => resolveSeedSource({ platformKey: 'linkedin', config: {}, label: 'x' })).toThrow(/forbidden/);
    expect(() => resolveSeedSource({ platformKey: 'greenhouse', config: {}, label: 'x' })).toThrow(/invalid config/);
    expect(() => resolveSeedSource({ platformKey: 'nope', config: {}, label: 'x' })).toThrow(/no connector/);
  });
});

describe('companies', () => {
  it('lists 120–200 companies with unique boards and resolvable keys', () => {
    expect(SEED_COMPANIES.length).toBeGreaterThanOrEqual(120);
    expect(SEED_COMPANIES.length).toBeLessThanOrEqual(200);
    const boards = SEED_COMPANIES.map((c) => `${c.platform}:${companyBoardSlug(c).toLowerCase()}`);
    expect(new Set(boards).size).toBe(boards.length);
    const names = SEED_COMPANIES.map((c) => seedCompanyKeys(c).nameKeys[0]);
    expect(new Set(names).size).toBe(names.length);
    for (const c of SEED_COMPANIES) {
      const k = seedCompanyKeys(c);
      expect(k.slugKey).toBeTruthy();
      expect(k.aliases.some((a) => a.kind === 'ats_slug')).toBe(true);
      expect(c.check.jobs).toBeGreaterThan(0);
      if (c.hqCountry !== null) expect(c.hqCountry).toMatch(/^[A-Z]{2}$/);
    }
  });
});

describe('kit starters', () => {
  it('has the three resume tracks, in EU CV markdown with placeholders', () => {
    expect(SEED_RESUME_VERSIONS.map((r) => r.track).sort()).toEqual(['cloud_security', 'devsecops', 'fullstack']);
    for (const r of SEED_RESUME_VERSIONS) {
      expect(RESUME_TRACKS as readonly string[]).toContain(r.track);
      expect(r.contentMd).toMatch(/\[[^\]]+\]/);
      expect(r.contentMd).not.toMatch(/TODO/i);
    }
  });

  it('declares a field for every {{slot}} and uses known kinds', () => {
    for (const t of SEED_TEMPLATES) {
      expect(TEMPLATE_KINDS as readonly string[]).toContain(t.kind);
      const slots = templateSlots(t.bodyMd);
      if (slots.length) {
        expect(t.fields?.map((f) => f.key).sort()).toEqual([...slots].sort());
        for (const s of slots) expect(TEMPLATE_FIELDS[s]).toBeDefined();
      } else expect(t.fields).toBeNull();
      expect(t.bodyMd).not.toMatch(/TODO/i);
    }
    expect(() => fieldsFor('Hello {{not_a_field}}')).toThrow();
  });

  it('ships the cover letters, six outreach messages, a checklist and a CV guide per country', () => {
    const letters = SEED_TEMPLATES.filter((t) => t.kind === 'cover_letter');
    expect(letters.map((t) => t.countryIso2 ?? '-').sort()).toEqual(['-', '-', 'DE', 'GB', 'IE']);
    expect(SEED_TEMPLATES.filter((t) => t.kind === 'outreach')).toHaveLength(6);
    expect(SEED_TEMPLATES.filter((t) => t.kind === 'checklist')).toHaveLength(1);
    const guides = SEED_TEMPLATES.filter((t) => t.kind === 'cv_convention');
    expect(guides.map((t) => t.countryIso2).sort()).toEqual([...SEED_COUNTRY_CODES].sort());
    const keys = SEED_TEMPLATES.map((t) => `${t.kind}:${t.countryIso2 ?? '-'}:${t.name}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const t of SEED_TEMPLATES) expect(t.name.length).toBeLessThanOrEqual(191);
  });
});

describe('docs stay in step with the seed data', () => {
  const root = path.resolve(__dirname, '../..');
  const rulesDoc = readFileSync(path.join(root, 'docs/COUNTRY_RULES.md'), 'utf8');
  const sourcesDoc = readFileSync(path.join(root, 'docs/SOURCES.md'), 'utf8');

  it('COUNTRY_RULES.md covers every country and route and says it is unverified', () => {
    for (const c of SEED_COUNTRIES) expect(rulesDoc).toContain(`### ${c.iso2} — `);
    for (const r of SEED_VISA_ROUTES) expect(rulesDoc).toContain(`(\`${r.code}\`)`);
    expect(rulesDoc).toMatch(/UNVERIFIED research import, 2026-09-30/);
  });

  it('SOURCES.md covers every platform and company board and says the terms need the owner', () => {
    for (const p of SEED_PLATFORMS) expect(sourcesDoc).toContain(`| \`${p.key}\` |`);
    for (const c of SEED_COMPANIES) expect(sourcesDoc).toContain(`\`${companyBoardSlug(c)}\``);
    expect(sourcesDoc).toMatch(/owner must confirm/);
  });
});
