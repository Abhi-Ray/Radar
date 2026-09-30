"use client";

/**
 * The per-job tailoring checklist. Ticks are kept in this browser only (localStorage, one key per
 * job) — they are working notes, not records; the application's logbook is the record.
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Textarea } from "@/components/ui/Input";
import { CopyButton } from "./CopyButton";
import type { ChecklistStep } from "./tailoring";

const key = (jobId: number) => `radar.tailor.${jobId}`;
/** Same-tab writes do not fire "storage"; this event tells the other subscribers. */
const LOCAL_EVENT = "radar:tailor";

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  window.addEventListener(LOCAL_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(LOCAL_EVENT, onChange);
  };
}

function readRaw(jobId: number): string {
  try {
    return window.localStorage.getItem(key(jobId)) ?? "[]";
  } catch {
    return "[]";
  }
}

function parseTicks(raw: string | null): string[] | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 50) : [];
  } catch {
    return [];
  }
}

export function TailorChecklist({ jobId, steps }: { jobId: number; steps: ChecklistStep[] }) {
  // null on the server and during hydration, then the stored ticks.
  const raw = useSyncExternalStore(subscribe, () => readRaw(jobId), () => null);
  const done = useMemo(() => parseTicks(raw), [raw]);
  const ticks = done ?? [];
  const save = (next: string[]) => {
    try {
      if (next.length) window.localStorage.setItem(key(jobId), JSON.stringify(next));
      else window.localStorage.removeItem(key(jobId));
    } catch {
      // Storage full or blocked (private mode): nothing to keep.
    }
    window.dispatchEvent(new Event(LOCAL_EVENT));
  };
  const toggle = (id: string, on: boolean) => save(on ? [...ticks.filter((t) => t !== id), id] : ticks.filter((t) => t !== id));
  const count = steps.filter((s) => ticks.includes(s.id)).length;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="micro text-ink" aria-live="polite">
          {done === null ? "Checklist" : `${count} of ${steps.length} done`}
        </p>
        {count ? (
          <Button type="button" variant="ghost" size="sm" icon="refresh" onClick={() => save([])}>
            Untick all
          </Button>
        ) : null}
      </div>
      <div aria-hidden="true" className="flex h-3 gap-0.5">
        {steps.map((s) => (
          <span key={s.id} className={`flex-1 border-2 border-ink ${ticks.includes(s.id) ? "bg-radar" : "bg-card"}`} />
        ))}
      </div>
      <ol className="m-0 flex list-none flex-col divide-y-2 divide-dashed divide-ink/30 p-0">
        {steps.map((s, i) => (
          <li key={s.id}>
            <Checkbox
              id={`tailor-${jobId}-${s.id}`}
              checked={ticks.includes(s.id)}
              disabled={done === null}
              onChange={(e) => toggle(s.id, e.currentTarget.checked)}
              label={
                <span className={ticks.includes(s.id) ? "line-through decoration-2 opacity-70" : undefined}>
                  <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")} </span>
                  {s.label}
                </span>
              }
              description={s.detail ?? undefined}
            />
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">Ticks are saved in this browser only.</p>
    </div>
  );
}

export function WhyLine({ initial, company }: { initial: string; company: string }) {
  const [text, setText] = useState(initial);
  return (
    <div className="flex flex-col gap-2">
      <Field label={`Why ${company}`} hint="A draft from what RADAR knows — make it yours: one specific reason, then the fit.">
        {(p) => <Textarea {...p} value={text} onChange={(e) => setText(e.currentTarget.value)} rows={3} maxLength={1000} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <CopyButton text={text.trim()} label="Copy the line" what="Why-this-company line" variant="primary" />
        {text !== initial ? (
          <Button type="button" variant="ghost" size="sm" icon="refresh" onClick={() => setText(initial)}>
            Back to the draft
          </Button>
        ) : null}
      </div>
    </div>
  );
}
