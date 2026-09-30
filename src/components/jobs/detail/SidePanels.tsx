import Link from "next/link";
import { AsOf, Badge, Icon, Notice, formatDate } from "@/components/ui";
import type { JobDetail } from "@/lib/queries/jobs";
import { AiSummaryButton, ClearOverrideButton } from "../JobActions";
import { describeFactValue, factLabel } from "../fact-display";
import { FactMeta, Panel } from "./FactMeta";

/** Manual "ask AI" — a cached summary if one exists, plus the budget it would spend. */
export function AiSummaryPanel({ detail }: { detail: JobDetail }) {
  const { aiSummary, aiBudget, job, now } = detail;
  const budget = aiBudget ? { enabled: aiBudget.enabled, used: aiBudget.used, limit: aiBudget.limit, remaining: aiBudget.remaining } : null;
  return (
    <Panel id="ai" code="H" kicker="AI · manual" title="AI summary" band="lilac">
      {aiSummary ? (
        <Notice kind="ai" title="Summary">
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{aiSummary.text}</p>
          <FactMeta fact={aiSummary.fact} now={now} className="mt-2" />
        </Notice>
      ) : (
        <p className="text-sm text-ink-soft">
          No summary yet. RADAR never calls the AI on its own for this — only when you press the button, and only within today&apos;s budget.
        </p>
      )}
      <AiSummaryButton jobId={job.id} budget={budget} hasSummary={Boolean(aiSummary)} />
      {aiBudget ? <AsOf at={aiBudget.syncedAt} label="Budget synced" now={now} variant="inline" /> : null}
    </Panel>
  );
}

/** Active overrides first (removable), then the ones that were replaced or removed. */
export function OverridesPanel({ detail }: { detail: JobDetail }) {
  const active = detail.overrides.filter((o) => o.active);
  const past = detail.overrides.filter((o) => !o.active);
  return (
    <Panel id="overrides" code="I" kicker="Manual" title={active.length ? `${active.length} override${active.length === 1 ? "" : "s"} in force` : "No overrides"}>
      {active.length ? (
        <ul className="flex list-none flex-col gap-2 p-0">
          {active.map((o) => (
            <li key={o.id} className="flex flex-col gap-1 border-2 border-ink bg-card p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="micro text-muted">{factLabel(o.field)}</span>
                <ClearOverrideButton jobId={detail.job.id} field={o.field} label={factLabel(o.field)} />
              </div>
              <p className="font-bold [overflow-wrap:anywhere]">{describeFactValue(o.field, o.valueJson)}</p>
              <p className="text-sm text-ink-soft [overflow-wrap:anywhere]">“{o.reason}”</p>
              <AsOf at={o.createdAt} label="Set" now={detail.now} variant="inline" />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">Every value on this page comes from the evidence. Use “Override a field” when you know better.</p>
      )}
      {past.length ? (
        <details className="text-sm">
          <summary className="cursor-pointer font-bold">
            {past.length} earlier override{past.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 flex list-none flex-col gap-1.5 p-0">
            {past.map((o) => (
              <li key={o.id} className="border-l-4 border-ink/30 pl-2 text-ink-soft">
                <span className="micro mr-1.5">{factLabel(o.field)}</span>
                <span className="line-through decoration-1">{describeFactValue(o.field, o.valueJson)}</span> · {formatDate(o.createdAt)}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </Panel>
  );
}

export function CorrectionsPanel({ detail }: { detail: JobDetail }) {
  const { corrections, now } = detail;
  if (!corrections.length) return null;
  return (
    <Panel id="corrections" code="J" kicker="Accuracy" title={`${corrections.length} correction${corrections.length === 1 ? "" : "s"} reported`}>
      <ul className="flex list-none flex-col gap-2 p-0">
        {corrections.map((c) => (
          <li key={c.id} className="flex flex-col gap-1 border-l-4 border-signal-deep bg-signal-tint px-3 py-2 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-bold">{factLabel(c.field)}</span>
              {c.addedToGolden ? (
                <Badge tone="radar" size="sm" icon="check">
                  Golden sample
                </Badge>
              ) : null}
            </p>
            {c.note ? <p className="[overflow-wrap:anywhere]">{c.note}</p> : null}
            <AsOf at={c.createdAt} label="Reported" now={now} variant="inline" />
          </li>
        ))}
      </ul>
      <Link href="/accuracy" className="text-xs font-bold underline underline-offset-4">
        See the accuracy check
      </Link>
    </Panel>
  );
}

export function ApplicationsPanel({ detail }: { detail: JobDetail }) {
  const { applications, now } = detail;
  if (!applications.length) return null;
  return (
    <Panel id="tracker" code="K" kicker="Tracker" title="Your application" band="cobalt">
      <ul className="flex list-none flex-col gap-2 p-0">
        {applications.map((a) => (
          <li key={a.id}>
            <Link href={`/applications/${a.id}`} className="flex flex-col gap-1 border-2 border-ink bg-card p-3 hover:bg-paper">
              <span className="flex flex-wrap items-center gap-2">
                <Badge tone="cobalt" size="sm">
                  {a.currentStage.replace(/_/g, " ")}
                </Badge>
                <span className="font-mono text-xs">#{a.id}</span>
                <Icon name="arrow-right" size={14} className="ml-auto" />
              </span>
              <span className="flex flex-wrap gap-x-3 text-xs">
                {a.appliedAt ? <AsOf at={a.appliedAt} label="Applied" now={now} variant="inline" relative={false} /> : null}
                {a.nextFollowUpAt ? <AsOf at={a.nextFollowUpAt} label="Follow up" now={now} variant="inline" relative={false} /> : null}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
