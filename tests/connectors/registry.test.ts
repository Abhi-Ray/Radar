import { describe, expect, it } from 'vitest';
import { CONNECTOR_KEYS, CONNECTORS, connectorVersions, getConnector } from '../../src/lib/connectors';
import { TRUSTED_API_HOSTS } from '../../src/lib/http/polite';

describe('connector registry', () => {
  it('holds all 15 connectors keyed by their platform key', () => {
    expect(CONNECTOR_KEYS).toHaveLength(15);
    for (const [k, c] of Object.entries(CONNECTORS)) expect(c.platformKey).toBe(k);
  });

  it('looks up only own keys', () => {
    for (const k of ['greenhouse', 'lever', 'ashby', 'smartrecruiters', 'workable', 'recruitee', 'personio', 'bundesagentur', 'jobtech_se', 'nav_no', 'arbeitnow', 'remotive', 'remoteok', 'himalayas', 'jobicy'])
      expect(getConnector(k), k).not.toBeNull();
    expect(getConnector('constructor')).toBeNull();
    expect(getConnector('nope')).toBeNull();
  });

  it('each module has a version, sane platform defaults and a parseable default-ish config', () => {
    for (const c of Object.values(CONNECTORS)) {
      expect(c.version).toMatch(new RegExp(`^${c.platformKey}@\\d{4}-\\d{2}-\\d{2}\\.\\d+$`));
      expect(c.platform.rateLimitPerMin).toBeGreaterThan(0);
      expect(c.platform.dailyCap).toBeGreaterThan(0);
      expect(['full', 'incremental']).toContain(c.listing);
      if (c.kind === 'aggregator') {
        expect(c.prefilter, c.platformKey).toBeTypeOf('function');
        expect(c.platform.attribution, c.platformKey).toBeTruthy();
      }
    }
  });

  it('records every parser version', () => {
    const v = connectorVersions();
    expect(Object.keys(v)).toHaveLength(16);
    expect(v.relevance).toMatch(/^relevance@/);
    expect(v['connector:nav_no']).toMatch(/^nav_no@/);
  });

  it('fixed API hosts are trusted; tenant hosts are not', () => {
    expect(TRUSTED_API_HOSTS.has('boards-api.greenhouse.io')).toBe(true);
    expect(TRUSTED_API_HOSTS.has('acme.recruitee.com')).toBe(false);
  });
});
