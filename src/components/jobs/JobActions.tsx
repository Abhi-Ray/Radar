"use client";

/**
 * Job action buttons (client): save, hide / unhide, mark applied, ask-AI summary, remove override.
 * Each is a real <form> bound to a server action through useActionState, so it degrades to a plain
 * POST without JavaScript, shows pending state, and reports the result as a toast + inline text.
 */
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ProgressBlocks } from "@/components/ui/ProgressBlocks";
import { SubmitButton } from "@/components/ui/SubmitButton";
import {
  askAiSummaryAction,
  clearOverrideAction,
  markAppliedAction,
  setHiddenAction,
  toggleSaveAction,
  type ActionState,
} from "@/lib/actions/jobs";
import { useActionFeedback, useKeepValuesAction } from "./useActionFeedback";

function InlineError({ state }: { state: ActionState | undefined }) {
  if (!state?.error) return null;
  return (
    <p role="alert" className="flex items-start gap-1.5 border-l-4 border-stamp-deep bg-stamp-tint px-2 py-1 text-sm font-bold">
      <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-stamp-deep" />
      {state.error}
    </p>
  );
}

/** Mounts the dialog on first open and keeps it mounted (focus return + exit handled by the kit). */
function useLazyModal() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  return {
    open,
    mounted,
    show: () => {
      setMounted(true);
      setOpen(true);
    },
    hide: () => setOpen(false),
  };
}

// ---- save ------------------------------------------------------------------------------------

export function SaveButton({ jobId, saved }: { jobId: number; saved: boolean }) {
  const [state, action] = useActionState(toggleSaveAction, undefined);
  useActionFeedback(state);
  return (
    <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="saved" value={saved ? "0" : "1"} />
      <SubmitButton variant={saved ? "ink" : "secondary"} icon={saved ? "bookmark-filled" : "bookmark"} aria-pressed={saved} pendingLabel={saved ? "Unsaving…" : "Saving…"}>
        {saved ? "Saved" : "Save"}
      </SubmitButton>
    </form>
  );
}

// ---- hide ------------------------------------------------------------------------------------

export function HideButton({ jobId, hidden, hiddenReason }: { jobId: number; hidden: boolean; hiddenReason: string | null }) {
  if (hidden) return <UnhideButton jobId={jobId} hiddenReason={hiddenReason} />;
  return <HideWithReason jobId={jobId} />;
}

function UnhideButton({ jobId, hiddenReason }: { jobId: number; hiddenReason: string | null }) {
  const [state, action] = useActionState(setHiddenAction, undefined);
  useActionFeedback(state);
  return (
    <form action={action}>
      <input type="hidden" name="jobId" value={jobId} />
      <input type="hidden" name="hidden" value="0" />
      <SubmitButton variant="secondary" icon="eye" pendingLabel="Unhiding…" title={hiddenReason ? `Hidden because: ${hiddenReason}` : undefined}>
        Unhide
      </SubmitButton>
    </form>
  );
}

function HideWithReason({ jobId }: { jobId: number }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(setHiddenAction, { onOk: m.hide });
  return (
    <>
      <Button variant="ghost" icon="eye-off" onClick={m.show} aria-haspopup="dialog">
        Hide
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Hide this job" kicker="Jobs · Hide" size="sm" tone="concrete">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="hidden" value="1" />
            <p className="text-sm text-ink-soft">
              It leaves the default list and the Desk. Nothing is deleted — tick “Jobs I hid” in the filters to find it again.
            </p>
            <Field label="Why?" optional hint="A word for future you: “agency spam”, “needs German”.">
              {(p) => <Input {...p} name="reason" maxLength={255} autoComplete="off" data-autofocus />}
            </Field>
            <InlineError state={state} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="ink" icon="eye-off" pending={pending} pendingLabel="Hiding…">
                Hide job
              </SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- mark applied ----------------------------------------------------------------------------

export function MarkAppliedButton({ jobId, applicationId }: { jobId: number; applicationId: number | null }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(markAppliedAction, { onOk: m.hide });
  const linked = state?.applicationId ?? applicationId;
  return (
    <>
      {linked ? (
        <Button href={`/applications/${linked}`} variant="secondary" icon="tracker">
          In tracker
        </Button>
      ) : null}
      <Button variant="primary" icon="check" onClick={m.show} aria-haspopup="dialog">
        {linked ? "Mark applied again" : "Mark applied"}
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Mark as applied" kicker="Jobs · Tracker" size="sm" tone="radar">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="jobId" value={jobId} />
            <p className="text-sm text-ink-soft">
              Logs an application at stage <strong>applied</strong> in the tracker and snapshots the posting as it is now, so
              you keep the text even if the ad disappears.{linked ? " The existing application is moved to “applied”." : ""}
            </p>
            <Field label="Note" optional hint="Which CV, who referred you, anything worth remembering.">
              {(p) => <Textarea {...p} name="note" rows={3} maxLength={1000} data-autofocus />}
            </Field>
            <InlineError state={state} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="check" pending={pending} pendingLabel="Logging…">
                Log application
              </SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- AI summary ------------------------------------------------------------------------------

export interface AiBudgetView {
  enabled: boolean;
  used: number;
  limit: number;
  remaining: number;
}

/**
 * One manual AI call, only when the budget allows it. The remaining budget is always visible;
 * with AI switched off the button is disabled and says so (no request is sent).
 */
export function AiSummaryButton({ jobId, budget, hasSummary }: { jobId: number; budget: AiBudgetView | null; hasSummary: boolean }) {
  const [state, action] = useActionState(askAiSummaryAction, undefined);
  useActionFeedback(state, { errorTitle: "No summary" });
  const blocked = !budget ? "The AI budget could not be read, so no call is allowed." : !budget.enabled ? "AI is switched off in settings." : budget.remaining <= 0 ? "Today's AI budget is used up." : null;
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="jobId" value={jobId} />
      {budget ? (
        <ProgressBlocks value={budget.used} max={Math.max(1, budget.limit)} label="AI calls used today" tone="lilac" warnAt={0.8} dangerAt={1} readout={`${budget.used}/${budget.limit} used · ${budget.remaining} left`} size="sm" />
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton variant="secondary" icon="ai" disabled={Boolean(blocked)} pendingLabel="Asking…">
          {hasSummary ? "Ask again" : "Ask AI for a summary"}
        </SubmitButton>
        <span className="text-xs text-muted">{blocked ?? "Uses 1 call. Cached answers are free; quotes are checked against the posting."}</span>
      </div>
      <InlineError state={state} />
    </form>
  );
}

// ---- remove override -------------------------------------------------------------------------

export function ClearOverrideButton({ jobId, field, label }: { jobId: number; field: string; label: string }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(clearOverrideAction, { onOk: m.hide });
  return (
    <>
      <Button variant="ghost" size="sm" icon="trash" onClick={m.show} aria-haspopup="dialog">
        Remove<span className="sr-only"> the {label} override</span>
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Remove override" kicker={`Override · ${label}`} size="sm" tone="stamp">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="jobId" value={jobId} />
            <input type="hidden" name="field" value={field} />
            <p className="text-sm text-ink-soft">The evidence decides this field again. The override stays in the history.</p>
            <Field label="Reason" required hint="3–500 characters. Kept in the audit log.">
              {(p) => <Input {...p} name="reason" minLength={3} maxLength={500} autoComplete="off" data-autofocus />}
            </Field>
            <InlineError state={state} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="danger" icon="trash" pending={pending} pendingLabel="Removing…">
                Remove override
              </SubmitButton>
            </div>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
