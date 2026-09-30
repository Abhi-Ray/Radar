import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { FieldEditProvider } from "@/components/jobs/FieldEditor";
import { DescriptionPanel } from "@/components/jobs/detail/DescriptionPanel";
import { EvidencePanels } from "@/components/jobs/detail/EvidencePanels";
import { FactLedger } from "@/components/jobs/detail/FactLedger";
import { FitPanel } from "@/components/jobs/detail/FitPanel";
import { HistoryPanel } from "@/components/jobs/detail/HistoryPanel";
import { JobHeader } from "@/components/jobs/detail/JobHeader";
import { AiSummaryPanel, ApplicationsPanel, CorrectionsPanel, OverridesPanel } from "@/components/jobs/detail/SidePanels";
import { SourcesPanel } from "@/components/jobs/detail/SourcesPanel";
import { VisaPanel } from "@/components/jobs/detail/VisaPanel";
import { describeFactValue } from "@/components/jobs/fact-display";
import { EDITABLE_FIELDS, type EditableField } from "@/components/jobs/field-edit";
import { JOBS_PATH } from "@/components/jobs/filters";
import { Icon, Notice } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { getJobDetail } from "@/lib/queries/jobs";

/** "123" → 123; anything else (signs, decimals, huge numbers, junk) → null. */
function parseJobId(raw: string): number | null {
  if (!/^[1-9]\d{0,9}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= 2_147_483_647 ? n : null;
}

/** One load per request, shared by generateMetadata and the page. */
const loadJob = cache(async (raw: string) => {
  const id = parseJobId(raw);
  return id === null ? null : getJobDetail(id);
});

export async function generateMetadata({ params }: PageProps<"/jobs/[id]">): Promise<Metadata> {
  await requireSession();
  const detail = await loadJob((await params).id);
  if (!detail) return { title: "Job not found" };
  return { title: `${detail.job.canonicalTitle || detail.job.titleRaw} · ${detail.company.name}` };
}

const JUMPS = [
  ["visa", "Visa"],
  ["evidence", "Receipts"],
  ["fit", "Fit"],
  ["ledger", "Provenance"],
  ["sources", "Sources"],
  ["description", "Posting"],
  ["history", "History"],
] as const;

export default async function JobPage({ params }: PageProps<"/jobs/[id]">) {
  await requireSession();
  const detail = await loadJob((await params).id);
  if (!detail) notFound();
  const { job } = detail;
  const current = {} as Record<EditableField, string>;
  for (const field of EDITABLE_FIELDS) current[field] = describeFactValue(field, detail.currentValues[field]);

  return (
    <FieldEditProvider jobId={job.id} defaults={detail.formDefaults} current={current}>
      <div className="flex flex-col gap-6">
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
          <Link href={JOBS_PATH} className="inline-flex items-center gap-1 font-bold underline decoration-2 underline-offset-4">
            <Icon name="arrow-left" size={16} />
            All jobs
          </Link>
          <span aria-hidden="true" className="text-muted">
            /
          </span>
          <span className="font-mono text-xs text-muted" aria-current="page">
            #{job.id}
          </span>
        </nav>

        {job.mergedIntoJobId ? (
          <Notice kind="info" title="Merged into another job">
            This posting was recognised as a duplicate. Its history is kept here;{" "}
            <Link href={`/jobs/${job.mergedIntoJobId}`} className="font-bold underline underline-offset-4">
              open the job it was merged into
            </Link>
            .
          </Notice>
        ) : null}

        <JobHeader detail={detail} />

        <nav aria-label="On this page" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
          {JUMPS.map(([id, label]) => (
            <a key={id} href={`#${id}`} className="micro shrink-0 border-2 border-ink bg-card px-2.5 py-1.5 text-ink hover:bg-acid focus-visible:bg-acid pointer-coarse:py-2.5">
              {label}
            </a>
          ))}
        </nav>

        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] xl:grid-cols-[minmax(0,1fr)_24rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <VisaPanel detail={detail} />
            <EvidencePanels detail={detail} />
            <FitPanel detail={detail} />
            <FactLedger detail={detail} />
            <DescriptionPanel detail={detail} />
            <HistoryPanel detail={detail} />
          </div>
          <aside aria-label="Actions and sources" className="flex min-w-0 flex-col gap-6">
            <ApplicationsPanel detail={detail} />
            <AiSummaryPanel detail={detail} />
            <OverridesPanel detail={detail} />
            <CorrectionsPanel detail={detail} />
            <SourcesPanel detail={detail} />
          </aside>
        </div>
      </div>
    </FieldEditProvider>
  );
}
