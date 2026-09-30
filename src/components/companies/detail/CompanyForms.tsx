"use client";

/**
 * /companies/[id] fixes (client): my own sponsor note, the agency flag, the parent link, merge
 * (another record into this one), split (names — and jobs — off into a new record) and undoing a
 * merge. Every change is audited server-side; merges and splits persist across re-runs.
 */
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Checkbox, ChoiceChip } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addSponsorNoteAction, mergeCompaniesAction, setAgencyAction, setParentAction, splitCompanyAction } from "@/lib/actions/companies";
import type { ActionState } from "@/lib/tracker/action-state";
import { InlineError, useKeepValuesAction, useLazyModal } from "@/components/tracker/action-hooks";
import { ALIAS_KIND_LABEL } from "../model";

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">{children}</div>;
}

function ReasonField({ hint, placeholder }: { hint?: string; placeholder?: string }) {
  return (
    <Field label="Reason" required hint={hint ?? "Kept in the audit log with the change."}>
      {(p) => <Input {...p} name="reason" minLength={3} maxLength={500} autoComplete="off" placeholder={placeholder} />}
    </Field>
  );
}

// ---- sponsor note ----------------------------------------------------------------------------

export function SponsorNoteForm({ companyId, companyName }: { companyId: number; companyName: string }) {
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(addSponsorNoteAction, { errorTitle: "Note not saved" });
  return (
    <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-3">
      <input type="hidden" name="companyId" value={companyId} />
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="micro mb-2 text-ink">Does {companyName} sponsor visas?</legend>
        <div className="flex flex-wrap gap-2">
          <ChoiceChip id={`sn-${companyId}-yes`} name="sponsors" value="yes" required label="Yes, they sponsor" />
          <ChoiceChip id={`sn-${companyId}-no`} name="sponsors" value="no" label="No, they don't" />
        </div>
      </fieldset>
      <Field label="How do you know" required hint="Who said it, where and when — e.g. “recruiter call 2026-09-28: Skilled Worker visa offered”.">
        {(p) => <Textarea {...p} name="note" rows={3} minLength={3} maxLength={2000} />}
      </Field>
      <Field label="Link" optional hint="Careers page, email thread, post…">
        {(p) => <Input {...p} name="url" type="url" inputMode="url" maxLength={2048} placeholder="https://" mono />}
      </Field>
      <InlineError state={state} />
      <p className="text-xs text-muted">Your note is evidence marked as yours. It never edits a register match; a newer note supersedes an older one.</p>
      <Actions>
        <SubmitButton variant="primary" icon="stamp" pending={pending} pendingLabel="Saving…">
          Record the note
        </SubmitButton>
      </Actions>
    </form>
  );
}

// ---- agency flag -----------------------------------------------------------------------------

