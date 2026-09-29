import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "System" };

export default function SystemPage() {
  return (
    <ModulePending
      section="/system"
      module="UI-OPS"
      description="Pipeline runs, alerts, dead letters, audit log, AI usage and backups."
    />
  );
}
