import { cn } from "./cn";
import { formatDateTime, formatRelative, isStale, toDate, type DateInput } from "./format";
import { Icon } from "./icons";

export interface AsOfProps {
  at: DateInput;
  /** Prefix word. Default "As of". Use "Checked", "Seen", "Run" etc. */
  label?: string;
  /** Mark the chip STALE (signal) when older than this many hours. */
  staleAfterHours?: number;
  /** Reference time (tests / consistent server renders). */
  now?: DateInput;
  /** "chip" (bordered) or "inline" (plain text in a sentence). */
  variant?: "chip" | "inline";
  /** Show the relative part ("3h ago"). Default true. */
  relative?: boolean;
  onInk?: boolean;
  className?: string;
}

/** Every data view says how fresh it is. `<AsOf at={run.finishedAt} staleAfterHours={30} />` */
export function AsOf({
  at,
  label = "As of",
  staleAfterHours,
  now,
  variant = "chip",
  relative = true,
  onInk,
  className,
}: AsOfProps) {
  const date = toDate(at);
  const reference = now ?? new Date();
  const stale = date !== null && staleAfterHours !== undefined && isStale(date, staleAfterHours, reference);
  const absolute = formatDateTime(date, { fallback: "never" });
  const rel = date ? formatRelative(date, reference) : null;

  const body = (
    <>
      <span className="font-bold uppercase tracking-[0.12em]">{label}</span>{" "}
      {date ? (
        <time dateTime={date.toISOString()} title={absolute} suppressHydrationWarning>
          {absolute}
          {relative && rel ? <span className="opacity-75"> · {rel}</span> : null}
        </time>
      ) : (
        <span>never</span>
      )}
      {stale ? (
        <span className="ml-1 bg-signal px-1 font-bold uppercase text-ink">
          Stale
        </span>
      ) : null}
    </>
  );

  if (variant === "inline") {
    return <span className={cn("font-mono text-xs tabular", className)}>{body}</span>;
  }

  return (
    <span
      className={cn(
        "inline-flex min-h-7 max-w-full flex-wrap items-center gap-x-1 border-2 px-1.5 py-0.5 font-mono text-[0.6875rem] leading-tight tabular",
        onInk ? "border-paper text-paper" : "border-ink bg-card text-ink",
        stale && !onInk && "bg-signal-tint",
        !date && "border-dashed",
        className,
      )}
    >
      <Icon name="clock" size={12} />
      {body}
    </span>
  );
}
