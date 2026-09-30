import type { Metadata } from "next";
import Link from "next/link";
import { Board } from "@/components/tracker/Board";
import { DueReminders } from "@/components/tracker/DueReminders";
import { ExportLinks } from "@/components/tracker/ExportLinks";
import { QuickAdd } from "@/components/tracker/QuickAdd";
import { StatsPanel } from "@/components/tracker/StatsPanel";
import { TrackerFilterForm } from "@/components/tracker/TrackerFilterForm";
import { APPLICATIONS_PATH, activeTrackerFilterCount, boardLanes, parseTrackerFilters, pickLane, trackerHref } from "@/components/tracker/filters";
import { Button, Card, DrawerButton, EmptyState, FilterChip, FilterChipRow, Notice, SectionHeader, formatNumber } from "@/components/ui";
import { loadBoard, BOARD_CARD_LIMIT } from "@/lib/queries/applications";
import { appTz, localDay } from "@/lib/time";

export const metadata: Metadata = { title: "Tracker" };

export default async function TrackerPage({ searchParams }: PageProps<"/applications">) {
  const f = parseTrackerFilters(await searchParams);
  const tz = appTz();
  const now = new Date();
  const board = await loadBoard(f, { now, tz });
  const lanes = boardLanes(f);
  const lane = pickLane(f.lane, lanes, board.counts);
  const nFilters = activeTrackerFilterCount(f);
  const today = localDay(now, tz);
  const countryLabel = new Map(board.facets.country.map((c) => [c.value, c.label]));
  const sourceLabel = new Map(board.facets.source.map((s) => [s.value, s.label]));
  const dueNow = board.due.filter((d) => d.bucket === "overdue" || d.bucket === "today").length;
  const quickAdd = <QuickAdd countries={board.countries} resumes={board.resumes} today={today} />;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="02"
        kicker="TRACK · Applications"
        title="Tracker"
        description="Every application from saved to offer, with its logbook. Stages only move forward — a step back is a correction with a reason, never an edit."
        actions={quickAdd}
      />

      {board.total === 0 ? (
        <EmptyState
          icon="tracker"
          code="0 SENT"
          size="lg"
          title="Nothing tracked yet"
          actions={
            <>
              {quickAdd}
              <Button href="/jobs" variant="secondary" icon="jobs">
                Find a job to apply for
              </Button>
            </>
          }
          note="Mark a job applied from its page, or log one RADAR never saw"
        >
          <p>The tracker fills up as you apply. Each application gets a logbook, a copy of the posting and follow-up reminders.</p>
        </EmptyState>
      ) : (
        <>
          <DueReminders due={board.due} now={now} tz={tz} />

          <section aria-labelledby="board-title" className="flex min-w-0 flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="board-title" className="text-sm" aria-live="polite">
                <span className="font-mono text-2xl font-bold tabular">{formatNumber(board.matching)}</span>{" "}
                <span className="font-bold">{board.matching === 1 ? "application" : "applications"}</span>
                {nFilters ? <span className="text-ink-soft"> · of {formatNumber(board.total)}</span> : null}
              </h2>
              <DrawerButton label="Filters" icon="filter" badge={nFilters || null} title="Filter applications" kicker="TRACK · Applications">
                <TrackerFilterForm filters={f} facets={board.facets} idPrefix="tf" />
              </DrawerButton>
            </div>

            <FilterChipRow label="Quick">
              <FilterChip href={trackerHref(f, { due: f.due ? null : "1" })} active={f.due} count={f.due ? null : dueNow}>
                Follow-up due
              </FilterChip>
              <FilterChip href={trackerHref(f, { open: f.open ? null : "1" })} active={f.open}>
                Open only
              </FilterChip>
              {f.q ? (
                <FilterChip href={trackerHref(f, { q: null })} active>
                  “{f.q}”
                </FilterChip>
              ) : null}
              {f.country.map((c) => (
                <FilterChip key={`c-${c}`} href={trackerHref(f, { country: f.country.filter((x) => x !== c) })} active>
                  {countryLabel.get(c) ?? c}
                </FilterChip>
              ))}
              {f.source.map((s) => (
                <FilterChip key={`s-${s}`} href={trackerHref(f, { source: f.source.filter((x) => x !== s) })} active>
                  {sourceLabel.get(s) ?? s}
                </FilterChip>
              ))}
              {nFilters ? (
                <Link href={f.lane ? trackerHref({ q: null, country: [], source: [], due: false, open: false, lane: f.lane }) : APPLICATIONS_PATH} scroll={false} className="micro inline-flex min-h-9 shrink-0 items-center px-2 text-stamp-deep underline underline-offset-4 pointer-coarse:min-h-11">
                  Clear all
                </Link>
              ) : null}
            </FilterChipRow>

            {board.truncated ? (
              <Notice kind="info" title={`Showing the ${formatNumber(BOARD_CARD_LIMIT)} most recently updated`}>
                The lane counts include everything; narrow the view with a filter to see older applications.
              </Notice>
            ) : null}

            {board.matching === 0 ? (
              <EmptyState
                icon="filter"
                code="NO MATCH"
                tone="signal"
                title="Nothing matches this view"
                actions={
                  <Button href={APPLICATIONS_PATH} variant="primary" icon="close">
                    Clear the filters
                  </Button>
                }
              >
                <p>{formatNumber(board.total)} applications are tracked, but none fit these filters.</p>
              </EmptyState>
            ) : (
              <Board cards={board.cards} lanes={lanes} counts={board.counts} mobileLane={lane} filters={f} now={now} tz={tz} />
            )}
          </section>

          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
            <StatsPanel stats={board.stats} filtered={nFilters > 0} />
            <Card as="aside" pad="md" aria-label="Export the tracker">
              <ExportLinks />
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
