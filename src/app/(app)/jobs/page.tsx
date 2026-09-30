import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { FilterForm } from "@/components/jobs/FilterForm";
import { JobCard } from "@/components/jobs/JobCard";
import { ActiveChips, HiddenPanel, NoMatches, SortBar, revealEverythingHref } from "@/components/jobs/ListControls";
import { JOBS_PATH, activeFilterCount, canonicalJobsRedirect, filtersToParams, parseJobFilters } from "@/components/jobs/filters";
import { AsOf, Button, DrawerButton, EmptyState, Pagination, SectionHeader, formatNumber } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { startOfTodayInTz, appTz } from "@/lib/time";
import { listJobs } from "@/lib/queries/jobs";

export const metadata: Metadata = { title: "Jobs" };

export default async function JobsPage({ searchParams }: PageProps<"/jobs">) {
  await requireSession();
  const sp = await searchParams;
  const canonical = canonicalJobsRedirect(sp);
  if (canonical) redirect(canonical);
  const filters = parseJobFilters(sp);
  const now = new Date();
  const result = await listJobs(filters, { now });
  const f = result.filters;
  const newSince = startOfTodayInTz(appTz(), now);
  const nFilters = activeFilterCount(f);
  const params = filtersToParams(f);
  const first = result.total === 0 ? 0 : (f.page - 1) * result.pageSize + 1;
  const last = Math.min(result.total, f.page * result.pageSize);
  const scopeEmpty = result.breakdown.total === 0;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="01"
        kicker="HUNT · Jobs"
        title="Jobs"
        description="Every job on the scope. Filters live in the address bar — bookmark a view, share it with yourself, press Back."
        actions={<AsOf at={result.asOf} now={now} />}
      />

      <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)]">
        <aside aria-label="Filters" className="hidden lg:block">
          <div className="sticky top-6 max-h-[calc(100dvh-3rem)] overflow-y-auto border-3 border-ink bg-card p-4 shadow-md">
            <p className="micro mb-3 flex items-center justify-between text-ink">
              Filters
              {nFilters ? <span className="bg-ink px-1.5 py-0.5 font-mono text-paper tabular">{nFilters}</span> : null}
            </p>
            <FilterForm filters={f} facets={result.facets} idPrefix="fd" />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm" aria-live="polite">
              <span className="font-mono text-2xl font-bold tabular">{formatNumber(result.total)}</span>{" "}
              <span className="font-bold">{result.total === 1 ? "job" : "jobs"}</span>
              {result.total > result.pageSize ? (
                <span className="text-ink-soft">
                  {" "}
                  · showing {formatNumber(first)}–{formatNumber(last)}
                </span>
              ) : null}
            </p>
            <div className="lg:hidden">
              <DrawerButton label="Filters" icon="filter" badge={nFilters || null} title="Filter jobs" kicker="HUNT · Jobs">
                <FilterForm filters={f} facets={result.facets} idPrefix="fm" />
              </DrawerButton>
            </div>
          </div>

          <SortBar filters={f} />
          <ActiveChips filters={f} />
          <HiddenPanel filters={f} breakdown={result.breakdown} />

          {result.rows.length ? (
            <ul className="grid gap-4 sm:grid-cols-2 2xl:grid-cols-3" aria-label="Jobs">
              {result.rows.map((job) => (
                <li key={job.id} className="min-w-0">
                  <JobCard job={job} now={now} newSince={newSince} />
                </li>
              ))}
            </ul>
          ) : scopeEmpty ? (
            <EmptyState
              icon="radar"
              code="0 BLIPS"
              size="lg"
              title="The scope is quiet"
              actions={
                <>
                  <Button href="/sources" variant="primary" icon="sources">
                    Check the sources
                  </Button>
                  <Button href="/system" variant="secondary" icon="system">
                    Run status
                  </Button>
                </>
              }
              note="0 jobs stored · nothing is hidden, there is simply nothing yet"
            >
              <p>
                RADAR has not picked up any jobs yet. Once a source is live and the daily run finishes, matches land here with
                their visa, salary and fit receipts.
              </p>
            </EmptyState>
          ) : (
            <EmptyState
              icon="filter"
              code="NO MATCH"
              tone="signal"
              title="Nothing matches this view"
              actions={<NoMatches filters={f} breakdown={result.breakdown} />}
              note={`${formatNumber(result.breakdown.hidden)} of ${formatNumber(result.breakdown.total)} jobs hidden by the rules above`}
            >
              <p>
                The scope has jobs, but every one of them is kept out by a filter or a default rule. The panel above says which
                rule hides how many.
              </p>
            </EmptyState>
          )}

          {result.total > result.pageSize ? (
            <Pagination pathname={JOBS_PATH} searchParams={toSearchParams(params)} page={f.page} pageSize={result.pageSize} total={result.total} noun="jobs" />
          ) : null}

          {!scopeEmpty && result.rows.length > 0 && result.breakdown.hidden > 0 ? (
            <p className="text-xs text-muted">
              Looking for something that is not here?{" "}
              <Link href={revealEverythingHref(f)} className="font-bold text-ink underline underline-offset-4">
                Show every job on the scope
              </Link>
              .
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Pagination wants plain search params; the filters serialise to lists / scalars. */
function toSearchParams(p: ReturnType<typeof filtersToParams>): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [k, v] of Object.entries(p)) {
    if (v === null || v === undefined || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) out[k] = v.map(String);
    } else out[k] = v === true ? "1" : String(v);
  }
  return out;
}
