import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { Panel } from "@/components/tracker/Panel";
import { AppHeader } from "@/components/tracker/detail/AppHeader";
import { CommentForm, FollowUpForm, ResumeForm, StageForm } from "@/components/tracker/detail/ApplicationForms";
import { Logbook } from "@/components/tracker/detail/Logbook";
import { ReminderHistory } from "@/components/tracker/detail/ReminderHistory";
import { SnapshotViewer } from "@/components/tracker/detail/SnapshotViewer";
import { APPLICATIONS_PATH } from "@/components/tracker/filters";
import { Icon } from "@/components/ui/icons";
import { tzLabel } from "@/components/ui/format";
import { loadApplication } from "@/lib/queries/applications";
import { localDayOf, localTimeOf } from "@/lib/tracker/follow-up";
import { isApplicationStage, isClosedStage } from "@/lib/tracker/stages";
import { appTz, localDay } from "@/lib/time";

/** "123" → 123; anything else (signs, decimals, huge numbers, junk) → null. */
function parseId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (raw: string) => {
  const id = parseId(raw);
  return id === null ? null : loadApplication(id);
});

export async function generateMetadata({ params }: PageProps<"/applications/[id]">): Promise<Metadata> {
  const d = await load((await params).id);
  if (!d) return { title: "Application not found" };
  return { title: `${d.app.title} · ${d.app.companyName} · Tracker` };
}

const JUMPS = [
  ["logbook", "Logbook"],
  ["stage", "Stage"],
  ["follow-up", "Follow-up"],
  ["posting", "Posting copy"],
] as const;

export default async function ApplicationPage({ params }: PageProps<"/applications/[id]">) {
  const d = await load((await params).id);
  if (!d) notFound();
  const tz = appTz();
  const now = new Date();
  const today = localDay(now, tz);
  const { app } = d;
  const stage = isApplicationStage(app.currentStage) ? app.currentStage : "saved";
  const closed = isClosedStage(stage);
  const current = app.nextFollowUpAt ? { day: localDayOf(app.nextFollowUpAt, tz), time: localTimeOf(app.nextFollowUpAt, tz) } : null;

  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={APPLICATIONS_PATH} className="inline-flex min-h-11 items-center gap-1 font-bold underline decoration-2 underline-offset-4 sm:min-h-0">
          <Icon name="arrow-left" size={16} />
          All applications
        </Link>
        <span aria-hidden="true" className="text-muted">
          /
        </span>
        <span className="font-mono text-xs text-muted" aria-current="page">
          #{app.id}
        </span>
      </nav>

      <AppHeader d={d} now={now} tz={tz} today={today} />

      <nav aria-label="On this page" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
        {JUMPS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="micro shrink-0 border-2 border-ink bg-card px-2.5 py-1.5 text-ink hover:bg-acid focus-visible:bg-acid pointer-coarse:py-2.5">
            {label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel id="logbook" code="A" kicker="Logbook" title="What happened, in order">
            <Logbook events={d.events} tz={tz} />
            <div className="border-t-3 border-ink pt-4">
              <h3 className="micro mb-3 text-ink">Add to the logbook</h3>
              <CommentForm applicationId={app.id} today={today} />
            </div>
          </Panel>
          <Panel id="posting" code="D" kicker="Posting copy" title="What you applied to">
            <SnapshotViewer snapshots={d.snapshots} jobGone={d.job === null} goneJobId={d.goneJobId} tz={tz} />
          </Panel>
        </div>
        <aside aria-label="Stage and follow-up" className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-4">
          <Panel id="stage" code="B" kicker="Stage" title="Move it along" band={closed ? "concrete" : undefined}>
            <StageForm key={`${stage}-${d.events.length}`} applicationId={app.id} stage={stage} today={today} />
          </Panel>
          <Panel id="follow-up" code="C" kicker="Follow-up" title="Next nudge">
            <FollowUpForm key={app.nextFollowUpAt?.toISOString() ?? "none"} applicationId={app.id} today={today} current={current} closed={closed} tzName={tzLabel(tz)} />
            <div className="border-t-3 border-ink pt-3">
              <ReminderHistory reminders={d.reminders} now={now} tz={tz} />
            </div>
          </Panel>
          <Panel id="resume" code="E" kicker="Resume" title="CV that went out">
            <ResumeForm applicationId={app.id} current={app.resumeVersionId} resumes={d.resumes} />
            {d.resume ? (
              <Link href={`/kit?tab=resumes&resume=${d.resume.id}`} className="inline-flex min-h-11 items-center gap-1 text-sm font-bold underline decoration-2 underline-offset-4 sm:min-h-0">
                Open “{d.resume.name}” in the kit
                <Icon name="arrow-right" size={14} />
              </Link>
            ) : null}
          </Panel>
        </aside>
      </div>
    </div>
  );
}
