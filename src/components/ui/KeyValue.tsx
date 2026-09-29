import type { ReactNode } from "react";
import { cn } from "./cn";

export interface KeyValueItem {
  label: ReactNode;
  value: ReactNode;
  /** Small text under the value (source, caveat). */
  hint?: ReactNode;
  /** Render the value in mono (numbers, codes). Default true. */
  mono?: boolean;
}

export interface KeyValueProps {
  items: KeyValueItem[];
  /** "rows" = label left / value right with rules; "grid" = labelled cells in 2–3 columns. */
  layout?: "rows" | "grid";
  columns?: 2 | 3;
  className?: string;
}

/** Definition list. Missing values should be passed as "Unknown" (or <Unknown/>), never omitted. */
export function KeyValue({ items, layout = "rows", columns = 2, className }: KeyValueProps) {
  if (layout === "grid") {
    return (
      <dl
        className={cn(
          "m-0 grid grid-cols-1 border-l-3 border-t-3 border-ink",
          columns === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2",
          className,
        )}
      >
        {items.map((item, i) => (
          <div key={i} className="min-w-0 border-r-3 border-b-3 border-ink bg-card px-3 py-2.5">
            <dt className="micro text-muted">{item.label}</dt>
            <dd className={cn("m-0 mt-1 font-bold [overflow-wrap:anywhere]", item.mono !== false && "font-mono tabular")}>{item.value}</dd>
            {item.hint ? <dd className="m-0 mt-0.5 text-xs text-muted">{item.hint}</dd> : null}
          </div>
        ))}
      </dl>
    );
  }
  return (
    <dl className={cn("m-0 divide-y-2 divide-dashed divide-ink/40 border-y-3 border-ink", className)}>
      {items.map((item, i) => (
        <div key={i} className="grid grid-cols-1 gap-x-4 gap-y-0.5 py-2 sm:grid-cols-[minmax(8rem,34%)_1fr]">
          <dt className="micro pt-0.5 text-muted">{item.label}</dt>
          <dd className="m-0 min-w-0">
            <span className={cn("font-bold [overflow-wrap:anywhere]", item.mono !== false && "font-mono tabular")}>{item.value}</span>
            {item.hint ? <span className="mt-0.5 block text-xs text-muted">{item.hint}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** First-class "Unknown": dashed, muted, never blank. */
export function Unknown({ children = "Unknown", className }: { children?: ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center border-2 border-dashed border-concrete-deep px-1.5 font-mono text-xs font-bold uppercase tracking-[0.1em] text-muted", className)}>
      {children}
    </span>
  );
}
