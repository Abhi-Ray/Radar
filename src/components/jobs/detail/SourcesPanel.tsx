import Link from "next/link";
import { AsOf, Badge, Icon, Unknown, formatDate, safeExternalHref, type Tone } from "@/components/ui";
import type { JobDetail } from "@/lib/queries/jobs";
import { LINK_LABEL, labelOf } from "../labels";
import { Panel, When } from "./FactMeta";
import { linkCheckText } from "./detail-model";

const GRADE_TONE: Record<string, Tone> = { A: "radar", B: "acid", C: "signal", D: "concrete" };
const LINK_TONE: Record<string, Tone> = { ok: "radar", dead: "stamp", redirected: "signal", unknown: "concrete" };

/** Apply link health and every place this job was seen (spec §19.3). */
export function SourcesPanel({ detail }: { detail: JobDetail }) {
  const { job, sources, linkChecks, now } = detail;
  const apply = safeExternalHref(job.applyUrl);
  return (
    <Panel id="sources" code="E" kicker="Sources" title={sources.length ? `Seen in ${sources.length} ${sources.length === 1 ? "place" : "places"}` : "Where it was seen"}>
      <div className="flex flex-col gap-2 border-2 border-ink bg-paper p-3">
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span className="micro text-muted">Apply link</span>
          <Badge tone={LINK_TONE[job.linkStatus] ?? "concrete"} variant="tint" size="sm" icon={job.linkStatus === "dead" ? "link-broken" : "link"}>
            {labelOf(LINK_LABEL, job.linkStatus)}
          </Badge>
          <AsOf at={job.linkCheckedAt} label="Checked" now={now} variant="inline" />
        </p>
        {apply ? (
          <a href={apply} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 font-mono text-xs underline underline-offset-4">
            <span className="truncate">{apply}</span>
            <Icon name="external" size={12} className="shrink-0" />
          </a>
        ) : (
          <p className="text-xs">
            <Unknown>The stored apply link is not a safe http(s) address, so it is not linked.</Unknown>
          </p>
        )}
        {linkChecks.length ? (
          <ul className="flex list-none flex-col gap-1 p-0 text-xs">
            {linkChecks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <Icon name={c.ok ? "check" : "alert"} size={12} className={c.ok ? "text-radar-deep" : "text-stamp-deep"} />
                <When at={c.checkedAt} now={now} className="text-[0.6875rem]" />
                <span className="font-mono [overflow-wrap:anywhere]">{linkCheckText(c)}</span>
                {c.finalUrl && c.finalUrl !== c.url ? <span className="text-muted">redirected</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-muted">No link checks recorded yet.</p>
        )}
      </div>

      {sources.length ? (
        <ul className="flex list-none flex-col gap-2 p-0">
          {sources.map((s) => {
            const href = safeExternalHref(s.url);
            return (
              <li key={s.id} className="flex flex-col gap-1.5 border-2 border-ink bg-card p-3">
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={GRADE_TONE[s.grade] ?? "concrete"} size="sm" srLabel={`Source grade ${s.grade}`}>
                    {s.grade}
                  </Badge>
                  <Link href={`/sources/${s.sourceId}`} className="min-w-0 font-bold underline decoration-dotted underline-offset-4 [overflow-wrap:anywhere]">
                    {s.sourceLabel}
                  </Link>
                  <span className="text-xs text-muted">{s.platformName}</span>
                  {s.isBest ? (
                    <Badge tone="ink" size="sm">
                      Best source
                    </Badge>
                  ) : null}
                  {s.sourceStatus !== "live" ? (
                    <Badge tone="signal" variant="tint" size="sm">
                      {s.sourceStatus}
                    </Badge>
                  ) : null}
                  {s.termsStatus !== "allowed" ? (
                    <Badge tone="concrete" variant="outline" size="sm">
                      terms: {s.termsStatus}
                    </Badge>
                  ) : null}
                </p>
                <p className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[0.6875rem] text-ink-soft tabular">
                  <span>first {formatDate(s.firstSeenAt)}</span>
                  <span>last {formatDate(s.lastSeenAt)}</span>
                  <span>platform grade {s.platformGrade}</span>
                </p>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 text-xs font-bold underline underline-offset-4">
                    <span className="truncate">Open on {s.platformName}</span>
                    <Icon name="external" size={12} className="shrink-0" />
                  </a>
                ) : (
                  <p className="text-xs">
                    <Unknown>Link not shown (not a safe http(s) address)</Unknown>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm">
          <Unknown>No source links stored.</Unknown>
        </p>
      )}
    </Panel>
  );
}
