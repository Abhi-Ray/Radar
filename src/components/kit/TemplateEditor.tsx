"use client";

/**
 * Create / edit a template: kind, name, (country for a CV convention), the declared fields and the
 * Markdown body with `{{slot}}` fields. Delete lives outside the form (its dialog has its own form).
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { InlineError, useKeepValuesAction, useLazyModal } from "@/components/tracker/action-hooks";
import { deleteTemplateAction, saveTemplateAction } from "@/lib/actions/kit";
import { MAX_MARKDOWN } from "./markdown";
import { TEMPLATE_KIND_HINT, TEMPLATE_KIND_KEYS, TEMPLATE_KIND_LABEL, type TemplateKindKey } from "./labels";
import { slotKeys } from "./template";

export interface TemplateDraft {
  id: number | null;
  kind: TemplateKindKey;
  name: string;
  bodyMd: string;
  fieldLines: string;
  countryIso2: string | null;
}

const STARTER = `Dear {{hiring_manager}},

I'm applying for the {{role}} role at {{company}}. {{why_company}}

In my current role I … (one measured result that matches the posting).

Kind regards,
{{my_name}}
`;

function DeleteTemplate({ id, name }: { id: number; name: string }) {
  const router = useRouter();
  const m = useLazyModal();
  const { state, pending, onSubmit } = useKeepValuesAction(deleteTemplateAction, {
    errorTitle: "Not deleted",
    onOk: () => {
      m.hide();
      router.push("/kit?tab=templates");
    },
  });
  return (
    <>
      <Button type="button" variant="ghost" icon="trash" onClick={m.show} aria-haspopup="dialog">
        Delete
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={`Delete “${name}”?`} kicker="Kit · Template" size="sm" tone="stamp">
          <form onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="id" value={id} />
            <p className="text-sm">The template is removed for good. Letters you already sent are not affected.</p>
            <InlineError state={state} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" type="button" data-dialog-close>
                Keep it
              </Button>
              <SubmitButton variant="danger" icon="trash" pending={pending} pendingLabel="Deleting…" data-autofocus>
                Delete template
              </SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

export function TemplateEditor({ draft, countries }: { draft: TemplateDraft; countries: Array<{ iso2: string; name: string }> }) {
  const router = useRouter();
  const [kind, setKind] = useState<TemplateKindKey>(draft.kind);
  const [body, setBody] = useState(draft.bodyMd || (draft.id ? "" : STARTER));
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(saveTemplateAction, {
    errorTitle: "Not saved",
    onOk: (s) => {
      if (s.href && !draft.id) router.push(s.href, { scroll: false });
    },
  });
  const slots = slotKeys(body);
  const formId = `template-form-${draft.id ?? "new"}`;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <form key={formKey} id={formId} onSubmit={onSubmit} className="flex min-w-0 flex-col gap-4" aria-label={draft.id ? `Edit ${draft.name}` : "New template"}>
        {draft.id ? <input type="hidden" name="id" value={draft.id} /> : null}
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Kind" required hint={TEMPLATE_KIND_HINT[kind]}>
            {(p) => (
              <Select
                {...p}
                name="kind"
                value={kind}
                onChange={(e) => setKind(e.currentTarget.value as TemplateKindKey)}
                options={TEMPLATE_KIND_KEYS.map((k) => ({ value: k, label: TEMPLATE_KIND_LABEL[k] }))}
              />
            )}
          </Field>
          <Field label="Name" required>
            {(p) => <Input {...p} name="name" defaultValue={draft.name} maxLength={191} placeholder="Cover letter · short" autoComplete="off" />}
          </Field>
          <Field label="Country" required={kind === "cv_convention"} optional={kind !== "cv_convention"} hint={kind === "cv_convention" ? "The country these conventions are for." : "Only if it is written for one market."}>
            {(p) => <Select {...p} name="countryIso2" defaultValue={draft.countryIso2 ?? ""} placeholder="Any country" options={countries.map((c) => ({ value: c.iso2, label: `${c.name} (${c.iso2})` }))} />}
          </Field>
          <Field label="Field labels" optional hint="One per line: key | Label | hint. Slots without a line get a label from their key.">
            {(p) => <Textarea {...p} name="fieldLines" defaultValue={draft.fieldLines} rows={3} mono maxLength={8000} placeholder={"why_company | Why this company | one sentence"} />}
          </Field>
        </div>
        <Field label="Text (Markdown)" required hint="Put {{field}} where the letter changes per job.">
          {(p) => <Textarea {...p} name="bodyMd" value={body} onChange={(e) => setBody(e.currentTarget.value)} rows={14} mono maxLength={MAX_MARKDOWN} spellCheck />}
        </Field>
        <p className="font-mono text-xs text-muted">
          {slots.length ? `Fields found: ${slots.map((s) => `{{${s}}}`).join(" ")}` : "No {{fields}} in the text yet."}
        </p>
        <InlineError state={state} />
      </form>
      <div className="flex flex-col-reverse gap-2 border-t-3 border-ink pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
        {draft.id ? <DeleteTemplate id={draft.id} name={draft.name} /> : null}
        <SubmitButton form={formId} variant="primary" icon="check" pending={pending} pendingLabel="Saving…">
          {draft.id ? "Save template" : "Create template"}
        </SubmitButton>
      </div>
    </div>
  );
}
