import { useId, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export interface FieldControlProps {
  id: string;
  "aria-describedby"?: string;
  "aria-invalid"?: true;
  required?: boolean;
}

export interface FieldProps {
  label: ReactNode;
  /** Help text under the control. */
  hint?: ReactNode;
  /** Error message; marks the control invalid and is announced. */
  error?: ReactNode;
  required?: boolean;
  /** Optional marker instead of the required star ("optional"). */
  optional?: boolean;
  /** Fixed id for the control (otherwise generated). */
  id?: string;
  /** Visually hide the label (still read by screen readers). */
  hideLabel?: boolean;
  /** Put the label on the left on wide screens. */
  inline?: boolean;
  className?: string;
  /**
   * Render prop receiving the wiring for the control:
   * <Field label="Email">{(p) => <Input {...p} name="email" />}</Field>
   */
  children: (control: FieldControlProps) => ReactNode;
}

/** Label + control + hint + error with correct ids, described-by and invalid state. */
export function Field({ label, hint, error, required, optional, id, hideLabel, inline, className, children }: FieldProps) {
  const auto = useId();
  const controlId = id ?? `f${auto.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("min-w-0", inline ? "grid gap-x-4 gap-y-1.5 md:grid-cols-[12rem_1fr] md:items-start" : "flex flex-col gap-1.5", className)}>
      <label htmlFor={controlId} className={cn("micro flex items-baseline gap-1.5 text-ink", inline && "md:pt-3.5", hideLabel && "sr-only")}>
        {label}
        {required ? (
          <span aria-hidden="true" className="text-stamp-deep">
            *
          </span>
        ) : optional ? (
          <span className="font-mono text-[0.625rem] font-normal normal-case tracking-normal text-muted">optional</span>
        ) : null}
      </label>
      <div className="flex min-w-0 flex-col gap-1.5">
        {children({
          id: controlId,
          "aria-describedby": describedBy,
          "aria-invalid": error ? true : undefined,
          required: required || undefined,
        })}
        {error ? (
          <p id={errorId} className="flex items-start gap-1.5 border-l-4 border-stamp-deep bg-stamp-tint px-2 py-1 text-sm font-bold text-ink">
            <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-stamp-deep" />
            <span>{error}</span>
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-xs leading-relaxed text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </div>
  );
}

/** Group of related controls (checkbox/radio sets) with a legend. */
export function Fieldset({ legend, hint, children, className }: { legend: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <fieldset className={cn("m-0 min-w-0 border-3 border-ink bg-card p-3 pt-2 md:p-4 md:pt-3", className)}>
      <legend className="micro -ml-1 bg-ink px-2 py-0.5 text-paper">{legend}</legend>
      {hint ? <p className="mb-2 text-xs text-muted">{hint}</p> : null}
      {children}
    </fieldset>
  );
}
