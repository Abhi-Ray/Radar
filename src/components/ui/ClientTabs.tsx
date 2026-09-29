"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { cn } from "./cn";
import { TabCount, tabClasses } from "./Tabs";

export interface ClientTab {
  id: string;
  label: ReactNode;
  count?: number | null;
  content: ReactNode;
}

export interface ClientTabsProps {
  tabs: ClientTab[];
  label: string;
  defaultTab?: string;
  className?: string;
  panelClassName?: string;
}

/**
 * In-page ARIA tabs (roving tabindex, arrows/Home/End). Use for small local switches;
 * prefer LinkTabs when the tab should be in the URL.
 */
export function ClientTabs({ tabs, label, defaultTab, className, panelClassName }: ClientTabsProps) {
  const base = useId();
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.id);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const idx = tabs.findIndex((t) => t.id === active);
    let next = idx;
    if (e.key === "ArrowRight") next = (idx + 1) % tabs.length;
    else if (e.key === "ArrowLeft") next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = tabs.length - 1;
    else return;
    e.preventDefault();
    setActive(tabs[next].id);
    refs.current[next]?.focus();
  }

  return (
    <div className={className}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="no-scrollbar flex gap-1.5 overflow-x-auto border-b-3 border-ink pt-1 pr-1 pb-3">
        {tabs.map((t, i) => {
          const selected = t.id === active;
          return (
            <button
              key={t.id}
              ref={(el) => {
                refs.current[i] = el;
              }}
              type="button"
              role="tab"
              id={`${base}-tab-${t.id}`}
              aria-selected={selected}
              aria-controls={`${base}-panel-${t.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setActive(t.id)}
              className={tabClasses(selected)}
            >
              {t.label}
              <TabCount count={t.count} active={selected} />
            </button>
          );
        })}
      </div>
      {tabs.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-panel-${t.id}`}
          aria-labelledby={`${base}-tab-${t.id}`}
          hidden={t.id !== active}
          tabIndex={0}
          className={cn("pt-4 focus-visible:outline-offset-4", panelClassName)}
        >
          {t.content}
        </div>
      ))}
    </div>
  );
}
