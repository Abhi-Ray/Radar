import type { ReactNode } from "react";
import { cn } from "@/components/ui/cn";
import { Icon } from "@/components/ui/icons";
import { Stamp } from "@/components/ui/Stamp";

export interface ErrorScreenProps {
  /** Big stencilled code ("500", "404"). */
  code: string;
  /** Stamp word ("FAULT", "NO SIGNAL"). */
  stamp: string;
  title: ReactNode;
  children?: ReactNode;
  /** Server error digest, printed so it can be matched to the server log line. */
  digest?: string;
  actions?: ReactNode;
  /** "page" = full-viewport screen (root), "panel" = inside the app shell. */
  layout?: "page" | "panel";
  /** Heading level; h1 when this is the only content of the document. */
  as?: "h1" | "h2";
}

/**
 * Shared fault screen for not-found / error boundaries. Plain markup, no hooks, so it works in
 * server components and client error boundaries alike.
 */
export function ErrorScreen({ code, stamp, title, children, digest, actions, layout = "panel", as: H = "h1" }: ErrorScreenProps) {
  return (
    <div className={cn(layout === "page" ? "flex min-h-dvh items-center justify-center px-4 py-10 sm:px-8" : "py-4 md:py-8")}>
      <section className="relative w-full max-w-3xl overflow-hidden border-3 border-ink bg-card shadow-xl">
        <div className="flex items-center justify-between gap-3 border-b-3 border-ink bg-ink px-4 py-2 text-paper">
          <p className="micro flex items-center gap-2 text-acid">
            <Icon name="alert" size={14} />
            Station fault report
          </p>
          <p className="font-mono text-[0.6875rem] font-bold">ERR {code}</p>
        </div>
        <div className="relative p-5 sm:p-8">
          <div aria-hidden="true" className="hatch-soft pointer-events-none absolute inset-0" />
          <span
            aria-hidden="true"
            className="headline wider pointer-events-none absolute -right-3 -bottom-6 select-none text-[clamp(6rem,24vw,13rem)] leading-none text-ink/[0.07]"
          >
            {code}
          </span>
          <div className="relative flex flex-col gap-5">
            <Stamp label={stamp} tone="stamp" size="lg" animate seed={code} className="self-start" />
            <H className="headline wide text-4xl uppercase md:text-6xl">{title}</H>
            {children ? <div className="max-w-prose text-base leading-relaxed text-ink-soft">{children}</div> : null}
            {digest ? (
              <p className="self-start border-2 border-ink bg-paper px-2 py-1 font-mono text-xs">
                <span className="micro mr-2 text-muted">Ref</span>
                <span className="font-bold [overflow-wrap:anywhere]">{digest}</span>
              </p>
            ) : null}
            {actions ? <div className="flex flex-wrap gap-3">{actions}</div> : null}
          </div>
        </div>
      </section>
    </div>
  );
}
