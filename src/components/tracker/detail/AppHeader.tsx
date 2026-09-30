/**
 * /applications/[id] header: the title, company, stage stamp, the key facts and the actions that
 * change the record itself (edit details, copy the posting again). Server component.
 */
import Link from "next/link";
import { buttonClasses } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { KeyValue, Unknown } from "@/components/ui/KeyValue";
import { Stamp } from "@/components/ui/Stamp";
import { Sticker } from "@/components/ui/Sticker";
import { formatDate, formatDateTime, formatRelative } from "@/components/ui/format";
import type { ApplicationDetail } from "@/lib/queries/applications";
import { localDayOf } from "@/lib/tracker/follow-up";
import { STAGE_META, isApplicationStage, isTerminalStage, isOfferStage } from "@/lib/tracker/stages";
import { StageBadge } from "../StageBadge";
import { EditDetailsButton, SnapshotButton } from "./ApplicationForms";

export function AppHeader({ d, now, tz, today }: { d: ApplicationDetail; now: Date; tz: string; today: string }) {
  const { app, job } = d;
  const stage = isApplicationStage(app.currentStage) ? app.currentStage : null;
  const meta = stage ? STAGE_META[stage] : null;
  const stamped = stage !== null && (isTerminalStage(stage) || isOfferStage(stage));
  const jobClosed = job !== null && (job.hidden || job.state === "closed" || job.state === "expired");
  const jobGone = job === null && d.goneJobId !== null;
  return (
    <header className="border-3 border-ink bg-card shadow-lg">
      <div className="hatch-soft flex flex-wrap items-center justify-between gap-2 border-b-3 border-ink px-4 py-2 sm:px-5">
        <p className="micro text-ink">
          Application <span className="font-mono tabular">#{app.id}</span> · {app.jobId !== null || d.goneJobId !== null ? "from RADAR" : "logged by hand"}
        </p>
        <p className="font-mono text-xs text-muted">updated {formatRelative(app.updatedAt, now)}</p>
      </div>
      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            {d.companyId ? (
              <Link href={`/companies/${d.companyId}`} className="underline decoration-2 underline-offset-4 hover:decoration-signal">
                {app.companyName}
              </Link>
            ) : (
              <span>{app.companyName}</span>
            )}
            {d.countryName ? <span className="font-mono text-xs font-normal text-muted">{d.countryName}</span> : null}
          </p>
          <h1 className="headline text-3xl leading-[1.05] [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">{app.title}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StageBadge stage={app.currentStage} size="md" />
            {jobClosed ? (
              <Sticker tone="signal" size="sm" icon="ghost" tilt="none">
                Ad gone · copy kept
              </Sticker>
            ) : null}
            {jobGone ? (
              <Sticker tone="stamp" size="sm" icon="link-broken" tilt="none">
                Job removed · copy kept
              </Sticker>
            ) : null}
          </div>
        </div>
        {stamped && meta ? (
          <div className="flex items-start md:justify-end">
            <Stamp label={meta.label} tone={meta.tone} kicker="Stage" size="lg" sub={formatDate(app.updatedAt, { tz })} animate />
          </div>
        ) : null}
      </div>
      <div className="border-t-3 border-ink p-4 sm:p-5">
        <KeyValue
          layout="grid"
          columns={3}
          items={[
            { label: "Applied", value: app.appliedAt ? formatDate(app.appliedAt, { tz }) : <Unknown>Not yet</Unknown> },
            { label: "Source", value: app.source ?? <Unknown>Not recorded</Unknown>, mono: false },
            { label: "Resume sent", value: d.resume ? d.resume.name : <Unknown>Not recorded</Unknown>, mono: false, hint: d.resume?.track },
            {
              label: "Next follow-up",
              value: app.nextFollowUpAt ? formatDateTime(app.nextFollowUpAt, { tz }) : <Unknown>None set</Unknown>,
              hint: app.nextFollowUpAt && localDayOf(app.nextFollowUpAt, tz) < today ? "Overdue" : undefined,
            },
            { label: "Outcome", value: app.outcome ?? <Unknown>—</Unknown>, mono: false },
            { label: "Tracked since", value: formatDate(app.createdAt, { tz }), hint: `${d.events.length} logbook ${d.events.length === 1 ? "entry" : "entries"}` },
          ]}
        />
      </div>
      <div className="flex flex-col gap-2 border-t-3 border-ink p-4 sm:flex-row sm:flex-wrap sm:items-center sm:p-5">
        {job ? (
          <Link href={`/jobs/${job.id}`} className={buttonClasses({ variant: "primary" })}>
            <Icon name="jobs" size={18} />
            Open the job
          </Link>
        ) : null}
        <EditDetailsButton
          applicationId={app.id}
          today={today}
          countries={d.countries}
          defaults={{
            companyName: app.companyName,
            title: app.title,
            countryIso2: app.countryIso2,
            source: app.source,
            outcome: app.outcome,
            appliedDay: app.appliedAt ? localDayOf(app.appliedAt, tz) : null,
          }}
        />
        {job && !jobClosed ? <SnapshotButton applicationId={app.id} /> : null}
      </div>
    </header>
  );
}
