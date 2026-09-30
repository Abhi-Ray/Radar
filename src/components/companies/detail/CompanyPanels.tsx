/**
 * /companies/[id] panels (server): the header, sponsor evidence as receipts (register name,
 * download date, match status, method, confidence, logic version), names and family, jobs and
 * applications. The fix-up forms live in CompanyForms.tsx (client).
 */
import Link from "next/link";
import { STATE_LABEL, labelOf } from "@/components/jobs/labels";
import { StageBadge } from "@/components/tracker/StageBadge";
import { Badge } from "@/components/ui/Badge";
import { formatDate, formatNumber, formatRelative } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import { KeyValue, Unknown } from "@/components/ui/KeyValue";
import { Notice } from "@/components/ui/Notice";
import { Receipt } from "@/components/ui/Receipt";
import { Stamp } from "@/components/ui/Stamp";
import { Sticker } from "@/components/ui/Sticker";
import { VISA_META, isVisaStatus } from "@/components/ui/status";
import { safeExternalHref } from "@/components/ui/url";
import type { CompanyDetail, CompanyRef, RegisterReceipt } from "@/lib/queries/companies";
import { ALIAS_KIND_LABEL, BASIS_LABEL, SPONSOR_CLASS_LABEL } from "../model";
import { SponsorStamp } from "../SponsorStamp";
import { SPONSOR_CLASS_META, companyTypeLabel, matchStatusMeta, registerSummaryLine, sizeLabel } from "../view";

const LINK = "inline-flex min-h-11 items-center gap-1 font-bold underline decoration-2 underline-offset-4 hover:decoration-signal sm:min-h-0";

function CompanyLink({ c }: { c: CompanyRef }) {
  return (
    <Link href={`/companies/${c.id}`} className={LINK}>
      {c.name}
      <span className="font-mono text-xs font-normal text-muted">
        #{c.id}
        {c.hqCountry ? ` · ${c.hqCountry}` : ""}
      </span>
    </Link>
  );
}

// ---- header ----------------------------------------------------------------------------------

