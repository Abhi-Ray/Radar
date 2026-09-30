/**
 * Every reminder of one application: the open one(s) as a sticky note with "Done", the closed ones
 * as a short struck-through list. Server component.
 */
import { cn } from "@/components/ui/cn";
import { formatDate, formatDateTime } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import type { ReminderRow } from "@/db/schema";
import { reminderBucket } from "@/lib/tracker/follow-up";
import { ReminderDone } from "../ReminderDone";

const OPEN_TONE = { overdue: "bg-stamp-tint", today: "bg-signal-tint", soon: "bg-acid-tint", later: "bg-card" } as const;

export function ReminderHistory({ reminders, now, tz }: { reminders: ReminderRow[]; now: Date; tz: string }) {
  const open = reminders.filter((r) => !r.doneAt);
  const done = reminders.filter((r) => r.doneAt);
  if (!reminders.length) return <p className="text-sm text-ink-soft">No reminders yet.</p>;
  return (
    <div className="flex flex-col gap-3">
      {open.length ? (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {open.map((r) => {
            const bucket = reminderBucket(r.dueAt, now, tz);
            return (
              <li key={r.id} className={cn("relative flex flex-col gap-2 border-3 border-ink p-3 pt-4 shadow-sm -rotate-[0.6deg] motion-reduce:rotate-0", OPEN_TONE[bucket])}>
                <span aria-hidden="true" className="absolute -top-2.5 left-1/2 h-4 w-14 -translate-x-1/2 border-2 border-ink/40 bg-paper-deep/90" />
                <p className="micro flex items-center gap-1 text-ink">
                  <Icon name={bucket === "overdue" ? "alert" : "clock"} size={14} />
                  {bucket === "overdue" ? "Overdue" : bucket === "today" ? "Due today" : "Open"}
                </p>
                <p className="font-mono text-sm font-bold tabular">{formatDateTime(r.dueAt, { tz, zone: true })}</p>
                {r.note ? <p className="whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{r.note}</p> : null}
                <div>
                  <ReminderDone reminderId={r.id} label="Followed up" />
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
      {done.length ? (
        <details className="group">
          <summary className="micro flex min-h-11 cursor-pointer items-center gap-2 text-ink">
            <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            Closed reminders ({done.length})
          </summary>
          <ul className="m-0 mt-1 flex list-none flex-col divide-y-2 divide-dashed divide-ink/30 p-0">
            {done.map((r) => (
              <li key={r.id} className="py-2 text-sm">
                <span className="font-mono text-xs tabular line-through decoration-2 opacity-70">{formatDate(r.dueAt, { tz })}</span>{" "}
                <span className="font-mono text-xs text-muted">· closed {formatDate(r.doneAt, { tz })}</span>
                {r.note ? <span className="block text-ink-soft [overflow-wrap:anywhere]">{r.note}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
