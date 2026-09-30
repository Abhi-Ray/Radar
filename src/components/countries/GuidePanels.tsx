/**
 * /countries/[iso2] guide blocks (server): the rule receipt per visa route with its freshness
 * stamp, the version history (append-only, viewable as of any day), the change log, the official
 * page watches, salary ranges (estimates look like estimates), best sites, languages and CV
 * conventions.
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { ConventionsBody } from "@/components/kit/KitPanels";
import { Badge } from "@/components/ui/Badge";
import { EstimateTag } from "@/components/ui/EstimateTag";
import { formatDate, formatMoney, formatMoneyRange } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import { Receipt, type ReceiptRow } from "@/components/ui/Receipt";
import { Stamp } from "@/components/ui/Stamp";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/Table";
import { Timeline, type TimelineEntry } from "@/components/ui/Timeline";
import { safeExternalHref } from "@/components/ui/url";
import type { IconName } from "@/components/ui/icons";
import type { Tone } from "@/components/ui/status";
import type { CountryGuide, RouteGuide } from "@/lib/queries/countries";
import { DAY_MS } from "@/lib/time";
import { REVIEW_INTERVAL_DAYS, parseOtherRules, ruleFreshness, utcDayOf } from "./model";
import { changeKindLabel, daysFromToday, effectiveSpan, ruleStamp, watchMeta, type RulePhase } from "./view";
import { AddRuleVersionButton, PageReviewedButton, VerifyRuleButton, type RuleDefaults } from "./CountryForms";

type Rule = RouteGuide["versions"][number];

function ExternalLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex min-h-11 items-center gap-1 font-bold underline decoration-2 underline-offset-4 [overflow-wrap:anywhere] sm:min-h-0 ${className ?? ""}`}
    >
      {children}
      <Icon name="external" size={14} />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}

function reviewPhrase(today: string, next: Date | null, tz: string): string {
  if (!next) return "not scheduled";
  const days = daysFromToday(today, utcDayOf(next));
  const when = formatDate(next, { tz });
  if (days === 0) return `${when} · today`;
  return days > 0 ? `${when} · in ${days} ${days === 1 ? "day" : "days"}` : `${when} · ${-days} ${days === -1 ? "day" : "days"} overdue`;
}

function thresholdValue(r: Rule): string {
  if (r.salaryThresholdEur !== null) return `${formatMoney(r.salaryThresholdEur, "EUR")} / yr`;
  if (r.salaryThresholdLocal !== null) return `${formatMoney(r.salaryThresholdLocal, r.currency ?? "EUR")} / yr`;
  return "No salary floor on file";
}

/** The rule receipt: thresholds, degree/experience, span, verification and its freshness stamp. */
export function RuleReceipt({
  g,
  rule,
  today,
  now,
  tz,
  phase = "current",
  actions,
}: {
  g: RouteGuide;
  rule: Rule;
  today: string;
  now: Date;
  tz: string;
  phase?: RulePhase;
  actions?: ReactNode;
}) {
  const f = ruleFreshness(rule, now);
  const stamp = ruleStamp(f, phase);
  const rows: ReceiptRow[] = [];
  if (rule.salaryThresholdEur !== null && rule.salaryThresholdLocal !== null && rule.currency && rule.currency !== "EUR") {
    rows.push({ label: "Local threshold", value: `${formatMoney(rule.salaryThresholdLocal, rule.currency)} / yr` });
  }
  rows.push({ label: "Degree", value: rule.degreeRule ?? "not stated" });
  rows.push({ label: "Experience", value: rule.experienceRule ?? "not stated" });
  for (const o of parseOtherRules(rule.otherRulesJson)) rows.push({ label: o.label, value: o.value });
  rows.push({ label: "In effect", value: effectiveSpan(rule.effectiveFrom, rule.effectiveTo), strong: true });
  rows.push({
    label: "Last verified",
    value:
      rule.verificationStatus === "verified" && rule.lastVerifiedAt
        ? `${formatDate(rule.lastVerifiedAt, { tz })}${rule.verifiedBy ? ` · ${rule.verifiedBy}` : ""}`
        : "never",
  });
  if (phase === "current") rows.push({ label: "Next review", value: reviewPhrase(today, rule.nextReviewAt, tz) });
  if (rule.changeReason) rows.push({ label: "Why this version", value: rule.changeReason });
  const shortText = rule.ruleText && rule.ruleText.length <= 600 ? rule.ruleText : null;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <Receipt
        title={`${g.route.code} · rule`}
        serial={`v${rule.version}`}
        value={thresholdValue(rule)}
        rows={rows}
        quote={shortText}
        source={rule.officialSourceUrl ? "Official source" : "No source on file"}
        sourceHref={rule.officialSourceUrl}
        method={rule.verificationStatus === "verified" ? "manual" : null}
        checkedAt={rule.verificationStatus === "verified" ? rule.lastVerifiedAt : null}
        logicVersion={`${g.route.code}@v${rule.version}`}
        footnote={
          phase === "past" ? (
            "No longer in effect — kept for the record. Verification applies to the rule in effect today."
          ) : phase === "upcoming" ? (
            "Not in effect yet. Verify it against the official page before it starts."
          ) : f.warning ? (
            <span className="font-bold text-stamp-deep">{f.warning}</span>
          ) : null
        }
      >
        <div className="flex flex-wrap items-center gap-2">
          <Stamp
            label={stamp.label}
            tone={stamp.tone}
            dashed={stamp.dashed}
            size="md"
            kicker={`v${rule.version}`}
            sub={f.daysSinceVerified !== null ? `${f.daysSinceVerified}d ago` : "never checked"}
          />
        </div>
      </Receipt>
      {rule.ruleText && !shortText ? (
        <details className="border-3 border-ink bg-card">
          <summary className="micro flex min-h-11 cursor-pointer items-center px-3 text-ink">Full rule text</summary>
          <p className="m-0 whitespace-pre-wrap border-t-2 border-ink px-3 py-3 text-sm [overflow-wrap:anywhere]">{rule.ruleText}</p>
        </details>
      ) : null}
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

function defaultsFrom(r: Rule | null, officialUrl: string | null): RuleDefaults | null {
  if (!r)
    return officialUrl
      ? {
          salaryThresholdEur: null,
          salaryThresholdLocal: null,
          currency: null,
          degreeRule: null,
          experienceRule: null,
          ruleText: null,
          officialSourceUrl: officialUrl,
        }
      : null;
  return {
    salaryThresholdEur: r.salaryThresholdEur,
    salaryThresholdLocal: r.salaryThresholdLocal,
    currency: r.currency,
    degreeRule: r.degreeRule,
    experienceRule: r.experienceRule,
    ruleText: r.ruleText,
    officialSourceUrl: r.officialSourceUrl ?? officialUrl,
  };
}

function statusCell(r: Rule, now: Date): ReactNode {
  const f = ruleFreshness(r, now);
  const s = ruleStamp(f);
  return (
    <Badge tone={s.tone} variant={f.state === "verified" ? "solid" : "tint"} size="sm">
      {s.label}
    </Badge>
  );
}

/** Every version of the route, newest first; nothing is overwritten. */
export function VersionHistory({ g, iso2, shownId, now, tz }: { g: RouteGuide; iso2: string; shownId: number | null; now: Date; tz: string }) {
  if (!g.versions.length) return null;
  return (
    <details className="group min-w-0">
      <summary className="micro flex min-h-11 cursor-pointer items-center gap-1.5 text-ink">
        <Icon name="history" size={14} />
        Version history · {g.versions.length} {g.versions.length === 1 ? "version" : "versions"}
      </summary>
      <div className="mt-2">
        <Table caption={`${g.route.name} rule versions`}>
          <THead>
            <tr>
              <TH>Ver.</TH>
              <TH>In effect</TH>
              <TH className="text-right">Threshold</TH>
              <TH>Status</TH>
              <TH>Why</TH>
              <TH>
                <span className="sr-only">View</span>
              </TH>
            </tr>
          </THead>
          <TBody>
            {g.versions.map((v) => (
              <TR key={v.id} className={v.id === shownId ? "bg-acid-tint" : undefined}>
                <TD className="font-mono font-bold">
                  v{v.version}
                  {v.id === g.current?.id ? (
                    <span className="ml-1 font-sans text-[0.625rem] font-bold uppercase tracking-[0.12em] text-radar-deep">now</span>
                  ) : null}
                </TD>
                <TD className="whitespace-nowrap font-mono text-xs">{effectiveSpan(v.effectiveFrom, v.effectiveTo)}</TD>
                <TD className="whitespace-nowrap text-right font-mono text-xs">
                  {v.salaryThresholdEur !== null
                    ? formatMoney(v.salaryThresholdEur, "EUR")
                    : v.salaryThresholdLocal !== null
                      ? formatMoney(v.salaryThresholdLocal, v.currency ?? "EUR")
                      : "—"}
                </TD>
                <TD>
                  <div className="flex flex-col gap-0.5">
                    {statusCell(v, now)}
                    <span className="font-mono text-[0.6875rem] text-muted">
                      {v.lastVerifiedAt && v.verificationStatus === "verified" ? formatDate(v.lastVerifiedAt, { tz }) : "never"}
                    </span>
                  </div>
                </TD>
                <TD className="min-w-40 text-xs [overflow-wrap:anywhere]">{v.changeReason ?? "—"}</TD>
                <TD>
                  {v.effectiveFrom && v.id !== shownId ? (
                    <Link
                      href={`/countries/${iso2.toLowerCase()}?asof=${v.effectiveFrom}#route-${g.route.id}`}
                      className="inline-flex min-h-11 items-center whitespace-nowrap text-xs font-bold underline underline-offset-4 sm:min-h-0"
                    >
                      As of {v.effectiveFrom}
                    </Link>
                  ) : null}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </details>
  );
}

/** One visa route: its rule in effect (or as of the chosen day), actions, upcoming versions, history. */
export function RouteSection({
  g,
  iso2,
  today,
  asOfDay,
  now,
  tz,
}: {
  g: RouteGuide;
  iso2: string;
  today: string;
  asOfDay: string | null;
  now: Date;
  tz: string;
}) {
  const shown = asOfDay ? g.asOf : g.current;
  const official = safeExternalHref(g.route.officialUrl);
  const nextVersion = (g.versions[0]?.version ?? 0) + 1;
  const isCurrent = shown !== null && shown.id === g.current?.id;
  const shownPhase: RulePhase = isCurrent || !shown ? "current" : (shown.effectiveFrom ?? "0000-01-01") > today ? "upcoming" : "past";
  const nextReview = utcDayOf(new Date(now.getTime() + REVIEW_INTERVAL_DAYS * DAY_MS));
  const actions = (
    <>
      {isCurrent && shown ? (
        <VerifyRuleButton
          ruleVersionId={shown.id}
          label={`${g.route.name} v${shown.version}`}
          sourceUrl={safeExternalHref(shown.officialSourceUrl ?? g.route.officialUrl)}
          nextReview={nextReview}
        />
      ) : null}
      <AddRuleVersionButton
        routeId={g.route.id}
        routeName={g.route.name}
        nextVersion={nextVersion}
        today={today}
        defaults={defaultsFrom(g.current ?? g.versions[0] ?? null, g.route.officialUrl)}
      />
    </>
  );
  return (
    <section
      id={`route-${g.route.id}`}
      aria-labelledby={`route-${g.route.id}-title`}
      className="flex min-w-0 scroll-mt-24 flex-col gap-4 border-t-3 border-ink pt-4 first:border-t-0 first:pt-0"
    >
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 id={`route-${g.route.id}-title`} className="text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
            {g.route.name}
          </h3>
          <p className="m-0 font-mono text-xs text-muted">
            {g.route.code}
            {g.route.isActive ? "" : " · retired route"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {g.route.isActive ? null : (
            <Badge tone="concrete" variant="outline" size="sm">
              Not used
            </Badge>
          )}
          {official ? (
            <ExternalLink href={official} className="text-sm">
              Official page
            </ExternalLink>
          ) : (
            <span className="text-xs text-muted">No official page on file</span>
          )}
        </div>
      </div>
      {g.route.notes ? <p className="m-0 text-sm text-ink-soft">{g.route.notes}</p> : null}

      {asOfDay && shown && g.current && shown.id !== g.current.id ? (
        <p className="m-0 border-2 border-dashed border-ink bg-acid-tint px-3 py-2 text-sm">
          Showing v{shown.version}, in effect on {asOfDay}. Today v{g.current.version} applies.
        </p>
      ) : null}

      {shown ? (
        <RuleReceipt g={g} rule={shown} today={today} now={now} tz={tz} phase={shownPhase} actions={actions} />
      ) : (
        <div className="flex flex-col gap-3">
          <div className="border-3 border-dashed border-ink bg-card px-4 py-4">
            <p className="m-0 font-bold">No rule in effect {asOfDay ? `on ${asOfDay}` : "today"}.</p>
            <p className="m-0 mt-1 text-sm text-ink-soft">
              {g.versions.length ? "Every version on file starts later or has ended." : "No rule version is on file for this route yet."} Jobs on this route
              cannot be checked against a threshold.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">{actions}</div>
        </div>
      )}

      {g.upcoming.length ? (
        <div className="flex flex-col gap-2">
          <h4 className="micro text-ink">Announced · not yet in effect</h4>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {g.upcoming.map((u) => (
              <li key={u.id} className="flex flex-wrap items-baseline justify-between gap-2 border-2 border-ink bg-cobalt-tint px-3 py-2 text-sm">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-mono font-bold">v{u.version}</span> from <span className="font-mono">{u.effectiveFrom}</span> · {thresholdValue(u)}
                </span>
                <span className="font-mono text-xs text-ink-soft">in {daysFromToday(today, u.effectiveFrom ?? today)} days</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <VersionHistory g={g} iso2={iso2} shownId={shown?.id ?? null} now={now} tz={tz} />
    </section>
  );
}

const CHANGE_ICON: Record<string, { icon: IconName; tone: Tone }> = {
  created: { icon: "plus", tone: "cobalt" },
  updated: { icon: "history", tone: "acid" },
  verified: { icon: "stamp", tone: "radar" },
  retired: { icon: "minus", tone: "concrete" },
  page_changed: { icon: "alert", tone: "signal" },
};

/** The visa change log as a logbook. */
export function ChangeLog({ changes }: { changes: CountryGuide["changes"] }) {
  const entries: TimelineEntry[] = changes.map((c) => {
    const meta = CHANGE_ICON[c.changeKind] ?? { icon: "history" as IconName, tone: "ink" as Tone };
    const src = safeExternalHref(c.sourceUrl);
    return {
      id: c.id,
      at: c.changedAt,
      title: `${changeKindLabel(c.changeKind)}${c.routeName ? ` · ${c.routeName}` : ""}`,
      body: (
        <div className="flex flex-col gap-1">
          <p className="m-0 [overflow-wrap:anywhere]">{c.what}</p>
          {c.why ? <p className="m-0 text-ink-soft [overflow-wrap:anywhere]">Why: {c.why}</p> : null}
          {src ? (
            <ExternalLink href={src} className="text-xs">
              Source
            </ExternalLink>
          ) : null}
        </div>
      ),
      actor: c.actor,
      icon: meta.icon,
      tone: meta.tone,
    };
  });
  return (
    <Timeline entries={entries} emptyText="No rule changes recorded yet." footer="Append-only — rule versions and verifications are logged, never edited." />
  );
}

/** Official pages the watcher fetches; a changed page waits for a human review. */
export function Watches({ g, now, tz }: { g: CountryGuide; now: Date; tz: string }) {
  if (!g.watches.length) return <p className="m-0 text-sm text-ink-soft">No official pages are watched for this country.</p>;
  const routeName = new Map(g.routes.map((r) => [r.route.id, r.route.name]));
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {g.watches.map((w) => {
        const meta = watchMeta(w.status);
        const href = safeExternalHref(w.url);
        const needs = w.status === "changed" || w.status === "error";
        return (
          <li key={w.id} className={`flex min-w-0 flex-col gap-2 border-3 border-ink px-3 py-3 ${needs ? "bg-signal-tint" : "bg-card"}`}>
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
              <Badge tone={meta.tone} variant={needs ? "solid" : "tint"} size="sm">
                {meta.label}
              </Badge>
              {w.routeId !== null && routeName.get(w.routeId) ? <span className="font-mono text-xs text-muted">{routeName.get(w.routeId)}</span> : null}
            </div>
            {href ? (
              <ExternalLink href={href} className="text-sm">
                {w.url.replace(/^https?:\/\//, "")}
              </ExternalLink>
            ) : (
              <span className="font-mono text-xs [overflow-wrap:anywhere]">{w.url}</span>
            )}
            <p className="m-0 font-mono text-xs text-ink-soft">
              checked {w.lastCheckedAt ? formatDate(w.lastCheckedAt, { tz }) : "never"}
              {w.changedAt ? ` · changed ${formatDate(w.changedAt, { tz })}` : ""}
              {w.lastCheckedAt && daysFromToday(utcDayOf(w.lastCheckedAt), utcDayOf(now)) > 14 ? " · check is old" : ""}
            </p>
            {meta.blurb ? <p className="m-0 text-xs text-ink-soft">{meta.blurb}</p> : null}
            {w.lastError ? <p className="m-0 font-mono text-xs text-stamp-deep [overflow-wrap:anywhere]">{w.lastError}</p> : null}
            {needs ? (
              <div>
                <PageReviewedButton watchId={w.id} />
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Salary ranges: estimates are dashed and flagged EST., stated / official ones say so. */
export function Salaries({ g }: { g: CountryGuide }) {
  if (!g.salaries.length) return <p className="m-0 text-sm text-ink-soft">No salary ranges recorded for this country.</p>;
  return (
    <ul className="m-0 flex list-none flex-col gap-3 p-0">
      {g.salaries.map((s, i) => {
        const range = s.min !== null || s.max !== null ? formatMoneyRange(s.min, s.max, s.currency) : formatMoney(s.median, s.currency, { compact: true });
        const basisText = [g.country.iso2, s.label, s.source, s.asOf].filter(Boolean).join(" · ");
        return (
          <li key={`${s.label}-${i}`} className="flex min-w-0 flex-col gap-1.5 border-b-2 border-dashed border-ink/40 pb-3 last:border-b-0 last:pb-0">
            <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
              <span className="font-bold [overflow-wrap:anywhere]">{s.label}</span>
              {s.basis === "estimate" ? (
                <EstimateTag basis={basisText} size="md">
                  {range}
                </EstimateTag>
              ) : (
                <span className="inline-flex items-center gap-1.5 font-mono text-sm font-bold">
                  {range}
                  <Badge tone={s.basis === "official" ? "cobalt" : "paper"} variant="outline" size="sm">
                    {s.basis === "official" ? "Official" : "From postings"}
                  </Badge>
                </span>
              )}
            </div>
            <p className="m-0 font-mono text-xs text-ink-soft">
              {s.median !== null && (s.min !== null || s.max !== null) ? `median ${formatMoney(s.median, s.currency, { compact: true })} · ` : ""}
              {s.source ?? "source not recorded"}
              {s.asOf ? ` · ${s.asOf}` : ""}
            </p>
            {s.sourceHref ? (
              <ExternalLink href={s.sourceHref} className="text-xs">
                Where it comes from
              </ExternalLink>
            ) : null}
            {s.note ? <p className="m-0 text-xs text-ink-soft">{s.note}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}

/** Best job sites, languages and the free notes on the country. */
export function SitesAndLanguages({ g }: { g: CountryGuide }) {
  const c = g.country;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-2">
        <h3 className="micro text-ink">Best sites</h3>
        {g.sites.length ? (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {g.sites.map((s, i) => (
              <li key={`${s.name}-${i}`} className="min-w-0 text-sm">
                {s.href ? <ExternalLink href={s.href}>{s.name}</ExternalLink> : <span className="font-bold">{s.name}</span>}
                {s.note ? <span className="block text-xs text-ink-soft">{s.note}</span> : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 text-sm text-ink-soft">No sites recorded.</p>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <h3 className="micro text-ink">Languages</h3>
        {g.languages.length ? (
          <div className="flex flex-wrap gap-1.5">
            {g.languages.map((l) => (
              <Badge key={l} tone="paper" variant="outline" size="sm">
                {l}
              </Badge>
            ))}
          </div>
        ) : null}
        <p className="m-0 text-sm text-ink-soft [overflow-wrap:anywhere]">
          {c.languageNotes ?? (g.languages.length ? "No notes on working languages." : "No languages recorded.")}
        </p>
      </div>
      {c.notes ? (
        <div className="flex flex-col gap-2">
          <h3 className="micro text-ink">Notes</h3>
          <p className="m-0 whitespace-pre-wrap text-sm [overflow-wrap:anywhere]">{c.notes}</p>
        </div>
      ) : null}
    </div>
  );
}

/** CV conventions from the guide, plus your per-country convention templates. */
export function Conventions({ g }: { g: CountryGuide }) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <ConventionsBody c={g.conventions} />
      {g.conventionTemplates.length ? (
        <div className="flex flex-col gap-1.5 border-t-2 border-dashed border-ink/40 pt-3">
          <h3 className="micro text-ink">Your convention templates</h3>
          <ul className="m-0 flex list-none flex-col gap-1 p-0">
            {g.conventionTemplates.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/kit?tab=templates&template=${t.id}`}
                  className="inline-flex min-h-11 items-center gap-1 text-sm font-bold underline underline-offset-4 sm:min-h-0"
                >
                  {t.name}
                  <Icon name="arrow-right" size={14} />
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Link href="/kit?tab=templates" className="inline-flex min-h-11 items-center gap-1 text-sm font-bold underline underline-offset-4 sm:min-h-0">
          Add a CV convention template in the kit
          <Icon name="arrow-right" size={14} />
        </Link>
      )}
    </div>
  );
}
