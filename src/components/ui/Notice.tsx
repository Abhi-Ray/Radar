import type { ReactNode } from "react";
import { cn } from "./cn";
import { Icon, type IconName } from "./icons";

export type NoticeKind = "info" | "ok" | "warn" | "danger" | "ai" | "neutral";

const KIND: Record<NoticeKind, { bar: string; bg: string; icon: IconName; word: string }> = {
  info: { bar: "bg-cobalt text-white", bg: "bg-cobalt-tint", icon: "info", word: "Note" },
  ok: { bar: "bg-radar text-ink", bg: "bg-radar-tint", icon: "check", word: "OK" },
  warn: { bar: "bg-signal text-ink", bg: "bg-signal-tint", icon: "alert", word: "Heads up" },
  danger: { bar: "bg-stamp-deep text-white", bg: "bg-stamp-tint", icon: "alert", word: "Problem" },
  ai: { bar: "bg-lilac text-ink", bg: "bg-lilac-tint", icon: "ai", word: "AI" },
  neutral: { bar: "bg-ink text-paper", bg: "bg-card", icon: "info", word: "Note" },
};

export interface NoticeProps {
  kind?: NoticeKind;
  title?: ReactNode;
  children?: ReactNode;
  /** Override the word on the side bar. */
  label?: string;
  actions?: ReactNode;
  /** role="alert" for errors that appear after an action; default role="status" for warn/danger, none otherwise. */
  live?: "alert" | "status" | "off";
  className?: string;
}

/** Inline banner: a labelled colour bar + message. */
export function Notice({ kind = "info", title, children, label, actions, live, className }: NoticeProps) {
  const k = KIND[kind];
  const role = live === "off" ? undefined : live ?? (kind === "danger" || kind === "warn" ? "status" : undefined);
  return (
    <div role={role} className={cn("flex min-w-0 border-3 border-ink shadow-sm", k.bg, className)}>
      <div aria-hidden="true" className={cn("flex w-10 shrink-0 justify-center border-r-3 border-ink pt-2.5", k.bar)}>
        <Icon name={k.icon} size={20} />
      </div>
      <div className="min-w-0 flex-1 px-3 py-2.5 md:px-4">
        <span className="sr-only">{label ?? k.word}: </span>
        {title ? <p className="font-extrabold leading-snug">{title}</p> : null}
        {children ? <div className={cn("text-sm leading-relaxed", title && "mt-0.5")}>{children}</div> : null}
        {actions ? <div className="mt-2.5 flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
