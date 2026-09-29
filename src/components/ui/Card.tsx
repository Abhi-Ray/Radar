import Link from "next/link";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "./cn";
import { TONE_SOLID, type Tone } from "./status";

export type CardShadow = "none" | "sm" | "md" | "lg";

const SHADOW: Record<CardShadow, string> = {
  none: "",
  sm: "shadow-sm",
  md: "shadow-md",
  lg: "shadow-lg",
};

export interface CardProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "section" | "article" | "aside" | "li";
  tone?: Tone;
  shadow?: CardShadow;
  /** Padding preset. Use "none" when composing CardHeader/CardBody/CardFooter. */
  pad?: "none" | "sm" | "md" | "lg";
  /** Whole card becomes a link (do not nest other links inside). */
  href?: string;
  /** Dashed ink border instead of solid (for pending/unknown/low-confidence surfaces). */
  dashed?: boolean;
  children?: ReactNode;
}

const PAD = { none: "", sm: "p-3", md: "p-4 md:p-5", lg: "p-5 md:p-7" } as const;

/** Flat surface, 3px ink border, hard shadow. */
export function Card({
  as = "div",
  tone = "card",
  shadow = "md",
  pad = "md",
  href,
  dashed,
  className,
  children,
  ...rest
}: CardProps) {
  const classes = cn(
    "relative min-w-0 border-3 border-ink",
    dashed && "border-dashed",
    TONE_SOLID[tone],
    tone === "ink" && "on-ink",
    SHADOW[shadow],
    PAD[pad],
    href && "block no-underline lift",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes} {...(rest as HTMLAttributes<HTMLAnchorElement>)}>
        {children}
      </Link>
    );
  }
  const Tag = as;
  return (
    <Tag className={classes} {...rest}>
      {children}
    </Tag>
  );
}

export interface CardHeaderProps {
  /** Micro label above the title, e.g. "04 · Visa & criteria". */
  kicker?: ReactNode;
  title: ReactNode;
  /** Heading level for the title. Default h3. */
  as?: "h2" | "h3" | "h4";
  actions?: ReactNode;
  /** Colour band behind the header. */
  band?: Tone;
  className?: string;
}

export function CardHeader({ kicker, title, as: H = "h3", actions, band, className }: CardHeaderProps) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b-3 border-ink px-4 py-3 md:px-5",
        band && TONE_SOLID[band],
        band === "ink" && "on-ink",
        className,
      )}
    >
      <div className="min-w-0">
        {kicker ? <p className="micro mb-1 opacity-80">{kicker}</p> : null}
        <H className="headline text-lg wide uppercase leading-none md:text-xl">{title}</H>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children?: ReactNode }) {
  return <div className={cn("px-4 py-4 md:px-5", className)}>{children}</div>;
}

export function CardFooter({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2 border-t-3 border-dashed border-ink px-4 py-3 md:px-5", className)}>
      {children}
    </div>
  );
}
