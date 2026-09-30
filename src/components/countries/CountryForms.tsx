"use client";

/**
 * /countries/[iso2] actions (client): mark a rule version verified today, add a rule version
 * (never overwrites — a new row with the next number), switch the country live / off, and mark a
 * changed official page reviewed. Each writes the change log and the audit log server-side.
 */
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { addRuleVersionAction, markPageReviewedAction, markRuleVerifiedAction, setCountryLiveAction } from "@/lib/actions/countries";
import { InlineError, useKeepValuesAction, useLazyModal } from "@/components/tracker/action-hooks";

function Actions({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">{children}</div>;
}

// ---- verify ----------------------------------------------------------------------------------

export function VerifyRuleButton({
  ruleVersionId,
  label,
  sourceUrl,
  nextReview,
}: {
  ruleVersionId: number;
  label: string;
  sourceUrl: string | null;
  nextReview: string;
}) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(markRuleVerifiedAction, { errorTitle: "Not verified", onOk: m.hide });
  return (
    <>
      <Button variant="primary" size="sm" icon="check" onClick={m.show} aria-haspopup="dialog">
        Mark verified today
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={`Verify ${label}`} kicker="Rule · Verify" size="sm" tone="radar">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="ruleVersionId" value={ruleVersionId} />
            <p className="text-sm text-ink-soft">
              Only after reading the official page: the threshold, degree and experience rules above still match it. The next review is set to {nextReview}.
            </p>
            {sourceUrl ? (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 text-sm font-bold underline underline-offset-4 [overflow-wrap:anywhere] sm:min-h-0"
              >
                Open the official source
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
            <Field label="Note" optional hint="What you checked, e.g. “threshold unchanged on the 2026 page”.">
              {(p) => <Input {...p} name="note" maxLength={1000} autoComplete="off" data-autofocus />}
            </Field>
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="stamp" pending={pending} pendingLabel="Stamping…">
                Verified today
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- add a rule version ----------------------------------------------------------------------

export interface RuleDefaults {
  salaryThresholdEur: number | null;
  salaryThresholdLocal: number | null;
  currency: string | null;
  degreeRule: string | null;
  experienceRule: string | null;
  ruleText: string | null;
  officialSourceUrl: string | null;
}

export function AddRuleVersionButton({
  routeId,
  routeName,
  nextVersion,
  today,
  defaults,
}: {
  routeId: number;
  routeName: string;
  nextVersion: number;
  today: string;
  defaults: RuleDefaults | null;
}) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(addRuleVersionAction, { errorTitle: "Version not added", onOk: m.hide });
  const n = (v: number | null) => (v === null ? "" : String(v));
  return (
    <>
      <Button variant="secondary" size="sm" icon="plus" onClick={m.show} aria-haspopup="dialog">
        Add rule version
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title={`${routeName} · v${nextVersion}`} kicker="Rule · New version" size="lg" tone="cobalt">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="routeId" value={routeId} />
            <p className="text-sm text-ink-soft">
              A new version is added next to the old ones — nothing is overwritten. {defaults ? "Pre-filled from the rule in effect; change what moved." : null}
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Takes effect on" required>
                {(p) => <Input {...p} type="date" name="effectiveFrom" defaultValue={today} required mono data-autofocus />}
              </Field>
              <Field label="Ends on" optional hint="Leave empty when open-ended.">
                {(p) => <Input {...p} type="date" name="effectiveTo" mono />}
              </Field>
              <Field label="Salary threshold (EUR / year)" optional>
                {(p) => (
                  <Input
                    {...p}
                    type="number"
                    inputMode="numeric"
                    name="salaryThresholdEur"
                    min={0}
                    step={1}
                    defaultValue={n(defaults?.salaryThresholdEur ?? null)}
                    mono
                  />
                )}
              </Field>
              <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
                <Field label="Local threshold" optional>
                  {(p) => (
                    <Input
                      {...p}
                      type="number"
                      inputMode="numeric"
                      name="salaryThresholdLocal"
                      min={0}
                      step={1}
                      defaultValue={n(defaults?.salaryThresholdLocal ?? null)}
                      mono
                    />
                  )}
                </Field>
                <Field label="Currency" optional>
                  {(p) => <Input {...p} name="currency" maxLength={3} defaultValue={defaults?.currency ?? ""} placeholder="GBP" mono className="uppercase" />}
                </Field>
              </div>
            </div>
            <Field label="Degree rule" optional>
              {(p) => <Textarea {...p} name="degreeRule" rows={2} maxLength={4000} defaultValue={defaults?.degreeRule ?? ""} />}
            </Field>
            <Field label="Experience rule" optional>
              {(p) => <Textarea {...p} name="experienceRule" rows={2} maxLength={4000} defaultValue={defaults?.experienceRule ?? ""} />}
            </Field>
            <Field label="Rule text" optional hint="Quote the official wording where you can.">
              {(p) => <Textarea {...p} name="ruleText" rows={4} maxLength={20000} defaultValue={defaults?.ruleText ?? ""} />}
            </Field>
            <Field label="Official source" optional hint="Defaults to the route’s official page.">
              {(p) => (
                <Input
                  {...p}
                  name="officialSourceUrl"
                  type="url"
                  inputMode="url"
                  maxLength={2048}
                  defaultValue={defaults?.officialSourceUrl ?? ""}
                  placeholder="https://"
                  mono
                />
              )}
            </Field>
            <Field label="Why the new version" required hint="Goes into the change log.">
              {(p) => <Input {...p} name="changeReason" minLength={3} maxLength={500} autoComplete="off" placeholder="2027 threshold announced" />}
            </Field>
            <Checkbox
              id={`rule-verified-${routeId}`}
              name="verified"
              value="1"
              label="I checked it against the official source today"
              description="Stamps it verified; otherwise it is added as unverified."
            />
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="plus" pending={pending} pendingLabel="Adding…">
                Add v{nextVersion}
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- live ------------------------------------------------------------------------------------

export function LiveToggle({ iso2, name, isLive, blocked }: { iso2: string; name: string; isLive: boolean; blocked: string | null }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(setCountryLiveAction, { errorTitle: isLive ? "Still live" : "Still off", onOk: m.hide });
  if (!isLive && blocked) {
    return (
      <div className="flex max-w-md flex-col gap-1.5">
        <Button variant="secondary" icon="lock" disabled aria-describedby={`live-blocked-${iso2}`}>
          Switch live
        </Button>
        <p id={`live-blocked-${iso2}`} className="m-0 text-xs text-ink-soft">
          {blocked}
        </p>
      </div>
    );
  }
  return (
    <>
      <Button variant={isLive ? "ghost" : "signal"} icon={isLive ? "pause" : "play"} onClick={m.show} aria-haspopup="dialog">
        {isLive ? "Switch off" : "Switch live"}
      </Button>
      {m.mounted ? (
        <Modal
          open={m.open}
          onClose={m.hide}
          title={isLive ? `Switch ${name} off` : `Switch ${name} on`}
          kicker="Country · Live"
          size="sm"
          tone={isLive ? "concrete" : "radar"}
        >
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="iso2" value={iso2} />
            <input type="hidden" name="live" value={isLive ? "0" : "1"} />
            <p className="text-sm text-ink-soft">
              {isLive
                ? "Records that you no longer rely on its rules. The Jobs list does not change and nothing is deleted."
                : "Records that you checked its visa rules and rely on them; the verified rule in effect is written down with the switch. The Jobs list does not change."}
            </p>
            <Field label="Reason" optional>
              {(p) => <Input {...p} name="reason" maxLength={500} autoComplete="off" data-autofocus />}
            </Field>
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant={isLive ? "danger" : "primary"} icon={isLive ? "pause" : "play"} pending={pending} pendingLabel="Switching…">
                {isLive ? "Switch off" : "Switch live"}
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}

// ---- official page reviewed ------------------------------------------------------------------

export function PageReviewedButton({ watchId }: { watchId: number }) {
  const m = useLazyModal();
  const { state, pending, onSubmit, formKey } = useKeepValuesAction(markPageReviewedAction, { errorTitle: "Not marked", onOk: m.hide });
  return (
    <>
      <Button variant="secondary" size="sm" icon="eye" onClick={m.show} aria-haspopup="dialog">
        Mark reviewed
      </Button>
      {m.mounted ? (
        <Modal open={m.open} onClose={m.hide} title="Official page reviewed" kicker="Watch · Review" size="sm" tone="acid">
          <form key={formKey} onSubmit={onSubmit} className="flex flex-col gap-4">
            <input type="hidden" name="watchId" value={watchId} />
            <p className="text-sm text-ink-soft">The rule is not changed. If the page shows a new threshold or rule, add a rule version too.</p>
            <Field label="Note" optional hint="What changed on the page, if anything.">
              {(p) => <Input {...p} name="note" maxLength={1000} autoComplete="off" data-autofocus />}
            </Field>
            <InlineError state={state} />
            <Actions>
              <Button variant="ghost" type="button" data-dialog-close>
                Cancel
              </Button>
              <SubmitButton variant="primary" icon="check" pending={pending} pendingLabel="Saving…">
                Mark reviewed
              </SubmitButton>
            </Actions>
          </form>
        </Modal>
      ) : null}
    </>
  );
}
