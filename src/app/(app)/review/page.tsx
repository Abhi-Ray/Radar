import type { Metadata } from "next";
import Link from "next/link";
import { pairReasons, pairScoreText, qualityFlags } from "@/components/review/flags";
import { ActionForm } from "@/components/system/ActionForm";
import { Badge, EmptyState, LinkTabs, Notice, Pagination, SectionHeader, formatNumber, formatRelative, truncate } from "@/components/ui";
import { ROLES } from "@/data/titles/roles";
import { requireSession } from "@/lib/auth/session";
import { clearReviewFlagAction, dismissDuplicateAction, ignoreUnrelatedTitlesAction, keepBothAction, mapTitleAction, mergeDuplicateAction, mergeTwinsAction } from "@/lib/actions/review";
import { REVIEW_PAGE_SIZE, listFlaggedJobs, listPairs, listTitles, reviewCounts, reviewTidy, type PairSide } from "@/lib/queries/review";

export const metadata: Metadata = { title: "Review" };

const TABS = ["duplicates", "titles", "jobs", "failed"] as const;
type Tab = (typeof TABS)[number];
const LABEL: Record<Tab, string> = { duplicates: "Possible duplicates", titles: "Unknown titles", jobs: "Needs a look", failed: "Parse failures" };
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const selectClass = "min-h-11 min-w-56 border-3 border-ink bg-card px-3 text-sm font-bold";

function Side({ s, label, now }: { s: PairSide; label: string; now: Date }) {
  return (
    <div className="min-w-0 border-3 border-ink bg-card p-3">
      <p className="micro">{label} · job #{s.id} · {s.state}</p>
      <Link href={`/jobs/${s.id}`} className="block font-bold underline underline-offset-4 [overflow-wrap:anywhere]">{s.title}</Link>
      <p className="text-sm">{s.company}</p>
      <p className="text-sm text-ink-soft">{[s.city, s.countryIso2].filter(Boolean).join(", ") || s.locationRaw || "—"}</p>
      <p className="micro mt-1">{s.source ?? "no source"} · first seen {formatRelative(s.firstSeenAt, now)}</p>
    </div>
  );
}

