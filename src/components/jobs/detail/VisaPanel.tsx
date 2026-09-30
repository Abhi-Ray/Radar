import Link from "next/link";
import type { ReactNode } from "react";
import { AsOf, Badge, Button, ConfidenceMeter, Icon, Notice, Receipt, Stamp, Unknown, formatDate, formatEur, formatMoney, safeExternalHref } from "@/components/ui";
import type { EligibilityValue } from "@/lib/contracts/jobs";
import type { StoredFact } from "@/lib/contracts/provenance";
import { RULE_STALE_DAYS, type JobDetail, type VisaRuleView } from "@/lib/queries/jobs";
import { EditFieldButton } from "../FieldEditor";
import { describeFactValue } from "../fact-display";
import { FactMeta, Panel } from "./FactMeta";
import { marginText, visaDecisionOf, visaSignalOf } from "./detail-model";

/** Visa & criteria (spec §13): the verdict, the quotes it rests on, the country rule and "Am I eligible?". */
export function VisaPanel({ detail }: { detail: JobDetail }) {
  const { job, resolved, now } = detail;
  const visa = resolved.visa_status ?? null;
  const decision = visa?.winner ? visaDecisionOf(visa.winner.value) : null;
  const signals = resolved.visa_signal ? [resolved.visa_signal.winner, ...resolved.visa_signal.others].filter((f): f is StoredFact => f !== null) : [];
  const iso = job.countryIso2 && job.countryIso2 !== "XW" ? job.countryIso2 : null;

  return (
    <Panel
      id="visa"
      code="A"
      kicker="Visa & criteria"
      title="Can they sponsor you?"
      band="acid"
      actions={
        <EditFieldButton mode="report" field="visa_status">
          Wrong?
        </EditFieldButton>
      }
    >
      <div className="flex flex-wrap items-start gap-4">
        <Stamp kind="visa" status={detail.visaStatus} size="md" seed={`vp${job.id}`} />
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2">
          {visa?.winner ? (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold">{describeFactValue("visa_status", visa.winner.value)}</span>
                <ConfidenceMeter level={visa.winner.confidence} showLabel size="sm" />
                {visa.overridden ? (
                  <Badge tone="ink" size="sm" icon="edit">
                    Manual override
                  </Badge>
                ) : null}
              </p>
              {decision?.reasons.length ? (
                <ul className="flex list-none flex-col gap-1 p-0 text-sm">
                  {decision.reasons.map((r, i) => (
                    <li key={i} className="flex gap-2">
                      <Icon name="arrow-right" size={14} className="mt-1 shrink-0" />
                      <span className="[overflow-wrap:anywhere]">{r}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <FactMeta fact={visa.winner} now={now} />
            </>
          ) : (
            <p className="text-sm">
              <Unknown>No visa evidence yet.</Unknown> Neither the posting nor the company records say anything about sponsorship, so RADAR
              will not guess.
            </p>
          )}
        </div>
      </div>

      {visa?.conflict && visa.winner ? (
        <Notice kind="warn" title="The evidence disagrees">
          <p className="mb-2">RADAR shows the most trusted side. Both sides are kept:</p>
          <ul className="flex list-none flex-col gap-1.5 p-0">
            <li>
              <span className="micro mr-1.5">Shown</span>
              <strong>{describeFactValue("visa_status", visa.winner.value)}</strong> — {visa.winner.source} ({visa.winner.method})
            </li>
            {visa.conflictWith.map((f) => (
              <li key={f.id}>
                <span className="micro mr-1.5">Against</span>
                <strong>{describeFactValue("visa_status", f.value)}</strong> — {f.source} ({f.method})
                {f.evidence ? <span className="text-ink-soft"> · “{f.evidence}”</span> : null}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}

      {decision?.sides ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <SideList title="For sponsorship" items={decision.sides.for} tone="radar" />
          <SideList title="Against" items={decision.sides.against} tone="stamp" />
        </div>
      ) : null}

      {signals.length ? (
        <div className="flex flex-col gap-3">
          <h3 className="micro text-ink">Evidence quotes · {signals.length}</h3>
          <div className="grid gap-3 md:grid-cols-2">
            {signals.map((f) => {
              const s = visaSignalOf(f.value);
              return (
                <Receipt
                  key={f.id}
                  compact
                  title="Visa signal"
                  value={s?.label ?? describeFactValue("visa_signal", f.value)}
                  quote={s?.quote ?? f.evidence}
                  source={f.source}
                  method={f.method}
                  confidence={f.confidence}
                  checkedAt={f.checkedAt}
                  logicVersion={s?.ruleId ? `${f.logicVersion} · ${s.ruleId}` : f.logicVersion}
                  footnote={s?.lang ? `Quote language: ${s.lang.toUpperCase()}` : undefined}
                />
              );
            })}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 border-t-2 border-dashed border-ink/40 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="micro text-ink">Country rules{detail.country ? ` · ${detail.country.name}` : ""}</h3>
          {iso ? (
            <Link href={`/countries/${iso.toLowerCase()}`} className="text-xs font-bold underline underline-offset-4">
              All {iso} routes
            </Link>
          ) : null}
        </div>
        {!iso ? (
          <p className="text-sm">
            <Unknown>No country resolved</Unknown> — worldwide or unclear location, so no national rule applies.
          </p>
        ) : detail.visaRules.length === 0 ? (
          <p className="text-sm">
            <Unknown>No visa route on file for {iso}.</Unknown> Add one on the country page before trusting any eligibility answer.
          </p>
        ) : (
          <ul className="flex list-none flex-col gap-3 p-0">
            {detail.visaRules.map((r) => (
              <li key={r.routeId}>
                <RuleCard rule={r} now={now} />
              </li>
            ))}
          </ul>
        )}
      </div>

      <EligibilityBlock detail={detail} />
    </Panel>
  );
}

function SideList({ title, items, tone }: { title: string; items: string[]; tone: "radar" | "stamp" }) {
  return (
    <div className={tone === "radar" ? "border-2 border-radar-deep bg-radar-tint p-3" : "border-2 border-stamp-deep bg-stamp-tint p-3"}>
      <p className="micro mb-1.5">{title}</p>
      {items.length ? (
        <ul className="flex list-disc flex-col gap-1 pl-4 text-sm">
          {items.map((t, i) => (
            <li key={i} className="[overflow-wrap:anywhere]">
              {t}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nothing on this side.</p>
      )}
    </div>
  );
}

function RuleCard({ rule: r, now }: { rule: VisaRuleView; now: Date }) {
  const v = r.rule;
  const official = safeExternalHref(v?.officialSourceUrl ?? r.routeUrl);
  return (
    <div className="border-2 border-ink bg-paper">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-ink px-3 py-2">
        <p className="min-w-0 font-bold [overflow-wrap:anywhere]">
          {r.routeName} <span className="font-mono text-xs font-normal text-muted">{r.routeCode}</span>
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          {v ? (
            <Badge tone="ink" variant="outline" size="sm">
              v{v.version}
            </Badge>
          ) : null}
          <Badge tone={r.verified ? "radar" : "signal"} variant="tint" size="sm" icon={r.verified ? "check" : "alert"}>
            {r.verified ? "Verified" : "Unverified"}
          </Badge>
          {!r.current && v ? (
            <Badge tone="concrete" variant="tint" size="sm">
              Not in force today
            </Badge>
          ) : null}
        </span>
      </div>
      <div className="flex flex-col gap-2 px-3 py-2 text-sm">
        {v ? (
          <>
            <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
              <RuleFact label="Salary threshold">
                {v.salaryThresholdEur !== null ? `${formatEur(v.salaryThresholdEur)}/yr gross` : <Unknown>None stated</Unknown>}
                {v.salaryThresholdLocal !== null && v.currency && v.currency !== "EUR" ? (
                  <span className="text-muted"> ({formatMoney(v.salaryThresholdLocal, v.currency)})</span>
                ) : null}
              </RuleFact>
              <RuleFact label="In force">
                {v.effectiveFrom ? formatDate(`${v.effectiveFrom}T12:00:00Z`) : "—"} → {v.effectiveTo ? formatDate(`${v.effectiveTo}T12:00:00Z`) : "open"}
              </RuleFact>
              {v.degreeRule ? <RuleFact label="Degree">{v.degreeRule}</RuleFact> : null}
              {v.experienceRule ? <RuleFact label="Experience">{v.experienceRule}</RuleFact> : null}
            </dl>
            {v.ruleText ? <p className="text-ink-soft [overflow-wrap:anywhere]">{v.ruleText}</p> : null}
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              <AsOf at={v.lastVerifiedAt} label="Verified" now={now} variant="inline" />
              {v.nextReviewAt ? <AsOf at={v.nextReviewAt} label="Next review" now={now} variant="inline" relative={false} /> : null}
              {official ? (
                <a href={official} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-bold underline underline-offset-4">
                  Official source <Icon name="external" size={12} />
                </a>
              ) : (
                <Unknown>No official source link</Unknown>
              )}
            </p>
          </>
        ) : (
          <p>
            <Unknown>No rule version recorded for this route.</Unknown>
          </p>
        )}
        {r.stale ? (
          <Notice kind="warn" title={r.verified ? `Rule last verified ${r.ageDays ?? "?"} days ago` : "Rule not verified"}>
            {r.verified
              ? `Rules older than ${RULE_STALE_DAYS} days may have changed. Re-check the official source before relying on this answer.`
              : "Nobody has checked this rule against the official source yet, so any eligibility answer built on it is provisional."}
          </Notice>
        ) : null}
      </div>
    </div>
  );
}

function RuleFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="micro text-muted">{label}</dt>
      <dd className="[overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function EligibilityBlock({ detail }: { detail: JobDetail }) {
  const { eligibility, now, job } = detail;
  const fact = eligibility.fact;
  const v: EligibilityValue = fact.value;
  const margin = marginText(v.marginPct);
  return (
    <div className="flex flex-col gap-3 border-t-3 border-ink pt-4">
      <h3 className="headline text-xl">Am I eligible?</h3>
      <div className="flex flex-wrap items-start gap-4">
        <Stamp kind="eligibility" result={v.result} size="md" seed={`ep${job.id}`} />
        <div className="flex min-w-0 flex-1 basis-56 flex-col gap-2 text-sm">
          <p className="font-bold [overflow-wrap:anywhere]">{v.reason || "No reason given."}</p>
          {margin ? <p className="font-mono text-xs tabular">{margin}</p> : null}
          <p className="text-xs text-ink-soft">
            {v.rule ? <>Rule used: <span className="font-mono">{v.rule}</span>. </> : null}
            {v.ruleVerifiedAt ? <>Rule verified {formatDate(v.ruleVerifiedAt)}. </> : eligibility.rule ? null : "No verified rule to check against. "}
            {eligibility.computedNow
              ? "Worked out for this page view from the current rule and your profile — not stored on the job yet."
              : "Stored with the job by the last pipeline run."}
          </p>
          <FactMeta fact={fact} now={now} />
        </div>
      </div>
      {eligibility.rule?.stale ? (
        <p className="text-xs font-bold text-stamp-deep">
          <Icon name="alert" size={14} className="mr-1 inline align-[-2px]" />
          The rule behind this answer is {eligibility.rule.verified ? "stale" : "unverified"} — treat it as provisional.
        </p>
      ) : null}
      <div>
        <Button href="/settings" variant="ghost" size="sm" icon="user">
          Check my profile
        </Button>
      </div>
    </div>
  );
}
