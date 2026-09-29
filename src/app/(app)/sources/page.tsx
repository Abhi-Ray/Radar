import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Sources" };

export default function SourcesPage() {
  return (
    <ModulePending
      section="/sources"
      module="UI-OPS"
      description="Job feeds and connectors: health, last run, yield and errors."
    />
  );
}
