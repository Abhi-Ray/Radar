import type { Metadata } from "next";
import { ModulePending } from "@/components/shell/ModulePending";

export const metadata: Metadata = { title: "Company" };

export default async function CompanyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ModulePending
      section="/companies"
      module="UI-TRACKER"
      record={{ kind: "Company", key: id }}
      description="One employer: sponsor evidence, open and past jobs, applications and notes."
    />
  );
}
