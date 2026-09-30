/**
 * Connector registry: platform key → module. The pipeline looks connectors up here; the SEED
 * step uses `configSchema` and `platform` defaults to create `source_platforms` / `sources` rows.
 */
import { arbeitnow } from './arbeitnow';
import { ashby } from './ashby';
import { bundesagentur } from './bundesagentur';
import { greenhouse } from './greenhouse';
import { himalayas } from './himalayas';
import { jobicy } from './jobicy';
import { jobtechSe } from './jobtech_se';
import { lever } from './lever';
import { navNo } from './nav_no';
import { personio } from './personio';
import { recruitee } from './recruitee';
import { remoteok } from './remoteok';
import { remotive } from './remotive';
import { smartrecruiters } from './smartrecruiters';
import type { ConnectorModule } from './types';
import { workable } from './workable';
import { RELEVANCE_VERSION } from './relevance';

export type { ConnectorModule, PlatformDefaults, PrefilterResult, PipelineFetchContext } from './types';
export { isSeenOnly, isSourceClosed } from './types';
export { RELEVANCE_VERSION };

// Each module is typed with its own config; the registry erases that (configs are validated inside).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyConnector = ConnectorModule<any>;

export const CONNECTORS: Readonly<Record<string, AnyConnector>> = Object.freeze({
  greenhouse,
  lever,
  ashby,
  smartrecruiters,
  workable,
  recruitee,
  personio,
  bundesagentur,
  jobtech_se: jobtechSe,
  nav_no: navNo,
  arbeitnow,
  remotive,
  remoteok,
  himalayas,
  jobicy,
});

export const CONNECTOR_KEYS = Object.keys(CONNECTORS);

export function getConnector(platformKey: string): AnyConnector | null {
  return Object.prototype.hasOwnProperty.call(CONNECTORS, platformKey) ? (CONNECTORS[platformKey] ?? null) : null;
}

/** Parser versions of every connector (recorded on each pipeline run). */
export function connectorVersions(): Record<string, string> {
  const out: Record<string, string> = { relevance: RELEVANCE_VERSION };
  for (const [k, c] of Object.entries(CONNECTORS)) out[`connector:${k}`] = c.version;
  return out;
}
