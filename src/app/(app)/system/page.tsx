import type { Metadata } from "next";
import Link from "next/link";
import { formatBytes } from "@/components/system/backups";
import { ActionForm } from "@/components/system/ActionForm";
import { Panel } from "@/components/tracker/Panel";
import { Badge, DataTable, EmptyState, KeyValue, Notice, SectionHeader, StatBlock, formatDateTime, formatDuration, formatNumber, formatRelative, truncate, type Column, type Tone } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { ackAlertAction, ackAllAlertsAction, runPipelineAction } from "@/lib/actions/system";
import { loadSystem, type HttpRow, type ReportSource, type RunRow } from "@/lib/queries/system";

export const metadata: Metadata = { title: "System" };

const STATUS_TONE: Record<string, Tone> = { ok: "radar", partial: "signal", failed: "stamp", running: "cobalt", queued: "lilac", skipped: "concrete" };
const SEV_TONE: Record<string, Tone> = { critical: "stamp", warn: "signal", info: "card" };
const REPORT_ROWS = 30;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

const runColumns: Column<RunRow>[] = [
  { key: "id", header: "Run", mobile: "primary", cell: (r) => <Link href={`/system?run=${r.id}#report`} className="font-mono font-bold underline underline-offset-4">#{r.id}</Link> },
  { key: "kind", header: "Kind", cell: (r) => <span className="flex flex-wrap gap-1">{r.kind.replace("_", " ")}{r.dryRun ? <Badge tone="lilac" variant="outline" size="sm">dry</Badge> : null}</span> },
  { key: "status", header: "Result", mobile: "badge", cell: (r) => <Badge tone={STATUS_TONE[r.status] ?? "card"} variant="solid" size="sm">{r.status}</Badge> },
  { key: "when", header: "Started", cell: (r) => formatRelative(r.startedAt ?? r.createdAt, new Date()) },
  { key: "dur", header: "Took", numeric: true, align: "right", cell: (r) => formatDuration(r.durationMs) },
  { key: "src", header: "Sources", numeric: true, align: "right", cell: (r) => (r.sources ? formatNumber(r.sources) : "—") },
  { key: "new", header: "New", numeric: true, align: "right", cell: (r) => formatNumber(r.created) },
  { key: "upd", header: "Updated", numeric: true, align: "right", cell: (r) => formatNumber(r.updated) },
  { key: "bad", header: "Failed items", numeric: true, align: "right", cell: (r) => (r.failedItems ? <span className="font-bold text-stamp-deep">{formatNumber(r.failedItems)}</span> : "0") },
  { key: "by", header: "By", mobile: "hidden", cell: (r) => r.requestedBy },
];

const sourceColumns: Column<ReportSource>[] = [
  { key: "s", header: "Source", mobile: "primary", cell: (s) => <Link href={`/sources/${s.sourceId}`} className="block max-w-[18rem] truncate font-bold underline underline-offset-4" title={s.sourceKey}>{s.label}</Link> },
  { key: "st", header: "Result", mobile: "badge", cell: (s) => <Badge tone={STATUS_TONE[s.status] ?? "card"} variant="solid" size="sm">{s.status}</Badge> },
  { key: "f", header: "Fetched", numeric: true, align: "right", cell: (s) => formatNumber(s.fetched) },
  { key: "n", header: "New", numeric: true, align: "right", cell: (s) => formatNumber(s.newCount) },
  { key: "u", header: "Upd.", numeric: true, align: "right", cell: (s) => formatNumber(s.updatedCount) },
  { key: "c", header: "Closed", numeric: true, align: "right", cell: (s) => formatNumber(s.closedCount) },
  { key: "p", header: "Parse fails", numeric: true, align: "right", cell: (s) => formatNumber(s.failedParse) },
  { key: "t", header: "Took", numeric: true, align: "right", cell: (s) => formatDuration(s.durationMs) },
  { key: "note", header: "Note", mobile: "secondary", cell: (s) => (s.note ? <span className="text-xs text-ink-soft" title={s.note}>{truncate(s.note, 70)}</span> : "—") },
];

const httpColumns: Column<HttpRow>[] = [
  { key: "p", header: "Platform", mobile: "primary", cell: (h) => <span className="font-bold">{h.platform}</span> },
  { key: "r", header: "Requests", numeric: true, align: "right", cell: (h) => formatNumber(h.requests) },
  { key: "f", header: "Failures", numeric: true, align: "right", cell: (h) => (h.failures ? <span className="font-bold text-stamp-deep">{h.failures}</span> : "0") },
  { key: "re", header: "Retries", numeric: true, align: "right", cell: (h) => formatNumber(h.retries) },
  { key: "w", header: "Waited", numeric: true, align: "right", cell: (h) => formatDuration(h.waitedMs) },
  { key: "b", header: "Data", numeric: true, align: "right", cell: (h) => formatBytes(h.bytes) },
];

export default async function SystemPage({ searchParams }: PageProps<"/system">) {
  await requireSession();
  const sp = await searchParams;
  const runParam = Number(first(sp.run));
  const showAll = first(sp.all) === "1";
  const s = await loadSystem({ runId: Number.isSafeInteger(runParam) && runParam > 0 ? runParam : null });
  const now = new Date();
  const lastRun = s.runs.find((r) => r.kind !== "linkcheck") ?? null;
  const openCritical = s.alerts.open.filter((a) => a.severity === "critical").length;
  const sel = s.selected;
  const shown = sel ? (showAll ? sel.sources : sel.sources.slice(0, REPORT_ROWS)) : [];
  const BACKUP_TONE: Record<string, Tone> = { ok: "radar", stale: "signal", failed: "stamp", none: "signal" };

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader as="h1" index="09" kicker="OPS · System" title="System" description="Is the station healthy? Runs and what each source brought in, alerts, backups, failed items and everything that was changed." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBlock label="Last run" value={lastRun ? lastRun.status.toUpperCase() : "NONE"} detail={lastRun ? `#${lastRun.id} · ${lastRun.kind} · ${formatRelative(lastRun.startedAt ?? lastRun.createdAt, now)}` : "Nothing has run yet"} tone={lastRun ? (STATUS_TONE[lastRun.status] ?? "card") : "card"} />
        <StatBlock label="Open alerts" value={formatNumber(s.alerts.open.length)} detail={openCritical ? `${openCritical} critical` : s.alerts.open.length ? "Warnings and notes" : "All quiet"} tone={openCritical ? "stamp" : s.alerts.open.length ? "signal" : "radar"} href="#alerts" />
        <StatBlock label="Backup" value={s.backup.verdict.toUpperCase()} detail={s.backup.message} tone={BACKUP_TONE[s.backup.verdict] ?? "card"} href="#backups" />
        <StatBlock label="AI today" value={`${s.ai.used}/${s.ai.limit}`} detail={s.ai.enabled ? `${s.ai.remaining} left · UTC day` : "AI is switched off"} tone="lilac" />
      </div>

      <KeyValue
        layout="grid"
        columns={3}
        items={[
          { label: "Jobs on file", value: formatNumber(s.jobsTotal) },
          { label: "Failed items waiting", value: formatNumber(s.deadLetters.open), hint: s.deadLetters.open ? "Retried by the next run" : undefined },
          { label: "Version", value: s.version ?? "dev" },
        ]}
      />

      <Panel id="runs" code="A" kicker="Pipeline" title="Runs" actions={<span className="micro">{s.runs.length} latest</span>}>
        <div className="flex flex-wrap gap-3">
          <ActionForm action={runPipelineAction} hidden={{ mode: "manual" }} submit="Run all sources now" icon="refresh" variant="primary" pending="Queueing…" />
          <ActionForm action={runPipelineAction} hidden={{ mode: "dry_run" }} submit="Dry run (change nothing)" icon="eye" pending="Queueing…" />
        </div>
        <p className="text-sm text-ink-soft">Runs are queued and executed by the worker, not by this page; the daily run happens on its own.</p>
        <DataTable caption="Latest pipeline runs" rows={s.runs} columns={runColumns} rowKey={(r) => r.id} empty={<p className="border-3 border-dashed border-ink bg-card p-4 font-mono text-sm">No runs yet.</p>} />
      </Panel>

      <Panel id="report" code="B" kicker="Run report" title={sel ? `What run #${sel.run.id} brought in` : "Run report"} actions={sel ? <Badge tone={STATUS_TONE[sel.run.status] ?? "card"} variant="solid" size="sm">{sel.run.status}</Badge> : undefined}>
        {!sel ? (
          <EmptyState icon="system" code="NO RUN" title="Nothing to report yet"><p>Queue a run above; the report appears here once it has started.</p></EmptyState>
        ) : (
          <>
            {sel.run.error ? <Notice kind="danger" title="The run reported an error" live="status">{truncate(sel.run.error, 400)}</Notice> : null}
            <KeyValue
              layout="grid"
              columns={3}
              items={[
                { label: "Sources", value: formatNumber(sel.totals.sources ?? sel.sources.length), hint: `${sel.totals.ok ?? 0} ok · ${sel.totals.partial ?? 0} partial · ${sel.totals.failed ?? 0} failed` },
                { label: "Postings listed → fetched", value: `${formatNumber(sel.totals.listed)} → ${formatNumber(sel.totals.fetched)}` },
                { label: "Parsed", value: formatNumber(sel.totals.parsed), hint: `${formatNumber(sel.totals.filtered)} filtered out` },
                { label: "New / updated", value: `${formatNumber(sel.totals.created)} / ${formatNumber(sel.totals.updated)}`, hint: `${formatNumber(sel.totals.merged)} merged as duplicates` },
                { label: "Closed", value: formatNumber((sel.totals.closedMarkers ?? 0) + (sel.totals.closedMissing ?? 0) + (sel.totals.closedBySource ?? 0)) },
                { label: "Sent to review", value: formatNumber((sel.totals.titleQueued ?? 0) + (sel.totals.possibleDuplicates ?? 0)), hint: `${formatNumber(sel.totals.titleQueued)} titles · ${formatNumber(sel.totals.possibleDuplicates)} possible duplicates` },
                { label: "AI queued", value: formatNumber(sel.totals.aiQueued) },
                { label: "Failed items", value: formatNumber((sel.totals.failedPersist ?? 0) + (sel.totals.failedParse ?? 0) + (sel.totals.failedNormalize ?? 0) + (sel.totals.failedValidate ?? 0)), hint: "Kept as dead letters and retried" },
                { label: "Took", value: formatDuration(sel.run.durationMs), hint: sel.run.startedAt ? formatDateTime(sel.run.startedAt) : undefined },
              ]}
            />
            <div className="flex flex-col gap-2">
              <p className="micro">Sources in this run — problems first, then by new jobs {sel.sources.length > REPORT_ROWS && !showAll ? `(showing ${REPORT_ROWS} of ${sel.sources.length})` : ""}</p>
              <DataTable caption="Per-source results of the selected run" rows={shown} columns={sourceColumns} rowKey={(r) => r.sourceId} />
              {sel.sources.length > REPORT_ROWS ? (
                <Link href={showAll ? `/system?run=${sel.run.id}#report` : `/system?run=${sel.run.id}&all=1#report`} className="micro w-fit underline underline-offset-4">
                  {showAll ? "Show fewer" : `Show all ${sel.sources.length} sources`}
                </Link>
              ) : null}
            </div>
            {sel.http.length ? (
              <div className="flex flex-col gap-2">
                <p className="micro">Network by platform</p>
                <DataTable caption="HTTP traffic by platform" rows={sel.http} columns={httpColumns} rowKey={(h) => h.platform} />
              </div>
            ) : null}
          </>
        )}
      </Panel>

      <Panel id="alerts" code="C" kicker="Alerts" title={`Open alerts · ${s.alerts.open.length}`} actions={s.alerts.open.length > 1 ? <ActionForm action={ackAllAlertsAction} submit="Acknowledge all" icon="check" variant="ghost" pending="Working…" /> : undefined}>
        {s.alerts.open.length === 0 ? (
          <p className="border-3 border-dashed border-ink bg-card p-4 text-sm font-bold">All quiet — nothing needs you.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {s.alerts.open.map((a) => (
              <li key={a.id} className="flex flex-col gap-2 border-3 border-ink bg-card p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={SEV_TONE[a.severity] ?? "card"} variant="solid" size="sm">{a.severity}</Badge>
                  <span className="font-bold">{a.title}</span>
                  {a.occurrences > 1 ? <span className="micro tabular">×{a.occurrences}</span> : null}
                  <span className="micro ml-auto">{formatRelative(a.lastRaisedAt, now)}</span>
                </div>
                {a.body ? <p className="whitespace-pre-line text-sm text-ink-soft">{truncate(a.body, 600)}</p> : null}
                <ActionForm action={ackAlertAction} hidden={{ alertId: a.id }} submit="Acknowledge" icon="check" pending="Working…" />
              </li>
            ))}
          </ul>
        )}
        {s.alerts.recent.length ? (
          <div className="flex flex-col gap-1 border-t-2 border-ink/25 pt-3">
            <p className="micro">Recently acknowledged</p>
            {s.alerts.recent.map((a) => (
              <p key={a.id} className="text-sm text-ink-soft"><Badge tone={SEV_TONE[a.severity] ?? "card"} variant="outline" size="sm">{a.severity}</Badge> {a.title} · {formatRelative(a.acknowledgedAt, now)}</p>
            ))}
          </div>
        ) : null}
      </Panel>

      <Panel id="backups" code="D" kicker="Safety" title="Backups" actions={<Badge tone={BACKUP_TONE[s.backup.verdict] ?? "card"} variant="solid" size="sm">{s.backup.verdict}</Badge>}>
        <p className="text-sm">{s.backup.message} Encrypted dumps are pushed to the <span className="font-mono font-bold">db-backups</span> branch on GitHub every day at 21:00 UTC, replacing the previous one; a restore test runs monthly{s.backup.restoreTestDue ? " and is due" : ""}.</p>
        {s.backup.restoreTestDue ? <Notice kind="warn" title="No recent restore test">A backup you have never restored is only a hope. The steps are in docs/RECOVERY.md.</Notice> : null}
        <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
          {s.backupRows.length === 0 ? <li className="text-ink-soft">No backup has run yet.</li> : s.backupRows.slice(0, 8).map((b) => (
            <li key={b.id} className="flex flex-wrap items-baseline gap-x-3 border-b-2 border-ink/20 pb-1 last:border-b-0">
              <Badge tone={STATUS_TONE[b.status] ?? "card"} variant="solid" size="sm">{b.status}</Badge>
              <span className="font-mono">{b.kind.replace("_", " ")}</span>
              <span className="micro">{formatDateTime(b.startedAt)}</span>
              <span className="micro tabular">{formatBytes(b.sizeBytes)}{b.rows ? ` · ${formatNumber(b.rows)} rows` : ""}</span>
              {b.error ? <span className="text-stamp-deep">{truncate(b.error, 120)}</span> : null}
            </li>
          ))}
        </ul>
      </Panel>

      <Panel id="failed" code="E" kicker="Data quality" title={`Failed items · ${s.deadLetters.open}`}>
        {s.deadLetters.open === 0 ? (
          <p className="border-3 border-dashed border-ink bg-card p-4 text-sm font-bold">No postings are stuck. Nothing was dropped.</p>
        ) : (
          <>
            <p className="text-sm text-ink-soft">Postings that could not be saved are kept here, not thrown away, and are tried again by the next run. By stage: {s.deadLetters.byStage.map((b) => `${b.stage} ${b.n}`).join(" · ")}.</p>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {s.deadLetters.recent.map((d) => (
                <li key={d.id} className="border-3 border-ink bg-card p-3 text-sm">
                  <p className="font-bold">{d.sourceLabel ?? "unknown source"} <span className="font-mono font-normal text-ink-soft">{d.externalId ?? ""}</span></p>
                  <p className="micro">{d.stage} · {formatRelative(d.createdAt, now)}</p>
                  <p className="mt-1 break-words font-mono text-xs text-ink-soft">{truncate(d.error, 240)}</p>
                </li>
              ))}
            </ul>
          </>
        )}
      </Panel>

      <Panel id="audit" code="F" kicker="Trail" title="Everything that was changed">
        {s.audit.length === 0 ? (
          <p className="text-sm text-ink-soft">Nothing recorded yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm">
            {s.audit.map((a) => (
              <li key={a.id} className="flex flex-wrap items-baseline gap-x-3 border-b-2 border-ink/20 pb-1 last:border-b-0">
                <span className="font-mono font-bold">{a.action}</span>
                <span className="text-ink-soft">{a.entityType}{a.entityId ? ` ${truncate(a.entityId, 40)}` : ""}</span>
                <span className="micro">{a.actor} · {formatDateTime(a.at)}</span>
                {a.reason ? <span className="text-ink-soft">— {truncate(a.reason, 120)}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
