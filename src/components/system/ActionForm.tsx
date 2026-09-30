"use client";

import type { ReactNode } from "react";
import { InlineError, useFormAction, type FormActionFn } from "@/components/tracker/action-hooks";
import { SubmitButton, cn, type ButtonSize, type ButtonVariant, type IconName } from "@/components/ui";

/**
 * A one-button form bound to a Server Action, for the ops screens: hidden fields, an optional
 * reason box and the toast / inline error every other form has. Refreshing is done by the action.
 */
export function ActionForm({
  action,
  hidden,
  submit,
  pending = "Working…",
  icon,
  variant = "secondary",
  size = "sm",
  reason,
  className,
  children,
}: {
  action: FormActionFn;
  hidden?: Record<string, string | number>;
  submit: string;
  pending?: string;
  icon?: IconName;
  variant?: ButtonVariant;
  size?: ButtonSize;
  reason?: { label: string; required?: boolean; name?: string; placeholder?: string };
  className?: string;
  children?: ReactNode;
}) {
  const { state, action: formAction } = useFormAction(action);
  return (
    <form action={formAction} className={cn("flex flex-wrap items-end gap-2", className)}>
      {Object.entries(hidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={String(v)} />
      ))}
      {reason ? (
        <label className="flex min-w-44 flex-1 flex-col gap-1">
          <span className="micro">
            {reason.label}
            {reason.required ? " *" : ""}
          </span>
          <input
            name={reason.name ?? "reason"}
            required={reason.required}
            minLength={reason.required ? 3 : undefined}
            maxLength={500}
            placeholder={reason.placeholder}
            autoComplete="off"
            className="min-h-11 border-3 border-ink bg-card px-3 text-sm"
          />
        </label>
      ) : null}
      {children}
      <SubmitButton variant={variant} size={size} icon={icon} pendingLabel={pending}>
        {submit}
      </SubmitButton>
      <InlineError state={state} />
    </form>
  );
}
