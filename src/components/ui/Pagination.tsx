import Link from "next/link";
import { cn } from "./cn";
import { formatNumber } from "./format";
import { Icon } from "./icons";
import { hrefWith, pageRange, pageWindow, type SearchParamsInput } from "./url";

export interface PaginationProps {
  /** Route the links point at ("/jobs"). */
  pathname: string;
  /** Current search params (filters are preserved). */
  searchParams?: SearchParamsInput;
  page: number;
  pageSize: number;
  total: number;
  pageParam?: string;
  /** Noun for the summary ("jobs"). */
  noun?: string;
  className?: string;
}

const CELL = "inline-flex min-h-11 min-w-11 items-center justify-center border-3 border-ink px-2 font-mono text-sm font-bold tabular no-underline";

/** Link-based pagination that keeps every other query param. */
export function Pagination({ pathname, searchParams = {}, page, pageSize, total, pageParam = "page", noun = "items", className }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const current = Math.min(Math.max(1, page), pages);
  const { from, to } = pageRange(current, pageSize, total);
  const href = (p: number) => hrefWith(pathname, searchParams, { [pageParam]: p === 1 ? null : p }, { pageParam });
  const tokens = pageWindow(current, pages);

  return (
    <nav aria-label="Pagination" className={cn("flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between", className)}>
      <p className="font-mono text-xs text-muted tabular" aria-live="polite">
        {total === 0 ? `No ${noun}` : `${formatNumber(from)}–${formatNumber(to)} of ${formatNumber(total)} ${noun}`}
      </p>
      {pages > 1 ? (
        <ul className="m-0 flex list-none flex-wrap items-center gap-1.5 p-0">
          <li>
            {current > 1 ? (
              <Link href={href(current - 1)} className={cn(CELL, "bg-card shadow-xs hover:bg-acid-tint")} rel="prev">
                <Icon name="arrow-left" size={16} />
                <span className="sr-only">Previous page</span>
              </Link>
            ) : (
              <span aria-hidden="true" className={cn(CELL, "border-dashed border-ink/40 text-ink/40")}>
                <Icon name="arrow-left" size={16} />
              </span>
            )}
          </li>
          {tokens.map((t, i) =>
            t === "gap" ? (
              <li key={`gap-${i}`} aria-hidden="true" className="px-1 font-mono text-sm font-bold text-muted">
                ···
              </li>
            ) : (
              <li key={t} className={cn(t !== current && Math.abs(t - current) > 1 && t !== 1 && t !== pages && "hidden sm:block")}>
                {t === current ? (
                  <span aria-current="page" className={cn(CELL, "bg-ink text-paper")}>
                    <span className="sr-only">Page </span>
                    {t}
                  </span>
                ) : (
                  <Link href={href(t)} className={cn(CELL, "bg-card shadow-xs hover:bg-acid-tint")}>
                    <span className="sr-only">Page </span>
                    {t}
                  </Link>
                )}
              </li>
            ),
          )}
          <li>
            {current < pages ? (
              <Link href={href(current + 1)} className={cn(CELL, "bg-acid shadow-xs")} rel="next">
                <Icon name="arrow-right" size={16} />
                <span className="sr-only">Next page</span>
              </Link>
            ) : (
              <span aria-hidden="true" className={cn(CELL, "border-dashed border-ink/40 text-ink/40")}>
                <Icon name="arrow-right" size={16} />
              </span>
            )}
          </li>
        </ul>
      ) : null}
    </nav>
  );
}
