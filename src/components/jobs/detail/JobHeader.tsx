import Link from "next/link";
import type { ReactNode } from "react";
import { AsOf, Badge, Button, FitGauge, Icon, Stamp, Unknown, formatDate, safeExternalHref } from "@/components/ui";
import type { JobDetail } from "@/lib/queries/jobs";
import { EditFieldButton } from "../FieldEditor";
import { When } from "./FactMeta";
import { HideButton, MarkAppliedButton, SaveButton } from "../JobActions";
import { JobFlags, SalaryText, locationText } from "../JobCard";
import { COMPANY_TYPE_LABEL, REMOTE_LABEL, STATE_LABEL, WORKPLACE_LABEL, labelOf } from "../labels";

/** Title block: who, where, when, the verdict stamp and the fit dial, then the action bar. */
export function JobHeader({ detail }: { detail: JobDetail }) {
  const { job, company, country, now } = detail;
  const applyHref = safeExternalHref(job.applyUrl);
  const location = locationText({ city: job.city, countryIso2: job.countryIso2, countryName: country?.name ?? null, locationRaw: job.locationRaw });
  const workplace = job.workplaceType ? labelOf(WORKPLACE_LABEL, job.workplaceType) : null;
  const remote = job.remoteClass && job.remoteClass !== "not_remote" ? REMOTE_LABEL[job.remoteClass] : null;
  const title = job.canonicalTitle || job.titleRaw;
  const showRawTitle = job.titleRaw && job.titleRaw.trim() !== title.trim();
  const gone = job.state === "closed" || job.state === "expired";

  return (
    <header className="border-3 border-ink bg-card shadow-lg">
      <div className="hatch-soft flex flex-wrap items-center justify-between gap-2 border-b-3 border-ink px-4 py-2 sm:px-5">
        <p className="micro text-ink">
          Job <span className="font-mono tabular">#{job.id}</span> · {labelOf(STATE_LABEL, job.state)}
        </p>
        <AsOf at={job.resolvedAt ?? job.updatedAt} label="Facts as of" now={now} variant="inline" />
      </div>

      <div className="grid gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          <p className="flex flex-wrap items-center gap-2 text-sm font-bold">
            <Link href={`/companies/${company.id}`} className="underline decoration-2 underline-offset-4 hover:decoration-signal">
              {company.name}
            </Link>
            {company.isAgency ? (
              <Badge tone="cobalt" size="sm" srLabel="Recruiting agency">
                Agency
              </Badge>
            ) : null}
            {company.type !== "unknown" ? (
              <Badge tone="concrete" variant="outline" size="sm">
                {labelOf(COMPANY_TYPE_LABEL, company.type)}
              </Badge>
            ) : null}
            {company.sizeBand ? <span className="font-mono text-xs font-normal text-muted">{company.sizeBand} people</span> : null}
          </p>

          <h1 className="headline text-3xl leading-[1.05] [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">{title}</h1>
          {showRawTitle ? (
            <p className="-mt-1 text-sm text-ink-soft">
              <span className="micro mr-1.5 text-muted">Posted as</span>
              <span className="[overflow-wrap:anywhere]">{job.titleRaw}</span>
            </p>
          ) : null}

          <p className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span className="inline-flex items-center gap-1 font-bold">
              <Icon name="pin" size={16} className="shrink-0" />
              {job.countryIso2 && job.countryIso2 !== "XW" ? (
                <Link href={`/countries/${job.countryIso2.toLowerCase()}`} className="underline decoration-dotted underline-offset-4">
                  {location}
                </Link>
              ) : (
                location
              )}
            </span>
            {workplace ? <span>{workplace}</span> : null}
            {remote ? (
              <Badge tone={job.remoteClass === "worldwide" ? "radar" : job.remoteClass === "unclear" ? "concrete" : "signal"} variant="tint" size="sm" icon="remote">
                {remote}
              </Badge>
            ) : null}
          </p>

          <div className="text-base">
            <SalaryText min={job.salaryEurMin} max={job.salaryEurMax} kind={job.salaryKind} size="lg" />
          </div>

          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-t-2 border-dashed border-ink/40 pt-3 text-xs sm:grid-cols-4">
            <HeaderFact label="Posted">{job.postedAt ? formatDate(job.postedAt) : <Unknown>Not stated</Unknown>}</HeaderFact>
            <HeaderFact label="First seen">
              <When at={job.firstSeenAt} now={now} />
            </HeaderFact>
            <HeaderFact label="Last live">
              {job.lastConfirmedLiveAt ? <When at={job.lastConfirmedLiveAt} now={now} staleAfterHours={72} /> : <Unknown>Never confirmed</Unknown>}
            </HeaderFact>
            <HeaderFact label="Closes">{job.closingAt ? formatDate(job.closingAt) : <Unknown>No date</Unknown>}</HeaderFact>
          </dl>

          <JobFlags job={{ ...job, isAgency: false }} />
        </div>

        <div className="flex flex-row flex-wrap items-center justify-start gap-5 md:flex-col md:items-end">
          <FitGauge score={detail.score?.score ?? job.score} variant="dial" size="md" />
          <div className="flex flex-col items-start gap-3 md:items-end">
            <Stamp kind="visa" status={detail.visaStatus} size="lg" seed={`vh${job.id}`} sub={job.visaConfidence ? `${job.visaConfidence} confidence` : undefined} />
            <Stamp kind="eligibility" result={detail.eligibility.fact.value.result} size="md" seed={`eh${job.id}`} inked={false} />
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t-3 border-ink bg-paper p-3 sm:px-5">
        {applyHref ? (
          <Button
            href={applyHref}
            external
            variant={gone ? "secondary" : "ink"}
            icon="external"
            size="md"
            title={gone ? `RADAR marked this posting ${labelOf(STATE_LABEL, job.state).toLowerCase()}; the link may no longer work` : undefined}
          >
            {gone ? "Open old posting" : "Apply on site"}
          </Button>
        ) : (
          <Button variant="ink" icon="link-broken" disabled title="The stored apply link is not a safe http(s) address">
            No safe apply link
          </Button>
        )}
        <SaveButton jobId={job.id} saved={job.saved} />
        <MarkAppliedButton
          jobId={job.id}
          application={detail.applications[0] ? { id: detail.applications[0].id, stage: detail.applications[0].currentStage } : null}
        />
        <HideButton jobId={job.id} hidden={job.hidden} hiddenReason={job.hiddenReason} />
        <span className="hidden grow sm:block" aria-hidden="true" />
        <EditFieldButton mode="report" field="visa_status" variant="ghost" size="md">
          Report wrong info
        </EditFieldButton>
        <EditFieldButton mode="override" field="visa_status" variant="ghost" size="md">
          Override a field
        </EditFieldButton>
      </div>
      {job.hidden ? (
        <p className="border-t-2 border-ink bg-concrete-tint px-4 py-2 text-sm sm:px-5">
          <Icon name="eye-off" size={16} className="mr-1.5 inline align-[-3px]" />
          Hidden from the list and the Desk{job.hiddenReason ? <>: “{job.hiddenReason}”</> : "."}
        </p>
      ) : null}
    </header>
  );
}

function HeaderFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <dt className="micro text-muted">{label}</dt>
      <dd className="font-mono text-xs font-bold tabular">{children}</dd>
    </div>
  );
}
