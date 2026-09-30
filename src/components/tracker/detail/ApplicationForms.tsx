"use client";

/**
 * The /applications/[id] forms (client): move the stage (or correct it, with a reason), add a
 * comment with the interview fields, set / clear the follow-up, record the resume version, edit
 * the details, copy the posting again. Each posts to a server action and appends to the logbook.
 */
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  addCommentAction,
  changeStageAction,
  editApplicationAction,
  setFollowUpAction,
  setResumeVersionAction,
  snapshotAction,
} from "@/lib/actions/applications";
import { COMMENT_FIELD_LABELS, MAX_COMMENT_FIELD } from "@/lib/tracker/meta";
import { STAGE_META, correctionStages, isClosedStage, nextStages, type ApplicationStage } from "@/lib/tracker/stages";
import { InlineError, useKeepValuesAction, useLazyModal } from "../action-hooks";

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">{children}</div>;
}

// ---- stage -----------------------------------------------------------------------------------

export function StageForm({ applicationId, stage, today }: { applicationId: number; stage: ApplicationStage; today: string }) {
  const normal = nextStages(stage);
  const [correction, setCorrection] = useState(normal.length === 0);
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(changeStageAction, {
    errorTitle: "Stage not changed",
    onOk: () => setCorrection(nextStages(stage).length === 0),
  });
  const options = correction ? correctionStages(stage) : normal;
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      {correction ? <input type="hidden" name="correction" value="1" /> : null}
      <Field label={correction ? "Correct the stage to" : "Move to"} hint={correction ? "Any stage — it is logged as a correction with your reason." : "The next normal steps from here."}>
        {(p) => (
          <Select
            key={correction ? "c" : "n"}
            {...p}
            name="stageTo"
            defaultValue={options[0]}
            options={options.map((s) => ({ value: s, label: `${STAGE_META[s].label}${s === stage ? " (again)" : ""}` }))}
          />
        )}
      </Field>
      <Checkbox
        id={`stage-correction-${applicationId}`}
        checked={correction}
        onChange={(e) => setCorrection(e.currentTarget.checked)}
        disabled={normal.length === 0}
        label="This is a correction"
        description={normal.length === 0 ? `“${STAGE_META[stage].label}” is closed — only a correction can move it.` : "Going back, or reopening — needs a reason."}
      />
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
        <Field label={correction ? "Reason" : "Note"} required={correction} optional={!correction} hint={correction ? "Why the logbook was wrong." : "Who called, what they said."}>
          {(p) => <Textarea {...p} name="note" rows={2} maxLength={4000} minLength={correction ? 3 : undefined} />}
        </Field>
        <Field label="When" optional hint="Empty = now.">
          {(p) => <Input {...p} type="date" name="occurredDay" max={today} mono />}
        </Field>
      </div>
      <InlineError state={state} />
      <Actions>
        <SubmitButton variant={correction ? "danger" : "primary"} icon={correction ? "edit" : "arrow-right"} pending={pending} pendingLabel="Logging…">
          {correction ? "Log the correction" : "Move stage"}
        </SubmitButton>
      </Actions>
    </form>
  );
}

// ---- comment ---------------------------------------------------------------------------------

export function CommentForm({ applicationId, today }: { applicationId: number; today: string }) {
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(addCommentAction, { errorTitle: "Not added" });
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Field label="Comment" optional hint="Anything worth remembering. Or just fill in the interview fields.">
        {(p) => <Textarea {...p} name="body" rows={3} maxLength={20_000} />}
      </Field>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={COMMENT_FIELD_LABELS.interviewer} optional>
          {(p) => <Input {...p} name="interviewer" maxLength={MAX_COMMENT_FIELD} autoComplete="off" placeholder="Name, role" />}
        </Field>
        <Field label="When" optional hint="Empty = now.">
          {(p) => <Input {...p} type="date" name="occurredDay" max={today} mono />}
        </Field>
        <Field label={COMMENT_FIELD_LABELS.questions} optional>
          {(p) => <Textarea {...p} name="questions" rows={3} maxLength={MAX_COMMENT_FIELD} />}
        </Field>
        <Field label={COMMENT_FIELD_LABELS.wentWell} optional>
          {(p) => <Textarea {...p} name="wentWell" rows={3} maxLength={MAX_COMMENT_FIELD} />}
        </Field>
      </div>
      <Field label={COMMENT_FIELD_LABELS.nextSteps} optional>
        {(p) => <Textarea {...p} name="nextSteps" rows={2} maxLength={MAX_COMMENT_FIELD} />}
      </Field>
      <InlineError state={state} />
      <Actions>
        <SubmitButton variant="primary" icon="plus" pending={pending} pendingLabel="Adding…">
          Add to logbook
        </SubmitButton>
      </Actions>
    </form>
  );
}

// ---- follow-up -------------------------------------------------------------------------------

function plusDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

const PRESETS = [
  { days: 3, label: "+3 days" },
  { days: 7, label: "+1 week" },
  { days: 14, label: "+2 weeks" },
] as const;

