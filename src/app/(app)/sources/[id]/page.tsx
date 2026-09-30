import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { TERMS_STATUSES } from "@/db/schema/_enums";
import { ChecklistItemForm, ConfigForm, TermsForm } from "@/components/sources/SourceForms";
import {
  CHECKLIST_META,
  SOURCE_STATUS_TONE,
  STATUS_MOVE_LABEL,
  TERMS_TONE,
  allowedMoves,
  circuitState,
  isAutoNote,
  moveTarget,
  promotionGate,
  sourceHealth,
  termsReviewDue,
} from "@/components/sources/checklist";
import { VolumeSpark } from "@/components/sources/VolumeSpark";
import { Panel } from "@/components/tracker/Panel";
import { ActionForm } from "@/components/system/ActionForm";
import { Badge, DataTable, Icon, KeyValue, Notice, SectionHeader, formatDateTime, formatDuration, formatNumber, formatRelative, truncate, type Column, type Tone } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { resetBaselineAction, resetBreakerAction, runSourceAction, sourceStatusAction } from "@/lib/actions/sources";
import { getSourceDetail, type SourceRunHistoryRow } from "@/lib/queries/sources";

const load = cache(async (raw: string) => {
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? getSourceDetail(id) : null;
});

export async function generateMetadata({ params }: PageProps<"/sources/[id]">): Promise<Metadata> {
  await requireSession();
  const d = await load((await params).id);
  return { title: d ? `${d.source.label} · Sources` : "Source not found" };
}

const RUN_TONE: Record<string, Tone> = { ok: "radar", partial: "signal", failed: "stamp", skipped: "concrete" };

const runColumns: Column<SourceRunHistoryRow>[] = [
  { key: "when", header: "When", mobile: "primary", cell: (r) => formatRelative(r.finishedAt ?? r.startedAt, new Date(), "—") },
  {
    key: "status",
    header: "Result",
    mobile: "badge",
    cell: (r) => (
      <span className="flex flex-wrap items-center gap-1">
        <Badge tone={RUN_TONE[r.status] ?? "card"} variant="solid" size="sm">{r.status}</Badge>
        {r.dryRun ? <Badge tone="lilac" variant="outline" size="sm">dry run</Badge> : null}
      </span>
    ),
  },
  { key: "fetched", header: "Fetched", numeric: true, align: "right", cell: (r) => formatNumber(r.fetched) },
  { key: "new", header: "New", numeric: true, align: "right", cell: (r) => formatNumber(r.newCount) },
  { key: "upd", header: "Updated", numeric: true, align: "right", cell: (r) => formatNumber(r.updatedCount) },
  { key: "closed", header: "Closed", numeric: true, align: "right", cell: (r) => formatNumber(r.closedCount) },
  { key: "bad", header: "Parse fails", numeric: true, align: "right", cell: (r) => formatNumber(r.failedParse) },
  { key: "time", header: "Time", numeric: true, align: "right", cell: (r) => formatDuration(r.durationMs) },
  {
    key: "note",
    header: "Note",
    mobile: "secondary",
    cell: (r) => {
      const note = r.error ?? r.flags.skipReason ?? (r.flags.healthy === false ? r.flags.healthReason : null) ?? (r.flags.raised.length ? r.flags.raised.join(", ") : null);
      return note ? <span className="text-xs text-ink-soft" title={note}>{truncate(note, 90)}</span> : <span className="text-ink-soft">—</span>;
    },
  },
];

