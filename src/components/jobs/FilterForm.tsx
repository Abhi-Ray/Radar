import Form from "next/form";
import type { ReactNode } from "react";
import { COMPANY_TYPES, JOB_STATES, REMOTE_CLASSES, ROLE_FAMILIES, VISA_STATUSES } from "@/db/schema/_enums";
import { Button, ChoiceChip, Checkbox, Field, Icon, Input, Select, SubmitButton, VISA_META, cn } from "@/components/ui";
import type { JobFacets } from "@/lib/queries/jobs";
import { COMPANY_TYPE_LABEL, CONFIDENCE_LABEL, FAMILY_LABEL, REMOTE_LABEL, STATE_LABEL } from "./labels";
import { JOBS_PATH, MINE_KEYS, MINE_LABEL, POSTED_WINDOWS, SORT_KEYS, SORT_LABEL, clearFiltersHref, type JobFilters } from "./filters";

interface Option {
  value: string;
  label: string;
  count?: number;
}

/** Collapsible checkbox group; open when something inside is selected. */
function ChipGroup({ legend, name, options, selected, idPrefix, empty }: { legend: string; name: string; options: Option[]; selected: readonly string[]; idPrefix: string; empty?: string }) {
  const count = selected.length;
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
                kind="checkbox"
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

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-b-2 border-ink/20 pb-4">
      <p className="micro text-ink">{title}</p>
      {children}
    </div>
  );
}

export interface FilterFormProps {
  filters: JobFilters;
  facets: JobFacets;
  /** Distinguishes the desktop and drawer copies (unique ids). */
  idPrefix: string;
  /** Hide the submit row (the drawer renders its own). */
  className?: string;
}

/**
 * The /jobs filter form. A plain GET form (next/form) — every filter lives in the URL, works
 * without JavaScript, and "Back" restores the previous view.
 */
export function FilterForm({ filters: f, facets, idPrefix, className }: FilterFormProps) {
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <Form action={JOBS_PATH} className={cn("flex flex-col gap-4", className)} aria-label="Filter jobs">
      <Field label="Search" id={id("q")} hint="Title or company.">
        {(p) => <Input {...p} name="q" type="search" icon="search" defaultValue={f.q ?? ""} maxLength={100} placeholder="cloud security…" />}
      </Field>

      <Field label="Sort by" id={id("sort")}>
        {(p) => <Select {...p} name="sort" defaultValue={f.sort} options={SORT_KEYS.map((k) => ({ value: k, label: SORT_LABEL[k] }))} />}
      </Field>

      <Section title="Visa & money">
        <ChipGroup legend="Visa status" name="visa" idPrefix={idPrefix} selected={f.visa} options={VISA_STATUSES.map((v) => ({ value: v, label: VISA_META[v].label }))} />
        <Field label="Salary at least" id={id("salary")} hint="Annual EUR; the top of the range must reach it." optional>
          {(p) => <Input {...p} name="salary" type="number" inputMode="numeric" min={1} max={1000000} step={1000} mono suffix="EUR/yr" defaultValue={f.salary ?? ""} />}
        </Field>
        <Checkbox id={id("stated")} name="stated" value="1" defaultChecked={f.stated} label="Stated salary only" description="Leave out estimates." />
      </Section>

      <Section title="Where">
        <ChipGroup legend="Country" name="country" idPrefix={idPrefix} selected={f.country} options={facets.countries} empty="No countries on the scope yet." />
        <ChipGroup legend="Remote" name="remote" idPrefix={idPrefix} selected={f.remote} options={REMOTE_CLASSES.map((r) => ({ value: r, label: REMOTE_LABEL[r] }))} />
      </Section>

      <Section title="Role & company">
        <ChipGroup legend="Role family" name="family" idPrefix={idPrefix} selected={f.family} options={ROLE_FAMILIES.map((r) => ({ value: r, label: FAMILY_LABEL[r] }))} />
        <ChipGroup legend="Role" name="role" idPrefix={idPrefix} selected={f.role} options={facets.roles} empty="No mapped roles yet." />
        <ChipGroup legend="Company size" name="size" idPrefix={idPrefix} selected={f.size} options={facets.sizes} empty="No company sizes known yet." />
        <ChipGroup legend="Company type" name="ctype" idPrefix={idPrefix} selected={f.ctype} options={COMPANY_TYPES.map((t) => ({ value: t, label: COMPANY_TYPE_LABEL[t] }))} />
      </Section>

      <Section title="Quality & freshness">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Fit at least" id={id("fit")} optional>
            {(p) => <Input {...p} name="fit" type="number" inputMode="numeric" min={1} max={100} mono defaultValue={f.fit ?? ""} />}
          </Field>
          <Field label="Confidence" id={id("conf")}>
            {(p) => (
              <Select
                {...p}
                name="conf"
                defaultValue={f.conf ?? ""}
                options={[{ value: "", label: "Any" }, ...(["medium", "high"] as const).map((c) => ({ value: c, label: `${CONFIDENCE_LABEL[c]}+` })), { value: "low", label: "Low+ (known)" }]}
              />
            )}
          </Field>
        </div>
        <Field label="Posted within" id={id("posted")}>
          {(p) => (
            <Select
              {...p}
              name="posted"
              defaultValue={f.posted === null ? "" : String(f.posted)}
              options={[
                { value: "", label: "Any time" },
                ...(f.posted !== null && !(POSTED_WINDOWS as readonly number[]).includes(f.posted) ? [f.posted] : []).map((d) => ({ value: String(d), label: `${d} days` })),
                ...POSTED_WINDOWS.map((d) => ({ value: String(d), label: d === 1 ? "24 hours" : `${d} days` })),
              ]}
            />
          )}
        </Field>
        <ChipGroup legend="Source" name="source" idPrefix={idPrefix} selected={f.source} options={facets.platforms} empty="No sources have delivered jobs yet." />
        <ChipGroup legend="State" name="state" idPrefix={idPrefix} selected={f.state} options={JOB_STATES.map((s) => ({ value: s, label: STATE_LABEL[s] }))} />
      </Section>

      <Section title="Mine">
        <ChipGroup legend="Only jobs I…" name="mine" idPrefix={idPrefix} selected={f.mine} options={MINE_KEYS.map((m) => ({ value: m, label: MINE_LABEL[m] }))} />
      </Section>

      <Section title="Default view">
        <p className="text-xs text-muted">RADAR leaves these out unless you ask. Each one is counted in the hidden panel.</p>
        <Checkbox id={id("show-all")} name="show" value="all" defaultChecked={f.show.includes("all")} label="Show everything" description="Region-limited remote, out-of-band and closed jobs." />
        <Checkbox id={id("show-remote")} name="show" value="remote" defaultChecked={f.show.includes("remote")} label="Region / time-zone-limited remote" />
        <Checkbox id={id("show-experience")} name="show" value="experience" defaultChecked={f.show.includes("experience")} label="Outside my experience band" />
        <Checkbox id={id("show-closed")} name="show" value="closed" defaultChecked={f.show.includes("closed")} label="Closed or expired" />
        <Checkbox id={id("show-hidden")} name="show" value="hidden" defaultChecked={f.show.includes("hidden")} label="Jobs I hid" />
      </Section>

      <div className="flex flex-wrap gap-2">
        <SubmitButton variant="primary" icon="filter" className="flex-1">
          Apply filters
        </SubmitButton>
        <Button href={clearFiltersHref({ ...f, show: [] })} variant="ghost" icon="close">
          Reset
        </Button>
      </div>
    </Form>
  );
}
