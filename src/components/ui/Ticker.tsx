import Link from "next/link";
import { useId, type ReactNode } from "react";
import { cn } from "./cn";
import { Icon } from "./icons";

export interface TickerItem {
  id: string | number;
  label: ReactNode;
  href?: string;
  /** Right-hand mono detail ("DE · 86"). */
  meta?: ReactNode;
  /** Flag it as new (signal square). */
  fresh?: boolean;
}

export interface TickerProps {
  items: TickerItem[];
  /** Left-hand block ("New today"). */
  kicker?: ReactNode;
  /** Region label for screen readers. */
  label?: string;
  /** 1 fastest … 4 slowest. Default picks by item count. */
  speed?: 1 | 2 | 3 | 4;
  /** Shown when there are no items. */
  emptyText?: ReactNode;
  className?: string;
}

function speedFor(n: number): 1 | 2 | 3 | 4 {
  if (n <= 4) return 1;
  if (n <= 8) return 2;
  if (n <= 14) return 3;
  return 4;
}

function Row({ items }: { items: TickerItem[] }) {
  return (
    <>
      {items.map((item) => (
        <li key={item.id} className="flex shrink-0 items-center gap-2 px-4">
          <span aria-hidden="true" className={cn("size-2.5 shrink-0", item.fresh ? "bg-signal" : "bg-radar")} />
          {item.href ? (
            <Link href={item.href} className="inline-flex min-h-11 items-center font-bold text-paper underline decoration-2 underline-offset-4 hover:bg-acid hover:text-ink hover:no-underline">
              {item.label}
            </Link>
          ) : (
            <span className="font-bold">{item.label}</span>
          )}
          {item.meta ? <span className="font-mono text-xs text-acid tabular">{item.meta}</span> : null}
        </li>
      ))}
    </>
  );
}

/**
 * Marquee of new jobs on an ink strip. Pauses on hover, keyboard focus, or the pause toggle.
 * Under prefers-reduced-motion it becomes a static, horizontally scrollable row.
 * Pure CSS (server component): the duplicate row that makes the loop seamless is inert.
 */
export function Ticker({ items, kicker = "New", label = "New blips", speed, emptyText = "No new blips since the last run.", className }: TickerProps) {
  const id = useId();
  const toggleId = `${id}-pause`;
  const spd = speed ?? speedFor(items.length);

  return (
    <section aria-label={label} className={cn("ticker on-ink relative flex min-h-[3.125rem] items-stretch border-3 border-ink bg-ink text-paper", className)}>
      <div className="flex shrink-0 items-center gap-1.5 border-r-3 border-ink bg-acid px-3 text-ink">
        <Icon name="radar" size={16} />
        <span className="micro whitespace-nowrap">{kicker}</span>
      </div>

      {items.length === 0 ? (
        <p className="flex items-center px-4 font-mono text-sm text-paper">{emptyText}</p>
      ) : (
        <>
          <input id={toggleId} type="checkbox" className="ticker-toggle peer sr-only" />
          <div className={cn("ticker-viewport no-scrollbar relative min-w-0 flex-1 overflow-hidden", `ticker-speed-${spd}`)}>
            <div className="ticker-track flex h-full w-max items-center">
              <ul className="m-0 flex shrink-0 list-none items-center p-0">
                <Row items={items} />
              </ul>
              <ul className="ticker-dup m-0 flex shrink-0 list-none items-center p-0" aria-hidden="true" inert>
                <Row items={items} />
              </ul>
            </div>
          </div>
          <label
            htmlFor={toggleId}
            className={cn(
              "flex min-h-11 w-12 shrink-0 cursor-pointer items-center justify-center border-l-3 border-ink bg-ink text-paper hover:bg-acid hover:text-ink",
              "peer-focus-visible:outline-3 peer-focus-visible:-outline-offset-4 peer-focus-visible:outline-acid motion-reduce:hidden",
            )}
          >
            <span className="sr-only">Pause ticker</span>
            <span aria-hidden="true" className="[.ticker-toggle:checked~*_&]:hidden">
              <Icon name="pause" size={18} />
            </span>
            <span aria-hidden="true" className="hidden [.ticker-toggle:checked~*_&]:inline">
              <Icon name="play" size={18} />
            </span>
          </label>
        </>
      )}
    </section>
  );
}
