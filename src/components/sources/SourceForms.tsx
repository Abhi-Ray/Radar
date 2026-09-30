"use client";

import { InlineError, useFormAction } from "@/components/tracker/action-hooks";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui";
import { checklistItemAction, platformTermsAction, sourceConfigAction } from "@/lib/actions/sources";

export function ChecklistItemForm({ sourceId, item, done, note }: { sourceId: number; item: string; done: boolean; note: string | null }) {
  const { state, action } = useFormAction(checklistItemAction);
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="sourceId" value={sourceId} />
      <input type="hidden" name="item" value={item} />
      <label className="flex min-h-11 items-center gap-2 border-3 border-ink bg-card px-3 text-sm font-bold">
        <input type="checkbox" name="done" value="1" defaultChecked={done} className="size-5 accent-ink" />I checked this
      </label>
      <label className="flex min-w-40 flex-1 flex-col gap-1">
        <span className="micro">Note (optional)</span>
        <input name="note" defaultValue={note && !note.startsWith("auto: ") ? note : ""} maxLength={500} autoComplete="off" className="min-h-11 border-3 border-ink bg-card px-3 text-sm" />
      </label>
      <SubmitButton variant="secondary" size="sm" pendingLabel="Saving…">
        Save
      </SubmitButton>
      <InlineError state={state} />
    </form>
  );
}

export function ConfigForm({ sourceId, label, countryIso2, configJson, notes }: { sourceId: number; label: string; countryIso2: string | null; configJson: string; notes: string | null }) {
  const { state, action } = useFormAction(sourceConfigAction);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="sourceId" value={sourceId} />
      <Field label="Label" required>
        {(p) => <Input {...p} name="label" defaultValue={label} minLength={2} maxLength={191} autoComplete="off" />}
      </Field>
      <Field label="Country" optional hint="Two-letter code; empty = worldwide / remote.">
        {(p) => <Input {...p} name="countryIso2" defaultValue={countryIso2 ?? ""} maxLength={2} autoComplete="off" className="uppercase" />}
      </Field>
      <Field label="Config (JSON)" required className="md:col-span-2" hint="Changing the identity part (board / query) changes the source key — the app checks it matches.">
        {(p) => <Textarea {...p} name="config" defaultValue={configJson} rows={7} spellCheck={false} className="font-mono" />}
      </Field>
      <Field label="Notes" optional className="md:col-span-2">
        {(p) => <Textarea {...p} name="notes" defaultValue={notes ?? ""} rows={2} maxLength={4000} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton variant="primary" icon="check" pendingLabel="Saving…">
          Save configuration
        </SubmitButton>
        <InlineError state={state} />
      </div>
    </form>
  );
}

export function TermsForm({ platformKey, termsStatus, termsUrl, termsNotes, statuses }: { platformKey: string; termsStatus: string; termsUrl: string | null; termsNotes: string | null; statuses: readonly string[] }) {
  const { state, action } = useFormAction(platformTermsAction);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <input type="hidden" name="platformKey" value={platformKey} />
      <Field label="Terms of use say" required>
        {(p) => <Select {...p} name="termsStatus" defaultValue={termsStatus} options={statuses.map((s) => ({ value: s, label: s }))} />}
      </Field>
      <Field label="Reviewed on" required hint="The date you read the terms.">
        {(p) => <Input {...p} type="date" name="reviewedAt" defaultValue={today} />}
      </Field>
      <Field label="Terms URL" optional className="md:col-span-2" hint="https:// link to the terms / API policy.">
        {(p) => <Input {...p} name="termsUrl" defaultValue={termsUrl ?? ""} maxLength={2048} autoComplete="off" />}
      </Field>
      <Field label="Notes" optional className="md:col-span-2">
        {(p) => <Textarea {...p} name="termsNotes" defaultValue={termsNotes ?? ""} rows={2} maxLength={4000} />}
      </Field>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton variant="primary" icon="check" pendingLabel="Saving…">
          Record the review
        </SubmitButton>
        <InlineError state={state} />
      </div>
    </form>
  );
}
