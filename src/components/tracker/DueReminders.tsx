/**
 * Follow-ups due now or in the next few days, as sticky notes on the board (overdue first).
 * Server component; "Done" is a small client form.
 */
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { formatDate, formatTime, tzLabel } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import type { DueReminder } from "@/lib/queries/applications";
import { localDayDiff, type ReminderBucket } from "@/lib/tracker/follow-up";
import { STAGE_META } from "@/lib/tracker/stages";
import { ReminderDone } from "./ReminderDone";

const NOTE_TONE: Record<ReminderBucket, string> = {
  overdue: "bg-stamp-tint",
  today: "bg-signal-tint",
  soon: "bg-acid-tint",
  later: "bg-card",
};

const TILT = ["-rotate-1", "rotate-1", "-rotate-[0.6deg]", "rotate-[0.8deg]"];

function when(r: DueReminder, now: Date, tz: string): string {
  if (r.bucket === "overdue") {
    const d = -localDayDiff(r.dueAt, now, tz);
    return d <= 0 ? "Overdue" : `Overdue · ${d}d`;
  }
  if (r.bucket === "today") return "Today";
  const d = localDayDiff(r.dueAt, now, tz);
  return d === 1 ? "Tomorrow" : `In ${d} days`;
}

export function StickyNote({ r, now, tz, index }: { r: DueReminder; now: Date; tz: string; index: number }) {
  return (
    <li className={cn("relative flex min-w-0 flex-col gap-2 border-3 border-ink p-3 pt-4 shadow-md motion-reduce:rotate-0", NOTE_TONE[r.bucket], TILT[index % TILT.length])}>
      <span aria-hidden="true" className="absolute -top-2.5 left-1/2 h-4 w-16 -translate-x-1/2 border-2 border-ink/40 bg-paper-deep/90" />
      <p className="micro flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-ink">
          <Icon name={r.bucket === "overdue" ? "alert" : "clock"} size={14} />
          {when(r, now, tz)}
        </span>
        <span className="font-mono text-muted tabular">
          {formatDate(r.dueAt, { tz, year: false })} {formatTime(r.dueAt, { tz })} {tzLabel(tz)}
        </span>
      </p>
      <p className="min-w-0 leading-snug">
        <Link href={`/applications/${r.applicationId}`} className="font-extrabold underline decoration-2 underline-offset-4 [overflow-wrap:anywhere]">
          {r.title}
        </Link>
        <span className="block text-sm text-ink-soft">
          {r.companyName} · {STAGE_META[r.stage].label}
        </span>
      </p>
      {r.note ? <p className="text-sm italic [overflow-wrap:anywhere]">“{r.note}”</p> : null}
      <div className="mt-auto flex justify-end">
        <ReminderDone reminderId={r.id} />
      </div>
    </li>
  );
}

export function DueReminders({ due, now, tz }: { due: DueReminder[]; now: Date; tz: string }) {
  if (!due.length) return null;
  const urgent = due.filter((d) => d.bucket === "overdue" || d.bucket === "today").length;
  return (
    <section aria-labelledby="due-title" className="flex flex-col gap-3">
      <h2 id="due-title" className="flex flex-wrap items-baseline gap-x-3 text-lg font-black uppercase tracking-[0.04em]">
        Follow-ups
        <span className="font-mono text-xs font-bold normal-case tracking-normal text-ink-soft">
          {urgent ? `${urgent} due now` : "nothing due today"} · {due.length - urgent} in the next few days
        </span>
      </h2>
      <ul className="m-0 grid list-none gap-5 p-0 pt-2 sm:grid-cols-2 xl:grid-cols-3">
        {due.map((r, i) => (
          <StickyNote key={r.id} r={r} now={now} tz={tz} index={i} />
        ))}
      </ul>
    </section>
  );
}
