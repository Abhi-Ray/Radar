import type { Metadata } from "next";
import Link from "next/link";
import { ConventionsList, JobPicker, TailoringSheet } from "@/components/kit/KitPanels";
import { ResumeList, TemplateList } from "@/components/kit/KitLists";
import { ResumeEditor } from "@/components/kit/ResumeEditor";
import { TemplateEditor } from "@/components/kit/TemplateEditor";
import { TemplateWorkbench } from "@/components/kit/TemplateWorkbench";
import { isResumeTrack, isTemplateKind } from "@/components/kit/labels";
import { KIT_TABS, KIT_TAB_LABEL, kitHref, parseKitParams } from "@/components/kit/params";
import { fieldLines } from "@/components/kit/template";
import { Panel } from "@/components/tracker/Panel";
import { EmptyState, LinkTabs, Notice, SectionHeader } from "@/components/ui";
import { requireSession } from "@/lib/auth/session";
import { loadKit } from "@/lib/queries/kit";
import { appTz } from "@/lib/time";

export const metadata: Metadata = { title: "Kit" };

export default async function KitPage({ searchParams }: PageProps<"/kit">) {
  await requireSession();
  const p = parseKitParams(await searchParams);
  const tz = appTz();
  const kit = await loadKit({ jobId: p.job });
  const t = kit.tailoring;
  const countryName = (iso2: string) => kit.countries.find((c) => c.iso2 === iso2)?.name ?? iso2;
  const counts: Record<(typeof KIT_TABS)[number], number | null> = {
    resumes: kit.resumes.length,
    templates: kit.templates.length,
    conventions: kit.conventions.length,
    tailor: null,
  };

  const resumeSel = p.resume ?? kit.resumes[0]?.id ?? "new";
  const resume = typeof resumeSel === "number" ? (kit.resumes.find((r) => r.id === resumeSel) ?? null) : null;
  const templateSel = p.template ?? kit.templates.find((x) => x.kind !== "cv_convention")?.id ?? kit.templates[0]?.id ?? "new";
  const template = typeof templateSel === "number" ? (kit.templates.find((x) => x.id === templateSel) ?? null) : null;
  const jobMissing = p.job !== null && t === null;

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="05"
        kicker="KIT · Documents"
        title="Kit"
        description="Resume versions, letters with fill-in fields, how CVs are written per country, and a tailoring sheet for each job."
      />

      <LinkTabs
        label="Kit sections"
        tabs={KIT_TABS.map((tab) => ({
          href: kitHref({ tab, job: p.job }),
          label: KIT_TAB_LABEL[tab],
          count: counts[tab],
          active: p.tab === tab,
        }))}
      />

      {jobMissing ? (
        <Notice kind="warn" title={`Job #${p.job} is not in RADAR`}>
          It may have been merged or removed. Pick another job below.
        </Notice>
      ) : null}

      {p.tab === "resumes" ? (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <ResumeList resumes={kit.resumes} selected={resume ? resume.id : resumeSel === "new" ? "new" : null} tz={tz} />
          {typeof resumeSel === "number" && !resume ? (
            <EmptyState icon="kit" code="GONE" title="That resume version is gone">
              <p>It was deleted, or the link is old. Pick another version on the left.</p>
            </EmptyState>
          ) : (
            <Panel id="resume-editor" code="A" kicker={resume ? "Edit version" : "New version"} title={resume ? resume.name : "A new resume version"}>
              <ResumeEditor
                key={resume ? `${resume.id}-${resume.updatedAt.getTime()}` : "new"}
                draft={
                  resume
                    ? {
                        id: resume.id,
                        name: resume.name,
                        track: isResumeTrack(resume.track) ? resume.track : "other",
                        fileNote: resume.fileNote,
                        contentMd: resume.contentMd,
                        usedBy: resume.usedBy,
                      }
                    : { id: null, name: "", track: t?.track ?? "cloud_security", fileNote: null, contentMd: "", usedBy: 0 }
                }
              />
            </Panel>
          )}
        </div>
      ) : null}

      {p.tab === "templates" ? (
        <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <TemplateList templates={kit.templates} selected={template ? template.id : templateSel === "new" ? "new" : null} countryName={countryName} />
          <div className="flex min-w-0 flex-col gap-6">
            {typeof templateSel === "number" && !template ? (
              <EmptyState icon="kit" code="GONE" title="That template is gone">
                <p>It was deleted, or the link is old. Pick another template on the left.</p>
              </EmptyState>
            ) : template ? (
              <>
                <Panel id="fill" code="A" kicker="Fill in" title={template.name}>
                  <JobPicker choices={kit.jobChoices} selected={p.job} tab="templates" extra={{ template: String(template.id) }} />
                  <TemplateWorkbench
                    key={`${template.id}-${template.updatedAt.getTime()}-${p.job ?? 0}`}
                    templateId={template.id}
                    name={template.name}
                    bodyMd={template.bodyMd}
                    fieldsJson={template.fieldsJson}
                    prefill={
                      t
                        ? {
                            company: t.job.companyName,
                            title: t.job.title,
                            country: t.job.countryName,
                            city: t.job.city,
                            whyCompany: t.why,
                            skills: t.plan.mirror,
                          }
                        : null
                    }
                    prefillLabel={t ? `${t.job.title} · ${t.job.companyName}` : null}
                  />
                </Panel>
                <Panel id="edit-template" code="B" kicker="Edit template" title="Change the wording">
                  <TemplateEditor
                    key={`${template.id}-${template.updatedAt.getTime()}`}
                    countries={kit.countries}
                    draft={{
                      id: template.id,
                      kind: isTemplateKind(template.kind) ? template.kind : "cover_letter",
                      name: template.name,
                      bodyMd: template.bodyMd,
                      fieldLines: fieldLines(template.fieldsJson),
                      countryIso2: template.countryIso2,
                    }}
                  />
                </Panel>
              </>
            ) : (
              <Panel id="new-template" code="A" kicker="New template" title="Write it once, fill it per job">
                <TemplateEditor key="new" countries={kit.countries} draft={{ id: null, kind: "cover_letter", name: "", bodyMd: "", fieldLines: "", countryIso2: null }} />
              </Panel>
            )}
          </div>
        </div>
      ) : null}

      {p.tab === "conventions" ? <ConventionsList conventions={kit.conventions} /> : null}

      {p.tab === "tailor" ? (
        <div className="flex min-w-0 flex-col gap-6">
          <Panel id="pick-job" code="0" kicker="Tailor" title="Which job?">
            <JobPicker choices={kit.jobChoices} selected={p.job} tab="tailor" />
          </Panel>
          {t ? (
            <>
              <h2 className="headline text-2xl leading-tight [overflow-wrap:anywhere] sm:text-3xl">
                <Link href={`/jobs/${t.job.id}`} className="underline decoration-3 underline-offset-4 hover:decoration-signal">
                  {t.job.title}
                </Link>{" "}
                <span className="text-ink-soft">· {t.job.companyName}</span>
              </h2>
              <TailoringSheet t={t} />
            </>
          ) : !jobMissing ? (
            <EmptyState icon="kit" code="NO JOB" title="Pick a job to tailor for">
              <p>The sheet lists the skills to mirror from the posting, the gaps, a why-this-company draft and a checklist to tick off.</p>
            </EmptyState>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
