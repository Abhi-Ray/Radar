import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Application" };

export default async function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ModulePending
      section="/applications"
      module="UI-TRACKER"
      record={{ kind: "Application", key: id }}
      description="One application: stage history, contacts, documents sent and next follow-up."
    />
  );
}
