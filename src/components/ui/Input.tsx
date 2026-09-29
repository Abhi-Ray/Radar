import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

/** Shared control chrome: 3px ink, card fill, 16px text (no iOS zoom), 44px tall. */
export const CONTROL =
  "w-full min-w-0 border-3 border-ink bg-card text-base text-ink shadow-[inset_3px_3px_0_0_var(--color-paper-deep)] " +
  "placeholder:text-muted disabled:cursor-not-allowed disabled:bg-paper-deep disabled:text-muted " +
  "aria-invalid:border-stamp-deep aria-invalid:bg-stamp-tint focus-visible:outline-offset-2 focus-visible:bg-white read-only:bg-paper";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /** Leading icon inside the field. */
  icon?: IconName;
  /** Trailing unit/suffix ("EUR", "/yr"). */
  suffix?: ReactNode;
  /** Monospace value (numbers, codes, URLs). */
  mono?: boolean;
}

export function Input({ icon, suffix, mono, className, type = "text", ...rest }: InputProps) {
  const input = (
    <input
      type={type}
      {...rest}
      className={cn(CONTROL, "min-h-11 px-3 py-2", mono && "font-mono tabular", icon && "pl-10", suffix ? "pr-14" : null, !icon && !suffix && className)}
    />
  );
  if (!icon && !suffix) return input;
  return (
    <div className={cn("relative min-w-0", className)}>
      {icon ? (
        <Icon name={icon} size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink" />
      ) : null}
      {input}
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center border-l-3 border-ink bg-paper-deep px-2 font-mono text-xs font-bold uppercase">
          {suffix}
        </span>
      ) : null}
    </div>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options?: SelectOption[];
  /** First empty option ("Any country"). */
  placeholder?: string;
}

export function Select({ options, placeholder, className, children, ...rest }: SelectProps) {
  return (
    <div className={cn("relative min-w-0", className)}>
      <select {...rest} className={cn(CONTROL, "min-h-11 cursor-pointer appearance-none py-2 pr-11 pl-3 font-bold")}>
        {placeholder !== undefined ? <option value="">{placeholder}</option> : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center border-l-3 border-ink bg-acid">
        <Icon name="chevron-down" size={18} />
      </span>
    </div>
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  mono?: boolean;
}

export function Textarea({ mono, className, rows = 4, ...rest }: TextareaProps) {
  return <textarea rows={rows} {...rest} className={cn(CONTROL, "block resize-y px-3 py-2 leading-relaxed", mono && "font-mono text-sm", className)} />;
}
