/**
 * Shared plumbing for the Server Actions in src/lib/actions/{applications,kit,companies,countries}.ts:
 * session check + caller IP, FormData → plain object, zod helpers and the ActionState results.
 * Server only (reads the request headers and the session).
 */
import 'server-only';
import { headers } from 'next/headers';
import { z } from 'zod';
import { clientIp } from '@/lib/auth/request';
import { requireSession } from '@/lib/auth/session';
import { log } from '@/lib/log';
import type { ActionState } from './action-state';

export type { ActionState } from './action-state';

/** Scalar form fields (the framework's `$ACTION_*` keys skipped). Repeated keys keep the last value. */
export function formObject(formData: FormData): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of formData.entries()) if (typeof v === 'string' && !k.startsWith('$ACTION')) out[k] = v;
  return out;
}

/** Every value of a repeated field (checkbox groups). */
export function formList(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((v): v is string => typeof v === 'string');
}

export function firstIssue(err: z.ZodError): string {
  return err.issues[0]?.message ?? 'Invalid input.';
}

export function fail(error: string): ActionState {
  return { ok: false, error, at: Date.now() };
}

export function done(message: string, extra: Partial<ActionState> = {}): ActionState {
  return { ok: true, message, at: Date.now(), ...extra };
}

/** Session first (redirects to /login when signed out), then the caller's IP for the audit row. */
export async function actor(): Promise<{ ip: string }> {
  await requireSession();
  return { ip: clientIp(await headers()) };
}

/**
 * Maps an error to the form's result: known domain errors (their message is written for the user)
 * pass through; anything else is logged and replaced by a generic line.
 */
export function unexpected(scope: string, what: string, err: unknown, known: ReadonlyArray<new (...args: never[]) => Error> = []): ActionState {
  if (known.some((K) => err instanceof K)) return fail((err as Error).message);
  log.error(`${scope} action: ${what} failed`, { err });
  return fail(`Could not ${what}. Nothing was changed — try again.`);
}

// ---- zod helpers -----------------------------------------------------------------------------

export const zId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/** Optional id: '' / absent → null. */
export const zOptionalId = z
  .union([z.literal(''), zId])
  .optional()
  .transform((v) => (v === '' || v === undefined ? null : v));

export const zReason = z.string().trim().min(3, 'Give a short reason (3+ characters).').max(500, 'Keep the reason under 500 characters.');

/** Optional trimmed text with a cap; '' → null. */
export function zOptionalText(max: number, label = 'This field') {
  return z
    .string()
    .trim()
    .max(max, `${label} is too long (max ${max} characters).`)
    .optional()
    .transform((v) => (v ? v : null));
}

export const zFlag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'on' || v === 'true');

/** 'YYYY-MM-DD' (optional; '' → null). Calendar validity is checked by the caller. */
export const zOptionalDay = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-09-30.')])
  .optional()
  .transform((v) => (v ? v : null));

/** ISO 3166 alpha-2 (optional; '' → null), upper-cased. */
export const zOptionalIso2 = z
  .union([z.literal(''), z.string().trim().regex(/^[A-Za-z]{2}$/, 'Pick a country.')])
  .optional()
  .transform((v) => (v ? v.toUpperCase() : null));

/** An http(s) URL typed by me (optional; '' → null). */
export const zOptionalUrl = z
  .union([
    z.literal(''),
    z
      .string()
      .trim()
      .max(2048, 'That link is too long.')
      .refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === 'https:' || u.protocol === 'http:';
        } catch {
          return false;
        }
      }, 'Use a full http(s):// link.'),
  ])
  .optional()
  .transform((v) => (v ? v : null));
