"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { ChoiceChip, Checkbox, Toggle } from "@/components/ui/Checkbox";
import { Field, Fieldset } from "@/components/ui/Field";
import { Input, Select, Textarea } from "@/components/ui/Input";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { useToast, type ToastKind } from "@/components/ui/Toast";

const TOASTS: { kind: ToastKind; title: string; body?: string; label: string }[] = [
  { kind: "ok", label: "OK", title: "Application saved", body: "Stage: Applied · follow-up in 7 days" },
  { kind: "info", label: "Info", title: "Run queued", body: "arbeitnow · next slot 14:30 IST" },
  { kind: "warn", label: "Warn", title: "Signal lost: arbeitnow", body: "0 jobs this run — keeping yesterday's 212" },
  { kind: "error", label: "Error", title: "Could not save", body: "Salary must be a number or a range like 60000-72000" },
  { kind: "ai", label: "AI", title: "Quote verified", body: "AI extraction matched the posting text exactly" },
];

/** Fires one toast per kind so every style can be inspected. */
export function ToastDemo() {
  const { toast } = useToast();
  return (
    <div className="flex flex-wrap gap-2">
      {TOASTS.map((t) => (
        <Button key={t.kind} size="sm" variant="secondary" onClick={() => toast({ kind: t.kind, title: t.title, body: t.body })}>
          Toast · {t.label}
        </Button>
      ))}
    </div>
  );
}

/** Form controls wired like a real screen; submitting only raises a toast (no server call). */
export function FormDemo() {
  const { toast } = useToast();
  const [salary, setSalary] = useState("48000");
  const invalid = salary.trim() !== "" && !/^\d{4,7}(\s*-\s*\d{4,7})?$/.test(salary.trim());

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (invalid) {
      toast({ kind: "error", title: "Fix the highlighted field", body: "Salary floor must be a number or a range." });
      return;
    }
    toast({ kind: "ok", title: "Specimen form accepted", body: "Nothing was saved — this is the styleguide." });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-5 lg:grid-cols-2" noValidate>
      <div className="flex flex-col gap-4">
        <Field label="Search" hint="Title, company or skill. Matches across languages.">
          {(p) => <Input {...p} name="q" icon="search" placeholder="cloud security, Kubernetes…" />}
        </Field>
        <Field label="Salary floor" required error={invalid ? "Use a number (48000) or a range (48000-60000)." : undefined} hint="Gross per year, before any estimate is applied.">
          {(p) => <Input {...p} name="salary" mono suffix="EUR" inputMode="numeric" value={salary} onChange={(e) => setSalary(e.target.value)} />}
        </Field>
        <Field label="Country" optional>
          {(p) => (
            <Select
              {...p}
              name="country"
              placeholder="Any country"
              options={[
                { value: "DE", label: "Germany" },
                { value: "NL", label: "Netherlands" },
                { value: "IE", label: "Ireland" },
                { value: "NO", label: "Norway" },
              ]}
            />
          )}
        </Field>
        <Field label="Notes" optional hint="Private. Never sent anywhere.">
          {(p) => <Textarea {...p} name="notes" rows={3} placeholder="Recruiter said the team is remote-first within CET ±2h." />}
        </Field>
        <Field label="Read-only value">
          {(p) => <Input {...p} readOnly mono value="visa-rules@2026-09-01.2" />}
        </Field>
        <Field label="Disabled">
          {(p) => <Input {...p} disabled placeholder="Locked while a run is active" />}
        </Field>
      </div>
      <div className="flex flex-col gap-4">
        <Fieldset legend="Visa route" hint="Pick one.">
          <div className="flex flex-wrap gap-2">
            <ChoiceChip name="route" value="blue-card" label="EU Blue Card" defaultChecked />
            <ChoiceChip name="route" value="skilled" label="Skilled worker" />
            <ChoiceChip name="route" value="any" label="Any" />
            <ChoiceChip name="route" value="none" label="Disabled" disabled />
          </div>
        </Fieldset>
        <Fieldset legend="Show">
          <Checkbox name="remote" label="Remote-friendly only" description="Includes 'remote within EU' but not 'remote (US only)'." defaultChecked />
          <Checkbox name="estimates" label="Include estimated salaries" description="Shown hatched, never mixed with stated ones." />
          <Checkbox name="closed" label="Closed postings" disabled />
        </Fieldset>
        <div className="border-3 border-ink bg-card px-3 md:px-4">
          <Toggle name="alerts" label="Email alerts" description="Critical alerts only, max one per hour." defaultChecked />
          <div className="border-t-2 border-dashed border-ink" />
          <Toggle name="ai" label="AI extraction" description="Off: rules and records only." onLabel="Yes" offLabel="No" />
        </div>
        <div className="mt-auto flex flex-wrap gap-3 pt-2">
          <SubmitButton variant="primary" icon="check">
            Apply filters
          </SubmitButton>
          <Button type="reset" variant="ghost" onClick={() => setSalary("")}>
            Reset
          </Button>
        </div>
      </div>
    </form>
  );
}
