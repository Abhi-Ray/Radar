import type { ReactNode } from "react";
import { cn } from "./cn";
import { formatDate, formatTime, toDate, type DateInput } from "./format";
import { Icon, type IconName } from "./icons";
import { TONE_SOLID, type Tone } from "./status";

export interface TimelineEntry {
  id: string | number;
  at: DateInput;
  title: ReactNode;
  body?: ReactNode;
  /** Who/what wrote it ("you", "pipeline", "linkcheck"). */
  actor?: ReactNode;
  icon?: IconName;
  tone?: Tone;
}

export interface TimelineProps {
  entries: TimelineEntry[];
  /** Newest first (default) or oldest first. */
  order?: "newest" | "oldest";
  /** Footer line that makes the append-only nature explicit. */
  footer?: ReactNode;
  emptyText?: ReactNode;
  className?: string;
}

/**
 * Logbook: numbered entries on a ruled spine. Entries are never edited in place —
 * corrections are new lines. Numbers count from the first entry, so they're stable.
 */
export function Timeline({
  entries,
  order = "newest",
  footer = "Append-only log — entries are never edited or removed.",
  emptyText = "No entries yet.",
  className,
}: TimelineProps) {
  const sorted = [...entries].sort((a, b) => {
    const ta = toDate(a.at)?.getTime() ?? 0;
    const tb = toDate(b.at)?.getTime() ?? 0;
    return order === "newest" ? tb - ta : ta - tb;
  });
  const total = sorted.length;

  return (
    <div className={cn("border-3 border-ink bg-card", className)}>
      {total === 0 ? (
        <p className="px-4 py-5 font-mono text-sm text-muted">{emptyText}</p>
      ) : (
        <ol className="m-0 list-none p-0">
          {sorted.map((entry, i) => {
            const n = order === "newest" ? total - i : i + 1;
            const d = toDate(entry.at);
            return (
              <li key={entry.id} className="grid grid-cols-[3.25rem_1fr] border-b-2 border-dashed border-ink/40 last:border-b-0 sm:grid-cols-[4.5rem_1fr]">
                <div className="flex flex-col items-center gap-1.5 border-r-3 border-ink bg-paper py-3">
                  <span className="font-mono text-[0.625rem] font-bold text-muted tabular">#{String(n).padStart(3, "0")}</span>
                  <span
                    aria-hidden="true"
                    className={cn("flex size-7 items-center justify-center border-2 border-ink", TONE_SOLID[entry.tone ?? "card"])}
                  >
                    <Icon name={entry.icon ?? "dot"} size={14} />
                  </span>
                </div>
                <div className="min-w-0 px-3 py-3 md:px-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                    <p className="font-extrabold leading-snug">{entry.title}</p>
                    <p className="font-mono text-[0.6875rem] text-muted tabular">
                      {d ? (
                        <time dateTime={d.toISOString()}>
                          {formatDate(d)} · {formatTime(d)}
                        </time>
                      ) : (
                        "undated"
                      )}
                      {entry.actor ? <> · {entry.actor}</> : null}
                    </p>
                  </div>
                  {entry.body ? <div className="mt-1 text-sm leading-relaxed text-ink-soft [overflow-wrap:anywhere]">{entry.body}</div> : null}
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {footer ? (
        <p className="flex items-center gap-2 border-t-3 border-ink bg-ink px-3 py-1.5 font-mono text-[0.6875rem] uppercase tracking-[0.1em] text-paper">
          <Icon name="lock" size={12} />
          {footer}
        </p>
      ) : null}
    </div>
  );
}
