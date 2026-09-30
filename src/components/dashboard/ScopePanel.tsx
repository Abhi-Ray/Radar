import Link from "next/link";
import { Card, CardBody, CardHeader, FitGauge, RadarSweep, VISA_META, cn } from "@/components/ui";
import { jobHref } from "@/components/jobs/JobCard";
import type { JobListRow } from "@/lib/queries/jobs";
import type { Section } from "@/lib/queries/dashboard";
import { REGION_SECTORS, groupBySector, placeJobBlips } from "./blips";
import { SectionError } from "./DeskPanels";

const LEGEND = ["confirmed", "likely", "unknown", "not_offered", "conflicting"] as const;
const DOT: Record<string, string> = {
  radar: "bg-radar",
  acid: "bg-acid",
  signal: "bg-signal",
  stamp: "bg-stamp",
  cobalt: "bg-cobalt",
  lilac: "bg-lilac",
  concrete: "bg-concrete",
  paper: "bg-paper",
};

/**
 * The scope: the default view's best jobs as blips (range = fit, bearing = region, colour = visa).
 * The grouped list under it carries the same data for keyboard and screen-reader use.
 */
export function ScopePanel({ scope, newSince }: { scope: Section<JobListRow[]>; newSince: Date }) {
  const blips = scope.ok
    ? placeJobBlips(
        scope.data.map((j) => ({ id: j.id, title: j.title, company: j.company, countryIso2: j.countryIso2, score: j.score, visaStatus: j.visaStatus, firstSeenAt: j.firstSeenAt })),
        { newSince, hrefFor: jobHref },
      )
    : [];
  const groups = groupBySector(blips);
  const regionsSeen = new Set(blips.map((b) => b.sector));

  return (
    <Card as="section" pad="none" aria-labelledby="desk-scope">
      <CardHeader kicker="Scope · top of the default view" title={<span id="desk-scope">On the radar</span>} as="h2" band="radar" />
      <CardBody className="flex flex-col gap-4">
        {!scope.ok ? <SectionError section={scope} title="Scope unavailable" /> : null}
        <div className="mx-auto w-full max-w-[26rem]">
          <RadarSweep
            blips={blips}
            label={blips.length ? "Top jobs by fit and region. Closer to the centre is a better fit." : "Radar scope, no jobs yet"}
          />
        </div>
        <p className="text-xs text-ink-soft">
          Closer to the hub = better fit. Each region owns a slice, clockwise from north:{" "}
          {REGION_SECTORS.filter((_, i) => regionsSeen.has(i))
            .map((s) => s.short)
            .join(" · ") || "no regions yet"}
          .
        </p>
        <ul className="flex list-none flex-wrap gap-x-3 gap-y-1 p-0 text-xs" aria-label="Blip colours">
          {LEGEND.map((k) => (
            <li key={k} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={cn("size-3 border-2 border-ink", DOT[VISA_META[k].tone] ?? "bg-concrete")} />
              {VISA_META[k].label}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="size-3 border-2 border-ink outline-2 outline-offset-1 outline-ink" />
            Ring = new today
          </li>
        </ul>

        {blips.length ? (
          <details className="group border-2 border-ink">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 bg-paper px-3 py-2 font-bold [&::-webkit-details-marker]:hidden">
              As a list · {blips.length} jobs by region
              <span aria-hidden="true" className="font-mono text-xs group-open:hidden">
                show
              </span>
              <span aria-hidden="true" className="hidden font-mono text-xs group-open:inline">
                hide
              </span>
            </summary>
            <div className="flex flex-col gap-3 border-t-2 border-ink p-3">
              {groups.map((g) => (
                <section key={g.sector.key} aria-label={g.sector.label}>
                  <h3 className="micro mb-1.5 text-muted">
                    {g.sector.label} · {g.blips.length}
                  </h3>
                  <ul className="flex list-none flex-col gap-1 p-0">
                    {g.blips.map((b) => (
                      <li key={b.id}>
                        <Link href={b.href ?? jobHref(b.id)} className="flex items-center gap-2 py-1 text-sm no-underline hover:underline">
                          <FitGauge score={b.score} variant="inline" className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">
                            <span className="font-bold">{b.title}</span> <span className="text-ink-soft">· {b.company}</span>
                          </span>
                          <span className="shrink-0 font-mono text-[0.6875rem] uppercase">{b.visaLabel}</span>
                          {b.isNew ? <span className="shrink-0 bg-signal px-1 font-mono text-[0.625rem] font-bold uppercase">New</span> : null}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          </details>
        ) : scope.ok ? (
          <p className="border-2 border-dashed border-ink/50 p-3 text-sm text-muted">
            The sweep finds nothing: no job passes the default view yet. Blips appear here after the first successful run.
          </p>
        ) : null}
      </CardBody>
    </Card>
  );
}
