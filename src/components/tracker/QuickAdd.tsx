"use client";

/**
 * "Log an application" for a job RADAR never saw (a referral, a company site, a recruiter mail).
 * Opens a dialog; on success it goes straight to the new logbook page.
 */
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { createManualApplicationAction } from "@/lib/actions/applications";
import { INITIAL_STAGES, STAGE_META } from "@/lib/tracker/stages";
import { InlineError, useKeepValuesAction, useLazyModal } from "./action-hooks";

export interface QuickAddProps {
  countries: Array<{ iso2: string; name: string }>;
  resumes: Array<{ id: number; name: string; track: string }>;
  /** Today in APP_TZ (YYYY-MM-DD): the latest "applied on" day allowed. */
  today: string;
  label?: string;
  variant?: "primary" | "secondary";
}

export function QuickAdd({ countries, resumes, today, label = "Log an application", variant = "primary" }: QuickAddProps) {
  const router = useRouter();
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(createManualApplicationAction, {
    errorTitle: "Not logged",
    onOk: (s) => {
      m.hide();
      if (s.href) router.push(s.href);
    },
  });
  return (
    <>
      <Button variant={variant} icon="plus" onClick={m.show} aria-haspopup="dialog">
        {label}
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Log an application" kicker="Tracker · Quick add" size="md" tone="acid">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <p className="text-sm text-ink-soft">
              For jobs that are not on the scope. Paste the ad if you have it — the logbook keeps a copy even when the posting disappears.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Company" required>
                {(p) => <Input {...p} name="companyName" maxLength={255} autoComplete="organization" data-autofocus />}
              </Field>
              <Field label="Job title" required>
                {(p) => <Input {...p} name="title" maxLength={512} autoComplete="off" />}
              </Field>
              <Field label="Stage" hint="Where it is right now.">
                {(p) => (
                  <Select
                    {...p}
                    name="stage"
                    defaultValue="applied"
                    options={INITIAL_STAGES.map((s) => ({ value: s, label: STAGE_META[s].label }))}
                  />
                )}
              </Field>
              <Field label="Applied on" optional hint="Empty = today (for applied or later).">
                {(p) => <Input {...p} type="date" name="appliedDay" max={today} mono />}
              </Field>
              <Field label="Country" optional>
                {(p) => <Select {...p} name="countryIso2" placeholder="Not set" options={countries.map((c) => ({ value: c.iso2, label: `${c.name} (${c.iso2})` }))} />}
              </Field>
              <Field label="Source" optional hint="Where you found it: “referral”, “company site”.">
                {(p) => <Input {...p} name="source" maxLength={191} autoComplete="off" />}
              </Field>
              <Field label="Resume version" optional>
                {(p) => <Select {...p} name="resumeVersionId" placeholder="Not recorded" options={resumes.map((r) => ({ value: String(r.id), label: r.name }))} />}
              </Field>
              <Field label="Posting link" optional>
                {(p) => <Input {...p} type="url" name="postingUrl" inputMode="url" maxLength={2048} placeholder="https://" mono />}
              </Field>
            </div>
            <Field label="Note" optional hint="Who referred you, what you sent.">
              {(p) => <Textarea {...p} name="note" rows={2} maxLength={4000} />}
            </Field>
            <details className="border-2 border-dashed border-ink p-3">
              <summary className="cursor-pointer font-bold">Paste the posting text</summary>
              <div className="mt-3">
                <Field label="Posting text" optional hint="Stored as the snapshot for interview prep.">
                  {(p) => <Textarea {...p} name="postingText" rows={6} maxLength={200_000} mono />}
                </Field>
              </div>
            </details>
            <InlineError state={state} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="check" pending={pending} pendingLabel="Logging…">
                Log it
              </SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
