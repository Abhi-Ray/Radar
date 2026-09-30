/**
 * Server panels of /kit: per-country CV conventions and the tailoring sheet for one job
 * (skills to mirror, gaps, the why-this-company draft, the checklist).
 */
import Form from "next/form";
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field } from "@/components/ui/Field";
import { Icon } from "@/components/ui/icons";
import { Select } from "@/components/ui/Input";
import { KeyValue } from "@/components/ui/KeyValue";
import { SubmitButton } from "@/components/ui/SubmitButton";
import { SPONSOR_CLASS_LABEL } from "@/components/companies/model";
import type { CvConventions } from "@/components/countries/model";
import type { CountryConventions, Tailoring } from "@/lib/queries/kit";
import { Panel } from "@/components/tracker/Panel";
import { Markdown } from "./MarkdownView";
import { TRACK_LABEL } from "./labels";
import { TailorChecklist, WhyLine } from "./TailorChecklist";

export function ConventionsBody({ c }: { c: CvConventions }) {
  if (!c.items.length && !c.notes.length) return <p className="text-sm text-ink-soft">No conventions recorded.</p>;
  return (
    <div className="flex flex-col gap-3">
      {c.items.length ? <KeyValue items={c.items.map((i) => ({ label: i.label, value: i.value, mono: false }))} /> : null}
      {c.notes.length ? (
        <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-sm">
          {c.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function ConventionsList({ conventions }: { conventions: CountryConventions[] }) {
  if (!conventions.length) {
    return (
      <EmptyState icon="countries" code="NO NOTES" title="No CV conventions recorded">
        <p>They come from the country guides (photo, length, personal details…). Add your own as a template of kind “CV convention” for a country.</p>
      </EmptyState>
    );
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {conventions.map((c) => (
        <Card key={c.iso2} as="section" pad="md" aria-labelledby={`cv-${c.iso2}`} className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`cv-${c.iso2}`} className="text-xl font-extrabold">
              {c.name} <span className="font-mono text-sm text-muted">{c.iso2}</span>
            </h2>
            <Link
              href={`/countries/${c.iso2.toLowerCase()}`}
              className="inline-flex min-h-11 items-center gap-1 text-sm font-bold underline underline-offset-4 sm:min-h-0"
            >
              Country guide
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
          <ConventionsBody c={c.conventions} />
          {c.templates.map((t) => (
            <div key={t.id} className="border-t-2 border-dashed border-ink/40 pt-3">
              <p className="micro mb-2 flex items-center justify-between gap-2 text-ink">
                <span>{t.name}</span>
                <Link href={`/kit?tab=templates&template=${t.id}`} className="normal-case underline underline-offset-4">
                  Edit
                </Link>
              </p>
              <Markdown source={t.bodyMd} compact />
            </div>
          ))}
        </Card>
      ))}
    </div>
  );
}

/** GET picker: which job to tailor for (keeps the tab). */
export function JobPicker({
  choices,
  selected,
  tab,
  extra,
}: {
  choices: Array<{ id: number; label: string }>;
  selected: number | null;
  tab: string;
  extra?: Record<string, string>;
}) {
  if (!choices.length) {
    return (
      <p className="text-sm text-ink-soft">
        Save a job (or mark one applied) and it shows up here.{" "}
        <Link href="/jobs" className="font-bold underline underline-offset-4">
          Browse jobs
        </Link>
      </p>
    );
  }
  return (
    <Form action="/kit" className="flex flex-col gap-1.5" aria-label="Pick a job">
      <input type="hidden" name="tab" value={tab} />
      {Object.entries(extra ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="Job" className="min-w-0 flex-1">
          {(p) => (
            <Select
              {...p}
              name="job"
              aria-describedby="kit-job-hint"
              defaultValue={selected ? String(selected) : ""}
              placeholder="Pick a job…"
              options={choices.map((c) => ({ value: String(c.id), label: c.label }))}
            />
          )}
        </Field>
        <SubmitButton variant="secondary" icon="arrow-right">
          Use this job
        </SubmitButton>
      </div>
      <p id="kit-job-hint" className="text-xs leading-relaxed text-muted">
        Saved jobs and jobs you applied to.
      </p>
    </Form>
  );
}

function Chips({ items, tone, empty }: { items: string[]; tone: "radar" | "signal" | "concrete"; empty: string }) {
  if (!items.length) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {items.map((s) => (
        <li key={s}>
          <Badge tone={tone} size="md" variant={tone === "concrete" ? "outline" : "solid"}>
            {s}
          </Badge>
        </li>
      ))}
    </ul>
  );
}

const BASIS: Record<Tailoring["plan"]["basis"], string> = {
  fact: "from the job's extracted skills",
  text: "by scanning the posting text",
  none: "no skills found in the posting",
};

export function TailoringSheet({ t }: { t: Tailoring }) {
  return (
    <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <div className="flex min-w-0 flex-col gap-6">
        <Panel
          id="mirror"
          code="A"
          kicker="Skills"
          title="Say it in their words"
          actions={<span className="font-mono text-xs text-muted">{BASIS[t.plan.basis]}</span>}
        >
          <div className="flex flex-col gap-2">
            <p className="micro text-ink">Mirror — in the posting and on your profile</p>
            <Chips items={t.plan.mirror} tone="radar" empty="No overlap found. Read the posting by hand." />
          </div>
          <div className="flex flex-col gap-2">
            <p className="micro text-ink">Gaps — asked for, not on your profile</p>
            <Chips items={t.plan.gaps} tone="signal" empty="No gaps against your profile skills." />
            {t.plan.gaps.length ? <p className="text-xs text-muted">Be honest: adjacent experience, what you are learning, or leave it out.</p> : null}
          </div>
          <div className="flex flex-col gap-2">
            <p className="micro text-ink">Lower in the CV for this one</p>
            <Chips items={t.plan.unused} tone="concrete" empty="Every profile skill is relevant here." />
          </div>
          {!t.profileSkills.length ? (
            <p className="border-2 border-dashed border-ink bg-signal-tint px-2 py-1.5 text-xs">
              Your profile has no skills yet, so nothing can be mirrored.{" "}
              <Link href="/settings" className="font-bold underline underline-offset-4">
                Add them in settings
              </Link>
              .
            </p>
          ) : null}
        </Panel>
        <Panel id="why" code="B" kicker="Why this company" title="One line, specific">
          <WhyLine initial={t.why} company={t.job.companyName} />
        </Panel>
        {t.conventions && (t.conventions.items.length || t.conventions.notes.length) ? (
          <Panel id="cv-conventions" code="C" kicker="CV conventions" title={t.job.countryName ?? t.job.countryIso2 ?? "Country"}>
            <ConventionsBody c={t.conventions} />
          </Panel>
        ) : null}
      </div>
      <aside aria-label="Checklist" className="flex min-w-0 flex-col gap-6">
        <Panel id="checklist" code="D" kicker="Checklist" title="Before you send">
          <KeyValue
            items={[
              { label: "Resume track", value: TRACK_LABEL[t.track], mono: false },
              { label: "Sponsor", value: SPONSOR_CLASS_LABEL[t.sponsor], mono: false },
              ...(t.visaLine
                ? [
                    {
                      label: "Visa",
                      value: (
                        <span className="flex flex-col gap-0.5">
                          <span>{t.visaLine}</span>
                          {t.visaRule ? <span className="font-mono text-[0.6875rem] font-normal text-muted [overflow-wrap:anywhere]">{t.visaRule}</span> : null}
                        </span>
                      ),
                      mono: false,
                    },
                  ]
                : []),
            ]}
          />
          <TailorChecklist jobId={t.job.id} steps={t.steps} />
          <div className="flex flex-col gap-2 border-t-3 border-ink pt-3 text-sm">
            <Link href={`/jobs/${t.job.id}`} className="inline-flex min-h-11 items-center gap-1 font-bold underline underline-offset-4 sm:min-h-0">
              Open the job
              <Icon name="arrow-right" size={14} />
            </Link>
            {t.applicationId ? (
              <Link
                href={`/applications/${t.applicationId}`}
                className="inline-flex min-h-11 items-center gap-1 font-bold underline underline-offset-4 sm:min-h-0"
              >
                Open the application
                <Icon name="arrow-right" size={14} />
              </Link>
            ) : null}
            <Link
              href={`/kit?tab=templates&job=${t.job.id}`}
              className="inline-flex min-h-11 items-center gap-1 font-bold underline underline-offset-4 sm:min-h-0"
            >
              Fill a template for this job
              <Icon name="arrow-right" size={14} />
            </Link>
          </div>
        </Panel>
      </aside>
    </div>
  );
}
