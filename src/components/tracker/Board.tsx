/**
 * The application board (spec §20): one column per stage on desktop (the row scrolls sideways
 * inside its own container), stage tabs + stacked cards on smaller screens (the tab is `?lane=`,
 * so it survives reloads and works without JavaScript). Server component.
 */
import Link from "next/link";
import { EmptyState } from "@/components/ui/EmptyState";
import { Icon } from "@/components/ui/icons";
import { Sticker } from "@/components/ui/Sticker";
import { LinkTabs } from "@/components/ui/Tabs";
import { cn } from "@/components/ui/cn";
import { formatDate, formatTime, tzLabel } from "@/components/ui/format";
import { TONE_SOLID } from "@/components/ui/status";
import type { BoardCard } from "@/lib/queries/applications";
import { reminderBucket } from "@/lib/tracker/follow-up";
import { STAGE_META, type ApplicationStage } from "@/lib/tracker/stages";
import { daysBetween, isTerminalLane, trackerHref, type TrackerFilters } from "./filters";

export interface BoardProps {
  cards: BoardCard[];
  lanes: ApplicationStage[];
  counts: Partial<Record<ApplicationStage, number>>;
  mobileLane: ApplicationStage;
  filters: TrackerFilters;
  now: Date;
  tz: string;
}

function ageLine(card: BoardCard, now: Date): string {
  if (card.appliedAt) {
    const d = daysBetween(card.appliedAt, now);
    return d === 0 ? "applied today" : `applied ${d}d ago`;
  }
  const d = daysBetween(card.updatedAt, now);
  return d === 0 ? "updated today" : `updated ${d}d ago`;
}

function FollowUpTag({ at, now, tz }: { at: Date; now: Date; tz: string }) {
  const bucket = reminderBucket(at, now, tz);
  if (bucket === "overdue")
    return (
      <Sticker tone="stamp" size="sm" icon="alert" tilt="none">
        Follow-up overdue
      </Sticker>
    );
  if (bucket === "today")
    return (
      <Sticker tone="signal" size="sm" icon="clock" tilt="none">
        Follow up today
      </Sticker>
    );
  return (
    <span className="inline-flex items-center gap-1 font-mono text-[0.6875rem] font-bold">
      <Icon name="calendar" size={12} />
      Follow up {formatDate(at, { tz, year: false })} {formatTime(at, { tz })} {tzLabel(tz)}
    </span>
  );
}

export function AppCard({ card, now, tz }: { card: BoardCard; now: Date; tz: string }) {
  return (
    <article className="min-w-0 border-3 border-ink bg-card shadow-sm">
      <Link
        href={`/applications/${card.id}`}
        className="flex min-w-0 flex-col gap-1.5 p-3 no-underline hover:bg-acid-tint focus-visible:bg-acid-tint"
        aria-label={`${card.title} at ${card.companyName} — ${STAGE_META[card.stage].label}`}
      >
        <p className="micro flex min-w-0 items-center justify-between gap-2 text-muted">
          <span className="truncate">{card.companyName}</span>
          <span className="shrink-0 font-mono tabular">#{card.id}</span>
        </p>
        <h3 className="font-extrabold leading-snug [overflow-wrap:anywhere]">{card.title}</h3>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[0.6875rem] text-ink-soft">
          {card.countryIso2 ? (
            <span className="inline-flex items-center gap-1">
              <Icon name="pin" size={12} />
              {card.countryName ?? card.countryIso2}
            </span>
          ) : null}
          <span>{ageLine(card, now)}</span>
          {card.events > 1 ? <span>{card.events} log entries</span> : null}
        </p>
        {card.nextFollowUpAt || card.jobClosed || card.resumeName || card.outcome ? (
          <div className="flex flex-wrap items-center gap-2 pt-0.5">
            {card.nextFollowUpAt ? <FollowUpTag at={card.nextFollowUpAt} now={now} tz={tz} /> : null}
            {card.jobClosed ? (
              <span className="inline-flex items-center gap-1 border-2 border-dashed border-ink px-1 font-mono text-[0.625rem] font-bold uppercase">
                <Icon name="link-broken" size={12} />
                Ad gone · copy kept
              </span>
            ) : null}
            {card.resumeName ? (
              <span className="inline-flex min-w-0 items-center gap-1 font-mono text-[0.6875rem]">
                <Icon name="kit" size={12} />
                <span className="truncate">{card.resumeName}</span>
              </span>
            ) : null}
            {card.outcome ? <span className="min-w-0 truncate text-xs italic text-ink-soft">“{card.outcome}”</span> : null}
          </div>
        ) : null}
      </Link>
    </article>
  );
}

function LaneHead({ stage, count }: { stage: ApplicationStage; count: number }) {
  const m = STAGE_META[stage];
  return (
    <div className={cn("flex items-center justify-between gap-2 border-b-3 border-ink px-3 py-2", TONE_SOLID[m.tone])}>
      <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-black uppercase tracking-[0.06em]">
        <Icon name={m.icon} size={16} />
        <span className="truncate">{m.short}</span>
      </h2>
      <span className="border-2 border-ink bg-card px-1.5 font-mono text-xs font-bold text-ink tabular">{count}</span>
    </div>
  );
}

export function Board({ cards, lanes, counts, mobileLane, filters, now, tz }: BoardProps) {
  const byLane = new Map<ApplicationStage, BoardCard[]>();
  for (const c of cards) byLane.set(c.stage, [...(byLane.get(c.stage) ?? []), c]);
  const mobileCards = byLane.get(mobileLane) ?? [];

  return (
    <>
      {/* Desktop: every lane side by side. */}
      <div className="hidden lg:block">
        <div className="overflow-x-auto pb-3" tabIndex={0} role="region" aria-label="Application board — scroll sideways for more stages">
          <ol className="m-0 flex w-max list-none items-start gap-3 p-0 pr-1">
            {lanes.map((stage) => {
              const list = byLane.get(stage) ?? [];
              const n = counts[stage] ?? 0;
              return (
                <li key={stage} className={cn("flex w-64 shrink-0 flex-col border-3 border-ink shadow-md", isTerminalLane(stage) ? "bg-paper-deep" : "bg-paper")} aria-label={`${STAGE_META[stage].label}: ${n}`}>
                  <LaneHead stage={stage} count={n} />
                  {list.length ? (
                    <ul className="m-0 flex max-h-[68dvh] list-none flex-col gap-3 overflow-y-auto p-2.5">
                      {list.map((c) => (
                        <li key={c.id}>
                          <AppCard card={c} now={now} tz={tz} />
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="px-3 py-6 text-center font-mono text-xs text-muted">{STAGE_META[stage].hint}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* Mobile / tablet: one lane at a time. */}
      <div className="flex min-w-0 flex-col gap-3 lg:hidden">
        <LinkTabs
          label="Stages"
          tabs={lanes.map((stage) => ({ href: trackerHref(filters, { lane: stage }), label: STAGE_META[stage].short, count: counts[stage] ?? 0, active: stage === mobileLane }))}
        />
        <p className="text-sm text-ink-soft">
          <strong className="text-ink">{STAGE_META[mobileLane].label}</strong> · {STAGE_META[mobileLane].hint}
        </p>
        {mobileCards.length ? (
          <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
            {mobileCards.map((c) => (
              <li key={c.id} className="min-w-0">
                <AppCard card={c} now={now} tz={tz} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState size="sm" icon={STAGE_META[mobileLane].icon} title={`Nothing at “${STAGE_META[mobileLane].short}”`}>
            <p>Pick another stage above, or log an application.</p>
          </EmptyState>
        )}
      </div>
    </>
  );
}
