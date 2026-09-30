"use client";

/**
 * "Manual override" and "Report wrong info" (spec §12, §16). One provider per job page owns the two
 * dialogs; any number of <EditFieldButton>s (header, fact ledger rows) open them pre-set to a field.
 * The inputs per field come from FIELD_SPECS; the server rebuilds and validates the value.
 */
import { createContext, use, useId, useState, type ReactNode } from "react";
import { Button, type ButtonSize, type ButtonVariant } from "@/components/ui/Button";
import { ChoiceChip, Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Icon, type IconName } from "@/components/ui/icons";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { overrideFieldAction, reportWrongInfoAction, type ActionState } from "@/lib/actions/jobs";
import { FIELD_OPTIONS, FIELD_SPECS, inputName, type EditableField, type InputSpec } from "./field-edit";
import { useKeepValuesAction } from "./useActionFeedback";

type Mode = "override" | "report";

interface FieldEditApi {
  open: (mode: Mode, field: EditableField) => void;
}

const FieldEditContext = createContext<FieldEditApi | null>(null);

export interface FieldEditProviderProps {
  jobId: number;
  /** Pre-filled inputs per field (current value). */
  defaults: Record<EditableField, Record<string, string>>;
  /** What RADAR shows now, per field, in words. */
  current: Record<EditableField, string>;
  children: ReactNode;
}

export function FieldEditProvider({ jobId, defaults, current, children }: FieldEditProviderProps) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [field, setField] = useState<EditableField>("visa_status");
  const [mounted, setMounted] = useState<Record<Mode, boolean>>({ override: false, report: false });
  const api: FieldEditApi = {
    open: (m, f) => {
      setField(f);
      setMode(m);
      setMounted((prev) => (prev[m] ? prev : { ...prev, [m]: true }));
    },
  };
  const close = () => setMode(null);
  return (
    <FieldEditContext value={api}>
      {children}
      {mounted.override ? (
        <OverrideDialog open={mode === "override"} onClose={close} jobId={jobId} field={field} setField={setField} defaults={defaults} current={current} />
      ) : null}
      {mounted.report ? (
        <ReportDialog open={mode === "report"} onClose={close} jobId={jobId} field={field} setField={setField} defaults={defaults} current={current} />
      ) : null}
    </FieldEditContext>
  );
}

export function EditFieldButton({
  mode,
  field,
  children,
  variant = "ghost",
  size = "sm",
  icon,
  className,
}: {
  mode: Mode;
  field: EditableField;
  children: ReactNode;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconName;
  className?: string;
}) {
  const api = use(FieldEditContext);
  if (!api) return null;
  return (
    <Button variant={variant} size={size} icon={icon ?? (mode === "override" ? "edit" : "flag")} onClick={() => api.open(mode, field)} aria-haspopup="dialog" className={className}>
      {children}
    </Button>
  );
}

// ---- inputs ----------------------------------------------------------------------------------

function SpecInput({ spec, value, idBase }: { spec: InputSpec; value: string; idBase: string }) {
  const name = inputName(spec.name);
  const id = `${idBase}-${spec.name}`;
  if (spec.type === "checkbox") {
    return <Checkbox id={id} name={name} value="on" defaultChecked={value === "on"} label={spec.label} description={spec.hint} className="sm:col-span-2" />;
  }
  const wide = spec.type === "textarea" || (spec.type === "text" && spec.maxLength > 64);
  return (
    <Field label={spec.label} id={id} hint={spec.hint} required={"required" in spec ? spec.required : undefined} optional={!("required" in spec && spec.required)} className={wide ? "sm:col-span-2" : undefined}>
      {(p) => {
        switch (spec.type) {
          case "select":
            return <Select {...p} name={name} defaultValue={value} options={spec.options} />;
          case "number":
            return <Input {...p} name={name} type="number" inputMode="numeric" min={spec.min} max={spec.max} step={spec.step ?? 1} defaultValue={value} mono suffix={spec.suffix} />;
          case "date":
            return <Input {...p} name={name} type="date" defaultValue={value} mono />;
          case "textarea":
            return <Textarea {...p} name={name} rows={spec.rows ?? 3} maxLength={spec.maxLength} defaultValue={value} />;
          case "text":
            return <Input {...p} name={name} maxLength={spec.maxLength} placeholder={spec.placeholder} mono={spec.mono} defaultValue={value} autoComplete="off" />;
        }
      }}
    </Field>
  );
}

/** Inputs for one field; keyed on the field so switching fields resets them to that field's defaults. */
function FieldInputs({ field, defaults }: { field: EditableField; defaults: Record<string, string> }) {
  const idBase = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <div key={field} className="grid gap-3 sm:grid-cols-2">
      {FIELD_SPECS[field].inputs.map((spec) => (
        <SpecInput key={spec.name} spec={spec} value={defaults[spec.name] ?? ""} idBase={`${idBase}-${field}`} />
      ))}
    </div>
  );
}

