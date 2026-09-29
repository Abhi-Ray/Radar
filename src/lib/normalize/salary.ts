// STUB(NORMALIZE): minimal safe implementation — never invents a salary (returns null).
// Replace with the real parser/estimator; keep the exported signatures.
import type { FxTable, NormalizedJob, SalaryValue } from '../contracts/jobs';
import type { Fact } from '../contracts/provenance';

export const SALARY_LOGIC_VERSION = 'salary-stub-0';

export function parseSalary(
  input: { hint?: NormalizedJob['salaryHint']; text: string; countryIso2: string | null },
  fx: FxTable,
): Fact<SalaryValue> | null {
  void input;
  void fx;
  return null;
}

/** Country-average estimate (kind 'estimated', method 'estimate'). */
export function estimateSalary(countryIso2: string | null, roleKey: string | null, fx: FxTable): Fact<SalaryValue> | null {
  void countryIso2;
  void roleKey;
  void fx;
  return null;
}
