import Link from "next/link";
import { Button, FilterChip, FilterChipRow, Icon, formatNumber } from "@/components/ui";
import { EMPTY_FILTERS, SORT_KEYS, SORT_LABEL, activeRules, clearFiltersHref, jobsHref, type HiddenBreakdown, type JobFilters } from "./filters";

/** Link that drops every filter and every default rule (hidden jobs included). */
export function revealEverythingHref(f: JobFilters): string {
  return jobsHref({ ...EMPTY_FILTERS, sort: f.sort, show: ["all", "hidden"] });
}

/**
 * "N hidden by filters": every rule that is narrowing the list, how many jobs it alone keeps out,
 * and a one-click reveal. Jobs caught by two or more rules are counted once, separately.
 */
export function HiddenPanel({ filters: f, breakdown: b }: { filters: JobFilters; breakdown: HiddenBreakdown }) {
  if (b.hidden === 0 && b.byRule.every((r) => r.count === 0)) {
    if (b.total === 0) return null;
    return (
      <p className="flex items-center gap-2 border-2 border-dashed border-ink/40 px-3 py-2 text-sm text-ink-soft">
        <Icon name="check" size={16} className="text-radar-deep" />
        Nothing hidden — all {formatNumber(b.total)} {b.total === 1 ? "job" : "jobs"} on the scope match.
      </p>
    );
  }
  const rows = b.byRule.filter((r) => r.count > 0);
  const quiet = b.byRule.filter((r) => r.count === 0);
  return (
    <section aria-labelledby="hidden-panel-title" className="border-3 border-ink bg-card shadow-sm">
      <details className="group" open={b.shown === 0}>
        <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hatch-soft [&::-webkit-details-marker]:hidden">
          <Icon name="eye-off" size={18} />
          <h2 id="hidden-panel-title" className="text-base font-extrabold">
            <span className="font-mono tabular">{formatNumber(b.hidden)}</span> hidden by filters
          </h2>
          <span className="text-sm text-ink-soft">
            of {formatNumber(b.total)} on the scope · {formatNumber(b.shown)} shown
          </span>
          <span className="micro ml-auto inline-flex items-center gap-1 text-ink">
            <span className="group-open:hidden">Why?</span>
            <span className="hidden group-open:inline">Close</span>
            <Icon name="chevron-down" size={16} className="transition-transform group-open:rotate-180 motion-reduce:transition-none" />
          </span>
        </summary>
        <div className="border-t-3 border-ink">
          <ul className="divide-y-2 divide-ink/15">
            {rows.map(({ rule, count }) => (
              <li key={rule.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-14 shrink-0 text-right font-mono text-lg font-bold tabular">{formatNumber(count)}</span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="micro mr-2 text-muted">{rule.kind === "default" ? "Default" : "Your filter"}</span>
                  <span className="font-bold [overflow-wrap:anywhere]">{rule.label}</span>
                </span>
                <Link href={rule.revealHref} scroll={false} className="micro inline-flex min-h-11 items-center gap-1 px-1 text-cobalt-deep underline underline-offset-4 hover:text-ink">
                  {rule.revealLabel}
                  <span className="sr-only"> ({rule.label})</span>
                  <Icon name="arrow-right" size={14} />
                </Link>
              </li>
            ))}
            {b.multi > 0 ? (
              <li className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <span className="w-14 shrink-0 text-right font-mono text-lg font-bold tabular">{formatNumber(b.multi)}</span>
                <span className="min-w-0 flex-1 text-sm font-bold">Caught by two or more rules at once</span>
                <Link href={revealEverythingHref(f)} scroll={false} className="micro inline-flex min-h-11 items-center gap-1 px-1 text-cobalt-deep underline underline-offset-4 hover:text-ink">
                  Show everything
                  <Icon name="arrow-right" size={14} />
                </Link>
              </li>
            ) : null}
          </ul>
          {quiet.length ? (
            <p className="border-t-2 border-ink/15 px-3 py-2 text-xs text-muted">
              Also active, hiding nothing on its own: {quiet.map((r) => r.rule.label).join(" · ")}
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

/** Removable chips for the active user filters, plus "clear all". */
export function ActiveChips({ filters: f }: { filters: JobFilters }) {
  const rules = activeRules(f).filter((r) => r.kind === "filter");
  if (!rules.length) return null;
  return (
    <FilterChipRow label="Filters">
      {rules.map((r) => (
        <FilterChip key={r.id} href={r.revealHref} active>
          {r.label}
        </FilterChip>
      ))}
      <Link href={clearFiltersHref(f)} scroll={false} className="micro inline-flex min-h-9 shrink-0 items-center px-2 text-stamp-deep underline underline-offset-4 pointer-coarse:min-h-11">
        Clear all
      </Link>
    </FilterChipRow>
  );
}

/** Sort links (URL-driven; the current one is marked). */
export function SortBar({ filters: f }: { filters: JobFilters }) {
  return (
    <nav aria-label="Sort jobs" className="flex min-w-0 items-center gap-2">
      <span className="micro shrink-0 text-muted">Sort</span>
      <div className="flex min-w-0 flex-wrap gap-1.5 py-1">
        {SORT_KEYS.map((k) => (
          <FilterChip key={k} href={jobsHref(f, { sort: k === "fit" ? null : k })} active={f.sort === k} removable={false} className="shrink-0">
            {SORT_LABEL[k]}
          </FilterChip>
        ))}
      </div>
    </nav>
  );
}

/** "Nothing matches" with the fastest ways out. */
export function NoMatches({ filters: f, breakdown: b }: { filters: JobFilters; breakdown: HiddenBreakdown }) {
  const biggest = [...b.byRule].sort((x, y) => y.count - x.count)[0];
  return (
    <div className="flex flex-wrap gap-2">
      {biggest && biggest.count > 0 ? (
        <Button href={biggest.rule.revealHref} variant="primary" icon="eye">
          {biggest.rule.kind === "default" ? `Show ${formatNumber(biggest.count)} left out by default` : `Drop “${biggest.rule.label}” (+${formatNumber(biggest.count)})`}
        </Button>
      ) : null}
      <Button href={revealEverythingHref(f)} variant="secondary" icon="radar">
        Show everything on the scope
      </Button>
    </div>
  );
}
