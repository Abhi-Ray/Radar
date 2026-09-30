import type { Metadata } from "next";
import { FollowUpsPanel, OnboardingPanel, TopMatchesPanel } from "@/components/dashboard/DeskPanels";
import { HealthStrip } from "@/components/dashboard/HealthStrip";
import { ScopePanel } from "@/components/dashboard/ScopePanel";
import { jobHref } from "@/components/jobs/JobCard";
import { AsOf, SectionHeader, Ticker, type TickerItem } from "@/components/ui";
import { getDeskData } from "@/lib/queries/dashboard";

export const metadata: Metadata = { title: "Desk" };

export default async function DeskPage() {
  const desk = await getDeskData();
  const { now, tz, startOfToday } = desk;
  const stationEmpty = desk.totalJobs.ok && desk.totalJobs.data === 0;
  const tickerItems: TickerItem[] = desk.ticker.ok
    ? desk.ticker.data.map((j) => ({
        id: j.id,
        label: `${j.title} · ${j.company}`,
        href: jobHref(j.id),
        meta: `${j.countryIso2 ?? "??"} · ${j.score ?? "—"}`,
        fresh: j.firstSeenAt.getTime() >= startOfToday.getTime(),
      }))
    : [];

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="00"
        kicker="HUNT · Desk"
        title="The Desk"
        description="What landed today, what is due, and whether the station is healthy."
        actions={<AsOf at={now} now={now} />}
      />

      <Ticker
        items={tickerItems}
        kicker="Newest"
        label="Newest blips"
        emptyText={desk.ticker.ok ? (stationEmpty ? "No blips yet — the scope is quiet." : "No visible jobs yet.") : "The ticker could not be loaded."}
      />

      <HealthStrip health={desk.health} now={now} />

      <OnboardingPanel onboarding={desk.onboarding} />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_28rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <TopMatchesPanel top={desk.top} now={now} tz={tz} stationEmpty={stationEmpty} />
          <FollowUpsPanel followUps={desk.followUps} now={now} tz={tz} />
        </div>
        <ScopePanel scope={desk.scope} newSince={startOfToday} />
      </div>
    </div>
  );
}
