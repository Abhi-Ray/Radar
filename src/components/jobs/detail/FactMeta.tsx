import type { ReactNode } from "react";
import { AsOf, Card, CardBody, CardHeader, ConfidenceMeter, MethodTag, Unknown, cn, formatDateTime, formatRelative, isStale, type Tone } from "@/components/ui";
import type { Fact } from "@/lib/contracts/provenance";

export type FactLike = Pick<Fact<unknown>, "source" | "method" | "confidence" | "checkedAt" | "logicVersion">;

/** "Source · METHOD · confidence · checked" — printed under every visible fact. */
export function FactMeta({ fact, now, className, empty = "No source yet" }: { fact: FactLike | null | undefined; now: Date; className?: string; empty?: string }) {
  if (!fact) {
    return (
      <p className={cn("text-xs", className)}>
        <Unknown>{empty}</Unknown>
      </p>
    );
  }
  return (
    <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs", className)}>
      <span className="min-w-0">
        <span className="micro mr-1.5 text-muted">Source</span>
        <span className="font-mono font-bold [overflow-wrap:anywhere]">{fact.source}</span>
      </span>
      <MethodTag method={fact.method} />
      <ConfidenceMeter level={fact.confidence} size="sm" />
      <AsOf at={fact.checkedAt} label="Checked" variant="inline" now={now} relative={false} />
    </p>
  );
}

/** A detail-page section: numbered kicker + title band + body. */
export function Panel({
  id,
  code,
  kicker,
  title,
  actions,
  band,
  children,
  className,
  bodyClassName,
}: {
  id: string;
  code: string;
  kicker: string;
  title: ReactNode;
  actions?: ReactNode;
  band?: Tone;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <Card as="section" pad="none" aria-labelledby={`${id}-title`} className={cn("scroll-mt-24", className)} id={id}>
      <CardHeader
        kicker={`${code} · ${kicker}`}
        title={<span id={`${id}-title`}>{title}</span>}
        as="h2"
        actions={actions}
        band={band}
      />
      <CardBody className={cn("flex flex-col gap-4", bodyClassName)}>{children}</CardBody>
    </Card>
  );
}

/** A bare timestamp: absolute date-time + relative age, with a STALE mark past `staleAfterHours`. */
export function When({ at, now, staleAfterHours, className }: { at: Date | null | undefined; now: Date; staleAfterHours?: number; className?: string }) {
  if (!at) return <Unknown>never</Unknown>;
  const stale = staleAfterHours !== undefined && isStale(at, staleAfterHours, now);
  return (
    <span className={cn("font-mono tabular", className)}>
      <time dateTime={at.toISOString()} title={formatDateTime(at)} suppressHydrationWarning>
        {formatDateTime(at)}
        <span className="font-normal opacity-75"> · {formatRelative(at, now)}</span>
      </time>
      {stale ? <span className="ml-1 bg-signal px-1 font-bold uppercase text-ink">Stale</span> : null}
    </span>
  );
}
