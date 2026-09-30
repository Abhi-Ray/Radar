"use client";

/**
 * Fill in a template: one input per `{{slot}}`, a live preview, and copy as plain text (for an
 * email or a web form) or as Markdown. Nothing is saved — the values live in this tab only.
 */
import { useDeferredValue, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Textarea } from "@/components/ui/Input";
import { CopyButton } from "./CopyButton";
import { Markdown } from "./MarkdownView";
import { markdownToPlain, wordCount } from "./markdown";
import { fillTemplate, prefillValues, templateFields, type PrefillSource } from "./template";

const LONG = /why|summary|paragraph|body|pitch|story|motivation|note/i;

export function TemplateWorkbench({
  templateId,
  name,
  bodyMd,
  fieldsJson,
  prefill,
  prefillLabel,
}: {
  templateId: number;
  name: string;
  bodyMd: string;
  fieldsJson: unknown;
  prefill: PrefillSource | null;
  /** "Security Engineer · Acme" when the values came from a job. */
  prefillLabel: string | null;
}) {
  const fields = templateFields(bodyMd, fieldsJson);
  const initial = prefill ? prefillValues(fields, prefill) : {};
  const [values, setValues] = useState<Record<string, string>>(initial);
  const shown = useDeferredValue(values);
  const labels = Object.fromEntries(fields.map((f) => [f.key, f.label]));
  const { missing } = fillTemplate(bodyMd, shown);
  const plain = markdownToPlain(bodyMd, { slots: shown });
  const md = fillTemplate(bodyMd, shown).text;
  const set = (k: string, v: string) => setValues((cur) => ({ ...cur, [k]: v }));
  const id = (k: string) => `tpl-${templateId}-${k.replace(/[^\w-]/g, "_")}`;
  return (
    <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-3">
        {prefillLabel ? (
          <p className="border-2 border-dashed border-ink bg-acid-tint px-2 py-1.5 text-xs">
            Prefilled from <strong>{prefillLabel}</strong> — check every line before sending.
          </p>
        ) : null}
        {fields.length ? (
          fields.map((f) => (
            <Field key={f.key} id={id(f.key)} label={f.label} optional hint={f.hint ?? (f.used ? undefined : "Declared but not used in the text.")}>
              {(p) =>
                LONG.test(f.key) ? (
                  <Textarea {...p} rows={3} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.currentTarget.value)} maxLength={4000} />
                ) : (
                  <Input {...p} value={values[f.key] ?? ""} onChange={(e) => set(f.key, e.currentTarget.value)} maxLength={500} autoComplete="off" />
                )
              }
            </Field>
          ))
        ) : (
          <p className="text-sm text-ink-soft">
            This template has no <code className="font-mono">{"{{fields}}"}</code> — it is copied as written.
          </p>
        )}
        {fields.length ? (
          <div>
            <Button type="button" variant="ghost" size="sm" icon="refresh" onClick={() => setValues(prefill ? prefillValues(fields, prefill) : {})}>
              {prefill ? "Back to the prefilled values" : "Clear the fields"}
            </Button>
          </div>
        ) : null}
      </div>
      <section aria-label={`Preview of ${name}`} className="flex min-w-0 flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="micro text-ink">
            Preview · <span className="font-mono tabular text-muted">{wordCount(plain)} words</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <CopyButton text={plain} label="Copy text" what={name} variant="primary" />
            <CopyButton text={md} label="Copy Markdown" what={`${name} (Markdown)`} />
          </div>
        </div>
        {missing.length ? (
          <p className="border-2 border-ink bg-signal-tint px-2 py-1 text-xs" role="status">
            {missing.length} field{missing.length === 1 ? "" : "s"} still empty: {missing.map((k) => labels[k] ?? k).join(", ")}.
          </p>
        ) : null}
        <div className="min-w-0 border-3 border-ink bg-card p-4 shadow-md sm:p-5">
          <Markdown source={bodyMd} slots={shown} slotLabels={labels} emptyText="The template is empty." />
        </div>
      </section>
    </div>
  );
}
