"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { Input } from "@/components/ui/Input";
import { Notice } from "@/components/ui/Notice";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { formatDateTime } from "@/components/ui/format";
import { loginAction, type LoginState } from "@/lib/auth/actions";
import { lockRemainingMs, formatCountdown } from "./lockout";

/* One-second clock for the lockout countdown. The server snapshot is null, so the countdown
   only appears after hydration (no server/client text mismatch). */
function subscribeClock(onTick: () => void): () => void {
  const t = setInterval(onTick, 1000);
  return () => clearInterval(t);
}
const clockSnapshot = () => Math.floor(Date.now() / 1000);
const serverClockSnapshot = () => null;

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState | undefined, FormData>(loginAction, undefined);
  // Controlled so a failed attempt keeps the email (React resets uncontrolled fields after an action).
  const [email, setEmail] = useState("");
  const [reveal, setReveal] = useState(false);
  const passwordRef = useRef<HTMLInputElement>(null);

  const nowSec = useSyncExternalStore(subscribeClock, clockSnapshot, serverClockSnapshot);
  const remaining = state?.lockedUntil && nowSec !== null ? lockRemainingMs(state.lockedUntil, nowSec * 1000) : null;
  const locked = Boolean(state?.lockedUntil) && (remaining === null || remaining > 0);
  const lockExpired = Boolean(state?.lockedUntil) && remaining === 0;

  // After a failed attempt, put the cursor back in the password box.
  useEffect(() => {
    if (state?.error && !state.lockedUntil) passwordRef.current?.focus();
  }, [state]);

  const showError = Boolean(state?.error) && !lockExpired;

  return (
    <div className="border-3 border-ink bg-card shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b-3 border-ink bg-acid px-4 py-2">
        <p className="micro flex items-center gap-2 text-ink">
          <Icon name="lock" size={14} />
          Operator sign-in
        </p>
        <p className="font-mono text-[0.6875rem] font-bold text-ink">SEAT 1/1</p>
      </div>

      <form action={formAction} aria-busy={pending || undefined} className="flex flex-col gap-5 p-5 sm:p-7">
        <div>
          <h2 className="headline wide text-4xl uppercase sm:text-5xl">Sign in</h2>
          <p className="mt-2 text-sm text-ink-soft">One operator, one password. Wrong tries are slowed down and logged.</p>
        </div>

        {showError && state?.error ? (
          <div>
            {locked && state.lockedUntil ? (
              <Notice kind="danger" live="alert" label="Locked" title="Station locked">
                <p>{state.error}</p>
                <p className="mt-1 font-mono text-xs font-bold">
                  Unlocks <time dateTime={state.lockedUntil}>{formatDateTime(state.lockedUntil)}</time>
                  {remaining !== null ? <> · in {formatCountdown(remaining)}</> : null}
                </p>
              </Notice>
            ) : (
              <Notice kind="danger" live="alert" label="Sign-in failed" title="Access denied">
                {state.error}
              </Notice>
            )}
          </div>
        ) : null}
        {lockExpired ? (
          <Notice kind="ok" live="status" title="Lock lifted">
            You can try again now.
          </Notice>
        ) : null}

        <input type="hidden" name="next" value={next} />

        <Field label="Email" required>
          {(p) => (
            <Input
              {...p}
              name="email"
              type="email"
              icon="mail"
              autoComplete="username"
              inputMode="email"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              maxLength={254}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="operator@example.com"
            />
          )}
        </Field>

        <Field label="Password" required>
          {(p) => (
            <div className="flex min-w-0">
              <Input
                {...p}
                ref={passwordRef}
                name="password"
                type={reveal ? "text" : "password"}
                icon="lock"
                autoComplete="current-password"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                maxLength={1024}
                className="min-w-0 flex-1"
              />
              <button
                type="button"
                aria-label={reveal ? "Hide password" : "Show password"}
                aria-pressed={reveal}
                aria-controls={p.id}
                onClick={() => setReveal((v) => !v)}
                className="-ml-[3px] flex w-12 shrink-0 items-center justify-center border-3 border-ink bg-paper-deep text-ink hover:bg-acid aria-pressed:bg-ink aria-pressed:text-paper"
              >
                <Icon name={reveal ? "eye-off" : "eye"} size={20} />
              </button>
            </div>
          )}
        </Field>

        <SubmitButton variant="primary" size="lg" fullWidth iconRight="arrow-right" pending={pending} pendingLabel="Checking credentials" disabled={locked}>
          {locked ? "Locked" : "Sign in"}
        </SubmitButton>

        <p className="flex items-start gap-2 border-t-3 border-dashed border-ink pt-4 text-sm font-bold text-ink">
          <Icon name="shield" size={18} className="mt-0.5 shrink-0" />
          <span>
            Stays signed in on this device for 1 year.
            <span className="block text-xs font-normal text-muted">Sign out or revoke the session from Settings on any device.</span>
          </span>
        </p>
      </form>
    </div>
  );
}
