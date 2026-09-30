/**
 * Logic versions recorded on every pipeline run (`pipeline_runs.logic_versions_json`): the
 * pipeline's own stages plus every enrichment module and connector parser. Reprocessing from raw
 * snapshots with a newer map explains why a stored value changed.
 */
import { COMPANY_LOGIC_VERSION } from '../company/resolve';
import { connectorVersions } from '../connectors';
import { DEDUP_LOGIC_VERSION } from '../dedup';
import { FX_LOGIC_VERSION } from '../fx/ecb';
import { POLITE_HTTP_VERSION } from '../http/polite';
import { EXPERIENCE_LOGIC_VERSION } from '../normalize/experience';
import { LANGUAGE_LOGIC_VERSION } from '../normalize/language';
import { LOCATION_LOGIC_VERSION } from '../normalize/location';
import { SALARY_LOGIC_VERSION } from '../normalize/salary';
import { TITLE_LOGIC_VERSION } from '../normalize/title';
import { URL_LOGIC_VERSION } from '../normalize/url';
import { REMOTE_LOGIC_VERSION } from '../remote/classify';
import { SCORE_VERSION } from '../scoring/score';
import { VISA_DECIDE_LOGIC_VERSION } from '../visa/decide';
import { ELIGIBILITY_LOGIC_VERSION } from '../visa/eligibility';
import { VISA_SIGNALS_LOGIC_VERSION } from '../visa/signals';
import { HEALTH_LOGIC_VERSION } from './health';
import { QUALITY_LOGIC_VERSION } from './quality';
import { SKILLS_LOGIC_VERSION } from './stages/skills';

/** Orchestration logic (stage order, change tracking, lifecycle rules). */
export const PIPELINE_LOGIC_VERSION = 'pipeline@2026-09-30.1';
export const LIFECYCLE_LOGIC_VERSION = 'lifecycle@2026-09-30.1';
export const LINKCHECK_LOGIC_VERSION = 'linkcheck@2026-09-30.1';

export function logicVersions(): Record<string, string> {
  return {
    pipeline: PIPELINE_LOGIC_VERSION,
    lifecycle: LIFECYCLE_LOGIC_VERSION,
    linkcheck: LINKCHECK_LOGIC_VERSION,
    health: HEALTH_LOGIC_VERSION,
    quality: QUALITY_LOGIC_VERSION,
    skills: SKILLS_LOGIC_VERSION,
    location: LOCATION_LOGIC_VERSION,
    title: TITLE_LOGIC_VERSION,
    experience: EXPERIENCE_LOGIC_VERSION,
    salary: SALARY_LOGIC_VERSION,
    language: LANGUAGE_LOGIC_VERSION,
    url: URL_LOGIC_VERSION,
    fx: FX_LOGIC_VERSION,
    dedup: DEDUP_LOGIC_VERSION,
    company: COMPANY_LOGIC_VERSION,
    visa_signals: VISA_SIGNALS_LOGIC_VERSION,
    visa_decide: VISA_DECIDE_LOGIC_VERSION,
    eligibility: ELIGIBILITY_LOGIC_VERSION,
    remote: REMOTE_LOGIC_VERSION,
    score: SCORE_VERSION,
    polite_http: POLITE_HTTP_VERSION,
    ...connectorVersions(),
  };
}
