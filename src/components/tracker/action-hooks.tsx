"use client";

/**
 * Form plumbing shared by the tracker, kit, companies and countries screens (client): toasts for
 * each action result, forms that keep what was typed after a validation error, the inline error
 * line and lazily-mounted modals. Same behaviour as the /jobs forms.
 */
import { startTransition, useActionState, useEffect, useEffectEvent, useRef, useState, type FormEvent } from "react";
import { Icon } from "@/components/ui/icons";
import { useToast, type ToastInput } from "@/components/ui/Toast";
import type { ActionState } from "@/lib/tracker/action-state";

export type FormActionFn = (prev: ActionState | undefined, formData: FormData) => Promise<ActionState>;

export function feedbackToast(s: ActionState, errorTitle?: string): ToastInput | null {
  if (s.ok) return { kind: "ok", title: s.message ?? "Done" };
  if (s.error) return { kind: "error", title: errorTitle ?? "Nothing changed", body: s.error };
  return null;
}

/** Runs `fn` once per new action result (keyed on `state.at`), after the render that shows it. */
export function useOnResult(state: ActionState | undefined, fn: (s: ActionState) => void) {
  const seen = useRef<number | undefined>(undefined);
  const run = useEffectEvent(fn);
  useEffect(() => {
    if (!state?.at || seen.current === state.at) return;
    seen.current = state.at;
    run(state);
  }, [state]);
}

/** Toasts each new result once and runs `onOk` after a success (for forms that stay mounted). */
export function useActionFeedback(state: ActionState | undefined, opts: { onOk?: (s: ActionState) => void; errorTitle?: string } = {}) {
  const { toast } = useToast();
  useOnResult(state, (s) => {
    const t = feedbackToast(s, opts.errorTitle);
    if (t) toast(t);
    if (s.ok) opts.onOk?.(s);
  });
}

/** A plain `<form action>` bound to a server action, with the toast. */
export function useFormAction(fn: FormActionFn, opts: { onOk?: (s: ActionState) => void; errorTitle?: string } = {}) {
  const [state, action, pending] = useActionState(fn, undefined);
  useActionFeedback(state, opts);
  return { state, action, pending };
}

/**
 * Submits without React's automatic form reset, so a validation error keeps what was typed. After
 * a success `formKey` changes: key the form on it and it remounts with fresh defaults. The toast
 * is raised as soon as the action returns (the refresh may unmount the component that ran it).
 */
export function useKeepValuesAction(fn: FormActionFn, opts: { onOk?: (s: ActionState) => void; errorTitle?: string } = {}) {
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
    opts.onOk?.(s);
  });
  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const submitter = (e.nativeEvent as SubmitEvent).submitter;
    const data = new FormData(e.currentTarget, submitter ?? undefined);
    startTransition(() => dispatch(data));
  };
  return { state, pending, onSubmit, formKey };
}

/** Mounts a dialog on first open and keeps it mounted (focus return handled by the kit). */
export function useLazyModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return {
    open,
    mounted,
    show: () => {
      setMounted(true);
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}

export function InlineError({ state }: { state: ActionState | undefined }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 border-l-4 border-stamp-deep bg-stamp-tint px-2 py-1 text-sm font-bold">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-stamp-deep" />
      {state.error}
    </p>
  );
}
