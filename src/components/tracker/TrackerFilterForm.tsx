/**
 * /applications filters: a plain GET form (next/form), so every view is a URL that survives reloads
 * and works without JavaScript. The mobile lane choice is carried along.
 */
import Form from "next/form";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Field } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { FacetOption } from "@/lib/queries/applications";
import { FacetGroup } from "./FacetGroup";
import { APPLICATIONS_PATH, type TrackerFilters } from "./filters";

export function TrackerFilterForm({ filters: f, facets, idPrefix }: { filters: TrackerFilters; facets: { country: FacetOption[]; source: FacetOption[] }; idPrefix: string }) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <Form action={APPLICATIONS_PATH} className="flex flex-col gap-4" aria-label="Filter applications">
      {f.lane ? <input type="hidden" name="lane" value={f.lane} /> : null}
      <Field label="Search" id={id("q")} hint="Company or job title.">
        {(p) => <Input {...p} name="q" type="search" icon="search" defaultValue={f.q ?? ""} maxLength={100} placeholder="security engineer…" />}
      </Field>
      <div className="flex flex-col border-b-2 border-ink/20 pb-3">
        <Checkbox id={id("due")} name="due" value="1" defaultChecked={f.due} label="Follow-up due" description="Due today or overdue." />
        <Checkbox id={id("open")} name="open" value="1" defaultChecked={f.open} label="Open only" description="Hide accepted, rejected, withdrawn and no-response." />
      </div>
      <FacetGroup legend="Country" name="country" idPrefix={idPrefix} selected={f.country} options={facets.country} empty="No applications yet." />
      <FacetGroup legend="Source" name="source" idPrefix={idPrefix} selected={f.source} options={facets.source} empty="No applications yet." />
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="primary" icon="filter" className="flex-1">
          Apply filters
        </SubmitButton>
        <Button href={APPLICATIONS_PATH} variant="ghost" icon="close">
          Reset
        </Button>
      </div>
    </Form>
  );
}
