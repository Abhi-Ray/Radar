import Link from "next/link";
import type { ReactNode } from "react";
import { AsOf, Badge, EstimateTag, FitGauge, Icon, LowConfTag, Stamp, Unknown, formatEurRange, type IconName } from "@/components/ui";
import type { JobListRow } from "@/lib/queries/jobs";
import { REMOTE_LABEL, WORKPLACE_LABEL, labelOf } from "./labels";

export function jobHref(id: number): string {
  return `/jobs/${id}`;
}

/** "Berlin, Germany" / "Worldwide remote" / the raw posting location when nothing resolved. */
export function locationText(j: Pick<JobListRow, "city" | "countryIso2" | "countryName" | "locationRaw">): string {
  if (j.countryIso2 === "XW") return "Worldwide remote";
  const country = j.countryName ?? j.countryIso2;
  const parts = [j.city, country].filter((p): p is string => Boolean(p));
  return parts.length ? parts.join(", ") : j.locationRaw || "Location unknown";
}

/** Annual EUR salary: stated in mono ink, estimated behind the EST. hatch — never the same look. */
export function SalaryText({ min, max, kind, size = "md" }: { min: number | null; max: number | null; kind: JobListRow["salaryKind"]; size?: "sm" | "md" | "lg" }) {
  if (min === null && max === null) return <Unknown>Salary not stated</Unknown>;
  const text = `${formatEurRange(min, max)}/yr`;
  if (kind === "estimated") return <EstimateTag size={size} basis="salary table for this country, role and seniority">{text}</EstimateTag>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={size === "lg" ? "font-mono text-xl font-bold tabular md:text-2xl" : "font-mono font-bold tabular"}>{text}</span>
      <Badge tone="radar" variant="tint" size="sm">
        Stated
      </Badge>
    </span>
  );
}

function Flag({ tone, icon, children }: { tone: "signal" | "stamp" | "concrete" | "cobalt" | "lilac"; icon?: IconName; children: ReactNode }) {
  return (
    <Badge tone={tone} variant="tint" size="sm" icon={icon}>
      {children}
    </Badge>
  );
}

/** Warning flags shared by the card and the detail header. */
export function JobFlags({ job }: { job: Pick<JobListRow, "ghostRisk" | "linkStatus" | "needsReview" | "repostCount" | "state" | "isAgency" | "factsConfidence" | "hidden"> }) {
  const flags: ReactNode[] = [];
  if (job.linkStatus === "dead") flags.push(<Flag key="dead" tone="stamp" icon="link-broken">Dead link</Flag>);
  if (job.ghostRisk) flags.push(<Flag key="ghost" tone="signal" icon="ghost">Ghost risk</Flag>);
  if (job.state === "suspicious") flags.push(<Flag key="sus" tone="stamp" icon="alert">Suspicious</Flag>);
  if (job.state === "stale") flags.push(<Flag key="stale" tone="signal" icon="clock">Stale</Flag>);
  if (job.state === "closed" || job.state === "expired") flags.push(<Flag key="closed" tone="concrete">{job.state === "closed" ? "Closed" : "Expired"}</Flag>);
  if (job.repostCount > 0) flags.push(<Flag key="repost" tone="signal" icon="refresh">Reposted ×{job.repostCount}</Flag>);
  if (job.isAgency) flags.push(<Flag key="agency" tone="cobalt">Agency</Flag>);
  if (job.needsReview) flags.push(<Flag key="review" tone="concrete" icon="eye">Needs review</Flag>);
  if (job.hidden) flags.push(<Flag key="hidden" tone="concrete" icon="eye-off">Hidden</Flag>);
  if (job.factsConfidence === "low") flags.push(<LowConfTag key="low" />);
  if (!flags.length) return null;
  return <div className="flex flex-wrap items-center gap-1.5">{flags}</div>;
}

export function JobCard({ job, now, newSince }: { job: JobListRow; now: Date; newSince?: Date }) {
  const isNew = newSince ? job.firstSeenAt.getTime() >= newSince.getTime() : false;
  const remote = job.remoteClass && job.remoteClass !== "not_remote" ? REMOTE_LABEL[job.remoteClass] : null;
  const workplace = job.workplaceType ? labelOf(WORKPLACE_LABEL, job.workplaceType) : null;
  return (
    <article className="relative flex h-full min-w-0 flex-col border-3 border-ink bg-card shadow-md transition-[box-shadow,translate] focus-within:shadow-lg hover:-translate-x-px hover:-translate-y-px hover:shadow-lg motion-reduce:transition-none motion-reduce:hover:translate-0">
      <div className="flex items-start gap-3 border-b-3 border-ink p-3 sm:p-4">
        <div className="min-w-0 flex-1">
          <p className="micro flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
            <span className="truncate">{job.company}</span>
            {isNew ? (
              <span className="bg-signal px-1 text-ink" aria-label="New today">
                New
              </span>
            ) : null}
          </p>
          <h3 className="mt-1 text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
            <Link href={jobHref(job.id)} className="underline-offset-4 outline-none after:absolute after:inset-0 after:content-[''] hover:underline focus-visible:underline">
              {job.title}
            </Link>
          </h3>
          <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-soft">
            <span className="inline-flex items-center gap-1">
              <Icon name="pin" size={14} className="shrink-0" />
              {locationText(job)}
            </span>
            {workplace ? <span aria-hidden="true">·</span> : null}
            {workplace ? <span>{workplace}</span> : null}
            {remote ? (
              <Badge tone={job.remoteClass === "worldwide" ? "radar" : job.remoteClass === "unclear" ? "concrete" : "signal"} variant="tint" size="sm" icon="remote">
                {remote}
              </Badge>
            ) : null}
          </p>
        </div>
        <FitGauge score={job.score} variant="inline" className="shrink-0" />
      </div>

      <div className="flex flex-1 flex-col gap-3 p-3 sm:p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Stamp kind="visa" status={job.visaStatus} size="sm" seed={`v${job.id}`} />
          <Stamp kind="eligibility" result={job.eligibility ?? "cant_tell"} size="sm" seed={`e${job.id}`} inked={false} />
          {job.visaConfidence ? (
            <span className="font-mono text-[0.6875rem] uppercase text-muted">
              visa conf. <span className="font-bold text-ink">{job.visaConfidence}</span>
            </span>
          ) : null}
        </div>
        <div className="text-sm">
          <SalaryText min={job.salaryEurMin} max={job.salaryEurMax} kind={job.salaryKind} size="sm" />
        </div>
        <JobFlags job={job} />
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t-3 border-ink bg-paper px-3 py-2 text-xs sm:px-4">
        <AsOf at={job.firstSeenAt} label="Seen" now={now} variant="inline" />
        <AsOf at={job.lastConfirmedLiveAt} label="Live" now={now} variant="inline" staleAfterHours={72} />
        <span className="ml-auto inline-flex items-center gap-1.5">
          {job.saved ? <Icon name="bookmark" size={14} title="Saved" /> : null}
          {job.applied ? (
            <Badge tone="cobalt" size="sm">
              Applied
            </Badge>
          ) : null}
          <Badge tone={job.bestGrade === "A" ? "radar" : job.bestGrade === "B" ? "acid" : "concrete"} variant="outline" size="sm" srLabel={`Best source grade ${job.bestGrade ?? "unknown"}, ${job.sourceCount} sources`}>
            {job.bestGrade ?? "?"} · {job.sourceCount} src
          </Badge>
        </span>
      </div>
    </article>
  );
}
