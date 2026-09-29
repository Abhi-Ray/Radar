// STUB(VISA): minimal safe implementation — "unclear" (low confidence); never claims worldwide.
// Replace with the real classifier; keep the exported signature.
import type { LocationResult, RemoteValue } from '../contracts/jobs';
import type { Fact } from '../contracts/provenance';

export const REMOTE_LOGIC_VERSION = 'remote-stub-0';

export function classifyRemote(text: string, loc: LocationResult): Fact<RemoteValue> {
  void text;
  void loc;
  return {
    value: { class: 'unclear', regions: [] },
    evidence: null,
    source: 'posting text',
    method: 'rule',
    confidence: 'low',
    checkedAt: new Date(),
    logicVersion: REMOTE_LOGIC_VERSION,
  };
}
