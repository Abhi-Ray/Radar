import { Timeline, formatDate, type IconName, type TimelineEntry, type Tone } from "@/components/ui";
import type { JobDetail } from "@/lib/queries/jobs";
import { Panel } from "./FactMeta";
import { historyItems, type HistoryItem } from "./detail-model";

const KIND_META: Record<HistoryItem["kind"], { icon: IconName; tone: Tone; actor: string }> = {
  change: { icon: "history", tone: "concrete", actor: "pipeline" },
  override: { icon: "edit", tone: "ink", actor: "you" },
  override_removed: { icon: "trash", tone: "concrete", actor: "you" },
  correction: { icon: "flag", tone: "signal", actor: "you" },
};

/** What changed on this job and every decision you made about it. */
export function HistoryPanel({ detail }: { detail: JobDetail }) {
  const items = historyItems({
    changes: detail.changes,
    overrides: detail.overrides,
    corrections: detail.corrections,
    overrideEnds: detail.overrideEnds,
    overrideClears: detail.overrideClears,
  });
  const entries: TimelineEntry[] = items.map((i) => ({
    id: i.id,
    at: i.at,
    title: i.title,
    body: i.body ?? undefined,
    actor: KIND_META[i.kind].actor,
    icon: KIND_META[i.kind].icon,
    tone: KIND_META[i.kind].tone,
  }));
  return (
    <Panel id="history" code="G" kicker="History" title="Change log">
      <Timeline
        entries={entries}
        emptyText="Nothing has changed since RADAR first saw this job."
        footer={
          <span>
            First seen {formatDate(detail.job.firstSeenAt)} · {detail.job.repostCount ? `reposted ${detail.job.repostCount}×` : "never reposted"}
          </span>
        }
      />
    </Panel>
  );
}
