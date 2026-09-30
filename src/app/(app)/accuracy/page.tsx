import type { Metadata } from "next";
import Link from "next/link";
import { FIELD_LABEL, type SpotField } from "@/components/accuracy/labels";
import { SpotCheckForm } from "@/components/accuracy/SpotCheckForm";
import { ActionForm } from "@/components/system/ActionForm";
import { Panel } from "@/components/tracker/Panel";
import { Badge, DataTable, EmptyState, Icon, Notice, ProgressBlocks, SectionHeader, StatBlock, formatNumber, formatPercent, formatRelative, formatMoneyRange, type Column } from "@/components/ui";
import { ROLES } from "@/data/titles/roles";
import { requireSession } from "@/lib/auth/session";
import { runEvalAction } from "@/lib/actions/accuracy";
import type { AccuracyRunSummary } from "@/lib/accuracy/log";
import type { SpotCheckJob } from "@/lib/accuracy/spot-check";
import { loadAccuracy } from "@/lib/queries/accuracy";

export const metadata: Metadata = { title: "Accuracy" };

const GOLDEN_MIN = 30;
const GOLDEN_GOAL = 200;
const roleLabel = (k: string | null) => (k ? (ROLES.find((r) => r.key === k)?.label ?? k.replaceAll("_", " ")) : "none");
const w = (v: string | null | undefined) => (v ? v.replaceAll("_", " ") : "none");

function shownFor(j: SpotCheckJob): Record<SpotField, string> {
  const s = j.shown;
  return {
    role_key: roleLabel(s.roleKey),
    seniority: w(s.seniority),
    visa_status: w(s.visaStatus ?? "unknown"),
    remote_class: w(s.remoteClass),
    salary: s.salaryEurMin !== null || s.salaryEurMax !== null ? `${formatMoneyRange(s.salaryEurMin, s.salaryEurMax, "EUR")} ${s.salaryKind ? `(${w(s.salaryKind)})` : ""}` : "no salary",
    language: w(s.languageRequirement),
    country_iso2: j.countryIso2 ?? "none",
    experience_min_years: s.experienceMinYears === null ? "not stated" : `${s.experienceMinYears} yr`,
  };
}

const runColumns: Column<AccuracyRunSummary>[] = [
  { key: "when", header: "When", mobile: "primary", cell: (r) => formatRelative(r.createdAt, new Date()) },
  { key: "n", header: "Samples", numeric: true, align: "right", cell: (r) => formatNumber(r.sampleCount) },
  { key: "role", header: "Role precision", numeric: true, align: "right", cell: (r) => formatPercent(r.keyMetrics["role_match.precision"] ?? null) },
  { key: "visa", header: "Visa “confirmed” precision", numeric: true, align: "right", cell: (r) => formatPercent(r.keyMetrics["visa_status.confirmed_precision"] ?? null) },
  { key: "gate", header: "Gate", mobile: "badge", cell: (r) => (r.blocked ? <Badge tone="stamp" variant="solid" size="sm">blocked</Badge> : <Badge tone="radar" variant="solid" size="sm">ok</Badge>) },
  { key: "by", header: "Trigger", cell: (r) => r.trigger ?? "—" },
];

