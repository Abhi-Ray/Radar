import type { Metadata } from "next";
import { CountryTiers } from "@/components/countries/CountryCards";
import { EmptyState, SectionHeader, StatBlock } from "@/components/ui";
import { listCountries } from "@/lib/queries/countries";
import { appTz } from "@/lib/time";

export const metadata: Metadata = { title: "Countries" };

export default async function CountriesPage() {
  const tz = appTz();
  const tiers = await listCountries();
  const all = tiers.flatMap((t) => t.countries);
  const live = all.filter((c) => c.isLive).length;
  const verified = all.filter((c) => c.marker === "verified").length;
  const needsWork = all.filter((c) => c.marker === "stale" || c.marker === "unverified").length;
  const pages = all.reduce((n, c) => n + c.pagesToReview, 0);

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="04"
        kicker="SCOPE · Countries"
        title="Countries"
        description="Visa routes and their rules per country, each with its official source and the day it was last checked. A country only goes live when a rule in effect is verified."
      />

      {all.length === 0 ? (
        <EmptyState icon="countries" code="0 ON FILE" size="lg" title="No countries on file" note="Countries come from the seed data">
          <p>Run the database seed to load the target countries, their visa routes and the first rule versions.</p>
        </EmptyState>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatBlock label="Live" value={live} detail={`of ${all.length} countries`} tone={live ? "radar" : "card"} size="sm" />
            <StatBlock label="Rules verified" value={verified} detail="checked within 90 days" size="sm" />
            <StatBlock label="Stale or unverified" value={needsWork} detail="re-check the source" tone={needsWork ? "signal" : "card"} size="sm" />
            <StatBlock label="Pages to review" value={pages} detail="official pages changed" tone={pages ? "acid" : "card"} size="sm" />
          </div>
          <CountryTiers tiers={tiers} tz={tz} />
        </>
      )}
    </div>
  );
}
