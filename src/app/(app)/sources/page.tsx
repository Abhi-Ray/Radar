import type { Metadata } from "next";
import { AddSourceForm } from "@/components/sources/AddSourceForm";
import { SOURCE_STATUS_TONE, sourceHealth, type SourceHealthVerdict } from "@/components/sources/checklist";
import { VolumeSpark } from "@/components/sources/VolumeSpark";
import { Badge, DataTable, EmptyState, LinkTabs, Pagination, SectionHeader, StatBlock, formatNumber, formatRelative, type Column } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { connectorChoices, listSourcesHealth, type SourceHealthRow } from "@/lib/queries/sources";

export const metadata: Metadata = { title: "Sources" };

const PAGE_SIZE = 40;
const VIEWS = ["all", "attention", "live", "trial", "draft", "off"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = { all: "All", attention: "Needs attention", live: "Live", trial: "Trial", draft: "Draft", off: "Paused / off" };

type Row = { r: SourceHealthRow; v: SourceHealthVerdict };

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const needsAttention = ({ r, v }: Row) => v.label === "CIRCUIT OPEN" || v.label === "FAILING" || r.lastRunStatus === "failed" || (r.parseFailRate ?? 0) >= 0.2;

function inView(view: View, row: Row): boolean {
  switch (view) {
    case "all": return true;
    case "attention": return needsAttention(row);
    case "live": return row.r.status === "live";
    case "trial": return row.r.status === "trial";
    case "draft": return row.r.status === "draft";
    case "off": return row.r.status === "paused" || row.r.status === "disabled";
  }
}

const columns: Column<Row>[] = [
  {
    key: "source",
    header: "Source",
    mobile: "primary",
    cell: ({ r }) => (
      <span className="block min-w-0 max-w-[18rem]" title={`${r.label} · ${r.sourceKey}`}>
        <span className="block truncate font-bold">{r.label}</span>
        <span className="block truncate font-mono text-xs text-ink-soft">{r.sourceKey}</span>
      </span>
    ),
  },
  {
    key: "status",
    header: "Health",
    mobile: "badge",
    cell: ({ r, v }) => (
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge tone={v.tone} variant="solid" size="sm">{v.label}</Badge>
        <Badge tone={SOURCE_STATUS_TONE[r.status]} variant="outline" size="sm">{r.status}</Badge>
      </span>
    ),
  },
  {
    key: "platform",
    header: "Platform",
    cell: ({ r }) => (
      <span className="block">
        {r.platformName ?? r.platformKey}
        {r.grade ? <span className="micro ml-1.5 border-2 border-ink px-1 tabular">{r.grade}</span> : null}
      </span>
    ),
  },
  { key: "country", header: "Country", cell: ({ r }) => r.countryIso2 ?? "—", numeric: true },
  {
    key: "volume",
    header: "Fetched per run",
    cell: ({ r }) => <VolumeSpark points={r.spark} baseline={r.baseline ? { low: r.baseline.volume_min, high: r.baseline.volume_max } : null} />,
  },
  { key: "last", header: "Last run", cell: ({ r }) => formatRelative(r.lastRunAt, new Date(), "never") },
  { key: "checklist", header: "Checklist", numeric: true, align: "right", cell: ({ r }) => `${r.checklist.done}/${r.checklist.total}` },
];

export default async function SourcesPage({ searchParams }: PageProps<"/sources">) {
  await requireSession();
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(first(sp.view)) ? (first(sp.view) as View) : "all";
  const q = first(sp.q).trim().toLowerCase().slice(0, 80);
  const page = Math.max(1, Math.floor(Number(first(sp.page))) || 1);

  const now = new Date();
  const all: Row[] = (await listSourcesHealth()).map((r) => ({ r, v: sourceHealth(r, now) }));
  const counts = Object.fromEntries(VIEWS.map((k) => [k, all.filter((row) => inView(k, row)).length])) as Record<View, number>;
  const matches = (row: Row) => !q || `${row.r.label} ${row.r.sourceKey} ${row.r.platformName ?? row.r.platformKey}`.toLowerCase().includes(q);
  const rank = (row: Row) => (needsAttention(row) ? 0 : row.r.status === "live" ? 1 : row.r.status === "trial" ? 2 : 3);
  const rows = all.filter((row) => inView(view, row) && matches(row)).sort((a, b) => rank(a) - rank(b) || a.r.label.localeCompare(b.r.label));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const okCount = all.filter((row) => row.v.label === "OK").length;
  const lastRun = all.reduce<Date | null>((m, { r }) => (r.lastRunAt && (!m || r.lastRunAt > m) ? r.lastRunAt : m), null);
  const href = (over: Record<string, string | number | null>) => {
    const p = new URLSearchParams();
    const next: Record<string, string | number | null> = { view: view === "all" ? null : view, q: q || null, ...over };
    for (const [k, v] of Object.entries(next)) if (v !== null && v !== "" && !(k === "page" && v === 1)) p.set(k, String(v));
    const s = p.toString();
    return s ? `/sources?${s}` : "/sources";
  };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="07"
        kicker="OPS · Sources"
        title="Sources"
        description="Every job feed RADAR reads: how healthy it is, what it fetched lately against its normal range, and whether it is allowed into the daily run."
      />

      {all.length === 0 ? (
        <EmptyState icon="sources" code="0 FEEDS" size="lg" title="No sources yet">
          <p>Load the reference data first (the seed), or add a feed below.</p>
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <StatBlock label="Sources" value={formatNumber(all.length)} detail={`${counts.live} live · ${counts.trial} trial · ${counts.draft} draft`} tone="card" />
            <StatBlock label="Healthy" value={formatNumber(okCount)} unit={`of ${formatNumber(all.length)}`} detail="Last run succeeded" tone="radar" />
            <StatBlock label="Need attention" value={formatNumber(counts.attention)} detail={counts.attention ? "Failing, tripped or many parse errors" : "All quiet"} tone={counts.attention ? "stamp" : "card"} />
            <StatBlock label="Last run" value={lastRun ? formatRelative(lastRun, now) : "never"} detail={lastRun ? "Most recent source run" : "Nothing has run yet"} tone="cobalt" />
          </div>

          <LinkTabs label="Source views" tabs={VIEWS.map((k) => ({ href: href({ view: k === "all" ? null : k, page: 1 }), label: VIEW_LABEL[k], count: counts[k], active: k === view }))} />

          <form action="/sources" method="get" role="search" className="flex flex-wrap items-end gap-3">
            {view !== "all" ? <input type="hidden" name="view" value={view} /> : null}
            <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
              <span className="micro">Find a source</span>
              <input name="q" defaultValue={q} placeholder="name, key or platform…" className="min-h-11 border-3 border-ink bg-card px-3 font-mono text-sm" />
            </label>
            <button type="submit" className="micro min-h-11 border-3 border-ink bg-acid px-4 font-bold shadow-sm">Search</button>
            {q ? <a href={href({ q: null, page: 1 })} className="micro min-h-11 content-center px-2 text-stamp-deep underline underline-offset-4">Clear</a> : null}
          </form>

          <DataTable
            caption="Sources and their health"
            rows={pageRows}
            columns={columns}
            rowKey={({ r }) => r.id}
            rowHref={({ r }) => `/sources/${r.id}`}
            empty={<EmptyState icon="filter" code="NO MATCH" tone="signal" title="No source matches this view"><p>Try another tab or clear the search.</p></EmptyState>}
          />
          <Pagination pathname="/sources" searchParams={{ ...(view !== "all" ? { view } : {}), ...(q ? { q } : {}) }} page={page} pageSize={PAGE_SIZE} total={rows.length} noun="sources" />
        </>
      )}

      <details className="border-3 border-ink bg-card p-4 shadow-md">
        <summary className="micro cursor-pointer font-bold">+ Add a source</summary>
        <div className="mt-4">
          <AddSourceForm choices={connectorChoices()} />
        </div>
      </details>
    </div>
  );
}
