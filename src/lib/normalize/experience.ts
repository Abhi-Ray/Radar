// STUB(NORMALIZE): minimal safe implementation — reports "unknown" experience with low
// confidence. Replace with the real extractor; keep the exported signature.
import type { ExperienceValue } from '../contracts/jobs';
import type { Fact } from '../contracts/provenance';

export const EXPERIENCE_LOGIC_VERSION = 'experience-stub-0';

export function extractExperience(text: string, title: string): Fact<ExperienceValue> {
  void text;
  void title;
  return {
    value: { minYears: null, maxYears: null, band: 'unknown', securityStrict: false },
    evidence: null,
    source: 'posting text',
    method: 'rule',
    confidence: 'low',
    checkedAt: new Date(),
    logicVersion: EXPERIENCE_LOGIC_VERSION,
  };
}
