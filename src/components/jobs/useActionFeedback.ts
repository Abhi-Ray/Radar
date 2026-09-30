"use client";

import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { useToast } from "@/components/ui/Toast";
import type { ActionState } from "@/lib/actions/jobs";

/**
 * Toasts each new action result once (keyed on `state.at`) and runs `onOk` after a success —
 * e.g. to close the modal the form lives in. Errors stay in the form too, so nothing is lost if
 * the toast is missed.
 */
export function useActionFeedback(state: ActionState | undefined, opts: { onOk?: () => void; errorTitle?: string } = {}) {
  const { toast } = useToast();
  const seen = useRef<number | undefined>(undefined);
  const report = useEffectEvent((s: ActionState) => {
    if (s.ok) {
      toast({ kind: "ok", title: s.message ?? "Done" });
      opts.onOk?.();
    } else if (s.error) {
      toast({ kind: "error", title: opts.errorTitle ?? "Nothing changed", body: s.error });
    }
  });
  useEffect(() => {
    if (!state?.at || seen.current === state.at) return;
    seen.current = state.at;
    report(state);
  }, [state]);
}

type FormActionFn = (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;

/**
 * Like `<form action={…}>` but without React's automatic form reset, so a validation error keeps
 * what was typed (used by the longer modal forms). After a success `formKey` changes: key the
 * form on it and it remounts with fresh defaults.
 */
export function useKeepValuesAction(fn: FormActionFn, opts: { onOk?: () => void; errorTitle?: string } = {}) {
  const [state, dispatch, pending] = useActionState(fn, undefined);
  const [formKey, setFormKey] = useState(0);
  useActionFeedback(state, {
    errorTitle: opts.errorTitle,
    onOk: () => {
      setFormKey((k) => k + 1);
      opts.onOk?.();
    },
  });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit, formKey };
}