export default async function AccuracyPage() {
  await requireSession();
  const a = await loadAccuracy();
  const now = new Date();
  const total = a.log.total;
  const goldenTone = a.golden.labelled >= GOLDEN_MIN ? "radar" : "signal";

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="08"
        kicker="OPS · Accuracy"
        title="Accuracy"
        description="How right is RADAR? Check a few jobs against the original postings every week; every mistake you find becomes a test case so it cannot come back unnoticed."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatBlock label="Golden sample" value={`${a.golden.labelled}`} unit={`of ${GOLDEN_MIN}+`} detail={a.golden.labelled >= GOLDEN_MIN ? `Goal ${GOLDEN_GOAL}` : "Numbers below 30 mean little"} tone={goldenTone}>
          <ProgressBlocks value={Math.min(a.golden.labelled, GOLDEN_MIN)} max={GOLDEN_MIN} label="Golden samples labelled" tone="lilac" size="sm" />
        </StatBlock>
        <StatBlock label="Spot-checks this week" value={`${a.checkedThisWeek}/${a.batchSize}`} detail={a.weekKey} tone="card" />
        <StatBlock label="Correct rate" value={total.correctRate === null ? "—" : formatPercent(total.correctRate)} detail={total.checked ? `${formatNumber(total.checked)} answers · last 12 weeks` : "No spot-checks yet"} tone={total.correctRate === null ? "card" : total.correctRate >= 0.9 ? "radar" : "signal"} caveat={total.checked > 0 && total.checked < 30 ? "Too few to conclude" : false} />
        <StatBlock label="Last evaluation" value={a.runs[0] ? formatRelative(a.runs[0].createdAt, now) : "never"} detail={a.runs[0] ? `${a.runs[0].sampleCount} samples${a.runs[0].blocked ? " · BLOCKED" : ""}` : "Needs labelled samples"} tone={a.runs[0]?.blocked ? "stamp" : "cobalt"} />
      </div>

      <Panel id="spot" code="A" kicker="Weekly · 15 minutes" title="This week's spot-check" actions={<Badge tone="card" variant="outline" size="sm">{a.weekKey}</Badge>}>
        {a.spot.length === 0 ? (
          <EmptyState icon="check" code="DONE" tone="radar" title={a.checkedThisWeek >= a.batchSize ? "This week's ten are done" : "No jobs to check yet"}>
            <p>{a.checkedThisWeek >= a.batchSize ? "Come back next week — or use “Report wrong info” on any job page whenever you spot a mistake." : "Jobs appear here once the first run has collected some."}</p>
          </EmptyState>
        ) : (
          <>
            <Notice kind="info" title="How to do it">
              Open the original posting, then mark each field <b>Right</b>, <b>Wrong</b> (say what the truth is) or <b>Skip</b> if the posting doesn&apos;t say. Right answers and your fixes both go into the golden sample.
            </Notice>
            <ol className="m-0 flex list-none flex-col gap-6 p-0">
              {a.spot.map((j, i) => (
                <li key={j.id} className="flex flex-col gap-3 border-3 border-ink bg-paper/60 p-3 shadow-sm">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-mono text-2xl font-black tabular">{String(a.checkedThisWeek + i + 1).padStart(2, "0")}</span>
                    <Link href={`/jobs/${j.id}`} className="font-bold underline underline-offset-4 [overflow-wrap:anywhere]">{j.canonicalTitle}</Link>
                    <span className="text-sm">{j.company}</span>
                    <span className="micro">{j.locationRaw || j.countryIso2 || ""}</span>
                    <a href={j.applyUrl} target="_blank" rel="noopener noreferrer" className="micro inline-flex min-h-9 items-center gap-1 border-2 border-ink bg-acid px-2 font-bold">
                      Original posting <Icon name="external" size={14} />
                    </a>
                  </div>
                  <SpotCheckForm job={{ id: j.id, shown: shownFor(j) }} />
                </li>
              ))}
            </ol>
          </>
        )}
      </Panel>

      <Panel id="log" code="B" kicker="Which areas need work" title="Accuracy log · last 12 weeks">
        {total.checked === 0 ? (
          <p className="text-sm text-ink-soft">No spot-checks logged yet. The first ten jobs above start this log.</p>
        ) : (
          <>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {Object.entries(a.log.byField)
                .sort((x, y) => y[1].wrong - x[1].wrong)
                .map(([field, f]) => (
                  <li key={field} className="grid grid-cols-[9rem_minmax(0,1fr)_auto] items-center gap-3 border-b-2 border-ink/20 pb-2 text-sm last:border-b-0">
                    <span className="font-bold">{FIELD_LABEL[field as keyof typeof FIELD_LABEL] ?? field.replaceAll("_", " ")}</span>
                    <ProgressBlocks value={Math.round((f.correctRate ?? 0) * 100)} max={100} label={`${field} correct rate`} tone={f.correctRate !== null && f.correctRate >= 0.9 ? "radar" : "signal"} size="sm" />
                    <span className="micro tabular">{f.correctRate === null ? "—" : formatPercent(f.correctRate)} · {f.wrong}/{f.checked} wrong</span>
                  </li>
                ))}
            </ul>
            {a.log.trend.length > 1 ? (
              <p className="micro">
                Trend: {a.log.trend.map((wk) => `${wk.week} ${wk.correctRate === null ? "—" : formatPercent(wk.correctRate)}`).join(" → ")}
              </p>
            ) : null}
          </>
        )}
      </Panel>

      <Panel id="eval" code="C" kicker="Regression check" title="Evaluation on the golden sample" actions={<ActionForm action={runEvalAction} submit="Run the evaluation" icon="play" variant="secondary" pending="Evaluating…" />}>
        <p className="text-sm text-ink-soft">
          Every rule or prompt change is scored against your labelled jobs first; a change that makes results worse is blocked. {formatNumber(a.golden.total)} sample{a.golden.total === 1 ? "" : "s"} on file
          {Object.keys(a.golden.byOrigin).length ? ` (${Object.entries(a.golden.byOrigin).map(([o, n]) => `${n} ${o.replaceAll("_", " ")}`).join(", ")})` : ""}.
        </p>
        <DataTable caption="Evaluation runs" rows={a.runs} columns={runColumns} rowKey={(r) => r.id} empty={<p className="border-3 border-dashed border-ink bg-card p-4 font-mono text-sm">No evaluation has run yet. It needs labelled samples — the spot-check above creates them.</p>} />
      </Panel>
    </div>
  );
}
