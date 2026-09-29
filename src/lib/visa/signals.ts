// STUB(VISA): minimal safe implementation — detects no signals (visa stays "unknown").
// Replace with the multilingual, negation-aware rule set; keep the exported signature.
import type { VisaSignal } from '../contracts/jobs';

export const VISA_SIGNALS_LOGIC_VERSION = 'visa-signals-stub-0';

export function detectVisaSignals(text: string): VisaSignal[] {
  void text;
  return [];
}
