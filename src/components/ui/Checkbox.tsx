import type { InputHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: ReactNode;
  /** Secondary line under the label. */
  description?: ReactNode;
  className?: string;
}

/** Square ink checkbox; the whole row is the 44px hit target. */
export function Checkbox({ label, description, className, disabled, ...rest }: CheckboxProps) {
  return (
    <label className={cn("group flex min-h-11 cursor-pointer items-start gap-3 py-2", disabled && "cursor-not-allowed opacity-60", className)}>
      <span className="relative mt-px inline-flex size-6 shrink-0">
        <input
          type="checkbox"
          disabled={disabled}
          {...rest}
          className="peer absolute inset-0 size-6 cursor-pointer appearance-none border-3 border-ink bg-card shadow-xs checked:bg-acid disabled:cursor-not-allowed group-hover:bg-acid-tint checked:group-hover:bg-acid aria-invalid:border-stamp-deep"
        />
        <Icon name="check" size={18} strokeWidth={3.5} className="pointer-events-none absolute inset-0 m-auto hidden text-ink peer-checked:block" />
      </span>
      <span className="min-w-0">
        <span className="block font-bold leading-snug">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
      </span>
    </label>
  );
}

export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "role"> {
  label: ReactNode;
  description?: ReactNode;
  /** Words printed on the track. */
  onLabel?: string;
  offLabel?: string;
  className?: string;
}

/** On/off switch (checkbox with role="switch"): square knob slides, track turns radar green. */
export function Toggle({ label, description, onLabel = "On", offLabel = "Off", className, disabled, ...rest }: ToggleProps) {
  return (
    <label className={cn("group flex min-h-11 cursor-pointer items-center justify-between gap-4 py-2", disabled && "cursor-not-allowed opacity-60", className)}>
      <span className="min-w-0">
        <span className="block font-bold leading-snug">{label}</span>
        {description ? <span className="mt-0.5 block text-xs text-muted">{description}</span> : null}
      </span>
      <span className="relative inline-flex h-8 w-[4.5rem] shrink-0">
        <input
          type="checkbox"
          role="switch"
          disabled={disabled}
          {...rest}
          className="peer absolute inset-0 h-8 w-[4.5rem] cursor-pointer appearance-none border-3 border-ink bg-concrete shadow-xs checked:bg-radar disabled:cursor-not-allowed"
        />
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-2 flex items-center font-mono text-[0.625rem] font-bold uppercase peer-checked:hidden">
          {offLabel}
        </span>
        <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-2 hidden items-center font-mono text-[0.625rem] font-bold uppercase peer-checked:flex">
          {onLabel}
        </span>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute top-1 left-1 size-6 border-3 border-ink bg-card transition-transform duration-100 peer-checked:translate-x-10 peer-checked:bg-ink"
        />
      </span>
    </label>
  );
}

export interface ChoiceChipProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** radio = one of a set, checkbox = many. */
  kind?: "radio" | "checkbox";
  label: ReactNode;
  className?: string;
}

/** Radio/checkbox styled as a chunky chip (stage pickers, segmented choices). */
export function ChoiceChip({ kind = "radio", label, className, ...rest }: ChoiceChipProps) {
  return (
    <label className={cn("relative inline-flex cursor-pointer", className)}>
      <input type={kind} {...rest} className="peer sr-only" />
      <span className="inline-flex min-h-11 items-center gap-1.5 border-3 border-ink bg-card px-3 text-sm font-extrabold uppercase tracking-[0.04em] shadow-xs peer-checked:bg-ink peer-checked:text-paper peer-checked:shadow-none peer-focus-visible:outline-3 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ink peer-disabled:cursor-not-allowed peer-disabled:opacity-55 hover:bg-acid-tint peer-checked:hover:bg-ink">
        {label}
      </span>
    </label>
  );
}
