/**
 * Shared state of one pipeline run (or one reprocess pass), handed to every stage. Built once in
 * run.ts / reprocess.ts; stages never read settings themselves, so one run uses one consistent
 * view of the profile, weights and title overrides.
 */
import type { VisaRuleVersionRow } from '../../../db/schema';
import type { AlertChannel, AlertSeverity } from '../../alerts';
import type { FxTable } from '../../contracts/jobs';
import type { AlertSettings, Profile, ScoreWeights, TitleOverrides } from '../../contracts/settings';
import type { Db } from '../../db';
import type { Logger } from '../../log';
import type { RunKind } from '../queue';

export interface RunSettings {
  profile: Profile;
  weights: ScoreWeights;
  alerts: AlertSettings;
  titleOverrides: TitleOverrides;
}

/** An alert raised (or attempted) during the run, for the run report. */
export interface RunAlertRecord {
  kind: string;
  severity: AlertSeverity;
  title: string;
  sourceId: number | null;
  alertId: number | null;
  error?: string;
}

export interface RunContext {
  db: Db;
  runId: number;
  kind: RunKind;
  dryRun: boolean;
  /**
   * Reprocess mode: re-derive from stored raw snapshots. No snapshot inserts, no last-seen /
   * missing-count / reopen changes (nothing was fetched), no source_runs rows.
   */
  forced: boolean;
  /** Fixed run start: every "seen at" of this run carries this exact timestamp. */
  now: Date;
  settings: RunSettings;
  fx: FxTable;
  /** countries.iso2 values (jobs.country_iso2 is a foreign key). */
  knownCountries: ReadonlySet<string>;
  signal: AbortSignal;
  channels: readonly AlertChannel[];
  log: Logger;
  /** Jobs whose missing count was already raised in this run (by another source). */
  missingIncremented: Set<number>;
  alerts: RunAlertRecord[];
  /** country → the visa rule used for eligibility (cached per run). */
  ruleCache: Map<string, VisaRuleVersionRow | null>;
}