export function CompanyHeader({ d, now, actions }: { d: CompanyDetail; now: Date; actions?: React.ReactNode }) {
  const c = d.company;
  const site = c.domain ? safeExternalHref(`https://${c.domain}`) : null;
  const size = sizeLabel(c.sizeBand);
  const openJobs = d.jobs.filter((j) => j.state !== "closed" && j.state !== "expired").length;
  return (
    <header className="border-3 border-ink bg-card shadow-lg">
      <div className="hatch-soft flex flex-wrap items-center justify-between gap-2 border-b-3 border-ink px-4 py-2 sm:px-5">
        <p className="micro text-ink">
          Company <span className="font-mono tabular">#{c.id}</span>
          {d.mergedRecords.length ? ` · ${d.mergedRecords.length} merged in` : ""}
        </p>
        <p className="font-mono text-xs text-muted">updated {formatRelative(c.updatedAt, now)}</p>
      </div>
      <div className="grid grid-cols-1 gap-5 p-4 sm:p-5 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="flex min-w-0 flex-col gap-3">
          {d.parent ? (
            <p className="text-sm">
              <span className="text-ink-soft">Part of </span>
              <CompanyLink c={d.parent} />
            </p>
          ) : null}
          <h1 className="headline text-3xl leading-[1.05] [overflow-wrap:anywhere] sm:text-4xl lg:text-5xl">{c.name}</h1>
          <div className="flex flex-wrap items-center gap-2">
            {site && c.domain ? (
              <a
                href={site}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-11 items-center gap-1 font-mono text-sm underline underline-offset-4 sm:min-h-0"
              >
                {c.domain}
                <Icon name="external" size={14} />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
            {/* The agency sticker already says "Agency". */}
            {c.type !== "unknown" && !(c.isAgency && c.type === "agency") ? (
              <Badge tone="lilac" variant="tint" size="md">
                {companyTypeLabel(c.type)}
              </Badge>
            ) : null}
            {c.isAgency ? (
              <Sticker tone="signal" size="sm" icon="flag" tilt="none">
                Agency
              </Sticker>
            ) : null}
          </div>
          <KeyValue
            layout="grid"
            columns={3}
            className="max-sm:grid-cols-2"
            items={[
              { label: "HQ", value: d.hqCountryName ?? c.hqCountry ?? <Unknown />, mono: false },
              { label: "Size", value: size ?? <Unknown />, mono: false },
              { label: "Type", value: c.type === "unknown" ? <Unknown /> : companyTypeLabel(c.type), mono: false },
              { label: "Open jobs", value: formatNumber(openJobs), hint: d.jobTotal > openJobs ? `${formatNumber(d.jobTotal)} seen in total` : undefined },
              { label: "Applications", value: formatNumber(d.applications.length) },
              { label: "On file since", value: formatDate(c.createdAt) },
            ]}
          />
          {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
        </div>
        <div className="flex min-w-0 items-start justify-center px-2 md:justify-end md:px-0 md:pt-2">
          {/* The large stamp's register line does not wrap; phones get the medium one. The wrappers
              carry the display switch: a className on Stamp would lose to its own inline-flex. */}
          <span className="md:hidden">
            <SponsorStamp cls={d.sponsor} size="md" sub={registerSummaryLine(d.summary)} kicker={d.latestNote ? "Your evidence" : "Visa sponsor"} />
          </span>
          <span className="hidden md:block">
            <SponsorStamp cls={d.sponsor} size="lg" sub={registerSummaryLine(d.summary)} kicker={d.latestNote ? "Your evidence" : "Visa sponsor"} />
          </span>
        </div>
      </div>
    </header>
  );
}

// ---- sponsor evidence ------------------------------------------------------------------------

function registerRows(r: RegisterReceipt) {
  const v = r.view;
  const e = r.entry;
  const downloaded = v.registerVersion ?? e?.registerVersion ?? null;
  const rows: Array<{ label: string; value: React.ReactNode; strong?: boolean }> = [
    { label: "Listed as", value: v.orgName ?? e?.orgName ?? "—", strong: true },
    { label: "Register file", value: downloaded ? `downloaded ${downloaded}` : "download date unknown" },
    { label: "Match", value: matchStatusMeta(r.matchStatus).label },
  ];
  if (v.basis) rows.push({ label: "Matched on", value: BASIS_LABEL[v.basis] ?? v.basis });
  if (v.matchedName) rows.push({ label: "Our name", value: v.matchedName });
  const town = v.town ?? e?.town;
  if (town) rows.push({ label: "Town", value: town });
  const country = v.countryIso2 ?? e?.countryIso2;
  if (country) rows.push({ label: "Country", value: v.countryAgrees === false ? `${country} (HQ differs)` : country });
  const route = v.route ?? e?.route;
  if (route) rows.push({ label: "Route", value: route });
  const rating = v.rating ?? e?.rating;
  if (rating) rows.push({ label: "Rating", value: rating });
  if (v.evidenceKind === "sponsorship_history") rows.push({ label: "Kind", value: "Past sponsorship (history)" });
  if (v.entryCount && v.entryCount > 1) rows.push({ label: "Entries", value: `${v.entryCount} on this register` });
  return rows;
}

export function SponsorEvidence({ d, tz }: { d: CompanyDetail; tz: string }) {
  const meta = SPONSOR_CLASS_META[d.sponsor];
  const s = d.summary;
  const latestId = d.notes.length ? Math.max(...d.notes.map((n) => n.evidenceId)) : null;
  const confirmedRegs = d.registers.filter((r) => r.matchStatus === "confirmed").length;
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-2 border-l-4 border-ink bg-paper px-3 py-2">
        <p className="m-0 font-extrabold">{SPONSOR_CLASS_LABEL[d.sponsor]}</p>
        <p className="m-0 text-sm text-ink-soft">{meta.blurb}</p>
        {s ? (
          <p className="m-0 font-mono text-xs text-muted">
            {s.sponsorCountries.length ? `sponsors in ${s.sponsorCountries.join(", ")}` : null}
            {s.sponsorCountries.length && s.historyCountries.length ? " · " : null}
            {s.historyCountries.length ? `history in ${s.historyCountries.join(", ")}` : null}
            {s.possibleMatches ? `${s.sponsorCountries.length || s.historyCountries.length ? " · " : ""}${s.possibleMatches} possible to check` : null}
            {s.at ? ` · matched ${formatDate(s.at, { tz })}` : null}
            {s.logicVersion ? ` · ${s.logicVersion}` : null}
          </p>
        ) : (
          <p className="m-0 font-mono text-xs text-muted">No register matching has run for this company yet.</p>
        )}
      </div>

      <section aria-labelledby="registers-title" className="flex min-w-0 flex-col gap-3">
        <h3 id="registers-title" className="micro text-ink">
          Register receipts · {d.registers.length}
          {d.registers.length ? <span className="font-normal text-muted"> ({confirmedRegs} confirmed)</span> : null}
        </h3>
        {d.registers.length ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {d.registers.map((r) => {
              const ms = matchStatusMeta(r.matchStatus);
              return (
                <Receipt
                  key={r.evidenceId}
                  compact
                  title="Sponsor register"
                  value={r.view.registerName}
                  serial={`E-${r.evidenceId}`}
                  rows={registerRows(r)}
                  quote={r.evidence}
                  source={r.source}
                  sourceHref={r.source}
                  method={r.method}
                  confidence={r.confidence}
                  checkedAt={r.checkedAt}
                  logicVersion={r.logicVersion}
                  footnote={ms.blurb || undefined}
                >
                  <Stamp label={ms.label} tone={ms.tone} size="sm" tilt="none" inked={false} dashed={r.matchStatus !== "confirmed"} />
                </Receipt>
              );
            })}
          </div>
        ) : s && s.status !== "unknown" ? (
          <p className="text-sm text-ink-soft">
            The saved register summary says <strong className="font-bold text-ink">{s.status}</strong>, but none of its receipts are on file. Treat that as
            unproven until the register matcher runs again or you record a note.
          </p>
        ) : (
          <p className="text-sm text-ink-soft">
            No sponsor register lists any of this company’s names. Registers exist for a few countries only, so this is not a “no”.
          </p>
        )}
      </section>

      <section aria-labelledby="notes-title" className="flex min-w-0 flex-col gap-3">
        <h3 id="notes-title" className="micro text-ink">
          Your notes · {d.notes.length}
        </h3>
        {d.notes.length ? (
          <div className="grid min-w-0 gap-4 xl:grid-cols-2">
            {d.notes.map((n) => (
              <Receipt
                key={n.evidenceId}
                compact
                title="Your sponsor note"
                value={n.note.sponsors ? "Sponsors visas" : "Does not sponsor"}
                serial={`N-${n.evidenceId}`}
                quote={n.note.note}
                source={n.url ? undefined : "Your own evidence"}
                sourceHref={n.url}
                method="manual"
                confidence="high"
                checkedAt={n.checkedAt}
                logicVersion="manual"
                footnote={n.evidenceId === latestId ? "In effect — the newest note wins." : "Superseded by a newer note."}
                className={n.evidenceId === latestId ? undefined : "opacity-75"}
              />
            ))}
          </div>
        ) : (
          <p className="text-sm text-ink-soft">
            No notes yet. Heard from a recruiter or read it on their careers page? Record it below — it counts as evidence from you.
          </p>
        )}
      </section>

      {d.agencyNotes.length || d.otherEvidence.length ? (
        <details className="border-2 border-dashed border-ink/50 px-3 py-2">
          <summary className="flex min-h-11 cursor-pointer items-center font-bold">Other evidence ({d.agencyNotes.length + d.otherEvidence.length})</summary>
          <ul className="m-0 flex list-none flex-col gap-2 p-0 text-sm">
            {d.agencyNotes.map((a) => (
              <li key={`a-${a.evidenceId}`} className="border-t-2 border-ink/20 pt-2">
                <span className="font-bold">{a.isAgency ? "Marked as an agency" : "Marked as a direct employer"}</span>
                <span className="font-mono text-xs text-muted"> · {formatDate(a.checkedAt, { tz })} · manual</span>
                {a.reason ? <p className="m-0 mt-1 text-ink-soft">“{a.reason}”</p> : null}
              </li>
            ))}
            {d.otherEvidence.map((e) => (
              <li key={`e-${e.id}`} className="border-t-2 border-ink/20 pt-2">
                <span className="font-bold">{e.kind.replace(/_/g, " ")}</span>
                <span className="font-mono text-xs text-muted">
                  {" "}
                  · {e.method} · {e.confidence} · {formatDate(e.checkedAt, { tz })} · {e.logicVersion}
                </span>
                {e.evidence ? <p className="m-0 mt-1 text-ink-soft [overflow-wrap:anywhere]">“{e.evidence.slice(0, 400)}”</p> : null}
                <p className="m-0 font-mono text-xs text-muted [overflow-wrap:anywhere]">{e.source}</p>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

// ---- names & family --------------------------------------------------------------------------

/**
 * One row per name as written: a single name can be stored under several search keys (e.g.
 * "Wise Payments Ltd" as "wise payments ltd" and "wise payments"), which would read as a duplicate.
 */
function distinctNames(names: CompanyDetail["names"]): CompanyDetail["names"] {
  const seen = new Set<string>();
  return names.filter((n) => {
    const key = `${n.kind}|${n.name.trim().toLowerCase()}|${n.countryIso2 ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function NamesAndFamily({ d }: { d: CompanyDetail }) {
  const own = distinctNames(d.names.filter((n) => n.companyId === d.company.id));
  const byRecord = d.mergedRecords.map((m) => ({ record: m, names: distinctNames(d.names.filter((n) => n.companyId === m.id)) }));
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <section aria-labelledby="names-title" className="flex flex-col gap-2">
        <h3 id="names-title" className="micro text-ink">
          Names · {own.length}
        </h3>
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {own.map((n) => (
            <li key={`${n.kind}-${n.normalized}-${n.countryIso2 ?? ""}`} className="flex min-w-0 flex-wrap items-center gap-2">
              <Badge tone={n.kind === "legal" ? "cobalt" : n.kind === "name" ? "ink" : "paper"} variant={n.kind === "name" ? "solid" : "outline"} size="sm">
                {n.kind === "name" ? "Main" : (ALIAS_KIND_LABEL[n.kind] ?? n.kind)}
              </Badge>
              <span className={`[overflow-wrap:anywhere] ${n.kind === "ats_slug" ? "font-mono text-sm" : "font-bold"}`}>{n.name}</span>
              {n.countryIso2 ? <span className="font-mono text-xs text-muted">{n.countryIso2}</span> : null}
            </li>
          ))}
        </ul>
        <p className="text-xs text-muted">The sponsor registers are searched under every name here, including legal names and those of merged records.</p>
      </section>

      <section aria-labelledby="family-title" className="flex flex-col gap-2">
        <h3 id="family-title" className="micro text-ink">
          Family
        </h3>
        {d.ancestors.length || d.subsidiaries.length ? (
          <ol className="m-0 flex list-none flex-col gap-1 border-l-3 border-ink p-0 pl-3 text-sm">
            {[...d.ancestors].reverse().map((a, i) => (
              <li key={a.id} style={{ paddingLeft: `${i * 0.75}rem` }}>
                <CompanyLink c={a} />
              </li>
            ))}
            <li style={{ paddingLeft: `${d.ancestors.length * 0.75}rem` }} className="font-extrabold" aria-current="page">
              ▸ {d.company.name}
            </li>
            {d.subsidiaries.map((s) => (
              <li key={s.id} style={{ paddingLeft: `${(d.ancestors.length + 1) * 0.75}rem` }}>
                <CompanyLink c={s} />
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-ink-soft">No parent or subsidiaries recorded.</p>
        )}
      </section>

      {byRecord.length ? (
        <section aria-labelledby="merged-title" className="flex flex-col gap-2">
          <h3 id="merged-title" className="micro text-ink">
            Merged into this record · {byRecord.length}
          </h3>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {byRecord.map(({ record, names }) => (
              <li key={record.id} className="border-2 border-ink/40 bg-paper px-3 py-2 text-sm">
                <p className="m-0 font-bold">
                  {record.name} <span className="font-mono text-xs font-normal text-muted">#{record.id}</span>
                </p>
                {names.length ? <p className="m-0 text-xs text-ink-soft [overflow-wrap:anywhere]">{names.map((n) => n.name).join(" · ")}</p> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

// ---- jobs & applications ---------------------------------------------------------------------

export function CompanyJobs({ d, tz }: { d: CompanyDetail; tz: string }) {
  if (!d.jobs.length) return <p className="text-sm text-ink-soft">No jobs from this company are in RADAR.</p>;
  return (
    <div className="flex flex-col gap-3">
      <ul className="m-0 flex list-none flex-col divide-y-2 divide-ink/20 p-0">
        {d.jobs.map((j) => {
          const closed = j.state === "closed" || j.state === "expired";
          const visa = isVisaStatus(j.visaStatus) ? VISA_META[j.visaStatus] : null;
          return (
            <li
              key={j.id}
              className={`flex min-w-0 flex-col gap-1 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 ${closed || j.hidden ? "opacity-70" : ""}`}
            >
              <div className="min-w-0">
                <Link href={`/jobs/${j.id}`} className="font-bold underline decoration-2 underline-offset-4 [overflow-wrap:anywhere] hover:decoration-signal">
                  {j.title}
                </Link>
                <p className="m-0 font-mono text-xs text-muted">
                  {[j.city, j.countryIso2].filter(Boolean).join(", ") || "location unknown"} · first seen {formatDate(j.firstSeenAt, { tz })}
                  {j.postedAt ? ` · posted ${formatDate(j.postedAt, { tz })}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                {visa ? (
                  <Badge tone={visa.tone} variant={j.visaStatus === "unknown" ? "outline" : "solid"} size="sm">
                    Visa {visa.label.toLowerCase()}
                  </Badge>
                ) : null}
                <Badge tone={closed ? "concrete" : "paper"} variant="outline" size="sm">
                  {labelOf(STATE_LABEL, j.state)}
                </Badge>
                {j.hidden ? (
                  <Badge tone="concrete" variant="tint" size="sm" icon="eye-off">
                    Hidden
                  </Badge>
                ) : null}
                {typeof j.score === "number" ? <span className="font-mono text-sm font-bold tabular">{Math.round(j.score)}</span> : null}
              </div>
            </li>
          );
        })}
      </ul>
      {d.jobTotal > d.jobs.length ? (
        <p className="text-sm">
          Showing the {formatNumber(d.jobs.length)} newest of {formatNumber(d.jobTotal)}.{" "}
          <Link href={`/jobs?q=${encodeURIComponent(d.company.name)}`} className="font-bold underline underline-offset-4">
            See them all in jobs
          </Link>
        </p>
      ) : null}
    </div>
  );
}

export function CompanyApplications({ d, tz }: { d: CompanyDetail; tz: string }) {
  if (!d.applications.length) {
    return <p className="text-sm text-ink-soft">You have not applied here yet.</p>;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {d.applications.map((a) => (
        <li key={a.id}>
          <Link
            href={`/applications/${a.id}`}
            className="flex min-h-11 min-w-0 flex-col gap-1 border-3 border-ink bg-card px-3 py-2 no-underline shadow-xs hover:bg-acid-tint"
          >
            <span className="font-bold leading-snug [overflow-wrap:anywhere]">{a.title}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <StageBadge stage={a.stage} />
              <span className="font-mono text-[0.6875rem] text-muted">
                {a.appliedAt ? `applied ${formatDate(a.appliedAt, { tz })}` : "not sent yet"}
                {a.companyName !== "" ? ` · as “${a.companyName}”` : ""}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function MergedNotice({ d }: { d: CompanyDetail }) {
  if (!d.mergedInto) return null;
  return (
    <Notice
      kind="warn"
      title={`Merged into ${d.mergedInto.name}`}
      actions={
        <Link href={`/companies/${d.mergedInto.id}`} className={LINK}>
          Open #{d.mergedInto.id}
          <Icon name="arrow-right" size={14} />
        </Link>
      }
    >
      This record is kept so its names keep pointing at the survivor. Its jobs and evidence moved there; fix things (or undo the merge) on #{d.mergedInto.id}.
    </Notice>
  );
}
