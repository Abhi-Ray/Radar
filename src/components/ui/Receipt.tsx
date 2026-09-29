import type { ReactNode } from "react";
import { AsOf } from "./AsOf";
import { cn } from "./cn";
import { ConfidenceMeter } from "./ConfidenceMeter";
import type { DateInput } from "./format";
import { Icon } from "./icons";
import { MethodTag } from "./MethodTag";
import type { ConfidenceLevel, MethodKind } from "./status";
import { safeExternalHref } from "./url";

export interface ReceiptRow {
  label: ReactNode;
  value: ReactNode;
  /** Emphasise (total line). */
  strong?: boolean;
}

export interface ReceiptProps {
  /** What this receipt proves ("Visa sponsorship", "Salary", "Remote"). */
  title: ReactNode;
  /** The displayed value, big. */
  value?: ReactNode;
  /** Optional printed serial ("#F-00412"). */
  serial?: string;
  rows?: ReceiptRow[];
  /** Exact quote the fact was taken from (never paraphrased). */
  quote?: string | null;
  /** Where the quote/value came from. */
  source?: ReactNode;
  /** Link to the original (opens off-site, rel=noopener noreferrer). */
  sourceHref?: string | null;
  method?: MethodKind | string | null;
  confidence?: ConfidenceLevel | string | null;
  checkedAt?: DateInput;
  /** Logic/rule/parser/prompt version that produced it ("visa-rules@2026-09-01.2"). */
  logicVersion?: string | null;
  /** Anything else, printed below the meta block (e.g. "Superseded by manual override"). */
  footnote?: ReactNode;
  /** Extra content between value and rows (e.g. a Stamp). */
  children?: ReactNode;
  /** Narrow receipts inside grids. */
  compact?: boolean;
  className?: string;
}

function Dots() {
  return <span aria-hidden="true" className="mx-1 min-w-4 flex-1 translate-y-[-0.28em] border-b-2 border-dotted border-ink/50" />;
}

/**
 * Provenance slip: value · evidence quote · source · method · confidence · checked at · logic version.
 * Monospace, zig-zag torn edges, perforated divisions.
 */
export function Receipt({
  title,
  value,
  serial,
  rows,
  quote,
  source,
  sourceHref,
  method,
  confidence,
  checkedAt,
  logicVersion,
  footnote,
  children,
  compact,
  className,
}: ReceiptProps) {
  // Data-driven URL: only http(s) becomes a link; anything else falls back to plain text.
  const href = safeExternalHref(sourceHref);
  const hasMeta = source || href || method || confidence || checkedAt || logicVersion;
  return (
    <figure className={cn("receipt-frame relative m-0 min-w-0 max-w-full", className)}>
      <div className={cn("zigzag bg-card font-mono text-ink", compact ? "px-3 py-5 text-xs" : "px-4 py-6 text-sm md:px-5")}>
        <figcaption className="flex items-baseline justify-between gap-3 border-b-2 border-ink pb-1.5">
          <span className="micro flex items-center gap-1.5">
            <Icon name="receipt" size={14} />
            {title}
          </span>
          {serial ? <span className="text-[0.6875rem] tabular text-muted">{serial}</span> : null}
        </figcaption>

        {value !== undefined && value !== null ? (
          <div className={cn("headline mt-3 break-words font-mono tabular", compact ? "text-xl" : "text-2xl md:text-3xl")}>{value}</div>
        ) : null}

        {children ? <div className="mt-3">{children}</div> : null}

        {rows && rows.length > 0 ? (
          <dl className="mt-3 space-y-1">
            {rows.map((row, i) => (
              <div key={i} className={cn("flex items-baseline", row.strong && "border-t-2 border-ink pt-1 font-bold")}>
                <dt className="shrink-0 uppercase text-muted">{row.label}</dt>
                <Dots />
                <dd className="m-0 min-w-0 text-right tabular [overflow-wrap:anywhere]">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}

        {quote ? (
          <blockquote className="relative mt-4 border-l-4 border-ink bg-paper px-3 py-2 italic leading-snug [overflow-wrap:anywhere]">
            <span className="sr-only">Evidence quote: </span>
            <span aria-hidden="true" className="headline absolute -top-3 left-1 bg-card px-0.5 text-2xl not-italic leading-none">
              “
            </span>
            {quote}
          </blockquote>
        ) : null}

        {hasMeta ? (
          <>
            <hr className="perforation my-4" />
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5 text-xs">
              {source || href ? (
                <>
                  <dt className="micro text-muted">Source</dt>
                  <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-cobalt-deep underline decoration-2 underline-offset-2">
                        {source ?? "Original"}
                        <Icon name="external" size={12} className="ml-0.5 inline align-[-1px]" />
                        <span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      source
                    )}
                  </dd>
                </>
              ) : null}
              {method ? (
                <>
                  <dt className="micro text-muted">Method</dt>
                  <dd className="m-0">
                    <MethodTag method={method} variant="long" />
                  </dd>
                </>
              ) : null}
              {confidence !== undefined ? (
                <>
                  <dt className="micro text-muted">Conf.</dt>
                  <dd className="m-0">
                    <ConfidenceMeter level={confidence} size="sm" />
                  </dd>
                </>
              ) : null}
              {checkedAt !== undefined ? (
                <>
                  <dt className="micro text-muted">Checked</dt>
                  <dd className="m-0">
                    <AsOf at={checkedAt} label="" variant="inline" />
                  </dd>
                </>
              ) : null}
              {logicVersion ? (
                <>
                  <dt className="micro text-muted">Logic</dt>
                  <dd className="m-0 min-w-0 text-[0.6875rem] [overflow-wrap:anywhere]">{logicVersion}</dd>
                </>
              ) : null}
            </dl>
          </>
        ) : null}

        {footnote ? <p className="mt-3 border-t-2 border-dashed border-ink pt-2 text-xs">{footnote}</p> : null}
      </div>
    </figure>
  );
}