export default async function ReviewPage({ searchParams }: PageProps<"/review">) {
  await requireSession();
  const sp = await searchParams;
  const tab: Tab = (TABS as readonly string[]).includes(first(sp.tab)) ? (first(sp.tab) as Tab) : "duplicates";
  const page = Math.max(1, Math.floor(Number(first(sp.page))) || 1);
  const now = new Date();
  const [counts, tidy] = await Promise.all([reviewCounts(), reviewTidy()]);
  const count: Record<Tab, number> = { duplicates: counts.duplicates, titles: counts.titles, jobs: counts.jobs, failed: counts.failed };

  const pairs = tab === "duplicates" ? await listPairs(page) : null;
  const titles = tab === "titles" ? await listTitles(page) : null;
  const flagged = tab === "jobs" ? await listFlaggedJobs(page) : null;
  const total = pairs?.total ?? titles?.total ?? flagged?.total ?? 0;
  const roleOptions = ROLES.filter((r) => r.key !== "other");

  return (
    <div className="flex flex-col gap-6">
      <SectionHeader
        as="h1"
        index="06"
        kicker="OPS · Review"
        title="Review"
        description="Where RADAR asks you instead of guessing: jobs that may be the same posting, titles it cannot place, postings that look doubtful. Nothing here is decided for you."
      />

      <LinkTabs label="Review queues" tabs={TABS.map((t) => ({ href: t === "duplicates" ? "/review" : `/review?tab=${t}`, label: LABEL[t], count: count[t], active: t === tab }))} />

      {tab === "duplicates" && pairs ? (
        pairs.rows.length === 0 ? (
          <EmptyState icon="merge" code="ALL CLEAR" title="No possible duplicates" tone="radar"><p>Every pair RADAR was unsure about has been decided.</p></EmptyState>
        ) : (
          <>
            {tidy.pairs.twins + tidy.pairs.keepBoth > 0 ? (
              <Notice
                kind="warn"
                title={`${formatNumber(tidy.pairs.twins + tidy.pairs.keepBoth)} of these pairs are one source listing separate postings`}
                live="off"
              >
                <p>
                  When the <b>same source</b> lists two jobs, it is telling you they are two postings — usually the same role in several cities, or one opening per team. They rarely need you.
                  RADAR clears them after every run; these buttons do it right now. Pairs from <b>different</b> sources (the real duplicates) are never touched
                  {tidy.pairs.needHuman ? ` — ${formatNumber(tidy.pairs.needHuman)} of those are waiting below` : ""}.
                </p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {tidy.pairs.twins > 0 ? (
                    <ActionForm action={mergeTwinsAction} submit={`Merge ${formatNumber(tidy.pairs.twins)} exact twins`} icon="merge" variant="primary" pending="Merging…" />
                  ) : null}
                  {tidy.pairs.keepBoth > 0 ? (
                    <ActionForm action={keepBothAction} submit={`Keep both for ${formatNumber(tidy.pairs.keepBoth)} pairs`} icon="split" pending="Clearing…" />
                  ) : null}
                </div>
                <p className="micro mt-2">Exact twin = same company, title, city and text. Merging keeps the older job and moves the other&apos;s links onto it; each merge is in the audit trail (System).</p>
              </Notice>
            ) : null}
            <Notice kind="info" title="Highest match first">Merging keeps one job and moves the other&apos;s links onto it. Every merge is written to the audit trail (System).</Notice>
            <ul className="m-0 flex list-none flex-col gap-4 p-0">
              {pairs.rows.map((p) => (
                <li key={p.id} className="flex flex-col gap-3 border-3 border-ink bg-paper/60 p-3 shadow-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="signal" variant="solid">{pairScoreText(p.score)} alike</Badge>
                    {pairReasons(p.reasons).slice(0, 6).map((r) => (
                      <span key={r} className="micro border-2 border-ink/40 px-1.5 py-0.5">{r}</span>
                    ))}
                  </div>
                  <div className="grid gap-3 md:grid-cols-2">
                    <Side s={p.a} label="Left" now={now} />
                    <Side s={p.b} label="Right" now={now} />
                  </div>
                  <div className="flex flex-wrap gap-3">
                    <ActionForm action={mergeDuplicateAction} hidden={{ candidateId: p.id, keepId: p.a.id }} submit="Same job — keep left" icon="merge" variant="primary" pending="Merging…" />
                    <ActionForm action={mergeDuplicateAction} hidden={{ candidateId: p.id, keepId: p.b.id }} submit="Same job — keep right" icon="merge" pending="Merging…" />
                    <ActionForm action={dismissDuplicateAction} hidden={{ candidateId: p.id }} submit="Different jobs" icon="split" variant="ghost" pending="Saving…" />
                  </div>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}

      {tab === "titles" && titles ? (
        titles.rows.length === 0 ? (
          <EmptyState icon="review" code="ALL CLEAR" title="No unknown titles" tone="radar"><p>Every title seen so far could be placed.</p></EmptyState>
        ) : (
          <>
            {tidy.titles.unrelated > 0 ? (
              <Notice kind="warn" title={`${formatNumber(tidy.titles.unrelated)} of ${formatNumber(tidy.titles.total)} titles contain no technical word`} live="off">
                <p>Sales, HR, retail, trades … They are already scored as “not a target role”, so nothing changes if you mark them as ignored. RADAR does this after every run; the button does it now. Titles with a technical word stay for you.</p>
                <div className="mt-3">
                  <ActionForm action={ignoreUnrelatedTitlesAction} submit={`Ignore ${formatNumber(tidy.titles.unrelated)} unrelated titles`} icon="check" variant="primary" pending="Clearing…" />
                </div>
              </Notice>
            ) : null}
            <Notice kind="info" title="Most common first">Tell RADAR which role a title is. It applies to new and re-processed jobs; “Not a role I track” hides the guess for good.</Notice>
            <ul className="m-0 flex list-none flex-col gap-3 p-0">
              {titles.rows.map((t) => (
                <li key={t.id} className="flex flex-col gap-2 border-3 border-ink bg-card p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-bold [overflow-wrap:anywhere]">{t.titleRaw}</span>
                    <Badge tone="card" variant="outline" size="sm">seen {formatNumber(t.count)}×</Badge>
                    {t.lang ? <span className="micro">{t.lang}</span> : null}
                    {t.sample ? <Link href={`/jobs/${t.sample.jobId}`} className="micro underline underline-offset-4">e.g. {truncate(t.sample.company, 30)}</Link> : null}
                  </div>
                  <ActionForm action={mapTitleAction} hidden={{ queueId: t.id }} submit="Save" icon="check" variant="primary" pending="Saving…">
                    <label className="flex flex-col gap-1">
                      <span className="micro">This title is a…</span>
                      <select name="roleKey" defaultValue="__ignore" className={selectClass}>
                        <option value="__ignore">Not a role I track</option>
                        {roleOptions.map((r) => (
                          <option key={r.key} value={r.key}>{r.label}</option>
                        ))}
                      </select>
                    </label>
                  </ActionForm>
                </li>
              ))}
            </ul>
          </>
        )
      ) : null}

      {tab === "jobs" && flagged ? (
        flagged.rows.length === 0 ? (
          <EmptyState icon="check" code="ALL CLEAR" title="Nothing looks doubtful" tone="radar"><p>No posting is flagged for a second look.</p></EmptyState>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {flagged.rows.map((j) => {
              const flags = qualityFlags(j);
              return (
                <li key={j.id} className="flex flex-col gap-2 border-3 border-ink bg-card p-3">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <Link href={`/jobs/${j.id}`} className="font-bold underline underline-offset-4 [overflow-wrap:anywhere]">{j.title}</Link>
                    <span className="text-sm">{j.company}</span>
                    <span className="micro">{j.countryIso2 ?? "—"} · seen {formatRelative(j.lastSeenAt, now)}</span>
                    {j.score !== null ? <Badge tone="lilac" variant="outline" size="sm">score {Math.round(j.score)}</Badge> : null}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {flags.length ? flags.map((f) => <Badge key={f.key} tone={f.tone} variant="tint" size="sm">{f.label}</Badge>) : <span className="micro">flagged, no specific reason recorded</span>}
                  </div>
                  <ActionForm action={clearReviewFlagAction} hidden={{ jobId: j.id }} submit="Looks fine" icon="check" pending="Saving…" />
                </li>
              );
            })}
          </ul>
        )
      ) : null}

      {tab === "failed" ? (
        <Notice kind={counts.failed ? "warn" : "info"} title={counts.failed ? `${formatNumber(counts.failed)} postings could not be saved` : "Nothing failed"}>
          Postings that failed to parse or save are kept, not dropped, and retried by the next run. The list with the reasons is on the{" "}
          <Link href="/system#failed" className="font-bold underline underline-offset-4">System screen</Link>.
        </Notice>
      ) : null}

      {tab !== "failed" && total > REVIEW_PAGE_SIZE ? (
        <Pagination pathname="/review" searchParams={tab === "duplicates" ? {} : { tab }} page={page} pageSize={REVIEW_PAGE_SIZE} total={total} noun={LABEL[tab].toLowerCase()} />
      ) : null}
    </div>
  );
}