function FieldPicker({ field, setField, id }: { field: EditableField; setField: (f: EditableField) => void; id: string }) {
  return (
    <Field label="Field" id={id} hint={FIELD_SPECS[field].help}>
      {(p) => (
        <Select
          {...p}
          name="field"
          value={field}
          onChange={(e) => {
            const v = e.currentTarget.value;
            const match = FIELD_OPTIONS.find((o) => o.value === v);
            if (match) setField(match.value as EditableField);
          }}
          options={FIELD_OPTIONS}
        />
      )}
    </Field>
  );
}

function ShownNow({ text }: { text: string }) {
  return (
    <p className="border-2 border-dashed border-ink/50 bg-paper px-3 py-2 text-sm">
      <span className="micro mr-2 text-muted">RADAR shows</span>
      <span className="font-mono [overflow-wrap:anywhere]">{text}</span>
    </p>
  );
}

function InlineError({ state }: { state: ActionState | undefined }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 border-l-4 border-stamp-deep bg-stamp-tint px-2 py-1 text-sm font-bold">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-stamp-deep" />
      {state.error}
    </p>
  );
}

interface DialogProps {
  open: boolean;
  onClose: () => void;
  jobId: number;
  field: EditableField;
  setField: (f: EditableField) => void;
  defaults: Record<EditableField, Record<string, string>>;
  current: Record<EditableField, string>;
}

function OverrideDialog({ open, onClose, jobId, field, setField, defaults, current }: DialogProps) {
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(overrideFieldAction, { onOk: onClose, errorTitle: "Override not set" });
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <Modal open={open} onClose={onClose} title="Manual override" kicker="Provenance · Manual beats everything" size="lg" tone="ink">
      <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending || undefined}>
        <input type="hidden" name="jobId" value={jobId} />
        <FieldPicker field={field} setField={setField} id={`${id}-field`} />
        <ShownNow text={current[field]} />
        <FieldInputs key={field} field={field} defaults={defaults[field]} />
        <Field label="Reason" id={`${id}-reason`} required hint="Why you know better — kept with the override and in the audit log.">
          {(p) => <Input {...p} name="reason" minLength={3} maxLength={500} autoComplete="off" />}
        </Field>
        <InlineError state={state} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" type="button" data-dialog-close>
            Cancel
          </Button>
          <SubmitButton variant="ink" icon="edit" pending={pending} pendingLabel="Saving…">
            Set override
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}

function ReportDialog({ open, onClose, jobId, field, setField, defaults, current }: DialogProps) {
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(reportWrongInfoAction, { onOk: onClose, errorTitle: "Correction not saved" });
  const [knows, setKnows] = useState(true);
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Report wrong info"
      kicker="Accuracy · Golden sample"
      size="lg"
      tone="signal"
      description="Every report is kept as a correction and added to the golden sample, so the accuracy check measures RADAR against what you found."
    >
      <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4" aria-busy={pending || undefined}>
        <input type="hidden" name="jobId" value={jobId} />
        <FieldPicker field={field} setField={setField} id={`${id}-field`} />
        <ShownNow text={current[field]} />
        <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
          <legend className="micro mb-2 text-ink">Do you know the correct value?</legend>
          <div className="flex flex-wrap gap-2">
            <ChoiceChip kind="radio" name="knowsCorrect" value="yes" checked={knows} onChange={() => setKnows(true)} label="Yes — I'll enter it" />
            <ChoiceChip kind="radio" name="knowsCorrect" value="no" checked={!knows} onChange={() => setKnows(false)} label="No — it's just wrong" />
          </div>
        </fieldset>
        {knows ? <FieldInputs key={field} field={field} defaults={defaults[field]} /> : null}
        <Field label="What is wrong?" id={`${id}-note`} required={!knows} optional={knows} hint={knows ? "Where you saw the right value helps." : "Say what is wrong, since there is no correct value."}>
          {(p) => <Textarea {...p} name="note" rows={3} maxLength={1000} />}
        </Field>
        {knows ? (
          <Checkbox id={`${id}-apply`} name="applyAsOverride" value="1" label="Also apply it as a manual override" description="The corrected value then wins on this job right away." />
        ) : null}
        <InlineError state={state} />
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" type="button" data-dialog-close>
            Cancel
          </Button>
          <SubmitButton variant="primary" icon="flag" pending={pending} pendingLabel="Sending…">
            Record correction
          </SubmitButton>
        </div>
      </form>
    </Modal>
  );
}
