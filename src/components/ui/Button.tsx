import Link from "next/link";
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "ink" | "signal";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANT: Record<ButtonVariant, string> = {
  primary: "bg-acid text-ink border-3 border-ink shadow-md press",
  secondary: "bg-card text-ink border-3 border-ink shadow-md press",
  ink: "bg-ink text-paper border-3 border-ink shadow-md press on-ink",
  signal: "bg-signal text-ink border-3 border-ink shadow-md press",
  danger: "bg-stamp-deep text-white border-3 border-ink shadow-md press",
  ghost:
    "bg-transparent text-ink border-3 border-transparent underline decoration-2 underline-offset-4 hover:bg-ink/5 hover:border-ink hover:no-underline active:translate-x-px active:translate-y-px",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "min-h-9 pointer-coarse:min-h-11 px-3 text-xs gap-1.5",
  md: "min-h-11 px-4 text-sm gap-2",
  lg: "min-h-14 px-6 text-base gap-2.5",
};

const ICON_SIZE: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 22 };

interface CommonProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: IconName;
  /** Trailing icon. */
  iconRight?: IconName;
  /** Shows the blinking block loader, sets aria-busy and disables the control. */
  pending?: boolean;
  /** Replaces the label while pending (e.g. "Saving…"). */
  pendingLabel?: ReactNode;
  fullWidth?: boolean;
  /** Icon-only: square button. Requires an aria-label. */
  square?: boolean;
  className?: string;
  children?: ReactNode;
}

export type ButtonAsButton = CommonProps &
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, keyof CommonProps> & { href?: undefined };

export type ButtonAsLink = CommonProps &
  Omit<AnchorHTMLAttributes<HTMLAnchorElement>, keyof CommonProps | "href"> & {
    href: string;
    /** Opens in a new tab with rel="noopener noreferrer" and a plain <a> (use for off-site links). */
    external?: boolean;
    prefetch?: boolean;
  };

export type ButtonProps = ButtonAsButton | ButtonAsLink;

export function buttonClasses({
  variant = "secondary",
  size = "md",
  fullWidth,
  square,
  className,
}: Pick<CommonProps, "variant" | "size" | "fullWidth" | "square" | "className"> = {}): string {
  return cn(
    "relative inline-flex select-none items-center justify-center whitespace-nowrap font-sans font-extrabold uppercase tracking-[0.06em] leading-none no-underline",
    "disabled:cursor-not-allowed disabled:opacity-55 aria-disabled:cursor-not-allowed aria-disabled:opacity-55",
    VARIANT[variant],
    SIZE[size],
    square && (size === "sm" ? "w-9 pointer-coarse:w-11 px-0" : size === "lg" ? "w-14 px-0" : "w-11 px-0"),
    fullWidth && "w-full",
    className,
  );
}

/** Three blocks that fill left→right; static under reduced motion. */
export function PendingBlocks({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn("inline-flex gap-[3px] animate-pending", className)}>
      <span className="size-[0.55em] bg-current" />
      <span className="size-[0.55em] bg-current" />
      <span className="size-[0.55em] bg-current" />
    </span>
  );
}

function Inner({ icon, iconRight, pending, pendingLabel, size = "md", children }: CommonProps) {
  const s = ICON_SIZE[size];
  return (
    <>
      {pending ? <PendingBlocks /> : icon ? <Icon name={icon} size={s} /> : null}
      {pending && pendingLabel ? pendingLabel : children}
      {!pending && iconRight ? <Icon name={iconRight} size={s} /> : null}
    </>
  );
}

/**
 * Brutal button. Renders `next/link` when `href` is given (plain `<a target=_blank>` with `external`).
 *
 * <Button variant="primary" icon="play">Run now</Button>
 * <Button href="/jobs?visa=confirmed" iconRight="arrow-right">Confirmed only</Button>
 */
export function Button(props: ButtonProps) {
  if (typeof props.href === "string") {
    const {
      variant,
      size,
      icon,
      iconRight,
      pending,
      pendingLabel,
      fullWidth,
      square,
      className,
      children,
      href,
      external,
      prefetch,
      ...rest
    } = props;
    const classes = buttonClasses({ variant, size, fullWidth, square, className });
    const inner = (
      <Inner icon={icon} iconRight={iconRight ?? (external ? "external" : undefined)} pending={pending} pendingLabel={pendingLabel} size={size}>
        {children}
      </Inner>
    );
    if (external) {
      return (
        <a {...rest} href={href} target="_blank" rel="noopener noreferrer" className={classes} aria-busy={pending || undefined}>
          {inner}
        </a>
      );
    }
    return (
      <Link {...rest} href={href} prefetch={prefetch} className={classes} aria-busy={pending || undefined}>
        {inner}
      </Link>
    );
  }

  const {
    variant,
    size,
    icon,
    iconRight,
    pending,
    pendingLabel,
    fullWidth,
    square,
    className,
    children,
    type = "button",
    disabled,
    href: _href,
    ...rest
  } = props;
  void _href;
  return (
    <button
      {...rest}
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={buttonClasses({ variant, size, fullWidth, square, className })}
    >
      <Inner icon={icon} iconRight={iconRight} pending={pending} pendingLabel={pendingLabel} size={size}>
        {children}
      </Inner>
    </button>
  );
}
