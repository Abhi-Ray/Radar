/**
 * Result wording for the /jobs actions. Kept out of the 'use server' module on purpose: every
 * export there becomes a callable server action, and these are plain pure helpers.
 */

/** What "Mark applied" did, in words. The tracker never moves an application backwards. */
export function markAppliedMessage(result: { created: boolean; snapshotId: number | null }, stage: string | null, hadNote: boolean): string {
  const snap = result.snapshotId ? " The posting was snapshotted." : "";
  if (result.created) return `Application logged in the tracker.${snap}`;
  if (result.snapshotId) return `The tracker already had this job — it is now at "applied".${snap}`;
  const at = stage ? ` at "${stage.replace(/_/g, " ")}"` : "";
  return `The tracker already has this application${at}, so its stage was left alone.${hadNote ? " Your note was added to it." : ""}`;
}