export function AgencyButton({ companyId, isAgency }: { companyId: number; isAgency: boolean }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(setAgencyAction, { errorTitle: "Not changed", onOk: m.hide });
  const next = isAgency ? "no" : "yes";
  return (
    <>
      <Button variant="secondary" size="sm" icon="flag" onClick={m.show} aria-haspopup="dialog">
        {isAgency ? "Not an agency" : "Mark as agency"}
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={isAgency ? "Mark as a direct employer" : "Mark as a recruitment agency"} kicker="Company · Agency" size="sm" tone="signal">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="companyId" value={companyId} />
            <input type="hidden" name="isAgency" value={next} />
            <p className="text-sm text-ink-soft">
              {isAgency
                ? "Its jobs stop carrying the agency sticker. The collector never overrides a manual decision."
                : "Its jobs get the agency sticker and can be filtered out. The collector never overrides a manual decision."}
            </p>
            <ReasonField placeholder={isAgency ? "Hires for itself — checked the careers page" : "Posts roles for unnamed clients"} />
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="check" pending={pending} pendingLabel="Saving…">
                {isAgency ? "Mark as direct employer" : "Mark as agency"}
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- parent ----------------------------------------------------------------------------------

export function ParentButton({ companyId, parent }: { companyId: number; parent: { id: number; name: string } | null }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(setParentAction, { errorTitle: "Parent not changed", onOk: m.hide });
  const [clear, setClear] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" icon="link" onClick={m.show} aria-haspopup="dialog">
        {parent ? "Change parent" : "Set a parent"}
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Parent company" kicker="Company · Family" size="sm" tone="cobalt">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="companyId" value={companyId} />
            <p className="text-sm text-ink-soft">
              A subsidiary shares the family’s sponsor evidence when the register lists the group. Loops are refused.
              {parent ? ` Now: #${parent.id} ${parent.name}.` : ""}
            </p>
            {clear ? (
              <input type="hidden" name="parentId" value="" />
            ) : (
              <Field label="Parent company number" required hint="The # on the parent’s page, e.g. 42.">
                {(p) => <Input {...p} name="parentId" type="number" inputMode="numeric" min={1} step={1} defaultValue={parent ? String(parent.id) : ""} mono data-autofocus />}
              </Field>
            )}
            {parent ? <Checkbox id={`parent-clear-${companyId}`} checked={clear} onChange={(e) => setClear(e.currentTarget.checked)} label="Remove the parent link" /> : null}
            <ReasonField placeholder="Group annual report lists it as a subsidiary" />
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="check" pending={pending} pendingLabel="Saving…">
                {clear ? "Remove the link" : "Save the parent"}
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- merge -----------------------------------------------------------------------------------

/** Merge another record into this one (`drop` preset from the duplicate list, or typed). */
export function MergeButton({ keepId, keepName, drop, label }: { keepId: number; keepName: string; drop?: { id: number; name: string } | null; label?: string }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(mergeCompaniesAction, { errorTitle: "Not merged", onOk: m.hide });
  return (
    <>
      <Button variant={drop ? "secondary" : "ghost"} size="sm" icon="merge" onClick={m.show} aria-haspopup="dialog">
        {label ?? (drop ? "Merge into this" : "Merge another record in")}
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={drop ? `Merge “${drop.name}” into “${keepName}”` : `Merge a record into “${keepName}”`} kicker="Company · Merge" size="md" tone="stamp">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="keepId" value={keepId} />
            {drop ? (
              <input type="hidden" name="dropId" value={drop.id} />
            ) : (
              <Field label="Company number to merge in" required hint="The # of the duplicate record (shown on its card and page).">
                {(p) => <Input {...p} name="dropId" type="number" inputMode="numeric" min={1} step={1} mono data-autofocus />}
              </Field>
            )}
            <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
              <li>Its jobs, boards and evidence move here; empty fields here are filled from it.</li>
              <li>Its names stay attached, so future postings under those names land here.</li>
              <li>You can undo it later from this page (Undo the merge).</li>
            </ul>
            <ReasonField placeholder="Same company, listed with and without “Ltd”" />
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="danger" icon="merge" pending={pending} pendingLabel="Merging…">
                Merge
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- split / undo a merge --------------------------------------------------------------------

export interface SplitAlias {
  id: number;
  alias: string;
  kind: string;
  countryIso2: string | null;
}

export interface SplitJob {
  id: number;
  title: string;
  where: string | null;
}

function JobPicks({ jobs, prefix }: { jobs: SplitJob[]; prefix: string }) {
  if (!jobs.length) return null;
  return (
    <details className="border-2 border-dashed border-ink/50 px-3 py-2">
      <summary className="flex min-h-11 cursor-pointer items-center font-bold">Also move jobs ({jobs.length} listed)</summary>
      <p className="text-xs text-muted">Only tick jobs that were posted by the other company.</p>
      <div className="flex max-h-60 flex-col overflow-y-auto">
        {jobs.map((j) => (
          <Checkbox
            key={j.id}
            id={`${prefix}-job-${j.id}`}
            name="jobId"
            value={String(j.id)}
            label={<span className="[overflow-wrap:anywhere]">{j.title}</span>}
            description={`#${j.id}${j.where ? ` · ${j.where}` : ""}`}
          />
        ))}
      </div>
    </details>
  );
}

export function SplitButton({ companyId, companyName, aliases, jobs }: { companyId: number; companyName: string; aliases: SplitAlias[]; jobs: SplitJob[] }) {
  const m = useLazyModal();
  const router = useRouter();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(splitCompanyAction, { errorTitle: "Not split", onOk: (s: ActionState) => {
      m.hide();
      if (s.href) router.push(s.href);
    },
  });
  const disabled = aliases.length === 0;
  return (
    <>
      <Button variant="ghost" size="sm" icon="split" onClick={m.show} aria-haspopup="dialog" disabled={disabled} title={disabled ? "This record has no extra names to split off." : undefined}>
        Split names off
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={`Split names off “${companyName}”`} kicker="Company · Split" size="lg" tone="stamp">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="companyId" value={companyId} />
            <p className="text-sm text-ink-soft">The ticked names move to a new company record, with any jobs you tick. Future postings under those names go there.</p>
            <fieldset className="m-0 border-0 p-0">
              <legend className="micro mb-1 text-ink">Names that belong to the other company</legend>
              <div className="flex max-h-60 flex-col overflow-y-auto">
                {aliases.map((a) => (
                  <Checkbox
                    key={a.id}
                    id={`split-${companyId}-alias-${a.id}`}
                    name="aliasId"
                    value={String(a.id)}
                    label={<span className="[overflow-wrap:anywhere]">{a.alias}</span>}
                    description={[ALIAS_KIND_LABEL[a.kind] ?? a.kind, a.countryIso2].filter(Boolean).join(" · ")}
                  />
                ))}
              </div>
            </fieldset>
            <Field label="Name of the new company" optional hint="Defaults to the first ticked name.">
              {(p) => <Input {...p} name="name" maxLength={255} autoComplete="off" />}
            </Field>
            <JobPicks jobs={jobs} prefix={`split-${companyId}`} />
            <ReasonField placeholder="The UK Ltd is a different employer" />
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="danger" icon="split" pending={pending} pendingLabel="Splitting…">
                Split off
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

/** Undo a merge: splitting a merged record's names off restores that record (split, restore mode). */
export function UndoMergeButton({ companyId, record, aliasIds, jobs }: { companyId: number; record: { id: number; name: string }; aliasIds: number[]; jobs: SplitJob[] }) {
  const m = useLazyModal();
  const router = useRouter();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(splitCompanyAction, { errorTitle: "Not restored", onOk: (s: ActionState) => {
      m.hide();
      if (s.href) router.push(s.href);
    },
  });
  const disabled = aliasIds.length === 0;
  return (
    <>
      <Button variant="ghost" size="sm" icon="split" onClick={m.show} aria-haspopup="dialog" disabled={disabled} title={disabled ? "The merged record has no names left to restore it by." : undefined}>
        Undo the merge
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={`Restore “${record.name}” (#${record.id})`} kicker="Company · Undo merge" size="md" tone="stamp">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="companyId" value={companyId} />
            {aliasIds.map((id) => (
              <input key={id} type="hidden" name="aliasId" value={id} />
            ))}
            <p className="text-sm text-ink-soft">
              #{record.id} becomes its own company again. What the merge moved comes back (jobs, boards, evidence, filled fields) unless it changed since; names learned
              from it since go with it.
            </p>
            <JobPicks jobs={jobs} prefix={`undo-${record.id}`} />
            <ReasonField placeholder="Not the same company after all" />
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="danger" icon="split" pending={pending} pendingLabel="Restoring…">
                Undo the merge
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
