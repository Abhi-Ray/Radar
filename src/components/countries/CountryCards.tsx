/**
 * /countries list (server): countries grouped by tier, each card stamped live / off with the
 * freshness of its rules (verified, stale, unverified) and pages waiting for review.
 */
import Link from "next/link";
import { Badge } from "@/components/ui/Badge";
import { formatDate } from "@/components/ui/format";
import { Stamp } from "@/components/ui/Stamp";
import { Sticker } from "@/components/ui/Sticker";
import type { CountryListItem, CountryTier } from "@/lib/queries/countries";
import { MARKER_LABEL, tierLabel } from "./model";
import { MARKER_TONE } from "./view";

export function IsoBlock({ iso2, size = "md" }: { iso2: string; size?: "md" | "lg" }) {
  return (
    <span
      aria-hidden="true"
      className={`inline-flex shrink-0 items-center justify-center border-3 border-ink bg-ink font-mono font-bold tracking-[0.08em] text-paper ${size === "lg" ? "h-16 w-20 text-3xl" : "h-11 w-14 text-lg"}`}
    >
      {iso2}
    </span>
  );
}

function CountryCard({ c, tz }: { c: CountryListItem; tz: string }) {
  return (
    <article aria-labelledby={`country-${c.iso2}`} className="relative flex h-full min-w-0 flex-col gap-3 border-3 border-ink bg-card p-4 shadow-md">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <IsoBlock iso2={c.iso2} />
          <div className="min-w-0">
            <h3 id={`country-${c.iso2}`} className="text-lg font-extrabold leading-tight [overflow-wrap:anywhere]">
              <Link
                href={`/countries/${c.iso2.toLowerCase()}`}
                className="underline decoration-2 underline-offset-4 hover:decoration-signal after:absolute after:inset-0 after:content-['']"
              >
                {c.name}
              </Link>
            </h3>
            <p className="m-0 font-mono text-xs text-muted">{[c.region, c.currency].filter(Boolean).join(" · ") || "—"}</p>
          </div>
        </div>
        <Stamp
          label={c.isLive ? "Live" : "Off"}
          tone={c.isLive ? "radar" : "concrete"}
          size="sm"
          dashed={!c.isLive}
          inked={false}
          tilt={c.isLive ? "auto" : "none"}
          srLabel={c.isLive ? "Live: jobs are in scope" : "Off: jobs are not in scope"}
        />
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge tone={MARKER_TONE[c.marker]} variant={c.marker === "verified" ? "solid" : c.marker === "none" ? "outline" : "tint"} size="sm">
          {MARKER_LABEL[c.marker]}
        </Badge>
        <Badge tone="paper" variant="outline" size="sm">
          {c.routes} {c.routes === 1 ? "route" : "routes"}
        </Badge>
        {c.pagesToReview ? (
          <Sticker tone="signal" size="sm" tilt="none" icon="alert">
            {c.pagesToReview} {c.pagesToReview === 1 ? "page" : "pages"} to review
          </Sticker>
        ) : null}
      </div>
      <p className="m-0 mt-auto border-t-2 border-dashed border-ink/40 pt-2 font-mono text-xs text-ink-soft">
        {c.nextReviewAt ? `next review ${formatDate(c.nextReviewAt, { tz })}` : c.routes ? "no review date set" : "no visa routes on file"}
      </p>
    </article>
  );
}

export function CountryTiers({ tiers, tz }: { tiers: CountryTier[]; tz: string }) {
  return (
    <div className="flex flex-col gap-8">
      {tiers.map((t) => {
        const live = t.countries.filter((c) => c.isLive).length;
        return (
          <section key={t.tier} aria-labelledby={`tier-${t.tier}`} className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 border-b-3 border-ink pb-1.5">
              <h2 id={`tier-${t.tier}`} className="text-xl font-extrabold">
                {tierLabel(t.tier)}
              </h2>
              <p className="m-0 font-mono text-xs text-muted">
                {live} of {t.countries.length} live
              </p>
            </div>
            <ul className="m-0 grid list-none gap-4 p-0 sm:grid-cols-2 xl:grid-cols-3">
              {t.countries.map((c) => (
                <li key={c.iso2} className="min-w-0">
                  <CountryCard c={c} tz={tz} />
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
