// STUB(NORMALIZE): minimal safe implementation — maps nothing (every title goes to review as
// unknown). Replace with the real title dictionary; keep the exported signature.
import type { TitleResult } from '../contracts/jobs';

export const TITLE_LOGIC_VERSION = 'title-stub-0';

export function mapTitle(title: string): TitleResult {
  void title;
  return { roleKey: null, roleFamily: 'other', seniorityWord: null, matched: null, lang: null, confidence: 'low', unknown: true };
}
