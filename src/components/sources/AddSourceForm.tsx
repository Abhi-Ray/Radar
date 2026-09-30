"use client";

import { useState } from "react";
import { InlineError, useFormAction } from "@/components/tracker/action-hooks";
import { Field, Input, Select, SubmitButton, Textarea } from "@/components/ui";
import { createSourceAction } from "@/lib/actions/sources";

export interface ConnectorChoice {
  key: string;
  name: string;
  grade: string;
  kind: string;
  example: string;
}

/** Adds a source as a DRAFT: it joins the daily run only after a trial and the checklist. */
export function AddSourceForm({ choices }: { choices: ConnectorChoice[] }) {
  const { state, action } = useFormAction(createSourceAction);
  const [key, setKey] = useState(choices[0]?.key ?? "");
  const example = choices.find((c) => c.key === key)?.example ?? "{}";
  return (
    <form action={action} className="grid gap-4 md:grid-cols-2">
      <Field label="Connector" required hint="Grade A/B are official or structured feeds; C/D are scraped or aggregated.">
        {(p) => <Select {...p} name="platformKey" value={key} onChange={(e) => setKey(e.target.value)} options={choices.map((c) => ({ value: c.key, label: `${c.name} · grade ${c.grade}` }))} />}
      </Field>
      <Field label="Label" required hint="How it appears in lists, e.g. “GitLab (Greenhouse)”.">
        {(p) => <Input {...p} name="label" minLength={2} maxLength={191} autoComplete="off" />}
      </Field>
      <Field label="Country" optional hint="Two-letter code like DE. Empty = worldwide / remote.">
        {(p) => <Input {...p} name="countryIso2" maxLength={2} autoComplete="off" className="uppercase" />}
      </Field>
      <Field label="Config (JSON)" required hint={<span className="break-all font-mono">e.g. {example}</span>}>
        {(p) => <Textarea {...p} key={key} name="config" rows={4} defaultValue={example} spellCheck={false} className="font-mono" />}
      </Field>
      <div className="flex flex-wrap items-center gap-3 md:col-span-2">
        <SubmitButton variant="primary" icon="plus" pendingLabel="Adding…">
          Add as draft
        </SubmitButton>
        <InlineError state={state} />
      </div>
    </form>
  );
}