export default async function SourcePage({ params }: PageProps<"/sources/[id]">) {
  await requireSession();
  const d = await load((await params).id);
  if (!d) notFound();
  const { source: s, platform, connector, config, checklist, baseline, runs, stats, statusBeforePause, history } = d;
  const now = new Date();
  const health = sourceHealth(s, now);
  const circuit = circuitState(s, now);
  const moves = allowedMoves(s.status);
  const gate = promotionGate(s.status, checklist);
  const points = [...runs].reverse().slice(-14).map((r) => ({ value: r.status === "skipped" ? null : r.fetched, failed: r.status === "failed" }));
  const terms = platform ? termsReviewDue(platform.termsReviewedAt, now) : null;
  const done = CHECKLIST_META.filter((m) => checklist[m.key].done).length;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="07"
        kicker="OPS · Source"
        title={truncate(s.label, 34)}
        description={
          <span className="block break-all">
            {s.label.length > 34 ? <span className="mb-1 block font-bold">{s.label}</span> : null}
            <span className="font-mono text-sm">{s.sourceKey}</span>
          </span>
        }
        actions={<Link href="/sources" className="micro inline-flex min-h-11 items-center gap-1.5 border-3 border-ink bg-card px-3 font-bold shadow-sm">← All sources</Link>}
      />

      <Panel id="status" code="A" kicker="Status & controls" title="Status and what to do next" band={health.tone}>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={health.tone} variant="solid">{health.label}</Badge>
          <Badge tone={SOURCE_STATUS_TONE[s.status]} variant="outline">{s.status}</Badge>
          {circuit !== "closed" ? <Badge tone={circuit === "open" ? "stamp" : "signal"} variant="tint">breaker {circuit}</Badge> : null}
          <span className="text-sm text-ink-soft">{health.detail}</span>
        </div>
        <KeyValue
          layout="grid"
          columns={3}
          items={[
            { label: "Last run", value: formatRelative(s.lastRunAt, now, "never"), hint: s.lastRunAt ? formatDateTime(s.lastRunAt) : undefined },
            { label: "Last success", value: formatRelative(s.lastSuccessAt, now, "never") },
            { label: "Failed in a row", value: s.consecutiveFailures, hint: s.circuitOpenUntil ? `Breaker open until ${formatDateTime(s.circuitOpenUntil)}` : undefined },
            { label: "Country", value: s.countryIso2 ?? "worldwide / remote" },
            { label: "Raw snapshots", value: formatNumber(stats.rawSnapshots) },
            { label: "Jobs linked", value: formatNumber(stats.jobLinks), hint: stats.openDeadLetters ? `${stats.openDeadLetters} open dead letter${stats.openDeadLetters === 1 ? "" : "s"}` : undefined },
          ]}
        />

        {moves.includes("promote") && !gate.ok ? <Notice kind="warn" title="Cannot go live yet">{gate.reason}</Notice> : null}
        <div className="flex flex-col gap-3">
          {moves.map((m) => {
            const target = moveTarget(s.status, m, statusBeforePause);
            const blocked = m === "promote" && !gate.ok;
            return (
              <ActionForm
                key={m}
                action={sourceStatusAction}
                hidden={{ sourceId: s.id, move: m }}
                submit={`${STATUS_MOVE_LABEL[m]}${target ? ` → ${target}` : ""}`}
                icon={m === "pause" ? "pause" : m === "disable" ? "close" : "play"}
                variant={m === "disable" ? "danger" : m === "promote" ? "primary" : "secondary"}
                reason={m === "pause" || m === "disable" ? { label: "Reason (optional)" } : undefined}
                className={blocked ? "opacity-60" : undefined}
              />
            );
          })}
        </div>

        <div className="flex flex-col gap-3 border-t-2 border-ink/25 pt-4">
          <p className="micro">Run it (queued for the worker — never in the web process)</p>
          <div className="flex flex-wrap gap-3">
            <ActionForm action={runSourceAction} hidden={{ sourceId: s.id, dryRun: "0" }} submit="Run now" icon="refresh" variant="primary" pending="Queueing…" />
            <ActionForm action={runSourceAction} hidden={{ sourceId: s.id, dryRun: "1" }} submit="Dry run" icon="eye" pending="Queueing…" />
          </div>
          {s.consecutiveFailures > 0 || s.circuitOpenUntil ? (
            <ActionForm action={resetBreakerAction} hidden={{ sourceId: s.id }} submit="Reset the breaker" icon="refresh" reason={{ label: "Why is it safe? (optional)" }} />
          ) : null}
          <ActionForm action={resetBaselineAction} hidden={{ sourceId: s.id }} submit="Reset the baseline" icon="history" variant="ghost" reason={{ label: "Why (e.g. the site changed)", required: true }} />
        </div>
      </Panel>

      <Panel
        id="runs"
        code="B"
        kicker="Volume & runs"
        title="What it fetched lately"
        actions={baseline ? <span className="micro tabular">normal {baseline.volume_min ?? "?"}–{baseline.volume_max ?? "?"}</span> : <span className="micro">no baseline yet</span>}
      >
        <VolumeSpark points={points} baseline={baseline ? { low: baseline.volume_min, high: baseline.volume_max } : null} width={360} height={64} />
        <DataTable caption="Recent runs of this source" rows={runs.slice(0, 20)} columns={runColumns} rowKey={(r) => r.id} empty={<p className="border-3 border-dashed border-ink bg-card p-4 font-mono text-sm">No runs yet. Use “Run now” above.</p>} />
      </Panel>

      <Panel id="checklist" code="C" kicker="Definition of done" title={`Promotion checklist · ${done}/${CHECKLIST_META.length}`}>
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {CHECKLIST_META.map((m) => {
            const item = checklist[m.key];
            return (
              <li key={m.key} className="flex flex-col gap-2 border-3 border-ink bg-card p-3">
                <div className="flex items-start gap-2">
                  <Icon name={item.done ? "check" : "minus"} size={18} className={item.done ? "mt-0.5 shrink-0 text-radar-deep" : "mt-0.5 shrink-0 text-ink-soft"} />
                  <div className="min-w-0">
                    <p className="font-bold">{m.label}</p>
                    <p className="text-sm text-ink-soft">
                      {m.how === "auto" ? "Ticked automatically when: " : "You tick this: "}
                      {m.evidence}
                    </p>
                    {item.done ? (
                      <p className="micro mt-1">
                        done {item.at ? formatRelative(item.at, now) : ""}
                        {item.note ? ` · ${isAutoNote(item.note) ? item.note.slice(6) : item.note}` : ""}
                      </p>
                    ) : null}
                  </div>
                </div>
                {m.how === "human" ? <ChecklistItemForm sourceId={s.id} item={m.key} done={item.done} note={item.note} /> : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      <div className="grid gap-6 xl:grid-cols-2">
        <Panel id="config" code="D" kicker="Configuration" title="What this source fetches">
          {!config.valid ? (
            <Notice kind="danger" title="This configuration has problems" live="status">
              <ul className="m-0 list-disc pl-5">{config.issues.map((i) => <li key={i}>{i}</li>)}</ul>
            </Notice>
          ) : null}
          {connector ? <p className="micro">Connector {connector.known ? "" : "(unknown!) "}{connector.kind ?? ""}{connector.version ? ` · v${connector.version}` : ""}</p> : null}
          <ConfigForm sourceId={s.id} label={s.label} countryIso2={s.countryIso2} configJson={JSON.stringify(s.configJson, null, 2)} notes={s.notes} />
        </Panel>

        {platform ? (
          <Panel id="terms" code="E" kicker="Platform & terms" title={platform.name}>
            <KeyValue
              layout="grid"
              columns={2}
              items={[
                { label: "Grade", value: platform.grade },
                { label: "Access", value: platform.accessMethod },
                { label: "Rate limit", value: `${platform.rateLimitPerMin}/min`, hint: `${formatNumber(platform.dailyCap)} per day cap` },
                { label: "Terms", value: <Badge tone={TERMS_TONE[platform.termsStatus] ?? "card"} variant="solid" size="sm">{platform.termsStatus}</Badge>, hint: platform.termsReviewedAt ? `reviewed ${formatDateTime(platform.termsReviewedAt)}` : "never reviewed" },
              ]}
            />
            {terms?.due ? <Notice kind="warn" title="Terms review is due">Read the terms again and record the review below.</Notice> : null}
            {platform.termsUrl ? (
              <a href={platform.termsUrl} target="_blank" rel="noopener noreferrer" className="micro inline-flex items-center gap-1 text-ink underline underline-offset-4">
                Open the terms <Icon name="external" size={14} />
              </a>
            ) : null}
            <TermsForm platformKey={platform.key} termsStatus={platform.termsStatus} termsUrl={platform.termsUrl} termsNotes={platform.termsNotes} statuses={TERMS_STATUSES} />
          </Panel>
        ) : null}
      </div>

      <Panel id="trail" code="F" kicker="Audit trail" title="Every change to this source">
        {history.length === 0 ? (
          <p className="text-sm text-ink-soft">No changes recorded yet.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline gap-x-3 border-b-2 border-ink/20 pb-2 text-sm last:border-b-0">
                <span className="font-mono font-bold">{h.action}</span>
                <span className="micro">{formatDateTime(h.at)}</span>
                {h.reason ? <span className="text-ink-soft">— {h.reason}</span> : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
