/**
 * Section panel used across /applications, /kit, /companies and /countries: a card with a lettered
 * kicker ("C · Logbook"), an h2 title and a body. Server-safe.
 */
import type { ReactNode } from "react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { cn } from "@/components/ui/cn";
import type { Tone } from "@/components/ui/status";

export interface PanelProps {
  id: string;
  code: string;
  kicker: string;
  title: ReactNode;
  actions?: ReactNode;
  band?: Tone;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}

export function Panel({ id, code, kicker, title, actions, band, children, className, bodyClassName }: PanelProps) {
  return (
    <Card as="section" pad="none" aria-labelledby={`${id}-title`} className={cn("min-w-0 scroll-mt-24", className)} id={id}>
      <CardHeader kicker={`${code} · ${kicker}`} title={<span id={`${id}-title`}>{title}</span>} as="h2" actions={actions} band={band} />
      <CardBody className={cn("flex min-w-0 flex-col gap-4", bodyClassName)}>{children}</CardBody>
    </Card>
  );
}
