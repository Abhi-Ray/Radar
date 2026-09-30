/**
 * /companies filters: a plain GET form (next/form), so every view is a URL that survives reloads
 * and works without JavaScript. Counts come from the other filters (facet counts).
 */
import Form from "next/form";
import { FacetGroup } from "@/components/tracker/FacetGroup";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { Input, Select } from "@/components/ui/Input";
import { SubmitButton } from "@/components/ui/SubmitButton";
import type { CompanyList } from "@/lib/queries/companies";
import { COMPANIES_PATH, COMPANY_SORTS, COMPANY_SORT_LABEL, type CompanyFilters } from "./filters";
import { SPONSOR_CLASSES, SPONSOR_CLASS_LABEL, type SponsorClass } from "./model";
import { companyTypeLabel, sizeLabel } from "./view";

export function CompanyFilterForm({ filters: f, facets, idPrefix }: { filters: CompanyFilters; facets: CompanyList["facets"]; idPrefix: string }) {
  const id = (s: string) => `${idPrefix}-${s}`;
  const sponsorCount = new Map(facets.sponsor.map((s) => [s.value, s.count]));
  const agencyCount = new Map(facets.agency.map((a) => [a.value, a.count]));
  const agencyTotal = facets.agency.reduce((n, a) => n + a.count, 0);
  return (
    <Form action={COMPANIES_PATH} className="flex flex-col gap-4" aria-label="Filter companies">
      <Field label="Search" id={id("q")} hint="Name, other names or domain.">
        {(p) => <Input {...p} name="q" type="search" icon="search" defaultValue={f.q ?? ""} maxLength={100} placeholder="acme…" />}
      </Field>
      <FacetGroup
        legend="Sponsor evidence"
        name="sponsor"
        idPrefix={idPrefix}
        selected={f.sponsor}
        options={SPONSOR_CLASSES.map((c: SponsorClass) => ({ value: c, label: SPONSOR_CLASS_LABEL[c], count: sponsorCount.get(c) ?? 0 }))}
      />
      <FacetGroup
        legend="Size"
        name="size"
        idPrefix={idPrefix}
        selected={f.size}
        options={facets.size.map((s) => ({ value: s.value, label: s.value === "none" ? s.label : (sizeLabel(s.value) ?? s.label), count: s.count }))}
        empty="No sizes recorded yet."
      />
      <FacetGroup
        legend="Type"
        name="type"
        idPrefix={idPrefix}
        selected={f.type}
        options={facets.type.map((t) => ({ value: t.value, label: companyTypeLabel(t.value), count: t.count }))}
        empty="No companies yet."
      />
      <FacetGroup legend="HQ country" name="country" idPrefix={idPrefix} selected={f.country} options={facets.country} empty="No companies yet." />
      <FacetGroup
        legend="Agency"
        name="agency"
        kind="radio"
        idPrefix={idPrefix}
        selected={f.agency ? [f.agency] : [""]}
        options={[
          { value: "", label: "Either", count: agencyTotal },
          { value: "no", label: "Direct employers", count: agencyCount.get("no") ?? 0 },
          { value: "yes", label: "Agencies only", count: agencyCount.get("yes") ?? 0 },
        ]}
      />
      <Field label="Sort" id={id("sort")}>
        {(p) => <Select {...p} name="sort" defaultValue={f.sort} options={COMPANY_SORTS.map((s) => ({ value: s, label: COMPANY_SORT_LABEL[s] }))} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="primary" icon="filter" className="flex-1">
          Apply filters
        </SubmitButton>
        <Button href={COMPANIES_PATH} variant="ghost" icon="close">
          Reset
        </Button>
      </div>
    </Form>
  );
}
