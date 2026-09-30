import type { ReactNode } from "react";
import { EstimateTag, Notice, Receipt, Unknown, formatEurRange, formatMoneyRange, formatNumber } from "@/components/ui";
import type { ReceiptRow } from "@/components/ui/Receipt";
import type { ResolvedFact } from "@/lib/contracts/provenance";
import { asSalaryValue, type JobDetail } from "@/lib/queries/jobs";
import { EditFieldButton } from "../FieldEditor";
import { PERIOD_LABEL, describeFactValue, evidenceOf } from "../fact-display";
import type { EditableField } from "../field-edit";
import { Panel } from "./FactMeta";

function conflictNote(key: string, r: ResolvedFact | undefined) {
  if (!r?.conflict || !r.winner) return undefined;
  const others = r.conflictWith.map((f) => `${describeFactValue(key, f.value)} (${f.source})`).join("; ");
  return `Conflicting evidence — also seen: ${others}`;
}

function overrideNote(r: ResolvedFact | undefined) {
  return r?.overridden ? `Manual override${r.winner?.evidence ? `: “${r.winner.evidence}”` : ""}` : undefined;
}

function EmptyReceipt({ title, field, children }: { title: string; field: EditableField; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2 self-start border-3 border-dashed border-ink/60 bg-paper p-4">
      <p className="micro text-muted">{title}</p>
      <p className="text-sm">
        <Unknown>{children}</Unknown>
      </p>
      <div>
        <EditFieldButton mode="override" field={field}>
          Set it
        </EditFieldButton>
      </div>
    </div>
  );
}

/** Remote, language, salary and experience receipts — each value with its quote and provenance. */
export function EvidencePanels({ detail }: { detail: JobDetail }) {
  const { resolved } = detail;
  return (
    <Panel id="evidence" code="B" kicker="Receipts" title="Where, which language, how much" bodyClassName="grid gap-4 md:grid-cols-2">
      <RemoteReceipt r={resolved.remote} />
      <LanguageReceipt r={resolved.language} />
      <SalaryReceipt r={resolved.salary} className="md:col-span-2" />
      <ExperienceReceipt r={resolved.experience} />
      <SeniorityReceipt r={resolved.seniority} />
    </Panel>
  );
}

function factReceiptProps(key: string, r: ResolvedFact) {
  const w = r.winner!;
  const notes = [overrideNote(r), conflictNote(key, r)].filter(Boolean);
  return {
    quote: evidenceOf(w.evidence),
    source: w.source,
    method: w.method,
    confidence: w.confidence,
    checkedAt: w.checkedAt,
    logicVersion: w.logicVersion,
    footnote: notes.length ? notes.join(" · ") : undefined,
  };
}

function RemoteReceipt({ r }: { r: ResolvedFact | undefined }) {
  if (!r?.winner) return <EmptyReceipt title="Remote" field="remote">The posting does not say where you can work from.</EmptyReceipt>;
  const v = r.winner.value as { class?: unknown; regions?: unknown } | null;
  const regions = Array.isArray(v?.regions) ? v.regions.filter((x): x is string => typeof x === "string") : [];
  const rows: ReceiptRow[] = [{ label: "Regions", value: regions.length ? regions.join(", ") : "None named" }];
  return <Receipt title="Remote" value={describeFactValue("remote", { class: v?.class, regions: [] })} rows={rows} {...factReceiptProps("remote", r)} />;
}

function LanguageReceipt({ r }: { r: ResolvedFact | undefined }) {
  if (!r?.winner) return <EmptyReceipt title="Language" field="language">No language requirement found.</EmptyReceipt>;
  const v = r.winner.value as { requirement?: unknown; languages?: unknown; postingLang?: unknown } | null;
  const langs = Array.isArray(v?.languages) ? v.languages.filter((x): x is string => typeof x === "string").map((l) => l.toUpperCase()) : [];
  const rows: ReceiptRow[] = [
    { label: "Languages", value: langs.length ? langs.join(", ") : "None named" },
    { label: "Posting written in", value: typeof v?.postingLang === "string" && v.postingLang ? v.postingLang.toUpperCase() : "Unknown" },
  ];
  return <Receipt title="Language" value={describeFactValue("language", { requirement: v?.requirement, languages: [] })} rows={rows} {...factReceiptProps("language", r)} />;
}

function SalaryReceipt({ r, className }: { r: ResolvedFact | undefined; className?: string }) {
  if (!r?.winner) {
    return (
      <div className={className}>
        <EmptyReceipt title="Salary" field="salary">
          No salary stated and no estimate yet.
        </EmptyReceipt>
      </div>
    );
  }
  const s = asSalaryValue(r.winner.value);
  if (!s) {
    return <Receipt className={className} title="Salary" value={describeFactValue("salary", r.winner.value)} {...factReceiptProps("salary", r)} />;
  }
  const estimated = s.kind === "estimated";
  const annual = s.annualEurMin !== null || s.annualEurMax !== null ? `${formatEurRange(s.annualEurMin, s.annualEurMax)}/yr` : null;
  const original = s.min !== null || s.max !== null ? `${formatMoneyRange(s.min, s.max, s.currency)} per ${PERIOD_LABEL[s.period] ?? s.period}` : null;
  const rows: ReceiptRow[] = [
    { label: "Kind", value: estimated ? "Estimated — not in the posting" : "Stated in the posting", strong: true },
    { label: "As written", value: original ?? "No amount" },
    { label: "Gross / net", value: s.grossNet === "unknown" ? "Not stated" : s.grossNet },
    { label: "Installments", value: s.installments ? `${s.installments} per year` : "Not stated" },
    {
      label: "FX rate",
      value:
        s.currency === "EUR"
          ? "Already EUR"
          : s.fxRate !== null
            ? `1 ${s.currency} = ${formatNumber(s.fxRate, { decimals: 4 })} EUR${s.fxDate ? ` · ${s.fxDate}` : ""}`
            : "Not converted",
    },
  ];
  return (
    <Receipt
      className={className}
      title="Salary"
      value={
        annual ? (
          estimated ? (
            <EstimateTag size="lg" basis={r.winner.source}>
              {annual}
            </EstimateTag>
          ) : (
            annual
          )
        ) : (
          <Unknown>Not converted to EUR</Unknown>
        )
      }
      rows={rows}
      {...factReceiptProps("salary", r)}
    >
      {estimated ? (
        <Notice kind="info" title="This is an estimate">
          The posting gives no salary. The range comes from the salary table named below, so treat it as a ballpark.
        </Notice>
      ) : null}
    </Receipt>
  );
}

function ExperienceReceipt({ r }: { r: ResolvedFact | undefined }) {
  if (!r?.winner) return <EmptyReceipt title="Experience" field="experience">No years of experience found.</EmptyReceipt>;
  return <Receipt compact title="Experience" value={describeFactValue("experience", r.winner.value)} {...factReceiptProps("experience", r)} />;
}

function SeniorityReceipt({ r }: { r: ResolvedFact | undefined }) {
  if (!r?.winner) return <EmptyReceipt title="Seniority" field="seniority">No seniority word in the title or text.</EmptyReceipt>;
  return <Receipt compact title="Seniority" value={describeFactValue("seniority", r.winner.value)} {...factReceiptProps("seniority", r)} />;
}
