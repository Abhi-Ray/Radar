import Link from "next/link";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState, Icon, Notice, ProgressBlocks, formatDate, formatTime, tzLabel } from "@/components/ui";
import { JobCard } from "@/components/jobs/JobCard";
import type { FollowUps, Onboarding, Section, TopMatches } from "@/lib/queries/dashboard";
import { onboardingItems } from "./blips";

export function SectionError({ section, title }: { section: Section<unknown>; title: string }) {
  if (section.ok) return null;
  return (
    <Notice kind="danger" title={title}>
      {section.error} The server log has the details; reload to try again.
    </Notice>
  );
}

/** Today's new jobs in the default view, best fit first. */
export function TopMatchesPanel({ top, now, tz, stationEmpty }: { top: Section<TopMatches>; now: Date; tz: string; stationEmpty: boolean }) {
  return (
    <Card as="section" pad="none" aria-labelledby="desk-top">
      <CardHeader
        kicker={top.ok ? `New since ${formatTime(top.data.since, { tz })} ${tzLabel(tz)}` : "New today"}
        title={<span id="desk-top">Today&apos;s top matches</span>}
        as="h2"
        band="acid"
        actions={
          top.ok && top.data.newToday > top.data.rows.length ? (
            <Link href="/jobs?sort=posted" className="text-xs font-bold underline underline-offset-4">
              {top.data.newToday} new today · list newest
            </Link>
          ) : null
        }
      />
      <CardBody>
        {!top.ok ? (
          <SectionError section={top} title="Top matches unavailable" />
        ) : top.data.rows.length ? (
          <ul className="grid list-none gap-4 p-0 md:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
            {top.data.rows.map((job) => (
              <li key={job.id} className="min-w-0">
                <JobCard job={job} now={now} newSince={top.data.since} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState
            icon="radar"
            code={stationEmpty ? "0 BLIPS" : "QUIET"}
            size="sm"
            as="h3"
            title={stationEmpty ? "Nothing on the scope yet" : "No new blips today"}
            actions={
              <Button href="/jobs" variant="secondary" size="sm" icon="arrow-right">
                {stationEmpty ? "Open jobs" : "Browse all jobs"}
              </Button>
            }
            note={`Day starts 00:00 ${tzLabel(tz)}`}
          >
            <p>
              {stationEmpty
                ? "No source has delivered a job yet. Once one is live and the daily run finishes, the best new matches land here."
                : "Nothing new has passed the default filters since midnight. The overnight run usually brings the next batch."}
            </p>
          </EmptyState>
        )}
      </CardBody>
    </Card>
  );
}

/** Reminders and follow-up dates due today or earlier (APP_TZ). */
export function FollowUpsPanel({ followUps, now, tz }: { followUps: Section<FollowUps>; now: Date; tz: string }) {
  return (
    <Card as="section" pad="none" aria-labelledby="desk-due">
      <CardHeader
        kicker="Tracker"
        title={<span id="desk-due">Follow-ups due</span>}
        as="h2"
        band="cobalt"
        actions={
          followUps.ok && followUps.data.total ? (
            <Badge tone={followUps.data.items.some((i) => i.overdue) ? "stamp" : "ink"} size="md">
              {followUps.data.total}
            </Badge>
          ) : null
        }
      />
      <CardBody>
        {!followUps.ok ? (
          <SectionError section={followUps} title="Follow-ups unavailable" />
        ) : followUps.data.items.length ? (
          <>
            <ul className="flex list-none flex-col gap-2 p-0">
              {followUps.data.items.map((f) => (
                <li key={f.key}>
                  <Link
                    href={`/applications/${f.applicationId}`}
                    className="flex items-start gap-3 border-2 border-ink bg-card p-3 no-underline hover:bg-paper focus-visible:bg-paper"
                  >
                    <Icon name={f.kind === "reminder" ? "clock" : "calendar"} size={18} className="mt-0.5 shrink-0" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="font-bold [overflow-wrap:anywhere]">{f.title}</span>
                      <span className="text-sm text-ink-soft [overflow-wrap:anywhere]">
                        {f.company} · {f.stage.replace(/_/g, " ")}
                      </span>
                      {f.note ? <span className="text-sm [overflow-wrap:anywhere]">{f.note}</span> : null}
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      {f.overdue ? (
                        <Badge tone="stamp" size="sm">
                          Overdue
                        </Badge>
                      ) : (
                        <Badge tone="signal" size="sm">
                          Today
                        </Badge>
                      )}
                      <time dateTime={f.dueAt.toISOString()} className="font-mono text-[0.6875rem] tabular" suppressHydrationWarning>
                        {formatDate(f.dueAt, { tz })}
                      </time>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {followUps.data.total > followUps.data.items.length ? (
              <p className="mt-3 text-xs text-muted">
                {followUps.data.total - followUps.data.items.length} more in the{" "}
                <Link href="/applications" className="font-bold underline underline-offset-4">
                  tracker
                </Link>
                .
              </p>
            ) : null}
          </>
        ) : (
          <EmptyState icon="check" code="0 DUE" size="sm" as="h3" tone="card" title="Nothing due today" note={`Checked ${formatTime(now, { tz })} ${tzLabel(tz)}`}>
            <p>No reminder or follow-up date has come round. Inbox zero, tracker edition.</p>
          </EmptyState>
        )}
      </CardBody>
    </Card>
  );
}

/** "Calibrate the station" — shown while any setup step is still open (spec §19.1). */
export function OnboardingPanel({ onboarding }: { onboarding: Section<Onboarding> }) {
  if (!onboarding.ok) return <SectionError section={onboarding} title="Setup checklist unavailable" />;
  const items = onboardingItems(onboarding.data);
  const done = items.filter((i) => i.done).length;
  if (done === items.length) return null;
  return (
    <Card as="section" pad="none" tone="paper" dashed aria-labelledby="desk-setup">
      <CardHeader
        kicker="Setup"
        title={<span id="desk-setup">Calibrate the station</span>}
        as="h2"
        band="signal"
        actions={<span className="font-mono text-sm font-bold tabular">{done}/{items.length}</span>}
      />
      <CardBody className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">
          The numbers on this desk only mean something once RADAR knows who you are, has checked the rules and has something to listen to.
        </p>
        <ProgressBlocks value={done} max={items.length} label="Setup steps done" tone="radar" size="sm" readout={`${done} of ${items.length} done`} />
        <ol className="grid list-none gap-3 p-0 md:grid-cols-2">
          {items.map((i) => (
            <li key={i.key} className={i.done ? "flex gap-3 border-2 border-ink bg-radar-tint p-3" : "flex gap-3 border-2 border-ink bg-card p-3"}>
              <span
                aria-hidden="true"
                className={i.done ? "flex size-7 shrink-0 items-center justify-center border-2 border-ink bg-radar" : "flex size-7 shrink-0 items-center justify-center border-2 border-dashed border-ink bg-paper"}
              >
                {i.done ? <Icon name="check" size={16} /> : null}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-1">
                <span className="font-bold">
                  {i.label}
                  <span className="sr-only">{i.done ? " — done" : " — to do"}</span>
                </span>
                <span className="text-sm text-ink-soft">{i.detail}</span>
                {!i.done ? (
                  <span>
                    <Button href={i.href} variant="secondary" size="sm" iconRight="arrow-right">
                      {i.cta}
                    </Button>
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      </CardBody>
    </Card>
  );
}
