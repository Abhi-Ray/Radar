// STUB(VISA): minimal safe implementation — deterministic score 0 with no components (nothing is
// ranked above anything else). Replace with the explainable weighted scorer; keep the signature.
import type { ScoreResult, ScoringInput } from '../contracts/jobs';
import type { Profile, ScoreWeights } from '../contracts/settings';

export const SCORE_VERSION = 'score-stub-0';

export function scoreJob(input: ScoringInput, weights: ScoreWeights, profile: Profile): ScoreResult {
  void input;
  void weights;
  void profile;
  return { score: 0, version: SCORE_VERSION, components: [] };
}
