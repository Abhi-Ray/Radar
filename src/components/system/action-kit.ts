/**
 * Shared, pure helpers for the ops server actions (review, sources, accuracy, settings, system):
 * form → object, the ActionState result shapes and common zod pieces. No server imports here, so
 * the helpers are unit-testable and safe to share.
 */
import { z } from "zod";
import type { ActionState } from "@/lib/actions/jobs";

export type { ActionState };

/** String fields of a form (React's `$ACTION_*` bookkeeping keys dropped; last value wins). */
export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === "string" && !k.startsWith("$ACTION")) out[k] = v;
  return out;
}

export function firstIssue(err: z.ZodError): string {
  const issue = err.issues[0];
  if (!issue) return "Invalid input.";
  return issue.message;
}

export function fail(error: string): ActionState {
  return { ok: false, error, at: Date.now() };
}

export function done(message: string, extra: Partial<ActionState> = {}): ActionState {
  return { ok: true, message, at: Date.now(), ...extra };
}

export const idSchema = z.coerce.number({ error: "Missing id." }).int().positive("Missing id.").max(Number.MAX_SAFE_INTEGER);

/** Checkbox / hidden flag: "1" | "on" | "true" → true, anything else (or absent) → false. */
export const flagSchema = z
  .string()
  .optional()
  .transform((v) => v === "1" || v === "on" || v === "true");

/** Optional free text; blank → null. */
export function optionalText(max: number, label = "Text") {
  return z
    .string()
    .trim()
    .max(max, `${label}: keep it under ${max} characters.`)
    .optional()
    .transform((v) => (v ? v : null));
}

/** Required short reason for destructive / judgement actions. */
export const reasonSchema = z
  .string({ error: "Give a short reason (3+ characters)." })
  .trim()
  .min(3, "Give a short reason (3+ characters).")
  .max(500, "Keep the reason under 500 characters.");

/** Calendar date input (YYYY-MM-DD) → Date at 12:00 UTC (stays on that day in any EU zone). */
export const dateInputSchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-09-30.")
  .transform((s) => new Date(`${s}T12:00:00.000Z`))
  .refine((d) => !Number.isNaN(d.getTime()), "That date does not exist.");

/** Version stamp of a versioned settings form (0 = the row did not exist yet). */
export const versionSchema = z.coerce.number({ error: "Missing form version — reload the page." }).int().min(0).max(1_000_000_000);

/** Positive integer ids from repeated form fields (checkbox groups). */
export function idList(formData: FormData, name: string): number[] {
  const out: number[] = [];
  for (const v of formData.getAll(name)) {
    if (typeof v !== "string") continue;
    const n = Number(v);
    if (Number.isSafeInteger(n) && n > 0 && !out.includes(n)) out.push(n);
  }
  return out;
}
