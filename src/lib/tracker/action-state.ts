/**
 * The result every tracker / kit / company / country Server Action returns to its form.
 * Pure type, client-safe (the forms' hooks in src/components/tracker/useActionFeedback.ts read it).
 */
export interface ActionState {
  ok?: boolean;
  error?: string;
  message?: string;
  /** Distinguishes two identical results in a row (so toasts fire again). */
  at?: number;
  /** The record created or changed (application, resume version, template, company). */
  id?: number;
  /** Where the result lives, when it is on another page (e.g. the split-off company). */
  href?: string;
}
