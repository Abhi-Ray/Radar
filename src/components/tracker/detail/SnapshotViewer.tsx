/**
 * The posting copies kept with an application (newest first). They are the record of what was
 * applied to, so they render even when the job has been deleted or the ad taken down. Server
 * component; the stored HTML goes through sanitizePostingHtml() again before it is shown.
 */
import Link from "next/link";
import { describeFactValue, describeSalary, factLabel } from "@/components/jobs/fact-display";
import { EXPERIENCE_BAND_LABEL, LANGUAGE_LABEL, REMOTE_LABEL, SENIORITY_LABEL, WORKPLACE_LABEL, labelOf } from "@/components/jobs/labels";
import { EstimateTag } from "@/components/ui/EstimateTag";
import { Icon } from "@/components/ui/icons";
import { KeyValue, Unknown, type KeyValueItem } from "@/components/ui/KeyValue";
import { Stamp } from "@/components/ui/Stamp";
import { formatDate, formatDateTime } from "@/components/ui/format";
import { safeExternalHref } from "@/components/ui/url";
import type { ApplicationSnapshotRow } from "@/db/schema";
import { sanitizePostingHtml } from "@/lib/security/sanitize";
import { PLAIN_TEXT, PROSE } from "../prose";
import { readSnapshot, readSnapshotSalary, snapshotLocation } from "../snapshot";

function metaItems(s: ApplicationSnapshotRow, tz: string): KeyValueItem[] {
  const v = readSnapshot(s.jobJson);
  const salary = readSnapshotSalary(s.salaryJson);
  const apply = safeExternalHref(s.applyUrl);
  const items: KeyValueItem[] = [
    { label: "Title", value: v.title ?? v.titleRaw ?? <Unknown />, mono: false, hint: v.titleRaw && v.title && v.titleRaw !== v.title ? `As posted: ${v.titleRaw}` : undefined },
    { label: "Company", value: v.company ?? <Unknown />, mono: false },
    { label: "Where", value: snapshotLocation(v) ?? <Unknown />, mono: false, hint: v.workplaceType ? labelOf(WORKPLACE_LABEL, v.workplaceType) : undefined },
  ];
  if (!v.manual) {
    items.push(
      { label: "Remote", value: labelOf(REMOTE_LABEL, v.remoteClass), mono: false },
      { label: "Visa at the time", value: v.visaStatus ? <Stamp kind="visa" status={v.visaStatus} size="sm" tilt="none" inked={false} /> : <Unknown /> },
      { label: "Level", value: `${labelOf(SENIORITY_LABEL, v.seniority)} · ${labelOf(EXPERIENCE_BAND_LABEL, v.experienceBand)}`, mono: false },
      { label: "Language", value: labelOf(LANGUAGE_LABEL, v.languageRequirement), mono: false },
      { label: "Posted", value: v.postedAt ? formatDate(v.postedAt, { tz }) : <Unknown>Not stated</Unknown>, hint: v.closingAt ? `Closing ${formatDate(v.closingAt, { tz })}` : undefined },
    );
  }
  items.push({
    label: "Salary",
    value: salary ? salary.estimated ? <EstimateTag size="sm">{describeSalary(salary.value)}</EstimateTag> : describeSalary(salary.value) : <Unknown>Not stated</Unknown>,
    mono: false,
    hint: salary?.method ? `${salary.method}${salary.confidence ? ` · ${salary.confidence}` : ""}` : undefined,
  });
  items.push({
    label: "Apply link",
    value: apply ? (
      <a href={apply} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 underline decoration-2 underline-offset-4 [overflow-wrap:anywhere]">
        {new URL(apply).host}
        <Icon name="external" size={14} />
        <span className="sr-only">(opens off-site)</span>
      </a>
    ) : s.applyUrl ? (
      <span className="[overflow-wrap:anywhere]">{s.applyUrl}</span>
    ) : (
      <Unknown>None kept</Unknown>
    ),
    mono: false,
    hint: apply ? "The ad may be gone; the copy below is what you applied to." : undefined,
  });
  return items;
}