export function FollowUpForm({
  applicationId,
  today,
  current,
  closed,
  tzName,
}: {
  applicationId: number;
  today: string;
  /** The follow-up now set, as the local day and time (APP_TZ). */
  current: { day: string; time: string } | null;
  closed: boolean;
  tzName: string;
}) {
  const [day, setDay] = useState(current?.day ?? plusDays(today, 7));
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(setFollowUpAction, { errorTitle: "Follow-up not set" });
  if (closed && !current) return <p className="text-sm text-ink-soft">The application is closed — there is nothing to follow up.</p>;
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="applicationId" value={applicationId} />
      {!closed ? (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Quick picks">
            {PRESETS.map((p) => {
              const v = plusDays(today, p.days);
              return (
                <Button key={p.days} type="button" size="sm" variant={day === v ? "ink" : "secondary"} aria-pressed={day === v} onClick={() => setDay(v)}>
                  {p.label}
                </Button>
              );
            })}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Day" hint={`In ${tzName}.`}>
              {(p) => <Input {...p} type="date" name="day" value={day} onChange={(e) => setDay(e.currentTarget.value)} min={today} mono />}
            </Field>
            <Field label="Time" optional hint="Default 10:00.">
              {(p) => <Input {...p} type="time" name="time" defaultValue={current?.time ?? "10:00"} mono />}
            </Field>
          </div>
          <Field label="Note" optional hint="What to chase: “ask about the take-home”.">
            {(p) => <Input {...p} name="note" maxLength={1000} autoComplete="off" />}
          </Field>
        </>
      ) : null}
      <InlineError state={state} />
      <Actions>
        {current ? (
          <SubmitButton variant="ghost" icon="close" name="clear" value="1" formNoValidate pending={pending}>
            Clear follow-up
          </SubmitButton>
        ) : null}
        {!closed ? (
          <SubmitButton variant="primary" icon="calendar" pending={pending} pendingLabel="Setting…">
            {current ? "Move follow-up" : "Set follow-up"}
          </SubmitButton>
        ) : null}
      </Actions>
    </form>
  );
}

// ---- resume version --------------------------------------------------------------------------

export function ResumeForm({ applicationId, current, resumes }: { applicationId: number; current: number | null; resumes: Array<{ id: number; name: string; track: string }> }) {
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(setResumeVersionAction, { errorTitle: "Not recorded" });
  if (!resumes.length) {
    return (
      <p className="text-sm text-ink-soft">
        No resume versions yet.{" "}
        <a href="/kit?tab=resumes" className="font-bold underline underline-offset-4">
          Add one in the kit
        </a>{" "}
        to record which CV went out.
      </p>
    );
  }
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <input type="hidden" name="applicationId" value={applicationId} />
      <Field label="Resume version sent" className="min-w-0 flex-1">
        {(p) => <Select {...p} name="resumeVersionId" defaultValue={current ? String(current) : ""} placeholder="Not recorded" options={resumes.map((r) => ({ value: String(r.id), label: r.name }))} />}
      </Field>
      <SubmitButton variant="secondary" icon="check" pending={pending} pendingLabel="Saving…">
        Record
      </SubmitButton>
      <InlineError state={state} />
    </form>
  );
}

// ---- edit details ----------------------------------------------------------------------------

export interface EditDefaults {
  companyName: string;
  title: string;
  countryIso2: string | null;
  source: string | null;
  outcome: string | null;
  appliedDay: string | null;
}

export function EditDetailsButton({ applicationId, defaults, countries, today }: { applicationId: number; defaults: EditDefaults; countries: Array<{ iso2: string; name: string }>; today: string }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(editApplicationAction, { errorTitle: "Not saved", onOk: m.hide });
  return (
    <>
      <Button variant="secondary" icon="edit" onClick={m.show} aria-haspopup="dialog">
        Edit details
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Edit the details" kicker="Tracker · Edit" size="md" tone="lilac">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="applicationId" value={applicationId} />
            <input type="hidden" name="appliedDayWas" value={defaults.appliedDay ?? ""} />
            <p className="text-sm text-ink-soft">Each change is logged with its old and new value — nothing is overwritten silently.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" required>
                {(p) => <Input {...p} name="companyName" defaultValue={defaults.companyName} maxLength={255} data-autofocus />}
              </Field>
              <Field label="Job title" required>
                {(p) => <Input {...p} name="title" defaultValue={defaults.title} maxLength={512} />}
              </Field>
              <Field label="Country" optional>
                {(p) => <Select {...p} name="countryIso2" defaultValue={defaults.countryIso2 ?? ""} placeholder="Not set" options={countries.map((c) => ({ value: c.iso2, label: `${c.name} (${c.iso2})` }))} />}
              </Field>
              <Field label="Source" optional>
                {(p) => <Input {...p} name="source" defaultValue={defaults.source ?? ""} maxLength={191} />}
              </Field>
              <Field label="Applied on" optional>
                {(p) => <Input {...p} type="date" name="appliedDay" defaultValue={defaults.appliedDay ?? ""} max={today} mono />}
              </Field>
              <Field label="Outcome" optional hint="One line, e.g. “salary too low”.">
                {(p) => <Input {...p} name="outcome" defaultValue={defaults.outcome ?? ""} maxLength={255} />}
              </Field>
            </div>
            <Field label="Why" optional hint="Goes into the logbook next to the change.">
              {(p) => <Input {...p} name="reason" maxLength={500} autoComplete="off" />}
            </Field>
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="check" pending={pending} pendingLabel="Saving…">
                Save changes
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- snapshot --------------------------------------------------------------------------------

export function SnapshotButton({ applicationId }: { applicationId: number }) {
  const { pending, onSubmit } = useKeepValuesAction(snapshotAction, { errorTitle: "Not copied" });
  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="applicationId" value={applicationId} />
      <SubmitButton variant="secondary" size="sm" icon="copy" pending={pending} pendingLabel="Copying…">
        Copy the posting again
      </SubmitButton>
    </form>
  );
}

export { isClosedStage };
