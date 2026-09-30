/**
 * The application logbook: every application_events row, oldest first, numbered. Append-only —
 * a correction is a new line that says it is one. Server component.
 */
import type { ReactNode } from "react";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { formatDate, formatDateTime } from "@/components/ui/format";
import type { IconName } from "@/components/ui/icons";
import type { Tone } from "@/components/ui/status";
import type { ApplicationEventRow } from "@/db/schema";
import { PATCH_FIELD_LABELS, type ApplicationPatch } from "@/lib/tracker";
import { COMMENT_FIELDS, COMMENT_FIELD_LABELS, followUpOf, isCorrection, parseCommentMeta, parseEditMeta } from "@/lib/tracker/meta";
import { STAGE_META, isApplicationStage } from "@/lib/tracker/stages";

function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function Text({ children }: { children: string }) {
  return <p className="whitespace-pre-wrap">{children}</p>;
}

function stageName(s: string | null): string {
  return s && isApplicationStage(s) ? STAGE_META[s].label : "—";
}

function showValue(field: string, v: unknown, named: string | null | undefined, tz: string): string {
  if (named) return named;
  if (v === null || v === undefined || v === "") return "none";
  if (field === "appliedAt" && typeof v === "string") return formatDate(v, { tz });
  return String(v);
}

function EditBody({ e, tz }: { e: ApplicationEventRow; tz: string }) {
  const changes = parseEditMeta(e.metaJson);
  const names = obj(obj(e.metaJson).names);
  const body = e.body ?? "";
  const generated = body.startsWith("Changed ");
  return (
    <div className="flex flex-col gap-1.5">
      {changes.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {changes.map((c) => {
            const n = obj(names[c.field]);
            return (
              <li key={c.field} className="font-mono text-xs">
                <span className="font-bold uppercase">{PATCH_FIELD_LABELS[c.field as keyof ApplicationPatch] ?? c.field}</span>:{" "}
                <span className="line-through decoration-2 opacity-70">{showValue(c.field, c.before, typeof n.before === "string" ? n.before : null, tz)}</span> →{" "}
                <strong>{showValue(c.field, c.after, typeof n.after === "string" ? n.after : null, tz)}</strong>
              </li>
            );
          })}
        </ul>
      ) : null}
      {body && (!changes.length || !generated) ? <Text>{changes.length ? `Why: ${body}` : body}</Text> : null}
    </div>
  );
}

function CommentBody({ e }: { e: ApplicationEventRow }) {
  const meta = parseCommentMeta(e.metaJson);
  const filled = COMMENT_FIELDS.filter((f) => meta[f]);
  const body = e.body && !(filled.length && e.body === "Interview notes") ? e.body : null;
  return (
    <div className="flex flex-col gap-2">
      {body ? <Text>{body}</Text> : null}
      {filled.length ? (
        <dl className="m-0 grid gap-2 border-l-4 border-ink/30 pl-3 sm:grid-cols-2">
          {filled.map((f) => (
            <div key={f} className="min-w-0">
              <dt className="micro text-ink">{COMMENT_FIELD_LABELS[f]}</dt>
              <dd className="m-0 whitespace-pre-wrap text-ink-soft">{meta[f]}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

function entryFor(e: ApplicationEventRow, tz: string): TimelineEntry {
  const meta = obj(e.metaJson);
  let title: ReactNode;
  let body: ReactNode = e.body ? <Text>{e.body}</Text> : null;
  let icon: IconName = "dot";
  let tone: Tone = "card";
  switch (e.kind) {
    case "stage_change": {
      const to = e.stageTo && isApplicationStage(e.stageTo) ? STAGE_META[e.stageTo] : null;
      icon = to?.icon ?? "dot";
      tone = to?.tone ?? "card";
      if (isCorrection(e.metaJson)) {
        title = (
          <>
            Correction: {stageName(e.stageFrom)} → {stageName(e.stageTo)}
          </>
        );
        tone = "stamp";
        icon = "edit";
        body = e.body ? <Text>{`Why: ${e.body}`}</Text> : null;
      } else if (e.stageFrom === null) {
        title = <>{meta.manual === true ? "Logged by hand at" : "Tracked at"} {stageName(e.stageTo)}</>;
      } else if (e.stageFrom === e.stageTo) {
        title = <>Another {stageName(e.stageTo).toLowerCase()}</>;
      } else {
        title = (
          <>
            {stageName(e.stageFrom)} → {stageName(e.stageTo)}
          </>
        );
      }
      const closed = typeof meta.remindersClosed === "number" && meta.remindersClosed > 0 ? meta.remindersClosed : 0;
      if (closed) {
        body = (
          <>
            {body}
            <p className="font-mono text-xs text-muted">
              {closed} open reminder{closed === 1 ? "" : "s"} closed.
            </p>
          </>
        );
      }
      break;
    }
    case "comment": {
      const hasFields = Object.keys(parseCommentMeta(e.metaJson)).length > 0;
      title = hasFields ? "Interview notes" : "Note";
      icon = hasFields ? "user" : "quote";
      tone = hasFields ? "cobalt" : "paper";
      body = <CommentBody e={e} />;
      break;
    }
    case "follow_up_set": {
      const f = followUpOf(e.metaJson);
      icon = "clock";
      if (f.done) {
        const due = typeof meta.dueAt === "string" ? meta.dueAt : null;
        title = due ? `Followed up (was due ${formatDate(due, { tz })})` : "Followed up";
        tone = "radar";
        icon = "check";
        if (f.at) {
          body = (
            <>
              {body}
              <p className="font-mono text-xs text-muted">Next follow-up: {formatDateTime(f.at, { tz })}</p>
            </>
          );
        }
      } else if (f.at) {
        title = `Follow-up set for ${formatDateTime(f.at, { tz })}`;
        tone = "acid";
      } else {
        title = "Follow-up cleared";
        tone = "concrete";
      }
      break;
    }
    case "edit": {
      title = "Details changed";
      icon = "edit";
      tone = "lilac";
      body = <EditBody e={e} tz={tz} />;
      break;
    }
    case "snapshot": {
      title = "Posting copied again";
      icon = "copy";
      tone = "paper";
      break;
    }
    default:
      title = e.kind;
  }
  return { id: e.id, at: e.occurredAt, title, body, icon, tone, actor: "you" };
}

export function Logbook({ events, tz }: { events: ApplicationEventRow[]; tz: string }) {
  return (
    <Timeline
      entries={events.map((e) => entryFor(e, tz))}
      order="oldest"
      emptyText="Nothing logged yet."
      footer="Append-only logbook — entries are never edited or removed; corrections are new lines."
    />
  );
}
