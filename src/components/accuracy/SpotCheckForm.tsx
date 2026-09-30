"use client";

import { useState } from "react";
import { InlineError, useKeepValuesAction } from "@/components/tracker/action-hooks";
import { SubmitButton, cn } from "@/components/ui";
import { ROLES } from "@/data/titles/roles";
import { LANGUAGE_REQUIREMENTS, REMOTE_CLASSES, SENIORITY_WORDS, VISA_STATUSES } from "@/db/schema/_enums";
import { spotCheckAction } from "@/lib/actions/accuracy";
import { ERROR_TYPES, ERROR_TYPE_LABEL, FIELD_LABEL, SPOT_FIELDS, errorName, fixName, valueName, verdictName, type SpotField } from "./labels";

export interface SpotJobView {
  id: number;
  /** What RADAR shows for each checked field, as text. */
  shown: Record<SpotField, string>;
}

const control = "min-h-11 min-w-44 border-3 border-ink bg-card px-3 text-sm";
const words = (v: string) => v.replaceAll("_", " ");

function options(list: readonly string[], none?: boolean) {
  return (
    <>
      <option value="">— I don&apos;t know —</option>
      {none ? <option value="none">none</option> : null}
      {list.map((v) => (
        <option key={v} value={v}>
          {words(v)}
        </option>
      ))}
    </>
  );
}

function FixControl({ field, value, onChange }: { field: SpotField; value: string; onChange: (v: string) => void }) {
  const name = valueName(field);
  const common = { name, value, onChange: (e: { target: { value: string } }) => onChange(e.target.value), className: control };
  switch (field) {
    case "role_key":
      return <select {...common}>{<>{options([], true)}{ROLES.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</>}</select>;
    case "seniority":
      return <select {...common}>{options(SENIORITY_WORDS, true)}</select>;
    case "visa_status":
      return <select {...common}>{options(VISA_STATUSES)}</select>;
    case "remote_class":
      return <select {...common}>{options(REMOTE_CLASSES)}</select>;
    case "language":
      return <select {...common}>{options(LANGUAGE_REQUIREMENTS)}</select>;
    case "country_iso2":
      return <input {...common} maxLength={2} placeholder="DE" autoComplete="off" className={cn(control, "uppercase")} />;
    case "experience_min_years":
      return <input {...common} type="number" min={0} max={40} step="any" placeholder="years" />;
    default:
      return null;
  }
}

/** One job of the weekly spot-check: mark each field correct / wrong / skip, with the fix when wrong. */
export function SpotCheckForm({ job }: { job: SpotJobView }) {
  const { state, onSubmit, formKey } = useKeepValuesAction(spotCheckAction);
  const [verdict, setVerdict] = useState<Record<string, "correct" | "wrong" | "skip">>({});
  const [fix, setFix] = useState<Record<string, string>>({});
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="jobId" value={job.id} />
      {SPOT_FIELDS.map((f) => {
        const v = verdict[f] ?? "skip";
        return (
          <fieldset key={f} className="grid gap-2 border-3 border-ink bg-card p-3 md:grid-cols-[13rem_minmax(0,1fr)]">
            <legend className="sr-only">{FIELD_LABEL[f]}</legend>
            <div className="min-w-0">
              <p className="micro">{FIELD_LABEL[f]}</p>
              <p className="font-bold [overflow-wrap:anywhere]">{job.shown[f]}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-2">
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={`${FIELD_LABEL[f]}: is it right?`}>
                {(["correct", "wrong", "skip"] as const).map((o) => (
                  <label
                    key={o}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center border-3 border-ink px-3 text-sm font-bold focus-within:outline focus-within:outline-2 focus-within:outline-offset-2",
                      v === o ? (o === "wrong" ? "bg-stamp text-paper" : o === "correct" ? "bg-radar" : "bg-acid") : "bg-paper",
                    )}
                  >
                    <input type="radio" name={verdictName(f)} value={o} checked={v === o} onChange={() => setVerdict((s) => ({ ...s, [f]: o }))} className="sr-only" />
                    {o === "correct" ? "✓ Right" : o === "wrong" ? "✗ Wrong" : "Skip"}
                  </label>
                ))}
              </div>
              {v === "wrong" ? (
                <div className="flex flex-wrap items-end gap-3">
                  <label className="flex flex-col gap-1">
                    <span className="micro">What kind of mistake?</span>
                    <select name={errorName(f)} defaultValue="wrong_value" className={control}>
                      {ERROR_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ERROR_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  {f !== "salary" ? (
                    <label className="flex flex-col gap-1">
                      <span className="micro">The right answer</span>
                      <FixControl field={f} value={fix[f] ?? ""} onChange={(x) => setFix((s) => ({ ...s, [f]: x }))} />
                      <input type="hidden" name={fixName(f)} value={fix[f] ? "1" : ""} />
                    </label>
                  ) : null}
                  <label className="flex min-w-48 flex-1 flex-col gap-1">
                    <span className="micro">Note (optional)</span>
                    <input name={`note_${f}`} maxLength={1000} autoComplete="off" className={control} />
                  </label>
                </div>
              ) : null}
            </div>
          </fieldset>
        );
      })}
      <div className="flex flex-wrap items-center gap-3">
        <SubmitButton variant="primary" icon="check" pendingLabel="Logging…">
          Log this job
        </SubmitButton>
        <InlineError state={state} />
      </div>
    </form>
  );
}
