import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { truncate } from "@/components/ui/format";
import { NAV_ITEMS } from "./nav";

export interface ModulePendingProps {
  /** Section href from NAV_ITEMS ("/jobs"); supplies code, label and icon. */
  section: string;
  /** Build module that owns this screen ("UI-JOBS"). */
  module: string;
  /** What the screen will do, one line. */
  description: string;
  /** Detail routes: the record being asked for ("Job", "42"). */
  record?: { kind: string; key: string };
  /** Page title override (defaults to the section label). */
  title?: ReactNode;
}

/**
 * Honest stand-in for a route whose module has not landed yet: the page exists, is behind the
 * login wall and inside the shell, and says plainly which module will fill it.
 */
export function ModulePending({ section, module, description, record, title }: ModulePendingProps) {
  const item = NAV_ITEMS.find((i) => i.href === section);
  const label = item?.label ?? "Section";
  const group = item?.group ? item.group.toUpperCase() : "RADAR";
  return (
    <div className="flex flex-col gap-8">
      <SectionHeader
        as="h1"
        index={item?.code}
        kicker={`${group} · ${record ? `${label} / ${record.kind}` : label}`}
        title={title ?? (record ? `${record.kind} ${truncate(record.key, 24)}` : label)}
        description={description}
      />
      <EmptyState
        icon={item?.icon ?? "radar"}
        code="NOT WIRED"
        tone="concrete"
        size="lg"
        title="Channel not wired yet"
        note={`owner: ${module} · route: ${section}${record ? `/${truncate(record.key, 24)}` : ""}`}
        actions={
          <>
            {record ? (
              <Button href={section} variant="secondary" icon="arrow-left">
                Back to {label}
              </Button>
            ) : null}
            <Button href="/styleguide" variant="secondary" iconRight="arrow-right">
              Browse the UI kit
            </Button>
          </>
        }
      >
        <p>
          This screen is reserved for the <strong className="font-mono">{module}</strong> module. The route, login wall and
          shell are live; the data views arrive when that module lands. Nothing here is hidden or cached — there is simply
          nothing to show yet.
        </p>
      </EmptyState>
    </div>
  );
}
