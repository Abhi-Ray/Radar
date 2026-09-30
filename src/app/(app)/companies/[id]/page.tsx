import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { AgencyButton, MergeButton, ParentButton, SponsorNoteForm, SplitButton, UndoMergeButton, type SplitJob } from "@/components/companies/detail/CompanyForms";
import { CompanyApplications, CompanyHeader, CompanyJobs, MergedNotice, NamesAndFamily, SponsorEvidence } from "@/components/companies/detail/CompanyPanels";
import { COMPANIES_PATH } from "@/components/companies/filters";
import { parsePositiveId } from "@/components/kit/params";
import { Panel } from "@/components/tracker/Panel";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/icons";
import { loadCompany } from "@/lib/queries/companies";
import { appTz } from "@/lib/time";

/** One load per request, shared by generateMetadata and the page. */
const load = cache(async (raw: string) => {
  const id = parsePositiveId(raw);
  return id === null ? null : loadCompany(id);
});

export async function generateMetadata({ params }: PageProps<"/companies/[id]">): Promise<Metadata> {
  const d = await load((await params).id);
  if (!d) return { title: "Company not found" };
  return { title: `${d.company.name} · Companies` };
}

const JUMPS = [
  ["sponsor", "Sponsor evidence"],
  ["names", "Names & family"],
  ["jobs", "Jobs"],
  ["applications", "Applications"],
] as const;

export default async function CompanyPage({ params }: PageProps<"/companies/[id]">) {
  const d = await load((await params).id);
  if (!d) notFound();
  const tz = appTz();
  const now = new Date();
  const c = d.company;
  const merged = d.mergedInto !== null;
  const splitJobs: SplitJob[] = d.jobs.map((j) => ({ id: j.id, title: j.title, where: [j.city, j.countryIso2].filter(Boolean).join(", ") || null }));

  const breadcrumb = (
    <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-2 text-sm">
      <Link href={COMPANIES_PATH} className="inline-flex min-h-11 items-center gap-1 font-bold underline decoration-2 underline-offset-4 sm:min-h-0">
        <Icon name="arrow-left" size={16} />
        All companies
      </Link>
      <span aria-hidden="true" className="text-muted">
        /
      </span>
      <span className="font-mono text-xs text-muted" aria-current="page">
        #{c.id}
      </span>
    </nav>
  );

  if (merged) {
    return (
      <div className="flex flex-col gap-6">
        {breadcrumb}
        <MergedNotice d={d} />
        <CompanyHeader d={d} now={now} />
        <Panel id="names" code="A" kicker="Names" title="Names that point to the survivor">
          <NamesAndFamily d={d} />
        </Panel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {breadcrumb}

      <CompanyHeader
        d={d}
        now={now}
        actions={
          <>
            <Button href={`/jobs?q=${encodeURIComponent(c.name)}`} variant="primary" icon="jobs">
              Its jobs
            </Button>
            <AgencyButton companyId={c.id} isAgency={c.isAgency} />
            <ParentButton companyId={c.id} parent={d.parent ? { id: d.parent.id, name: d.parent.name } : null} />
          </>
        }
      />

      <nav aria-label="On this page" className="no-scrollbar -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 lg:hidden">
        {JUMPS.map(([id, label]) => (
          <a key={id} href={`#${id}`} className="micro shrink-0 border-2 border-ink bg-card px-2.5 py-1.5 text-ink hover:bg-acid focus-visible:bg-acid pointer-coarse:py-2.5">
            {label}
          </a>
        ))}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <Panel id="sponsor" code="A" kicker="Sponsor evidence" title="Receipts, not guesses">
            <SponsorEvidence d={d} tz={tz} />
            <div className="border-t-3 border-ink pt-4">
              <h3 className="micro mb-3 text-ink">Add your own evidence</h3>
              <SponsorNoteForm companyId={c.id} companyName={c.name} />
            </div>
          </Panel>
          <Panel id="jobs" code="C" kicker="Jobs" title={`${d.jobTotal} seen from ${c.name}`}>
            <CompanyJobs d={d} tz={tz} />
          </Panel>
        </div>
        <aside aria-label="Names, family and applications" className="flex min-w-0 flex-col gap-6">
          <Panel id="names" code="B" kicker="Names & family" title="Who this is">
            <NamesAndFamily d={d} />
            <div className="flex flex-col gap-2 border-t-3 border-ink pt-3">
              <h3 className="micro text-ink">Fix the record</h3>
              <p className="text-xs text-muted">Merges and splits are audited and survive re-runs of the collector.</p>
              <div className="flex flex-wrap gap-2">
                <SplitButton companyId={c.id} companyName={c.name} aliases={d.aliases} jobs={splitJobs} />
                <MergeButton keepId={c.id} keepName={c.name} />
              </div>
              {d.mergedRecords.length ? (
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {d.mergedRecords.map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        {m.name} <span className="font-mono text-xs text-muted">#{m.id}</span>
                      </span>
                      <UndoMergeButton
                        companyId={c.id}
                        record={{ id: m.id, name: m.name }}
                        aliasIds={d.mergedAliases.filter((a) => a.companyId === m.id).map((a) => a.id)}
                        jobs={splitJobs}
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </Panel>
          {d.duplicates.length ? (
            <Panel id="duplicates" code="D" kicker="Possible duplicates" title="Same company?" band="acid">
              <ul className="m-0 flex list-none flex-col gap-3 p-0">
                {d.duplicates.map((x) => (
                  <li key={x.id} className="flex flex-col gap-2 border-b-2 border-dashed border-ink/40 pb-3 last:border-b-0 last:pb-0">
                    <Link href={`/companies/${x.id}`} className="font-bold underline decoration-2 underline-offset-4 [overflow-wrap:anywhere]">
                      {x.name} <span className="font-mono text-xs font-normal text-muted">#{x.id}</span>
                    </Link>
                    <p className="m-0 font-mono text-xs text-muted">
                      {x.why} · {x.openJobs} open {x.openJobs === 1 ? "job" : "jobs"}
                      {x.hqCountry ? ` · ${x.hqCountry}` : ""}
                    </p>
                    <div>
                      <MergeButton keepId={c.id} keepName={c.name} drop={{ id: x.id, name: x.name }} />
                    </div>
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
          <Panel id="applications" code="E" kicker="Applications" title={d.applications.length ? `${d.applications.length} filed` : "None yet"}>
            <CompanyApplications d={d} tz={tz} />
          </Panel>
        </aside>
      </div>
    </div>
  );
}
