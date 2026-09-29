import Link from "next/link";
import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";
import { hrefWith, type SearchParamsInput } from "./url";

/* ---------------- Primitives (for bespoke tables) ---------------- */

export function Table({ className, children, caption, ...rest }: HTMLAttributes<HTMLTableElement> & { caption?: ReactNode }) {
  return (
    <div className="min-w-0 overflow-x-auto border-3 border-ink bg-card shadow-md">
      <table {...rest} className={cn("w-full border-collapse text-left text-sm", className)}>
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function THead({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead {...rest} className={cn("bg-ink text-paper", className)} />;
}

export function TBody({ className, ...rest }: HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody {...rest} className={cn("[&>tr:nth-child(even)]:bg-paper/60", className)} />;
}

export function TR({ className, ...rest }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr {...rest} className={cn("border-b-2 border-ink/25 last:border-b-0 hover:bg-acid-tint/60", className)} />;
}

export function TH({ className, scope = "col", ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th {...rest} scope={scope} className={cn("micro whitespace-nowrap px-3 py-2.5 align-bottom font-extrabold", className)} />;
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td {...rest} className={cn("px-3 py-2.5 align-top", className)} />;
}

/* ---------------- DataTable ---------------- */

export type MobileRole = "primary" | "secondary" | "badge" | "field" | "hidden";

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: "left" | "right" | "center";
  /** Tailwind width class for the desktop column ("w-24"). */
  width?: string;
  /** How the column appears on the stacked mobile card. Default "field". */
  mobile?: MobileRole;
  /** Makes the header a sort link using this key (?sort=key&dir=asc|desc). */
  sortKey?: string;
  /** Mono/tabular cell text. */
  numeric?: boolean;
  className?: string;
}

export interface SortState {
  pathname: string;
  searchParams?: SearchParamsInput;
  /** Active sort key and direction. */
  sort?: string | null;
  dir?: "asc" | "desc" | null;
  sortParam?: string;
  dirParam?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string | number;
  /** Where a row leads; the primary cell becomes the link. */
  rowHref?: (row: T) => string | undefined;
  /** Accessible table caption (visually hidden). */
  caption: string;
  empty?: ReactNode;
  sort?: SortState;
  /** Extra row classes (e.g. dim stale jobs). */
  rowClassName?: (row: T) => string | undefined;
  className?: string;
}

function alignClass(align: Column<unknown>["align"]) {
  return align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
}

function SortHeader<T>({ col, sort }: { col: Column<T>; sort: SortState }) {
  const sortParam = sort.sortParam ?? "sort";
  const dirParam = sort.dirParam ?? "dir";
  const active = sort.sort === col.sortKey;
  const nextDir = active && sort.dir !== "desc" ? "desc" : "asc";
  const href = hrefWith(sort.pathname, sort.searchParams ?? {}, { [sortParam]: col.sortKey, [dirParam]: nextDir });
  return (
    <Link href={href} scroll={false} className="on-ink inline-flex min-h-8 items-center gap-1 text-paper no-underline hover:text-acid">
      {col.header}
      <Icon name={active ? (sort.dir === "desc" ? "arrow-down" : "arrow-up") : "sort"} size={14} className={active ? "text-acid" : "opacity-60"} />
      <span className="sr-only">{active ? `, sorted ${sort.dir === "desc" ? "descending" : "ascending"}` : ", sortable"}</span>
    </Link>
  );
}

/**
 * Desktop: a real <table> with sortable headers. Mobile (<768px): each row becomes a stacked card —
 * primary column as the title (linked), secondary under it, badges in a row, remaining fields as a
 * compact definition list. Both are server-rendered; CSS picks one.
 */
export function DataTable<T>({ rows, columns, rowKey, rowHref, caption, empty, sort, rowClassName, className }: DataTableProps<T>) {
  if (rows.length === 0) {
    return <div className={className}>{empty ?? <p className="border-3 border-dashed border-ink bg-card p-5 font-mono text-sm">Nothing here.</p>}</div>;
  }

  const primary = columns.find((c) => c.mobile === "primary") ?? columns[0];
  const secondary = columns.filter((c) => c.mobile === "secondary");
  const badges = columns.filter((c) => c.mobile === "badge");
  const fields = columns.filter((c) => c !== primary && (c.mobile ?? "field") === "field");

  return (
    <div className={className}>
      {/* Desktop */}
      <div className="hidden min-w-0 overflow-x-auto border-3 border-ink bg-card shadow-md md:block">
        <table className="w-full border-collapse text-left text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead className="bg-ink text-paper">
            <tr>
              {columns.map((col) => {
                const active = sort && col.sortKey && sort.sort === col.sortKey;
                return (
                  <th
                    key={col.key}
                    scope="col"
                    aria-sort={active ? (sort?.dir === "desc" ? "descending" : "ascending") : undefined}
                    className={cn("micro whitespace-nowrap px-3 py-2.5 align-bottom font-extrabold", alignClass(col.align), col.width)}
                  >
                    {sort && col.sortKey ? <SortHeader col={col} sort={sort} /> : col.header}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const href = rowHref?.(row);
              return (
                <tr key={rowKey(row)} className={cn("border-b-2 border-ink/25 last:border-b-0 even:bg-paper/60 hover:bg-acid-tint/60", rowClassName?.(row))}>
                  {columns.map((col) => {
                    const content = col.cell(row);
                    const isPrimary = col === primary;
                    return (
                      <td
                        key={col.key}
                        className={cn("px-3 py-2.5 align-top", alignClass(col.align), col.numeric && "font-mono tabular", col.className)}
                      >
                        {isPrimary && href ? (
                          <Link href={href} className="font-extrabold text-ink underline decoration-2 underline-offset-4 hover:bg-acid hover:no-underline">
                            {content}
                          </Link>
                        ) : (
                          content
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <ul aria-label={caption} className="m-0 flex list-none flex-col gap-3 p-0 md:hidden">
        {rows.map((row) => {
          const href = rowHref?.(row);
          const title = primary.cell(row);
          return (
            <li key={rowKey(row)} className={cn("min-w-0 border-3 border-ink bg-card shadow-sm", rowClassName?.(row))}>
              <div className="border-b-2 border-ink px-3 py-2.5">
                <p className="text-base font-extrabold leading-snug [overflow-wrap:anywhere]">
                  {href ? (
                    <Link href={href} className="text-ink underline decoration-2 underline-offset-4">
                      {title}
                    </Link>
                  ) : (
                    title
                  )}
                </p>
                {secondary.map((c) => (
                  <div key={c.key} className="mt-0.5 text-sm text-ink-soft">
                    {c.cell(row)}
                  </div>
                ))}
              </div>
              {badges.length ? (
                <div className="flex flex-wrap items-center gap-2 border-b-2 border-dashed border-ink/40 px-3 py-2">
                  {badges.map((c) => (
                    <span key={c.key} className="inline-flex">
                      {c.cell(row)}
                    </span>
                  ))}
                </div>
              ) : null}
              {fields.length ? (
                <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2 px-3 py-2.5">
                  {fields.map((c) => (
                    <div key={c.key} className="min-w-0">
                      <dt className="micro text-muted">{c.header}</dt>
                      <dd className={cn("m-0 text-sm [overflow-wrap:anywhere]", c.numeric && "font-mono tabular")}>{c.cell(row)}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
