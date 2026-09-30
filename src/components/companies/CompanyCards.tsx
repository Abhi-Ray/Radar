/**
 * /companies list (server): one index card per company with its sponsor stamp, HQ, size, type,
 * open jobs and — when a register lists it — which register and the file's download date.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatNumber } from "@/components/ui/format";
import { Icon } from "@/components/ui/icons";
import { Sticker } from "@/components/ui/Sticker";
import type { CompanyListRow } from "@/lib/queries/companies";
import { SponsorStamp } from "./SponsorStamp";
import { companyTypeLabel, registerSummaryLine, sizeLabel } from "./view";

export function CompanyCards({ rows }: { rows: CompanyListRow[] }) {
  return (
    <ul className="m-0 grid list-none gap-4 p-0 md:grid-cols-2 2xl:grid-cols-3">
      {rows.map((c) => (
        <li key={c.id} className="min-w-0">
          <CompanyCard c={c} />
        </li>
      ))}
    </ul>
  );
}

function CompanyCard({ c }: { c: CompanyListRow }) {
  const line = registerSummaryLine(c.summary);
  const size = sizeLabel(c.sizeBand);
  return (
    <article aria-labelledby={`co-${c.id}`} className="relative flex h-full min-w-0 flex-col gap-3 border-3 border-ink bg-card p-4 shadow-md">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 id={`co-${c.id}`} className="text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
            <Link
              href={`/companies/${c.id}`}
              className="underline decoration-2 underline-offset-4 hover:decoration-signal after:absolute after:inset-0 after:content-['']"
            >
              {c.name}
            </Link>
          </h3>
          {c.domain ? <p className="mt-0.5 truncate font-mono text-xs text-muted">{c.domain}</p> : null}
        </div>
        <SponsorStamp cls={c.sponsor} size="sm" className="shrink-0" />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone="paper" variant="outline" size="sm" icon="pin">
          {c.hqCountryName ?? c.hqCountry ?? "HQ unknown"}
        </Badge>
        {size ? (
          <Badge tone="paper" variant="outline" size="sm">
            {size}
          </Badge>
        ) : null}
        {/* The agency sticker already says "Agency". */}
        {c.type !== "unknown" && !(c.isAgency && c.type === "agency") ? (
          <Badge tone="lilac" variant="tint" size="sm">
            {companyTypeLabel(c.type)}
          </Badge>
        ) : null}
        {c.isAgency ? (
          <Sticker tone="signal" size="sm" tilt="none">
            Agency
          </Sticker>
        ) : null}
      </div>
      {line ? (
        <p className="flex min-w-0 items-center gap-1.5 font-mono text-xs text-ink-soft">
          <Icon name="receipt" size={14} className="shrink-0" />
          <span className="truncate">{line}</span>
          {c.summary && c.summary.possibleMatches > 0 && c.sponsor !== "confirmed" ? (
            <span className="shrink-0 text-muted">· {c.summary.possibleMatches} to check</span>
          ) : null}
        </p>
      ) : null}
      <div className="mt-auto flex items-end justify-between gap-2 border-t-2 border-dashed border-ink/40 pt-2">
        <p className="m-0 flex items-baseline gap-1.5">
          <span className="font-mono text-2xl font-bold tabular">{formatNumber(c.openJobs)}</span>
          <span className="text-sm font-bold">open {c.openJobs === 1 ? "job" : "jobs"}</span>
        </p>
        <p className="m-0 font-mono text-[0.6875rem] text-muted">
          #{c.id}
          {c.aliases ? ` · +${c.aliases} ${c.aliases === 1 ? "name" : "names"}` : ""}
          {c.parentCompanyId ? " · subsidiary" : ""}
        </p>
      </div>
    </article>
  );
}
