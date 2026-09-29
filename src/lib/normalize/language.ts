// STUB(NORMALIZE): minimal safe implementation — language requirement "unclear", low confidence.
// Replace with the real detector; keep the exported signature.
import type { LanguageValue } from '../contracts/jobs';
import type { Fact } from '../contracts/provenance';

export const LANGUAGE_LOGIC_VERSION = 'language-stub-0';

export function detectLanguage(text: string): Fact<LanguageValue> {
  void text;
  return {
    value: { postingLang: null, requirement: 'unclear', languages: [] },
    evidence: null,
    source: 'posting text',
    method: 'rule',
    confidence: 'low',
    checkedAt: new Date(),
    logicVersion: LANGUAGE_LOGIC_VERSION,
  };
}
