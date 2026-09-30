import type { Metadata } from "next";
import Link from "next/link";
import { CompanyCards } from "@/components/companies/CompanyCards";
import { CompanyFilterForm } from "@/components/companies/CompanyFilterForm";
import { COMPANIES_PATH, activeCompanyFilterCount, companiesHref, companySearchParams, parseCompanyFilters } from "@/components/companies/filters";
import { SPONSOR_CLASSES, SPONSOR_CLASS_LABEL } from "@/components/companies/model";
import { companyTypeLabel, sizeLabel } from "@/components/companies/view";
import { Button, DrawerButton, EmptyState, FilterChip, FilterChipRow, Pagination, SectionHeader, formatNumber } from "@/components/ui";
import { listCompanies } from "@/lib/queries/companies";

export const metadata: Metadata = { title: "Companies" };

export default async function CompaniesPage({ searchParams }: PageProps<"/companies">) {
  const f = parseCompanyFilters(await searchParams);
  const list = await listCompanies(f);
  const nFilters = activeCompanyFilterCount(f);
  const countryLabel = new Map(list.facets.country.map((c) => [c.value, c.label]));
  const sponsorCount = new Map(list.facets.sponsor.map((s) => [s.value, s.count]));

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="03"
        kicker="SCOPE · Companies"
        title="Companies"
        description="Every employer RADAR has seen, with the sponsor-register evidence behind each verdict. “No evidence” means nothing was found — not that they refuse."
      />

      {list.all === 0 ? (
        <EmptyState
          icon="companies"
          code="0 SEEN"
          size="lg"
          title="No companies yet"
          actions={
            <Button href="/jobs" variant="secondary" icon="jobs">
              Go to jobs
            </Button>
          }
          note="Companies are created from job postings"
        >
          <p>Each company shows up here once a job from it is collected. Sponsor registers are matched against them automatically.</p>
        </EmptyState>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
          <aside aria-label="Filters" className="hidden lg:block">
            <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto border-3 border-ink bg-card p-4 shadow-md">
              <p className="micro mb-3 flex items-center justify-between text-ink">
                Filters
                {nFilters ? <span className="bg-ink px-1.5 py-0.5 font-mono text-paper tabular">{nFilters}</span> : null}
              </p>
              <CompanyFilterForm filters={f} facets={list.facets} idPrefix="cfd" />
            </div>
          </aside>

          <section aria-labelledby="companies-count" className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="companies-count" className="text-sm" aria-live="polite">
                <span className="font-mono text-2xl font-bold tabular">{formatNumber(list.total)}</span>{" "}
                <span className="font-bold">{list.total === 1 ? "company" : "companies"}</span>
                {nFilters ? <span className="text-ink-soft"> · of {formatNumber(list.all)}</span> : null}
              </h2>
              <div className="lg:hidden">
                <DrawerButton label="Filters" icon="filter" badge={nFilters || null} title="Filter companies" kicker="SCOPE · Companies">
                  <CompanyFilterForm filters={f} facets={list.facets} idPrefix="cfm" />
                </DrawerButton>
              </div>
            </div>

            <FilterChipRow label="Sponsor">
              {SPONSOR_CLASSES.map((c) => {
                const on = f.sponsor.includes(c);
                return (
                  <FilterChip key={c} href={companiesHref(f, { sponsor: on ? f.sponsor.filter((x) => x !== c) : [...f.sponsor, c], page: null })} active={on} count={on ? null : (sponsorCount.get(c) ?? 0)}>
                    {SPONSOR_CLASS_LABEL[c]}
                  </FilterChip>
                );
              })}
              <FilterChip href={companiesHref(f, { agency: f.agency === "no" ? null : "no", page: null })} active={f.agency === "no"}>
                No agencies
              </FilterChip>
            </FilterChipRow>

            {nFilters ? (
              <FilterChipRow label="Active">
                {f.q ? (
                  <FilterChip href={companiesHref(f, { q: null, page: null })} active>
                    “{f.q}”
                  </FilterChip>
                ) : null}
                {f.size.map((s) => (
                  <FilterChip key={`s-${s}`} href={companiesHref(f, { size: f.size.filter((x) => x !== s), page: null })} active>
                    {s === "none" ? "Size unknown" : (sizeLabel(s) ?? s)}
                  </FilterChip>
                ))}
                {f.type.map((t) => (
                  <FilterChip key={`t-${t}`} href={companiesHref(f, { type: f.type.filter((x) => x !== t), page: null })} active>
                    {companyTypeLabel(t)}
                  </FilterChip>
                ))}
                {f.country.map((c) => (
                  <FilterChip key={`c-${c}`} href={companiesHref(f, { country: f.country.filter((x) => x !== c), page: null })} active>
                    {countryLabel.get(c) ?? c}
                  </FilterChip>
                ))}
                {f.agency === "yes" ? (
                  <FilterChip href={companiesHref(f, { agency: null, page: null })} active>
                    Agencies only
                  </FilterChip>
                ) : null}
                <Link
                  href={f.sort !== "jobs" ? companiesHref({ ...f, q: null, sponsor: [], size: [], type: [], country: [], agency: null, page: 1 }) : COMPANIES_PATH}
                  scroll={false}
                  className="micro inline-flex min-h-9 shrink-0 items-center px-2 text-stamp-deep underline underline-offset-4 pointer-coarse:min-h-11"
                >
                  Clear all
                </Link>
              </FilterChipRow>
            ) : null}

            {list.total === 0 ? (
              <EmptyState
                icon="filter"
                code="NO MATCH"
                tone="signal"
                title="No company matches this view"
                actions={
                  <Button href={COMPANIES_PATH} variant="primary" icon="close">
                    Clear the filters
                  </Button>
                }
              >
                <p>{formatNumber(list.all)} companies are on file, but none fit these filters.</p>
              </EmptyState>
            ) : (
              <>
                <CompanyCards rows={list.rows} />
                <Pagination pathname={COMPANIES_PATH} searchParams={companySearchParams(f)} page={list.page} pageSize={list.pageSize} total={list.total} noun="companies" />
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
