import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Source" };

export default async function SourcePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ModulePending
      section="/sources"
      module="UI-OPS"
      record={{ kind: "Source", key: id }}
      description="One connector: run history, yield trend, errors and configuration."
    />
  );
}
