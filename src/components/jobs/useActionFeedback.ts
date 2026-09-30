"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { useToast, type ToastInput } from "@/components/ui/Toast";
import type { ActionState } from "@/lib/actions/jobs";

/** The toast for one action result (null when there is nothing to say). */
export function feedbackToast(s: ActionState, errorTitle?: string): ToastInput | null {
  if (s.ok) return { kind: "ok", title: s.message ?? "Done" };
  if (s.error) return { kind: "error", title: errorTitle ?? "Nothing changed", body: s.error };
  return null;
}

/**
 * Runs `fn` once per new action result (keyed on `state.at`), after the render that shows it.
 * Only fires while the component is mounted.
 */
function useOnResult(state: ActionState | undefined, fn: (s: ActionState) => void) {
  const seen = useRef<number | undefined>(undefined);
  const run = useEffectEvent(fn);
  useEffect(() => {
    if (!state?.at || seen.current === state.at) return;
    seen.current = state.at;
    run(state);
  }, [state]);
}

/**
 * Toasts each new action result once and runs `onOk` after a success — e.g. to close the modal
 * the form lives in. Errors stay in the form too, so nothing is lost if the toast is missed.
 * For forms that stay mounted after the refresh; `useKeepValuesAction` covers the others.
 */
export function useActionFeedback(state: ActionState | undefined, opts: { onOk?: () => void; errorTitle?: string } = {}) {
  const { toast } = useToast();
  useOnResult(state, (s) => {
    const t = feedbackToast(s, opts.errorTitle);
    if (t) toast(t);
    if (s.ok) opts.onOk?.();
  });
}

type FormActionFn = (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;

/**
 * Like `<form action={…}>` but without React's automatic form reset, so a validation error keeps
 * what was typed (used by the longer modal forms). After a success `formKey` changes: key the
 * form on it and it remounts with fresh defaults.
 *
 * The toast is raised as soon as the action returns, not from an effect: the refresh that follows
 * often removes the very component that ran it (a removed override leaves the list), and an
 * effect in an unmounted component never runs.
 */
export function useKeepValuesAction(fn: FormActionFn, opts: { onOk?: () => void; errorTitle?: string } = {}) {
  const { toast } = useToast();
  const errorTitle = opts.errorTitle;
  const [state, dispatch, pending] = useActionState(async (prev: ActionState | undefined, formData: FormData) => {
    const s = await fn(prev, formData);
    const t = feedbackToast(s, errorTitle);
    if (t) toast(t);
    return s;
  }, undefined);
  const [formKey, setFormKey] = useState(0);
  useOnResult(state, (s) => {
    if (!s.ok) return;
    setFormKey((k) => k + 1);
    opts.onOk?.();
  });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit, formKey };
}
