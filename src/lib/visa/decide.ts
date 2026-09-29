// STUB(VISA): minimal safe implementation — always "unknown" (low confidence). The real engine
// combines posting, company evidence, manual notes and AI; AI alone never yields "confirmed".
// Keep the exported signature.
import type { CompanyEvidenceRow } from '../../db/schema';
import type { VisaDecisionValue, VisaSignal } from '../contracts/jobs';
import type { Fact } from '../contracts/provenance';

export const VISA_DECIDE_LOGIC_VERSION = 'visa-decide-stub-0';

export function decideVisaStatus(input: {
  postingSignals: VisaSignal[];
  companyEvidence: CompanyEvidenceRow[];
  manualNotes: { sponsors: boolean; note: string; at: Date }[];
  aiSignals: VisaSignal[];
}): Fact<VisaDecisionValue> {
  void input;
  return {
    value: { status: 'unknown', reasons: ['Visa rules are not active yet.'] },
    evidence: null,
    source: 'visa engine',
    method: 'rule',
    confidence: 'low',
    checkedAt: new Date(),
    logicVersion: VISA_DECIDE_LOGIC_VERSION,
  };
}
