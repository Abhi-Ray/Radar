/**
 * Collapsible checkbox-chip group for GET filter forms (tracker and companies). Open when something
 * inside is ticked. Server-safe; the values land in the URL as repeated `name=` params.
 */
import type { ReactNode } from "react";
import { ChoiceChip } from "@/components/ui/Checkbox";
import { Icon } from "@/components/ui/icons";

export interface FacetOptionView {
  value: string;
  label: string;
  count?: number;
}

export function FacetGroup({
  legend,
  name,
  options,
  selected,
  idPrefix,
  empty,
  kind = "checkbox",
}: {
  legend: string;
  name: string;
  options: FacetOptionView[];
  selected: readonly string[];
  idPrefix: string;
  empty?: ReactNode;
  kind?: "checkbox" | "radio";
}) {
  const count = selected.filter(Boolean).length;
  return (
    <details open={count > 0} className="group border-b-2 border-ink/20 pb-3 [&[open]>summary_svg]:rotate-180">
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 font-bold [&::-webkit-details-marker]:hidden">
        <span className="micro text-ink">
          {legend}
          {count ? <span className="ml-2 bg-ink px-1.5 py-0.5 font-mono text-[0.6875rem] text-paper tabular">{count}</span> : null}
        </span>
        <Icon name="chevron-down" size={16} className="transition-transform motion-reduce:transition-none" />
      </summary>
      {options.length ? (
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{legend}</legend>
          <div className="flex max-h-64 flex-wrap gap-2 overflow-y-auto p-0.5">
            {options.map((o) => (
              <ChoiceChip
                key={o.value}
                kind={kind}
                id={`${idPrefix}-${name}-${o.value}`}
                name={name}
                value={o.value}
                defaultChecked={selected.includes(o.value)}
                className="[&>span]:min-h-9 [&>span]:px-2.5 [&>span]:text-xs [&>span]:normal-case [&>span]:tracking-normal pointer-coarse:[&>span]:min-h-11"
                label={
                  <>
                    {o.label}
                    {typeof o.count === "number" ? <span className="font-mono font-normal tabular opacity-70">{o.count}</span> : null}
                  </>
                }
              />
            ))}
          </div>
        </fieldset>
      ) : (
        <p className="text-sm text-muted">{empty ?? "Nothing to pick from yet."}</p>
      )}
    </details>
  );
}