function Body({ s }: { s: ApplicationSnapshotRow }) {
  const v = readSnapshot(s.jobJson);
  const html = s.descriptionHtmlSanitized ? sanitizePostingHtml(s.descriptionHtmlSanitized) : "";
  const req = s.requirementsText?.trim() ?? "";
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {req ? (
        <div className="border-3 border-ink bg-paper p-3">
          <p className="micro mb-2 text-ink">Requirements as posted</p>
          <div className={`${PLAIN_TEXT} text-sm`}>{req}</div>
        </div>
      ) : null}
      <div>
        <p className="micro mb-2 text-ink">The ad</p>
        {html ? (
          <div className={PROSE} dangerouslySetInnerHTML={{ __html: html }} />
        ) : v.descriptionText ? (
          <div className={PLAIN_TEXT}>{v.descriptionText}</div>
        ) : (
          <p className="text-sm">
            <Unknown>No posting text was kept</Unknown>
          </p>
        )}
      </div>
      {v.facts.length ? (
        <details className="group border-t-2 border-dashed border-ink/40 pt-2">
          <summary className="micro flex min-h-11 cursor-pointer items-center gap-2 text-ink">
            <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
            Facts RADAR had at the time ({v.facts.length})
          </summary>
          <dl className="m-0 mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">
            {v.facts.map((f) => (
              <div key={f.key} className="min-w-0">
                <dt className="micro text-muted">{factLabel(f.key)}</dt>
                <dd className="m-0 text-sm [overflow-wrap:anywhere]">
                  {describeFactValue(f.key, f.value)}
                  {f.method ? <span className="font-mono text-xs text-muted"> · {f.method}</span> : null}
                </dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

function Copy({ s, n, tz }: { s: ApplicationSnapshotRow; n: number; tz: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <KeyValue items={metaItems(s, tz)} layout="grid" />
      <Body s={s} />
      <p className="border-t-2 border-dashed border-ink/40 pt-2 font-mono text-[0.6875rem] text-muted">
        Copy #{n} · captured {formatDateTime(s.capturedAt, { tz, zone: true })} · formatting stripped to a safe subset
      </p>
    </div>
  );
}

export function SnapshotViewer({ snapshots, jobGone, goneJobId, tz }: { snapshots: ApplicationSnapshotRow[]; jobGone: boolean; goneJobId: number | null; tz: string }) {
  if (!snapshots.length) {
    return (
      <p className="text-sm text-ink-soft">
        No copy of the posting was kept — it is saved when an application is marked applied, or when you copy it again from a job that still exists.
      </p>
    );
  }
  const [latest, ...older] = snapshots;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {jobGone && goneJobId ? (
        <p className="border-3 border-dashed border-ink bg-signal-tint px-3 py-2 text-sm">
          <strong>Job #{goneJobId} is no longer in RADAR.</strong> The copy below is everything that was kept when you applied.
        </p>
      ) : null}
      <Copy s={latest} n={snapshots.length} tz={tz} />
      {older.length ? (
        <div className="flex flex-col gap-2 border-t-3 border-ink pt-3">
          <p className="micro text-ink">Earlier copies</p>
          {older.map((s, i) => (
            <details key={s.id} className="group border-3 border-ink bg-card">
              <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-3 py-2 font-mono text-xs font-bold uppercase">
                <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90 motion-reduce:transition-none" />
                Copy #{snapshots.length - 1 - i} · {formatDate(s.capturedAt, { tz })}
              </summary>
              <div className="border-t-3 border-ink p-3">
                <Copy s={s} n={snapshots.length - 1 - i} tz={tz} />
              </div>
            </details>
          ))}
        </div>
      ) : null}
      {!jobGone ? null : (
        <p className="text-xs text-muted">
          Looking for similar roles?{" "}
          <Link href="/jobs" className="font-bold underline underline-offset-4">
            Search the jobs
          </Link>
          .
        </p>
      )}
    </div>
  );
}
