// STUB(VISA): minimal safe implementation — "can't tell" (low confidence). Replace with the real
// salary-threshold / degree / experience check; keep the exported signature.
import type { VisaRuleVersionRow } from '../../db/schema';
import type { Profile } from '../contracts/settings';
import type { EligibilityValue, SalaryValue } from '../contracts/jobs';
import type { Fact } from '../contracts/provenance';

export const ELIGIBILITY_LOGIC_VERSION = 'eligibility-stub-0';

export function checkEligibility(input: {
  salary: SalaryValue | null;
  rule: VisaRuleVersionRow | null;
  profile: Profile;
  now: Date;
}): Fact<EligibilityValue> {
  return {
    value: {
      result: 'cant_tell',
      reason: 'Eligibility check is not active yet.',
      marginPct: null,
      ruleVerifiedAt: input.rule?.lastVerifiedAt ?? null,
    },
    evidence: null,
    source: 'eligibility check',
    method: 'rule',
    confidence: 'low',
    checkedAt: input.now,
    logicVersion: ELIGIBILITY_LOGIC_VERSION,
  };
}
