import { Badge, Icon, cn } from "@/components/ui";
import type { JobDetail } from "@/lib/queries/jobs";
import { EditFieldButton } from "../FieldEditor";
import { describeFactValue, evidenceOf, factLabel } from "../fact-display";
import { isEditableField, type EditableField } from "../field-edit";
import { FactMeta, Panel } from "./FactMeta";
import { ledgerEntries, lingeringColumnOverride, type CandidateRole, type LedgerEntry } from "./detail-model";

const ROLE_BADGE: Record<CandidateRole, { label: string; tone: "radar" | "stamp" | "concrete" | "lilac" }> = {
  winner: { label: "Shown", tone: "radar" },
  agrees: { label: "Agrees", tone: "concrete" },
  disagrees: { label: "Disagrees", tone: "stamp" },
  estimate: { label: "Estimate", tone: "lilac" },
};

const COLUMN_FIELDS: readonly EditableField[] = ["title", "country", "city", "workplace_type"];

/**
 * Every candidate fact per field (spec §5): trust order, which one won, and who disagrees —
 * both sides of a conflict are always on screen. ai_summary has its own panel.
 */
export function FactLedger({ detail }: { detail: JobDetail }) {
  const entries = ledgerEntries(detail.resolved, { skip: ["ai_summary"] });
  const conflicts = entries.filter((e) => e.conflict).length;
  return (
    <Panel
      id="ledger"
      code="D"
      kicker="Provenance"
      title="Every fact and where it came from"
      actions={
        conflicts ? (
          <Badge tone="stamp" icon="alert">
            {conflicts} conflict{conflicts === 1 ? "" : "s"}
          </Badge>
        ) : null
      }
    >
      <p className="text-sm text-ink-soft">
        Trust order: <strong>manual → official → posting → rule → AI → estimate</strong>. A lower level never overwrites a higher one;
        disagreements stay visible here.
      </p>
      {entries.length ? (
        <ul className="flex list-none flex-col gap-2 p-0">
          {entries.map((e) => (
            <li key={e.key}>
              <LedgerRow entry={e} now={detail.now} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="border-2 border-dashed border-ink/50 p-3 text-sm text-muted">No facts recorded for this job yet.</p>
      )}
      <ColumnFacts detail={detail} />
    </Panel>
  );
}

function LedgerRow({ entry: e, now }: { entry: LedgerEntry; now: Date }) {
  const editable = isEditableField(e.key) ? e.key : null;
  return (
    <details className={cn("group border-2 border-ink bg-card", e.conflict && "border-stamp-deep")} open={e.conflict || undefined}>
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-paper focus-visible:outline-3 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
        <Icon name="chevron-down" size={16} className="shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" />
        <span className="micro w-28 shrink-0 text-muted">{e.label}</span>
        <span className="min-w-0 flex-1 basis-48 font-bold [overflow-wrap:anywhere]">{e.winnerText}</span>
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {e.overridden ? (
            <Badge tone="ink" size="sm" icon="edit">
              Override
            </Badge>
          ) : null}
          {e.conflict ? (
            <Badge tone="stamp" size="sm" icon="alert">
              Conflict
            </Badge>
          ) : null}
          <Badge tone="concrete" variant="outline" size="sm" srLabel={`${e.candidates.length} candidate facts`}>
            {e.candidates.length}×
          </Badge>
        </span>
      </summary>
      <div className="flex flex-col gap-2 border-t-2 border-ink bg-paper p-3">
        <ol className="flex list-none flex-col gap-2 p-0">
          {e.candidates.map((c) => {
            const badge = ROLE_BADGE[c.role];
            const quote = evidenceOf(c.fact.evidence);
            return (
              <li key={c.fact.id} className={cn("flex flex-col gap-1.5 border-l-4 bg-card px-3 py-2", c.role === "winner" ? "border-radar-deep" : c.role === "disagrees" ? "border-stamp-deep" : "border-ink/30")}>
                <p className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs font-bold text-muted tabular">#{c.rank}</span>
                  <Badge tone={badge.tone} variant={c.role === "winner" ? "solid" : "tint"} size="sm">
                    {badge.label}
                  </Badge>
                  <span className="min-w-0 font-bold [overflow-wrap:anywhere]">{c.text}</span>
                </p>
                {quote ? (
                  <blockquote className="border-l-2 border-ink/40 pl-2 text-sm italic text-ink-soft [overflow-wrap:anywhere]">
                    {c.manual ? "Reason: " : ""}“{quote}”
                  </blockquote>
                ) : null}
                <FactMeta fact={c.fact} now={now} />
                <p className="font-mono text-[0.6875rem] text-muted">logic {c.fact.logicVersion}</p>
              </li>
            );
          })}
        </ol>
        {editable ? (
          <div className="flex flex-wrap gap-2">
            <EditFieldButton mode="override" field={editable}>
              Override {factLabel(editable).toLowerCase()}
            </EditFieldButton>
            <EditFieldButton mode="report" field={editable}>
              Report wrong
            </EditFieldButton>
          </div>
        ) : null}
      </div>
    </details>
  );
}

/** Title / location fields live on the job row: shown with the override that set them, if any. */
function ColumnFacts({ detail }: { detail: JobDetail }) {
  const best = detail.sources.find((s) => s.isBest) ?? detail.sources[0] ?? null;
  return (
    <div className="flex flex-col gap-2 border-t-2 border-dashed border-ink/40 pt-3">
      <h3 className="micro text-ink">Posting fields</h3>
      <ul className="flex list-none flex-col gap-1.5 p-0">
        {COLUMN_FIELDS.map((field) => {
          const ov = detail.overrides.find((o) => o.active && o.field === field) ?? null;
          const lingering = ov ? null : lingeringColumnOverride(detail.overrides, field, detail.currentValues[field]);
          return (
            <li key={field} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-ink/15 pb-1.5 text-sm last:border-b-0">
              <span className="micro w-28 shrink-0 text-muted">{factLabel(field)}</span>
              <span className="min-w-0 flex-1 font-bold [overflow-wrap:anywhere]">{describeFactValue(field, detail.currentValues[field])}</span>
              <span className="min-w-0 flex-1 basis-48 text-xs text-ink-soft">
                {ov ? (
                  <>
                    <Badge tone="ink" size="sm" icon="edit">
                      Override
                    </Badge>{" "}
                    “{ov.reason}”
                  </>
                ) : lingering ? (
                  <>
                    <Badge tone="concrete" variant="outline" size="sm" icon="edit">
                      Removed override
                    </Badge>{" "}
                    Still shown until the pipeline re-reads the posting
                  </>
                ) : best ? (
                  <>From the posting · {best.platformName}</>
                ) : (
                  "From the posting"
                )}
              </span>
              <EditFieldButton mode="override" field={field} className="shrink-0">
                <span className="sr-only">Override {factLabel(field).toLowerCase()}</span>
                <span aria-hidden="true">Edit</span>
              </EditFieldButton>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
